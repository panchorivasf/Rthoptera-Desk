// Voice notes: find stretches of human speech in a recording and, on request,
// transcribe them. Loaded after main.js.
//
//   Detection      Silero VAD (a 2 MB ONNX model, bundled in vendor/silero) run
//                  with onnxruntime-web over the recording at 16 kHz.
//   Transcription  OpenAI Whisper (ONNX export, encoder + decoder + tokenizer),
//                  run with onnxruntime-web. The model is not bundled: it is
//                  downloaded once, or loaded from files, and kept in the
//                  browser's IndexedDB so it survives restarts. Only the stretches
//                  the detector found are transcribed, so Whisper never sees
//                  insect sound alone (where it tends to invent text).
//
// Everything runs on this computer; nothing is sent anywhere except the one
// download of the model files, which the user starts.

const VN_SR = 16000; // both models work at 16 kHz
const VN_CHUNK = 512; // Silero frame: 32 ms
const VN_CTX = 64; // Silero context carried between frames
const VN_BLOCK = 960 * VN_CHUNK; // samples per VAD block (30.72 s at 16 kHz)
const VN_WIN = 30 * VN_SR; // Whisper window
const VN_NFFT = 400;
const VN_HOP = 160;

const VN = {
  ranges: [], // {t0, t1, conf, text|null, lang|null}
  key: "", // which recording/timeline the ranges belong to
  vad: null, // onnx session
  model: null, // {label, enc: ArrayBuffer, dec: ArrayBuffer, tok: string, gen: string|null}
  w: null, // built Whisper runtime (sessions + tokenizer)
  busy: false,
  cancel: false,
  detCfg: "", // detection settings the current list was made with
};

// The settings that decide the result. A list made with other settings than
// the ones showing now is out of date.
function vnDetectCfg() {
  return vnEl("vnSens").value + "|" + vnEl("vnMin").value;
}
function vnTranscribeCfg() {
  return vnEl("vnLang").value + "|" + (VN.model ? VN.model.id || VN.model.label : "");
}

// ── onnxruntime-web setup (same as the Clustering module) ───────────────
function vnOrtInit() {
  if (typeof ort === "undefined") throw new Error("onnxruntime-web is missing (vendor/ort).");
  if (vnOrtInit.done) return;
  const base = new URL("vendor/ort/", document.baseURI).href;
  ort.env.wasm.wasmPaths = {
    mjs: base + "ort-wasm-simd-threaded.mjs",
    wasm: base + "ort-wasm-simd-threaded.wasm",
  };
  ort.env.wasm.numThreads = 1;
  vnOrtInit.done = true;
}

// ── audio at 16 kHz ─────────────────────────────────────────────────────
// `nOut` samples of `sig` (sample rate `sr`) starting at `startSec`, resampled
// to 16 kHz (low-passed first when downsampling). Reads a little before and
// after so the filter's edges fall outside what is returned. Out-of-range
// parts are zero.
function vnAudio16k(sig, sr, startSec, nOut) {
  const out = new Float32Array(nOut);
  const margin = 0.2;
  const s0 = Math.max(0, Math.floor((startSec - margin) * sr));
  const s1 = Math.min(sig.length, Math.ceil((startSec + nOut / VN_SR + margin) * sr));
  if (s1 <= s0) return out;
  const seg = sig.subarray(s0, s1);
  let y;
  if (sr === VN_SR) y = seg;
  else if (sr > VN_SR) y = applyResample(seg, sr, VN_SR);
  else y = _resampleLinear(seg, sr / VN_SR, Math.max(1, Math.round((seg.length * VN_SR) / sr)));
  const off = Math.round((startSec - s0 / sr) * VN_SR);
  for (let i = 0; i < nOut; i++) {
    const k = i + off;
    if (k >= 0 && k < y.length) out[i] = y[k];
  }
  return out;
}

// ── voice activity detection ────────────────────────────────────────────
async function vnLoadVad() {
  if (VN.vad) return VN.vad;
  vnOrtInit();
  const res = await fetch(new URL("vendor/silero/silero_vad.onnx", document.baseURI).href);
  if (!res.ok) throw new Error("the voice-detection model (vendor/silero/silero_vad.onnx) is missing");
  VN.vad = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ["wasm"],
  });
  return VN.vad;
}

