#!/usr/bin/env node
// reactive.mjs — every one of the controls must change the sound when moved from
// its minimum to its maximum, inside a patch where it is meant to matter.
//   node reactive.mjs <wasm> [--verbose]
import { Engine, mono, metrics, P, rawToActual } from "./lab.mjs";
import { MOD_DESTS, MOD_SRC } from "../params.mjs";
const wasm = process.argv[2], verbose = process.argv.includes("--verbose"), SR = 48000;
const dst = (k) => MOD_DESTS.findIndex((p) => p.key === k) + 1, src = (n) => MOD_SRC.indexOf(n);
const mx = (i, s, d, a) => ({ [`MX${i}_SRC`]: src(s), [`MX${i}_DST`]: dst(d), [`MX${i}_AMT`]: a });

// a patch that engages every layer and every effect at moderate settings
const BASE = {
  T_LEV: -8, T_SHAPE: 2, T_PW: 0.3, T_PITCH: 90, T_KT: 1, T_PE1_AMT: 18, T_PE1_TIME: 60, T_PE2_AMT: 4, T_PE2_TIME: 300, T_DEC: 500, T_SUB: -12, T_FOLD: 0.1,
  F_LEV: -10, F_FREQ: 200, F_IDX: 3, F_DEC: 300, F_MRATIO: 1.4,
  M_LEV: -8, M_PITCH: 150, M_MAT: 1.5, M_NUM: 8, M_DEC: 500, S_CLK: 0.6, S_NOI: 0.4, S_TONE: 0.3, S_MET: 0.3, S_FM: 0.3, M_EXCN: 0.4,
  N_LEV: -8, N_TYPE: 0, N_MODE: 1, N_CUT: 3000, N_RES: 0.4, N_DEC: 300, N_KT: 0.5,
  X_LEV: -10, X_SET: 1, X_FREQ: 250, X_DEC: 300, X_BPF: 7000, X_HPF: 3000, X_RING: 0.2, X_FOLD: 0.1,
  C_LEV: -8, C_TYPE: 4, C_FREQ: 3000, C_LEN: 3, X_NFM: 0.2, X_MRM: 0.2, X_TFC: 0.5, X_TFM: 0.2,
  D1_TYPE: 1, D1_DRV: 12, D1_LOW: 90, D2_TYPE: 3, D2_DRV: 6, D2_MIX: 0.6, CR_BITS: 10, CR_RATE: 20000, CR_JIT: 0.1, CR_MIX: 0.5,
  FL_ON: 1, FL_CUT: 3000, FL_RES: 2, FL_ENV: 1, FL_ENVT: 200, CB_MIX: 0.4, CB_FREQ: 180, CB_FB: 0.8, CB_STEREO: 10, RM_MIX: 0.2,
  EQ_HPF: 40, EQ_LS_G: 5, EQ_LM_G: -5, EQ_HM_G: 5, EQ_HS_G: -5, CP_THR: -24, CP_RATIO: 4, CP_MAKE: 3, CP_MIX: 0.8,
  DL_MIX: 0.3, DL_TIME: 90, DL_FB: 0.5, RV_MIX: 0.3, RV_DEC: 1, OUT_WIDTH: 1.5, OUT_HAAS: 3, OUT_DRIVE: 3, OUT_CEIL: -0.1, OUT_CLIP: 0,
  RAT_N: 3, RAT_TIME: 80, RAT_VEL: -0.1, RAT_PITCH: 2, VEL_AMP: 0.5, VEL_PITCH: 3, VEL_DEC: 0.3, VEL_BRT: 0.3, HUMAN: 0.2,
  TS_ATK: 6, TS_SUS: -3, MAC1: 0.7, MAC2: 0.7, MAC3: 0.7, MAC4: 0.7, L1_RATE: 5, L2_RATE: 3, L1_RETRIG: 1, L2_RETRIG: 1,
  ...mx(1, "Velocity", "T_PITCH", 0.2), ...mx(2, "LFO 1", "N_CUT", 0.4), ...mx(3, "LFO 2", "M_POS", 0.5), ...mx(4, "Env A", "X_BPF", 0.4),
  ...mx(5, "Env B", "F_IDX", 0.5), ...mx(6, "Macro 1", "D1_DRV", 0.5), ...mx(7, "Macro 2", "CB_MIX", 0.5), ...mx(8, "Macro 3", "RV_MIX", 0.5),
};
// per-parameter context tweaks: [regex, overrides | fn(base)->overrides, events?]
const bendEv = [{ t: 0, type: "cc", num: 128, val: 0.8 }, { t: 0, type: "cc", num: 1, val: 0.6 }, { t: 0, type: "cc", num: 129, val: 0.7 }, { t: 0.001, type: "on", note: 40, vel: 0.7 }];
const CTX = [
  [/^T_PW$/, { T_SHAPE: 3 }], [/^T_SYNCR$/, { T_SYNC: 1 }], [/^T_SUBOCT$/, { T_SUB: 0 }], [/^T_PE1_CRV$/, {}], [/^T_TAILT$/, { T_TAIL: -3 }],
  [/^[TNX]_TAILT?$/, { T_TAIL: -3, N_TAIL: -3, X_TAIL: -3 }], [/^N_B(N|SP|JIT|LEN|SLOPE)$/, { N_GATE: 1 }], [/^N_RAT$/, { N_GATE: 2 }],
  [/^N_RATE$/, { N_TYPE: 5 }], [/^F_MRATIO|F_DET|F_MWAVE|F_IDXC$/, { F_IDX: 8 }],
  [/^M_SPREAD$/, {}], [/^M_NL$/, {}], [/^M_FOLLOW$/, {}],
  [/^D2_/, { D2_TYPE: 2, D2_MIX: 1 }], [/^D1_LOW$/, { D1_TYPE: 2, D1_DRV: 36 }], [/^D2_LOW$/, { D2_TYPE: 2, D2_DRV: 36, D2_MIX: 1 }], [/^D1_BIAS$/, { D1_TYPE: 5 }],
  [/^DS_OS$/, { D1_TYPE: 2, D1_DRV: 48, T_SHAPE: 0, T_PITCH: 2900 }],
  [/^CR_/, { CR_MIX: 1, CR_BITS: 6, CR_RATE: 9000, CR_JIT: 0.3 }], [/^CR_RATE$/, { CR_BITS: 6, CR_MIX: 1 }], [/^CR_BITS$/, { CR_MIX: 1, CR_RATE: 9000 }],
  [/^FL_/, { FL_ON: 1 }], [/^CB_/, { CB_MIX: 0.8, CB_FB: 0.85 }], [/^RM_/, { RM_MIX: 0.6 }],
  [/^EQ_LS_F|EQ_LM_F|EQ_LM_Q|EQ_HM_F|EQ_HM_Q|EQ_HS_F$/, { EQ_LS_G: 12, EQ_LM_G: 12, EQ_HM_G: 12, EQ_HS_G: 12 }],
  [/^CP_(ATT|REL|KNEE|HPF|MIX|MAKE)$/, { CP_THR: -40, CP_RATIO: 20 }],
  [/^DL_(TIME|SYNC|FB|DAMP|PING)$/, { DL_MIX: 0.6 }], [/^RV_(SIZE|DEC|DAMP|PRE|GATE|GHOLD|GREL)$/, { RV_MIX: 0.6 }], [/^RV_GHOLD|RV_GREL$/, { RV_GATE: 1, RV_MIX: 1, RV_DEC: 3, T_DEC: 40, F_DEC: 40, M_DEC: 40, N_DEC: 40, X_DEC: 40, T_TAIL: -60, DL_MIX: 0 }],
  [/^OUT_(PAN|CLIP|CEIL|DRIVE)$/, { OUT_DRIVE: 12, OUT_CEIL: -6 }],
  [/^BEND$/, {}, bendEv], [/^ROOT$/, {}], [/^POLY$/, { T_DEC: 800 }, [{ t: 0, type: "on", note: 36, vel: 0.9 }, { t: 0.02, type: "on", note: 38, vel: 0.9 }, { t: 0.04, type: "on", note: 40, vel: 0.9 }]],
  [/^(GATE|REL)$/, { GATE: 1, T_DEC: 3000, M_DEC: 3000 }, [{ t: 0, type: "on", note: 36, vel: 0.9 }, { t: 0.1, type: "off", note: 36 }]],
  [/^RAT_/, { RAT_N: 5 }], [/^L1_/, {}], [/^MAC/, {}],
  [/_KT$/, {}, [{ t: 0, type: "on", note: 48, vel: 0.8 }]],
  [/^N_FE_TIME$/, { N_FE_AMT: 4 }], [/^X_FE_TIME$/, { X_FE_AMT: 3 }], [/^X_PE_TIME$/, { X_PE_AMT: 24 }], [/^N_FE_AMT$/, {}],
  [/^CP_KNEE$/, { CP_THR: -14, CP_RATIO: 10 }],
  [/^MX(\d)_(SRC|DST|AMT)$/, (m) => ({ ...mx(+m[1], "Velocity", "T_PITCH", 0.8) }), null],
];
const MXR = /^MX(\d)_(SRC|DST|AMT)$/;
function ctxFor(p) {
  let patch = {}, events = null;
  for (const [re, ov, ev] of CTX) { const m = p.key.match(re); if (m) { patch = { ...patch, ...(typeof ov === "function" ? ov(m) : ov) }; if (ev) events = ev; } }
  return { patch, events };
}
const evDefault = [{ t: 0, type: "on", note: 36, vel: 0.8 }];
function render(patch, events) { const e = new Engine(wasm, SR); e.setPatch(patch, 120); return mono(e.render(1.4, events || evDefault, 256)); }
function diff(a, b) { let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; s += a[i] * a[i] + b[i] * b[i]; } return Math.sqrt(d / (s / 2 + 1e-12)); }

