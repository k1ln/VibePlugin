// =====================================================================
//  lab.mjs — offline test bench for KHEVEREST. Loads the compiled wasm,
//  writes patches through the SAME packing code the GUI uses (pack.mjs),
//  renders notes and measures them.
// =====================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { P } from "../params.mjs";
import { L, slotDefaults, actualToRaw, rawToActual } from "../pack.mjs";
export { P, L, slotDefaults, actualToRaw, rawToActual };

const STRIDE = 8192;
export const KEYS = Object.fromEntries(P.map((p, i) => [p.key, p]));
export const IDX = Object.fromEntries(P.map((p, i) => [p.key, i]));

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
    this.ip = this.ex.getInputPtr() >>> 2;
  }
  mem() { return new Float32Array(this.ex.memory.buffer); }
  reset(sr = this.sr) { this.sr = sr; this.ex.init(sr, STRIDE, 2); this.pp = this.ex.getParamsPtr() >>> 2; this.op = this.ex.getOutputPtr() >>> 2; this.dp = this.ex.getDisplayPtr() >>> 2; this.ip = this.ex.getInputPtr() >>> 2; }
  setPatch(values = {}, tempo = 0) {
    const slots = slotDefaults(values);
    const m = this.mem();
    for (let i = 0; i < 64; i++) m[this.pp + i] = 0;
    slots.forEach((v, i) => (m[this.pp + i] = v));
    m[this.pp + 63] = tempo;
  }
  display() { const m = this.mem(); return Array.from(m.subarray(this.dp, this.dp + 16)); }
  hz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
  // events: [{t, type:'on'|'off'|'cc'|'patch', note, vel, num, val, values}]
  render(seconds, events = [{ t: 0, type: "on", note: 60, vel: 0.8 }], block = 256) {
    const total = Math.round(seconds * this.sr);
    const out = new Float32Array(total * 2);
    const ev = [...events].sort((a, b) => a.t - b.t);
    let ei = 0;
    for (let pos = 0; pos < total; ) {
      let n = Math.min(block, total - pos);
      while (ei < ev.length && Math.round(ev[ei].t * this.sr) <= pos) {
        const e = ev[ei++];
        if (e.type === "on") this.ex.noteOn(e.note, this.hz(e.note), e.vel ?? 0.8);
        else if (e.type === "off") this.ex.noteOff(e.note);
        else if (e.type === "cc") this.ex.controlChange(e.num, e.val);
        else if (e.type === "patch") this.setPatch(e.values, e.tempo || 0);
      }
      if (ei < ev.length) n = Math.min(n, Math.max(1, Math.round(ev[ei].t * this.sr) - pos));
      this.ex.process(n);
      const m = this.mem();
      for (let i = 0; i < n; i++) { out[(pos + i) * 2] = m[this.op + i]; out[(pos + i) * 2 + 1] = m[this.op + STRIDE + i]; }
      pos += n;
    }
    return out;
  }
}
export function metrics(buf) {
  let sq = 0, pk = 0, dc = 0, nan = 0;
  for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (!Number.isFinite(v)) { nan++; continue; } sq += v * v; dc += v; const a = Math.abs(v); if (a > pk) pk = a; }
  return { rms: Math.sqrt(sq / buf.length), peak: pk, dc: dc / buf.length, nan };
}
export const mono = (buf) => { const n = buf.length / 2, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (buf[2 * i] + buf[2 * i + 1]) / 2; return o; };
export const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
// autocorrelation pitch (Hz) of a mono window
export function pitch(x, sr, fmin = 40, fmax = 2000) {
  const n = Math.min(x.length, 8192);
  const lo = Math.floor(sr / fmax), hi = Math.floor(sr / fmin);
  let best = 0, bl = 0; const c = [];
  for (let l = lo; l <= hi; l++) { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i + l < n; i++) { s += x[i] * x[i + l]; e1 += x[i] * x[i]; e2 += x[i + l] * x[i + l]; } c[l] = s / Math.sqrt(e1 * e2 + 1e-12); }
  for (let l = lo + 1; l < hi; l++) if (c[l] > 0.5 && c[l] >= c[l - 1] && c[l] >= c[l + 1]) { best = c[l]; bl = l; break; }
  if (!bl) for (let l = lo; l <= hi; l++) if (c[l] > best) { best = c[l]; bl = l; }
  // parabolic refine
  const a = c[bl - 1], b = c[bl], d = c[bl + 1]; const off = (a - d) / (2 * (a - 2 * b + d) || 1);
  return sr / (bl + (Number.isFinite(off) ? off : 0));
}
// spectrum helpers (naive DFT of selected bins)
export function bandEnergy(x, sr, f0, f1, N = 4096) {
  N = Math.min(N, x.length);
  const w = x.slice(0, N); let e = 0;
  for (let k = Math.floor(f0 * N / sr); k <= Math.ceil(f1 * N / sr); k++) {
    let re = 0, im = 0; for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re += w[i] * h * Math.cos(2 * Math.PI * k * i / N); im += w[i] * h * Math.sin(2 * Math.PI * k * i / N); }
    e += re * re + im * im;
  }
  return Math.sqrt(e) / N;
}
export function writeWav(path, stereo, sr = 48000) {
  const n = stereo.length / 2, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < stereo.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(stereo[i] * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}
