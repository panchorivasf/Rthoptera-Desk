// Microphone correction for the FFT filter: load a microphone's frequency
// response (a text/CSV table of frequency and level in dB), invert it, and put
// the result into the editor as an ordinary gain curve. From there it is edited
// and applied like any other FFT filter. Loaded after fft_filter.js.
//
// The curve is cleaned up on the way in, because a raw manufacturer table is
// not something to apply as it stands:
//   - smoothed over a fraction of an octave, so a narrow notch or resonance in
//     the table is not "corrected" into ringing;
//   - clamped to a maximum boost and cut, because boosting where the
//     microphone barely responds only raises the noise there;
//   - simplified to a handful of points, so it can be edited by hand.

EQ.mic = null; // {name, f: Float64Array (Hz), g: Float64Array (dB), unit}

function eqMicStatus(msg, isErr) {
  const el = eqEl("eqMicStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "#f85149" : "var(--txt3)";
}

// Parse a two-column table. Accepts comma, semicolon, tab or space separated
// text, decimal points or commas (when the separator is not a comma), and
// ignores header lines and extra columns.
function eqMicParse(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#*"']/.test(line)) continue;
    let parts;
    if (/[;\t]/.test(line)) parts = line.split(/[;\t]+/).map((s) => s.trim().replace(",", "."));
    else if (/,/.test(line) && !/\s/.test(line.replace(/,\s*/g, ""))) parts = line.split(",");
    else parts = line.split(/[\s,]+/);
    const f = parseFloat(parts[0]),
      g = parseFloat(parts[1]);
    if (isFinite(f) && isFinite(g) && f >= 0) rows.push([f, g]);
  }
  if (rows.length < 3) throw new Error("need at least 3 lines of 'frequency, level (dB)'");
  rows.sort((a, b) => a[0] - b[0]);
  // One value per frequency (average duplicates).
  const f = [],
    g = [],
    n = [];
  for (const [ff, gg] of rows) {
    if (f.length && Math.abs(ff - f[f.length - 1]) < 1e-9) {
      g[g.length - 1] += gg;
      n[n.length - 1]++;
    } else {
      f.push(ff);
      g.push(gg);
      n.push(1);
    }
  }
  return { f: Float64Array.from(f), g: Float64Array.from(g.map((v, i) => v / n[i])) };
}

// Ramer–Douglas–Peucker on (f, dB): keep the points that straight lines
// between the kept ones (what the gain curve draws) deviate from by > tol dB.
function eqMicSimplify(f, g, tol) {
  const keep = new Uint8Array(f.length);
  keep[0] = keep[f.length - 1] = 1;
  const stack = [[0, f.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1,
      wd = tol;
    for (let i = a + 1; i < b; i++) {
      const t = (f[i] - f[a]) / (f[b] - f[a] || 1);
      const d = Math.abs(g[i] - (g[a] + (g[b] - g[a]) * t));
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = [];
  for (let i = 0; i < f.length; i++) if (keep[i]) out.push({ f: f[i], g: g[i] });
  return out;
}

// Build the correction from the loaded response with the current settings.
// Returns {pts, resp}: the gain points, and the (smoothed) microphone response
// relative to its reference level, for drawing.
function eqMicBuild() {
  const m = EQ.mic;
  const maxBoost = Math.max(0, parseFloat(eqEl("eqMicBoost").value) || 0);
  const maxCut = Math.max(0, parseFloat(eqEl("eqMicCut").value) || 0);
  const smoothOct = parseFloat(eqEl("eqMicSmooth").value) || 0;
  const tol = Math.max(0.05, parseFloat(eqEl("eqMicTol").value) || 0.5);
  const refK = parseFloat(eqEl("eqMicRef").value);

  // Resample onto a log-frequency grid (48 per octave) over the stretch the
  // table covers within this file's range, so smoothing is the same fraction
  // of an octave everywhere.
  const fLo = Math.max(m.f[0], 10),
    fHi = Math.min(m.f[m.f.length - 1], EQ.nyq);
  if (!(fHi > fLo * 1.05)) throw new Error("the curve does not reach into this file's frequency range");
  const PER = 48;
  const N = Math.max(8, Math.ceil(Math.log2(fHi / fLo) * PER) + 1);
  const gf = new Float64Array(N),
    gr = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const f = Math.min(fHi, fLo * Math.pow(2, i / PER));
    gf[i] = f;
    while (j < m.f.length - 2 && m.f[j + 1] < f) j++;
    const t = (f - m.f[j]) / (m.f[j + 1] - m.f[j] || 1);
    gr[i] = m.g[j] + (m.g[j + 1] - m.g[j]) * Math.max(0, Math.min(1, t));
  }
  // Moving average over ±smoothOct/2 octaves.
  const half = Math.round((smoothOct * PER) / 2);
  let sm = gr;
  if (half > 0) {
    sm = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0,
        c = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(N - 1, i + half); k++) {
        s += gr[k];
        c++;
      }
      sm[i] = s / c;
    }
  }
  // Reference level: the response at the chosen frequency, else the median.
  let ref;
  if (isFinite(refK) && refK > 0) {
    const f = refK * 1000;
    let k = 0;
    while (k < N - 1 && gf[k] < f) k++;
    ref = sm[k];
  } else {
    const s = Array.from(sm).sort((a, b) => a - b);
    ref = s[s.length >> 1];
  }
  const resp = new Float64Array(N),
    cor = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    resp[i] = sm[i] - ref;
    cor[i] = Math.max(-maxCut, Math.min(maxBoost, -resp[i]));
  }
  return {
    pts: eqMicSimplify(gf, cor, tol),
    resp: { f: gf, g: resp },
    ref,
    clipped: cor.reduce((n, v, i) => n + (Math.abs(v + resp[i]) > 1e-9 ? 1 : 0), 0) / N,
  };
}

