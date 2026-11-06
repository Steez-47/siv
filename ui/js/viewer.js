// SIV · zoom/pan engine. A "surface" element holds content at its natural pixel size and is placed with
// translate + scale inside a viewport. z = device pixels per image pixel, so 100% means 1:1 on screen.
//
// Mouse:   wheel zooms at the cursor (or navigates, per setting) · Ctrl+wheel / pinch always zooms
//          left-drag pans (artboard: the image can be moved anywhere, even past the window edges) · middle-drag pans too
// Keys (Photoshop): hold Space = hand · Ctrl+Space = zoom in (click) / scrubby zoom (drag left-right)
//          Alt+Space = zoom out (click)
import { settings } from "./settings.js";
import { clamp } from "./util.js";

export const MIN_Z = 0.02, MAX_Z = 64;
const KEEP = 64;                       // CSS px of image that always stays inside the window when panning
const dpr = () => window.devicePixelRatio || 1;

/** Global modifier state shared by every viewer (Space is held at the window level). */
export const tool = {
  space: false, ctrl: false, alt: false,
  get kind() { return !this.space ? null : this.ctrl ? "zoom-in" : this.alt ? "zoom-out" : "hand"; },
};
function syncToolClass() {
  const k = tool.kind, b = document.body.classList;
  b.toggle("tool-hand", k === "hand"); b.toggle("tool-zoom-in", k === "zoom-in"); b.toggle("tool-zoom-out", k === "zoom-out");
}
const typing = (e) => e.target?.closest?.("input:not([type=range]), textarea, select, [contenteditable]");
addEventListener("keydown", (e) => {
  tool.ctrl = e.ctrlKey || e.metaKey; tool.alt = e.altKey;
  if (e.code === "Space" && !typing(e) && !document.querySelector("dialog[open]")) { tool.space = true; e.preventDefault(); }
  if (e.code === "Space" && tool.alt) e.preventDefault(); // Alt+Space would open the window system menu
  syncToolClass();
}, true);
addEventListener("keyup", (e) => {
  tool.ctrl = e.ctrlKey || e.metaKey; tool.alt = e.altKey;
  if (e.code === "Space") tool.space = false;
  if (e.key === "Alt") e.preventDefault();
  syncToolClass();
}, true);
addEventListener("blur", () => { tool.space = tool.ctrl = tool.alt = false; syncToolClass(); });

export class Viewer extends EventTarget {
  /**
   * @param {HTMLElement} viewport  element whose box is the visible area (receives input)
   * @param {HTMLElement} surface   element that gets sized + transformed
   */
  constructor(viewport, surface, { leftDrag = () => settings.dragPan, onDblClick = null, onNavigate = null } = {}) {
    super();
    this.vp = viewport; this.surf = surface;
    this.w = 0; this.h = 0; this.z = 1; this.x = 0; this.y = 0;
    this.fitMode = "fit";              // "fit" | "fill" | "manual": fit modes re-fit on resize
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.leftDrag = leftDrag; this.onDblClick = onDblClick; this.onNavigate = onNavigate;
    this.followers = [];
    this.enabled = true;
    this._anim = 0;
    this._bind();
    new ResizeObserver(() => this.relayout()).observe(viewport);
  }

  // ---------------------------------------------------------------- geometry
  box() {
    const r = this.vp.getBoundingClientRect(), i = this.insets;
    return { left: i.left, top: i.top, width: Math.max(40, r.width - i.left - i.right), height: Math.max(40, r.height - i.top - i.bottom), vw: r.width, vh: r.height, rx: r.left, ry: r.top };
  }
  fitZoom(fill = false) {
    if (!this.w || !this.h) return 1;
    const b = this.box(), sx = b.width / this.w, sy = b.height / this.h;
    return (fill ? Math.max(sx, sy) : Math.min(sx, sy)) * dpr();
  }
  /** Initial zoom for a freshly opened image, per the "When opening" setting. */
  openZoom() {
    const fit = this.fitZoom();
    this._shrinkOnly = settings.fitMode === "shrink";
    if (settings.fitMode === "actual") return { z: 1, mode: "manual" };
    if (settings.fitMode === "shrink") return { z: Math.min(fit, 1), mode: "fit" };
    if (settings.fitMode === "fill") return { z: this.fitZoom(true), mode: "fill" };
    return { z: fit, mode: "fit" };
  }
  get scale() { return this.z / dpr(); }
  get sw() { return this.w * this.scale; }
  get sh() { return this.h * this.scale; }
  /** Normalized content coords → viewport-relative CSS px. */
  toScreen(u, v) { return { x: this.x + u * this.sw, y: this.y + v * this.sh }; }
  /** Client coords → normalized content coords. */
  toContent(cx, cy) { const r = this.vp.getBoundingClientRect(); return { u: (cx - r.left - this.x) / this.sw, v: (cy - r.top - this.y) / this.sh }; }

