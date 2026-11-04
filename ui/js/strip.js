// SIV · folder strip: SVP's timeline, repurposed to scrub through the images in the folder.
// Hover shows a thumbnail (DCT-scaled JPEG decode in Rust, so it keeps up with the pointer);
// click or drag jumps, Home / End go to the ends.
import { url } from "./api.js";
import { settings } from "./settings.js";
import { $, clamp } from "./util.js";

export class Strip extends EventTarget {
  constructor() {
    super();
    this.el = $("timeline"); this.fill = $("tlFill"); this.thumb = $("tlThumb");
    this.hover = $("tlHover"); this.hoverImg = $("tlHoverImg"); this.hoverName = $("tlHoverName");
    this.ticks = document.createElement("div"); this.ticks.className = "tl-ticks";
    this.el.querySelector(".tl-track").append(this.ticks);
    this.list = []; this.idx = 0;
    this._bind();
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  frac(x) { const r = this.el.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); }
  at(x) { return Math.round(this.frac(x) * (this.list.length - 1)); }

  set(list, idx) {
    const changed = list !== this.list;
    this.list = list; this.idx = idx;
    this.el.classList.toggle("single", list.length < 2);
    this.el.setAttribute("aria-valuemax", String(list.length));
    this.el.setAttribute("aria-valuenow", String(idx + 1));
    if (changed) this.ticks.innerHTML = list.length > 1 && list.length <= 48 ? list.map((_, i) => `<i style="left:${(i / (list.length - 1)) * 100}%"></i>`).join("") : "";
    this.update(idx);
  }
  update(idx) {
    const f = this.list.length > 1 ? idx / (this.list.length - 1) : 0;
    this.fill.style.transform = `scaleX(${f})`;
    this.thumb.style.left = `${f * 100}%`;
  }

  _bind() {
    const el = this.el;
    let dragging = false, last = -1;
    el.addEventListener("pointerdown", (e) => {
      if (this.list.length < 2 || e.button !== 0) return;
      dragging = true; el.classList.add("drag");
      last = this.at(e.clientX); this.update(last); this.emit("go", { i: last, scrub: true });
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (this.list.length < 2) return;
      const i = this.at(e.clientX);
      this._hoverAt(e.clientX, i);
      if (dragging && i !== last) { last = i; this.update(i); this.emit("go", { i, scrub: true }); }
    });
    const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove("drag"); this.emit("go", { i: this.at(e.clientX), scrub: false }); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => { if (!dragging) this.hover.classList.remove("show"); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Home") { this.emit("go", { i: 0 }); e.preventDefault(); }
      if (e.key === "End") { this.emit("go", { i: this.list.length - 1 }); e.preventDefault(); }
    });
  }

  _hoverAt(x, i) {
    const f = this.list[i]; if (!f) return;
    const r = this.el.getBoundingClientRect();
    this.hoverName.textContent = `${i + 1} · ${f.name}`;
    const show = settings.showThumbs;
    this.hover.classList.toggle("no-img", !show);
    if (show) {
      const u = url.thumb(f.path, 220, f.mtime);
      if (this.hoverImg.dataset.u !== u) { this.hoverImg.dataset.u = u; this.hoverImg.src = u; }
    }
    const hw = this.hover.offsetWidth || 120;
    this.hover.style.left = `${Math.max(6, Math.min(innerWidth - hw - 6, x - hw / 2))}px`;
    this.hover.style.bottom = `${innerHeight - r.top + 10}px`;
    this.hover.classList.add("show");
  }
}
