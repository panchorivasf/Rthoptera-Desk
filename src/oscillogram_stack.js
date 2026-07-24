// ═══════════════════════════════════════════════════════════════════
// OSCILLOGRAM STACK
// Several waves, decimated to a min/max envelope, drawn on one shared
// SVG time axis. Mirrors the R/Shiny oscillogram_stack widget: R (here,
// the browser) computes a small envelope once, then the SVG is edited
// and exported without any further recomputation.
//
// All movable text (per-trace labels, panel letters, free annotations,
// symbols) shares one "slot" shape — {text, dx, dy, fontSize,
// fontFamily, italic, strokeWidth, ...} — and one selection/drag/
// keyboard-nudge/style-apply pipeline, so a fix in one applies to all.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);

  let oscWaves = []; // { id, label, samples: Float32Array, rate, dur }
  let oscNextId = 1;
  let oscDurTouched = false; // true once the user hand-edits the time axis
  let oscAutoSet = false;
  let oscSvgEl = null;

  // Per-wave annotation slots, independent of the wave-list name (w.label).
  const oscAnno = new Map(); // waveId -> { top, below, temp }
  let oscLettersOn = false;
  const oscLetterPos = new Map(); // waveId -> slot (text implicit: A, B, C…)
  let oscFreeAnnos = []; // free-floating text/symbol slots
  let oscNextFreeId = 1;

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

  function newAnnoSet(topText) {
    return {
      top: defaultSlot(topText, { fontSize: 12, italic: true }),
      below: defaultSlot("", { fontSize: 11 }),
      temp: defaultSlot("", { fontSize: 11 }),
      scalebar: defaultSlot("", { fontSize: 9, strokeWidth: 1.2, color: "#000" }),
    };
  }

  // ── Decoding ─────────────────────────────────────────────────────
  async function oscAddFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      try {
        const ab = await file.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(ab.slice(0));
        ctx.close();

        // Mono-mix by averaging channels, matching how the rest of the app
        // treats multi-channel audio.
        const len = decoded.length;
        const nch = decoded.numberOfChannels;
        const mono = new Float32Array(len);
        for (let c = 0; c < nch; c++) {
          const ch = decoded.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] += ch[i] / nch;
        }

        const label = file.name.replace(/\.[^/.]+$/, "");
        const id = oscNextId++;
        oscWaves.push({
          id,
          label,
          samples: mono,
          rate: decoded.sampleRate,
          dur: len / decoded.sampleRate,
        });
        oscAnno.set(id, newAnnoSet(label));
      } catch (err) {
        alert(`Could not decode "${file.name}": ${err.message || err}`);
      }
    }

    $("oscFiles").value = "";
    oscRenderWaveList();
    oscOnBufferChange();
  }

  function oscRemoveWave(id) {
    oscWaves = oscWaves.filter((w) => w.id !== id);
    oscAnno.delete(id);
    oscLetterPos.delete(id);
    oscRenderWaveList();
    oscOnBufferChange();
  }

  function oscMoveWave(id, dir) {
    const i = oscWaves.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= oscWaves.length) return;
    [oscWaves[i], oscWaves[j]] = [oscWaves[j], oscWaves[i]];
    oscRenderWaveList();
  }

  function oscRenderWaveList() {
    const el = $("oscWaveList");
    const hasWaves = oscWaves.length > 0;
    ["btnOscDraw", "btnOscLetters", "btnOscAddAnno", "btnOscMale", "btnOscFemale", "btnOscApplyStyle"].forEach(
      (id) => {
        const b = $(id);
        if (b) b.disabled = !hasWaves;
      },
    );

    if (!oscWaves.length) {
      el.innerHTML =
        '<div style="color: var(--txt2); font-size: 11px">No waves loaded.</div>';
      return;
    }

    el.innerHTML = "";
    oscWaves.forEach((w, idx) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:4px;padding:2px 0;border-bottom:1px solid var(--border)";
      row.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${w.label} — ${w.dur.toFixed(3)}s @ ${w.rate}Hz">${w.label}</span>
        <button style="font-size:10px;padding:1px 5px" data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button style="font-size:10px;padding:1px 5px" data-act="down" ${idx === oscWaves.length - 1 ? "disabled" : ""}>▼</button>
        <button style="font-size:10px;padding:1px 5px" data-act="rm">✕</button>
      `;
      row.querySelector('[data-act="up"]').onclick = () =>
        oscMoveWave(w.id, -1);
      row.querySelector('[data-act="down"]').onclick = () =>
        oscMoveWave(w.id, 1);
      row.querySelector('[data-act="rm"]').onclick = () => oscRemoveWave(w.id);
      el.appendChild(row);
    });
  }

  // ── Axis defaulting (mirrors dur_touched/auto_set in server.R) ──
  function oscSuggestedDur() {
    if (!oscWaves.length) return null;
    let buf = parseFloat($("oscDurBuffer").value);
    if (isNaN(buf)) buf = 0;
    const maxDur = Math.max(...oscWaves.map((w) => w.dur));
    return Math.ceil((maxDur + buf) * 100) / 100;
  }

  function oscOnBufferChange() {
    if (!oscWaves.length || oscDurTouched) return;
    const sug = oscSuggestedDur();
    if (sug == null) return;
    oscAutoSet = true;
    $("oscMaxDur").value = sug;
  }

  function oscTouchDur() {
    if (oscAutoSet) {
      oscAutoSet = false;
    } else {
      oscDurTouched = true;
    }
  }

  // ── Min/max envelope decimation ──────────────────────────────────
  // Direct JS port of minmax_envelope.cpp: for each of n_bins output
  // columns, the min and max sample within that bin. n_bins is clamped
  // to the wave's own length so short waves keep full resolution.
  function minmaxEnvelope(samples, nBinsRequested) {
    const n = samples.length;
    const nBins = Math.max(1, Math.min(nBinsRequested, n));
    const env = new Float32Array(nBins * 2);
    for (let b = 0; b < nBins; b++) {
      const start = Math.floor((b * n) / nBins);
      const end = Math.max(start + 1, Math.floor(((b + 1) * n) / nBins));
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

  function peakAbs(samples) {
    let p = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > p) p = v;
    }
    return p || 1;
  }

  // ── Selection / drag / keyboard-nudge / styling (shared by every
  // annotation slot: per-trace labels, letters, free text, symbols) ──
  const SVG_NS = "http://www.w3.org/2000/svg";
  const AXIS_WIDTH = 1400; // internal SVG units; scales to fill the container

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  const selectedSlots = new Set();
  let currentSlotEls = new Map(); // slot -> <text> element, rebuilt each draw

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

  // Wires selection (click / shift-click / ctrl-click), group drag, and
  // optional double-click text editing onto one annotation element. `el`
  // is usually a <text> but can be a <g> wrapping other shapes (e.g. a
  // scale bar's line + label, or a bracket's two paths) — pass
  // `skipDefaultStyle` + a `renderText` that styles the children itself
  // in that case.
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
      if (!selectedSlots.has(slot)) selectOnly(slot);
      dragging = true;
      moved = false;
      startClient = { x: ev.clientX, y: ev.clientY };
      dragSnapshot = new Map();
      for (const s of selectedSlots) dragSnapshot.set(s, { dx: s.dx, dy: s.dy });
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

  // Rectangle-marquee selection when dragging on empty canvas.
  // Plain drag replaces the selection; Shift adds; Ctrl toggles.
  function bindMarquee(svg) {
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.target !== svg) return;
      const startClient = { x: ev.clientX, y: ev.clientY };
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
    });
  }

  // ── Letters / free annotations / symbols ───────────────────────────
  function oscToggleLetters() {
    if (!oscWaves.length) {
      alert("Add waves first.");
      return;
    }
    oscLettersOn = !oscLettersOn;
    const btn = $("btnOscLetters");
    if (btn) btn.textContent = oscLettersOn ? "🔤 Remove letters" : "🔤 Add letters";
    if (oscLettersOn) {
      oscWaves.forEach((w) => {
        if (!oscLetterPos.has(w.id)) oscLetterPos.set(w.id, defaultSlot("", { fontSize: 18 }));
      });
    }
    oscDraw();
  }

  function oscAddAnnotation() {
    if (!oscWaves.length) {
      alert("Add waves and draw the stack first.");
      return;
    }
    const n = oscFreeAnnos.length;
    const slot = defaultSlot("Text", { fontSize: 13 });
    slot.id = oscNextFreeId++;
    slot.baseX = 30 + ((n * 18) % 200);
    slot.baseY = 24 + ((n * 18) % 120);
    slot.anchor = "start";
    oscFreeAnnos.push(slot);
    oscDraw();
    selectOnly(slot);
  }

  function oscAddSymbol(sym) {
    if (!oscWaves.length) {
      alert("Add waves and draw the stack first.");
      return;
    }
    const n = oscFreeAnnos.length;
    const slot = defaultSlot(sym, { fontSize: 22, strokeWidth: 0.6 });
    slot.id = oscNextFreeId++;
    slot.baseX = 60 + ((n * 20) % 200);
    slot.baseY = 60 + ((n * 20) % 120);
    slot.anchor = "middle";
    oscFreeAnnos.push(slot);
    oscDraw();
    selectOnly(slot);
  }

  // ── Style controls (apply to selection, or every label if checked) ──
  function allSlots() {
    const list = [];
    oscAnno.forEach((a) => list.push(a.top, a.below, a.temp, a.scalebar));
    if (oscLettersOn) oscLetterPos.forEach((s) => list.push(s));
    oscFreeAnnos.forEach((s) => list.push(s));
    return list;
  }

  function oscApplyStyle() {
    if (!oscWaves.length) return;
    const family = $("oscFontFamily").value;
    const size = parseFloat($("oscFontSize").value);
    const thickness = parseFloat($("oscStrokeWidth").value);
    const color = $("oscLabelColor").value;
    const applyAll = $("oscApplyAllLabels").checked;
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
    oscDraw();
  }

  // ── Drawing ───────────────────────────────────────────────────────
  function oscDraw() {
    if (!oscWaves.length) return;
    attachKeyHandler();
    currentSlotEls = new Map();

    const maxDur = parseFloat($("oscMaxDur").value) || oscSuggestedDur() || 1;
    const scalebar = parseFloat($("oscScalebar").value) || 0;
    const allScalebar = $("oscAllScalebar").checked;
    const traceColor = $("oscTraceColor").value;
    const traceWidth = parseFloat($("oscTraceWidth").value) || 0.7;
    const rowHeight = parseFloat($("oscRowHeight").value) || 110;
    const showLabels = $("oscShowLabels").checked;
    const normalize = $("oscNormalize").checked;

    const overLong = oscWaves.filter((w) => w.dur > maxDur);
    if (overLong.length) {
      const ok = confirm(
        `${overLong.length} wave(s) are longer than the time axis (${maxDur}s) and will be clipped. Continue?`,
      );
      if (!ok) return;
    }

    const globalPeak = normalize
      ? 1
      : Math.max(...oscWaves.map((w) => peakAbs(w.samples)));

    const topLabelH = showLabels ? 18 : 0;
    const rowGap = 8;
    const rowStride = rowHeight + topLabelH + rowGap;
    const totalH = oscWaves.length * rowStride + 24;
    const svg = svgEl("svg", {
      xmlns: SVG_NS,
      viewBox: `0 0 ${AXIS_WIDTH} ${totalH}`,
      style:
        "width:100%;height:auto;display:block;background:#fff;font-family:Arial,sans-serif",
      tabindex: 0,
    });
    bindMarquee(svg);

    oscWaves.forEach((w, idx) => {
      const anno = oscAnno.get(w.id) || newAnnoSet(w.label);
      oscAnno.set(w.id, anno);

      const nSamples = w.samples.length;
      const nBins = Math.min(nSamples, 8000);
      const env = minmaxEnvelope(w.samples, nBins);
      const effPeak = normalize ? peakAbs(w.samples) : globalPeak;

      // Trace spans dur/maxDur of the axis width, centred — no zero padding.
      const traceFrac = Math.min(1, w.dur / maxDur);
      const traceW = AXIS_WIDTH * traceFrac;
      const xOff = (AXIS_WIDTH - traceW) / 2;
      const rowY = idx * rowStride;
      const traceY0 = rowY + topLabelH;
      const traceY1 = rowY + topLabelH + rowHeight;
      const midY = (traceY0 + traceY1) / 2;
      const ampScale = (rowHeight / 2 - 2) / effPeak;

      const g = svgEl("g", { class: "osc-row" });

      // Baseline (zero line) across the full row width.
      g.appendChild(
        svgEl("line", {
          x1: 0,
          x2: AXIS_WIDTH,
          y1: midY,
          y2: midY,
          stroke: "#ccc",
          "stroke-width": 0.5,
        }),
      );

      // One continuous path: min/max columns joined, never isolated
      // zero-length segments (those render as nothing in SVG).
      let d = "";
      for (let b = 0; b < nBins; b++) {
        const x = xOff + (b / Math.max(1, nBins - 1)) * traceW;
        const yMax = midY - env[b * 2 + 1] * ampScale;
        const yMin = midY - env[b * 2] * ampScale;
        d += (b === 0 ? "M" : "L") + x.toFixed(2) + " " + yMax.toFixed(2);
        d += "L" + x.toFixed(2) + " " + yMin.toFixed(2);
      }
      g.appendChild(
        svgEl("path", {
          d,
          fill: "none",
          stroke: traceColor,
          "stroke-width": traceWidth,
          "stroke-linecap": "round",
        }),
      );

      // Scale bar: first trace, or every trace if requested. Rendered as
      // one selectable/draggable group (line + label) sharing the slot
      // model, so it moves and restyles exactly like any other label.
      if (scalebar > 0 && (idx === 0 || allScalebar)) {
        const barW = (scalebar / maxDur) * AXIS_WIDTH;
        const barY = traceY1 - 6;
        const barX = xOff + 24; // nudged right, clear of the left margin
        const sbSlot = anno.scalebar;
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
            lblEl.textContent = `${scalebar} s`;
          },
        });
      }

      if (showLabels) {
        // Top slot — pre-filled with the wave's name, italic (species-name
        // convention). Editing it here does NOT rename the wave in the list.
        const topEl = svgEl("text", { x: xOff, y: rowY + 13 });
        g.appendChild(topEl);
        bindInteractions(topEl, anno.top, svg, {
          renderText: (el, slot) => (el.textContent = slot.text),
        });

        // Below-zero-line slot — empty by default (locality/notes).
        const belowEl = svgEl("text", { x: xOff, y: midY + 16 });
        g.appendChild(belowEl);
        bindInteractions(belowEl, anno.below, svg, {
          color: "#333",
          renderText: (el, slot) => {
            el.textContent = slot.text || "(label)";
            el.style.opacity = slot.text ? "1" : "0.35";
          },
        });

        // Temperature slot — right edge of the row.
        const tempEl = svgEl("text", {
          x: AXIS_WIDTH - 8,
          y: midY - 8,
          "text-anchor": "end",
        });
        g.appendChild(tempEl);
        bindInteractions(tempEl, anno.temp, svg, {
          color: "#333",
          renderText: (el, slot) => {
            el.textContent = (slot.text || "—") + " °C";
            el.style.opacity = slot.text ? "1" : "0.35";
          },
        });
      }

      // Panel letters — top-left of each trace, not the wave name, so
      // they renumber automatically when the order changes.
      if (oscLettersOn) {
        let slot = oscLetterPos.get(w.id);
        if (!slot) {
          slot = defaultSlot("", { fontSize: 18 });
          oscLetterPos.set(w.id, slot);
        }
        const letterChar = String.fromCharCode(65 + idx);
        const letterEl = svgEl("text", { x: 4, y: traceY0 + 14 });
        g.appendChild(letterEl);
        bindInteractions(letterEl, slot, svg, {
          bold: true,
          editable: false,
          renderText: (el) => (el.textContent = letterChar),
        });
      }

      svg.appendChild(g);
    });

    // Free-floating annotations and symbols — not tied to any one row.
    oscFreeAnnos.forEach((slot) => {
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

    const wrap = $("oscStackWrap");
    wrap.innerHTML = "";
    wrap.appendChild(svg);
    oscSvgEl = svg;

    $("btnOscSvg").disabled = false;
    $("btnOscPng").disabled = false;
  }

  // ── Export ────────────────────────────────────────────────────────
  function oscSerializeSvg() {
    // Strip editor-only affordances (selection outline, drag cursor,
    // marquee rect, placeholder text/opacity) before export so the
    // standalone file matches what a reader should see, not the editing
    // state.
    const clone = oscSvgEl.cloneNode(true);
    clone.querySelectorAll(".osc-marquee").forEach((r) => r.remove());
    clone.querySelectorAll(".osc-annot").forEach((t) => {
      t.style.cursor = "";
      t.classList.remove("osc-sel");
    });
    clone.querySelectorAll("text").forEach((t) => {
      if (t.style.opacity && parseFloat(t.style.opacity) < 1) {
        t.remove(); // don't export unfilled placeholder text
      } else {
        t.style.opacity = "";
      }
    });
    return new XMLSerializer().serializeToString(clone);
  }

  async function oscExportSvg() {
    if (!oscSvgEl) return;
    const svgText = oscSerializeSvg();
    const defaultName = "oscillogram_stack.svg";

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

  async function oscExportPng() {
    if (!oscSvgEl) return;
    const svgText = oscSerializeSvg();
    const vb = oscSvgEl.viewBox.baseVal;
    const scale = 2; // basic supersampling for print-quality PNG

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
      const defaultName = "oscillogram_stack.png";

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
  window.oscAddFiles = oscAddFiles;
  window.oscOnBufferChange = oscOnBufferChange;
  window.oscTouchDur = oscTouchDur;
  window.oscDraw = oscDraw;
  window.oscExportSvg = oscExportSvg;
  window.oscExportPng = oscExportPng;
  window.oscToggleLetters = oscToggleLetters;
  window.oscAddAnnotation = oscAddAnnotation;
  window.oscAddSymbol = oscAddSymbol;
  window.oscApplyStyle = oscApplyStyle;
})();
