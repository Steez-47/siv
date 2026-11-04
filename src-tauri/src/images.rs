//! Image helpers: folder listing, decoding of formats WebView2 can't show, fast thumbnails, EXIF.
use image::{DynamicImage, ImageEncoder};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Decoded natively by WebView2 (Chromium): served as-is, zero conversion.
pub const NATIVE: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "png", "apng", "gif", "webp", "avif", "bmp", "dib", "ico", "cur", "svg"];
/// Decoded in Rust and handed to the webview as PNG.
pub const CONVERT: &[&str] = &["tif", "tiff", "tga", "dds", "hdr", "exr", "pnm", "pbm", "pgm", "ppm", "pam", "qoi", "ff"];

pub fn ext_of(p: &str) -> String {
    Path::new(p).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}
pub fn is_native(p: &str) -> bool { NATIVE.contains(&ext_of(p).as_str()) }
pub fn is_image(p: &str) -> bool { let e = ext_of(p); NATIVE.contains(&e.as_str()) || CONVERT.contains(&e.as_str()) }

pub fn mime(p: &str) -> &'static str {
    match ext_of(p).as_str() {
        "jpg" | "jpeg" | "jpe" | "jfif" | "pjpeg" | "pjp" => "image/jpeg",
        "png" | "apng" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" | "dib" => "image/bmp",
        "ico" | "cur" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Natural ("img2" < "img10"), case-insensitive name order.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Equal,
            (None, _) => return Less,
            (_, None) => return Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let mut n1 = String::new(); while let Some(c) = x.peek().copied().filter(|c| c.is_ascii_digit()) { n1.push(c); x.next(); }
                let mut n2 = String::new(); while let Some(c) = y.peek().copied().filter(|c| c.is_ascii_digit()) { n2.push(c); y.next(); }
                let (t1, t2) = (n1.trim_start_matches('0'), n2.trim_start_matches('0'));
                let o = t1.len().cmp(&t2.len()).then_with(|| t1.cmp(t2));
                if o != Equal { return o; }
            }
            (Some(c), Some(d)) => { if c != d { return c.cmp(&d); } x.next(); y.next(); }
        }
    }
}

/// Every image in the folder of `path` (or in `path` itself when it is a folder).
pub fn list_folder(path: &str) -> Result<Value, String> {
    let p = Path::new(path);
    let dir = if p.is_dir() { p.to_path_buf() } else { p.parent().map(Path::to_path_buf).ok_or("No parent folder")? };
    let mut files: Vec<(String, String, u64, u64)> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let s = path.to_string_lossy().into_owned();
            if !is_image(&s) { return None; }
            let m = e.metadata().ok()?;
            if !m.is_file() { return None; }
            Some((s, e.file_name().to_string_lossy().into_owned(), m.len(), mtime_ms(&m)))
        })
        .collect();
    files.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    Ok(json!({
        "dir": dir.to_string_lossy(),
        "files": files.into_iter().map(|(p, n, s, m)| json!({ "path": p, "name": n, "size": s, "mtime": m })).collect::<Vec<_>>(),
    }))
}