// Speech probability for every 32 ms frame of `sig`. onProgress(0..1).
async function vnVadProbs(sig, sr, onProgress) {
  const sess = await vnLoadVad();
  const total = sig.length / sr;
  const nFrames = Math.ceil((total * VN_SR) / VN_CHUNK);
  const probs = new Float32Array(nFrames);
  let state = new Float32Array(2 * 1 * 128);
  let ctx = new Float32Array(VN_CTX);
  const srT = new ort.Tensor("int64", BigInt64Array.from([BigInt(VN_SR)]), []);
  const buf = new Float32Array(VN_CTX + VN_CHUNK);
  let f = 0,
    tick = 0;
  for (let b0 = 0; f < nFrames; b0 += VN_BLOCK) {
    if (VN.cancel) throw new Error("cancelled");
    const x = vnAudio16k(sig, sr, b0 / VN_SR, VN_BLOCK);
    for (let k = 0; k + VN_CHUNK <= VN_BLOCK && f < nFrames; k += VN_CHUNK, f++) {
      buf.set(ctx, 0);
      buf.set(x.subarray(k, k + VN_CHUNK), VN_CTX);
      ctx = buf.slice(VN_CHUNK);
      const out = await sess.run({
        input: new ort.Tensor("float32", buf.slice(), [1, VN_CTX + VN_CHUNK]),
        state: new ort.Tensor("float32", state, [2, 1, 128]),
        sr: srT,
      });
      probs[f] = out.output.data[0];
      state = Float32Array.from(out.stateN.data);
      if (++tick % 64 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(Math.min(1, f / nFrames));
  }
  return probs;
}

// Speech probabilities -> time ranges. Hysteresis (a stretch starts at
// `thr` and ends once the probability stays below thr-0.15), then stretches
// separated by less than `minSilence` are joined, short ones are dropped, and
// each is padded a little so a word's first and last sounds are inside.
function vnSegments(probs, dur, o) {
  const thr = o.thr,
    neg = Math.max(0.01, thr - 0.15),
    fd = VN_CHUNK / VN_SR;
  const raw = [];
  let start = -1,
    lastHi = -1;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (start < 0) {
      if (p >= thr) {
        start = i;
        lastHi = i;
      }
    } else if (p >= neg) {
      lastHi = i;
    } else if ((i - lastHi) * fd >= o.minSilence) {
      raw.push([start, lastHi + 1]);
      start = -1;
    }
  }
  if (start >= 0) raw.push([start, lastHi + 1]);
  // Join stretches closer than minSilence.
  const joined = [];
  for (const r of raw) {
    const p = joined[joined.length - 1];
    if (p && (r[0] - p[1]) * fd < o.minSilence) p[1] = r[1];
    else joined.push(r.slice());
  }
  const out = [];
  for (const [a, b] of joined) {
    if ((b - a) * fd < o.minSpeech) continue;
    let s = 0,
      n = 0;
    for (let i = a; i < b; i++) {
      s += probs[i];
      n++;
    }
    out.push({
      t0: Math.max(0, a * fd - o.pad),
      t1: Math.min(dur, b * fd + o.pad),
      conf: s / Math.max(1, n),
      text: null,
      lang: null,
    });
  }
  // Padding can make neighbours touch.
  const merged = [];
  for (const r of out) {
    const p = merged[merged.length - 1];
    if (p && r.t0 <= p.t1) {
      p.conf = (p.conf * (p.t1 - p.t0) + r.conf * (r.t1 - r.t0)) / (r.t1 - p.t0);
      p.t1 = r.t1;
    } else merged.push(r);
  }
  return merged;
}

// ── Whisper: log-mel spectrogram ────────────────────────────────────────
const _vnMelCache = {};
function vnMelTables(nMels) {
  if (_vnMelCache[nMels]) return _vnMelCache[nMels];
  const nF = VN_NFFT / 2 + 1;
  const hz2mel = (f) => (f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
  const mel2hz = (m) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)));
  const m0 = hz2mel(0),
    m1 = hz2mel(VN_SR / 2);
  const fc = [];
  for (let i = 0; i < nMels + 2; i++) fc.push(mel2hz(m0 + ((m1 - m0) * i) / (nMels + 1)));
  const filt = new Float32Array(nMels * nF);
  const lo = new Int32Array(nMels),
    hi = new Int32Array(nMels);
  for (let m = 0; m < nMels; m++) {
    let a = nF,
      b = -1;
    for (let k = 0; k < nF; k++) {
      const f = (k * VN_SR) / VN_NFFT;
      const up = (f - fc[m]) / (fc[m + 1] - fc[m]),
        dn = (fc[m + 2] - f) / (fc[m + 2] - fc[m + 1]);
      const w = Math.max(0, Math.min(up, dn)) * (2 / (fc[m + 2] - fc[m]));
      filt[m * nF + k] = w;
      if (w > 0) {
        if (k < a) a = k;
        if (k > b) b = k;
      }
    }
    lo[m] = a;
    hi[m] = b;
  }
  const cosT = new Float64Array(nF * VN_NFFT),
    sinT = new Float64Array(nF * VN_NFFT),
    win = new Float64Array(VN_NFFT);
  for (let n = 0; n < VN_NFFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / VN_NFFT);
  for (let k = 0; k < nF; k++)
    for (let n = 0; n < VN_NFFT; n++) {
      const a = (2 * Math.PI * k * n) / VN_NFFT;
      cosT[k * VN_NFFT + n] = Math.cos(a) * win[n];
      sinT[k * VN_NFFT + n] = Math.sin(a) * win[n];
    }
  return (_vnMelCache[nMels] = { nF, filt, lo, hi, cosT, sinT });
}

