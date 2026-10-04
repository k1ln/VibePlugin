#!/usr/bin/env node
// probe.mjs — measure a Std* plugin's behaviour with pure tones / an impulse.
//   node factory/std/probe.mjs <slug> [--set "idx=val,idx=val"] [--freqs 100,1000,..] [--amp 0.1]
//        [--sr 48000] [--impulse] [--burst] [--seconds 1.5]
//  default: steady-state gain (dB, output RMS / input RMS, L channel) for each tone freq.
//  --noise:   steady-state gain for uncorrelated white noise on L/R (best loudness check for reverbs)
//  --impulse: prints energy per 100 ms window of the response to a single click (reverb/delay tails)
//  --burst:   0.2 s tone burst (--freqs first value) then silence; prints RMS per 50 ms window
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const a = process.argv.slice(2);
const slug = a[0];
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : (a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : true); };
const sets = String(opt("--set", "")).split(",").filter(Boolean).map((s) => s.split("=").map(Number));
const freqs = String(opt("--freqs", "100,300,1000,3000,8000")).split(",").map(Number);
const amp = +opt("--amp", 0.1), sr = +opt("--sr", 48000), secs = +opt("--seconds", 1.5);
const ASM = join(root, "factory/plugins", slug, "assembly.ts");
const wasmPath = join(tmpdir(), `probe-${slug}.wasm`);
try { execFileSync("node", ["compiler/asc-driver.mjs", ASM, wasmPath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { console.error("compile failed:", String(e.stderr || e.message).slice(0, 800)); process.exit(1); }
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), { env: { abort() {}, seed: () => 0 } });
const ex = instance.exports, mem = () => new Float32Array(ex.memory.buffer);
const inP = ex.getInputPtr() >> 2, outP = ex.getOutputPtr() >> 2, parP = ex.getParamsPtr() >> 2, S = 8192;
function render(fn, frames, withSets = true) {
  ex.init(sr, S, 2);
  if (withSets) for (const [i, v] of sets) mem()[parP + i] = v;
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let pos = 0; pos < frames; pos += 256) {
    const n = Math.min(256, frames - pos), m = mem();
    for (let i = 0; i < n; i++) { const v = fn(pos + i); m[inP + i] = v[0]; m[inP + S + i] = v[1]; }
    ex.process(n);
    const o = mem();
    for (let i = 0; i < n; i++) { L[pos + i] = o[outP + i]; R[pos + i] = o[outP + S + i]; }
  }
  return [L, R];
}
const rms = (x, a0, a1) => { let s = 0; for (let i = a0; i < a1; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, a1 - a0)); };
const db = (x) => (20 * Math.log10(x + 1e-9)).toFixed(1);
if (opt("--noise", false)) {
  let sd = 12345; const rn = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return (sd / 4294967296) * 2 - 1; };
  const frames = Math.round(sr * secs);
  const [L, R] = render(() => [amp * rn(), amp * rn()], frames);
  const a0 = Math.round(frames * 0.5);
  let pk = 0; for (let i = a0; i < frames; i++) pk = Math.max(pk, Math.abs(L[i]));
  console.log(`white-noise gain: L ${db(rms(L, a0, frames) / (amp / Math.sqrt(3)))} dB, R ${db(rms(R, a0, frames) / (amp / Math.sqrt(3)))} dB (out peak ${pk.toFixed(3)}, in peak ${amp})`);
} else if (opt("--impulse", false)) {
  const [L, R] = render((i) => (i === 0 ? [0.5, 0.5] : [0, 0]), Math.round(sr * secs));
  const w = Math.round(sr * 0.1), o = [];
  for (let p = 0; p + w <= L.length; p += w) o.push(db(rms(L, p, p + w) * 4));
  console.log("L energy dB per 100ms:", o.join(" "));
  let c = 0, l2 = 0, r2 = 0; for (let i = 0; i < L.length; i++) { c += L[i] * R[i]; l2 += L[i] * L[i]; r2 += R[i] * R[i]; }
  console.log("L/R correlation:", (c / Math.sqrt(l2 * r2 + 1e-20)).toFixed(3));
} else if (opt("--burst", false)) {
  const f = freqs[0], bl = Math.round(sr * 0.2);
  const [L] = render((i) => { const v = i < bl ? amp * Math.sin((2 * Math.PI * f * i) / sr) : 0; return [v, v]; }, Math.round(sr * secs));
  const w = Math.round(sr * 0.05), o = [];
  for (let p = 0; p + w <= L.length; p += w) o.push(db(rms(L, p, p + w)));
  console.log("L RMS dB per 50ms:", o.join(" "));
} else {
  const rows = [];
  for (const f of freqs) {
    const frames = Math.round(sr * 1.0);
    const [L] = render((i) => { const v = amp * Math.sin((2 * Math.PI * f * i) / sr); return [v, v]; }, frames);
    const a0 = Math.round(frames * 0.5);
    const ir = rms(L, a0, frames), inr = amp / Math.SQRT2;
    let pk = 0; for (let i = a0; i < frames; i++) pk = Math.max(pk, Math.abs(L[i]));
    rows.push(`${f}Hz: ${db(ir / inr)} dB (peak ${pk.toFixed(3)})`);
  }
  console.log(rows.join("\n"));
}
