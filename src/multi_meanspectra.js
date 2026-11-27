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
  let msBrushColor = {}; // label -> colour in brush mode, stable per label
  let msNextId = 1;
  let msPending = null; // { t0, t1 } brushed, not yet added
  let msLibSelectedId = null;
  let msSvgEl = null;
  let msGeo = null; // plot geometry of the last draw, for the pointer handlers
  let msBV0 = 0; // time range shown on the brush-mode oscillogram (s)
  let msBV1 = 0;
  let msLastClick = 0; // for double-click-to-fit on the oscillogram

  // Table mode ("Label classes from selection tables")
  let msMode = "brush"; // "brush" | "tables"
  let msTables = []; // { id, name, stem, cols: {lower: original}, hasFile, libId (null = auto) }
  let msRows = []; // { id, tableId, t0, t1, file, lo, hi, raw: {lower: value}, label, edited, on, spec, specKey }
  let msNextTableId = 1;
  let msNextRowId = 1;
  let msLabelColKey = null; // lowercase header of the label column; "" = none
  let msClassColor = {}; // label -> colour, kept stable across recomputes
  let msClassOff = new Set(); // labels left out of the plot
  let msClassSpecs = []; // { label, color, n, freqs, amp, sd, cnt }
  let msPicked = new Set(); // row ids picked for bulk labelling
  let msLastPicked = null;
  const UNLABELLED = "(unlabelled)";

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

  // A plot title with light Markdown: *italic* or _italic_, **bold**,
  // ***both***, and \* to write a literal asterisk. A marker without a
  // partner is kept as text, and _ only counts at a word edge, so names
  // like Ind3_HAA stay as typed. Returns an SVG <text> of <tspan>s.
  function mdTitle(attrs, src) {
    const toks = [];
    let buf = "";
    const flush = () => {
      if (buf) toks.push({ s: buf });
      buf = "";
    };
    const word = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\" && i + 1 < src.length && /[*_\\]/.test(src[i + 1])) {
        buf += src[++i];
      } else if (c === "*") {
        let n = 1;
        while (src[i + n] === "*" && n < 3) n++;
        flush();
        if (n === 3) toks.push({ m: "**", s: "**" }, { m: "*", s: "*" });
        else toks.push({ m: n === 2 ? "**" : "*", s: "*".repeat(n) });
        i += n - 1;
      } else if (c === "_" && (!word(src[i - 1]) || !word(src[i + 1]))) {
        flush();
        toks.push({ m: "_", s: "_", open: !word(src[i - 1]), close: !word(src[i + 1]) });
      } else buf += c;
    }
    flush();
    // Pair the markers; the unpaired ones become text again.
    const open = {};
    toks.forEach((t, k) => {
      if (!t.m) return;
      const st = (open[t.m] = open[t.m] || []);
      const canClose = t.m !== "_" || t.close;
      const canOpen = t.m !== "_" || t.open;
      if (st.length && canClose) {
        toks[st.pop()].on = true;
        t.on = true;
      } else if (canOpen) st.push(k);
    });
    const el = svgEl("text", attrs);
    let bold = false,
      ital = false;
    toks.forEach((t) => {
      if (t.m && t.on) {
        if (t.m === "**") bold = !bold;
        else ital = !ital;
        return;
      }
      const ts = svgEl("tspan", {}, t.s);
      if (ital) ts.setAttribute("font-style", "italic");
      if (bold) ts.setAttribute("font-weight", 800);
      el.appendChild(ts);
    });
    return el;
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
    return meanSpectrumOf(msSamples, msRate, i0, i1, wl);
  }

  function meanSpectrumOf(samples, rate, i0, i1, wl) {
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
      for (let k = 0; k < len; k++) re[k] = samples[start + k] * win[k];
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
      freqs[b] = (b * rate) / wl / 1000;
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
    msBrushColor = {};
    msPending = null;
    msBV0 = 0;
    msBV1 = msDur;
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
    // Recordings added or closed change which table rows can be matched.
    if (msTables.length) {
      if (msMode === "tables") msRecompute();
      else msRenderTables();
    }
  }

  // ── Controls ──────────────────────────────────────────────────────
  function msOnNameChoice() {
    const custom = $("msSelNameCustom");
    if (custom)
      custom.style.display = $("msSelName").value === "Custom..." ? "" : "none";
  }

  function msUpdateUi() {
    if (msMode === "tables") return msUpdateTablesUi();
    const has = !!msSamples;
    ["btnMsAdd", "btnMsClear", "btnMsPng", "btnMsSvg", "btnMsCsv"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !has;
    });
    ["btnMsZoomIn", "btnMsZoomOut", "btnMsZoomFit"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !has;
    });
    const zs = $("btnMsZoomSel");
    if (zs) zs.disabled = !has || !(msPending || msSels.length);
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
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text" title="${s.t0.toFixed(3)}–${s.t1.toFixed(3)} s · click to rename"></span>` +
        `<span style="color:var(--txt3)">${s.t0.toFixed(2)}–${s.t1.toFixed(2)}s</span>` +
        `<button class="xbtn" title="Remove" style="font-size:10px">×</button>`;
      const nameEl = row.children[1];
      nameEl.textContent = s.name;
      nameEl.onclick = () => editSelName(s, nameEl);
      row.querySelector("button").onclick = () => {
        msSels = msSels.filter((x) => x.id !== s.id);
        msUpdateUi();
        msDraw();
      };
      list.appendChild(row);
    });
  }

  // Rename a selection in place: Enter or leaving the box keeps the new
  // label, Esc cancels. The selection takes its new label's colour and is
  // pooled with that label's other selections. The suggestions are the
  // labels in use plus the preset names.
  function editSelName(s, nameEl) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = s.name;
    inp.style.cssText = "flex:1;min-width:0;font-size:11px;padding:0 3px";
    let dl = $("msSelNameList");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "msSelNameList";
      document.body.appendChild(dl);
    }
    const presets = [...($("msSelName")?.options || [])]
      .map((o) => o.value)
      .filter((v) => v !== "Custom...");
    dl.innerHTML = "";
    [...new Set(msSels.map((x) => x.name).concat(presets))].forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      dl.appendChild(o);
    });
    inp.setAttribute("list", "msSelNameList");
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = inp.value.trim();
      if (save && name && name !== s.name) {
        s.name = name;
        s.color = brushColorOf(name);
        msDraw();
      }
      msUpdateUi();
    };
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
      ev.stopPropagation();
    });
    inp.addEventListener("blur", () => finish(true));
    nameEl.replaceWith(inp);
    inp.focus();
    inp.select();
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
      color: brushColorOf(name),
      spec: selectionSpectrum(t0, t1),
    };
    msSels.push(sel);
    msPending = null;
    msUpdateUi();
    msDraw();
  }

  // One colour per label: a label keeps the colour it was first given, even
  // after its selections are removed and added again; a new label takes the
  // first palette colour no other label holds.
  function brushColorOf(name) {
    if (!msBrushColor[name]) {
      const used = new Set(Object.values(msBrushColor));
      const free = PALETTE.find((c) => !used.has(c));
      msBrushColor[name] =
        free || PALETTE[Object.keys(msBrushColor).length % PALETTE.length];
    }
    return msBrushColor[name];
  }

  // Selections pooled by label, in order of first appearance. A label's
  // spectrum is the bin-by-bin mean of its selections' spectra (each one
  // the normalised meanspec scaled by its peak amplitude, as for a single
  // selection), so one selection draws exactly as before.
  function brushGroups() {
    const byName = new Map();
    msSels.forEach((s) => {
      let g = byName.get(s.name);
      if (!g) {
        g = { name: s.name, color: s.color, n: 0, sels: [] };
        byName.set(s.name, g);
      }
      g.n++;
      g.sels.push(s);
    });
    return [...byName.values()].map((g) => {
      const f = g.sels[0].spec.freqs;
      const amp = new Float64Array(f.length);
      g.sels.forEach((s) => {
        for (let b = 0; b < amp.length; b++) amp[b] += s.spec.amp[b];
      });
      for (let b = 0; b < amp.length; b++) amp[b] /= g.n;
      g.spec = { freqs: f, amp };
      return g;
    });
  }

  function msClearSelections() {
    msBrushColor = {};
    msSels = [];
    msPending = null;
    msUpdateUi();
    msDraw();
  }

  // Window length changed: every spectrum is stale.
  async function msOnWlChange() {
    if (msMode === "tables") return msRecompute();
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
    if (msMode === "tables") return msDrawClasses();
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
        mdTitle({ x: L, y: 22, "font-size": 17, fill: "#111", "font-weight": 600 }, title),
      );

    // ── Oscillogram ── (the zoomed time range msBV0..msBV1)
    if (!(msBV1 > msBV0)) {
      msBV0 = 0;
      msBV1 = msDur;
    }
    const v0 = msBV0,
      v1 = msBV1;
    const tX = (t) => L + ((t - v0) / (v1 - v0)) * pw;
    const aY = (a) => oscTop + oscH * (1 - (a + 1.2) / 2.4); // -1.2..1.2, as the Shiny app's y limits
    const si0 = Math.max(0, Math.floor(v0 * msRate));
    const si1 = Math.min(msSamples.length, Math.max(si0 + 1, Math.ceil(v1 * msRate)));
    const bins = minmaxBins(si0, si1, Math.floor(pw));
    const perBin = (si1 - si0) / bins.nBins; // samples per bin
    const envPath = (b0, b1) => {
      let d = "";
      for (let b = b0; b < b1; b++) {
        const x = tX((si0 + (b + 0.5) * perBin) / msRate);
        d += `M${x.toFixed(1)},${aY(scaled(bins.mins[b])).toFixed(1)}L${x.toFixed(1)},${aY(scaled(bins.maxs[b])).toFixed(1)}`;
      }
      return d;
    };
    svg.appendChild(
      svgEl("path", { d: envPath(0, bins.nBins), stroke: "#000", "stroke-width": 1, fill: "none" }),
    );
    msSels.forEach((s) => {
      const b0 = Math.max(0, Math.floor((s.t0 * msRate - si0) / perBin));
      const b1 = Math.min(bins.nBins, Math.ceil((s.t1 * msRate - si0) / perBin));
      if (b1 > b0)
        svg.appendChild(
          svgEl("path", { d: envPath(b0, b1), stroke: s.color, "stroke-width": 1, fill: "none" }),
        );
    });
    // axes
    svg.appendChild(svgEl("line", { x1: L, y1: oscTop + oscH, x2: L + pw, y2: oscTop + oscH, stroke: "#000" }));
    svg.appendChild(svgEl("line", { x1: L, y1: oscTop, x2: L, y2: oscTop + oscH, stroke: "#000" }));
    niceTicks(v0, v1, 8).forEach((t) => {
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
    if (msPending && msPending.t1 > v0 && msPending.t0 < v1) {
      const px0 = tX(Math.max(v0, msPending.t0)),
        px1 = tX(Math.min(v1, msPending.t1));
      svg.appendChild(
        svgEl("rect", {
          x: px0,
          y: oscTop,
          width: Math.max(1, px1 - px0),
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
    const groups = brushGroups(); // selections pooled by label
    const gName = (g) => (g.n > 1 ? `${g.name} (n=${g.n})` : g.name);
    const yMax = Math.max(1, ...groups.map((g) => Math.max(...g.spec.amp))) * 1.05;
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
    groups.forEach((s) => {
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

    // Legend (right-aligned, above the spectrum): Mean, then each label
    const items = [{ name: "Mean", color: "#000", line: true }].concat(
      groups.map((g) => ({ name: gName(g), color: g.color })),
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
    msGeo = {
      L, pw, oscTop, oscH, specTop, specH, f0, f1, yMax, fX, sY, tX,
      traces: [{ name: "Mean", color: "#000", spec: msFull }].concat(
        groups.map((g) => ({ name: gName(g), color: g.color, spec: g.spec })),
      ),
    };

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
      if (ev.altKey || ev.button === 1) return panDrag(svg, ev);
      if (ev.button !== 0) return;
      const v0 = msBV0,
        v1 = msBV1;
      const toT = (x) => Math.max(v0, Math.min(v1, v0 + ((x - g.L) / g.pw) * (v1 - v0)));
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
          // Two plain clicks in quick succession: show the whole wave. (A
          // dblclick listener would not fire: the first click redraws.)
          const now = performance.now();
          if (now - msLastClick < 400) {
            msBV0 = 0;
            msBV1 = msDur;
          }
          msLastClick = now;
        }
        msUpdateUi();
        msDraw();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });
    // Wheel zooms in time around the pointer; Shift+wheel (or a sideways
    // swipe) pans. Double-click shows the whole wave.
    rect.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const g = msGeo;
        const span = msBV1 - msBV0;
        if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
          const d = (ev.shiftKey ? ev.deltaY : ev.deltaX) || ev.deltaY;
          const k = (d > 0 ? 0.15 : -0.15) * span;
          msBrushSetView(msBV0 + k, msBV1 + k);
          msDraw();
        } else {
          const x = clientToSvgX(svg, ev.clientX);
          msBrushZoom(ev.deltaY > 0 ? 1.25 : 0.8, msBV0 + ((x - g.L) / g.pw) * span);
        }
      },
      { passive: false },
    );
  }

  // Alt-drag or middle-drag on the oscillogram: pan in time.
  function panDrag(svg, ev) {
    const g = msGeo;
    const startX = clientToSvgX(svg, ev.clientX);
    const a0 = msBV0,
      a1 = msBV1;
    const onMove = (e2) => {
      const dt = ((clientToSvgX(svg, e2.clientX) - startX) / g.pw) * (a1 - a0);
      msBrushSetView(a0 - dt, a1 - dt);
      msDraw();
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    ev.preventDefault();
  }

  // ── Time zoom of the brush-mode oscillogram ──
  function msBrushSetView(a, b) {
    if (!msSamples) return;
    const span = Math.max(Math.min(msDur, 64 / msRate), Math.min(msDur, b - a));
    a = Math.max(0, Math.min(a, msDur - span));
    msBV0 = a;
    msBV1 = a + span;
  }

  // k < 1 zooms in, around the centre (or around time `at`).
  function msBrushZoom(k, at) {
    if (!msSamples) return;
    const c = at != null ? at : (msBV0 + msBV1) / 2;
    msBrushSetView(c - (c - msBV0) * k, c + (msBV1 - c) * k);
    msDraw();
  }

  function msBrushZoomFit() {
    if (!msSamples) return;
    msBV0 = 0;
    msBV1 = msDur;
    msDraw();
  }

  // The brushed stretch (or the last selection) with a quarter of its
  // length on either side.
  function msBrushZoomToSel() {
    const s = msPending || msSels[msSels.length - 1];
    if (!msSamples || !s) return;
    const pad = (s.t1 - s.t0) * 0.25;
    msBrushSetView(s.t0 - pad, s.t1 + pad);
    msDraw();
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
      const rows = geo.traces.map((t) => ({ name: t.name, color: t.color, v: t.spec.amp[binOf(t.spec)] }));
      clear();
      g = svgEl("g", { class: "ms-ui", "pointer-events": "none" });
      g.appendChild(svgEl("line", { x1: x, y1: geo.specTop, x2: x, y2: geo.specTop + geo.specH, stroke: "#888", "stroke-dasharray": "3 3" }));
      const bw = Math.max(128, 60 + Math.max(...rows.map((r) => r.name.length)) * 6.2),
        bh = 18 + rows.length * 14;
      let bx = x + 10;
      if (bx + bw > geo.L + geo.pw) bx = x - 10 - bw;
      const by = geo.specTop + 8;
      g.appendChild(svgEl("rect", { x: bx, y: by, width: bw, height: bh, fill: "#fff", stroke: "#999", rx: 3 }));
      g.appendChild(svgEl("text", { x: bx + 6, y: by + 13, "font-size": 11, fill: "#222", "font-weight": 600 }, f.toFixed(2) + " kHz"));
      rows.forEach((r, i) => {
        g.appendChild(svgEl("rect", { x: bx + 6, y: by + 20 + i * 14, width: 8, height: 8, fill: r.color }));
        g.appendChild(svgEl("text", { x: bx + 18, y: by + 28 + i * 14, "font-size": 11, fill: "#222" }, `${r.name}: ${isFinite(r.v) ? r.v.toFixed(2) : "–"}`));
      });
      svg.appendChild(g);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TABLE MODE — one mean spectrum per label class
  // One or more selection tables (Raven .txt, CSV/TSV or .xlsx sheets with begin/end
  // columns), from the same or from different recordings. Every row is tied
  // to a loaded recording: by its Begin File column when the table has one
  // (Raven tables spanning several files; File Offset (s) then gives the time
  // inside that file), otherwise by the table's file name, which the user
  // can override. Each row takes its label from a chosen column, and labels
  // can be edited per row or for picked rows at once.
  //
  // A class's spectrum: every selection's mean spectrum (meanspec, as above,
  // normalised to a maximum of 1 so a loud recording does not outweigh a
  // quiet one) is put on a common frequency grid by linear interpolation —
  // recordings may differ in sampling rate — and averaged bin by bin; the
  // average is then normalised to a maximum of 1. Above a recording's
  // Nyquist frequency its selections simply do not contribute, so the
  // per-bin count is exported with the CSV. The SD is the sample SD of the
  // normalised spectra, scaled by the same factor as the mean.
  // ═══════════════════════════════════════════════════════════════════
  function libList() {
    return typeof audioLibrary !== "undefined" ? audioLibrary : [];
  }

  const stemOf = (name) => String(name || "").replace(/\.[^/.]+$/, "").trim().toLowerCase();
  const fileBase = (p) => String(p || "").split(/[\\/]/).pop().trim();

  // "rec.Table.1.selections.txt" or "rec_annotations_raven.selections.txt" → "rec"
  function tableStem(name) {
    return name
      .replace(/\.(txt|csv|tsv|xlsx)$/i, "")
      .replace(/\.selections$/i, "")
      .replace(/\.Table\.\d+$/i, "")
      .replace(/_annotations(_raven)?$/i, "");
  }

  function matchEntry(stem) {
    const s = String(stem || "").toLowerCase();
    if (!s) return null;
    const lib = libList();
    const exact = lib.find((x) => stemOf(x.name) === s);
    if (exact) return exact;
    // A prefix either way (a recording saved as "rec_1hpf" for table "rec"),
    // the longest one winning.
    let best = null;
    let bestLen = 2;
    lib.forEach((x) => {
      const xs = stemOf(x.name);
      if ((s.startsWith(xs) || xs.startsWith(s)) && xs.length > bestLen) {
        best = x;
        bestLen = xs.length;
      }
    });
    return best;
  }

  const tableOf = (id) => msTables.find((t) => t.id === id);

  // Rows of the tables in use. A table switched off (its "Use" box) is out
  // of everything — spectra, classes, the list and the viewer — while its
  // rows keep their own include/label state for when it is switched back on.
  const tableUsed = (t) => !!t && t.on !== false;
  const rowLive = (r) => tableUsed(tableOf(r.tableId));
  const liveRows = () => msRows.filter(rowLive);

  // A table whose selections each enclose two or more selections of another
  // table is a grouping level of that table (motifs over syllables, echemes
  // over pulses...). Returns { of: table, per: mean count } or null.
  function groupingOf(t) {
    const mine = msRows.filter((r) => r.tableId === t.id).map((r) => ({ r, e: rowEntry(r) }));
    if (!mine.length) return null;
    let best = null;
    msTables.forEach((u) => {
      if (u.id === t.id) return;
      const theirs = msRows.filter((r) => r.tableId === u.id).map((r) => ({ r, e: rowEntry(r) }));
      if (!theirs.length) return;
      let groups = 0,
        held = 0;
      mine.forEach(({ r, e }) => {
        if (!e) return;
        const k = theirs.filter((o) => o.e === e && o.r.t0 >= r.t0 - 0.001 && o.r.t1 <= r.t1 + 0.001 && o.r.t1 - o.r.t0 < r.t1 - r.t0 - 0.001).length;
        if (k >= 2) {
          groups++;
          held += k;
        }
      });
      if (groups >= Math.max(1, mine.length * 0.5) && (!best || groups > best.groups))
        best = { of: u, groups, per: held / groups };
    });
    return best;
  }

  function tableEntry(t) {
    const lib = libList();
    if (t.libId != null) return lib.find((x) => x.id === t.libId) || null;
    return matchEntry(t.stem) || (lib.length === 1 ? lib[0] : null);
  }

  function rowEntry(r) {
    if (r.file) return matchEntry(stemOf(r.file));
    const t = tableOf(r.tableId);
    return t ? tableEntry(t) : null;
  }

  // Why a row cannot be used, or "" when it can.
  function rowProblem(r, entry) {
    if (!entry)
      return r.file
        ? `No loaded recording matches "${r.file}"`
        : "No loaded recording is chosen for this table";
    if (r.t0 >= entry.dur) return `Starts after the end of ${entry.name} (${entry.dur.toFixed(2)} s)`;
    return "";
  }

  const labelOf = (r) => (r.label || "").trim() || UNLABELLED;

  function colorOf(label) {
    if (!msClassColor[label])
      msClassColor[label] = PALETTE[Object.keys(msClassColor).length % PALETTE.length];
    return msClassColor[label];
  }

  function classOrder() {
    const seen = [];
    const has = new Set();
    liveRows().forEach((r) => {
      const l = labelOf(r);
      if (!has.has(l)) {
        has.add(l);
        seen.push(l);
      }
    });
    return seen;
  }

  // ── Parsing ──
  function splitLine(line, sep) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += c;
      } else if (c === '"' && !cur.trim()) q = true;
      else if (c === sep) {
        out.push(cur.trim());
        cur = "";
      } else cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  const TIME_COLS = {
    begin: ["begin time (s)", "begin time", "begin_s", "begin", "start", "start_s", "start (s)", "start time", "start_time", "start time (s)"],
    end: ["end time (s)", "end time", "end_s", "end", "end (s)", "end_time", "stop", "stop (s)"],
    file: ["begin file", "file", "filename", "file name", "sound file", "begin path", "path", "recording"],
    offset: ["file offset (s)", "file offset", "file_offset", "offset (s)"],
    lo: ["low freq (hz)", "low freq", "low_hz", "flo", "low frequency (hz)"],
    hi: ["high freq (hz)", "high freq", "high_hz", "fhi", "high frequency (hz)"],
    sel: ["selection"],
  };

  // A text table (Raven .txt, CSV, TSV, semicolon CSV).
  function parseTable(txt) {
    const lines = txt.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { error: "no rows" };
    const h0 = lines[0];
    const sep = h0.includes("\t")
      ? "\t"
      : (h0.match(/;/g) || []).length > (h0.match(/,/g) || []).length
        ? ";"
        : ",";
    return parseGrid(splitLine(h0, sep), lines.slice(1).map((l) => splitLine(l, sep)));
  }

  // One sheet of an .xlsx, as _readXlsx gives it: an array of row objects
  // keyed by the header row.
  function parseSheet(objs) {
    if (!objs || !objs.length) return { error: "empty sheet" };
    const headers = [];
    const seen = new Set();
    objs.forEach((o) =>
      Object.keys(o).forEach((k) => {
        if (!seen.has(k)) {
          seen.add(k);
          headers.push(k);
        }
      }),
    );
    return parseGrid(
      headers,
      objs.map((o) => headers.map((h) => (o[h] == null ? "" : String(o[h]).trim()))),
    );
  }

  // Begin/end columns not in TIME_COLS: Desk's own exports name them by the
  // structure ("pulse_start", "motif_end", "train_start_s").
  const BEGIN_RX = /^(.*[_ ])?(start|begin|onset)(_s|_time| \(s\))?$/;
  const END_RX = /^(.*[_ ])?(end|stop|offset)(_s|_time| \(s\))?$/;

  function parseGrid(headers, lines) {
    const hdr = headers.map((h) => String(h).trim().toLowerCase());
    const col = (names) => hdr.findIndex((h) => names.includes(h));
    let bi = col(TIME_COLS.begin);
    let ei = col(TIME_COLS.end);
    if (bi < 0) bi = hdr.findIndex((h) => BEGIN_RX.test(h) && !/file/.test(h));
    if (bi >= 0 && ei < 0) {
      // the end column that goes with this begin column, if there is one
      ei = hdr.indexOf(hdr[bi].replace(/(start|begin|onset)/, "end"));
      if (ei < 0) ei = hdr.findIndex((h) => END_RX.test(h) && !/file/.test(h));
    }
    if (bi < 0 || ei < 0)
      return { error: `no begin/end time columns (found: ${headers.join(", ")})` };
    const fi = col(TIME_COLS.file);
    const oi = col(TIME_COLS.offset);
    const li = col(TIME_COLS.lo);
    const hi = col(TIME_COLS.hi);
    const si = col(TIME_COLS.sel);
    const rows = [];
    const seen = new Set();
    let bad = 0;
    let dupes = 0;
    for (let k = 0; k < lines.length; k++) {
      const c = lines[k];
      const b = parseFloat(c[bi]);
      const e = parseFloat(c[ei]);
      if (!(isFinite(b) && isFinite(e) && e > b)) {
        bad++;
        continue;
      }
      const file = fi >= 0 ? fileBase(c[fi]) : "";
      let t0 = b,
        t1 = e;
      if (file && oi >= 0) {
        const off = parseFloat(c[oi]);
        if (isFinite(off)) {
          t0 = off;
          t1 = off + (e - b);
        }
      }
      // Raven writes each selection once per view (Waveform 1, Spectrogram 1):
      // keep the first.
      const key = si >= 0 && c[si] ? `${file}|#${c[si]}` : `${file}|${t0.toFixed(6)}|${t1.toFixed(6)}`;
      if (seen.has(key)) {
        dupes++;
        continue;
      }
      seen.add(key);
      const raw = {};
      hdr.forEach((h, i) => (raw[h] = c[i] != null ? c[i] : ""));
      const lo = li >= 0 ? parseFloat(c[li]) : NaN;
      const hiF = hi >= 0 ? parseFloat(c[hi]) : NaN;
      rows.push({ t0, t1, file, lo: isFinite(lo) ? lo : null, hi: isFinite(hiF) ? hiF : null, raw });
    }
    if (!rows.length) return { error: "no valid selections (begin < end)" };
    const cols = {};
    const skip = new Set([bi, ei, oi]);
    headers.forEach((h, i) => {
      if (!skip.has(i) && !/^delta /i.test(h) && h) cols[hdr[i]] = h;
    });
    return { rows, cols, hasFile: fi >= 0, bad, dupes };
  }

  const LABEL_PREF = ["annotation", "label", "class", "type", "sound type", "call type", "species", "scientific_name", "tags", "tag"];

  function allCols() {
    const out = {};
    msTables.forEach((t) => Object.assign(out, t.cols));
    return out;
  }

  function rawLabel(r) {
    return msLabelColKey ? (r.raw[msLabelColKey] || "").trim() : "";
  }

  function renderLabelColSelect() {
    const sel = $("msLabelCol");
    if (!sel) return;
    const cols = allCols();
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    sel.appendChild(none);
    Object.keys(cols).forEach((k) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = cols[k];
      sel.appendChild(o);
    });
    sel.value = msLabelColKey || "";
  }

  async function msImportTables(input) {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    const problems = [];
    const added = [];
    // Every readable table, a text file or one sheet of a workbook:
    // { name, stemFrom, res }.
    const found = [];
    for (const f of files) {
      if (/\.xlsx$/i.test(f.name)) {
        let wb;
        try {
          if (typeof _readXlsx !== "function") throw new Error("the Excel reader is not available");
          wb = await _readXlsx(new Uint8Array(await f.arrayBuffer()));
        } catch (e) {
          problems.push(`${f.name}: ${e.message}`);
          continue;
        }
        const sheets = Object.keys(wb || {})
          .map((sh) => ({ sh, res: parseSheet(wb[sh]) }))
          .filter((x) => !x.res.error);
        if (!sheets.length) {
          problems.push(`${f.name}: no sheet has begin and end time columns`);
          continue;
        }
        sheets.forEach((x) =>
          found.push({ name: sheets.length > 1 ? `${f.name} › ${x.sh}` : f.name, stemFrom: f.name, res: x.res }),
        );
        continue;
      }
      let res;
      try {
        res = parseTable(await f.text());
      } catch (e) {
        res = { error: e.message };
      }
      if (res.error) problems.push(`${f.name}: ${res.error}`);
      else found.push({ name: f.name, stemFrom: f.name, res });
    }
    for (const { name, stemFrom, res } of found) {
      const t = {
        id: msNextTableId++,
        name,
        stem: tableStem(stemFrom),
        cols: res.cols,
        hasFile: res.hasFile,
        libId: null,
        on: true,
        skipped: res.bad,
        dupes: res.dupes,
      };
      msTables.push(t);
      res.rows.forEach((r) => {
        const row = { ...r, id: msNextRowId++, tableId: t.id, label: "", edited: false, on: true, spec: null, specKey: "" };
        msRows.push(row);
        added.push(row);
      });
    }
    // The label column: keep the one in use if the new tables have it too,
    // otherwise pick the most label-like column present.
    const cols = allCols();
    if (msLabelColKey == null || (msLabelColKey && !(msLabelColKey in cols))) {
      msLabelColKey =
        LABEL_PREF.find((k) => k in cols) ||
        Object.keys(cols).find((k) => /(^|[_ ])(annotation|label|class|type)$/.test(k)) ||
        "";
      msRows.forEach((r) => {
        if (!r.edited) r.label = rawLabel(r);
      });
    } else added.forEach((r) => (r.label = rawLabel(r)));
    renderLabelColSelect();
    if (problems.length) alert("Some tables could not be read:\n\n" + problems.join("\n"));
    await msRecompute();
  }

  function msOnLabelColChange() {
    const key = $("msLabelCol").value;
    if (msRows.some((r) => r.edited) && !confirm("Changing the label column replaces the labels edited by hand. Continue?")) {
      $("msLabelCol").value = msLabelColKey || "";
      return;
    }
    msLabelColKey = key;
    msRows.forEach((r) => {
      r.label = rawLabel(r);
      r.edited = false;
    });
    msRecompute();
  }

  function msUseTable(id, on) {
    const t = tableOf(id);
    if (!t) return;
    t.on = on;
    if (!on)
      msRows.forEach((r) => {
        if (r.tableId === id) msPicked.delete(r.id);
      });
    if (msFocusId != null && !rowLive(msRows.find((r) => r.id === msFocusId) || {})) msFocusId = null;
    msRecompute();
  }

  function msRemoveTable(id) {
    msTables = msTables.filter((t) => t.id !== id);
    msRows = msRows.filter((r) => {
      if (r.tableId !== id) return true;
      msPicked.delete(r.id);
      return false;
    });
    if (!msTables.length) msLabelColKey = null;
    renderLabelColSelect();
    msRecompute();
  }

  function msClearTables() {
    msTables = [];
    msRows = [];
    msPicked.clear();
    msLastPicked = null;
    msFocusId = null;
    msLabelColKey = null;
    msClassColor = {};
    msClassOff.clear();
    msClassSpecs = [];
    renderLabelColSelect();
    msRecompute();
  }

  // ── Computing the class spectra ──
  function rowSpec(r, entry, w) {
    const key = `${entry.id}|${entry.samples.length}|${w}`;
    if (r.specKey === key) return r.spec;
    const i0 = Math.max(0, Math.floor(r.t0 * entry.rate));
    const i1 = Math.min(entry.samples.length, Math.ceil(r.t1 * entry.rate));
    r.spec = i1 - i0 >= 2 ? meanSpectrumOf(entry.samples, entry.rate, i0, i1, w) : null;
    r.specKey = key;
    return r.spec;
  }

  function computeClasses() {
    const w = wl();
    const used = []; // { label, sp, df }
    liveRows().forEach((r) => {
      if (!r.on) return;
      const label = labelOf(r);
      if (msClassOff.has(label)) return;
      const e = rowEntry(r);
      if (rowProblem(r, e)) return;
      const sp = rowSpec(r, e, w);
      if (sp) used.push({ label, sp, df: e.rate / w / 1000 });
    });
    msClassSpecs = [];
    if (!used.length) return;
    const df = Math.min(...used.map((u) => u.df));
    const fTop = Math.max(...used.map((u) => u.sp.freqs[u.sp.freqs.length - 1]));
    const nb = Math.floor(fTop / df + 1e-9) + 1;
    const freqs = new Float64Array(nb);
    for (let b = 0; b < nb; b++) freqs[b] = b * df;
    classOrder().forEach((label) => {
      const mine = used.filter((u) => u.label === label);
      if (!mine.length) return;
      const sum = new Float64Array(nb);
      const sq = new Float64Array(nb);
      const cnt = new Uint32Array(nb);
      mine.forEach((u) => {
        const a = u.sp.amp;
        const last = a.length - 1;
        for (let b = 0; b < nb; b++) {
          const x = freqs[b] / u.df;
          if (x > last + 1e-9) break;
          const i = Math.min(last, Math.floor(x));
          const fr = x - i;
          const v = i < last ? a[i] * (1 - fr) + a[i + 1] * fr : a[i];
          sum[b] += v;
          sq[b] += v * v;
          cnt[b]++;
        }
      });
      const amp = new Float64Array(nb);
      const sd = new Float64Array(nb);
      let mx = 0;
      for (let b = 0; b < nb; b++) {
        const n = cnt[b];
        if (!n) {
          amp[b] = sd[b] = NaN;
          continue;
        }
        const m = sum[b] / n;
        amp[b] = m;
        sd[b] = n > 1 ? Math.sqrt(Math.max(0, (sq[b] - n * m * m) / (n - 1))) : 0;
        if (m > mx) mx = m;
      }
      const k = mx > 0 ? 1 / mx : 1;
      for (let b = 0; b < nb; b++) {
        amp[b] *= k;
        sd[b] *= k;
      }
      msClassSpecs.push({ label, color: colorOf(label), n: mine.length, freqs, amp, sd, cnt });
    });
  }

  // opts.keepRows: leave the selections list alone (a label typed in it is
  // being committed; rebuilding the list would steal the focus).
  async function msRecompute(opts) {
    const w = wl();
    let fresh = 0;
    msRows.forEach((r) => {
      const e = r.on ? rowEntry(r) : null;
      if (e && !r.specKey.endsWith("|" + w)) fresh += (r.t1 - r.t0) * e.rate;
    });
    if (fresh > 1_500_000 && typeof withBusy === "function")
      await withBusy("Class mean spectra…", async () => computeClasses());
    else computeClasses();
    if (msMode === "tables") {
      msRenderTables();
      renderLabelList();
      if (!(opts && opts.keepRows)) msRenderRows();
      msUpdateTablesUi();
      msDraw();
      msDrawViewer();
    } else msRenderTables();
  }

  // ── Table-mode panels ──
  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function msRenderTables() {
    const box = $("msTableList");
    if (!box) return;
    box.innerHTML = "";
    if (!msTables.length) {
      box.appendChild(el("div", "color:var(--txt2);font-size:11px", "No tables imported."));
      return;
    }
    const lib = libList();
    msTables.forEach((t) => {
      const rows = msRows.filter((r) => r.tableId === t.id);
      const ok = rows.filter((r) => !rowProblem(r, rowEntry(r))).length;
      const card = el("div", "border:1px solid var(--border);border-radius:4px;padding:3px 5px;font-size:11px;display:flex;flex-direction:column;gap:2px");
      const top = el("div", "display:flex;align-items:center;gap:4px");
      const nm = el("span", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600", t.name);
      nm.title = t.name;
      const x = el("button", "font-size:10px", "×");
      x.className = "xbtn";
      x.title = "Remove this table";
      x.onclick = () => msRemoveTable(t.id);
      const use = document.createElement("input");
      use.type = "checkbox";
      use.checked = tableUsed(t);
      use.title = "Use this table. Unticked, its selections are left out of the spectra, the classes, the list and the viewer (their own settings are kept).";
      use.onchange = () => msUseTable(t.id, use.checked);
      top.prepend(use);
      top.append(nm, x);
      card.appendChild(top);
      if (!tableUsed(t)) card.style.opacity = "0.55";
      const grp = groupingOf(t);
      if (grp) {
        const g = el("div", "color:var(--accent,#2d6cdf)",
          `⊃ Groups the selections of "${grp.of.name}" (about ${grp.per.toFixed(1)} in each${grp.groups < rows.length ? `, ${grp.groups} of ${rows.length}` : ""}): motifs, echemes or similar. Decide whether to use this level.`);
        g.title = "Each of these selections encloses two or more selections of the other table. Using both counts the same sound twice, at two levels.";
        card.appendChild(g);
      }
      const info = el("div", `color:${ok < rows.length ? "#d29922" : "var(--txt3)"}`,
        `${rows.length} selection${rows.length === 1 ? "" : "s"}, ${ok} matched` +
          (t.dupes ? `, ${t.dupes} duplicate view row${t.dupes === 1 ? "" : "s"} skipped` : "") +
          (t.skipped ? `, ${t.skipped} unreadable` : ""));
      card.appendChild(info);
      const rep = repeatedRows(t).length;
      if (rep) {
        const w = el("div", "color:#d29922",
          `⚠ ${rep} selection${rep === 1 ? " repeats" : "s repeat"} one in another table (same recording and times); untick ${rep === 1 ? "it" : "them"} or remove a table so ${rep === 1 ? "it is" : "they are"} not counted twice`);
        card.appendChild(w);
      }
      if (t.hasFile) {
        card.appendChild(el("div", "color:var(--txt3)", "Recording: from the Begin File column"));
      } else {
        const sel = document.createElement("select");
        sel.style.cssText = "font-size:11px;width:100%";
        const auto = tableEntry({ ...t, libId: null });
        const o0 = document.createElement("option");
        o0.value = "";
        o0.textContent = auto ? `Auto: ${auto.name}` : "Auto: no match — pick a recording";
        sel.appendChild(o0);
        lib.forEach((e) => {
          const o = document.createElement("option");
          o.value = String(e.id);
          o.textContent = e.name;
          sel.appendChild(o);
        });
        sel.value = t.libId != null && lib.some((e) => e.id === t.libId) ? String(t.libId) : "";
        sel.title = "The recording this table's times refer to";
        sel.onchange = () => {
          t.libId = sel.value ? parseInt(sel.value, 10) : null;
          msRecompute();
        };
        card.appendChild(sel);
      }
      box.appendChild(card);
    });
  }

  function msRenderClasses() {
    const box = $("msClassList");
    if (!box) return;
    box.innerHTML = "";
    const order = classOrder();
    if (!order.length) {
      box.appendChild(el("div", "color:var(--txt2);font-size:11px", "No classes yet."));
      return;
    }
    const used = {};
    msClassSpecs.forEach((c) => (used[c.label] = c.n));
    order.forEach((label, idx) => {
      const total = liveRows().filter((r) => labelOf(r) === label).length;
      const row = el("div", "display:flex;align-items:center;gap:4px;font-size:11px");
      const key = el("span", "width:10px;color:var(--txt3);font-size:10px;text-align:right;flex-shrink:0", idx < 9 ? String(idx + 1) : "");
      if (idx < 9) key.title = `Press ${idx + 1} in the viewer or the list to give the picked selections this label`;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !msClassOff.has(label);
      cb.title = "Plot this class";
      cb.onchange = () => {
        if (cb.checked) msClassOff.delete(label);
        else msClassOff.add(label);
        msRecompute({ keepRows: true });
      };
      const col = document.createElement("button");
      const cur = colorOf(label);
      col.style.cssText = `width:22px;height:16px;padding:0;border:1px solid #888;border-radius:3px;background:${cur};flex-shrink:0;cursor:pointer`;
      col.title = `${colorName(cur)} — click for colour-blind-safe palettes`;
      col.onclick = (ev) => {
        ev.stopPropagation();
        openColorPicker(col, label);
      };
      const name = document.createElement("input");
      name.type = "text";
      name.value = label;
      name.title = "Rename the class: every selection with this label gets the new one (a name already in use merges the two classes)";
      name.style.cssText = "flex:1;min-width:0;font-size:11px";
      name.onchange = () => msRenameClass(label, name.value);
      const n = el("span", "color:var(--txt3);white-space:nowrap", `${used[label] || 0}/${total}`);
      n.title = `${used[label] || 0} of ${total} selections in this class are plotted`;
      row.append(key, cb, col, name, n);
      box.appendChild(row);
    });
  }

  // ── Class colours: colour-blind-safe presets ──
  // Named, published palettes, so a figure's colours can be cited and
  // reproduced exactly (the hex codes are shown on every swatch).
  const CB_PALETTES = [
    {
      name: "Okabe–Ito",
      ref: "Okabe & Ito 2008; Wong 2011, Nature Methods",
      colors: [
        ["orange", "#E69F00"], ["sky blue", "#56B4E9"], ["bluish green", "#009E73"], ["yellow", "#F0E442"],
        ["blue", "#0072B2"], ["vermillion", "#D55E00"], ["reddish purple", "#CC79A7"], ["black", "#000000"],
      ],
    },
    {
      name: "Tol Bright",
      ref: "Paul Tol, personal.sron.nl/~pault",
      colors: [
        ["blue", "#4477AA"], ["red", "#EE6677"], ["green", "#228833"], ["yellow", "#CCBB44"],
        ["cyan", "#66CCEE"], ["purple", "#AA3377"], ["grey", "#BBBBBB"],
      ],
    },
    {
      name: "Tol Vibrant",
      ref: "Paul Tol, personal.sron.nl/~pault",
      colors: [
        ["orange", "#EE7733"], ["blue", "#0077BB"], ["cyan", "#33BBEE"], ["magenta", "#EE3377"],
        ["red", "#CC3311"], ["teal", "#009988"], ["grey", "#BBBBBB"],
      ],
    },
    {
      name: "Tol Muted",
      ref: "Paul Tol, personal.sron.nl/~pault",
      colors: [
        ["indigo", "#332288"], ["cyan", "#88CCEE"], ["teal", "#44AA99"], ["green", "#117733"], ["olive", "#999933"],
        ["sand", "#DDCC77"], ["rose", "#CC6677"], ["wine", "#882255"], ["purple", "#AA4499"],
      ],
    },
    {
      name: "Viridis (6)",
      ref: "matplotlib viridis, 6 evenly spaced steps",
      colors: [
        ["1", "#440154"], ["2", "#414487"], ["3", "#2A788E"], ["4", "#22A884"], ["5", "#7AD151"], ["6", "#FDE725"],
      ],
    },
  ];

  function colorName(hex) {
    const h = String(hex).toUpperCase();
    for (const p of CB_PALETTES) for (const [n, c] of p.colors) if (c === h) return `${p.name} ${n} ${c}`;
    return h;
  }

  function setClassColor(label, hex) {
    msClassColor[label] = hex;
    msClassSpecs.forEach((c) => c.label === label && (c.color = hex));
  }

  function afterColorChange() {
    msRenderClasses();
    msRenderRows();
    msDraw();
    msDrawViewer();
  }

  let pickerEl = null;
  function closeColorPicker() {
    if (pickerEl) pickerEl.remove();
    pickerEl = null;
    document.removeEventListener("mousedown", pickerOutside, true);
    document.removeEventListener("keydown", pickerEsc, true);
  }
  function pickerOutside(ev) {
    if (pickerEl && !pickerEl.contains(ev.target)) closeColorPicker();
  }
  function pickerEsc(ev) {
    if (ev.key === "Escape") closeColorPicker();
  }

  function openColorPicker(anchor, label) {
    closeColorPicker();
    const cur = colorOf(label).toUpperCase();
    const pop = el("div",
      "position:fixed;z-index:9999;background:#fff;color:#222;border:1px solid #999;border-radius:5px;" +
        "box-shadow:0 4px 14px rgba(0,0,0,.35);padding:8px;font:11px Arial,sans-serif;width:262px");
    pop.id = "msColorPicker";
    pop.appendChild(el("div", "font-weight:600;margin-bottom:6px", `Colour of “${label}”`));
    CB_PALETTES.forEach((p) => {
      const head = el("div", "display:flex;align-items:center;margin:4px 0 2px");
      const nm = el("span", "flex:1;color:#444", p.name);
      nm.title = p.ref;
      const all = el("a", "color:#2d6cdf;cursor:pointer;font-size:10px", "Apply to all classes");
      all.title = `Give the classes the ${p.name} colours in order`;
      all.onclick = () => {
        classOrder().forEach((l, i) => setClassColor(l, p.colors[i % p.colors.length][1]));
        closeColorPicker();
        afterColorChange();
      };
      head.append(nm, all);
      const row = el("div", "display:flex;gap:3px;flex-wrap:wrap");
      p.colors.forEach(([n, c]) => {
        const sw = el("button",
          `width:22px;height:18px;padding:0;border-radius:3px;cursor:pointer;background:${c};` +
            (c === cur ? "border:2px solid #000;outline:1px solid #fff;outline-offset:-3px" : "border:1px solid #888"));
        sw.title = `${p.name}: ${n} ${c}`;
        sw.dataset.hex = c;
        sw.onclick = () => {
          setClassColor(label, c);
          closeColorPicker();
          afterColorChange();
        };
        row.appendChild(sw);
      });
      pop.append(head, row);
    });
    // Hex field and the system picker, for anything else
    const foot = el("div", "display:flex;align-items:center;gap:6px;margin-top:8px;border-top:1px solid #ddd;padding-top:6px");
    const hex = document.createElement("input");
    hex.type = "text";
    hex.value = cur;
    hex.style.cssText = "width:70px;font:11px monospace";
    hex.title = "Hex code, e.g. #0072B2 (Enter to apply)";
    const applyHex = () => {
      const v = hex.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
      if (!/^#[0-9a-f]{6}$/i.test(v)) {
        hex.style.borderColor = "#e5534b";
        return;
      }
      setClassColor(label, v.toUpperCase());
      closeColorPicker();
      afterColorChange();
    };
    hex.onkeydown = (ev) => ev.key === "Enter" && applyHex();
    const custom = document.createElement("input");
    custom.type = "color";
    custom.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur.toLowerCase() : "#000000";
    custom.style.cssText = "width:26px;height:20px;padding:0;border:none;background:none";
    custom.title = "Custom colour";
    custom.onchange = () => {
      setClassColor(label, custom.value.toUpperCase());
      closeColorPicker();
      afterColorChange();
    };
    const ok = el("button", "font-size:11px", "Apply");
    ok.onclick = applyHex;
    foot.append(el("span", "color:#444", "Hex"), hex, ok, el("span", "flex:1"), el("span", "color:#444", "Custom…"), custom);
    pop.appendChild(foot);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const ph = pop.offsetHeight || 300;
    pop.style.left = Math.max(4, Math.min(r.left, (window.innerWidth || 1200) - 270)) + "px";
    pop.style.top = (r.bottom + ph + 4 > (window.innerHeight || 800) ? Math.max(4, r.top - ph - 4) : r.bottom + 4) + "px";
    pickerEl = pop;
    setTimeout(() => {
      document.addEventListener("mousedown", pickerOutside, true);
      document.addEventListener("keydown", pickerEsc, true);
    }, 0);
  }

  function msRenameClass(from, to) {
    to = (to || "").trim();
    if (!to || to === from) return msRenderClasses();
    const newLabel = to === UNLABELLED ? "" : to;
    msRows.forEach((r) => {
      if (labelOf(r) === from) {
        r.label = newLabel;
        r.edited = true;
      }
    });
    if (!msClassColor[to]) msClassColor[to] = msClassColor[from];
    if (msClassOff.has(from)) {
      msClassOff.delete(from);
      msClassOff.add(to);
    }
    msRecompute();
  }

  function renderLabelList() {
    const dl = $("msLabelList");
    if (!dl) return;
    dl.innerHTML = "";
    classOrder()
      .filter((l) => l !== UNLABELLED)
      .forEach((l) => {
        const o = document.createElement("option");
        o.value = l;
        dl.appendChild(o);
      });
  }

  function msRenderRows() {
    const box = $("msRowList");
    if (!box) return;
    const scroll = box.scrollTop;
    box.innerHTML = "";
    if (!box.dataset.keys) {
      box.dataset.keys = "1";
      box.tabIndex = 0;
      box.style.outline = "none";
      box.addEventListener("keydown", msViewerKey);
    }
    if (!msRows.length) {
      box.appendChild(el("div", "color:var(--txt2);font-size:11px", "No selections."));
      return;
    }
    const multiRec = msTables.length > 1 || msTables.some((t) => t.hasFile);
    const frag = document.createDocumentFragment();
    const live = liveRows();
    if (!live.length) box.appendChild(el("div", "color:var(--txt2);font-size:11px", "No table is in use."));
    live.forEach((r) => {
      const e = rowEntry(r);
      const why = rowProblem(r, e);
      const picked = msPicked.has(r.id);
      const row = el("div",
        "display:flex;align-items:center;gap:4px;font-size:11px;padding:1px 2px;border-radius:3px;cursor:pointer" +
          (picked ? ";background:var(--accent,#2d6cdf);color:#fff" : "") +
          (r.on ? "" : ";opacity:0.5"));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = r.on;
      cb.title = "Include this selection";
      cb.onclick = (ev) => ev.stopPropagation();
      cb.onchange = () => {
        r.on = cb.checked;
        row.style.opacity = r.on ? "" : "0.5";
        msRecompute({ keepRows: true });
      };
      const sw = el("span", `width:8px;height:8px;border-radius:2px;flex-shrink:0;background:${colorOf(labelOf(r))}`);
      const lab = document.createElement("input");
      lab.type = "text";
      lab.value = r.label;
      lab.placeholder = UNLABELLED;
      lab.setAttribute("list", "msLabelList");
      lab.style.cssText = "width:78px;font-size:11px;flex-shrink:0";
      lab.onclick = (ev) => ev.stopPropagation();
      lab.onchange = () => {
        r.label = lab.value.trim();
        r.edited = true;
        sw.style.background = colorOf(labelOf(r));
        msRecompute({ keepRows: true });
      };
      const where = (multiRec ? `${e ? stemOf(e.name) : r.file || "?"} ` : "") + `${r.t0.toFixed(2)}–${r.t1.toFixed(2)}s`;
      const meta = el("span",
        "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" +
          (why ? ";color:#e5534b" : picked ? "" : ";color:var(--txt3)"),
        (why ? "⚠ " : "") + where);
      meta.title = (why ? why + "\n" : "") + `${tableOf(r.tableId)?.name || ""}\n${r.t0.toFixed(4)}–${r.t1.toFixed(4)} s`;
      row.append(cb, sw, lab, meta);
      row.dataset.id = String(r.id);
      if (r.id === msFocusId) row.style.boxShadow = "inset 3px 0 0 #000";
      row.onclick = (ev) => msPick(r.id, ev);
      frag.appendChild(row);
    });
    box.appendChild(frag);
    box.scrollTop = scroll;
  }

  function msPick(id, ev, opts) {
    ev = ev || {};
    if (ev.shiftKey && msLastPicked != null) {
      const ids = liveRows().map((r) => r.id);
      const a = ids.indexOf(msLastPicked);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        if (!(ev.ctrlKey || ev.metaKey)) msPicked.clear();
        ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => msPicked.add(x));
      }
    } else if (ev.ctrlKey || ev.metaKey) {
      if (msPicked.has(id)) msPicked.delete(id);
      else msPicked.add(id);
      msLastPicked = id;
    } else {
      const only = msPicked.size === 1 && msPicked.has(id) && !(opts && opts.keep);
      msPicked.clear();
      if (!only) msPicked.add(id);
      msLastPicked = id;
    }
    msFocusId = id;
    const r = msRows.find((x) => x.id === id);
    if (r) showRow(r);
    msRenderRows();
    msUpdateTablesUi();
    msDrawViewer();
    if (opts && opts.fromViewer) {
      const rowEl = $("msRowList")?.querySelector(`[data-id="${id}"]`);
      if (rowEl && rowEl.scrollIntoView) rowEl.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Selection viewer ──
  // Above the class spectra: the recording of the current selection as a
  // waveform or an amplitude envelope, every selection of that recording
  // boxed in its class colour, so selections can be heard and seen while
  // they are labelled. Not part of the exported figure.
  let msFocusId = null; // the row the viewer follows
  let msViewEntryId = null;
  let msViewT0 = 0;
  let msViewT1 = 0;
  let msViewStyle = "wave"; // "wave" | "env"
  let msViewBoxes = []; // label-track bars of the last draw: { id, x0, x1, y0, y1 }
  let msViewSpans = []; // the same selections on the waveform: { id, x0, x1, on }
  let msAudio = null; // { ctx, src }
  const peakCache = new WeakMap();

  function entryPeak(e) {
    let p = peakCache.get(e.samples);
    if (p == null) {
      p = 0;
      const a = e.samples;
      for (let i = 0; i < a.length; i++) {
        const v = Math.abs(a[i]);
        if (v > p) p = v;
      }
      peakCache.set(e.samples, p || 1);
    }
    return p || 1;
  }

  function viewEntry() {
    const lib = libList();
    return lib.find((x) => x.id === msViewEntryId) || null;
  }

  // Recordings that have at least one row, in table order.
  function viewerEntries() {
    const out = [];
    liveRows().forEach((r) => {
      const e = rowEntry(r);
      if (e && !out.includes(e)) out.push(e);
    });
    return out;
  }

  function setViewEntry(e, keepView) {
    if (!e) return;
    if (e.id !== msViewEntryId || !keepView) {
      msViewEntryId = e.id;
      msViewT0 = 0;
      msViewT1 = e.dur;
    }
  }

  // Bring a row into view: switch recording if needed; keep the zoom when
  // the selection already fits, otherwise centre on it.
  function showRow(r) {
    const e = rowEntry(r);
    if (!e) return;
    setViewEntry(e, true);
    const span = msViewT1 - msViewT0;
    const d = r.t1 - r.t0;
    if (r.t0 >= msViewT0 && r.t1 <= msViewT1) return;
    const want = Math.max(span, d * 1.5);
    let a = (r.t0 + r.t1) / 2 - want / 2;
    a = Math.max(0, Math.min(a, e.dur - want));
    msViewT0 = a;
    msViewT1 = Math.min(e.dur, a + want);
  }

  // Greedy interval partitioning of one recording's selections into lanes.
  // One block of lanes per table, in import order, so a table's selections
  // stay together; within a table, selections that overlap get extra lanes.
  // tableStart: the first lane of each table that has rows here.
  function layoutLanes(e) {
    const lane = new Map();
    const tableStart = [];
    let base = 0;
    msTables.forEach((t) => {
      if (!tableUsed(t)) return;
      const rows = msRows
        .filter((r) => r.tableId === t.id && rowEntry(r) === e)
        .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
      if (!rows.length) return;
      const ends = []; // last end time per lane
      rows.forEach((r) => {
        let k = ends.findIndex((x) => x <= r.t0 + 1e-9);
        if (k < 0) {
          k = ends.length;
          ends.push(0);
        }
        ends[k] = r.t1;
        lane.set(r.id, base + k);
      });
      tableStart.push({ lane: base, table: t });
      base += ends.length;
    });
    return { lane, nLanes: Math.max(1, base), tableStart };
  }

  // Rows of table t that repeat a selection of another table (same
  // recording, begin and end within 1 ms): they would be counted twice.
  function repeatedRows(t) {
    if (!tableUsed(t)) return [];
    const others = liveRows().filter((r) => r.tableId !== t.id).map((r) => ({ r, e: rowEntry(r) }));
    return msRows.filter((r) => {
      if (r.tableId !== t.id) return false;
      const e = rowEntry(r);
      return e && others.some((o) => o.e === e && Math.abs(o.r.t0 - r.t0) < 0.001 && Math.abs(o.r.t1 - r.t1) < 0.001);
    });
  }

  function buildViewer() {
    const box = $("msViewer");
    if (!box || box.dataset.built) return;
    box.dataset.built = "1";
    box.innerHTML = "";
    const bar = el("div", "display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:#333;margin-bottom:4px");
    const rec = document.createElement("select");
    rec.id = "msViewRec";
    rec.style.cssText = "font-size:11px;max-width:220px";
    rec.title = "The recording shown";
    rec.onchange = () => {
      const e = libList().find((x) => String(x.id) === rec.value);
      setViewEntry(e, false);
      msDrawViewer();
    };
    const sty = document.createElement("select");
    sty.style.cssText = "font-size:11px";
    [["wave", "Waveform"], ["env", "Envelope"]].forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sty.appendChild(o);
    });
    sty.onchange = () => {
      msViewStyle = sty.value;
      msDrawViewer();
    };
    const btn = (txt, title, fn) => {
      const b = el("button", "font-size:11px;padding:1px 6px", txt);
      b.title = title;
      b.onclick = fn;
      return b;
    };
    bar.append(
      rec,
      sty,
      btn("◀", "Previous selection (←)", () => msStep(-1)),
      btn("▶", "Next selection (→)", () => msStep(1)),
      btn("♪ Play", "Play the picked selection (Space)", () => msPlayFocus()),
      el("span", "width:6px"),
      btn("−", "Zoom out in time (−)", () => msZoom(1.6)),
      btn("+", "Zoom in in time (+)", () => msZoom(1 / 1.6)),
      btn("⤢ Selection", "Zoom to the current selection (Z)", () => msZoomToFocus()),
      btn("Fit", "Show the whole recording (F, or double-click)", () => msZoomFit()),
      el("span", "color:#333;font-variant-numeric:tabular-nums", ""),
      el("span", "color:#777;font-size:10px;margin-left:auto",
        "Drag to zoom in time · wheel zoom · Alt-drag or Shift+wheel pan · click a box to pick · ←/→ step · 1–9 label · Space play"),
    );
    bar.children[bar.children.length - 2].id = "msViewSpan";
    const cv = document.createElement("canvas");
    cv.id = "msViewCanvas";
    cv.tabIndex = 0;
    cv.style.cssText = "display:block;width:100%;height:170px;border:1px solid #ccc;border-radius:3px;outline:none;cursor:pointer;background:#fff";
    box.append(bar, cv);
    attachViewerInput(cv);
  }

  function msDrawViewer() {
    const box = $("msViewer");
    if (!box) return;
    const on = msMode === "tables" && liveRows().length > 0;
    box.style.display = on ? "" : "none";
    if (!on) return;
    buildViewer();
    const entries = viewerEntries();
    if (!viewEntry() || !entries.includes(viewEntry())) setViewEntry(entries[0], false);
    const e = viewEntry();
    const rec = $("msViewRec");
    rec.innerHTML = "";
    entries.forEach((x) => {
      const o = document.createElement("option");
      o.value = String(x.id);
      o.textContent = x.name;
      rec.appendChild(o);
    });
    if (e) rec.value = String(e.id);
    const cv = $("msViewCanvas");
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(300, cv.clientWidth || 800);
    // Layout, top to bottom: the waveform at full height, shaded where the
    // included selections are; under it a label track, one lane per set of
    // selections that overlap in time (each selection a bar with its label);
    // then the time axis.
    const LANE_H = 17;
    const lanes = e ? layoutLanes(e) : { lane: new Map(), nLanes: 1 };
    const wavTop = 4,
      wavH = 120;
    const trackTop = wavTop + wavH + 4;
    const trackH = Math.min(8, lanes.nLanes) * LANE_H;
    const axisTop = trackTop + trackH + 2;
    const H = axisTop + 20;
    cv.style.height = H + "px";
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext && cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    msViewBoxes = [];
    msViewSpans = [];
    if (!e) {
      ctx.fillStyle = "#666";
      ctx.font = "12px Arial";
      ctx.fillText("No selection is matched to a loaded recording.", 10, 24);
      return;
    }
    const L = 8,
      R = 8;
    const pw = W - L - R;
    const t0 = msViewT0,
      t1 = Math.max(msViewT0 + 1e-4, msViewT1);
    const tX = (t) => L + ((t - t0) / (t1 - t0)) * pw;
    const spanEl = $("msViewSpan");
    if (spanEl) {
      const d = t1 - t0;
      const dp = d < 0.1 ? 4 : d < 10 ? 3 : 2;
      spanEl.textContent = `${t0.toFixed(dp)}–${t1.toFixed(dp)} s` + (d < e.dur - 1e-6 ? ` (${(d < 1 ? (d * 1000).toFixed(0) + " ms" : d.toFixed(2) + " s")} of ${e.dur.toFixed(2)} s)` : "");
    }
    const mine = liveRows().filter((r) => rowEntry(r) === e && r.t1 > t0 && r.t0 < t1);
    const xs = (r) => [Math.max(L, tX(r.t0)), Math.min(L + pw, tX(r.t1))];

    // Shading on the waveform: included selections only, full height.
    mine.forEach((r) => {
      const [x0, x1] = xs(r);
      msViewSpans.push({ id: r.id, x0, x1, on: r.on });
      if (!r.on) return;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = colorOf(labelOf(r));
      ctx.fillRect(x0, wavTop, Math.max(1, x1 - x0), wavH);
      ctx.globalAlpha = 1;
    });

    // The trace
    const a = e.samples;
    const pk = entryPeak(e);
    const i0 = Math.max(0, Math.floor(t0 * e.rate));
    const i1 = Math.min(a.length, Math.ceil(t1 * e.rate));
    const n = Math.max(1, i1 - i0);
    const cols = Math.max(1, Math.floor(pw));
    ctx.strokeStyle = "#222";
    ctx.fillStyle = "#333";
    ctx.lineWidth = 1;
    const mid = wavTop + wavH / 2;
    const amp = (v) => (v / pk) * (wavH / 2) * 0.95;
    if (msViewStyle === "env") {
      ctx.beginPath();
      ctx.moveTo(L, wavTop + wavH);
      for (let c = 0; c < cols; c++) {
        const s = i0 + Math.floor((c * n) / cols);
        const end = Math.max(s + 1, i0 + Math.floor(((c + 1) * n) / cols));
        let m = 0;
        for (let i = s; i < end && i < a.length; i++) {
          const v = Math.abs(a[i]);
          if (v > m) m = v;
        }
        ctx.lineTo(L + c + 0.5, wavTop + wavH - (m / pk) * wavH * 0.95);
      }
      ctx.lineTo(L + cols, wavTop + wavH);
      ctx.closePath();
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (n <= cols * 2) {
      ctx.beginPath();
      for (let i = i0; i < i1; i++) {
        const x = tX(i / e.rate);
        const y = mid - amp(a[i]);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      for (let c = 0; c < cols; c++) {
        const s = i0 + Math.floor((c * n) / cols);
        const end = Math.max(s + 1, i0 + Math.floor(((c + 1) * n) / cols));
        let lo = a[s],
          hi = a[s];
        for (let i = s + 1; i < end; i++) {
          const v = a[i];
          if (v < lo) lo = v;
          else if (v > hi) hi = v;
        }
        const x = L + c + 0.5;
        ctx.moveTo(x, mid - amp(hi));
        ctx.lineTo(x, mid - amp(lo) + 0.5);
      }
      ctx.stroke();
    }

    // Picked selections: outlined on the waveform too
    mine.forEach((r) => {
      if (!msPicked.has(r.id)) return;
      const [x0, x1] = xs(r);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 0.5, wavTop + 0.5, Math.max(1, x1 - x0 - 1), wavH - 1);
      ctx.lineWidth = 1;
    });

    // Label track
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(L, trackTop, pw, trackH);
    lanes.tableStart.forEach((b, i) => {
      if (!i || b.lane >= 8) return;
      ctx.strokeStyle = "#bbb";
      ctx.beginPath();
      ctx.moveTo(L, trackTop + b.lane * LANE_H + 0.5);
      ctx.lineTo(L + pw, trackTop + b.lane * LANE_H + 0.5);
      ctx.stroke();
    });
    ctx.font = "11px Arial";
    ctx.textBaseline = "middle";
    mine.forEach((r) => {
      const k = lanes.lane.get(r.id);
      if (k >= 8) return; // more than 8 overlapping: the rest are not drawn
      const [x0, x1] = xs(r);
      const y0 = trackTop + k * LANE_H + 1;
      const h = LANE_H - 2;
      const c = colorOf(labelOf(r));
      const w = Math.max(2, x1 - x0);
      if (r.on) {
        ctx.fillStyle = c;
        ctx.fillRect(x0, y0, w, h);
      } else {
        ctx.fillStyle = "#e6e6e6";
        ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = "#999";
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
      }
      if (msPicked.has(r.id)) {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
        ctx.lineWidth = 1;
      }
      const text = labelOf(r) + (r.on ? "" : " (out)");
      if (w > 12) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, w, h);
        ctx.clip();
        ctx.fillStyle = r.on ? "#fff" : "#666";
        ctx.fillText(text, x0 + 3, y0 + h / 2 + 0.5);
        ctx.restore();
      }
      if (r.id === msFocusId) {
        ctx.fillStyle = "#000";
        ctx.beginPath();
        const xm = (x0 + x1) / 2;
        ctx.moveTo(xm - 5, wavTop + wavH);
        ctx.lineTo(xm + 5, wavTop + wavH);
        ctx.lineTo(xm, wavTop + wavH - 7);
        ctx.fill();
      }
      msViewBoxes.push({ id: r.id, x0, x1, y0, y1: y0 + h });
    });

    // Time axis
    ctx.textBaseline = "top";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, axisTop + 0.5);
    ctx.lineTo(L + pw, axisTop + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.textAlign = "center";
    niceTicks(t0, t1, 10).forEach((t) => {
      const x = tX(t);
      if (x < L - 1 || x > L + pw + 1) return;
      ctx.beginPath();
      ctx.moveTo(x, axisTop);
      ctx.lineTo(x, axisTop + 4);
      ctx.stroke();
      ctx.fillText(fmtTick(t), x, axisTop + 6);
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if ($("msFigWave")?.checked) {
      clearTimeout(figWaveTimer);
      figWaveTimer = setTimeout(() => msMode === "tables" && msDrawClasses(), 120);
    }
  }
  let figWaveTimer = null;

  // ── Time zoom ──
  function setView(a, b) {
    const e = viewEntry();
    if (!e) return;
    const span = Math.max(0.005, Math.min(e.dur, b - a));
    a = Math.max(0, Math.min(a, e.dur - span));
    msViewT0 = a;
    msViewT1 = a + span;
  }

  // k < 1 zooms in, around the centre (or around time `at`).
  function msZoom(k, at) {
    if (!viewEntry()) return;
    const c = at != null ? at : (msViewT0 + msViewT1) / 2;
    setView(c - (c - msViewT0) * k, c + (msViewT1 - c) * k);
    msDrawViewer();
  }

  function msZoomFit() {
    const e = viewEntry();
    if (!e) return;
    msViewT0 = 0;
    msViewT1 = e.dur;
    msDrawViewer();
  }

  // The current selection with a quarter of its length on either side.
  function msZoomToFocus() {
    const r = msRows.find((x) => x.id === msFocusId) || msRows.find((x) => msPicked.has(x.id));
    const e = r && rowEntry(r);
    if (!e) return;
    setViewEntry(e, true);
    const pad = (r.t1 - r.t0) * 0.25;
    setView(r.t0 - pad, r.t1 + pad);
    msDrawViewer();
  }

  function attachViewerInput(cv) {
    const toX = (ev) => ev.clientX - cv.getBoundingClientRect().left;
    const toY = (ev) => ev.clientY - cv.getBoundingClientRect().top;
    const geom = () => {
      const W = cv.clientWidth || 800;
      return { L: 8, pw: W - 16 };
    };
    const toT = (x) => {
      const g = geom();
      return msViewT0 + ((x - g.L) / g.pw) * (msViewT1 - msViewT0);
    };
    const clampView = setView;
    cv.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const span = msViewT1 - msViewT0;
      if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        const d = (ev.shiftKey ? ev.deltaY : ev.deltaX) || ev.deltaY;
        clampView(msViewT0 + (d > 0 ? 0.15 : -0.15) * span, msViewT1 + (d > 0 ? 0.15 : -0.15) * span);
      } else {
        msZoom(ev.deltaY > 0 ? 1.25 : 0.8, toT(toX(ev)));
        return;
      }
      msDrawViewer();
    }, { passive: false });
    // Drag: zoom to the dragged stretch of time. Alt-drag or middle-drag:
    // pan. A click without moving: pick the box under it.
    cv.addEventListener("pointerdown", (ev) => {
      const x0 = toX(ev);
      const y0 = toY(ev);
      const v0 = msViewT0,
        v1 = msViewT1;
      const pan = ev.altKey || ev.button === 1;
      if (ev.button === 1) ev.preventDefault();
      let moved = false;
      let x1 = x0;
      const onMove = (e2) => {
        x1 = toX(e2);
        const dx = x1 - x0;
        if (!moved && Math.abs(dx) > 3) moved = true;
        if (!moved) return;
        if (pan) {
          const dt = (dx / geom().pw) * (v1 - v0);
          clampView(v0 - dt, v1 - dt);
          msDrawViewer();
          return;
        }
        msDrawViewer();
        const g = geom();
        const a = Math.max(g.L, Math.min(x0, x1)),
          b = Math.min(g.L + g.pw, Math.max(x0, x1));
        const ctx = cv.getContext && cv.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "rgba(45,108,223,0.15)";
          ctx.strokeStyle = "#2d6cdf";
          ctx.fillRect(a, 0, b - a, cv.clientHeight || 170);
          ctx.strokeRect(a + 0.5, 0.5, Math.max(0, b - a - 1), (cv.clientHeight || 170) - 1);
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (moved && !pan) {
          const ta = toT(Math.min(x0, x1)),
            tb = toT(Math.max(x0, x1));
          setView(Math.max(v0, ta), Math.min(v1, tb));
          msDrawViewer();
        }
        if (moved) return;
        // a click: pick the box under it (the shortest, if they overlap)
        // On the label track: the bar under the pointer.
        const bar = msViewBoxes.find((b) => x0 >= b.x0 - 1 && x0 <= b.x1 + 1 && y0 >= b.y0 && y0 <= b.y1);
        if (bar) return msPick(bar.id, ev, { fromViewer: true });
        // On the waveform: the selections there, included ones first,
        // shortest first; clicking again steps to the next overlapping one.
        const trackY = msViewBoxes.length ? Math.min(...msViewBoxes.map((b) => b.y0)) : Infinity;
        if (y0 >= trackY - 2) return;
        const rowsById = new Map(msRows.map((r) => [r.id, r]));
        const hits = msViewSpans
          .filter((b) => x0 >= b.x0 - 1 && x0 <= b.x1 + 1)
          .map((b) => rowsById.get(b.id))
          .filter(Boolean)
          .sort((p, q) => (q.on - p.on) || (p.t1 - p.t0) - (q.t1 - q.t0));
        if (!hits.length) return;
        const at = msPicked.has(msFocusId) ? hits.findIndex((r) => r.id === msFocusId) : -1;
        const next = at >= 0 && hits.length > 1 && !(ev.shiftKey || ev.ctrlKey || ev.metaKey) ? hits[(at + 1) % hits.length] : hits[0];
        msPick(next.id, ev, { fromViewer: true, keep: at >= 0 && hits.length > 1 });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      cv.focus();
    });
    cv.addEventListener("dblclick", () => msZoomFit());
    // Tooltip: which selection a bar is, and where it comes from.
    cv.addEventListener("mousemove", (ev) => {
      const x = toX(ev),
        y = toY(ev);
      const b = msViewBoxes.find((q) => x >= q.x0 - 1 && x <= q.x1 + 1 && y >= q.y0 && y <= q.y1);
      const r = b && msRows.find((q) => q.id === b.id);
      cv.title = r
        ? `${labelOf(r)}${r.on ? "" : " (left out)"}
${tableOf(r.tableId)?.name || ""}
${r.t0.toFixed(3)}–${r.t1.toFixed(3)} s (${((r.t1 - r.t0) * 1000).toFixed(0)} ms)`
        : "";
    });
    cv.addEventListener("keydown", msViewerKey);
  }

  // Keys while the viewer or the selections list has the focus (never while
  // typing in a field).
  function msViewerKey(ev) {
    const tag = (ev.target && ev.target.tagName) || "";
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) && ev.target.type !== "checkbox") return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      msStep(1);
      ev.preventDefault();
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      msStep(-1);
      ev.preventDefault();
    } else if (ev.key === " ") {
      msPlayFocus();
      ev.preventDefault();
    } else if (ev.key === "+" || ev.key === "=") {
      msZoom(1 / 1.6);
      ev.preventDefault();
    } else if (ev.key === "-" || ev.key === "_") {
      msZoom(1.6);
      ev.preventDefault();
    } else if (ev.key === "z" || ev.key === "Z") {
      msZoomToFocus();
      ev.preventDefault();
    } else if (ev.key === "f" || ev.key === "F") {
      msZoomFit();
      ev.preventDefault();
    } else if (/^[1-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const label = classOrder()[parseInt(ev.key, 10) - 1];
      if (label == null || !msPicked.size) return;
      const single = msPicked.size === 1;
      msRows.forEach((r) => {
        if (msPicked.has(r.id)) {
          r.label = label === UNLABELLED ? "" : label;
          r.edited = true;
        }
      });
      ev.preventDefault();
      msRecompute().then(() => single && msStep(1));
    }
  }

  // Move the pick to the previous/next selection in table order.
  function msStep(dir) {
    const ids = liveRows().map((r) => r.id);
    if (!ids.length) return;
    let i = ids.indexOf(msFocusId);
    i = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + dir));
    msPick(ids[i], {}, { fromViewer: true });
  }

  function msPlayFocus() {
    const r = msRows.find((x) => x.id === msFocusId) || msRows.find((x) => msPicked.has(x.id));
    const e = r && rowEntry(r);
    if (!e) return;
    try {
      if (msAudio && msAudio.src) msAudio.src.stop();
    } catch (err) {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!msAudio) msAudio = { ctx: new AC() };
    const i0 = Math.max(0, Math.floor(r.t0 * e.rate));
    const i1 = Math.min(e.samples.length, Math.ceil(r.t1 * e.rate));
    if (i1 - i0 < 2) return;
    const buf = msAudio.ctx.createBuffer(1, i1 - i0, e.rate);
    const pk = entryPeak(e);
    const ch = buf.getChannelData(0);
    for (let i = i0; i < i1; i++) ch[i - i0] = e.samples[i] / pk * 0.9;
    const src = msAudio.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(msAudio.ctx.destination);
    if (msAudio.ctx.state === "suspended") msAudio.ctx.resume();
    src.start();
    msAudio.src = src;
  }

  function msPickAll(on) {
    msPicked.clear();
    if (on) liveRows().forEach((r) => msPicked.add(r.id));
    msRenderRows();
    msUpdateTablesUi();
  }

  function msLabelPicked() {
    if (!msPicked.size) return;
    const label = ($("msBulkLabel").value || "").trim();
    msRows.forEach((r) => {
      if (msPicked.has(r.id)) {
        r.label = label;
        r.edited = true;
      }
    });
    msRecompute();
  }

  function msIncludePicked(on) {
    msRows.forEach((r) => msPicked.has(r.id) && (r.on = on));
    msRecompute();
  }

  function msUpdateTablesUi() {
    const has = msClassSpecs.length > 0;
    ["btnMsPng", "btnMsSvg", "btnMsCsv"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !has;
    });
    const set = (id, dis) => {
      const b = $(id);
      if (b) b.disabled = dis;
    };
    set("btnMsTableOut", !msRows.length);
    set("btnMsTablesClear", !msTables.length);
    ["btnMsBulkLabel", "btnMsInclPicked", "btnMsExclPicked"].forEach((id) => set(id, !msPicked.size));
    const pc = $("msPickedInfo");
    if (pc) pc.textContent = msPicked.size ? `${msPicked.size} picked` : "";
    msRenderClasses();
  }

  function msOnModeChange() {
    msMode = $("msMode").value;
    const t = msMode === "tables";
    const show = (id, on) => {
      const e = $(id);
      if (e) e.style.display = on ? "" : "none";
    };
    show("msPanelWave", !t);
    show("msPanelBrush", !t);
    show("msPanelTables", t);
    show("msPanelClasses", t);
    show("msPanelRows", t);
    show("msSdRow", t);
    show("msClassStyleRow", t);
    show("msFigWaveRow", t);
    show("btnMsTableOut", t);
    msDrawViewer();
    if (t) {
      renderLabelColSelect();
      msRecompute();
    } else {
      msUpdateUi();
      msDraw();
    }
  }

  // ── Drawing the class spectra ──
  // ── Waveform panel of the class figure ──
  // The recording and time range shown in the selection viewer, drawn as in
  // brush mode: the oscillogram (or envelope) scaled to -1..1, recoloured in
  // the class colour where included selections lie, with a compact label
  // track and a time axis. Exported with the figure.
  const FIG_OSC_H = 150;
  const FIG_LANE_H = 14;

  function figWaveLayout(y0) {
    if (!$("msFigWave")?.checked) return null;
    const e = viewEntry();
    if (!e) return null;
    const t0 = msViewT0,
      t1 = Math.max(msViewT0 + 1e-4, msViewT1);
    const rows = liveRows()
      .filter((r) => r.on && rowEntry(r) === e && r.t1 > t0 && r.t0 < t1)
      .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    // lanes for the label track: greedy, included selections only
    const ends = [];
    const lane = new Map();
    rows.forEach((r) => {
      let k = ends.findIndex((x) => x <= r.t0 + 1e-9);
      if (k < 0) {
        k = ends.length;
        ends.push(0);
      }
      ends[k] = r.t1;
      lane.set(r.id, k);
    });
    const nLanes = Math.min(6, ends.length);
    const oscTop = y0 + 22; // room for the recording name
    const trackTop = oscTop + FIG_OSC_H + 4;
    const axisTop = trackTop + nLanes * FIG_LANE_H + 2;
    return { e, t0, t1, rows, lane, nLanes, y0, oscTop, trackTop, axisTop, bottom: axisTop + 40 };
  }

  function drawFigWave(svg, wf, L, pw) {
    const { e, t0, t1, rows, lane, nLanes, y0, oscTop, trackTop, axisTop } = wf;
    const tX = (t) => L + ((t - t0) / (t1 - t0)) * pw;
    const full = t0 <= 1e-6 && t1 >= e.dur - 1e-6;
    svg.appendChild(svgEl("text", { x: L, y: y0 + 14, "font-size": 12, fill: "#222" },
      e.name.replace(/\.[^/.]+$/, "") + (full ? "" : `  (${t0.toFixed(3)}–${t1.toFixed(3)} s)`)));
    const env = msViewStyle === "env";
    const a = e.samples;
    const pk = entryPeak(e);
    const nBins = Math.max(1, Math.floor(pw));
    const i0 = Math.max(0, Math.floor(t0 * e.rate));
    const i1 = Math.min(a.length, Math.ceil(t1 * e.rate));
    const n = Math.max(1, i1 - i0);
    const aY = env
      ? (v) => oscTop + FIG_OSC_H * (1 - v / 1.1) // 0..1.1
      : (v) => oscTop + FIG_OSC_H * (1 - (v + 1.2) / 2.4); // -1.2..1.2, as brush mode
    // colour of each column: the first included selection covering it
    const colorAt = (t) => {
      const r = rows.find((q) => q.t0 <= t && q.t1 >= t);
      return r ? colorOf(labelOf(r)) : "#000";
    };
    const paths = {};
    for (let c = 0; c < nBins; c++) {
      const s0 = i0 + Math.floor((c * n) / nBins);
      const s1 = Math.max(s0 + 1, i0 + Math.floor(((c + 1) * n) / nBins));
      let lo = Infinity,
        hi = -Infinity,
        m = 0;
      for (let i = s0; i < s1 && i < a.length; i++) {
        const v = a[i] / pk;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (Math.abs(v) > m) m = Math.abs(v);
      }
      if (!isFinite(lo)) continue;
      const x = (L + c + 0.5).toFixed(1);
      const col = colorAt(t0 + ((c + 0.5) / nBins) * (t1 - t0));
      paths[col] = (paths[col] || "") + (env
        ? `M${x},${aY(0).toFixed(1)}L${x},${aY(m).toFixed(1)}`
        : `M${x},${aY(lo).toFixed(1)}L${x},${(aY(hi) - 0.5).toFixed(1)}`);
    }
    Object.keys(paths).forEach((col) =>
      svg.appendChild(svgEl("path", { d: paths[col], stroke: col, "stroke-width": 1, fill: "none" })),
    );
    // y axis
    svg.appendChild(svgEl("line", { x1: L, y1: oscTop, x2: L, y2: oscTop + FIG_OSC_H, stroke: "#000" }));
    (env ? [0, 0.5, 1] : [-1, 0, 1]).forEach((v) => {
      const y = aY(v);
      svg.appendChild(svgEl("line", { x1: L - 4, y1: y, x2: L, y2: y, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x: L - 7, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#222" }, String(v)));
    });
    svg.appendChild(svgEl("text", { x: 14, y: oscTop + FIG_OSC_H / 2, "text-anchor": "middle", "font-size": 12, fill: "#222", transform: `rotate(-90 14 ${oscTop + FIG_OSC_H / 2})` }, "Amplitude"));
    // label track
    rows.forEach((r) => {
      const k = lane.get(r.id);
      if (k >= nLanes) return;
      const x0 = Math.max(L, tX(r.t0)),
        x1 = Math.min(L + pw, tX(r.t1));
      const y = trackTop + k * FIG_LANE_H;
      const col = colorOf(labelOf(r));
      svg.appendChild(svgEl("rect", { x: x0.toFixed(1), y, width: Math.max(1, x1 - x0).toFixed(1), height: FIG_LANE_H - 2, fill: col }));
      const text = labelOf(r);
      if (x1 - x0 > text.length * 5.6 + 6)
        svg.appendChild(svgEl("text", { x: (x0 + 3).toFixed(1), y: y + FIG_LANE_H - 5, "font-size": 9.5, fill: "#fff" }, text));
    });
    // time axis
    svg.appendChild(svgEl("line", { x1: L, y1: axisTop, x2: L + pw, y2: axisTop, stroke: "#000" }));
    niceTicks(t0, t1, 8).forEach((t) => {
      const x = tX(t);
      if (x < L - 1 || x > L + pw + 1) return;
      svg.appendChild(svgEl("line", { x1: x, y1: axisTop, x2: x, y2: axisTop + 4, stroke: "#000" }));
      svg.appendChild(svgEl("text", { x, y: axisTop + 16, "text-anchor": "middle", "font-size": 11, fill: "#222" }, fmtTick(t)));
    });
    svg.appendChild(svgEl("text", { x: L + pw / 2, y: axisTop + 32, "text-anchor": "middle", "font-size": 12, fill: "#222" }, "Time (s)"));
  }

  function msDrawClasses() {
    const wrap = $("msFigure");
    if (!wrap) return;
    wrap.innerHTML = "";
    msSvgEl = null;
    if (!msClassSpecs.length) {
      const msg = !msTables.length
        ? "Import one or more selection tables on the left (Raven .txt, CSV or Excel, with begin and end times)."
        : !libList().length
          ? "Load the recordings the tables refer to (Loaded Audio)."
          : "No included selection is matched to a loaded recording. See the Selection tables panel.";
      wrap.appendChild(el("div", "color:#666;font-size:12px;padding:20px", msg));
      return;
    }
    const W = Math.max(620, wrap.clientWidth - 8);
    const L = 64,
      R = 22;
    const pw = W - L - R;
    const title = ($("msTitle")?.value || "").trim();
    const titleH = title ? 34 : 12;
    const alpha = Math.max(0.05, Math.min(1, num("msAlpha", 0.9)));
    const showSd = !!$("msSd")?.checked;

    // Legend: one entry per class, wrapping onto more lines when needed.
    const items = msClassSpecs.map((c) => ({ c, text: `${c.label} (n=${c.n})` }));
    const lines = [[]];
    let used = 0;
    items.forEach((it) => {
      it.w = 30 + it.text.length * 6.4;
      if (used + it.w > pw && lines[lines.length - 1].length) {
        lines.push([]);
        used = 0;
      }
      lines[lines.length - 1].push(it);
      used += it.w;
    });
    // Optional waveform panel: the viewer's recording and time range.
    const wf = figWaveLayout(titleH);
    const legendTop = (wf ? wf.bottom : titleH) + 8;
    const specTop = legendTop + lines.length * 18 + 8,
      specH = 380;
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
    if (title)
      svg.appendChild(mdTitle({ x: L, y: 22, "font-size": 17, fill: "#111", "font-weight": 600 }, title));
    if (wf) drawFigWave(svg, wf, L, pw);

    const grid = msClassSpecs[0].freqs;
    const fNyq = grid[grid.length - 1];
    let f0 = num("msFMin", 0);
    let f1 = num("msFMax", fNyq);
    f0 = Math.max(0, Math.min(f0, fNyq));
    f1 = Math.max(f0 + 0.01, Math.min(f1, fNyq));
    let top = 1;
    msClassSpecs.forEach((c) => {
      for (let b = 0; b < grid.length; b++) {
        if (grid[b] < f0 || grid[b] > f1) continue;
        const v = c.amp[b] + (showSd ? c.sd[b] : 0);
        if (v > top) top = v;
      }
    });
    const yMax = top * 1.05;
    const fX = (f) => L + ((f - f0) / (f1 - f0)) * pw;
    const sY = (a) => specTop + specH * (1 - a / yMax);

    // Polyline through the in-range bins; NaN (no recording reaches that
    // frequency) breaks the line.
    const segments = (vals) => {
      const segs = [];
      let cur = null;
      for (let b = 0; b < grid.length; b++) {
        const f = grid[b];
        if (f < f0 || f > f1) continue;
        const v = vals(b);
        if (!isFinite(v)) {
          cur = null;
          continue;
        }
        if (!cur) segs.push((cur = []));
        cur.push([fX(f), sY(Math.max(0, v))]);
      }
      return segs;
    };
    const pts = (seg) => seg.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");

    const GRm = gridRead("msGrid");
    if (GRm && GRm.on) {
      const dash = GRm.dash.map((v) => v * Math.max(1, GRm.width)).join(" ");
      const gl = (x1, y1, x2, y2) =>
        svg.appendChild(svgEl("line", { x1, y1, x2, y2, stroke: GRm.color || "#bbbbbb", "stroke-width": GRm.width, "stroke-dasharray": dash }));
      niceTicks(f0, f1, 10).forEach((f) => gl(fX(f), specTop, fX(f), specTop + specH));
      niceTicks(0, yMax, 5).forEach((a) => gl(L, sY(a), L + pw, sY(a)));
    }

    // Each class drawn whole (band or fill, then its line) before the next,
    // so overlapping classes stack the same way everywhere. "Lines" draws no
    // fill under the mean, which reads best with several classes.
    const filled = ($("msClassStyle")?.value || "lines") === "fill";
    const base = sY(0).toFixed(1);
    msClassSpecs.forEach((c) => {
      if (showSd) {
        const up = segments((b) => c.amp[b] + c.sd[b]);
        const dn = segments((b) => c.amp[b] - c.sd[b]);
        up.forEach((seg, i) => {
          const low = dn[i];
          if (!low) return;
          svg.appendChild(svgEl("path", {
            d: "M" + pts(seg) + "L" + pts(low.slice().reverse()) + "Z",
            fill: c.color,
            "fill-opacity": alpha * 0.4,
            stroke: "none",
          }));
        });
      } else if (filled) {
        segments((b) => c.amp[b]).forEach((seg) => {
          svg.appendChild(svgEl("path", {
            d: `M${seg[0][0].toFixed(1)},${base}L` + pts(seg) + `L${seg[seg.length - 1][0].toFixed(1)},${base}Z`,
            fill: c.color,
            "fill-opacity": alpha,
            stroke: "none",
          }));
        });
      }
      segments((b) => c.amp[b]).forEach((seg) =>
        svg.appendChild(svgEl("path", { d: "M" + pts(seg), fill: "none", stroke: c.color, "stroke-width": filled ? 1 : 1.4, "stroke-opacity": filled ? 1 : Math.max(0.5, alpha) })),
      );
    });

    // Axes
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
    svg.appendChild(svgEl("text", { x: 14, y: specTop + specH / 2, "text-anchor": "middle", "font-size": 12, fill: "#222", transform: `rotate(-90 14 ${specTop + specH / 2})` }, "Relative amplitude"));

    // Legend, right-aligned line by line
    lines.forEach((line, li) => {
      const y = legendTop + li * 18 + 6;
      let lx = L + pw - line.reduce((s, it) => s + it.w, 0);
      line.forEach((it) => {
        if (filled || showSd)
          svg.appendChild(svgEl("rect", { x: lx, y: y - 5, width: 14, height: 10, fill: it.c.color, "fill-opacity": showSd ? alpha * 0.4 : alpha, stroke: it.c.color }));
        else svg.appendChild(svgEl("line", { x1: lx, y1: y, x2: lx + 14, y2: y, stroke: it.c.color, "stroke-width": 2.5 }));
        svg.appendChild(svgEl("text", { x: lx + 19, y: y + 4, "font-size": 11, fill: "#222" }, it.text));
        lx += it.w;
      });
    });

    const hoverRect = svgEl("rect", { x: L, y: specTop, width: pw, height: specH, fill: "transparent", class: "ms-ui" });
    svg.appendChild(hoverRect);
    wrap.appendChild(svg);
    msSvgEl = svg;
    msGeo = {
      L, pw, specTop, specH, f0, f1, yMax, fX, sY,
      traces: msClassSpecs.map((c) => ({ name: c.label, color: c.color, spec: c })),
    };
    attachHover(svg, hoverRect);
  }

  // ── Table-mode exports ──
  async function msExportClassCsv() {
    if (!msClassSpecs.length) return;
    const safe = (s) => s.replace(/[^\w.-]+/g, "_");
    const cols = ["frequency_khz"];
    msClassSpecs.forEach((c) => cols.push(`${safe(c.label)}_mean`, `${safe(c.label)}_sd`, `${safe(c.label)}_n`));
    const f = (v, d) => (isFinite(v) ? v.toFixed(d) : "");
    let csv = cols.join(",") + "\n";
    const grid = msClassSpecs[0].freqs;
    for (let b = 0; b < grid.length; b++) {
      const row = [grid[b].toFixed(5)];
      msClassSpecs.forEach((c) => row.push(f(c.amp[b], 6), f(c.sd[b], 6), c.cnt[b]));
      csv += row.join(",") + "\n";
    }
    await dlFile(baseName() + suffix() + ".csv", csv, "text/csv", { exactName: true });
  }

  async function msExportLabelledTable() {
    if (!msRows.length) return;
    const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ");
    let txt =
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tBegin File\tFile Offset (s)\tSource Table\tIncluded\tAnnotation\n";
    msRows.forEach((r, i) => {
      const e = rowEntry(r);
      txt +=
        [
          i + 1,
          "Spectrogram 1",
          1,
          r.t0.toFixed(6),
          r.t1.toFixed(6),
          (r.lo != null ? r.lo : 0).toFixed(2),
          (r.hi != null ? r.hi : e ? e.rate / 2 : 0).toFixed(2),
          clean(r.file || (e ? e.name : "")),
          r.t0.toFixed(6),
          clean(tableOf(r.tableId)?.name || ""),
          r.on && rowLive(r) ? "yes" : "no",
          clean((r.label || "").trim()),
        ].join("\t") + "\n";
    });
    await dlFile(baseName() + "_labelled.selections.txt", txt, "text/plain", { exactName: true });
  }

  // ── Export ────────────────────────────────────────────────────────
  function serialize() {
    const clone = msSvgEl.cloneNode(true);
    clone.querySelectorAll(".ms-ui, .ms-brush").forEach((e) => e.remove());
    return new XMLSerializer().serializeToString(clone);
  }

  function baseName() {
    const t = ($("msFilePrefix")?.value || "").trim();
    const fallback = msMode === "tables" ? "classes" : msLabel || "meanspectra";
    return (t || fallback).replace(/[^\w.-]+/g, "_");
  }

  function suffix() {
    return msMode === "tables" ? "_class_meanspectra" : "_meanspectra";
  }

  async function msExportSvg() {
    if (!msSvgEl) return;
    await dlFile(baseName() + suffix() + ".svg", serialize(), "image/svg+xml", { exactName: true });
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
        await dlFile(baseName() + suffix() + ".png", bytes, "image/png", { exactName: true });
      }, "image/png");
    };
    img.src = url;
  }

  async function msExportCsv() {
    if (msMode === "tables") return msExportClassCsv();
    if (!msFull) return;
    const groups = brushGroups(); // one column per label, its selections pooled
    const cols = ["frequency_khz", "mean"].concat(
      groups.map((g) => `${g.name}_n${g.n}`.replace(/[^\w.-]+/g, "_")),
    );
    let csv = cols.join(",") + "\n";
    for (let b = 0; b < msFull.freqs.length; b++) {
      const row = [msFull.freqs[b].toFixed(5), msFull.amp[b].toFixed(6)];
      groups.forEach((g) => row.push(g.spec.amp[b].toFixed(6)));
      csv += row.join(",") + "\n";
    }
    await dlFile(baseName() + "_meanspectra.csv", csv, "text/csv", { exactName: true });
  }

  window.addEventListener("resize", () => {
    const v = $("mainview-meanspec");
    if (v && v.offsetParent !== null) {
      msDraw();
      msDrawViewer();
    }
  });

  window.msRenderLibPicker = msRenderLibPicker;
  window.msDraw = msDraw;
  window.msBrushZoom = msBrushZoom;
  window.msBrushZoomFit = msBrushZoomFit;
  window.msBrushZoomToSel = msBrushZoomToSel;
  window.msOnNameChoice = msOnNameChoice;
  window.msOnWlChange = msOnWlChange;
  window.msAddSelection = msAddSelection;
  window.msClearSelections = msClearSelections;
  window.msExportSvg = msExportSvg;
  window.msExportPng = msExportPng;
  window.msExportCsv = msExportCsv;
  window.msOnModeChange = msOnModeChange;
  window.msImportTables = msImportTables;
  window.msClearTables = msClearTables;
  window.msOnLabelColChange = msOnLabelColChange;
  window.msLabelPicked = msLabelPicked;
  window.msPickAll = msPickAll;
  window.msIncludePicked = msIncludePicked;
  window.msExportLabelledTable = msExportLabelledTable;
})();
