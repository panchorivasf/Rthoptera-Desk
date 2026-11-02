// ═══════════════════════════════════════════════════════════════════════
// STR: SIMPLIFIED TEMPORAL REPRESENTATION
//
// Reduces a recording to two things:
//   1. its dominant frequency, measured on a long analysis window averaged over
//      the pulses, so it is steady against individual and equipment differences;
//   2. a "barcode" of its pulses: one bar per pulse, width = duration, height =
//      maximum amplitude, placed at its true time (the gaps are the silences),
//      normalised to the loudest pulse of each echeme or of the whole song.
//
// The STR vector is [dominant frequency, duration_1, amplitude_1, duration_2,
// amplitude_2, ...]. It is variable length; making a fixed-length embedding from
// it is a separate step.
// ═══════════════════════════════════════════════════════════════════════

let strResults = []; // one per recording, see strProcess
let strSel = -1;
let strEchemeSel = -1; // -1 = whole song

// ── UI ───────────────────────────────────────────────────────────────
function strInit() {
  const root = document.getElementById("strRoot");
  if (!root) return;
  const num = (id, label, val, tip, min, step) =>
    '<label class="chk" style="font-size:11px;color:var(--txt2)" title="' + tip + '">' + label +
    ' <input type="number" id="' + id + '" value="' + val + '" min="' + min + '" step="' + step +
    '" style="width:64px;font-size:11px"></label>';
  root.innerHTML =
    '<div style="font-size:11px;color:var(--txt2);line-height:1.6;max-width:950px">' +
    "Turns each checked recording into its <b>dominant frequency</b> plus a <b>barcode of its pulses</b> " +
    "(bar width = pulse duration, bar height = maximum amplitude, gaps = silence). " +
    "The frequency comes from a long window averaged over all the pulses, so a single noisy moment cannot move it." +
    "</div>" +
    '<div class="panel" style="max-width:950px"><h2>Dominant frequency</h2><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
    num("strWin", "Window (ms)", 50, "Length of each spectrum window. Longer windows give a finer, steadier peak.", 5, 5) +
    num("strSmooth", "Smoothing (Hz)", 1000, "The averaged spectrum is smoothed over this width before the peak is taken, so the result follows the main band rather than a single spike.", 0, 100) +
    num("strLow", "Search from (kHz)", 1, "Ignore everything below this frequency (wind, handling noise).", 0, 0.5) +
    "</div></div>" +
    '<div class="panel" style="max-width:950px"><h2>Pulses</h2><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
    num("strBand", "Band-limit &plusmn; (kHz)", 3, "Before looking for pulses, keep only this much either side of the dominant frequency, so noise outside the song does not count. 0 = use the whole band.", 0, 0.5) +
    num("strRes", "Envelope step (ms)", 0.25, "Time resolution of the amplitude envelope. Pulse starts and ends are accurate to about this much.", 0.05, 0.05) +
    num("strThr", "Threshold (dB below peak)", 20, "A pulse is any stretch whose envelope stays above this level, measured down from the loud end of the recording.", 3, 1) +
    num("strMinDur", "Min pulse (ms)", 1, "Shorter blips are discarded.", 0, 0.5) +
    num("strMerge", "Join gaps shorter than (ms)", 0.5, "Two stretches separated by less than this are one pulse.", 0, 0.25) +
    "</div></div>" +
    '<div class="panel" style="max-width:950px"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
    '<button id="strRun" class="suc" style="font-size:11px" onclick="strRun()">&#9654; Compute STR for checked recordings</button>' +
    num("strEGap", "Echeme gap (ms)", 100, "Pulses closer together than this belong to the same echeme. Changing it regroups instantly.", 1, 10) +
    '<label class="chk" style="font-size:11px;color:var(--txt2)" title="Bar heights are divided by the loudest pulse of each echeme, or of the whole song. Changing it redraws instantly.">Normalise per <select id="strNorm" style="font-size:11px" onchange="strRegroup()"><option value="echeme">echeme</option><option value="song">song</option></select></label>' +
    '<button id="strExport" style="font-size:11px" onclick="strExport()" disabled>&#11015; Export (Excel)</button>' +
    "</div>" +
    '<div id="strStatus" style="font-size:11px;color:var(--txt2);margin-top:4px">Check recordings in the Loaded Audio list (or leave none checked to use the active one).</div></div>' +
    '<div id="strResults" style="display:none;max-width:1250px;gap:8px;flex-wrap:wrap;align-items:flex-start">' +
    '<div class="panel" style="flex:0 1 330px;max-height:520px;overflow:auto"><table class="dtable"><thead><tr><th>Recording</th><th>kHz</th><th>Pulses</th><th>Echemes</th></tr></thead><tbody id="strBody"></tbody></table></div>' +
    '<div style="flex:1 1 600px;min-width:0;display:flex;flex-direction:column;gap:8px">' +
    '<div class="panel"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--txt2)">' +
    '<span id="strTitle" style="font-weight:700;color:var(--txt3)"></span><span style="flex:1"></span>' +
    '<label class="chk">View <select id="strEchemeSel" style="font-size:11px" onchange="strEchemeSel=parseInt(this.value,10); strDraw()"></select></label></div>' +
    '<canvas id="strCanvas" style="width:100%;height:260px;display:block;margin-top:4px;cursor:pointer"></canvas></div>' +
    '<div class="panel"><div style="font-size:11px;color:var(--txt2);margin-bottom:2px">Averaged spectrum (the dominant frequency is the marked peak)</div>' +
    '<canvas id="strSpec" style="width:100%;height:120px;display:block"></canvas></div>' +
    '<div class="panel"><div class="row" style="gap:8px;align-items:center"><span style="font-size:11px;color:var(--txt2)">STR vector</span><span style="flex:1"></span>' +
    '<button style="font-size:10px;padding:1px 8px" onclick="strCopyVector()">Copy</button></div>' +
    '<div id="strVector" style="font-family:monospace;font-size:11px;color:var(--txt2);word-break:break-all;max-height:110px;overflow:auto"></div></div>' +
    "</div></div>";
  document.getElementById("strCanvas").addEventListener("click", strCanvasClick);
  window.addEventListener("resize", () => strSel >= 0 && strDraw());
}
function strSetStatus(t, err) {
  const s = document.getElementById("strStatus");
  if (s) {
    s.textContent = t;
    s.style.color = err ? "#f85149" : "var(--txt2)";
  }
}
function strParams() {
  const v = (id, d) => {
    const x = parseFloat(document.getElementById(id).value);
    return isFinite(x) ? x : d;
  };
  return {
    winMs: Math.max(5, v("strWin", 50)),
    smoothHz: Math.max(0, v("strSmooth", 1000)),
    lowKhz: Math.max(0, v("strLow", 1)),
    bandKhz: Math.max(0, v("strBand", 3)),
    resMs: Math.max(0.05, v("strRes", 0.25)),
    thrDb: Math.max(3, v("strThr", 20)),
    minDurMs: Math.max(0, v("strMinDur", 1)),
    mergeMs: Math.max(0, v("strMerge", 0.5)),
  };
}

