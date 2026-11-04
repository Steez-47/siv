<img src="assets/icon.svg" width="64" height="64" alt="">

# SIV · Steez Image Viewer

The image companion to [SVP](https://github.com/Steez-47/SVP): the same liquid-glass UI, built for images. Tauri v2 (Rust + WebView2), no external dependencies.

- **Instant.** Images stream from a local server and WebView2 decodes them off the main thread. The decoded element is swapped straight into the stage, and neighbours in the folder are decoded ahead of time, so stepping through a folder takes a few milliseconds. TIFF, TGA, DDS, HDR, EXR, PNM and QOI are decoded in Rust.
- **Zoom like Photoshop.** Scroll wheel zooms at the cursor, Ctrl+wheel / pinch always zooms. Hold **Space** to pan, **Ctrl+Space** click to zoom in or drag left/right for scrubby zoom, **Alt+Space** click to zoom out. Middle-drag pans, double-click toggles fit / 100%, Ctrl+0 / Ctrl+1. Real pixels above 200%.
- **Adjust.** Exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, hue, saturation, vibrance, sharpen, clarity, vignette and grain, plus one-click looks (Vivid, Punch, Warm, Cool, Mono, Noir, Fade, Film). Everything renders live on the GPU in one WebGL2 pass. Hold `\` to see the original.
- **Crop & rotate.** Free or locked aspect (Original, 1:1, 4:5, 3:2, 4:3, 16:9, X to swap), rotate, flip, rule-of-thirds grid.
- **Non-destructive.** Undo / redo per image. Ctrl+S saves a copy next to the original (`photo edited.jpg`) and never overwrites it; Ctrl+Shift+S to choose. Ctrl+C copies the edited image.
- **Compare.** Two images in the same frame: draggable split line, side by side with linked zoom, or a pixel difference view. Drop two files to start.
- **Folder strip.** SVP's timeline scrubs through the folder, with hover thumbnails (DCT-scaled JPEG decode, so they keep up). Sort by name, date, size or type.

## Run

Requires Node 20+ and Rust (stable; pinned in `rust-toolchain.toml`).

```sh
npm install
npm run dev      # development
npm run build    # signed NSIS installer in src-tauri/target/release/bundle
python scripts/make-test-media.py   # optional: a folder of test images in test-media/
```

## Releases and updates

Installed copies check `https://github.com/Steez-47/siv/releases/latest/download/latest.json` on startup (Settings › Updates), verify the minisign signature and install in place, then reopen.

```sh
npm run release -- 0.2.0                       # bumps package.json, tauri.conf.json, Cargo.toml
git commit -am "SIV 0.2.0" && git tag v0.2.0
git push origin master v0.2.0                  # .github/workflows/release.yml builds, signs and publishes
```

The workflow needs the repo secret `TAURI_SIGNING_PRIVATE_KEY` (the contents of `~/.tauri/siv.key`). Keep that key private and backed up: without it, existing installs can't verify future updates. Release builds (`npm run build`, also used by CI) need active Microsoft Defender and 7-Zip: they scan the finished installer and its extracted `siv.exe` before succeeding.

## Windows integration

The installer registers SIV for 23 image types under *Open with* and in *Settings › Apps › Default apps* (never overriding another app's default). Settings › Updates › *Set as default…* opens the Default apps page.

## Layout

| Path | What |
|---|---|
| `src-tauri/src/server.rs` | Local image server: `/img` (native formats from disk, others → PNG), `/thumb` |
| `src-tauri/src/images.rs` | Folder listing (natural sort), Rust decoding, fast thumbnails, EXIF |
| `src-tauri/src/lib.rs` | Commands: boot, list_folder, file_info, image_meta, save_image (raw-bytes IPC) |
| `src-tauri/src/updater.rs` · `ui/js/updates.js` | In-app updates from GitHub Releases |
| `ui/js/viewer.js` | Zoom / pan engine and Photoshop-style tools |
| `ui/js/gl.js` | WebGL2 edit renderer (geometry + adjustments in one pass) |
| `ui/js/editor.js` | Edit state, undo, Adjust panel, save / copy |
| `ui/js/crop.js`, `compare.js`, `strip.js` | Crop mode, compare, folder strip |

Known gaps: camera metadata (EXIF) isn't copied into saved files yet; HEIC and RAW aren't supported; AI upscaling is planned.
