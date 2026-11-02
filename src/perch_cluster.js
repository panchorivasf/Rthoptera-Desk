// ═══════════════════════════════════════════════════════════════════════
// CLUSTERING (Perch 2.0 embeddings)
//
// Embeds each unit with Google's Perch 2.0 (run locally through the vendored
// onnxruntime-web, from an .onnx file the user loads) and groups the units by
// cosine distance. No acoustic metrics are involved.
//
// Unit = a selection, when the recording has any (selections live only on the
// ACTIVE recording: they are cleared when another one is opened); otherwise
// consecutive 5 s windows of the recording.
//
// Perch 2.0 takes 5 s of mono audio at 32 kHz and returns a 1536-d embedding.
// ═══════════════════════════════════════════════════════════════════════

const PC_SR = 32000;
const PC_WIN = 5 * PC_SR;
const PC_DIM = 1536;
const PC_MAX_UNITS = 2500; // the distance matrix is N x N

let pcSession = null;
let pcModelName = "";
let pcUnits = []; // { rec, recId, rate, species, start, end, kind, aid, emb, cluster }
let pcNormEmb = null; // unit-length embeddings of pcUnits
let pcPcaRaw = null; // 3 principal components, unscaled (t-SNE start)
let pcProj = {}; // projection name -> [[x, y, z]] scaled to [-1, 1]
let pcMethod = "pca";
let pcColorBy = "cluster";
let pcView = { yaw: 0.6, pitch: 0.35, zoom: 1 };
let pcInfo = null; // { k, silhouette }
let pcSel = -1;
let pcAudioCtx = null;

// ── UI ───────────────────────────────────────────────────────────────
function pcInit() {
  const root = document.getElementById("pcRoot");
  if (!root) return;
  root.innerHTML =
    '<div style="font-size:11px;color:var(--txt2);line-height:1.6;max-width:900px">' +
    "Groups the checked recordings by how they sound to <b>Google Perch 2.0</b>, without any of the usual metrics. " +
    "A recording with selections is clustered selection by selection (only the <b>active</b> recording keeps its selections); " +
    "any other is cut into consecutive 5 s windows. Selections shorter than 5 s are repeated to fill the window. " +
    "Perch reads audio at 32 kHz (up to 16 kHz); for ultrasonic insects use <b>Slow-down</b> to shift the sound down first." +
    "</div>" +
    '<div class="panel" style="max-width:900px"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
    '<button id="pcLoad" class="pri" style="font-size:11px" onclick="document.getElementById(\'pcFile\').click()">&#128193; Load Perch model (.onnx)</button>' +
    '<input type="file" id="pcFile" accept=".onnx" style="display:none" onchange="pcLoadModel(this.files[0]); this.value=\'\';">' +
    '<span id="pcModelStatus" style="font-size:11px;color:var(--txt2)">No model loaded. Use a single-file Perch 2.0 ONNX export.</span>' +
    "</div></div>" +
    '<div class="panel" style="max-width:900px"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">' +
    '<label class="chk" style="font-size:11px;color:var(--txt2)" title="Treat the recording as if it had been recorded N times slower, so ultrasound lands inside Perch\'s 0–16 kHz range. 1 = none (plain resampling to 32 kHz).">Slow-down &times; <input type="number" id="pcSlow" value="1" min="1" max="32" step="0.5" style="width:60px;font-size:11px"></label>' +
    '<label class="chk" style="font-size:11px;color:var(--txt2)" title="Leave empty to choose automatically (best silhouette score).">Clusters (k) <input type="number" id="pcK" min="2" max="30" placeholder="auto" style="width:60px;font-size:11px"></label>' +
    '<label class="chk" style="font-size:11px;color:var(--txt2)" title="Upper limit when k is chosen automatically.">Max k <input type="number" id="pcKMax" value="12" min="2" max="30" style="width:50px;font-size:11px"></label>' +
    '<button id="pcRun" class="suc" style="font-size:11px" onclick="pcRun()" disabled>&#9654; Cluster checked recordings</button>' +
    '<button id="pcLabel" style="font-size:11px" onclick="pcApplyLabels()" disabled title="Write \'cluster N\' into the label of each selection of the active recording.">Label selections</button>' +
    '<button id="pcExport" style="font-size:11px" onclick="pcExport()" disabled>&#11015; Export (Excel)</button>' +
    "</div>" +
    '<div id="pcStatus" style="font-size:11px;color:var(--txt2);margin-top:4px">Check recordings in the Loaded Audio list (or leave none checked to use the active one).</div></div>' +
    '<div id="pcResults" style="display:none;max-width:1250px;flex-direction:column;gap:8px">' +
    '<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--txt2)">' +
    '<label class="chk" title="How the 1536 numbers per unit are folded into 3D. PCA is instant and keeps global layout; UMAP and t-SNE separate groups more clearly but take longer.">Projection <select id="pcProjSel" style="font-size:11px" onchange="pcChooseProjection(this.value)"><option value="pca">PCA</option><option value="umap">UMAP</option><option value="tsne">t-SNE</option></select></label>' +
    '<label class="chk" title="What the dot colours show. Cluster colours come from the clustering; the others help check whether a cluster really is a species or just a recording condition.">Colour by <select id="pcColorSel" style="font-size:11px" onchange="pcColorBy=this.value; pcDraw()"><option value="cluster">Cluster</option><option value="recording">Recording</option><option value="rate">Sample rate</option><option value="species">Species</option></select></label>' +
    '<button style="font-size:11px" onclick="pcResetView()">Reset view</button></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch">' +
    '<div class="panel" style="flex:1 1 560px;min-width:0"><canvas id="pcCanvas" style="width:100%;height:460px;display:block;cursor:grab;touch-action:none"></canvas>' +
    '<div id="pcLegend" style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--txt2);margin-top:4px"></div></div>' +
    '<div class="panel" style="flex:1 1 380px;min-width:0"><div style="font-size:11px;color:var(--txt2);margin-bottom:4px">Spectrogram of the selected point</div>' +
    '<canvas id="pcSpec" style="width:100%;height:260px;display:block;background:#0c0728"></canvas>' +
    '<div id="pcSpecCap" style="font-size:11px;color:var(--txt2);margin-top:4px">Click a point (or a table row).</div></div></div>' +
    '<div class="panel" style="max-height:300px;overflow:auto"><table class="dtable"><thead><tr><th>#</th><th>Recording</th><th>Start (s)</th><th>End (s)</th><th>Cluster</th><th>kHz</th><th>Species</th></tr></thead><tbody id="pcBody"></tbody></table></div>' +
    "</div>";
  pcInit3D();
  window.addEventListener("resize", () => {
    if (!pcUnits.length) return;
    pcDraw();
    if (pcSel >= 0) pcDrawSpec(pcUnits[pcSel]);
  });
  pcRefreshButtons();
}
function pcRefreshButtons() {
  const run = document.getElementById("pcRun");
  if (run) run.disabled = !pcSession;
  const has = pcUnits.length > 0;
  const lab = document.getElementById("pcLabel");
  if (lab) lab.disabled = !has || !pcUnits.some((u) => u.kind === "selection" && u.recId === audioLibActiveId);
  const ex = document.getElementById("pcExport");
  if (ex) ex.disabled = !has;
}
function pcSetStatus(t, err) {
  const s = document.getElementById("pcStatus");
  if (s) {
    s.textContent = t;
    s.style.color = err ? "#f85149" : "var(--txt2)";
  }
}
function pcColor(c, k) {
  return "hsl(" + Math.round((c * 360) / Math.max(1, k)) + ",65%,55%)";
}

