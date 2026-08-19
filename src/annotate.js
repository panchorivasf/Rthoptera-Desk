// ═══════════════════════════════════════════════════════════════════
// ANNOTATOR
// Label one species' motifs, with the frequency band treated as a
// per-species decision rather than a per-box one.
//
// Port of rthoptera-detect's annotation GUI (rthoptera_detect/gui.py and
// band.py), which was built to feed the training set and never shipped
// inside the app. Rthoptera Desk already owns the annotation store, the
// Raven round-trip, and the envelope peak→pulse→motif grouping, so what crosses
// over is the part it lacked: the interaction model, and the rules that
// decide what a selection *is*.
//
// ── The interaction model, and why it differs from Spectral Analysis ──
//
// Spectral Analysis draws boxes on the spectrogram. That is the natural
// thing to do and it is measuring the wrong object: a spectrogram is one
// fixed compromise between time and frequency resolution, so a box
// dragged on it records that compromise as much as it records the
// animal. Here the two axes are chosen where each can be measured
// honestly:
//
//   time       on the WAVEFORM, at sample resolution, with no window
//              length smearing the onsets. This is what the rhythm
//              features are read off.
//   frequency  on the POWER SPECTRUM of that time span, where a window
//              long enough to resolve the carrier costs nothing because
//              no time resolution is needed of it.
//   the box    is DISPLAYED on the spectrogram. Never drawn there.
//
// ── The band as a species-level decision ──
//
// An amplitude threshold — so many dB below the peak of the spectrum —
// derives the band automatically, and locking it freezes that band
// across every later selection and every later recording. So the band
// edges reaching a training table are one considered decision rather
// than a few hundred hand-drags of varying steadiness. The lock is what
// makes "auto" safe: without it, every new selection silently rewrites
// the band you settled on.
//
// A band derived from the whole view describes no species in particular
// — in a recording holding a cricket and a katydid it is neither
// animal's band — so it can be used but is refused a place on disk. That
// refusal is the one rule the earlier partial port (band_detect.js) left
// out, and it is the rule the whole file format exists to protect.
//
// ── What is reused rather than reimplemented ──
//
// The `annotations` array, `annotSnapshot`/`undoAnnot`, `refreshAnnotList`,
// `exportAnnotations`, `applyBandpass`, `fft`, `cmap`, and
// pkFindEnvPeaks/pkGroupPulses/pkGroupMotifs all come from main.js. A change
// to how Rthoptera groups envelope peaks changes this module too, and the two can
// never drift. The only local numerics are the ones that did not already
// exist: the Welch spectrum, the threshold band, a view-local
// spectrogram, and a band-limited envelope (pkComputeEnv reads the global
// rawSamples, so it can never be handed a filtered copy).
//
// The band profile JSON is byte-compatible with rthoptera-detect's
// BandProfile — same keys, same vocabulary — so a band chosen here is
// read by the Python feature extraction without a translation step.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);

  // ── constants ─────────────────────────────────────────────────────

  // The spectrogram window is a DURATION, not a sample count, converted
  // per file. Insect recordings run from 44.1 to 384 kHz, so a fixed
  // n_fft is a different analysis on every recorder: 1024 samples is
  // 2.7 ms at 384 kHz and 23 ms at 44.1 kHz, and the second is long
  // enough to fuse the pulses inside a pulse into one smear. 4 ms sits
  // below a typical inter-pulse interval while still resolving a carrier.
  const AN_WINDOW_S = 0.004;
  const AN_MAX_TIME_BINS = 1400;
  const AN_MAX_WAVE_POINTS = 2400;

  // The power spectrum is deliberately NOT run at the finest resolution
  // available. Individual animals and individual microphones put fine
  // structure in a spectrum that does not generalise — the band edges
  // should describe the species, not this wing or this recorder — so the
  // default window is short enough to smooth that away.
  const AN_PSD_NFFT_CHOICES = [256, 512, 1024, 2048, 4096, 8192];
  const AN_DB_FLOOR = -120;

  const AN_BAND_MODES = ["outer", "contiguous"];

  // Okabe–Ito, which stays distinguishable under every common form of
  // colour blindness. Assigned by label on first sight and stable
  // thereafter, so annotating a third species does not recolour the
  // first two and a table reloaded next week comes back the same.
  const AN_LABEL_COLORS = [
    "#56B4E9", // sky blue
    "#009E73", // bluish green
    "#CC79A7", // reddish purple
    "#F0E442", // yellow
    "#0072B2", // blue
    "#D55E00", // vermillion
    "#E69F00", // orange
  ];

  // ── state ─────────────────────────────────────────────────────────

  // Every decision the annotator makes. Kept as one object, separate
  // from the drawing, so the rules that decide what a selection is can
  // be reasoned about (and driven from a console) without the canvases.
  const st = {
    label: "motif",
    fMin: 0,
    fMax: 0, // set to Nyquist on first load
    thresholdDb: 20,
    bandMode: "outer",
    autoBand: true,
    lockBand: false,
    band: null, // [lo, hi] Hz
    // Where the current band came from. "view" means it was derived from
    // whatever is on screen rather than from a chosen motif, which in a
    // recording holding more than one species describes nothing in
    // particular — worth refusing to save.
    bandSource: "view",
    span: null, // [t0, t1] seconds — the pending selection's time extent
    psdNFft: 1024,
    // Set when a loaded profile names the window its band was derived
    // at, so the view can match it: the same edges mean something
    // different at a different resolution.
    psdNFftHint: null,
  };

  // View window, independent of Spectral Analysis's — that viewer is a
  // single DOM subtree that moves between tabs and cannot be in two
  // places, and coupling the zooms would mean panning here scrolls a
  // view the user is not looking at.
  const view = { t0: 0, dur: 0, f0: 0, f1: 0 };

  let anLabelColors = {}; // label -> colour, assigned on first sight
  let anPsd = null; // { power: Float64Array dB, freqs: Float64Array }
  let anPeakHz = null;
  let anSpecCache = null; // { key, cols, bins, db, fLo, fHi, min, max }
  let anWaveCache = null; // { key, times, lows, highs }
  let anSelIndex = null; // index into `annotations` of the clicked box
  let anNote = { text: "", ok: true, at: 0 };
  let anDrag = null;
  let anLastFile = "";
  let anStale = false;

  // ── numerics: spectra ─────────────────────────────────────────────

  function anCeilDiv(a, b) {
    return Math.ceil(a / b);
  }

  // Periodic Hann — the window scipy returns, and a different window
  // from the symmetric np.hanning. Matching it is what keeps a band
  // derived here identical to one derived in rthoptera-detect.
  function anHann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++)
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return w;
  }

  function anPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  // Power to dB, referenced to unity and floored — NOT normalised to the
  // maximum of this particular block. Normalising per block would make
  // the colour scale jump on every zoom and would make the spectra of
  // two different segments incomparable, which is exactly the comparison
  // a band is chosen by.
  function anToDb(p) {
    const floor = Math.pow(10, AN_DB_FLOOR / 10);
    return 10 * Math.log10(Math.max(p, floor));
  }

  // One-sided PSD of every frame of sig[lo..hi), max-pooled in groups of
  // `pool`. Returns { db: Float32Array(bins * cols), bins, cols }.
  //
  // Max-pooling rather than spacing the windows further apart is what
  // keeps a zoomed-out view honest: a brief pulse survives pooling,
  // where it would simply have fallen in the gap between two widely
  // spaced short windows and vanished from the display.
  function anStft(sig, lo, hi, nperseg, hop, pool) {
    const n = hi - lo;
    const bins = nperseg / 2 + 1;
    if (n < nperseg) return { db: new Float32Array(0), bins, cols: 0 };

    const frames = 1 + Math.floor((n - nperseg) / hop);
    const cols = anCeilDiv(frames, pool);
    const win = anHann(nperseg);
    let winPow = 0;
    for (let i = 0; i < nperseg; i++) winPow += win[i] * win[i];
    const scale = 1 / (sampleRate * winPow);

    const re = new Float64Array(nperseg);
    const im = new Float64Array(nperseg);
    const out = new Float32Array(bins * cols);
    const acc = new Float64Array(bins);

    for (let c = 0; c < cols; c++) {
      acc.fill(0);
      const fFrom = c * pool;
      const fTo = Math.min(fFrom + pool, frames);
      for (let f = fFrom; f < fTo; f++) {
        const start = lo + f * hop;
        for (let i = 0; i < nperseg; i++) {
          re[i] = sig[start + i] * win[i];
          im[i] = 0;
        }
        fft(re, im, nperseg);
        for (let k = 0; k < bins; k++) {
          let p = (re[k] * re[k] + im[k] * im[k]) * scale;
          // One-sided: everything but DC and Nyquist counts twice.
          if (k !== 0 && k !== bins - 1) p *= 2;
          if (p > acc[k]) acc[k] = p; // max-pool
        }
      }
      for (let k = 0; k < bins; k++) out[k * cols + c] = anToDb(acc[k]);
    }
    return { db: out, bins, cols };
  }

  // Choose (nperseg, hop, pool) for a view of n samples. Two regimes,
  // and the boundary between them is the point of this function.
  // Zoomed in, the window already gives fewer than maxBins columns, so
  // only the overlap is spent. Zoomed out, the hop widens to at most the
  // window — so consecutive windows still tile the signal rather than
  // skipping audio between them — and the surplus columns are pooled.
  function anPlanSpec(nSamples, nFft, maxBins) {
    nSamples = Math.max(1, nSamples);
    const nperseg = Math.max(8, Math.min(nFft, Math.max(8, nSamples)));
    const hop = Math.min(
      Math.max(nperseg >> 2, anCeilDiv(nSamples, maxBins)),
      nperseg,
    );
    const cols = anCeilDiv(Math.max(0, nSamples - nperseg), hop) + 1;
    return { nperseg, hop, pool: Math.max(1, anCeilDiv(cols, maxBins)) };
  }

  // Welch mean power spectrum of sig[lo..hi): the periodogram averaged
  // over 50%-overlapped Hann windows. Averaging is what stops a noisy
  // recording looking as though it has spectral structure it does not,
  // which matters because the band gets read off this plot by eye.
  //
  // nfft is clamped to the segment length, so selecting a single short
  // pulse gives a coarse but valid spectrum rather than an error.
  function anSpectrum(sig, lo, hi, nfft) {
    const n = hi - lo;
    if (n < 8) return null;
    // Rounded DOWN to a power of two, unlike the Python original: fft()
    // here is radix-2 where numpy's rfft takes any length. Rounding down
    // rather than up is what keeps the window inside the segment, so a
    // single short pulse still gives a coarse but valid spectrum.
    const want = Math.min(nfft, n);
    let size = anPow2(want);
    if (size > want) size >>= 1;
    const nperseg = Math.max(8, size);
    const hop = Math.max(1, nperseg >> 1);
    const bins = nperseg / 2 + 1;

    const win = anHann(nperseg);
    let winPow = 0;
    for (let i = 0; i < nperseg; i++) winPow += win[i] * win[i];

    const re = new Float64Array(nperseg);
    const im = new Float64Array(nperseg);
    const acc = new Float64Array(bins);
    let frames = 0;

    for (let start = lo; start + nperseg <= hi; start += hop) {
      for (let i = 0; i < nperseg; i++) {
        re[i] = sig[start + i] * win[i];
        im[i] = 0;
      }
      fft(re, im, nperseg);
      for (let k = 0; k < bins; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        acc[k] += k === 0 || k === bins - 1 ? p : 2 * p;
      }
      frames++;
    }
    if (!frames) return null;

    const scale = 1 / (sampleRate * winPow);
    const power = new Float64Array(bins);
    const freqs = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      power[k] = anToDb((acc[k] / frames) * scale);
      freqs[k] = (k * sampleRate) / nperseg;
    }
    return { power, freqs, nperseg };
  }

  // Carrier frequency to better than one bin. argmax can only ever name
  // a bin centre, so it is wrong by up to half a bin — 23 Hz at 1024
  // points and 48 kHz, the same order as the gap between two congeneric
  // species. Fitting a parabola through the envelope peak bin and its neighbours
  // recovers the true maximum to a few Hz.
  //
  // The fit is on the dB values, not linear power, and that is not
  // arbitrary: the main lobe of a windowed sinusoid is very nearly
  // parabolic in the log domain and distinctly not in the linear one. It
  // is the one place where the scale genuinely matters, and it points
  // the opposite way to intuition.
  function anRefinePeak(power, freqs) {
    if (!power.length) return null;
    let k = 0;
    for (let i = 1; i < power.length; i++) if (power[i] > power[k]) k = i;
    if (k === 0 || k === power.length - 1 || freqs.length < 2) return freqs[k];
    const a = power[k - 1],
      b = power[k],
      c = power[k + 1];
    const curve = a - 2 * b + c;
    if (curve === 0) return freqs[k]; // flat: no vertex to find
    const d = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve));
    return freqs[k] + d * (freqs[1] - freqs[0]);
  }

  // Where the spectrum crosses the cutoff between two adjacent bins.
  // Without this the band edges land only on bin centres, so a -20 dB
  // bandwidth is quantised to ~47 Hz steps however carefully it was
  // chosen.
  function anCross(freqs, power, inside, outside, cutoff) {
    const hi = power[inside],
      lo = power[outside];
    if (hi === lo) return freqs[inside];
    const f = (hi - cutoff) / (hi - lo);
    return freqs[inside] + f * (freqs[outside] - freqs[inside]);
  }

  // Band edges thrDb below the spectrum's peak, or null if the search
  // range is empty. Two ways to read the same threshold off the same
  // spectrum, and the choice is a claim about the species rather than a
  // display preference:
  //
  //   "outer"      the outermost crossings anywhere in the search range.
  //                A species whose harmonics carry real energy gets a
  //                band that spans them — but so does a band that
  //                happens to catch a different animal calling in the
  //                same window.
  //   "contiguous" walk out from the envelope peak and stop at the first crossing
  //                each side: the one lobe around the carrier, with
  //                harmonics and unrelated neighbours excluded. What you
  //                want when the carrier alone is diagnostic, or when
  //                the recording is busy.
  //
  // Both take the last bin still at or above the cutoff, so the two
  // agree exactly on a single-lobed spectrum and diverge only where
  // there is something else to find.
  //
  // fMin/fMax bound the search and matter more than they look:
  // low-frequency wind and handling noise routinely exceed an insect's
  // call in absolute level, and would otherwise capture the envelope peak and
  // drag the band down to DC.
  function anBandFromThreshold(power, freqs, thrDb, mode, fMin, fMax) {
    if (!power || !power.length || power.length !== freqs.length) return null;
    const idx = [];
    for (let i = 0; i < freqs.length; i++)
      if (freqs[i] >= fMin && freqs[i] <= fMax) idx.push(i);
    if (!idx.length) return null;

    let envPeak = idx[0];
    for (const i of idx) if (power[i] > power[envPeak]) envPeak = i;
    const cutoff = power[envPeak] - Math.abs(thrDb);
    const above = (i) => power[i] >= cutoff;
    const first = idx[0],
      last = idx[idx.length - 1];

    let loI, hiI;
    if (mode === "contiguous") {
      loI = envPeak;
      while (loI > first && above(loI - 1)) loI--;
      hiI = envPeak;
      while (hiI < last && above(hiI + 1)) hiI++;
    } else {
      const hits = idx.filter(above);
      loI = hits[0];
      hiI = hits[hits.length - 1];
    }

    // Interpolate only where there is a bin on the far side to cross
    // towards; at the edge of the search range the spectrum never came
    // back down, so the edge is the edge.
    let fLo = freqs[loI],
      fHi = freqs[hiI];
    if (loI > first) fLo = anCross(freqs, power, loI, loI - 1, cutoff);
    if (hiI < last) fHi = anCross(freqs, power, hiI, hiI + 1, cutoff);
    return fHi > fLo ? [fLo, fHi] : null;
  }

  // Band-limited RMS envelope, normalised 0–1 — the same contract as
  // pkComputeEnv, which cannot be reused because it reads the global
  // rawSamples and so can never be handed a filtered copy.
  function anEnvelope(sig, smoothMs) {
    const half = Math.max(1, Math.round((sampleRate * smoothMs) / 2000));
    const n = sig.length;
    const env = new Float32Array(n);
    let ss = 0;
    for (let i = 0; i < Math.min(half, n); i++) ss += sig[i] * sig[i];
    for (let i = 0; i < n; i++) {
      const ai = i + half,
        ri = i - half - 1;
      if (ai < n) ss += sig[ai] * sig[ai];
      if (ri >= 0) ss -= sig[ri] * sig[ri];
      const wl = Math.min(i + half, n - 1) - Math.max(i - half, 0) + 1;
      env[i] = Math.sqrt(Math.max(0, ss / wl));
    }
    let mx = 0;
    for (let i = 0; i < n; i++) if (env[i] > mx) mx = env[i];
    if (mx > 1e-10) for (let i = 0; i < n; i++) env[i] /= mx;
    return env;
  }

  // Min/max envelope of sig[lo..hi) for drawing. Plotting every sample
  // of a 384 kHz recording is both slow and a lie — the renderer decides
  // which samples survive. Taking the min and max of each bucket keeps
  // every envelope peak visible at any zoom level, which is what the time
  // selection is made against.
  function anDecimate(sig, lo, hi, maxPoints) {
    const n = hi - lo;
    if (n <= 0)
      return { lows: new Float32Array(0), highs: new Float32Array(0) };
    const count = Math.min(n, maxPoints);
    const lows = new Float32Array(count);
    const highs = new Float32Array(count);
    // Bucket edges are the view divided proportionally, NOT a fixed bucket
    // width with the remainder dropped: the drawing code places point b at
    // fraction (b + 0.5) / count of the pane, so any samples left out of the
    // last bucket would silently stretch the trace and slide it out of
    // register with the spectrogram and with the span it is being drawn
    // against — by a third of the view in the worst case.
    for (let b = 0; b < count; b++) {
      const from = lo + Math.floor((b * n) / count);
      const to = lo + Math.floor(((b + 1) * n) / count);
      let mn = Infinity,
        mx = -Infinity;
      for (let i = from; i < Math.max(to, from + 1); i++) {
        const v = sig[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      lows[b] = mn;
      highs[b] = mx;
    }
    return { lows, highs };
  }

  // ── rules ─────────────────────────────────────────────────────────

  // The box as it would be committed right now, or null if no time span
  // is marked. With no band chosen it spans the whole search range,
  // which is the honest reading of "I have not decided yet".
  function anPending() {
    if (!st.span) return null;
    const f = st.band || [st.fMin, st.fMax];
    return { t0: st.span[0], t1: st.span[1], f0: f[0], f1: f[1] };
  }

  function anSetSpan(a, b) {
    st.span = [Math.min(a, b), Math.max(a, b)];
  }

  // A drag on the spectrum beats the threshold, and it beats the lock
  // too: reaching for the spectrum is an unambiguous statement that the
  // current band is wrong. It also turns auto off, because leaving it on
  // would silently overwrite the drag on the next selection.
  function anSetBand(f0, f1) {
    st.band = [Math.min(f0, f1), Math.max(f0, f1)];
    st.bandSource = "manual";
    st.autoBand = false;
    anSyncControls();
  }

  // Re-derive the band from the current spectrum, honouring auto and
  // lock. Returns the band in force afterwards.
  function anDeriveBand() {
    if (!anPsd) return st.band;
    // A locked band is a decision already made for this species, so it
    // survives. That is the whole point of locking it.
    if (st.lockBand && st.band) return st.band;
    if (!st.autoBand) return st.band;
    // With nothing selected the spectrum on show is the whole view,
    // which must not be allowed to overwrite a band that was decided
    // from something specific — otherwise clearing the pending
    // selection silently rewrites it.
    if (!st.span && ["selection", "manual", "profile"].includes(st.bandSource))
      return st.band;

    const found = anBandFromThreshold(
      anPsd.power,
      anPsd.freqs,
      st.thresholdDb,
      st.bandMode,
      st.fMin,
      st.fMax,
    );
    if (found) {
      st.band = found;
      st.bandSource = st.span ? "selection" : "view";
    }
    anSyncControls();
    return st.band;
  }

  // Index into `annotations` of the box under a point, or null. Among
  // overlapping boxes the smallest is preferred — a short selection
  // inside a long one would otherwise be unreachable.
  function anSelectionAt(t, f) {
    const hits = [];
    annotations.forEach((a, i) => {
      if (t >= a.start && t <= a.end && f >= a.fLo && f <= a.fHi) hits.push(i);
    });
    if (!hits.length) return null;
    return hits.reduce((best, i) =>
      annotations[i].end - annotations[i].start <
      annotations[best].end - annotations[best].start
        ? i
        : best,
    );
  }

  // Take an existing selection's label and band as the current ones —
  // the way back from "I annotated forty motifs and never saved the
  // band". Deliberately does NOT touch the pending span: pointing it at
  // a box that already exists would draw a second, dashed rectangle on
  // top of that box, which then survives deselecting and leaves it
  // looking selected when it is not.
  function anAdoptSelection(i) {
    const a = annotations[i];
    if (!a) return;
    st.label = a.label || st.label;
    st.band = [a.fLo, a.fHi];
    st.bandSource = "selection";
    st.autoBand = false; // this band is a record, not something to re-derive
    anSyncControls();
  }

  // Commit automatically-found spans, skipping ones already annotated.
  // A proposal is skipped when more than half of it already lies inside
  // a selection carrying the SAME label — so running detection twice, or
  // running it over a stretch already done by hand, tops up rather than
  // duplicates. Overlap with a different species is not a conflict: two
  // animals can call in the same second.
  function anTriageDetections(spans, minOverlap = 0.5) {
    const keep = [];
    let skipped = 0;
    spans.forEach(([start, end]) => {
      if (end <= start) return;
      let covered = 0;
      annotations.forEach((a) => {
        if (a.label !== st.label) return;
        covered = Math.max(
          covered,
          Math.min(end, a.end) - Math.max(start, a.start),
        );
      });
      if (covered > 0 && covered / (end - start) > minOverlap) skipped++;
      else keep.push([start, end]);
    });
    return { keep, skipped };
  }

  function anCommitDetections(keep) {
    keep.forEach(([start, end]) => {
      annotations.push({
        id: nextAid++,
        start,
        end,
        fLo: st.band[0],
        fHi: st.band[1],
        label: st.label,
      });
    });
    return keep.length;
  }

  // ── band profiles ─────────────────────────────────────────────────

  function anSlug(name) {
    const slug = (name || "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return slug || "species";
  }

  // The current band as a saveable per-species decision, or null.
  //
  // The provenance fields are not decoration. A band derived at 20 dB
  // from three selections in one recording is a weaker claim than one
  // from forty across a season, and six months later nothing else will
  // tell you which you are looking at.
  //
  // Keys and vocabulary match rthoptera_detect.band.BandProfile exactly,
  // so the Python feature extraction reads this file unmodified.
  function anBandProfile() {
    if (!st.band) return null;
    return {
      species: st.label,
      f_lo: st.band[0],
      f_hi: st.band[1],
      // Only meaningful alongside auto: a hand-drawn band was not
      // derived at any threshold, and recording one would invite
      // somebody to reproduce it and get a different answer.
      threshold_db: st.autoBand ? st.thresholdDb : null,
      band_mode: st.autoBand ? st.bandMode : null,
      band_source: st.bandSource,
      search_f_min: st.fMin,
      search_f_max: st.fMax,
      psd_n_fft: st.psdNFft,
      peak_hz: anPeakHz,
      // Only this species' selections. One recording routinely holds
      // several species, and a band's provenance is worthless if it
      // counts the ones annotated for something else.
      n_selections: annotations.filter((a) => a.label === st.label).length,
      source: anLastFile || currentAudioFileName || "",
      created: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    };
  }

  // Adopt a saved band: same species, same edges, locked so it cannot
  // drift. A band read from a file is a decision already made;
  // re-deriving it from whatever spectrum happens to load next would
  // silently discard it.
  function anApplyBandProfile(p) {
    st.label = p.species;
    st.band = [p.f_lo, p.f_hi];
    st.bandSource = "profile";
    if (p.threshold_db != null && isFinite(p.threshold_db))
      st.thresholdDb = p.threshold_db;
    if (AN_BAND_MODES.includes(p.band_mode)) st.bandMode = p.band_mode;
    if (p.psd_n_fft) st.psdNFftHint = p.psd_n_fft | 0;
    if (p.search_f_min != null && isFinite(p.search_f_min))
      st.fMin = p.search_f_min;
    if (p.search_f_max != null && isFinite(p.search_f_max))
      st.fMax = p.search_f_max;
    st.autoBand = false;
    st.lockBand = true;
  }

  async function anSaveBand() {
    const p = anBandProfile();
    if (!p) {
      anSay("no band yet — drag a time span, or drag on the spectrum", false);
      return;
    }
    // Derived from everything on screen, which in a recording holding
    // two species is neither species' band.
    if (p.band_source === "view") {
      anSay(
        "band came from the whole view — select one clear motif first",
        false,
      );
      return;
    }
    try {
      await dlFile(
        anSlug(p.species) + ".band.json",
        JSON.stringify(p, null, 2) + "\n",
        "application/json",
        { exactName: true },
      );
      anSay(
        "saved band " +
          Math.round(p.f_lo) +
          "–" +
          Math.round(p.f_hi) +
          " Hz for " +
          p.species,
      );
      log("Saved band profile for " + p.species, "ok");
    } catch (e) {
      anSay("save failed: " + e.message, false);
    }
  }

  function anIngestProfile(text) {
    let p;
    try {
      p = JSON.parse(text);
    } catch (e) {
      anSay("not valid JSON: " + e.message, false);
      return;
    }
    // Tolerant on purpose: these files are meant to be hand-edited and
    // to outlive the code that wrote them, so an unrecognised key is not
    // a reason to refuse one. Only the three that define a band are
    // required.
    if (
      !p.species ||
      !isFinite(p.f_lo) ||
      !isFinite(p.f_hi) ||
      p.f_hi <= p.f_lo
    ) {
      anSay("band profile needs species, f_lo and a larger f_hi", false);
      return;
    }
    anApplyBandProfile(p);
    anSyncControls();
    anRecomputePsd();
    anRedraw();
    anRefreshList();
    anSay(
      "loaded " +
        Math.round(p.f_lo) +
        "–" +
        Math.round(p.f_hi) +
        " Hz for " +
        p.species +
        " (locked)",
    );
    if (st.psdNFftHint && st.psdNFftHint !== st.psdNFft)
      log(
        "Band was derived at " +
          st.psdNFftHint +
          "-point resolution; the spectrum here is at " +
          st.psdNFft,
        "warn",
      );
  }

  async function anLoadBand() {
    // Tauri gets a real file dialog; a plain browser (dev) falls back to
    // a hidden file input rather than failing outright.
    if (window.__TAURI__?.dialog) {
      try {
        const path = await window.__TAURI__.dialog.open({
          multiple: false,
          filters: [{ name: "Band profile", extensions: ["json"] }],
        });
        if (!path) return;
        const bytes = await window.__TAURI__.fs.readFile(path);
        anIngestProfile(new TextDecoder().decode(bytes));
      } catch (e) {
        anSay("could not read band profile: " + e.message, false);
      }
      return;
    }
    const input = $("anBandFile");
    if (input) input.click();
  }

  // ── labels ────────────────────────────────────────────────────────

  // Colour for a species label, assigned on first sight and stable
  // thereafter — keyed off the label rather than its position, so
  // annotating a third species does not recolour the first two.
  function anColorFor(label) {
    if (!(label in anLabelColors))
      anLabelColors[label] =
        AN_LABEL_COLORS[
          Object.keys(anLabelColors).length % AN_LABEL_COLORS.length
        ];
    return anLabelColors[label];
  }

  function anLabelsInUse() {
    const seen = [];
    [...annotations]
      .sort((a, b) => a.start - b.start)
      .forEach((a) => {
        const l = a.label || "motif";
        if (!seen.includes(l)) seen.push(l);
      });
    return seen;
  }

  // ── small helpers ─────────────────────────────────────────────────

  function anNum(id, fallback) {
    const v = parseFloat($(id)?.value);
    return isFinite(v) ? v : fallback;
  }

  function anNyq() {
    return (sampleRate || 2) / 2;
  }

  // One-off feedback about an action, shown next to the buttons and
  // allowed to expire. Kept off the main log, which is a running record
  // rather than an answer to "did that work?".
  function anSay(text, ok = true) {
    anNote = { text, ok, at: Date.now() };
    const el = $("anNote");
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? "var(--green)" : "var(--amber)";
    const stamp = anNote.at;
    setTimeout(() => {
      if (anNote.at === stamp && $("anNote")) $("anNote").textContent = "";
    }, 6000);
  }

  function anReady() {
    return !!(rawSamples && rawSamples.length && sampleRate);
  }

  // ── derived data ──────────────────────────────────────────────────

  function anSampleRange(t0, t1) {
    const n = rawSamples.length;
    const lo = Math.max(0, Math.min(n, Math.floor(t0 * sampleRate)));
    const hi = Math.max(lo, Math.min(n, Math.ceil(t1 * sampleRate)));
    return [lo, hi];
  }

  // The span the power spectrum describes: the marked selection if there
  // is one, otherwise the visible view. Which of the two it was is what
  // `bandSource` records, and what decides whether the band may be saved.
  function anPsdSpan() {
    return st.span || [view.t0, view.t0 + view.dur];
  }

  function anRecomputePsd() {
    if (!anReady()) {
      anPsd = null;
      anPeakHz = null;
      return;
    }
    const [t0, t1] = anPsdSpan();
    const [lo, hi] = anSampleRange(t0, t1);
    const spec = anSpectrum(rawSamples, lo, hi, st.psdNFft);
    if (!spec) {
      anPsd = null;
      anPeakHz = null;
      return;
    }
    anPsd = spec;
    anPeakHz = anRefinePeak(spec.power, spec.freqs);
  }

  function anRecomputeSpec() {
    if (!anReady()) {
      anSpecCache = null;
      return;
    }
    const [lo, hi] = anSampleRange(view.t0, view.t0 + view.dur);
    const nFft = Math.max(
      128,
      Math.min(8192, anPow2(Math.round(AN_WINDOW_S * sampleRate))),
    );
    const plan = anPlanSpec(hi - lo, nFft, AN_MAX_TIME_BINS);
    const key = [lo, hi, plan.nperseg, plan.hop, plan.pool].join(":");
    if (anSpecCache && anSpecCache.key === key) return;

    const s = anStft(rawSamples, lo, hi, plan.nperseg, plan.hop, plan.pool);
    if (!s.cols) {
      anSpecCache = null;
      return;
    }
    let mn = Infinity,
      mx = -Infinity;
    for (let i = 0; i < s.db.length; i++) {
      const v = s.db[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    // The frames stop short of the end of the slice by up to one window
    // plus a hop, so the image covers slightly less time than the view.
    // Recording where it starts and ends is what keeps a box drawn at
    // 1.2340 s sitting over the pulse at 1.2340 s.
    const frames = 1 + Math.floor((hi - lo - plan.nperseg) / plan.hop);
    anSpecCache = {
      key,
      db: s.db,
      bins: s.bins,
      cols: s.cols,
      binHz: sampleRate / plan.nperseg,
      t0: lo / sampleRate,
      t1: (lo + (frames - 1) * plan.hop + plan.nperseg) / sampleRate,
      min: mn,
      max: mx,
    };
  }

  function anRecomputeWave() {
    if (!anReady()) {
      anWaveCache = null;
      return;
    }
    const [lo, hi] = anSampleRange(view.t0, view.t0 + view.dur);
    const key = lo + ":" + hi;
    if (anWaveCache && anWaveCache.key === key) return;
    const d = anDecimate(rawSamples, lo, hi, AN_MAX_WAVE_POINTS);
    anWaveCache = { key, lows: d.lows, highs: d.highs };
  }

  // ── drawing ───────────────────────────────────────────────────────

  function anCanvas(id) {
    const cv = $(id);
    if (!cv) return null;
    const w = cv.clientWidth || 720;
    const h = cv.clientHeight || 120;
    if (!w || !h) return null;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  const anTx = (t, w) => ((t - view.t0) / view.dur) * w;
  const anXt = (x, w) => view.t0 + (x / w) * view.dur;
  const anFy = (f, h) => h * (1 - (f - view.f0) / (view.f1 - view.f0));
  const anYf = (y, h) => view.f0 + (1 - y / h) * (view.f1 - view.f0);

  function anDrawWave() {
    const c = anCanvas("anWave");
    if (!c) return;
    const { g, w, h } = c;
    g.fillStyle = "#0a0d12";
    g.fillRect(0, 0, w, h);
    if (!anReady() || !anWaveCache) return;

    const mid = h / 2;
    let envPeak = 1e-9;
    const { lows, highs } = anWaveCache;
    for (let i = 0; i < lows.length; i++) {
      envPeak = Math.max(envPeak, Math.abs(lows[i]), Math.abs(highs[i]));
    }
    const sc = (mid - 2) / envPeak;

    // The marked span is drawn under the trace, not over it: the point
    // of this pane is judging onsets, and a translucent wash across them
    // is exactly what you do not want on top.
    if (st.span) {
      const x0 = anTx(st.span[0], w),
        x1 = anTx(st.span[1], w);
      g.fillStyle = "rgba(88,166,255,0.18)";
      g.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    g.strokeStyle = "#7ee787";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < lows.length; i++) {
      const x = ((i + 0.5) / lows.length) * w;
      g.moveTo(x, mid - highs[i] * sc);
      g.lineTo(x, mid - lows[i] * sc);
    }
    g.stroke();

    if (st.span) {
      g.strokeStyle = "#58a6ff";
      g.lineWidth = 1;
      [st.span[0], st.span[1]].forEach((t) => {
        const x = anTx(t, w);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      });
    }

    g.fillStyle = "#8b949e";
    g.font = "10px Consolas, monospace";
    g.fillText("waveform — drag to set the time span", 5, 11);
  }

  function anDrawSpec() {
    const c = anCanvas("anSpec");
    if (!c) return;
    const { g, w, h } = c;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);

    if (anReady() && anSpecCache) {
      const { db, bins, cols, binHz, max } = anSpecCache;
      const kLo = Math.max(0, Math.floor(view.f0 / binHz));
      const kHi = Math.min(bins - 1, Math.ceil(view.f1 / binHz));
      const rows = Math.max(1, kHi - kLo + 1);
      const range = anNum("anDbRange", 70);
      const floor = max - range;
      const cmapName = $("anCmap")?.value || "inferno";

      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const og = off.getContext("2d");
      const img = og.createImageData(cols, rows);
      for (let r = 0; r < rows; r++) {
        const k = kHi - r; // row 0 is the top of the image = highest freq
        for (let x = 0; x < cols; x++) {
          const t = Math.max(
            0,
            Math.min(1, (db[k * cols + x] - floor) / range),
          );
          const [rr, gg, bb] = cmap(t, cmapName);
          const p = (r * cols + x) * 4;
          img.data[p] = rr;
          img.data[p + 1] = gg;
          img.data[p + 2] = bb;
          img.data[p + 3] = 255;
        }
      }
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      // Both axes are placed by value, not stretched to fill: the rows
      // cover kLo..kHi bin centres and the columns cover t0..t1, neither
      // of which is the whole pane.
      const ix = anTx(anSpecCache.t0, w);
      const iw = Math.max(1, anTx(anSpecCache.t1, w) - ix);
      const iyTop = anFy(kHi * binHz, h);
      const ih = Math.max(1, anFy(kLo * binHz, h) - iyTop);
      g.drawImage(off, ix, iyTop, iw, ih);
    }

    // Committed boxes, coloured by species.
    annotations.forEach((a, i) => {
      const x0 = anTx(a.start, w),
        x1 = anTx(a.end, w);
      if (x1 < -20 || x0 > w + 20) return;
      const y0 = anFy(a.fHi, h),
        y1 = anFy(a.fLo, h);
      const col = anColorFor(a.label || "motif");
      const sel = i === anSelIndex;
      g.strokeStyle = col;
      g.lineWidth = sel ? 2.5 : 1.2;
      g.strokeRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      if (sel) {
        g.fillStyle = col + "33";
        g.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
      if (x1 - x0 > 26) {
        g.fillStyle = col;
        g.font = "10px Consolas, monospace";
        g.fillText(a.label || "motif", x0 + 2, Math.max(10, y0 - 3));
      }
    });

    // The pending box, dashed — not yet part of the table.
    const p = anPending();
    if (p) {
      const x0 = anTx(p.t0, w),
        x1 = anTx(p.t1, w);
      const y0 = anFy(p.f1, h),
        y1 = anFy(p.f0, h);
      g.strokeStyle = "#58a6ff";
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.strokeRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      g.setLineDash([]);
    }

    // Frequency ticks.
    g.fillStyle = "rgba(230,237,243,0.75)";
    g.font = "10px Consolas, monospace";
    for (let i = 0; i <= 4; i++) {
      const f = view.f0 + ((view.f1 - view.f0) * i) / 4;
      const y = anFy(f, h);
      g.fillText(
        (f / 1000).toFixed(1) + "k",
        3,
        Math.max(9, Math.min(h - 2, y - 2)),
      );
    }
    g.fillStyle = "rgba(230,237,243,0.55)";
    g.fillText(
      "spectrogram — click a box to select; boxes are not drawn here",
      42,
      11,
    );
  }

  function anDrawPsd() {
    const c = anCanvas("anPsd");
    if (!c) return;
    const { g, w, h } = c;
    g.fillStyle = "#0a0d12";
    g.fillRect(0, 0, w, h);
    if (!anPsd) {
      g.fillStyle = "#8b949e";
      g.font = "10px Consolas, monospace";
      g.fillText("load audio to see the power spectrum", 5, 14);
      return;
    }

    const fMin = st.fMin,
      fMax = st.fMax;
    const idx = [];
    for (let i = 0; i < anPsd.freqs.length; i++)
      if (anPsd.freqs[i] >= fMin && anPsd.freqs[i] <= fMax) idx.push(i);
    if (idx.length < 2) return;

    let vTop = -Infinity;
    for (const i of idx) if (anPsd.power[i] > vTop) vTop = anPsd.power[i];

    // Linear is drawn as a fraction of the envelope peak: raw power density is
    // ~1e-4 and renders as unreadable tick labels, and the number that
    // matters here is relative anyway — the -20 dB cutoff sits at 0.01.
    //
    // dB compresses the vertical range so a 40 dB-down noise floor still
    // occupies half the plot and every species looks like a broad hump;
    // linear puts everything 20 dB down at 1% of envelope peak height, so the
    // carrier reads as a spike and the shoulders are unmistakable.
    // Neither changes a single number that gets saved.
    const linear = $("anScale")?.value === "linear";
    const val = (i) =>
      linear ? Math.pow(10, (anPsd.power[i] - vTop) / 10) : anPsd.power[i];

    let vMin, vMax;
    if (linear) {
      vMin = 0;
      vMax = 1.05;
    } else {
      vMin = Infinity;
      vMax = -Infinity;
      for (const i of idx) {
        const v = val(i);
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
      vMin -= 2;
      vMax += 3;
    }

    const x = (f) => ((f - fMin) / (fMax - fMin)) * w;
    const y = (v) => h - ((v - vMin) / (vMax - vMin)) * h;

    if (st.band) {
      const col = anColorFor(st.label);
      g.fillStyle = col + "28";
      g.fillRect(
        x(st.band[0]),
        0,
        Math.max(1, x(st.band[1]) - x(st.band[0])),
        h,
      );
      g.strokeStyle = col;
      g.lineWidth = 1;
      [st.band[0], st.band[1]].forEach((f) => {
        g.beginPath();
        g.moveTo(x(f), 0);
        g.lineTo(x(f), h);
        g.stroke();
      });
    }

    if (st.autoBand) {
      const cutoff = linear
        ? Math.pow(10, -Math.abs(st.thresholdDb) / 10)
        : vTop - Math.abs(st.thresholdDb);
      g.strokeStyle = "rgba(120,220,150,0.85)";
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(0, y(cutoff));
      g.lineTo(w, y(cutoff));
      g.stroke();
      g.setLineDash([]);
    }

    g.strokeStyle = "#58a6ff";
    g.lineWidth = 1.2;
    g.beginPath();
    idx.forEach((i, n) => {
      const px = x(anPsd.freqs[i]),
        py = y(val(i));
      if (n === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();

    if (anPeakHz != null && anPeakHz >= fMin && anPeakHz <= fMax) {
      g.strokeStyle = "rgba(235,90,90,0.9)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x(anPeakHz), 0);
      g.lineTo(x(anPeakHz), h);
      g.stroke();
      g.setLineDash([]);
    }

    g.fillStyle = "#8b949e";
    g.font = "10px Consolas, monospace";
    for (let t = 0; t <= 4; t++) {
      const f = fMin + ((fMax - fMin) * t) / 4;
      g.fillText(
        (f / 1000).toFixed(1) + " kHz",
        Math.min(x(f) + 3, w - 48),
        h - 4,
      );
    }
    g.fillText(linear ? "power / envelope peak" : "dB", 4, 11);
    g.fillText(
      st.span
        ? "spectrum of the marked span — drag to set the band"
        : "spectrum of the whole view",
      4,
      23,
    );
  }

  function anRedraw() {
    anRecomputeWave();
    anRecomputeSpec();
    anDrawWave();
    anDrawSpec();
    anDrawPsd();
    anUpdateReadout();
  }

  function anUpdateReadout() {
    const el = $("anReadout");
    if (!el) return;
    if (!anReady()) {
      el.textContent = "No audio loaded.";
      return;
    }
    const parts = [];
    parts.push(
      "view " +
        view.t0.toFixed(3) +
        "–" +
        (view.t0 + view.dur).toFixed(3) +
        " s",
    );
    if (st.span)
      parts.push(
        "span " +
          st.span[0].toFixed(4) +
          "–" +
          st.span[1].toFixed(4) +
          " s (" +
          ((st.span[1] - st.span[0]) * 1000).toFixed(1) +
          " ms)",
      );
    else parts.push("no span marked");
    if (anPeakHz != null) parts.push("carrier " + Math.round(anPeakHz) + " Hz");
    if (st.band)
      parts.push(
        "band " +
          Math.round(st.band[0]) +
          "–" +
          Math.round(st.band[1]) +
          " Hz (" +
          Math.round(st.band[1] - st.band[0]) +
          " Hz, " +
          st.bandSource +
          ")",
      );
    else parts.push("no band");
    el.textContent = parts.join("     ");
  }

  // ── controls ↔ state ──────────────────────────────────────────────

  // One direction only: state → widgets. Everything that changes state
  // goes through a named handler, so there is exactly one place per
  // decision where it can be written.
  function anSyncControls() {
    const set = (id, v) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("anLabel", st.label);
    set("anFMin", Math.round(st.fMin));
    set("anFMax", Math.round(st.fMax));
    set("anThreshold", st.thresholdDb);
    set("anMode", st.bandMode);
    set("anPsdFft", String(st.psdNFft));
    set("anBandLo", st.band ? st.band[0].toFixed(1) : "");
    set("anBandHi", st.band ? st.band[1].toFixed(1) : "");
    const auto = $("anAuto"),
      lock = $("anLock");
    if (auto) auto.checked = st.autoBand;
    if (lock) lock.checked = st.lockBand;
    const swatch = $("anSwatch");
    if (swatch) swatch.style.background = anColorFor(st.label);
    anUpdateReadout();
  }

  // ── interaction ───────────────────────────────────────────────────

  function anZoomTime(cvId, e) {
    const cv = $(cvId);
    const w = cv.clientWidth || 1;
    const tc = anXt(e.offsetX, w);
    const factor = e.deltaY > 0 ? 1.3 : 0.77;
    const nd = Math.min(duration, Math.max(0.002, view.dur * factor));
    view.dur = nd;
    view.t0 = Math.max(0, Math.min(tc - (nd * e.offsetX) / w, duration - nd));
    if (!st.span) anRecomputePsd();
    anRedraw();
  }

  function anAttachWave() {
    const cv = $("anWave");
    if (!cv || cv._anWired) return;
    cv._anWired = true;
    cv.style.cursor = "crosshair";

    cv.addEventListener("mousedown", (e) => {
      if (!anReady()) return;
      const w = cv.clientWidth;
      if (e.shiftKey) {
        anDrag = { kind: "pan", x: e.offsetX, t0: view.t0 };
        cv.style.cursor = "grabbing";
        return;
      }
      anDrag = { kind: "span", anchor: anXt(e.offsetX, w), moved: false };
    });

    cv.addEventListener("mousemove", (e) => {
      const w = cv.clientWidth;
      if (!anDrag) return;
      if (e.buttons === 0) {
        anDrag = null;
        cv.style.cursor = "crosshair";
        return;
      }
      if (anDrag.kind === "pan") {
        const dt = ((e.offsetX - anDrag.x) / w) * view.dur;
        view.t0 = Math.max(0, Math.min(anDrag.t0 - dt, duration - view.dur));
        anRedraw();
        return;
      }
      // 3 px of slop so a click with a shaky hand stays a click.
      if (Math.abs(anXt(e.offsetX, w) - anDrag.anchor) * (w / view.dur) > 3)
        anDrag.moved = true;
      if (anDrag.moved) {
        anSetSpan(anDrag.anchor, anXt(e.offsetX, w));
        anDrawWave();
        anDrawSpec();
        anUpdateReadout();
      }
    });

    cv.addEventListener("mouseup", () => {
      if (!anDrag) return;
      const kind = anDrag.kind,
        moved = anDrag.moved;
      anDrag = null;
      cv.style.cursor = "crosshair";
      if (kind !== "span") return;
      if (!moved) {
        // A plain click clears the span. Clearing keeps the band — the
        // band belongs to the species, not to this one selection.
        st.span = null;
        anSelIndex = null;
      }
      anRecomputePsd();
      anDeriveBand();
      anRedraw();
    });

    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (anReady()) anZoomTime("anWave", e);
      },
      { passive: false },
    );
  }

  function anAttachSpec() {
    const cv = $("anSpec");
    if (!cv || cv._anWired) return;
    cv._anWired = true;
    cv.style.cursor = "default";

    // Click selects a committed box and adopts its label and band. There
    // is deliberately no drag-to-draw here: see the header.
    cv.addEventListener("click", (e) => {
      if (!anReady()) return;
      const w = cv.clientWidth,
        h = cv.clientHeight;
      const i = anSelectionAt(anXt(e.offsetX, w), anYf(e.offsetY, h));
      anSelIndex = i;
      if (i != null) {
        anAdoptSelection(i);
        const a = annotations[i];
        anSay(
          "selected #" +
            a.id +
            " (" +
            (a.label || "motif") +
            ") — its band is now current",
        );
        // Show that selection's spectrum without making it pending.
        const [lo, hi] = anSampleRange(a.start, a.end);
        const spec = anSpectrum(rawSamples, lo, hi, st.psdNFft);
        if (spec) {
          anPsd = spec;
          anPeakHz = anRefinePeak(spec.power, spec.freqs);
        }
      }
      anRefreshList();
      anRedraw();
    });

    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!anReady()) return;
        if (e.ctrlKey) {
          const h = cv.clientHeight;
          const f = anYf(e.offsetY, h);
          const range = view.f1 - view.f0;
          const factor = e.deltaY > 0 ? 1.3 : 0.77;
          const nr = Math.min(
            anNyq(),
            Math.max(anNyq() * 0.005, range * factor),
          );
          view.f0 = Math.max(0, f - nr / 2);
          view.f1 = Math.min(anNyq(), view.f0 + nr);
          if (view.f1 >= anNyq()) {
            view.f1 = anNyq();
            view.f0 = Math.max(0, view.f1 - nr);
          }
          anRedraw();
        } else anZoomTime("anSpec", e);
      },
      { passive: false },
    );
  }

  function anAttachPsd() {
    const cv = $("anPsd");
    if (!cv || cv._anWired) return;
    cv._anWired = true;
    cv.style.cursor = "col-resize";
    const xf = (x) =>
      st.fMin + (x / (cv.clientWidth || 1)) * (st.fMax - st.fMin);

    cv.addEventListener("mousedown", (e) => {
      if (!anPsd) return;
      anDrag = { kind: "band", anchor: xf(e.offsetX), moved: false };
    });
    cv.addEventListener("mousemove", (e) => {
      if (!anDrag || anDrag.kind !== "band") return;
      if (e.buttons === 0) {
        anDrag = null;
        return;
      }
      const f = xf(e.offsetX);
      if (Math.abs(f - anDrag.anchor) > (st.fMax - st.fMin) / 200)
        anDrag.moved = true;
      if (anDrag.moved) {
        st.band = [Math.min(anDrag.anchor, f), Math.max(anDrag.anchor, f)];
        anDrawPsd();
        anDrawSpec();
        anUpdateReadout();
      }
    });
    cv.addEventListener("mouseup", () => {
      if (!anDrag || anDrag.kind !== "band") return;
      const moved = anDrag.moved;
      anDrag = null;
      if (!moved || !st.band) return;
      // st.band already holds the dragged edges; this only records what
      // the drag MEANT — a deliberate band, so stop re-deriving one.
      anSetBand(st.band[0], st.band[1]);
      anRedraw();
      anSay("band set by hand — auto is off");
    });
  }

  // ── actions ───────────────────────────────────────────────────────

  function anAdd() {
    const p = anPending();
    if (!p) {
      anSay("no time span marked — drag on the waveform", false);
      return;
    }
    annotSnapshot("add annotation");
    const a = {
      id: nextAid++,
      start: p.t0,
      end: p.t1,
      fLo: p.f0,
      fHi: p.f1,
      label: st.label,
    };
    annotations.push(a);
    // Keeps the band, drops the span: the band belongs to the species,
    // so the next motif of the same animal needs only a time drag.
    st.span = null;
    anSelIndex = null;
    anAfterChange();
    anSay(
      "added #" +
        a.id +
        " as ‘" +
        a.label +
        "’ — " +
        ((a.end - a.start) * 1000).toFixed(1) +
        " ms, " +
        Math.round(a.fLo) +
        "–" +
        Math.round(a.fHi) +
        " Hz",
    );
  }

  function anUndo() {
    // Rides main.js's snapshot undo rather than keeping a second stack,
    // so undoing here also puts back what Spectral Analysis removed and
    // the two histories can never disagree about what the table holds.
    undoAnnot();
    anSelIndex = null;
    anAfterChange(false);
  }

  function anClearSpan() {
    st.span = null;
    anSelIndex = null;
    anRecomputePsd();
    anRedraw();
    anSay("span cleared — the band is kept");
  }

  function anDeleteSelected() {
    if (anSelIndex == null || !annotations[anSelIndex]) {
      anSay("click a box on the spectrogram to select it", false);
      return;
    }
    const a = annotations[anSelIndex];
    deleteAnnot(a.id);
    anSelIndex = null;
    anAfterChange(false);
    anSay("deleted #" + a.id);
  }

  // Everything that mutates `annotations` funnels through here, so the
  // app-wide list, the spectrogram, and this tab's own list can never
  // show three different tables.
  function anAfterChange(redrawApp = true) {
    if (typeof refreshAnnotList === "function") refreshAnnotList();
    anRefreshList();
    anRedraw();
    if (redrawApp && typeof render === "function") render();
  }

  // ── detection ─────────────────────────────────────────────────────

  // Band-pass samples[lo..hi), group its pulses into motifs with
  // Rthoptera's own grouping, and commit each one.
  function anDetectBetween(lo, hi, where) {
    if (!st.band) {
      anSay("no band yet — select a motif, or load a band", false);
      return;
    }
    if (hi - lo < 64) {
      anSay("nothing to detect in " + where, false);
      return;
    }
    const slice = rawSamples.subarray
      ? rawSamples.subarray(lo, hi)
      : rawSamples.slice(lo, hi);
    const filtered = applyBandpass(slice, sampleRate, st.band[0], st.band[1]);
    const env = anEnvelope(filtered, anNum("anSmooth", 1));
    const envPeaks = pkFindEnvPeaks(
      env,
      anNum("anEnvPeakWin", 1),
      anNum("anEnvPeakThr", 10),
      anNum("anDetThr", 5),
      null,
      0,
    );
    if (!envPeaks.length) {
      anSay("no envelope peaks inside this band — lower the detection threshold", false);
      return;
    }
    const pulses = pkGroupPulses(
      envPeaks,
      anNum("anEnvPeakGap", 30),
      null,
      false,
      0,
      0,
    );
    const motifs = pkGroupMotifs(pulses, anNum("anPulseGap", 200));
    // Envelope peak times are relative to the slice handed to pkFindEnvPeaks.
    const t0 = lo / sampleRate;
    const pad = typeof pkPulsePadSec === "function" ? pkPulsePadSec() : 0.0005;

    const spans = motifs
      .map((m) => {
        const lastPulse = m[m.length - 1];
        return [
          Math.max(0, t0 + m[0][0].time - pad),
          Math.min(
            duration || Infinity,
            t0 + lastPulse[lastPulse.length - 1].time + pad,
          ),
        ];
      })
      .filter(([a, b]) => b > a);

    // Triaged before the snapshot: a run that adds nothing should not
    // leave an undo step that appears to do nothing when pressed.
    const { keep, skipped } = anTriageDetections(spans);
    let added = 0;
    if (keep.length) {
      annotSnapshot("detect in " + where);
      added = anCommitDetections(keep);
      anAfterChange();
    }
    anSay(
      "detected " +
        added +
        " motifs as ‘" +
        st.label +
        "’ in " +
        where +
        (skipped ? ", " + skipped + " already annotated" : "") +
        (added || skipped ? "" : " — try a lower threshold or a wider band"),
      !!added,
    );
    log(
      "Annotator: " + added + " motifs added as " + st.label,
      added ? "ok" : "warn",
    );
  }

  function anDetectView() {
    if (!anReady()) {
      anSay("load audio first", false);
      return;
    }
    const [lo, hi] = anSampleRange(view.t0, view.t0 + view.dur);
    anDetectBetween(lo, hi, "this view");
  }

  // Detect inside the marked span only — narrower than the view, which
  // is what you want when only part of what is on screen is worth
  // searching: a stretch where the animal is close and clean, with a
  // noisy neighbour left out rather than detected and deleted afterwards.
  function anDetectSelection() {
    if (!anReady()) {
      anSay("load audio first", false);
      return;
    }
    const span =
      st.span ||
      (annotations[anSelIndex] && [
        annotations[anSelIndex].start,
        annotations[anSelIndex].end,
      ]);
    if (!span) {
      anSay(
        "no time span marked — drag on the waveform, or click a box",
        false,
      );
      return;
    }
    const [lo, hi] = anSampleRange(span[0], span[1]);
    anDetectBetween(lo, hi, "the selection");
  }

  // ── selection list ────────────────────────────────────────────────

  function anRefreshList() {
    const host = $("anList");
    if (!host) return;
    host.innerHTML = "";
    const labels = anLabelsInUse();
    labels.forEach(anColorFor); // stable colours, first-appearance order

    // Species picker options, so a name typed once never has to be
    // typed again — the single commonest source of label typos, and a
    // typo here silently splits one species into two in the training set.
    const dl = $("anLabelList");
    if (dl) {
      dl.innerHTML = "";
      labels.forEach((l) => {
        const o = document.createElement("option");
        o.value = l;
        dl.appendChild(o);
      });
    }

    const legend = $("anLegend");
    if (legend) {
      legend.innerHTML = "";
      labels.forEach((l) => {
        const n = annotations.filter((a) => (a.label || "motif") === l).length;
        const s = document.createElement("span");
        s.style.cssText =
          "display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--txt2)";
        s.innerHTML =
          '<span style="width:9px;height:9px;border-radius:2px;background:' +
          anColorFor(l) +
          '"></span>' +
          l +
          " (" +
          n +
          ")";
        legend.appendChild(s);
      });
      if (!labels.length)
        legend.innerHTML =
          '<span style="font-size:11px;color:var(--txt2)">No selections yet.</span>';
    }

    anRefreshRelabelOptions();

    const count = $("anCount");
    if (count)
      count.textContent = annotations.length
        ? annotations.length +
          " selection" +
          (annotations.length === 1 ? "" : "s")
        : "";

    const order = annotations
      .map((a, i) => ({ a, i }))
      .sort((p, q) => p.a.start - q.a.start);
    order.forEach(({ a, i }) => {
      const row = document.createElement("div");
      row.className = "arow" + (i === anSelIndex ? " sel" : "");
      row.style.gridTemplateColumns = "9px 26px 1fr 88px 60px 16px";
      row.innerHTML =
        '<span style="width:9px;height:9px;border-radius:2px;background:' +
        anColorFor(a.label || "motif") +
        '"></span>' +
        '<span style="color:var(--txt3)">#' +
        a.id +
        "</span>" +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        (a.label || "motif") +
        "</span>" +
        '<span style="color:var(--txt2)">' +
        a.start.toFixed(3) +
        "–" +
        a.end.toFixed(3) +
        "s</span>" +
        '<span style="color:var(--txt2)">' +
        Math.round(a.fLo / 100) / 10 +
        "–" +
        Math.round(a.fHi / 100) / 10 +
        "k</span>" +
        '<button class="xbtn" title="Delete">×</button>';
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("xbtn")) {
          e.stopPropagation();
          deleteAnnot(a.id);
          if (anSelIndex === i) anSelIndex = null;
          anAfterChange(false);
          return;
        }
        anSelIndex = i;
        anAdoptSelection(i);
        // Centre the view on it, keeping the current zoom.
        const mid = (a.start + a.end) / 2;
        view.t0 = Math.max(
          0,
          Math.min(mid - view.dur / 2, duration - view.dur),
        );
        anRecomputePsd();
        anRefreshList();
        anRedraw();
      });
      host.appendChild(row);
    });

    if (!annotations.length) {
      const d = document.createElement("div");
      d.style.cssText = "color:var(--txt2);font-size:11px;padding:3px 0";
      d.textContent =
        "None yet. Drag a time span on the waveform, check the band, then Add.";
      host.appendChild(d);
    }
  }

  // Rename every selection carrying one label. The way to fix a species
  // name after the fact, and the way annotations that arrived from
  // Spectral Analysis or a Raven import (where the label is whatever
  // that path wrote) get a real species attached.
  function anRelabelAll() {
    const from = $("anRelabelFrom")?.value;
    const to = ($("anLabel")?.value || "").trim();
    if (!from) {
      anSay("pick which label to rename", false);
      return;
    }
    if (!to) {
      anSay("type the new species name in the Species box first", false);
      return;
    }
    if (from === to) {
      anSay("that is already the name", false);
      return;
    }
    const n = annotations.filter((a) => (a.label || "motif") === from).length;
    if (!n) {
      anSay("no selections carry that label", false);
      return;
    }
    annotSnapshot("relabel " + from + " → " + to);
    annotations.forEach((a) => {
      if ((a.label || "motif") === from) a.label = to;
    });
    // Hand the old label's colour to the new name, so a rename does not
    // recolour a table the annotator has been reading for an hour.
    if (from in anLabelColors && !(to in anLabelColors)) {
      anLabelColors[to] = anLabelColors[from];
      delete anLabelColors[from];
    }
    st.label = to;
    anSyncControls();
    anAfterChange();
    anSay(
      "renamed " + n + " selection" + (n === 1 ? "" : "s") + " to ‘" + to + "’",
    );
  }

  function anRefreshRelabelOptions() {
    const sel = $("anRelabelFrom");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = "";
    anLabelsInUse().forEach((l) => {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = l;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  }

  // ── control handlers ──────────────────────────────────────────────

  function anOnLabel() {
    st.label = ($("anLabel")?.value || "").trim() || "motif";
    anSyncControls();
    anRedraw();
  }

  function anOnRange() {
    const nyq = anNyq();
    let lo = Math.max(0, anNum("anFMin", 0));
    let hi = Math.min(anNum("anFMax", nyq) || nyq, nyq);
    if (hi <= lo) {
      lo = 0;
      hi = nyq;
    }
    st.fMin = lo;
    st.fMax = hi;
    anDeriveBand();
    anSyncControls();
    anRedraw();
  }

  function anOnThreshold() {
    st.thresholdDb = Math.abs(anNum("anThreshold", 20));
    anDeriveBand();
    anRedraw();
  }

  function anOnMode() {
    const m = $("anMode")?.value;
    if (AN_BAND_MODES.includes(m)) st.bandMode = m;
    anDeriveBand();
    anRedraw();
  }

  function anOnAuto() {
    st.autoBand = !!$("anAuto")?.checked;
    if (st.autoBand) anDeriveBand();
    anRedraw();
  }

  function anOnLock() {
    st.lockBand = !!$("anLock")?.checked;
    if (!st.lockBand) anDeriveBand();
    anRedraw();
    anSay(st.lockBand ? "band locked — it will not drift" : "band unlocked");
  }

  function anOnPsdFft() {
    const v = parseInt($("anPsdFft")?.value, 10);
    if (AN_PSD_NFFT_CHOICES.includes(v)) st.psdNFft = v;
    anRecomputePsd();
    anDeriveBand();
    anRedraw();
  }

  // A typed band beats the threshold for the same reason a drag does.
  function anApplyTypedBand() {
    const lo = anNum("anBandLo", NaN),
      hi = anNum("anBandHi", NaN);
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
      anSay("band needs a low and a larger high, in Hz", false);
      return;
    }
    anSetBand(Math.max(0, lo), Math.min(anNyq(), hi));
    anRedraw();
    anSay("band set by hand — auto is off");
  }

  function anZoomBy(factor) {
    if (!anReady()) return;
    const mid = view.t0 + view.dur / 2;
    view.dur = Math.min(duration, Math.max(0.002, view.dur * factor));
    view.t0 = Math.max(0, Math.min(mid - view.dur / 2, duration - view.dur));
    if (!st.span) anRecomputePsd();
    anRedraw();
  }

  function anZoomAll() {
    if (!anReady()) return;
    view.t0 = 0;
    view.dur = duration;
    view.f0 = 0;
    view.f1 = anNyq();
    if (!st.span) anRecomputePsd();
    anRedraw();
  }

  function anZoomToSpan() {
    if (!st.span) {
      anSay("no span marked", false);
      return;
    }
    const pad = (st.span[1] - st.span[0]) * 0.5 || 0.01;
    view.t0 = Math.max(0, st.span[0] - pad);
    view.dur = Math.min(duration - view.t0, st.span[1] - st.span[0] + 2 * pad);
    anRedraw();
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  // Called by switchMainTab. A canvas inside a display:none panel has
  // zero width, so anything drawn before the tab is shown is lost —
  // hence the deferred first draw.
  function anEnter() {
    anAttachWave();
    anAttachSpec();
    anAttachPsd();
    anAttachBandFile();
    if (
      anReady() &&
      (anStale || !view.dur || anLastFile !== currentAudioFileName)
    )
      anReset();
    anSyncControls();
    anRefreshList();
    anRefreshRelabelOptions();
    setTimeout(() => {
      anRecomputePsd();
      anRedraw();
    }, 50);
  }

  // New audio: the view and the spectra describe the old file. The band
  // is kept only when it is locked or came from a profile — that is
  // exactly the case the whole per-species scheme exists for, annotating
  // recording after recording of one animal without re-deciding.
  function anReset() {
    anStale = false;
    anLastFile = currentAudioFileName || "";
    view.t0 = 0;
    view.dur = duration || 0;
    view.f0 = 0;
    view.f1 = anNyq();
    st.span = null;
    anSelIndex = null;
    anSpecCache = null;
    anWaveCache = null;
    if (!st.fMax || st.fMax > anNyq()) {
      st.fMin = 0;
      st.fMax = anNyq();
    }
    if (!st.lockBand && st.bandSource !== "profile") {
      st.band = null;
      st.bandSource = "view";
    }
    anRecomputePsd();
    anDeriveBand();
    anSyncControls();
  }

  // Loading, trimming or filtering the audio moves the timeline the
  // cached spectra and the view window describe. Callers announce that
  // rather than triggering a rebuild, because at the moment they call,
  // `duration` and `sampleRate` may still be the outgoing recording's —
  // so the rebuild is deferred to whenever this tab is next looked at.
  function anInvalidate() {
    anStale = true;
    anSpecCache = null;
    anWaveCache = null;
    anPsd = null;
    anPeakHz = null;
    anSelIndex = null;
    if (anTabActive()) setTimeout(anEnter, 0);
  }

  // Non-Tauri fallback for Load band. Kept alongside the dialog path so a
  // dev build in a plain browser can still read a profile.
  function anAttachBandFile() {
    const input = $("anBandFile");
    if (!input || input._anWired) return;
    input._anWired = true;
    input.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      anIngestProfile(await f.text());
      e.target.value = "";
    });
  }

  // Keyboard, gated on this tab being the visible one — Rthoptera Desk
  // already gives 'a', Delete and Ctrl+Z to Spectral Analysis and
  // Temporal Analysis, and each module defers to whichever tab the user
  // is actually looking at.
  function anTabActive() {
    const t = $("maintab-annotate");
    return !!(t && t.classList.contains("active"));
  }

  document.addEventListener("keydown", (e) => {
    if (!anTabActive()) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (
      (e.key === "z" || e.key === "Z") &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey
    ) {
      anUndo();
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" || e.key === "a" || e.key === "A") {
      anAdd();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      anClearSpan();
      e.preventDefault();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      anDeleteSelected();
      e.preventDefault();
    }
  });

  window.addEventListener("resize", () => {
    if (anTabActive()) anRedraw();
  });

  // ── exports ───────────────────────────────────────────────────────

  window.anEnter = anEnter;
  window.anReset = anReset;
  window.anInvalidate = anInvalidate;
  window.anAdd = anAdd;
  window.anUndo = anUndo;
  window.anClearSpan = anClearSpan;
  window.anDeleteSelected = anDeleteSelected;
  window.anDetectView = anDetectView;
  window.anDetectSelection = anDetectSelection;
  window.anSaveBand = anSaveBand;
  window.anLoadBand = anLoadBand;
  window.anIngestProfile = anIngestProfile;
  window.anApplyTypedBand = anApplyTypedBand;
  window.anRelabelAll = anRelabelAll;
  window.anRefreshRelabelOptions = anRefreshRelabelOptions;
  window.anOnLabel = anOnLabel;
  window.anOnRange = anOnRange;
  window.anOnThreshold = anOnThreshold;
  window.anOnMode = anOnMode;
  window.anOnAuto = anOnAuto;
  window.anOnLock = anOnLock;
  window.anOnPsdFft = anOnPsdFft;
  window.anZoomBy = anZoomBy;
  window.anZoomAll = anZoomAll;
  window.anZoomToSpan = anZoomToSpan;
  window.anRedraw = anRedraw;
  window.anRefreshList = anRefreshList;
})();
