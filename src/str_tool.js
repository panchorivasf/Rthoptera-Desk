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
  // One parameter as a label cell and a box cell of a grid, so a pane's
  // fields line up in columns and the three top panes stay compact.
  const num = (id, label, val, tip, min, step) =>
    '<span style="font-size:11px;color:var(--txt2);white-space:nowrap" title="' + tip + '">' + label + "</span>" +
    '<input type="number" id="' + id + '" value="' + val + '" min="' + min + '" step="' + step +
    '" title="' + tip + '" style="width:64px;font-size:11px">';
  const grid = (cols) => '<div style="display:grid;grid-template-columns:' + cols + ';gap:5px 8px;align-items:center">';
  root.innerHTML =
    '<div style="font-size:11px;color:var(--txt2);line-height:1.6;max-width:1250px">' +
    "<b>STR = Simplified Temporal Representation.</b> The song is reduced to the two things that carry most of its identity: " +
    "its <b>dominant frequency</b> and the <b>timing of its pulses</b>, drawn as a barcode " +
    "(bar width = pulse duration, bar height = maximum amplitude, the spaces between bars = the silent gaps). " +
    "The frequency comes from a long window averaged over all the pulses, so a single noisy moment cannot move it. " +
    "Compute it from the checked recordings, or build it from the Pulses table of a Temporal Analysis export." +
    "</div>" +
    // Settings and actions: one row of three panes (wraps on narrow windows).
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;max-width:1250px">' +
    '<div class="panel" style="flex:0 0 auto;margin:0"><h2>Dominant frequency</h2>' + grid("auto auto") +
    num("strWin", "Window (ms)", 50, "Length of each spectrum window. Longer windows give a finer, steadier peak.", 5, 5) +
    num("strSmooth", "Smoothing (Hz)", 1000, "The averaged spectrum is smoothed over this width before the peak is taken, so the result follows the main band rather than a single spike.", 0, 100) +
    num("strLow", "Search from (kHz)", 1, "Ignore everything below this frequency (wind, handling noise).", 0, 0.5) +
    "</div></div>" +
    '<div class="panel" style="flex:0 0 auto;margin:0"><h2>Pulses</h2>' + grid("auto auto auto auto") +
    num("strBand", "Band-limit &plusmn; (kHz)", 3, "Before looking for pulses, keep only this much either side of the dominant frequency, so noise outside the song does not count. 0 = use the whole band.", 0, 0.5) +
    num("strRes", "Envelope step (ms)", 0.25, "Time resolution of the amplitude envelope. Pulse starts and ends are accurate to about this much.", 0.05, 0.05) +
    num("strThr", "Threshold (dB below peak)", 20, "A pulse is any stretch whose envelope stays above this level, measured down from the loud end of the recording.", 3, 1) +
    num("strMinDur", "Min pulse (ms)", 1, "Shorter blips are discarded.", 0, 0.5) +
    num("strMerge", "Join gaps shorter than (ms)", 0.5, "Two stretches separated by less than this are one pulse.", 0, 0.25) +
    "</div></div>" +
    '<div class="panel" style="flex:1 1 340px;min-width:0;margin:0;display:flex;flex-direction:column;gap:6px">' +
    '<div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">' +
    '<button id="strRun" class="suc" style="font-size:11px" onclick="strRun()">&#9654; Compute STR for checked recordings</button>' +
    '<button style="font-size:11px" onclick="pickXlsxFiles(\'strXlsx\', strImportTables)" title="Build the STR from the Pulses sheet of Temporal Analysis Excel exports (pulse_start, pulse_end, amplitude, peak frequency). No audio is needed, and the pulses and motifs are exactly the ones you checked and edited there. Pick several files at once with Ctrl+click or Shift+click; a workbook holding several recordings (e.g. merged in Summarize) gives one STR per source_file. Each import ADDS to the list.">&#128194; Add Temporal Analysis tables (.xlsx)&hellip;</button>' +
    '<button style="font-size:11px" onclick="strClear()" title="Remove every STR from the list, and the representatives built from or loaded with them.">Clear</button>' +
    '<input type="file" id="strXlsx" accept=".xlsx" multiple style="display:none" onchange="strImportTables(this.files); this.value=\'\';">' +
    "</div>" +
    '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
    grid("auto auto auto auto") +
    num("strEGap", "Echeme gap (ms)", 100, "Pulses closer together than this belong to the same echeme. Changing it regroups instantly.", 1, 10) +
    '<span style="font-size:11px;color:var(--txt2)" title="Bar heights are divided by the loudest pulse of each echeme, or of the whole song. Changing it redraws instantly.">Normalise per</span>' +
    '<select id="strNorm" style="font-size:11px" onchange="strRegroup()"><option value="echeme">echeme</option><option value="song">song</option></select>' +
    "</div>" +
    '<button id="strExport" style="font-size:11px" onclick="strExport()" disabled>&#11015; Export (Excel)</button>' +
    "</div>" +
    '<div id="strStatus" style="font-size:11px;color:var(--txt2)">Compute from recordings checked in the Loaded Audio list (or the active one), and/or add Temporal Analysis tables. Both add to the same list, so recordings and tables can be pooled.</div></div>' +
    "</div>" +
    // Results: plots on the left, the list of loaded STRs on the right (the
    // list drops below the plots on narrow windows).
    '<div id="strResults" style="display:none;max-width:1250px;gap:8px;flex-wrap:wrap;align-items:flex-start">' +
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
    "</div>" +
    '<div class="panel" style="flex:0 1 360px;min-width:260px;max-height:640px;overflow:auto;margin:0">' +
    '<table class="dtable" style="table-layout:fixed;width:100%"><colgroup><col><col style="width:44px"><col style="width:48px"><col style="width:56px"><col style="width:20px"></colgroup>' +
    "<thead><tr><th>Recording</th><th>kHz</th><th>Pulses</th><th>Echemes</th><th></th></tr></thead><tbody id=\"strBody\"></tbody></table></div>" +
    "</div>" +
    // Outside #strResults: loaded representative files must show even with
    // no STR in the list.
    '<div id="strRepPanel" class="panel" style="display:none;max-width:1250px;min-width:0">' +
    '<div class="row" style="gap:10px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--txt2)">' +
    '<b style="color:var(--txt3)" title="One consensus song per species, pooled from every STR in the list above, plus any representatives loaded from files. Time is expressed as a proportion of each echeme, so faster and slower renditions (temperature, individuals) line up; the tempo itself is kept apart as one number, the median period.">Representative STR</b>' +
    '<label class="chk">Species <select id="strRepSp" style="font-size:11px" onchange="strDrawRep()"></select></label>' +
    '<label class="chk" title="Overlay a second species on both plots, in pink: its amplitude as an outline and its occupancy as a dashed line on the barcode, its fingerprint as outlined bars.">Compare with <select id="strRepCmp" style="font-size:11px" onchange="strDrawRep()"></select></label>' +
    '<label class="chk" title="Echeme period = onset to the next echeme\'s onset, so the silence after the echeme is part of the shape (the last echeme of each recording has no period and is left out). Echeme duration = first pulse onset to last pulse offset: the internal pattern only. Applies to representatives built here; loaded ones keep the setting they were saved with.">Normalise by <select id="strRepBy" style="font-size:11px" onchange="strBuildRep()"><option value="period">echeme period</option><option value="duration">echeme duration</option></select></label>' +
    '<span style="flex:1"></span>' +
    '<button style="font-size:11px" onclick="pickXlsxFiles(\'strRepXlsx\', strLoadReps)" title="Load representatives saved earlier (the representative Excel, or the main STR export), any number of files and species, to view and compare them here.">&#128194; Load representatives&hellip;</button>' +
    '<input type="file" id="strRepXlsx" accept=".xlsx" multiple style="display:none" onchange="strLoadReps(this.files); this.value=\'\';">' +
    '<button style="font-size:11px" onclick="strRepSavePng()" title="Both plots of the species shown, with a caption, as one PNG.">&#11015; PNG</button>' +
    '<button style="font-size:11px" onclick="strRepExportXlsx()" title="Every species\' representative: STR_representative (tempo, consensus bars, occupancy and amplitude per 1% of the unit) and STR_rep_fingerprint (median and quartiles of the 52 numbers). Both are also in the main Export (Excel).">&#11015; Excel</button>' +
    "</div>" +
    '<canvas id="strRepCanvas" style="width:100%;height:200px;display:block;margin-top:4px"></canvas>' +
    '<div id="strRepNote" style="font-size:11px;color:var(--txt2);margin-top:3px"></div>' +
    '<canvas id="strRepFp" style="width:100%;height:110px;display:block;margin-top:10px"></canvas>' +
    '<div id="strRepFpNote" style="font-size:11px;color:var(--txt2);margin-top:3px"></div></div>';
  document.getElementById("strCanvas").addEventListener("click", strCanvasClick);
  // Redraw whenever the plots change size: window resizes, the Loaded Audio
  // pane opening, and above all the STR tab or results block going from
  // hidden (0 wide) to shown, which is what left the plots blank before.
  if (typeof ResizeObserver === "function") {
    let pending = false;
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        strRedrawAll();
      });
    });
    ["strCanvas", "strRepCanvas"].forEach((id) => ro.observe(document.getElementById(id)));
  } else window.addEventListener("resize", strRedrawAll);
}
// Every STR plot, but only while visible: drawn while hidden, a canvas is
// 0 wide, and redrawing then would wipe a good picture.
function strRedrawAll() {
  const c = document.getElementById("strRepCanvas");
  if (!c || !c.clientWidth) return;
  if (strSel >= 0 && strResults[strSel]) strDraw();
  strDrawRep();
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
  const replaced = strAddResults(out);
  strSetStatus(
    "Added " + out.length + " recording(s) from " + files.length + " table(s)" +
      (replaced ? " (" + replaced + " already listed, replaced)" : "") + "; " + strResults.length + " in the list. " +
      "Echemes follow the table's motif_id where present." +
      (problems.length ? " Skipped: " + problems.join("; ") + "." : ""),
    false,
  );
}
// New STRs join the list; one with the same recording name replaces the old
// entry, so re-importing a corrected table updates it instead of doubling it.
function strAddResults(list) {
  let replaced = 0;
  list.forEach((r) => {
    const i = strResults.findIndex((x) => x.name === r.name);
    if (i >= 0) {
      strResults[i] = r;
      replaced++;
    } else strResults.push(r);
  });
  strSel = strResults.indexOf(list[0]);
  strEchemeSel = -1;
  // Shown BEFORE drawing: a canvas inside a hidden block measures 0 wide and
  // stays blank.
  document.getElementById("strResults").style.display = "flex";
  document.getElementById("strExport").disabled = !strResults.length;
  strRegroup();
  strSelect(strSel);
  return replaced;
}
function strRemove(i) {
  strResults.splice(i, 1);
  if (!strResults.length) {
    strClear();
    return;
  }
  strSel = Math.min(strSel, strResults.length - 1);
  strEchemeSel = -1;
  strRegroup();
  strSelect(strSel);
  strSetStatus(strResults.length + " in the list.", false);
}
function strClear() {
  strResults = [];
  strReps = [];
  strRepsFile = [];
  strSel = -1;
  strEchemeSel = -1;
  document.getElementById("strResults").style.display = "none";
  document.getElementById("strExport").disabled = true;
  strBuildRep();
  strSetStatus("List cleared.", false);
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
  strBuildRep();
}