// ── model ────────────────────────────────────────────────────────────
async function pcLoadModel(file) {
  if (!file) return;
  const st = document.getElementById("pcModelStatus");
  if (typeof ort === "undefined") {
    st.textContent = "onnxruntime-web is missing (vendor/ort).";
    return;
  }
  try {
    st.textContent = "Loading " + file.name + "…";
    // Absolute URLs: a relative path is read as a bare module specifier by the
    // dynamic import inside onnxruntime-web and fails to resolve.
    const base = new URL("vendor/ort/", document.baseURI).href;
    ort.env.wasm.wasmPaths = {
      mjs: base + "ort-wasm-simd-threaded.mjs",
      wasm: base + "ort-wasm-simd-threaded.wasm",
    };
    ort.env.wasm.numThreads = 1;
    const buf = new Uint8Array(await file.arrayBuffer());
    pcSession = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
    pcModelName = file.name;
    st.textContent =
      "Loaded " + file.name + " — input: " + pcSession.inputNames.join(", ") + "; outputs: " + pcSession.outputNames.join(", ");
  } catch (e) {
    pcSession = null;
    st.textContent = "Could not load the model: " + e.message;
  }
  pcRefreshButtons();
}

// One 5 s window (Float32Array, PC_WIN long) -> Float32Array(1536)
async function pcEmbedWindow(win) {
  // Same as perch-hoplite: remove the mean, then scale the peak to 0.25.
  let mean = 0;
  for (let i = 0; i < win.length; i++) mean += win[i] / win.length;
  let peak = 0;
  for (let i = 0; i < win.length; i++) {
    const a = Math.abs(win[i] - mean);
    if (a > peak) peak = a;
  }
  const x = new Float32Array(win.length);
  const g = peak > 1e-9 ? 0.25 / peak : 1;
  for (let i = 0; i < win.length; i++) x[i] = (win[i] - mean) * g;
  const name = pcSession.inputNames[0];
  let out;
  try {
    out = await pcSession.run({ [name]: new ort.Tensor("float32", x, [1, PC_WIN]) });
  } catch (e) {
    out = await pcSession.run({ [name]: new ort.Tensor("float32", x, [1, PC_WIN, 1]) });
  }
  let best = null;
  pcSession.outputNames.forEach((n) => {
    const t = out[n];
    if (!t || !t.dims || !t.dims.includes(PC_DIM)) return;
    // Prefer the plain "embedding" output over "spatial_embedding".
    if (!best || n === "embedding" || (/embed/i.test(n) && !/spatial/i.test(n))) best = t;
  });
  if (!best)
    throw new Error(
      "No " + PC_DIM + "-d embedding among the outputs: " +
        pcSession.outputNames.map((n) => n + " [" + (out[n] ? out[n].dims : "?") + "]").join(", "),
    );
  // Mean over every axis but the last (handles (1,1536) and (1,5,3,1536)).
  const d = best.data,
    emb = new Float32Array(PC_DIM),
    rows = d.length / PC_DIM;
  for (let r = 0; r < rows; r++) for (let j = 0; j < PC_DIM; j++) emb[j] += d[r * PC_DIM + j] / rows;
  return emb;
}

