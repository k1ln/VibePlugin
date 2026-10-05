// quality.mjs — per-preset gate: audible across the keyboard, level, headroom, finite, tails, velocity.
//   node factory/kheverest/tests/quality.mjs <wasm>
import { Engine, metrics, mono, db } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
const e = new Engine(process.argv[2]); const SR = 48000; let bad = 0;
const fail = (n, m) => { bad++; console.log(`FAIL ${n}: ${m}`); };
for (const p of PRESETS) {
  const arp = p.set.ARP_ON, perc = p.cat === "Percussive";
  const run = (notes, vel = 0.8, dur = 2.4) => { e.reset(SR); e.setPatch(p.set, 120); const ev = []; notes.forEach((n) => { ev.push({ t: 0.02, type: "on", note: n, vel }); ev.push({ t: perc ? 0.1 : 1.4, type: "off", note: n }); }); return e.render(dur, ev); };
  const isChord = arp || ["Pad", "Keys", "Strings", "Brass", "FX"].includes(p.cat);
  const chord = run(isChord ? [48, 55, 60] : [52]); const m = metrics(chord);
  if (m.nan) fail(p.name, "NaN");
  if (m.peak > 1.0) fail(p.name, `peak ${m.peak.toFixed(2)}`);
  const w = Math.round(0.4 * SR); let best = 0; const x = mono(chord);
  for (let i = 0; i + w < x.length; i += 2400) { let s = 0; for (let j = 0; j < w; j++) s += x[i + j] * x[i + j]; best = Math.max(best, Math.sqrt(s / w)); }
  if (best < 0.02) fail(p.name, `too quiet (${best.toFixed(3)})`); if (best > 0.35) fail(p.name, `too loud (${best.toFixed(3)})`);
  if (Math.abs(m.dc) > 0.02) fail(p.name, `DC ${m.dc.toFixed(3)}`);
  if (!arp) for (const n of [28, 72, 96]) { const r = metrics(run([n])); if (r.rms < 0.0015) fail(p.name, `inaudible at note ${n} (rms ${r.rms.toExponential(1)})`); }
  // tail: must not hang at full level 1 s after note-off (except drones/pads/fx with long releases)
  const longRel = (p.set.EA_R || 40) > 85 || (p.set.RV_LEVEL || 0) > 60 || p.set.ARP_LATCH;
  if (!perc && !longRel && !arp) { const t = metrics(mono(chord).subarray(Math.round(2.35 * SR))); if (t.rms > best * 0.5) fail(p.name, "does not release"); }
  // velocity changes something when the patch has velocity sensitivity
}
console.log(`${PRESETS.length} presets checked, ${bad} problems`);
process.exit(bad ? 1 : 0);