function eqMicUse(confirmReplace) {
  if (!EQ.mic) {
    eqMicStatus("Import a response curve first.", true);
    return;
  }
  let b;
  try {
    b = eqMicBuild();
  } catch (e) {
    eqMicStatus("Could not build the correction: " + e.message, true);
    return;
  }
  if (confirmReplace && EQ.pts.length && !confirm("Replace the points in the editor with the microphone correction?"))
    return;
  EQ.pts = b.pts.map((p) => ({ f: +p.f.toFixed(2), g: +p.g.toFixed(2) }));
  EQ.sel = null;
  EQ.smooth = false;
  eqEl("eqSmooth").checked = false;
  // Show the whole gain range the correction uses.
  const need = Math.max(0, ...EQ.pts.map((p) => Math.abs(p.g)));
  let r = EQ.range;
  while (r < need && r < 96) r = EQ_RANGES[EQ_RANGES.indexOf(r) + 1];
  EQ.range = r;
  eqEl("eqRange").value = String(r);
  EQ.micDraw = b.resp;
  eqSyncInputs();
  eqDraw();
  eqMicStatus(
    '"' + EQ.mic.name + '": ' + EQ.pts.length + " point(s), " + b.ref.toFixed(1) + " dB reference" +
      (b.clipped > 0.005 ? ", " + Math.round(b.clipped * 100) + "% of the range limited by max boost/cut" : "") +
      (EQ.mic.f[EQ.mic.f.length - 1] < EQ.nyq * 0.98
        ? ". The curve ends at " + eqFmtHz(EQ.mic.f[EQ.mic.f.length - 1]) + "; the last value is held above it."
        : "") +
      ". Press Apply filter to use it.",
  );
}

async function eqMicImportFile(file) {
  if (!file) return;
  try {
    const parsed = eqMicParse(await file.text());
    // Frequencies in kHz or Hz? Decide from the table unless told.
    let unit = eqEl("eqMicUnit").value;
    const fmax = parsed.f[parsed.f.length - 1];
    if (unit === "auto") unit = fmax < 300 ? "khz" : "hz";
    if (unit === "khz") for (let i = 0; i < parsed.f.length; i++) parsed.f[i] *= 1000;
    EQ.mic = {
      name: file.name.replace(/\.[^.]+$/, ""),
      f: parsed.f,
      g: parsed.g,
    };
    eqMicUse(true);
    // Let the editor show the full range of the curve.
    eqSetView(0, EQ.nyq);
  } catch (e) {
    eqMicStatus("Could not read the curve: " + e.message, true);
  }
}

function eqMicClear() {
  EQ.mic = null;
  EQ.micDraw = null;
  eqMicStatus("");
  eqDraw();
}
