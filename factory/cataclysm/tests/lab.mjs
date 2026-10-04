// =====================================================================
//  lab.mjs — offline test bench for CATACLYSM.
//  Loads the compiled wasm, writes patches through the SAME packing code the
//  GUI uses (pack.mjs), renders hits and measures them.
// =====================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { P } from "../params.mjs";
import { L, slotDefaults, actualToRaw, rawToActual } from "../pack.mjs";

const STRIDE = 8192;
export const KEYS = Object.fromEntries(P.map((p, i) => [p.key, p]));

export class Engine {
  constructor(wasmPath, sr = 48000) {
    const bytes = readFileSync(wasmPath);
    this.inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
    this.ex = this.inst.exports;
    this.sr = sr;
    this.ex.init(sr, STRIDE, 2);
    this.pp = this.ex.getParamsPtr() >>> 2;
    this.op = this.ex.getOutputPtr() >>> 2;
    this.dp = this.ex.getDisplayPtr() >>> 2;
    this.nslots = this.ex.getNumParams();
    this.patch = {};
  }
  mem() { return new Float32Array(this.ex.memory.buffer); }
  reset(sr = this.sr) { this.sr = sr; this.ex.init(sr, STRIDE, 2); this.pp = this.ex.getParamsPtr() >>> 2; this.op = this.ex.getOutputPtr() >>> 2; }
  // values: {KEY: actual}. Anything missing is the default.
  setPatch(values = {}, tempo = 0) {
    this.patch = values;
    const slots = slotDefaults(values);
    const m = this.mem();
    for (let i = 0; i < 64; i++) m[this.pp + i] = 0;
    slots.forEach((v, i) => (m[this.pp + i] = v));
    m[this.pp + 63] = tempo;
  }
  setSlotsRaw(arr) { const m = this.mem(); arr.forEach((v, i) => (m[this.pp + i] = v)); }
  display() { const m = this.mem(); return Array.from(m.subarray(this.dp, this.dp + 16)); }
  hz(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  // events: [{t: seconds, type:'on'|'off'|'cc', note, vel, num, val}]
  render(seconds, events = [{ t: 0, type: "on", note: 36, vel: 0.9 }], block = 256) {
    const total = Math.round(seconds * this.sr);
    const out = new Float32Array(total * 2);
    const ev = [...events].sort((a, b) => a.t - b.t);
    let ei = 0;
    for (let pos = 0; pos < total; ) {
      // sample-accurate: split the block at the next event
      let n = Math.min(block, total - pos);
      while (ei < ev.length && Math.round(ev[ei].t * this.sr) <= pos) {
        const e = ev[ei++];
        if (e.type === "on") this.ex.noteOn(e.note, this.hz(e.note), e.vel ?? 0.9);
        else if (e.type === "off") this.ex.noteOff(e.note);
        else if (e.type === "cc") this.ex.controlChange(e.num, e.val);
      }
      if (ei < ev.length) n = Math.min(n, Math.max(1, Math.round(ev[ei].t * this.sr) - pos));
      this.ex.process(n);
      const m = this.mem();
      for (let i = 0; i < n; i++) {
        out[(pos + i) * 2] = m[this.op + i];
        out[(pos + i) * 2 + 1] = m[this.op + STRIDE + i];
      }
      pos += n;
    }
    return out;
  }
}

// ---------- analysis ----------
export function metrics(buf) {
  let sq = 0, pk = 0, dc = 0, nan = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    sq += v * v; dc += v; const a = Math.abs(v); if (a > pk) pk = a;
  }
  return { rms: Math.sqrt(sq / buf.length), peak: pk, dc: dc / buf.length, nan };
}
export function mono(buf) { const n = buf.length / 2, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (buf[2 * i] + buf[2 * i + 1]) / 2; return o; }
// RMS envelope in dB per window (ms)
export function envDb(m, sr, winMs = 10) {
  const w = Math.max(1, Math.round(sr * winMs / 1000)), out = [];
  for (let i = 0; i + w <= m.length; i += w) {
    let s = 0; for (let j = 0; j < w; j++) s += m[i + j] * m[i + j];
    out.push(10 * Math.log10(s / w + 1e-14));
  }
  return out;
}
// time (s) after which the level stays below (peak - db)
export function decayTime(m, sr, db = 40, winMs = 5) {
  const e = envDb(m, sr, winMs); const pk = Math.max(...e);
  let last = 0; for (let i = 0; i < e.length; i++) if (e[i] > pk - db) last = i;
  return (last + 1) * winMs / 1000;
}
// dominant pitch by normalised autocorrelation within [t0,t1] seconds:
// first prominent local maximum (>= 90 % of the best), energies taken over the same overlap
export function pitchAt(m, sr, t0, t1, fmin = 20, fmax = 2000) {
  const a = Math.round(t0 * sr), b = Math.min(m.length, Math.round(t1 * sr));
  const seg = m.subarray(a, b);
  let e0 = 0; for (let i = 0; i < seg.length; i++) e0 += seg[i] * seg[i];
  if (e0 < 1e-12) return 0;
  const lo = Math.max(2, Math.floor(sr / fmax)), hi = Math.min(Math.floor(sr / fmin), (seg.length * 2) / 3 | 0);
  const r = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let c = 0, ea = 0, eb = 0;
    for (let i = 0; i + lag < seg.length; i++) { c += seg[i] * seg[i + lag]; ea += seg[i] * seg[i]; eb += seg[i + lag] * seg[i + lag]; }
    r[lag] = c / Math.sqrt(ea * eb + 1e-18);
  }
  let best = -1; for (let lag = lo; lag <= hi; lag++) if (r[lag] > best) best = r[lag];
  for (let lag = lo; lag <= hi; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= 0.9 * best) {
      // parabolic interpolation for sub-sample accuracy
      const y0 = r[lag - 1], y1 = r[lag], y2 = r[lag + 1];
      const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
      return sr / (lag + d);
    }
  }
  return 0;
}
// spectral centroid (Hz) of a segment via a naive radix-2 FFT
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export function spectrum(m, sr, t0, t1, n = 8192) {
  const a = Math.round(t0 * sr);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n && a + i < m.length && a + i < Math.round(t1 * sr); i++) re[i] = m[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { mag, binHz: sr / n };
}
export function centroid(m, sr, t0, t1) {
  const { mag, binHz } = spectrum(m, sr, t0, t1);
  let s = 0, w = 0; for (let i = 1; i < mag.length; i++) { s += mag[i] * i * binHz; w += mag[i]; }
  return w ? s / w : 0;
}
export function bandEnergyDb(m, sr, t0, t1, f0, f1) {
  const { mag, binHz } = spectrum(m, sr, t0, t1);
  let e = 0; for (let i = Math.floor(f0 / binHz); i < Math.min(mag.length, Math.ceil(f1 / binHz)); i++) e += mag[i] * mag[i];
  return 10 * Math.log10(e + 1e-12);
}
export function writeWav(path, interleaved, rate) {
  const n = interleaved.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, interleaved[i])) * 32767), 44 + i * 2);
  writeFileSync(path, buf);
}
// spectrogram PNG through ffmpeg (so the sound can be inspected visually)
export function spectrogram(wavPath, pngPath, w = 900, h = 300) {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-lavfi",
      `showspectrumpic=s=${w}x${h}:legend=0:scale=log:fscale=log:color=fire:stop=20000`, pngPath]);
    return true;
  } catch { return false; }
}
export { L, slotDefaults, actualToRaw, rawToActual, P };