// Samples at srcRate -> Float32Array at 32 kHz (after the slow-down factor).
function pcTo32k(seg, srcRate, slow) {
  const eff = srcRate / slow;
  if (Math.abs(eff - PC_SR) < 1) return seg;
  if (eff > PC_SR) return applyResample(seg, eff, PC_SR);
  const outLen = Math.max(1, Math.round((seg.length * PC_SR) / eff));
  return _resampleLinear(seg, eff / PC_SR, outLen);
}
// 32 kHz segment -> list of PC_WIN windows (short ones are repeated).
function pcWindows(seg) {
  const wins = [];
  if (seg.length <= PC_WIN) {
    const w = new Float32Array(PC_WIN);
    for (let i = 0; i < PC_WIN; i++) w[i] = seg[i % seg.length];
    return [w];
  }
  for (let s = 0; s < seg.length; s += PC_WIN) {
    const part = seg.subarray(s, Math.min(seg.length, s + PC_WIN));
    if (part.length < PC_SR && wins.length) break; // drop a <1 s remainder
    const w = new Float32Array(PC_WIN);
    for (let i = 0; i < PC_WIN; i++) w[i] = part[i % part.length];
    wins.push(w);
  }
  return wins;
}

// ── run ──────────────────────────────────────────────────────────────
async function pcRun() {
  if (!pcSession) return;
  const slow = Math.max(1, parseFloat(document.getElementById("pcSlow").value) || 1);
  let ids = audioLibBatchSelected && audioLibBatchSelected.size ? [...audioLibBatchSelected] : [audioLibActiveId];
  ids = ids.filter((i) => i !== null && i !== undefined);
  if (!ids.length) {
    pcSetStatus("Load audio first.", true);
    return;
  }

  // 1. Plan the units.
  const plan = [];
  ids.forEach((id) => {
    const entry = audioLibrary.find((e) => e.id === id);
    if (!entry) return;
    const live = id === audioLibActiveId && rawSamples;
    const samples = live ? rawSamples : entry.samples,
      sr = live ? sampleRate : entry.rate;
    if (!samples) return;
    if (live && annotations.length) {
      annotations.forEach((a) => {
        if (a.end > a.start) plan.push({ entry, samples, sr, start: a.start, end: a.end, kind: "selection", aid: a.id });
      });
    } else {
      const dur = samples.length / sr,
        step = 5 * slow; // 5 s of the slowed-down sound
      for (let s = 0; s < dur; s += step) {
        if (dur - s < slow && s > 0) break;
        plan.push({ entry, samples, sr, start: s, end: Math.min(dur, s + step), kind: "window" });
      }
    }
  });
  if (plan.length < 2) {
    pcSetStatus("Need at least 2 units to cluster (got " + plan.length + ").", true);
    return;
  }
  if (plan.length > PC_MAX_UNITS) {
    pcSetStatus(plan.length + " units is more than the " + PC_MAX_UNITS + " limit; check fewer recordings.", true);
    return;
  }

  // 2. Embed.
  const units = [];
  let failed = null;
  try {
    await withBusy(
      "Embedding with Perch 2.0…",
      async (progress) => {
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i];
          progress("Embedding " + (i + 1) + " / " + plan.length + " (" + p.entry.name + ")", i / plan.length);
          await busyTick();
          const a = Math.max(0, Math.floor(p.start * p.sr)),
            b = Math.min(p.samples.length, Math.ceil(p.end * p.sr));
          if (b - a < 2) continue;
          const seg = pcTo32k(p.samples.subarray(a, b), p.sr, slow);
          const wins = pcWindows(seg);
          const mean = new Float32Array(PC_DIM);
          for (const w of wins) {
            const e = await pcEmbedWindow(w);
            for (let j = 0; j < PC_DIM; j++) mean[j] += e[j] / wins.length;
          }
          units.push({ rec: p.entry.name, recId: p.entry.id, rate: p.sr, species: p.entry.species || "", start: p.start, end: p.end, kind: p.kind, aid: p.aid, emb: mean });
        }
      },
      { cancellable: true },
    );
  } catch (e) {
    failed = e;
  }
  if (failed) {
    pcSetStatus("Embedding failed: " + failed.message, true);
    return;
  }
  if (busyWasCancelled) {
    pcSetStatus("Cancelled.");
    return;
  }
  if (units.length < 2) {
    pcSetStatus("Fewer than 2 usable units.", true);
    return;
  }

  // 3. Cluster + project.
  const kFixed = parseInt(document.getElementById("pcK").value, 10) || 0;
  const kMax = Math.max(2, parseInt(document.getElementById("pcKMax").value, 10) || 12);
  const res = await withBusy("Clustering…", async () => {
    await busyPaint();
    return pcCluster(units.map((u) => u.emb), kFixed, kMax);
  });
  const embs = units.map((u) => u.emb);
  pcPcaRaw = pcPca(embs, 3);
  pcNormEmb = pcNormalise(embs);
  pcProj = { pca: pcFit(pcPcaRaw) };
  pcMethod = "pca";
  document.getElementById("pcProjSel").value = "pca";
  units.forEach((u, i) => (u.cluster = res.labels[i]));
  pcUnits = units;
  pcInfo = { k: res.k, silhouette: res.silhouette };
  pcSel = -1;
  document.getElementById("pcResults").style.display = "flex";
  pcSetStatus(
    units.length + " units in " + res.k + " clusters" + (kFixed ? "" : " (chosen automatically)") +
      (isFinite(res.silhouette) ? ", silhouette " + res.silhouette.toFixed(2) : "") +
      ". Click a point to hear it and see its spectrogram.",
  );
  pcRenderTable();
  pcDraw();
  pcRefreshButtons();
}