// x: up to 30 s of 16 kHz audio -> Float32Array(nMels * 3000), as Whisper
// expects (mel-major). Frames lying wholly past the end of the audio are
// silent and are not computed.
function vnLogMel(x, nMels) {
  const T = vnMelTables(nMels);
  const nFr = VN_WIN / VN_HOP; // 3000
  const L = Math.min(x.length, VN_WIN);
  // 30 s, zero-padded, with reflected edges (as librosa/torch STFT, center=True)
  const half = VN_NFFT / 2;
  const xp = new Float32Array(VN_WIN + VN_NFFT);
  xp.set(x.subarray(0, L), half);
  for (let i = 1; i <= half; i++) {
    xp[half - i] = x[i] !== undefined && i < L ? x[i] : 0;
    xp[half + VN_WIN - 1 + i] = VN_WIN - 1 - i < L ? x[VN_WIN - 1 - i] : 0;
  }
  const active = Math.min(nFr, Math.ceil((L + half) / VN_HOP) + 1);
  const logm = new Float32Array(nMels * nFr).fill(-10);
  const pw = new Float64Array(T.nF);
  let mx = active < nFr ? -10 : -Infinity;
  for (let t = 0; t < active; t++) {
    const o = t * VN_HOP;
    for (let k = 0; k < T.nF; k++) {
      let re = 0,
        im = 0;
      const b = k * VN_NFFT;
      for (let n = 0; n < VN_NFFT; n++) {
        const v = xp[o + n];
        re += v * T.cosT[b + n];
        im -= v * T.sinT[b + n];
      }
      pw[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      let s = 0;
      for (let k = T.lo[m]; k <= T.hi[m]; k++) s += T.filt[m * T.nF + k] * pw[k];
      const v = Math.log10(Math.max(s, 1e-10));
      logm[m * nFr + t] = v;
      if (v > mx) mx = v;
    }
  }
  const floor = mx - 8;
  for (let i = 0; i < logm.length; i++) logm[i] = (Math.max(logm[i], floor) + 4) / 4;
  return logm;
}

// ── Whisper: tokenizer (byte-level BPE; decoding only) ──────────────────
function vnBuildTokenizer(json) {
  const t = typeof json === "string" ? JSON.parse(json) : json;
  const vocab = t.model.vocab;
  const added = {};
  let maxId = 0;
  for (const k in vocab) if (vocab[k] > maxId) maxId = vocab[k];
  for (const a of t.added_tokens) {
    added[a.content] = a.id;
    if (a.id > maxId) maxId = a.id;
  }
  const id2tok = new Array(maxId + 1).fill("");
  for (const k in vocab) id2tok[vocab[k]] = k;
  // GPT-2 byte <-> unicode table
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++)
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  const u2b = new Map();
  bs.forEach((b, i) => u2b.set(String.fromCharCode(cs[i]), b));
  const eot = added["<|endoftext|>"];
  const langs = {};
  for (const c in added) {
    const m = /^<\|([a-z]{2,3})\|>$/.exec(c);
    if (m) langs[m[1]] = added[c];
  }
  return {
    size: maxId + 1,
    eot,
    sot: added["<|startoftranscript|>"],
    transcribe: added["<|transcribe|>"],
    noTimestamps: added["<|notimestamps|>"],
    langs, // {"en": id, ...} (empty for English-only models)
    decode(ids) {
      let s = "";
      for (const id of ids) if (id < eot) s += id2tok[id] || "";
      const bytes = [];
      for (const ch of s) bytes.push(u2b.has(ch) ? u2b.get(ch) : ch.charCodeAt(0) & 255);
      return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
    },
  };
}

// ── Whisper: sessions and greedy decoding ───────────────────────────────
async function vnBuildWhisper(model) {
  vnOrtInit();
  const opt = { executionProviders: ["wasm"] };
  const enc = await ort.InferenceSession.create(new Uint8Array(model.enc), opt);
  const dec = await ort.InferenceSession.create(new Uint8Array(model.dec), opt);
  const tok = vnBuildTokenizer(model.tok);
  // Shapes of the decoder's cache inputs: [batch, heads, seq, head_dim].
  const layers = dec.inputNames.filter((n) => /^past_key_values\.\d+\.decoder\.key$/.test(n)).length;
  let heads = 0,
    hd = 0;
  const md = dec.inputMetadata;
  const item = Array.isArray(md) ? md.find((m) => m.name === "past_key_values.0.decoder.key") : md && md["past_key_values.0.decoder.key"];
  if (item && item.shape) {
    heads = +item.shape[1];
    hd = +item.shape[3];
  }
  if (!(heads > 0 && hd > 0)) throw new Error("could not read the decoder's attention shape");
  let nMels = 80;
  const em = enc.inputMetadata;
  const ei = Array.isArray(em) ? em[0] : em && em[enc.inputNames[0]];
  if (ei && ei.shape && +ei.shape[1] > 0) nMels = +ei.shape[1];
  let suppress = null;
  if (model.gen) {
    try {
      suppress = JSON.parse(model.gen).suppress_tokens || null;
    } catch (e) {}
  }
  return { enc, dec, tok, layers, heads, hd, nMels, suppress };
}