// ── representative STR ───────────────────────────────────────────────
// Shape and tempo are pooled separately. Each unit (echeme period, echeme
// duration, or for trills the pulse cycle) is mapped onto 0..1 and cut into
// STR_REP_BINS bins. Per bin: occupancy = share of units with sound there
// (partial overlap counts partially), amplitude = mean level of that sound,
// each unit scaled to its own loudest pulse. Units with different pulse
// counts blend instead of being discarded: positions every rendition agrees
// on come out solid, variable ones faint. The tempo is the unit length in ms,
// reported as median and quartiles.
const STR_REP_BINS = 100;
let strReps = []; // built from the STR list
let strRepsFile = []; // loaded from saved files (strLoadReps)
const strRepsAll = () => strReps.concat(strRepsFile);
function strRepUnits(r, by) {
  const P = r.pulses,
    E = r.echemes,
    units = [];
  E.forEach((e, i) => {
    if (by === "period") {
      if (i < E.length - 1) units.push({ a: e.start, b: E[i + 1].start, first: e.first, last: e.last, max: e.max });
    } else if (e.last > e.first) units.push({ a: e.start, b: e.end, first: e.first, last: e.last, max: e.max });
  });
  return units;
}
function strRepCycles(r) {
  // Trill fallback: every pulse onset to the next pulse's onset.
  const P = r.pulses,
    max = Math.max(0, ...P.map((p) => p.amp)),
    out = [];
  for (let i = 0; i < P.length - 1; i++) out.push({ a: P[i].start, b: P[i + 1].start, first: i, last: i, max });
  return out;
}
function strBuildRep() {
  const sel = document.getElementById("strRepBy");
  if (!sel) return;
  const by = sel.value,
    groups = new Map();
  strResults.forEach((r) => {
    const sp = (r.meta && String(r.meta.species || "").trim()) || "(no species)";
    if (!groups.has(sp)) groups.set(sp, []);
    groups.get(sp).push(r);
  });
  strReps = [];
  groups.forEach((recs, sp) => {
    // A period needs a FOLLOWING echeme in the same recording, so n echemes
    // give n - 1 periods and a one-echeme recording gives none. When that
    // leaves fewer than 3, durations (any echeme of 2+ pulses) are tried
    // before falling back to the pulse cycle, and `why` says what happened.
    const collect = (b) => {
        const ps = [];
        recs.forEach((r) => strRepUnits(r, b).forEach((u) => ps.push([r, u])));
        return ps;
      },
      nEch = recs.reduce((s, r) => s + r.echemes.length, 0),
      found = nEch + " echeme(s) in " + recs.length + " recording(s)";
    let unitKind = by === "period" ? "echeme period" : "echeme duration",
      pairs = collect(by),
      why = "";
    if (pairs.length < 3 && by === "period") {
      const d = collect("duration");
      why =
        found + " give only " + pairs.length + " echeme period(s): a period runs to the NEXT echeme's onset, so the last echeme of each recording has none.";
      if (d.length >= 3) {
        pairs = d;
        unitKind = "echeme duration";
        why += " Echeme durations are used instead.";
      }
    }
    if (pairs.length < 3) {
      if (!why) why = found + " give only " + pairs.length + " echeme(s) with 2 or more pulses.";
      why +=
        " Too few to pool, so the pulse cycle (onset to next onset) is used. If the song does have echemes, they were not separated:" +
        " for tables, echemes follow motif_id (check Max pulse gap in Temporal Analysis); from audio, lower the Echeme gap.";
      unitKind = "pulse cycle";
      pairs = [];
      recs.forEach((r) => strRepCycles(r).forEach((u) => pairs.push([r, u])));
    }
    if (!pairs.length) return;
    const B = STR_REP_BINS,
      occ = new Float64Array(B),
      ampW = new Float64Array(B),
      lens = [];
    pairs.forEach(([r, u]) => {
      const L = u.b - u.a;
      if (!(L > 0)) return;
      lens.push(L * 1000);
      for (let i = u.first; i <= u.last; i++) {
        const p = r.pulses[i],
          x0 = Math.max(0, (p.start - u.a) / L),
          x1 = Math.min(1, (p.end - u.a) / L),
          a = u.max > 0 ? p.amp / u.max : 0;
        if (!(x1 > x0)) continue;
        for (let k = Math.floor(x0 * B); k < Math.min(B, Math.ceil(x1 * B)); k++) {
          const cov = Math.max(0, Math.min(x1, (k + 1) / B) - Math.max(x0, k / B)) * B;
          occ[k] += cov;
          ampW[k] += cov * a;
        }
      }
    });
    const n = lens.length;
    if (!n) return;
    const s = [...lens].sort((x, y) => x - y),
      q = (f) => s[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))],
      temps = recs.map((r) => parseFloat(r.meta && r.meta.temp_c)).filter(isFinite);
    // Representative fingerprint: per number, the median of the recordings'
    // fingerprints, with quartiles. One recording = one vote, however many
    // pulses it holds.
    const fps = recs.map(strFingerprint).filter(Boolean),
      fp = {},
      fpQ = {};
    if (fps.length)
      Object.keys(fps[0]).forEach((k) => {
        const v = fps.map((f) => f[k]).filter((x) => x !== null && isFinite(x)).sort((a, b) => a - b),
          at = (f) => {
            const p = f * (v.length - 1),
              i = Math.floor(p);
            return i + 1 < v.length ? v[i] + (p - i) * (v[i + 1] - v[i]) : v[i];
          };
        fp[k] = v.length ? Math.round(at(0.5) * 1e4) / 1e4 : null;
        fpQ[k] = v.length ? [Math.round(at(0.25) * 1e4) / 1e4, Math.round(at(0.75) * 1e4) / 1e4] : null;
      });
    strReps.push({
      species: sp,
      unit: unitKind,
      why,
      fp: fps.length ? fp : null,
      fpQ,
      nFp: fps.length,
      nRec: recs.length,
      nUnits: n,
      occ: Array.from(occ, (v) => v / n),
      amp: Array.from(occ, (v, k) => (v > 0 ? ampW[k] / v : 0)),
      med: q(0.5),
      q1: q(0.25),
      q3: q(0.75),
      tMin: temps.length ? Math.min(...temps) : null,
      tMax: temps.length ? Math.max(...temps) : null,
    });
  });
  strFillRepSelects();
  strDrawRep();
}
// Species and Compare menus over built + loaded representatives; the choice
// survives a rebuild by matching the label, not the index.
function strRepLabel(x) {
  return x.species + (x.fromFile ? " (" + x.fromFile + ")" : "");
}
function strFillRepSelects() {
  const all = strRepsAll(),
    spSel = document.getElementById("strRepSp"),
    cmpSel = document.getElementById("strRepCmp"),
    prevSp = spSel.selectedOptions[0] ? spSel.selectedOptions[0].textContent : "",
    prevCmp = cmpSel.selectedOptions[0] ? cmpSel.selectedOptions[0].textContent : "";
  const opts = all.map((x, i) => '<option value="' + i + '">' + strEsc(strRepLabel(x)) + "</option>").join("");
  spSel.innerHTML = opts;
  cmpSel.innerHTML = '<option value="-1">(none)</option>' + opts;
  const find = (label) => all.findIndex((x) => strRepLabel(x) === label);
  if (find(prevSp) >= 0) spSel.value = String(find(prevSp));
  cmpSel.value = find(prevCmp) >= 0 ? String(find(prevCmp)) : "-1";
  document.getElementById("strRepPanel").style.display = all.length ? "" : "none";
}
// Representatives saved earlier: STR_representative rows (barcode, tempo)
// joined by species with STR_rep_fingerprint rows (fingerprint). Either sheet
// alone is enough. A species loaded again from the same file replaces itself.
async function strLoadReps(files) {
  if (!files || !files.length) return;
  let added = 0;
  const problems = [];
  for (const file of files) {
    let wb;
    try {
      wb = await _readXlsx(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      problems.push(file.name + ": " + e.message);
      continue;
    }
    const bar = wb.STR_representative || [],
      fpr = wb.STR_rep_fingerprint || [];
    if (!bar.length && !fpr.length) {
      problems.push(file.name + ": no STR_representative or STR_rep_fingerprint sheet");
      continue;
    }
    const num = (v) => (v === "" || v === null || v === undefined || !isFinite(+v) ? null : +v);
    const species = [...new Set(bar.concat(fpr).map((r) => String(r.species || "").trim() || "(no species)"))];
    species.forEach((sp) => {
      const b = bar.find((r) => (String(r.species || "").trim() || "(no species)") === sp),
        f = fpr.find((r) => (String(r.species || "").trim() || "(no species)") === sp);
      const series = (row, pre) =>
        row
          ? Object.keys(row)
              .filter((k) => k.startsWith(pre))
              .sort()
              .map((k) => num(row[k]) ?? 0)
          : null;
      let fp = null,
        fpQ = {};
      if (f) {
        fp = {};
        Object.keys(f).forEach((k) => {
          if (/^(species|n_recordings|temp_min_c|temp_max_c)$/.test(k) || /_q[13]$/.test(k)) return;
          fp[k] = num(f[k]);
          fpQ[k] = num(f[k + "_q1"]) !== null ? [num(f[k + "_q1"]), num(f[k + "_q3"])] : null;
        });
      }
      const rep = {
        species: sp,
        fromFile: file.name.replace(/\.xlsx$/i, ""),
        unit: (b && b.unit) || "echeme period",
        why: (b && b.note) || "",
        nRec: num(b ? b.n_recordings : f.n_recordings) ?? 0,
        nUnits: num(b && b.n_units) ?? 0,
        occ: series(b, "occ_"),
        amp: series(b, "amp_"),
        med: num(b && b.tempo_median_ms),
        q1: num(b && b.tempo_q1_ms),
        q3: num(b && b.tempo_q3_ms),
        tMin: num((b || f).temp_min_c),
        tMax: num((b || f).temp_max_c),
        fp,
        fpQ,
        nFp: num(f && f.n_recordings) ?? 0,
      };
      const i = strRepsFile.findIndex((x) => x.species === sp && x.fromFile === rep.fromFile);
      if (i >= 0) strRepsFile[i] = rep;
      else strRepsFile.push(rep);
      added++;
    });
  }
  strFillRepSelects();
  // Show the first species just loaded.
  const spSel = document.getElementById("strRepSp");
  if (added) spSel.value = String(strRepsAll().length - strRepsFile.length + Math.max(0, strRepsFile.length - added));
  strDrawRep();
  strSetStatus(
    "Loaded " + added + " representative(s) from " + files.length + " file(s)." + (problems.length ? " Skipped: " + problems.join("; ") + "." : ""),
    !added,
  );
}
// The consensus as bars: runs of bins where most units have sound (occupancy
// >= 0.5), each with its mean amplitude. [start, end] are proportions.
function strRepBars(rep) {
  const bars = [],
    B = rep.occ.length;
  let k = 0;
  while (k < B) {
    if (rep.occ[k] < 0.5) {
      k++;
      continue;
    }
    let j = k,
      s = 0,
      w = 0;
    while (j < B && rep.occ[j] >= 0.5) {
      s += rep.amp[j] * rep.occ[j];
      w += rep.occ[j];
      j++;
    }
    bars.push([k / B, j / B, w > 0 ? s / w : 0]);
    k = j;
  }
  return bars;
}
function strDrawRep() {
  const cv = document.getElementById("strRepCanvas"),
    note = document.getElementById("strRepNote");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const all = strRepsAll(),
    rep = all[+document.getElementById("strRepSp").value],
    cmpI = +document.getElementById("strRepCmp").value,
    cmp = cmpI >= 0 && all[cmpI] !== rep ? all[cmpI] : null,
    PINK = "#e8589c";
  if (!rep) {
    note.textContent = strResults.length ? "Not enough pulses to build a representative." : "";
    strDrawFpChart(document.getElementById("strRepFp"), null);
    document.getElementById("strRepFpNote").textContent = "";
    return;
  }
  const css = getComputedStyle(document.body),
    ink = css.getPropertyValue("--txt2").trim() || "#999",
    accent = css.getPropertyValue("--accent").trim() || "#58a6ff";
  const L = 40, R = 12, T = 10, B = 24,
    pw = w - L - R, ph = h - T - B, base = T + ph;
  g.strokeStyle = "rgba(150,150,160,0.35)";
  g.beginPath();
  [0.5, 1].forEach((f) => {
    g.moveTo(L, base - f * ph);
    g.lineTo(L + pw, base - f * ph);
  });
  g.stroke();
  if (rep.occ && rep.occ.length) {
    const bw = pw / rep.occ.length;
    // Every bin: height = mean amplitude, opacity = how many units agree.
    g.fillStyle = accent;
    rep.occ.forEach((o, k) => {
      if (o <= 0) return;
      g.globalAlpha = 0.15 + 0.85 * o;
      const bh = rep.amp[k] * ph;
      g.fillRect(L + k * bw, base - bh, Math.max(1, bw + 0.5), bh);
    });
    g.globalAlpha = 1;
    // Occupancy as a line, so "always there" and "sometimes there" read apart.
    g.strokeStyle = "#f0b429";
    g.beginPath();
    rep.occ.forEach((o, k) => {
      const x = L + (k + 0.5) * bw,
        y = base - o * ph;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  } else {
    g.fillStyle = ink;
    g.font = "11px sans-serif";
    g.fillText("No barcode in this file (fingerprint only).", L + 8, T + ph / 2);
  }
  // The compared species, in pink: amplitude where it has sound (outline)
  // and its occupancy (dashed).
  if (cmp && cmp.occ && cmp.occ.length) {
    const bw2 = pw / cmp.occ.length;
    g.strokeStyle = PINK;
    g.lineWidth = 1.5;
    g.beginPath();
    cmp.occ.forEach((o, k) => {
      const y = base - (o > 0 ? cmp.amp[k] : 0) * ph;
      if (!k) g.moveTo(L, y);
      g.lineTo(L + k * bw2, y);
      g.lineTo(L + (k + 1) * bw2, y);
    });
    g.stroke();
    g.setLineDash([4, 3]);
    g.lineWidth = 1;
    g.beginPath();
    cmp.occ.forEach((o, k) => {
      const x = L + (k + 0.5) * bw2,
        y = base - o * ph;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = "rgba(150,150,160,0.7)";
  g.beginPath();
  g.moveTo(L, base);
  g.lineTo(L + pw, base);
  g.stroke();
  g.fillStyle = ink;
  g.font = "10px sans-serif";
  g.textAlign = "right";
  [["1", T + 4], ["0.5", base - ph / 2 + 3], ["0", base + 3]].forEach(([s, y]) => g.fillText(s, L - 5, y));
  g.textAlign = "center";
  for (let i = 0; i <= 10; i++) g.fillText((i / 10).toFixed(1), L + (pw * i) / 10, h - 8);
  g.textAlign = "left";
  const r0 = (x) => (x === null || x === undefined ? "–" : Math.round(x * 10) / 10);
  const tempo = (x) =>
    "median " + x.unit + " " + r0(x.med) + " ms (quartiles " + r0(x.q1) + "–" + r0(x.q3) + ")" +
    (x.tMin !== null && x.tMin !== undefined ? ", recorded at " + x.tMin + (x.tMax !== x.tMin ? "–" + x.tMax : "") + " °C" : "");
  note.innerHTML =
    "<b>" + strEsc(strRepLabel(rep)) + "</b>: " + rep.nUnits + " " + rep.unit + "s from " + rep.nRec + " recording(s). " +
    "Time axis = proportion of the " + rep.unit + "; bar height = mean amplitude, opacity and the " +
    '<span style="color:#f0b429">yellow line</span> = share of renditions with sound there. ' +
    "Tempo: " + tempo(rep) + "." +
    (rep.why ? ' <span style="color:#f0b429">' + strEsc(rep.why) + "</span>" : "") +
    (cmp
      ? '<br><span style="color:' + PINK + '"><b>Compared: ' + strEsc(strRepLabel(cmp)) + "</b></span> (outline = amplitude, dashed = occupancy): " +
        tempo(cmp) + "." +
        (cmp.unit !== rep.unit ? ' <span style="color:#f0b429">Different units (' + rep.unit + " vs " + cmp.unit + "): the time axes do not mean the same thing.</span>" : "")
      : "");
  const fcv = document.getElementById("strRepFp"),
    fnote = document.getElementById("strRepFpNote");
  strDrawFpChart(fcv, rep.fp, rep.fpQ, cmp && cmp.fp);
  const f = rep.fp,
    line = (x) =>
      "rate " + (x.pulse_rate_pps ?? "–") + " pulses/s, duty cycle " + (x.duty_cycle_pct ?? "–") + " %, " + (x.pulses_per_echeme ?? "–") +
      " pulses/echeme, echeme period " + (x.echeme_period_ms ?? "–") + " ms";
  fnote.innerHTML = f
    ? "Representative fingerprint: median of " + rep.nFp + " recording fingerprint(s), whiskers = quartiles; " + line(f) +
      ". Rates and intervals are in real time, so recordings at different temperatures widen the quartiles." +
      (rep.nFp < 3 ? " With fewer than 3 recordings the quartiles mean little." : "") +
      (cmp && cmp.fp ? '<br><span style="color:' + PINK + '">Outlined: ' + strEsc(strRepLabel(cmp)) + "</span>; " + line(cmp.fp) + "." : "")
    : "No fingerprint for this species.";
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
  if (!out.length) {
    strSetStatus("No audio to process.", true);
    return;
  }
  const replaced = strAddResults(out);
  const none = out.filter((r) => !r.pulses.length).length;
  strSetStatus(
    out.length + " recording(s) processed" + (replaced ? " (" + replaced + " already listed, replaced)" : "") + "; " +
      strResults.length + " in the list" +
      (none ? "; " + none + " with no pulses found (try a lower threshold or a smaller minimum pulse)" : "") + ".",
    false,
  );
}

// ── results ──────────────────────────────────────────────────────────
function strEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function strRenderTable() {
  document.getElementById("strBody").innerHTML = strResults
    .map(
      (r, i) =>
        '<tr style="cursor:pointer;' + (i === strSel ? "background:var(--bg3, rgba(128,128,128,.25))" : "") + '" onclick="strSelect(' + i + ')"><td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + strEsc(r.name) + '">' +
        strEsc(r.name) + (r.source === "table" ? ' <span style="color:var(--txt3);font-size:10px" title="Built from a Temporal Analysis table">&#9638;</span>' : "") +
        "</td><td>" + (r.dom ? r.dom.f0.toFixed(1) : "–") + "</td><td>" + r.pulses.length + "</td><td>" + r.echemes.length +
        '</td><td><span title="Remove from the list" style="cursor:pointer;color:var(--txt2)" onclick="event.stopPropagation(); strRemove(' + i + ')">&#10005;</span></td></tr>',
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
  const fp = strFingerprint(r);
  strDrawFpChart(cv, fp);
  if (!fp) {
    note.textContent = "Needs at least 2 pulses.";
    return;
  }
  note.textContent =
    Object.keys(fp).length + " numbers. Rate " + (fp.pulse_rate_pps ?? "–") + " pulses/s, duty cycle " + (fp.duty_cycle_pct ?? "–") +
    " %, " + (fp.pulses_per_echeme ?? "–") + " pulses/echeme, echeme period " + (fp.echeme_period_ms ?? "–") + " ms. " +
    "Exported in the STR_fingerprint sheet, which Summarize reads as the STR table.";
}
// The four block charts of a fingerprint. With `spread` ({key: [q1, q3]}) a
// whisker marks the quartiles of each bar (the representative fingerprint);
// `other` is a second fingerprint drawn as pink outlined bars, to compare.
function strDrawFpChart(cv, fp, spread, other) {
  const dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  if (!fp) return;
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
    const ph = h - T - B,
      Y = (val) => h - B - Math.min(1, Math.max(0, val / max)) * ph;
    ks.forEach((k, i) => {
      const v = fp[k] === null ? 0 : fp[k];
      g.fillStyle = accent;
      g.fillRect(x + i * bw + 1, Y(v), Math.max(1, bw - 2), h - B - Y(v));
      const s = spread && spread[k];
      if (s) {
        const cx = x + i * bw + bw / 2;
        g.strokeStyle = ink;
        g.beginPath();
        g.moveTo(cx, Y(s[0]));
        g.lineTo(cx, Y(s[1]));
        g.moveTo(cx - Math.min(3, bw / 3), Y(s[0]));
        g.lineTo(cx + Math.min(3, bw / 3), Y(s[0]));
        g.moveTo(cx - Math.min(3, bw / 3), Y(s[1]));
        g.lineTo(cx + Math.min(3, bw / 3), Y(s[1]));
        g.stroke();
      }
      if (other && other[k] !== null && other[k] !== undefined) {
        g.strokeStyle = "#e8589c";
        g.lineWidth = 1.5;
        g.strokeRect(x + i * bw + 1.5, Y(other[k]), Math.max(1, bw - 3), h - B - Y(other[k]));
        g.lineWidth = 1;
      }
    });
    x += bw * ks.length + gap;
  });
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
  const { reps, repFps } = strRepRows();
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_STR_" + stamp + ".xlsx",
      // STR_pulses, not Pulses: Summarize would otherwise take these rows for
      // a Temporal Analysis pulse table.
      _buildXlsx([["STR_fingerprint", prints], ["STR_representative", reps], ["STR_rep_fingerprint", repFps], ["STR_summary", summary], ["STR_pulses", pulses], ["STR_vectors", vectors], ["Info", strInfoRows()]].filter(([, rows]) => rows.length)),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
  } catch (e) {
    log("STR export failed: " + e.message, "err");
  }
}
// The representative alone: both species-level sheets and the parameters.
async function strRepExportXlsx() {
  const all = strRepsAll();
  if (!all.length) return;
  const { reps, repFps } = strRepRows();
  // Named after the species it holds, so files can be told apart without
  // opening them; past three names the rest are counted, not listed.
  const species = [...new Set(all.map((x) => x.species))],
    named =
      species.slice(0, 3).join("_") + (species.length > 3 ? "_and_" + (species.length - 3) + "_more" : ""),
    safe = named.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 120);
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_STR_representative_" + (safe ? safe + "_" : "") + stamp + ".xlsx",
      _buildXlsx([["STR_representative", reps], ["STR_rep_fingerprint", repFps], ["Info", strInfoRows()]].filter(([, rows]) => rows.length)),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
  } catch (e) {
    log("Representative export failed: " + e.message, "err");
  }
}
// The shown species' two plots stacked into one PNG, with a caption, on the
// page's own background so it reads the same as on screen.
async function strRepSavePng() {
  const all = strRepsAll(),
    rep = all[+document.getElementById("strRepSp").value],
    cmpI = +document.getElementById("strRepCmp").value,
    cmp = cmpI >= 0 && all[cmpI] !== rep ? all[cmpI] : null;
  if (!rep) return;
  strDrawRep();
  const a = document.getElementById("strRepCanvas"),
    b = document.getElementById("strRepFp"),
    dpr = window.devicePixelRatio || 1,
    head = Math.round(44 * dpr),
    gap = Math.round(12 * dpr),
    out = document.createElement("canvas");
  out.width = Math.max(a.width, b.width);
  out.height = head + a.height + gap + b.height;
  const g = out.getContext("2d"),
    css = getComputedStyle(document.body);
  g.fillStyle = css.getPropertyValue("--bg2").trim() || css.backgroundColor || "#161b22";
  g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = css.getPropertyValue("--txt3").trim() || "#ddd";
  g.font = "bold " + Math.round(13 * dpr) + "px sans-serif";
  g.fillText("Representative STR: " + rep.species + (cmp ? "   vs   " + cmp.species + " (pink)" : ""), 8 * dpr, 18 * dpr);
  g.fillStyle = css.getPropertyValue("--txt2").trim() || "#999";
  g.font = Math.round(11 * dpr) + "px sans-serif";
  const r0 = (x) => (x === null || x === undefined ? "–" : Math.round(x * 10) / 10);
  g.fillText(
    rep.nUnits + " " + rep.unit + "s, " + rep.nRec + " recording(s); x = proportion of the " + rep.unit +
      "; median " + rep.unit + " " + r0(rep.med) + " ms (quartiles " + r0(rep.q1) + "–" + r0(rep.q3) + ")" +
      (rep.tMin !== null && rep.tMin !== undefined ? "; " + rep.tMin + (rep.tMax !== rep.tMin ? "–" + rep.tMax : "") + " °C" : ""),
    8 * dpr,
    36 * dpr,
  );
  g.drawImage(a, 0, head);
  g.drawImage(b, 0, head + a.height + gap);
  const blob = await new Promise((res) => out.toBlob(res, "image/png"));
  const safe = (rep.species + (cmp ? "_vs_" + cmp.species : "")).replace(/[^\w.-]+/g, "_");
  try {
    await dlFile("Rthoptera_STR_representative_" + safe + ".png", new Uint8Array(await blob.arrayBuffer()), "image/png", { exactName: true });
  } catch (e) {
    log("PNG export failed: " + e.message, "err");
  }
}
function strRepRows() {
  // One row per species, fixed length: tempo, the consensus bars, then the
  // occupancy and amplitude of every bin (proportions of the unit).
  const pad3 = (k) => String(k + 1).padStart(3, "0"),
    r4 = (x) => Math.round(x * 1e4) / 1e4;
  // Built and loaded representatives alike; a loaded one with no barcode
  // contributes only its fingerprint row.
  const all = strRepsAll(),
    rn = (x) => (x === null || x === undefined ? "" : r4(x));
  const reps = all.filter((rep) => rep.occ && rep.occ.length).map((rep) => {
    const row = {
      species: rep.species,
      from_file: rep.fromFile || "",
      unit: rep.unit,
      n_recordings: rep.nRec,
      n_units: rep.nUnits,
      tempo_median_ms: rn(rep.med),
      tempo_q1_ms: rn(rep.q1),
      tempo_q3_ms: rn(rep.q3),
      temp_min_c: rep.tMin ?? "",
      temp_max_c: rep.tMax ?? "",
      consensus_bars: strRepBars(rep).map(([a, b, amp]) => r4(a) + "-" + r4(b) + ":" + r4(amp)).join(";"),
      note: rep.why || "",
    };
    rep.occ.forEach((v, k) => (row["occ_" + pad3(k)] = r4(v)));
    rep.amp.forEach((v, k) => (row["amp_" + pad3(k)] = r4(v)));
    return row;
  });
  // Representative fingerprint: medians under the same column names as the
  // per-recording STR_fingerprint sheet (so the two line up), then quartiles.
  const repFps = all
    .filter((rep) => rep.fp)
    .map((rep) => {
      const row = { species: rep.species, n_recordings: rep.nFp, temp_min_c: rep.tMin ?? "", temp_max_c: rep.tMax ?? "" };
      Object.keys(rep.fp).forEach((k) => (row[k] = rep.fp[k]));
      Object.keys(rep.fp).forEach((k) => {
        row[k + "_q1"] = rep.fpQ[k] ? rep.fpQ[k][0] : null;
        row[k + "_q3"] = rep.fpQ[k] ? rep.fpQ[k][1] : null;
      });
      return row;
    });
  return { reps, repFps };
}
function strInfoRows() {
  const P = strParams();
  return [
    {
      ...P,
      echeme_gap_ms: parseFloat(document.getElementById("strEGap").value) || 100,
      normalised_per: document.getElementById("strNorm").value,
      vector_layout: "dominant_khz;duration_ms;amplitude_norm;gap_ms;duration_ms;amplitude_norm;gap_ms;...;duration_ms;amplitude_norm",
      representative_normalised_by: document.getElementById("strRepBy").value,
      representative_layout:
        "per species: tempo = unit length in ms (median, quartiles); consensus_bars = start-end:amplitude as proportions of the unit, where at least half the renditions have sound; occ_001-100 = share of renditions with sound in each 1% of the unit; amp_001-100 = their mean amplitude (each unit scaled to its loudest pulse)",
      fingerprint_version: 1,
      fingerprint_layout:
        "scalars; pdur_* = share of pulses per duration bin (8, log 0.5-500 ms); ioi_* = share of onset-to-onset intervals per bin (12, log 1-2000 ms); amp_p01-16 = mean amplitude along the echeme (each scaled to its loudest pulse); dur_p01-08 = pulse duration along the echeme / echeme mean",
      generated: new Date().toISOString(),
    },
  ];
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", strInit);
else strInit();
