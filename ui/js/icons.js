// SIV companion icon sprite: viewer/editor glyphs in the Steez icon style
// (24×24, stroke = currentColor, width/cap/join from the theme via `.i`). Use like any Steez icon:
// <svg class="i"><use href="#i-crop"/></svg>
const ICONS = {
  "crop": '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  "rotate-left": '<path d="M3 4v5h5"/><path d="M3.5 9A8.5 8.5 0 1 1 6 16.5"/>',
  "rotate-right": '<path d="M21 4v5h-5"/><path d="M20.5 9A8.5 8.5 0 1 0 18 16.5"/>',
  "flip-h": '<path d="M12 3v18"/><path d="M8 7 3 17h5z"/><path d="m16 7 5 10h-5z"/>',
  "flip-v": '<path d="M3 12h18"/><path d="M7 8 17 3v5z"/><path d="m7 16 10 5v-5z"/>',
  "compare": '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 2v20"/><path d="m7 10-2 2 2 2M17 10l2 2-2 2"/>',
  "split": '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/>',
  "side": '<rect x="2.5" y="5" width="8.5" height="14" rx="2"/><rect x="13" y="5" width="8.5" height="14" rx="2"/>',
  "diff": '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  "fullscreen": '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  "fullscreen-exit": '<path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4"/>',
  "win-min": '<path d="M6 12h12"/>',
  "win-max": '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  "win-restore": '<rect x="5" y="8" width="11" height="11" rx="1.5"/><path d="M9 5h8.5A1.5 1.5 0 0 1 19 6.5V15"/>',
  "keyboard": '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  "zoom-in": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>',
  "zoom-out": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  "swap": '<path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 4 4"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8a4 4 0 0 1-4-4"/>',
  "undo": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  "redo": '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  "aspect": '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4h3M17 14v-4h-3"/>',
  "pip": '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11" width="6" height="5" rx="1"/>',
  "save": '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-2z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
  "fit": '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
  "before-after": '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/><path d="M12 4h6.5A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H12z" fill="currentColor" stroke="none" opacity=".35"/>',
};
const svg = `<svg id="siv-icons" width="0" height="0" style="position:absolute" aria-hidden="true">${
  Object.entries(ICONS).map(([n, p]) => `<symbol id="i-${n}" viewBox="0 0 24 24">${p}</symbol>`).join("")}</svg>`;
document.body.insertAdjacentHTML("afterbegin", svg);
export const icon = (name, cls = "") => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