async function vnDecoderStep(w, ids, encOut, past, useCache) {
  const feeds = {
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map((v) => BigInt(v))), [1, ids.length]),
    encoder_hidden_states: encOut,
    use_cache_branch: new ort.Tensor("bool", Uint8Array.from([useCache ? 1 : 0]), [1]),
  };
  for (let i = 0; i < w.layers; i++)
    for (const kind of ["decoder", "encoder"])
      for (const kv of ["key", "value"]) {
        const name = "past_key_values." + i + "." + kind + "." + kv;
        feeds[name] = past[name] || new ort.Tensor("float32", new Float32Array(0), [1, w.heads, 0, w.hd]);
      }
  const out = await w.dec.run(feeds);
  const next = {};
  for (const n of Object.keys(out)) {
    if (!n.startsWith("present.")) continue;
    const name = "past_key_values." + n.slice(8);
    // The encoder's cache is produced once, on the first step.
    if (useCache && name.indexOf(".encoder.") >= 0 && past[name]) next[name] = past[name];
    else next[name] = out[n];
  }
  const lg = out.logits;
  const V = lg.dims[2],
    L = lg.dims[1];
  return { logits: lg.data.subarray((L - 1) * V, L * V), past: next };
}

// 16 kHz audio of at most 30 s -> {text, lang}
async function vnWhisperChunk(w, x, langCode, maxTokens) {
  const tok = w.tok;
  const mel = vnLogMel(x, w.nMels);
  const eo = await w.enc.run({ [w.enc.inputNames[0]]: new ort.Tensor("float32", mel, [1, w.nMels, VN_WIN / VN_HOP]) });
  const encOut = eo[w.enc.outputNames[0]];
  const multi = Object.keys(tok.langs).length > 0;
  let lang = null,
    prompt = [tok.sot];
  if (multi) {
    if (langCode && langCode !== "auto" && tok.langs[langCode] !== undefined) lang = langCode;
    else {
      const r = await vnDecoderStep(w, [tok.sot], encOut, {}, false);
      let best = -Infinity;
      for (const c in tok.langs) {
        const v = r.logits[tok.langs[c]];
        if (v > best) {
          best = v;
          lang = c;
        }
      }
    }
    prompt.push(tok.langs[lang], tok.transcribe);
  }
  prompt.push(tok.noTimestamps);
  const toks = [];
  let r = await vnDecoderStep(w, prompt, encOut, {}, false);
  const sup = new Uint8Array(r.logits.length);
  for (let i = tok.eot + 1; i < sup.length; i++) sup[i] = 1; // all other special tokens
  if (w.suppress) for (const i of w.suppress) if (i < sup.length) sup[i] = 1;
  for (let n = 0; n < maxTokens; n++) {
    const lg = r.logits;
    let best = -1,
      bv = -Infinity;
    for (let i = 0; i < lg.length; i++) {
      if (sup[i]) continue;
      if (n === 0 && (i === tok.eot || i === 220)) continue; // never start empty
      if (lg[i] > bv) {
        bv = lg[i];
        best = i;
      }
    }
    if (best === tok.eot || best < 0) break;
    toks.push(best);
    // A short phrase repeating over and over is a decoding loop: stop.
    let looped = false;
    for (let p = 1; p <= 4 && !looped; p++) {
      if (toks.length < p * 5) continue;
      looped = true;
      for (let k = 1; k < p * 5 && looped; k++) if (toks[toks.length - k] !== toks[toks.length - k - p]) looped = false;
    }
    if (looped) break;
    r = await vnDecoderStep(w, [best], encOut, r.past, true);
  }
  const text = tok.decode(toks).replace(/\s+/g, " ").trim();
  return { text, lang };
}

// Any length of 16 kHz audio -> text, in pieces of at most 28 s.
async function vnWhisperAudio(w, x, langCode) {
  const step = 28 * VN_SR;
  const parts = [];
  let lang = langCode;
  for (let o = 0; o < x.length; o += step) {
    const r = await vnWhisperChunk(w, x.subarray(o, Math.min(x.length, o + step)), lang, 224);
    if (r.text) parts.push(r.text);
    if (lang === "auto" || !lang) lang = r.lang || lang; // keep the first piece's language
  }
  return { text: parts.join(" "), lang: lang === "auto" ? null : lang };
}

