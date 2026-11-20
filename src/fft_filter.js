// FFT filter (Preprocessing ▸ FFT filter…): a graphical equaliser drawn on the
// recording's own power spectrum. Click the spectrum to add a point, drag it up
// or down to boost or cut that part of the spectrum, drag sideways to move it,
// right-click or double-click to remove it. The wheel zooms the frequency axis.
//
// The edit lives in the audio edit chain as
//   {type: "eqfft", pts: [{f, g}], smooth, size, region}
// f in Hz, g in dB; `region` ({t0, t1} seconds) limits it to a stretch of the
// recording, or is null for the whole file. rebuildAudioFromEdits() calls
// applyFftFilterCached() for it, after the frequency drop and before Normalize,
// noise padding and fades, so the curve is drawn against the same frequencies
// the spectrum shows.

// ── DSP ──────────────────────────────────────────────────────────────────
// Gain in dB at frequency f: straight lines between the points, or a cosine
// ease (flat at every point) when `smooth`. Flat beyond the first/last point.
function eqGainDb(pts, f, smooth) {
  const n = pts.length;
  if (!n) return 0;
  if (f <= pts[0].f) return pts[0].g;
  if (f >= pts[n - 1].f) return pts[n - 1].g;
  let i = 1;
  while (pts[i].f < f) i++;
  const a = pts[i - 1],
    b = pts[i];
  let t = (f - a.f) / (b.f - a.f || 1);
  if (smooth) t = (1 - Math.cos(Math.PI * t)) / 2;
  return a.g + (b.g - a.g) * t;
}

// Zero-phase spectral filter: sine-windowed frames at 50% overlap (the squared
// window sums to 1), each multiplied by the gain curve and windowed again on
// the way out. Returns a NEW Float32Array.
function fftFilterSignal(x, sr, pts, smooth, N) {
  const n = x.length,
    hop = N >> 1,
    half = N >> 1;
  const G = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++)
    G[k] = Math.pow(10, eqGainDb(pts, (k * sr) / N, smooth) / 20);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / N);
  const out = new Float32Array(n);
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let s = -hop; s < n; s += hop) {
    for (let i = 0; i < N; i++) {
      const idx = s + i;
      re[i] = idx >= 0 && idx < n ? x[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, N);
    for (let k = 0; k <= half; k++) {
      const g = G[k];
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < half) {
        re[N - k] *= g;
        im[N - k] *= g;
      }
    }
    _ifft(re, im, N);
    for (let i = 0; i < N; i++) {
      const idx = s + i;
      if (idx >= 0 && idx < n) out[idx] += re[i] * win[i];
    }
  }
  return out;
}

function applyFftFilter(sig, sr, ed) {
  const pts = ed.pts;
  if (!pts || !pts.length) return sig;
  const N = ed.size || 16384;
  if (!ed.region)
    return fftFilterSignal(sig, sr, pts, ed.smooth, N);
  // Selection only: filter a stretch with room to spare, then blend it back
  // into the untouched audio with 5 ms ramps at its edges.
  const n = sig.length;
  const i0 = Math.max(0, Math.round(ed.region.t0 * sr)),
    i1 = Math.min(n, Math.round(ed.region.t1 * sr));
  if (i1 <= i0) return sig;
  const a = Math.max(0, i0 - N),
    b = Math.min(n, i1 + N);
  const seg = fftFilterSignal(sig.subarray(a, b), sr, pts, ed.smooth, N);
  const out = Float32Array.from(sig);
  const ramp = Math.max(1, Math.min(Math.round(0.005 * sr), (i1 - i0) >> 1));
  for (let i = i0; i < i1; i++) {
    let w = 1;
    if (i - i0 < ramp) w = (i - i0 + 0.5) / ramp;
    if (i1 - 1 - i < ramp) w = Math.min(w, (i1 - i - 0.5) / ramp);
    out[i] = sig[i] * (1 - w) + seg[i - a] * w;
  }
  return out;
}

