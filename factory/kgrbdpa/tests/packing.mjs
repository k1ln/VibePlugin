// packing.mjs — every raw value of every control (and random whole patches) survives the host float chain:
// pack.mjs → host slot floats → decodeSlot() in the wasm. node tests/packing.mjs <wasm>
import { Engine, P, L, rawToActual, WASM } from "./lab.mjs";
import { check, done } from "./t.mjs";
const e = new Engine(WASM);
const pidx = Object.fromEntries(P.map((p, i) => [p.key, i]));
const dec = () => { e.ex.process(1); return (k) => e.ex.paramValue(pidx[k]); };
let bad = 0, tested = 0;
for (const p of P) {
  const vals = p.direct ? [p.min, p.max, (p.min + p.max) / 2, p.def] : Array.from({ length: p.steps }, (_, r) => rawToActual(p, r));
  for (const v of vals) {
    e.reset(); e.setPatch({ [p.key]: v });
    const get = dec(); tested++;
    const got = get(p.key);
    if (Math.abs(got - v) > (p.direct ? 1e-5 * Math.max(1, Math.abs(v)) : 1e-6)) { bad++; if (bad < 8) console.log(`  MISMATCH ${p.key}: wrote ${v} read ${got}`); }
  }
}
check(`all ${tested} raw values of all ${P.length} controls round-trip exactly`, bad === 0, `${bad} mismatches`);
// random whole patches: every control at once
let rnd = 12345; const R = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
let bad2 = 0;
for (let t = 0; t < 300; t++) {
  const v = {}; for (const p of P) v[p.key] = p.direct ? p.min + R() * (p.max - p.min) : rawToActual(p, Math.floor(R() * p.steps));
  e.reset(); e.setPatch(v); const get = dec();
  for (const p of P) { const got = get(p.key); const ok = p.direct ? Math.abs(got - Math.fround(v[p.key])) < 2e-6 * Math.max(1, Math.abs(v[p.key])) : got === v[p.key]; if (!ok) { bad2++; if (bad2 < 6) console.log(`  random patch ${t}: ${p.key} wrote ${v[p.key]} read ${got}`); } }
}
check("300 random whole patches decode exactly", bad2 === 0, `${bad2} mismatches`);
check(`slot budget: ${L.slots} of 63 host slots (${L.direct.length} direct + ${L.slots - L.direct.length} packed)`, L.slots <= 63);
done("packing");
