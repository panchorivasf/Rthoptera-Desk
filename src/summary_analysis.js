// ═══════════════════════════════════════════════════════════════════
// SUMMARY ANALYSIS
// A sub-module of Summarize. Where "Summary" pools every row and reports
// descriptive statistics, this one treats each RECORDING (or each specimen)
// as one observation, described by the mean of each chosen metric, and asks
// how the species differ:
//
//   - PCA biplot (2D) and 3D view, on Z-scored metrics, with a covariance
//     ellipse (or ellipsoid) per species and the metric loadings;
//   - a radar plot of min-max scaled metrics, species mean +/- 1 SD;
//   - a ranking of how strongly each metric separates the species
//     (eta-squared and F from a one-way ANOVA) — the cheap, interpretable
//     answer to "which variables matter".
//
// Follows the plan in Cesare's notes ("metrics-assisted song recognition"):
// Z-scores for the plotting phase, native values left alone elsewhere.
// Reads summMerged, built by Merge & Summarize, so nothing is read twice.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";

  const CATS = [
    ["motifs", "Motifs"],
    ["pulses", "Pulses"],
    ["envPeaks", "EnvPeaks"],
    ["spectral", "Spectral"],
    ["motseq", "MotifSeqs"],
  ];
  // Columns that identify or locate a row rather than describe the sound.
  const EXCL_START = /^(source|specimen|species|country|locality|selection|view|channel|annotation|label|unit|type|temp)/i;
  const EXCL_END = /(_id|_start|_end|_time)$|^(id|n|nrow)$/i;
  // A first, reasonable set of "indicators" (Cesare's list): rates, counts,
  // duty cycle, complexity and excursion indices, frequency.
  const SUGGESTED = [
    "motifs::motif_rate_per_s",
    "motifs::n_pulses",
    "motifs::duty_cycle_pct",
    "motifs::pulse_rate_pps",
    "motifs::pci_syl",
    "motifs::pci_agn",
    "motifs::tem_exc_mean",
    "motifs::dyn_exc_mean",
    "motifs::peak_freq_khz",
    "motifs::bw_20db_khz",
  ];
  const BASE_COLORS = [
    "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9",
    "#7B3294", "#999999", "#8C564B", "#17BECF",
  ];
  const specColor = (i) =>
    i < BASE_COLORS.length
      ? BASE_COLORS[i]
      : "hsl(" + (((i * 137.508) % 360) | 0) + ",62%," + (42 + (i % 3) * 8) + "%)";

  const sa = {
    samples: [], // { key, species, n, vals: {featId: mean} }
    features: [], // { id, cat, col, label }
    species: [], // names, in first-seen order
    selFeat: new Set(),
    selSp: new Set(),
    pca: null,
    rel: null,
    view3d: { yaw: -0.7, pitch: 0.4, zoom: 1 },
    hover3d: null, // recording key under the cursor in the 3D plot
    pin3d: new Set(), // recording keys whose ID was clicked on
    pin2d: new Set(), // same, in the 2D biplot
    d3: null, // the scene last drawn
    // Temperature as a covariate: slopes are fitted WITHIN species (so that
    // species that live at different temperatures do not tilt the slope), then
    // each value is moved to a reference temperature.
    temp: { on: false, ref: 25, onlySig: true, fit: null },
  };

  // User-edited names, kept when the data are rescanned:
  //   obs    recording key -> display label
  //   obsSp  recording key -> species to use instead of the file's tag
  //   sp     species (after the per-recording override) -> display name;
  //          giving two species one name merges them everywhere
  const lab = { obs: new Map(), obsSp: new Map(), sp: new Map() };

  function applyLabels() {
    sa.samples.forEach((s) => {
      s.base = lab.obsSp.get(s.key) || s.raw;
      s.species = lab.sp.get(s.base) || s.base;
      s.label = lab.obs.get(s.key) || s.key;
    });
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }
  const num = (v) => {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const x = Number(v);
      return isFinite(x) ? x : null;
    }
    return null;
  };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sdev = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };
  const say = (t, bad) => {
    const el = $("saStatus");
    if (el) {
      el.textContent = t;
      el.style.color = bad ? "#f85149" : "var(--txt2)";
    }
  };

  // ── Sub-tab switching ─────────────────────────────────────────────
  function summSwitchPane(which) {
    const main = $("summPaneMain"),
      an = $("summPaneAnalysis");
    if (main) main.style.display = which === "main" ? "flex" : "none";
    if (an) an.style.display = which === "analysis" ? "flex" : "none";
    ["main", "analysis"].forEach((n) => {
      const t = $("summsubtab-" + n);
      if (t) t.classList.toggle("active", n === which);
    });
    if (which === "analysis") saScan();
  }

  // ── Building the observations from the merged tables ───────────────
  function saScan() {
    const merged = typeof summMerged !== "undefined" ? summMerged : null;
    const prevFeat = new Set(sa.selFeat);
    sa.samples = [];
    sa.features = [];
    sa.species = [];
    sa.pca = null;
    if (!merged) {
      renderLists();
      renderNames();
      renderCmpList();
      say("Add files and press Merge & Summarize on the Summary tab first.", true);
      return;
    }
    const unit = $("saUnit") ? $("saUnit").value : "recording";
    const keyOf = (r) =>
      unit === "specimen"
        ? String(r.specimen_id || "(no specimen)")
        : String(r.source_file || r.source_workbook || r.specimen_id || "(unknown)");

    const bySample = new Map(); // key -> { acc: Map(featId -> [sum,count]), sp: Map, n }
    const featMeta = new Map();
    const touch = (key) => {
      let s = bySample.get(key);
      if (!s) {
        s = { key, acc: new Map(), sp: new Map(), spec: new Map(), n: 0, tsum: 0, tn: 0 };
        bySample.set(key, s);
      }
      return s;
    };
    const add = (s, id, v) => {
      let a = s.acc.get(id);
      if (!a) {
        a = [0, 0];
        s.acc.set(id, a);
      }
      a[0] += v;
      a[1]++;
    };

    CATS.forEach(([cat, label]) => {
      (merged[cat] || []).forEach((r) => {
        const s = touch(keyOf(r));
        s.n++;
        const sp = String(r.species || "").trim();
        if (sp) s.sp.set(sp, (s.sp.get(sp) || 0) + 1);
        const sid = String(r.specimen_id || "").trim();
        if (sid) s.spec.set(sid, (s.spec.get(sid) || 0) + 1);
        // temperature may be typed as "22.5" or "~23": take the first number
        const tm = r.temp_c == null ? null : String(r.temp_c).match(/-?\d+(\.\d+)?/);
        if (tm) {
          s.tsum += parseFloat(tm[0]);
          s.tn++;
        }
        for (const col in r) {
          if (EXCL_START.test(col) || EXCL_END.test(col)) continue;
          const v = num(r[col]);
          if (v == null) continue;
          const id = cat + "::" + col;
          if (!featMeta.has(id))
            featMeta.set(id, { id, cat, col, label: label + ": " + col });
          add(s, id, v);
        }
        // Echemes per second: the mean of 1 / (onset-to-onset period), as on
        // the Temporal Analysis dashboard.
        if (cat === "motifs") {
          const per = num(r.motif_period_s);
          if (per != null && per > 0) {
            const id = "motifs::motif_rate_per_s";
            if (!featMeta.has(id))
              featMeta.set(id, { id, cat, col: "motif_rate_per_s", label: "Motifs: motif_rate_per_s" });
            add(s, id, 1 / per);
          }
        }
      });
    });

    sa.samples = [...bySample.values()].map((s) => {
      let species = "(no species)",
        best = 0;
      s.sp.forEach((c, name) => {
        if (c > best) {
          best = c;
          species = name;
        }
      });
      const vals = {};
      s.acc.forEach((a, id) => (vals[id] = a[0] / a[1]));
      let specimen = "",
        bestSp = 0;
      s.spec.forEach((c, id) => {
        if (c > bestSp) {
          bestSp = c;
          specimen = id;
        }
      });
      return { key: s.key, raw: species, species, specimen, n: s.n, vals, temp: s.tn ? s.tsum / s.tn : null };
    });
    applyLabels();
    // Keep a variable if any observation has a value for it. PCA and the
    // other multi-observation steps drop the ones with fewer than 3 values
    // themselves; comparing two recordings needs no more than one each.
    sa.features = [...featMeta.values()];
    sa.features.sort(
      (a, b) =>
        CATS.findIndex((c) => c[0] === a.cat) - CATS.findIndex((c) => c[0] === b.cat) ||
        a.col.localeCompare(b.col),
    );
    sa.species = [...new Set(sa.samples.map((s) => s.species))];

    // Selections: keep what the user had, else the suggested set (else all).
    const ids = new Set(sa.features.map((f) => f.id));
    sa.selFeat = new Set([...prevFeat].filter((i) => ids.has(i)));
    if (!sa.selFeat.size) {
      SUGGESTED.forEach((i) => ids.has(i) && sa.selFeat.add(i));
      if (sa.selFeat.size < 3) sa.features.slice(0, 10).forEach((f) => sa.selFeat.add(f.id));
    }
    const spOk = new Set(sa.species);
    sa.selSp = new Set([...sa.selSp].filter((s) => spOk.has(s)));
    if (!sa.selSp.size)
      (sa.species.length <= 8 ? sa.species : sa.species.slice(0, 6)).forEach((s) =>
        sa.selSp.add(s),
      );
    renderLists();
    renderNames();
    renderCmpList();
    refreshTemp();
    say(
      sa.samples.length +
        " observation(s), " +
        sa.species.length +
        " species, " +
        sa.features.length +
        " usable variable(s). Choose the variables and press Run analysis.",
    );
  }

  function renderLists() {
    const fl = $("saFeatList"),
      sl = $("saSpList");
    if (fl) {
      fl.innerHTML = "";
      let lastCat = "";
      sa.features.forEach((f) => {
        if (f.cat !== lastCat) {
          lastCat = f.cat;
          const h = document.createElement("div");
          h.style.cssText = "grid-column:1/-1;font-size:10px;font-weight:600;color:var(--txt3);margin-top:4px";
          h.textContent = CATS.find((c) => c[0] === f.cat)[1];
          fl.appendChild(h);
        }
        const lab = document.createElement("label");
        lab.className = "chk";
        lab.style.cssText = "font-size:11px;color:var(--txt2);white-space:nowrap";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = sa.selFeat.has(f.id);
        cb.onchange = () => {
          if (cb.checked) sa.selFeat.add(f.id);
          else sa.selFeat.delete(f.id);
          updateFeatCount();
        };
        lab.appendChild(cb);
        lab.append(" " + f.col);
        fl.appendChild(lab);
      });
    }
    if (sl) {
      sl.innerHTML = "";
      sa.species.forEach((name, i) => {
        const lab = document.createElement("label");
        lab.className = "chk";
        lab.style.cssText = "font-size:11px;color:var(--txt2);white-space:nowrap";
        const sw = document.createElement("span");
        sw.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 3px;background:" + specColor(i);
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = sa.selSp.has(name);
        cb.onchange = () => {
          if (cb.checked) sa.selSp.add(name);
          else sa.selSp.delete(name);
          if (sa.pca) drawAll();
        };
        lab.appendChild(cb);
        lab.appendChild(sw);
        lab.append(name + " (" + sa.samples.filter((s) => s.species === name).length + ")");
        sl.appendChild(lab);
      });
    }
    updateFeatCount();
  }
  function updateFeatCount() {
    const c = $("saFeatCount");
    if (c) c.textContent = sa.selFeat.size + " of " + sa.features.length;
  }
  function saSelectFeatures(mode) {
    sa.selFeat = new Set();
    if (mode === "all") sa.features.forEach((f) => sa.selFeat.add(f.id));
    if (mode === "suggested") {
      const ids = new Set(sa.features.map((f) => f.id));
      SUGGESTED.forEach((i) => ids.has(i) && sa.selFeat.add(i));
    }
    renderLists();
  }
  function saSelectSpecies(mode) {
    sa.selSp = new Set();
    if (mode === "all") sa.species.forEach((s) => sa.selSp.add(s));
    if (mode === "first6") sa.species.slice(0, 6).forEach((s) => sa.selSp.add(s));
    renderLists();
    if (sa.pca) drawAll();
  }


  // ── Temperature ───────────────────────────────────────────────────
  // Regularised incomplete beta, for the Student-t p-value of a slope.
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x,
      t = x + 5.5;
    t -= (x + 0.5) * Math.log(t);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -t + Math.log((2.5066282746310005 * ser) / x);
  }
  function betacf(a, b, x) {
    let qab = a + b,
      qap = a + 1,
      qam = a - 1,
      c = 1,
      d = 1 - (qab * x) / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
  const tTwoSidedP = (t, df) => ibeta(df / 2, 0.5, df / (df + t * t));

  // Within-species regression of every variable on temperature: pooled slope
  // from deviations around each species' own means.
  function fitTemperature() {
    const withT = sa.samples.filter((s) => s.temp != null);
    sa.temp.fit = null;
    if (withT.length < 4) return;
    const fit = new Map();
    sa.features.forEach((f) => {
      const groups = new Map();
      withT.forEach((s) => {
        if (!(f.id in s.vals)) return;
        if (!groups.has(s.species)) groups.set(s.species, []);
        groups.get(s.species).push([s.temp, s.vals[f.id]]);
      });
      let sxx = 0,
        sxy = 0,
        syy = 0,
        df = 0,
        n = 0;
      groups.forEach((pts) => {
        n += pts.length;
        if (pts.length < 2) return;
        const mt = mean(pts.map((p) => p[0])),
          my = mean(pts.map((p) => p[1]));
        pts.forEach(([t, y]) => {
          sxx += (t - mt) ** 2;
          sxy += (t - mt) * (y - my);
          syy += (y - my) ** 2;
        });
        df += pts.length - 1;
      });
      df -= 1;
      if (sxx < 1e-9 || syy <= 0 || df < 2) return;
      const b = sxy / sxx;
      const sse = Math.max(0, syy - b * sxy);
      const se = Math.sqrt(sse / df / sxx);
      const t = se > 0 ? b / se : Infinity;
      fit.set(f.id, { b, r2: (sxy * sxy) / (sxx * syy), p: se > 0 ? tTwoSidedP(t, df) : 0, n });
    });
    sa.temp.fit = fit;
  }

  // The adjustment currently in force: { ref, slopes: Map(id -> per-°C slope) }.
  function tempRule() {
    const T = sa.temp;
    if (!T.on || !T.fit) return null;
    const slopes = new Map();
    T.fit.forEach((f, id) => {
      if (!T.onlySig || f.p < 0.05) slopes.set(id, f.b);
    });
    return slopes.size ? { ref: T.ref, slopes } : null;
  }
  // A value, moved to the reference temperature when a rule applies.
  function adjustedVal(s, id, rule) {
    const v = s.vals[id];
    if (v == null || !rule || s.temp == null) return v;
    const b = rule.slopes.get(id);
    return b == null ? v : v - b * (s.temp - rule.ref);
  }
  const valOf = (s, id) => (id in s.vals ? adjustedVal(s, id, tempRule()) : null);

  function refreshTemp() {
    const T = sa.temp;
    const refEl = $("saTempRef");
    const have = sa.samples.filter((s) => s.temp != null);
    fitTemperature();
    const info = $("saTempInfo");
    if (info) {
      if (!sa.samples.length) info.textContent = "";
      else if (!have.length) info.textContent = "No temperature in the data (the temp_c column is empty), so there is nothing to adjust.";
      else {
        const ts = have.map((s) => s.temp);
        const sig = T.fit ? [...T.fit.values()].filter((f) => f.p < 0.05).length : 0;
        info.textContent =
          have.length + " of " + sa.samples.length + " observations have a temperature (" + Math.min(...ts).toFixed(1) + "–" + Math.max(...ts).toFixed(1) + " °C)" +
          (T.fit ? "; " + sig + " of " + T.fit.size + " variables show a significant slope within species." : "; too few to fit slopes.") +
          (T.on && have.length < sa.samples.length ? " " + (sa.samples.length - have.length) + " without a temperature are left unadjusted." : "");
        // first time: offer the mean temperature as the reference
        if (refEl && !refEl.dataset.touched && ts.length) {
          T.ref = Math.round(mean(ts) * 2) / 2;
          refEl.value = String(T.ref);
        }
      }
    }
    const tr = $("saTempRow");
    if (tr) tr.style.opacity = have.length ? "1" : "0.6";
  }
  function saTempChanged(touchedRef) {
    const T = sa.temp;
    T.on = !!$("saTempOn")?.checked;
    const r = parseFloat($("saTempRef")?.value);
    if (isFinite(r)) T.ref = r;
    if (touchedRef && $("saTempRef")) $("saTempRef").dataset.touched = "1";
    T.onlySig = $("saTempSig") ? $("saTempSig").checked : true;
    refreshTemp();
    if (sa.pca) saRun();
  }

  // ── PCA (Z-scored metrics, eigen-decomposition of the correlation matrix) ──
  function jacobiEigen(A, p) {
    // Cyclic Jacobi for a symmetric p x p matrix (array of rows). Returns
    // { values, vectors } with vectors[i][j] = component i of eigenvector j.
    const a = A.map((r) => r.slice());
    const v = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) off += a[i][j] * a[i][j];
      if (off < 1e-20) break;
      for (let pp = 0; pp < p - 1; pp++) {
        for (let q = pp + 1; q < p; q++) {
          if (Math.abs(a[pp][q]) < 1e-300) continue;
          const theta = (a[q][q] - a[pp][pp]) / (2 * a[pp][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1),
            s = t * c;
          for (let k = 0; k < p; k++) {
            const akp = a[k][pp],
              akq = a[k][q];
            a[k][pp] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < p; k++) {
            const apk = a[pp][k],
              aqk = a[q][k];
            a[pp][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < p; k++) {
            const vkp = v[k][pp],
              vkq = v[k][q];
            v[k][pp] = c * vkp - s * vkq;
            v[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const order = Array.from({ length: p }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x]);
    return {
      values: order.map((i) => a[i][i]),
      vectors: Array.from({ length: p }, (_, r) => order.map((i) => v[r][i])),
    };
  }

  function saRun() {
    saScan_keepSelection();
    const feats = sa.features.filter((f) => sa.selFeat.has(f.id));
    if (sa.samples.length < 3) {
      say("Need at least 3 observations (recordings or specimens).", true);
      return;
    }
    if (feats.length < 2) {
      say("Select at least 2 variables.", true);
      return;
    }
    // Raw matrix with column means imputed for missing values.
    const n = sa.samples.length;
    const cols = [];
    feats.forEach((f) => {
      const vals = sa.samples.map((s) => valOf(s, f.id));
      const ok = vals.filter((v) => v != null);
      if (ok.length < 3) return;
      const m = mean(ok),
        sd = sdev(ok);
      if (!(sd > 1e-12)) return; // a constant carries no information
      cols.push({ f, raw: vals.map((v) => (v == null ? m : v)), m, sd });
    });
    const dropped = feats.length - cols.length;
    if (cols.length < 2) {
      say("Fewer than 2 selected variables vary between observations.", true);
      return;
    }
    const p = cols.length;
    const Z = Array.from({ length: n }, (_, i) => cols.map((c) => (c.raw[i] - c.m) / c.sd));
    // correlation matrix
    const C = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < p; i++)
      for (let j = i; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += Z[k][i] * Z[k][j];
        C[i][j] = C[j][i] = s / (n - 1);
      }
    const eig = jacobiEigen(C, p);
    const kPC = Math.min(3, p);
    const total = eig.values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const scores = Z.map((row) =>
      Array.from({ length: kPC }, (_, c) => row.reduce((s, z, j) => s + z * eig.vectors[j][c], 0)),
    );
    const loadings = cols.map((_, j) =>
      Array.from({ length: kPC }, (_, c) => eig.vectors[j][c] * Math.sqrt(Math.max(0, eig.values[c]))),
    );
    sa.pca = {
      cols,
      scores,
      loadings,
      ratio: eig.values.slice(0, kPC).map((v) => Math.max(0, v) / total),
      kPC,
    };
    sa.rel = relevance(cols);
    fillAxisSelects(kPC);
    drawAll();
    say(
      "PCA on " + n + " observations × " + p + " variables" +
        (dropped ? " (" + dropped + " constant/short variable(s) skipped)" : "") +
        ". PC1–" + kPC + " explain " +
        (sa.pca.ratio.reduce((s, v) => s + v, 0) * 100).toFixed(0) + "% of the variance.",
    );
  }
  // saRun re-reads the species selection after a rescan only if needed.
  function saScan_keepSelection() {
    if (!sa.samples.length) saScan();
  }

  function fillAxisSelects(k) {
    ["saPcX", "saPcY"].forEach((id, ix) => {
      const el = $(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = "";
      for (let i = 0; i < k; i++) {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = "PC" + (i + 1) + " (" + (sa.pca.ratio[i] * 100).toFixed(1) + "%)";
        el.appendChild(o);
      }
      el.value = cur && +cur < k ? cur : String(Math.min(ix, k - 1));
    });
  }

  // ── Which variables separate the species? (one-way ANOVA) ──────────
  // eta-squared = between-species sum of squares / total, the share of a
  // variable's variance that species explains; F is the usual ratio.
  function relevance(cols) {
    const groups = new Map();
    sa.samples.forEach((s, i) => {
      if (!groups.has(s.species)) groups.set(s.species, []);
      groups.get(s.species).push(i);
    });
    const k = groups.size;
    const N = sa.samples.length;
    return cols
      .map((c) => {
        const x = c.raw;
        const gm = mean(x);
        let ssb = 0,
          ssw = 0;
        groups.forEach((idx) => {
          const m = mean(idx.map((i) => x[i]));
          ssb += idx.length * (m - gm) ** 2;
          idx.forEach((i) => (ssw += (x[i] - m) ** 2));
        });
        const sst = ssb + ssw;
        const eta = sst > 0 ? ssb / sst : 0;
        const F = N > k && k > 1 && ssw > 0 ? ssb / (k - 1) / (ssw / (N - k)) : null;
        return { id: c.f.id, label: c.f.label, eta2: eta, F };
      })
      .sort((a, b) => b.eta2 - a.eta2);
  }

  // ── Drawing ───────────────────────────────────────────────────────
  function drawAll() {
    if (!sa.pca) return;
    drawPca2d();
    drawPca3d();
    drawRadar();
    drawRelevance();
  }
  const speciesIdx = (name) => sa.species.indexOf(name);
  const shown = () => sa.samples.map((s, i) => ({ s, i })).filter((o) => sa.selSp.has(o.s.species));

  function covEllipsePts(pts, nStd, steps) {
    // pts: array of [x, y]
    const n = pts.length;
    const mx = mean(pts.map((p) => p[0])),
      my = mean(pts.map((p) => p[1]));
    let sxx = 0,
      sxy = 0,
      syy = 0;
    pts.forEach(([x, y]) => {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (y - my);
      syy += (y - my) ** 2;
    });
    sxx /= n - 1;
    sxy /= n - 1;
    syy /= n - 1;
    const tr = sxx + syy,
      det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc,
      l2 = Math.max(0, tr / 2 - disc);
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const out = [];
    for (let t = 0; t <= steps; t++) {
      const a = (t / steps) * 2 * Math.PI;
      const ex = nStd * Math.sqrt(l1) * Math.cos(a),
        ey = nStd * Math.sqrt(l2) * Math.sin(a);
      out.push([mx + ex * Math.cos(th) - ey * Math.sin(th), my + ex * Math.sin(th) + ey * Math.cos(th)]);
    }
    return { pts: out, mx, my };
  }

  function niceTicks(lo, hi, target) {
    const span = hi - lo;
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
      out.push(Math.round(v / step) * step);
    return out;
  }

  const legendCol = (names) => 28 + Math.max(0, ...names.map((n) => n.length)) * 6.4;
  function legendInto(svg, x0, y0, names) {
    const colW = legendCol(names),
      perCol = 16;
    names.forEach((name, i) => {
      const cx = x0 + Math.floor(i / perCol) * colW,
        cy = y0 + (i % perCol) * 17;
      svg.appendChild(svgEl("rect", { x: cx, y: cy - 8, width: 10, height: 10, rx: 2, fill: specColor(speciesIdx(name)) }));
      svg.appendChild(svgEl("text", { x: cx + 15, y: cy, "font-size": 11, fill: "#222" }, name));
    });
    return Math.ceil(names.length / perCol) * colW;
  }

  function drawPca2d() {
    const host = $("saPcaFig");
    if (!host) return;
    host.innerHTML = "";
    const P = sa.pca;
    const cx = Math.min(P.kPC - 1, +($("saPcX")?.value || 0)),
      cy = Math.min(P.kPC - 1, +($("saPcY")?.value || 1));
    const nStd = parseFloat($("saSigma")?.value) || 2;
    const showEll = $("saEllipse")?.checked !== false;
    const showLoad = $("saLoadings")?.checked !== false;
    const rows = shown();
    if (!rows.length) {
      host.textContent = "Tick at least one species.";
      return;
    }
    const names = [...new Set(rows.map((o) => o.s.species))];
    const pts = (name) => rows.filter((o) => o.s.species === name).map((o) => [P.scores[o.i][cx], P.scores[o.i][cy]]);
    // extent: points + ellipses
    let xs = [],
      ys = [];
    const ells = {};
    names.forEach((nm) => {
      const pp = pts(nm);
      pp.forEach(([x, y]) => (xs.push(x), ys.push(y)));
      if (showEll && pp.length >= 3) {
        ells[nm] = covEllipsePts(pp, nStd, 60);
        ells[nm].pts.forEach(([x, y]) => (xs.push(x), ys.push(y)));
      }
    });
    let lo = [Math.min(...xs), Math.min(...ys)],
      hi = [Math.max(...xs), Math.max(...ys)];
    const loadScale = (() => {
      const mx = Math.max(...P.loadings.map((l) => Math.hypot(l[cx], l[cy]))) || 1;
      const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1]) || 1;
      return (0.42 * ext) / mx;
    })();
    if (showLoad)
      P.loadings.forEach((l) => {
        xs.push(l[cx] * loadScale * 1.2);
        ys.push(l[cy] * loadScale * 1.2);
      });
    lo = [Math.min(...xs), Math.min(...ys)];
    hi = [Math.max(...xs), Math.max(...ys)];
    const padX = (hi[0] - lo[0]) * 0.06 || 1,
      padY = (hi[1] - lo[1]) * 0.06 || 1;
    lo = [lo[0] - padX, lo[1] - padY];
    hi = [hi[0] + padX, hi[1] + padY];

    const ML = 56,
      MT = 36,
      MB = 48,
      plotW = 560,
      plotH = 480;
    const sc = Math.min(plotW / (hi[0] - lo[0]), plotH / (hi[1] - lo[1])); // equal aspect keeps ellipses honest
    const gw = sc * (hi[0] - lo[0]),
      gh = sc * (hi[1] - lo[1]);
    const X = (v) => ML + (v - lo[0]) * sc;
    const Y = (v) => MT + gh - (v - lo[1]) * sc;
    const legW = Math.ceil(names.length / 16) * legendCol(names);
    const W = ML + gw + 24 + legW,
      H = Math.max(MT + gh + MB, MT + 16 * 17 + 10);
    const svg = svgEl("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: "background:#fff;display:block;max-width:100%;height:auto", "font-family": "Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    // grid + zero lines + ticks
    niceTicks(lo[0], hi[0], 7).forEach((t) => {
      svg.appendChild(svgEl("line", { x1: X(t), y1: MT, x2: X(t), y2: MT + gh, stroke: "#eee" }));
      svg.appendChild(svgEl("text", { x: X(t), y: MT + gh + 15, "text-anchor": "middle", "font-size": 10, fill: "#444" }, String(+t.toPrecision(3))));
    });
    niceTicks(lo[1], hi[1], 7).forEach((t) => {
      svg.appendChild(svgEl("line", { x1: ML, y1: Y(t), x2: ML + gw, y2: Y(t), stroke: "#eee" }));
      svg.appendChild(svgEl("text", { x: ML - 6, y: Y(t) + 3, "text-anchor": "end", "font-size": 10, fill: "#444" }, String(+t.toPrecision(3))));
    });
    if (lo[0] < 0 && hi[0] > 0) svg.appendChild(svgEl("line", { x1: X(0), y1: MT, x2: X(0), y2: MT + gh, stroke: "#999", "stroke-dasharray": "4 3" }));
    if (lo[1] < 0 && hi[1] > 0) svg.appendChild(svgEl("line", { x1: ML, y1: Y(0), x2: ML + gw, y2: Y(0), stroke: "#999", "stroke-dasharray": "4 3" }));
    svg.appendChild(svgEl("rect", { x: ML, y: MT, width: gw, height: gh, fill: "none", stroke: "#000" }));
    svg.appendChild(svgEl("text", { x: ML + gw / 2, y: MT + gh + 36, "text-anchor": "middle", "font-size": 12, fill: "#111" }, `PC${cx + 1} (${(P.ratio[cx] * 100).toFixed(1)}% variance)`));
    svg.appendChild(svgEl("text", { x: 14, y: MT + gh / 2, "text-anchor": "middle", "font-size": 12, fill: "#111", transform: `rotate(-90 14 ${MT + gh / 2})` }, `PC${cy + 1} (${(P.ratio[cy] * 100).toFixed(1)}% variance)`));
    svg.appendChild(svgEl("text", { x: ML, y: 22, "font-size": 14, "font-weight": 600, fill: "#111" }, "PCA biplot" + (showEll ? ` — ${nStd}σ covariance ellipses` : "")));
    // ellipses, points, centroids
    names.forEach((nm) => {
      const col = specColor(speciesIdx(nm));
      if (ells[nm])
        svg.appendChild(svgEl("path", { d: "M" + ells[nm].pts.map(([x, y]) => X(x).toFixed(1) + "," + Y(y).toFixed(1)).join("L") + "Z", fill: col, "fill-opacity": 0.16, stroke: col, "stroke-width": 1 }));
    });
    rows.forEach((o) => {
      const col = specColor(speciesIdx(o.s.species));
      const c = svgEl("circle", { cx: X(P.scores[o.i][cx]), cy: Y(P.scores[o.i][cy]), r: 4, fill: col, "fill-opacity": 0.75, stroke: "#fff", "stroke-width": 0.6 });
      c.appendChild(svgEl("title", {}, o.s.label + " — " + o.s.species));
      c.style.cursor = "pointer";
      c.addEventListener("click", () => {
        if (sa.pin2d.has(o.s.key)) sa.pin2d.delete(o.s.key);
        else sa.pin2d.add(o.s.key);
        drawPca2d();
      });
      svg.appendChild(c);
      if (sa.pin2d.has(o.s.key))
        svg.appendChild(
          svgEl("text", { x: X(P.scores[o.i][cx]) + 7, y: Y(P.scores[o.i][cy]) - 6, "font-size": 10, "font-weight": 600, fill: "#111", stroke: "#fff", "stroke-width": 3, "paint-order": "stroke" }, o.s.label),
        );
    });
    names.forEach((nm) => {
      const pp = pts(nm);
      const mx = mean(pp.map((q) => q[0])),
        my = mean(pp.map((q) => q[1]));
      const col = specColor(speciesIdx(nm));
      const x = X(mx),
        y = Y(my);
      svg.appendChild(svgEl("path", { d: `M${x - 6},${y - 6}L${x + 6},${y + 6}M${x - 6},${y + 6}L${x + 6},${y - 6}`, stroke: "#000", "stroke-width": 3.4 }));
      svg.appendChild(svgEl("path", { d: `M${x - 6},${y - 6}L${x + 6},${y + 6}M${x - 6},${y + 6}L${x + 6},${y - 6}`, stroke: col, "stroke-width": 1.8 }));
    });
    if (showLoad) {
      P.loadings.forEach((l, j) => {
        const x2 = X(l[cx] * loadScale),
          y2 = Y(l[cy] * loadScale);
        svg.appendChild(svgEl("line", { x1: X(0), y1: Y(0), x2, y2, stroke: "#222", "stroke-width": 1.2, "stroke-opacity": 0.7 }));
        const ang = Math.atan2(y2 - Y(0), x2 - X(0));
        svg.appendChild(svgEl("path", { d: `M${x2},${y2}L${x2 - 7 * Math.cos(ang - 0.4)},${y2 - 7 * Math.sin(ang - 0.4)}L${x2 - 7 * Math.cos(ang + 0.4)},${y2 - 7 * Math.sin(ang + 0.4)}Z`, fill: "#222", "fill-opacity": 0.7 }));
        const lbl = P.cols[j].f.col;
        const tx = X(l[cx] * loadScale * 1.12),
          ty = Y(l[cy] * loadScale * 1.12);
        svg.appendChild(svgEl("text", { x: tx, y: ty, "text-anchor": tx >= X(0) ? "start" : "end", "font-size": 10, "font-weight": 600, fill: "#111", stroke: "#fff", "stroke-width": 2.5, "paint-order": "stroke" }, lbl));
      });
    }
    legendInto(svg, ML + gw + 24, MT + 8, names);
    host.appendChild(svg);
  }


  // ── 3D view ───────────────────────────────────────────────────────
  // The scene is plain data (D) drawn by three self-contained functions that
  // use nothing from the rest of the module, so the very same code runs here
  // and, copied as text, inside the saved HTML page.
  function s3dProject(D, V, W, H) {
    const legW = D._legW || 0;
    const cyw = Math.cos(V.yaw),
      syw = Math.sin(V.yaw),
      cp = Math.cos(V.pitch),
      sp = Math.sin(V.pitch);
    const scale = (0.36 * Math.min(W - legW - 40, H) * V.zoom) / D.maxAbs;
    const cx = (W - legW) / 2,
      cy = H / 2;
    return {
      f: (x, y, z) => {
        const x1 = x * cyw - y * syw,
          y1 = x * syw + y * cyw;
        const y2 = y1 * cp - z * sp,
          z2 = y1 * sp + z * cp;
        return { sx: cx + x1 * scale, sy: cy - z2 * scale, d: y2 };
      },
    };
  }

  function s3dDraw(g, W, H, D, V, hoverKey, pins, showAll) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    // legend size first: the scene is centred in what is left
    g.font = "11px Arial";
    const perCol = 22;
    let tw = 0;
    D.legend.forEach((l) => (tw = Math.max(tw, g.measureText(l.name).width)));
    const colW = tw + 30;
    D._legW = D.legend.length ? Math.ceil(D.legend.length / perCol) * colW + 10 : 0;
    const f = s3dProject(D, V, W, H).f;
    const m = D.maxAbs * 1.08;
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(([ax, ay, az], i) => {
      const a = f(-ax * m, -ay * m, -az * m),
        b = f(ax * m, ay * m, az * m);
      g.strokeStyle = "#999";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a.sx, a.sy);
      g.lineTo(b.sx, b.sy);
      g.stroke();
      g.fillStyle = "#222";
      g.font = "12px Arial";
      g.fillText(D.axes[i], b.sx + 5, b.sy);
    });
    D.rings.forEach((r) => {
      g.strokeStyle = r.color;
      g.globalAlpha = 0.45;
      g.lineWidth = 1;
      r.loops.forEach((loop) => {
        g.beginPath();
        loop.forEach((p, k) => {
          const q = f(p[0], p[1], p[2]);
          if (k === 0) g.moveTo(q.sx, q.sy);
          else g.lineTo(q.sx, q.sy);
        });
        g.stroke();
      });
      g.globalAlpha = 1;
    });
    const items = [];
    D.points.forEach((p) => {
      const q = f(p.x, p.y, p.z);
      items.push({ d: q.d, kind: 0, sx: q.sx, sy: q.sy, col: p.color, key: p.key });
    });
    D.cent.forEach((c) => {
      const q = f(c.x, c.y, c.z);
      items.push({ d: q.d, kind: 1, sx: q.sx, sy: q.sy, col: c.color });
    });
    items.sort((a, b) => b.d - a.d); // far first
    items.forEach((o) => {
      if (o.kind === 0) {
        const on = o.key === hoverKey || pins.has(o.key);
        g.fillStyle = o.col;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(o.sx, o.sy, on ? 6 : 4, 0, 2 * Math.PI);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = on ? "#000" : "#fff";
        g.lineWidth = on ? 1.6 : 0.6;
        g.stroke();
      } else {
        g.strokeStyle = "#000";
        g.lineWidth = 3.4;
        g.beginPath();
        g.moveTo(o.sx - 6, o.sy - 6);
        g.lineTo(o.sx + 6, o.sy + 6);
        g.moveTo(o.sx - 6, o.sy + 6);
        g.lineTo(o.sx + 6, o.sy - 6);
        g.stroke();
        g.strokeStyle = o.col;
        g.lineWidth = 1.8;
        g.stroke();
      }
    });
    // recording IDs: all of them, or the ones clicked
    g.font = "11px Arial";
    D.points.forEach((p) => {
      if (!showAll && !pins.has(p.key)) return;
      const q = f(p.x, p.y, p.z);
      g.lineWidth = 3;
      g.strokeStyle = "#fff";
      g.strokeText(p.label, q.sx + 8, q.sy - 6);
      g.fillStyle = "#111";
      g.fillText(p.label, q.sx + 8, q.sy - 6);
    });
    // tooltip for the point under the cursor
    const hp = hoverKey != null ? D.points.find((p) => p.key === hoverKey) : null;
    if (hp) {
      const q = f(hp.x, hp.y, hp.z);
      const lines = [hp.label, hp.sp];
      if (hp.key !== hp.label) lines.push(hp.key);
      let bw = 0;
      lines.forEach((t) => (bw = Math.max(bw, g.measureText(t).width)));
      bw += 14;
      const bh = lines.length * 15 + 8;
      let bx = q.sx + 12,
        by = q.sy - bh - 8;
      if (bx + bw > W - D._legW) bx = q.sx - 12 - bw;
      if (by < 4) by = q.sy + 12;
      g.fillStyle = "rgba(255,255,255,0.96)";
      g.strokeStyle = "#555";
      g.lineWidth = 1;
      g.fillRect(bx, by, bw, bh);
      g.strokeRect(bx, by, bw, bh);
      g.fillStyle = "#111";
      lines.forEach((t, i) => {
        g.font = i === 0 ? "bold 11px Arial" : "11px Arial";
        g.fillText(t, bx + 7, by + 15 + i * 15);
      });
    }
    // legend
    g.font = "11px Arial";
    D.legend.forEach((l, i) => {
      const x = W - D._legW + Math.floor(i / perCol) * colW,
        y = 20 + (i % perCol) * 17;
      g.fillStyle = l.color;
      g.fillRect(x, y - 9, 10, 10);
      g.fillStyle = "#222";
      g.fillText(l.name, x + 15, y);
    });
    g.fillStyle = "#777";
    g.fillText("drag to rotate · wheel to zoom · hover or click a point for its recording ID", 10, H - 8);
  }

  // index of the point nearest (mx, my) within 9 px, preferring the one in front
  function s3dHit(D, V, W, H, mx, my) {
    const f = s3dProject(D, V, W, H).f;
    let best = -1,
      bd = 81,
      bz = Infinity;
    D.points.forEach((p, i) => {
      const q = f(p.x, p.y, p.z);
      const dd = (q.sx - mx) * (q.sx - mx) + (q.sy - my) * (q.sy - my);
      if (dd < 81 && (dd < bd - 9 || (dd < bd + 9 && q.d < bz))) {
        best = i;
        bd = dd;
        bz = q.d;
      }
    });
    return best;
  }

  function build3dData() {
    const P = sa.pca;
    if (!P || P.kPC < 3) return null;
    const rows = shown();
    if (!rows.length) return null;
    const names = [...new Set(rows.map((o) => o.s.species))];
    const D = { points: [], cent: [], rings: [], legend: [], axes: [], maxAbs: 1e-9 };
    rows.forEach((o) => {
      const sc = P.scores[o.i];
      D.points.push({ x: sc[0], y: sc[1], z: sc[2], sp: o.s.species, label: o.s.label, key: o.s.key, color: specColor(speciesIdx(o.s.species)) });
      sc.slice(0, 3).forEach((v) => (D.maxAbs = Math.max(D.maxAbs, Math.abs(v))));
    });
    names.forEach((nm) => {
      const col = specColor(speciesIdx(nm));
      D.legend.push({ name: nm, color: col });
      const pts = rows.filter((o) => o.s.species === nm).map((o) => P.scores[o.i].slice(0, 3));
      if (pts.length < 2) return;
      const mu = [0, 1, 2].map((c) => mean(pts.map((p) => p[c])));
      D.cent.push({ x: mu[0], y: mu[1], z: mu[2], color: col });
      if (pts.length < 4) return;
      const C = [0, 1, 2].map((a) => [0, 1, 2].map((b) => pts.reduce((s, p) => s + (p[a] - mu[a]) * (p[b] - mu[b]), 0) / (pts.length - 1)));
      const e = jacobiEigen(C, 3);
      const loops = [[0, 1], [0, 2], [1, 2]].map(([i1, i2]) => {
        const loop = [];
        for (let t = 0; t <= 48; t++) {
          const a = (t / 48) * 2 * Math.PI;
          const r1 = 1.5 * Math.sqrt(Math.max(0, e.values[i1])) * Math.cos(a),
            r2 = 1.5 * Math.sqrt(Math.max(0, e.values[i2])) * Math.sin(a);
          loop.push([0, 1, 2].map((k) => mu[k] + r1 * e.vectors[k][i1] + r2 * e.vectors[k][i2]));
        }
        return loop;
      });
      D.rings.push({ color: col, loops });
    });
    D.axes = [0, 1, 2].map((i) => "PC" + (i + 1) + " (" + (P.ratio[i] * 100).toFixed(0) + "%)");
    return D;
  }

  function drawPca3d() {
    const cv = $("saPca3d");
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 640,
      H = 520;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.height = H + "px";
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const D = build3dData();
    sa.d3 = D;
    if (!D) {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#555";
      g.font = "13px Arial";
      g.fillText(sa.pca && sa.pca.kPC < 3 ? "The 3D view needs at least 3 variables (3 principal components)." : "Tick at least one species.", 20, 30);
      return;
    }
    s3dDraw(g, W, H, D, sa.view3d, sa.hover3d, sa.pin3d, $("saShowIds")?.checked);
  }

  function attach3d() {
    const cv = $("saPca3d");
    if (!cv || cv._saWired) return;
    cv._saWired = true;
    let drag = null;
    cv.style.cursor = "grab";
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const hit = (e) => {
      if (!sa.d3) return -1;
      const [mx, my] = pos(e);
      return s3dHit(sa.d3, sa.view3d, cv.clientWidth, 520, mx, my);
    };
    cv.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: sa.view3d.yaw, pitch: sa.view3d.pitch, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (drag) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
        if (!drag.moved) return;
        cv.style.cursor = "grabbing";
        sa.view3d.yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
        sa.view3d.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * 0.01));
        if (sa.pca) drawPca3d();
        return;
      }
      const i = hit(e);
      const key = i >= 0 ? sa.d3.points[i].key : null;
      cv.style.cursor = i >= 0 ? "pointer" : "grab";
      if (key !== sa.hover3d) {
        sa.hover3d = key;
        if (sa.pca) drawPca3d();
      }
    });
    cv.addEventListener("pointerup", (e) => {
      const d = drag;
      drag = null;
      cv.style.cursor = "grab";
      if (d && !d.moved) {
        const i = hit(e);
        if (i >= 0) {
          const k = sa.d3.points[i].key;
          if (sa.pin3d.has(k)) sa.pin3d.delete(k);
          else sa.pin3d.add(k);
          drawPca3d();
        }
      }
    });
    cv.addEventListener("pointercancel", () => (drag = null));
    cv.addEventListener("pointerleave", () => {
      if (sa.hover3d != null) {
        sa.hover3d = null;
        if (sa.pca) drawPca3d();
      }
    });
    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        sa.view3d.zoom = Math.max(0.4, Math.min(3, sa.view3d.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
        if (sa.pca) drawPca3d();
      },
      { passive: false },
    );
  }
  function saReset3d() {
    sa.view3d = { yaw: -0.7, pitch: 0.4, zoom: 1 };
    if (sa.pca) drawPca3d();
  }
  function saClear3dIds() {
    sa.pin3d.clear();
    if ($("saShowIds")) $("saShowIds").checked = false;
    if (sa.pca) drawPca3d();
  }

  // The 3D plot as one self-contained .html page: no libraries, no network.
  // It carries the data and the same drawing functions, and offers the same
  // rotate / zoom / hover / click.
  async function saSave3dHtml() {
    const D = build3dData();
    if (!D) {
      say("Run the analysis first (the 3D view needs at least 3 variables).", true);
      return;
    }
    const fns = [s3dProject, s3dDraw, s3dHit].map((fn) => fn.toString()).join("\n\n");
    const data = JSON.stringify(D).replace(/</g, "\\u003c");
    const boot = [
      "var V={yaw:" + sa.view3d.yaw + ",pitch:" + sa.view3d.pitch + ",zoom:" + sa.view3d.zoom + "};",
      'var cv=document.getElementById("c"),hover=null,pins=new Set(),showAll=false;',
      "function draw(){var dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;",
      " cv.width=W*dpr;cv.height=H*dpr;var g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);s3dDraw(g,W,H,D,V,hover,pins,showAll);}",
      "function hit(e){var r=cv.getBoundingClientRect();return s3dHit(D,V,cv.clientWidth,cv.clientHeight,e.clientX-r.left,e.clientY-r.top);}",
      "var drag=null;",
      "cv.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY,yaw:V.yaw,pitch:V.pitch,moved:false};cv.setPointerCapture(e.pointerId);});",
      "cv.addEventListener('pointermove',function(e){",
      " if(drag){if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4)drag.moved=true;if(!drag.moved)return;",
      "  V.yaw=drag.yaw+(e.clientX-drag.x)*0.01;V.pitch=Math.max(-1.5,Math.min(1.5,drag.pitch+(e.clientY-drag.y)*0.01));draw();return;}",
      " var i=hit(e),k=i>=0?D.points[i].key:null;cv.style.cursor=i>=0?'pointer':'grab';if(k!==hover){hover=k;draw();}});",
      "cv.addEventListener('pointerup',function(e){var d=drag;drag=null;if(d&&!d.moved){var i=hit(e);if(i>=0){var k=D.points[i].key;if(pins.has(k))pins.delete(k);else pins.add(k);draw();}}});",
      "cv.addEventListener('pointerleave',function(){if(hover!==null){hover=null;draw();}});",
      "cv.addEventListener('wheel',function(e){e.preventDefault();V.zoom=Math.max(0.4,Math.min(3,V.zoom*(e.deltaY>0?0.92:1.08)));draw();},{passive:false});",
      "document.getElementById('ids').onchange=function(){showAll=this.checked;draw();};",
      "document.getElementById('clr').onclick=function(){pins.clear();document.getElementById('ids').checked=false;showAll=false;draw();};",
      "window.addEventListener('resize',draw);draw();",
    ].join("\n");
    const page = [
      "<!doctype html>",
      '<html><head><meta charset="utf-8"><title>3D PCA — Rthoptera Desk</title>',
      "<style>body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#222}#bar{padding:6px 10px;border-bottom:1px solid #ddd;font-size:13px}",
      "#c{display:block;width:100%;height:calc(100vh - 36px);cursor:grab;touch-action:none}</style></head><body>",
      '<div id="bar"><b>3D PCA</b> &nbsp; <label><input type="checkbox" id="ids"> show all recording IDs</label> &nbsp; <button id="clr">clear labels</button></div>',
      '<canvas id="c"></canvas>',
      "<script>",
      fns,
      "var D=" + data + ";",
      boot,
      "</script></body></html>",
    ].join("\n");
    await dlFile("pca_3d.html", page, "text/html", { exactName: true });
    say("3D PCA saved as a standalone HTML page.");
  }

  // ── Radar: min-max scaled metrics, species mean ± 1 SD ─────────────
  function drawRadar() {
    const host = $("saRadarFig");
    if (!host) return;
    host.innerHTML = "";
    const P = sa.pca;
    const m = P.cols.length;
    if (m < 3) {
      host.textContent = "The radar plot needs at least 3 variables.";
      return;
    }
    const rows = shown();
    if (!rows.length) {
      host.textContent = "Tick at least one species.";
      return;
    }
    const names = [...new Set(rows.map((o) => o.s.species))];
    // min-max per variable across ALL observations, so a species keeps the
    // same shape whichever others are on screen
    const mm = P.cols.map((c) => {
      const lo = Math.min(...c.raw),
        hi = Math.max(...c.raw);
      return { lo, span: hi - lo || 1 };
    });
    const scaled = (i, j) => (P.cols[j].raw[i] - mm[j].lo) / mm[j].span;
    const R = 220,
      CX = 330,
      CY = 290,
      W = CX + R + 150 + Math.ceil(names.length / 16) * legendCol(names),
      H = CY + R + 70;
    const svg = svgEl("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: "background:#fff;display:block;max-width:100%;height:auto", "font-family": "Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("text", { x: 20, y: 26, "font-size": 14, "font-weight": 600, fill: "#111" }, "Normalised profiles (min–max scaled, mean ± 1 SD)"));
    const ang = (j) => -Math.PI / 2 + (j / m) * 2 * Math.PI;
    const pt = (j, r) => [CX + r * R * Math.cos(ang(j)), CY + r * R * Math.sin(ang(j))];
    [0.2, 0.4, 0.6, 0.8, 1].forEach((r) => {
      svg.appendChild(svgEl("path", { d: "M" + P.cols.map((_, j) => pt(j, r).map((v) => v.toFixed(1)).join(",")).join("L") + "Z", fill: "none", stroke: r === 1 ? "#999" : "#ddd" }));
      svg.appendChild(svgEl("text", { x: CX + 3, y: CY - r * R + 11, "font-size": 9, fill: "#888" }, String(r)));
    });
    P.cols.forEach((c, j) => {
      const [x, y] = pt(j, 1);
      svg.appendChild(svgEl("line", { x1: CX, y1: CY, x2: x, y2: y, stroke: "#ccc" }));
      const [lx, ly] = pt(j, 1.08);
      const cosA = Math.cos(ang(j));
      svg.appendChild(svgEl("text", { x: lx, y: ly + 4, "text-anchor": Math.abs(cosA) < 0.2 ? "middle" : cosA > 0 ? "start" : "end", "font-size": 11, "font-weight": 600, fill: "#111" }, c.f.col));
    });
    names.forEach((nm) => {
      const idx = rows.filter((o) => o.s.species === nm).map((o) => o.i);
      const col = specColor(speciesIdx(nm));
      const mu = P.cols.map((_, j) => mean(idx.map((i) => scaled(i, j))));
      const sd = P.cols.map((_, j) => sdev(idx.map((i) => scaled(i, j))));
      const up = mu.map((v, j) => Math.min(1, v + sd[j])),
        lo = mu.map((v, j) => Math.max(0, v - sd[j]));
      const loop = (arr) => "M" + arr.map((v, j) => pt(j, v).map((q) => q.toFixed(1)).join(",")).join("L") + "Z";
      if (idx.length > 1)
        svg.appendChild(svgEl("path", { d: loop(up) + loop(lo), fill: col, "fill-opacity": 0.16, "fill-rule": "evenodd", stroke: "none" }));
      svg.appendChild(svgEl("path", { d: loop(mu), fill: "none", stroke: col, "stroke-width": 2.4, "stroke-linejoin": "round" }));
    });
    legendInto(svg, CX + R + 140, 70, names);
    host.appendChild(svg);
  }


  // ── Editing names ─────────────────────────────────────────────────
  function relabelAndRefresh() {
    const prev = new Map(sa.samples.map((s) => [s.key, s.species]));
    applyLabels();
    const sel = new Set();
    sa.samples.forEach((s) => {
      if (sa.selSp.has(prev.get(s.key))) sel.add(s.species);
    });
    sa.species = [...new Set(sa.samples.map((s) => s.species))];
    sa.selSp = sel.size ? sel : new Set(sa.species);
    renderLists();
    renderNames();
    renderCmpList();
    refreshTemp();
    if (sa.pca) drawAll();
  }
  function setMap(map, key, value, dflt) {
    const v = String(value || "").trim();
    if (!v || v === dflt) map.delete(key);
    else map.set(key, v);
  }
  function saEditSpecies(base, value) {
    setMap(lab.sp, base, value, base);
    relabelAndRefresh();
  }
  function saEditObs(key, value) {
    setMap(lab.obs, key, value, key);
    relabelAndRefresh();
  }
  function saEditObsSpecies(key, value) {
    const s = sa.samples.find((o) => o.key === key);
    setMap(lab.obsSp, key, value, s ? s.raw : "");
    relabelAndRefresh();
  }

  function renderNames() {
    const host = $("saNamesOut");
    if (!host) return;
    if (!sa.samples.length) {
      host.textContent = "Nothing loaded yet.";
      return;
    }
    const bases = [...new Set(sa.samples.map((s) => s.base))];
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const inp = (val, fn, extra) =>
      '<input type="text" value="' + esc(val) + '" ' + (extra || "") + ' style="width:100%;font-size:11px" onchange="' + fn + '">';
    host.innerHTML =
      '<datalist id="saSpNames">' + [...new Set(sa.samples.map((s) => s.species))].map((n) => '<option value="' + esc(n) + '">').join("") + "</datalist>" +
      '<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:1 1 280px"><div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:3px">Species names <span style="font-weight:400">(use the same name twice to merge)</span></div>' +
      '<table class="dtable" style="width:100%"><thead><tr><th>In the data</th><th>Shown as</th></tr></thead><tbody>' +
      bases.map((b, i) => "<tr><td>" + esc(b) + '</td><td data-sp="' + i + '">' + inp(lab.sp.get(b) || b, "saEditSpecies(window._saBases[" + i + "], this.value)") + "</td></tr>").join("") +
      '</tbody></table></div><div style="flex:2 1 420px"><div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:3px">Recordings <span style="font-weight:400">(a different species here re-assigns that recording)</span></div>' +
      '<div style="max-height:260px;overflow:auto"><table class="dtable" style="width:100%"><thead><tr><th>Recording</th><th>Name</th><th>Species</th></tr></thead><tbody>' +
      sa.samples
        .map(
          (s, i) =>
            "<tr><td>" + esc(s.key) + "</td><td>" + inp(s.label, "saEditObs(window._saKeys[" + i + "], this.value)") + "</td><td>" +
            inp(s.base, "saEditObsSpecies(window._saKeys[" + i + "], this.value)", 'list="saSpNames"') + "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></div></div>";
    window._saBases = bases;
    window._saKeys = sa.samples.map((s) => s.key);
  }



  // ── Start again ───────────────────────────────────────────────────
  // Forgets every choice and result of this tab (variables, species, edited
  // names, temperature settings, plots, tests, profiles, loaded knowledge
  // base) and rebuilds the lists from the merged data with the defaults. The
  // merged data themselves stay: clear those on the Summary tab.
  function saResetAll() {
    if (
      !confirm(
        "Reset the Summary Analysis?\n\nThis clears your variable and species choices, edited names, temperature settings, plots, test results and any loaded knowledge base. The merged data stay.",
      )
    )
      return;
    lab.obs.clear();
    lab.obsSp.clear();
    lab.sp.clear();
    sa.selFeat = new Set();
    sa.selSp = new Set();
    sa.pca = null;
    sa.rel = null;
    sa.view3d = { yaw: -0.7, pitch: 0.4, zoom: 1 };
    sa.hover3d = null;
    sa.pin3d.clear();
    sa.pin2d.clear();
    sa.d3 = null;
    cmpSel.clear();
    Object.assign(sa.temp, { on: false, ref: 25, onlySig: true, fit: null });
    const set = (id, fn) => $(id) && fn($(id));
    set("saUnit", (e) => (e.value = "recording"));
    set("saTempOn", (e) => (e.checked = false));
    set("saTempRef", (e) => {
      e.value = "25";
      delete e.dataset.touched;
    });
    set("saTempSig", (e) => (e.checked = true));
    set("saEllipse", (e) => (e.checked = true));
    set("saLoadings", (e) => (e.checked = true));
    set("saSigma", (e) => (e.value = "2"));
    set("saCvLeave", (e) => (e.value = "recording"));
    set("saShowIds", (e) => (e.checked = false));
    ["saPcX", "saPcY"].forEach((id) => set(id, (e) => (e.innerHTML = "")));
    ["saPcaFig", "saRadarFig", "saRelFig", "saRecTable", "saRecFig"].forEach((id) => set(id, (e) => (e.innerHTML = "")));
    set("saCvOut", (e) => (e.textContent = "Not run yet."));
    const cv = $("saPca3d");
    if (cv) {
      const g = cv.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, cv.width, cv.height);
    }
    if (typeof window.saKbReset === "function") window.saKbReset();
    saScan();
    say("Summary Analysis reset. " + (sa.samples.length ? "Lists rebuilt from the merged data." : ""));
  }

  // ── Settings as a JSON file ───────────────────────────────────────
  // Everything chosen in this tab — the unit, the ticked variables and
  // species, every edited name, the plot options and the items picked for
  // comparison — so an analysis can be set up again on the same or a later
  // merge of the data. Names are matched by recording file name and species.
  const SETTINGS_KIND = "rthoptera-summary-analysis-settings";
  const OPT_IDS = ["saPcX", "saPcY", "saSigma", "saCvLeave"];
  const OPT_CHECKS = ["saEllipse", "saLoadings"];

  async function saSettingsSave() {
    const obj = {
      kind: SETTINGS_KIND,
      version: 1,
      saved: new Date().toISOString(),
      unit: $("saUnit") ? $("saUnit").value : "recording",
      variables: [...sa.selFeat],
      speciesShown: [...sa.selSp],
      names: {
        species: Object.fromEntries(lab.sp),
        recordings: Object.fromEntries(lab.obs),
        recordingSpecies: Object.fromEntries(lab.obsSp),
      },
      options: Object.fromEntries(OPT_IDS.filter((i) => $(i)).map((i) => [i, $(i).value])),
      checks: Object.fromEntries(OPT_CHECKS.filter((i) => $(i)).map((i) => [i, $(i).checked])),
      compare: [...cmpSel],
      temperature: { on: sa.temp.on, ref: sa.temp.ref, onlySignificant: sa.temp.onlySig },
    };
    await dlFile("summary_analysis_settings.json", JSON.stringify(obj, null, 1), "application/json", { exactName: true });
    say("Settings saved (" + obj.variables.length + " variables, " + Object.keys(obj.names.recordings).length + " recording names, " + Object.keys(obj.names.species).length + " species names).");
  }

  async function saSettingsLoad(file) {
    if (!file) return;
    let d;
    try {
      d = JSON.parse(await file.text());
      if (d.kind !== SETTINGS_KIND) throw new Error("not a Summary Analysis settings file");
    } catch (e) {
      say("Could not read that settings file: " + e.message, true);
      return;
    }
    const toMap = (o) => new Map(Object.entries(o || {}));
    lab.sp = toMap(d.names && d.names.species);
    lab.obs = toMap(d.names && d.names.recordings);
    lab.obsSp = toMap(d.names && d.names.recordingSpecies);
    if ($("saUnit") && d.unit) $("saUnit").value = d.unit;
    sa.selFeat = new Set(d.variables || []);
    sa.selSp = new Set(d.speciesShown || []);
    cmpSel.clear();
    (d.compare || []).forEach((i) => cmpSel.add(i));
    Object.keys(d.checks || {}).forEach((i) => $(i) && ($(i).checked = !!d.checks[i]));
    if (d.options && d.options.saSigma && $("saSigma")) $("saSigma").value = d.options.saSigma;
    if (d.options && d.options.saCvLeave && $("saCvLeave")) $("saCvLeave").value = d.options.saCvLeave;
    if (d.temperature) {
      sa.temp.on = !!d.temperature.on;
      if (isFinite(d.temperature.ref)) sa.temp.ref = d.temperature.ref;
      sa.temp.onlySig = d.temperature.onlySignificant !== false;
      if ($("saTempOn")) $("saTempOn").checked = sa.temp.on;
      if ($("saTempRef")) {
        $("saTempRef").value = String(sa.temp.ref);
        $("saTempRef").dataset.touched = "1";
      }
      if ($("saTempSig")) $("saTempSig").checked = sa.temp.onlySig;
    }
    saScan();
    // The axis choices only exist once a PCA has been run.
    if (sa.pca && d.options) {
      ["saPcX", "saPcY"].forEach((i) => d.options[i] != null && $(i) && ($(i).value = d.options[i]));
      drawAll();
    }
    say("Settings loaded from " + file.name + ".");
  }

  // ── Compare recordings or species (works with just two) ────────────
  // Scales every variable as value / the largest of the chosen items, so the
  // shapes are comparable without needing a population to take a range from.
  const cmpSel = new Set(); // "r:<key>" or "s:<species>"

  function cmpItems() {
    const items = [];
    sa.species.forEach((nm) => {
      const rows = sa.samples.filter((s) => s.species === nm);
      items.push({ id: "s:" + nm, label: nm + " — species mean (" + rows.length + ")", short: nm, samples: rows });
    });
    sa.samples.forEach((s) => items.push({ id: "r:" + s.key, label: s.label + " (" + s.species + ")", short: s.label, samples: [s] }));
    return items;
  }

  function renderCmpList() {
    const host = $("saCmpPick");
    if (!host) return;
    host.innerHTML = "";
    const items = cmpItems();
    const ids = new Set(items.map((i) => i.id));
    [...cmpSel].forEach((i) => ids.has(i) || cmpSel.delete(i));
    let lastKind = "";
    items.forEach((it) => {
      const kind = it.id[0];
      if (kind !== lastKind) {
        lastKind = kind;
        const h = document.createElement("div");
        h.style.cssText = "grid-column:1/-1;font-size:10px;font-weight:600;color:var(--txt3);margin-top:4px";
        h.textContent = kind === "s" ? "Species (mean of their recordings)" : "Recordings";
        host.appendChild(h);
      }
      const lab2 = document.createElement("label");
      lab2.className = "chk";
      lab2.style.cssText = "font-size:11px;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = cmpSel.has(it.id);
      cb.onchange = () => {
        if (cb.checked) {
          if (cmpSel.size >= 6) {
            cb.checked = false;
            say("Pick at most 6 to compare.", true);
            return;
          }
          cmpSel.add(it.id);
        } else cmpSel.delete(it.id);
      };
      lab2.appendChild(cb);
      lab2.append(" " + it.label);
      host.appendChild(lab2);
    });
  }

  function saRecCompare() {
    const items = cmpItems().filter((i) => cmpSel.has(i.id));
    const figHost = $("saRecFig"),
      tbl = $("saRecTable");
    if (items.length < 2) {
      say("Tick at least 2 recordings or species to compare.", true);
      return;
    }
    const feats = sa.features.filter(
      (f) => sa.selFeat.has(f.id) && items.every((it) => it.samples.some((s) => f.id in s.vals)),
    );
    if (!feats.length) {
      say("None of the selected variables has a value for every chosen item.", true);
      return;
    }
    const stat = (it, f) => {
      const v = it.samples.filter((s) => f.id in s.vals).map((s) => valOf(s, f.id));
      return { m: mean(v), sd: v.length > 1 ? sdev(v) : null };
    };
    const data = feats.map((f) => items.map((it) => stat(it, f)));
    // table
    const fmt = (v) => (v == null ? "—" : String(+Number(v).toPrecision(4)));
    const ratioHead = items.length === 2 ? "<th>" + items[1].short + " ÷ " + items[0].short + "</th>" : "<th>largest ÷ smallest</th>";
    tbl.innerHTML =
      '<table class="dtable"><thead><tr><th>Variable</th>' + items.map((it) => "<th>" + it.short + "</th>").join("") + ratioHead + "</tr></thead><tbody>" +
      feats
        .map((f, j) => {
          const ms = data[j].map((d) => d.m);
          let r;
          if (items.length === 2) r = ms[0] !== 0 ? ms[1] / ms[0] : null;
          else {
            const mx = Math.max(...ms.map(Math.abs)),
              mn = Math.min(...ms.map(Math.abs));
            r = mn > 0 ? mx / mn : null;
          }
          return "<tr><td>" + f.label + "</td>" + data[j].map((d) => "<td>" + fmt(d.m) + (d.sd != null ? " ± " + fmt(d.sd) : "") + "</td>").join("") + "<td>" + (r == null ? "—" : fmt(r) + "×") + "</td></tr>";
        })
        .join("") +
      "</tbody></table>";
    // radar
    figHost.innerHTML = "";
    if (feats.length < 3) {
      figHost.textContent = "The radar needs at least 3 variables with values for every chosen item (the table above still shows the numbers).";
      return;
    }
    const anyNeg = data.some((row) => row.some((d) => d.m < 0));
    const scale = feats.map((_, j) => {
      const ms = data[j].map((d) => d.m);
      if (anyNeg) {
        const lo = Math.min(...ms),
          hi = Math.max(...ms);
        return (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
      }
      const mx = Math.max(...ms) || 1;
      return (v) => v / mx;
    });
    figHost.appendChild(
      radarSvg({
        title: "Comparison (" + (anyNeg ? "min–max scaled" : "each variable as a share of the largest value") + ")",
        axes: feats.map((f) => f.col),
        series: items.map((it, i) => ({
          label: it.short,
          color: specColor(i),
          values: feats.map((_, j) => scale[j](data[j][i].m)),
          lo: it.samples.length > 1 ? feats.map((_, j) => scale[j](data[j][i].m - (data[j][i].sd || 0))) : null,
          hi: it.samples.length > 1 ? feats.map((_, j) => scale[j](data[j][i].m + (data[j][i].sd || 0))) : null,
        })),
      }),
    );
    say("Compared " + items.length + " item(s) on " + feats.length + " variable(s).");
  }

  // A small general radar: axes [labels], series [{label,color,values 0..1,lo?,hi?}].
  function radarSvg({ title, axes, series }) {
    const m = axes.length;
    const R = 210,
      CX = 320,
      CY = 280,
      W = CX + R + 140 + 6.4 * Math.max(0, ...series.map((q) => q.label.length)),
      H = CY + R + 60;
    const svg = svgEl("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: "background:#fff;display:block;max-width:100%;height:auto", "font-family": "Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("text", { x: 20, y: 26, "font-size": 14, "font-weight": 600, fill: "#111" }, title));
    const ang = (k) => -Math.PI / 2 + (k / m) * 2 * Math.PI;
    const pt = (k, v) => [CX + v * R * Math.cos(ang(k)), CY + v * R * Math.sin(ang(k))];
    const loop = (arr) => "M" + arr.map((v, k) => pt(k, Math.max(0, Math.min(1.05, v))).map((q) => q.toFixed(1)).join(",")).join("L") + "Z";
    [0.2, 0.4, 0.6, 0.8, 1].forEach((v) => {
      svg.appendChild(svgEl("path", { d: loop(axes.map(() => v)), fill: "none", stroke: v === 1 ? "#999" : "#ddd" }));
      svg.appendChild(svgEl("text", { x: CX + 3, y: CY - v * R + 11, "font-size": 9, fill: "#888" }, String(v)));
    });
    axes.forEach((a, k) => {
      const [x, y] = pt(k, 1);
      svg.appendChild(svgEl("line", { x1: CX, y1: CY, x2: x, y2: y, stroke: "#ccc" }));
      const [lx, ly] = pt(k, 1.09);
      const c = Math.cos(ang(k));
      svg.appendChild(svgEl("text", { x: lx, y: ly + 4, "text-anchor": Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end", "font-size": 11, "font-weight": 600, fill: "#111" }, a));
    });
    series.forEach((s) => {
      if (s.lo && s.hi) svg.appendChild(svgEl("path", { d: loop(s.hi) + loop(s.lo), fill: s.color, "fill-opacity": 0.16, "fill-rule": "evenodd", stroke: "none" }));
      svg.appendChild(svgEl("path", { d: loop(s.values), fill: "none", stroke: s.color, "stroke-width": 2.4, "stroke-linejoin": "round" }));
    });
    series.forEach((s, i) => {
      const y = 70 + i * 18;
      svg.appendChild(svgEl("rect", { x: CX + R + 110, y: y - 9, width: 14, height: 10, fill: s.color, "fill-opacity": 0.85 }));
      svg.appendChild(svgEl("text", { x: CX + R + 130, y, "font-size": 11, fill: "#222" }, s.label));
    });
    return svg;
  }

  // ── Variable relevance ────────────────────────────────────────────
  function tempCells(id) {
    if (!sa.temp.fit) return "";
    const f = sa.temp.fit.get(id);
    if (!f) return "<td>—</td><td>—</td>";
    const star = f.p < 0.05 ? "*" : "";
    return "<td" + (f.p < 0.05 ? ' style="font-weight:600"' : "") + ">" + f.r2.toFixed(2) + star + "</td><td>" + (+f.b.toPrecision(3)) + "</td>";
  }
  function drawRelevance() {
    const host = $("saRelFig");
    if (!host) return;
    const rel = sa.rel || [];
    const k = new Set(sa.samples.map((s) => s.species)).size;
    if (k < 2) {
      host.textContent = "Relevance needs observations from at least 2 species (species tags).";
      return;
    }
    const maxEta = Math.max(...rel.map((r) => r.eta2), 1e-9);
    host.innerHTML =
      '<table class="dtable" style="width:100%"><thead><tr><th>#</th><th>Variable</th><th>η² (species)</th><th></th><th>F</th>' + (sa.temp.fit ? '<th title="Share of the variance, within species, explained by temperature (and the slope per °C)">Temp. R²</th><th>slope /°C</th>' : "") + '</tr></thead><tbody>' +
      rel
        .map(
          (r, i) =>
            "<tr><td>" + (i + 1) + "</td><td>" + r.label + "</td><td>" + r.eta2.toFixed(3) + '</td><td style="width:40%"><div style="height:8px;border-radius:3px;background:#2d6cdf;width:' + ((r.eta2 / maxEta) * 100).toFixed(0) + '%"></div></td><td>' + (r.F == null ? "—" : r.F.toFixed(1)) + "</td>" + tempCells(r.id) + "</tr>",
        )
        .join("") +
      "</tbody></table>";
  }

  // ── Export ────────────────────────────────────────────────────────
  function serialize(host) {
    const svg = host.querySelector("svg");
    return svg ? new XMLSerializer().serializeToString(svg) : null;
  }
  async function saveSvg(hostId, name) {
    const host = $(hostId);
    const txt = host && serialize(host);
    if (!txt) return;
    await dlFile(name + ".svg", txt, "image/svg+xml", { exactName: true });
  }
  async function savePng(hostId, name) {
    const host = $(hostId);
    const txt = host && serialize(host);
    if (!txt) return;
    const svg = host.querySelector("svg");
    const vb = svg.viewBox.baseVal;
    const url = URL.createObjectURL(new Blob([txt], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = vb.width * 3;
      c.height = vb.height * 3;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(async (b) => {
        await dlFile(name + ".png", new Uint8Array(await b.arrayBuffer()), "image/png", { exactName: true });
      }, "image/png");
    };
    img.src = url;
  }
  function saveCanvasPng(name) {
    const cv = $("saPca3d");
    if (!cv) return;
    cv.toBlob(async (b) => {
      await dlFile(name + ".png", new Uint8Array(await b.arrayBuffer()), "image/png", { exactName: true });
    }, "image/png");
  }
  async function saveCsv() {
    if (!sa.pca) return;
    const P = sa.pca;
    const head = ["observation", "source_key", "species", "n_rows", "temp_c"]
      .concat(P.scores[0].map((_, i) => "PC" + (i + 1)))
      .concat(P.cols.map((c) => c.f.label));
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    let csv = head.map(q).join(",") + "\n";
    sa.samples.forEach((s, i) => {
      csv += [q(s.label), q(s.key), q(s.species), s.n, s.temp == null ? "" : s.temp.toFixed(2)]
        .concat(P.scores[i].map((v) => v.toFixed(5)))
        .concat(P.cols.map((c) => c.raw[i].toFixed(6)))
        .join(",") + "\n";
    });
    csv += "\n" + ["variable", "loading_PC1", "loading_PC2", "loading_PC3", "eta2", "F"].map(q).join(",") + "\n";
    const relBy = new Map((sa.rel || []).map((r) => [r.label, r]));
    P.cols.forEach((c, j) => {
      const r = relBy.get(c.f.label);
      csv += [q(c.f.label)]
        .concat(P.loadings[j].map((v) => v.toFixed(5)))
        .concat(r ? [r.eta2.toFixed(5), r.F == null ? "" : r.F.toFixed(3)] : ["", ""])
        .join(",") + "\n";
    });
    await dlFile("summary_analysis.csv", csv, "text/csv", { exactName: true });
  }

  window.addEventListener("resize", () => {
    const v = $("summPaneAnalysis");
    if (v && v.offsetParent !== null && sa.pca) drawPca3d();
  });
  window.addEventListener("load", attach3d);

  // The selected variables as a matrix, one row per observation, a missing
  // value replaced by that variable's mean. Variables with fewer than 3
  // values are left out.
  function buildMatrix() {
    const feats = [];
    const cols = [];
    sa.features
      .filter((f) => sa.selFeat.has(f.id))
      .forEach((f) => {
        const vals = sa.samples.map((s) => valOf(s, f.id));
        const ok = vals.filter((v) => v != null);
        if (ok.length < 3) return;
        const m = mean(ok);
        feats.push(f);
        cols.push(vals.map((v) => (v == null ? m : v)));
      });
    return { feats, X: sa.samples.map((_, i) => cols.map((c) => c[i])) };
  }
  window.saInternals = { lab, sa, tempRule, adjustedVal, buildMatrix, specColor, svgEl, mean, sdev, say, num, saveSvg, savePng, legendInto };

  window.summSwitchPane = summSwitchPane;
  window.saScan = saScan;
  window.saRun = saRun;
  window.saSelectFeatures = saSelectFeatures;
  window.saSelectSpecies = saSelectSpecies;
  window.saRedraw = () => sa.pca && drawAll();
  window.saReset3d = saReset3d;
  window.saClear3dIds = saClear3dIds;
  window.saSave3dHtml = saSave3dHtml;
  window.saInternals.s3d = { s3dProject, s3dDraw, s3dHit };
  window.saSavePcaPng = () => savePng("saPcaFig", "pca_biplot");
  window.saSavePcaSvg = () => saveSvg("saPcaFig", "pca_biplot");
  window.saSave3dPng = () => saveCanvasPng("pca_3d");
  window.saSaveRadarPng = () => savePng("saRadarFig", "radar_profiles");
  window.saSaveRadarSvg = () => saveSvg("saRadarFig", "radar_profiles");
  window.saSaveCsv = saveCsv;
  // Called by Summarize after every (re)merge so the lists follow the data.
  window.saTempChanged = saTempChanged;
  window.saResetAll = saResetAll;
  window.saSettingsSave = saSettingsSave;
  window.saSettingsLoad = saSettingsLoad;
  window.saEditSpecies = saEditSpecies;
  window.saEditObs = saEditObs;
  window.saEditObsSpecies = saEditObsSpecies;
  window.saRecCompare = saRecCompare;
  window.saSaveRecPng = () => savePng("saRecFig", "comparison");
  window.saSaveRecSvg = () => saveSvg("saRecFig", "comparison");
  window.saOnDataChanged = () => {
    const v = $("summPaneAnalysis");
    if (v && v.offsetParent !== null) saScan();
  };
})();