// ── signal processing ────────────────────────────────────────────────
// Block maximum of |x|: an amplitude envelope sampled every `res` seconds.
function strEnvelope(x, sr, res) {
  const B = Math.max(1, Math.round(sr * res)),
    n = Math.ceil(x.length / B),
    env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(x.length, (i + 1) * B);
    for (let j = i * B; j < end; j++) {
      const a = x[j] < 0 ? -x[j] : x[j];
      if (a > m) m = a;
    }
    env[i] = m;
  }
  return { env, step: B / sr };
}
function strQuantile(arr, q) {
  const s = Float32Array.from(arr).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
}
// Pulses = stretches of the envelope above a threshold set below the peak.
function strDetect(E, P) {
  const { env, step } = E,
    peak = strQuantile(env, 0.995),
    floor = strQuantile(env, 0.5),
    thr = Math.max(peak * Math.pow(10, -P.thrDb / 20), floor * 3);
  if (!(peak > 0) || thr >= peak) return [];
  const mergeBlocks = Math.max(0, Math.round(P.mergeMs / 1000 / step)),
    runs = [];
  let i = 0;
  while (i < env.length) {
    if (env[i] < thr) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < env.length && env[j + 1] >= thr) j++;
    runs.push([i, j]);
    i = j + 1;
  }
  const merged = [];
  runs.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] - 1 <= mergeBlocks) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  });
  const out = [];
  merged.forEach(([a, b]) => {
    const dur = (b - a + 1) * step * 1000;
    if (dur < P.minDurMs) return;
    let amp = 0;
    for (let k = a; k <= b; k++) if (env[k] > amp) amp = env[k];
    out.push({ start: a * step, end: (b + 1) * step, dur_ms: dur, amp });
  });
  return out;
}