// Rebuilds happen on every edit; the filter is slow on long files, so reuse
// the result while its input and settings are unchanged.
let _eqCache = null;
function applyFftFilterCached(sig, sr, ed) {
  const key =
    sr +
    "|" +
    sig.length +
    "|" +
    JSON.stringify(ed) +
    "|" +
    JSON.stringify(audioEdits.filter((e) => e.type !== "eqfft"));
  if (_eqCache && _eqCache.src === origSamples && _eqCache.key === key)
    return _eqCache.out;
  const out = applyFftFilter(sig, sr, ed);
  _eqCache = { src: origSamples, key, out };
  return out;
}

// Welch power spectrum in dB (full-scale sine ≈ 0 dB) of x[i0, i1).
function eqComputeSpectrum(x, sr, i0, i1, N) {
  const len = Math.max(1, i1 - i0),
    half = N >> 1;
  const win = new Float64Array(N);
  let wsum = 0;
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    wsum += win[i];
  }
  let step = N >> 1,
    frames = 1;
  if (len > N) {
    frames = Math.floor((len - N) / step) + 1;
    if (frames > 400) {
      frames = 400;
      step = Math.floor((len - N) / (frames - 1));
    }
  }
  const acc = new Float64Array(half + 1);
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const s = i0 + f * step;
    for (let i = 0; i < N; i++) {
      const idx = s + i;
      re[i] = idx < i1 && idx < x.length ? x[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im, N);
    for (let k = 0; k <= half; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const db = new Float32Array(half + 1);
  const norm = (4 / (wsum * wsum)) / frames;
  for (let k = 0; k <= half; k++)
    db[k] = 10 * Math.log10(acc[k] * norm + 1e-20);
  return { db, N, sr, df: sr / N };
}

// ── Editor ───────────────────────────────────────────────────────────────
const EQ = {
  pts: [],
  sel: null, // the selected point object
  f0: 0,
  f1: 1,
  nyq: 1,
  sr: 1,
  range: 24, // gain axis shows ±range dB
  dyn: 90, // spectrum axis span in dB
  size: 16384,
  smooth: false,
  spec: null,
  specLabel: "",
  base: null, // the applied (whole-file) filter, taken out of the display
  drag: null,
  hover: null,
  open: false,
};
const EQ_PAD = { l: 54, r: 46, t: 10, b: 26 };

const eqEl = (id) => document.getElementById(id);

function eqFmtHz(f) {
  return f >= 1000
    ? (Math.round(f) / 1000).toFixed(f >= 10000 ? 2 : 3).replace(/\.?0+$/, "") + " kHz"
    : Math.round(f) + " Hz";
}

function openFftFilter() {
  if (!origSamples || !rawSamples) {
    log("Load audio first", "warn");
    return;
  }
  if (typeof trimMode !== "undefined" && trimMode) {
    ppWarn("Confirm or cancel the trim first (Trim mode is open).");
    return;
  }
  const ex = audioEdits.find((e) => e.type === "eqfft");
  EQ.sr = sampleRate;
  EQ.nyq = sampleRate / 2;
  EQ.f0 = 0;
  EQ.f1 = EQ.nyq;
  EQ.pts = ex ? ex.pts.map((p) => ({ ...p })) : [];
  EQ.smooth = ex ? !!ex.smooth : false;
  EQ.size = ex ? ex.size || 16384 : 16384;
  EQ.sel = null;
  EQ.base = ex && !ex.region ? ex : null;
  eqEl("eqSmooth").checked = EQ.smooth;
  eqEl("eqSize").value = String(EQ.size);
  eqEl("eqSpecScope").value = ppSel && ppSel.t1 > ppSel.t0 ? "sel" : "file";
  eqEl("eqApplyScope").value = ex && ex.region ? "sel" : "file";
  eqEl("eqNote").textContent = ex && ex.region
    ? "The spectrum includes the filter now applied to a selection."
    : "";
  EQ.open = true;
  eqEl("fftFilterOverlay").classList.add("show");
  eqSyncRange();
  eqRefreshSpectrum();
  // Size the canvas once the overlay is laid out.
  requestAnimationFrame(() => {
    eqDraw();
    eqSyncInputs();
  });
}

function closeFftFilter() {
  EQ.open = false;
  EQ.drag = null;
  eqEl("fftFilterOverlay").classList.remove("show");
}

function eqRefreshSpectrum() {
  if (!rawSamples) return;
  let i0 = 0,
    i1 = rawSamples.length;
  EQ.specLabel = "whole file";
  if (eqEl("eqSpecScope").value === "sel" && ppSel && ppSel.t1 > ppSel.t0) {
    i0 = Math.max(0, Math.floor(ppSel.t0 * sampleRate));
    i1 = Math.min(rawSamples.length, Math.ceil(ppSel.t1 * sampleRate));
    EQ.specLabel = "selection " + ppSel.t0.toFixed(2) + "–" + ppSel.t1.toFixed(2) + " s";
  } else eqEl("eqSpecScope").value = "file";
  const N = Math.min(16384, Math.max(2048, EQ.size));
  EQ.spec = eqComputeSpectrum(rawSamples, sampleRate, i0, i1, N);
  eqDraw();
}

function eqSyncRange() {
  eqEl("eqFrom").value = (EQ.f0 / 1000).toFixed(3);
  eqEl("eqTo").value = (EQ.f1 / 1000).toFixed(3);
}

function eqSyncInputs() {
  const s = EQ.sel;
  eqEl("eqPtF").value = s ? s.f.toFixed(1) : "";
  eqEl("eqPtG").value = s ? s.g.toFixed(1) : "";
  eqEl("eqPtF").disabled = eqEl("eqPtG").disabled = !s;
  eqEl("eqPtDel").disabled = !s;
  eqEl("eqCount").textContent = EQ.pts.length
    ? EQ.pts.length + " point" + (EQ.pts.length > 1 ? "s" : "")
    : "no points";
}

// Geometry ---------------------------------------------------------------
function eqGeom() {
  const c = eqEl("eqCanvas");
  const W = c.clientWidth,
    H = c.clientHeight;
  return {
    c,
    W,
    H,
    pw: Math.max(10, W - EQ_PAD.l - EQ_PAD.r),
    ph: Math.max(10, H - EQ_PAD.t - EQ_PAD.b),
  };
}
const eqX = (f, g) => EQ_PAD.l + ((f - EQ.f0) / (EQ.f1 - EQ.f0)) * g.pw;
const eqF = (x, g) => EQ.f0 + ((x - EQ_PAD.l) / g.pw) * (EQ.f1 - EQ.f0);
const eqYg = (db, g) => EQ_PAD.t + g.ph * (1 - (db + EQ.range) / (2 * EQ.range));
const eqGfromY = (y, g) =>
  (1 - (y - EQ_PAD.t) / g.ph) * 2 * EQ.range - EQ.range;

function eqNiceStep(span, target) {
  const raw = span / target,
    mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * mag;
}

// Spectrum value (dB) at frequency f, with the applied filter taken out.
function eqSpecAt(f) {
  const sp = EQ.spec;
  if (!sp) return -200;
  const k = Math.max(0, Math.min(sp.db.length - 1, Math.round(f / sp.df)));
  let v = sp.db[k];
  if (EQ.base) v -= eqGainDb(EQ.base.pts, f, EQ.base.smooth);
  return v;
}

function eqDraw() {
  if (!EQ.open) return;
  const g = eqGeom();
  const c = g.c,
    dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(g.W * dpr) || c.height !== Math.round(g.H * dpr)) {
    c.width = Math.round(g.W * dpr);
    c.height = Math.round(g.H * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  const txt2 = col("--txt2", "#9aa"),
    border = col("--border", "#334"),
    bg = col("--bg3", "#111");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, g.W, g.H);
  ctx.font = "10px sans-serif";

  const x0 = EQ_PAD.l,
    x1 = EQ_PAD.l + g.pw,
    y0 = EQ_PAD.t,
    y1 = EQ_PAD.t + g.ph;

  // Spectrum level axis: top = loudest point of the WHOLE spectrum, rounded
  // up. It must not follow the zoom: the gain axis is fixed, so an axis that
  // rescaled to whatever is in view would slide the 0 dB gain line against
  // the level scale every time the frequency range changed.
  let top = -20;
  const sp = EQ.spec;
  if (sp) {
    let mx = -200;
    for (let k = 0; k < sp.db.length; k++) {
      const v = eqSpecAt(k * sp.df);
      if (v > mx) mx = v;
    }
    top = Math.ceil((mx + 4) / 10) * 10;
  }
  const bottom = top - EQ.dyn;
  const yS = (db) => y0 + g.ph * (1 - (db - bottom) / (top - bottom));

  // Grid + frequency axis
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  const fs = eqNiceStep(EQ.f1 - EQ.f0, Math.max(4, g.pw / 90));
  for (let f = Math.ceil(EQ.f0 / fs) * fs; f <= EQ.f1 + 1e-9; f += fs) {
    const x = Math.round(eqX(f, g)) + 0.5;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillStyle = txt2;
    ctx.fillText(eqFmtHz(f), x, y1 + 14);
  }
  ctx.textAlign = "right";
  for (let db = Math.ceil(bottom / 10) * 10; db <= top; db += 10) {
    const y = Math.round(yS(db)) + 0.5;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillStyle = txt2;
    ctx.fillText(db + " dB", x0 - 4, y + 3);
  }
  ctx.strokeStyle = col("--border2", "#556");
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, g.pw, g.ph);

  // Spectrum (peak per pixel column) and the predicted result
  if (sp) {
    const peak = (px) => {
      const fa = eqF(px, g),
        fb = eqF(px + 1, g);
      const ka = Math.max(0, Math.floor(fa / sp.df)),
        kb = Math.min(sp.db.length - 1, Math.max(ka, Math.ceil(fb / sp.df)));
      let m = -200;
      for (let k = ka; k <= kb; k++) {
        const v = eqSpecAt(k * sp.df);
        if (v > m) m = v;
      }
      return { m, f: (fa + fb) / 2 };
    };
    const cols = [];
    for (let px = x0; px < x1; px++) cols.push(peak(px));
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    cols.forEach((p, i) => ctx.lineTo(x0 + i, Math.min(y1, Math.max(y0, yS(p.m)))));
    ctx.lineTo(x1 - 1, y1);
    ctx.closePath();
    ctx.fillStyle = "rgba(86,180,233,0.28)";
    ctx.fill();
    ctx.beginPath();
    cols.forEach((p, i) => {
      const y = Math.min(y1, Math.max(y0, yS(p.m)));
      if (i) ctx.lineTo(x0 + i, y);
      else ctx.moveTo(x0, y);
    });
    ctx.strokeStyle = "#56B4E9";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (EQ.pts.length) {
      ctx.beginPath();
      cols.forEach((p, i) => {
        const y = Math.min(y1, Math.max(y0, yS(p.m + eqGainDb(EQ.pts, p.f, EQ.smooth))));
        if (i) ctx.lineTo(x0 + i, y);
        else ctx.moveTo(x0, y);
      });
      ctx.strokeStyle = "#009E73";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Gain axis (right) with its 0 dB line
  ctx.textAlign = "left";
  ctx.fillStyle = "#E69F00";
  const gs = EQ.range / 4;
  for (let v = -EQ.range; v <= EQ.range + 1e-9; v += gs) {
    const y = eqYg(v, g);
    ctx.fillText((v > 0 ? "+" : "") + +v.toFixed(1), x1 + 5, y + 3);
  }
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(230,159,0,0.6)";
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(eqYg(0, g)) + 0.5);
  ctx.lineTo(x1, Math.round(eqYg(0, g)) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Gain curve and its points
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, g.pw, g.ph);
  ctx.clip();
  // The loaded microphone response (on the gain axis, relative to its
  // reference level), so the correction can be checked against it.
  if (EQ.micDraw) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < EQ.micDraw.f.length; i++) {
      const x = eqX(EQ.micDraw.f[i], g),
        y = eqYg(EQ.micDraw.g[i], g);
      if (x < x0 - 5 || x > x1 + 5) continue;
      if (started) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      started = true;
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#CC79A7";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  for (let px = x0; px <= x1; px++) {
    const y = eqYg(eqGainDb(EQ.pts, eqF(px, g), EQ.smooth), g);
    if (px === x0) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.strokeStyle = "#E69F00";
  ctx.lineWidth = 2;
  ctx.stroke();
  EQ.pts.forEach((p) => {
    const x = eqX(p.f, g),
      y = eqYg(p.g, g);
    ctx.beginPath();
    ctx.arc(x, y, p === EQ.sel ? 6 : 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = p === EQ.sel ? "#E69F00" : bg;
    ctx.fill();
    ctx.strokeStyle = "#E69F00";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  ctx.restore();

  // Legend + cursor readout
  ctx.textAlign = "left";
  ctx.fillStyle = "#56B4E9";
  ctx.fillText("Spectrum (" + EQ.specLabel + ")", x0 + 6, y0 + 12);
  if (EQ.pts.length) {
    ctx.fillStyle = "#009E73";
    ctx.fillText("After filter", x0 + 6, y0 + 24);
  }
  let ly = y0 + (EQ.pts.length ? 36 : 24);
  ctx.fillStyle = "#E69F00";
  ctx.fillText("Gain (right axis)", x0 + 6, ly);
  if (EQ.micDraw) {
    ctx.fillStyle = "#CC79A7";
    ctx.fillText("Microphone response (right axis)", x0 + 6, ly + 12);
  }
  if (EQ.hover) {
    const f = EQ.hover.f;
    eqEl("eqReadout").textContent =
      eqFmtHz(f) +
      "   spectrum " +
      eqSpecAt(f).toFixed(1) +
      " dB   gain " +
      eqGainDb(EQ.pts, f, EQ.smooth).toFixed(1) +
      " dB";
  }
}

// Points ------------------------------------------------------------------
function eqSortPts() {
  EQ.pts.sort((a, b) => a.f - b.f);
}
function eqHit(px, py, g) {
  let best = null,
    bd = 10;
  EQ.pts.forEach((p) => {
    const d = Math.hypot(eqX(p.f, g) - px, eqYg(p.g, g) - py);
    if (d < bd) {
      bd = d;
      best = p;
    }
  });
  return best;
}
function eqClampG(v) {
  return Math.max(-EQ.range, Math.min(EQ.range, v));
}
function eqDeletePoint(p) {
  if (!p) return;
  EQ.pts = EQ.pts.filter((q) => q !== p);
  if (EQ.sel === p) EQ.sel = null;
  eqSyncInputs();
  eqDraw();
}

// View --------------------------------------------------------------------
function eqSetView(f0, f1) {
  const minSpan = Math.max(20, EQ.nyq / 4000);
  let span = Math.max(minSpan, Math.min(EQ.nyq, f1 - f0));
  let a = Math.max(0, Math.min(EQ.nyq - span, f0));
  EQ.f0 = a;
  EQ.f1 = a + span;
  eqSyncRange();
  eqDraw();
}
function eqZoom(factor, centreF) {
  const c = centreF === undefined ? (EQ.f0 + EQ.f1) / 2 : centreF;
  const r = (c - EQ.f0) / (EQ.f1 - EQ.f0);
  const span = (EQ.f1 - EQ.f0) * factor;
  eqSetView(c - r * span, c - r * span + span);
}
function eqZoomFit() {
  eqSetView(0, EQ.nyq);
}
function eqViewFromInputs() {
  const a = parseFloat(eqEl("eqFrom").value) * 1000,
    b = parseFloat(eqEl("eqTo").value) * 1000;
  if (isFinite(a) && isFinite(b) && b > a) eqSetView(a, b);
  else eqSyncRange();
}
// Zoom onto the points' own neighbourhood: the range they occupy, with margin.
function eqZoomToPoints() {
  if (EQ.pts.length < 2) return;
  const a = EQ.pts[0].f,
    b = EQ.pts[EQ.pts.length - 1].f,
    m = (b - a) * 0.1;
  eqSetView(a - m, b + m);
}

// Controls ----------------------------------------------------------------
function eqPtInputsChanged() {
  const p = EQ.sel;
  if (!p) return;
  const f = parseFloat(eqEl("eqPtF").value),
    gdb = parseFloat(eqEl("eqPtG").value);
  if (isFinite(f)) p.f = Math.max(0, Math.min(EQ.nyq, f));
  if (isFinite(gdb)) p.g = Math.max(-96, Math.min(96, gdb));
  eqSortPts();
  eqSyncInputs();
  eqDraw();
}
function eqSettingsChanged() {
  EQ.smooth = eqEl("eqSmooth").checked;
  EQ.range = parseFloat(eqEl("eqRange").value) || 24;
  EQ.dyn = parseFloat(eqEl("eqDyn").value) || 90;
  const sz = parseInt(eqEl("eqSize").value, 10) || 16384;
  const resChanged = sz !== EQ.size;
  EQ.size = sz;
  if (resChanged) eqRefreshSpectrum();
  else eqDraw();
}
function eqClearPoints() {
  EQ.pts = [];
  EQ.sel = null;
  eqSyncInputs();
  eqDraw();
}

function eqApply() {
  if (!origSamples) return;
  if (!EQ.pts.length) {
    log("Add at least one point to the gain curve first.", "warn");
    return;
  }
  let region = null;
  if (eqEl("eqApplyScope").value === "sel") {
    const s = ppSelOnChainTimeline(false);
    if (!s) return;
    region = { t0: s.t0, t1: s.t1 };
  }
  audioEdits = audioEdits.filter((e) => e.type !== "eqfft");
  audioEdits.push({
    type: "eqfft",
    pts: EQ.pts.map((p) => ({ f: p.f, g: p.g })),
    smooth: EQ.smooth,
    size: EQ.size,
    region,
  });
  rebuildAudioFromEdits({ resetView: false });
  EQ.base = region ? null : audioEdits.find((e) => e.type === "eqfft");
  eqEl("eqNote").textContent = region
    ? "The spectrum includes the filter now applied to the selection."
    : "";
  eqRefreshSpectrum();
  log(
    "FFT filter: " + EQ.pts.length + " point(s)" +
      (region ? ", selection " + region.t0.toFixed(2) + "–" + region.t1.toFixed(2) + " s" : ", whole file") +
      ".",
    "ok",
  );
}

function clearFftFilter() {
  if (!audioHasEdit("eqfft")) return;
  audioEdits = audioEdits.filter((e) => e.type !== "eqfft");
  rebuildAudioFromEdits({ resetView: false });
  if (EQ.open) {
    EQ.base = null;
    eqEl("eqNote").textContent = "";
    eqRefreshSpectrum();
  }
  log("FFT filter removed", "ok");
}

// Pointer handling ----------------------------------------------------------
function eqInit() {
  const c = eqEl("eqCanvas");
  if (!c || c._eqInit) return;
  c._eqInit = true;
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener("pointerdown", (e) => {
    const g = eqGeom(),
      { x, y } = pos(e);
    c.setPointerCapture(e.pointerId);
    // Middle button or Ctrl+drag pans the frequency axis.
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      EQ.drag = { pan: true, x, f0: EQ.f0, f1: EQ.f1 };
      c.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }
    const hit = eqHit(x, y, g);
    if (e.button === 2) {
      if (hit) eqDeletePoint(hit);
      return;
    }
    if (e.button !== 0) return;
    if (x < EQ_PAD.l || x > EQ_PAD.l + g.pw || y < EQ_PAD.t || y > EQ_PAD.t + g.ph) {
      if (!hit) return;
    }
    let p = hit;
    if (!p) {
      p = {
        f: Math.max(0, Math.min(EQ.nyq, eqF(x, g))),
        g: eqClampG(eqGfromY(y, g)),
      };
      EQ.pts.push(p);
      eqSortPts();
    }
    EQ.sel = p;
    EQ.drag = { pt: p, f: p.f };
    eqSyncInputs();
    eqDraw();
  });
  c.addEventListener("pointermove", (e) => {
    const g = eqGeom(),
      { x, y } = pos(e);
    const d = EQ.drag;
    if (d && d.pan) {
      const df = ((x - d.x) / g.pw) * (d.f1 - d.f0);
      const span = d.f1 - d.f0;
      const a = Math.max(0, Math.min(EQ.nyq - span, d.f0 - df));
      EQ.f0 = a;
      EQ.f1 = a + span;
      eqSyncRange();
    } else if (d && d.pt) {
      // Shift keeps the frequency and moves the gain only.
      if (!e.shiftKey) d.pt.f = Math.max(0, Math.min(EQ.nyq, eqF(x, g)));
      else d.pt.f = d.f;
      d.pt.g = eqClampG(eqGfromY(y, g));
      eqSortPts();
      eqSyncInputs();
    } else {
      c.style.cursor = eqHit(x, y, g) ? "grab" : "crosshair";
    }
    EQ.hover = { f: Math.max(0, Math.min(EQ.nyq, eqF(x, g))) };
    eqDraw();
  });
  const end = (e) => {
    if (EQ.drag && EQ.drag.pan) c.style.cursor = "crosshair";
    EQ.drag = null;
    if (c.hasPointerCapture && c.hasPointerCapture(e.pointerId))
      c.releasePointerCapture(e.pointerId);
  };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("dblclick", (e) => {
    const g = eqGeom(),
      { x, y } = pos(e);
    const hit = eqHit(x, y, g);
    if (hit) eqDeletePoint(hit);
  });
  c.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const g = eqGeom(),
        { x } = pos(e);
      const f = eqF(x, g);
      if (e.shiftKey) {
        const span = EQ.f1 - EQ.f0,
          d = (e.deltaY > 0 ? 1 : -1) * span * 0.15;
        eqSetView(EQ.f0 + d, EQ.f1 + d);
      } else eqZoom(e.deltaY < 0 ? 0.8 : 1.25, f);
    },
    { passive: false },
  );
  new ResizeObserver(() => eqDraw()).observe(c);
  document.addEventListener("keydown", (e) => {
    if (!EQ.open) return;
    const tag = e.target && e.target.tagName;
    if (e.key === "Escape") {
      closeFftFilter();
      return;
    }
    if (tag === "INPUT" || tag === "SELECT") return;
    if ((e.key === "Delete" || e.key === "Backspace") && EQ.sel) {
      eqDeletePoint(EQ.sel);
      e.preventDefault();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && EQ.sel) {
      EQ.sel.g = Math.max(-96, Math.min(96, EQ.sel.g + (e.key === "ArrowUp" ? 0.5 : -0.5)));
      eqSyncInputs();
      eqDraw();
      e.preventDefault();
    }
  });
}
document.addEventListener("DOMContentLoaded", eqInit);
if (document.readyState !== "loading") eqInit();