// ── clustering maths ─────────────────────────────────────────────────
function pcNormalise(embs) {
  return embs.map((e) => {
    let n = 0;
    for (let j = 0; j < e.length; j++) n += e[j] * e[j];
    n = Math.sqrt(n) || 1;
    const o = new Float32Array(e.length);
    for (let j = 0; j < e.length; j++) o[j] = e[j] / n;
    return o;
  });
}
// Average-linkage agglomerative clustering on cosine distance. Returns the
// merge list; cutting it at k gives the clusters.
function pcCluster(embs, kFixed, kMax) {
  const X = pcNormalise(embs),
    N = X.length;
  const D = new Float32Array(N * N);
  const P = X[0].length;
  for (let i = 0; i < N; i++) {
    const a = X[i];
    for (let j = i + 1; j < N; j++) {
      const b = X[j];
      let d = 0;
      for (let t = 0; t < P; t++) d += a[t] * b[t];
      D[i * N + j] = D[j * N + i] = 1 - d;
    }
  }
  const W = Float32Array.from(D),
    size = new Float64Array(N).fill(1),
    alive = new Uint8Array(N).fill(1),
    id = Array.from({ length: N }, (_, i) => i), // cluster node id held by slot
    merges = [];
  // Nearest-neighbour cache: average linkage is reducible, so a row only needs
  // rescanning when its nearest neighbour was one of the two merged clusters.
  const nn = new Int32Array(N),
    nnd = new Float32Array(N);
  const rescan = (i) => {
    let bj = -1,
      bd = Infinity;
    for (let j = 0; j < N; j++)
      if (alive[j] && j !== i && W[i * N + j] < bd) {
        bd = W[i * N + j];
        bj = j;
      }
    nn[i] = bj;
    nnd[i] = bd;
  };
  for (let i = 0; i < N; i++) rescan(i);
  for (let step = 0; step < N - 1; step++) {
    let bi = -1,
      bd = Infinity;
    for (let i = 0; i < N; i++) if (alive[i] && nnd[i] < bd) {
      bd = nnd[i];
      bi = i;
    }
    let bj = nn[bi];
    if (bj < bi) [bi, bj] = [bj, bi];
    merges.push([id[bi], id[bj]]);
    for (let k = 0; k < N; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const d = (size[bi] * W[bi * N + k] + size[bj] * W[bj * N + k]) / (size[bi] + size[bj]);
      W[bi * N + k] = W[k * N + bi] = d;
    }
    size[bi] += size[bj];
    alive[bj] = 0;
    id[bi] = N + step;
    rescan(bi);
    for (let k = 0; k < N; k++) {
      if (!alive[k] || k === bi) continue;
      if (nn[k] === bi || nn[k] === bj) rescan(k);
      else if (W[k * N + bi] < nnd[k]) {
        nn[k] = bi;
        nnd[k] = W[k * N + bi];
      }
    }
  }
  const cut = (k) => {
    const parent = Array.from({ length: 2 * N }, (_, i) => i);
    const find = (a) => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    for (let s = 0; s < N - k; s++) {
      parent[find(merges[s][0])] = N + s;
      parent[find(merges[s][1])] = N + s;
    }
    const map = new Map();
    return Array.from({ length: N }, (_, i) => {
      const r = find(i);
      if (!map.has(r)) map.set(r, map.size);
      return map.get(r);
    });
  };
  const silhouette = (lab, k) => {
    const cnt = new Array(k).fill(0);
    lab.forEach((l) => cnt[l]++);
    let tot = 0;
    for (let i = 0; i < N; i++) {
      const sum = new Float64Array(k);
      for (let j = 0; j < N; j++) if (j !== i) sum[lab[j]] += D[i * N + j];
      if (cnt[lab[i]] < 2) continue; // singleton: silhouette 0
      const a = sum[lab[i]] / (cnt[lab[i]] - 1);
      let b = Infinity;
      for (let c = 0; c < k; c++) if (c !== lab[i] && cnt[c]) b = Math.min(b, sum[c] / cnt[c]);
      tot += (b - a) / Math.max(a, b || 1e-9);
    }
    return tot / N;
  };
  if (kFixed >= 1) {
    const k = Math.min(kFixed, N);
    const labels = cut(k);
    return { labels, k, silhouette: k > 1 ? silhouette(labels, k) : NaN };
  }
  let best = { labels: cut(2), k: 2, silhouette: -Infinity };
  best.silhouette = silhouette(best.labels, 2);
  for (let k = 3; k <= Math.min(kMax, N - 1); k++) {
    const labels = cut(k),
      s = silhouette(labels, k);
    if (s > best.silhouette) best = { labels, k, silhouette: s };
  }
  return best;
}
// Principal components by power iteration (nc = 2 or 3).
function pcPca(embs, nc) {
  const X = pcNormalise(embs),
    N = X.length,
    P = X[0].length,
    mu = new Float64Array(P);
  for (let i = 0; i < N; i++) for (let j = 0; j < P; j++) mu[j] += X[i][j] / N;
  const C = X.map((r) => {
    const o = new Float64Array(P);
    for (let j = 0; j < P; j++) o[j] = r[j] - mu[j];
    return o;
  });
  const comps = [];
  for (let c = 0; c < nc; c++) {
    let v = new Float64Array(P);
    for (let j = 0; j < P; j++) v[j] = Math.sin(j * 12.9898 + c * 78.233);
    for (let it = 0; it < 60; it++) {
      const nv = new Float64Array(P);
      for (let i = 0; i < N; i++) {
        const r = C[i];
        let t = 0;
        for (let j = 0; j < P; j++) t += r[j] * v[j];
        for (let j = 0; j < P; j++) nv[j] += r[j] * t;
      }
      let n = 0;
      for (let j = 0; j < P; j++) n += nv[j] * nv[j];
      n = Math.sqrt(n) || 1;
      for (let j = 0; j < P; j++) nv[j] /= n;
      v = nv;
    }
    comps.push(v);
    for (let i = 0; i < N; i++) {
      const r = C[i];
      let p = 0;
      for (let j = 0; j < P; j++) p += r[j] * v[j];
      for (let j = 0; j < P; j++) r[j] -= p * v[j];
    }
  }
  return X.map((r) =>
    comps.map((v) => {
      let s = 0;
      for (let j = 0; j < P; j++) s += (r[j] - mu[j]) * v[j];
      return s;
    }),
  );
}