// Dominant frequency from a long window, averaged over every window that
// overlaps a pulse (the whole recording when none was found).
function strDominant(x, sr, pulses, P) {
  let nfft = 256;
  while (nfft < (P.winMs / 1000) * sr && nfft < 65536) nfft <<= 1;
  const hop = nfft >> 1,
    starts = [];
  if (pulses.length) {
    let pi = 0;
    for (let s = 0; s + nfft <= x.length; s += hop) {
      const t0 = s / sr,
        t1 = (s + nfft) / sr;
      while (pi < pulses.length && pulses[pi].end < t0) pi++;
      if (pi < pulses.length && pulses[pi].start < t1) starts.push(s);
    }
  }
  if (!starts.length) for (let s = 0; s + nfft <= x.length; s += hop) starts.push(s);
  if (!starts.length) return null;
  let use = starts;
  if (starts.length > 400) {
    use = [];
    for (let i = 0; i < 400; i++) use.push(starts[Math.floor((i * starts.length) / 400)]);
  }
  const bins = nfft >> 1,
    acc = new Float64Array(bins),
    win = hannWin(nfft),
    re = new Float32Array(nfft),
    im = new Float32Array(nfft);
  use.forEach((s) => {
    for (let i = 0; i < nfft; i++) {
      re[i] = x[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im, nfft);
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  });
  const binHz = sr / nfft,
    w = Math.max(1, Math.round(P.smoothHz / binHz)),
    sm = new Float64Array(bins);
  const half = w >> 1;
  // Plain moving average (clear rather than clever; bins is at most 32768).
  for (let k = 0; k < bins; k++) {
    let s = 0,
      c = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(bins - 1, k + half); j++) {
      s += acc[j];
      c++;
    }
    sm[k] = s / c;
  }
  const kLo = Math.max(1, Math.ceil((P.lowKhz * 1000) / binHz));
  let best = kLo;
  for (let k = kLo; k < bins; k++) if (sm[k] > sm[best]) best = k;
  const stride = Math.max(1, Math.floor(bins / 700)),
    spec = [];
  for (let k = 0; k < bins; k += stride) spec.push(10 * Math.log10(sm[k] + 1e-20));
  return { f0: (best * binHz) / 1000, spec, stride, binHz, nfft };
}

async function strProcess(entry, samples, sr, P) {
  const res = P.resMs / 1000;
  const first = strDetect(strEnvelope(samples, sr, res), P);
  const dom = strDominant(samples, sr, first, P);
  let pulses = first;
  if (dom && P.bandKhz > 0) {
    const nyq = sr / 2,
      lo = Math.max(0, (dom.f0 - P.bandKhz) * 1000),
      hi = Math.min(nyq * 0.98, (dom.f0 + P.bandKhz) * 1000);
    const filt = applyBandpass(samples, sr, lo, hi);
    pulses = strDetect(strEnvelope(filt, sr, res), P);
  }
  return { id: entry.id, name: entry.name, sr, dur: samples.length / sr, dom, pulses, echemes: [] };
}

