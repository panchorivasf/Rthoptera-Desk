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
    "<b>STR = Simplified Temporal Representation.</b> The song is reduced to the two things that carry most of its identity: " +
    "its <b>dominant frequency</b> and the <b>timing of its pulses</b>, drawn as a barcode " +
    "(bar width = pulse duration, bar height = maximum amplitude, the spaces between bars = the silent gaps). " +
    "The frequency comes from a long window averaged over all the pulses, so a single noisy moment cannot move it. " +
    "Compute it from the checked recordings, or build it from the Pulses table of a Temporal Analysis export." +
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
    '<button style="font-size:11px" onclick="document.getElementById(\'strXlsx\').click()" title="Build the STR from the Pulses sheet of a Temporal Analysis Excel export (pulse_start, pulse_end, amplitude, peak frequency). No audio is needed, and the pulses and motifs are exactly the ones you checked and edited there. A workbook holding several recordings (e.g. merged in Summarize) gives one STR per source_file.">&#128194; From Temporal Analysis table (.xlsx)</button>' +
    '<input type="file" id="strXlsx" accept=".xlsx" multiple style="display:none" onchange="strImportTables(this.files); this.value=\'\';">' +
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
    '<div class="panel"><div style="font-size:11px;color:var(--txt2);margin-bottom:2px" title="A fixed set of numbers summarising the whole song, the same for every recording, so songs can be compared and pooled into species profiles. Histograms are shares of pulses or intervals; the along-echeme profiles are relative, so recording length and gain do not matter.">STR fingerprint (fixed length, for comparing and pooling songs)</div>' +
    '<canvas id="strFp" style="width:100%;height:90px;display:block"></canvas>' +
    '<div id="strFpNote" style="font-size:11px;color:var(--txt2);margin-top:3px"></div></div>' +
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
  return { id: entry.id, name: entry.name, source: "audio", sr, dur: samples.length / sr, dom, pulses, echemes: [], meta: strEntryMeta(entry) };
}
// Specimen, species and temperature travel with the fingerprint so Summarize
// can group and temperature-correct it like any other table. The active
// recording's fields may have been edited since it was loaded.
function strEntryMeta(entry) {
  const active = entry.id === audioLibActiveId;
  return {
    specimen_id: (active ? currentSpecimenId : entry.specimenId) || "",
    species: (active ? currentSpecies : entry.species) || "",
    temp_c: (active ? currentTempC : entry.tempC) || "",
  };
}