// ── t-SNE (exact, 3 output dimensions) ───────────────────────────────
// X: unit-length embeddings; init: PCA coordinates (makes the layout
// reproducible). Runs on the UI thread, yielding every few iterations so the
// progress bar repaints and Cancel can be heard.
async function pcTsne(X, init, progress) {
  const N = X.length,
    P = X[0].length;
  const D = new Float32Array(N * N); // squared Euclidean distance
  for (let i = 0; i < N; i++) {
    const a = X[i];
    for (let j = i + 1; j < N; j++) {
      const b = X[j];
      let d = 0;
      for (let t = 0; t < P; t++) d += a[t] * b[t];
      D[i * N + j] = D[j * N + i] = Math.max(0, 2 - 2 * d);
    }
  }
  const perp = Math.min(30, Math.max(2, (N - 1) / 3)),
    target = Math.log(perp),
    Pm = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    let beta = 1,
      lo = 0,
      hi = Infinity;
    for (let it = 0; it < 60; it++) {
      let sp = 0,
        sdp = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const p = Math.exp(-D[i * N + j] * beta);
        sp += p;
        sdp += D[i * N + j] * p;
      }
      sp = sp || 1e-12;
      const diff = Math.log(sp) + (beta * sdp) / sp - target;
      if (Math.abs(diff) < 1e-5) break;
      if (diff > 0) {
        lo = beta;
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
      } else {
        hi = beta;
        beta = (beta + lo) / 2;
      }
    }
    let sp = 0;
    for (let j = 0; j < N; j++) if (j !== i) sp += Math.exp(-D[i * N + j] * beta);
    sp = sp || 1e-12;
    for (let j = 0; j < N; j++) if (j !== i) Pm[i * N + j] = Math.exp(-D[i * N + j] * beta) / sp;
  }
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++)
      Pm[i * N + j] = Pm[j * N + i] = Math.max((Pm[i * N + j] + Pm[j * N + i]) / (2 * N), 1e-12);

  // Start from the PCA layout, shrunk to a tiny cloud.
  const Y = new Float64Array(N * 3),
    vel = new Float64Array(N * 3),
    gain = new Float64Array(N * 3).fill(1),
    grad = new Float64Array(N * 3),
    num = new Float32Array(N * N);
  let sd = 0;
  init.forEach((r) => r.forEach((v) => (sd += v * v)));
  sd = Math.sqrt(sd / (N * 3)) || 1;
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) Y[i * 3 + c] = (init[i][c] / sd) * 1e-2;
  const ITERS = 600,
    EXAG_UNTIL = 250,
    lr = Math.max(200, N / 12);
  for (let it = 0; it < ITERS; it++) {
    const ex = it < EXAG_UNTIL ? 12 : 1,
      mom = it < EXAG_UNTIL ? 0.5 : 0.8;
    let Z = 0;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      for (let j = i + 1; j < N; j++) {
        const j3 = j * 3,
          dx = Y[i3] - Y[j3],
          dy = Y[i3 + 1] - Y[j3 + 1],
          dz = Y[i3 + 2] - Y[j3 + 2],
          q = 1 / (1 + dx * dx + dy * dy + dz * dz);
        num[i * N + j] = q;
        Z += 2 * q;
      }
    }
    grad.fill(0);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      for (let j = i + 1; j < N; j++) {
        const j3 = j * 3,
          q = num[i * N + j],
          m = 4 * (ex * Pm[i * N + j] - q / Z) * q,
          dx = Y[i3] - Y[j3],
          dy = Y[i3 + 1] - Y[j3 + 1],
          dz = Y[i3 + 2] - Y[j3 + 2];
        grad[i3] += m * dx;
        grad[i3 + 1] += m * dy;
        grad[i3 + 2] += m * dz;
        grad[j3] -= m * dx;
        grad[j3 + 1] -= m * dy;
        grad[j3 + 2] -= m * dz;
      }
    }
    const mean = [0, 0, 0];
    for (let k = 0; k < N * 3; k++) {
      const g = grad[k];
      gain[k] = Math.sign(g) === Math.sign(vel[k]) ? gain[k] * 0.8 : gain[k] + 0.2;
      if (gain[k] < 0.01) gain[k] = 0.01;
      vel[k] = mom * vel[k] - lr * gain[k] * g;
      Y[k] += vel[k];
      mean[k % 3] += Y[k] / N;
    }
    for (let k = 0; k < N * 3; k++) Y[k] -= mean[k % 3];
    if (it % 5 === 0) {
      progress("t-SNE iteration " + (it + 1) + " / " + ITERS, it / ITERS);
      await busyTick();
    }
  }
  return Array.from({ length: N }, (_, i) => [Y[i * 3], Y[i * 3 + 1], Y[i * 3 + 2]]);
}

