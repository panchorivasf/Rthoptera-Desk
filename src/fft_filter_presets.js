// FFT filter presets: named presets kept in this app's local storage, plus
// .json files that can be copied to another computer or kept beside the
// recordings. A preset holds the gain curve and its settings; frequencies are
// absolute (Hz). Loaded after fft_filter.js, whose editor state (EQ) it fills.
const EQ_PRESET_KEY = "rt_fft_filter_presets";
const EQ_PRESET_FILE_TYPE = "rthoptera-fft-filter-preset";
const EQ_RANGES = [6, 12, 24, 48, 96];

function eqPresetStore() {
  try {
    const o = JSON.parse(localStorage.getItem(EQ_PRESET_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (e) {
    return {};
  }
}
function eqPresetStatus(msg, isErr) {
  const el = eqEl("eqPresetStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "#f85149" : "var(--txt3)";
}
function eqPresetWrite(o) {
  try {
    localStorage.setItem(EQ_PRESET_KEY, JSON.stringify(o));
    return true;
  } catch (e) {
    eqPresetStatus("Storage unavailable: " + e.message, true);
    return false;
  }
}
function eqPresetRefresh(selectName) {
  const sel = eqEl("eqPresetSelect");
  if (!sel) return;
  const keep = selectName !== undefined ? selectName : sel.value;
  const names = Object.keys(eqPresetStore()).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">— presets —</option>';
  names.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = names.includes(keep) ? keep : "";
}
function eqCapture() {
  return {
    pts: EQ.pts.map((p) => ({ f: +p.f.toFixed(3), g: +p.g.toFixed(3) })),
    smooth: EQ.smooth,
    size: EQ.size,
    range: EQ.range,
  };
}
// Put a preset into the editor. Points above this file's Nyquist are skipped.
function eqApplyPreset(d) {
  if (!d || !Array.isArray(d.pts)) throw new Error("no gain curve in this preset");
  const all = d.pts
    .map((p) => ({ f: Number(p.f), g: Number(p.g) }))
    .filter((p) => isFinite(p.f) && isFinite(p.g) && p.f >= 0);
  if (!all.length) throw new Error("the preset has no points");
  const kept = all.filter((p) => p.f <= EQ.nyq);
  EQ.pts = kept.map((p) => ({ f: p.f, g: Math.max(-96, Math.min(96, p.g)) }));
  eqSortPts();
  EQ.sel = null;
  EQ.smooth = !!d.smooth;
  eqEl("eqSmooth").checked = EQ.smooth;
  const sizes = [2048, 4096, 8192, 16384, 32768, 65536];
  if (sizes.includes(d.size)) {
    EQ.size = d.size;
    eqEl("eqSize").value = String(d.size);
  }
  // Gain axis: the preset's own range, widened if its curve would not fit.
  const need = Math.max(0, ...EQ.pts.map((p) => Math.abs(p.g)));
  let r = EQ_RANGES.includes(d.range) ? d.range : EQ.range;
  while (r < need && r < 96) r = EQ_RANGES[EQ_RANGES.indexOf(r) + 1];
  EQ.range = r;
  eqEl("eqRange").value = String(r);
  eqSyncInputs();
  eqRefreshSpectrum();
  return { kept: kept.length, dropped: all.length - kept.length };
}
function eqPresetMsg(prefix, r) {
  eqPresetStatus(
    prefix +
      ". " +
      r.kept +
      " point(s)" +
      (r.dropped ? ", " + r.dropped + " above this file's Nyquist skipped" : "") +
      ". Press Apply filter to use it.",
  );
}

function eqPresetSave() {
  if (!EQ.pts.length) {
    eqPresetStatus("Add at least one point first.", true);
    return;
  }
  const store = eqPresetStore();
  const cur = eqEl("eqPresetSelect").value;
  const name = (prompt("Name for this FFT filter preset:", cur || "") || "").trim();
  if (!name) return;
  if (store[name] && name !== cur && !confirm('Replace the preset "' + name + '"?')) return;
  store[name] = { ...eqCapture(), _saved: new Date().toISOString() };
  if (!eqPresetWrite(store)) return;
  eqPresetRefresh(name);
  eqPresetStatus('Saved "' + name + '".');
}
function eqPresetLoad() {
  const name = eqEl("eqPresetSelect").value;
  if (!name) {
    eqPresetStatus("Choose a preset first.", true);
    return;
  }
  const d = eqPresetStore()[name];
  if (!d) {
    eqPresetStatus("That preset is gone.", true);
    eqPresetRefresh("");
    return;
  }
  try {
    eqPresetMsg('Loaded "' + name + '"', eqApplyPreset(d));
  } catch (e) {
    eqPresetStatus("Could not load: " + e.message, true);
  }
}
function eqPresetDelete() {
  const name = eqEl("eqPresetSelect").value;
  if (!name) {
    eqPresetStatus("Choose a preset first.", true);
    return;
  }
  if (!confirm('Delete the preset "' + name + '"?')) return;
  const store = eqPresetStore();
  delete store[name];
  if (eqPresetWrite(store)) {
    eqPresetRefresh("");
    eqPresetStatus('Deleted "' + name + '".');
  }
}
async function eqPresetExportFile() {
  if (!EQ.pts.length) {
    eqPresetStatus("Add at least one point first.", true);
    return;
  }
  const cur = eqEl("eqPresetSelect").value;
  const data = {
    _type: EQ_PRESET_FILE_TYPE,
    _version: 1,
    _name: cur || "fft filter",
    _saved: new Date().toISOString(),
    ...eqCapture(),
  };
  const stem =
    (cur || "fft_filter").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "fft_filter";
  try {
    // exactName: a preset is not a recording, so it must not be renamed after
    // whichever WAV is open.
    await dlFile(stem + "_preset.json", JSON.stringify(data, null, 2), "application/json", {
      exactName: true,
    });
    eqPresetStatus("Preset exported.");
  } catch (e) {
    eqPresetStatus("Export failed: " + e.message, true);
  }
}
async function eqPresetImportFile(file) {
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d._type && d._type !== EQ_PRESET_FILE_TYPE)
      throw new Error("this is not an FFT filter preset");
    eqPresetMsg(
      "Loaded" + (d._name ? ' "' + d._name + '"' : "") + " from file",
      eqApplyPreset(d),
    );
  } catch (e) {
    eqPresetStatus("Could not read preset: " + e.message, true);
  }
}
document.addEventListener("DOMContentLoaded", () => eqPresetRefresh());
if (document.readyState !== "loading") eqPresetRefresh();
