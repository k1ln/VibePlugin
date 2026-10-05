// behavior.mjs — the keyboard / glide / trigger behaviour of the Model D: low-note priority (and HIGH / LAST), the sample-and-hold keeping
// the pitch after release, single vs multiple triggering, glide, scales, vintage key error, keys outside the 44-key range.
// node tests/behavior.mjs <wasm>
import { Engine, NODE, zcFreq, WASM } from "./lab.mjs";
import { SCALE_DEV, PARTCH } from "../scales.mjs";
import { check, near, done } from "./t.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
const BASE = { DRIFT: 0, BLEED: 0, SW_O1: 1, VOL1: 0.6, CUTOFF: 1, EMPH: 0, LSUS: 1, LATK: 0, LDEC: 0.3, FSUS: 1, OUTVOL: 1, O1_RANGE: 3, O1_WAVE: 0, KB1: 0, KB2: 0 };
const run = (vals, ev, secs, node, block = 1) => { e.reset(SR); e.setPatch({ ...BASE, ...vals }); return e.render(secs, ev, { probe: node, block }).probe; };
const semi = (x, a, b) => 12 * Math.log2(zcFreq(x.subarray(Math.round(a * SR), Math.round(b * SR)), SR) / 87.30706);   // above the bottom F
const keyAt = (vals, ev, t0, t1, secs = t1 + 0.1) => semi(run(vals, ev, secs, NODE.O1), t0, t1);

// --- priority
const two = [on(0.05, 60), on(0.3, 50), on(0.55, 70)];
check("LOW priority (original): the lowest held key sounds, whatever is added", near(keyAt({ KEY_PRI: 0 }, two, 0.4, 0.5), 50 - 41, 0.03) && near(keyAt({ KEY_PRI: 0 }, two, 0.7, 0.8), 50 - 41, 0.03));
check("HIGH priority: the highest held key sounds", near(keyAt({ KEY_PRI: 1 }, two, 0.2, 0.28), 60 - 41, 0.03) && near(keyAt({ KEY_PRI: 1 }, two, 0.7, 0.8), 70 - 41, 0.03));
check("LAST priority: the newest key sounds", near(keyAt({ KEY_PRI: 2 }, two, 0.4, 0.5), 50 - 41, 0.03) && near(keyAt({ KEY_PRI: 2 }, two, 0.7, 0.8), 70 - 41, 0.03));
{ const ev = [on(0.05, 60), on(0.2, 50), off(0.4, 50)];
  check("releasing the lowest key hands the pitch back to the held one", near(keyAt({ KEY_PRI: 0 }, ev, 0.15, 0.19, 0.7), 60 - 41, 0.03) && near(keyAt({ KEY_PRI: 0 }, ev, 0.5, 0.6, 0.7), 60 - 41, 0.03)); }
// --- sample and hold
{ const ev = [on(0.05, 55), off(0.3, 55)], x = run({ DECAY_ON: 1, LDEC: 0.55, LATK: 0 }, ev, 1.5, NODE.O1);
  check("S/H: the pitch stays at the last key after release (the release tail does not slide)", near(semi(x, 0.35, 0.6), 55 - 41, 0.03) && near(semi(x, 0.8, 1.0), 55 - 41, 0.03)); }
