// SIV · settings dialog. Panes are generated from a schema into Steez list rows (STZ 7.1.01) with
// switches (2.1), native selects (3.4.02), sliders (2.6.01), text fields (3.1.02), theme buttons (8.1.01),
// appearance (8.2.01), rebindable shortcuts and a hold-to-confirm reset (1.5.02).
import { openDialog } from "./api.js";
import { settings, onSetting, resetSettings, DEFAULT_KEYS, KEY_LABELS } from "./settings.js";
import { $, esc } from "./util.js";
import { aboutPane } from "./updates.js";

const sel = (opts) => ({ type: "select", opts });
const SECTIONS = {
  viewing: [
    ["h", "Opening images"],
    ["fitMode", sel([["shrink", "Fit, never enlarge small images"], ["fit", "Fit to window"], ["fill", "Fill window"], ["actual", "Actual pixels (100%)"]]), "Zoom when opening"],
    ["bg", sel([["black", "Black"], ["grey", "Dark grey"], ["light", "Light grey"], ["theme", "Theme wallpaper"]]), "Background"],
    ["checker", "switch", "Checkerboard behind transparency"],
    ["h", "Zoom"],
    ["wheel", sel([["zoom", "Zoom"], ["navigate", "Previous / next image"]]), "Scroll wheel", "Ctrl + wheel and touchpad pinch always zoom"],
    ["zoomStep", sel([[1.1, "Fine (10%)"], [1.25, "Normal (25%)"], [1.5, "Coarse (50%)"]]), "Zoom step"],
    ["smoothZoom", "switch", "Animated zoom"],
    ["pixelated", "switch", "Sharp pixels when zoomed in", "Shows real pixels above 200% instead of smoothing them"],
    ["h", "Mouse"],
    ["dragPan", "switch", "Drag to pan", "Left-drag moves the image around, like an artboard"],
    ["dblClick", sel([["zoom", "Toggle fit / 100%"], ["fullscreen", "Fullscreen"]]), "Double-click image"],
    ["note", "Photoshop controls work everywhere: hold Space and drag to pan. Ctrl+Space and click to zoom in, or drag left and right to zoom smoothly. Alt+Space and click to zoom out. Middle-drag pans too, and the mouse's back / forward buttons switch images."],
  ],
  folder: [
    ["h", "Browsing"],
    ["sort", sel([["name", "Name"], ["date", "Date modified"], ["size", "File size"], ["type", "Type"]]), "Sort by"],
    ["sortRev", "switch", "Reverse order"],
    ["loopFolder", "switch", "Wrap around at the ends", "After the last image, start again at the first"],
    ["h", "Speed"],
    ["preload", sel([[0, "Off"], [1, "1 each way"], [2, "2 each way"], [3, "3 each way"]]), "Preload neighbours", "Decodes nearby images in the background so they open instantly"],
  ],
  interface: [
    ["h", "Controls"],
    ["hideDelay", sel([[1500, "1.5 s"], [2500, "2.5 s"], [4000, "4 s"], [600000, "Never"]]), "Hide controls after", "Controls stay visible while editing"],
    ["showThumbs", "switch", "Folder strip previews", "Thumbnails while hovering the strip"],
    ["showBadges", "switch", "Format badges in the title bar"],
    ["osd", "switch", "On-screen messages", "Zoom, rotation and edit feedback"],
    ["alwaysOnTop", "switch", "Always on top"],
  ],
  appearance: [["theme"], ["prefs"]],
  export: [
    ["outdir"],
    ["h", "Format"],
    ["saveFormat", sel([["same", "Same as the original"], ["jpg", "JPEG"], ["png", "PNG (lossless)"], ["webp", "WebP"]]), "Save as", "TIFF, HDR and other formats save as PNG"],
    ["quality", { type: "range", min: 50, max: 100, step: 1, suffix: "" }, "JPEG / WebP quality"],
    ["suffix", { type: "text", placeholder: " edited" }, "Copy name suffix", "photo.jpg → photo edited.jpg"],
    ["note", "Saving always writes a new file, so your original is never changed. Camera metadata (EXIF) isn't carried over to the copy yet."],
  ],
  keys: [["keys"]],
  about: [["about"]],
};

