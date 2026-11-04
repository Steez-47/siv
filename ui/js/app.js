// SIV · app shell: wires the viewer, folder strip, editor, crop and compare to the Steez UI.
// Same chrome as SVP: glass title bar, auto-hiding dock, OSD, info panel, settings.
//
// Speed: images are served straight from disk by the local server and decoded by WebView2 off the main
// thread (img.decode()). The decoded <img> element itself is swapped into the stage, and neighbours in the
// folder are decoded ahead of time, so stepping through a folder is instant.
import "./icons.js";
import { invoke, listen, win, setServer, url, openDialog, reveal, isTauri, IMAGE_EXT } from "./api.js";
import { settings, onSetting, pushRecent } from "./settings.js";
import { Viewer, tool } from "./viewer.js";
import { Strip } from "./strip.js";
import { initEditor, ADJ, isIdentity } from "./editor.js";
import { initCrop } from "./crop.js";
import { initCompare } from "./compare.js";
import { initSettings } from "./settings-ui.js";
import { initUpdates } from "./updates.js";
import { $, esc, base, dirname, bytes, mp, pct, formatName, extOf, clamp } from "./util.js";

const body = document.body;
const viewer = new Viewer($("view"), $("surface"), {
  leftDrag: (e) => settings.dragPan && !app.crop?.active && $("view").classList.contains("can-pan"),
  onDblClick: (e, px, py) => { if (app.crop?.active) return; settings.dblClick === "fullscreen" ? toggleFull() : viewer.toggle(px, py); },
  onNavigate: (d) => go(folder.idx + d),
});
const strip = new Strip();
const folder = { dir: "", files: [], list: [], idx: 0 };
const cache = new Map();            // url → decoded <img> (current + preloaded neighbours)
let openSeq = 0;

export const app = {
  viewer, strip, settings, folder, osd, setMode, openFile, layoutInsets, busy: showBusy, idle: hideBusy,
  cur: { path: "", img: $("img"), w: 0, h: 0, size: 0, mtime: 0 },
  toast: (...a) => Steez.toast(...a),
};

// ---------------------------------------------------------------- boot
(async function boot() {
  if (!isTauri) console.warn("SIV UI running outside Tauri (preview mode)");
  initEditor(app); initCrop(app); initCompare(app); initSettings(app); initUpdates(app);
  applyPrefs(); renderRecent();
  try {
    const b = await invoke("boot");
    setServer(b.port, b.token);
    if (b.file) openFile(b.file);
  } catch (e) { console.warn(e); }
  listen("open-file", (p) => openFile(p));
  if (window.__TAURI__?.webview) window.__TAURI__.webview.getCurrentWebview().onDragDropEvent((e) => onDrag(e.payload));
})();

function applyPrefs() {
  body.dataset.bg = settings.bg;
  body.dataset.checker = settings.checker === false ? "off" : "on";
  $("mTop").setAttribute("aria-checked", String(!!settings.alwaysOnTop)); win()?.setAlwaysOnTop(!!settings.alwaysOnTop).catch(() => {});
  $("m-sort").querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sort === settings.sort)));
  $("sortRev").setAttribute("aria-checked", String(!!settings.sortRev));
}
onSetting((k) => {
  if (["bg", "checker", "alwaysOnTop", "sort", "sortRev", "*"].includes(k)) applyPrefs();
  if (k === "showBadges" || k === "*") renderBadges();
  if (k === "sort" || k === "sortRev") { applySort(); osd(`Sorted by ${{ name: "name", date: "date", size: "size", type: "type" }[settings.sort]}${settings.sortRev ? ", reversed" : ""}`); }
  if (k === "pixelated") viewer.apply();
  if (k === "preload") preload();
});

// ---------------------------------------------------------------- modes (empty / view / compare)
function setMode(m) { body.dataset.mode = m; poke(); layoutInsets(); }

// ---------------------------------------------------------------- open
function newImg(src) {
  const im = new Image();
  im.crossOrigin = "anonymous"; im.decoding = "async"; im.draggable = false; im.alt = "";
  im.src = src;
  im._ready = im.decode().then(() => true, () => false);
  return im;
}