let inert = [];
for (const p of P) {
  const { patch, events } = ctxFor(p);
  const base = { ...BASE, ...patch };
  // matrix cells: vary only the cell under test around a live routing
  let lo, hi;
  if (MXR.test(p.key)) {
    const i = +p.key.match(MXR)[1], live = mx(i, "Velocity", "N_CUT", 0.5), part = p.key.endsWith("SRC") ? "SRC" : p.key.endsWith("DST") ? "DST" : "AMT";
    const b2 = { ...BASE, ...live, N_LEV: -6, N_RES: 0.2 };
    const v = (raw) => rawToActual(p, raw);
    lo = { ...b2, [p.key]: part === "SRC" ? 0 : part === "DST" ? 0 : -1 }; hi = { ...b2, [p.key]: part === "SRC" ? src("Macro 4") : part === "DST" ? dst("N_CUT") : 1 };
    if (part === "SRC") { b2.MAC4 = 0.05; hi = { ...b2, [p.key]: src("Velocity") }; lo = { ...b2, [p.key]: src("Macro 4") }; } // velocity 0.8 vs macro 0.05
  } else {
    lo = { ...base, [p.key]: p.direct ? p.min : rawToActual(p, 0) }; hi = { ...base, [p.key]: p.direct ? p.max : rawToActual(p, p.steps - 1) };
    if (p.key === "MAC1" || p.key === "MAC2" || p.key === "MAC3") { lo[p.key] = 0; hi[p.key] = 1; }
    if (p.key === "MAC4") { const b = { ...BASE, ...mx(8, "Macro 4", "N_CUT", 0.8), ...patch }; lo = { ...b, MAC4: 0 }; hi = { ...b, MAC4: 1 }; }
  }
  const a = render(lo, events), b = render(hi, events);
  const d = diff(a, b);
  const ok = d > 0.004;
  if (!ok) inert.push(p.key);
  if (verbose || !ok) console.log(`${ok ? "ok   " : "INERT"} ${p.key.padEnd(12)} ${p.name.padEnd(18)} rel Δ ${d.toFixed(4)}`);
}
console.log(`\n${P.length - inert.length}/${P.length} controls audibly reactive` + (inert.length ? `; inert: ${inert.join(", ")}` : ""));
process.exit(inert.length ? 1 : 0);