  // ---------------------------------------------------------------- content
  /** New content size. keep=true keeps the visible center/zoom (e.g. crop applied, same image). */
  setContent(w, h, { keep = false, z = null } = {}) {
    const had = this.w && this.h;
    if (keep && had) {
      const b = this.box(), cu = (b.left + b.width / 2 - this.x) / this.sw, cv = (b.top + b.height / 2 - this.y) / this.sh;
      this.w = w; this.h = h;
      if (this.fitMode !== "manual") return this.refit();
      this.x = b.left + b.width / 2 - cu * this.sw; this.y = b.top + b.height / 2 - cv * this.sh;
      return this.apply();
    }
    this.w = w; this.h = h;
    if (z != null) { this.fitMode = "manual"; this.z = z; this.center(); return this.apply(); }
    const o = this.openZoom();
    this.fitMode = o.mode; this.z = o.z; this.center(); this.apply();
  }
  center() { const b = this.box(); this.x = b.left + (b.width - this.sw) / 2; this.y = b.top + (b.height - this.sh) / 2; }
  refit() {
    if (!this.w) return;
    if (this.fitMode === "fill") this.z = this.fitZoom(true);
    else if (this.fitMode === "fit") this.z = this._shrinkOnly ? Math.min(this.fitZoom(), 1) : this.fitZoom();
    this.center(); this.apply();
  }
  relayout() { if (!this.w) return; if (this.fitMode !== "manual") this.refit(); else { this.clampPan(); this.apply(); } }
  setInsets(i, animate = false) {
    const same = ["top", "right", "bottom", "left"].every((k) => (i[k] || 0) === this.insets[k]);
    if (same) return;
    const before = { z: this.z, x: this.x, y: this.y };
    this.insets = { top: i.top || 0, right: i.right || 0, bottom: i.bottom || 0, left: i.left || 0 };
    if (!this.w) return;
    if (this.fitMode !== "manual") { const m = this.fitMode; this.refitTarget(m); } else this.clampPan();
    if (animate) { const to = { z: this.z, x: this.x, y: this.y }; Object.assign(this, before); this.animateTo(to); } else this.apply();
  }
  refitTarget(mode) {
    if (mode === "fill") this.z = this.fitZoom(true);
    else this.z = this._shrinkOnly ? Math.min(this.fitZoom(), 1) : this.fitZoom();
    this.center();
  }

  // ---------------------------------------------------------------- zoom + pan
  /** Artboard: the image moves freely around (and past) the window, only a sliver must stay visible so it can't get lost. */
  clampPan() {
    const b = this.box(), mx = Math.min(this.sw, KEEP), my = Math.min(this.sh, KEEP);
    this.x = clamp(this.x, b.left + mx - this.sw, b.left + b.width - mx);
    this.y = clamp(this.y, b.top + my - this.sh, b.top + b.height - my);
  }
  /** Zoom to z keeping the content point under viewport point (px, py) fixed. */
  zoomTo(z, px, py, { animate = false, mode = "manual" } = {}) {
    if (!this.w) return;
    const b = this.box();
    px ??= b.left + b.width / 2; py ??= b.top + b.height / 2;
    z = clamp(z, MIN_Z, MAX_Z);
    const from = this._target || { z: this.z, x: this.x, y: this.y };
    const u = (px - from.x) / (this.w * from.z / dpr()), v = (py - from.y) / (this.h * from.z / dpr());
    const s = z / dpr();
    const t = { z, x: px - u * this.w * s, y: py - v * this.h * s };
    // fit / fill always land centered, wherever the image was dragged to
    if (mode !== "manual") { t.x = b.left + (b.width - this.w * s) / 2; t.y = b.top + (b.height - this.h * s) / 2; }
    this.fitMode = mode;
    const save = { z: this.z, x: this.x, y: this.y };
    Object.assign(this, t); this.clampPan(); t.x = this.x; t.y = this.y; Object.assign(this, save);
    if (animate && settings.smoothZoom) this.animateTo(t); else { this._stopAnim(); Object.assign(this, t); this.apply(); }
  }
  zoomBy(f, px, py, opts) { this.zoomTo((this._target?.z ?? this.z) * f, px, py, opts); }
  /** Step to the next zoom level (Photoshop-like stops), at an optional point. */
  step(dir, px, py) {
    const f = settings.zoomStep || 1.25, cur = this._target?.z ?? this.z;
    let z = dir > 0 ? cur * f : cur / f;
    // snap onto 100% and fit when we cross them
    for (const stop of [1, this.fitZoom()]) if ((cur < stop && z > stop) || (cur > stop && z < stop)) { z = stop; break; }
    this.zoomTo(z, px, py, { animate: true, mode: Math.abs(z - this.fitZoom()) < 1e-6 ? "fit" : "manual" });
  }
  fit(animate = true) { const b = this.box(), z = this.fitZoom(); this._shrinkOnly = false; this.zoomTo(z, b.left + b.width / 2, b.top + b.height / 2, { animate, mode: "fit" }); }
  fill(animate = true) { const b = this.box(); this.zoomTo(this.fitZoom(true), b.left + b.width / 2, b.top + b.height / 2, { animate, mode: "fill" }); }
  actual(px, py, animate = true) { this.zoomTo(1, px, py, { animate }); }
  toggle(px, py) {
    const fit = this.fitZoom();
    if (Math.abs(this.z - fit) < 1e-3 || this.fitMode !== "manual") this.actual(px, py);
    else this.fit();
  }
  panBy(dx, dy) { this._stopAnim(); this.x += dx; this.y += dy; this.clampPan(); this.fitMode = this.fitMode === "fit" && dx === 0 && dy === 0 ? "fit" : "manual"; this.apply(); }
  /** Copy zoom + position from another viewer (linked compare panes). */
  follow(o) { this.w = o.w; this.h = o.h; this.z = o.z; this.x = o.x; this.y = o.y; this.fitMode = o.fitMode; this.insets = { ...o.insets }; this.apply(true); }

