// =====================================================================
//  reactive.mjs — proof that EVERY control is wired: for each parameter a context is
//  built in which it must matter, the value is changed and the rendered audio has to
//  change. Controls that are stored-but-sound-neutral by design are listed in UI_ONLY.
//     node factory/kheverest/tests/reactive.mjs <wasm> [filter]
// =====================================================================
import { Engine, P, KEYS, rawToActual, mono } from "./lab.mjs";
const wasm = process.argv[2], only = process.argv[3];
const e = new Engine(wasm);
const SR = 48000;
// controls that only select which knob the panel edits (exactly like the hardware's Source buttons) / display state
const UI_ONLY = new Set(["O1_SRC", "O2_SRC", "O3_SRC", "F_ENVSEL", "ENV_SEL", "RV_TYPE"]);
const SRC = ["Direct", "ModWheel", "AftTouch", "ExprPED1", "BrthPED2", "Velocity", "Keyboard", "Lfo1+", "Lfo1+/-", "Lfo2+", "Lfo2+/-", "AmpEnv", "ModEnv1", "ModEnv2", "Animate1", "Animate2", "CV +/-", "Lfo3+", "Lfo3+/-", "Lfo4+", "Lfo4+/-", "BndWhl+", "BndWhl-"];
const DST = ["0123Ptch", "Osc1Ptch", "Osc2Ptch", "Osc3Ptch", "Osc1VSnc", "Osc2VSnc", "Osc3VSnc", "Osc1Shpe", "Osc2Shpe", "Osc3Shpe", "Osc1 Lev", "Osc2 Lev", "Osc3 Lev", "NoiseLev", "Ring Lev", "VcaLevel", "Filt Drv", "FiltDist", "FiltFreq", "Filt Res"];
const on = (note, t = 0, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (note, t) => ({ t, type: "off", note });
const cc = (num, val, t = 0) => ({ t, type: "cc", num, val });
const mm = (n, a, b, d, depth) => ({ [`MM${n}_A`]: SRC.indexOf(a), [`MM${n}_B`]: SRC.indexOf(b), [`MM${n}_DEST`]: DST.indexOf(d), [`MM${n}_DEPTH`]: depth });
const NOTE = [on(48), off(48, 0.9)];

// context: returns {patch, events, dur, tempo}
function ctx(k) {
  let m;
  const C = (patch = {}, events = NOTE, dur = 1.3, tempo = 0) => ({ patch, events, dur, tempo });
  const mod1 = { F_FREQ: 120, F_ENVMOD: 50, EM1_S: 90 }, mod2 = { O1_ENV2: 40, EM2_S: 90 };
  if ((m = /^O([123])_(\w+)$/.exec(k))) {
    const n = +m[1], f = m[2], mix = { MIX1: 0, MIX2: 0, MIX3: 0, [`MIX${n}`]: 255 };
    const fin = { ...mix };
    if (f === "MORE") return C({ ...fin, [`O${n}_WAVE`]: 4 });
    if (f === "ENV2") return C({ ...fin, EM2_S: 90, EM2_D: 100 }, NOTE);
    if (f === "LFO2") return C({ ...fin, L2_RATE: 100 });
    if (f === "SHAPE") return C({ ...fin, [`O${n}_WAVE`]: 3 });
    if (f === "SHENV") return C({ ...fin, [`O${n}_WAVE`]: 3, EM1_S: 90, EM1_D: 100 });
    if (f === "SHLFO") return C({ ...fin, [`O${n}_WAVE`]: 3, L1_RATE: 140 });
    if (f === "DDET") return C({ ...fin, [`O${n}_SAWD`]: 100 });
    if (f === "SAWD") return C({ ...fin });
    if (f === "FIXED") return C({ ...fin }, [on(40), off(40, 0.9)]);
    if (f === "BEND") return C({ ...fin }, [on(48), cc(128, 0.8), off(48, 0.9)]);
    return C(fin);
  }
  if (k === "DIVERGE") return C({ MIX2: 255, O2_WAVE: 2, O2_FINE: 0 }, [on(48), on(55), off(48, 0.9), off(55, 0.9)]);
  if (k === "DRIFT") return C({}, [on(48)], 2.5);
  if (k === "NOISELPF") return C({ MIX1: 0, MIXN: 255 });
  if (k === "KEYSYNC") return C({ MODE: 0, EA_R: 0 }, [on(48, 0), off(48, 0.1), on(48, 0.2137), off(48, 0.5)], 0.7);
  if (k === "TUNING") return C({}, [on(61), off(61, 0.9)]);
  if (k === "MIX1" || k === "MIX2" || k === "MIX3") return C({ MIX1: 128, MIX2: 128, MIX3: 128 });
  if (k === "MIXR") return C({ MIX1: 128, MIX2: 128 });
  if (k === "MIXN") return C({});
  if (k === "F_KEY") return C({ F_FREQ: 100 }, [on(72), off(72, 0.9)]);
  if (k === "F_DIV") return C({ F_FREQ: 140, F_RES: 110 }, [on(60), on(64), on(67), on(71)]);
  if (k === "F_ENVAMP") return C({ F_FREQ: 100, EA_D: 100, EA_S: 40 });
  if (k === "F_ENVMOD") return C({ F_FREQ: 100, EM1_D: 100, EM1_S: 30 });
  if (k === "F_LFO1") return C({ F_FREQ: 100, L1_RATE: 140 });
  if (k === "F_OSC3") return C({ F_FREQ: 100, MIX3: 0 });
  if (k === "F_POST" || k === "F_OD") return C({});
  if (k.startsWith("F_")) return C({ F_FREQ: 140, F_RES: 40 });
  if ((m = /^E(A|M1|M2)_(\w+)$/.exec(k))) {
    const e = m[1], f = m[2];
    const route = e === "A" ? {} : e === "M1" ? { F_FREQ: 100, F_ENVMOD: 60, EM1_D: 100 } : { O1_ENV2: 50, EM2_D: 100 };
    const pre = e === "A" ? "EA" : `E${e}`;
    if (f === "A") return C({ ...route, [`${pre}_D`]: 90, [`${pre}_S`]: 30 }, [on(48, 0, 1), off(48, 1.0)], 1.4);
    if (f === "D") return C({ ...route, [`${pre}_A`]: 0, [`${pre}_S`]: 20 }, [on(48, 0, 1), off(48, 1.2)], 1.4);
    if (f === "S") return C({ ...route, [`${pre}_D`]: 60 }, [on(48, 0, 1), off(48, 1.0)], 1.4);
    if (f === "R") return C({ ...route }, [on(48, 0, 1), off(48, 0.2)], 1.3);
    if (f === "VEL") return C({ ...route }, [on(48, 0, 0.25), off(48, 0.9)]);
    if (f === "TRIG") return C({ ...route, MODE: 0, [`${pre}_D`]: 60, [`${pre}_S`]: 20 }, [on(48, 0, 1), on(55, 0.8, 1), off(55, 1.2), off(48, 1.2)], 1.5);
    if (f === "HOLD") return C({ ...route, [`${pre}_A`]: 0, [`${pre}_D`]: 80, [`${pre}_S`]: 0 }, [on(48, 0, 1)], 1.2);
    if (f === "REP") return C({ ...route, [`${pre}_A`]: 0, [`${pre}_D`]: 40, [`${pre}_S`]: 0 }, [on(48, 0, 1)], 1.2);
  }
  if ((m = /^L([12])_(\w+)$/.exec(k))) {
    const l = +m[1], f = m[2];
    const route = l === 1 ? { F_FREQ: 110, F_LFO1: 110 } : { O1_LFO2: 90 };
    const base = { ...route, [`L${l}_RATE`]: 150 };
    if (f === "SYNC") return C({ ...base, [`L${l}_RANGE`]: 2 }, NOTE, 1.3, 120);
    if (f === "FADE") return C({ ...base }, NOTE);
    if (f === "FMODE") return C({ ...base, [`L${l}_FADE`]: 60 });
    if (f === "FSYNC") return C({ ...base, MODE: 0, [`L${l}_FADE`]: 60, [`L${l}_MONO`]: 0 }, [on(48), on(55, 0.8), off(55, 1.2), off(48, 1.2)], 1.5);
    if (f === "MONO") return C({ ...base, MODE: 0, [`L${l}_PHASE`]: 15 }, [on(48), on(55, 0.7), off(55, 1.2), off(48, 1.2)], 1.5);
    if (f === "PHASE") return C({ ...base }, [on(48, 0.3), off(48, 1.0)]);
    if (f === "SLEW") return C({ ...base, [`L${l}_TYPE`]: 2 });
    if (f === "REP") return C({ ...base, [`L${l}_RATE`]: 190 });
    if (f === "COMMON") return C({ ...base, [`L${l}_RATE`]: 120 }, [on(48, 0), on(55, 0.33), off(48, 1.2), off(55, 1.2)], 1.5);
    return C(base);
  }
  if ((m = /^L([34])_(\w+)$/.exec(k))) { const l = +m[1]; return C({ F_FREQ: 100, ...mm(1, "Direct", `Lfo${l}+/-`, "FiltFreq", 50), [`L${l}_RATE`]: 90 }, NOTE, 1.5, 120); }
  if (k === "UNISON") return C({}, [on(60), off(60, 0.9)]);
  if (k === "UNIDET") return C({ UNISON: 3 });
  if (k === "UNISPR") return C({ UNISON: 1 });
  if (k === "PREGLIDE") return C({ GLIDE_ON: 1, GLIDE: 70 }, [on(60), off(60, 0.9)]);
  if (k === "GLIDE" || k === "GLIDE_ON") return C({ MODE: 0, GLIDE_ON: 1, GLIDE: 70 }, [on(48), on(60, 0.4), off(60, 1.0), off(48, 1.0)], 1.3);
  if (k === "MODE") return C({ EA_R: 90 }, [on(60), on(64, 0.2), off(64, 0.6), off(60, 0.6)], 1.3);
  if (k === "KBDOCT") return C({});
  if (k === "FX_BYPASS" || k === "FX_ROUTE") return C({ CH_LEVEL: 90, DL_LEVEL: 90, RV_LEVEL: 90, DL_FB: 70 });
  if (k === "FX_WET" || k === "FX_DRY") return C({ CH_LEVEL: 90, DL_LEVEL: 90, RV_LEVEL: 90 });
  if (k === "DIST") return C({});
  if (k.startsWith("CH_")) return C({ CH_LEVEL: 100, CH_DEPTH: 80, CH_RATE: 60, FX_DRY: 0, CH_FB: k === "CH_FB" ? 0 : 20 });
  if (k.startsWith("DL_")) return C({ DL_LEVEL: 100, DL_TIME: 40, DL_FB: 80, DL_SYNC: k === "DL_SYNCR" ? 1 : 0, DL_LR: k === "DL_WIDTH" ? 1 : 0, EA_R: 20 }, [on(48), off(48, 0.15)], 2, 120);
  if (k.startsWith("RV_")) return C({ RV_LEVEL: 100, RV_TIME: 70, EA_R: 20 }, [on(48), off(48, 0.15)], 2);
  if ((m = /^FM(\d)_(\w+)$/.exec(k))) { const s = +m[1]; const base = { CH_LEVEL: 70, DL_LEVEL: 70, RV_LEVEL: 70, DL_FB: 60, DIST: 30, EA_R: 20, ...Object.fromEntries([[`FM${s}_DEST`, 8], [`FM${s}_DEPTH`, 60], [`FM${s}_A`, 3], [`FM${s}_B`, 0]]), EXPR1: 0.6 }; return C(base, [on(48), off(48, 0.15)], 1.6); }
  if (k.startsWith("ARP_")) { const arp = { ARP_ON: 1, ARP_SYNC: 15, EA_A: 0, EA_D: 0, EA_S: 127, EA_R: 5 }; const ch = [on(60, 0.01), on(64, 0.01), on(67, 0.01)]; if (k === "ARP_ON") return C({}, ch, 1.5, 0); if (k === "ARP_LATCH") return C({ ...arp }, [...ch, off(60, 0.3), off(64, 0.3), off(67, 0.3)], 1.5); if (k === "ARP_KSYNC") return C({ ...arp, ARP_LATCH: 1 }, [...ch, off(60, 0.3), off(64, 0.3), off(67, 0.3), on(62, 0.56), on(65, 0.56)], 1.5); if (k === "ARP_SRC") return C({ ...arp }, ch, 1.5, 200); if (k === "ARP_SWING") return C({ ...arp }, ch, 1.5); return C({ ...arp }, ch, 1.5); }
  if (k === "VELSHAPE") return C({ EA_VEL: 64 }, [on(60, 0, 0.3), off(60, 0.9)]);
  if (k === "TRANSPOSE" || k === "TUNECENTS" || k === "VOLRANGE") return C({});
  if (k === "WHEEL_MOD") return C({ F_FREQ: 100, ...mm(1, "ModWheel", "Direct", "FiltFreq", 50) });
  if (k === "WHEEL_BEND") return C({ O1_BEND: 12 });
  if (k === "EXPR1") return C({ F_FREQ: 100, ...mm(1, "ExprPED1", "Direct", "FiltFreq", 50) });
  if (k === "EXPR2") return C({ F_FREQ: 100, ...mm(1, "BrthPED2", "Direct", "FiltFreq", 50) });
  if (k === "AFTERT") return C({ F_FREQ: 100, ...mm(1, "AftTouch", "Direct", "FiltFreq", 50) });
  if (k === "CVIN") return C({ F_FREQ: 100, ...mm(1, "CV +/-", "Direct", "FiltFreq", 50) });
  if (k === "ANIM") return C({ F_FREQ: 100, ...mm(1, "Animate1", "Direct", "FiltFreq", 50), ...mm(2, "Animate2", "Direct", "FiltFreq", -50) });
  if ((m = /^MM(\d+)_(\w+)$/.exec(k))) { const n = +m[1]; return C({ F_FREQ: 100, EXPR1: 0.5, ...mm(n, "ExprPED1", "Direct", "FiltFreq", 40) }); }
  return C({});
}

function render(c, extra) {
  e.reset(SR); e.setPatch({ ...c.patch, ...extra }, c.tempo);
  return e.render(c.dur, c.events);       // stereo (interleaved)
}
const diff = (a, b) => { let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - b[i]); s += Math.abs(a[i]) + Math.abs(b[i]); } return d / (s + 1e-9); };

let ok = 0, dead = [], ui = 0;
for (const p of P) {
  if (only && !p.key.includes(only)) continue;
  if (UI_ONLY.has(p.key)) { ui++; continue; }
  const c = ctx(p.key);
  const baseV = c.patch[p.key] !== undefined ? c.patch[p.key] : p.def;
  const base = render(c, {});
  const cands = [];
  if (p.direct) cands.push(p.max, p.min, (p.min + p.max) / 2); else for (const raw of [p.steps - 1, 0, Math.floor(p.steps / 2), Math.floor(p.steps * 0.3)]) cands.push(rawToActual(p, raw));
  let best = 0;
  for (const v of cands) { if (Math.abs(v - baseV) < 1e-9) continue; best = Math.max(best, diff(base, render(c, { [p.key]: v }))); if (best > 2e-3) break; }
  if (best > 2e-3) ok++; else dead.push(`${p.key}(${best.toExponential(1)})`);
}
console.log(`${ok} controls proven reactive, ${ui} UI-only selectors, ${dead.length} unproven`);
if (dead.length) console.log("UNPROVEN:", dead.join(" "));
process.exit(dead.length ? 1 : 0);
