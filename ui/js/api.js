// SIV · bridge to the Rust backend (Tauri invoke + local image server URLs).
const T = window.__TAURI__;
export const isTauri = !!T;
export const invoke = (cmd, args, opts) => (T ? T.core.invoke(cmd, args, opts) : Promise.reject(new Error("Not running inside SIV")));
export const listen = (ev, cb) => (T ? T.event.listen(ev, (e) => cb(e.payload)) : Promise.resolve(() => {}));
export const win = () => T?.window.getCurrentWindow();

let base = "", token = "";
export function setServer(port, k) { base = `http://127.0.0.1:${port}`; token = k; }
const q = (o) => Object.entries({ k: token, ...o }).map(([a, b]) => `${a}=${encodeURIComponent(b)}`).join("&");
// `m` (mtime) only busts the browser cache when a file changes on disk.
export const url = {
  img: (p, m = 0) => `${base}/img?${q({ p, m })}`,
  thumb: (p, s = 160, m = 0) => `${base}/thumb?${q({ p, s, m })}`,
};

/** Write encoded bytes to disk via the raw-body IPC channel (no base64, no JSON). */
export const saveBytes = (path, bytes, unique = false) =>
  invoke("save_image", bytes, { headers: { "x-path": encodeURIComponent(path), "x-unique": unique ? "1" : "0" } });

export async function openDialog(opts) { return T.dialog.open(opts); }
export async function saveDialog(opts) { return T.dialog.save(opts); }
export const reveal = (p) => T?.opener.revealItemInDir(p);
export const NATIVE_EXT = ["jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp", "avif", "bmp", "dib", "ico", "cur", "svg"];
export const IMAGE_EXT = [...NATIVE_EXT, "tif", "tiff", "tga", "dds", "hdr", "exr", "pnm", "pbm", "pgm", "ppm", "pam", "qoi", "ff"];
