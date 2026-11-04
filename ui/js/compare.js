// SIV · compare: two images in the same rect (B scaled to A), with three views:
//   Split       drag the line across them (Shift / middle / Space-drag pans)
//   Side        next to each other, zoom and pan linked
//   Difference  per-pixel |A − B|: black where they match
// Zoom, pan and the Photoshop keys work exactly like the main viewer.
import { invoke, openDialog, url, IMAGE_EXT } from "./api.js";
import { Viewer } from "./viewer.js";
import { $, base, bytes, clamp, formatName } from "./util.js";

export function initCompare(app) {
  const root = $("compare"), view = $("cmpView"), viewR = $("cmpViewR");
  const iA = $("cmpA"), iB = $("cmpB"), iB2 = $("cmpB2");
  const pick = { a: "", b: "" };
  let split = 0.5, active = false, mode = "split", seq = 0;
  const dbl = (e, px, py) => V.toggle(px, py);
  const V = new Viewer(view, $("cmpSurf"), { leftDrag: (e) => mode !== "split" || e.shiftKey, onDblClick: dbl });
  const VR = new Viewer(viewR, $("cmpSurfR"), { leftDrag: () => true, onDblClick: (e, px, py) => VR.toggle(px, py) });
  V.followers = [VR]; VR.followers = [V];
  app.cmpViewer = V;

  // ---------------------------------------------------------------- picker dialog
  function setSlot(slot, path) {
    pick[slot] = path || "";
    const el = $(slot === "a" ? "pickA" : "pickB");
    el.classList.toggle("set", !!path);
    el.querySelector(".pick-name").textContent = path ? base(path) : "Choose image";
    el.querySelector(".pick-sub").textContent = "";
    if (path) invoke("file_info", { path }).then((i) => { if (pick[slot] === path) el.querySelector(".pick-sub").textContent = `${formatName(path)} · ${bytes(i.size)}`; }).catch(() => {});
    $("cmpGo").disabled = !(pick.a && pick.b);
  }
  async function choose(slot) {
    const f = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: IMAGE_EXT }] });
    if (f) setSlot(slot, f);
  }
  function openPicker() {
    if (app.cur.path && (!pick.a || pick.a === pick.b)) setSlot("a", app.cur.path);
    if (!pick.b && app.neighbor) { const n = app.neighbor(1); if (n && n !== pick.a) setSlot("b", n); }
    Steez.openDialog("d-compare");
  }
  $("pickA").onclick = () => choose("a");
  $("pickB").onclick = () => choose("b");
  $("pickSwap").onclick = () => { const a = pick.a, b = pick.b; setSlot("a", b); setSlot("b", a); };
  $("cmpGo").onclick = () => { Steez.closeDialog("d-compare"); start(pick.a, pick.b); };
  $("btnCompare").onclick = () => (active ? exit() : openPicker());
  $("emptyCompare").onclick = openPicker;

  // ---------------------------------------------------------------- start / exit
  async function load(img, path) {
    const i = await invoke("file_info", { path });
    img.src = url.img(path, i.mtime);
    await img.decode();
    return i;
  }
  async function start(a, b) {
    if (!a || !b) return;
    const my = ++seq;
    setSlot("a", a); setSlot("b", b);
    if (app.crop?.active) app.crop.cancel();
    app.edit?.togglePanel?.(false);
    active = true;
    root.hidden = false;
    app.setMode("compare");
    $("btnCompare").setAttribute("aria-pressed", "true");
    $("title").textContent = `${base(a)}  vs  ${base(b)}`;
    $("badges").innerHTML = "";
    app.busy?.("Opening…");
    let ia, ib;
    try { [ia, ib] = await Promise.all([load(iA, a), load(iB, b)]); }
    catch (e) { app.idle?.(); if (my === seq) { Steez.toast("err", `Couldn't open both images: ${e.message || e}`); exit(); } return; }
    app.idle?.();
    if (my !== seq) return;
    iB2.src = iB.src;
    V.setContent(iA.naturalWidth, iA.naturalHeight);
    setSplit(split);
    tags(ia, ib);
    const ra = iA.naturalWidth / iA.naturalHeight, rb = iB.naturalWidth / iB.naturalHeight;
    if (Math.abs(ra - rb) > 0.01) Steez.toast("info", `B has a different shape (${iB.naturalWidth} × ${iB.naturalHeight}), so it's stretched to A's frame.`, { ms: 5000 });
    else if (iA.naturalWidth !== iB.naturalWidth) Steez.toast("info", `B is ${iB.naturalWidth} × ${iB.naturalHeight}, scaled to match A's ${iA.naturalWidth} × ${iA.naturalHeight}.`);
    app.onZoom?.();
  }
  function tags(ia, ib) {
    const t = (k, img, p, i) => [k, base(p), formatName(p), `${img.naturalWidth}×${img.naturalHeight}`, i ? bytes(i.size) : ""].filter(Boolean).join(" · ");
    $("cmpTagA").textContent = t("A", iA, pick.a, ia); $("cmpTagB").textContent = t("B", iB, pick.b, ib);
    $("cmpTagA").title = $("cmpTagA").textContent; $("cmpTagB").title = $("cmpTagB").textContent;
  }
  function exit() {
    if (!active) return;
    active = false; seq++;
    root.hidden = true;
    $("btnCompare").setAttribute("aria-pressed", "false");
    iA.removeAttribute("src"); iB.removeAttribute("src"); iB2.removeAttribute("src");
    if (app.cur.path) { app.setMode("view"); app.restoreTitle?.(); }
    else { app.setMode("empty"); $("title").textContent = "Steez Image Viewer"; }
    app.onZoom?.();
  }

  // ---------------------------------------------------------------- views, split
  function setMode(m) {
    mode = m;
    root.dataset.cmp = m;
    viewR.hidden = m !== "side";
    $("cmpMode").querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === m)));
    Steez.init($("cmpMode"));
    requestAnimationFrame(() => { V.relayout(); VR.follow(V); syncClip(); });
    app.osd({ split: "Split", side: "Side by side", diff: "Difference" }[m]);
  }
  $("cmpMode").addEventListener("stz:change", (e) => setMode(e.detail.value));
  $("cmpMode").addEventListener("click", (e) => { const b = e.target.closest("[data-value]"); if (b && b.dataset.value !== mode) setTimeout(() => mode !== b.dataset.value && setMode(b.dataset.value), 0); });
  $("cmpSwap").onclick = () => { if (active) start(pick.b, pick.a); };
  root.dataset.cmp = "split";

  function setSplit(f) {
    split = clamp(f, 0, 1);
    view.style.setProperty("--split", `${split * 100}%`);
    $("cmpHandle").setAttribute("aria-valuenow", String(Math.round(split * 100)));
    syncClip();
  }
  /** B is clipped in its own (scaled) coordinates, so convert the screen split into content space. */
  function syncClip() {
    const w = view.getBoundingClientRect().width;
    const f = V.sw ? clamp((split * w - V.x) / V.sw, 0, 1) : 0.5;
    $("cmpBWrap").style.setProperty("--bsplit", `${f * 100}%`);
  }
  V.addEventListener("change", () => { syncClip(); app.onZoom?.(); });
  VR.addEventListener("change", () => app.onZoom?.());

  let drag = false;
  view.addEventListener("pointerdown", (e) => {
    if (!active || mode !== "split" || e.button !== 0) return;
    drag = true; view.classList.add("drag");
    const r = view.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width);
    view.setPointerCapture(e.pointerId); e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => { if (!drag) return; const r = view.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); });
  const end = () => { drag = false; view.classList.remove("drag"); };
  view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
  for (const v of [view, viewR]) v.addEventListener("contextmenu", (e) => e.preventDefault());
  $("cmpHandle").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { setSplit(split - 0.02); e.preventDefault(); e.stopPropagation(); }
    if (e.key === "ArrowRight") { setSplit(split + 0.02); e.preventDefault(); e.stopPropagation(); }
  });

  app.startCompare = start;
  app.exitCompare = exit;
  app.openCompare = () => (active ? exit() : openPicker());
  app.compareKey = (act) => {
    if (act === "close" || act === "compare") { exit(); return true; }
    if (act === "prev" || act === "next") { setSplit(split + (act === "next" ? 0.05 : -0.05)); return true; }
    return false;
  };
  app.cmpCycle = () => setMode({ split: "side", side: "diff", diff: "split" }[mode]);
}