// Echeme grouping and normalisation: cheap, so they follow the controls live.
function strRegroup() {
  const gap = (parseFloat(document.getElementById("strEGap").value) || 100) / 1000,
    perSong = document.getElementById("strNorm").value === "song";
  strResults.forEach((r) => {
    r.echemes = [];
    r.pulses.forEach((p, i) => {
      const prev = r.pulses[i - 1];
      if (!prev || p.start - prev.end > gap) r.echemes.push({ first: i, last: i, start: p.start, end: p.end, max: 0 });
      const e = r.echemes[r.echemes.length - 1];
      e.last = i;
      e.end = p.end;
      if (p.amp > e.max) e.max = p.amp;
      p.echeme = r.echemes.length;
      p.gap_ms = null;
      if (prev) prev.gap_ms = (p.start - prev.end) * 1000;
    });
    const songMax = Math.max(0, ...r.pulses.map((p) => p.amp));
    r.pulses.forEach((p) => {
      const m = perSong ? songMax : r.echemes[p.echeme - 1].max;
      p.amp_norm = m > 0 ? p.amp / m : 0;
    });
  });
  strRenderTable();
  if (strSel >= 0) {
    strFillEchemes();
    strDraw();
  }
}

// ── run ──────────────────────────────────────────────────────────────
async function strRun() {
  let ids = audioLibBatchSelected && audioLibBatchSelected.size ? [...audioLibBatchSelected] : [audioLibActiveId];
  ids = ids.filter((i) => i !== null && i !== undefined);
  if (!ids.length) {
    strSetStatus("Load audio first.", true);
    return;
  }
  const P = strParams(),
    out = [];
  let failed = null;
  try {
    await withBusy(
      "Computing STR…",
      async (progress) => {
        for (let i = 0; i < ids.length; i++) {
          const entry = audioLibrary.find((e) => e.id === ids[i]);
          if (!entry) continue;
          progress((i + 1) + " / " + ids.length + ": " + entry.name, i / ids.length);
          await busyTick();
          const live = entry.id === audioLibActiveId && rawSamples;
          const samples = live ? rawSamples : entry.samples,
            sr = live ? sampleRate : entry.rate;
          if (!samples || !samples.length) continue;
          out.push(await strProcess(entry, samples, sr, P));
        }
      },
      { cancellable: true },
    );
  } catch (e) {
    failed = e;
  }
  if (failed) {
    strSetStatus("STR failed: " + failed.message, true);
    return;
  }
  if (busyWasCancelled) {
    strSetStatus("Cancelled.");
    return;
  }
  strResults = out;
  strSel = out.length ? 0 : -1;
  strEchemeSel = -1;
  strRegroup();
  document.getElementById("strResults").style.display = "flex";
  document.getElementById("strExport").disabled = !out.length;
  const none = out.filter((r) => !r.pulses.length).length;
  strSetStatus(
    out.length + " recording(s) processed" + (none ? "; " + none + " with no pulses found (try a lower threshold or a smaller minimum pulse)" : "") + ".",
    false,
  );
  if (strSel >= 0) strSelect(0);
}

