// SIV · crop & rotate mode. Works on a draft (rotation, flips, crop rect) shown live over the full image;
// Apply commits it as one undo step, Esc throws it away. The crop bar lives in the dock like SVP's trim bar.
// Rect coords are normalized to the rotated image; aspect math happens in pixels.
import { orientedSize } from "./gl.js";
import { tool } from "./viewer.js";
import { $, clamp } from "./util.js";

const ASPECTS = { free: null, orig: "orig", "1:1": 1, "4:5": 4 / 5, "3:2": 3 / 2, "4:3": 4 / 3, "16:9": 16 / 9 };
const MIN = 8; // px

export function initCrop(app) {
  const body = document.body, layer = $("cropLayer"), box = $("cropBox"), V = app.viewer, ed = app.edit;
  let active = false, rect = null, aspect = "free", portrait = false;

  const dims = () => orientedSize(app.cur.w, app.cur.h, ed.draft);
  /** Locked aspect (w/h in pixels) or null. */
  function ratio() {
    const a = ASPECTS[aspect];
    if (!a) return null;
    const [ow, oh] = dims();
    let r = a === "orig" ? Math.max(app.cur.w, app.cur.h) / Math.min(app.cur.w, app.cur.h) : a;
    if (a === "orig" && ow < oh) r = 1 / r;          // "Original" follows the image's own orientation
    if (portrait && r !== 1) r = r > 1 ? 1 / r : r;
    else if (!portrait && a !== "orig" && r < 1) r = 1 / r;
    return r;
  }

  // ---------------------------------------------------------------- enter / exit
  function enter() {
    if (active || !app.cur.path || body.dataset.mode !== "view") return;
    ed.togglePanel?.(false);
    const e = ed.e;
    ed.draft = { rot: e.rot, flipH: e.flipH, flipV: e.flipV };
    rect = e.crop ? { ...e.crop } : { x: 0, y: 0, w: 1, h: 1 };
    active = true;
    body.classList.add("cropping");
    $("cropbar").hidden = false; layer.hidden = false;
    $("btnCrop").setAttribute("aria-pressed", "true");
    app.layoutInsets?.();
    ed.refresh({ keep: false }).then(() => { V.fit(false); place(); });
    app.poke?.();
  }
  function exit() {
    active = false; ed.draft = null;
    body.classList.remove("cropping");
    $("cropbar").hidden = true; layer.hidden = true;
    $("btnCrop").setAttribute("aria-pressed", "false");
    app.layoutInsets?.();
  }
  function apply() {
    if (!active) return;
    const d = ed.draft, full = rect.x < 1e-4 && rect.y < 1e-4 && rect.w > 0.9999 && rect.h > 0.9999;
    const e = { ...ed.e, rot: d.rot, flipH: d.flipH, flipV: d.flipV, crop: full ? null : { ...rect } };
    exit();
    ed.set(e);                     // refreshes the display
    V.fitMode = "fit";
    ed.refresh({ keep: false });
    app.osd(full ? "Rotation applied" : "Cropped");
  }
  function cancel() { if (!active) return; exit(); ed.refresh({ keep: false }); }

  // ---------------------------------------------------------------- draft geometry
  function rotate(d) {
    const g = ed.draft;
    g.rot = (g.rot + (d > 0 ? 1 : 3)) % 4;
    rect = ed.rotRect(rect, d);
    if (ASPECTS[aspect] && aspect !== "orig") portrait = !portrait;
    ed.refresh({ keep: false }).then(() => { V.fit(false); place(); });
  }
  function flip(axis) {
    const g = ed.draft, srcAxis = g.rot % 2 ? (axis === "h" ? "v" : "h") : axis;
    if (srcAxis === "h") g.flipH = !g.flipH; else g.flipV = !g.flipV;
    rect = ed.flipRect(rect, axis);
    ed.refresh().then(place);
  }
  function reset() {
    ed.draft = { rot: 0, flipH: false, flipV: false };
    rect = { x: 0, y: 0, w: 1, h: 1 }; setAspect("free");
    ed.refresh({ keep: false }).then(() => { V.fit(false); place(); });
  }
  /** Largest rect of the locked ratio inside the current one, same center. */
  function conform() {
    const r = ratio(); if (!r) return;
    const [ow, oh] = dims();
    let w = rect.w * ow, h = rect.h * oh;
    if (w / h > r) w = h * r; else h = w / r;
    const cx = (rect.x + rect.w / 2) * ow, cy = (rect.y + rect.h / 2) * oh;
    let x = clamp(cx - w / 2, 0, ow - w), y = clamp(cy - h / 2, 0, oh - h);
    rect = { x: x / ow, y: y / oh, w: w / ow, h: h / oh };
    place();
  }
  function setAspect(a) {
    aspect = a; portrait = false;
    if (a !== "free" && a !== "orig") { const [ow, oh] = dims(); portrait = oh > ow && rect.h * oh > rect.w * ow; }
    $("cropAspectLbl").textContent = a === "free" ? "Free" : a === "orig" ? "Original" : (portrait ? a.split(":").reverse().join(":") : a);
    $("m-aspect").querySelectorAll("[data-aspect]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.aspect === a)));
    conform();
  }
  function swapAspect() {
    if (!ASPECTS[aspect] || aspect === "1:1") return;
    if (aspect === "orig") { aspect = "orig"; }
    portrait = !portrait;
    $("cropAspectLbl").textContent = aspect === "orig" ? "Original" : (portrait ? aspect.split(":").reverse().join(":") : aspect);
    // swap around the center, then fit back inside the image
    const [ow, oh] = dims(), cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let w = rect.h * oh, h = rect.w * ow;
    const s = Math.min(1, ow / w, oh / h); w *= s; h *= s;
    rect = { x: clamp(cx - w / ow / 2, 0, 1 - w / ow), y: clamp(cy - h / oh / 2, 0, 1 - h / oh), w: w / ow, h: h / oh };
    conform();
  }

  // ---------------------------------------------------------------- overlay
  function place() {
    if (!active || !rect) return;
    const a = V.toScreen(rect.x, rect.y), b = V.toScreen(rect.x + rect.w, rect.y + rect.h);
    Object.assign(box.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
    const [ow, oh] = dims();
    $("cropInfo").textContent = `${Math.round(rect.w * ow)} × ${Math.round(rect.h * oh)}`;
  }
  V.addEventListener("change", place);

  let drag = null;
  layer.addEventListener("pointerdown", (e) => {
    if (!active || e.button !== 0 || tool.kind) return;
    const [ow, oh] = dims(), p = V.toContent(e.clientX, e.clientY);
    const px = clamp(p.u, 0, 1) * ow, py = clamp(p.v, 0, 1) * oh;
    const R = { x: rect.x * ow, y: rect.y * oh, w: rect.w * ow, h: rect.h * oh };
    const h = e.target.closest(".ch")?.dataset.h;
    if (h) drag = { kind: "resize", h, R };
    else if (e.target.closest(".crop-box")) drag = { kind: "move", R, px, py };
    else drag = { kind: "new", ax: px, ay: py, R };
    layer.classList.add("active");
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [ow, oh] = dims(), p = V.toContent(e.clientX, e.clientY);
    const px = clamp(p.u, 0, 1) * ow, py = clamp(p.v, 0, 1) * oh;
    const R = drag.R;
    let r = ratio();
    if (!r && e.shiftKey) r = R.w / R.h;           // Shift keeps the current proportions
    let out;
    if (drag.kind === "move") {
      const x = clamp(R.x + px - drag.px, 0, ow - R.w), y = clamp(R.y + py - drag.py, 0, oh - R.h);
      out = { x, y, w: R.w, h: R.h };
    } else {
      // anchor + growth direction per axis (sx/sy: 1 grows right/down, -1 left/up, 0 centered)
      let ax, ay, sx, sy, w, h;
      if (drag.kind === "new") { ax = drag.ax; ay = drag.ay; sx = px >= ax ? 1 : -1; sy = py >= ay ? 1 : -1; w = Math.abs(px - ax); h = Math.abs(py - ay); }
      else {
        const H = drag.h;
        sx = H.includes("e") ? 1 : H.includes("w") ? -1 : 0;
        sy = H.includes("s") ? 1 : H.includes("n") ? -1 : 0;
        ax = sx === 1 ? R.x : sx === -1 ? R.x + R.w : R.x + R.w / 2;
        ay = sy === 1 ? R.y : sy === -1 ? R.y + R.h : R.y + R.h / 2;
        w = sx ? Math.max(MIN, sx * (px - ax)) : R.w;
        h = sy ? Math.max(MIN, sy * (py - ay)) : R.h;
        if (!sx && !r) { ax = R.x; sx = 1; }
        if (!sy && !r) { ay = R.y; sy = 1; }
      }
      w = Math.max(MIN, w); h = Math.max(MIN, h);
      if (r) {
        if (sx && sy) { if (w / h > r) h = w / r; else w = h * r; }
        else if (sx) h = w / r; else w = h * r;
      }
      const maxW = sx === 1 ? ow - ax : sx === -1 ? ax : 2 * Math.min(ax, ow - ax);
      const maxH = sy === 1 ? oh - ay : sy === -1 ? ay : 2 * Math.min(ay, oh - ay);
      if (r) { const s = Math.min(1, maxW / w, maxH / h); w *= s; h *= s; }
      else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
      const x = sx === 1 ? ax : sx === -1 ? ax - w : ax - w / 2;
      const y = sy === 1 ? ay : sy === -1 ? ay - h : ay - h / 2;
      out = { x, y, w, h };
    }
    rect = { x: out.x / ow, y: out.y / oh, w: out.w / ow, h: out.h / oh };
    place();
  });
  const end = () => {
    if (!drag) return;
    if (drag.kind === "new" && (rect.w * dims()[0] < MIN || rect.h * dims()[1] < MIN)) rect = { x: drag.R.x / dims()[0], y: drag.R.y / dims()[1], w: drag.R.w / dims()[0], h: drag.R.h / dims()[1] };
    drag = null; layer.classList.remove("active"); place();
  };
  layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
  layer.addEventListener("dblclick", (e) => { if (e.target.closest(".crop-box")) apply(); });

  // ---------------------------------------------------------------- controls
  $("btnCrop").onclick = () => (active ? cancel() : enter());
  $("cropApply").onclick = apply;
  $("cropClose").onclick = cancel;
  $("cropReset").onclick = reset;
  $("cropRotL").onclick = () => rotate(-1);
  $("cropRotR").onclick = () => rotate(1);
  $("cropFlipH").onclick = () => flip("h");
  $("cropFlipV").onclick = () => flip("v");
  $("m-aspect").addEventListener("click", (e) => { const b = e.target.closest("[data-aspect]"); if (b) setAspect(b.dataset.aspect); });
  $("aspectSwap").onclick = swapAspect;

  app.crop = { get active() { return active; }, enter, apply, cancel, rotate, flip, swapAspect, toggle: () => (active ? cancel() : enter()) };
}