export async function openFile(path, opts = {}) {
  if (!path) return;
  if (body.dataset.mode === "compare") app.exitCompare?.();
  if (app.crop?.active) app.crop.cancel();
  const seq = ++openSeq;
  const known = folder.list.find((f) => f.path === path);
  const info = known || await invoke("file_info", { path }).catch(() => null);
  if (seq !== openSeq) return;
  if (!info) { Steez.toast("err", `Can't find ${base(path)}. It may have been moved or deleted.`); return; }
  const src = url.img(path, info.mtime);
  let im = cache.get(src);
  if (!im) { im = newImg(src); cache.set(src, im); }
  // show the folder position immediately, even before pixels arrive
  if (opts.nav) { strip.update(folder.idx); renderCounter(); }
  setTitle(path);
  const slow = setTimeout(() => { if (seq === openSeq) showBusy("Opening…"); }, 160);
  const ok = await im._ready;
  clearTimeout(slow);
  if (seq !== openSeq) return;
  hideBusy();
  if (!ok || !im.naturalWidth) {
    cache.delete(src);
    Steez.toast("err", `Can't open ${base(path)}: the format isn't supported or the file is damaged.`, { ms: 6000 });
    if (!app.cur.path) setMode("empty");
    return;
  }
  // swap the decoded element in: no re-decode, no flash
  const old = app.cur.img;
  im.id = "img";
  old.replaceWith(im);
  $("glc").hidden = true;
  app.cur = { path, img: im, w: im.naturalWidth, h: im.naturalHeight, size: info.size, mtime: info.mtime, src };
  setMode("view");
  app.edit.sync();
  await app.edit.refresh({ keep: false });
  renderBadges(); renderCounter();
  if (!$("infoPanel").hidden) renderInfo();
  if (!opts.nav) { pushRecent(path); renderRecent(); await loadFolder(path); }
  preload();
}

function setTitle(path) {
  $("title").textContent = base(path);
  win()?.setTitle(`${base(path)} · SIV`).catch(() => {});
}
app.restoreTitle = () => { if (app.cur.path) { setTitle(app.cur.path); renderBadges(); } };

function showBusy(t) { clearTimeout(showBusy._t); showBusy._t = setTimeout(() => { $("busy").hidden = false; $("busyText").textContent = t; }, 120); }
function hideBusy() { clearTimeout(showBusy._t); $("busy").hidden = true; }

// ---------------------------------------------------------------- folder
async function loadFolder(path) {
  try {
    const r = await invoke("list_folder", { path });
    if (app.cur.path !== path) return;
    folder.dir = r.dir; folder.files = r.files;
    applySort();
  } catch (e) { console.warn("list_folder", e); }
}
function applySort() {
  const l = [...folder.files], s = settings.sort;
  if (s === "date") l.sort((a, b) => b.mtime - a.mtime);
  else if (s === "size") l.sort((a, b) => b.size - a.size);
  else if (s === "type") l.sort((a, b) => extOf(a.name).localeCompare(extOf(b.name)) || folder.files.indexOf(a) - folder.files.indexOf(b));
  if (settings.sortRev) l.reverse();
  folder.list = l;
  folder.idx = Math.max(0, l.findIndex((f) => f.path === app.cur.path));
  strip.set(l, folder.idx);
  renderCounter();
  preload();
}
function wrapIdx(i) {
  const n = folder.list.length;
  return settings.loopFolder ? ((i % n) + n) % n : clamp(i, 0, n - 1);
}
function go(i, opts = {}) {
  const n = folder.list.length;
  if (n < 2 || body.dataset.mode !== "view") return;
  const j = wrapIdx(i);
  if (j === folder.idx) { if (i !== j) osd(i < 0 ? "First image" : "Last image"); return; }
  if (!settings.loopFolder && i !== j) return;
  folder.idx = j;
  openFile(folder.list[j].path, { nav: true, ...opts });
}
app.go = go;
app.neighbor = (d) => (folder.list.length > 1 ? folder.list[wrapIdx(folder.idx + d)]?.path : "");
strip.addEventListener("go", ({ detail }) => go(detail.i));

/** Decode the next images ahead of time (forward first: that's where people usually go). */
function preload() {
  const n = settings.preload | 0, list = folder.list, keep = new Set([app.cur.src]);
  if (n && list.length > 1) {
    for (const d of [1, -1, 2, 3, -2, -3].filter((d) => Math.abs(d) <= n)) {
      const f = list[wrapIdx(folder.idx + d)];
      if (!f || f.path === app.cur.path) continue;
      const src = url.img(f.path, f.mtime);
      keep.add(src);
      if (!cache.has(src)) cache.set(src, newImg(src));
    }
  }
  for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
}