// ── results ──────────────────────────────────────────────────────────
function strEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function strRenderTable() {
  document.getElementById("strBody").innerHTML = strResults
    .map(
      (r, i) =>
        '<tr style="cursor:pointer;' + (i === strSel ? "background:var(--bg3, rgba(128,128,128,.25))" : "") + '" onclick="strSelect(' + i + ')"><td>' +
        strEsc(r.name) + "</td><td>" + (r.dom ? r.dom.f0.toFixed(1) : "–") + "</td><td>" + r.pulses.length + "</td><td>" + r.echemes.length + "</td></tr>",
    )
    .join("");
}
function strSelect(i) {
  strSel = i;
  strEchemeSel = -1;
  strRenderTable();
  strFillEchemes();
  strDraw();
}
function strFillEchemes() {
  const r = strResults[strSel],
    sel = document.getElementById("strEchemeSel");
  if (!r) return;
  if (strEchemeSel >= r.echemes.length) strEchemeSel = -1;
  sel.innerHTML =
    '<option value="-1">Whole song</option>' +
    r.echemes.map((e, i) => '<option value="' + i + '">Echeme ' + (i + 1) + " (" + (e.last - e.first + 1) + " pulses)</option>").join("");
  sel.value = String(strEchemeSel);
}
function strView(r) {
  if (!r.pulses.length) return { t0: 0, t1: Math.max(r.dur, 0.001), list: [] };
  if (strEchemeSel >= 0 && r.echemes[strEchemeSel]) {
    const e = r.echemes[strEchemeSel],
      pad = (e.end - e.start) * 0.04 + 0.0005;
    return { t0: e.start - pad, t1: e.end + pad, list: r.pulses.slice(e.first, e.last + 1) };
  }
  const a = r.pulses[0].start,
    b = r.pulses[r.pulses.length - 1].end,
    pad = (b - a) * 0.01 + 0.0005;
  return { t0: Math.max(0, a - pad), t1: b + pad, list: r.pulses };
}
const STR_M = { L: 40, R: 12, T: 10, B: 24 };
function strDraw() {
  const r = strResults[strSel];
  if (!r) return;
  document.getElementById("strTitle").textContent =
    r.name + (r.dom ? " — dominant frequency " + r.dom.f0.toFixed(2) + " kHz" : " — no spectrum");
  const cv = document.getElementById("strCanvas"),
    dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const css = getComputedStyle(document.body),
    ink = css.getPropertyValue("--txt2").trim() || "#999",
    accent = css.getPropertyValue("--accent").trim() || "#58a6ff";
  const v = strView(r),
    L = STR_M.L, R = STR_M.R, T = STR_M.T, B = STR_M.B,
    pw = w - L - R, ph = h - T - B, mid = T + ph / 2,
    X = (t) => L + ((t - v.t0) / (v.t1 - v.t0)) * pw;
  if (strEchemeSel < 0)
    r.echemes.forEach((e, i) => {
      if (i % 2) return;
      g.fillStyle = "rgba(128,128,140,0.12)";
      g.fillRect(X(e.start), T, Math.max(1, X(e.end) - X(e.start)), ph);
    });
  g.strokeStyle = "rgba(150,150,160,0.35)";
  g.beginPath();
  g.moveTo(L, mid);
  g.lineTo(L + pw, mid);
  g.stroke();
  g.fillStyle = accent;
  v.list.forEach((p) => {
    const bw = Math.max(1, X(p.end) - X(p.start)),
      bh = p.amp_norm * (ph / 2);
    g.fillRect(X(p.start), mid - bh, bw, bh * 2);
    p._x0 = X(p.start);
    p._x1 = X(p.start) + bw;
  });
  g.fillStyle = ink;
  g.font = "10px sans-serif";
  g.textAlign = "right";
  [["1", T + 8], ["0", mid + 3], ["1", T + ph]].forEach(([s, y]) => g.fillText(s, L - 5, y));
  g.textAlign = "center";
  const span = v.t1 - v.t0,
    useMs = span < 2;
  for (let i = 0; i <= 5; i++) {
    const t = v.t0 + (span * i) / 5;
    g.fillText(useMs ? (t * 1000).toFixed(0) : t.toFixed(span < 20 ? 1 : 0), X(t), h - 8);
  }
  g.textAlign = "left";
  g.fillText(useMs ? "ms" : "s", L + pw - 12, h - 8 - 12);
  if (!v.list.length) g.fillText("No pulses found.", L + 10, mid - 8);
  strDrawSpec(r);
  strShowVector(r, v);
}
function strCanvasClick(ev) {
  if (strEchemeSel >= 0) return;
  const r = strResults[strSel];
  if (!r || !r.pulses.length) return;
  const x = ev.clientX - ev.target.getBoundingClientRect().left;
  const p = r.pulses.find((q) => x >= q._x0 - 2 && x <= q._x1 + 2);
  if (!p) return;
  strEchemeSel = p.echeme - 1;
  document.getElementById("strEchemeSel").value = String(strEchemeSel);
  strDraw();
}
function strDrawSpec(r) {
  const cv = document.getElementById("strSpec"),
    dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  if (!r.dom) return;
  const css = getComputedStyle(document.body),
    ink = css.getPropertyValue("--txt2").trim() || "#999",
    accent = css.getPropertyValue("--accent").trim() || "#58a6ff";
  const { spec, stride, binHz } = r.dom,
    L = 40, R = 12, T = 8, B = 20,
    mx = Math.max(...spec),
    mn = Math.max(mx - 70, Math.min(...spec)),
    fmax = ((spec.length - 1) * stride * binHz) / 1000,
    X = (k) => L + (((k * stride * binHz) / 1000 / fmax) * (w - L - R)),
    Y = (db) => T + (1 - (Math.max(db, mn) - mn) / (mx - mn || 1)) * (h - T - B);
  g.strokeStyle = accent;
  g.beginPath();
  spec.forEach((db, k) => (k ? g.lineTo(X(k), Y(db)) : g.moveTo(X(k), Y(db))));
  g.stroke();
  const fx = L + (r.dom.f0 / fmax) * (w - L - R);
  g.strokeStyle = "#f85149";
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(fx, T);
  g.lineTo(fx, h - B);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = ink;
  g.font = "10px sans-serif";
  g.textAlign = "center";
  for (let i = 0; i <= 5; i++) g.fillText(((fmax * i) / 5).toFixed(fmax >= 20 ? 0 : 1), L + ((w - L - R) * i) / 5, h - 6);
  g.textAlign = "left";
  g.fillText(r.dom.f0.toFixed(2) + " kHz", Math.min(fx + 4, w - 70), T + 10);
  g.fillText("kHz", 4, h - 6);
}

