// ═══════════════════════════════════════════════════════════════════
// AUTO-CODED OSCILLOGRAM
//
// An implementation of Brizio (2023), "Colour Enhanced Time/Pressure
// Envelope (CETPE), a novel on-screen rendering of digital sound",
// Rivista Italiana di Acustica 48(2):63-71, doi:10.3280/ria2-2023oa16390.
//
// NOMENCLATURE: the paper's names are kept in the comments below, where they
// explain the paper, but the app's own names are what reach the screen —
//   TPE   (Time/Pressure Envelope)              → "Oscillogram"
//   TFSI  (Time/Frequency Spectrographic Image) → "Spectrogram"
//   CETPE (Colour Enhanced TPE)                 → "Auto-coded Oscillogram"
// so this pane reads like the rest of Rthoptera Desk rather than like a
// citation. Element ids still carry the short forms (ceShowTfsi, etc.).
//
// The idea: a spectrogram is a TFSI (time × frequency × pressure-as-colour).
// A CE-TPE re-projects the same three domains onto an oscillogram — time on
// the horizontal axis, pressure as the vertical span, and FREQUENCY as the
// colour. The envelope keeps an oscillogram's readability while marking, in
// colour, exactly where user-chosen frequency bands are present above a
// user-chosen threshold. It is, in the paper's words, "a TFSI under disguise".
//
// Two renderings, both from the paper:
//   • 2-colour     — one frequency range (FRB..FRT); a column is drawn in the
//                    highlight colour when any bin in that range reaches the
//                    Frequency Range Pressure Threshold (FRPT).
//   • Multicolour  — the range is split into 6, 12 or 24 uniform Frequency
//                    Window Bands, each mapped to ONE bit of the 24-bit RGB
//                    triplet ("informative palette": red = upper third of the
//                    window, green = middle, blue = lower). Every band over
//                    the FRPT raises its bit; the OR of the raised bits IS the
//                    column's colour. See §7.1 and Tables 1-3 of the paper.
//
// Departures from the paper's proof-of-concept Python demonstrator, all of
// which it explicitly asks for ("extensive redesign of this proof of concept
// is required"):
//   • a frequency RANGE (FRB..FRT, §2.3) rather than the demonstrator's single
//     interesting frequency;
//   • the FRPT in dBFS rather than raw sample values, so a threshold means the
//     same thing across bit depths and recorders (the paper offers both);
//   • FFT size and overlap under user control rather than SciPy defaults;
//   • the optional overall Pressure Range (PRB/PRT, §2.3) actually wired up.
//
// Time resolution is the spectrogram's, not the waveform's — this is inherent
// to the technique (§2.1), not a shortcut: one drawn column subsumes one hop's
// worth of samples, and the vertical span of that column is the min/max of the
// samples it subsumes (per the paper's footnote 2).
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";

  const AXIS_WIDTH = 1400;
  // The left margin has to clear the spectrogram's frequency tick labels,
  // which are right-anchored just inside it — a worst case like "112.5 kHz"
  // at 11px runs to about 55px, plus the tick and its gap.
  const PAD_L = 78;
  const PAD_R = 30;

  // The whole waveform is held in memory and transformed in one pass, so a
  // very long file is refused up front rather than freezing the UI later.
  const MAX_SAMPLES = 60_000_000;

  // Drawn columns are capped well above the on-screen width so a 2-3× PNG
  // export still resolves them; beyond this, analysis columns are merged
  // (see mergeColumns) rather than dropped, so no colour is ever lost.
  const MAX_RENDER_COLS = AXIS_WIDTH * 3;

  // Spectrogram panel raster. It is a picture, not data: it is rasterized on
  // demand for whatever time range is on screen, at this fixed size, and never
  // stored. Storing one raster for the whole recording would cost the same
  // memory and then go blocky the moment the view is zoomed in past it.
  const TFSI_W = 1600;
  const TFSI_H = 512;

  // Gain ramp applied at the start and end of every playback run. Starting or
  // stopping in the middle of a waveform is a step discontinuity, and with
  // seeking and speed changes restarting playback constantly that is an
  // audible click on every single press. 8 ms is inaudible as a fade but long
  // enough to remove the step.
  const PLAY_FADE = 0.008;

  const DB_FLOOR = -120; // silence floor for every dBFS conversion here

  let ceSamples = null; // Float32Array, mono, whole recording
  let ceRate = 1;
  let ceDur = 0;
  let ceLabel = "";
  let cePeak = 1;

  let ceAnalysis = null; // see ceAnalyze() for the shape
  let ceColors = null; // { colors[], masks, nLit } — recomputed on threshold changes alone
  let ceSvgEl = null;

  // ── Small helpers ─────────────────────────────────────────────────
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function numVal(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function toDb(amp) {
    return amp > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(amp)) : DB_FLOOR;
  }

  function fmtHzShort(hz) {
    if (hz >= 1000) return (Math.round(hz / 100) / 10).toString() + " kHz";
    return Math.round(hz) + " Hz";
  }

  // Bare seconds, with the decimal count taken from the tick step so every
  // label on the axis has the same shape. The unit lives in the axis title
  // ("Time (s)") rather than on each tick — repeating it eight times is what
  // made the old axis crowded, and a per-tick unit that switched to ms below
  // 1 s contradicted the title outright.
  function fmtTimeTick(t, step) {
    const decimals = clamp(Math.ceil(-Math.log10(step)), 0, 6);
    const v = t.toFixed(decimals);
    return v === "-" + (0).toFixed(decimals) ? (0).toFixed(decimals) : v;
  }

  function niceStep(targetSpan) {
    if (targetSpan <= 0) return 1;
    const exp = Math.floor(Math.log10(targetSpan));
    const base = Math.pow(10, exp);
    let best = base;
    for (const m of [1, 2, 5, 10]) {
      const c = m * base;
      if (c <= targetSpan) best = c;
    }
    return best;
  }

  function ceStatus(msg, isErr) {
    const el = $("ceStatus");
    if (el) {
      el.textContent = msg;
      el.style.color = isErr ? "var(--red, #f85149)" : "var(--txt3, #6e7681)";
    }
    if (typeof log === "function" && msg)
      log("Auto-coded Oscillogram: " + msg, isErr ? "err" : "");
  }

  // Export names are built from the recording so a folder of them stays
  // sortable and self-describing. dlFile's "rename to match the loaded audio"
  // intercept would collapse these to a bare "<recording>.csv" — which
  // collides with every other CSV from the same recording — so callers pass
  // exactName and use this instead.
  function ceFileStem() {
    const stem = (ceLabel || "audio").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
    return stem + "_auto_coded_oscillogram";
  }

  // ═══════════════════════════════════════════════════════════════════
  // COLOUR MAPPING  (paper §7.1, Tables 1-3)
  // ═══════════════════════════════════════════════════════════════════
  // One band, one bit. Bands are numbered from the BOTTOM of the frequency
  // window; the bands fill blue first (lower third of the window), then
  // green (middle), then red (upper) — the paper's "informative palette",
  // where reddish/greenish/bluish hues mean higher/mid/lower frequencies.
  //
  // Within each 8-bit colour byte the bands run LSB→MSB, and a reduced band
  // count uses only the MOST significant bits of each byte: 24 bands use all
  // 8 (values 1..128), 12 bands the top 4 (16..128), 6 bands the top 2
  // (64,128). Dropping the low bits is what keeps the reduced palettes
  // bright and high-contrast — the paper's stated reason for offering them.
  function bandBits(nBands) {
    const perChannel = nBands / 3; // 8, 4 or 2
    const shift = 8 - perChannel; // 0, 4 or 6
    const bits = new Uint32Array(nBands);
    for (let b = 0; b < nBands; b++) {
      const channel = Math.floor(b / perChannel); // 0=blue, 1=green, 2=red
      const bitPos = shift + (b % perChannel);
      bits[b] = 1 << (channel * 8 + bitPos);
    }
    return bits;
  }

  function maskToHex(mask) {
    return "#" + (mask >>> 0).toString(16).padStart(6, "0");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PARAMETERS
  // ═══════════════════════════════════════════════════════════════════
  function ceBandCount() {
    const mode = $("ceMode").value;
    return mode === "2col" ? 1 : parseInt(mode, 10);
  }

  // Reads FRB/FRT and validates them against the loaded recording. Returns
  // null (after complaining) rather than silently clamping, because a
  // frequency window is the whole point of the rendering — quietly analysing
  // a different band than the one asked for would be worse than refusing.
  function ceFreqRange() {
    const nyq = ceRate / 2;
    const frb = numVal("ceFrb", 0);
    const frt = numVal("ceFrt", nyq);
    if (frb < 0 || frt <= frb) {
      ceStatus("Frequency Range Top must be above Frequency Range Bottom.", true);
      return null;
    }
    if (frb >= nyq) {
      ceStatus(
        `Frequency Range Bottom (${fmtHzShort(frb)}) is at or above the Nyquist ` +
          `frequency (${fmtHzShort(nyq)}) — nothing to analyse.`,
        true,
      );
      return null;
    }
    // A top above Nyquist is clamped rather than refused: asking for "up to
    // 100 kHz" on a 48 kHz recording is a reasonable thing to type, and the
    // clamp is reported so the band edges on the legend are never a surprise.
    let clamped = false;
    let top = frt;
    if (top > nyq) {
      top = nyq;
      clamped = true;
    }
    return { frb, frt: top, clamped, nyq };
  }

  // ═══════════════════════════════════════════════════════════════════
  // LOADING
  // ═══════════════════════════════════════════════════════════════════
  let ceLibSelectedId = null;

  function ceRenderLibPicker() {
    const el = $("ceLibPicker");
    if (!el) return;
    const lib = typeof audioLibrary !== "undefined" ? audioLibrary : [];
    el.innerHTML = "";
    if (!lib.length) {
      el.innerHTML =
        '<div style="color: var(--txt2); font-size: 11px">No audio loaded yet.</div>';
      return;
    }
    lib.forEach((entry) => {
      const row = document.createElement("div");
      row.style.cssText =
        "padding:2px 4px;border-radius:3px;cursor:pointer;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap" +
        (entry.id === ceLibSelectedId
          ? ";background:var(--accent,#2d6cdf);color:#fff"
          : "");
      row.title = `${entry.name} — ${entry.dur.toFixed(3)}s @ ${entry.rate}Hz`;
      row.textContent = entry.name;
      row.onclick = () => {
        ceLibSelectedId = entry.id;
        ceSetWave(
          Float32Array.from(entry.samples),
          entry.rate,
          entry.name.replace(/\.[^/.]+$/, ""),
        );
        ceRenderLibPicker();
      };
      el.appendChild(row);
    });
  }

  function ceSetWave(samples, rate, label) {
    if (samples.length > MAX_SAMPLES) {
      alert(
        `This recording has ${samples.length.toLocaleString()} samples. The Auto-coded Oscillogram ` +
          `transforms the whole waveform in one pass with it held in memory, so ` +
          `files over ${MAX_SAMPLES.toLocaleString()} samples are refused. Trim it first.`,
      );
      return;
    }
    ceSamples = samples;
    ceRate = rate;
    ceDur = samples.length / rate;
    ceLabel = label;
    let p = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > p) p = v;
    }
    cePeak = p || 1;

    ceAnalysis = null;
    ceColors = null;
    ceSvgEl = null;
    _tfsiCache = { key: null, url: null };
    // A new recording invalidates the view, the playhead and the decoded
    // playback buffer alike — none of them mean anything against other audio.
    ceStopPlay();
    ceView = null;
    cePlayhead = 0;
    cePlayBuf = null;
    cePlayBufKey = "";
    ceShowPlayNote(null);
    ceGeom = null;
    ceLastLightMask = -1;
    ceUpdatePlayheadUI();
    ceUpdateViewInfo();
    const wrap = $("ceWrap");
    if (wrap) wrap.innerHTML = "";

    const nyq = rate / 2;
    $("ceWaveInfo").textContent =
      `${label} — ${ceDur.toFixed(3)} s @ ${rate} Hz ` +
      `(Nyquist ${fmtHzShort(nyq)}, peak ${toDb(cePeak).toFixed(1)} dBFS)`;

    // Default the frequency window to the full recorded band the first time a
    // wave is loaded, so "Analyze" is meaningful without any setup. A window
    // the user has already narrowed is left alone.
    const frtEl = $("ceFrt");
    if (frtEl && !frtEl.dataset.userSet) frtEl.value = Math.round(nyq);

    ["btnCeAnalyze", "btnCeFullRange"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = false;
    });
    ["btnCeDraw", "btnCeSvg", "btnCePng"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = true;
    });
    ceStatus("Wave loaded — set the frequency window, then Analyze.");
  }

  function ceFullRange() {
    if (!ceSamples) return;
    $("ceFrb").value = 0;
    $("ceFrt").value = Math.round(ceRate / 2);
    const frtEl = $("ceFrt");
    if (frtEl) delete frtEl.dataset.userSet;
    ceStatus("Frequency window reset to the full recorded band.");
  }

  // ═══════════════════════════════════════════════════════════════════
  // ANALYSIS — one STFT pass over the recording
  // ═══════════════════════════════════════════════════════════════════
  // Everything the rendering needs is reduced during this single pass:
  //   • per column, the min/max of the samples it subsumes (the envelope);
  //   • per column, the overall envelope peak in dBFS (for the optional Pressure Range);
  //   • per column and BAND, the strongest bin in dBFS (for the FRPT test);
  //   • a fixed-size TFSI raster for the reference spectrogram panel.
  // Only the per-band dB values are kept, not the full spectrogram, so memory
  // is bounded by the band count (1, 6, 12 or 24) rather than the FFT size.
  //
  // The FRPT is deliberately NOT applied here: re-thresholding is the knob a
  // user turns most, and keeping it out of the transform makes it instant.
  async function ceAnalyze() {
    if (!ceSamples) {
      ceStatus("Load a wave first.", true);
      return;
    }
    const range = ceFreqRange();
    if (!range) return;

    const fftN = parseInt($("ceFftSize").value, 10) || 1024;
    const overlapPct = clamp(numVal("ceOverlap", 75), 0, 93.75);
    const hop = Math.max(1, Math.round(fftN * (1 - overlapPct / 100)));
    const nBands = ceBandCount();
    const bits = bandBits(nBands === 1 ? 24 : nBands);

    const n = ceSamples.length;
    const nBins = fftN >> 1;
    const binHz = ceRate / fftN;
    // Centred frames (the window is centred on c*hop and zero-padded at the
    // edges), so column c covers samples [c*hop - hop/2, c*hop + hop/2) and
    // the columns tile the recording end to end. A non-centred STFT would
    // leave the first and last half-window with no colour at all.
    const nCols = Math.floor(n / hop) + 1;

    // Band edges over the frequency window. In 2-colour mode there is a
    // single band spanning the whole window — the mode is exactly the
    // one-band degenerate case of the multicolour one (paper §2.3: "when the
    // frequency range collapses to a single frequency ... a single
    // contrasting colour will mark the relevant CETPE portions").
    const bandCount = nBands === 1 ? 1 : nBands;
    const edges = new Float64Array(bandCount + 1);
    for (let b = 0; b <= bandCount; b++)
      edges[b] = range.frb + ((range.frt - range.frb) * b) / bandCount;

    // Bin span per band. A band narrower than one bin still gets the single
    // nearest bin rather than none — the paper (§7.1.1) explicitly allows a
    // bin to serve two adjacent bands.
    const bandB0 = new Int32Array(bandCount);
    const bandB1 = new Int32Array(bandCount);
    for (let b = 0; b < bandCount; b++) {
      let b0 = Math.ceil(edges[b] / binHz);
      let b1 = Math.floor(edges[b + 1] / binHz);
      if (b1 < b0) b0 = b1 = clamp(Math.round((edges[b] + edges[b + 1]) / 2 / binHz), 0, nBins - 1);
      bandB0[b] = clamp(b0, 0, nBins - 1);
      bandB1[b] = clamp(b1, 0, nBins - 1);
    }

    // One FFT per column: a long recording at high overlap is a real wait, and
    // the only lever the user has is overlap or FFT size. Better to say so
    // before spending the minute than to sit behind the busy overlay.
    if (nCols > 150_000) {
      const est = Math.round((nCols * fftN * Math.log2(fftN)) / 4e7);
      const ok = confirm(
        `This will transform ${nCols.toLocaleString()} columns ` +
          `(FFT ${fftN}, ${overlapPct}% overlap) — roughly ${est}s of work.\n\n` +
          `Lower the overlap or raise the FFT size for fewer columns.\n\nProceed?`,
      );
      if (!ok) {
        ceStatus("Analysis cancelled.");
        return;
      }
    }

    const colMin = new Float32Array(nCols);
    const colMax = new Float32Array(nCols);
    const colPeakDb = new Float32Array(nCols);
    const bandDb = new Float32Array(nCols * bandCount);

    // Hann window, and the coherent gain that turns |X| into an amplitude
    // referred to full scale: a full-scale sine reads 0 dBFS in its own bin.
    const win = new Float32Array(fftN);
    let winSum = 0;
    for (let i = 0; i < fftN; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftN - 1));
      winSum += win[i];
    }
    const magScale = 2 / winSum;

    const re = new Float32Array(fftN);
    const im = new Float32Array(fftN);
    const binDb = new Float32Array(nBins);
    const half = fftN >> 1;
    const halfHop = hop / 2;

    const runner = async (progress) => {
      for (let c = 0; c < nCols; c++) {
        const centre = c * hop;

        // ── Envelope for this column: the extremes of the samples it
        // subsumes, which is what gives the drawn segment its length
        // (paper, footnote 2).
        let mn = 0,
          mx = 0,
          pk = 0;
        const s0 = Math.max(0, Math.round(centre - halfHop));
        const s1 = Math.min(n, Math.round(centre + halfHop));
        for (let i = s0; i < s1; i++) {
          const v = ceSamples[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
          const a = v < 0 ? -v : v;
          if (a > pk) pk = a;
        }
        colMin[c] = mn;
        colMax[c] = mx;
        colPeakDb[c] = toDb(pk);

        // ── Spectrum for this column
        const off = centre - half;
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < fftN; i++) {
          const src = off + i;
          if (src >= 0 && src < n) re[i] = ceSamples[src] * win[i];
        }
        fft(re, im, fftN);
        for (let b = 0; b < nBins; b++) {
          // Bin 0 is not one half of a conjugate pair, so it does not take
          // the ×2 that folds the negative-frequency half back in.
          const scale = b === 0 ? magScale / 2 : magScale;
          binDb[b] = toDb(Math.hypot(re[b], im[b]) * scale);
        }

        // ── Reduce to bands: the strongest bin in each band decides whether
        // the band is "present", matching the paper's per-bin threshold test.
        const base = c * bandCount;
        for (let b = 0; b < bandCount; b++) {
          let best = DB_FLOOR;
          const e = bandB1[b];
          for (let k = bandB0[b]; k <= e; k++) if (binDb[k] > best) best = binDb[k];
          bandDb[base + b] = best;
        }

        if ((c & 1023) === 0) {
          progress(`Transforming… column ${c.toLocaleString()} of ${nCols.toLocaleString()}`, c / nCols);
          if (typeof busyTick === "function") await busyTick();
        }
      }
    };

    if (typeof withBusy === "function") {
      await withBusy("Auto-coded Oscillogram — analysing…", runner);
    } else {
      await runner(() => {});
    }

    _tfsiCache = { key: null, url: null }; // new raster, same dimensions as the last
    ceAnalysis = {
      fftN,
      hop,
      nCols,
      nBins,
      binHz,
      bandCount,
      bits,
      edges,
      frb: range.frb,
      frt: range.frt,
      nyq: range.nyq,
      twoColour: nBands === 1,
      colMin,
      colMax,
      colPeakDb,
      bandDb,
    };

    const timeRes = (fftN / ceRate) * 1000;
    const notes = [];
    if (range.clamped)
      notes.push(`top clamped to Nyquist (${fmtHzShort(range.nyq)})`);
    ceStatus(
      `${nCols.toLocaleString()} columns, ${bandCount} band(s), ` +
        `bin ${binHz.toFixed(1)} Hz, window ${timeRes.toFixed(1)} ms, ` +
        `hop ${((hop / ceRate) * 1000).toFixed(2)} ms` +
        (notes.length ? " — " + notes.join("; ") : ""),
    );

    ["btnCeDraw"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = false;
    });
    ceDraw();
  }

  // ═══════════════════════════════════════════════════════════════════
  // COLOURING — cheap; no transform, so thresholds re-render instantly
  // ═══════════════════════════════════════════════════════════════════
  function ceComputeColors() {
    const a = ceAnalysis;
    if (!a) return null;
    const frpt = numVal("ceFrpt", -60);
    const usePr = $("cePrEnable").checked;
    const prb = numVal("cePrb", -90);
    const prt = numVal("cePrt", 0);
    const hiColor = $("ceHiColor").value;

    const masks = new Uint32Array(a.nCols);
    const colors = new Array(a.nCols).fill(null); // null = draw in base colour
    let nLit = 0;
    let nExcluded = 0;

    for (let c = 0; c < a.nCols; c++) {
      // Outside the overall Pressure Range, a column is never a candidate for
      // colour (paper §2.4) — this is how the "exclude the loudest / feeblest
      // parts" filter of §2.3 is meant to work.
      if (usePr && (a.colPeakDb[c] < prb || a.colPeakDb[c] > prt)) {
        nExcluded++;
        continue;
      }
      let mask = 0;
      const base = c * a.bandCount;
      for (let b = 0; b < a.bandCount; b++)
        if (a.bandDb[base + b] >= frpt) mask |= a.bits[b];
      if (!mask) continue;
      masks[c] = mask;
      nLit++;
      colors[c] = a.twoColour ? hiColor : maskToHex(mask);
    }
    return { masks, colors, nLit, nExcluded, frpt };
  }

  // Merges analysis columns down to at most `target` drawn columns. Masks are
  // OR-ed and envelopes min/max-ed, so a merged column shows every band that
  // occurs anywhere inside it — the same "presence" semantics as an unmerged
  // one, only over a wider slice of time. Nothing is dropped or averaged away.
  // `from`/`to` bound the analysis columns in view. Zooming in narrows that
  // span, so fewer columns compete for the same budget and merging stops
  // happening — the figure genuinely gains resolution as you zoom rather than
  // magnifying an already-merged picture.
  function mergeColumns(a, col, target, from, to) {
    const c0 = clamp(from == null ? 0 : from, 0, a.nCols);
    const c1 = clamp(to == null ? a.nCols : to, c0 + 1, a.nCols);
    const nIn = c1 - c0;
    const nOut = Math.min(nIn, target);
    const outMin = new Float32Array(nOut);
    const outMax = new Float32Array(nOut);
    const outMask = new Uint32Array(nOut);
    const outColor = new Array(nOut).fill(null);
    const outT0 = new Float64Array(nOut);
    const outT1 = new Float64Array(nOut);
    const hiColor = $("ceHiColor").value;

    for (let o = 0; o < nOut; o++) {
      const s0 = c0 + Math.floor((o * nIn) / nOut);
      const s1 = Math.max(s0 + 1, c0 + Math.floor(((o + 1) * nIn) / nOut));
      let mn = 0,
        mx = 0,
        mask = 0;
      for (let c = s0; c < s1; c++) {
        if (a.colMin[c] < mn) mn = a.colMin[c];
        if (a.colMax[c] > mx) mx = a.colMax[c];
        mask |= col.masks[c];
      }
      outMin[o] = mn;
      outMax[o] = mx;
      outMask[o] = mask;
      if (mask) outColor[o] = a.twoColour ? hiColor : maskToHex(mask);
      outT0[o] = (s0 * a.hop) / ceRate;
      outT1[o] = (s1 * a.hop) / ceRate;
    }
    return { nOut, outMin, outMax, outMask, outColor, outT0, outT1, merged: nOut < nIn };
  }

  // ═══════════════════════════════════════════════════════════════════
  // TFSI RASTER → data: URI  (embedded in the SVG so exports stay portable)
  // ═══════════════════════════════════════════════════════════════════
  // Rasterizing 1600×512 cells costs tens of milliseconds — not much, except
  // that every colour picker and spin box in the sidebar redraws the whole
  // figure live. The picture only depends on these four controls, so it is
  // kept until one of them actually changes.
  let _tfsiCache = { key: null, url: null };

  function ceTfsiDataUrl(a, v0, v1, fTop, dbTop, dbRange) {
    const mapName = $("ceCmap") ? $("ceCmap").value : "viridis";
    const key = `${v0.toFixed(6)}|${v1.toFixed(6)}|${a.fftN}|${fTop}|${dbTop}|${dbRange}|${mapName}`;
    if (_tfsiCache.key === key) return _tfsiCache.url;
    const url = ceRasterizeTfsi(a, v0, v1, fTop, dbTop, dbRange, mapName);
    _tfsiCache = { key, url };
    return url;
  }

  // Rasterizes the visible slice at the analysis FFT size, one frame per
  // raster column. The frame spacing follows the VIEW, not the analysis hop,
  // so zooming in buys real detail instead of magnifying stored pixels; the
  // cost is bounded at TFSI_W transforms however long the recording is.
  function ceRasterizeTfsi(a, v0, v1, fTop, dbTop, dbRange, mapName) {
    const fftN = a.fftN;
    const nBins = fftN >> 1;
    const half = fftN >> 1;
    const n = ceSamples.length;
    const i0 = clamp(Math.floor(v0 * ceRate), 0, n);
    const i1 = clamp(Math.ceil(v1 * ceRate), i0 + 1, n);
    const nView = i1 - i0;
    const cols = Math.max(1, Math.min(TFSI_W, nView));
    const rows = Math.max(1, Math.min(TFSI_H, nBins));
    const rowTop = clamp(Math.round((fTop / a.nyq) * rows), 1, rows);

    const win = new Float32Array(fftN);
    let winSum = 0;
    for (let i = 0; i < fftN; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftN - 1));
      winSum += win[i];
    }
    const magScale = 2 / winSum;
    const re = new Float32Array(fftN);
    const im = new Float32Array(fftN);
    const px = new Float32Array(cols * rowTop).fill(DB_FLOOR);

    for (let x = 0; x < cols; x++) {
      const centre = i0 + Math.round(((x + 0.5) * nView) / cols);
      const off = centre - half;
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftN; i++) {
        const src = off + i;
        if (src >= 0 && src < n) re[i] = ceSamples[src] * win[i];
      }
      fft(re, im, fftN);
      for (let b = 0; b < nBins; b++) {
        const ty = Math.floor((b * rows) / nBins);
        if (ty >= rowTop) break; // bins above the displayed top are not drawn
        const scale = b === 0 ? magScale / 2 : magScale;
        const db = toDb(Math.hypot(re[b], im[b]) * scale);
        const idx = ty * cols + x;
        if (db > px[idx]) px[idx] = db;
      }
    }

    const cv = document.createElement("canvas");
    cv.width = cols;
    cv.height = rowTop;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(cols, rowTop);
    const useCmap = typeof cmap === "function";
    for (let y = 0; y < rowTop; y++) {
      // Row 0 of the raster is the lowest frequency; the image's row 0 is the
      // TOP of the panel, so the vertical axis is flipped here.
      const srcRow = rowTop - 1 - y;
      for (let x = 0; x < cols; x++) {
        const db = px[srcRow * cols + x];
        const t = clamp((db - (dbTop - dbRange)) / dbRange, 0, 1);
        const rgb = useCmap ? cmap(t, mapName) : [t * 255, t * 255, t * 255];
        const o = (y * cols + x) * 4;
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIEW  (x-axis zoom / pan)
  // ═══════════════════════════════════════════════════════════════════
  // One view range shared by all three panels, so the oscillogram, the
  // spectrogram and the auto-coded oscillogram always show the same slice of
  // time. null means "the whole recording" — kept distinct from an explicit
  // 0..duration so a redraw after loading a new wave starts fully zoomed out.
  let ceView = null;

  function ceViewRange() {
    if (!ceView) return { v0: 0, v1: ceDur || 1 };
    return { v0: ceView.t0, v1: ceView.t1 };
  }

  // A view narrower than a few analysis columns shows nothing but a handful
  // of drawn bars, so that is the floor.
  function ceMinSpan() {
    const a = ceAnalysis;
    const byColumns = a ? (8 * a.hop) / ceRate : 1e-3;
    return Math.max(byColumns, 1e-4);
  }

  function ceSetView(t0, t1, quiet) {
    if (!ceAnalysis) return;
    if (t1 < t0) [t0, t1] = [t1, t0];
    const minSpan = ceMinSpan();
    if (t1 - t0 < minSpan) {
      const c = (t0 + t1) / 2;
      t0 = c - minSpan / 2;
      t1 = c + minSpan / 2;
    }
    // Slide rather than squash when a zoom lands against an edge, so the
    // span the user asked for is the span they get.
    const span = Math.min(t1 - t0, ceDur);
    if (t0 < 0) {
      t0 = 0;
      t1 = span;
    }
    if (t1 > ceDur) {
      t1 = ceDur;
      t0 = ceDur - span;
    }
    ceView = span >= ceDur - 1e-9 ? null : { t0: Math.max(0, t0), t1: Math.min(ceDur, t1) };
    ceDraw();
    if (!quiet) ceUpdateViewInfo();
  }

  function ceZoomFull() {
    if (!ceAnalysis) return;
    ceView = null;
    ceDraw();
  }

  // Zooms about a fixed time — the cursor for a wheel, the view centre for the
  // buttons — so whatever the user is pointing at stays put.
  function ceZoomBy(factor, anchorT) {
    if (!ceAnalysis) return;
    const { v0, v1 } = ceViewRange();
    const t = anchorT == null ? (v0 + v1) / 2 : clamp(anchorT, v0, v1);
    const frac = (t - v0) / Math.max(1e-12, v1 - v0);
    const span = (v1 - v0) * factor;
    ceSetView(t - frac * span, t + (1 - frac) * span);
  }

  function ceZoomIn() {
    ceZoomBy(0.5, null);
  }

  function ceZoomOut() {
    ceZoomBy(2, null);
  }

  function cePanBy(fracOfSpan) {
    if (!ceAnalysis || !ceView) return;
    const { v0, v1 } = ceViewRange();
    const d = (v1 - v0) * fracOfSpan;
    ceSetView(v0 + d, v1 + d);
  }

  function ceUpdateViewInfo() {
    const el = $("ceViewInfo");
    if (!el) return;
    if (!ceAnalysis) {
      el.textContent = "";
      return;
    }
    const { v0, v1 } = ceViewRange();
    const span = v1 - v0;
    el.textContent = ceView
      ? `${v0.toFixed(3)}–${v1.toFixed(3)} s (${(ceDur / span).toFixed(1)}×)`
      : `full ${ceDur.toFixed(3)} s`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DRAWING
  // ═══════════════════════════════════════════════════════════════════
  function ceDraw() {
    const a = ceAnalysis;
    if (!a) {
      ceStatus("Run Analyze first.", true);
      return;
    }
    const col = ceComputeColors();
    ceColors = col;

    const showTpe = $("ceShowTpe").checked;
    const showTfsi = $("ceShowTfsi").checked;
    const showLegend = $("ceShowLegend").checked && !a.twoColour;
    const showCaption = $("ceShowCaption").checked;
    const baseColor = $("ceBaseColor").value;
    const figBg = $("ceFigBg").value;
    const rowH = clamp(numVal("ceRowHeight", 170), 60, 500);
    const traceW = clamp(numVal("ceTraceWidth", 1), 0.1, 6);
    const tfsiFTop = (() => {
      const v = numVal("ceTfsiFmax", 0);
      return v > 0 ? Math.min(v, a.nyq) : a.nyq;
    })();

    // Columns whose centres fall in the view, widened by one on each side so
    // the drawn envelope reaches the plot edges instead of stopping short.
    const { v0, v1 } = ceViewRange();
    const cFrom = Math.max(0, Math.floor((v0 * ceRate) / a.hop) - 1);
    const cTo = Math.min(a.nCols, Math.ceil((v1 * ceRate) / a.hop) + 2);
    const draw = mergeColumns(a, col, MAX_RENDER_COLS, cFrom, cTo);

    const plotW = AXIS_WIDTH - PAD_L - PAD_R;
    const tSpan = Math.max(1e-12, v1 - v0);
    // Single source of truth for time → x, used by the envelope, the axis,
    // the playhead and every pointer gesture. They drifted apart when each
    // did its own arithmetic.
    const xOfT = (t) => PAD_L + ((t - v0) / tSpan) * plotW;
    const tOfX = (x) => v0 + ((x - PAD_L) / plotW) * tSpan;
    const titleH = 20;
    const captionH = showCaption ? 34 : 0;
    const axisH = 48; // rule, tick labels at +17, "Time (s)" title at +37
    const gap = 12;
    const legendH = showLegend ? 74 : 0;

    let y = 10;
    const layout = [];
    if (showTpe) {
      layout.push({ kind: "tpe", y: y + titleH, h: rowH, titleY: y + 13 });
      y += titleH + rowH + gap;
    }
    if (showTfsi) {
      layout.push({ kind: "tfsi", y: y + titleH, h: rowH, titleY: y + 13 });
      y += titleH + rowH + gap;
    }
    layout.push({ kind: "cetpe", y: y + titleH, h: rowH, titleY: y + 13 });
    y += titleH + rowH + axisH + captionH;
    const totalH = y + legendH + 10;

    const svg = svgEl("svg", {
      xmlns: SVG_NS,
      "xmlns:xlink": "http://www.w3.org/1999/xlink",
      viewBox: `0 0 ${AXIS_WIDTH} ${totalH}`,
      style: "width:100%;height:auto;display:block;font-family:Arial,sans-serif",
    });
    svg.appendChild(
      svgEl("rect", { x: 0, y: 0, width: AXIS_WIDTH, height: totalH, fill: figBg }),
    );

    // Envelope columns are widened past the view edges (see cFrom/cTo) so no
    // gap shows at the margins; this keeps the overhang off the axis labels.
    const clipId = "ceClip";
    const defs = svgEl("defs", {});
    const clip = svgEl("clipPath", { id: clipId });
    clip.appendChild(
      svgEl("rect", { x: PAD_L, y: 0, width: plotW, height: totalH }),
    );
    defs.appendChild(clip);
    svg.appendChild(defs);

    const fg = pickForeground(figBg);
    const label = (x, yy, text, opts) => {
      const t = svgEl(
        "text",
        Object.assign({ x, y: yy, "font-size": 13, fill: fg }, opts || {}),
      );
      t.textContent = text;
      return t;
    };

    const colW = plotW / draw.nOut;
    const strokeW = Math.max(colW, 0.6);

    layout.forEach((panel) => {
      if (panel.kind === "tfsi") {
        svg.appendChild(
          label(PAD_L, panel.titleY, "Spectrogram", { "font-weight": 700 }),
        );
        const dbTop = numVal("ceTfsiDbTop", 0);
        const dbRange = Math.max(6, numVal("ceTfsiDbRange", 80));
        const url = ceTfsiDataUrl(a, v0, v1, tfsiFTop, dbTop, dbRange);
        const img = svgEl("image", {
          x: PAD_L,
          y: panel.y,
          width: plotW,
          height: panel.h,
          preserveAspectRatio: "none",
        });
        img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", url);
        img.setAttribute("href", url);
        svg.appendChild(img);

        // Frequency window markers — the paper's demonstrator drew one yellow
        // line at the interesting frequency; a range needs both edges.
        [a.frb, a.frt].forEach((f) => {
          if (f > tfsiFTop) return;
          const yy = panel.y + panel.h - (f / tfsiFTop) * panel.h;
          svg.appendChild(
            svgEl("line", {
              x1: PAD_L,
              x2: PAD_L + plotW,
              y1: yy,
              y2: yy,
              stroke: "#ffd400",
              "stroke-width": 1.2,
              "stroke-dasharray": "6,3",
            }),
          );
        });
        svg.appendChild(
          label(
            PAD_L + plotW - 4,
            panel.y + 14,
            `FR ${fmtHzShort(a.frb)}–${fmtHzShort(a.frt)}`,
            { "text-anchor": "end", "font-size": 12, fill: "#ffd400" },
          ),
        );
        // Frequency ticks
        const fStep = niceStep(tfsiFTop / 5);
        for (let f = 0; f <= tfsiFTop + 1e-9; f += fStep) {
          const yy = panel.y + panel.h - (f / tfsiFTop) * panel.h;
          svg.appendChild(
            svgEl("line", {
              x1: PAD_L - 4,
              x2: PAD_L,
              y1: yy,
              y2: yy,
              stroke: fg,
              "stroke-width": 1,
            }),
          );
          svg.appendChild(
            label(PAD_L - 6, yy + 4, fmtHzShort(f), {
              "text-anchor": "end",
              "font-size": 11,
            }),
          );
        }
        return;
      }

      const isCe = panel.kind === "cetpe";
      svg.appendChild(
        label(PAD_L, panel.titleY, isCe ? "Auto-coded Oscillogram" : "Oscillogram", {
          "font-weight": 700,
        }),
      );

      const midY = panel.y + panel.h / 2;
      const ampScale = (panel.h / 2 - 2) / cePeak;
      svg.appendChild(
        svgEl("line", {
          x1: PAD_L,
          x2: PAD_L + plotW,
          y1: midY,
          y2: midY,
          stroke: fg,
          "stroke-width": 0.4,
          opacity: 0.4,
        }),
      );

      // One <path> per distinct colour rather than one element per column:
      // the base colour collapses to a single path, and the coloured columns
      // group into however many distinct RGB triplets the mapping produced —
      // typically dozens, never the 16M the palette can express.
      const byColor = new Map();
      for (let o = 0; o < draw.nOut; o++) {
        // Positioned from the column's own timestamp, not its index, so the
        // envelope, the axis and the playhead cannot disagree.
        const x = xOfT((draw.outT0[o] + draw.outT1[o]) / 2);
        const yMax = midY - draw.outMax[o] * ampScale;
        const yMin = midY - draw.outMin[o] * ampScale;
        const key = isCe ? draw.outColor[o] || baseColor : baseColor;
        let d = byColor.get(key);
        if (d === undefined) d = "";
        d += `M${x.toFixed(2)} ${yMax.toFixed(2)}L${x.toFixed(2)} ${yMin.toFixed(2)}`;
        byColor.set(key, d);
      }
      // Base colour first so highlighted columns are never hidden underneath
      // it when they land on the same fractional pixel.
      const keys = Array.from(byColor.keys()).sort((p, q) =>
        p === baseColor ? -1 : q === baseColor ? 1 : 0,
      );
      keys.forEach((k) => {
        svg.appendChild(
          svgEl("path", {
            d: byColor.get(k),
            fill: "none",
            stroke: k,
            "stroke-width": isCe ? strokeW : Math.max(colW, traceW),
            "stroke-linecap": "butt",
            "clip-path": `url(#${clipId})`,
          }),
        );
      });
    });

    // ── Time axis under the Auto-coded Oscillogram ────────────────────────────────────
    const cePanel = layout[layout.length - 1];
    const axisY = cePanel.y + cePanel.h;
    svg.appendChild(
      svgEl("line", {
        x1: PAD_L,
        x2: PAD_L + plotW,
        y1: axisY,
        y2: axisY,
        stroke: fg,
        "stroke-width": 1,
      }),
    );
    const tStep = niceStep(tSpan / 8);
    const tFirst = Math.ceil(v0 / tStep) * tStep;
    for (let t = tFirst; t <= v1 + 1e-9; t += tStep) {
      const x = xOfT(t);
      svg.appendChild(
        svgEl("line", { x1: x, x2: x, y1: axisY, y2: axisY + 4, stroke: fg, "stroke-width": 1 }),
      );
      svg.appendChild(
        label(x, axisY + 17, fmtTimeTick(t, tStep), {
          "text-anchor": "middle",
          "font-size": 12,
        }),
      );
    }
    // Centred on the plot and on its own line below the ticks, rather than
    // right-anchored at the end of the axis where it sat on top of the last
    // tick label.
    svg.appendChild(
      label(PAD_L + plotW / 2, axisY + 37, "Time (s)", {
        "text-anchor": "middle",
        "font-size": 12,
      }),
    );

    // ── Parameter caption (the paper's figure captions state the settings) ──
    if (showCaption) {
      const mode = a.twoColour ? "2-colour" : `Multicolour, ${a.bandCount} bands`;
      const pr = $("cePrEnable").checked
        ? `, PR ${numVal("cePrb", -90)}…${numVal("cePrt", 0)} dBFS`
        : "";
      svg.appendChild(
        label(
          PAD_L,
          axisY + axisH + 12,
          `${ceLabel} — ${mode}; FR ${fmtHzShort(a.frb)}–${fmtHzShort(a.frt)}; ` +
            `FRPT ${col.frpt} dBFS${pr}; FFT ${a.fftN}, hop ${a.hop} ` +
            `(${((a.hop / ceRate) * 1000).toFixed(2)} ms)`,
          { "font-size": 11, opacity: 0.85 },
        ),
      );
      svg.appendChild(
        label(
          PAD_L,
          axisY + axisH + 26,
          `${col.nLit.toLocaleString()} of ${a.nCols.toLocaleString()} columns above threshold` +
            (col.nExcluded
              ? `; ${col.nExcluded.toLocaleString()} excluded by the Pressure Range`
              : "") +
            (draw.merged
              ? `; drawn at ${draw.nOut.toLocaleString()} columns (adjacent columns merged, bands OR-ed)`
              : ""),
          { "font-size": 11, opacity: 0.7 },
        ),
      );
    }

    // ── Band → colour legend ─────────────────────────────────────────
    if (showLegend) {
      const legY = totalH - legendH + 4;
      svg.appendChild(
        label(PAD_L, legY + 10, "Frequency Window Bands → RGB bit", {
          "font-size": 11,
          "font-weight": 700,
        }),
      );
      const swW = plotW / a.bandCount;
      for (let b = 0; b < a.bandCount; b++) {
        const x = PAD_L + b * swW;
        svg.appendChild(
          svgEl("rect", {
            x,
            y: legY + 18,
            width: Math.max(1, swW - 1),
            height: 18,
            fill: maskToHex(a.bits[b]),
            stroke: fg,
            "stroke-width": 0.3,
          }),
        );
        // Only every other edge is labelled once the bands get narrow, so the
        // legend stays readable at 24 bands.
        if (a.bandCount <= 12 || b % 2 === 0) {
          svg.appendChild(
            label(x + swW / 2, legY + 48, fmtHzShort(a.edges[b]), {
              "text-anchor": "middle",
              "font-size": 9,
            }),
          );
        }
      }
      svg.appendChild(
        label(PAD_L + plotW, legY + 48, fmtHzShort(a.edges[a.bandCount]), {
          "text-anchor": "end",
          "font-size": 9,
        }),
      );
      svg.appendChild(
        label(PAD_L, legY + 64, "Blue = lower third of the window, green = middle, red = upper. A column's colour is the OR of every band over the FRPT.", {
          "font-size": 9,
          opacity: 0.7,
        }),
      );
    }

    // ── Playhead + pointer surface ───────────────────────────────────
    // Both span every panel, so a click anywhere in the stack scrubs and the
    // position line reads across the oscillogram, the spectrogram and the
    // auto-coded oscillogram at once.
    const plotTop = layout[0].y;
    const plotBot = layout[layout.length - 1].y + layout[layout.length - 1].h;

    // Under the playhead but over the traces: a transparent rect that turns
    // drags into zooms and clicks into playhead moves.
    const hit = svgEl("rect", {
      x: PAD_L,
      y: plotTop,
      width: plotW,
      height: plotBot - plotTop,
      fill: "transparent",
      class: "ce-transient",
      style: "cursor:text",
    });
    svg.appendChild(hit);

    const playhead = svgEl("line", {
      x1: PAD_L,
      x2: PAD_L,
      y1: plotTop,
      y2: plotBot,
      stroke: "#ff2b2b",
      "stroke-width": 1.5,
      "pointer-events": "none",
      class: "ce-transient",
      visibility: "hidden",
    });
    svg.appendChild(playhead);

    // Geometry the per-frame playhead update and the pointer handlers read,
    // so neither has to re-derive the layout or trigger a redraw.
    ceGeom = { v0, v1, plotW, plotTop, plotBot, xOfT, tOfX, playhead, svg, draw };
    bindViewGestures(svg, hit);

    const wrap = $("ceWrap");
    wrap.innerHTML = "";
    wrap.appendChild(svg);
    ceSvgEl = svg;
    attachHover(svg, a, draw, PAD_L, plotW);
    ceUpdateViewInfo();
    ceUpdatePlayheadUI();

    $("btnCeSvg").disabled = false;
    $("btnCePng").disabled = false;
    ["btnCePlay", "btnCeStop", "btnCeZoomIn", "btnCeZoomOut", "btnCeZoomFull"].forEach(
      (id) => {
        const b = $(id);
        if (b) b.disabled = false;
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // POINTER GESTURES — drag to zoom, click to scrub, wheel to zoom
  // ═══════════════════════════════════════════════════════════════════
  function bindViewGestures(svg, hit) {
    const toSvgX = (clientX) => {
      const r = svg.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * AXIS_WIDTH;
    };

    hit.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const startX = ev.clientX;
      const g = ceGeom;
      let brushing = false;
      let rect = null;

      const onMove = (e2) => {
        if (!brushing && Math.abs(e2.clientX - startX) > 3) {
          brushing = true;
          rect = svgEl("rect", {
            y: g.plotTop,
            height: g.plotBot - g.plotTop,
            fill: "rgba(217,153,34,0.20)",
            stroke: "#d29922",
            "stroke-width": 1,
            "pointer-events": "none",
            class: "ce-transient",
          });
          svg.appendChild(rect);
        }
        if (!brushing) return;
        const x0 = clamp(Math.min(toSvgX(startX), toSvgX(e2.clientX)), PAD_L, PAD_L + g.plotW);
        const x1 = clamp(Math.max(toSvgX(startX), toSvgX(e2.clientX)), PAD_L, PAD_L + g.plotW);
        rect.setAttribute("x", x0);
        rect.setAttribute("width", Math.max(0, x1 - x0));
      };

      const onUp = (e2) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (rect) rect.remove();
        if (brushing) {
          const t0 = g.tOfX(clamp(toSvgX(startX), PAD_L, PAD_L + g.plotW));
          const t1 = g.tOfX(clamp(toSvgX(e2.clientX), PAD_L, PAD_L + g.plotW));
          ceSetView(t0, t1);
        } else {
          // A plain click parks the playhead — the same gesture the main
          // viewer uses, so it needs no explanation here.
          ceSeek(g.tOfX(clamp(toSvgX(e2.clientX), PAD_L, PAD_L + g.plotW)));
        }
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    svg.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ceZoomFull();
    });

    // Wheel zooms about the cursor; Shift+wheel pans. preventDefault keeps
    // the surrounding pane from scrolling out from under the gesture.
    svg.addEventListener(
      "wheel",
      (ev) => {
        if (!ceAnalysis) return;
        ev.preventDefault();
        const g = ceGeom;
        if (!g) return;
        if (ev.shiftKey) {
          cePanBy((ev.deltaY > 0 ? 0.15 : -0.15));
          return;
        }
        const x = clamp(toSvgX(ev.clientX), PAD_L, PAD_L + g.plotW);
        ceZoomBy(ev.deltaY > 0 ? 1.25 : 0.8, g.tOfX(x));
      },
      { passive: false },
    );
  }

  // White figures want dark type, dark figures want light type — the figure
  // background is a user choice, and a fixed foreground turns one of the two
  // into invisible text.
  function pickForeground(bgHex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(bgHex || "");
    if (!m) return "#111";
    const v = parseInt(m[1], 16);
    const lum =
      0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
    return lum > 140 ? "#111" : "#eee";
  }

  // ═══════════════════════════════════════════════════════════════════
  // PLAYBACK, PLAYHEAD AND THE ACTIVITY LIGHT
  // ═══════════════════════════════════════════════════════════════════
  let ceGeom = null; // set by ceDraw; what the per-frame update reads
  let cePlayhead = 0; // seconds into the recording
  let cePlaying = false;
  let ceSrc = null;
  let ceGain = null; // fade node; see PLAY_FADE
  let cePlayBuf = null;
  let cePlayBufKey = "";
  let cePlayCtxT0 = 0; // AudioContext clock at the moment playback started
  let cePlayStartT = 0; // recording time the current run started from
  let cePlaySpeed = 1;
  let cePlayEndT = 0;
  let ceRafId = null;
  let ceLastLightMask = -1;

  // Reuses main.js's AudioContext when there is one. Browsers cap how many a
  // page may create, and this pane is not important enough to spend one of
  // them on a second context.
  function ceAudioContext() {
    try {
      if (typeof audioCtx !== "undefined" && audioCtx) return audioCtx;
    } catch (e) {
      /* main.js not loaded — fall through and make our own */
    }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    const ctx = new C();
    try {
      audioCtx = ctx;
    } catch (e) {
      /* not assignable; keep it local */
    }
    return ctx;
  }

  // Which analysis column a moment in time belongs to, and therefore whether
  // that moment is highlighted. This is the single question the light answers.
  function ceMaskAtTime(t) {
    const a = ceAnalysis;
    if (!a || !ceColors) return 0;
    const c = clamp(Math.round((t * ceRate) / a.hop), 0, a.nCols - 1);
    return ceColors.masks[c];
  }

  function ceBandsLabel(mask) {
    const a = ceAnalysis;
    if (!mask || !a) return "";
    if (a.twoColour) return `${fmtHzShort(a.frb)}–${fmtHzShort(a.frt)}`;
    const lit = [];
    for (let b = 0; b < a.bandCount; b++)
      if (mask & a.bits[b]) lit.push(`${fmtHzShort(a.edges[b])}–${fmtHzShort(a.edges[b + 1])}`);
    return lit.join(", ");
  }

  // Moves the line and drives the light. Called every animation frame during
  // playback and once per seek, so it touches attributes only — never redraws.
  function ceUpdatePlayheadUI() {
    const g = ceGeom;
    if (g && g.playhead) {
      if (cePlayhead >= g.v0 && cePlayhead <= g.v1) {
        const x = g.xOfT(cePlayhead);
        g.playhead.setAttribute("x1", x);
        g.playhead.setAttribute("x2", x);
        g.playhead.setAttribute("visibility", "visible");
      } else {
        g.playhead.setAttribute("visibility", "hidden");
      }
    }
    const td = $("ceTimeDisp");
    if (td) td.textContent = cePlayhead.toFixed(3) + " s";

    const mask = ceMaskAtTime(cePlayhead);
    // The DOM is only touched when the answer changes: at 60 fps over a fast
    // echeme pulse this is the difference between a few writes and a few
    // hundred per second.
    if (mask !== ceLastLightMask) {
      ceLastLightMask = mask;
      const light = $("ceLight");
      if (light) {
        light.style.background = mask ? "#ff2b2b" : "var(--bg3, #21262d)";
        light.style.boxShadow = mask ? "0 0 9px 2px rgba(255,43,43,0.85)" : "none";
        light.style.borderColor = mask ? "#ff6b6b" : "var(--border2, #30363d)";
      }
      const lbl = $("ceLightLabel");
      if (lbl) {
        lbl.textContent = mask ? ceBandsLabel(mask) : "—";
        lbl.style.color = mask ? "#ff8a8a" : "var(--txt2)";
      }
    }
  }

  function ceSeek(t) {
    cePlayhead = clamp(t, 0, ceDur);
    if (cePlaying) {
      // Restart from the new position rather than letting the line snap back
      // to where the running buffer actually is.
      ceStartPlay(true);
    } else {
      ceUpdatePlayheadUI();
    }
  }

  // Percent of real time, matching the main transport's own Speed box (and
  // its 5-400% limits) so the two controls mean the same thing.
  function cePlayRate() {
    const el = $("cePlaySpeed");
    const pct = el ? parseFloat(el.value) : 100;
    if (!isFinite(pct) || pct <= 0) return 1;
    return clamp(pct, 1, 400) / 100; // 1% floor, matching the main transport
  }

  function ceSetSpeed() {
    cePlaySpeed = cePlayRate();
    // Restart from the current position so the elapsed-time arithmetic stays
    // exact — the rate is captured per run, not read live.
    if (cePlaying) ceStartPlay(true);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PLAYBACK ANTI-ALIASING
  // ═══════════════════════════════════════════════════════════════════
  // A 250 kHz recording has to be resampled to the ~48 kHz the sound card
  // runs at. Web Audio's AudioBufferSourceNode does that by interpolation
  // with NO anti-alias filter, so every component above the output Nyquist
  // folds back down into the audible band as noise — an ultrasonic song at
  // 42 kHz lands somewhere in the middle of what you hear, which is why such
  // a file comes out harsh here but clean in Windows Media Player or
  // Audition. Both of those low-pass before resampling; so does this now.
  //
  // The cutoff depends on Speed, because Speed is what decides where an input
  // frequency ENDS UP: a component at f is heard at f × rate. Alias-free
  // therefore means f × rate < outputNyquist for every f in the recording,
  // and nothing needs filtering at all unless ceRate × rate exceeds the
  // output rate. That is why slowing down to hear ultrasound still works:
  // at 6% the whole 125 kHz band lands under 8 kHz and is passed untouched.
  function cePlaybackCutoff(ctx, rate) {
    const out = ctx.sampleRate || 48000;
    if (ceRate * rate <= out) return null; // no downsampling ⇒ nothing can fold
    // 0.45 rather than 0.5 leaves the filter's transition band room to roll
    // off below the output Nyquist instead of straddling it.
    return Math.min(ceRate * 0.49, (0.45 * out) / rate);
  }

  // Cascaded-biquad Butterworth low-pass (order 8 ⇒ four sections, about
  // -48 dB per octave past the corner). An FIR would have a tighter
  // transition band, but this runs over every sample of a multi-million
  // sample recording and the octave-and-up rejection is what matters for
  // keeping an ultrasonic envelope peak out of the audible band.
  function ceLowPass(src, rate, cutoff, order) {
    const out = Float32Array.from(src);
    const w0 = (2 * Math.PI * cutoff) / rate;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const sections = Math.max(1, Math.round(order / 2));
    for (let s = 0; s < sections; s++) {
      // Butterworth pole Q for section s of an order-N cascade.
      const q = 1 / (2 * Math.cos((Math.PI * (2 * s + 1)) / (2 * order)));
      const alpha = sinw / (2 * q);
      const a0 = 1 + alpha;
      const b0 = (1 - cosw) / 2 / a0;
      const b1 = (1 - cosw) / a0;
      const b2 = b0;
      const a1 = (-2 * cosw) / a0;
      const a2 = (1 - alpha) / a0;
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      for (let i = 0; i < out.length; i++) {
        const x = out[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] = y;
      }
    }
    return out;
  }

  // ONE buffer for the whole recording, exactly as the main transport builds
  // its own, with playback started at an offset into it. Slicing a buffer per
  // run instead meant every press began at an arbitrary mid-waveform sample.
  // Cached per cutoff, so changing Speed only re-filters when it has to.
  function ceEnsurePlayBuffer(ctx, rate) {
    const cutoff = cePlaybackCutoff(ctx, rate);
    const key = `${ceLabel}|${ceRate}|${ceSamples.length}|${cutoff ? Math.round(cutoff) : 0}`;
    if (cePlayBufKey === key && cePlayBuf) return cePlayBuf;
    const data = cutoff ? ceLowPass(ceSamples, ceRate, cutoff, 8) : ceSamples;
    const buf = ctx.createBuffer(1, ceSamples.length, ceRate);
    buf.copyToChannel(data, 0);
    cePlayBuf = buf;
    cePlayBufKey = key;
    ceShowPlayNote(cutoff, rate);
    return buf;
  }

  // Filtering is for LISTENING only — the analysis, the colours, the exports
  // and every figure use the untouched recording — so it has to be visible
  // rather than a silent change to what you hear.
  function ceShowPlayNote(cutoff, rate) {
    const el = $("cePlayNote");
    if (!el) return;
    if (!cutoff) {
      el.textContent = "";
      el.title = "";
      return;
    }
    el.textContent = `≤ ${fmtHzShort(cutoff)}`;
    el.title =
      `Playback is low-passed at ${fmtHzShort(cutoff)} before resampling, so the ` +
      `ultrasonic part of this ${fmtHzShort(ceRate)} recording cannot alias into ` +
      `the audible band. Analysis, colours and exports are unaffected. ` +
      `Lower the Speed to bring higher bands down into hearing range instead.`;
  }

  // Fades out over PLAY_FADE and stops after it, rather than cutting the
  // waveform off mid-cycle.
  function ceStopSource() {
    if (!ceSrc) return;
    const src = ceSrc;
    const gain = ceGain;
    ceSrc = null;
    ceGain = null;
    src.onended = null;
    const ctx = ceAudioContext();
    try {
      if (gain && ctx) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + PLAY_FADE);
        src.stop(now + PLAY_FADE);
      } else {
        src.stop();
      }
    } catch (e) {
      try {
        src.stop();
      } catch (e2) {
        /* already stopped */
      }
    }
  }

  // Plays from the playhead to the END OF THE RECORDING. Zoom is a view, not
  // a selection: bounding playback by it made a tight zoom stop after a
  // fraction of a second, which reads as playback pausing itself.
  function ceStartPlay(restart) {
    if (!ceSamples || !ceAnalysis) return;
    const ctx = ceAudioContext();
    if (!ctx) {
      ceStatus("This browser has no Web Audio support — playback unavailable.", true);
      return;
    }
    if (ctx.state === "suspended") ctx.resume();

    // Two transports playing at once is never what anyone wants.
    if (!restart) {
      try {
        if (typeof isPlaying !== "undefined" && isPlaying && typeof pausePb === "function")
          pausePb();
      } catch (e) {
        /* main transport not present */
      }
    }
    ceStopSource();

    let startT = clamp(cePlayhead, 0, ceDur);
    if (startT >= ceDur - 1e-6) startT = ceViewRange().v0;

    cePlaySpeed = cePlayRate();
    let buf;
    try {
      buf = ceEnsurePlayBuffer(ctx, cePlaySpeed);
    } catch (e) {
      // A sample rate outside the browser's createBuffer range is the usual
      // cause, and it is worth naming rather than failing silently.
      ceStatus(
        `Could not prepare playback at ${ceRate} Hz: ${e.message}. ` +
          `Resample the recording to a standard rate first.`,
        true,
      );
      return;
    }

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + PLAY_FADE);
    gain.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = cePlaySpeed;
    src.connect(gain);
    src.onended = () => {
      if (cePlaying && ceSrc === src) ceStopPlay();
    };
    // Offset into the whole-recording buffer — the same call the main
    // transport makes.
    src.start(0, startT);
    ceSrc = src;
    ceGain = gain;

    cePlayCtxT0 = now;
    cePlayStartT = startT;
    cePlayEndT = ceDur;
    cePlayhead = startT;
    cePlaying = true;
    ceSetPlayButton(true);
    cancelAnimationFrame(ceRafId);
    ceRafId = requestAnimationFrame(ceTick);
  }

  function ceTick() {
    if (!cePlaying) return;
    const ctx = ceAudioContext();
    // Wall-clock elapsed × rate = audio consumed, the same arithmetic the
    // main transport uses.
    const t = cePlayStartT + (ctx.currentTime - cePlayCtxT0) * cePlaySpeed;
    if (t >= cePlayEndT) {
      cePlayhead = cePlayEndT;
      ceStopPlay();
      return;
    }
    cePlayhead = t;
    // Page the view along so a zoomed-in figure keeps up with what is being
    // heard instead of the playhead vanishing off the right edge.
    if (ceView && t > ceView.t1) {
      const span = ceView.t1 - ceView.t0;
      ceSetView(t, t + span, true);
    }
    ceUpdatePlayheadUI();
    ceRafId = requestAnimationFrame(ceTick);
  }

  function cePausePlay() {
    if (!cePlaying) return;
    const ctx = ceAudioContext();
    cePlayhead = clamp(
      cePlayStartT + (ctx.currentTime - cePlayCtxT0) * cePlaySpeed,
      0,
      ceDur,
    );
    ceStopSource();
    cePlaying = false;
    ceSetPlayButton(false);
    cancelAnimationFrame(ceRafId);
    ceUpdatePlayheadUI();
  }

  // `rewind` distinguishes the Stop button (back to the start of the view)
  // from playback simply reaching the end (leave the line where it stopped).
  function ceStopPlay(rewind) {
    ceStopSource();
    cePlaying = false;
    ceSetPlayButton(false);
    cancelAnimationFrame(ceRafId);
    if (rewind) cePlayhead = ceViewRange().v0;
    ceUpdatePlayheadUI();
  }

  function cePlayToggle() {
    if (!ceAnalysis) {
      ceStatus("Run Analyze first.", true);
      return;
    }
    cePlaying ? cePausePlay() : ceStartPlay(false);
  }

  function ceSetPlayButton(playing) {
    const b = $("btnCePlay");
    if (b) b.textContent = playing ? "⏸ Pause" : "▶ Play";
  }

  // Space belongs to whichever transport is on screen. main.js binds it on
  // document in the bubble phase for the main viewer, which is hidden while
  // this pane is up — so this claims it in the CAPTURE phase, and only then.
  // switchMainTab and switchPlotSubtab both set this pane's display directly,
  // so the inline style is authoritative. offsetParent was also being checked
  // here, which can read null for reasons unrelated to this pane — and every
  // false negative hands Space back to the main transport, so BOTH would play
  // the same audio at once.
  function ceIsPaneVisible() {
    const el = $("mainview-cetpe");
    return !!el && el.style.display !== "none";
  }

  document.addEventListener(
    "keydown",
    (ev) => {
      if (!ceIsPaneVisible()) return;
      const tag = ev.target && ev.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        cePlayToggle();
      } else if (ev.key === "Home") {
        ev.preventDefault();
        ev.stopPropagation();
        ceZoomFull();
      }
    },
    true,
  );

  // ── Hover readout ─────────────────────────────────────────────────
  // Which bands actually lit a given column is the question the rendering
  // raises and cannot answer by itself once several bands share a hue.
  function attachHover(svg, a, draw, xOff, plotW) {
    const out = $("ceHoverInfo");
    if (!out) return;
    svg.addEventListener("pointerleave", () => {
      out.textContent = "";
    });
    svg.addEventListener("pointermove", (ev) => {
      const g = ceGeom;
      if (!g) return;
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * AXIS_WIDTH;
      if (x < xOff || x > xOff + plotW) {
        out.textContent = "";
        return;
      }
      // Located by TIME, not by index: drawn columns are positioned from
      // their timestamps and cover slightly more than the view, so an
      // index-proportional lookup would report the wrong column near the
      // edges once zoomed.
      const t = g.tOfX(x);
      let o = Math.round(
        ((t - draw.outT0[0]) / Math.max(1e-12, draw.outT1[draw.nOut - 1] - draw.outT0[0])) *
          (draw.nOut - 1),
      );
      o = clamp(o, 0, draw.nOut - 1);
      const mask = draw.outMask[o];
      let txt =
        `t = ${t.toFixed(4)} s · envelope peak ` +
        `${toDb(Math.max(Math.abs(draw.outMin[o]), draw.outMax[o])).toFixed(1)} dBFS · `;
      if (!mask) {
        txt += "no band above the FRPT";
      } else if (a.twoColour) {
        txt += `${fmtHzShort(a.frb)}–${fmtHzShort(a.frt)} above the FRPT`;
      } else {
        const lit = ceBandsLabel(mask).split(", ");
        txt += `${lit.length} band(s): ${lit.join(", ")} → ${maskToHex(mask)}`;
      }
      out.textContent = txt;
    });
  }

  // Redraw on a control change, but only when the change is a pure
  // re-colouring or re-layout. FFT size, overlap, band count and the
  // frequency window all change what was transformed, so they invalidate the
  // analysis and say so instead of silently drawing stale bands.
  function ceRecolor() {
    if (ceAnalysis) ceDraw();
  }

  // `src` is the control that fired, so that typing in FRT — and only that —
  // marks the frequency window as the user's, keeping the next loaded wave
  // from resetting the top back to its own Nyquist.
  function ceInvalidate(src) {
    if (src && src.id === "ceFrt") src.dataset.userSet = "1";
    if (!ceAnalysis) return;
    ceStopPlay();
    ceAnalysis = null;
    ceColors = null;
    ceGeom = null;
    _tfsiCache = { key: null, url: null };
    const b = $("btnCeDraw");
    if (b) b.disabled = true;
    ceStatus("Analysis parameters changed — press Analyze to recompute.");
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════
  // The playhead, the brush rectangle and the invisible pointer surface are
  // interface, not figure — a published plot must not carry a red line
  // wherever playback happened to be paused.
  function ceSerializeSvg() {
    const clone = ceSvgEl.cloneNode(true);
    clone.querySelectorAll(".ce-transient").forEach((el) => el.remove());
    return new XMLSerializer().serializeToString(clone);
  }

  async function ceExportSvg() {
    if (!ceSvgEl) return;
    const svgText = ceSerializeSvg();
    const name = ceFileStem() + ".svg";
    if (
      window.__TAURI__ &&
      window.__TAURI__.dialog &&
      typeof window.__TAURI__.dialog.save === "function" &&
      window.__TAURI__.fs &&
      typeof window.__TAURI__.fs.writeTextFile === "function"
    ) {
      const filePath = await window.__TAURI__.dialog.save({
        filters: [{ name: "SVG", extensions: ["svg"] }],
        defaultPath: name,
      });
      if (!filePath) return;
      await window.__TAURI__.fs.writeTextFile(filePath, svgText);
      alert("SVG saved successfully!");
    } else {
      const blob = new Blob([svgText], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = name;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
    }
  }

  async function ceExportPng() {
    if (!ceSvgEl) return;
    const svgText = ceSerializeSvg();
    const vb = ceSvgEl.viewBox.baseVal;
    const scale = clamp(numVal("cePngScale", 2), 1, 6);
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vb.width * scale);
      canvas.height = Math.round(vb.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = $("ceFigBg").value || "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL("image/png");
      const name = ceFileStem() + ".png";
      if (
        window.__TAURI__ &&
        window.__TAURI__.dialog &&
        typeof window.__TAURI__.dialog.save === "function" &&
        window.__TAURI__.fs &&
        typeof window.__TAURI__.fs.writeFile === "function"
      ) {
        const filePath = await window.__TAURI__.dialog.save({
          filters: [{ name: "Image", extensions: ["png"] }],
          defaultPath: name,
        });
        if (!filePath) return;
        const b64 = dataUrl.split(",")[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await window.__TAURI__.fs.writeFile(filePath, bytes);
        alert("PNG saved successfully!");
      } else {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const dlUrl = URL.createObjectURL(blob);
        const el = document.createElement("a");
        el.href = dlUrl;
        el.download = name;
        document.body.appendChild(el);
        el.click();
        el.remove();
        URL.revokeObjectURL(dlUrl);
      }
    };
    img.src = url;
  }

  // ── Detected regions as CSV ──────────────────────────────────────
  // The paper's stated purpose is locating the interesting portions of a long
  // unsupervised recording. On screen that is a colour; to actually act on it
  // you need the time ranges, so contiguous runs of coloured columns are
  // exported as intervals with the bands that lit them.
  async function ceExportRegions() {
    const a = ceAnalysis;
    const col = ceColors;
    if (!a || !col) {
      ceStatus("Draw an Auto-coded Oscillogram first.", true);
      return;
    }
    const rows = [["start_s", "end_s", "duration_s", "env_peak_dbfs", "rgb", "bands_hz"]];
    let c = 0;
    while (c < a.nCols) {
      if (!col.masks[c]) {
        c++;
        continue;
      }
      const start = c;
      let mask = 0;
      let envPeak = DB_FLOOR;
      while (c < a.nCols && col.masks[c]) {
        mask |= col.masks[c];
        if (a.colPeakDb[c] > envPeak) envPeak = a.colPeakDb[c];
        c++;
      }
      const t0 = ((start * a.hop) / ceRate).toFixed(6);
      const t1 = ((c * a.hop) / ceRate).toFixed(6);
      const bands = [];
      for (let b = 0; b < a.bandCount; b++)
        if (mask & a.bits[b])
          bands.push(`${Math.round(a.edges[b])}-${Math.round(a.edges[b + 1])}`);
      rows.push([
        t0,
        t1,
        (parseFloat(t1) - parseFloat(t0)).toFixed(6),
        envPeak.toFixed(2),
        a.twoColour ? "" : maskToHex(mask),
        bands.join(" "),
      ]);
    }
    if (rows.length === 1) {
      ceStatus("No column reached the FRPT — nothing to export.", true);
      return;
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const name = ceFileStem() + "_regions.csv";
    if (typeof dlFile === "function") {
      await dlFile(name, csv, "text/csv", { exactName: true });
    } else {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = name;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
    }
    ceStatus(`Exported ${rows.length - 1} coloured region(s).`);
  }

  // ── Citation ──────────────────────────────────────────────────────
  // Read out of the DOM rather than duplicated here, so the string a user
  // copies is provably the one they were shown. The markup wraps it across
  // several lines for readability, hence the whitespace collapse.
  //
  // The async Clipboard API is not guaranteed in a packaged webview (it can
  // be gated by permissions, or by the document not being focused), so a
  // failure falls back to the old execCommand path rather than leaving the
  // button looking like it worked.
  async function ceCopyCitation(btn) {
    const el = $("ceCitation");
    if (!el) return;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const done = (ok) => {
      if (!btn) return;
      const was = btn.textContent;
      btn.textContent = ok ? "✔ Copied" : "✘ Copy failed — select it manually";
      setTimeout(() => {
        btn.textContent = was;
      }, 1800);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return done(true);
      }
      throw new Error("no clipboard API");
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        done(ok);
      } catch (e2) {
        done(false);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRESETS  (same contract as the Osc. Zoom preset files)
  // ═══════════════════════════════════════════════════════════════════
  const CE_PRESET_FIELDS = [
    "ceFftSize",
    "ceOverlap",
    "ceMode",
    "ceFrb",
    "ceFrt",
    "ceFrpt",
    "cePrEnable",
    "cePrb",
    "cePrt",
    "ceBaseColor",
    "ceHiColor",
    "ceFigBg",
    "ceRowHeight",
    "ceTraceWidth",
    "ceShowTpe",
    "ceShowTfsi",
    "ceShowLegend",
    "ceShowCaption",
    "ceCmap",
    "ceTfsiFmax",
    "ceTfsiDbTop",
    "ceTfsiDbRange",
    "cePngScale",
  ];
  const CE_PRESET_KIND = "rthoptera.cetpe.preset";
  const CE_PRESET_VERSION = 1;

  function ceSanitizePreset(data) {
    const known = new Set(CE_PRESET_FIELDS);
    const clean = {};
    const invalid = [];
    const clamped = [];
    let unknown = 0;

    Object.keys(data).forEach((k) => {
      if (!k.startsWith("_") && !known.has(k)) unknown++;
    });

    CE_PRESET_FIELDS.forEach((id) => {
      if (!(id in data)) return;
      const el = $(id);
      if (!el) return;
      const v = data[id];
      if (el.type === "checkbox") {
        if (typeof v !== "boolean") return invalid.push(id);
        clean[id] = v;
      } else if (el.tagName === "SELECT") {
        const want = String(v);
        if (!Array.from(el.options).some((o) => o.value === want)) return invalid.push(id);
        clean[id] = want;
      } else if (el.type === "number") {
        const num = parseFloat(v);
        if (!isFinite(num)) return invalid.push(id);
        const lo = el.min === "" ? -Infinity : parseFloat(el.min);
        const hi = el.max === "" ? Infinity : parseFloat(el.max);
        const fixed = Math.min(isFinite(hi) ? hi : Infinity, Math.max(isFinite(lo) ? lo : -Infinity, num));
        if (fixed !== num) clamped.push(id);
        clean[id] = String(fixed);
      } else if (el.type === "color") {
        if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v.trim())) return invalid.push(id);
        clean[id] = v.trim().toLowerCase();
      } else {
        if (v === null || typeof v === "object") return invalid.push(id);
        clean[id] = String(v);
      }
    });
    return { clean, invalid, clamped, unknown };
  }

  async function ceExportPreset() {
    const data = {};
    CE_PRESET_FIELDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      data[id] = el.type === "checkbox" ? el.checked : el.value;
    });
    const payload = {
      _kind: CE_PRESET_KIND,
      _version: CE_PRESET_VERSION,
      _app: "Rthoptera Desktop",
      _savedAt: new Date().toISOString(),
      ...data,
    };
    const text = JSON.stringify(payload, null, 2);
    const name = "rthoptera_auto_coded_oscillogram_preset.json";
    if (typeof dlFile === "function") {
      await dlFile(name, text, "application/json", { exactName: true });
      return;
    }
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = name;
    document.body.appendChild(el);
    el.click();
    el.remove();
    URL.revokeObjectURL(url);
  }

  async function ceImportPreset(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        ceStatus("Not a preset file (expected a JSON object).", true);
        return;
      }
      if (data._kind && data._kind !== CE_PRESET_KIND) {
        ceStatus(`Not an Auto-coded Oscillogram preset (file says "${data._kind}").`, true);
        return;
      }
      const { clean, invalid, clamped, unknown } = ceSanitizePreset(data);
      const n = Object.keys(clean).length;
      if (!n) {
        ceStatus("No recognizable Auto-coded Oscillogram settings in that file.", true);
        return;
      }
      Object.keys(clean).forEach((id) => {
        const el = $(id);
        if (!el) return;
        if (el.type === "checkbox") el.checked = clean[id];
        else el.value = clean[id];
      });
      // A preset can change the FFT/window/band settings, so whatever was
      // transformed under the old ones no longer describes the figure.
      ceAnalysis = null;
      ceColors = null;
      const b = $("btnCeDraw");
      if (b) b.disabled = true;
      const notes = [];
      if (unknown) notes.push(`${unknown} unknown setting(s) ignored`);
      if (invalid.length) notes.push(`${invalid.length} skipped (${invalid.join(", ")})`);
      if (clamped.length) notes.push(`${clamped.length} clamped (${clamped.join(", ")})`);
      ceStatus(
        `✔ Loaded ${n} setting(s)` +
          (notes.length ? "; " + notes.join("; ") : "") +
          " — press Analyze.",
      );
    } catch (e) {
      ceStatus("Could not read preset: " + e.message, true);
    } finally {
      const inp = $("cePresetFile");
      if (inp) inp.value = "";
    }
  }

  // Expose to the inline handlers in index.html
  window.ceRenderLibPicker = ceRenderLibPicker;
  window.ceFullRange = ceFullRange;
  window.ceAnalyze = ceAnalyze;
  window.ceDraw = ceDraw;
  window.ceRecolor = ceRecolor;
  window.ceInvalidate = ceInvalidate;
  window.ceExportSvg = ceExportSvg;
  window.ceExportPng = ceExportPng;
  window.ceExportRegions = ceExportRegions;
  window.ceCopyCitation = ceCopyCitation;
  window.cePlayToggle = cePlayToggle;
  window.ceStopPlay = ceStopPlay;
  window.ceSetSpeed = ceSetSpeed;
  window.ceZoomIn = ceZoomIn;
  window.ceZoomOut = ceZoomOut;
  window.ceZoomFull = ceZoomFull;
  window.ceExportPreset = ceExportPreset;
  window.ceImportPreset = ceImportPreset;
})();
