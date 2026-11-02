// ═══════════════════════════════════════════════════════════════════════
// CUSTOM WORKFLOW
//
// "Record Workflow" (tab bar) logs the analysis steps the user takes; "Stop
// Workflow" asks for a name and for the metrics to keep, and stores both. The
// Custom Workflow tab replays a saved workflow on the active recording or on
// every recording checked in the Loaded Audio list, and exports ONLY the
// metrics that were ticked when it was saved.
//
// Recording works by wrapping a short list of global action functions (the
// ones the buttons call). A step stores the function, its plain arguments, the
// tab it was run from, and the parameter fields (inputs/selects) that changed
// since the previous step, so a replay reproduces the settings as well as the
// clicks.
// ═══════════════════════════════════════════════════════════════════════

const WF_STORE_KEY = "rt_workflows";

// Parameter-driven actions only. Anything that needs a drag or a click on a
// plot (trim, drawing selections, editing peaks by hand) cannot be replayed
// and is deliberately absent.
const WF_TRACKED = {
  applyBandpassEdit: "Bandpass filter",
  applyFreqDropEdit: "Frequency drop",
  applyFadeSelected: "Fade",
  applyNoisePadEdit: "Noise padding",
  applyDownsampleEdit: "Downsample",
  applyNormalizeEdit: "Normalize",
  fixDcOffset: "Fix DC offset",
  pkDetectFloor: "Detect local minima",
  pkDetect: "Detect envelope peaks",
  pkRunAmpDetector: "Amplitude Detector",
  pkClearAmpDetections: "Clear detections",
  pkApplyDetectionsToSpectral: "Apply to Spectral Analysis",
  pkConfirm: "Compute metrics from peaks",
  pkConfirmFromPulses: "Compute metrics from pulses",
  computeUnifiedSpectralMetrics: "Spectral metrics",
};

// Columns that identify a row rather than measure something: always kept,
// never offered as a metric.
const WF_ID_COLS = new Set([
  "source_file", "temp_c", "specimen_id", "species", "country", "locality",
  "rec_date", "rec_time", "latitude", "longitude", "elevation_m", "recorder",
  "microphone", "accessories",
]);

const WF_TEMPORAL_SHEETS = ["Envelope peaks", "Pulses", "Motifs", "MotifSeqs", "Summary"];
const WF_SPECTRAL_SHEET = "Spectral_Analysis";

let wfRecording = false;
let wfReplaying = false;
let wfInStep = false;
let wfSteps = [];
let wfLastSnap = {};
let wfPending = null; // { steps } while the save dialog is open