// ── vector + export ──────────────────────────────────────────────────
function strVector(r, list) {
  const v = [r.dom ? Math.round(r.dom.f0 * 1000) / 1000 : null];
  list.forEach((p) => v.push(Math.round(p.dur_ms * 100) / 100, Math.round(p.amp_norm * 1000) / 1000));
  return v;
}
function strShowVector(r, view) {
  const v = strVector(r, view.list),
    shown = v.slice(0, 80).join(", ");
  document.getElementById("strVector").textContent =
    "[" + shown + (v.length > 80 ? ", … (" + ((v.length - 1) / 2) + " pulses)" : "") + "]   =  [dominant kHz, duration ms, amplitude, duration ms, amplitude, …]";
}
function strCopyVector() {
  const r = strResults[strSel];
  if (!r) return;
  const text = JSON.stringify(strVector(r, strView(r).list));
  navigator.clipboard.writeText(text).then(
    () => log("STR vector copied.", "ok"),
    () => log("Could not copy to the clipboard.", "warn"),
  );
}
async function strExport() {
  if (!strResults.length) return;
  const summary = [],
    pulses = [],
    vectors = [];
  strResults.forEach((r) => {
    summary.push({
      source_file: r.name,
      dominant_khz: r.dom ? Math.round(r.dom.f0 * 1000) / 1000 : "",
      n_pulses: r.pulses.length,
      n_echemes: r.echemes.length,
      duration_s: Math.round(r.dur * 1000) / 1000,
      sample_rate_hz: r.sr,
    });
    r.pulses.forEach((p, i) =>
      pulses.push({
        source_file: r.name,
        echeme: p.echeme,
        pulse: i + 1,
        start_s: Math.round(p.start * 1e6) / 1e6,
        end_s: Math.round(p.end * 1e6) / 1e6,
        duration_ms: Math.round(p.dur_ms * 100) / 100,
        amplitude: Math.round(p.amp * 1e6) / 1e6,
        amplitude_norm: Math.round(p.amp_norm * 1e4) / 1e4,
        gap_to_next_ms: p.gap_ms === null ? "" : Math.round(p.gap_ms * 100) / 100,
      }),
    );
    const add = (label, list) =>
      vectors.push({
        source_file: r.name,
        unit: label,
        n_pulses: list.length,
        vector: strVector(r, list).join(";"),
      });
    add("song", r.pulses);
    r.echemes.forEach((e, i) => add("echeme " + (i + 1), r.pulses.slice(e.first, e.last + 1)));
  });
  const P = strParams();
  const info = [
    {
      ...P,
      echeme_gap_ms: parseFloat(document.getElementById("strEGap").value) || 100,
      normalised_per: document.getElementById("strNorm").value,
      vector_layout: "dominant_khz;duration_ms;amplitude_norm;duration_ms;amplitude_norm;...",
      generated: new Date().toISOString(),
    },
  ];
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_STR_" + stamp + ".xlsx",
      _buildXlsx([["STR_summary", summary], ["Pulses", pulses], ["STR_vectors", vectors], ["Info", info]]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
  } catch (e) {
    log("STR export failed: " + e.message, "err");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", strInit);
else strInit();
