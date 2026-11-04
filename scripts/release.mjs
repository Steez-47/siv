// Bump SIV's version everywhere: node scripts/release.mjs 0.2.0
// Then: git commit -am "SIV 0.2.0" && git tag v0.2.0 && git push origin master v0.2.0  (CI publishes the release)
import { readFileSync, writeFileSync } from "node:fs";
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || "")) { console.error("usage: node scripts/release.mjs X.Y.Z"); process.exit(1); }
const edit = (f, fn) => writeFileSync(f, fn(readFileSync(f, "utf8")));
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${v}"`));
edit("src-tauri/Cargo.lock", (s) => s.replace(/(\[\[package\]\]\r?\nname = "siv"\r?\nversion = ")[^"]+"/, `$1${v}"`));
edit("package-lock.json", (s) => {
  const lock = JSON.parse(s);
  lock.version = v;
  lock.packages[""].version = v;
  return JSON.stringify(lock, null, 2) + "\n";
});
console.log(`SIV ${v}: updated manifests and lockfiles`);
console.log(`next: git commit -am "SIV ${v}" && git tag v${v} && git push origin master v${v}`);
