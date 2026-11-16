// ═══════════════════════════════════════════════════════════════════
// SUMMARY ANALYSIS — do the species differ? PERMANOVA.
//
//   Data       exactly what the PCA uses: the ticked variables, adjusted for
//              temperature when that box is ticked, for the ticked species.
//              Each variable is Z-scored over the observations tested, so the
//              distance is the Euclidean distance in PCA space (all axes).
//   Global     one-way PERMANOVA (Anderson 2001): pseudo-F from the distance
//              matrix, R² = SS(among) / SS(total), p from permuting the
//              species labels.
//   Dispersion PERMDISP: PERMANOVA also reacts to groups that differ in
//              spread only, so the distances to each species' centroid are
//              compared the same way (ANOVA F, permuted).
//   Pairwise   the same test for every pair of species, p corrected with
//              Holm's method.
//   Specimens  recordings of one animal are not independent. By default the
//              labels are permuted among whole specimens, so a specimen's
//              recordings always move together.
// A fixed random seed makes the p-values reproducible.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const I = window.saInternals;
  if (!I) return;
  const { sa, buildMatrix } = I;
  const $ = (id) => document.getElementById(id);
  const SEED = 20240601;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (v, d = 3) => (v == null || !isFinite(v) ? (v === Infinity ? "∞" : "—") : String(+Number(v).toPrecision(d)));
  const fmtP = (p) => (p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // log of the number of distinct ways to deal the labels out: n! / prod(n_g!)
  function logArrangements(counts) {
    const lf = (n) => {
      let s = 0;
      for (let i = 2; i <= n; i++) s += Math.log(i);
      return s;
    };
    const n = counts.reduce((a, b) => a + b, 0);
    return lf(n) - counts.reduce((s, c) => s + lf(c), 0);
  }

  // One test design: observations `ids` (indices into the sample list), their
  // group, and the clusters (specimens) that move together when permuting.
  function makeDesign(ids, groupOf, specOf, useSpec) {
    const names = [...new Set(ids.map((i) => groupOf[i]))];
    const gIdx = new Map(names.map((n, k) => [n, k]));
    const lab = Int32Array.from(ids.map((i) => gIdx.get(groupOf[i])));
    // a specimen keeps its recordings together only if they share one group here
    const specGroups = new Map();
    if (useSpec)
      ids.forEach((i, k) => {
        const sp = specOf[i];
        if (!sp) return;
        if (!specGroups.has(sp)) specGroups.set(sp, new Set());
        specGroups.get(sp).add(lab[k]);
      });
    const clusterIdx = new Map();
    const clusterOf = new Int32Array(ids.length);
    const clusterLab = [];
    ids.forEach((i, k) => {
      const sp = specOf[i];
      const key = useSpec && sp && specGroups.get(sp).size === 1 ? "s:" + sp : "o:" + k;
      if (!clusterIdx.has(key)) {
        clusterIdx.set(key, clusterLab.length);
        clusterLab.push(lab[k]);
      }
      clusterOf[k] = clusterIdx.get(key);
    });
    const counts = new Array(names.length).fill(0);
    clusterLab.forEach((l) => counts[l]++);
    return { n: ids.length, names, g: names.length, lab, clusterOf, clusterLab: Int32Array.from(clusterLab), clusterCounts: counts };
  }

  // Permutation p for any statistic of the label vector (larger = stronger).
  function permP(stat, d, nperm, rand) {
    const obs = stat(d.lab);
    const cl = d.clusterLab.slice();
    const lab = new Int32Array(d.n);
    const tol = 1e-12 * Math.abs(obs);
    let ge = 0;
    for (let k = 0; k < nperm; k++) {
      for (let i = cl.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0;
        const t = cl[i];
        cl[i] = cl[j];
        cl[j] = t;
      }
      for (let i = 0; i < d.n; i++) lab[i] = cl[d.clusterOf[i]];
      if (stat(lab) >= obs - tol) ge++;
    }
    const arr = Math.exp(logArrangements(d.clusterCounts));
    return { obs, p: (ge + 1) / (nperm + 1), minP: Math.max(1 / arr, 1 / (nperm + 1)) };
  }

  // PERMANOVA on the squared-distance matrix D2 (stride N) for observations ids.
  function permanova(D2, N, ids, d, nperm, rand) {
    const n = ids.length;
    let tot = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) tot += D2[ids[a] * N + ids[b]];
    const SST = tot / n;
    const stat = (lab) => {
      const w = new Float64Array(d.g);
      const cnt = new Int32Array(d.g);
      for (let a = 0; a < n; a++) cnt[lab[a]]++;
      for (let a = 0; a < n; a++) {
        const ra = ids[a] * N;
        const la = lab[a];
        for (let b = a + 1; b < n; b++) if (lab[b] === la) w[la] += D2[ra + ids[b]];
      }
      let SSW = 0;
      for (let k = 0; k < d.g; k++) if (cnt[k]) SSW += w[k] / cnt[k];
      const SSA = SST - SSW;
      return SSW <= 1e-12 ? Infinity : (SSA / (d.g - 1)) / (SSW / (n - d.g));
    };
    const r = permP(stat, d, nperm, rand);
    const q = (r.obs * (d.g - 1)) / (n - d.g); // SS(among) / SS(within)
    return { F: r.obs, R2: r.obs === Infinity ? 1 : q / (1 + q), p: r.p, minP: r.minP, df1: d.g - 1, df2: n - d.g };
  }

  // PERMDISP: ANOVA F on the distances to the group centroids.
  function permdisp(Z, ids, d, nperm, rand) {
    const p = Z[0].length;
    const cen = Array.from({ length: d.g }, () => new Float64Array(p));
    const cnt = new Int32Array(d.g);
    ids.forEach((i, k) => {
      cnt[d.lab[k]]++;
      for (let j = 0; j < p; j++) cen[d.lab[k]][j] += Z[i][j];
    });
    cen.forEach((c, g) => c.forEach((_, j) => (c[j] /= cnt[g])));
    const dist = ids.map((i, k) => {
      let s = 0;
      for (let j = 0; j < p; j++) s += (Z[i][j] - cen[d.lab[k]][j]) ** 2;
      return Math.sqrt(s);
    });
    const grand = dist.reduce((a, b) => a + b, 0) / dist.length;
    const stat = (lab) => {
      const sum = new Float64Array(d.g);
      const c = new Int32Array(d.g);
      dist.forEach((v, k) => {
        sum[lab[k]] += v;
        c[lab[k]]++;
      });
      let ssa = 0,
        ssw = 0;
      for (let g = 0; g < d.g; g++) if (c[g]) ssa += c[g] * (sum[g] / c[g] - grand) ** 2;
      dist.forEach((v, k) => (ssw += (v - sum[lab[k]] / c[lab[k]]) ** 2));
      return ssw <= 1e-12 ? Infinity : ssa / (d.g - 1) / (ssw / (dist.length - d.g));
    };
    const r = permP(stat, d, nperm, rand);
    const meanDist = d.names.map((nm, g) => {
      let s = 0;
      dist.forEach((v, k) => d.lab[k] === g && (s += v));
      return { name: nm, mean: s / cnt[g] };
    });
    return { F: r.obs, p: r.p, meanDist };
  }

  function holm(ps) {
    const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    const adj = new Array(ps.length);
    let run = 0;
    order.forEach(([p, i], k) => {
      run = Math.max(run, Math.min(1, (ps.length - k) * p));
      adj[i] = run;
    });
    return adj;
  }

  async function saPermRun() {
    const out = $("saPermOut");
    if (!out) return;
    const bad = (t) => {
      out.textContent = t;
      I.say(t, true);
    };
    if (sa.repMode) return bad("PERMANOVA needs several recordings per species, but the STR rep. table gives one row per species. Untick STR rep. and use the STR table.");
    const { feats, X } = buildMatrix();
    if (feats.length < 2) return bad("Select at least 2 variables first.");

    // observations: ticked species with a name, species with at least 2 observations
    const groupOf = sa.samples.map((s) => (s.species === "(no species)" || !sa.selSp.has(s.species) ? null : s.species));
    const specOf = sa.samples.map((s) => s.specimen || "");
    const counts = new Map();
    groupOf.forEach((g) => g && counts.set(g, (counts.get(g) || 0) + 1));
    const dropped = [...counts].filter(([, c]) => c < 2).map(([g]) => g);
    const names = [...counts].filter(([, c]) => c >= 2).map(([g]) => g);
    if (names.length < 2) return bad("The test needs at least 2 ticked species with at least 2 observations each.");
    const ids = groupOf.map((g, i) => (g && names.includes(g) ? i : -1)).filter((i) => i >= 0);

    // Z-score each variable over the observations tested; skip constant ones
    const keep = [];
    feats.forEach((_, j) => {
      const col = ids.map((i) => X[i][j]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length - 1));
      if (sd > 1e-12) keep.push({ j, m, sd });
    });
    if (keep.length < 2) return bad("Fewer than 2 of the ticked variables vary among the observations tested.");
    const N = sa.samples.length;
    const Z = sa.samples.map((_, i) => (ids.includes(i) ? keep.map((k) => (X[i][k.j] - k.m) / k.sd) : null));
    const D2 = new Float64Array(N * N);
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        let s = 0;
        const za = Z[ids[a]],
          zb = Z[ids[b]];
        for (let j = 0; j < za.length; j++) s += (za[j] - zb[j]) ** 2;
        D2[ids[a] * N + ids[b]] = D2[ids[b] * N + ids[a]] = s;
      }

    const nperm = parseInt($("saPermN")?.value || "9999", 10);
    const useSpec = !!$("saPermSpec")?.checked;
    const rand = rng(SEED);
    out.textContent = "Running… (global test)";
    await tick();

    const dAll = makeDesign(ids, groupOf, specOf, useSpec);
    if (dAll.n - dAll.g < 1) return bad("Not enough observations: there must be more observations than species.");
    const glob = permanova(D2, N, ids, dAll, nperm, rand);
    const disp = permdisp(Z, ids, dAll, nperm, rand);

    const pairs = [];
    for (let a = 0; a < names.length; a++)
      for (let b = a + 1; b < names.length; b++) {
        out.textContent = "Running… pair " + (pairs.length + 1) + " of " + (names.length * (names.length - 1)) / 2;
        await tick();
        const sub = ids.filter((i) => groupOf[i] === names[a] || groupOf[i] === names[b]);
        const d = makeDesign(sub, groupOf, specOf, useSpec);
        const r = permanova(D2, N, sub, d, nperm, rand);
        const rd = permdisp(Z, sub, d, nperm, rand);
        pairs.push({ a: names[a], b: names[b], na: counts.get(names[a]), nb: counts.get(names[b]), ...r, pDisp: rd.p });
      }
    const adj = holm(pairs.map((q) => q.p));
    pairs.forEach((q, i) => (q.padj = adj[i]));

    render({ nObs: ids.length, names, counts, p: keep.length, nperm, useSpec, glob, disp, pairs, dropped, nClusters: dAll.clusterLab.length, dAll });
    I.say("PERMANOVA done: " + names.length + " species, " + ids.length + " observations, " + keep.length + " variables.");
  }

  function render(R) {
    const out = $("saPermOut");
    const temp = sa.temp && sa.temp.on ? "adjusted to " + sa.temp.ref + " °C" + (sa.temp.onlySig ? " (significant slopes only)" : "") : "not temperature-adjusted";
    const warn = [];
    if (R.dropped.length) warn.push("Left out for having only one observation: " + R.dropped.map(esc).join(", ") + ".");
    if (R.useSpec && R.nClusters < R.nObs) warn.push("Labels were permuted among " + R.nClusters + " specimens (" + R.nObs + " recordings).");
    if (R.glob.minP > 0.05) warn.push("Too few distinct arrangements for this design: the smallest p it can give is " + fmtP(R.glob.minP) + ".");
    const dispNote =
      R.disp.p < 0.05
        ? "The species differ in how spread out they are (PERMDISP p " + (R.disp.p < 0.001 ? "< 0.001" : "= " + R.disp.p.toFixed(3)) + "). A significant PERMANOVA may then reflect the difference in spread and not only in position, so read it with caution."
        : "The species do not differ detectably in spread (PERMDISP p = " + R.disp.p.toFixed(3) + "), so the PERMANOVA result can be read as a difference in position.";
    out.innerHTML =
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:6px">' +
      R.nObs + " observations, " + R.names.length + " species, " + R.p + " variables (Z-scored, Euclidean distance, " + temp + "); " +
      R.nperm + " permutations, fixed seed.</div>" +
      '<table class="dtable"><thead><tr><th>Test</th><th>Pseudo-F</th><th>R²</th><th>p</th></tr></thead><tbody>' +
      "<tr><td><b>PERMANOVA</b> (species, " + R.glob.df1 + " and " + R.glob.df2 + " df)</td><td>" + fmt(R.glob.F) + "</td><td>" + fmt(R.glob.R2) + "</td><td><b>" + fmtP(R.glob.p) + "</b></td></tr>" +
      "<tr><td>PERMDISP (spread around each species' centroid)</td><td>" + fmt(R.disp.F) + "</td><td>—</td><td>" + fmtP(R.disp.p) + "</td></tr></tbody></table>" +
      '<div style="font-size:11px;color:var(--txt2);margin:6px 0">' + dispNote + "</div>" +
      '<div style="font-size:11px;font-weight:600;color:var(--txt3);margin-top:8px">Pairwise (p corrected over ' + R.pairs.length + " pair" + (R.pairs.length === 1 ? "" : "s") + " with Holm)</div>" +
      '<table class="dtable"><thead><tr><th>Species A</th><th>Species B</th><th>n A / n B</th><th>Pseudo-F</th><th>R²</th><th>p</th><th>p (Holm)</th><th title="Smallest p the design can give, from the number of distinct label arrangements">min. p</th><th title="PERMDISP for this pair">spread p</th></tr></thead><tbody>' +
      R.pairs
        .map(
          (q) =>
            "<tr><td>" + esc(q.a) + "</td><td>" + esc(q.b) + "</td><td>" + q.na + " / " + q.nb + "</td><td>" + fmt(q.F) + "</td><td>" + fmt(q.R2) + "</td><td>" + fmtP(q.p) + "</td><td><b>" + fmtP(q.padj) + "</b></td><td>" + fmtP(q.minP) + "</td><td>" + fmtP(q.pDisp) + "</td></tr>",
        )
        .join("") +
      "</tbody></table>" +
      (warn.length ? '<div style="font-size:11px;color:#b9770e;margin-top:6px">' + warn.join("<br>") + "</div>" : "");
  }

  window.saPermRun = saPermRun;
  window.saPermReset = () => {
    const o = $("saPermOut");
    if (o) o.textContent = "Not run yet.";
  };
})();
