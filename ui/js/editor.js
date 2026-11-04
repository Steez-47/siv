// SIV · non-destructive editing: per-image edit state with undo/redo, the Adjust panel
// (looks STZ 2.5.02, accordion STZ 7.5.01, sliders STZ 2.6.01), before/after, save and copy.
// The original file is never touched: "Save copy" writes a new file next to it (or to the export folder).
import { saveBytes, saveDialog, reveal } from "./api.js";
import { settings } from "./settings.js";
import { Renderer, IDENTITY, outputSize } from "./gl.js";
import { $, esc, base, dirname, stem, extOf } from "./util.js";

export const ADJ = [
  { g: "Light", k: "exposure", label: "Exposure", min: -5, max: 5, step: 0.05, fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV` },
  { g: "Light", k: "contrast", label: "Contrast" },
  { g: "Light", k: "highlights", label: "Highlights" },
  { g: "Light", k: "shadows", label: "Shadows" },
  { g: "Light", k: "whites", label: "Whites" },
  { g: "Light", k: "blacks", label: "Blacks" },
  { g: "Color", k: "temp", label: "Temperature" },
  { g: "Color", k: "tint", label: "Tint" },
  { g: "Color", k: "hue", label: "Hue", min: -180, max: 180, fmt: (v) => `${v > 0 ? "+" : ""}${v}°` },
  { g: "Color", k: "saturation", label: "Saturation" },
  { g: "Color", k: "vibrance", label: "Vibrance" },
  { g: "Detail", k: "sharpen", label: "Sharpen", min: 0 },
  { g: "Detail", k: "clarity", label: "Clarity" },
  { g: "Effects", k: "vignette", label: "Vignette" },
  { g: "Effects", k: "grain", label: "Grain", min: 0 },
].map((a) => ({ min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? "+" : ""}${v}`, ...a }));

export const LOOKS = {
  none: { label: "Original", adj: {} },
  vivid: { label: "Vivid", adj: { contrast: 15, vibrance: 35, saturation: 8, clarity: 12 } },
  punch: { label: "Punch", adj: { contrast: 30, clarity: 28, vibrance: 22, sharpen: 25, vignette: -18 } },
  warm: { label: "Warm", adj: { temp: 28, tint: 4, vibrance: 10 } },
  cool: { label: "Cool", adj: { temp: -26, tint: -4, vibrance: 6 } },
  mono: { label: "Mono", adj: { saturation: -100, contrast: 12 } },
  noir: { label: "Noir", adj: { saturation: -100, contrast: 45, blacks: -18, clarity: 25, vignette: -35 } },
  fade: { label: "Fade", adj: { contrast: -22, blacks: 32, saturation: -18, temp: 6 } },
  film: { label: "Film", adj: { contrast: 10, blacks: 18, highlights: -20, temp: 10, saturation: -10, grain: 22 } },
};