// --- gate and triggers
{ const gate = (vals, ev, secs) => run(vals, ev, secs, NODE.GATE, 1);
  const g = gate({ TRIG_MODE: 0 }, [on(0.05, 50), on(0.2, 55), off(0.35, 50), off(0.5, 55)], 0.8);
  let drops = 0; for (let i = Math.round(0.1 * SR); i < Math.round(0.45 * SR); i++) if (g[i] === 0 && g[i - 1] === 1) drops++;
  check("SINGLE trigger (original): playing legato does not retrigger — the gate stays high while any key is down", drops === 0);
  const g2 = gate({ TRIG_MODE: 1 }, [on(0.05, 50), on(0.2, 55), off(0.35, 50), off(0.5, 55)], 0.8);
  let d2 = 0; for (let i = Math.round(0.1 * SR); i < Math.round(0.45 * SR); i++) if (g2[i] === 0 && g2[i - 1] === 1) d2++;
  check("MULTI trigger (reissue): every new key retriggers the contours", d2 >= 1, String(d2));
  let t0 = -1, t1 = -1; for (let i = 0; i < g.length; i++) { if (t0 < 0 && g[i] === 1) t0 = i / SR; if (t0 >= 0 && g[i] === 0 && i / SR > 0.4) { t1 = i / SR; break; } }
  check("gate follows the keys: rises ~1.5 ms after the key, falls when the last key is released", near(t0, 0.05, 0.004) && near(t1, 0.5, 0.004), `${t0.toFixed(4)} ${t1.toFixed(4)}`);
  const cl = run({ TRIG_MODE: 0, LATK: 0, LDEC: 0.45, LSUS: 0.3 }, [on(0.05, 50), on(1.0, 55), off(1.4, 50), off(1.8, 55)], 2.0, NODE.CL, 4);
  const a = cl[Math.round(1.05 * SR)], b = cl[Math.round(0.95 * SR)];
  check("legato playing with single trigger leaves the contour alone (it keeps decaying instead of restarting)", a <= b + 0.01, `${b.toFixed(3)} → ${a.toFixed(3)}`);
  const mx = (x) => { let m = 0; for (let i = Math.round(1.0 * SR); i < Math.round(1.3 * SR); i++) m = Math.max(m, x[i]); return m; };
  const cs = run({ TRIG_MODE: 0, LATK: 0.2, LDEC: 0.45, LSUS: 0.3 }, [on(0.05, 50), on(1.0, 55), off(1.4, 50), off(1.8, 55)], 2.0, NODE.CL, 4);
  const cm = run({ TRIG_MODE: 1, LATK: 0.2, LDEC: 0.45, LSUS: 0.3 }, [on(0.05, 50), on(1.0, 55), off(1.4, 50), off(1.8, 55)], 2.0, NODE.CL, 4);
  check("multi trigger restarts the contour on the second key (it rises again to the peak; single does not)", mx(cm) > mx(cs) + 0.05 && mx(cm) >= 1.0, `${mx(cs).toFixed(3)} vs ${mx(cm).toFixed(3)}`); }
// --- glide
{ const k = (g, on_) => run({ GLIDE_ON: on_, GLIDE: g }, [on(0.0, 41), off(0.4, 41), on(0.5, 65), off(3.5, 65)], 4, NODE.KCUR, 4);
  const tauOf = (x) => { for (let i = Math.round(0.55 * SR); i < x.length; i += 4) if (x[i] >= 24 * 0.632) return i / SR - 0.5; return -1; };
  const taper = (v) => (Math.exp(4.39 * v) - 1) / (Math.exp(4.39) - 1);
  for (const g of [0.2, 0.5, 0.8]) { const t = tauOf(k(g, 1)), want = 0.00033 + 2.2 * taper(g); check(`GLIDE ${g * 10}: exponential approach, τ = ${want.toFixed(3)} s`, near(t / want, 1, 0.07) || near(t, want, 0.02), `${t.toFixed(3)} s`); }
  const x = k(1, 1); check("GLIDE 10: slowest setting: τ ≈ 2.2 s (73 % of the interval after 2.9 s; ~10 s to settle)", x[Math.round(3.4 * SR)] > 24 * 0.68 && x[Math.round(3.4 * SR)] < 24 * 0.78, x[Math.round(3.4 * SR)].toFixed(2));
  const y = k(0.8, 0); check("GLIDE switch off: the knob has no effect (instant pitch)", y[Math.round(0.52 * SR)] > 23.9);
  const z = k(0.0, 1); check("GLIDE knob at 0 with the switch on: instantaneous (≈ 0.3 ms)", z[Math.round(0.502 * SR)] > 23.5); }
