// minimal PNG writer + spectrogram renderer (no dependencies) — for eyeballing DSP
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
export function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
function fft(re, im) { const N = re.length; for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = i + k + len / 2; const xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr; re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
// spectrogram: time on x, log-frequency or linear on y, dB colour map
export function spectrogram(path, x, sr, { N = 2048, hop = 256, fmax = 8000, dbRange = 80, w = 900, h = 400, log = false } = {}) {
  const frames = Math.floor((x.length - N) / hop);
  const img = Buffer.alloc(w * h * 3);
  let maxMag = 1e-9; const cols = [];
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f * hop + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im); const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) { m[k] = Math.hypot(re[k], im[k]); if (m[k] > maxMag) maxMag = m[k]; } cols.push(m);
  }
  const heat = (v) => { v = Math.max(0, Math.min(1, v)); const r = Math.min(255, v * 3 * 255), g = Math.max(0, Math.min(255, (v * 3 - 1) * 255)), b = Math.max(0, Math.min(255, (v * 3 - 2) * 255)); return [r, g, b]; };
  const bin = (yy) => { const fr = log ? 20 * Math.pow(fmax / 20, 1 - yy / h) : fmax * (1 - yy / h); return Math.min(N / 2 - 1, Math.round(fr * N / sr)); };
  for (let px = 0; px < w; px++) {
    const m = cols[Math.min(frames - 1, Math.floor(px * frames / w))];
    for (let py = 0; py < h; py++) { const v = 1 + 20 * Math.log10(m[bin(py)] / maxMag + 1e-12) / dbRange; const [r, g, b] = heat(v); const o = (py * w + px) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; }
  }
  writePng(path, w, h, img);
}
// waveform plot (min/max envelope)
export function plotWave(path, x, { w = 900, h = 240, lo = -1, hi = 1 } = {}) {
  const img = Buffer.alloc(w * h * 3, 20);
  for (let px = 0; px < w; px++) {
    const i0 = Math.floor(px * x.length / w), i1 = Math.max(i0 + 1, Math.floor((px + 1) * x.length / w));
    let mn = 1e9, mx = -1e9; for (let i = i0; i < i1; i++) { mn = Math.min(mn, x[i]); mx = Math.max(mx, x[i]); }
    const y0 = Math.round((1 - (mx - lo) / (hi - lo)) * (h - 1)), y1 = Math.round((1 - (mn - lo) / (hi - lo)) * (h - 1));
    for (let py = Math.max(0, y0); py <= Math.min(h - 1, y1); py++) { const o = (py * w + px) * 3; img[o] = 80; img[o + 1] = 220; img[o + 2] = 120; }
  }
  const zy = Math.round((1 - (0 - lo) / (hi - lo)) * (h - 1)); for (let px = 0; px < w; px++) { const o = (zy * w + px) * 3; img[o] = 120; img[o + 1] = 120; img[o + 2] = 120; }
  writePng(path, w, h, img);
}