function renderCounter() {
  const n = folder.list.length;
  $("cIdx").textContent = n ? String(folder.idx + 1) : app.cur.path ? "1" : "0";
  $("cTot").textContent = String(n || (app.cur.path ? 1 : 0));
  $("btnPrev").disabled = $("btnNext").disabled = n < 2;
}
$("btnPrev").onclick = () => go(folder.idx - 1);
$("btnNext").onclick = () => go(folder.idx + 1);
$("m-sort").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sort]"); if (b) settings.sort = b.dataset.sort;
  if (e.target.closest("#sortRev")) setTimeout(() => { settings.sortRev = $("sortRev").getAttribute("aria-checked") === "true"; }, 0);
});

// ---------------------------------------------------------------- badges + zoom label
function renderBadges() {
  const c = app.cur, el = $("badges");
  if (!c.path || !settings.showBadges || body.dataset.mode !== "view") { el.innerHTML = ""; return; }
  const b = [formatName(c.path), `${c.w} × ${c.h}`, mp(c.w, c.h), bytes(c.size)];
  el.innerHTML = b.map((x) => `<span class="badge">${esc(x)}</span>`).join("") + (app.edit?.edited ? `<span class="badge tone-info" data-tip="Unsaved edits. Save a copy with Ctrl+S"><svg class="i i-sm"><use href="#i-edit"/></svg>Edited</span>` : "");
}
app.renderBadges = renderBadges;
const zoomTarget = () => (body.dataset.mode === "compare" ? app.cmpViewer : viewer);
function onZoom() { const v = zoomTarget(); $("btnZoom").textContent = v?.w ? pct(v.z) : "100%"; }
app.onZoom = onZoom;
viewer.addEventListener("change", onZoom);

$("btnZoomIn").onclick = () => zoomTarget().step(1);
$("btnZoomOut").onclick = () => zoomTarget().step(-1);
$("m-zoom").addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom]"); if (!b) return;
  const v = zoomTarget(), z = b.dataset.zoom;
  if (z === "fit") v.fit(); else if (z === "fill") v.fill(); else v.zoomTo(+z, undefined, undefined, { animate: true });
});

/** Editing keeps the chrome up, so fit the image into the space between the bars and the panel. */
function layoutInsets() {
  const editing = app.crop?.active || app.edit?.panelOpen?.();
  const panel = app.edit?.panelOpen?.() ? Math.min(320, innerWidth - 12) + 12 : 0;
  const dockH = $("dock").offsetHeight || 80;
  viewer.setInsets(editing ? { top: 54, right: panel, bottom: dockH + 22, left: 0 } : {}, true);
  poke();
}
addEventListener("resize", () => layoutInsets());

// ---------------------------------------------------------------- info panel
async function renderInfo() {
  const c = app.cur;
  if (!c.path) { $("infoBody").innerHTML = `<p class="caption">Open an image to see its details.</p>`; return; }
  const kv = (rows) => `<dl class="kv">${rows.filter((r) => r[1] !== "" && r[1] != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const n = folder.list.length;
  let h = `<h5>File</h5>` + kv([["Name", base(c.path)], ["Folder", dirname(c.path)], ["Format", formatName(c.path)], ["Size", bytes(c.size)],
    ["Modified", c.mtime ? new Date(c.mtime).toLocaleString() : ""], ["Position", n > 1 ? `${folder.idx + 1} of ${n}` : ""]]);
  h += `<h5>Image</h5>` + kv([["Dimensions", `${c.w} × ${c.h} px`], ["Megapixels", mp(c.w, c.h)], ["Aspect", aspect(c.w, c.h)]]);
  const e = app.edit.e;
  if (!isIdentity(e)) {
    const rows = ADJ.filter((a) => e.adj?.[a.k]).map((a) => [a.label, a.fmt(e.adj[a.k])]);
    if (e.crop) rows.unshift(["Crop", `${Math.round(e.crop.w * (e.rot % 2 ? c.h : c.w))} × ${Math.round(e.crop.h * (e.rot % 2 ? c.w : c.h))}`]);
    if (e.rot) rows.unshift(["Rotation", `${e.rot * 90}°`]);
    if (e.flipH || e.flipV) rows.unshift(["Flip", [e.flipH && "horizontal", e.flipV && "vertical"].filter(Boolean).join(" + ")]);
    h += `<h5>Edits (unsaved)</h5>` + kv(rows);
  }
  $("infoBody").innerHTML = h + `<div id="exifRows"></div>`;
  const path = c.path;
  const m = await invoke("image_meta", { path }).catch(() => null);
  if (path !== app.cur.path || !m?.exif?.length || !$("exifRows")) return;
  $("exifRows").innerHTML = `<h5>Camera</h5>` + kv(m.exif);
}
function aspect(w, h) { const g = (a, b) => (b ? g(b, a % b) : a), d = g(w, h); const a = w / d, b = h / d; return a <= 50 && b <= 50 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`; }
function toggleInfo(force) {
  const p = $("infoPanel"); const on = force != null ? force : p.hidden;
  if (on && app.edit.panelOpen()) app.edit.togglePanel(false);
  p.hidden = !on; if (on) renderInfo();
}
app.onEditChange = () => { if (!$("infoPanel").hidden) renderInfo(); };
$("mInfo").onclick = () => toggleInfo(true);
$("infoClose").onclick = () => toggleInfo(false);
$("mReveal").onclick = () => app.cur.path && reveal(app.cur.path);
$("mCopyPath").onclick = () => { if (app.cur.path) { navigator.clipboard.writeText(app.cur.path); Steez.toast("ok", "Path copied"); } };
$("mTop").onclick = () => { settings.alwaysOnTop = !settings.alwaysOnTop; };
$("mShortcuts").onclick = () => app.openSettings?.("keys");