// ── model storage (IndexedDB) ───────────────────────────────────────────
function vnDb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open("rthoptera_voice", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("models");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function vnDbGet() {
  try {
    const db = await vnDb();
    return await new Promise((res) => {
      const r = db.transaction("models").objectStore("models").get("whisper");
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}
async function vnDbPut(m) {
  const db = await vnDb();
  await new Promise((res, rej) => {
    const tx = db.transaction("models", "readwrite");
    tx.objectStore("models").put(m, "whisper");
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function vnDbDelete() {
  try {
    const db = await vnDb();
    await new Promise((res) => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").delete("whisper");
      tx.oncomplete = res;
      tx.onerror = res;
    });
  } catch (e) {}
}

// ── UI ──────────────────────────────────────────────────────────────────
function vnEl(id) {
  return document.getElementById(id);
}
function vnStatus(msg, isErr) {
  const e = vnEl("vnStatus");
  if (!e) return;
  e.textContent = msg || "";
  e.style.color = isErr ? "#f85149" : "var(--txt3)";
}
function vnModelStatus(msg, isErr) {
  const e = vnEl("vnModelStatus");
  if (!e) return;
  e.textContent = msg || "";
  e.style.color = isErr ? "#f85149" : "var(--txt3)";
}
function vnFmt(t) {
  const m = Math.floor(t / 60),
    s = t - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}
function vnTimelineKey() {
  return (typeof currentAudioFileName === "string" ? currentAudioFileName : "") + "|" + sampleRate + "|" + (duration || 0).toFixed(5);
}
// The ranges are positions on the current timeline. Edits that move the
// timeline (or another recording) make them meaningless, so drop them.
function vnCheckKey() {
  if (VN.ranges.length && VN.key !== vnTimelineKey()) {
    vnStopPlay();
    VN.ranges = [];
    vnRender();
    vnStatus("");
  }
}
function vnRefreshButtons() {
  const has = VN.ranges.length > 0 && !!(typeof rawSamples !== "undefined" && rawSamples);
  const loaded = typeof rawSamples !== "undefined" && !!rawSamples;
  const set = (id, on) => {
    const b = vnEl(id);
    if (b) b.disabled = !on;
  };
  set("btnVnDetect", loaded || VN.busy);
  set("btnVnTranscribe", has && !VN.busy);
  set("btnVnVanish", has && !VN.busy);
  set("btnVnDelete", has && !VN.busy);
  set("btnVnTxt", has);
  set("btnVnCsv", has);
}
function vnRender() {
  const box = vnEl("vnList");
  if (!box) return;
  if (!VN.ranges.length) {
    box.innerHTML = "";
    box.style.display = "none";
  } else {
    box.style.display = "";
    box.innerHTML = VN.ranges
      .map((r, i) => {
        const txt = r.text === null ? "" : r.text;
        return (
          '<div style="border-bottom:1px solid var(--border);padding:3px 0">' +
          '<div class="row" style="gap:4px;align-items:center;font-size:11px">' +
          '<a href="#" onclick="vnSelect(' + i + ');return false" style="color:#58a6ff;text-decoration:none" title="Select this stretch on the waveform">' +
          vnFmt(r.t0) + " – " + vnFmt(r.t1) + "</a>" +
          '<span style="color:var(--txt3)">' + (r.t1 - r.t0).toFixed(1) + " s · " + Math.round(r.conf * 100) + "%" + (r.lang ? " · " + r.lang : "") + "</span>" +
          '<button id="vnPlay' + i + '" onclick="vnPlay(' + i + ')" style="font-size:10px;padding:0 6px" title="Listen to this stretch (at the playback speed set in the playback bar)">&#9654;</button>' +
          '<span style="flex:1"></span>' +
          (r.text !== null ? '<button onclick="vnTranscribeOne(' + i + ')" style="font-size:10px;padding:0 5px" title="Transcribe this stretch again">&#8635;</button>' : "") +
          '<button onclick="vnRemove(' + i + ')" style="font-size:10px;padding:0 5px" title="Remove this stretch from the list (it is then left alone by Vanish and Delete)">&#10005;</button>' +
          "</div>" +
          (r.text !== null
            ? '<textarea rows="2" oninput="VN.ranges[' + i + '].text=this.value;VN.ranges[' + i + '].edited=true" style="width:100%;font-size:11px;box-sizing:border-box;resize:vertical" placeholder="(no speech recognised)">' +
              txt.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
              "</textarea>"
            : "") +
          "</div>"
        );
      })
      .join("");
  }
  vnRefreshButtons();
  if (VN.play.i >= VN.ranges.length) vnStopPlay();
  vnMarkPlaying();
  if (typeof render === "function") render();
}

// ── listening to one stretch ────────────────────────────────────────────
// Plays just that part of the recording, so a note can be checked without going
// back to the waveform. Uses the playback speed set in the playback bar.
VN.play = { i: -1, node: null };
function vnMarkPlaying() {
  VN.ranges.forEach((r, k) => {
    const b = vnEl("vnPlay" + k);
    if (b) b.innerHTML = VN.play.i === k ? "&#9632;" : "&#9654;";
  });
}
function vnStopPlay() {
  const n = VN.play.node;
  VN.play = { i: -1, node: null };
  if (n) {
    n.onended = null;
    try {
      n.stop();
    } catch (e) {}
  }
  vnMarkPlaying();
}
function vnPlay(i) {
  if (VN.play.i === i) {
    vnStopPlay();
    return;
  }
  vnStopPlay();
  const r = VN.ranges[i];
  if (!r || typeof rawSamples === "undefined" || !rawSamples) return;
  if (typeof isPlaying !== "undefined" && isPlaying) pausePb(); // not both at once
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") audioCtx.resume();
  const a = Math.max(0, Math.floor(r.t0 * sampleRate)),
    b = Math.min(rawSamples.length, Math.ceil(r.t1 * sampleRate));
  if (b - a < 2) return;
  const buf = audioCtx.createBuffer(1, b - a, sampleRate);
  buf.copyToChannel(rawSamples.subarray(a, b), 0);
  const node = audioCtx.createBufferSource();
  node.buffer = buf;
  node.playbackRate.value = typeof currentPlayRate === "function" ? currentPlayRate() : 1;
  node.connect(audioCtx.destination);
  node.onended = () => {
    if (VN.play.node === node) {
      VN.play = { i: -1, node: null };
      vnMarkPlaying();
    }
  };
  node.start();
  VN.play = { i, node };
  vnMarkPlaying();
}
function vnSelect(i) {
  const r = VN.ranges[i];
  if (!r) return;
  ppSel = { t0: r.t0, t1: r.t1 };
  if (r.t0 < viewStart || r.t1 > viewStart + viewDur) {
    viewStart = Math.max(0, Math.min(r.t0 - 0.1 * viewDur, duration - viewDur));
  }
  if (typeof updatePpSelReadout === "function") updatePpSelReadout();
  render();
  if (typeof renderMinimap === "function") renderMinimap();
}
function vnRemove(i) {
  vnStopPlay();
  VN.ranges.splice(i, 1);
  vnRender();
}

// Drawn from main.js's drawOverlay (Preprocessing only).
function vnDrawOverlay(ctx, tx, W, H) {
  if (!VN.ranges.length || VN.key !== vnTimelineKey()) return;
  ctx.save();
  for (const r of VN.ranges) {
    const a = tx(r.t0),
      b = tx(r.t1);
    if (b < 0 || a > W) continue;
    const x0 = Math.max(0, a),
      x1 = Math.min(W, b);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#bc8cff";
    ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#bc8cff";
    ctx.fillRect(x0, 0, x1 - x0, 3);
  }
  ctx.restore();
}

async function vnDetect() {
  if (VN.busy) {
    VN.cancel = true; // the button reads "Cancel" while running
    return;
  }
  if (typeof rawSamples === "undefined" || !rawSamples) return;
  const sens = parseFloat(vnEl("vnSens").value) || 0.5;
  const minSp = parseFloat(vnEl("vnMin").value);
  const btn = vnEl("btnVnDetect");
  VN.busy = true;
  VN.cancel = false;
  btn.textContent = "Cancel";
  vnRefreshButtons();
  btn.disabled = false;
  const sig = rawSamples,
    sr = sampleRate,
    dur = duration,
    key = vnTimelineKey(),
    cfg = vnDetectCfg();
  try {
    vnStatus("Loading the voice-detection model…");
    const t0 = performance.now();
    const probs = await vnVadProbs(sig, sr, (p) => vnStatus("Looking for voice… " + Math.round(p * 100) + "%"));
    const ranges = vnSegments(probs, dur, {
      thr: sens,
      minSpeech: isFinite(minSp) ? minSp : 0.25,
      minSilence: 0.4,
      pad: 0.15,
    });
    if (vnTimelineKey() !== key) throw new Error("the recording changed while it was being analysed");
    VN.ranges = ranges;
    VN.key = key;
    VN.detCfg = cfg;
    const tot = ranges.reduce((s, r) => s + r.t1 - r.t0, 0);
    vnStatus(
      ranges.length
        ? ranges.length + " stretch(es) of voice, " + tot.toFixed(1) + " s in total (" + ((performance.now() - t0) / 1000).toFixed(1) + " s to analyse). Click a time to see it on the waveform."
        : "No voice found" + (sens > 0.35 ? ". A higher sensitivity finds fainter voices." : "."),
    );
    if (typeof log === "function") log("Voice notes: " + ranges.length + " stretch(es) found.", ranges.length ? "ok" : "");
  } catch (e) {
    vnStatus(e.message === "cancelled" ? "Cancelled." : "Voice detection failed: " + e.message, e.message !== "cancelled");
  }
  VN.busy = false;
  btn.textContent = "Detect voice";
  vnRender();
}

// ── model loading ───────────────────────────────────────────────────────
async function vnEnsureWhisper() {
  if (VN.w) return VN.w;
  if (!VN.model) VN.model = vnNormModel(await vnDbGet());
  if (!VN.model) {
    const d = vnEl("vnModelBox");
    if (d) d.open = true;
    throw new Error("no transcription model yet: load one or download one (Transcription model, below).");
  }
  vnModelStatus("Starting " + VN.model.label + "…");
  VN.w = await vnBuildWhisper(VN.model);
  vnModelStatus(VN.model.label + " ready" + (Object.keys(VN.w.tok.langs).length ? "" : " (English only)") + ".");
  return VN.w;
}
// Models stored before models carried a size and id: read them from the label.
function vnNormModel(m) {
  const k = m && /^Whisper (tiny|base|small)$/.exec(m.label);
  if (k && !m.size) {
    m.size = k[1];
    m.id = "dl:" + k[1];
  }
  return m;
}
async function vnInitModelStatus() {
  const m = vnNormModel(await vnDbGet());
  if (m) {
    VN.model = m;
    vnModelStatus(m.label + " is stored on this computer.");
  } else vnModelStatus("No model yet.");
}

// Choose the files of an ONNX Whisper export yourself: the encoder, the merged
// decoder and tokenizer.json (generation_config.json is optional).
async function vnImportFiles(files) {
  files = Array.from(files || []);
  if (!files.length) return;
  const pick = (re) => files.find((f) => re.test(f.name));
  const fe = pick(/encoder.*\.onnx$/i),
    fd = pick(/decoder.*merged.*\.onnx$/i) || pick(/decoder.*\.onnx$/i),
    ft = pick(/tokenizer\.json$/i),
    fg = pick(/generation_config\.json$/i);
  if (!fe || !fd || !ft) {
    vnModelStatus("Choose three files together: the encoder .onnx, the decoder (merged) .onnx and tokenizer.json.", true);
    return;
  }
  try {
    vnModelStatus("Reading the files…");
    const model = {
      label: "Whisper (" + fe.name.replace(/\.onnx$/i, "") + ")",
      enc: await fe.arrayBuffer(),
      dec: await fd.arrayBuffer(),
      tok: await ft.text(),
      gen: fg ? await fg.text() : null,
      id: "files:" + fe.name + ":" + fe.size + ":" + fd.size,
    };
    VN.w = await vnBuildWhisper(model); // fail now rather than at the first transcription
    await vnDbPut(model);
    VN.model = model;
    vnModelStatus(model.label + " loaded and stored on this computer.");
  } catch (e) {
    vnModelStatus("Could not use these files: " + e.message, true);
  }
}

async function vnDownload() {
  const size = vnEl("vnModelSize").value;
  const base = "https://huggingface.co/onnx-community/whisper-" + size + "/resolve/main/";
  const items = [
    ["enc", "onnx/encoder_model_q4.onnx", "buf"],
    ["dec", "onnx/decoder_model_merged_int8.onnx", "buf"],
    ["tok", "tokenizer.json", "text"],
    ["gen", "generation_config.json", "text"],
  ];
  const btn = vnEl("btnVnDownload");
  btn.disabled = true;
  try {
    const model = { label: "Whisper " + size, size, id: "dl:" + size };
    for (let k = 0; k < items.length; k++) {
      const [key, path, kind] = items[k];
      vnModelStatus("Downloading " + path.split("/").pop() + " (" + (k + 1) + "/" + items.length + ")…");
      const res = await fetch(base + path);
      if (!res.ok) throw new Error(path + ": HTTP " + res.status);
      const total = +res.headers.get("content-length") || 0;
      const rd = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) vnModelStatus("Downloading " + path.split("/").pop() + " (" + (k + 1) + "/" + items.length + ") " + Math.round((got / total) * 100) + "%");
      }
      const blob = new Blob(parts);
      model[key] = kind === "buf" ? await blob.arrayBuffer() : await blob.text();
    }
    VN.w = await vnBuildWhisper(model);
    await vnDbPut(model);
    VN.model = model;
    vnModelStatus(model.label + " downloaded and stored on this computer.");
  } catch (e) {
    vnModelStatus("Download failed: " + e.message, true);
  }
  btn.disabled = false;
}

async function vnForgetModel() {
  await vnDbDelete();
  VN.model = null;
  VN.w = null;
  vnModelStatus("The stored model was removed.");
}

// ── transcription ───────────────────────────────────────────────────────
async function vnTranscribeRange(w, r, langCode, cfg) {
  const pad = 0.2;
  const a = Math.max(0, r.t0 - pad),
    b = Math.min(duration, r.t1 + pad);
  const x = vnAudio16k(rawSamples, sampleRate, a, Math.max(1, Math.round((b - a) * VN_SR)));
  // Whisper expects a decent level; very quiet notes are brought up to a
  // peak of 0.5 (its log-mel input is relative anyway, this only avoids
  // numerical floor effects).
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk > 1e-6 && pk < 0.1) {
    const g = 0.5 / pk;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  const res = await vnWhisperAudio(w, x, langCode);
  r.text = res.text;
  r.lang = res.lang;
  r.edited = false;
  r.cfg = cfg;
}
async function vnRunTranscription(indices) {
  if (VN.busy) return;
  VN.busy = true;
  vnRefreshButtons();
  const key = VN.key;
  try {
    vnStatus("Loading the transcription model…");
    const w = await vnEnsureWhisper();
    const lang = vnEl("vnLang").value;
    const cfg = vnTranscribeCfg();
    let done = 0;
    for (const i of indices) {
      const r = VN.ranges[i];
      if (!r) continue;
      vnStatus("Transcribing " + (done + 1) + " of " + indices.length + "…");
      await vnTranscribeRange(w, r, lang, cfg);
      done++;
      if (VN.key !== key) break;
      vnRender();
    }
    vnStatus("Transcribed " + done + " stretch(es). The text can be edited.");
  } catch (e) {
    vnStatus("Transcription failed: " + e.message, true);
  }
  VN.busy = false;
  vnRender();
}
async function vnTranscribe() {
  if (VN.busy) return;
  // The model picked in the list is not the one on this computer: offer it.
  const picked = vnEl("vnModelSize").value;
  if (VN.model && VN.model.size && VN.model.size !== picked) {
    if (confirm("The model chosen is " + picked + ", but the one stored is " + VN.model.size + ". Download " + picked + " and use it? (Cancel uses " + VN.model.size + ".)")) {
      await vnDownload();
      if (!VN.model || VN.model.size !== picked) return; // the download failed
    } else vnEl("vnModelSize").value = VN.model.size;
  }
  // If any setting differs from the one the list and its transcripts were made
  // with (sensitivity, minimum length, language, model), start from scratch:
  // detect again, then transcribe everything. Otherwise only what is missing.
  const redetect = !!VN.detCfg && VN.detCfg !== vnDetectCfg();
  const trCfg = vnTranscribeCfg();
  let idx = [];
  VN.ranges.forEach((r, i) => {
    if (redetect || r.text === null || r.cfg !== trCfg) idx.push(i);
  });
  if (!idx.length) {
    vnStatus("Everything is transcribed already with these settings (the arrow beside a stretch redoes just that one).");
    return;
  }
  const edited = idx.filter((i) => VN.ranges[i].text !== null && VN.ranges[i].edited).length;
  if (edited && !confirm(edited + " transcript(s) you edited by hand will be replaced. Continue?")) return;
  if (redetect) {
    vnStatus("Settings changed: detecting voice again…");
    await vnDetect();
    if (!VN.ranges.length || VN.detCfg !== vnDetectCfg()) return; // nothing found, cancelled or failed
    idx = VN.ranges.map((r, i) => i);
  }
  vnRunTranscription(idx);
}
function vnTranscribeOne(i) {
  vnRunTranscription([i]);
}

// ── acting on the stretches ─────────────────────────────────────────────
// Work from the end so earlier stretches keep their positions when a Delete
// shortens the recording.
function vnVanishAll() {
  if (!VN.ranges.length) return;
  if (!confirm("Replace " + VN.ranges.length + " stretch(es) of voice with matched background noise? Each one is a separate step in Undo.")) return;
  vnStopPlay();
  const list = VN.ranges.slice().sort((a, b) => b.t0 - a.t0);
  let n = 0;
  for (const r of list) if (ppVanishSelection({ t0: r.t0, t1: r.t1 }) !== false) n++;
  VN.ranges = [];
  vnStatus("Replaced " + n + " stretch(es) of voice.");
  vnRender();
}
function vnDeleteAll() {
  if (!VN.ranges.length) return;
  if (!confirm("Cut " + VN.ranges.length + " stretch(es) of voice out of the recording? The recording gets shorter, and detections and annotations made earlier are cleared. Each cut is a separate step in Undo.")) return;
  vnStopPlay();
  const list = VN.ranges.slice().sort((a, b) => b.t0 - a.t0);
  let n = 0;
  for (const r of list) if (ppDeleteSelection({ t0: r.t0, t1: r.t1 })) n++;
  VN.ranges = [];
  vnStatus("Cut " + n + " stretch(es) of voice.");
  vnRender();
}

function vnExport(kind) {
  if (!VN.ranges.length) return;
  const base = (typeof currentAudioFileName === "string" ? currentAudioFileName : "recording").replace(/\.[^/.]+$/, "");
  let s;
  if (kind === "csv") {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    s = "start_s,end_s,duration_s,confidence,language,text\n" +
      VN.ranges.map((r) => [r.t0.toFixed(3), r.t1.toFixed(3), (r.t1 - r.t0).toFixed(3), r.conf.toFixed(3), r.lang || "", q(r.text || "")].join(",")).join("\n") + "\n";
  } else {
    s = "Voice notes in " + base + " (times in the edited audio)\n\n" +
      VN.ranges.map((r) => "[" + vnFmt(r.t0) + " - " + vnFmt(r.t1) + "] " + (r.text === null ? "(not transcribed)" : r.text || "(no speech recognised)")).join("\n") + "\n";
  }
  dlFile(base + "_voice_notes." + kind, s, kind === "csv" ? "text/csv" : "text/plain", { exactName: true });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    vnInitModelStatus();
    vnRefreshButtons();
  });
  // Keep the list honest when the recording or its timeline changes.
  setInterval(() => {
    if (typeof rawSamples !== "undefined") {
      vnCheckKey();
      vnRefreshButtons();
    }
  }, 1500);
}