// --- keys outside the 44 keys, bend isolation
{ const lo = keyAt({}, [on(0.05, 28)], 0.2, 0.4), hi = keyAt({}, [on(0.05, 100)], 0.2, 0.4);
  check("keys below F / above C extend the 1 V/oct scale (a MIDI controller can play beyond the 44 keys)", near(lo, 28 - 41, 0.05) && near(hi, 100 - 41, 0.05), `${lo.toFixed(2)} ${hi.toFixed(2)}`); }
// --- scales
{ const st = (note, sc) => keyAt({ SCALE: sc }, [on(0.05, note)], 0.2, 0.4);
  const eq = st(64, 0), py = st(64, 1), sj = st(64, 2);
  check("Pythagorean (C) scale: E is +7.8 cents sharp of equal temperament (81/64 vs 4 st)", near(py - eq, SCALE_DEV[4], 0.004) && near((py - eq) * 100, 7.82, 0.5), `${((py - eq) * 100).toFixed(2)} ct`);
  check("Super-just scale: E sits at the pure 5/4 (−13.7 cents)", near((sj - eq) * 100, -13.69, 0.6), `${((sj - eq) * 100).toFixed(2)} ct`);
  check("12-note scales are rooted on C: C is unchanged (0 cents)", near(st(60, 1) - st(60, 0), 0, 0.003) && near(st(72, 2) - st(72, 0), 0, 0.003));
  const pa = [41, 42, 43, 60, 83, 84].map((n) => keyAt({ SCALE: 3 }, [on(0.05, n)], 0.2, 0.4));
  check("Partch 43-tone: 43 keys span one octave (key 43 = the octave, ratio 2)", near(pa[0], 0, 0.02) && near(pa[1], PARTCH[1], 0.02) && near(pa[2], PARTCH[2], 0.02) && near(keyAt({ SCALE: 3 }, [on(0.05, 41 + 43)], 0.2, 0.4), 12, 0.03), pa.map((v) => v.toFixed(2)).join(" "));
  const ke = keyAt({ KEY_ERR: 1 }, [on(0.05, 80)], 0.2, 0.4) - keyAt({ KEY_ERR: 0 }, [on(0.05, 80)], 0.2, 0.4);
  check("vintage key error: each key a few cents off (|Δ| ≤ 0.2 st, nonzero away from the bottom F)", Math.abs(ke) > 0.0005 && Math.abs(ke) < 0.2, `${(ke * 100).toFixed(2)} ct`); }
// --- local off / output stays untouched by the keys when local off
{ const g = run({ LOCAL: 0 }, [on(0.05, 50), off(0.5, 50)], 0.8, NODE.GATE, 4); check("LOCAL off: no gate", Math.max(...g) === 0); }
// --- drift & bleed
{ const f = (d) => { const x = run({ DRIFT: d }, [on(0, 57)], 8, NODE.F1, 8); let lo = 1e9, hi = -1e9; for (let i = Math.round(1 * SR / 8); i < x.length; i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); } return 1200 * Math.log2(hi / lo); };
  const d0 = f(0), d1 = f(1); check("DRIFT 0: the oscillators are rock steady; DRIFT 1: a few cents of slow wander", d0 < 0.01 && d1 > 1 && d1 < 40, `${d0.toFixed(3)} / ${d1.toFixed(1)} ct p-p`); }
{ const beat = (bl) => { e.reset(SR); e.setPatch({ ...BASE, BLEED: bl, SW_O2: 1, VOL2: 0.6, O2_WAVE: 2, O1_WAVE: 2, O2_FREQ: 0.004 }); e.render(0.05, [on(0, 57)]); const b = e.render(1.5, [], { probe: NODE.F1, block: 1 }).probe; const x = b.subarray(SR / 2); let lo = 1e9, hi = -1e9; for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  check("BLEED: oscillators 1 and 2 pulled by each other when close", beat(1) !== beat(0)); }
done("behavior");