async function pcUmap(X, progress) {
  const Ctor = typeof UMAP !== "undefined" && (UMAP.UMAP || UMAP);
  if (typeof Ctor !== "function") throw new Error("UMAP library is missing (vendor/umap).");
  if (X.length < 6) throw new Error("UMAP needs at least 6 units.");
  let s = 42;
  const random = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const um = new Ctor({ nComponents: 3, nNeighbors: Math.min(15, X.length - 1), minDist: 0.1, random });
  const out = await um.fitAsync(
    X.map((a) => Array.from(a)),
    (epoch) => {
      progress("UMAP epoch " + epoch + " / " + um.getNEpochs(), um.getNEpochs() ? epoch / um.getNEpochs() : 0);
      if (_busyCancel) return false;
    },
  );
  if (_busyCancel) throw new BusyCancelled();
  return out;
}

// Centre on the bounding box and scale into [-1, 1] (same scale on all axes).
function pcFit(xyz) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  xyz.forEach((p) =>
    p.forEach((v, c) => {
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }),
  );
  const half = Math.max(...hi.map((h, c) => (h - lo[c]) / 2)) || 1;
  return xyz.map((p) => p.map((v, c) => (v - (lo[c] + hi[c]) / 2) / half));
}

// ── projection choice ────────────────────────────────────────────────
async function pcChooseProjection(m) {
  if (!pcUnits.length) return;
  if (!pcProj[m]) {
    let got;
    try {
      got = await withBusy(
        (m === "umap" ? "UMAP" : "t-SNE") + "…",
        async (progress) => {
          await busyPaint();
          return m === "umap" ? await pcUmap(pcNormEmb, progress) : await pcTsne(pcNormEmb, pcPcaRaw, progress);
        },
        { cancellable: true },
      );
    } catch (e) {
      pcSetStatus((m === "umap" ? "UMAP" : "t-SNE") + " failed: " + e.message, true);
    }
    if (!got || busyWasCancelled) {
      document.getElementById("pcProjSel").value = pcMethod;
      return;
    }
    pcProj[m] = pcFit(got);
  }
  pcMethod = m;
  document.getElementById("pcProjSel").value = m;
  pcDraw();
}

// ── colour by ────────────────────────────────────────────────────────
function pcCategories() {
  const by = pcColorBy;
  const keyOf = (u) =>
    by === "cluster"
      ? "cluster " + (u.cluster + 1)
      : by === "recording"
        ? u.rec
        : by === "rate"
          ? (u.rate / 1000).toFixed(1) + " kHz"
          : u.species || "(no species)";
  const keys = pcUnits.map(keyOf),
    count = new Map();
  keys.forEach((k) => count.set(k, (count.get(k) || 0) + 1));
  const order = [...count.keys()].sort((a, b) =>
    by === "cluster" ? parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10) : count.get(b) - count.get(a),
  );
  const color = new Map();
  order.forEach((k, i) =>
    color.set(
      k,
      by === "cluster" ? pcColor(i, order.length) : "hsl(" + Math.round((i * 137.508) % 360) + ",65%," + (i % 2 ? 62 : 50) + "%)",
    ),
  );
  return { keys, order, count, color };
}

