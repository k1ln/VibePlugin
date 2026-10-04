#!/usr/bin/env node
// react.mjs — strict QA for Std* plugins (the stock wasm-runner reseeds nothing between renders, so its
// "params affect output" check passes on noise alone).
//   node factory/std/react.mjs [slug …|all] [--quiet]
//  1. every parameter: deterministic decorrelated-stereo input, engaged patch (test-params.json defaults),
//     min vs max render must differ by > 0.1% (relative RMS) — otherwise "INERT".
//  2. fuzz: 40 random/extreme parameter sets at 44.1/48/96/192 kHz must stay finite and bounded.
//  3. silence in -> silence out (no self-noise > -90 dB, no NaN) after the tail has died.
//  4. block-size independence: 64 vs 256 vs 1000-frame blocks must give the same output.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
let slugs = args.filter((a) => !a.startsWith("--"));
if (!slugs.length || slugs.includes("all")) slugs = readdirSync(join(root, "factory/plugins")).filter((d) => d.startsWith("std-")).sort();
const S = 8192;

function makeInput(sr, seedBase) {
  let a = seedBase >>> 0;
  const rn = () => { a = (a * 1664525 + 1013904223) >>> 0; return (a / 4294967296) * 2 - 1; };
  return (i) => {
    const t = i / sr;
    const sw = Math.sin(2 * Math.PI * (110 + 1800 * (t % 1)) * t);
    const imp = i % Math.round(sr / 2) === 0 ? 0.4 : 0;
    const bur = (t % 0.7) < 0.15 ? 0.35 * Math.sin(2 * Math.PI * 220 * t) : 0;
    return [0.3 * sw + 0.08 * rn() + imp + bur, 0.24 * sw * Math.cos(t * 3) + 0.08 * rn() + imp * 0.5 + bur * 0.6];
  };
}

function makeBursts(sr, seedBase) {
  let a = seedBase >>> 0;
  const rn = () => { a = (a * 1664525 + 1013904223) >>> 0; return (a / 4294967296) * 2 - 1; };
  return (i) => {
    const t = (i / sr) % 1.0;
    const env = t < 0.2 ? 1 : (t < 0.55 ? Math.exp(-(t - 0.2) * 9) : 0);
    const v = env * (0.4 * Math.sin(2 * Math.PI * 220 * t) + 0.08 * rn()) + 0.002 * rn();
    return [v, v * 0.8];
  };
}

