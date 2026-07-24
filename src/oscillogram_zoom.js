// ═══════════════════════════════════════════════════════════════════
// OSCILLOGRAM ZOOM
// One wave, progressively brushed into deeper panels. Panel 0 is always
// the full waveform; dragging across any panel opens that time slice as
// a new panel below it, truncating whatever was zoomed in further.
//
// The whole waveform is decoded once and kept in the browser — no
// per-brush round trip — so a very long recording is refused up front
// (see MAX_SAMPLES) rather than degrading interaction later.
//
// Shares the "slot" annotation model with oscillogram_stack.js (per
// the porting notes, the two should eventually share one osc-core.js;
// for now this is a parallel, self-contained implementation).
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_SAMPLES = 5_000_000;

  let ozSamples = null; // Float32Array, whole waveform, mono
  let ozRate = 1;
  let ozDur = 0;
  let ozLabel = "";
  let ozGlobalPeak = 1;

  let ozPanels = []; // [{ t0, t1, anno:{top,below,temp}, letterSlot }]
  let ozFreeAnnos = [];
  let ozNextFreeId = 1;
  let ozLettersOn = false;
  let ozSvgEl = null;

  function defaultSlot(text, overrides) {
    return Object.assign(
      {
        text,
        dx: 0,
        dy: 0,
        fontSize: 12,
        fontFamily: "Arial,sans-serif",
        italic: false,
        strokeWidth: 0,
        color: null, // null = use the slot's contextual default color
      },
      overrides || {},
    );
  }

  function newPanelAnno(topText) {
    return {
      top: defaultSlot(topText, { fontSize: 12, italic: true }),
      below: defaultSlot("", { fontSize: 11 }),
      temp: defaultSlot("", { fontSize: 11 }),
      scalebar: defaultSlot("", { fontSize: 9, strokeWidth: 1.2, color: "#000" }),
    };
  }

  function newBracketSlot() {
    // locked: selectable (for style changes) but never draggable/nudgeable.
    return defaultSlot("", { strokeWidth: 1, color: "#888", locked: true });
  }

  function peakAbs(samples, i0, i1) {
    let p = 0;
    const end = i1 == null ? samples.length : i1;
    for (let i = i0 || 0; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > p) p = v;
    }
    return p || 1;
  }

  // ── Loading ──────────────────────────────────────────────────────
  function ozSetWave(samples, rate, label) {
    if (samples.length > MAX_SAMPLES) {
      alert(
        `This wave has ${samples.length.toLocaleString()} samples. ` +
          `Zooming happens in the browser with the whole waveform in memory, ` +
          `so files over ${MAX_SAMPLES.toLocaleString()} samples are refused. ` +
          `Trim it to a shorter section first.`,
      );
      return;
    }
    ozSamples = samples;
    ozRate = rate;
    ozDur = samples.length / rate;
    ozLabel = label;
    ozGlobalPeak = peakAbs(samples);
    ozPanels = [{ t0: 0, t1: ozDur, anno: newPanelAnno(label), letterSlot: null, bracketSlot: null }];
    ozFreeAnnos = [];
    ozLettersOn = false;
    const lb = $("btnOzLetters");
    if (lb) lb.textContent = "🔤 Add letters";

    $("ozWaveInfo").textContent = `${label} — ${ozDur.toFixed(3)}s @ ${rate} Hz`;
    ["btnOzDraw", "btnOzLetters", "btnOzAddAnno", "btnOzMale", "btnOzFemale", "btnOzApplyStyle", "btnOzReset"].forEach(
      (id) => {
        const b = $(id);
        if (b) b.disabled = false;
      },
    );
    ozDraw();
  }

  async function ozOpenFile(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(ab.slice(0));
      ctx.close();
      const len = decoded.length;
      const nch = decoded.numberOfChannels;
      const mono = new Float32Array(len);
      for (let c = 0; c < nch; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += ch[i] / nch;
      }
      ozSetWave(mono, decoded.sampleRate, file.name.replace(/\.[^/.]+$/, ""));
    } catch (err) {
      alert(`Could not decode "${file.name}": ${err.message || err}`);
    } finally {
      $("ozFile").value = "";
    }
  }

  // Reuses the audio already decoded in the main Spectral Analysis view
  // (globals `rawSamples`/`sampleRate`/`currentAudioFileName` from main.js),
  // so users don't have to import the same file twice.
  function ozUseLoadedAudio() {
    if (typeof rawSamples === "undefined" || !rawSamples || !rawSamples.length) {
      alert("No audio is loaded in Spectral Analysis yet.");
      return;
    }
    const label =
      (typeof currentAudioFileName !== "undefined" && currentAudioFileName
        ? currentAudioFileName
        : "loaded_audio"
      ).replace(/\.[^/.]+$/, "");
    ozSetWave(Float32Array.from(rawSamples), sampleRate, label);
  }

  function ozResetZoom() {
    if (!ozSamples) return;
    ozPanels = [{ t0: 0, t1: ozDur, anno: newPanelAnno(ozLabel), letterSlot: null, bracketSlot: null }];
    ozDraw();
  }

  // ── Min/max envelope decimation (same port as oscillogram_stack.js) ──
  function minmaxEnvelope(samples, i0, i1, nBinsRequested) {
    const n = i1 - i0;
    const nBins = Math.max(1, Math.min(nBinsRequested, n));
    const env = new Float32Array(nBins * 2);
    for (let b = 0; b < nBins; b++) {
      const start = i0 + Math.floor((b * n) / nBins);
      const end = Math.max(start + 1, i0 + Math.floor(((b + 1) * n) / nBins));
      let mn = samples[start],
        mx = samples[start];
      for (let i = start + 1; i < end; i++) {
        const v = samples[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      env[b * 2] = mn;
      env[b * 2 + 1] = mx;
    }
    return env;
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

  function fmtSeconds(v) {
    if (Math.abs(v) < 1) {
      const ms = v * 1000;
      return (Math.round(ms * 100) / 100).toString() + " ms";
    }
    return (Math.round(v * 100) / 100).toString() + " s";
  }

  // ── Selection / drag / keyboard-nudge / styling ────────────────────
  const SVG_NS = "http://www.w3.org/2000/svg";
  const AXIS_WIDTH = 1400;
  const PAD_X = 40; // left/right margin so brackets aren't clipped at the edge

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Builds a path through `pts` with each interior vertex rounded off
  // (quadratic curve using the vertex itself as the control point) —
  // used for the bracket "shoulders" where a vertical meets a diagonal.
  function roundedPath(pts, radius) {
    const p = (pt) => `${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`;
    let d = `M${p(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1],
        cur = pts[i],
        next = pts[i + 1];
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(radius, d1 / 2, d2 / 2);
      const before = {
        x: cur.x + ((prev.x - cur.x) * r) / (d1 || 1),
        y: cur.y + ((prev.y - cur.y) * r) / (d1 || 1),
      };
      const after = {
        x: cur.x + ((next.x - cur.x) * r) / (d2 || 1),
        y: cur.y + ((next.y - cur.y) * r) / (d2 || 1),
      };
      d += `L${p(before)}Q${p(cur)} ${p(after)}`;
    }
    d += `L${p(pts[pts.length - 1])}`;
    return d;
  }

  const selectedSlots = new Set();
  let currentSlotEls = new Map();

  function clearSelection() {
    for (const s of selectedSlots) {
      const el = currentSlotEls.get(s);
      if (el) el.classList.remove("osc-sel");
    }
    selectedSlots.clear();
  }

  function selectOnly(slot) {
    clearSelection();
    selectedSlots.add(slot);
    const el = currentSlotEls.get(slot);
    if (el) el.classList.add("osc-sel");
  }

  function toggleSelect(slot) {
    const el = currentSlotEls.get(slot);
    if (selectedSlots.has(slot)) {
      selectedSlots.delete(slot);
      if (el) el.classList.remove("osc-sel");
    } else {
      selectedSlots.add(slot);
      if (el) el.classList.add("osc-sel");
    }
  }

  function applyTransform(el, slot) {
    el.setAttribute("transform", `translate(${slot.dx} ${slot.dy})`);
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

  function styleAnnotationEl(el, slot, defaultColor, bold) {
    const col = slot.color || defaultColor;
    el.setAttribute("font-size", slot.fontSize);
    el.setAttribute("font-family", slot.fontFamily);
    if (slot.italic) el.setAttribute("font-style", "italic");
    else el.removeAttribute("font-style");
    if (bold) el.setAttribute("font-weight", 700);
    el.setAttribute("fill", col);
    if (slot.strokeWidth > 0) {
      el.setAttribute("stroke", col);
      el.setAttribute("stroke-width", slot.strokeWidth);
    } else {
      el.removeAttribute("stroke");
      el.removeAttribute("stroke-width");
    }
  }

  // `el` is usually a <text> but can be a <g> wrapping other shapes (a
  // scale bar's line + label, or a zoom bracket's two paths) — pass
  // `skipDefaultStyle` + a `renderText` that styles the children itself.
  function bindInteractions(el, slot, svg, opts) {
    opts = opts || {};
    const renderText =
      opts.renderText ||
      ((e, s) => {
        if (e.tagName === "text") e.textContent = s.text;
      });
    const editable = opts.editable !== false;

    if (!opts.skipDefaultStyle) styleAnnotationEl(el, slot, opts.color || "#111", opts.bold);
    renderText(el, slot);
    applyTransform(el, slot);
    el.classList.add("osc-annot");
    if (selectedSlots.has(slot)) el.classList.add("osc-sel");
    el.style.cursor = "move";
    currentSlotEls.set(slot, el);

    let dragging = false;
    let moved = false;
    let dragSnapshot = null;
    let startClient = null;

    el.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey || ev.ctrlKey) {
        toggleSelect(slot);
        return;
      }
      if (slot.locked) {
        // Selectable (so its style can be changed) but never draggable.
        selectOnly(slot);
        return;
      }
      if (!selectedSlots.has(slot)) selectOnly(slot);
      dragging = true;
      moved = false;
      startClient = { x: ev.clientX, y: ev.clientY };
      dragSnapshot = new Map();
      for (const s of selectedSlots) {
        if (!s.locked) dragSnapshot.set(s, { dx: s.dx, dy: s.dy });
      }
      el.setPointerCapture(ev.pointerId);
    });

    el.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const p0 = clientToSvg(svg, startClient.x, startClient.y);
      const p1 = clientToSvg(svg, ev.clientX, ev.clientY);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
      for (const [s, start] of dragSnapshot) {
        s.dx = start.dx + dx;
        s.dy = start.dy + dy;
        const e2 = currentSlotEls.get(s);
        if (e2) applyTransform(e2, s);
      }
    });

    el.addEventListener("pointerup", (ev) => {
      dragging = false;
      el.releasePointerCapture(ev.pointerId);
    });

    if (editable) {
      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        const next = prompt("Text:", slot.text);
        if (next != null) {
          slot.text = next.trim();
          renderText(el, slot);
        }
      });
    }
  }

  function nudgeSelected(dx, dy) {
    if (!selectedSlots.size) return;
    for (const s of selectedSlots) {
      if (s.locked) continue;
      s.dx += dx;
      s.dy += dy;
      const el = currentSlotEls.get(s);
      if (el) applyTransform(el, s);
    }
  }

  let keyHandlerAttached = false;
  function attachKeyHandler() {
    if (keyHandlerAttached) return;
    keyHandlerAttached = true;
    document.addEventListener("keydown", (ev) => {
      if (!selectedSlots.size) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const step = ev.shiftKey ? 10 : 1;
      let handled = true;
      if (ev.key === "ArrowUp") nudgeSelected(0, -step);
      else if (ev.key === "ArrowDown") nudgeSelected(0, step);
      else if (ev.key === "ArrowLeft") nudgeSelected(-step, 0);
      else if (ev.key === "ArrowRight") nudgeSelected(step, 0);
      else handled = false;
      if (handled) ev.preventDefault();
    });
  }

  // Shift/Ctrl-drag over the background (whole svg, or a panel's hit
  // rect with a modifier held) marquee-selects labels instead of
  // zooming/panning.
  function runMarquee(svg, startClient, ev0) {
    let marqueeing = false;
    let rectEl = null;

    function onMove(ev2) {
      const dxPx = ev2.clientX - startClient.x;
      const dyPx = ev2.clientY - startClient.y;
      if (!marqueeing && (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3)) {
        marqueeing = true;
        rectEl = svgEl("rect", {
          fill: "rgba(32,96,192,0.15)",
          stroke: "#2060c0",
          "stroke-width": 1,
          "stroke-dasharray": "3,2",
          class: "osc-marquee",
        });
        svg.appendChild(rectEl);
      }
      if (!marqueeing) return;
      const p0 = clientToSvg(
        svg,
        Math.min(startClient.x, ev2.clientX),
        Math.min(startClient.y, ev2.clientY),
      );
      const p1 = clientToSvg(
        svg,
        Math.max(startClient.x, ev2.clientX),
        Math.max(startClient.y, ev2.clientY),
      );
      rectEl.setAttribute("x", p0.x);
      rectEl.setAttribute("y", p0.y);
      rectEl.setAttribute("width", Math.max(0, p1.x - p0.x));
      rectEl.setAttribute("height", Math.max(0, p1.y - p0.y));
    }

    function onUp(ev2) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (marqueeing) {
        const rect = {
          left: Math.min(startClient.x, ev2.clientX),
          right: Math.max(startClient.x, ev2.clientX),
          top: Math.min(startClient.y, ev2.clientY),
          bottom: Math.max(startClient.y, ev2.clientY),
        };
        const hits = [];
        for (const [slot, el] of currentSlotEls) {
          const b = el.getBoundingClientRect();
          if (
            b.left < rect.right &&
            b.right > rect.left &&
            b.top < rect.bottom &&
            b.bottom > rect.top
          ) {
            hits.push(slot);
          }
        }
        if (ev2.shiftKey) {
          hits.forEach((s) => {
            selectedSlots.add(s);
            const el = currentSlotEls.get(s);
            if (el) el.classList.add("osc-sel");
          });
        } else if (ev2.ctrlKey) {
          hits.forEach((s) => toggleSelect(s));
        } else {
          clearSelection();
          hits.forEach((s) => {
            selectedSlots.add(s);
            const el = currentSlotEls.get(s);
            if (el) el.classList.add("osc-sel");
          });
        }
        if (rectEl) rectEl.remove();
      } else if (!ev2.shiftKey && !ev2.ctrlKey) {
        clearSelection();
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // ── Brush-to-zoom on a panel's plot area ───────────────────────────
  // The brushed selection is kept centered in the new panel, with extra
  // audio shown on either side (clamped to the parent panel's own
  // range) — so the deepest panel isn't a bare, context-free sliver.
  // The selection's own edges (selT0/selT1) are kept separately from
  // the panel's shown range (t0/t1) so the bracket can still point at
  // exactly what was brushed.
  function zoomToRange(panelIdx, t0, t1) {
    if (t1 < t0) [t0, t1] = [t1, t0];
    const levels = Math.max(2, Math.min(5, parseInt($("ozLevels").value, 10) || 3));
    if (panelIdx >= levels - 1) {
      alert(
        `Maximum panels (${levels}) reached. Increase "Maximum panels" or brush an earlier panel.`,
      );
      return;
    }
    if (t1 - t0 < ozDur / 100000) return; // ignore accidental zero-width brush

    const parent = ozPanels[panelIdx];
    let padPct = parseFloat($("ozContextPad").value);
    if (isNaN(padPct) || padPct < 0) padPct = 30;
    const pad = (t1 - t0) * (padPct / 100);
    const shownT0 = Math.max(parent.t0, t0 - pad);
    const shownT1 = Math.min(parent.t1, t1 + pad);

    ozPanels = ozPanels.slice(0, panelIdx + 1);
    ozPanels.push({
      t0: shownT0,
      t1: shownT1,
      selT0: t0,
      selT1: t1,
      anno: newPanelAnno(""),
      letterSlot: null,
      bracketSlot: newBracketSlot(),
    });
    ozDraw();
  }

  function bindPanelBackground(rectEl, svg, panelIdx, xOff, traceW, t0, t1) {
    rectEl.addEventListener("pointerdown", (ev) => {
      const startClient = { x: ev.clientX, y: ev.clientY };
      if (ev.shiftKey || ev.ctrlKey) {
        runMarquee(svg, startClient, ev);
        return;
      }

      let brushing = false;
      let brushRect = null;

      function onMove(ev2) {
        const dxPx = ev2.clientX - startClient.x;
        if (!brushing && Math.abs(dxPx) > 3) {
          brushing = true;
          brushRect = svgEl("rect", {
            fill: "rgba(217,153,34,0.18)",
            stroke: "#d29922",
            "stroke-width": 1,
            class: "osc-marquee",
          });
          rectEl.parentNode.appendChild(brushRect);
          const y = rectEl.getAttribute("y");
          const h = rectEl.getAttribute("height");
          brushRect.setAttribute("y", y);
          brushRect.setAttribute("height", h);
        }
        if (!brushing) return;
        const p0 = clientToSvg(svg, Math.min(startClient.x, ev2.clientX), 0);
        const p1 = clientToSvg(svg, Math.max(startClient.x, ev2.clientX), 0);
        brushRect.setAttribute("x", p0.x);
        brushRect.setAttribute("width", Math.max(0, p1.x - p0.x));
      }

      function onUp(ev2) {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (brushing) {
          const p0 = clientToSvg(svg, Math.min(startClient.x, ev2.clientX), 0);
          const p1 = clientToSvg(svg, Math.max(startClient.x, ev2.clientX), 0);
          const frac0 = (p0.x - xOff) / traceW;
          const frac1 = (p1.x - xOff) / traceW;
          const newT0 = t0 + Math.max(0, Math.min(1, frac0)) * (t1 - t0);
          const newT1 = t0 + Math.max(0, Math.min(1, frac1)) * (t1 - t0);
          if (brushRect) brushRect.remove();
          zoomToRange(panelIdx, newT0, newT1);
        } else if (!ev2.shiftKey && !ev2.ctrlKey) {
          clearSelection();
        }
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // ── Letters / free annotations / symbols ───────────────────────────
  function ozToggleLetters() {
    if (!ozSamples) return;
    ozLettersOn = !ozLettersOn;
    $("btnOzLetters").textContent = ozLettersOn ? "🔤 Remove letters" : "🔤 Add letters";
    ozDraw();
  }

  function ozAddAnnotation() {
    if (!ozSamples) return;
    const n = ozFreeAnnos.length;
    const slot = defaultSlot("Text", { fontSize: 13 });
    slot.id = ozNextFreeId++;
    slot.baseX = 30 + ((n * 18) % 200);
    slot.baseY = 24 + ((n * 18) % 120);
    slot.anchor = "start";
    ozFreeAnnos.push(slot);
    ozDraw();
    selectOnly(slot);
  }

  function ozAddSymbol(sym) {
    if (!ozSamples) return;
    const n = ozFreeAnnos.length;
    const slot = defaultSlot(sym, { fontSize: 22, strokeWidth: 0.6 });
    slot.id = ozNextFreeId++;
    slot.baseX = 60 + ((n * 20) % 200);
    slot.baseY = 60 + ((n * 20) % 120);
    slot.anchor = "middle";
    ozFreeAnnos.push(slot);
    ozDraw();
    selectOnly(slot);
  }

  function allSlots() {
    const list = [];
    ozPanels.forEach((p) => {
      list.push(p.anno.top, p.anno.below, p.anno.temp, p.anno.scalebar);
      if (ozLettersOn && p.letterSlot) list.push(p.letterSlot);
      if (p.bracketSlot) list.push(p.bracketSlot);
    });
    ozFreeAnnos.forEach((s) => list.push(s));
    return list;
  }

  function ozApplyStyle() {
    if (!ozSamples) return;
    const family = $("ozFontFamily").value;
    const size = parseFloat($("ozFontSize").value);
    const thickness = parseFloat($("ozStrokeWidth").value);
    const color = $("ozLabelColor").value;
    const applyAll = $("ozApplyAllLabels").checked;
    const targets = applyAll ? allSlots() : Array.from(selectedSlots);

    if (!targets.length) {
      alert('Select one or more labels first, or check "Apply to all labels".');
      return;
    }
    targets.forEach((s) => {
      if (family) s.fontFamily = family;
      if (!isNaN(size) && size > 0) s.fontSize = size;
      if (!isNaN(thickness) && thickness >= 0) s.strokeWidth = thickness;
      if (color) s.color = color;
    });
    ozDraw();
  }

  // ── Drawing ───────────────────────────────────────────────────────
  function ozDraw() {
    if (!ozSamples) return;
    attachKeyHandler();
    currentSlotEls = new Map();

    const display = $("ozDisplay").value;
    const rescalePanels = $("ozRescalePanels").checked;
    const traceColor = $("ozTraceColor").value;
    const traceWidth = parseFloat($("ozTraceWidth").value) || 0.7;
    const rowHeight = parseFloat($("ozRowHeight").value) || 150;
    const showLabels = $("ozShowLabels").checked;

    const topLabelH = showLabels ? 18 : 0;
    const axisH = display === "axes" ? 16 : 0;
    const rowGap = 8;
    const rowStride = rowHeight + topLabelH + axisH + rowGap;
    const totalH = ozPanels.length * rowStride + 24;

    const svg = svgEl("svg", {
      xmlns: SVG_NS,
      viewBox: `0 0 ${AXIS_WIDTH} ${totalH}`,
      style:
        "width:100%;height:auto;display:block;background:#fff;font-family:Arial,sans-serif",
      tabindex: 0,
    });

    // Full-canvas background: outside any panel, drag = marquee select,
    // click = deselect. Panels stack their own hit rects on top of this.
    const baseRect = svgEl("rect", {
      x: 0,
      y: 0,
      width: AXIS_WIDTH,
      height: totalH,
      fill: "transparent",
    });
    svg.appendChild(baseRect);
    baseRect.addEventListener("pointerdown", (ev) => {
      runMarquee(svg, { x: ev.clientX, y: ev.clientY }, ev);
    });

    let prevGeom = null; // { t0, t1, traceY1, midY } of the panel above, for brackets

    ozPanels.forEach((panel, idx) => {
      const t0 = panel.t0,
        t1 = panel.t1;
      const i0 = Math.max(0, Math.floor(t0 * ozRate));
      const i1 = Math.min(ozSamples.length, Math.ceil(t1 * ozRate));
      const nSamples = Math.max(1, i1 - i0);
      const nBins = Math.min(nSamples, 8000);
      const samplesPerBin = nSamples / nBins;

      const effPeak = rescalePanels ? peakAbs(ozSamples, i0, i1) : ozGlobalPeak;

      const rowY = idx * rowStride;
      const traceY0 = rowY + topLabelH;
      const traceY1 = traceY0 + rowHeight;
      const midY = (traceY0 + traceY1) / 2;
      const ampScale = (rowHeight / 2 - 2) / effPeak;
      const xOff = PAD_X;
      const traceW = AXIS_WIDTH - PAD_X * 2;

      // Brackets: show where this panel's slice sits within the parent
      // panel above it. The vertical portions run almost all the way to
      // each panel's own zero line (leaving a small margin so they don't
      // touch it), then bend into a diagonal that crosses the gap to the
      // matching vertical in the other panel — which stops short of the
      // panel's full width now that padding adds context on either side
      // of the selection.
      if (idx > 0 && prevGeom) {
        if (!panel.bracketSlot) panel.bracketSlot = newBracketSlot();
        const selT0 = panel.selT0 != null ? panel.selT0 : t0;
        const selT1 = panel.selT1 != null ? panel.selT1 : t1;
        const xLeftParent =
          xOff + ((selT0 - prevGeom.t0) / (prevGeom.t1 - prevGeom.t0)) * traceW;
        const xRightParent =
          xOff + ((selT1 - prevGeom.t0) / (prevGeom.t1 - prevGeom.t0)) * traceW;
        const xLeftChild = xOff + ((selT0 - t0) / (t1 - t0)) * traceW;
        const xRightChild = xOff + ((selT1 - t0) / (t1 - t0)) * traceW;
        const zeroLineMargin = 4;
        const parentY = prevGeom.midY + zeroLineMargin;
        const childY = midY - zeroLineMargin;
        const shoulderR = 10; // rounds the two bends per side
        const leftD = roundedPath(
          [
            { x: xLeftParent, y: parentY },
            { x: xLeftParent, y: prevGeom.traceY1 },
            { x: xLeftChild, y: traceY0 },
            { x: xLeftChild, y: childY },
          ],
          shoulderR,
        );
        const rightD = roundedPath(
          [
            { x: xRightParent, y: parentY },
            { x: xRightParent, y: prevGeom.traceY1 },
            { x: xRightChild, y: traceY0 },
            { x: xRightChild, y: childY },
          ],
          shoulderR,
        );
        const bracketG = svgEl("g", {});
        const leftPath = svgEl("path", { d: leftD, fill: "none" });
        const rightPath = svgEl("path", { d: rightD, fill: "none" });
        bracketG.appendChild(leftPath);
        bracketG.appendChild(rightPath);
        svg.appendChild(bracketG);
        bindInteractions(bracketG, panel.bracketSlot, svg, {
          skipDefaultStyle: true,
          editable: false,
          renderText: (el, slot) => {
            const col = slot.color || "#888";
            [leftPath, rightPath].forEach((p) => {
              p.setAttribute("stroke", col);
              p.setAttribute("stroke-width", slot.strokeWidth || 1);
            });
          },
        });
      }

      const g = svgEl("g", { class: "osc-row" });

      // Panel hit-rect: catches brush-to-zoom (plain drag) and
      // marquee-select (Shift/Ctrl-drag). Sits under the trace visually
      // (appended first) but above the full-canvas background rect.
      const hitRect = svgEl("rect", {
        x: xOff,
        y: traceY0,
        width: traceW,
        height: rowHeight,
        fill: "transparent",
      });
      g.appendChild(hitRect);
      bindPanelBackground(hitRect, svg, idx, xOff, traceW, t0, t1);

      g.appendChild(
        svgEl("line", {
          x1: xOff,
          x2: xOff + traceW,
          y1: midY,
          y2: midY,
          stroke: "#ccc",
          "stroke-width": 0.5,
          "pointer-events": "none",
        }),
      );

      let d = "";
      if (samplesPerBin < 2) {
        // Deep zoom: fewer than ~2 samples per column means min/max
        // decimation degenerates (min==max ⇒ zero-length SVG segments
        // that don't render). Plot the actual samples as a polyline.
        for (let i = i0; i < i1; i++) {
          const x = xOff + ((i - i0) / Math.max(1, nSamples - 1)) * traceW;
          const y = midY - ozSamples[i] * ampScale;
          d += (i === i0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
        }
      } else {
        const env = minmaxEnvelope(ozSamples, i0, i1, nBins);
        for (let b = 0; b < nBins; b++) {
          const x = xOff + (b / Math.max(1, nBins - 1)) * traceW;
          const yMax = midY - env[b * 2 + 1] * ampScale;
          const yMin = midY - env[b * 2] * ampScale;
          d += (b === 0 ? "M" : "L") + x.toFixed(2) + " " + yMax.toFixed(2);
          d += "L" + x.toFixed(2) + " " + yMin.toFixed(2);
        }
      }
      g.appendChild(
        svgEl("path", {
          d,
          fill: "none",
          stroke: traceColor,
          "stroke-width": traceWidth,
          "stroke-linecap": "round",
          "pointer-events": "none",
        }),
      );

      // Time reference: self-sizing scale bar, or a tick axis.
      const panelDur = t1 - t0;
      if (display === "scalebar") {
        const step = niceStep(panelDur * 0.2);
        const barW = (step / panelDur) * traceW;
        const barY = traceY1 - 6;
        const barX = xOff + 24; // nudged right, clear of the left margin
        const sbSlot = panel.anno.scalebar;
        const sbG = svgEl("g", {});
        const lineEl = svgEl("line", { x1: barX, x2: barX + barW, y1: barY, y2: barY });
        const lblEl = svgEl("text", { x: barX, y: barY - 3 });
        sbG.appendChild(lineEl);
        sbG.appendChild(lblEl);
        g.appendChild(sbG);
        bindInteractions(sbG, sbSlot, svg, {
          skipDefaultStyle: true,
          editable: false,
          renderText: (el, slot) => {
            const col = slot.color || "#000";
            lineEl.setAttribute("stroke", col);
            lineEl.setAttribute("stroke-width", slot.strokeWidth || 1.2);
            lblEl.setAttribute("fill", col);
            lblEl.setAttribute("font-size", slot.fontSize || 9);
            lblEl.setAttribute("font-family", slot.fontFamily || "Arial,sans-serif");
            lblEl.textContent = fmtSeconds(step);
          },
        });
      } else {
        const step = niceStep(panelDur / 5);
        const axisY = traceY1 + 12;
        const firstTick = Math.ceil(t0 / step) * step;
        for (let t = firstTick; t <= t1 + 1e-9; t += step) {
          const x = xOff + ((t - t0) / panelDur) * traceW;
          g.appendChild(
            svgEl("line", {
              x1: x,
              x2: x,
              y1: traceY1,
              y2: traceY1 + 4,
              stroke: "#000",
              "stroke-width": 1,
              "pointer-events": "none",
            }),
          );
          const lbl = svgEl("text", {
            x,
            y: axisY + 6,
            "font-size": 8,
            "text-anchor": "middle",
            fill: "#000",
            "pointer-events": "none",
          });
          lbl.textContent = fmtSeconds(t);
          g.appendChild(lbl);
        }
      }

      if (showLabels) {
        const topEl = svgEl("text", { x: xOff, y: rowY + 13 });
        g.appendChild(topEl);
        bindInteractions(topEl, panel.anno.top, svg, {
          renderText: (el, slot) => (el.textContent = slot.text),
        });

        const belowEl = svgEl("text", { x: xOff, y: midY + 16 });
        g.appendChild(belowEl);
        bindInteractions(belowEl, panel.anno.below, svg, {
          color: "#333",
          renderText: (el, slot) => {
            el.textContent = slot.text || "(label)";
            el.style.opacity = slot.text ? "1" : "0.35";
          },
        });

        const tempEl = svgEl("text", {
          x: xOff + traceW - 8,
          y: midY - 8,
          "text-anchor": "end",
        });
        g.appendChild(tempEl);
        bindInteractions(tempEl, panel.anno.temp, svg, {
          color: "#333",
          renderText: (el, slot) => {
            el.textContent = (slot.text || "—") + " °C";
            el.style.opacity = slot.text ? "1" : "0.35";
          },
        });
      }

      if (ozLettersOn) {
        if (!panel.letterSlot) panel.letterSlot = defaultSlot("", { fontSize: 18 });
        const letterChar = String.fromCharCode(65 + idx);
        const letterEl = svgEl("text", { x: 4, y: traceY0 + 14 });
        g.appendChild(letterEl);
        bindInteractions(letterEl, panel.letterSlot, svg, {
          bold: true,
          editable: false,
          renderText: (el) => (el.textContent = letterChar),
        });
      }

      svg.appendChild(g);
      prevGeom = { t0, t1, traceY1, midY };
    });

    ozFreeAnnos.forEach((slot) => {
      const el = svgEl("text", {
        x: slot.baseX,
        y: slot.baseY,
        "text-anchor": slot.anchor || "start",
      });
      svg.appendChild(el);
      bindInteractions(el, slot, svg, {
        renderText: (e, s) => (e.textContent = s.text),
      });
    });

    const wrap = $("ozStackWrap");
    wrap.innerHTML = "";
    wrap.appendChild(svg);
    ozSvgEl = svg;

    $("btnOzSvg").disabled = false;
    $("btnOzPng").disabled = false;
  }

  // ── Export ────────────────────────────────────────────────────────
  function ozSerializeSvg() {
    const clone = ozSvgEl.cloneNode(true);
    clone.querySelectorAll(".osc-marquee").forEach((r) => r.remove());
    clone.querySelectorAll(".osc-annot").forEach((t) => {
      t.style.cursor = "";
      t.classList.remove("osc-sel");
    });
    clone.querySelectorAll("text").forEach((t) => {
      if (t.style.opacity && parseFloat(t.style.opacity) < 1) {
        t.remove();
      } else {
        t.style.opacity = "";
      }
    });
    return new XMLSerializer().serializeToString(clone);
  }

  async function ozExportSvg() {
    if (!ozSvgEl) return;
    const svgText = ozSerializeSvg();
    const defaultName = "oscillogram_zoom.svg";

    if (
      window.__TAURI__ &&
      window.__TAURI__.dialog &&
      typeof window.__TAURI__.dialog.save === "function" &&
      window.__TAURI__.fs &&
      typeof window.__TAURI__.fs.writeTextFile === "function"
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

  async function ozExportPng() {
    if (!ozSvgEl) return;
    const svgText = ozSerializeSvg();
    const vb = ozSvgEl.viewBox.baseVal;
    const scale = 2;

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
      const defaultName = "oscillogram_zoom.png";

      if (
        window.__TAURI__ &&
        window.__TAURI__.dialog &&
        typeof window.__TAURI__.dialog.save === "function" &&
        window.__TAURI__.fs &&
        typeof window.__TAURI__.fs.writeFile === "function"
      ) {
        const filePath = await window.__TAURI__.dialog.save({
          filters: [{ name: "Image", extensions: ["png"] }],
          defaultPath: defaultName,
        });
        if (!filePath) return;
        const base64Data = dataUrl.split(",")[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++)
          bytes[i] = binaryString.charCodeAt(i);
        await window.__TAURI__.fs.writeFile(filePath, bytes);
        alert("PNG saved successfully!");
      } else {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(dlUrl);
      }
    };
    img.src = url;
  }

  // Expose to inline onclick/oninput handlers in index.html
  window.ozOpenFile = ozOpenFile;
  window.ozUseLoadedAudio = ozUseLoadedAudio;
  window.ozResetZoom = ozResetZoom;
  window.ozDraw = ozDraw;
  window.ozExportSvg = ozExportSvg;
  window.ozExportPng = ozExportPng;
  window.ozToggleLetters = ozToggleLetters;
  window.ozAddAnnotation = ozAddAnnotation;
  window.ozAddSymbol = ozAddSymbol;
  window.ozApplyStyle = ozApplyStyle;
})();
