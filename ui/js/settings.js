// SIV · settings store (localStorage) + change events.
const KEY = "siv.settings.v1";

export const DEFAULT_KEYS = {
  prev: ["ArrowLeft", "PageUp"],
  next: ["ArrowRight", "PageDown"],
  first: ["Home"],
  last: ["End"],
  zoomIn: ["Equal", "NumpadAdd", "Ctrl+Equal"],
  zoomOut: ["Minus", "NumpadSubtract", "Ctrl+Minus"],
  zoomFit: ["Ctrl+Digit0", "Digit0"],
  zoom100: ["Ctrl+Digit1", "Digit1"],
  zoomToggle: ["KeyZ"],
  adjust: ["KeyA"],
  crop: ["KeyR"],
  rotateLeft: ["BracketLeft"],
  rotateRight: ["BracketRight"],
  flipH: ["Shift+KeyH"],
  flipV: ["Shift+KeyV"],
  undo: ["Ctrl+KeyZ"],
  redo: ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
  resetEdits: ["Ctrl+Shift+KeyR"],
  compare: ["KeyC"],
  save: ["Ctrl+KeyS"],
  saveAs: ["Ctrl+Shift+KeyS"],
  copy: ["Ctrl+KeyC"],
  info: ["Tab", "KeyI"],
  fullscreen: ["KeyF", "F11"],
  open: ["Ctrl+KeyO"],
  settings: ["Ctrl+Comma"],
  close: ["Escape"],
};
export const KEY_LABELS = {
  prev: "Previous image", next: "Next image", first: "First image", last: "Last image",
  zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit to window", zoom100: "Actual pixels (100%)", zoomToggle: "Toggle fit / 100%",
  adjust: "Adjust panel", crop: "Crop & rotate", rotateLeft: "Rotate left", rotateRight: "Rotate right", flipH: "Flip horizontal", flipV: "Flip vertical",
  undo: "Undo", redo: "Redo", resetEdits: "Reset all edits", compare: "Compare", save: "Save copy", saveAs: "Save as…", copy: "Copy image",
  info: "Image info", fullscreen: "Fullscreen", open: "Open file", settings: "Settings", close: "Close panel / exit fullscreen",
};

export const DEFAULTS = {
  // viewing
  fitMode: "shrink", bg: "black", checker: true, pixelated: true, wheel: "zoom", zoomStep: 1.25, dblClick: "zoom", dragPan: true, smoothZoom: true,
  // folder
  sort: "name", sortRev: false, loopFolder: true, preload: 2,
  // interface
  hideDelay: 2500, showThumbs: true, showBadges: true, osd: true, alwaysOnTop: false,
  // appearance
  theme: "noir",
  // export
  outDir: "", saveFormat: "same", quality: 92, suffix: " edited",
  // updates
  autoUpdate: true,
  keys: DEFAULT_KEYS,
  recent: [],
};

const listeners = new Set();
let data = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); return { ...structuredClone(DEFAULTS), ...s, keys: { ...DEFAULT_KEYS, ...(s.keys || {}) } }; }
  catch { return structuredClone(DEFAULTS); }
}
let t;
function persist() { clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }, 120); }

export const settings = new Proxy({}, {
  get: (_, k) => data[k],
  set: (_, k, v) => { const old = data[k]; data[k] = v; persist(); if (old !== v) listeners.forEach((f) => f(k, v, old)); return true; },
});
export const onSetting = (f) => { listeners.add(f); return () => listeners.delete(f); };
export function resetSettings() { const keep = { recent: data.recent }; data = { ...structuredClone(DEFAULTS), ...keep }; persist(); listeners.forEach((f) => f("*")); }
export function pushRecent(path) { settings.recent = [path, ...data.recent.filter((p) => p !== path)].slice(0, 8); }