pub fn file_info(path: &str) -> Result<Value, String> {
    let m = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let name = Path::new(path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(json!({ "size": m.len(), "mtime": mtime_ms(&m), "name": name, "native": is_native(path) }))
}

// ---------------------------------------------------------------- decoding

/// Float images (HDR, EXR) are linear: clamp and apply a display gamma so they don't look black.
fn to_display_rgba8(img: DynamicImage) -> image::RgbaImage {
    match img {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
            let f = img.to_rgba32f();
            let (w, h) = f.dimensions();
            let mut out = image::RgbaImage::new(w, h);
            for (o, i) in out.pixels_mut().zip(f.pixels()) {
                let g = |v: f32| (v.clamp(0.0, 1.0).powf(1.0 / 2.2) * 255.0 + 0.5) as u8;
                *o = image::Rgba([g(i[0]), g(i[1]), g(i[2]), (i[3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8]);
            }
            out
        }
        other => other.to_rgba8(),
    }
}

/// Decode a non-native format to a PNG the webview can show (fast compression: speed over size).
pub fn convert_png(path: &str) -> Result<Vec<u8>, String> {
    let img = image::ImageReader::open(path).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .decode().map_err(|e| e.to_string())?;
    let rgba = to_display_rgba8(img);
    let mut out = Vec::with_capacity((rgba.width() * rgba.height()) as usize);
    image::codecs::png::PngEncoder::new_with_quality(&mut out, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::NoFilter)
        .write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

static CONVERTED: Lazy<Mutex<VecDeque<(String, u64, std::sync::Arc<Vec<u8>>)>>> = Lazy::new(|| Mutex::new(VecDeque::new()));

/// Converted PNG with a tiny LRU so flipping back and forth between TIFFs doesn't decode twice.
pub fn converted(path: &str) -> Result<std::sync::Arc<Vec<u8>>, String> {
    let mt = std::fs::metadata(path).map(|m| mtime_ms(&m)).unwrap_or(0);
    if let Some(hit) = CONVERTED.lock().iter().find(|(p, m, _)| p == path && *m == mt).map(|e| e.2.clone()) { return Ok(hit); }
    let png = std::sync::Arc::new(convert_png(path)?);
    let mut c = CONVERTED.lock();
    c.push_back((path.to_string(), mt, png.clone()));
    while c.len() > 6 { c.pop_front(); }
    Ok(png)
}

// ---------------------------------------------------------------- thumbnails

pub fn orientation(path: &str) -> u32 {
    let Ok(f) = File::open(path) else { return 1 };
    exif::Reader::new().read_from_container(&mut BufReader::new(f)).ok()
        .and_then(|e| e.get_field(exif::Tag::Orientation, exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)))
        .unwrap_or(1)
}

fn orient(img: DynamicImage, o: u32) -> DynamicImage {
    match o {
        2 => img.fliph(), 3 => img.rotate180(), 4 => img.flipv(),
        5 => img.rotate90().fliph(), 6 => img.rotate90(), 7 => img.rotate270().fliph(), 8 => img.rotate270(),
        _ => img,
    }
}

/// JPEGs decode with DCT scaling (1/8 size straight from the bitstream), so even 50 MP files thumbnail in a few ms.
fn decode_small(path: &str, size: u32) -> Result<DynamicImage, String> {
    let ext = ext_of(path);
    if matches!(ext.as_str(), "jpg" | "jpeg" | "jpe" | "jfif" | "pjpeg" | "pjp") {
        let f = File::open(path).map_err(|e| e.to_string())?;
        let mut d = jpeg_decoder::Decoder::new(BufReader::new(f));
        d.read_info().map_err(|e| e.to_string())?;
        let (w, h) = d.scale(size as u16 * 2, size as u16 * 2).map_err(|e| e.to_string())?;
        let px = d.decode().map_err(|e| e.to_string())?;
        let info = d.info().ok_or("no jpeg info")?;
        let (w, h) = (w as u32, h as u32);
        let img = match info.pixel_format {
            jpeg_decoder::PixelFormat::RGB24 => image::RgbImage::from_raw(w, h, px).map(DynamicImage::ImageRgb8),
            jpeg_decoder::PixelFormat::L8 => image::GrayImage::from_raw(w, h, px).map(DynamicImage::ImageLuma8),
            jpeg_decoder::PixelFormat::CMYK32 => {
                let rgb: Vec<u8> = px.chunks_exact(4).flat_map(|c| {
                    let k = 255 - c[3] as u32;
                    [(255 - c[0] as u32) * k / 255, (255 - c[1] as u32) * k / 255, (255 - c[2] as u32) * k / 255].map(|v| v as u8)
                }).collect();
                image::RgbImage::from_raw(w, h, rgb).map(DynamicImage::ImageRgb8)
            }
            _ => None,
        };
        if let Some(i) = img { return Ok(i); }
    }
    let img = image::ImageReader::open(path).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .decode().map_err(|e| e.to_string())?;
    Ok(DynamicImage::ImageRgba8(to_display_rgba8(img)))
}

static THUMBS: Lazy<Mutex<HashMap<(String, u32), (u64, std::sync::Arc<Vec<u8>>)>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// JPEG thumbnail that fits a `size`×`size` box, EXIF orientation applied.
pub fn thumb(path: &str, size: u32) -> Result<std::sync::Arc<Vec<u8>>, String> {
    let size = size.clamp(16, 1024);
    let mt = std::fs::metadata(path).map(|m| mtime_ms(&m)).unwrap_or(0);
    let key = (path.to_string(), size);
    if let Some((m, b)) = THUMBS.lock().get(&key) { if *m == mt { return Ok(b.clone()); } }
    if ext_of(path) == "svg" { return Err("svg".into()); }
    let img = orient(decode_small(path, size)?, orientation(path));
    let t = img.thumbnail(size, size).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&t).map_err(|e| e.to_string())?;
    let out = std::sync::Arc::new(out);
    let mut c = THUMBS.lock();
    if c.len() > 2000 { c.clear(); }
    c.insert(key, (mt, out.clone()));
    Ok(out)
}

// ---------------------------------------------------------------- metadata

/// Camera + capture details for the info panel. Empty when the file carries no EXIF.
pub fn meta(path: &str) -> Value {
    let mut rows: Vec<(String, String)> = Vec::new();
    if let Ok(f) = File::open(path) {
        if let Ok(e) = exif::Reader::new().read_from_container(&mut BufReader::new(f)) {
            use exif::Tag;
            let get = |t: Tag| e.get_field(t, exif::In::PRIMARY).map(|f| f.display_value().with_unit(&e).to_string().trim_matches('"').trim().to_string()).filter(|s| !s.is_empty());
            let cam = [get(Tag::Make), get(Tag::Model)].into_iter().flatten().collect::<Vec<_>>();
            let cam = if cam.len() == 2 && cam[1].to_lowercase().starts_with(&cam[0].to_lowercase()) { cam[1].clone() } else { cam.join(" ") };
            if !cam.is_empty() { rows.push(("Camera".into(), cam)); }
            for (label, tag) in [("Lens", Tag::LensModel), ("Aperture", Tag::FNumber), ("Shutter", Tag::ExposureTime), ("ISO", Tag::PhotographicSensitivity),
                ("Focal length", Tag::FocalLength), ("35 mm equiv.", Tag::FocalLengthIn35mmFilm), ("Exposure bias", Tag::ExposureBiasValue), ("Flash", Tag::Flash),
                ("Taken", Tag::DateTimeOriginal), ("Software", Tag::Software), ("Artist", Tag::Artist), ("Copyright", Tag::Copyright)] {
                if let Some(v) = get(tag) { rows.push((label.into(), v)); }
            }
            let gps = |t: Tag, r: Tag| -> Option<f64> {
                let f = e.get_field(t, exif::In::PRIMARY)?;
                let exif::Value::Rational(v) = &f.value else { return None };
                if v.len() < 3 { return None; }
                let d = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
                let neg = e.get_field(r, exif::In::PRIMARY).map(|f| { let s = f.display_value().to_string(); s.contains('S') || s.contains('W') }).unwrap_or(false);
                Some(if neg { -d } else { d })
            };
            if let (Some(la), Some(lo)) = (gps(Tag::GPSLatitude, Tag::GPSLatitudeRef), gps(Tag::GPSLongitude, Tag::GPSLongitudeRef)) {
                rows.push(("Location".into(), format!("{la:.5}, {lo:.5}")));
            }
        }
    }
    json!({ "exif": rows })
}
