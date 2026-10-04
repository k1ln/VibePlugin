#!/usr/bin/env node
// packing.mjs — end-to-end proof that what the GUI/host writes into the 61 slots
// is exactly what the DSP decodes: every raw value of every parameter, then
// random full patches (all 256 controls at once, catches cross-field overflow),
// then the real host chain (norm → float32 → hostMin + n·(max−min)).
import { Engine, P, L, slotDefaults, rawToActual, actualToRaw } from "./lab.mjs";
const wasm = process.argv[2];
const e = new Engine(wasm);
const idx = Object.fromEntries(P.map((p, i) => [p.key, i]));
const read = (key) => e.ex.paramValue(idx[key]);
const f32 = Math.fround;
let bad = 0, checks = 0;
function expect(p, got, want, ctx) {
  checks++;
  const tol = Math.max(1e-4, Math.abs(want) * 2e-6);
  if (!(Math.abs(got - want) <= tol)) { if (bad++ < 15) console.log(`MISMATCH ${p.key} ${ctx}: got ${got} want ${want}`); }
}
function load(values, hostChain = false) {
  const slots = slotDefaults(values);
  const m = e.mem();
  for (let i = 0; i < 64; i++) m[e.pp + i] = 0;
  slots.forEach((v, i) => {
    if (hostChain) { // what PluginProcessor does: actualToNorm → float32 → normToActual
      const s = P.find((p) => p.slot === i && p.direct);
      const lo = s ? s.min : 0, hi = s ? s.max : 16777216;
      const n = f32((v - lo) / (hi - lo)); m[e.pp + i] = f32(lo + n * (hi - lo));
    } else m[e.pp + i] = v;
  });
  e.ex.process(1);
}
// 1) every raw value of every parameter, alone
for (const p of P) {
  if (p.direct) { for (const v of [p.min, p.def, (p.min + p.max) / 2, p.max]) { load({ [p.key]: v }); expect(p, read(p.key), v, "direct"); } continue; }
  for (let raw = 0; raw < p.steps; raw++) { const want = rawToActual(p, raw); load({ [p.key]: want }); expect(p, read(p.key), want, `raw ${raw}`); }
}
console.log(`single-parameter sweep: ${checks} checks`);
// 2) random full patches, via the host float chain
let seed = 987654;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
for (let n = 0; n < 300; n++) {
  const patch = {};
  for (const p of P) patch[p.key] = p.direct ? p.min + rnd() * (p.max - p.min) : rawToActual(p, Math.floor(rnd() * p.steps));
  load(patch, n % 2 === 1);
  for (const p of P) expect(p, read(p.key), p.direct ? f32(patch[p.key]) : rawToActual(p, actualToRaw(p, patch[p.key])), `patch ${n}${n % 2 ? " (host chain)" : ""}`);
}
// 3) the maximal slot value (all digits at their top) must decode, not wrap
{ const m = e.mem(); for (let s = 0; s < L.slots; s++) m[e.pp + s] = 16777215; for (const p of P.filter((q) => q.direct)) m[e.pp + p.slot] = p.max; e.ex.process(1);
  for (const p of P) if (!p.direct) expect(p, read(p.key), rawToActual(p, Math.min(p.steps - 1, Math.floor(16777215 / p.mult) % p.steps)), "all-ones slot"); }
console.log(`${checks} checks, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