// ---------------------------------------------------------------- open buttons + recent + drag/drop
async function pickAndOpen() {
  const f = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: IMAGE_EXT }, { name: "All files", extensions: ["*"] }] });
  if (f) openFile(f);
}
app.pickAndOpen = pickAndOpen;
$("btnOpen").onclick = pickAndOpen; $("emptyOpen").onclick = pickAndOpen;

function renderRecent() {
  const r = (settings.recent || []).slice(0, 5);
  $("recentWrap").hidden = !r.length;
  $("recent").innerHTML = r.map((p) => `<button class="list-row" data-open="${esc(p)}"><span class="lbl">${esc(base(p))}</span><span class="val">${esc(p.split(/[\\/]/).slice(-2, -1)[0] || "")}</span></button>`).join("");
}
$("recent").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openFile(b.dataset.open); });

function onDrag(p) {
  const type = p.type;
  if (type === "enter" || type === "over") { $("dropHint").hidden = false; $("dropSub").textContent = (p.paths?.length || 0) > 1 ? "Two images: compare them" : "Drop two images to compare them"; }
  else if (type === "leave") $("dropHint").hidden = true;
  else if (type === "drop") {
    $("dropHint").hidden = true;
    const files = (p.paths || []).filter(Boolean);
    if (files.length >= 2) app.startCompare?.(files[0], files[1]);
    else if (files[0]) openFile(files[0]);
  }
}

// ---------------------------------------------------------------- window chrome
const W = win();
$("winMin").onclick = () => W?.minimize();
$("winMax").onclick = () => W?.toggleMaximize();
$("winClose").onclick = () => W?.close();
W?.onResized?.(async () => {
  const max = await W.isMaximized().catch(() => false);
  $("winMax").querySelector("use").setAttribute("href", max ? "#i-win-restore" : "#i-win-max");
});
async function toggleFull(force) {
  if (!W) { document.fullscreenElement ? document.exitFullscreen() : body.requestFullscreen(); return; }
  const fs = force ?? !(await W.isFullscreen());
  await W.setFullscreen(fs);
  body.classList.toggle("fullscreen", fs);
  $("btnFull").querySelector("use").setAttribute("href", fs ? "#i-fullscreen-exit" : "#i-fullscreen");
}
app.toggleFull = toggleFull;
$("btnFull").onclick = () => toggleFull();
// mouse back / forward buttons switch images
addEventListener("mouseup", (e) => { if (e.button === 3) { e.preventDefault(); go(folder.idx - 1); } if (e.button === 4) { e.preventDefault(); go(folder.idx + 1); } });

// ---------------------------------------------------------------- idle hide
let idleT = 0;
function poke() {
  body.classList.remove("idle");
  clearTimeout(idleT);
  const can = body.dataset.mode !== "empty" && !app.crop?.active && !app.edit?.panelOpen?.() && $("infoPanel").hidden;
  if (can) idleT = setTimeout(() => {
    if (document.querySelector(".popup.open, dialog[open], .dock:hover, .titlebar:hover, .timeline.drag") || tool.space || viewer.dragging) return poke();
    body.classList.add("idle"); $("tlHover").classList.remove("show");
  }, settings.hideDelay);
}
app.poke = poke;
addEventListener("pointermove", poke); addEventListener("pointerdown", poke); addEventListener("keydown", poke);

