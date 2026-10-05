// =====================================================================
//  lab.mjs — offline test bench for KGrbdPa. Loads the compiled wasm, writes
//  patches through the SAME packing code the GUI uses (pack.mjs), renders notes
//  and measures them. Patch-bay cables are set by name: { "PB_F_CUT": "LFO" }.
// =====================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { P, SRC } from "../params.mjs";
import { L, slotDefaults, actualToRaw, rawToActual } from "../pack.mjs";
export { P, L, slotDefaults, actualToRaw, rawToActual, SRC };

const STRIDE = 8192;
export const KEYS = Object.fromEntries(P.map((p) => [p.key, p]));
export const IDX = Object.fromEntries(P.map((p, i) => [p.key, i]));
export const SRCNAMES = ["—", ...SRC.map((s) => s[1])];

// accept {PB_x: "LFO"} / {PB_x: "Mod Wave Out"} / numbers
export function normValues(values = {}) {
  const o = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith("PB_") && typeof v === "string") {
      let i = v === "—" || v === "" ? 0 : SRC.findIndex((s) => s[0] === v || s[1] === v) + 1;
      if (v !== "—" && i === 0) throw new Error("unknown cable source " + v);
      o[k] = i;
    } else o[k] = v;
  }
  return o;
}

export class Engine {
  constructor(wasmPath, sr = 48000) {
    const bytes = readFileSync(wasmPath);
    this.inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
    this.ex = this.inst.exports;
    this.sr = sr;
    this.reset(sr);
  }
  mem() { return new Float32Array(this.ex.memory.buffer); }
  reset(sr = this.sr) {
    this.sr = sr;
    this.ex.init(sr, STRIDE, 2);
    this.pp = this.ex.getParamsPtr() >>> 2; this.op = this.ex.getOutputPtr() >>> 2;
    this.dp = this.ex.getDisplayPtr() >>> 2; this.ip = this.ex.getInputPtr() >>> 2;
    this.values = {};
  }
  setPatch(values = {}, tempo = 0) {
    this.values = normValues(values);
    const slots = slotDefaults(this.values);
    const m = this.mem();
    for (let i = 0; i < 64; i++) m[this.pp + i] = 0;
    slots.forEach((v, i) => (m[this.pp + i] = v));
    m[this.pp + 63] = tempo;
  }
  // change a few params on top of the current ones
  tweak(values, tempo) { this.setPatch({ ...this.values, ...normValues(values) }, tempo ?? this.mem()[this.pp + 63]); }
  display() { const m = this.mem(); return Array.from(m.subarray(this.dp, this.dp + 16)); }
  hz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
  // events: [{t, type:'on'|'off'|'cc'|'patch'|'transport', note, vel, num, val, values}]
  // input: optional function (i)=>[l,r] feeding the audio input
  render(seconds, events = [{ t: 0, type: "on", note: 60, vel: 0.8 }], opt = {}) {
    const block = opt.block || 256;
    const total = Math.round(seconds * this.sr);
    const out = new Float32Array(total);
    const probe = opt.probe ? new Float32Array(total) : null;
    const probes = opt.probes ? opt.probes.map(() => new Float32Array(total)) : null;
    const states = opt.states ? opt.states.map(() => new Float32Array(total)) : null;
    const ev = [...events].sort((a, b) => a.t - b.t);
    let ei = 0;
    const m0 = this.mem();
    for (let pos = 0; pos < total; ) {
      let n = Math.min(block, total - pos);
      while (ei < ev.length && Math.round(ev[ei].t * this.sr) <= pos) {
        const e = ev[ei++];
        if (e.type === "on") this.ex.noteOn(e.id ?? e.note, this.hz(e.note), e.vel ?? 0.8);
        else if (e.type === "off") this.ex.noteOff(e.id ?? e.note);
        else if (e.type === "marker") this.ex.noteOn(e.id, 0, 0);
        else if (e.type === "cc") this.ex.controlChange(e.num, e.val);
        else if (e.type === "patch") this.tweak(e.values, e.tempo);
        else if (e.type === "transport") this.ex.transport(e.playing ?? 1, e.ppq ?? 0, e.bpm ?? 120);
      }
      if (ei < ev.length) n = Math.min(n, Math.max(1, Math.round(ev[ei].t * this.sr) - pos));
      { const m = this.mem(); for (let i = 0; i < n; i++) { const [l, r] = opt.input ? opt.input(pos + i) : [0, 0]; m[this.ip + i] = l; m[this.ip + STRIDE + i] = r; } }
      this.ex.process(n);
      const m = this.mem();
      for (let i = 0; i < n; i++) out[pos + i] = m[this.op + i];
      if (probe) for (let i = 0; i < n; i++) probe[pos + i] = this.ex.dbgSrc(opt.probe);
      if (states) for (let k = 0; k < states.length; k++) { const v = this.ex.dbgState(opt.states[k]); for (let i = 0; i < n; i++) states[k][pos + i] = v; }
      if (probes) for (let k = 0; k < probes.length; k++) { const v = this.ex.dbgSrc(opt.probes[k]); for (let i = 0; i < n; i++) probes[k][pos + i] = v; }
      pos += n;
    }
    out.probe = probe; out.probes = probes; out.states = states;
    return out;
  }
}
export function metrics(buf) {
  let sq = 0, pk = 0, dc = 0, nan = 0;
  for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (!Number.isFinite(v)) { nan++; continue; } sq += v * v; dc += v; const a = Math.abs(v); if (a > pk) pk = a; }
  return { rms: Math.sqrt(sq / buf.length), peak: pk, dc: dc / buf.length, nan };
}
export const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const slice = (buf, sr, t0, t1) => buf.subarray(Math.round(t0 * sr), Math.round(t1 * sr));
// frequency from upward zero crossings (works for any periodic wave; sub-sample interpolated)
export function zcFreq(x, sr) {
  const cross = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) cross.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  if (cross.length < 3) return 0;
  return (cross.length - 1) * sr / (cross[cross.length - 1] - cross[0]);
}
// autocorrelation pitch (Hz) of a mono window
export function pitch(x, sr, fmin = 30, fmax = 4000) {
  const n = Math.min(x.length, 16384);
  const lo = Math.floor(sr / fmax), hi = Math.min(Math.floor(sr / fmin), n - 2);
  let best = 0, bl = 0; const c = new Float64Array(hi + 2);
  for (let l = lo; l <= hi; l++) { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i + l < n; i++) { s += x[i] * x[i + l]; e1 += x[i] * x[i]; e2 += x[i + l] * x[i + l]; } c[l] = s / Math.sqrt(e1 * e2 + 1e-12); }
  for (let l = lo + 1; l < hi; l++) if (c[l] > 0.6 && c[l] >= c[l - 1] && c[l] >= c[l + 1]) { best = c[l]; bl = l; break; }
  if (!bl) for (let l = lo; l <= hi; l++) if (c[l] > best) { best = c[l]; bl = l; }
  const a = c[bl - 1], b = c[bl], d = c[bl + 1]; const off = (a - d) / (2 * (a - 2 * b + d) || 1);
  return sr / (bl + (Number.isFinite(off) ? off : 0));
}
// DFT magnitude at one frequency (Hann window), normalised so a unit sine reads 1
export function tone(x, sr, f) {
  const N = x.length; let re = 0, im = 0, w = 0;
  for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); const a = 2 * Math.PI * f * i / sr; re += x[i] * h * Math.cos(a); im -= x[i] * h * Math.sin(a); w += h; }
  return 2 * Math.hypot(re, im) / w;
}
// radix-2 FFT magnitude spectrum (power of two N)
export function fftMag(x, N = 16384) {
  N = Math.min(N, 1 << Math.floor(Math.log2(x.length)));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  const mag = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) * 4 / N;
  return mag;
}
export function writeWav(path, mono, sr = 48000) {
  const n = mono.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}
export const WASM = process.env.KG_WASM || process.argv.find((a) => a.endsWith(".wasm")) || "/tmp/kg.wasm";
