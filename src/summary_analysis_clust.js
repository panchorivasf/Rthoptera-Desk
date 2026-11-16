// ═══════════════════════════════════════════════════════════════════
// SUMMARY ANALYSIS — unsupervised grouping, for looking at the data.
//
//   Data      the same as the PCA / PERMANOVA: ticked variables (temperature-
//             adjusted if ticked) for the ticked species, Z-scored; Euclidean
//             distance in that space (all variables, not only PC1-PC2).
//   k-means   k chosen by the user; k-means++ starts, best of 40; silhouette
//             width for k = 2..8 as a guide.
//   DBSCAN    eps and minPts; points with too few neighbours are "noise".
//             The k-distance plot suggests eps.
//   Hierarchical  Ward, average, complete or single linkage; dendrogram with
//             the cut for k clusters.
//   Agreement clusters x species table and the adjusted Rand index. The
//             species names are never used to make the clusters.
// None of this is a test: it describes the data. A fixed seed makes it
// reproducible.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const I = window.saInternals;
  if (!I) return;
  const { sa, buildMatrix, specColor, svgEl } = I;
  const $ = (id) => document.getElementById(id);
  const SEED = 20240601;
  const CL_COLORS = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#a65628", "#f781bf", "#17becf", "#bcbd22", "#6a3d9a"];
  const NOISE = "#8a8a8a";
  const clColor = (c) => (c < 0 ? NOISE : CL_COLORS[c % CL_COLORS.length]);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const f2 = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(2));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const METHODS = { kmeans: "k-means", dbscan: "DBSCAN", hier: "Hierarchical" };
  let R = null; // last result

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

  // ── k-means ───────────────────────────────────────────────────────
  const sq = (a, b) => {
    let s = 0;
    for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
    return s;
  };
  function kmeansOnce(Z, k, rand) {
    const n = Z.length,
      p = Z[0].length;
    const cen = [Z[(rand() * n) | 0].slice()];
    while (cen.length < k) {
      const d = Z.map((z) => Math.min(...cen.map((c) => sq(z, c))));
      const tot = d.reduce((a, b) => a + b, 0);
      let r = rand() * tot,
        pick = n - 1;
      for (let i = 0; i < n; i++) {
        r -= d[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      cen.push(Z[pick].slice());
    }
    let lab = new Int32Array(n).fill(-1);
    for (let it = 0; it < 200; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let best = 0,
          bd = Infinity;
        for (let c = 0; c < k; c++) {
          const d = sq(Z[i], cen[c]);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (lab[i] !== best) {
          lab[i] = best;
          moved = true;
        }
      }
      const sum = Array.from({ length: k }, () => new Float64Array(p));
      const cnt = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        cnt[lab[i]]++;
        for (let j = 0; j < p; j++) sum[lab[i]][j] += Z[i][j];
      }
      for (let c = 0; c < k; c++) {
        if (cnt[c]) for (let j = 0; j < p; j++) cen[c][j] = sum[c][j] / cnt[c];
        else {
          // empty cluster: take the point farthest from its centre
          let far = 0,
            fd = -1;
          for (let i = 0; i < n; i++) {
            const d = sq(Z[i], cen[lab[i]]);
            if (d > fd) {
              fd = d;
              far = i;
            }
          }
          cen[c] = Z[far].slice();
          moved = true;
        }
      }
      if (!moved) break;
    }
    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += sq(Z[i], cen[lab[i]]);
    return { lab, inertia };
  }
  function kmeans(Z, k, rand) {
    let best = null;
    for (let r = 0; r < 40; r++) {
      const o = kmeansOnce(Z, k, rand);
      if (!best || o.inertia < best.inertia) best = o;
    }
    return best;
  }

  // mean silhouette width; a one-member cluster counts as 0
  function silhouette(D, lab, n) {
    const ks = [...new Set(lab)].filter((c) => c >= 0);
    if (ks.length < 2) return null;
    let tot = 0,
      m = 0;
    for (let i = 0; i < n; i++) {
      if (lab[i] < 0) continue;
      const sum = new Map(ks.map((c) => [c, 0]));
      const cnt = new Map(ks.map((c) => [c, 0]));
      for (let j = 0; j < n; j++) {
        if (j === i || lab[j] < 0) continue;
        sum.set(lab[j], sum.get(lab[j]) + D[i * n + j]);
        cnt.set(lab[j], cnt.get(lab[j]) + 1);
      }
      m++;
      if (!cnt.get(lab[i])) continue; // singleton: 0
      const a = sum.get(lab[i]) / cnt.get(lab[i]);
      let b = Infinity;
      ks.forEach((c) => c !== lab[i] && cnt.get(c) && (b = Math.min(b, sum.get(c) / cnt.get(c))));
      if (isFinite(b)) tot += (b - a) / Math.max(a, b);
    }
    return m ? tot / m : null;
  }

  // ── DBSCAN ────────────────────────────────────────────────────────
  function dbscan(D, n, eps, minPts) {
    const lab = new Int32Array(n).fill(-2); // -2 unvisited, -1 noise
    const near = (i) => {
      const o = [];
      for (let j = 0; j < n; j++) if (D[i * n + j] <= eps) o.push(j);
      return o;
    };
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (lab[i] !== -2) continue;
      const nb = near(i);
      if (nb.length < minPts) {
        lab[i] = -1;
        continue;
      }
      lab[i] = c;
      const queue = nb.filter((j) => j !== i);
      for (let q = 0; q < queue.length; q++) {
        const j = queue[q];
        if (lab[j] === -1) lab[j] = c;
        if (lab[j] !== -2) continue;
        lab[j] = c;
        const nj = near(j);
        if (nj.length >= minPts) nj.forEach((x) => queue.push(x));
      }
      c++;
    }
    return lab;
  }
  // distance of every point to its minPts-th nearest neighbour (itself counted), sorted
  function kDistance(D, n, minPts) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = [];
      for (let j = 0; j < n; j++) d.push(D[i * n + j]);
      d.sort((a, b) => a - b);
      out.push(d[Math.min(minPts - 1, n - 1)]);
    }
    return out.sort((a, b) => a - b);
  }

  // ── hierarchical ──────────────────────────────────────────────────
  // Returns the merges [{a, b, h, size}]; leaves are 0..n-1, merge s is node n+s.
  function hclust(D, n, method) {
    const ward = method === "ward";
    const d = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) d[i] = ward ? D[i] * D[i] : D[i];
    const id = Array.from({ length: n }, (_, i) => i);
    const size = new Array(n).fill(1);
    const alive = new Array(n).fill(true);
    const merges = [];
    for (let step = 0; step < n - 1; step++) {
      let bi = -1,
        bj = -1,
        bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        for (let j = i + 1; j < n; j++) if (alive[j] && d[i * n + j] < bd) {
          bd = d[i * n + j];
          bi = i;
          bj = j;
        }
      }
      merges.push({ a: id[bi], b: id[bj], h: ward ? Math.sqrt(bd) : bd, size: size[bi] + size[bj] });
      for (let k = 0; k < n; k++) {
        if (!alive[k] || k === bi || k === bj) continue;
        const dik = d[bi * n + k],
          djk = d[bj * n + k],
          dij = bd;
        let v;
        if (method === "single") v = Math.min(dik, djk);
        else if (method === "complete") v = Math.max(dik, djk);
        else if (method === "average") v = (size[bi] * dik + size[bj] * djk) / (size[bi] + size[bj]);
        else v = ((size[bi] + size[k]) * dik + (size[bj] + size[k]) * djk - size[k] * dij) / (size[bi] + size[bj] + size[k]);
        d[bi * n + k] = d[k * n + bi] = v;
      }
      alive[bj] = false;
      size[bi] += size[bj];
      id[bi] = n + step;
    }
    return merges;
  }
  function cutTree(merges, n, k) {
    const parent = Array.from({ length: 2 * n - 1 }, (_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (let s = 0; s < n - k; s++) {
      parent[find(merges[s].a)] = n + s;
      parent[find(merges[s].b)] = n + s;
    }
    const map = new Map();
    const lab = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!map.has(r)) map.set(r, map.size);
      lab[i] = map.get(r);
    }
    return lab;
  }

  // ── agreement with the species ────────────────────────────────────
  function ari(a, b) {
    const n = a.length;
    const tab = new Map();
    const ra = new Map(),
      rb = new Map();
    for (let i = 0; i < n; i++) {
      const key = a[i] + "|" + b[i];
      tab.set(key, (tab.get(key) || 0) + 1);
      ra.set(a[i], (ra.get(a[i]) || 0) + 1);
      rb.set(b[i], (rb.get(b[i]) || 0) + 1);
    }
    const c2 = (x) => (x * (x - 1)) / 2;
    let sij = 0,
      sa2 = 0,
      sb2 = 0;
    tab.forEach((v) => (sij += c2(v)));
    ra.forEach((v) => (sa2 += c2(v)));
    rb.forEach((v) => (sb2 += c2(v)));
    const exp = (sa2 * sb2) / c2(n),
      mx = (sa2 + sb2) / 2;
    return mx === exp ? 1 : (sij - exp) / (mx - exp);
  }

  // ── two PCs of the Z matrix, for the picture ──────────────────────
  function pca2(Z) {
    const n = Z.length,
      p = Z[0].length;
    const C = Array.from({ length: p }, () => new Float64Array(p));
    Z.forEach((z) => {
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] += (z[a] * z[b]) / (n - 1);
    });
    const vecs = [],
      vals = [];
    let trace = 0;
    for (let a = 0; a < p; a++) trace += C[a][a];
    for (let c = 0; c < 2; c++) {
      let v = Float64Array.from({ length: p }, (_, j) => Math.sin(j + 1 + c * 7));
      let lam = 0;
      for (let it = 0; it < 500; it++) {
        const w = new Float64Array(p);
        for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) w[a] += C[a][b] * v[b];
        lam = Math.hypot(...w) || 1;
        for (let a = 0; a < p; a++) v[a] = w[a] / lam;
      }
      vecs.push(v);
      vals.push(lam);
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] -= lam * v[a] * v[b];
    }
    return { xy: Z.map((z) => vecs.map((v) => z.reduce((s, x, j) => s + x * v[j], 0))), ratio: vals.map((l) => l / trace) };
  }

  // ── run ───────────────────────────────────────────────────────────
  async function saClustRun() {
    const out = $("saClustOut");
    if (!out) return;
    const bad = (t) => {
      out.textContent = t;
      I.say(t, true);
    };
    if (sa.repMode) return bad("Clustering needs several recordings per species, but the STR rep. table gives one row per species.");
    const { feats, X } = buildMatrix();
    if (feats.length < 2) return bad("Select at least 2 variables first.");
    const ids = [];
    sa.samples.forEach((s, i) => {
      if (s.species !== "(no species)" && sa.selSp.has(s.species)) ids.push(i);
    });
    if (ids.length < 4) return bad("Tick species so that at least 4 observations are included.");
    const keep = [];
    feats.forEach((f, j) => {
      const col = ids.map((i) => X[i][j]);
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length - 1));
      if (sd > 1e-12) keep.push({ j, m, sd });
    });
    if (keep.length < 2) return bad("Fewer than 2 of the ticked variables vary among the observations.");
    const n = ids.length;
    const Z = ids.map((i) => keep.map((k) => (X[i][k.j] - k.m) / k.sd));
    const D = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) D[a * n + b] = D[b * n + a] = Math.sqrt(sq(Z[a], Z[b]));
    const species = ids.map((i) => sa.samples[i].species);
    const names = [...new Set(species)];
    const spIdx = Int32Array.from(species.map((s) => names.indexOf(s)));

    const kIn = parseInt($("saClustK")?.value, 10);
    const k = Math.max(2, Math.min(isFinite(kIn) ? kIn : names.length, n - 1));
    const minPts = Math.max(2, parseInt($("saClustMin")?.value, 10) || 3);
    const link = $("saClustLink")?.value || "ward";
    const rand = rng(SEED);
    out.textContent = "Running…";
    await tick();

    // k-means, and a silhouette for each k
    const sil = [];
    let km = null;
    for (let kk = 2; kk <= Math.min(8, n - 1); kk++) {
      const o = kmeans(Z, kk, rand);
      sil.push({ k: kk, s: silhouette(D, o.lab, n), inertia: o.inertia });
      if (kk === k) km = o;
    }
    if (!km) km = kmeans(Z, k, rand);

    // DBSCAN
    const kd = kDistance(D, n, minPts);
    const epsIn = parseFloat($("saClustEps")?.value);
    const epsSug = kd[Math.min(kd.length - 1, Math.floor(0.85 * kd.length))];
    const eps = isFinite(epsIn) && epsIn > 0 ? epsIn : epsSug;
    const db = dbscan(D, n, eps, minPts);

    // hierarchical
    const merges = hclust(D, n, link);
    const hc = cutTree(merges, n, k);

    const pc = pca2(Z);
    R = {
      ids, n, names, species, spIdx, p: keep.length, k, minPts, eps, epsSug, epsAuto: !(isFinite(epsIn) && epsIn > 0), link, kd, sil,
      pc, merges,
      labs: { kmeans: km.lab, dbscan: db, hier: hc },
    };
    if ($("saClustEps") && R.epsAuto) $("saClustEps").placeholder = "auto: " + epsSug.toFixed(2);
    render();
    I.say("Clustering done: " + n + " observations, " + keep.length + " variables.");
  }

  // ── output ────────────────────────────────────────────────────────
  function contingency(lab) {
    const cl = [...new Set(lab)].sort((a, b) => (a < 0) - (b < 0) || a - b);
    const cnt = (c, s) => {
      let m = 0;
      for (let i = 0; i < R.n; i++) if (lab[i] === c && R.spIdx[i] === s) m++;
      return m;
    };
    return (
      '<table class="dtable"><thead><tr><th>Cluster</th>' +
      R.names.map((s) => "<th>" + esc(s) + "</th>").join("") +
      "</tr></thead><tbody>" +
      cl
        .map(
          (c) =>
            '<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + clColor(c) + ';margin-right:4px"></span>' +
            (c < 0 ? "noise" : "cluster " + (c + 1)) + "</td>" +
            R.names.map((_, s) => "<td>" + (cnt(c, s) || "·") + "</td>").join("") + "</tr>",
        )
        .join("") +
      "</tbody></table>"
    );
  }
  function section(title, note, lab) {
    const nc = [...new Set(lab)].filter((c) => c >= 0).length;
    const noise = [...lab].filter((c) => c < 0).length;
    return (
      '<div style="min-width:240px"><div style="font-size:11px;font-weight:600;color:var(--txt3)">' + title + "</div>" +
      '<div style="font-size:11px;color:var(--txt2);margin:2px 0 4px">' + nc + " cluster" + (nc === 1 ? "" : "s") + (noise ? ", " + noise + " noise" : "") +
      " · adjusted Rand index vs species <b>" + f2(ari(Array.from(lab), Array.from(R.spIdx))) + "</b>" + (note ? "<br>" + note : "") + "</div>" +
      contingency(lab) + "</div>"
    );
  }

  function render() {
    const out = $("saClustOut");
    const best = R.sil.filter((o) => o.s != null).sort((a, b) => b.s - a.s)[0];
    const silTxt = R.sil
      .map((o) => "k=" + o.k + ": " + f2(o.s) + (best && o.k === best.k ? " ◀" : ""))
      .join(" &nbsp; ");
    out.innerHTML =
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:6px">' + R.n + " observations, " + R.names.length + " species, " + R.p +
      " variables (Z-scored, Euclidean distance); species names were not used to form the clusters. The adjusted Rand index is 1 when the clusters equal the species and about 0 when they agree no better than chance.</div>" +
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:6px"><b>Silhouette width</b> of k-means (higher = better separated; ◀ best): ' + silTxt + "</div>" +
      '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
      section("k-means (k = " + R.k + ")", "", R.labs.kmeans) +
      section("DBSCAN (eps = " + R.eps.toFixed(2) + (R.epsAuto ? ", suggested" : "") + ", minPts = " + R.minPts + ")", "Noise is counted as its own group in the Rand index.", R.labs.dbscan) +
      section("Hierarchical (" + R.link + ", cut at " + R.k + ")", "", R.labs.hier) +
      "</div>";
    drawScatter();
    drawDend();
    drawKd();
  }

  function shapeEl(si, x, y, r, attrs) {
    const m = si % 6;
    if (m === 0) return svgEl("circle", { cx: x, cy: y, r, ...attrs });
    if (m === 1) return svgEl("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, ...attrs });
    if (m === 2) return svgEl("polygon", { points: [x, y - r * 1.2, x + r * 1.1, y + r * 0.9, x - r * 1.1, y + r * 0.9].join(","), ...attrs });
    if (m === 3) return svgEl("polygon", { points: [x, y - r * 1.3, x + r * 1.3, y, x, y + r * 1.3, x - r * 1.3, y].join(","), ...attrs });
    if (m === 4) return svgEl("polygon", { points: [x - r * 1.1, y - r * 0.9, x + r * 1.1, y - r * 0.9, x, y + r * 1.2].join(","), ...attrs });
    return svgEl("polygon", { points: [x - r * 0.4, y - r * 1.2, x + r * 0.4, y - r * 1.2, x + r * 0.4, y - r * 0.4, x + r * 1.2, y - r * 0.4, x + r * 1.2, y + r * 0.4, x + r * 0.4, y + r * 0.4, x + r * 0.4, y + r * 1.2, x - r * 0.4, y + r * 1.2, x - r * 0.4, y + r * 0.4, x - r * 1.2, y + r * 0.4, x - r * 1.2, y - r * 0.4, x - r * 0.4, y - r * 0.4].join(","), ...attrs });
  }

  function drawScatter() {
    const host = $("saClustFig");
    if (!host || !R) return;
    host.innerHTML = "";
    const which = $("saClustBy")?.value || "kmeans";
    const lab = R.labs[which];
    const W = 560,
      H = 400,
      ML = 50,
      MT = 28,
      MR = 150,
      MB = 40;
    const xs = R.pc.xy.map((q) => q[0]),
      ys = R.pc.xy.map((q) => q[1]);
    const lo = [Math.min(...xs), Math.min(...ys)],
      hi = [Math.max(...xs), Math.max(...ys)];
    const px = (hi[0] - lo[0]) * 0.07 || 1,
      py = (hi[1] - lo[1]) * 0.07 || 1;
    const X = (v) => ML + ((v - lo[0] + px) / (hi[0] - lo[0] + 2 * px)) * (W - ML - MR);
    const Y = (v) => H - MB - ((v - lo[1] + py) / (hi[1] - lo[1] + 2 * py)) * (H - MT - MB);
    const svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: "0 0 " + W + " " + H, style: "font-family:Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("rect", { x: ML, y: MT, width: W - ML - MR, height: H - MT - MB, fill: "none", stroke: "#bbb" }));
    svg.appendChild(svgEl("text", { x: ML, y: 16, "font-size": 12, "font-weight": 600, fill: "#222" }, "Coloured by " + METHODS[which] + " · shape = species"));
    svg.appendChild(svgEl("text", { x: ML + (W - ML - MR) / 2, y: H - 8, "font-size": 11, "text-anchor": "middle", fill: "#333" }, "PC1 (" + (R.pc.ratio[0] * 100).toFixed(0) + "%)"));
    svg.appendChild(svgEl("text", { x: 14, y: MT + (H - MT - MB) / 2, "font-size": 11, "text-anchor": "middle", fill: "#333", transform: "rotate(-90 14 " + (MT + (H - MT - MB) / 2) + ")" }, "PC2 (" + (R.pc.ratio[1] * 100).toFixed(0) + "%)"));
    for (let i = 0; i < R.n; i++) {
      const s = sa.samples[R.ids[i]];
      const e = shapeEl(R.spIdx[i], X(R.pc.xy[i][0]), Y(R.pc.xy[i][1]), 4.5, { fill: clColor(lab[i]), "fill-opacity": lab[i] < 0 ? 0.5 : 0.85, stroke: "#222", "stroke-width": 0.8 });
      e.appendChild(svgEl("title", {}, s.label + " — " + s.species + " — " + (lab[i] < 0 ? "noise" : "cluster " + (lab[i] + 1))));
      svg.appendChild(e);
    }
    // legend
    let y = MT + 4;
    const lx = W - MR + 14;
    svg.appendChild(svgEl("text", { x: lx, y, "font-size": 10, "font-weight": 600, fill: "#555" }, "Clusters"));
    [...new Set(lab)].sort((a, b) => (a < 0) - (b < 0) || a - b).forEach((c) => {
      y += 15;
      svg.appendChild(svgEl("rect", { x: lx, y: y - 9, width: 12, height: 10, fill: clColor(c) }));
      svg.appendChild(svgEl("text", { x: lx + 18, y, "font-size": 11, fill: "#222" }, c < 0 ? "noise" : "cluster " + (c + 1)));
    });
    y += 22;
    svg.appendChild(svgEl("text", { x: lx, y, "font-size": 10, "font-weight": 600, fill: "#555" }, "Species"));
    R.names.forEach((nm, si) => {
      y += 16;
      svg.appendChild(shapeEl(si, lx + 6, y - 4, 4.5, { fill: "#ddd", stroke: "#222", "stroke-width": 0.8 }));
      svg.appendChild(svgEl("text", { x: lx + 18, y, "font-size": 11, fill: "#222", "font-style": "italic" }, nm));
    });
    host.appendChild(svg);
  }

  function drawDend() {
    const host = $("saClustDend");
    if (!host || !R) return;
    host.innerHTML = "";
    const n = R.n,
      m = R.merges;
    const kids = new Map();
    m.forEach((q, s) => kids.set(n + s, [q.a, q.b]));
    const order = [];
    const walk = (x) => (x < n ? order.push(x) : kids.get(x).forEach(walk));
    walk(2 * n - 2);
    const yOf = new Map(order.map((leaf, r) => [leaf, r]));
    const hOf = (x) => (x < n ? 0 : m[x - n].h);
    const yy = new Map();
    const pos = (x) => {
      if (x < n) return yOf.get(x);
      if (!yy.has(x)) yy.set(x, kids.get(x).map(pos).reduce((a, b) => a + b, 0) / 2);
      return yy.get(x);
    };
    const maxH = m[m.length - 1].h || 1;
    const rowH = 15,
      ML = 20,
      MT = 30,
      treeW = 360,
      labW = 230;
    const H = MT + n * rowH + 28,
      W = ML + treeW + labW;
    const X = (h) => ML + treeW - (h / maxH) * treeW;
    const Y = (r) => MT + r * rowH + rowH / 2;
    const svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: "0 0 " + W + " " + H, style: "font-family:Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("text", { x: ML, y: 16, "font-size": 12, "font-weight": 600, fill: "#222" }, "Dendrogram (" + R.link + ") · dashed line = cut at " + R.k + " clusters"));
    const lab = R.labs.hier;
    const col = (x) => {
      // colour a branch by its cluster when all its leaves share one
      const ls = [];
      const w = (z) => (z < n ? ls.push(z) : kids.get(z).forEach(w));
      w(x);
      const c = lab[ls[0]];
      return ls.every((l) => lab[l] === c) ? clColor(c) : "#555";
    };
    m.forEach((q, s) => {
      const node = n + s;
      const ya = pos(q.a),
        yb = pos(q.b);
      const c = col(node);
      const line = (x1, y1, x2, y2) => svg.appendChild(svgEl("line", { x1, y1, x2, y2, stroke: c, "stroke-width": 1.6 }));
      line(X(q.h), Y(ya), X(q.h), Y(yb));
      line(X(hOf(q.a)), Y(ya), X(q.h), Y(ya));
      line(X(hOf(q.b)), Y(yb), X(q.h), Y(yb));
    });
    if (R.k > 1 && R.k <= n) {
      const hCut = (m[n - R.k - 1].h + m[n - R.k].h) / 2;
      svg.appendChild(svgEl("line", { x1: X(hCut), y1: MT - 4, x2: X(hCut), y2: MT + n * rowH, stroke: "#c33", "stroke-dasharray": "5 4" }));
    }
    order.forEach((leaf, r) => {
      const s = sa.samples[R.ids[leaf]];
      svg.appendChild(svgEl("text", { x: X(0) + 6, y: Y(r) + 4, "font-size": 11, fill: specColor(sa.species.indexOf(s.species)) }, s.label + "  (" + s.species + ")"));
    });
    host.appendChild(svg);
  }

  function drawKd() {
    const host = $("saClustKd");
    if (!host || !R) return;
    host.innerHTML = "";
    const W = 360,
      H = 200,
      ML = 42,
      MT = 26,
      MB = 30,
      MR = 10;
    const kd = R.kd;
    const mx = Math.max(kd[kd.length - 1], R.eps) * 1.08 || 1;
    const X = (i) => ML + (i / (kd.length - 1 || 1)) * (W - ML - MR);
    const Y = (v) => H - MB - (v / mx) * (H - MT - MB);
    const svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: "0 0 " + W + " " + H, style: "font-family:Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("text", { x: ML, y: 14, "font-size": 11, "font-weight": 600, fill: "#222" }, "k-distance (k = " + R.minPts + "): distance to each point's " + R.minPts + "th nearest neighbour"));
    svg.appendChild(svgEl("rect", { x: ML, y: MT, width: W - ML - MR, height: H - MT - MB, fill: "none", stroke: "#bbb" }));
    svg.appendChild(svgEl("polyline", { points: kd.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" "), fill: "none", stroke: "#2d6cdf", "stroke-width": 1.8 }));
    svg.appendChild(svgEl("line", { x1: ML, y1: Y(R.eps), x2: W - MR, y2: Y(R.eps), stroke: "#c33", "stroke-dasharray": "5 4" }));
    svg.appendChild(svgEl("text", { x: W - MR - 2, y: Y(R.eps) - 4, "font-size": 10, "text-anchor": "end", fill: "#c33" }, "eps = " + R.eps.toFixed(2)));
    svg.appendChild(svgEl("text", { x: ML + (W - ML - MR) / 2, y: H - 8, "font-size": 10, "text-anchor": "middle", fill: "#333" }, "observations, sorted"));
    svg.appendChild(svgEl("text", { x: ML - 4, y: Y(0) + 3, "font-size": 10, "text-anchor": "end", fill: "#333" }, "0"));
    svg.appendChild(svgEl("text", { x: ML - 4, y: Y(mx / 1.08) + 3, "font-size": 10, "text-anchor": "end", fill: "#333" }, (mx / 1.08).toFixed(1)));
    host.appendChild(svg);
  }

  window.saClustRun = saClustRun;
  window.saClustRedraw = () => R && drawScatter();
  window.saClustReset = () => {
    R = null;
    ["saClustFig", "saClustDend", "saClustKd"].forEach((id) => $(id) && ($(id).innerHTML = ""));
    if ($("saClustOut")) $("saClustOut").textContent = "Not run yet.";
  };
})();
