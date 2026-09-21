// drumlab.mjs — load a drum-machine wasm and measure voices.
// Usage as a module: import { Lab } from "./drumlab.mjs"
import { readFileSync, writeFileSync } from "node:fs";

const STRIDE = 8192;

export class Lab {
  constructor(wasmPath, sr = 48000) {
    this.sr = sr;
    const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), { env: { abort() {} } });
    this.ex = inst.exports;
    this.reset();
  }
  reset() {
    this.ex.init(this.sr, STRIDE, 2);
    this.out = this.ex.getOutputPtr() >>> 2;
    this.par = this.ex.getParamsPtr() >>> 2;
    this.disp = this.ex.getDisplayPtr ? this.ex.getDisplayPtr() >>> 2 : 0;
  }
  f32() { return new Float32Array(this.ex.memory.buffer); }
  set(i, v) { this.f32()[this.par + i] = v; }
  get(i) { return this.f32()[this.par + i]; }
  display() { const m = this.f32(); return Array.from(m.subarray(this.disp, this.disp + 16)); }
  // Render `sec` seconds; `events` = [{at: seconds, note, vel}] ; block size 256
  render(sec, events = [], opts = {}) {
    const n = Math.round(sec * this.sr), blk = opts.block || 256;
    const L = new Float32Array(n), R = new Float32Array(n);
    const ev = events.slice().sort((a, b) => a.at - b.at);
    let k = 0;
    for (let pos = 0; pos < n; pos += blk) {
      const m = Math.min(blk, n - pos);
      if (opts.transport) this.ex.transport(1, (pos / this.sr) * (opts.bpm || 120) / 60, opts.bpm || 120);
      while (k < ev.length && Math.round(ev[k].at * this.sr) < pos + m) {
        const e = ev[k++];
        if (e.off) this.ex.noteOff(e.note); else this.ex.noteOn(e.note, 440 * 2 ** ((e.note - 69) / 12), e.vel ?? 0.7);
      }
      this.ex.process(m);
      const f = this.f32();
      for (let i = 0; i < m; i++) { L[pos + i] = f[this.out + i]; R[pos + i] = f[this.out + STRIDE + i]; }
    }
    return { L, R, sr: this.sr };
  }
}

export const mono = (b) => { const o = new Float32Array(b.L.length); for (let i = 0; i < o.length; i++) o[i] = 0.5 * (b.L[i] + b.R[i]); return o; };
export const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
export const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

// Envelope in 1 ms windows → time (ms) when it falls below peak·10^(db/20) for good.
export function decayMs(x, sr, db = -20) {
  const w = Math.round(sr / 1000), env = [];
  for (let i = 0; i + w <= x.length; i += w) env.push(rms(x, i, i + w));
  const pk = Math.max(...env), th = pk * 10 ** (db / 20);
  let last = 0;
  for (let i = 0; i < env.length; i++) if (env[i] >= th) last = i;
  return last;
}

// Dominant frequency in a window via zero-crossing of a low-passed copy,
// refined with autocorrelation. Good for the tonal voices.
export function pitchAt(x, sr, t0ms, lenMs, fmin = 30, fmax = 3000) {
  const a = Math.round(t0ms * sr / 1000), n = Math.round(lenMs * sr / 1000);
  const seg = x.subarray(a, a + n);
  let best = 0, bestLag = 0;
  const lmin = Math.floor(sr / fmax), lmax = Math.min(Math.floor(sr / fmin), n - 2);
  let e0 = 0; for (let i = 0; i < n; i++) e0 += seg[i] * seg[i];
  for (let lag = lmin; lag <= lmax; lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += seg[i] * seg[i + lag];
    s /= (n - lag);
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return 0;
  // parabolic refine
  const ac = (lag) => { let s = 0; for (let i = 0; i + lag < n; i++) s += seg[i] * seg[i + lag]; return s / (n - lag); };
  const y0 = ac(bestLag - 1), y1 = ac(bestLag), y2 = ac(bestLag + 1);
  const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return sr / (bestLag + (Number.isFinite(d) ? d : 0));
}

// Spectral centroid (Hz) of a window, naive DFT on 2048 points.
export function centroid(x, sr, t0ms = 0, N = 2048) {
  const a = Math.round(t0ms * sr / 1000);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k += 2) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const v = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); const ph = 2 * Math.PI * k * i / N; re += v * Math.cos(ph); im -= v * Math.sin(ph); }
    const m = Math.hypot(re, im); num += m * k * sr / N; den += m;
  }
  return den ? num / den : 0;
}

export function wav(path, b) {
  const n = b.L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(b.sr, 24);
  buf.writeUInt32LE(b.sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.R[i])) * 32767), 46 + i * 4); }
  writeFileSync(path, buf);
}