// ── from a Temporal Analysis export ──────────────────────────────────
// The Pulses sheet already holds pulses the user checked by eye, so they are
// taken as they are. Amplitude: max_amp (pulses-only route) or mean_amp (peak
// route, which has no maximum). Dominant frequency: the median of the pulses'
// peak_freq_khz, the nearest thing to a long window averaged over the pulses
// that the table offers. motif_id, when present, defines the echemes.
function strFromRows(name, rows) {
  const num = (v) => {
    const x = typeof v === "number" ? v : parseFloat(v);
    return isFinite(x) ? x : null;
  };
  const pulses = [];
  rows.forEach((r) => {
    const s = num(r.pulse_start),
      e = num(r.pulse_end);
    if (s === null || e === null || !(e > s)) return;
    const amp = num(r.max_amp) ?? num(r.mean_amp);
    pulses.push({
      start: s,
      end: e,
      dur_ms: num(r.pulse_dur_ms) ?? (e - s) * 1000,
      amp: amp === null ? 1 : Math.abs(amp),
      motif: num(r.motif_id),
      f: num(r.peak_freq_khz),
    });
  });
  pulses.sort((a, b) => a.start - b.start);
  const fs = pulses.map((p) => p.f).filter((f) => f !== null && f > 0).sort((a, b) => a - b);
  const mid = fs.length >> 1,
    f0 = fs.length ? Math.round((fs.length % 2 ? fs[mid] : (fs[mid - 1] + fs[mid]) / 2) * 1000) / 1000 : null;
  return {
    id: null,
    name,
    source: "table",
    sr: num(rows[0] && rows[0].sample_rate_hz),
    dur: pulses.length ? pulses[pulses.length - 1].end : 0,
    dom: f0 === null ? null : { f0, spec: null },
    pulses,
    echemes: [],
    byMotif: pulses.length > 0 && pulses.every((p) => p.motif !== null),
    meta: {
      specimen_id: (rows.find((x) => x.specimen_id) || {}).specimen_id || "",
      species: (rows.find((x) => x.species) || {}).species || "",
      temp_c: (rows.find((x) => x.temp_c !== undefined && x.temp_c !== "") || {}).temp_c ?? "",
    },
  };
}
async function strImportTables(files) {
  if (!files || !files.length) return;
  const out = [],
    problems = [];
  for (const file of files) {
    let wb;
    try {
      wb = await _readXlsx(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      problems.push(file.name + ": " + e.message);
      continue;
    }
    // Prefer the sheet called Pulses; otherwise any sheet with pulse_start/pulse_end.
    const names = Object.keys(wb),
      has = (n) => wb[n] && wb[n].length && "pulse_start" in wb[n][0] && "pulse_end" in wb[n][0],
      sheet = names.find((n) => n.toLowerCase() === "pulses" && has(n)) || names.find(has);
    if (!sheet) {
      problems.push(file.name + ": no Pulses sheet (needs pulse_start and pulse_end columns)");
      continue;
    }
    const groups = new Map();
    wb[sheet].forEach((r) => {
      const k = r.source_file ? String(r.source_file) : file.name.replace(/\.xlsx$/i, "");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    groups.forEach((rows, k) => {
      const r = strFromRows(k, rows);
      if (r.pulses.length) out.push(r);
      else problems.push(k + ": no valid pulse rows");
    });
  }
  if (!out.length) {
    strSetStatus("Nothing imported. " + problems.join("; "), true);
    return;
  }
  strResults = out;
  strSel = 0;
  strEchemeSel = -1;
  strRegroup();
  document.getElementById("strResults").style.display = "flex";
  document.getElementById("strExport").disabled = false;
  strSetStatus(
    out.length + " recording(s) built from Temporal Analysis tables. Echemes follow the table's motif_id where present." +
      (problems.length ? " Skipped: " + problems.join("; ") + "." : ""),
    false,
  );
  strSelect(0);
}

// Echeme grouping and normalisation: cheap, so they follow the controls live.
function strRegroup() {
  const gap = (parseFloat(document.getElementById("strEGap").value) || 100) / 1000,
    perSong = document.getElementById("strNorm").value === "song";
  strResults.forEach((r) => {
    r.echemes = [];
    r.pulses.forEach((p, i) => {
      const prev = r.pulses[i - 1];
      // A table's own motifs win over the Echeme gap: they were checked by eye.
      const split = r.byMotif ? !prev || p.motif !== prev.motif : !prev || p.start - prev.end > gap;
      if (split) r.echemes.push({ first: i, last: i, start: p.start, end: p.end, max: 0 });
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
    pw = w - L - R, ph = h - T - B, base = T + ph,
    X = (t) => L + ((t - v.t0) / (v.t1 - v.t0)) * pw;
  if (strEchemeSel < 0)
    r.echemes.forEach((e, i) => {
      if (i % 2) return;
      g.fillStyle = "rgba(128,128,140,0.12)";
      g.fillRect(X(e.start), T, Math.max(1, X(e.end) - X(e.start)), ph);
    });
  // Amplitude is never negative, so the bars rise from a 0 baseline rather
  // than mirroring about a centre line: same information, twice the height.
  g.strokeStyle = "rgba(150,150,160,0.35)";
  g.beginPath();
  [0.5, 1].forEach((f) => {
    g.moveTo(L, base - f * ph);
    g.lineTo(L + pw, base - f * ph);
  });
  g.stroke();
  g.strokeStyle = "rgba(150,150,160,0.7)";
  g.beginPath();
  g.moveTo(L, base);
  g.lineTo(L + pw, base);
  g.stroke();
  g.fillStyle = accent;
  v.list.forEach((p) => {
    const bw = Math.max(1, X(p.end) - X(p.start)),
      bh = p.amp_norm * ph;
    g.fillRect(X(p.start), base - bh, bw, bh);
    p._x0 = X(p.start);
    p._x1 = X(p.start) + bw;
  });
  g.fillStyle = ink;
  g.font = "10px sans-serif";
  g.textAlign = "right";
  [["1", T + 4], ["0.5", base - ph / 2 + 3], ["0", base + 3]].forEach(([s, y]) => g.fillText(s, L - 5, y));
  g.textAlign = "center";
  const span = v.t1 - v.t0,
    useMs = span < 2;
  for (let i = 0; i <= 5; i++) {
    const t = v.t0 + (span * i) / 5;
    g.fillText(useMs ? (t * 1000).toFixed(0) : t.toFixed(span < 20 ? 1 : 0), X(t), h - 8);
  }
  g.textAlign = "right";
  g.fillText(useMs ? "ms" : "s", L - 16, h - 8); // clear of the first tick label, centred on L
  g.textAlign = "left";
  if (!v.list.length) g.fillText("No pulses found.", L + 10, base - ph / 2);
  strDrawSpec(r);
  strShowVector(r, v);
  strDrawFingerprint(r);
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
  if (!r.dom.spec) {
    g.fillStyle = ink;
    g.font = "11px sans-serif";
    g.fillText(
      "Built from a table: no audio, so no spectrum. Dominant frequency = median peak_freq_khz of the pulses (" + r.dom.f0.toFixed(2) + " kHz).",
      8,
      h / 2,
    );
    return;
  }
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
// [dominant kHz, dur_1, amp_1, gap_1, dur_2, amp_2, gap_2, ..., dur_n, amp_n]:
// each pulse is followed by the silence before the next one, so the vector
// holds the whole rhythm, not just the pulses. No gap after the last pulse.
function strVector(r, list) {
  const v = [r.dom ? Math.round(r.dom.f0 * 1000) / 1000 : null];
  list.forEach((p, i) => {
    v.push(Math.round(p.dur_ms * 100) / 100, Math.round(p.amp_norm * 1000) / 1000);
    if (i < list.length - 1) v.push(Math.round((list[i + 1].start - p.end) * 1e5) / 100);
  });
  return v;
}
function strShowVector(r, view) {
  const v = strVector(r, view.list),
    shown = v.slice(0, 90).join(", ");
  document.getElementById("strVector").textContent =
    "[" + shown + (v.length > 90 ? ", … (" + view.list.length + " pulses)" : "") +
    "]   =  [dominant kHz, duration ms, amplitude, gap ms, duration ms, amplitude, gap ms, …, duration ms, amplitude]";
}
// ── fingerprint ──────────────────────────────────────────────────────
// The vector's length depends on how many pulses were recorded, so two songs
// cannot be compared number by number. The fingerprint summarises the same
// barcode into a FIXED set of numbers, always in the same order, so songs can
// be averaged, compared and pooled into species profiles (Summary Analysis
// reads it as the "STR" table). Blocks:
//   scalars      dominant frequency and the classic rate/duty/echeme values
//   pdur_*       share of pulses per duration bin (log spaced)
//   ioi_*        share of onset-to-onset intervals per bin (log spaced); the
//                intervals that cross echemes land in the long bins, so the
//                rhythm at both levels is in one histogram
//   amp_pNN      mean amplitude shape along an echeme (time normalised, each
//                echeme scaled to its own loudest pulse)
//   dur_pNN      pulse duration along an echeme, relative to that echeme's mean
// Histograms are proportions and profiles are relative, so the fingerprint
// does not depend on recording length or gain.
const STR_FP = {
  durEdges: strLogEdges(0.5, 500, 8),
  ioiEdges: strLogEdges(1, 2000, 12),
  ampPos: 16,
  durPos: 8,
};
function strLogEdges(a, b, n) {
  const e = [];
  for (let i = 0; i <= n; i++) e.push(a * Math.pow(b / a, i / n));
  return e;
}
function strBinLabel(edges, i) {
  const f = (x) => (x < 10 ? x.toFixed(1) : Math.round(x));
  return f(edges[i]) + "-" + f(edges[i + 1]) + "ms";
}
function strHist(vals, edges) {
  const n = edges.length - 1,
    h = new Array(n).fill(0);
  vals.forEach((v) => {
    let k = 0;
    while (k < n - 1 && v >= edges[k + 1]) k++; // below the first edge -> bin 0, above the last -> last bin
    h[k]++;
  });
  const s = vals.length || 1;
  return h.map((c) => c / s);
}
// Value of a piecewise-linear profile (points sorted by x in [0, 1]) at u.
function strInterp(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (u <= pts[i][0]) {
      const [x0, y0] = pts[i - 1],
        [x1, y1] = pts[i];
      return x1 > x0 ? y0 + ((u - x0) / (x1 - x0)) * (y1 - y0) : y1;
    }
  return pts[pts.length - 1][1];
}
function strFingerprint(r) {
  const P = r.pulses,
    E = r.echemes,
    r4 = (x) => (x === null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4),
    mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null),
    median = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y),
        m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
  if (P.length < 2) return null;
  const fp = {};
  const multi = E.filter((e) => e.last > e.first),
    within = [];
  multi.forEach((e) => {
    for (let i = e.first; i < e.last; i++) within.push((P[i + 1].start - P[i].end) * 1000);
  });
  fp.dominant_khz = r.dom ? r4(r.dom.f0) : null;
  fp.pulse_rate_pps = r4(mean(multi.map((e) => (e.last - e.first) / (P[e.last].start - P[e.first].start))));
  fp.duty_cycle_pct = r4(
    mean(
      multi.map((e) => {
        let on = 0;
        for (let i = e.first; i <= e.last; i++) on += P[i].end - P[i].start;
        return (100 * on) / (e.end - e.start);
      }),
    ),
  );
  fp.pulses_per_echeme = r4(mean(E.map((e) => e.last - e.first + 1)));
  fp.echeme_dur_ms = r4(mean(E.map((e) => (e.end - e.start) * 1000)));
  fp.echeme_period_ms = r4(E.length > 1 ? mean(E.slice(1).map((e, i) => (e.start - E[i].start) * 1000)) : null);
  fp.pulse_dur_median_ms = r4(median(P.map((p) => p.dur_ms)));
  fp.pulse_gap_median_ms = r4(median(within));

  strHist(P.map((p) => p.dur_ms), STR_FP.durEdges).forEach((v, i) => (fp["pdur_" + strBinLabel(STR_FP.durEdges, i)] = r4(v)));
  const ioi = [];
  for (let i = 1; i < P.length; i++) ioi.push((P[i].start - P[i - 1].start) * 1000);
  strHist(ioi, STR_FP.ioiEdges).forEach((v, i) => (fp["ioi_" + strBinLabel(STR_FP.ioiEdges, i)] = r4(v)));

  // Profiles along the echeme, from echemes with at least 3 pulses (fewer
  // points describe no shape). x = pulse centre, 0 at the echeme's first
  // pulse centre and 1 at its last.
  const shaped = E.filter((e) => e.last - e.first >= 2),
    amp = new Array(STR_FP.ampPos).fill(0),
    dur = new Array(STR_FP.durPos).fill(0);
  shaped.forEach((e) => {
    const c = (p) => (p.start + p.end) / 2,
      x0 = c(P[e.first]),
      span = c(P[e.last]) - x0 || 1,
      ps = P.slice(e.first, e.last + 1),
      mDur = ps.reduce((s, p) => s + p.dur_ms, 0) / ps.length || 1,
      ap = ps.map((p) => [(c(p) - x0) / span, e.max > 0 ? p.amp / e.max : 0]),
      dp = ps.map((p) => [(c(p) - x0) / span, p.dur_ms / mDur]);
    for (let k = 0; k < STR_FP.ampPos; k++) amp[k] += strInterp(ap, (k + 0.5) / STR_FP.ampPos);
    for (let k = 0; k < STR_FP.durPos; k++) dur[k] += strInterp(dp, (k + 0.5) / STR_FP.durPos);
  });
  const two = (k) => String(k + 1).padStart(2, "0");
  amp.forEach((v, k) => (fp["amp_p" + two(k)] = shaped.length ? r4(v / shaped.length) : null));
  dur.forEach((v, k) => (fp["dur_p" + two(k)] = shaped.length ? r4(v / shaped.length) : null));
  return fp;
}
function strDrawFingerprint(r) {
  const cv = document.getElementById("strFp"),
    note = document.getElementById("strFpNote");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const fp = strFingerprint(r);
  if (!fp) {
    note.textContent = "Needs at least 2 pulses.";
    return;
  }
  const css = getComputedStyle(document.body),
    ink = css.getPropertyValue("--txt2").trim() || "#999",
    accent = css.getPropertyValue("--accent").trim() || "#58a6ff";
  const keys = Object.keys(fp),
    groups = [
      ["Pulse duration", keys.filter((k) => k.startsWith("pdur_")), 1],
      ["Onset-to-onset interval", keys.filter((k) => k.startsWith("ioi_")), 1],
      ["Amplitude along echeme", keys.filter((k) => k.startsWith("amp_p")), 1],
      ["Duration along echeme", keys.filter((k) => k.startsWith("dur_p")), 2],
    ],
    total = groups.reduce((s, gr) => s + gr[1].length, 0),
    gap = 14,
    T = 14,
    B = 6,
    bw = (w - gap * (groups.length - 1)) / total;
  let x = 0;
  g.font = "10px sans-serif";
  groups.forEach(([label, ks, max]) => {
    g.fillStyle = ink;
    g.fillText(label, x, 10);
    g.strokeStyle = "rgba(150,150,160,0.35)";
    g.strokeRect(x, T, bw * ks.length, h - T - B);
    g.fillStyle = accent;
    ks.forEach((k, i) => {
      const v = fp[k] === null ? 0 : Math.min(1, fp[k] / max),
        bh = v * (h - T - B);
      g.fillRect(x + i * bw + 1, h - B - bh, Math.max(1, bw - 2), bh);
    });
    x += bw * ks.length + gap;
  });
  const n = keys.length;
  note.textContent =
    n + " numbers. Rate " + (fp.pulse_rate_pps ?? "–") + " pulses/s, duty cycle " + (fp.duty_cycle_pct ?? "–") +
    " %, " + (fp.pulses_per_echeme ?? "–") + " pulses/echeme, echeme period " + (fp.echeme_period_ms ?? "–") + " ms. " +
    "Exported in the STR_fingerprint sheet, which Summarize reads as the STR table.";
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
    vectors = [],
    prints = [];
  strResults.forEach((r) => {
    const fp = strFingerprint(r);
    if (fp)
      prints.push({
        source_file: r.name,
        specimen_id: (r.meta && r.meta.specimen_id) || "",
        species: (r.meta && r.meta.species) || "",
        temp_c: (r.meta && r.meta.temp_c) ?? "",
        ...fp,
      });
    summary.push({
      source_file: r.name,
      built_from: r.source === "table" ? "Temporal Analysis table" : "audio",
      dominant_khz: r.dom ? Math.round(r.dom.f0 * 1000) / 1000 : "",
      n_pulses: r.pulses.length,
      n_echemes: r.echemes.length,
      duration_s: Math.round(r.dur * 1000) / 1000,
      sample_rate_hz: r.sr ?? "",
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
      vector_layout: "dominant_khz;duration_ms;amplitude_norm;gap_ms;duration_ms;amplitude_norm;gap_ms;...;duration_ms;amplitude_norm",
      fingerprint_version: 1,
      fingerprint_layout:
        "scalars; pdur_* = share of pulses per duration bin (8, log 0.5-500 ms); ioi_* = share of onset-to-onset intervals per bin (12, log 1-2000 ms); amp_p01-16 = mean amplitude along the echeme (each scaled to its loudest pulse); dur_p01-08 = pulse duration along the echeme / echeme mean",
      generated: new Date().toISOString(),
    },
  ];
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_STR_" + stamp + ".xlsx",
      // STR_pulses, not Pulses: Summarize would otherwise take these rows for
      // a Temporal Analysis pulse table.
      _buildXlsx([["STR_fingerprint", prints], ["STR_summary", summary], ["STR_pulses", pulses], ["STR_vectors", vectors], ["Info", info]]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
  } catch (e) {
    log("STR export failed: " + e.message, "err");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", strInit);
else strInit();
