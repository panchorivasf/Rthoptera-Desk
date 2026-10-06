// ═══════════════════════════════════════════════════════════════════
// MULTI-MEAN SPECTRA
// Port of the Rthoptera Shiny app "multi_meanspectra_plotly". One wave:
// its oscillogram on top, brushable in time, and below it the mean power
// spectrum of the whole wave (black line) with the mean spectrum of every
// brushed stretch laid over it as a coloured filled area, so the spectra of
// e.g. the opening and closing strokes, or a male and a female, can be read
// against each other.
//
// What carries over exactly from the Shiny app:
//   - the mean spectrum is seewave::meanspec's: a Hann window of the chosen
//     length, no overlap, the magnitude spectra of all windows averaged, then
//     normalised to a maximum of 1;
//   - the oscillogram is min-max scaled to -1..1;
//   - a selection's spectrum is scaled by the largest (scaled) amplitude
//     inside it, so a loud stroke draws a taller area than a quiet one;
//   - the selections' colours come from the same colour-blind-safe palette,
//     and the brushed stretch is recoloured on the oscillogram.
// Differences: the frequency axis is in kHz (meanspec returns kHz; the Shiny
// app labels it Hz), and the figure is exported as PNG / SVG / CSV rather
// than as a plotly HTML page.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const MAX_SAMPLES = 40_000_000;
  const PALETTE = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#F0E442",
    "#56B4E9",
    "#999999",
    "#D55E00",
  ];

  let msSamples = null;
  let msRate = 1;
  let msDur = 0;
  let msLabel = "";
  let msMin = 0; // waveform extremes, for the -1..1 scaling
  let msMax = 1;
  let msFull = null; // { freqs (kHz), amp } of the whole wave, window = msFullWl
  let msFullWl = 0;
  let msSels = []; // { id, name, t0, t1, color, spec }
  let msNextId = 1;
  let msPending = null; // { t0, t1 } brushed, not yet added
  let msLibSelectedId = null;
  let msSvgEl = null;
  let msGeo = null; // plot geometry of the last draw, for the pointer handlers

  const hannCache = {};
  function hann(n) {
    if (!hannCache[n]) {
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++)
        w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      hannCache[n] = w;
    }
    return hannCache[n];
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }

  function num(id, fallback) {
    const v = parseFloat($(id)?.value);
    return isFinite(v) ? v : fallback;
  }

  // ── The mean spectrum itself ──────────────────────────────────────
  // seewave::meanspec(wave, from, to, wl, ovlp = 0, norm = TRUE). A stretch
  // shorter than one window is zero-padded into a single window rather than
  // refused.
  function meanSpectrum(i0, i1, wl) {
    const n = Math.max(1, i1 - i0);
    const frames = Math.max(1, Math.floor(n / wl));
    const bins = wl / 2 + 1;
    const acc = new Float64Array(bins);
    const win = hann(wl);
    const re = new Float32Array(wl);
    const im = new Float32Array(wl);
    for (let f = 0; f < frames; f++) {
      re.fill(0);
      im.fill(0);
      const start = i0 + f * wl;
      const len = Math.min(wl, i1 - start);
      for (let k = 0; k < len; k++) re[k] = msSamples[start + k] * win[k];
      fft(re, im, wl);
      for (let b = 0; b < bins; b++) acc[b] += Math.hypot(re[b], im[b]);
    }
    let mx = 0;
    for (let b = 0; b < bins; b++) {
      acc[b] /= frames;
      if (acc[b] > mx) mx = acc[b];
    }
    const freqs = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
      freqs[b] = (b * msRate) / wl / 1000;
      if (mx > 0) acc[b] /= mx;
    }
    return { freqs, amp: acc };
  }

  function wl() {
    return parseInt($("msWl")?.value, 10) || 4096;
  }

  function scaled(a) {
    const r = msMax - msMin;
    return r > 0 ? (2 * (a - msMin)) / r - 1 : 0;
  }

  // Largest scaled amplitude in [t0, t1] — the factor the Shiny app
  // multiplies a selection's normalised spectrum by.
  function peakScaled(t0, t1) {
    const i0 = Math.max(0, Math.floor(t0 * msRate));
    const i1 = Math.min(msSamples.length, Math.ceil(t1 * msRate));
    let mx = -Infinity;
    for (let i = i0; i < i1; i++) if (msSamples[i] > mx) mx = msSamples[i];
    return scaled(mx);
  }

  function selectionSpectrum(t0, t1) {
    const i0 = Math.max(0, Math.floor(t0 * msRate));
    const i1 = Math.min(msSamples.length, Math.ceil(t1 * msRate));
    const sp = meanSpectrum(i0, i1, wl());
    const k = peakScaled(t0, t1);
    for (let b = 0; b < sp.amp.length; b++) sp.amp[b] *= k;
    return sp;
  }

  async function computeFull() {
    const w = wl();
    const run = () => {
      msFull = meanSpectrum(0, msSamples.length, w);
      msFullWl = w;
    };
    if (msSamples.length > 1_500_000 && typeof withBusy === "function")
      await withBusy("Mean spectrum…", async () => run());
    else run();
  }

  // ── Loading ───────────────────────────────────────────────────────
  async function msSetWave(samples, rate, label) {
    if (samples.length > MAX_SAMPLES) {
      alert(
        `This wave has ${samples.length.toLocaleString()} samples; files over ` +
          `${MAX_SAMPLES.toLocaleString()} are refused. Trim it first.`,
      );
      return;
    }
    msSamples = samples;
    msRate = rate;
    msDur = samples.length / rate;
    msLabel = label;
    let mn = Infinity,
      mx = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    msMin = mn;
    msMax = mx;
    msSels = [];
    msPending = null;
    $("msWaveInfo").textContent = `${label} — ${msDur.toFixed(3)}s @ ${rate} Hz`;
    if (!$("msTitle").value) $("msTitle").value = "";
    await computeFull();
    msUpdateUi();
    msDraw();
  }

  function msRenderLibPicker() {
    const el = $("msLibPicker");
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
        "padding:2px 4px;border-radius:3px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" +
        (entry.id === msLibSelectedId ? ";background:var(--accent,#2d6cdf);color:#fff" : "");
      row.title = `${entry.name} — ${entry.dur.toFixed(3)}s @ ${entry.rate}Hz`;
      row.textContent = entry.name;
      row.onclick = () => {
        msLibSelectedId = entry.id;
        msSetWave(entry.samples, entry.rate, entry.name.replace(/\.[^/.]+$/, ""));
        msRenderLibPicker();
      };
      el.appendChild(row);
    });
  }

  // ── Controls ──────────────────────────────────────────────────────
  function msOnNameChoice() {
    const custom = $("msSelNameCustom");
    if (custom)
      custom.style.display = $("msSelName").value === "Custom..." ? "" : "none";
  }

  function msUpdateUi() {
    const has = !!msSamples;
    ["btnMsAdd", "btnMsClear", "btnMsPng", "btnMsSvg", "btnMsCsv"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !has;
    });
    const add = $("btnMsAdd");
    if (add) add.disabled = !has || !msPending;
    const clr = $("btnMsClear");
    if (clr) clr.disabled = !msSels.length;
    const pend = $("msPendingInfo");
    if (pend)
      pend.textContent = msPending
        ? `Brushed ${msPending.t0.toFixed(3)}–${msPending.t1.toFixed(3)} s`
        : "Drag on the oscillogram to brush a stretch";
    const list = $("msSelList");
    if (!list) return;
    list.innerHTML = "";
    if (!msSels.length) {
      list.innerHTML =
        '<div style="color: var(--txt2); font-size: 11px">No selections yet.</div>';
      return;
    }
    msSels.forEach((s) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;font-size:11px;padding:1px 0";
      row.innerHTML =
        `<span style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0"></span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.t0.toFixed(3)}–${s.t1.toFixed(3)} s"></span>` +
        `<span style="color:var(--txt3)">${s.t0.toFixed(2)}–${s.t1.toFixed(2)}s</span>` +
        `<button class="xbtn" title="Remove" style="font-size:10px">×</button>`;
      row.children[1].textContent = s.name;
      row.querySelector("button").onclick = () => {
        msSels = msSels.filter((x) => x.id !== s.id);
        msUpdateUi();
        msDraw();
      };
      list.appendChild(row);
    });
  }

  async function msAddSelection() {
    if (!msSamples || !msPending) return;
    let name = $("msSelName").value;
    if (name === "Custom...") name = ($("msSelNameCustom").value || "").trim() || "selection";
    const t0 = Math.round(msPending.t0 * 1000) / 1000;
    const t1 = Math.round(msPending.t1 * 1000) / 1000;
    if (!(t1 > t0)) {
      alert("The selection is invalid. Please try again.");
      return;
    }
    const sel = {
      id: msNextId++,
      name,
      t0,
      t1,
      color: PALETTE[msSels.length % PALETTE.length],
      spec: selectionSpectrum(t0, t1),
    };
    msSels.push(sel);
    msPending = null;
    msUpdateUi();
    msDraw();
  }

  function msClearSelections() {
    msSels = [];
    msPending = null;
    msUpdateUi();
    msDraw();
  }

  // Window length changed: every spectrum is stale.
  async function msOnWlChange() {
    if (!msSamples) return;
    await computeFull();
    msSels.forEach((s) => (s.spec = selectionSpectrum(s.t0, s.t1)));
    msDraw();
  }

  // ── Drawing ───────────────────────────────────────────────────────
  function niceTicks(lo, hi, target) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
      out.push(Math.round(v / step) * step);
    return out;
  }

  function fmtTick(v) {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1).replace(/\.0$/, "");
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function minmaxBins(i0, i1, nBins) {
    const n = i1 - i0;
    nBins = Math.max(1, Math.min(nBins, n));
    const mins = new Float32Array(nBins);
    const maxs = new Float32Array(nBins);
    for (let b = 0; b < nBins; b++) {
      const s = i0 + Math.floor((b * n) / nBins);
      const e = Math.max(s + 1, i0 + Math.floor(((b + 1) * n) / nBins));
      let mn = msSamples[s],
        mx = msSamples[s];
      for (let i = s + 1; i < e; i++) {
        const v = msSamples[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      mins[b] = mn;
      maxs[b] = mx;
    }
    return { mins, maxs, nBins };
  }

  function msDraw() {
    const wrap = $("msFigure");
    if (!wrap) return;
    wrap.innerHTML = "";
    msSvgEl = null;
    if (!msSamples || !msFull) {
      wrap.innerHTML =
        '<div style="color:#666;font-size:12px;padding:20px">Pick a wave in the list on the left.</div>';
      return;
    }
    const W = Math.max(620, wrap.clientWidth - 8);
    const L = 64,
      R = 22;
    const pw = W - L - R;
    const titleH = 34;
    const oscTop = titleH,
      oscH = 150;
    const legendY = oscTop + oscH + 56;
    const specTop = legendY + 18,
      specH = 340;
    const H = specTop + specH + 52;

    const svg = svgEl("svg", {
      xmlns: NS,
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      style: "background:#fff;display:block",
      "font-family": "Arial,sans-serif",
    });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));

    // Title
    const title = ($("msTitle")?.value || "").trim();
    if (title)
      svg.appendChild(
        svgEl("text", { x: L, y: 22, "font-size": 17, fill: "#111", "font-weight": 600 }, title),
      );

    // ── Oscillogram ──
    const tX = (t) => L + (t / msDur) * pw;
    const aY = (a) => oscTop + oscH * (1 - (a + 1.2) / 2.4); // -1.2..1.2, as the Shiny app's y limits
    const bins = minmaxBins(0, msSamples.length, Math.floor(pw));
    const envPath = (b0, b1, i0, i1) => {
      let d = "";
      for (let b = b0; b < b1; b++) {
        const x = L + ((b + 0.5) / bins.nBins) * pw;
        d += `M${x.toFixed(1)},${aY(scaled(bins.mins[b])).toFixed(1)}L${x.toFixed(1)},${aY(scaled(bins.maxs[b])).toFixed(1)}`;
      }
      return d;
    };
    svg.appendChild(
      svgEl("path", { d: envPath(0, bins.nBins), stroke: "#000", "stroke-width": 1, fill: "none" }),
    );
    msSels.forEach((s) => {
      const b0 = Math.max(0, Math.floor((s.t0 / msDur) * bins.nBins));
      const b1 = Math.min(bins.nBins, Math.ceil((s.t1 / msDur) * bins.nBins));
      if (b1 > b0)
        svg.appendChild(
          svgEl("path", { d: envPath(b0, b1), stroke: s.color, "stroke-width": 1, fill: "none" }),
        );
    });
    // axes
    svg.appendChild(svgEl("line", { x1: L, y1: oscTop + oscH, x2: L + pw, y2: oscTop + oscH, stroke: "#000" }));
    svg.appendChild(svgEl("line", { x1: L, y1: oscTop, x2: L, y2: oscTop + oscH, stroke: "#000" }));
    niceTicks(0, msDur, 8).forEach((t) => {
      const x = tX(t);
      svg.appendChild(svgEl("line", { x1: x, y1: oscTop + oscH, x2: x, y2: oscTop + oscH + 4, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x, y: oscTop + oscH + 16, "text-anchor": "middle", "font-size": 11, fill: "#222" }, fmtTick(t)));
    });
    svg.appendChild(svgEl("text", { x: L + pw / 2, y: oscTop + oscH + 32, "text-anchor": "middle", "font-size": 12, fill: "#222" }, "Time (s)"));
    [-1, 0, 1].forEach((a) => {
      const y = aY(a);
      svg.appendChild(svgEl("line", { x1: L - 4, y1: y, x2: L, y2: y, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x: L - 7, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#222" }, String(a)));
    });
    const yl = svgEl("text", { x: 14, y: oscTop + oscH / 2, "text-anchor": "middle", "font-size": 12, fill: "#222", transform: `rotate(-90 14 ${oscTop + oscH / 2})` }, "Amplitude");
    svg.appendChild(yl);
    if (msPending) {
      svg.appendChild(
        svgEl("rect", {
          x: tX(msPending.t0),
          y: oscTop,
          width: Math.max(1, tX(msPending.t1) - tX(msPending.t0)),
          height: oscH,
          fill: "rgba(217,153,34,0.18)",
          stroke: "#d29922",
          "stroke-dasharray": "4 3",
          class: "ms-brush",
        }),
      );
    }
    const brushRect = svgEl("rect", {
      x: L,
      y: oscTop,
      width: pw,
      height: oscH,
      fill: "transparent",
      style: "cursor:crosshair",
      class: "ms-ui",
    });
    svg.appendChild(brushRect);

    // ── Spectrum ──
    const fNyq = msRate / 2000;
    let f0 = num("msFMin", 0);
    let f1 = num("msFMax", fNyq);
    f0 = Math.max(0, Math.min(f0, fNyq));
    f1 = Math.max(f0 + 0.01, Math.min(f1, fNyq));
    const yMax = Math.max(1, ...msSels.map((s) => Math.max(...s.spec.amp))) * 1.05;
    const fX = (f) => L + ((f - f0) / (f1 - f0)) * pw;
    const sY = (a) => specTop + specH * (1 - a / yMax);

    const area = (spec, color, alpha) => {
      let d = "";
      let first = true;
      for (let b = 0; b < spec.freqs.length; b++) {
        const f = spec.freqs[b];
        if (f < f0 || f > f1) continue;
        d += (first ? "M" : "L") + fX(f).toFixed(1) + "," + sY(spec.amp[b]).toFixed(1);
        first = false;
      }
      return d;
    };
    const alpha = Math.max(0.05, Math.min(1, num("msAlpha", 0.9)));
    // Optional grid, behind the traces: vertical at the frequency ticks,
    // horizontal at the amplitude ticks.
    const GRm = gridRead("msGrid");
    if (GRm && GRm.on) {
      const dash = GRm.dash.map((v) => v * Math.max(1, GRm.width)).join(" ");
      const gl = (x1, y1, x2, y2) =>
        svg.appendChild(
          svgEl("line", {
            x1, y1, x2, y2,
            stroke: GRm.color || "#bbbbbb",
            "stroke-width": GRm.width,
            "stroke-dasharray": dash,
          }),
        );
      niceTicks(f0, f1, 10).forEach((f) => gl(fX(f), specTop, fX(f), specTop + specH));
      niceTicks(0, yMax, 5).forEach((a) => gl(L, sY(a), L + pw, sY(a)));
    }
    msSels.forEach((s) => {
      const line = area(s.spec);
      if (!line) return;
      const x1 = fX(Math.min(f1, s.spec.freqs[s.spec.freqs.length - 1]));
      const xs = fX(Math.max(f0, s.spec.freqs[0]));
      svg.appendChild(
        svgEl("path", {
          d: line + `L${x1.toFixed(1)},${sY(0).toFixed(1)}L${xs.toFixed(1)},${sY(0).toFixed(1)}Z`,
          fill: s.color,
          "fill-opacity": alpha,
          stroke: "none",
        }),
      );
    });
    svg.appendChild(
      svgEl("path", { d: area(msFull), fill: "none", stroke: "#000", "stroke-width": 1.5 }),
    );
    // axes
    svg.appendChild(svgEl("line", { x1: L, y1: specTop + specH, x2: L + pw, y2: specTop + specH, stroke: "#000" }));
    svg.appendChild(svgEl("line", { x1: L, y1: specTop, x2: L, y2: specTop + specH, stroke: "#000" }));
    niceTicks(f0, f1, 10).forEach((f) => {
      const x = fX(f);
      svg.appendChild(svgEl("line", { x1: x, y1: specTop + specH, x2: x, y2: specTop + specH + 5, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x, y: specTop + specH + 18, "text-anchor": "middle", "font-size": 11, fill: "#222" }, fmtTick(f)));
    });
    svg.appendChild(svgEl("text", { x: L + pw / 2, y: specTop + specH + 40, "text-anchor": "middle", "font-size": 12, fill: "#222" }, "Frequency (kHz)"));
    niceTicks(0, yMax, 5).forEach((a) => {
      const y = sY(a);
      svg.appendChild(svgEl("line", { x1: L - 4, y1: y, x2: L, y2: y, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x: L - 7, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#222" }, fmtTick(a)));
    });
    svg.appendChild(svgEl("text", { x: 14, y: specTop + specH / 2, "text-anchor": "middle", "font-size": 12, fill: "#222", transform: `rotate(-90 14 ${specTop + specH / 2})` }, "Amplitude"));

    // Legend (right-aligned, above the spectrum): Mean, then each selection
    const items = [{ name: "Mean", color: "#000", line: true }].concat(
      msSels.map((s) => ({ name: s.name, color: s.color })),
    );
    let lx = L + pw;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const w = 36 + it.name.length * 6.4;
      lx -= w;
      if (it.line)
        svg.appendChild(svgEl("line", { x1: lx, y1: legendY, x2: lx + 14, y2: legendY, stroke: it.color, "stroke-width": 2 }));
      else
        svg.appendChild(svgEl("rect", { x: lx, y: legendY - 5, width: 14, height: 10, fill: it.color, "fill-opacity": alpha }));
      svg.appendChild(svgEl("text", { x: lx + 19, y: legendY + 4, "font-size": 11, fill: "#222" }, it.name));
    }

    const hoverRect = svgEl("rect", {
      x: L,
      y: specTop,
      width: pw,
      height: specH,
      fill: "transparent",
      class: "ms-ui",
    });
    svg.appendChild(hoverRect);

    wrap.appendChild(svg);
    msSvgEl = svg;
    msGeo = { L, pw, oscTop, oscH, specTop, specH, f0, f1, yMax, fX, sY, tX };

    attachBrush(svg, brushRect);
    attachHover(svg, hoverRect);
  }

  function clientToSvgX(svg, clientX) {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return ((clientX - r.left) / r.width) * vb.width;
  }

  function attachBrush(svg, rect) {
    rect.addEventListener("pointerdown", (ev) => {
      const g = msGeo;
      const startX = clientToSvgX(svg, ev.clientX);
      const toT = (x) => Math.max(0, Math.min(msDur, ((x - g.L) / g.pw) * msDur));
      let moved = false;
      const live = svgEl("rect", {
        y: g.oscTop,
        height: g.oscH,
        fill: "rgba(217,153,34,0.18)",
        stroke: "#d29922",
        class: "ms-ui",
      });
      const onMove = (e2) => {
        const x = clientToSvgX(svg, e2.clientX);
        if (!moved && Math.abs(x - startX) > 3) {
          moved = true;
          svg.appendChild(live);
        }
        if (!moved) return;
        live.setAttribute("x", Math.min(startX, x));
        live.setAttribute("width", Math.abs(x - startX));
      };
      const onUp = (e2) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        live.remove();
        if (moved) {
          const a = toT(startX),
            b = toT(clientToSvgX(svg, e2.clientX));
          msPending = { t0: Math.min(a, b), t1: Math.max(a, b) };
        } else {
          msPending = null; // a plain click clears the brush
        }
        msUpdateUi();
        msDraw();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });
  }

  // Hover: a vertical guide and the value of every trace at that frequency,
  // like plotly's hovermode "x" in the Shiny app.
  function attachHover(svg, rect) {
    let g = null;
    const clear = () => {
      if (g) g.remove();
      g = null;
    };
    rect.addEventListener("pointerleave", clear);
    rect.addEventListener("pointermove", (ev) => {
      const geo = msGeo;
      const x = clientToSvgX(svg, ev.clientX);
      const f = geo.f0 + ((x - geo.L) / geo.pw) * (geo.f1 - geo.f0);
      const binOf = (spec) => {
        const df = spec.freqs[1] - spec.freqs[0];
        return Math.max(0, Math.min(spec.freqs.length - 1, Math.round(f / df)));
      };
      const rows = [{ name: "Mean", color: "#000", v: msFull.amp[binOf(msFull)] }].concat(
        msSels.map((s) => ({ name: s.name, color: s.color, v: s.spec.amp[binOf(s.spec)] })),
      );
      clear();
      g = svgEl("g", { class: "ms-ui", "pointer-events": "none" });
      g.appendChild(svgEl("line", { x1: x, y1: geo.specTop, x2: x, y2: geo.specTop + geo.specH, stroke: "#888", "stroke-dasharray": "3 3" }));
      const bw = 128,
        bh = 18 + rows.length * 14;
      let bx = x + 10;
      if (bx + bw > geo.L + geo.pw) bx = x - 10 - bw;
      const by = geo.specTop + 8;
      g.appendChild(svgEl("rect", { x: bx, y: by, width: bw, height: bh, fill: "#fff", stroke: "#999", rx: 3 }));
      g.appendChild(svgEl("text", { x: bx + 6, y: by + 13, "font-size": 11, fill: "#222", "font-weight": 600 }, f.toFixed(2) + " kHz"));
      rows.forEach((r, i) => {
        g.appendChild(svgEl("rect", { x: bx + 6, y: by + 20 + i * 14, width: 8, height: 8, fill: r.color }));
        g.appendChild(svgEl("text", { x: bx + 18, y: by + 28 + i * 14, "font-size": 11, fill: "#222" }, `${r.name}: ${r.v.toFixed(2)}`));
      });
      svg.appendChild(g);
    });
  }

  // ── Export ────────────────────────────────────────────────────────
  function serialize() {
    const clone = msSvgEl.cloneNode(true);
    clone.querySelectorAll(".ms-ui, .ms-brush").forEach((e) => e.remove());
    return new XMLSerializer().serializeToString(clone);
  }

  function baseName() {
    const t = ($("msFilePrefix")?.value || "").trim();
    return (t || msLabel || "meanspectra").replace(/[^\w.-]+/g, "_");
  }

  async function msExportSvg() {
    if (!msSvgEl) return;
    await dlFile(baseName() + "_meanspectra.svg", serialize(), "image/svg+xml", { exactName: true });
  }

  async function msExportPng() {
    if (!msSvgEl) return;
    const vb = msSvgEl.viewBox.baseVal;
    const scale = 3;
    const url = URL.createObjectURL(new Blob([serialize()], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement("canvas");
      c.width = vb.width * scale;
      c.height = vb.height * scale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await dlFile(baseName() + "_meanspectra.png", bytes, "image/png", { exactName: true });
      }, "image/png");
    };
    img.src = url;
  }

  async function msExportCsv() {
    if (!msFull) return;
    const cols = ["frequency_khz", "mean"].concat(
      msSels.map((s, i) => `${s.name}_${i + 1}`.replace(/[^\w.-]+/g, "_")),
    );
    let csv = cols.join(",") + "\n";
    for (let b = 0; b < msFull.freqs.length; b++) {
      const row = [msFull.freqs[b].toFixed(5), msFull.amp[b].toFixed(6)];
      msSels.forEach((s) => row.push(s.spec.amp[b].toFixed(6)));
      csv += row.join(",") + "\n";
    }
    await dlFile(baseName() + "_meanspectra.csv", csv, "text/csv", { exactName: true });
  }

  window.addEventListener("resize", () => {
    const v = $("mainview-meanspec");
    if (v && v.offsetParent !== null) msDraw();
  });

  window.msRenderLibPicker = msRenderLibPicker;
  window.msDraw = msDraw;
  window.msOnNameChoice = msOnNameChoice;
  window.msOnWlChange = msOnWlChange;
  window.msAddSelection = msAddSelection;
  window.msClearSelections = msClearSelections;
  window.msExportSvg = msExportSvg;
  window.msExportPng = msExportPng;
  window.msExportCsv = msExportCsv;
})();
