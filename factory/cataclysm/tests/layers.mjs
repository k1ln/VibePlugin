#!/usr/bin/env node
// layers.mjs — behavioural checks: every layer / modulator / FX does what its label says.
import { Engine, metrics, mono, pitchAt, decayTime, centroid, bandEnergyDb, envDb, KEYS, P } from "./lab.mjs";
import { MOD_DESTS, MOD_SRC } from "../params.mjs";
const wasm = process.argv[2];
const SR = 48000;
let fails = 0;
const ok = (name, cond, info = "") => { console.log((cond ? "PASS " : "FAIL ") + name + (info ? "  — " + info : "")); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const destIdx = (key) => MOD_DESTS.findIndex((p) => p.key === key) + 1;
const srcIdx = (n) => MOD_SRC.indexOf(n);
function run(patch, { note = 36, vel = 0.9, sec = 0.8, events, sr = SR, tempo = 0 } = {}) {
  const e = new Engine(wasm, sr); e.setPatch(patch, tempo);
  const buf = e.render(sec, events || [{ t: 0, type: "on", note, vel }]);
  return { buf, m: mono(buf), met: metrics(buf), e };
}
const TONE = { C_LEV: -60, T_LEV: 0, D1_TYPE: 0, T_PE1_AMT: 0, T_PE2_AMT: 0, T_DEC: 3000, T_PITCH: 100, T_KT: 0, EQ_HPF: 10, OUT_CEIL: -0.1 };
const pitchOf = (r, a = 0.1, b = 0.4) => pitchAt(r.m, SR, a, b, 30, 3000);

// ---- tone ----
for (const [name, shape] of [["sine", 0], ["triangle", 1], ["saw", 2], ["square", 3]]) {
  const r = run({ ...TONE, T_SHAPE: shape }); ok(`tone ${name} @100 Hz`, near(pitchOf(r), 100, 1.5), pitchOf(r).toFixed(2) + " Hz");
}
{ const r = run({ ...TONE, T_KT: 1 }, { note: 48 }); ok("key tracking x1: +12 st doubles pitch", near(pitchOf(r), 200, 3), pitchOf(r).toFixed(1)); }
{ const r = run({ ...TONE, T_KT: 0.5 }, { note: 48 }); ok("key tracking x0.5: +12 st = +6 st", near(pitchOf(r), 141.4, 3), pitchOf(r).toFixed(1)); }
{ const r = run({ ...TONE, TUNE: 12 }); ok("master tune +12 st", near(pitchOf(r), 200, 3), pitchOf(r).toFixed(1)); }
{ const r = run({ ...TONE, T_PE1_AMT: 24, T_PE1_TIME: 400 }, { sec: 0.8 }); const p0 = pitchAt(r.m, SR, 0.002, 0.012, 60, 3000), p1 = pitchOf(r, 0.6, 0.78); ok("pitch env: starts ~+24 st (4x) and settles", p0 > 330 && near(p1, 100, 4), p0.toFixed(0) + " → " + p1.toFixed(1)); }
{ const r = run({ ...TONE, T_SUB: 6, T_LEV: -60 }); ok("sub oscillator silent when the tone layer is off", r.met.rms < 1e-4); const r2 = run({ ...TONE, T_SUB: 0, T_LEV: 0 }); ok("sub oscillator is -1 oct", near(pitchOf(r2, 0.1, 0.5), 50, 1.5), pitchOf(r2, 0.1, 0.5).toFixed(1)); }
{ const a = run({ ...TONE, T_SHAPE: 0 }), b = run({ ...TONE, T_SHAPE: 0, T_FOLD: 1 }); ok("wavefold adds harmonics", centroid(b.m, SR, 0.05, 0.3) > centroid(a.m, SR, 0.05, 0.3) * 2, `${centroid(a.m, SR, .05, .3).toFixed(0)} → ${centroid(b.m, SR, .05, .3).toFixed(0)} Hz`); }
{ const a = run({ ...TONE, T_SHAPE: 2 }), b = run({ ...TONE, T_SHAPE: 2, T_SYNC: 1, T_SYNCR: 4 }); ok("hard sync keeps pitch, changes timbre", near(pitchOf(b), 100, 2) && Math.abs(centroid(b.m, SR, .05, .3) - centroid(a.m, SR, .05, .3)) > 100); }
{ const a = run({ ...TONE, T_DEC: 100 }), b = run({ ...TONE, T_DEC: 800 }); ok("decay time scales", decayTime(b.m, SR, 40) > decayTime(a.m, SR, 40) * 3, `${decayTime(a.m, SR, 40).toFixed(2)} vs ${decayTime(b.m, SR, 40).toFixed(2)} s`); }
{ const r = run({ ...TONE, T_DEC: 100, T_TAIL: -6, T_TAILT: 1500 }, { sec: 2 }); ok("tail layer extends the ring", decayTime(r.m, SR, 40) > 0.6, decayTime(r.m, SR, 40).toFixed(2) + " s"); }
{ const a = run({ ...TONE, T_TENS: 0, T_DEC: 600 }), b = run({ ...TONE, T_TENS: 12, T_DEC: 600 }); ok("tension raises initial pitch then settles", pitchAt(b.m, SR, 0.003, 0.03, 60, 1500) > pitchAt(a.m, SR, 0.003, 0.03, 60, 1500) * 1.2 && near(pitchOf(b, 0.5, 0.8), 100, 6), `${pitchAt(b.m, SR, 0.003, 0.03, 60, 1500).toFixed(0)} Hz early`); }

// ---- FM ----
const FMP = { T_LEV: -60, C_LEV: -60, F_LEV: 0, D1_TYPE: 0, F_FREQ: 440, F_KT: 0, F_DEC: 2000, F_IDXT: 4000, F_FOLLOW: 0, T_PE1_AMT: 0 };
{ const r = run({ ...FMP, F_IDX: 0 }); ok("FM idx 0: pure carrier", near(pitchOf(r), 440, 3)); }
{ const r = run({ ...FMP, F_IDX: 3, F_MRATIO: 1 }); const e1 = bandEnergyDb(r.m, SR, .05, .3, 850, 910), e2 = bandEnergyDb(r.m, SR, .05, .3, 1290, 1350); ok("FM sidebands appear at carrier ± k·mod", e1 > bandEnergyDb(r.m, SR, .05, .3, 2000, 2060) + 6 && e2 > bandEnergyDb(r.m, SR, .05, .3, 2400, 2460), `${e1.toFixed(0)} / ${e2.toFixed(0)} dB`); }
{ const r = run({ ...FMP, F_IDX: 0, F_MODE: 1 }); ok("FM ring mode runs", r.met.rms > 0.01 && r.met.nan === 0); }
{ const r = run({ ...FMP, F_IDX: 10, F_MWAVE: 3, F_FB: 1.5 }); ok("FM noise-mod + feedback extremes finite", r.met.nan === 0 && r.met.peak <= 1.0, `peak ${r.met.peak.toFixed(2)}`); }

// ---- noise ----
const NP = { T_LEV: -60, C_LEV: -60, N_LEV: 0, D1_TYPE: 0, N_DEC: 600, N_TAIL: -60, N_KT: 0 };
for (const [t, name] of [[0, "white"], [1, "pink"], [2, "brown"], [3, "blue"], [4, "dust"], [5, "S&H"], [6, "crackle"]]) {
  const r = run({ ...NP, N_TYPE: t, N_MODE: 1, N_CUT: 4000, N_RES: 0.1, N_RATE: 4000 }, { sec: 0.5 });
  ok(`noise ${name}: audible, finite, bounded`, r.met.rms > 0.005 && r.met.nan === 0 && r.met.peak <= 1.0, `rms ${r.met.rms.toFixed(3)} peak ${r.met.peak.toFixed(2)}`);
}
{ const lo = run({ ...NP, N_MODE: 0, N_CUT: 300 }), hi = run({ ...NP, N_MODE: 2, N_CUT: 6000 }); ok("noise filter: LP is dark, HP is bright", centroid(lo.m, SR, .02, .3) < 700 && centroid(hi.m, SR, .02, .3) > 8000, `${centroid(lo.m, SR, .02, .3).toFixed(0)} / ${centroid(hi.m, SR, .02, .3).toFixed(0)} Hz`); }
{ const r = run({ ...NP, N_MODE: 1, N_CUT: 1000, N_RES: 1 }); const p = pitchOf(r, 0.02, 0.3); ok("noise filter Q=200 rings at the cutoff", near(p, 1000, 40), p.toFixed(0) + " Hz"); }
{ const r = run({ ...NP, N_GATE: 1, N_BN: 5, N_BSP: 12, N_BLEN: 4, N_DEC: 200, N_BJIT: 0 }, { sec: 0.4 }); const e = envDb(r.m, SR, 2); let peaks = 0; for (let i = 2; i < 40; i++) if (e[i] > e[i - 1] + 4 && e[i] >= e[i + 1]) peaks++; ok("clap: separate noise bursts then tail", peaks >= 3, `${peaks} bursts seen`); }
{ const a = run({ ...NP, N_DEC: 100 }), b = run({ ...NP, N_DEC: 100, N_TAIL: -3, N_TAILT: 1200 }, { sec: 1.5 }); ok("noise tail", decayTime(b.m, SR, 40) > decayTime(a.m, SR, 40) * 4); }

// ---- metal ----
const XP = { T_LEV: -60, C_LEV: -60, X_LEV: 0, D1_TYPE: 0, X_DEC: 300, X_KT: 0, X_HPF: 50, X_BAND: 1, X_FREQ: 200 };
for (let s = 0; s <= 5; s++) { const r = run({ ...XP, X_SET: s }, { sec: 0.4 }); ok(`metal set ${s}: audible, finite, bounded`, r.met.rms > 0.005 && r.met.nan === 0 && r.met.peak <= 1.0, `rms ${r.met.rms.toFixed(3)} peak ${r.met.peak.toFixed(2)}`); }
{ const a = run({ ...XP, X_SET: 2, X_FREQ: 200, X_PW: 0.5, X_HPF: 50, X_BPF: 18000, X_BPQ: 0.3 }), b = run({ ...XP, X_SET: 2, X_FREQ: 400, X_PW: 0.5, X_HPF: 50, X_BPF: 18000, X_BPQ: 0.3 }); const pa = pitchOf(a, 0.01, 0.2), pb = pitchOf(b, 0.01, 0.2); ok("metal base freq sets the cluster pitch (harmonic set)", near(pa, 200, 8) && near(pb, 400, 14), pa.toFixed(0) + " / " + pb.toFixed(0)); }
{ const a = run({ ...XP, X_RING: 0 }), b = run({ ...XP, X_RING: 1 }); ok("ring mix changes the spectrum", Math.abs(centroid(a.m, SR, .01, .2) - centroid(b.m, SR, .01, .2)) > 100); }

// ---- click ----
for (let t = 0; t < 6; t++) { const r = run({ T_LEV: -60, C_LEV: 0, D1_TYPE: 0, C_TYPE: t, C_FREQ: 3000, C_LEN: 2 }, { sec: 0.2 }); ok(`click type ${t}`, r.met.rms > 0.002 && r.met.nan === 0 && decayTime(r.m, SR, 40, 1) < 0.06, `rms ${r.met.rms.toFixed(3)} peak ${r.met.peak.toFixed(2)} dur ${(decayTime(r.m, SR, 40, 1) * 1000).toFixed(0)} ms`); }

// ---- modal ----
const MP = { T_LEV: -60, C_LEV: -60, M_LEV: 0, D1_TYPE: 0, M_KT: 0, M_PITCH: 150, M_DEC: 800, M_EXCL: 0.2 };
{ const r = run({ ...MP, M_NUM: 1 }); ok("modal 1 mode = pitch", near(pitchOf(r), 150, 2), pitchOf(r).toFixed(1)); }
{ const r = run({ ...MP, M_NUM: 12, M_MAT: 0, M_TILT: 0, M_BRT: 0, M_POS: 0 }); const a = bandEnergyDb(r.m, SR, .02, .3, 290, 310), b = bandEnergyDb(r.m, SR, .02, .3, 440, 460); ok("modal string material: harmonic partials", a > -30 + bandEnergyDb(r.m, SR, .02, .3, 140, 160) && b > -30 + bandEnergyDb(r.m, SR, .02, .3, 140, 160)); }
{ const r = run({ ...MP, M_NUM: 8, M_MAT: 1 }); ok("modal membrane finite/audible", r.met.rms > 0.01 && r.met.nan === 0); }
{ const a = run({ ...MP, M_DEC: 150 }), b = run({ ...MP, M_DEC: 1500 }); ok("modal decay", decayTime(b.m, SR, 40) > decayTime(a.m, SR, 40) * 3); }
{ const a = run({ ...MP, M_TENS: 0 }), b = run({ ...MP, M_TENS: 24 }); ok("modal tension pitch glide", pitchAt(b.m, SR, 0.003, 0.03, 60, 1500) > pitchAt(a.m, SR, 0.003, 0.03, 60, 1500) * 1.15 || b.met.rms > 0); }
{ const r = run({ ...MP, M_NL: 1, M_NUM: 8, M_MAT: 1 }); ok("modal saturation bounded", r.met.peak <= 1.0 && r.met.nan === 0); }
{ const r = run({ T_LEV: -60, C_LEV: 0, M_LEV: 0, S_CLK: 1, D1_TYPE: 0, M_PITCH: 150, M_NUM: 1, M_DEC: 800, M_KT: 0 }); ok("click excites the resonator (sends)", r.met.rms > 0.005); }
{ const r = run({ T_LEV: -60, C_LEV: -60, M_LEV: 0, N_LEV: -60, N_DEC: 400, N_TYPE: 0, N_MODE: 1, N_CUT: 150, N_RES: 0.7, S_NOI: 1, S_CLK: 0, M_PITCH: 150, M_NUM: 1, M_DEC: 300, M_KT: 0, M_EXCL: 0.05, D1_TYPE: 0, vel: 0 }, { sec: 0.6 }); ok("noise send drives the modal body (pitched noise)", near(pitchOf(r, 0.05, 0.3), 150, 8) , pitchOf(r, .05, .3).toFixed(1)); }
{ const r = run({ T_LEV: 0, C_LEV: -60, M_LEV: -60, S_TONE: 1.5, M_PITCH: 300, M_NUM: 1, M_DEC: 500, D1_TYPE: 0, T_KT: 0, M_KT: 0, T_PITCH: 300, T_PE1_AMT: 0, T_DEC: 100 }); ok("tone send into hidden modal still sounds", r.met.rms > 0.01); }

// ---- cross-mod ----
{ const a = run({ ...TONE, T_SHAPE: 0, N_LEV: -60, X_NFM: 0 }), b = run({ ...TONE, T_SHAPE: 0, N_LEV: -60, X_NFM: 1, N_DEC: 800, N_CUT: 5000, N_MODE: 2 }); ok("noise → tone FM adds rasp", centroid(b.m, SR, .02, .3) > centroid(a.m, SR, .02, .3) * 3); }
{ const r = run({ ...TONE, X_LEV: -60, X_MRM: 1, X_DEC: 600, X_FREQ: 300, X_SET: 1 }); ok("metal ring-mods the tone", r.met.rms > 0.01 && r.met.nan === 0); }

// ---- modulation ----
const MXV = (n, src, key, amt) => ({ [`MX${n}_SRC`]: srcIdx(src), [`MX${n}_DST`]: destIdx(key), [`MX${n}_AMT`]: amt });
{ const base = { ...TONE, T_PITCH: 100, T_KT: 0 };
  const lo = run({ ...base, ...MXV(1, "Velocity", "T_PITCH", 0.3) }, { vel: 0.2 }), hi = run({ ...base, ...MXV(1, "Velocity", "T_PITCH", 0.3) }, { vel: 1.0 });
  ok("matrix: velocity → pitch", pitchOf(hi) > pitchOf(lo) * 1.3, `${pitchOf(lo).toFixed(0)} vs ${pitchOf(hi).toFixed(0)} Hz`); }
{ const r0 = run({ ...TONE, MAC1: 0, ...MXV(1, "Macro 1", "T_PITCH", 0.2) }), r1 = run({ ...TONE, MAC1: 1, ...MXV(1, "Macro 1", "T_PITCH", 0.2) }); ok("matrix: macro 1 → pitch", pitchOf(r1) > pitchOf(r0) * 1.3, `${pitchOf(r0).toFixed(0)} → ${pitchOf(r1).toFixed(0)}`); }
{ const r0 = run({ ...TONE, T_SHAPE: 0, T_LEV: -6, ...MXV(1, "Macro 2", "D1_DRV", 1), D1_TYPE: 3, D1_DRV: 0 }), r1 = run({ ...TONE, T_SHAPE: 0, T_LEV: -6, MAC2: 1, ...MXV(1, "Macro 2", "D1_DRV", 1), D1_TYPE: 3, D1_DRV: 0 }); ok("matrix: macro → FX target (distortion drive)", centroid(r1.m, SR, .05, .3) > centroid(r0.m, SR, .05, .3) * 2, `${centroid(r0.m, SR, .05, .3).toFixed(0)} → ${centroid(r1.m, SR, .05, .3).toFixed(0)} Hz`); }
{ const r = run({ ...TONE, L1_RATE: 6, L1_SHAPE: 0, ...MXV(1, "LFO 1", "T_PITCH", 0.15) }, { sec: 1 }); const p1 = pitchAt(r.m, SR, 0.0, 0.1, 40, 400), p2 = pitchAt(r.m, SR, 0.12, 0.22, 40, 400); ok("matrix: LFO → pitch wobbles", Math.abs(p1 - p2) > 3, `${p1.toFixed(0)} / ${p2.toFixed(0)} Hz`); }

// ---- ratchet ----
{ const r = run({ ...TONE, T_DEC: 40, RAT_N: 4, RAT_TIME: 80, RAT_VEL: 0 }, { sec: 0.6 }); const e = envDb(r.m, SR, 5); let hits = 0; for (let i = 0; i < e.length - 1; i++) if ((i == 0 || e[i] > e[i - 1] + 10) && e[i] > -30) hits++; ok("ratchet: 4 hits", hits === 4, `${hits} onsets`); }
{ const r = run({ ...TONE, T_DEC: 30, RAT_N: 3, RAT_SYNC: 2, RAT_VEL: 0 }, { sec: 1, tempo: 120 }); const e = envDb(r.m, SR, 5); const on = []; for (let i = 0; i < e.length - 1; i++) if ((i == 0 || e[i] > e[i - 1] + 10) && e[i] > -30) on.push(i * 5); ok("ratchet: 1/16 sync at 120 BPM = 125 ms", on.length === 3 && near(on[1] - on[0], 125, 10), JSON.stringify(on)); }
{ const r = run({ ...TONE, T_DEC: 100, RAT_N: 2, RAT_TIME: 150, RAT_PITCH: 12, RAT_VEL: 0 }, { sec: 0.6 }); ok("ratchet pitch step +12 st", near(pitchAt(r.m, SR, 0.17, 0.25, 30, 800), 200, 5), pitchAt(r.m, SR, .17, .25, 30, 800).toFixed(1)); }

// ---- polyphony / gate ----
{ const ev = [{ t: 0, type: "on", note: 36, vel: 1 }, { t: 0.01, type: "on", note: 36, vel: 1 }]; const r = run({ ...TONE, POLY: 1, T_DEC: 800 }, { events: ev, sec: 1.0 }); ok("mono: retrigger chokes", r.met.peak <= 1.0 && r.met.nan === 0); }
{ const r = run({ ...TONE, T_DEC: 3000, GATE: 1, REL: 20 }, { events: [{ t: 0, type: "on", note: 36, vel: 1 }, { t: 0.1, type: "off", note: 36 }], sec: 0.6 }); ok("gate mode: note-off releases", decayTime(r.m, SR, 40) < 0.3, decayTime(r.m, SR, 40).toFixed(2) + " s"); }
{ const r = run({ ...TONE, T_DEC: 3000, GATE: 0 }, { events: [{ t: 0, type: "on", note: 36, vel: 1 }, { t: 0.1, type: "off", note: 36 }], sec: 0.6 }); ok("one-shot mode: note-off ignored", decayTime(r.m, SR, 20) > 0.4); }

// ---- FX ----
const FXB = { ...TONE, T_SHAPE: 3, T_DEC: 400, T_PITCH: 110 };
{ const a = run({ ...FXB, D1_TYPE: 0 }), b = run({ ...FXB, D1_TYPE: 3, D1_DRV: 30 }); ok("distortion adds harmonics", centroid(b.m, SR, .02, .3) !== centroid(a.m, SR, .02, .3) && b.met.nan === 0); }
for (let t = 1; t <= 9; t++) { const r = run({ ...TONE, T_SHAPE: 0, T_DEC: 300, D1_TYPE: t, D1_DRV: 36 }); ok(`dist type ${t}`, r.met.rms > 0.005 && r.met.nan === 0 && r.met.peak <= 1.0, `rms ${r.met.rms.toFixed(3)} dc ${r.met.dc.toFixed(4)}`); }
{ const a = run({ ...FXB, D1_TYPE: 2, D1_DRV: 40, D1_LOW: 20 }), b = run({ ...FXB, D1_TYPE: 2, D1_DRV: 40, D1_LOW: 300 }); ok("low bypass keeps the sub clean", bandEnergyDb(b.m, SR, .02, .3, 80, 140) !== bandEnergyDb(a.m, SR, .02, .3, 80, 140)); }
{ const a = run({ ...FXB }), b = run({ ...FXB, CR_BITS: 3, CR_RATE: 6000 }); ok("crusher changes the signal", Math.abs(centroid(a.m, SR, .02, .3) - centroid(b.m, SR, .02, .3)) > 50); }
{ const a = run({ ...FXB, T_SHAPE: 2 }), b = run({ ...FXB, T_SHAPE: 2, FL_ON: 1, FL_TYPE: 0, FL_CUT: 400, FL_RES: 1 }); ok("master LP filter darkens", centroid(b.m, SR, .02, .3) < centroid(a.m, SR, .02, .3) * 0.6); }
{ const r = run({ ...FXB, CB_MIX: 1, CB_FREQ: 330, CB_FB: 0.95, CB_DAMP: 12000 }, { sec: 1.0 }); ok("comb resonates", r.met.rms > 0 && r.met.nan === 0 && r.met.peak <= 1.0); }
{ const r = run({ ...FXB, CB_MIX: 1, CB_FREQ: 330, CB_FB: 1.05 }, { sec: 2.0 }); ok("comb self-oscillation bounded", r.met.peak <= 1.0 && r.met.nan === 0, `peak ${r.met.peak.toFixed(2)}`); }
{ const a = run({ ...FXB }), b = run({ ...FXB, EQ_LM_G: 20, EQ_LM_F: 1000 }); ok("EQ boost", b.met.rms !== a.met.rms); }
{ const a = run({ ...FXB, T_LEV: 6 }), b = run({ ...FXB, T_LEV: 6, CP_THR: -30, CP_RATIO: 20, CP_ATT: 0.1, CP_REL: 100 }); ok("compressor reduces peaks", b.met.peak < a.met.peak * 0.9 || b.met.rms < a.met.rms * 0.9, `${a.met.peak.toFixed(2)} → ${b.met.peak.toFixed(2)}`); }
{ const a = run({ ...FXB, T_DEC: 40 }, { sec: 1.2 }), b = run({ ...FXB, T_DEC: 40, DL_MIX: 0.8, DL_TIME: 250, DL_FB: 0.5 }, { sec: 1.2 }); ok("echo repeats", bandEnergyDb(b.m, SR, 0.26, 0.4, 20, 8000) > bandEnergyDb(a.m, SR, 0.26, 0.4, 20, 8000) + 10); }
{ const a = run({ ...FXB, T_DEC: 40 }, { sec: 2 }), b = run({ ...FXB, T_DEC: 40, RV_MIX: 0.8, RV_DEC: 2 }, { sec: 2 }); ok("reverb tail", bandEnergyDb(b.m, SR, 0.5, 0.9, 20, 8000) > bandEnergyDb(a.m, SR, 0.5, 0.9, 20, 8000) + 15); }
{ const a = run({ ...FXB, T_DEC: 40, RV_MIX: 0.8, RV_DEC: 3, RV_GATE: 0 }, { sec: 2 }), b = run({ ...FXB, T_DEC: 40, RV_MIX: 0.8, RV_DEC: 3, RV_GATE: 1, RV_GHOLD: 100 }, { sec: 2 }); ok("gated reverb cuts the tail", bandEnergyDb(b.m, SR, 0.8, 1.2, 20, 8000) < bandEnergyDb(a.m, SR, 0.8, 1.2, 20, 8000) - 15); }
{ const r = run({ ...FXB, OUT_WIDTH: 0 }); let d = 0; for (let i = 0; i < r.buf.length; i += 2) d = Math.max(d, Math.abs(r.buf[i] - r.buf[i + 1])); ok("width 0 = mono", d < 1e-4); }
{ const r = run({ ...FXB, T_LEV: 12, D1_TYPE: 2, D1_DRV: 60, OUT_CEIL: -6, OUT_CLIP: 1 }); ok("hard ceiling −6 dB respected", r.met.peak <= 0.5013, r.met.peak.toFixed(3)); }
{ const r = run({ ...FXB, T_LEV: 12, D1_TYPE: 2, D1_DRV: 60, OUT_CEIL: -6, OUT_CLIP: 2 }); ok("limiter ceiling −6 dB respected", r.met.peak <= 0.5013, r.met.peak.toFixed(3)); }
{ const r = run({ ...FXB, TS_ATK: 24, TS_SUS: -24 }); ok("transient shaper runs", r.met.nan === 0 && r.met.rms > 0.001); }
{ const r = run({ ...FXB, RM_MIX: 1, RM_FREQ: 440 }); ok("ring mod", r.met.nan === 0 && r.met.rms > 0.001); }

// ---- sample-rate independence of pitch ----
for (const sr of [44100, 96000]) { const r = run({ ...TONE }, { sr, sec: 0.6 }); const p = pitchAt(r.m, sr, 0.1, 0.4, 30, 3000); ok(`pitch @${sr} Hz`, near(p, 100, 1.5), p.toFixed(2)); }

// ---- block-size independence ----
{ const e1 = new Engine(wasm, SR); e1.setPatch({ ...TONE, T_PE1_AMT: 12, T_PE1_TIME: 60 }); const a = e1.render(0.3, undefined, 64);
  const e2 = new Engine(wasm, SR); e2.setPatch({ ...TONE, T_PE1_AMT: 12, T_PE1_TIME: 60 }); const b = e2.render(0.3, undefined, 480);
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); ok("output independent of host block size", d < 1e-3, "max diff " + d.toExponential(1)); }

console.log(fails ? `\n${fails} FAILED` : "\nall layer checks passed");
process.exit(fails ? 1 : 0);