// ---------------------------------------------------------------- OSD
let osdT = 0;
function osd(text, ms = 900) {
  if (!settings.osd) return;
  const el = $("osd"); el.textContent = text; el.classList.add("show");
  clearTimeout(osdT); osdT = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------------------------------------------------------- keyboard
function combo(e) {
  const mods = [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...mods, e.code].join("+");
}
app.combo = combo;
const zoomAt = zoomTarget;
const ACTIONS = {
  prev: () => go(folder.idx - 1), next: () => go(folder.idx + 1), first: () => go(0), last: () => go(folder.list.length - 1),
  zoomIn: () => zoomAt().step(1), zoomOut: () => zoomAt().step(-1), zoomFit: () => zoomAt().fit(), zoom100: () => zoomAt().actual(),
  zoomToggle: () => zoomAt().toggle(),
  adjust: () => app.edit.togglePanel(), crop: () => app.crop.toggle(),
  rotateLeft: () => (app.crop.active ? app.crop.rotate(-1) : app.edit.rotate(-1)), rotateRight: () => (app.crop.active ? app.crop.rotate(1) : app.edit.rotate(1)),
  flipH: () => (app.crop.active ? app.crop.flip("h") : app.edit.flip("h")), flipV: () => (app.crop.active ? app.crop.flip("v") : app.edit.flip("v")),
  undo: () => app.edit.undo(), redo: () => app.edit.redo(), resetEdits: () => app.edit.reset(),
  compare: () => app.openCompare?.(), save: () => app.edit.save(), saveAs: () => app.edit.save({ as: true }), copy: () => app.edit.copy(),
  info: () => toggleInfo(), fullscreen: () => toggleFull(), open: pickAndOpen, settings: () => app.openSettings?.(),
  close: async () => {
    if (app.crop.active) return app.crop.cancel();
    if (!$("infoPanel").hidden) return toggleInfo(false);
    if (app.edit.panelOpen()) return app.edit.togglePanel(false);
    if (body.classList.contains("fullscreen")) return toggleFull(false);
    if (body.dataset.mode === "compare") return app.exitCompare?.();
  },
};
const VIEW_ONLY = new Set(["prev", "next", "first", "last", "adjust", "crop", "rotateLeft", "rotateRight", "flipH", "flipV", "undo", "redo", "resetEdits", "save", "saveAs", "copy", "info"]);
const NEEDS_IMAGE = new Set(["zoomIn", "zoomOut", "zoomFit", "zoom100", "zoomToggle"]);
addEventListener("keydown", (e) => {
  if (app.capturingKey) return;
  if (e.target.closest("input, textarea, select, [contenteditable]") && !e.target.matches('input[type="range"]')) return;
  if (document.querySelector("dialog[open]") && e.code !== "Escape") return;
  if (e.code === "Space") return; // hand tool (viewer.js)
  if (app.crop.active && (e.code === "Enter" || e.code === "NumpadEnter")) { e.preventDefault(); return app.crop.apply(); }
  if (app.crop.active && e.code === "KeyX" && !e.ctrlKey) { e.preventDefault(); return app.crop.swapAspect(); }
  // sliders keep their arrow keys; everything else falls through to the bindings
  if (e.target.matches('input[type="range"]') && /^Arrow|^Page|^Home|^End/.test(e.code)) return;
  const c = combo(e);
  for (const [act, list] of Object.entries(settings.keys)) {
    if (!list?.includes(c)) continue;
    if (act === "close" && document.querySelector("dialog[open], .popup.open")) return; // Steez closes those
    if (body.dataset.mode === "compare" && app.compareKey?.(act)) { e.preventDefault(); return; }
    if (VIEW_ONLY.has(act) && body.dataset.mode !== "view") return;
    if (NEEDS_IMAGE.has(act) && body.dataset.mode === "empty") return;
    if (act === "copy" && getSelection()?.toString()) return;
    e.preventDefault();
    ACTIONS[act]?.(e);
    return;
  }
  if (e.key === "?") app.openSettings?.("keys");
});

window.siv = app; // handy for debugging in devtools