// ── 3D view ──────────────────────────────────────────────────────────
function pcInit3D() {
  const cv = document.getElementById("pcCanvas");
  let drag = null;
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    pcView.yaw += dx * 0.01;
    pcView.pitch = Math.max(-1.55, Math.min(1.55, pcView.pitch + dy * 0.01));
    pcDraw();
  });
  cv.addEventListener("pointerup", (e) => {
    if (drag && drag.moved < 5) pcCanvasClick(e);
    drag = null;
  });
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      pcView.zoom = Math.max(0.4, Math.min(6, pcView.zoom * Math.exp(-e.deltaY * 0.0012)));
      pcDraw();
    },
    { passive: false },
  );
  cv.addEventListener("dblclick", pcResetView);
}
function pcResetView() {
  pcView = { yaw: 0.6, pitch: 0.35, zoom: 1 };
  pcDraw();
}
function pcDraw() {
  const cv = document.getElementById("pcCanvas");
  const xyz = pcProj[pcMethod];
  if (!cv || !pcUnits.length || !xyz) return;
  const dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const cat = pcCategories(),
    cy = Math.cos(pcView.yaw),
    sy = Math.sin(pcView.yaw),
    cp = Math.cos(pcView.pitch),
    sp = Math.sin(pcView.pitch),
    CAM = 3.4,
    scale = (Math.min(w, h) / 2.5) * pcView.zoom;
  const proj = (x, y, z) => {
    const x1 = x * cy + z * sy,
      z1 = -x * sy + z * cy,
      y1 = y * cp - z1 * sp,
      z2 = y * sp + z1 * cp,
      k = CAM / (CAM - z2);
    return { px: w / 2 + x1 * k * scale, py: h / 2 - y1 * k * scale, z: z2, k };
  };
  // Bounding box: gives the eye a frame of reference while rotating.
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push(proj(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1));
  g.strokeStyle = "rgba(140,140,150,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < 8; i++)
    [1, 2, 4].forEach((b) => {
      if (!(i & b)) {
        g.moveTo(corners[i].px, corners[i].py);
        g.lineTo(corners[i | b].px, corners[i | b].py);
      }
    });
  g.stroke();
  const pts = pcUnits.map((u, i) => {
    const p = proj(xyz[i][0], xyz[i][1], xyz[i][2]);
    u._px = p.px;
    u._py = p.py;
    u._pz = p.z;
    u._pr = Math.max(2, 4 * p.k * Math.pow(pcView.zoom, 0.35));
    return i;
  });
  pts.sort((a, b) => pcUnits[a]._pz - pcUnits[b]._pz); // far first
  pts.forEach((i) => {
    const u = pcUnits[i],
      depth = Math.max(0.35, Math.min(1, 0.65 + u._pz * 0.25));
    g.beginPath();
    g.arc(u._px, u._py, i === pcSel ? u._pr + 2.5 : u._pr, 0, 6.283);
    g.globalAlpha = i === pcSel ? 1 : depth;
    g.fillStyle = cat.color.get(cat.keys[i]);
    g.fill();
    g.globalAlpha = 1;
    if (i === pcSel) {
      g.strokeStyle = "#fff";
      g.lineWidth = 2;
      g.stroke();
    }
  });
  g.fillStyle = "rgba(160,160,170,0.8)";
  g.font = "10px sans-serif";
  g.fillText("drag: rotate · wheel: zoom · double-click: reset · click a point: play + spectrogram", 8, h - 8);
  // Legend (largest groups first; long lists are cut).
  const MAXL = 14;
  document.getElementById("pcLegend").innerHTML =
    cat.order
      .slice(0, MAXL)
      .map(
        (k) =>
          '<span><span style="color:' + cat.color.get(k) + '">&#9679;</span> ' + wfEscSafe(k) + " (" + cat.count.get(k) + ")</span>",
      )
      .join("") + (cat.order.length > MAXL ? "<span>+ " + (cat.order.length - MAXL) + " more</span>" : "");
}
function wfEscSafe(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function pcRenderTable() {
  document.getElementById("pcBody").innerHTML = pcUnits
    .slice(0, 1000)
    .map(
      (u, i) =>
        '<tr id="pcRow' + i + '" style="cursor:pointer" onclick="pcSelect(' + i + ')"><td>' + (i + 1) + "</td><td>" +
        wfEscSafe(u.rec) + "</td><td>" + u.start.toFixed(3) + "</td><td>" + u.end.toFixed(3) + "</td><td>" +
        (u.cluster + 1) + "</td><td>" + (u.rate / 1000).toFixed(1) + "</td><td>" + wfEscSafe(u.species || "") + "</td></tr>",
    )
    .join("");
}
function pcCanvasClick(ev) {
  const r = ev.target.getBoundingClientRect(),
    x = ev.clientX - r.left,
    y = ev.clientY - r.top;
  let bi = -1,
    bz = -Infinity;
  pcUnits.forEach((u, i) => {
    const reach = u._pr + 5;
    if ((u._px - x) ** 2 + (u._py - y) ** 2 <= reach * reach && u._pz > bz) {
      bz = u._pz;
      bi = i;
    }
  });
  if (bi >= 0) pcSelect(bi);
}
function pcSelect(i) {
  pcSel = i;
  pcDraw();
  const row = document.getElementById("pcRow" + i);
  document.querySelectorAll("#pcBody tr").forEach((r) => (r.style.background = ""));
  if (row) {
    row.style.background = "var(--bg3, rgba(128,128,128,.25))";
  }
  pcDrawSpec(pcUnits[i]);
  pcPlay(pcUnits[i]);
}

// ── spectrogram of the selected unit ─────────────────────────────────
function pcUnitAudio(u) {
  const live = u.recId === audioLibActiveId && rawSamples;
  const entry = audioLibrary.find((e) => e.id === u.recId);
  const samples = live ? rawSamples : entry && entry.samples,
    sr = live ? sampleRate : entry && entry.rate;
  return samples ? { samples, sr } : null;
}
const PC_CMAP = [
  [0, [12, 7, 40]],
  [0.25, [72, 30, 130]],
  [0.5, [190, 55, 100]],
  [0.75, [250, 150, 40]],
  [1, [252, 250, 190]],
];
function pcCmap(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < PC_CMAP.length; i++)
    if (t <= PC_CMAP[i][0]) {
      const [t0, c0] = PC_CMAP[i - 1],
        [t1, c1] = PC_CMAP[i],
        f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * f);
    }
  return PC_CMAP[PC_CMAP.length - 1][1];
}
function pcDrawSpec(u) {
  const cv = document.getElementById("pcSpec"),
    cap = document.getElementById("pcSpecCap");
  if (!cv) return;
  const au = pcUnitAudio(u);
  if (!au) {
    cap.textContent = "Recording no longer loaded.";
    return;
  }
  const { samples, sr } = au,
    a = Math.max(0, Math.floor(u.start * sr)),
    b = Math.min(samples.length, Math.floor(Math.min(u.end, u.start + 5) * sr)),
    seg = samples.subarray(a, b);
  const nfft = sr > 100000 ? 2048 : 1024,
    hop = Math.max(nfft >> 2, Math.ceil(seg.length / 700)),
    frames = Math.max(1, Math.floor((seg.length - nfft) / hop) + 1),
    bins = nfft / 2,
    win = hannWin(nfft),
    mag = new Float32Array(frames * bins),
    re = new Float32Array(nfft),
    im = new Float32Array(nfft);
  let mx = -Infinity;
  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < nfft; i++) {
      const s = f * hop + i;
      re[i] = s < seg.length ? seg[s] * win[i] : 0;
    }
    fft(re, im, nfft);
    for (let k = 0; k < bins; k++) {
      const db = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
      mag[f * bins + k] = db;
      if (db > mx) mx = db;
    }
  }
  const range = 80,
    off = document.createElement("canvas");
  off.width = frames;
  off.height = bins;
  const og = off.getContext("2d"),
    img = og.createImageData(frames, bins);
  for (let f = 0; f < frames; f++)
    for (let k = 0; k < bins; k++) {
      const c = pcCmap((mag[f * bins + k] - (mx - range)) / range),
        o = ((bins - 1 - k) * frames + f) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  og.putImageData(img, 0, 0);
  const dpr = window.devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const L = 40,
    B = 20,
    T = 6,
    R = 8;
  g.imageSmoothingEnabled = false;
  g.drawImage(off, L, T, w - L - R, h - T - B);
  g.fillStyle = "rgba(170,170,180,0.9)";
  g.font = "10px sans-serif";
  g.strokeStyle = "rgba(170,170,180,0.5)";
  const dur = seg.length / sr,
    nyq = sr / 2000; // kHz
  for (let i = 0; i <= 4; i++) {
    const y = T + ((h - T - B) * (4 - i)) / 4;
    g.fillText(((nyq * i) / 4).toFixed(nyq >= 20 ? 0 : 1), 4, Math.min(h - B - 2, y + 9));
    g.beginPath();
    g.moveTo(L - 3, y);
    g.lineTo(L, y);
    g.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const x = L + ((w - L - R) * i) / 4;
    g.fillText(((dur * i) / 4).toFixed(dur < 1 ? 3 : 2) + (i === 4 ? " s" : ""), Math.min(x - 8, w - 40), h - 6);
  }
  g.save();
  g.translate(10, h / 2);
  g.rotate(-Math.PI / 2);
  g.fillText("kHz", -8, -2);
  g.restore();
  cap.textContent =
    u.rec + " — " + u.start.toFixed(2) + "–" + u.end.toFixed(2) + " s — cluster " + (u.cluster + 1) +
    " — " + (sr / 1000).toFixed(1) + " kHz — FFT " + nfft;
}