export function initSettings(app) {
  const panes = $("setPanes");
  let current = "viewing";

  function row(key, ctl, label, sub) {
    const id = `set-${key}`;
    const lbl = `<span class="lbl">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>`;
    const v = settings[key];
    if (ctl === "switch") return `<div class="list-row">${lbl}<button type="button" class="switch" role="switch" aria-checked="${!!v}" aria-label="${esc(label)}" data-set="${key}"><span class="knob"></span></button></div>`;
    if (ctl.type === "select") return `<div class="list-row">${lbl}<select class="input input--plain" id="${id}" data-set="${key}" aria-label="${esc(label)}">${ctl.opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
    if (ctl.type === "range") return `<div class="list-row">${lbl}<input type="range" id="${id}" min="${ctl.min}" max="${ctl.max}" step="${ctl.step}" value="${v}" data-set="${key}" data-output="${id}-o" data-suffix="${ctl.suffix || ""}" aria-label="${esc(label)}"><output class="val-out" id="${id}-o">${v}${ctl.suffix || ""}</output></div>`;
    if (ctl.type === "text") return `<div class="list-row">${lbl}<input class="input" id="${id}" data-set="${key}" value="${esc(v)}" placeholder="${esc(ctl.placeholder || "")}" aria-label="${esc(label)}" spellcheck="false"></div>`;
    return "";
  }

  function build(sec) {
    let html = "", group = [];
    const flush = () => { if (group.length) { html += `<div class="list">${group.join("")}</div>`; group = []; } };
    for (const it of SECTIONS[sec]) {
      const [k] = it;
      if (k === "h") { flush(); html += `<h3>${esc(it[1])}</h3>`; }
      else if (k === "note") { flush(); html += `<p class="caption">${esc(it[1])}</p>`; }
      else if (k === "theme") {
        flush();
        html += `<h3>Theme</h3><!-- STZ 8.1.01 --><div class="row">${Steez.themes.map((t) => `<button type="button" class="btn btn--glass btn--sm pressable" data-set-theme="${t}" aria-pressed="${t === settings.theme}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
          <p class="caption">Noir is the default greyscale look, matching SVP. Every theme keeps the same controls.</p>`;
      } else if (k === "prefs") {
        const r = document.documentElement.dataset;
        html += `<h3>Accessibility</h3><!-- STZ 8.2.01 --><div class="list">
          <div class="list-row"><span class="lbl">Reduce transparency<small>Glass becomes solid</small></span><button type="button" class="switch" role="switch" aria-checked="${r.transparency === "reduced"}" data-pref="transparency" aria-label="Reduce transparency"><span class="knob"></span></button></div>
          <div class="list-row"><span class="lbl">Reduce motion<small>Springs and drifts stop</small></span><button type="button" class="switch" role="switch" aria-checked="${r.motion === "reduced"}" data-pref="motion" aria-label="Reduce motion"><span class="knob"></span></button></div>
          <div class="list-row"><span class="lbl">Increase contrast<small>Stronger text and edges</small></span><button type="button" class="switch" role="switch" aria-checked="${r.contrast === "more"}" data-pref="contrast" aria-label="Increase contrast"><span class="knob"></span></button></div></div>`;
      } else if (k === "outdir") {
        flush();
        html += `<h3>Output</h3><div class="list"><div class="list-row"><span class="lbl">Save copies to<small id="outDirLbl">${esc(settings.outDir || "Same folder as the original")}</small></span>
          <button type="button" class="btn btn--glass btn--sm pressable" id="outDirPick">Choose…</button>${settings.outDir ? `<button type="button" class="btn btn--plain btn--sm pressable" id="outDirReset">Reset</button>` : ""}</div></div>`;
      } else if (k === "keys") {
        html += `<p class="caption">Click a shortcut, then press the new key. Esc cancels, Backspace clears. Space (hand), Ctrl+Space (zoom) and \\ (hold for the original) are fixed.</p><div class="list keys-grid">${Object.keys(DEFAULT_KEYS).map((a) =>
          `<div class="list-row"><span class="lbl">${esc(KEY_LABELS[a] || a)}</span>${(settings.keys[a] || []).map((c, i) => `<kbd data-act="${a}" data-i="${i}" tabindex="0" role="button" aria-label="Change shortcut for ${esc(KEY_LABELS[a])}">${esc(pretty(c))}</kbd>`).join("")}<kbd data-act="${a}" data-i="${(settings.keys[a] || []).length}" tabindex="0" role="button" class="faint" aria-label="Add shortcut">+</kbd></div>`).join("")}</div>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn--plain btn--sm pressable" id="keysReset">Reset shortcuts</button></div>`;
      } else if (k === "about") {
        html += aboutPane() + `
          <h3>Reset</h3><div class="list"><div class="list-row"><span class="lbl">Reset all settings<small>Keeps recent files</small></span>
          <!-- STZ 1.5.02 --><button type="button" class="btn btn--danger btn-hold btn--sm pressable" data-hold="1200" id="resetAll"><svg class="i"><use href="#i-refresh"/></svg>Hold to reset</button></div></div>`;
      } else group.push(row(k, it[1], it[2], it[3]));
    }
    flush();
    return `<div class="set-pane" data-pane="${sec}">${html}</div>`;
  }

  function pretty(c) { return c.replace(/Key([A-Z])/g, "$1").replace(/Digit(\d)/g, "$1").replace("Comma", ",").replace("Period", ".").replace("BracketLeft", "[").replace("BracketRight", "]").replace("Equal", "=").replace("NumpadAdd", "Num +").replace("NumpadSubtract", "Num −").replace("Minus", "−").replace("Backslash", "\\").replace("Arrow", "").replace("Escape", "Esc").replace(/\+/g, " + "); }

  function show(sec) {
    current = sec;
    panes.innerHTML = build(sec);
    $("setNav").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.sec === sec)));
    Steez.init($("d-settings"));
  }

  // ---- events
  $("setNav").addEventListener("click", (e) => { const b = e.target.closest("[data-sec]"); if (b) show(b.dataset.sec); });
  panes.addEventListener("click", async (e) => {
    const sw = e.target.closest(".switch[data-set]");
    if (sw) setTimeout(() => { settings[sw.dataset.set] = sw.getAttribute("aria-checked") === "true"; }, 0);
    if (e.target.closest("[data-set-theme]")) setTimeout(() => { settings.theme = document.documentElement.dataset.theme; show("appearance"); }, 50);
    if (e.target.closest("#outDirPick")) { const d = await openDialog({ directory: true }); if (d) { settings.outDir = d; show("export"); } }
    if (e.target.closest("#outDirReset")) { settings.outDir = ""; show("export"); }
    if (e.target.closest("#keysReset")) { settings.keys = structuredClone(DEFAULT_KEYS); show("keys"); }
    const kb = e.target.closest("kbd[data-act]"); if (kb) capture(kb);
  });
  panes.addEventListener("change", (e) => {
    const t = e.target.closest("[data-set]"); if (!t || t.classList.contains("switch")) return;
    const old = settings[t.dataset.set];
    settings[t.dataset.set] = typeof old === "number" ? +t.value : t.value;
  });
  panes.addEventListener("input", (e) => { const t = e.target; if (t.type === "range" && t.dataset.set) settings[t.dataset.set] = +t.value; });
  panes.addEventListener("stz:confirm", (e) => { if (e.target.closest("#resetAll")) { resetSettings(); Steez.setTheme("noir"); Steez.toast("ok", "Settings reset"); show(current); } });

  function capture(kb) {
    kb.classList.add("listening"); kb.textContent = "Press a key…";
    app.capturingKey = true;
    const onKey = (e) => {
      if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) return;
      e.preventDefault(); e.stopPropagation();
      removeEventListener("keydown", onKey, true);
      app.capturingKey = false;
      const act = kb.dataset.act, i = +kb.dataset.i;
      const keys = structuredClone(settings.keys);
      const list = [...(keys[act] || [])];
      if (e.code === "Escape") { show("keys"); return; }
      if (e.code === "Backspace") list.splice(i, 1);
      else {
        const c = app.combo(e);
        for (const [a, l] of Object.entries(keys)) if (a !== act) keys[a] = l.filter((x) => x !== c); // steal from others
        list[i] = c;
      }
      keys[act] = [...new Set(list.filter(Boolean))];
      settings.keys = keys;
      show("keys");
    };
    addEventListener("keydown", onKey, true);
  }

  function open(sec) { show(sec || current); Steez.openDialog("d-settings"); requestAnimationFrame(() => requestAnimationFrame(() => Steez.init($("d-settings")))); }
  $("btnSettings").onclick = () => open();
  $("d-settings").addEventListener("stz:close", () => { app.capturingKey = false; });
  app.openSettings = open;
  app.registerPaneRenderer = (sec, give) => give(() => { if (current === sec && $("d-settings").open) { const top = panes.scrollTop; show(sec); panes.scrollTop = top; } });
  void onSetting;
}