  animateTo(t, ms = 140) {
    if (this._anim) cancelAnimationFrame(this._anim);
    const from = { z: this.z, x: this.x, y: this.y }, t0 = performance.now();
    this._target = t;
    // interpolate in log-zoom with the anchor kept consistent: lerp scale and position together
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      this.z = Math.exp(Math.log(from.z) + (Math.log(t.z) - Math.log(from.z)) * e);
      // keep the same fixed point the target describes: solve x so the screen anchor stays put
      const a = (from.z === t.z) ? e : (this.z - from.z) / (t.z - from.z);
      this.x = from.x + (t.x - from.x) * a; this.y = from.y + (t.y - from.y) * a;
      this.apply();
      if (k < 1) this._anim = requestAnimationFrame(tick); else { this._anim = 0; this._target = null; }
    };
    this._anim = requestAnimationFrame(tick);
  }
  _stopAnim() { if (this._anim) { cancelAnimationFrame(this._anim); this._anim = 0; if (this._target) { Object.assign(this, this._target); } this._target = null; } }

  apply(silent = false) {
    const s = this.scale, st = this.surf.style;
    st.width = `${this.w}px`; st.height = `${this.h}px`;
    st.transform = `translate(${this.x}px, ${this.y}px) scale(${s})`;
    this.surf.classList.toggle("pixel", settings.pixelated && this.z >= 2);
    const b = this.box();
    this.vp.classList.toggle("can-pan", !!this.w && !!this.leftDrag({}));
    if (silent) return;
    for (const f of this.followers) f.follow(this);
    this.dispatchEvent(new Event("change"));
  }

  // ---------------------------------------------------------------- input
  _bind() {
    const vp = this.vp;
    vp.addEventListener("wheel", (e) => {
      if (!this.enabled || !this.w) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const pinch = e.ctrlKey && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY);
      if (pinch) return this.zoomBy(Math.exp(-e.deltaY * 0.012), px, py);
      if (settings.wheel === "navigate" && !e.ctrlKey && this.onNavigate) return this.onNavigate(e.deltaY > 0 ? 1 : -1);
      if (e.shiftKey && !e.ctrlKey) return this.panBy(-e.deltaY, 0);
      const notches = clamp(Math.abs(e.deltaY) / 100, 0.25, 3), f = Math.pow(settings.zoomStep || 1.25, notches);
      this.zoomBy(e.deltaY < 0 ? f : 1 / f, px, py, { animate: true });
    }, { passive: false });

    let drag = null;
    vp.addEventListener("pointerdown", (e) => {
      if (!this.enabled || !this.w) return;
      const r = vp.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const k = tool.kind;
      if (k === "zoom-in" && e.button === 0) { drag = { kind: "zoom", sx: e.clientX, z0: this.z, px, py, moved: false }; document.body.classList.add("scrub-zoom"); }
      else if (k === "zoom-out" && e.button === 0) { this.step(-1, px, py); e.preventDefault(); return; }
      else if (k === "hand" || e.button === 1 || (e.button === 0 && this.leftDrag(e))) { drag = { kind: "pan", x: e.clientX, y: e.clientY }; document.body.classList.add("panning"); }
      else return;
      e.preventDefault(); e.stopPropagation();
      this._stopAnim();
      vp.setPointerCapture(e.pointerId);
    }, true);
    vp.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.kind === "pan") { this.panBy(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; }
      else {
        const dx = e.clientX - drag.sx;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved) this.zoomTo(drag.z0 * Math.exp(dx * 0.008), drag.px, drag.py);
      }
    });
    const end = (e) => {
      if (!drag) return;
      if (drag.kind === "zoom" && !drag.moved && e.type === "pointerup") this.step(e.altKey ? -1 : 1, drag.px, drag.py);
      drag = null; document.body.classList.remove("panning", "scrub-zoom");
    };
    vp.addEventListener("pointerup", end); vp.addEventListener("pointercancel", end);
    vp.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    vp.addEventListener("dblclick", (e) => {
      if (!this.enabled || !this.w || tool.kind) return;
      const r = vp.getBoundingClientRect();
      if (this.onDblClick) this.onDblClick(e, e.clientX - r.left, e.clientY - r.top);
    });
  }
  get dragging() { return document.body.classList.contains("panning") || document.body.classList.contains("scrub-zoom"); }
}
