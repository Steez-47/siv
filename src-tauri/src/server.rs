//! Local image server on 127.0.0.1 (random port, random token on every request).
//!
//! Routes (all GET, all require `k=<token>`):
//!   /img?p=PATH            the image itself: native formats straight from disk, others decoded to PNG
//!   /thumb?p=PATH&s=SIZE   small JPEG preview (DCT-scaled decode for JPEGs, EXIF orientation applied)
//!
//! Serving over HTTP (instead of a custom protocol) lets WebView2 stream and decode on its own threads,
//! and with CORS the pixels stay readable for WebGL editing and export.
use crate::images;
use percent_encoding::percent_decode_str;
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::io::BufReader;
use std::sync::OnceLock;
use tiny_http::{Header, Request, Response, Server, StatusCode};

static TOKEN: OnceLock<String> = OnceLock::new();
pub fn token() -> &'static str { TOKEN.get().map(|s| s.as_str()).unwrap_or("") }

fn random_token() -> String {
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i ^ std::process::id() as u64);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// Start the server thread; returns the bound port.
pub fn start() -> u16 {
    let _ = TOKEN.set(random_token());
    let server = Server::http("127.0.0.1:0").expect("image server bind failed");
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            std::thread::spawn(move || handle(req));
        }
    });
    port
}

fn hdr(k: &str, v: &str) -> Header { Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap() }
fn cors() -> Header { hdr("Access-Control-Allow-Origin", "*") }
// URLs carry the file's mtime, so a changed file gets a new URL and the cache can be permanent.
fn cache() -> Header { hdr("Cache-Control", "private, max-age=31536000, immutable") }

fn query(url: &str) -> (String, HashMap<String, String>) {
    let (path, q) = url.split_once('?').unwrap_or((url, ""));
    let map = q.split('&').map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        let dec = |s: &str| percent_decode_str(&s.replace('+', " ")).decode_utf8_lossy().into_owned();
        (dec(k), dec(v))
    }).collect();
    (path.to_string(), map)
}

fn err(req: Request, code: u16, msg: &str) {
    let _ = req.respond(Response::from_string(msg).with_status_code(code).with_header(cors()));
}

fn bytes(req: Request, data: &[u8], mime: &str) {
    let _ = req.respond(Response::from_data(data.to_vec()).with_header(cors()).with_header(cache()).with_header(hdr("Content-Type", mime)));
}

fn handle(req: Request) {
    let (path, q) = query(req.url());
    if q.get("k").map(String::as_str) != Some(token()) { return err(req, 403, "forbidden"); }
    let p = q.get("p").cloned().unwrap_or_default();
    match path.as_str() {
        "/img" => serve_img(req, &p),
        "/thumb" => match images::thumb(&p, q.get("s").and_then(|s| s.parse().ok()).unwrap_or(160)) {
            Ok(b) => bytes(req, &b, "image/jpeg"),
            Err(e) => err(req, 415, &e),
        },
        _ => err(req, 404, "not found"),
    }
}

fn serve_img(req: Request, p: &str) {
    if images::is_native(p) {
        let Ok(f) = File::open(p) else { return err(req, 404, "file not found") };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let h = vec![cors(), cache(), hdr("Content-Type", images::mime(p))];
        let _ = req.respond(Response::new(StatusCode(200), h, BufReader::with_capacity(1 << 20, f), Some(len as usize), None));
        return;
    }
    match images::converted(p) {
        Ok(png) => bytes(req, &png, "image/png"),
        Err(e) => err(req, 415, &e),
    }
}