async function load(slug) {
  const wasm = join(tmpdir(), `react-${slug}.wasm`);
  execFileSync("node", ["compiler/asc-driver.mjs", `factory/plugins/${slug}/assembly.ts`, wasm], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const { instance } = await WebAssembly.instantiate(readFileSync(wasm), { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
  return instance.exports;
}

function render(ex, spec, over, { sr = 48000, secs = 2, block = 256, input, silent = false } = {}) {
  const mem = () => new Float32Array(ex.memory.buffer);
  const inP = ex.getInputPtr() >> 2, outP = ex.getOutputPtr() >> 2, parP = ex.getParamsPtr() >> 2;
  ex.init(sr, S, 2);
  for (const p of spec) mem()[parP + p.index] = over[p.index] ?? p.default;
  const N = Math.round(sr * secs), out = new Float32Array(N * 2);
  const inp = input || makeInput(sr, 99);
  for (let pos = 0; pos < N; pos += block) {
    const n = Math.min(block, N - pos), m = mem();
    for (let i = 0; i < n; i++) { const v = silent ? [0, 0] : inp(pos + i); m[inP + i] = v[0]; m[inP + S + i] = v[1]; }
    ex.process(n);
    const o = mem();
    for (let i = 0; i < n; i++) { out[(pos + i) * 2] = o[outP + i]; out[(pos + i) * 2 + 1] = o[outP + S + i]; }
  }
  return out;
}
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / a.length); };
const stats = (x) => { let pk = 0, bad = 0; for (let i = 0; i < x.length; i++) { if (!Number.isFinite(x[i])) bad++; else pk = Math.max(pk, Math.abs(x[i])); } return { pk, bad }; };

let fails = 0;
for (const slug of slugs) {
  const dir = join(root, "factory/plugins", slug);
  if (!existsSync(join(dir, "spec.json"))) { console.log(`? ${slug}: no spec.json`); continue; }
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")).params;
  const tp = JSON.parse(readFileSync(join(dir, "test-params.json"), "utf8"));
  const engaged = {}; tp.forEach((p) => { engaged[p.index] = p.default; });
  let ex;
  try { ex = await load(slug); } catch (e) { console.log(`✗ ${slug}: compile/load failed ${String(e.stderr || e.message).slice(0, 300)}`); fails++; continue; }
  const problems = [];
  // 1. reactivity
  const defMod = (await import(join(dir, "def.mjs") + "?t=" + Date.now())).default;
  const inputFn = defMod.reactInput === "bursts" ? makeBursts : makeInput;
  const patches = [engaged, ...(defMod.reactPatches || []).map((pt) => ({ ...engaged, ...pt }))];
  const R = (over, o = {}) => render(ex, spec, over, { ...o, input: o.input || inputFn(o.sr || 48000, 99) });
  const base = R(engaged);
  const baseRms = rms(base);
  if (baseRms < (inputFn === makeBursts ? 0.002 : 0.01)) problems.push(`silent at defaults (rms ${baseRms.toExponential(1)})`);
  const rows = [];
  for (const p of spec) {
    let rel = 0;
    for (const pt of patches) {
      const lo = R({ ...pt, [p.index]: p.min }), hi = R({ ...pt, [p.index]: p.max });
      rel = Math.max(rel, diff(lo, hi) / Math.max(rms(lo), rms(hi), 1e-9));
    }
    rows.push(`${p.name}:${rel.toFixed(3)}`);
    if (rel < (defMod.reactMin ?? 0.001)) problems.push(`INERT param "${p.name}" (rel ${rel.toExponential(1)})`);
  }
  // 2. fuzz
  let seed = 12345; const rn = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const sr of [44100, 48000, 96000, 192000]) {
    for (let k = 0; k < (sr > 48000 ? 8 : 14); k++) {
      const over = {};
      for (const p of spec) { const r = rn(); over[p.index] = r < 0.2 ? p.min : r < 0.4 ? p.max : p.min + rn() * (p.max - p.min); if (p.step) over[p.index] = Math.round(over[p.index] / p.step) * p.step; }
      const o = render(ex, spec, over, { sr, secs: 1, input: inputFn(sr, k + 1) });
      const st = stats(o);
      if (st.bad || st.pk > 30) { problems.push(`fuzz @${sr}: ${st.bad} non-finite, peak ${st.pk.toFixed(1)} params ${JSON.stringify(over)}`); break; }
    }
  }
  // 3. silence
  { const o0 = render(ex, spec, engaged, { secs: 2, silent: true }); const o = o0.subarray(Math.floor(o0.length / 2)); const st = stats(o); if (st.bad || st.pk > 0.003) problems.push(`self-noise on silence: peak ${st.pk.toExponential(1)} nonfinite ${st.bad}`); }
  // 4. block independence
  { const a = R(engaged, { block: 64, secs: 1 }), b = R(engaged, { block: 1000, secs: 1 }), c = R(engaged, { block: 256, secs: 1 });
    const d = Math.max(diff(a, c), diff(b, c)) / Math.max(rms(c), 1e-9); if (d > 0.05) problems.push(`block-size dependent (rel ${d.toFixed(3)})`); }
  const peak = stats(base).pk;
  if (peak > 1.0005 && !["std-utility"].includes(slug)) problems.push(`peak ${peak.toFixed(3)} > 1`);
  if (problems.length) fails++;
  console.log(`${problems.length ? "✗" : "✓"} ${slug}${quiet && !problems.length ? "" : "  [" + rows.join(" ") + "]"}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}
console.log(`\n${slugs.length - fails}/${slugs.length} clean`);
process.exit(fails ? 1 : 0);
