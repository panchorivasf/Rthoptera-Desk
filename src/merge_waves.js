// ═══════════════════════════════════════════════════════════════════
// MERGE WAVES
// Concatenate several loaded recordings, end to end, into one.
//
// Port of the Rthoptera R package's merge_waves(), which takes a list of
// tuneR Wave objects, appends their channels, and normalises the result.
// The core is four lines of R; what this module adds is the three things
// the R version leaves to the caller and which quietly produce wrong
// audio when the caller gets them wrong.
//
// ── 1. Order is a decision, not an accident ──
//
// merge_waves() concatenates in list order. In R that order is whatever
// the caller built, usually a directory listing — so the merged file's
// timeline is alphabetical by filename, which is nobody's intent. Here
// the merge list is explicit and reorderable, and each entry shows the
// offset at which it will land.
//
// ── 2. Sample rates must actually match ──
//
// The R docs say the objects "should be compatible" and nothing checks.
// tuneR keeps the FIRST wave's samp.rate, so appending 48 kHz audio to a
// 44.1 kHz wave does not error: the 48 kHz material is simply replayed
// at 44.1 kHz, stretching it by 8.8% and dropping every frequency in it
// by the same amount. For insect recordings, where the carrier is the
// diagnostic feature, that is a silent 8.8% error in the measurement the
// whole analysis rests on. This module refuses by default and resamples
// only when asked, low-passing first so a downsample cannot alias.
//
// ── 3. Normalising once, at the end ──
//
// The R version calls normalize() INSIDE the loop, so the running
// concatenation is re-centred and re-scaled on every append. Repeated
// peak normalisation is near enough idempotent, but repeated centring is
// not: each pass subtracts the mean of a different, longer signal, so
// the samples that arrived first are shifted once per later file. Doing
// it once at the end is both cheaper and the only version with a
// definition you can state.
//
// What normalising costs is worth saying plainly, because merge_waves()
// does it unconditionally and this module defaults to matching it:
// scaling the concatenation to a single peak destroys the RELATIVE
// levels between the source recordings. If the amplitudes were
// comparable — same gain, same distance — that comparison does not
// survive the merge. Turn it off to keep it.
//
// Reuses main.js throughout: applyNormalize, applyBandpass and
// _resampleLinear for the numerics, addAudioToLibrary for the result,
// withBusy for the progress overlay. The merged recording enters the
// shared Loaded Audio library like any import, so every other pane sees
// it without knowing this module exists.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);

  // Beyond this the merged buffer is large enough that the browser's
  // typed-array allocation, not the merge, becomes the failure — better
  // to say so than to hand back a RangeError from somewhere else.
  const MW_MAX_SAMPLES = 400_000_000;

  let mwList = []; // ordered [{ uid, libId, name, samples, rate, dur }]
  let mwUid = 1;
  let mwResult = null; // { samples, rate, bounds: [{name, start, end}] }
  let mwBusy = false;

  // ── helpers ───────────────────────────────────────────────────────

  function mwNum(id, fallback) {
    const v = parseFloat($(id)?.value);
    return isFinite(v) ? v : fallback;
  }

  function mwLib() {
    return typeof audioLibrary !== "undefined" ? audioLibrary : [];
  }

  function mwSay(text, ok = true) {
    const el = $("mwNote");
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? "var(--green)" : "var(--amber)";
  }

  function mwFmtDur(s) {
    return s >= 60
      ? Math.floor(s / 60) + "m " + (s % 60).toFixed(2) + "s"
      : s.toFixed(3) + "s";
  }

  // ── the merge list ────────────────────────────────────────────────

  // Checklist of what is in the Loaded Audio library. Kept in step by
  // renderAudioLibraryPanel, which calls this whenever the library
  // changes, so an import or a removal shows up here without polling.
  function mwRenderLibPicker() {
    const el = $("mwLibPicker");
    if (!el) return;
    const lib = mwLib();
    const prev = new Set(
      Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(
        (c) => c.value,
      ),
    );
    el.innerHTML = "";
    if (!lib.length) {
      el.innerHTML =
        '<div style="color: var(--txt2); font-size: 11px">No audio loaded yet.</div>';
      return;
    }
    lib.forEach((entry) => {
      const row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;gap:5px;cursor:pointer";
      row.innerHTML =
        '<input type="checkbox" value="' +
        entry.id +
        '" ' +
        (prev.has(String(entry.id)) ? "checked" : "") +
        ' /><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
        entry.name +
        " — " +
        entry.dur.toFixed(3) +
        "s @ " +
        entry.rate +
        'Hz">' +
        entry.name +
        '</span><span style="color:var(--txt2);font-size:10px">' +
        (entry.rate / 1000).toFixed(1) +
        "k</span>";
      el.appendChild(row);
    });
  }

  // Appended in library order, and the same recording may be added more
  // than once — repeating one file in a merged review track is a
  // legitimate thing to want, and refusing it would be the module
  // second-guessing the user.
  function mwAddChecked() {
    const el = $("mwLibPicker");
    if (!el) return;
    const checked = Array.from(
      el.querySelectorAll('input[type="checkbox"]:checked'),
    ).map((c) => parseInt(c.value, 10));
    if (!checked.length) {
      mwSay("check at least one loaded recording first", false);
      return;
    }
    checked.forEach((libId) => {
      const entry = mwLib().find((e) => e.id === libId);
      if (!entry) return;
      mwList.push({
        uid: mwUid++,
        libId,
        name: entry.name,
        // Not copied: the library entry owns its samples and this module
        // never writes to them. A copy per merge-list row would double
        // the memory of a long recording added twice for no gain.
        samples: entry.samples,
        rate: entry.rate,
        dur: entry.dur,
      });
    });
    el.querySelectorAll('input[type="checkbox"]:checked').forEach(
      (c) => (c.checked = false),
    );
    mwRenderList();
    mwSay("added " + checked.length + " to the merge list");
  }

  function mwRemove(uid) {
    mwList = mwList.filter((w) => w.uid !== uid);
    mwRenderList();
  }

  function mwMove(uid, dir) {
    const i = mwList.findIndex((w) => w.uid === uid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= mwList.length) return;
    [mwList[i], mwList[j]] = [mwList[j], mwList[i]];
    mwRenderList();
  }

  function mwClear() {
    mwList = [];
    mwResult = null;
    mwRenderList();
    mwDrawPreview();
  }

  // ── rate policy ───────────────────────────────────────────────────

  // The distinct rates present, ascending.
  function mwRates() {
    return [...new Set(mwList.map((w) => w.rate))].sort((a, b) => a - b);
  }

  // The rate the merged file will carry, or null when the list is empty.
  // "first" mirrors tuneR, which silently keeps the first wave's rate —
  // offered so the R behaviour is reproducible, not because it is a good
  // default.
  function mwTargetRate() {
    const rates = mwRates();
    if (!rates.length) return null;
    switch ($("mwRatePolicy")?.value || "refuse") {
      case "highest":
        return rates[rates.length - 1];
      case "lowest":
        return rates[0];
      case "first":
        return mwList[0].rate;
      default:
        return rates.length === 1 ? rates[0] : null; // "refuse"
    }
  }

  // ── numerics ──────────────────────────────────────────────────────

  // Rate conversion by windowed-sinc interpolation.
  //
  // The obvious implementation — main.js's _resampleLinear behind a
  // Butterworth low-pass — was measured at only ~23 dB of alias
  // rejection, because a filtfilt biquad is 24 dB/octave and a 96 → 48
  // kHz conversion asks it to stop a 30 kHz tone less than half an
  // octave above the cutoff. A katydid with real energy at 30 kHz would
  // come back with a ghost of itself at 18 kHz, sitting in the band at
  // a twentieth of its amplitude and looking exactly like signal.
  //
  // A windowed sinc puts the transition where it belongs — at the
  // target Nyquist — and MW_SINC_ZEROS sets how sharp it is. The
  // Blackman–Harris window is what buys the stopband depth; a plain
  // Blackman would cap it around −58 dB.
  //
  // Measured on a 96 -> 48 kHz conversion: flat to 20 kHz, −111 dB at 30
  // kHz, −125 dB at 40 kHz. The transition is not free, though — it
  // spans roughly the top tenth of the new Nyquist, so a component 2 kHz
  // above a 24 kHz Nyquist still folds back at about −19 dB. Downsampling
  // to a rate whose Nyquist lands close to the call is the one case where
  // this is worth thinking about rather than accepting.
  const MW_SINC_ZEROS = 16;
  // Kernel samples per source sample in the lookup table below. The table
  // is what makes this usable: evaluating sin() per tap costs ~180 million
  // transcendental calls on a one-minute 96 kHz file, which took minutes.
  // 512 steps with linear interpolation between them is far finer than the
  // −110 dB stopband needs.
  const MW_KERNEL_STEPS = 512;

  function mwSinc(x) {
    if (x === 0) return 1;
    const pix = Math.PI * x;
    return Math.sin(pix) / pix;
  }

  // Blackman–Harris over t in [0, 1].
  function mwWindow(t) {
    const a = 2 * Math.PI * t;
    return (
      0.35875 -
      0.48829 * Math.cos(a) +
      0.14128 * Math.cos(2 * a) -
      0.01168 * Math.cos(3 * a)
    );
  }

  // Half the windowed-sinc kernel, tabulated over d in [0, half]. Only half
  // is stored because the kernel is even in d.
  function mwKernelTable(half, cutoff) {
    const n = half * MW_KERNEL_STEPS + 2;
    const tab = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = i / MW_KERNEL_STEPS;
      tab[i] = d > half ? 0 : mwSinc(d * cutoff) * mwWindow((d / half + 1) / 2);
    }
    return tab;
  }

  function mwResample(samples, from, to) {
    if (from === to) return samples;
    const ratio = to / from;
    // Fraction of the SOURCE band to keep. Downsampling keeps only what
    // fits under the new Nyquist; upsampling keeps everything, because
    // there is nothing above the old Nyquist to remove.
    const cutoff = Math.min(1, ratio);
    const half = Math.ceil(MW_SINC_ZEROS / cutoff);
    const outLen = Math.max(1, Math.round(samples.length * ratio));
    const out = new Float32Array(outLen);
    const step = from / to;
    const n = samples.length;
    const tab = mwKernelTable(half, cutoff);
    const last = tab.length - 2;

    for (let i = 0; i < outLen; i++) {
      const p = i * step;
      const c = Math.floor(p);
      let acc = 0;
      // Weights are summed and divided out rather than trusted to sum to
      // one. They do not at the very start and end of the signal, where
      // part of the kernel hangs off the edge, and without this those
      // samples come back attenuated — an amplitude taper on the first
      // and last half-millisecond of every resampled piece.
      let wsum = 0;
      const lo = Math.max(0, c - half + 1);
      const hi = Math.min(n - 1, c + half);
      for (let k = lo; k <= hi; k++) {
        const d = p - k;
        const t = (d < 0 ? -d : d) * MW_KERNEL_STEPS;
        const j = t | 0;
        let w;
        if (j >= last) w = 0;
        else {
          const f = t - j;
          w = tab[j] + (tab[j + 1] - tab[j]) * f;
        }
        acc += samples[k] * w;
        wsum += w;
      }
      out[i] = wsum > 1e-9 ? acc / wsum : 0;
    }
    return out;
  }

  // ── merge ─────────────────────────────────────────────────────────

  async function mwMerge() {
    // The merge awaits inside withBusy, so mwList is reachable while it
    // runs — a second Merge (or a Clear) landing in that window would
    // size the output from one list and fill it from another, and the
    // failure is an out-of-bounds write partway through, not a wrong
    // answer you could spot.
    if (mwBusy) return;

    // Empty list returns nothing and says so, where the R version
    // returns NULL — and, on a single-element list, does not: `2:1`
    // counts DOWN in R, so merge_waves(list(w)) indexes wave_list[[2]]
    // and errors. One recording merging to itself is well defined here.
    if (!mwList.length) {
      mwSay("nothing in the merge list", false);
      return;
    }

    const rate = mwTargetRate();
    if (rate == null) {
      mwSay(
        "sample rates differ (" +
          mwRates()
            .map((r) => (r / 1000).toFixed(1) + "k")
            .join(", ") +
          ") — choose what to resample to, or remove the odd one out",
        false,
      );
      return;
    }

    const gapS = Math.max(0, mwNum("mwGap", 0)) / 1000;
    const gapN = Math.round(gapS * rate);
    const lens = mwList.map((w) =>
      Math.round((w.samples.length / w.rate) * rate),
    );
    const total =
      lens.reduce((a, b) => a + b, 0) + gapN * Math.max(0, mwList.length - 1);

    if (total > MW_MAX_SAMPLES) {
      mwSay(
        "merged length would be " +
          mwFmtDur(total / rate) +
          " (" +
          (total / 1e6).toFixed(0) +
          "M samples) — too large to hold in memory",
        false,
      );
      return;
    }

    mwBusy = true;
    const btn = $("btnMwMerge");
    if (btn) btn.disabled = true;
    try {
      await withBusy("Merging recordings…", async (progress) => {
        const out = new Float32Array(total);
        const bounds = [];
        let at = 0;

        for (let i = 0; i < mwList.length; i++) {
          const w = mwList[i];
          progress(
            w.name + " (" + (i + 1) + "/" + mwList.length + ")…",
            i / mwList.length,
          );
          await busyTick();

          const piece = mwResample(w.samples, w.rate, rate);
          out.set(piece, at);
          bounds.push({
            name: w.name,
            start: at / rate,
            end: (at + piece.length) / rate,
            resampled: w.rate !== rate ? w.rate : null,
          });
          at += piece.length;
          // The gap is silence between pieces only — never a lead-in or a
          // tail, which would move every annotation time by a constant and
          // leave the file ending on nothing.
          if (i < mwList.length - 1) at += gapN;
        }

        progress("Normalizing…", 0.95);
        await busyTick();

        // Once, at the end — see the header for why not once per append.
        if ($("mwCenter")?.checked) {
          let mean = 0;
          for (let i = 0; i < out.length; i++) mean += out[i];
          mean /= out.length || 1;
          if (Math.abs(mean) > 1e-12)
            for (let i = 0; i < out.length; i++) out[i] -= mean;
        }
        let merged = out;
        if ($("mwNormalize")?.checked) {
          merged = applyNormalize(out, Math.pow(10, mwNum("mwNormDb", 0) / 20));
        }

        mwResult = { samples: merged, rate, bounds, gapS };

        const name = mwName();
        const folder =
          mwLib().find((e) => e.id === mwList[0].libId)?.folder || "";
        addAudioToLibrary(name, folder, merged, rate);

        const resampled = bounds.filter((b) => b.resampled).length;
        log(
          "Merged " +
            mwList.length +
            " recordings into “" +
            name +
            "” — " +
            mwFmtDur(total / rate) +
            " @ " +
            rate +
            " Hz" +
            (resampled ? ", " + resampled + " resampled" : ""),
          "ok",
        );
        bounds.forEach((b, i) =>
          log(
            "  " +
              (i + 1) +
              ". " +
              b.start.toFixed(4) +
              "–" +
              b.end.toFixed(4) +
              " s  " +
              b.name +
              (b.resampled ? "  (from " + b.resampled + " Hz)" : ""),
          ),
        );
        mwSay(
          "merged " +
            mwList.length +
            " into “" +
            name +
            "” — " +
            mwFmtDur(total / rate) +
            ", now the active recording",
        );
      });
    } finally {
      mwBusy = false;
    }

    mwRenderList();
    mwDrawPreview();
  }

  function mwName() {
    const typed = ($("mwName")?.value || "").trim();
    if (typed) return typed;
    const base = (mwList[0]?.name || "audio").replace(/\.[^/.]+$/, "");
    return base + "_merged";
  }

  function mwExport() {
    if (!mwResult) {
      mwSay("merge first — there is nothing to export", false);
      return;
    }
    exportAudioToDisk(mwName(), mwResult.samples, mwResult.rate);
  }

  // Write the piece boundaries as a Raven selection table. Merging is
  // what makes a boundary hard to see afterwards, and this is the record
  // of where each source recording went — enough to split the merged
  // file again, or to keep per-recording results attributable once the
  // annotations are all in one timeline.
  function mwExportBounds() {
    if (!mwResult) {
      mwSay("merge first — there are no boundaries yet", false);
      return;
    }
    const nyq = mwResult.rate / 2;
    let txt =
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tAnnotation\n";
    mwResult.bounds.forEach((b, i) => {
      txt +=
        i +
        1 +
        "\tSpectrogram 1\t1\t" +
        b.start.toFixed(6) +
        "\t" +
        b.end.toFixed(6) +
        "\t0\t" +
        nyq.toFixed(1) +
        "\t" +
        b.name +
        "\n";
    });
    dlFile(mwName() + "_pieces.txt", txt, "text/plain", { exactName: true });
    mwSay("wrote " + mwResult.bounds.length + " piece boundaries");
  }

  // ── rendering ─────────────────────────────────────────────────────

  function mwRenderList() {
    const el = $("mwList");
    if (!el) return;
    el.innerHTML = "";

    const rate = mwTargetRate();
    const gapS = Math.max(0, mwNum("mwGap", 0)) / 1000;

    if (!mwList.length) {
      el.innerHTML =
        '<div style="color: var(--txt2); font-size: 11px">Nothing to merge yet. Check recordings on the left and press Add.</div>';
    } else {
      let at = 0;
      mwList.forEach((w, idx) => {
        // Offsets are shown at the TARGET rate, so what the list says is
        // where each piece actually lands after any resampling — not
        // where it would land if the rates already agreed.
        const dur = w.samples.length / w.rate;
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:4px;padding:2px 0;border-bottom:1px solid var(--border);font-size:11px";
        const odd = rate != null && w.rate !== rate;
        row.innerHTML =
          '<span style="color:var(--txt3);width:20px">' +
          (idx + 1) +
          '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
          w.name +
          '">' +
          w.name +
          "</span>" +
          '<span style="color:' +
          (odd ? "var(--amber)" : "var(--txt2)") +
          ';width:52px;text-align:right" title="' +
          (odd ? "will be resampled to " + rate + " Hz" : "") +
          '">' +
          (w.rate / 1000).toFixed(1) +
          "k</span>" +
          '<span style="color:var(--txt2);width:126px;text-align:right">' +
          at.toFixed(3) +
          "–" +
          (at + dur).toFixed(3) +
          "s</span>" +
          '<button style="font-size:10px;padding:1px 5px" data-act="up"' +
          (idx === 0 ? " disabled" : "") +
          ">▲</button>" +
          '<button style="font-size:10px;padding:1px 5px" data-act="down"' +
          (idx === mwList.length - 1 ? " disabled" : "") +
          ">▼</button>" +
          '<button class="xbtn" data-act="rm" title="Remove">×</button>';
        row.querySelector('[data-act="up"]').onclick = () => mwMove(w.uid, -1);
        row.querySelector('[data-act="down"]').onclick = () => mwMove(w.uid, 1);
        row.querySelector('[data-act="rm"]').onclick = () => mwRemove(w.uid);
        el.appendChild(row);
        at += dur + (idx < mwList.length - 1 ? gapS : 0);
      });
    }

    const rates = mwRates();
    const status = $("mwStatus");
    if (status) {
      if (!mwList.length) status.textContent = "";
      else {
        const total =
          mwList.reduce((a, w) => a + w.samples.length / w.rate, 0) +
          gapS * (mwList.length - 1);
        status.textContent =
          mwList.length +
          " piece" +
          (mwList.length === 1 ? "" : "s") +
          "     " +
          mwFmtDur(total) +
          "     " +
          (rate != null
            ? "output " + rate + " Hz"
            : "MIXED RATES: " + rates.map((r) => r + " Hz").join(", "));
        status.style.color = rate == null ? "var(--amber)" : "var(--txt3)";
      }
    }

    const warn = $("mwRateWarn");
    if (warn)
      warn.style.display =
        rates.length > 1 && ($("mwRatePolicy")?.value || "refuse") === "refuse"
          ? "block"
          : "none";

    const btn = $("btnMwMerge");
    if (btn) btn.disabled = !mwList.length || rate == null;
    const ex = $("btnMwExport"),
      eb = $("btnMwExportBounds");
    if (ex) ex.disabled = !mwResult;
    if (eb) eb.disabled = !mwResult;

    const ph = $("mwNamePlaceholder");
    if (ph) ph.textContent = mwList.length ? mwName() : "";
  }

  // A strip of the merged result with every join marked. The whole risk
  // of a blind concatenation is that a boundary lands mid-call or that a
  // piece went in at the wrong rate, and both are obvious here and
  // invisible in a log line.
  function mwDrawPreview() {
    const cv = $("mwPreview");
    if (!cv) return;
    const w = cv.clientWidth || 720;
    const h = cv.clientHeight || 96;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0a0d12";
    g.fillRect(0, 0, w, h);
    g.font = "10px Consolas, monospace";

    if (!mwResult) {
      g.fillStyle = "#8b949e";
      g.fillText(
        "Merge to see the result and where each recording joins.",
        6,
        15,
      );
      return;
    }

    const { samples, rate, bounds } = mwResult;
    const n = samples.length;
    const mid = h / 2;
    let peak = 1e-9;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000)))
      peak = Math.max(peak, Math.abs(samples[i]));
    const sc = (mid - 3) / peak;

    g.strokeStyle = "#7ee787";
    g.lineWidth = 1;
    g.beginPath();
    const cols = Math.min(w, 4000);
    for (let c = 0; c < cols; c++) {
      const from = Math.floor((c * n) / cols),
        to = Math.floor(((c + 1) * n) / cols);
      let mn = Infinity,
        mx = -Infinity;
      for (let i = from; i < Math.max(to, from + 1); i++) {
        const v = samples[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const x = ((c + 0.5) / cols) * w;
      g.moveTo(x, mid - mx * sc);
      g.lineTo(x, mid - mn * sc);
    }
    g.stroke();

    const totalS = n / rate;
    bounds.forEach((b, i) => {
      const x = (b.start / totalS) * w;
      if (i > 0) {
        g.strokeStyle = "rgba(210,153,34,0.9)";
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
        g.setLineDash([]);
      }
      g.fillStyle = "rgba(230,237,243,0.8)";
      const label = i + 1 + ". " + b.name.replace(/\.[^/.]+$/, "");
      g.fillText(label.slice(0, 28), x + 3, 11 + (i % 2) * 11);
    });

    g.fillStyle = "#8b949e";
    g.fillText(mwFmtDur(totalS) + " @ " + rate + " Hz", 6, h - 5);
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  function mwEnter() {
    mwRenderLibPicker();
    mwRenderList();
    // A canvas in a display:none panel has zero width, so anything drawn
    // before the tab is shown is lost.
    setTimeout(mwDrawPreview, 50);
  }

  function mwOnPolicyChange() {
    mwRenderList();
  }

  window.addEventListener("resize", () => {
    const t = $("maintab-merge");
    if (t && t.classList.contains("active")) mwDrawPreview();
  });

  // ── exports ───────────────────────────────────────────────────────

  window.mwEnter = mwEnter;
  window.mwRenderLibPicker = mwRenderLibPicker;
  window.mwAddChecked = mwAddChecked;
  window.mwClear = mwClear;
  window.mwMerge = mwMerge;
  window.mwExport = mwExport;
  window.mwExportBounds = mwExportBounds;
  window.mwRenderList = mwRenderList;
  window.mwOnPolicyChange = mwOnPolicyChange;
})();