const clone = (e) => structuredClone(e);
const adjEmpty = (a) => !Object.values(a || {}).some((v) => v);
export const isIdentity = (e) => adjEmpty(e.adj) && !e.crop && !e.rot && !e.flipH && !e.flipV;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function initEditor(app) {
  const body = document.body;
  const store = new Map();           // path → { e, undo: [], redo: [] }
  let renderer = null, glError = null, srcFor = null, srcReady = null;
  let before = false, raf = 0, pending = null;
  const canvas = $("glc");

  const entry = (p = app.cur.path) => { if (!store.has(p)) store.set(p, { e: IDENTITY(), undo: [], redo: [] }); return store.get(p); };
  const ed = {
    get e() { return app.cur.path ? entry().e : IDENTITY(); },
    get edited() { return !!app.cur.path && !isIdentity(entry().e); },
    isEdited: (p) => store.has(p) && !isIdentity(store.get(p).e),
    draft: null,                     // crop mode works on a draft geometry, see crop.js
    /** Replace the edit (pushes undo unless push=false). */
    set(e, { push = true } = {}) {
      const en = entry();
      if (same(en.e, e)) return;
      if (push) { en.undo.push(clone(en.e)); en.redo = []; if (en.undo.length > 200) en.undo.shift(); }
      en.e = clone(e);
      changed();
    },
    undo() { const en = entry(); if (!en.undo.length) return app.osd("Nothing to undo"); en.redo.push(clone(en.e)); en.e = en.undo.pop(); changed(); app.osd("Undo"); },
    redo() { const en = entry(); if (!en.redo.length) return app.osd("Nothing to redo"); en.undo.push(clone(en.e)); en.e = en.redo.pop(); changed(); app.osd("Redo"); },
    reset() { if (!ed.edited) return; ed.set(IDENTITY()); app.osd("Edits reset"); },
    rotate(d) { const e = clone(ed.e); e.rot = (e.rot + (d > 0 ? 1 : 3)) % 4; if (e.crop) e.crop = rotRect(e.crop, d); ed.set(e); app.osd(d > 0 ? "Rotated right" : "Rotated left"); },
    flip(axis) {
      const e = clone(ed.e);
      // flips act on what you see: after a quarter turn, a horizontal flip is a source vertical flip
      const srcAxis = e.rot % 2 ? (axis === "h" ? "v" : "h") : axis;
      if (srcAxis === "h") e.flipH = !e.flipH; else e.flipV = !e.flipV;
      if (e.crop) e.crop = flipRect(e.crop, axis);
      ed.set(e); app.osd(axis === "h" ? "Flipped horizontally" : "Flipped vertically");
    },
    refresh, save, copy, ensureSource, renderer: () => renderer,
    forget: (p) => store.delete(p),
  };
  app.edit = ed;

  // ---------------------------------------------------------------- display
  /** Picks what the stage shows: the plain <img> (zero cost) or the WebGL canvas with the edit applied. */
  async function refresh({ keep = true } = {}) {
    const cur = app.cur;
    if (!cur.path || !cur.img) return;
    const cropping = !!ed.draft;
    const e = cropping ? { ...ed.e, ...ed.draft, crop: null } : ed.e;
    const useGl = !before && (cropping || !isIdentity(e));
    let w = cur.w, h = cur.h;
    if (useGl) {
      const ok = await ensureSource();
      if (!ok || cur !== app.cur) return showImg(keep);
      [w, h] = outputSize(cur.w, cur.h, e, !cropping);
      cancelAnimationFrame(raf);
      renderer.render(e, { withCrop: !cropping });
      canvas.hidden = false; cur.img.style.visibility = "hidden";
      // the GL source may be downscaled for huge images: display at the original geometry anyway
      app.viewer.setContent(w, h, { keep });
    } else showImg(keep);
    $("btnBefore").disabled = !ed.edited;
    renderBadges();
    app.onEditChange?.();
  }
  function showImg(keep) { canvas.hidden = true; app.cur.img.style.visibility = ""; app.viewer.setContent(app.cur.w, app.cur.h, { keep }); }
  /** Re-render on the next frame (slider drags). */
  function live() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }

  async function ensureSource() {
    if (glError) return false;
    try { renderer ??= new Renderer(canvas); }
    catch (e) { glError = e; Steez.toast("err", `Editing needs WebGL2, which isn't available: ${e.message}`); return false; }
    const cur = app.cur;
    if (srcFor === cur.img && srcReady) return srcReady;
    srcFor = cur.img;
    srcReady = (async () => {
      const max = renderer.maxSize, w = cur.w, h = cur.h, s = Math.min(1, max / Math.max(w, h));
      const opts = s < 1 ? { resizeWidth: Math.floor(w * s), resizeHeight: Math.floor(h * s), resizeQuality: "high" } : {};
      if (s < 1) Steez.toast("info", `This image is larger than your GPU's ${max}px limit, so edits use a ${opts.resizeWidth} × ${opts.resizeHeight} copy.`, { ms: 6000 });
      const bmp = await createImageBitmap(cur.img, opts);
      if (srcFor !== cur.img) { bmp.close(); return false; }
      renderer.setSource(bmp, bmp.width, bmp.height);
      return true;
    })().catch((e) => { Steez.toast("err", `Couldn't prepare the image for editing: ${e.message || e}`); srcFor = null; return false; });
    return srcReady;
  }

  function changed() { refresh(); syncPanel(); syncUndo(); }

  // ---------------------------------------------------------------- geometry helpers (normalized rects)
  function rotRect(c, d) { return d > 0 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w }; }
  function flipRect(c, axis) { return axis === "h" ? { ...c, x: 1 - c.x - c.w } : { ...c, y: 1 - c.y - c.h }; }
  ed.rotRect = rotRect; ed.flipRect = flipRect;

  // ---------------------------------------------------------------- badges
  function renderBadges() { app.renderBadges?.(); }

  // ---------------------------------------------------------------- panel
  const groups = [...new Set(ADJ.map((a) => a.g))];
  $("edLooks").innerHTML = Object.entries(LOOKS).map(([id, l]) => `<button type="button" class="chip pressable" aria-pressed="${id === "none"}" data-look="${id}"><span class="chip-check"><span><svg class="i"><use href="#i-check"/></svg></span></span>${esc(l.label)}</button>`).join("");
  $("edGroups").innerHTML = groups.map((g, gi) => `<div class="acc-item" data-group="${g}"><button type="button" class="acc-head" aria-expanded="${gi < 2}">${g}<span class="dot-on" hidden></span><svg class="i"><use href="#i-chev-down"/></svg></button><div class="acc-body"><div class="stack">${
    ADJ.filter((a) => a.g === g).map((a) => `<div class="slider" data-k="${a.k}"><div class="slider-top"><label for="adj-${a.k}">${esc(a.label)}</label><output id="adj-${a.k}-o">${a.fmt(0)}</output></div><input type="range" id="adj-${a.k}" min="${a.min}" max="${a.max}" step="${a.step}" value="0" data-adj="${a.k}" aria-label="${esc(a.label)}"></div>`).join("")
  }</div></div></div>`).join("");

  function paint(input) {
    const a = ADJ.find((x) => x.k === input.dataset.adj), v = +input.value;
    $(`adj-${a.k}-o`).textContent = a.fmt(v);
    input.style.setProperty("--val", `${((v - a.min) / (a.max - a.min)) * 100}%`);
    input.closest(".slider").classList.toggle("changed", v !== 0);
  }
  function syncPanel() {
    if ($("editPanel").hidden) return;
    const adj = ed.e.adj || {};
    for (const a of ADJ) { const i = $(`adj-${a.k}`); if (document.activeElement !== i || !pending) { i.value = String(adj[a.k] || 0); paint(i); } }
    for (const g of groups) $("edGroups").querySelector(`[data-group="${g}"] .dot-on`).hidden = !ADJ.some((a) => a.g === g && adj[a.k]);
    const look = Object.entries(LOOKS).find(([, l]) => same(sortKeys(l.adj), sortKeys(clean(adj))))?.[0];
    $("edLooks").querySelectorAll("[data-look]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.look === look)));
    $("edReset").disabled = !ed.edited;
  }
  const clean = (a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v));
  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  function syncUndo() {
    const en = app.cur.path ? entry() : { undo: [], redo: [] };
    $("edUndo").disabled = !en.undo.length; $("edRedo").disabled = !en.redo.length;
  }
  ed.sync = () => { syncPanel(); syncUndo(); $("btnBefore").disabled = !ed.edited; };

  const groupsEl = $("edGroups");
  groupsEl.addEventListener("input", (e) => {
    const i = e.target.closest("[data-adj]"); if (!i) return;
    const en = entry();
    pending ??= clone(en.e);
    en.e = { ...en.e, adj: { ...en.e.adj, [i.dataset.adj]: +i.value } };
    paint(i); live();
  });
  groupsEl.addEventListener("change", (e) => {
    const i = e.target.closest("[data-adj]"); if (!i || !pending) return;
    const en = entry();
    if (!same(pending, en.e)) { en.undo.push(pending); en.redo = []; }
    pending = null; syncPanel(); syncUndo(); renderBadges();
  });
  // double-click a slider to reset it
  groupsEl.addEventListener("dblclick", (e) => {
    const s = e.target.closest(".slider"); if (!s) return;
    const k = s.dataset.k, cur = ed.e;
    if (!cur.adj?.[k]) return;
    ed.set({ ...cur, adj: { ...cur.adj, [k]: 0 } });
  });
  $("edLooks").addEventListener("click", (e) => {
    const c = e.target.closest("[data-look]"); if (!c) return;
    const l = LOOKS[c.dataset.look];
    setTimeout(() => { ed.set({ ...ed.e, adj: { ...l.adj } }); app.osd(l.label); }, 0);
  });
  $("edReset").onclick = () => ed.reset();
  $("edUndo").onclick = () => ed.undo();
  $("edRedo").onclick = () => ed.redo();
  $("edSave").onclick = () => save();
  $("edClose").onclick = () => togglePanel(false);
  $("btnAdjust").onclick = () => togglePanel();

  function togglePanel(force) {
    const p = $("editPanel"), on = force ?? p.hidden;
    if (on && !app.cur.path) return;
    if (on && app.crop?.active) app.crop.cancel();
    p.hidden = !on;
    $("btnAdjust").setAttribute("aria-pressed", String(on));
    body.classList.toggle("panel-open", on);
    if (on) { $("infoPanel").hidden = true; syncPanel(); syncUndo(); ensureSource(); }
    app.layoutInsets?.();
  }
  ed.togglePanel = togglePanel;
  ed.panelOpen = () => !$("editPanel").hidden;

  // ---------------------------------------------------------------- before / after (hold)
  function setBefore(on) {
    if (on === before || (on && !ed.edited) || ed.draft) return;
    before = on; $("btnBefore").classList.toggle("held", on);
    refresh(); if (on) app.osd("Original", 600);
  }
  ed.setBefore = setBefore;
  const bb = $("btnBefore");
  bb.addEventListener("pointerdown", (e) => { if (e.button === 0) setBefore(true); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) bb.addEventListener(ev, () => setBefore(false));
  addEventListener("keydown", (e) => { if (e.code === "Backslash" && !e.repeat && !e.target.closest("input:not([type=range]), textarea") && body.dataset.mode === "view") setBefore(true); });
  addEventListener("keyup", (e) => { if (e.code === "Backslash") setBefore(false); });
  addEventListener("blur", () => setBefore(false));

  // ---------------------------------------------------------------- export
  const FMT = { png: ["image/png", "PNG"], jpg: ["image/jpeg", "JPEG"], webp: ["image/webp", "WebP"] };
  function targetExt(src) {
    if (settings.saveFormat !== "same") return settings.saveFormat;
    const x = extOf(src);
    return ["jpg", "jpeg", "jpe", "jfif"].includes(x) ? "jpg" : x === "webp" ? "webp" : "png";
  }
  async function encode(ext) {
    if (!(await ensureSource())) throw new Error("the editor couldn't start");
    renderer.render(ed.e, { withCrop: true });
    const blob = await renderer.toBlob(FMT[ext][0], ext === "png" ? undefined : settings.quality / 100);
    if (ed.draft || before || isIdentity(ed.e)) refresh(); // canvas was repurposed for the export frame
    return blob;
  }
  const join = (dir, name) => `${dir}${dir.includes("/") && !dir.includes("\\") ? "/" : "\\"}${name}`;
  async function save({ as = false } = {}) {
    const cur = app.cur; if (!cur.path) return;
    if (ed.draft) app.crop.apply();
    let ext = targetExt(cur.path), path, unique = false;
    const name = `${stem(cur.path)}${settings.suffix ?? " edited"}.${ext}`;
    if (as) {
      path = await saveDialog({ defaultPath: join(settings.outDir || dirname(cur.path), name), filters: [
        { name: "JPEG", extensions: ["jpg", "jpeg"] }, { name: "PNG", extensions: ["png"] }, { name: "WebP", extensions: ["webp"] }].sort((a) => (a.extensions[0] === ext ? -1 : 0)) });
      if (!path) return;
      const x = extOf(path); ext = x === "jpeg" ? "jpg" : FMT[x] ? x : ext;
      if (!FMT[x] && x !== "jpeg") path += `.${ext}`;
    } else { path = join(settings.outDir || dirname(cur.path), name); unique = true; }
    try {
      app.busy?.("Saving…");
      const blob = await encode(ext);
      const out = await saveBytes(path, new Uint8Array(await blob.arrayBuffer()), unique);
      app.idle?.();
      Steez.toast("ok", `Saved · ${base(out)}`, { action: "Show", onAction: () => reveal(out) });
      app.onSaved?.(out);
    } catch (e) { app.idle?.(); Steez.toast("err", `Couldn't save the image: ${e.message || e}`); }
  }
  async function copy() {
    if (!app.cur.path) return;
    try {
      const blob = isIdentity(ed.e) && !ed.draft ? await plainPng() : await encode("png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      Steez.toast("ok", ed.edited ? "Copied the edited image" : "Image copied");
    } catch (e) { Steez.toast("err", `Couldn't copy the image: ${e.message || e}`); }
  }
  async function plainPng() {
    const c = document.createElement("canvas"); c.width = app.cur.w; c.height = app.cur.h;
    c.getContext("2d").drawImage(app.cur.img, 0, 0);
    return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("encode failed"))), "image/png"));
  }
  $("btnSave").onclick = () => save();
  $("mSaveAs").onclick = () => save({ as: true });
  $("mCopy").onclick = copy;
  $("mReset").onclick = () => ed.reset();
  $("mRotL").onclick = () => (app.crop?.active ? app.crop.rotate(-1) : ed.rotate(-1));
  $("mRotR").onclick = () => (app.crop?.active ? app.crop.rotate(1) : ed.rotate(1));
  $("mFlipH").onclick = () => (app.crop?.active ? app.crop.flip("h") : ed.flip("h"));
  $("mFlipV").onclick = () => (app.crop?.active ? app.crop.flip("v") : ed.flip("v"));
  return ed;
}
