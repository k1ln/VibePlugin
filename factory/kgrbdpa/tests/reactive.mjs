// =====================================================================
//  reactive.mjs — every one of the controls is proven to be wired: moving it changes the sound.
//  Each control gets a context in which it can act (arp on for the arp controls, a cable for the
//  utility knobs, audio on INSTRUMENT IN, …). node tests/reactive.mjs <wasm>
// =====================================================================
import { Engine, P, rawToActual, WASM } from "./lab.mjs";
import { check, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
const BASE = { O1_WAVE: 1, O2_WAVE: 2, MIX_O1: 0.55, MIX_O2: 0.45, MIX_NZ: 0.1, CUTOFF: 0.62, RESO: 0.35, ENV_AMT: 0.4, ATK: 0.05, DEC: 0.4, SUS: 0.5, REL: 0.3,
  VCA_MODE: 0, REV_MIX: 0.25, MODW: 1, MOD_PITCH: 0.05, MOD_CUT: 0.2, MOD_PW: 0.3, MOD_RATE: 0.35, DRIFT: 0, VOLUME: 0.8, ATT: 0.5, HP_CUT: 0.4, O2_FREQ: 0.1 };
const notes = [on(0.05, 52), off(0.7, 52), on(0.9, 59), off(1.6, 59)];
const legato = [on(0.05, 48), on(0.5, 60), off(0.9, 60), off(1.0, 48), on(1.2, 55), off(1.7, 55)];
const arpEv = [on(0.05, 52), on(0.06, 55), on(0.07, 59), off(1.5, 52), off(1.5, 55), off(1.5, 59)];
const ARP = { ARP_MODE: 0, PLAY: 1, ARP_RATE: 0.5 };
const run = (vals, ev, opt = {}, tempo = 0) => { e.reset(SR); e.setPatch({ ...BASE, ...vals }, tempo); if (opt.tempoEv) ev = [...ev]; return e.render(2.2, ev, opt.input ? { input: opt.input } : {}); };
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
const tone = (i) => { const v = 0.3 * Math.sin(2 * Math.PI * 330 * i / SR); return [v, v]; };

// per-control context: { ctx: base overrides, ev: events, tempo, input, vals: list of values to compare }
const C = {
  PITCHW: { ev: notes }, MODW: { ev: notes }, GLIDE: { ev: legato, ctx: { GL_TYPE: 2 } },
  PLAY: { ctx: { ARP_MODE: 0, ARP_RATE: 0.5 }, ev: arpEv }, HOLD: { ctx: ARP, ev: [on(0.05, 52), off(0.3, 52)] },
  GL_TYPE: { ctx: { GLIDE: 0.6 }, ev: legato }, GL_LEGATO: { ctx: { GLIDE: 0.6 }, ev: [on(0.05, 48), off(0.3, 48), on(0.6, 60), off(1.2, 60)] }, GL_GATED: { ctx: { GLIDE: 0.9 }, ev: [on(0.05, 48), off(0.1, 48), on(0.15, 70), off(1.2, 70)] },
  KB_OCT: {}, KB_TRANS: {}, ARP_RATE: { ctx: ARP, ev: arpEv }, ARP_MODE: { ctx: { PLAY: 1, ARP_RATE: 0.5 }, ev: arpEv }, ARP_DIR: { ctx: ARP, ev: arpEv }, OCT_SEQ: { ctx: ARP, ev: arpEv },
  TAP_BPM: { ctx: ARP, ev: arpEv }, CLK_SRC: { ctx: { ...ARP, ARP_RATE: 0.5 }, ev: arpEv, tempo: 140, special: "host" },
  EXT_MODE: { ctx: { ...ARP, PB_CLK_IN: "LFO", MOD_WAVE: 3, MOD_RATE: 0.4, EXT_PPQN: 3 }, ev: arpEv }, EXT_PPQN: { ctx: { ...ARP, PB_CLK_IN: "LFO", MOD_WAVE: 3, MOD_RATE: 0.4 }, ev: arpEv },
  OUT_PPQN: { ctx: { ...ARP, PB_E_TRIG: "CLK" }, ev: arpEv },
  MOD_RATE: {}, MOD_FINE: {}, MOD_WAVE: {}, MOD_PITCH: {}, MOD_CUT: {}, MOD_PW: {},
  O1_OCT: {}, O1_WAVE: {}, SYNC: { ctx: { O2_FREQ: 0.4 } }, O2_OCT: {}, O2_FREQ: {}, O2_WAVE: {},
  MIX_O1: {}, MIX_O2: {}, MIX_NZ: {}, HP_CUT: { ctx: { PB_HP_IN: "MIX", PB_V_IN: "HP" } }, ATT: { ctx: { PB_F_CUT: "ATT" } },
  CUTOFF: {}, RESO: {}, ENV_AMT: {}, KBD_TRK: {}, ATK: {}, DEC: {}, SUS: {}, REL: {}, VOLUME: {}, VCA_MODE: {}, REV_MIX: {},
  FINE: {}, INST_LVL: { ctx: { MIX_O1: 0, MIX_O2: 0 }, input: tone, ev: notes }, DRIFT: {}, NOTE_PRI: { ev: [on(0.05, 48), on(0.2, 60), on(0.4, 55), off(1.0, 60), off(1.1, 55), off(1.2, 48)] },
  BEND_UP: { ctx: { PITCHW: 0.9 } }, BEND_DN: { ctx: { PITCHW: -0.9 } }, KB_RANGE: { ctx: { PB_O1_PITCH: "KB" } }, LOCAL: {},
};
let n = 0;
for (const p of P) {
  if (p.key.startsWith("PB_")) continue;                   // patch-bay selectors: tests/patchbay.mjs
  const c = C[p.key];
  if (!c) { check(`context for ${p.key}`, false, "missing"); continue; }
  const ev = c.ev || notes;
  const vals = p.direct ? [p.min, (p.min + p.max) / 2, p.max] : (p.steps <= 6 ? Array.from({ length: p.steps }, (_, r) => rawToActual(p, r)) : [rawToActual(p, 0), rawToActual(p, Math.floor(p.steps / 2)), rawToActual(p, p.steps - 1)]);
  const outs = vals.map((v) => run({ ...(c.ctx || {}), [p.key]: v }, ev, { input: c.input }, c.tempo || 0));
  let maxd = 0; for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) maxd = Math.max(maxd, diff(outs[i], outs[j]));
  const adjacentAll = p.steps > 0 && p.steps <= 4 ? outs.every((o, i) => i === 0 || diff(outs[i - 1], o) > 1e-4) : true;
  n++;
  check(`${p.key.padEnd(10)} ${p.name}: moving it changes the sound`, maxd > 1e-4 && adjacentAll, `max Δrms ${maxd.toExponential(2)}${adjacentAll ? "" : "  (some adjacent options identical)"}`);
}
console.log(`${n} controls exercised`);
done("reactive");
