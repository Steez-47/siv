// SIV · WebGL2 edit renderer. One fragment pass applies geometry (crop, quarter turns, flips) and every
// adjustment, so slider drags re-render a full-resolution image in a few milliseconds on the GPU.
// The same pass renders the export, so what you see is exactly what gets saved.

const VS = `#version 300 es
out vec2 v;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; // full-screen triangle
  v = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);                                   // v.y = 0 at the top
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v;
out vec4 o;
uniform sampler2D tex;
uniform mat3 uvm;          // output uv -> source uv
uniform vec2 texel;        // 1 / source size
uniform vec2 outSize;
uniform float clarR;       // clarity radius in source texels
uniform float exposure, contrast, highlights, shadows, whites, blacks;
uniform float temp, tint, hue, sat, vib;
uniform float sharpen, clarity, vignette, grain;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec2 uv = (uvm * vec3(v, 1.0)).xy;
  vec4 src = texture(tex, uv);
  vec3 c = src.rgb;

  // detail: unsharp mask (sharpen) and wide-radius local contrast (clarity), both on luminance
  if (sharpen > 0.0) {
    vec3 b = (texture(tex, uv + vec2(texel.x, 0)).rgb + texture(tex, uv - vec2(texel.x, 0)).rgb +
              texture(tex, uv + vec2(0, texel.y)).rgb + texture(tex, uv - vec2(0, texel.y)).rgb) * 0.25;
    c += (c - b) * sharpen * 2.0;
  }
  if (clarity != 0.0) {
    float lb = 0.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5235988;
      float r = (i % 2 == 0) ? 1.0 : 0.5;
      lb += luma(texture(tex, uv + vec2(cos(a), sin(a)) * texel * clarR * r).rgb);
    }
    lb /= 12.0;
    float l = luma(c), mid = 1.0 - abs(l * 2.0 - 1.0);
    c += (l - lb) * clarity * 1.6 * mid;
  }

  // white balance + exposure in linear light
  vec3 lin = toLin(clamp(c, 0.0, 1.0));
  lin *= vec3(1.0 + temp * 0.32, 1.0 - tint * 0.22, 1.0 - temp * 0.32) * vec3(1.0 + max(tint, 0.0) * 0.08, 1.0, 1.0 + max(tint, 0.0) * 0.08);
  lin *= exp2(exposure);
  c = toSrgb(lin);

  // levels: whites / blacks move the end points
  float bp = -blacks * 0.12, wp = 1.0 - whites * 0.22;
  c = (c - bp) / max(wp - bp, 1e-3);

  // highlights / shadows: luminance masks, applied as a ratio to keep hue
  float l = max(luma(c), 1e-4);
  float sm = 1.0 - smoothstep(0.0, 0.55, l), hm = smoothstep(0.45, 1.0, l);
  float nl = l + shadows * 0.45 * sm * (1.0 - l) + highlights * 0.45 * hm * (highlights > 0.0 ? (1.0 - l) + 0.15 : l);
  c *= max(nl, 0.0) / l;

  // contrast: S-curve pivoting on mid grey
  if (contrast > 0.0) c = mix(c, c * c * (3.0 - 2.0 * clamp(c, 0.0, 1.0)), contrast) + (c - 0.5) * contrast * 0.25;
  else c = mix(c, vec3(0.5), -contrast * 0.5);

  // hue rotation in YIQ
  if (hue != 0.0) {
    mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 y = toYiq * c;
    float cs = cos(hue), sn = sin(hue);
    y.yz = vec2(y.y * cs - y.z * sn, y.y * sn + y.z * cs);
    c = toRgb * y;
  }

  // saturation + vibrance (vibrance favors muted colors)
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + sat);
  float s = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + vib * (1.0 - clamp(s * 1.6, 0.0, 1.0)));

  // vignette (aspect-correct, on the output frame)
  if (vignette != 0.0) {
    vec2 d = (v - 0.5) * vec2(outSize.x / max(outSize.x, outSize.y), outSize.y / max(outSize.x, outSize.y)) * 2.0;
    float m = smoothstep(0.35, 1.25, length(d));
    c = vignette < 0.0 ? c * (1.0 + vignette * m * 0.9) : mix(c, vec3(1.0), vignette * m * 0.8);
  }
  if (grain > 0.0) c += (hash(floor(v * outSize)) - 0.5) * grain * 0.22;

  o = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

export const IDENTITY = () => ({ adj: {}, crop: null, rot: 0, flipH: false, flipV: false });

/** Size of the image after quarter turns (before crop). */
export function orientedSize(w, h, e) { return e.rot % 2 ? [h, w] : [w, h]; }
/** Output size: oriented size with the crop applied (crop ignored when showCrop is false). */
export function outputSize(w, h, e, withCrop = true) {
  const [ow, oh] = orientedSize(w, h, e);
  const c = withCrop && e.crop;
  return c ? [Math.max(1, Math.round(c.w * ow)), Math.max(1, Math.round(c.h * oh))] : [ow, oh];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
    if (!gl) throw new Error("WebGL2 isn't available");
    this.gl = gl;
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.p = p; gl.useProgram(p);
    this.u = {};
    for (const n of ["tex", "uvm", "texel", "outSize", "clarR", "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temp", "tint", "hue", "sat", "vib", "sharpen", "clarity", "vignette", "grain"])
      this.u[n] = gl.getUniformLocation(p, n);
    this.vao = gl.createVertexArray();
    this.tex = gl.createTexture();
    this.w = 0; this.h = 0; this.source = null;
  }

  /** Upload an ImageBitmap / HTMLImageElement / canvas as the source texture. */
  setSource(src, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.w = w; this.h = h; this.source = src;
  }

  /** Output-uv → source-uv affine map (column-major mat3): crop, then undo rotation, then undo flips. */
  matrix(e, withCrop) {
    const c = withCrop && e.crop ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
    // oriented o = (c.x + c.w * u, c.y + c.h * v); express s = A·o + b for each quarter turn
    let A, b;
    switch (e.rot & 3) {
      case 1: A = [[0, 1], [-1, 0]]; b = [0, 1]; break;     // s = (o.y, 1 - o.x)
      case 2: A = [[-1, 0], [0, -1]]; b = [1, 1]; break;    // s = (1 - o.x, 1 - o.y)
      case 3: A = [[0, -1], [1, 0]]; b = [1, 0]; break;     // s = (1 - o.y, o.x)
      default: A = [[1, 0], [0, 1]]; b = [0, 0];
    }
    if (e.flipH) { A[0] = A[0].map((x) => -x); b[0] = 1 - b[0]; }
    if (e.flipV) { A[1] = A[1].map((x) => -x); b[1] = 1 - b[1]; }
    // s = A·(C·[u v] + c0) + b
    const m00 = A[0][0] * c.w, m01 = A[0][1] * c.h, m10 = A[1][0] * c.w, m11 = A[1][1] * c.h;
    const t0 = A[0][0] * c.x + A[0][1] * c.y + b[0], t1 = A[1][0] * c.x + A[1][1] * c.y + b[1];
    return new Float32Array([m00, m10, 0, m01, m11, 0, t0, t1, 1]);
  }

  render(e, { withCrop = true } = {}) {
    if (!this.source) return;
    const gl = this.gl, [ow, oh] = outputSize(this.w, this.h, e, withCrop);
    if (this.canvas.width !== ow || this.canvas.height !== oh) { this.canvas.width = ow; this.canvas.height = oh; }
    gl.viewport(0, 0, ow, oh);
    gl.useProgram(this.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const a = e.adj || {}, n = (k) => (a[k] || 0) / 100, u = this.u;
    gl.uniform1i(u.tex, 0);
    gl.uniformMatrix3fv(u.uvm, false, this.matrix(e, withCrop));
    gl.uniform2f(u.texel, 1 / this.w, 1 / this.h);
    gl.uniform2f(u.outSize, ow, oh);
    gl.uniform1f(u.clarR, Math.max(3, Math.max(this.w, this.h) / 160));
    gl.uniform1f(u.exposure, a.exposure || 0);
    for (const k of ["contrast", "highlights", "shadows", "whites", "blacks", "temp", "tint", "vignette", "clarity"]) gl.uniform1f(u[k], n(k));
    gl.uniform1f(u.hue, ((a.hue || 0) * Math.PI) / 180);
    gl.uniform1f(u.sat, n("saturation"));
    gl.uniform1f(u.vib, n("vibrance"));
    gl.uniform1f(u.sharpen, n("sharpen"));
    gl.uniform1f(u.grain, n("grain"));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Encode the current canvas. type: image/png | image/jpeg | image/webp. */
  toBlob(type, quality) { return new Promise((r, j) => this.canvas.toBlob((b) => (b ? r(b) : j(new Error("Couldn't encode the image"))), type, quality)); }
}