function pcPlay(u) {
  const live = u.recId === audioLibActiveId && rawSamples;
  const entry = audioLibrary.find((e) => e.id === u.recId);
  const samples = live ? rawSamples : entry && entry.samples,
    sr = live ? sampleRate : entry && entry.rate;
  if (!samples) return;
  const a = Math.floor(u.start * sr),
    b = Math.min(samples.length, Math.floor(Math.min(u.end, u.start + 5) * sr));
  if (b <= a) return;
  try {
    pcAudioCtx = pcAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = pcAudioCtx.createBuffer(1, b - a, sr);
    buf.copyToChannel(samples.subarray(a, b), 0);
    const src = pcAudioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(pcAudioCtx.destination);
    src.start();
  } catch (e) {
    log("Playback failed: " + e.message, "warn");
  }
}

// ── outputs ──────────────────────────────────────────────────────────
function pcApplyLabels() {
  let n = 0;
  pcUnits.forEach((u) => {
    if (u.kind !== "selection" || u.recId !== audioLibActiveId) return;
    const a = annotations.find((x) => x.id === u.aid);
    if (a) {
      a.label = "cluster " + (u.cluster + 1);
      n++;
    }
  });
  if (typeof refreshAnnotList === "function") refreshAnnotList();
  if (typeof render === "function") render();
  log("Labelled " + n + " selection(s) with their cluster.", "ok");
}
async function pcExport() {
  const rows = pcUnits.map((u, i) => ({
    n: i + 1,
    source_file: u.rec,
    unit: u.kind,
    start: Math.round(u.start * 1e6) / 1e6,
    end: Math.round(u.end * 1e6) / 1e6,
    cluster: u.cluster + 1,
    sample_rate_hz: u.rate,
    species: u.species,
    projection: pcMethod,
    x: Math.round(pcProj[pcMethod][i][0] * 1e5) / 1e5,
    y: Math.round(pcProj[pcMethod][i][1] * 1e5) / 1e5,
    z: Math.round(pcProj[pcMethod][i][2] * 1e5) / 1e5,
  }));
  const info = [
    {
      model: pcModelName,
      units: rows.length,
      clusters: pcInfo.k,
      silhouette: isFinite(pcInfo.silhouette) ? Math.round(pcInfo.silhouette * 1e4) / 1e4 : "",
      slow_down: parseFloat(document.getElementById("pcSlow").value) || 1,
      linkage: "average, cosine distance",
      generated: new Date().toISOString(),
    },
  ];
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_clusters_" + stamp + ".xlsx",
      _buildXlsx([["Clusters", rows], ["Info", info]]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
  } catch (e) {
    log("Cluster export failed: " + e.message, "err");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pcInit);
else pcInit();