// ── storage ──────────────────────────────────────────────────────────
function wfLoad() {
  try {
    const l = JSON.parse(localStorage.getItem(WF_STORE_KEY) || "[]");
    return Array.isArray(l) ? l : [];
  } catch (e) {
    return [];
  }
}
function wfStore(list) {
  try {
    localStorage.setItem(WF_STORE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    alert("Could not store the workflow: " + e.message);
    return false;
  }
}
function wfEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ── parameter snapshots ──────────────────────────────────────────────
function wfSnapshot() {
  const snap = {};
  ["mainview-preprocess", "mainview-envpeaks", "mainview-analyzer"].forEach((v) => {
    const root = document.getElementById(v);
    if (!root) return;
    root.querySelectorAll("input[id], select[id]").forEach((el) => {
      if (el.type === "file" || el.type === "button") return;
      snap[el.id] = el.type === "checkbox" ? (el.checked ? "1" : "0") : String(el.value);
    });
  });
  return snap;
}
function wfDelta(prev, cur) {
  const d = {};
  Object.keys(cur).forEach((k) => {
    if (prev[k] !== cur[k]) d[k] = cur[k];
  });
  return d;
}
function wfApplyParams(params) {
  Object.keys(params || {}).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = params[id] === "1";
    else el.value = params[id];
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function wfActiveTab() {
  const a = document.querySelector('.tab.active[id^="maintab-"]');
  return a ? a.id.replace("maintab-", "") : "analyzer";
}

// ── recording ────────────────────────────────────────────────────────
function wfWrap(name) {
  const orig = window[name];
  if (typeof orig !== "function" || orig.__wf) return;
  const wrapped = function (...args) {
    if (!wfRecording || wfReplaying || wfInStep) return orig.apply(this, args);
    const cur = wfSnapshot();
    wfSteps.push({
      fn: name,
      label: WF_TRACKED[name],
      args: args.filter((a) => ["string", "number", "boolean"].includes(typeof a)),
      tab: wfActiveTab(),
      params: wfDelta(wfLastSnap, cur),
    });
    wfLastSnap = cur;
    wfUpdateButton();
    wfInStep = true;
    let out;
    try {
      out = orig.apply(this, args);
    } catch (e) {
      wfInStep = false;
      throw e;
    }
    if (out && typeof out.then === "function") {
      const done = () => (wfInStep = false);
      out.then(done, done);
    } else wfInStep = false;
    return out;
  };
  wrapped.__wf = true;
  window[name] = wrapped;
}

function wfUpdateButton() {
  const b = document.getElementById("btnWfRecord");
  if (!b) return;
  if (wfRecording) {
    b.innerHTML = "&#9209; Stop Workflow (" + wfSteps.length + ")";
    b.style.color = "#f85149";
    b.style.borderColor = "#f85149";
  } else {
    b.innerHTML = "&#9210; Record Workflow";
    b.style.color = "";
    b.style.borderColor = "";
  }
}

function wfToggleRecord() {
  if (wfReplaying) return;
  if (!wfRecording) {
    wfRecording = true;
    wfSteps = [];
    wfLastSnap = wfSnapshot();
    wfUpdateButton();
    log("Recording workflow: steps you run are now being stored.", "ok");
    return;
  }
  if (!wfSteps.length) {
    wfRecording = false;
    wfUpdateButton();
    log("Workflow recording stopped: no steps were taken.", "warn");
    return;
  }
  const catalog = wfCatalog();
  if (!catalog.length) {
    alert(
      "No metrics have been calculated yet, so there is nothing to choose from.\n\n" +
        "Run the metrics step (Compute Metrics / Spectral Metrics) while recording, then press Stop Workflow again.",
    );
    return;
  }
  wfRecording = false;
  wfUpdateButton();
  wfPending = { steps: wfSteps.slice(), catalog };
  wfOpenSaveDialog();
}

// ── metric catalogue (from the tables actually computed) ─────────────
function wfLiveTables() {
  const spec =
    spectralMetricsRows && spectralMetricsRows.length
      ? spectralMetricsRows
      : detMeasurements && detMeasurements.length
        ? detMeasurements
        : [];
  return {
    "Envelope peaks": pkEnvPeakData,
    Pulses: pkPulseData,
    Motifs: pkMotifData,
    MotifSeqs: pkMotifSeqData,
    Summary: pkSummaryData ? [pkSummaryData] : [],
    [WF_SPECTRAL_SHEET]: spec,
  };
}
function wfCatalog() {
  const live = wfLiveTables();
  const out = [];
  Object.keys(live).forEach((sheet) => {
    const rows = live[sheet] || [];
    if (!rows.length) return;
    const cols = _unionCols(rows).filter((c) => !WF_ID_COLS.has(c));
    if (cols.length)
      out.push({ sheet, group: sheet === WF_SPECTRAL_SHEET ? "Spectral Analysis" : "Temporal Analysis", cols });
  });
  return out;
}

// ── save dialog ──────────────────────────────────────────────────────
function wfDefaultName() {
  const used = new Set(wfLoad().map((w) => w.name));
  let n = used.size + 1;
  while (used.has("Workflow " + n)) n++;
  return "Workflow " + n;
}
function wfOpenSaveDialog() {
  document.getElementById("wfName").value = wfDefaultName();
  document.getElementById("wfStepsSummary").textContent =
    wfPending.steps.length + " step(s): " + wfPending.steps.map((s) => s.label).join(" → ");
  const body = document.getElementById("wfMetricBody");
  body.innerHTML = "";
  ["Temporal Analysis", "Spectral Analysis"].forEach((group) => {
    const sheets = wfPending.catalog.filter((c) => c.group === group);
    if (!sheets.length) return;
    const g = document.createElement("div");
    g.className = "panel";
    let html = '<h2 style="margin-bottom:4px">' + group + "</h2>";
    sheets.forEach((c, si) => {
      html +=
        '<div style="margin-bottom:6px"><div style="font-size:11px;font-weight:700;color:var(--txt3);display:flex;gap:8px;align-items:center">' +
        wfEsc(c.sheet.replace("_", " ")) +
        '<button type="button" style="font-size:10px;padding:0 6px" onclick="wfTickSheet(' + JSON.stringify(c.sheet).replace(/"/g, "&quot;") + ',true)">all</button>' +
        '<button type="button" style="font-size:10px;padding:0 6px" onclick="wfTickSheet(' + JSON.stringify(c.sheet).replace(/"/g, "&quot;") + ',false)">none</button>' +
        '</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px 10px">';
      c.cols.forEach((col) => {
        html +=
          '<label class="chk" style="font-size:11px;color:var(--txt2)"><input type="checkbox" data-wf-sheet="' +
          wfEsc(c.sheet) + '" data-wf-col="' + wfEsc(col) + '"> ' + wfEsc(col) + "</label>";
      });
      html += "</div></div>";
    });
    g.innerHTML = html;
    body.appendChild(g);
  });
  document.getElementById("wfSaveOverlay").classList.add("show");
  document.getElementById("wfName").select();
}
function wfTickSheet(sheet, on) {
  document.querySelectorAll("#wfMetricBody input[data-wf-sheet]").forEach((el) => {
    if (el.dataset.wfSheet === sheet) el.checked = on;
  });
}
function wfCancelSave() {
  document.getElementById("wfSaveOverlay").classList.remove("show");
  wfPending = null;
  wfSteps = [];
  log("Workflow discarded.", "warn");
}
function wfCommitSave() {
  if (!wfPending) return;
  const metrics = {};
  document.querySelectorAll("#wfMetricBody input[data-wf-sheet]:checked").forEach((el) => {
    (metrics[el.dataset.wfSheet] = metrics[el.dataset.wfSheet] || []).push(el.dataset.wfCol);
  });
  if (!Object.keys(metrics).length) {
    alert("Tick at least one metric to calculate.");
    return;
  }
  const list = wfLoad();
  let name = document.getElementById("wfName").value.trim() || wfDefaultName();
  if (list.some((w) => w.name === name)) {
    if (!confirm('A workflow named "' + name + '" exists. Replace it?')) return;
    list.splice(list.findIndex((w) => w.name === name), 1);
  }
  list.push({
    id: "wf" + Date.now(),
    name,
    created: new Date().toISOString(),
    steps: wfPending.steps,
    metrics,
  });
  if (!wfStore(list)) return;
  document.getElementById("wfSaveOverlay").classList.remove("show");
  wfPending = null;
  wfSteps = [];
  log('Workflow "' + name + '" saved.', "ok");
  wfRenderList();
}

// ── Custom Workflow tab ──────────────────────────────────────────────
function wfRenderList() {
  const box = document.getElementById("wfList");
  if (!box) return;
  const list = wfLoad();
  if (!list.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--txt3)">No workflows saved yet.</div>';
    return;
  }
  const nChecked = audioLibBatchSelected ? audioLibBatchSelected.size : 0;
  box.innerHTML = "";
  list.forEach((w) => {
    const card = document.createElement("div");
    card.className = "panel";
    card.style.cssText = "max-width:900px";
    const mSummary = Object.keys(w.metrics)
      .map((s) => wfEsc(s.replace("_", " ")) + " (" + w.metrics[s].length + ")")
      .join(", ");
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<b style="font-size:13px;color:var(--txt3)">' + wfEsc(w.name) + "</b>" +
      '<span style="font-size:10px;color:var(--txt2)">' + new Date(w.created).toLocaleString() + "</span>" +
      '<span style="flex:1"></span>' +
      '<button class="suc" style="font-size:11px" onclick="wfRun(\'' + w.id + '\',\'active\')">&#9654; Run on active recording</button>' +
      '<button class="suc" style="font-size:11px"' + (nChecked ? "" : " disabled") + ' onclick="wfRun(\'' + w.id + '\',\'checked\')">&#9654; Run on checked (' + nChecked + ")</button>" +
      '<button style="font-size:11px" onclick="wfRename(\'' + w.id + '\')">Rename</button>' +
      '<button style="font-size:11px" onclick="wfDelete(\'' + w.id + '\')">&#128465;</button></div>' +
      '<div style="font-size:11px;color:var(--txt2);margin-top:4px"><b>Steps:</b> ' +
      w.steps.map((s, i) => i + 1 + ". " + wfEsc(s.label)).join(" &rarr; ") + "</div>" +
      '<div style="font-size:11px;color:var(--txt2);margin-top:2px"><b>Metrics:</b> ' + mSummary + "</div>";
    box.appendChild(card);
  });
}
function wfRename(id) {
  const list = wfLoad();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  const nm = prompt("Workflow name:", w.name);
  if (!nm || !nm.trim()) return;
  w.name = nm.trim();
  wfStore(list);
  wfRenderList();
}
function wfDelete(id) {
  const list = wfLoad();
  const w = list.find((x) => x.id === id);
  if (!w || !confirm('Delete workflow "' + w.name + '"?')) return;
  wfStore(list.filter((x) => x.id !== id));
  wfRenderList();
}

// ── replay ───────────────────────────────────────────────────────────
function wfCollect(w) {
  const live = wfLiveTables();
  const out = {};
  Object.keys(w.metrics).forEach((sheet) => {
    const keep = new Set(w.metrics[sheet]);
    out[sheet] = (live[sheet] || []).map((row) => {
      const r = { source_file: row.source_file !== undefined ? row.source_file : pkSourceFile() };
      Object.keys(row).forEach((c) => {
        if (c === "source_file") return;
        if (keep.has(c) || WF_ID_COLS.has(c)) r[c] = row[c];
      });
      return r;
    });
  });
  return out;
}

async function wfRun(id, scope) {
  if (wfRecording || wfReplaying) return;
  const w = wfLoad().find((x) => x.id === id);
  if (!w) return;
  const ids = scope === "checked" ? [...audioLibBatchSelected] : [audioLibActiveId];
  if (!ids.length || ids[0] === null || ids[0] === undefined || !rawSamples) {
    alert("Load audio first.");
    return;
  }
  wfReplaying = true;
  const sheets = {};
  try {
    await withBusy('Running "' + w.name + '"…', async (progress) => {
      for (let r = 0; r < ids.length; r++) {
        if (ids[r] !== audioLibActiveId) selectLibraryAudio(ids[r]);
        spectralMetricsRows = null;
        detMeasurements = [];
        const entry = audioLibrary.find((e) => e.id === ids[r]);
        for (let s = 0; s < w.steps.length; s++) {
          const st = w.steps[s];
          progress(
            (entry ? entry.name : "recording") + " (" + (r + 1) + "/" + ids.length + "): " + st.label,
            (r + s / w.steps.length) / ids.length,
          );
          const tabEl = document.getElementById("maintab-" + st.tab);
          if (tabEl) switchMainTab(st.tab, tabEl);
          wfApplyParams(st.params);
          await new Promise((res) => setTimeout(res, 60));
          const fn = window[st.fn];
          if (typeof fn === "function") await fn(...st.args);
        }
        const got = wfCollect(w);
        Object.keys(got).forEach((sh) => {
          sheets[sh] = (sheets[sh] || []).concat(got[sh]);
        });
      }
    });
  } catch (e) {
    wfReplaying = false;
    log("Workflow failed: " + e.message, "err");
    return;
  }
  wfReplaying = false;
  switchMainTab("workflow", document.getElementById("maintab-workflow"));
  const out = Object.keys(sheets)
    .filter((s) => sheets[s].length)
    .map((s) => [s, sheets[s]]);
  if (!out.length) {
    log('Workflow "' + w.name + '" produced no rows.', "warn");
    return;
  }
  try {
    const bytes = _buildXlsx(out);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await dlFile(
      "Rthoptera_" + w.name.replace(/[^\w.-]+/g, "_") + "_" + stamp + ".xlsx",
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { exactName: true },
    );
    log('Workflow "' + w.name + '" exported (' + out.length + " sheet(s)).", "ok");
  } catch (e) {
    log("Workflow export failed: " + e.message, "err");
  }
}

Object.keys(WF_TRACKED).forEach(wfWrap);
