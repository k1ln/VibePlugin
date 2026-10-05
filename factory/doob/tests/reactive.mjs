// =====================================================================
//  reactive.mjs — every control is proven to be wired: moving it changes the sound. Each control gets a context in which it can act
//  (a mod source for the modulation switches, audio on the external input, …). node tests/reactive.mjs <wasm>
// =====================================================================
import { Engine, P, rawToActual, WASM } from "./lab.mjs";
import { check, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
const BASE = { SW_O1: 1, SW_O2: 1, VOL1: 0.5, VOL2: 0.4, O1_WAVE: 2, O2_WAVE: 1, O2_FREQ: 0.05, CUTOFF: 0.55, EMPH: 0.35, CONTOUR: 0.4, FATK: 0.05, FDEC: 0.4, FSUS: 0.4,
  LATK: 0.05, LDEC: 0.4, LSUS: 0.6, OUTVOL: 0.8, MODW: 1, DRIFT: 0, BLEED: 0, MODMIX: 0.2, KB1: 1, O3_RANGE: 0, O3_WAVE: 0, O3_FREQ: 0.3, VOL3: 0, SW_O3: 0 };
const notes = [on(0.05, 52), off(0.7, 52), on(0.9, 59), off(1.6, 59)];
const legato = [on(0.05, 48), off(0.5, 48), on(0.6, 60), off(1.2, 60), on(1.3, 55), off(1.8, 55)];
const two = [on(0.05, 60), on(0.2, 50), on(0.4, 70), off(1.0, 50), off(1.1, 60), off(1.2, 70)];
const run = (vals, ev, input) => { e.reset(SR); e.setPatch({ ...BASE, ...vals }); return e.render(2.2, ev, input ? { input } : {}); };
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
const tone = (i) => { const v = 0.3 * Math.sin(2 * Math.PI * 330 * i / SR); return [v, v]; };
const MOD = { O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 0, O3_FREQ: 0.3, MODW: 1, MODMIX: 0 };

const C = {
  TUNE: {}, GLIDE: { ctx: { GLIDE_ON: 1 }, ev: legato }, MODMIX: { ctx: { ...MOD, OSC_MOD: 1, MOD_B: 0 } },
  OSC_MOD: { ctx: MOD }, FIL_MOD: { ctx: MOD }, O3_CTRL: { ctx: { SW_O3: 1, VOL3: 0.4, O3_RANGE: 3 } },
  O1_RANGE: {}, O1_WAVE: {}, O2_RANGE: {}, O2_FREQ: {}, O2_WAVE: {}, O3_RANGE: { ctx: { SW_O3: 1, VOL3: 0.5 } }, O3_FREQ: { ctx: { SW_O3: 1, VOL3: 0.5, O3_RANGE: 3 } }, O3_WAVE: { ctx: { SW_O3: 1, VOL3: 0.5, O3_RANGE: 3 } },
  SW_O1: {}, VOL1: {}, SW_O2: {}, VOL2: {}, SW_O3: { ctx: { VOL3: 0.5, O3_RANGE: 3 } }, VOL3: { ctx: { SW_O3: 1, O3_RANGE: 3 } },
  SW_EXT: { ctx: { VOLEXT: 0.6 }, input: tone }, VOLEXT: { ctx: { SW_EXT: 1 }, input: tone },
  SW_NZ: { ctx: { VOLNZ: 0.5 } }, VOLNZ: { ctx: { SW_NZ: 1 } }, NZ_COLOR: { ctx: { SW_NZ: 1, VOLNZ: 0.5 } },
  CUTOFF: {}, EMPH: {}, CONTOUR: {}, FATK: {}, FDEC: {}, FSUS: {}, KB1: {}, KB2: {},
  LATK: {}, LDEC: {}, LSUS: {}, OUTVOL: {}, MAIN_ON: {}, A440: {},
  PITCHW: {}, MODW: { ctx: { ...MOD, OSC_MOD: 1 } }, GLIDE_ON: { ctx: { GLIDE: 0.7 }, ev: legato }, DECAY_ON: { ctx: { LDEC: 0.55 } },
  STRIG: { ev: [] }, FEEDBACK: { ctx: { SW_EXT: 1, VOLEXT: 0.5 } }, DRIFT: {}, BLEED: {},
  KEY_PRI: { ev: two }, TRIG_MODE: { ctx: { LATK: 0.3, LSUS: 0.3 }, ev: [on(0.05, 50), on(0.6, 55), off(1.2, 50), off(1.4, 55)] },
  BEND: { ctx: { PITCHW: 0.9 } }, SCALE: { ev: [on(0.05, 64), off(0.7, 64), on(0.9, 66), off(1.6, 66)] }, KEY_ERR: {},
  MOD_A: { ctx: { ...MOD, FIL_MOD: 1, FATK: 0.4, FSUS: 1, STRIG: 1 } }, MOD_B: { ctx: { ...MOD, MODMIX: 1, OSC_MOD: 1, LFO_RATE: 0.6 } },
  LFO_RATE: { ctx: { ...MOD, MODMIX: 1, MOD_B: 1, OSC_MOD: 1 } }, LFO_WAVE: { ctx: { ...MOD, MODMIX: 1, MOD_B: 1, OSC_MOD: 1, LFO_RATE: 0.5 } },
  LOCAL: {},
};
let n = 0;
for (const p of P) {
  const c = C[p.key];
  if (!c) { check(`context for ${p.key}`, false, "missing"); continue; }
  const ev = c.ev || notes;
  const vals = p.direct ? [p.min, (p.min + p.max) / 2, p.max] : (p.steps <= 6 ? Array.from({ length: p.steps }, (_, r) => rawToActual(p, r)) : [rawToActual(p, 0), rawToActual(p, Math.floor(p.steps / 2)), rawToActual(p, p.steps - 1)]);
  const outs = vals.map((v) => run({ ...(c.ctx || {}), [p.key]: v }, ev, c.input));
  let maxd = 0; for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) maxd = Math.max(maxd, diff(outs[i], outs[j]));
  const adjacentAll = p.steps > 0 && p.steps <= 4 ? outs.every((o, i) => i === 0 || diff(outs[i - 1], o) > 1e-4) : true;
  n++;
  check(`${p.key.padEnd(10)} ${p.name}: moving it changes the sound`, maxd > 1e-4 && adjacentAll, `max Δrms ${maxd.toExponential(2)}${adjacentAll ? "" : "  (some adjacent options identical)"}`);
}
console.log(`${n} controls exercised`);
done("reactive");
