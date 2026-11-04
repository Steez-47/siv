// SIV · small shared helpers.
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function bytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const base = (p) => String(p).split(/[\\/]/).pop();
export const dirname = (p) => { const s = String(p); const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/")); return i < 0 ? "" : s.slice(0, i); };
export const stem = (p) => base(p).replace(/\.[^.]+$/, "");
export const extOf = (p) => (base(p).match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
export const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const mp = (w, h) => { const m = (w * h) / 1e6; return m >= 10 ? `${Math.round(m)} MP` : `${m.toFixed(1)} MP`; };
const FORMATS = { jpg: "JPEG", jpeg: "JPEG", jpe: "JPEG", jfif: "JPEG", pjpeg: "JPEG", pjp: "JPEG", png: "PNG", apng: "APNG", gif: "GIF", webp: "WebP", avif: "AVIF",
  bmp: "BMP", dib: "BMP", ico: "ICO", cur: "CUR", svg: "SVG", tif: "TIFF", tiff: "TIFF", tga: "TGA", dds: "DDS", hdr: "HDR", exr: "OpenEXR",
  pnm: "PNM", pbm: "PBM", pgm: "PGM", ppm: "PPM", pam: "PAM", qoi: "QOI", ff: "Farbfeld" };
export const formatName = (p) => FORMATS[extOf(p)] || extOf(p).toUpperCase();
export const pct = (z) => `${z >= 10 ? Math.round(z * 100) : Math.round(z * 1000) / 10}%`;
