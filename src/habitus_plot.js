// ═══════════════════════════════════════════════════════════════════
// HABITUS PLOT
// Several waves → one mean (or median) power-spectrum contour with a
// ±SD band, drawn as a narrow vertical silhouette next to a cropped
// habitus photo — the JS port of the old server.R/ui.R "Spectrum with
// Image Composite" module.
//
// Built as an interactive SVG (like oscillogram_stack.js/zoom.js)
// rather than a flat canvas: the "A"/"B" letters are draggable +
// colorable slots, and the photo is drawn into a fixed clipped frame
// that the user can pan by dragging — whatever slides past the frame
// edge is simply clipped, never distorted.
//
// Self-contained IIFE, parallel to oscillogram_stack.js/zoom.js (see
// their header notes — modules intentionally don't share state yet).
// Reuses fft()/nextPow2() from main.js, which are declared at top
// level there (no IIFE), so they're on window already.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const UNIT = 100; // svg user-units per inch

  // Photo state: natural size + a data URL (so exported SVG is standalone),
  // plus its current pan offset within the fixed frame (svg user units).
  let habImg = null; // { dataUrl, w, h }
  let habImgPan = null; // { x, y } — top-left of the scaled image, frame-relative origin baked in at draw time

  // Draggable "A"/"B" letter slots — dx/dy are offsets from a fixed anchor.
  let habLetterPos = {
    A: { dx: 0, dy: 0 },
    B: { dx: 0, dy: 0 },
  };

  let habSvgEl = null;
  let habCurrentGeom = null; // geometry from the last draw, needed to clamp drag
  let habLetterRefs = {}; // key ("A"/"B") -> { el, pos } — rebuilt every draw, used by snap-drag

  // Okabe–Ito colorblind-safe palette (minus black/yellow, which read
  // poorly against a white figure background) — a standard, citable
  // choice for publication figures.
  const HAB_SWATCHES = ["#E69F00", "#56B4E9", "#009E73", "#0072B2", "#D55E00"];

  function buildSwatchRow(containerId, inputId, onPick) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = "";
    HAB_SWATCHES.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = c;
      b.style.cssText =
        `width:18px;height:18px;padding:0;border-radius:3px;border:1px solid var(--border2);background:${c};cursor:pointer`;
      b.onclick = () => {
        $(inputId).value = c;
        if (onPick) onPick(c);
      };
      el.appendChild(b);
    });
  }

  buildSwatchRow("habLineSwatches", "habLineColor");
  buildSwatchRow("habBandSwatches", "habBandColor");

  // ── Window functions (mirrors seewave's wn options) ─────────────
  function windowCoeffs(type, n) {
    const w = new Float32Array(n);
    const N1 = n - 1 || 1;
    switch (type) {
      case "hamming":
        for (let i = 0; i < n; i++)
          w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / N1);
        break;
      case "blackman":
        for (let i = 0; i < n; i++)
          w[i] =
            0.42 -
            0.5 * Math.cos((2 * Math.PI * i) / N1) +
            0.08 * Math.cos((4 * Math.PI * i) / N1);
        break;
      case "bartlett":
        for (let i = 0; i < n; i++) w[i] = 1 - Math.abs((i - N1 / 2) / (N1 / 2));
        break;
      case "flattop": {
        const a = [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368];
        for (let i = 0; i < n; i++) {
          let v = a[0];
          for (let k = 1; k < a.length; k++)
            v += (k % 2 === 0 ? 1 : -1) * a[k] * Math.cos((2 * Math.PI * k * i) / N1);
          w[i] = v;
        }
        break;
      }
      case "rectangle":
        w.fill(1);
        break;
      case "hanning":
      default:
        for (let i = 0; i < n; i++)
          w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N1);
        break;
    }
    return w;
  }

  // ── Recording selection ─────────────────────────────────────────
  // No separate "add" step: Habitus draws from whatever's checked in the
  // Loaded Audio panel's own batch-select checkboxes (`audioLibBatchSelected`,
  // main.js) — the same checkboxes used for batch filter/normalize/save.
  // Audio is decoded exactly once, by main.js's shared importer, into the
  // global `audioLibrary` — that importer already does the native-rate
  // decode fix (this module used to have its own single-pass
  // decodeAudioData call, which is what caused the 24kHz-cutoff bug: it
  // silently resampled to the device's default rate).
  function habSelectedEntries() {
    const lib = typeof audioLibrary !== "undefined" ? audioLibrary : [];
    const sel = typeof audioLibBatchSelected !== "undefined" ? audioLibBatchSelected : new Set();
    return lib.filter((e) => sel.has(e.id));
  }

  // Re-renders the read-only "what's currently checked" list. Called both
  // on tab-switch and (via main.js's updateBatchEditStatus) on every
  // checkbox click, so it never goes stale.
  function habRenderLibPicker() {
    const el = $("habWaveList");
    const b = $("btnHabDraw");
    if (!el) return;
    const entries = habSelectedEntries();
    if (b) b.disabled = entries.length < 2;

    el.innerHTML = "";
    if (!entries.length) {
      el.innerHTML = '<div style="color: var(--txt2); font-size: 11px">No audio checked yet.</div>';
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:2px 0;border-bottom:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      row.title = `${entry.name} — ${entry.dur.toFixed(3)}s @ ${entry.rate}Hz`;
      row.textContent = entry.name;
      el.appendChild(row);
    });
    if (entries.length < 2) {
      const note = document.createElement("div");
      note.style.cssText = "color: var(--txt2); font-size: 10px; margin-top: 4px";
      note.textContent = "Check at least one more recording — the band needs ≥2 to compute a spread.";
      el.appendChild(note);
    }
  }

  // ── Image loading (as a data URL, so the exported SVG is standalone) ─
  function habOnImageFile(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const probe = new Image();
      probe.onload = () => {
        habImg = { dataUrl, w: probe.naturalWidth, h: probe.naturalHeight };
        habImgPan = null; // recompute default pan on next draw
        $("habImgStatus").textContent = `${file.name} (${probe.naturalWidth}×${probe.naturalHeight})`;
      };
      probe.onerror = () => alert(`Could not load image "${file.name}"`);
      probe.src = dataUrl;
    };
    reader.onerror = () => alert(`Could not read image "${file.name}"`);
    reader.readAsDataURL(file);
  }

  function habResetImagePosition() {
    habImgPan = null;
    if (habSvgEl) habDraw();
  }

  function peakAbs(samples) {
    let p = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > p) p = v;
    }
    return p || 1;
  }

  // ── Spectrum computation ─────────────────────────────────────────
  // Returns { freqs: Float64Array (kHz), amp: Float64Array } with amp
  // already converted to the requested display scale.
  function computeMeanSpectrum(wave, opts) {
    const { wl, ovlpPct, wn, scale, fmin, fmax, normalize } = opts;
    const samples = wave.samples;
    const rate = wave.rate;
    const hop = Math.max(1, Math.round(wl * (1 - ovlpPct / 100)));
    const fftN = nextPow2(wl);
    const win = windowCoeffs(wn, wl);
    const winSum = win.reduce((a, b) => a + b, 0) || wl;
    const nBinsFull = fftN >> 1;
    const nyq = rate / 2;

    // Peak-normalize the recording (to full scale) before analysis, so
    // recordings captured at different gain levels contribute equally to
    // the averaged contour/band instead of the louder one dominating.
    const gain = normalize ? 1 / peakAbs(samples) : 1;

    const nFrames = Math.max(1, Math.floor((samples.length - wl) / hop) + 1);
    const meanPower = new Float64Array(nBinsFull);

    for (let fr = 0; fr < nFrames; fr++) {
      const off = fr * hop;
      const re = new Float32Array(fftN),
        im = new Float32Array(fftN);
      for (let i = 0; i < wl && off + i < samples.length; i++)
        re[i] = samples[off + i] * win[i] * gain;
      fft(re, im, fftN);
      for (let b = 0; b < nBinsFull; b++) {
        meanPower[b] += re[b] * re[b] + im[b] * im[b];
      }
    }
    for (let b = 0; b < nBinsFull; b++) meanPower[b] /= nFrames;

    const bLo = Math.max(0, Math.floor(((fmin * 1000) / nyq) * nBinsFull));
    const bHi = Math.min(nBinsFull - 1, Math.ceil(((fmax * 1000) / nyq) * nBinsFull));
    const nOut = Math.max(1, bHi - bLo + 1);
    const freqs = new Float64Array(nOut);
    const amp = new Float64Array(nOut);
    for (let i = 0; i < nOut; i++) {
      const b = bLo + i;
      freqs[i] = (b * nyq) / nBinsFull / 1000; // kHz
      amp[i] = meanPower[b];
    }

    if (scale === "linear") {
      let mx = 0;
      for (let i = 0; i < nOut; i++) if (amp[i] > mx) mx = amp[i];
      if (mx < 1e-30) mx = 1;
      for (let i = 0; i < nOut; i++) amp[i] = amp[i] / mx;
    } else if (scale === "dB") {
      let mx = 0;
      for (let i = 0; i < nOut; i++) if (amp[i] > mx) mx = amp[i];
      if (mx < 1e-30) mx = 1e-30;
      for (let i = 0; i < nOut; i++) amp[i] = 10 * Math.log10((amp[i] + 1e-30) / mx);
    } else {
      // dBFS: calibrate against a full-scale sinusoid under this window,
      // since decoded samples are already float in [-1, 1] (no original
      // bit depth to look up, unlike the R version).
      const ref = ((winSum / 2) * (winSum / 2)) || 1;
      for (let i = 0; i < nOut; i++) amp[i] = 10 * Math.log10((amp[i] + 1e-30) / ref);
    }

    return { freqs, amp };
  }

  // ── SVG helpers ──────────────────────────────────────────────────
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clientToSvg(svg, x, y) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x, y };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function niceTicks(lo, hi, n) {
    if (hi === lo) return [lo];
    const step = (hi - lo) / n;
    const ticks = [];
    for (let i = 0; i <= n; i++) ticks.push(lo + i * step);
    return ticks;
  }

  // ── Draw ─────────────────────────────────────────────────────────
  function habDraw() {
    const waves = habSelectedEntries();
    if (waves.length < 2) {
      alert("Check at least two recordings in the Loaded Audio panel first.");
      return;
    }
    const rates = new Set(waves.map((w) => w.rate));
    if (rates.size > 1) {
      alert(
        "All checked recordings must share the same sample rate to be averaged together.\n" +
          "Rates found: " + Array.from(rates).join(", "),
      );
      return;
    }

    const wl = parseInt($("habWl").value) || 1024;
    const ovlpPct = parseFloat($("habOvlp").value) || 75;
    const wn = $("habWn").value || "hanning";
    const scale = $("habScale").value || "linear";
    const normalize = $("habNormalize").checked;
    const fmin = Math.max(0, parseFloat($("habFmin").value) || 0);
    const fmax = parseFloat($("habFmax").value) || waves[0].rate / 2 / 1000;
    const yMin = parseFloat($("habYMin").value);
    const central = $("habCentral").value || "mean";
    const bandMult = parseFloat($("habBandMult").value) || 1;
    const lineColor = $("habLineColor").value || "#000000";
    const bandColor = $("habBandColor").value || "#000000";
    const bandAlpha = Math.max(0, Math.min(100, parseFloat($("habBandAlpha").value) || 0)) / 100;
    const labelColorA = $("habLabelColorA").value || "#000000";
    const labelColorB = $("habLabelColorB").value || "#000000";

    const opts = { wl, ovlpPct, wn, scale, fmin, fmax, normalize };
    const specs = waves.map((w) => computeMeanSpectrum(w, opts));

    const freqs = specs[0].freqs;
    const n = freqs.length;
    const central_ = new Float64Array(n);
    const sd = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const vals = specs.map((s) => s.amp[i]);
      if (central === "median") {
        const sorted = vals.slice().sort((a, b) => a - b);
        const m = sorted.length;
        central_[i] = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
      } else {
        central_[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
      sd[i] = Math.sqrt(variance);
    }

    const lower = new Float64Array(n);
    const upper = new Float64Array(n);
    const loClamp = scale === "linear" ? 0 : yMin;
    const hiClamp = scale === "linear" ? 1 : 0;
    for (let i = 0; i < n; i++) {
      lower[i] = Math.max(loClamp, central_[i] - bandMult * sd[i]);
      upper[i] = Math.min(hiClamp, central_[i] + bandMult * sd[i]);
    }

    renderSvg({
      freqs, central: central_, lower, upper,
      fmin, fmax, scale, yMin,
      lineColor, bandColor, bandAlpha, labelColorA, labelColorB,
    });
  }

  function renderSvg(d) {
    const specWin = 3.98, imgWin = habImg ? 9.37 : 0, hIn = 7.5;
    const specW = specWin * UNIT, imgW = imgWin * UNIT, H = hIn * UNIT;
    const totalW = specW + imgW;

    const svg = svgEl("svg", {
      xmlns: SVG_NS,
      viewBox: `0 0 ${totalW} ${H}`,
      style: "width:100%;height:auto;display:block;background:#fff;font-family:Arial,sans-serif",
    });

    // ── Spectrum panel (frequency vertical, amplitude horizontal —
    // the coord_flip() from the R version) ──────────────────────
    const ML = 46, MT = 14, MB = 34, MR = 10;
    const plotX = ML, plotY = MT, plotW = specW - ML - MR, plotH = H - MT - MB;

    const ampLo = d.scale === "linear" ? 0 : d.yMin;
    const ampHi = d.scale === "linear" ? 1 : 0;
    // Clamp before mapping — the central line isn't pre-clamped like the
    // band edges are (a single file's dB spectrum can dip far below yMin
    // at near-silent bins), so without this the line/band could be drawn
    // past the axis instead of stopping at it.
    const AX = (v) => {
      const cv = Math.max(ampLo, Math.min(ampHi, v));
      return plotX + ((cv - ampLo) / (ampHi - ampLo)) * plotW;
    };
    const FY = (f) => plotY + plotH - ((f - d.fmin) / (d.fmax - d.fmin)) * plotH;

    let bandPath = "";
    for (let i = 0; i < d.freqs.length; i++) {
      const x = AX(d.upper[i]), y = FY(d.freqs[i]);
      bandPath += (i === 0 ? "M" : "L") + x + " " + y + " ";
    }
    for (let i = d.freqs.length - 1; i >= 0; i--) {
      bandPath += "L" + AX(d.lower[i]) + " " + FY(d.freqs[i]) + " ";
    }
    bandPath += "Z";
    svg.appendChild(
      svgEl("path", { d: bandPath, fill: d.bandColor, "fill-opacity": d.bandAlpha, stroke: "none" }),
    );

    let linePath = "";
    for (let i = 0; i < d.freqs.length; i++) {
      const x = AX(d.central[i]), y = FY(d.freqs[i]);
      linePath += (i === 0 ? "M" : "L") + x + " " + y + " ";
    }
    svg.appendChild(
      svgEl("path", { d: linePath, fill: "none", stroke: d.lineColor, "stroke-width": 1.5 }),
    );

    svg.appendChild(
      svgEl("rect", { x: plotX, y: plotY, width: plotW, height: plotH, fill: "none", stroke: "#000", "stroke-width": 1 }),
    );

    const freqTicks = niceTicks(d.fmin, d.fmax, 6);
    freqTicks.forEach((f) => {
      const y = FY(f);
      svg.appendChild(svgEl("line", { x1: plotX - 4, y1: y, x2: plotX, y2: y, stroke: "#000" }));
      const t = svgEl("text", { x: plotX - 6, y, "text-anchor": "end", "dominant-baseline": "middle", "font-size": 10 });
      t.textContent = f.toFixed(f % 1 === 0 ? 0 : 1);
      svg.appendChild(t);
    });
    const axLabel = svgEl("text", {
      x: 12, y: plotY + plotH / 2, "text-anchor": "middle", "font-size": 11,
      transform: `rotate(-90 12 ${plotY + plotH / 2})`,
    });
    axLabel.textContent = "Frequency (kHz)";
    svg.appendChild(axLabel);

    const ampTicks = d.scale === "linear" ? [0, 0.5, 1] : niceTicks(ampLo, ampHi, 4);
    ampTicks.forEach((a) => {
      const x = AX(a);
      svg.appendChild(svgEl("line", { x1: x, y1: plotY + plotH, x2: x, y2: plotY + plotH + 4, stroke: "#000" }));
      const t = svgEl("text", { x, y: plotY + plotH + 15, "text-anchor": "middle", "font-size": 10 });
      t.textContent = String(Math.round(a * 100) / 100);
      svg.appendChild(t);
    });
    const ampLabel = svgEl("text", { x: plotX + plotW / 2, y: plotY + plotH + 28, "text-anchor": "middle", "font-size": 11 });
    ampLabel.textContent = "Amplitude";
    svg.appendChild(ampLabel);

    // ── Image panel (pannable within a fixed clipped frame) ────────
    if (habImg) {
      const frameX = specW, frameY = 0, frameW = imgW, frameH = H;
      const scaleCover = Math.max(frameW / habImg.w, frameH / habImg.h);
      const scaledW = habImg.w * scaleCover, scaledH = habImg.h * scaleCover;

      if (!habImgPan) {
        // Default anchor: bottom-right of the frame stays visible.
        habImgPan = {
          x: frameX + frameW - scaledW,
          y: frameY + frameH - scaledH,
        };
      }
      habCurrentGeom = { frameX, frameY, frameW, frameH, scaledW, scaledH };

      const clipId = "habClip";
      const defs = svgEl("defs", {});
      const clip = svgEl("clipPath", { id: clipId });
      clip.appendChild(svgEl("rect", { x: frameX, y: frameY, width: frameW, height: frameH }));
      defs.appendChild(clip);
      svg.appendChild(defs);

      const g = svgEl("g", { "clip-path": `url(#${clipId})` });
      const imgEl = svgEl("image", {
        href: habImg.dataUrl,
        x: habImgPan.x, y: habImgPan.y, width: scaledW, height: scaledH,
        preserveAspectRatio: "none",
      });
      imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "href", habImg.dataUrl);
      g.appendChild(imgEl);
      svg.appendChild(g);

      // Transparent hit-rect over the frame to drag-pan the photo.
      const hit = svgEl("rect", {
        x: frameX, y: frameY, width: frameW, height: frameH,
        fill: "rgba(0,0,0,0)", style: "cursor: move",
      });
      svg.appendChild(hit);
      bindImageDrag(hit, imgEl, svg);

      svg.appendChild(
        svgEl("rect", { x: frameX + 1.5, y: frameY + 1.5, width: frameW - 3, height: frameH - 3, fill: "none", stroke: "#000", "stroke-width": 3 }),
      );

      // Draggable/colorable letters — anchored a bit further into the
      // top-right corner of each panel by default.
      habLetterRefs = {};
      addLetter(svg, "A", specW * 0.92, H * 0.06, d.labelColorA);
      addLetter(svg, "B", specW + imgW * 0.965, H * 0.06, d.labelColorB);
    }

    svg.appendChild(
      svgEl("rect", { x: 1.5, y: 1.5, width: totalW - 3, height: H - 3, fill: "none", stroke: "#000", "stroke-width": 3 }),
    );

    const wrap = $("habPreviewWrap");
    wrap.innerHTML = "";
    wrap.appendChild(svg);
    habSvgEl = svg;

    $("btnHabPng").disabled = false;
    $("btnHabSvg").disabled = false;
  }

  function addLetter(svg, key, baseX, baseY, color) {
    const pos = habLetterPos[key];
    const t = svgEl("text", {
      x: baseX, y: baseY, transform: `translate(${pos.dx} ${pos.dy})`,
      "font-size": 30, "font-weight": "bold", fill: color, style: "cursor: move; user-select: none",
    });
    t.textContent = key;
    svg.appendChild(t);
    habLetterRefs[key] = { el: t, pos };
    bindLetterDrag(t, pos, svg, key);
  }

  // ── Drag: A/B letters (free move, no clamping). When "Snap A/B
  // together" is checked, dragging one carries the other by the same
  // delta, so their relative alignment holds while you reposition both.
  function bindLetterDrag(el, pos, svg, key) {
    let dragging = false, start = null, base = null, otherBase = null;
    el.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      dragging = true;
      start = { x: ev.clientX, y: ev.clientY };
      base = { dx: pos.dx, dy: pos.dy };
      const other = habLetterRefs[key === "A" ? "B" : "A"];
      otherBase = other ? { dx: other.pos.dx, dy: other.pos.dy } : null;
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const p0 = clientToSvg(svg, start.x, start.y);
      const p1 = clientToSvg(svg, ev.clientX, ev.clientY);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      pos.dx = base.dx + dx;
      pos.dy = base.dy + dy;
      el.setAttribute("transform", `translate(${pos.dx} ${pos.dy})`);

      if ($("habSnapLetters").checked && otherBase) {
        const other = habLetterRefs[key === "A" ? "B" : "A"];
        other.pos.dx = otherBase.dx + dx;
        other.pos.dy = otherBase.dy + dy;
        other.el.setAttribute("transform", `translate(${other.pos.dx} ${other.pos.dy})`);
      }
    });
    el.addEventListener("pointerup", (ev) => {
      dragging = false;
      el.releasePointerCapture(ev.pointerId);
    });
  }

  // ── Drag: photo pan, clamped so the frame never shows empty space ─
  function bindImageDrag(hit, imgEl, svg) {
    let dragging = false, start = null, base = null;
    hit.addEventListener("pointerdown", (ev) => {
      dragging = true;
      start = { x: ev.clientX, y: ev.clientY };
      base = { x: habImgPan.x, y: habImgPan.y };
      hit.setPointerCapture(ev.pointerId);
    });
    hit.addEventListener("pointermove", (ev) => {
      if (!dragging || !habCurrentGeom) return;
      const p0 = clientToSvg(svg, start.x, start.y);
      const p1 = clientToSvg(svg, ev.clientX, ev.clientY);
      const g = habCurrentGeom;
      let nx = base.x + (p1.x - p0.x);
      let ny = base.y + (p1.y - p0.y);
      // Clamp so the image always fully covers the frame — the parts
      // sliding past the frame edge are clipped, never revealing a gap.
      nx = Math.min(g.frameX, Math.max(g.frameX + g.frameW - g.scaledW, nx));
      ny = Math.min(g.frameY, Math.max(g.frameY + g.frameH - g.scaledH, ny));
      habImgPan.x = nx;
      habImgPan.y = ny;
      imgEl.setAttribute("x", nx);
      imgEl.setAttribute("y", ny);
    });
    hit.addEventListener("pointerup", (ev) => {
      dragging = false;
      hit.releasePointerCapture(ev.pointerId);
    });
  }

  function habUpdateLetterColor(key, color) {
    if (!habSvgEl) return;
    const els = habSvgEl.querySelectorAll("text");
    els.forEach((t) => {
      if (t.textContent === key) t.setAttribute("fill", color);
    });
  }

  function habToggleScaleFields() {
    const scale = $("habScale").value;
    $("habYMinRow").style.display = scale === "linear" ? "none" : "flex";
  }

  // ── Export ───────────────────────────────────────────────────────
  function habSerializeSvg() {
    const clone = habSvgEl.cloneNode(true);
    clone.setAttribute("xmlns", SVG_NS);
    return new XMLSerializer().serializeToString(clone);
  }

  async function habExportSvg() {
    if (!habSvgEl) return;
    const svgText = habSerializeSvg();
    const defaultName = "habitus_plot.svg";

    if (
      window.__TAURI__ && window.__TAURI__.dialog &&
      typeof window.__TAURI__.dialog.save === "function" &&
      window.__TAURI__.fs && typeof window.__TAURI__.fs.writeTextFile === "function"
    ) {
      const filePath = await window.__TAURI__.dialog.save({
        filters: [{ name: "SVG", extensions: ["svg"] }],
        defaultPath: defaultName,
      });
      if (!filePath) return;
      await window.__TAURI__.fs.writeTextFile(filePath, svgText);
      alert("SVG saved successfully!");
    } else {
      const blob = new Blob([svgText], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }

  async function habExportPng() {
    if (!habSvgEl) return;
    const svgText = habSerializeSvg();
    const vb = habSvgEl.viewBox.baseVal;
    const scale = 4; // print-quality supersampling

    const img = new Image();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = vb.width * scale;
      canvas.height = vb.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL("image/png");
      const defaultName = "habitus_plot.png";

      if (
        window.__TAURI__ && window.__TAURI__.dialog &&
        typeof window.__TAURI__.dialog.save === "function" &&
        window.__TAURI__.fs && typeof window.__TAURI__.fs.writeFile === "function"
      ) {
        const filePath = await window.__TAURI__.dialog.save({
          filters: [{ name: "Image", extensions: ["png"] }],
          defaultPath: defaultName,
        });
        if (!filePath) return;
        const base64Data = dataUrl.split(",")[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        await window.__TAURI__.fs.writeFile(filePath, bytes);
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };
    img.src = url;
  }

  // Expose to inline onclick/oninput handlers in index.html
  window.habRenderLibPicker = habRenderLibPicker;
  window.habOnImageFile = habOnImageFile;
  window.habResetImagePosition = habResetImagePosition;
  window.habDraw = habDraw;
  window.habExportPng = habExportPng;
  window.habExportSvg = habExportSvg;
  window.habToggleScaleFields = habToggleScaleFields;
  window.habUpdateLetterColor = habUpdateLetterColor;
})();
