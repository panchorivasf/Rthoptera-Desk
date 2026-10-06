// ═══════════════════════════════════════════════════════════════════
// SUMMARY ANALYSIS — identification: cross-validated test, species
// profiles, knowledge base, comparison.
//
// From Cesare's notes ("metrics-assisted song recognition"):
//   species profile  = for one species, the mean and the spread (SD, with the
//                      full covariance kept too) of each chosen variable over
//                      that species' recordings;
//   knowledge base   = a file of species profiles, one per species;
//   comparison       = take the profile of an unknown recording and ask which
//                      known profiles it sits closest to.
//
// Two ways of measuring "closest", both on the native (not Z-scored) values:
//   Mahalanobis  distance to each species using that species' own variance
//                for every variable (its SD), shrunk toward the pooled
//                variance when the species has few recordings;
//   LDA          distance using the covariance pooled over all species, so
//                correlated variables are not counted twice. With equal
//                priors this is exactly linear discriminant analysis.
// Plus Cesare's first, simplest check: how many variables fall inside the
// species' mean ± 2 SD range.
//
// Because the knowledge base stores only mean, SD, covariance and n, the
// cross-validated test and the comparison use the very same two methods.
// ═══════════════════════════════════════════════════════════════════
(function () {
  const I = window.saInternals;
  if (!I) return;
  const { sa, lab, buildMatrix, tempRule, adjustedVal, specColor, svgEl, mean, sdev } = I;
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const KB_KIND = "rthoptera-species-kb";
  const K0 = 2; // prior strength, in observations, of the pooled variance

  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const f3 = (v) => (v == null || !isFinite(v) ? "—" : String(+Number(v).toPrecision(3)));

  // ── linear algebra ────────────────────────────────────────────────
  function invert(A) {
    const n = A.length;
    const M = A.map((r, i) => r.slice().concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c];
      for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f) for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r) => r.slice(n));
  }

  // ── profiles ──────────────────────────────────────────────────────
  // rows: array of vectors (all the same length p). Returns mean, variance
  // (null for a single row) and the sample covariance (null for a single row).
  function profileOf(name, rows) {
    const n = rows.length,
      p = rows[0].length;
    const mu = Array.from({ length: p }, (_, j) => mean(rows.map((r) => r[j])));
    if (n < 2) return { name, n, mean: mu, sd: null, cov: null };
    const cov = Array.from({ length: p }, () => new Array(p).fill(0));
    rows.forEach((r) => {
      for (let a = 0; a < p; a++) for (let b = a; b < p; b++) cov[a][b] += (r[a] - mu[a]) * (r[b] - mu[b]);
    });
    for (let a = 0; a < p; a++)
      for (let b = a; b < p; b++) {
        cov[a][b] /= n - 1;
        cov[b][a] = cov[a][b];
      }
    return { name, n, mean: mu, sd: cov.map((r, j) => Math.sqrt(Math.max(0, r[j]))), cov };
  }

  // A scoring model for a set of profiles restricted to the variables `idx`.
  function makeModel(profiles, idx) {
    const p = idx.length;
    const pr = profiles.map((q) => ({
      name: q.name,
      n: q.n,
      mean: idx.map((j) => q.mean[j]),
      sd: q.sd ? idx.map((j) => q.sd[j]) : null,
      cov: q.cov ? idx.map((a) => idx.map((b) => q.cov[a][b])) : null,
    }));
    let df = 0;
    const poolCov = Array.from({ length: p }, () => new Array(p).fill(0));
    pr.forEach((q) => {
      if (!q.cov) return;
      df += q.n - 1;
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) poolCov[a][b] += (q.n - 1) * q.cov[a][b];
    });
    if (df > 0) for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) poolCov[a][b] /= df;
    else {
      // every species has one recording: fall back on the spread of the means
      for (let a = 0; a < p; a++) {
        const v = sdev(pr.map((q) => q.mean[a])) ** 2 || 1;
        poolCov[a][a] = v;
      }
    }
    const poolVar = poolCov.map((r, j) => Math.max(r[j], 1e-12));
    // Shrink the pooled covariance toward its diagonal; the less data, the more.
    const lam = df >= 5 * p ? 0.1 : df >= p ? 0.4 : 0.8;
    const reg = poolCov.map((r, a) => r.map((v, b) => (a === b ? Math.max(v, 1e-12) : (1 - lam) * v)));
    let inv = invert(reg);
    if (!inv) inv = invert(reg.map((r, a) => r.map((v, b) => (a === b ? v : 0)))); // diagonal fallback
    const sp = pr.map((q) => ({
      name: q.name,
      n: q.n,
      mean: q.mean,
      sd: q.sd,
      // own variance, shrunk toward the pooled one when n is small
      v: q.mean.map((_, j) => {
        const own = q.sd ? q.sd[j] ** 2 : 0;
        const w = q.n - 1;
        return Math.max((w * own + K0 * poolVar[j]) / (w + K0), 1e-12);
      }),
    }));
    return { p, sp, inv, poolVar };
  }

  // Distances of vector x (length p) to every species in the model.
  function classify(model, x) {
    const { p, sp, inv } = model;
    const out = sp.map((q) => {
      let dm = 0,
        inRange = 0;
      const d = x.map((v, j) => v - q.mean[j]);
      for (let j = 0; j < p; j++) {
        dm += (d[j] * d[j]) / q.v[j];
        const sdj = q.sd ? q.sd[j] : Math.sqrt(model.poolVar[j]);
        if (Math.abs(d[j]) <= 2 * sdj) inRange++;
      }
      let dl = 0;
      for (let a = 0; a < p; a++) {
        let s = 0;
        for (let b = 0; b < p; b++) s += inv[a][b] * d[b];
        dl += d[a] * s;
      }
      return { name: q.name, n: q.n, dM: Math.sqrt(dm), dL: Math.sqrt(Math.max(0, dl)), d2L: Math.max(0, dl), inRange };
    });
    // equal-prior posterior from the LDA distance
    const mn = Math.min(...out.map((o) => o.d2L));
    const w = out.map((o) => Math.exp(-(o.d2L - mn) / 2));
    const tot = w.reduce((s, v) => s + v, 0) || 1;
    out.forEach((o, i) => (o.post = w[i] / tot));
    return out;
  }
  const byM = (res) => res.slice().sort((a, b) => a.dM - b.dM);
  const byL = (res) => res.slice().sort((a, b) => a.d2L - b.d2L);

  // ── 1. Leave-one-out test ─────────────────────────────────────────
  async function saCvRun() {
    const { feats, X } = buildMatrix();
    const status = (t, bad) => I.say(t, bad);
    if (feats.length < 2 || X.length < 4) {
      status("Select at least 2 variables and have at least 4 observations first.", true);
      return;
    }
    const labels = sa.samples.map((s) => (s.species === "(no species)" ? null : s.species));
    const leaveSpecimen = $("saCvLeave")?.value === "specimen";
    const names = [...new Set(labels.filter(Boolean))];
    if (names.length < 2) {
      status("The test needs observations from at least 2 species.", true);
      return;
    }
    const idx = feats.map((_, j) => j);
    const res = await withBusy(
      "Leave-one-out test…",
      async () => {
        const preds = []; // { i, truth, mah:[names ranked], lda:[names ranked] }
        let skipped = 0;
        for (let i = 0; i < X.length; i++) {
          await busyYield();
          if (!labels[i]) continue;
          const train = [];
          for (let j = 0; j < X.length; j++) {
            if (j === i || !labels[j]) continue;
            if (leaveSpecimen && sa.samples[i].specimen && sa.samples[j].specimen === sa.samples[i].specimen) continue;
            train.push(j);
          }
          const groups = new Map();
          train.forEach((j) => {
            if (!groups.has(labels[j])) groups.set(labels[j], []);
            groups.get(labels[j]).push(X[j]);
          });
          if (!groups.has(labels[i]) || groups.size < 2) {
            skipped++;
            continue;
          }
          const model = makeModel([...groups].map(([nm, rows]) => profileOf(nm, rows)), idx);
          const r = classify(model, X[i]);
          preds.push({ i, truth: labels[i], mah: byM(r).map((o) => o.name), lda: byL(r).map((o) => o.name) });
        }
        return { preds, skipped };
      },
      { cancellable: true },
    );
    if (!res) {
      status("Test cancelled.", true);
      return;
    }
    renderCv(res, names, feats.length, leaveSpecimen);
    status("Leave-one-out test done: " + res.preds.length + " observation(s) tested.");
  }

  function renderCv({ preds, skipped }, names, p, leaveSpecimen) {
    const host = $("saCvOut");
    if (!host) return;
    if (!preds.length) {
      host.textContent = "No observation could be tested: every species needs at least 2 observations (from different specimens if you leave out whole specimens).";
      return;
    }
    const K = names.length;
    const acc = (key, topN) => preds.filter((q) => q[key].slice(0, topN).includes(q.truth)).length / preds.length;
    const per = new Map();
    const mix = { mah: new Map(), lda: new Map() };
    preds.forEach((q) => {
      if (!per.has(q.truth)) per.set(q.truth, { n: 0, m: 0, l: 0 });
      const o = per.get(q.truth);
      o.n++;
      if (q.mah[0] === q.truth) o.m++;
      else mix.mah.set(q.truth + " → " + q.mah[0], (mix.mah.get(q.truth + " → " + q.mah[0]) || 0) + 1);
      if (q.lda[0] === q.truth) o.l++;
      else mix.lda.set(q.truth + " → " + q.lda[0], (mix.lda.get(q.truth + " → " + q.lda[0]) || 0) + 1);
    });
    const pct = (v) => (v * 100).toFixed(0) + "%";
    const top = (m) =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, c]) => esc(k) + " (" + c + ")")
        .join("<br>") || "none";
    host.innerHTML =
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:6px">' +
      preds.length + " observation(s) tested, each classified from the profiles of all the others" +
      (leaveSpecimen ? " (all recordings of the same specimen left out together)" : "") +
      ", " + p + " variables, " + K + " species" +
      (skipped ? "; " + skipped + " could not be tested (only one observation of that species)" : "") +
      ". Chance would be " + pct(1 / K) + ".</div>" +
      '<table class="dtable"><thead><tr><th>Method</th><th>Correct</th><th>In top 3</th></tr></thead><tbody>' +
      "<tr><td>Mahalanobis (each species' own variance)</td><td><b>" + pct(acc("mah", 1)) + "</b></td><td>" + pct(acc("mah", 3)) + "</td></tr>" +
      "<tr><td>LDA (pooled covariance)</td><td><b>" + pct(acc("lda", 1)) + "</b></td><td>" + pct(acc("lda", 3)) + "</td></tr></tbody></table>" +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px"><div>' +
      '<table class="dtable"><thead><tr><th>Species</th><th>Tested</th><th>Mahalanobis</th><th>LDA</th></tr></thead><tbody>' +
      [...per]
        .sort((a, b) => b[1].l / b[1].n - a[1].l / a[1].n)
        .map(([nm, o]) => "<tr><td>" + esc(nm) + "</td><td>" + o.n + "</td><td>" + pct(o.m / o.n) + "</td><td>" + pct(o.l / o.n) + "</td></tr>")
        .join("") +
      '</tbody></table></div><div style="font-size:11px;color:var(--txt2)"><b>Most frequent mix-ups</b><br>' +
      "<u>LDA</u><br>" + top(mix.lda) + "<br><u>Mahalanobis</u><br>" + top(mix.mah) + "</div></div>";
  }

  // ── 2. Species profiles → knowledge base ──────────────────────────
  let profiles = null; // { feats, list: [profile] }
  let kb = null; // loaded or last-saved knowledge base

  function saProfilesExtract() {
    const { feats, X } = buildMatrix();
    if (feats.length < 2) {
      I.say("Select at least 2 variables first.", true);
      return;
    }
    const groups = new Map();
    sa.samples.forEach((s, i) => {
      if (s.species === "(no species)" || !sa.selSp.has(s.species)) return;
      if (!groups.has(s.species)) groups.set(s.species, []);
      groups.get(s.species).push(i);
    });
    if (!groups.size) {
      I.say("No species ticked under Species shown (or the observations carry no species tag).", true);
      return;
    }
    const list = [...groups].map(([nm, ix]) => {
      const q = profileOf(nm, ix.map((i) => X[i]));
      q.observations = ix.map((i) => sa.samples[i].label);
      q.sources = ix.map((i) => sa.samples[i].key);
      q.original_names = [...new Set(ix.map((i) => sa.samples[i].base))];
      return q;
    });
    // A loaded knowledge base that was temperature-adjusted fixes the rule for
    // everything added to it; otherwise the rule currently set in the tab applies.
    let rule = tempRule();
    let tempNote = "";
    if (kb && kb.temperature) {
      rule = { ref: kb.temperature.ref_c, slopes: new Map(Object.entries(kb.temperature.slopes)) };
      tempNote = " Temperature adjusted to " + rule.ref + " °C with the loaded knowledge base's slopes.";
    } else if (rule) tempNote = " Temperature adjusted to " + rule.ref + " °C.";
    // rebuild the matrix under that rule (it may differ from the tab's)
    const X2 = sa.samples.map((s) => feats.map((f) => adjustedVal(s, f.id, rule)));
    const colMean = feats.map((_, j) => mean(X2.map((r) => r[j]).filter((v) => v != null)));
    const Xr = X2.map((r) => r.map((v, j) => (v == null ? colMean[j] : v)));
    list.length = 0;
    groups.forEach((ix, nm) => {
      const q = profileOf(nm, ix.map((i) => Xr[i]));
      q.observations = ix.map((i) => sa.samples[i].label);
      q.sources = ix.map((i) => sa.samples[i].key);
      q.original_names = [...new Set(ix.map((i) => sa.samples[i].base))];
      list.push(q);
    });
    profiles = { feats, list, rule };
    renderProfiles();
    $("btnSaKbSave").disabled = false;
    I.say("Extracted " + list.length + " species profile(s) from " + feats.length + " variables." + tempNote);
  }

  function renderProfiles() {
    const host = $("saProfilesOut");
    if (!host || !profiles) return;
    const { feats, list } = profiles;
    host.innerHTML =
      '<div style="overflow:auto;max-height:260px"><table class="dtable"><thead><tr><th>Species</th><th>n</th>' +
      feats.map((f) => "<th>" + esc(f.col) + "</th>").join("") +
      "</tr></thead><tbody>" +
      list
        .map(
          (q) =>
            "<tr><td>" + esc(q.name) + "</td><td>" + q.n + "</td>" +
            q.mean.map((m, j) => "<td>" + f3(m) + (q.sd ? " ± " + f3(q.sd[j]) : "") + "</td>").join("") +
            "</tr>",
        )
        .join("") +
      "</tbody></table></div>" +
      (list.some((q) => q.n < 2)
        ? '<div style="font-size:11px;color:#d29922;margin-top:4px">Species with a single recording have no spread; they borrow the pooled variance when compared.</div>'
        : "");
  }

  // The names that were in force when a knowledge base was made, so they
  // are not lost: which file names became which labels, and which species tags
  // were renamed or reassigned.
  const namesSnapshot = () => ({
    species: Object.fromEntries(lab.sp),
    recordings: Object.fromEntries(lab.obs),
    recordingSpecies: Object.fromEntries(lab.obsSp),
  });

  async function saKbSave() {
    if (!profiles && kb) {
      // nothing new extracted: save the loaded knowledge base as it now stands (e.g. after renaming)
      const nm = ($("saKbName")?.value || "").trim() || kb.name || "knowledge_base";
      kb = { ...kb, name: nm, updated: new Date().toISOString() };
      await dlFile(nm.replace(/[^\w.-]+/g, "_") + ".kb.json", JSON.stringify(kb, null, 1), "application/json", { exactName: true });
      renderKbInfo();
      I.say("Knowledge base “" + nm + "” saved: " + kb.species.length + " species.");
      return;
    }
    if (!profiles) {
      I.say("Extract the species profiles first.", true);
      return;
    }
    const ids = profiles.feats.map((f) => f.id);
    const name = ($("saKbName")?.value || "").trim() || (kb ? kb.name : "knowledge_base");
    let out;
    let note = "";
    const sameVars = kb && kb.indicators.length === ids.length && kb.indicators.every((k) => ids.includes(k.id));
    // Adjusted and unadjusted profiles cannot share a knowledge base.
    const same = sameVars && !!kb.temperature === !!profiles.rule;
    if (kb && same) {
      // merge into the loaded knowledge base, in ITS variable order
      const order = kb.indicators.map((k) => ids.indexOf(k.id));
      const incoming = profiles.list.map((q) => ({
        name: q.name,
        n: q.n,
        mean: order.map((j) => q.mean[j]),
        sd: q.sd ? order.map((j) => q.sd[j]) : null,
        cov: q.cov ? order.map((a) => order.map((b) => q.cov[a][b])) : null,
        observations: q.observations,
        sources: q.sources,
        original_names: q.original_names,
      }));
      const kept = kb.species.filter((s) => !incoming.some((q) => q.name === s.name));
      out = {
        ...kb,
        name,
        species: kept.concat(incoming),
        updated: new Date().toISOString(),
        names: { ...(kb.names || {}), ...namesSnapshot() },
      };
      note = " (" + incoming.length + " added or replaced, " + kept.length + " kept)";
    } else {
      if (kb && !same)
        note = sameVars
          ? " — its temperature adjustment differs from the loaded knowledge base, so this is a NEW one"
          : " — the variables differ from the loaded knowledge base, so this is a NEW one";
      out = {
        kind: KB_KIND,
        version: 1,
        name,
        created: new Date().toISOString(),
        indicators: profiles.feats.map((f) => ({ id: f.id, label: f.label })),
        species: profiles.list.map((q) => ({
          name: q.name, n: q.n, mean: q.mean, sd: q.sd, cov: q.cov,
          observations: q.observations, sources: q.sources, original_names: q.original_names,
        })),
        names: namesSnapshot(),
        ...(profiles.rule
          ? {
              temperature: {
                ref_c: profiles.rule.ref,
                slopes: Object.fromEntries(profiles.rule.slopes),
                note: "value_adjusted = value - slope * (T - ref_c); slopes are per degree C, fitted within species",
              },
            }
          : {}),
      };
    }
    await dlFile(name.replace(/[^\w.-]+/g, "_") + ".kb.json", JSON.stringify(out, null, 1), "application/json", { exactName: true });
    kb = out;
    // The profiles are in the knowledge base now; a further save (say after
    // renaming a species) must save the knowledge base as it stands, not add
    // them a second time.
    profiles = null;
    const po = $("saProfilesOut");
    if (po) po.insertAdjacentHTML("beforeend", '<div style="font-size:11px;color:var(--txt3);margin-top:3px">These profiles are now in the knowledge base “' + esc(name) + '”.</div>');
    renderKbInfo();
    I.say("Knowledge base “" + name + "” saved: " + out.species.length + " species" + note + ".");
  }

  async function saKbLoad(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.kind !== KB_KIND || !Array.isArray(data.species) || !Array.isArray(data.indicators))
        throw new Error("not a species knowledge base file");
      kb = data;
      if ($("saKbName")) $("saKbName").value = data.name || "";
      renderKbInfo();
      I.say("Loaded knowledge base “" + (data.name || file.name) + "”: " + data.species.length + " species, " + data.indicators.length + " variables.");
    } catch (e) {
      I.say("Could not read that knowledge base: " + e.message, true);
    }
  }

  function renderKbInfo() {
    const host = $("saKbInfo");
    if (!host) return;
    if (!kb) {
      host.textContent = "No knowledge base loaded.";
      return;
    }
    $("btnSaKbSave").disabled = false;
    host.innerHTML =
      "<b>" + esc(kb.name || "(unnamed)") + "</b> — " + kb.species.length + " species, " + kb.indicators.length + " variables" +
      (kb.temperature ? ", adjusted to " + kb.temperature.ref_c + " °C" : "") +
      '<div style="margin:3px 0;color:var(--txt3)">Variables: ' + kb.indicators.map((k) => esc(k.id.split("::")[1])).join(", ") + "</div>" +
      '<details><summary style="cursor:pointer">Species in this knowledge base (names can be edited)</summary>' +
      '<div style="max-height:220px;overflow:auto"><table class="dtable" style="width:100%"><thead><tr><th>Name</th><th>n</th><th>Made from</th></tr></thead><tbody>' +
      kb.species
        .map(
          (s, i) =>
            '<tr><td><input type="text" value="' + esc(s.name) + '" style="width:100%;font-size:11px" onchange="saKbRename(' + i + ', this.value)"></td><td>' + s.n + "</td><td>" +
            esc((s.original_names || []).join(", ")) + (s.previous_names && s.previous_names.length ? ' <span style="color:var(--txt3)">(was ' + esc(s.previous_names.join(", ")) + ")</span>" : "") + "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></details>";
    $("btnSaKbCompare").disabled = false;
  }

  function saKbRename(i, value) {
    const v = String(value || "").trim();
    const sp = kb && kb.species[i];
    if (!sp || !v || v === sp.name) return renderKbInfo();
    if (kb.species.some((o, j) => j !== i && o.name === v)) {
      I.say("Another species in the knowledge base is already called “" + v + "”.", true);
      return renderKbInfo();
    }
    sp.previous_names = (sp.previous_names || []).concat(sp.name);
    sp.name = v;
    renderKbInfo();
    I.say("Renamed to “" + v + "”. Save the knowledge base to keep it.");
  }

  // ── 3. Compare observations with the knowledge base ───────────────
  let cmp = null; // { rows:[{label, tag, res, idx, x, sdv, n}], ids }

  function saKbCompare() {
    if (!kb) {
      I.say("Load a knowledge base first.", true);
      return;
    }
    if (!sa.samples.length) {
      I.say("There are no observations loaded — merge your recordings on the Summary tab first.", true);
      return;
    }
    const ids = kb.indicators.map((k) => k.id);
    const kbRule = kb.temperature
      ? { ref: kb.temperature.ref_c, slopes: new Map(Object.entries(kb.temperature.slopes)) }
      : null;
    // each observation's values, moved to the knowledge base's temperature
    const valsOf = (s) => {
      if (!kbRule || s.temp == null) return s.vals;
      const o = {};
      for (const id in s.vals) o[id] = adjustedVal(s, id, kbRule);
      return o;
    };
    const noTemp = kbRule ? sa.samples.filter((s) => s.temp == null).length : 0;
    const cache = new Map();
    const modelFor = (idx) => {
      const key = idx.join(",");
      if (!cache.has(key)) cache.set(key, makeModel(kb.species, idx));
      return cache.get(key);
    };
    const run = (label, tag, vecs) => {
      // vecs: array of {id: value} maps; the unknown is their per-variable mean
      const idx = [],
        x = [],
        sdv = [];
      ids.forEach((id, j) => {
        const v = vecs.map((m) => m[id]).filter((u) => u != null);
        if (v.length) {
          idx.push(j);
          x.push(mean(v));
          sdv.push(v.length > 1 ? sdev(v) : null);
        }
      });
      if (idx.length < 2) return null;
      const res = classify(modelFor(idx), x);
      return { label, tag, res, idx, x, sdv, n: vecs.length };
    };
    const rows = [];
    const pooled = run("All loaded observations (one profile)", "", sa.samples.map(valsOf));
    if (pooled) rows.push(pooled);
    sa.samples.forEach((s) => {
      const r = run(s.label, s.species === "(no species)" ? "" : s.species, [valsOf(s)]);
      if (r) rows.push(r);
    });
    if (!rows.length) {
      I.say("The loaded observations share fewer than 2 variables with the knowledge base.", true);
      return;
    }
    cmp = { rows };
    const sel = $("saCmpWho");
    if (sel) {
      sel.innerHTML = "";
      rows.forEach((r, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = r.label;
        sel.appendChild(o);
      });
    }
    renderCompare();
    I.say(
      "Compared " + sa.samples.length + " observation(s) with “" + (kb.name || "knowledge base") + "” (" + kb.species.length + " species)." +
        (kbRule ? " Adjusted to " + kbRule.ref + " °C" + (noTemp ? "; " + noTemp + " without a temperature left unadjusted." : ".") : ""),
    );
  }

  function renderCompare() {
    const host = $("saCmpOut");
    if (!host || !cmp) return;
    const fmtL = (o) => esc(o.name) + " " + (o.post * 100).toFixed(0) + "%";
    const fmtM = (o) => esc(o.name) + " " + o.dM.toFixed(2);
    host.innerHTML =
      '<div style="overflow:auto;max-height:340px"><table class="dtable"><thead><tr><th>Observation</th><th>Tagged as</th><th>Closest (LDA)</th><th>2nd</th><th>3rd</th><th>Closest (Mahalanobis)</th><th>2nd</th><th>3rd</th><th>Variables in mean ± 2 SD of #1</th></tr></thead><tbody>' +
      cmp.rows
        .map((r, i) => {
          const L = byL(r.res),
            M = byM(r.res);
          const inr = L[0].inRange + "/" + r.idx.length;
          return (
            '<tr data-i="' + i + '" style="cursor:pointer"><td>' + esc(r.label) + "</td><td>" + esc(r.tag) + "</td>" +
            "<td><b>" + fmtL(L[0]) + "</b></td><td>" + (L[1] ? fmtL(L[1]) : "") + "</td><td>" + (L[2] ? fmtL(L[2]) : "") + "</td>" +
            "<td><b>" + fmtM(M[0]) + "</b></td><td>" + (M[1] ? fmtM(M[1]) : "") + "</td><td>" + (M[2] ? fmtM(M[2]) : "") + "</td>" +
            "<td>" + inr + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>" +
      '<div style="font-size:10px;color:var(--txt3);margin-top:3px">LDA: share of the evidence, from the pooled-covariance distance with equal priors. Mahalanobis: distance in SD units (smaller = closer). Click a row to plot it.</div>';
    host.querySelectorAll("tr[data-i]").forEach((tr) =>
      tr.addEventListener("click", () => {
        $("saCmpWho").value = tr.dataset.i;
        drawCompare();
      }),
    );
    drawCompare();
  }

  // Radar of the chosen observation (black, dashed) against its three closest
  // species; each variable is scaled 0–1 over all the knowledge base's species
  // means (and the unknown), so shapes stay comparable.
  function drawCompare() {
    const host = $("saCmpFig");
    if (!host || !cmp) return;
    host.innerHTML = "";
    const r = cmp.rows[+($("saCmpWho")?.value || 0)] || cmp.rows[0];
    const m = r.idx.length;
    if (m < 3) {
      host.textContent = "The radar needs at least 3 shared variables.";
      return;
    }
    const useM = $("saCmpMethod")?.value === "mah";
    const near = (useM ? byM(r.res) : byL(r.res)).slice(0, 3);
    const prof = (nm) => kb.species.find((s) => s.name === nm);
    const lo = r.idx.map((j, k) => Math.min(r.x[k], ...kb.species.map((s) => s.mean[j])));
    const hi = r.idx.map((j, k) => Math.max(r.x[k], ...kb.species.map((s) => s.mean[j])));
    const sc = (v, k) => (hi[k] > lo[k] ? (v - lo[k]) / (hi[k] - lo[k]) : 0.5);
    const R = 200,
      CX = 300,
      CY = 270,
      W = CX + R + 150 + 6.4 * Math.max(r.label.length, ...near.map((o) => o.name.length + 22)),
      H = CY + R + 60;
    const svg = svgEl("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: "background:#fff;display:block;max-width:100%;height:auto", "font-family": "Arial,sans-serif" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    svg.appendChild(svgEl("text", { x: 20, y: 26, "font-size": 14, "font-weight": 600, fill: "#111" }, "“" + r.label + "” against its closest species (" + (useM ? "Mahalanobis" : "LDA") + ")"));
    const ang = (k) => -Math.PI / 2 + (k / m) * 2 * Math.PI;
    const pt = (k, v) => [CX + v * R * Math.cos(ang(k)), CY + v * R * Math.sin(ang(k))];
    [0.2, 0.4, 0.6, 0.8, 1].forEach((v) => {
      svg.appendChild(svgEl("path", { d: "M" + r.idx.map((_, k) => pt(k, v).map((q) => q.toFixed(1)).join(",")).join("L") + "Z", fill: "none", stroke: v === 1 ? "#999" : "#ddd" }));
    });
    r.idx.forEach((j, k) => {
      const [x, y] = pt(k, 1);
      svg.appendChild(svgEl("line", { x1: CX, y1: CY, x2: x, y2: y, stroke: "#ccc" }));
      const [lx, ly] = pt(k, 1.09);
      const c = Math.cos(ang(k));
      svg.appendChild(svgEl("text", { x: lx, y: ly + 4, "text-anchor": Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end", "font-size": 11, "font-weight": 600, fill: "#111" }, kb.indicators[j].id.split("::")[1]));
    });
    const loop = (arr) => "M" + arr.map((v, k) => pt(k, Math.max(0, Math.min(1, v))).map((q) => q.toFixed(1)).join(",")).join("L") + "Z";
    near.forEach((o, i) => {
      const s = prof(o.name);
      const col = specColor(i);
      const mu = r.idx.map((j, k) => sc(s.mean[j], k));
      if (s.sd) {
        const up = r.idx.map((j, k) => sc(s.mean[j] + s.sd[j], k)),
          dn = r.idx.map((j, k) => sc(s.mean[j] - s.sd[j], k));
        svg.appendChild(svgEl("path", { d: loop(up) + loop(dn), fill: col, "fill-opacity": 0.16, "fill-rule": "evenodd", stroke: "none" }));
      }
      svg.appendChild(svgEl("path", { d: loop(mu), fill: "none", stroke: col, "stroke-width": 2.3, "stroke-linejoin": "round" }));
    });
    svg.appendChild(svgEl("path", { d: loop(r.x.map((v, k) => sc(v, k))), fill: "none", stroke: "#000", "stroke-width": 2.6, "stroke-dasharray": "7 4", "stroke-linejoin": "round" }));
    // legend
    let y = 70;
    const lx = CX + R + 110;
    svg.appendChild(svgEl("line", { x1: lx, y1: y - 3, x2: lx + 18, y2: y - 3, stroke: "#000", "stroke-width": 2.6, "stroke-dasharray": "7 4" }));
    svg.appendChild(svgEl("text", { x: lx + 24, y, "font-size": 11, fill: "#222" }, r.label));
    near.forEach((o, i) => {
      y += 18;
      svg.appendChild(svgEl("rect", { x: lx, y: y - 9, width: 18, height: 10, fill: specColor(i), "fill-opacity": 0.8 }));
      svg.appendChild(svgEl("text", { x: lx + 24, y, "font-size": 11, fill: "#222" }, (i + 1) + ". " + o.name + (useM ? "  d=" + o.dM.toFixed(2) : "  " + (o.post * 100).toFixed(0) + "%")));
    });
    host.appendChild(svg);
  }

  window.saCvRun = saCvRun;
  window.saProfilesExtract = saProfilesExtract;
  window.saKbSave = saKbSave;
  window.saKbLoad = saKbLoad;
  // forget the extracted profiles, the loaded knowledge base and the comparison
  window.saKbReset = () => {
    profiles = null;
    kb = null;
    cmp = null;
    ["saProfilesOut", "saCmpOut", "saCmpFig"].forEach((id) => $(id) && ($(id).innerHTML = ""));
    if ($("saCmpWho")) $("saCmpWho").innerHTML = "";
    if ($("saKbInfo")) $("saKbInfo").textContent = "No knowledge base loaded.";
    if ($("saKbName")) $("saKbName").value = "";
    ["btnSaKbSave", "btnSaKbCompare"].forEach((id) => $(id) && ($(id).disabled = true));
  };
  window.saKbRename = saKbRename;
  window.saKbCompare = saKbCompare;
  window.saCmpRedraw = drawCompare;
  window.saSaveCmpPng = () => I.savePng("saCmpFig", "comparison_radar");
  window.saSaveCmpSvg = () => I.saveSvg("saCmpFig", "comparison_radar");
  // exposed so the numerics can be unit-tested
  window.saKbMath = { profileOf, makeModel, classify };
})();
