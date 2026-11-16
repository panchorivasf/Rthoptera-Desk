// Configurable keyboard shortcuts (Preferences ▸ Keyboard shortcuts…).
// A binding is a "+"-joined list of KeyboardEvent.code values, modifiers first,
// e.g. "ControlRight+ShiftRight+ArrowUp". Left/right modifiers are distinct.
// Other scripts ask `kbMatch(actionId, event)`; actions that are not routed
// through kbMatch are handled by the dispatcher at the bottom of this file.

const KB_ACTIONS = [
  { id: "specResUp", label: "Spectrogram: finer frequency resolution (larger FFT)", def: "ControlRight+ShiftRight+ArrowUp", run: () => stepSpecResolution(1) },
  { id: "specResDown", label: "Spectrogram: finer time resolution (smaller FFT)", def: "ControlRight+ShiftRight+ArrowDown", run: () => stepSpecResolution(-1) },
  { id: "zoomTimeIn", label: "Zoom in (time)", def: "", run: () => zoomTime(0.7) },
  { id: "zoomTimeOut", label: "Zoom out (time)", def: "", run: () => zoomTime(1 / 0.7) },
  { id: "zoomFreqIn", label: "Zoom in (frequency)", def: "", run: () => zoomFreq(0.7) },
  { id: "zoomFreqOut", label: "Zoom out (frequency)", def: "", run: () => zoomFreq(1 / 0.7) },
  { id: "zoomAmpIn", label: "Zoom in (amplitude)", def: "", run: () => zoomAmp(0.7) },
  { id: "zoomAmpOut", label: "Zoom out (amplitude)", def: "", run: () => zoomAmp(1 / 0.7) },
  { id: "playPause", label: "Play / pause", def: "Space", run: null },
  { id: "toolSelect", label: "Tool: Select (Spectral Analysis)", def: "KeyS", run: null },
  { id: "toolAnnotate", label: "Tool: Annotate (Spectral Analysis)", def: "KeyA", run: null },
  { id: "toolPan", label: "Tool: Pan (Spectral Analysis)", def: "KeyH", run: null },
];

const KB_STORE = "rt_keybindings";
const KB_MODS = ["Control", "Shift", "Alt", "Meta"];
let kbBindings = {};
let kbRecording = null;
const kbHeld = new Set();

function kbLoad() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KB_STORE) || "{}") || {};
  } catch (e) {}
  kbBindings = {};
  for (const a of KB_ACTIONS) kbBindings[a.id] = typeof saved[a.id] === "string" ? saved[a.id] : a.def;
}
function kbSave() {
  try {
    localStorage.setItem(KB_STORE, JSON.stringify(kbBindings));
  } catch (e) {}
}
kbLoad();

function kbModKind(code) {
  for (const m of KB_MODS) if (code.startsWith(m)) return m;
  return null;
}

function kbMatch(actionId, e) {
  const b = kbBindings[actionId];
  if (!b || e.code === undefined) return false;
  const parts = b.split("+");
  const key = parts[parts.length - 1];
  if (e.code !== key) return false;
  const mods = parts.slice(0, -1);
  const flags = { Control: e.ctrlKey, Shift: e.shiftKey, Alt: e.altKey, Meta: e.metaKey };
  for (const m of KB_MODS) {
    const need = mods.some((x) => kbModKind(x) === m);
    if (!!flags[m] !== need) return false;
  }
  return mods.every((x) => kbHeld.has(x));
}

function kbPretty(b) {
  if (!b) return t("— not set —");
  return b
    .split("+")
    .map((c) =>
      c
        .replace(/^(Control|Shift|Alt|Meta)(Left|Right)$/, (_, m, s) => (s === "Right" ? t("Right") : t("Left")) + " " + (m === "Control" ? "Ctrl" : m))
        .replace(/^Key([A-Z])$/, "$1")
        .replace(/^Digit(\d)$/, "$1")
        .replace(/^Arrow(Up|Down|Left|Right)$/, t("Arrow") + " $1"),
    )
    .join(" + ");
}

function kbIsTyping(t) {
  if (!t || !t.tagName) return false;
  if (t.tagName === "TEXTAREA" || t.isContentEditable) return true;
  if (t.tagName === "INPUT") return !["range", "checkbox", "radio", "button"].includes(t.type);
  return false;
}

// Held-key tracking (needed to tell right Ctrl/Shift from left).
document.addEventListener(
  "keydown",
  (e) => {
    kbHeld.add(e.code);
    if (kbRecording) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        kbRecording = null;
        kbRender();
      } else if (!kbModKind(e.code)) {
        const mods = [...kbHeld].filter((c) => kbModKind(c));
        const binding = mods.concat(e.code).join("+");
        const clash = KB_ACTIONS.find((a) => a.id !== kbRecording && kbBindings[a.id] === binding);
        if (clash) kbBindings[clash.id] = "";
        kbBindings[kbRecording] = binding;
        kbRecording = null;
        kbSave();
        kbRender();
      }
      return;
    }
    if (kbIsTyping(e.target) || e.repeat) return;
    for (const a of KB_ACTIONS) {
      if (a.run && kbMatch(a.id, e)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof rawSamples !== "undefined" && rawSamples) a.run();
        return;
      }
    }
  },
  true,
);
document.addEventListener("keyup", (e) => kbHeld.delete(e.code), true);
window.addEventListener("blur", () => kbHeld.clear());

function kbRender() {
  const box = document.getElementById("shortcutsList");
  if (!box) return;
  box.innerHTML = "";
  for (const a of KB_ACTIONS) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px";
    const lbl = document.createElement("span");
    lbl.style.cssText = "flex:1;font-size:12px;color:var(--txt)";
    lbl.textContent = t(a.label);
    const key = document.createElement("button");
    key.type = "button";
    key.className = "kb-key" + (kbRecording === a.id ? " recording" : "");
    key.textContent = kbRecording === a.id ? t("Press keys…") : kbPretty(kbBindings[a.id]);
    key.onclick = () => {
      kbRecording = a.id;
      kbRender();
    };
    const clr = document.createElement("button");
    clr.type = "button";
    clr.textContent = t("Clear");
    clr.style.fontSize = "11px";
    clr.onclick = () => {
      kbBindings[a.id] = "";
      kbSave();
      kbRender();
    };
    const rst = document.createElement("button");
    rst.type = "button";
    rst.textContent = t("Default");
    rst.style.fontSize = "11px";
    rst.onclick = () => {
      const clash = KB_ACTIONS.find((o) => o.id !== a.id && a.def && kbBindings[o.id] === a.def);
      if (clash) kbBindings[clash.id] = "";
      kbBindings[a.id] = a.def;
      kbSave();
      kbRender();
    };
    row.append(lbl, key, clr, rst);
    box.appendChild(row);
  }
}
function kbResetAll() {
  for (const a of KB_ACTIONS) kbBindings[a.id] = a.def;
  kbSave();
  kbRender();
}
function openShortcuts() {
  kbRecording = null;
  kbRender();
  document.getElementById("shortcutsOverlay").classList.add("show");
}
function closeShortcuts() {
  kbRecording = null;
  document.getElementById("shortcutsOverlay").classList.remove("show");
}
