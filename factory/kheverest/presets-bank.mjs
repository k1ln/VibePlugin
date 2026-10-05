// =====================================================================
//  KHEVEREST factory patches. Written with helpers over the real parameter names;
//  loudness is normalised afterwards by tests/tune-levels.mjs (PATCHLVL → presets.levels.json).
//  Each patch: { name, cat, set } — `set` lists only differences from the Init patch.
// =====================================================================
import { WAVETABLES, MOD_SRC, MOD_DEST, FXMOD_SRC, FXMOD_DEST, LFO_SYNC, ARP_SYNC, DELAY_SYNC } from "./params.mjs";

const wt = (n) => { const i = WAVETABLES.indexOf(n); if (i < 0) throw new Error("no wavetable " + n); return i; };
const ls = (n) => { const i = LFO_SYNC.findIndex((x) => x[0] === n); if (i < 0) throw new Error("lfo sync " + n); return i; };
const as = (n) => { const i = ARP_SYNC.findIndex((x) => x[0] === n); if (i < 0) throw new Error("arp sync " + n); return i; };
const ds = (n) => { const i = DELAY_SYNC.findIndex((x) => x[0] === n); if (i < 0) throw new Error("delay sync " + n); return i; };
const MM = (n, a, b, d, depth) => ({ [`MM${n}_A`]: MOD_SRC.indexOf(a), [`MM${n}_B`]: MOD_SRC.indexOf(b), [`MM${n}_DEST`]: MOD_DEST.indexOf(d), [`MM${n}_DEPTH`]: depth });
const FX = (n, a, b, d, depth) => ({ [`FM${n}_A`]: FXMOD_SRC.indexOf(a), [`FM${n}_B`]: FXMOD_SRC.indexOf(b), [`FM${n}_DEST`]: FXMOD_DEST.indexOf(d), [`FM${n}_DEPTH`]: depth });
const O = (n, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`O${n}_${k}`, v]));
const AE = (a, d, s, r) => ({ EA_A: a, EA_D: d, EA_S: s, EA_R: r });
const E1 = (a, d, s, r) => ({ EM1_A: a, EM1_D: d, EM1_S: s, EM1_R: r });
const E2 = (a, d, s, r) => ({ EM2_A: a, EM2_D: d, EM2_S: s, EM2_R: r });
const SINE = 0, TRI = 1, SAW = 2, PUL = 3, MORE = 4;
const R16 = 0, R8 = 1, R4 = 2, R2 = 3;
const UNI = { 1: 0, 2: 1, 3: 2, 4: 3, 8: 4 };
const MONO = 0, MONOLG = 1, MONO2 = 2, POLY = 3, POLY2 = 4;
const L = (l, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`L${l}_${k}`, v]));
const ARP = (o) => ({ ARP_ON: 1, ...o });

export const BANK = [];
const add = (name, cat, ...sets) => BANK.push({ name, cat, set: Object.assign({}, ...sets) });

// ----------------------------------------------------------------- BASS
add("Sub Foundation", "Bass", { MODE: MONO, GLIDE_ON: 1, GLIDE: 40, MIX1: 255, MIX2: 150, F_FREQ: 118, F_RES: 20, F_ENVMOD: 28, F_KEY: 100 }, O(1, { WAVE: SINE, RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R16, FINE: 4 }), AE(0, 70, 110, 30), E1(0, 55, 30, 40));
add("Reese Machine", "Bass", { MODE: POLY, UNISON: UNI[2], UNIDET: 40, MIX1: 255, MIX2: 255, MIX3: 160, F_FREQ: 125, F_RES: 25, F_ENVMOD: 20, CH_LEVEL: 55, CH_TYPE: 1 }, O(1, { WAVE: SAW, RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R16, FINE: 14 }), O(3, { WAVE: SAW, RANGE: R16, FINE: -11 }), AE(0, 90, 120, 35), E1(0, 70, 40, 50));
add("Wobble Deck", "Bass", { MODE: MONO, MIX1: 255, MIX2: 180, F_FREQ: 130, F_RES: 62, F_LFO1: 70, F_KEY: 90, F_OD: 30, DL_LEVEL: 0 }, O(1, { WAVE: SAW, RANGE: R16 }), O(2, { WAVE: PUL, RANGE: R16, SHAPE: 10, FINE: 6 }), L(1, { RANGE: 2, SYNC: ls("8th"), TYPE: 0 }), AE(0, 70, 127, 30));
add("Acid Climber", "Bass", { MODE: MONO, GLIDE_ON: 1, GLIDE: 38, MIX1: 255, F_FREQ: 92, F_RES: 100, F_ENVMOD: 48, F_KEY: 80, F_OD: 45, DIST: 20, DL_LEVEL: 40, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 55 }, O(1, { WAVE: SAW, RANGE: R16 }), AE(0, 55, 0, 25), E1(0, 50, 0, 30));
add("FM Pulse Bass", "Bass", { MODE: MONO, MIX1: 0, MIX2: 255, F_FREQ: 170, F_RES: 15, F_KEY: 100, ...MM(1, "Direct", "ModEnv1", "FM O1>O2", 38) }, O(1, { WAVE: SINE, RANGE: R16 }), O(2, { WAVE: SINE, RANGE: R16 }), AE(0, 60, 40, 25), E1(0, 50, 0, 30));
add("Hollow Square", "Bass", { MODE: MONO, MIX1: 255, MIX2: 100, F_FREQ: 150, F_RES: 30, F_KEY: 95 }, O(1, { WAVE: PUL, RANGE: R16, SRC: 2, SHLFO: 28 }), O(2, { WAVE: TRI, RANGE: R8 }), L(1, { RATE: 70 }), AE(0, 80, 100, 30));
add("Growl Table", "Bass", { MODE: MONO, MIX1: 255, F_FREQ: 140, F_RES: 28, F_KEY: 90 }, O(1, { WAVE: MORE, MORE: wt("Growl 04"), RANGE: R16, SRC: 1, SHENV: 40 }), AE(0, 85, 100, 30), E1(0, 70, 20, 40));
add("Fold Bass", "Bass", { MODE: MONO, MIX1: 255, F_FREQ: 160, F_RES: 20, F_KEY: 80, DIST: 30 }, O(1, { WAVE: MORE, MORE: wt("Dst Sin.Fold"), RANGE: R16, SRC: 1, SHENV: -40 }), AE(0, 70, 90, 28), E1(0, 55, 10, 35));
add("Rubber Bass", "Bass", { MODE: MONO, GLIDE_ON: 1, GLIDE: 30, MIX1: 255, MIX2: 200, F_FREQ: 105, F_RES: 55, F_ENVMOD: 40, F_KEY: 90, F_OD: 25 }, O(1, { WAVE: SAW, RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R8, FINE: -8 }), AE(0, 50, 20, 25), E1(0, 40, 0, 30));
add("Octave Pump", "Bass", { MODE: MONO, MIX1: 255, MIX2: 255, F_FREQ: 135, F_RES: 40, F_KEY: 80, ...MM(1, "Lfo3+", "Direct", "Osc2Ptch", 8), ...L(3, { RATE: 90, SYNC: 0 }) }, O(1, { WAVE: PUL, RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R8 }), AE(0, 90, 120, 30));

// ----------------------------------------------------------------- LEADS
add("Sync Scream", "Lead", { MODE: MONO, GLIDE_ON: 1, GLIDE: 28, MIX1: 255, F_FREQ: 200, F_RES: 20, F_KEY: 100, DL_LEVEL: 35, DL_TIME: 60, DL_FB: 50, ...MM(1, "ModEnv1", "Direct", "Osc1VSnc", 12), ...MM(2, "ModWheel", "Direct", "Osc1VSnc", 22) }, O(1, { WAVE: SAW, RANGE: R8, VSYNC: 14 }), AE(2, 80, 110, 35), E1(10, 90, 40, 40));
add("Super Saw Lead", "Lead", { MODE: POLY, UNISON: UNI[2], UNIDET: 35, UNISPR: 80, MIX1: 255, MIX2: 200, F_FREQ: 205, F_RES: 15, F_KEY: 110, CH_LEVEL: 50, DL_LEVEL: 36, DL_TIME: 66, DL_FB: 55, RV_LEVEL: 28 }, O(1, { WAVE: SAW, SAWD: 100, DDET: 80 }), O(2, { WAVE: SAW, SAWD: 100, DDET: 70, FINE: 9, RANGE: R8 }), AE(3, 80, 115, 40));
add("Ring Bell Lead", "Lead", { MODE: MONO, MIX1: 0, MIX2: 0, MIXR: 255, F_FREQ: 210, F_RES: 20, F_KEY: 100, ...MM(1, "Direct", "ModEnv1", "FM O1>O2", 14), RV_LEVEL: 40, RV_TIME: 78 }, O(1, { WAVE: SINE }), O(2, { WAVE: SINE, COARSE: 7, FINE: 12 }), AE(0, 85, 30, 60), E1(0, 60, 0, 50));
add("Vox Lead", "Lead", { MODE: MONO, GLIDE_ON: 1, GLIDE: 35, MIX1: 255, F_FREQ: 210, F_KEY: 100, RV_LEVEL: 32, ...MM(1, "Lfo3+/-", "Direct", "0123Ptch", 1), ...L(3, { RATE: 70 }) }, O(1, { WAVE: MORE, MORE: wt("VoxOooEe"), SRC: 2, SHLFO: 50 }), L(1, { RATE: 60, FADE: 40 }), AE(8, 70, 115, 40));
add("Mono Fury", "Lead", { MODE: MONOLG, GLIDE_ON: 1, GLIDE: 36, MIX1: 255, MIX2: 255, MIX3: 255, F_FREQ: 170, F_RES: 40, F_ENVMOD: 20, F_KEY: 100, F_OD: 40, DL_LEVEL: 36, DL_TIME: 62, DL_FB: 55 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 8 }), O(3, { WAVE: PUL, RANGE: R16, FINE: -6 }), AE(2, 70, 115, 35), E1(0, 70, 55, 40));
add("Glass Tine Lead", "Lead", { MODE: MONO, MIX1: 255, F_FREQ: 230, F_KEY: 100, RV_LEVEL: 36, DL_LEVEL: 30, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 55 }, O(1, { WAVE: MORE, MORE: wt("E.Piano"), SRC: 1, SHENV: 40 }), AE(0, 75, 60, 55), E1(0, 70, 0, 50));
add("Pulse Wave Hero", "Lead", { MODE: POLY, UNISON: UNI[2], UNIDET: 25, MIX1: 255, MIX2: 200, F_FREQ: 190, F_RES: 20, F_KEY: 100, CH_LEVEL: 40, DL_LEVEL: 28 }, O(1, { WAVE: PUL, SRC: 2, SHLFO: 40 }), O(2, { WAVE: PUL, FINE: 10, SRC: 2, SHLFO: -36 }), L(1, { RATE: 70 }), AE(2, 80, 115, 40));
add("Crystal Sync", "Lead", { MODE: POLY, MIX1: 255, MIX2: 150, F_FREQ: 220, F_KEY: 100, RV_LEVEL: 36, ...MM(1, "Lfo2+", "Direct", "Osc1VSnc", 20), ...MM(2, "ModWheel", "Direct", "FiltFreq", 8) }, O(1, { WAVE: SAW, VSYNC: 20 }), O(2, { WAVE: TRI, RANGE: R4, FINE: 7 }), L(2, { RATE: 85 }), AE(3, 80, 100, 50));
add("Whistle Sine", "Lead", { MODE: MONO, GLIDE_ON: 1, GLIDE: 45, MIX1: 255, MIX2: 60, F_FREQ: 255, RV_LEVEL: 40, DL_LEVEL: 34, DL_TIME: 70, DL_FB: 60, ...MM(1, "ModWheel", "Direct", "Osc1Shpe", 30) }, O(1, { WAVE: SINE, RANGE: R4, LFO2: 8 }), O(2, { WAVE: SINE, RANGE: R4, FINE: 4 }), L(2, { RATE: 105, FADE: 60, FMODE: 2 }), AE(8, 70, 115, 50));

// ----------------------------------------------------------------- PADS
add("Slow Horizon", "Pad", { MODE: POLY, UNISON: UNI[2], UNIDET: 30, UNISPR: 60, MIX1: 200, MIX2: 200, F_FREQ: 140, F_RES: 14, F_ENVMOD: 25, F_KEY: 80, CH_LEVEL: 60, RV_LEVEL: 55, RV_TIME: 95, DRIFT: 50, DIVERGE: 30 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 8 }), AE(75, 90, 110, 85), E1(80, 90, 70, 80));
add("Glass Cathedral", "Pad", { MODE: POLY, MIX1: 255, MIX2: 130, F_FREQ: 215, F_RES: 10, F_KEY: 100, RV_LEVEL: 75, RV_TIME: 108, RV_SIZE: 127, CH_LEVEL: 40, DRIFT: 40 }, O(1, { WAVE: MORE, MORE: wt("GlassSaw"), SRC: 2, SHLFO: 40 }), O(2, { WAVE: MORE, MORE: wt("Glassy"), RANGE: R4, FINE: 5 }), L(1, { RATE: 40 }), AE(80, 90, 115, 95));
add("Warm Strings", "Pad", { MODE: POLY, UNISON: UNI[3], UNIDET: 28, UNISPR: 70, MIX1: 255, MIX2: 220, F_FREQ: 170, F_RES: 8, F_KEY: 90, F_ENVMOD: 15, CH_LEVEL: 85, CH_TYPE: 2, RV_LEVEL: 40, DRIFT: 40 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 7 }), AE(60, 90, 115, 75), E1(55, 80, 85, 70));
add("Choral Dawn", "Pad", { MODE: POLY, UNISON: UNI[2], UNIDET: 20, MIX1: 255, F_FREQ: 235, F_KEY: 100, CH_LEVEL: 60, RV_LEVEL: 55, RV_TIME: 98 }, O(1, { WAVE: MORE, MORE: wt("Choral"), SRC: 2, SHLFO: 60 }), L(1, { RATE: 30 }), AE(70, 90, 115, 90));
add("Analog Drift", "Pad", { MODE: POLY, MIX1: 255, MIX2: 255, MIX3: 255, F_FREQ: 130, F_RES: 20, F_ENVMOD: 20, F_KEY: 90, DRIFT: 127, DIVERGE: 60, F_DIV: 60, CH_LEVEL: 45, RV_LEVEL: 45 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 5 }), O(3, { WAVE: PUL, SHAPE: 20, RANGE: R16, FINE: -5 }), AE(70, 90, 110, 80), E1(70, 90, 70, 80));
add("Wide Detune Pad", "Pad", { MODE: POLY, UNISON: UNI[4], UNIDET: 50, UNISPR: 127, MIX1: 255, F_FREQ: 150, F_RES: 10, F_ENVMOD: 20, F_KEY: 90, CH_LEVEL: 50, RV_LEVEL: 50 }, O(1, { WAVE: SAW }), AE(70, 90, 115, 85), E1(65, 90, 75, 80));
add("Evolving Table", "Pad", { MODE: POLY, UNISON: UNI[2], UNIDET: 18, MIX1: 255, MIX2: 150, F_FREQ: 190, F_RES: 15, F_KEY: 95, CH_LEVEL: 45, RV_LEVEL: 55, RV_TIME: 100 }, O(1, { WAVE: MORE, MORE: wt("PWMc 12"), SRC: 2, SHLFO: 63 }), O(2, { WAVE: MORE, MORE: wt("Hyper 03"), SRC: 2, SHLFO: -55, FINE: 6 }), L(1, { RATE: 35 }), AE(78, 90, 115, 90));
add("Ice Breath", "Pad", { MODE: POLY, MIX1: 0, MIXN: 255, MIX2: 0, F_SHAPE: 1, F_FREQ: 170, F_RES: 95, F_KEY: 100, F_LFO1: 25, RV_LEVEL: 60, RV_TIME: 100, DL_LEVEL: 25, NOISELPF: 100 }, L(1, { RATE: 70, TYPE: 3 }), AE(85, 90, 115, 95));
add("Organ Hall", "Pad", { MODE: POLY, MIX1: 255, MIX2: 200, MIX3: 160, F_FREQ: 220, F_KEY: 100, CH_LEVEL: 70, CH_TYPE: 3, RV_LEVEL: 55, RV_TIME: 85 }, O(1, { WAVE: MORE, MORE: wt("Organ") }), O(2, { WAVE: SINE, RANGE: R4 }), O(3, { WAVE: SINE, RANGE: R16 }), AE(10, 90, 127, 50));
add("Breathing Pad", "Pad", { MODE: POLY, UNISON: UNI[2], UNIDET: 25, MIX1: 255, MIX2: 200, F_FREQ: 125, F_RES: 25, F_KEY: 90, F_LFO1: 28, RV_LEVEL: 50, CH_LEVEL: 50 }, O(1, { WAVE: SAW }), O(2, { WAVE: PUL, FINE: 7 }), L(1, { RATE: 50 }), AE(80, 90, 120, 90));
add("Animate Me", "Pad", { MODE: POLY, UNISON: UNI[2], UNIDET: 22, MIX1: 255, MIX2: 200, F_FREQ: 100, F_RES: 30, F_KEY: 90, CH_LEVEL: 50, RV_LEVEL: 40, DL_LEVEL: 0, ...MM(1, "Animate1", "Direct", "FiltFreq", 38), ...MM(2, "Animate2", "Direct", "Osc2Ptch", 4), ...FX(1, "Animate2", "Direct", "Del Lev", 50), DL_TIME: 70, DL_FB: 70 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 8 }), AE(55, 90, 115, 80));

// ----------------------------------------------------------------- KEYS
add("Tine Piano", "Keys", { MODE: POLY, MIX1: 255, F_FREQ: 230, F_KEY: 110, CH_LEVEL: 50, RV_LEVEL: 35, EA_VEL: 40 }, O(1, { WAVE: MORE, MORE: wt("E.Piano"), SRC: 1, SHENV: 38 }), AE(0, 85, 0, 55), E1(0, 70, 0, 50));
add("Funk Clav", "Keys", { MODE: POLY, MIX1: 255, F_FREQ: 170, F_RES: 20, F_ENVMOD: 30, F_KEY: 110, EA_VEL: 30 }, O(1, { WAVE: MORE, MORE: wt("SoftClav") }), AE(0, 60, 0, 35), E1(0, 50, 0, 40));
add("Digital Bell", "Keys", { MODE: POLY, MIX1: 255, MIX2: 0, F_FREQ: 240, F_KEY: 100, RV_LEVEL: 55, RV_TIME: 95, ...MM(1, "Direct", "ModEnv1", "FM O1>O2", 20) }, O(1, { WAVE: SINE, COARSE: 12 }), O(2, { WAVE: MORE, MORE: wt("Tokyo") }), AE(0, 95, 0, 70), E1(0, 80, 0, 60));
add("Drawbar Organ", "Keys", { MODE: POLY, MIX1: 255, MIX2: 190, MIX3: 150, F_FREQ: 235, F_KEY: 100, CH_LEVEL: 40, DIST: 25, RV_LEVEL: 25 }, O(1, { WAVE: SINE }), O(2, { WAVE: SINE, RANGE: R4 }), O(3, { WAVE: MORE, MORE: wt("Organ"), RANGE: R16 }), AE(5, 90, 127, 25));
add("Marimba Ring", "Keys", { MODE: POLY, MIX1: 0, MIX2: 0, MIXR: 255, F_FREQ: 200, F_KEY: 100, RV_LEVEL: 40 }, O(1, { WAVE: SINE }), O(2, { WAVE: SINE, COARSE: 12, FINE: 5 }), AE(0, 70, 0, 40));
add("Soft Pluck Keys", "Keys", { MODE: POLY, MIX1: 255, MIX2: 160, F_FREQ: 125, F_RES: 15, F_ENVMOD: 38, F_KEY: 110, CH_LEVEL: 40, RV_LEVEL: 40, EA_VEL: 40 }, O(1, { WAVE: SAW }), O(2, { WAVE: TRI, RANGE: R4, FINE: 6 }), AE(0, 75, 0, 45), E1(0, 62, 0, 45));
add("Wurly Bite", "Keys", { MODE: POLY, MIX1: 255, F_FREQ: 215, F_KEY: 100, DIST: 40, CH_LEVEL: 45, CH_TYPE: 1, EA_VEL: 40, ...MM(1, "Velocity", "Direct", "Osc1Shpe", 24) }, O(1, { WAVE: MORE, MORE: wt("E.Piano"), SRC: 1, SHENV: -20, SHAPE: 20 }), AE(0, 80, 20, 50), E1(0, 55, 0, 40));
add("Glass Harp", "Keys", { MODE: POLY, MIX1: 255, MIX2: 150, F_FREQ: 235, F_KEY: 100, RV_LEVEL: 70, RV_TIME: 105, CH_LEVEL: 30 }, O(1, { WAVE: MORE, MORE: wt("Glassy") }), O(2, { WAVE: SINE, RANGE: R4, FINE: 5 }), AE(15, 100, 40, 80));

// ----------------------------------------------------------------- ARPEGGIOS & SEQUENCES
add("Arp Pulse 16th", "Arp", ARP({ ARP_SYNC: as("16th"), ARP_GATE: 56, ARP_OCT: 2 }), { MODE: POLY, MIX1: 255, MIX2: 180, F_FREQ: 140, F_RES: 40, F_ENVMOD: 34, F_KEY: 100, DL_LEVEL: 40, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 55, RV_LEVEL: 25 }, O(1, { WAVE: PUL, SHAPE: 10 }), O(2, { WAVE: SAW, FINE: 6 }), AE(0, 60, 40, 30), E1(0, 55, 0, 30));
add("Dub Chord Stabs", "Arp", ARP({ ARP_TYPE: 6, ARP_SYNC: as("8th"), ARP_GATE: 45, ARP_RHYTHM: 4 }), { MODE: POLY, MIX1: 255, MIX2: 200, F_FREQ: 120, F_RES: 25, F_ENVMOD: 36, F_KEY: 100, DL_LEVEL: 70, DL_SYNC: 1, DL_SYNCR: ds("4th D"), DL_FB: 80, RV_LEVEL: 40 }, O(1, { WAVE: SAW }), O(2, { WAVE: PUL, FINE: 7 }), AE(0, 60, 20, 30), E1(0, 55, 0, 30));
add("Arp Cascade", "Arp", ARP({ ARP_TYPE: 3, ARP_OCT: 3, ARP_SYNC: as("16th"), ARP_GATE: 50, ARP_RHYTHM: 1 }), { MODE: POLY, MIX1: 255, F_FREQ: 170, F_RES: 25, F_KEY: 110, CH_LEVEL: 45, RV_LEVEL: 45, DL_LEVEL: 38, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 60 }, O(1, { WAVE: MORE, MORE: wt("Glassy"), SRC: 1, SHENV: 30 }), AE(0, 65, 0, 55), E1(0, 55, 0, 50));
add("Octave Bounce", "Arp", ARP({ ARP_TYPE: 0, ARP_OCT: 3, ARP_SYNC: as("16th"), ARP_GATE: 50, ARP_RHYTHM: 7 }), { MODE: POLY, MIX1: 255, MIX2: 120, F_FREQ: 120, F_RES: 55, F_ENVMOD: 38, F_KEY: 100, F_OD: 20 }, O(1, { WAVE: SAW }), O(2, { WAVE: PUL, RANGE: R16 }), AE(0, 55, 10, 25), E1(0, 50, 0, 25));
add("Random Glass", "Arp", ARP({ ARP_TYPE: 5, ARP_OCT: 2, ARP_SYNC: as("16th"), ARP_GATE: 60 }), { MODE: POLY, MIX1: 255, F_FREQ: 225, F_KEY: 100, RV_LEVEL: 60, RV_TIME: 100, DL_LEVEL: 50, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 70 }, O(1, { WAVE: MORE, MORE: wt("E.Piano") }), AE(0, 70, 0, 60));
add("Trance Gate", "Arp", ARP({ ARP_TYPE: 6, ARP_SYNC: as("16th"), ARP_RHYTHM: 12, ARP_GATE: 70 }), { MODE: POLY, UNISON: UNI[2], UNIDET: 30, MIX1: 255, MIX2: 255, F_FREQ: 175, F_RES: 20, F_KEY: 100, CH_LEVEL: 40, RV_LEVEL: 30 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 8 }), AE(0, 80, 100, 25));
add("Swing Pluck", "Arp", ARP({ ARP_TYPE: 2, ARP_SYNC: as("16th"), ARP_SWING: 63, ARP_GATE: 50, ARP_OCT: 2 }), { MODE: POLY, MIX1: 255, F_FREQ: 130, F_RES: 30, F_ENVMOD: 38, F_KEY: 110, DL_LEVEL: 40, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 50 }, O(1, { WAVE: PUL, SHAPE: 15 }), O(2, { WAVE: SAW, FINE: 5 }), AE(0, 55, 0, 30), E1(0, 50, 0, 30));
add("Held Cloud", "Arp", ARP({ ARP_LATCH: 1, ARP_TYPE: 4, ARP_OCT: 2, ARP_SYNC: as("8th T"), ARP_GATE: 80 }), { MODE: POLY, MIX1: 255, MIX2: 180, F_FREQ: 170, F_RES: 20, F_KEY: 100, RV_LEVEL: 55, RV_TIME: 95, CH_LEVEL: 50, DL_LEVEL: 40, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 60 }, O(1, { WAVE: MORE, MORE: wt("Vowelled") }), O(2, { WAVE: TRI, RANGE: R4, FINE: 6 }), AE(0, 70, 60, 70));
add("Rhythm Machine", "Arp", ARP({ ARP_TYPE: 0, ARP_RHYTHM: 18, ARP_SYNC: as("16th"), ARP_GATE: 40, ARP_OCT: 1 }), { MODE: POLY, MIX1: 255, MIX2: 180, F_FREQ: 105, F_RES: 55, F_ENVMOD: 45, F_KEY: 100, F_OD: 30 }, O(1, { WAVE: SAW, RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R8, FINE: 6 }), AE(0, 50, 0, 25), E1(0, 45, 0, 25));
add("Down Stairs", "Arp", ARP({ ARP_TYPE: 1, ARP_OCT: 3, ARP_SYNC: as("8th"), ARP_GATE: 70, ARP_RHYTHM: 3 }), { MODE: POLY, MIX1: 255, MIX2: 150, F_FREQ: 180, F_RES: 20, F_KEY: 105, RV_LEVEL: 40, CH_LEVEL: 40 }, O(1, { WAVE: MORE, MORE: wt("Lead") }), O(2, { WAVE: SAW, FINE: 7 }), AE(0, 70, 50, 40));

// ----------------------------------------------------------------- BRASS & STRINGS
add("Poly Brass", "Brass", { MODE: POLY, UNISON: UNI[2], UNIDET: 15, MIX1: 255, MIX2: 255, F_FREQ: 110, F_RES: 15, F_ENVMOD: 38, F_KEY: 100, CH_LEVEL: 35, RV_LEVEL: 25, EA_VEL: 25 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 6 }), AE(18, 80, 110, 35), E1(22, 75, 70, 40));
add("Brass Stab", "Brass", { MODE: POLY, MIX1: 255, MIX2: 255, F_FREQ: 100, F_RES: 20, F_ENVMOD: 45, F_KEY: 100, RV_LEVEL: 35, EA_VEL: 35 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 9 }), AE(6, 62, 20, 35), E1(10, 55, 5, 35));
add("Analog Strings", "Strings", { MODE: POLY, UNISON: UNI[2], UNIDET: 20, MIX1: 255, MIX2: 255, F_FREQ: 180, F_KEY: 90, CH_LEVEL: 90, CH_TYPE: 3, RV_LEVEL: 45, DRIFT: 35 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 8 }), AE(55, 90, 120, 70));
add("Octave Strings", "Strings", { MODE: POLY, MIX1: 255, MIX2: 200, MIX3: 160, F_FREQ: 190, F_KEY: 95, CH_LEVEL: 80, CH_TYPE: 2, RV_LEVEL: 45 }, O(1, { WAVE: MORE, MORE: wt("String") }), O(2, { WAVE: SAW, RANGE: R4, FINE: 6 }), O(3, { WAVE: SAW, RANGE: R16, FINE: -6 }), AE(50, 90, 118, 70));
add("Cello Section", "Strings", { MODE: POLY, UNISON: UNI[2], UNIDET: 15, MIX1: 255, MIX2: 150, F_FREQ: 160, F_RES: 10, F_KEY: 80, CH_LEVEL: 55, RV_LEVEL: 45 }, O(1, { WAVE: MORE, MORE: wt("String"), RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R16, FINE: 5 }), AE(40, 90, 115, 60), L(1, { RATE: 95, FADE: 70 }), { O1_LFO2: 6, O2_LFO2: 6 }, L(2, { RATE: 105, FADE: 70 }));

// ----------------------------------------------------------------- PERCUSSIVE
add("Sine Kick", "Percussive", { MODE: MONO, MIX1: 255, F_FREQ: 200, F_KEY: 0, DIST: 18 }, O(1, { WAVE: SINE, RANGE: R16, ENV2: 45 }), AE(0, 52, 0, 15), E2(0, 28, 0, 20));
add("Tom Drop", "Percussive", { MODE: POLY, MIX1: 255, F_FREQ: 170, F_KEY: 60, RV_LEVEL: 25 }, O(1, { WAVE: TRI, ENV2: 30 }), AE(0, 62, 0, 30), E2(0, 40, 0, 30));
add("Zap Laser", "Percussive", { MODE: POLY, MIX1: 255, MIX2: 150, F_FREQ: 220, F_KEY: 100, DL_LEVEL: 30 }, O(1, { WAVE: SAW, ENV2: 63 }), O(2, { WAVE: PUL, ENV2: 55, FINE: 10 }), AE(0, 58, 0, 25), E2(0, 40, 0, 20));
add("Noise Hat", "Percussive", { MODE: POLY, MIX1: 0, MIXN: 255, F_SHAPE: 2, F_FREQ: 200, F_KEY: 0 }, AE(0, 38, 0, 18));
add("Rim Click", "Percussive", { MODE: POLY, MIX1: 255, MIXN: 120, F_SHAPE: 0, F_FREQ: 205, F_RES: 30, F_KEY: 80, F_OD: 40 }, O(1, { WAVE: PUL, RANGE: R4 }), AE(0, 40, 0, 20));
add("Metal Hit", "Percussive", { MODE: POLY, MIX1: 0, MIXR: 255, F_FREQ: 235, F_KEY: 80, RV_LEVEL: 40, RV_TIME: 80 }, O(1, { WAVE: SAW, COARSE: 5 }), O(2, { WAVE: PUL, COARSE: -3, FINE: 25 }), AE(0, 62, 0, 40));
add("Pluck Mallet", "Percussive", { MODE: POLY, MIX1: 255, MIX2: 130, F_FREQ: 125, F_RES: 25, F_ENVMOD: 40, F_KEY: 110, RV_LEVEL: 35, EA_VEL: 40 }, O(1, { WAVE: TRI }), O(2, { WAVE: SINE, RANGE: R4, FINE: 5 }), AE(0, 55, 0, 30), E1(0, 50, 0, 30));

// ----------------------------------------------------------------- FX & DRONES
add("Sea Drone", "FX", { MODE: POLY, MIX1: 255, MIX2: 150, F_FREQ: 120, F_RES: 30, F_LFO1: 30, F_KEY: 60, RV_LEVEL: 75, RV_TIME: 115, RV_SIZE: 127 }, O(1, { WAVE: MORE, MORE: wt("SeaBase"), RANGE: R16 }), O(2, { WAVE: SAW, RANGE: R16, FINE: 5 }), L(1, { RATE: 30 }), AE(100, 90, 127, 100));
add("Alien Transmission", "FX", { MODE: MONO, MIX1: 255, MIX2: 150, F_FREQ: 170, F_RES: 55, F_KEY: 70, RV_LEVEL: 50, DL_LEVEL: 45, DL_TIME: 80, DL_FB: 75, ...MM(1, "Lfo3+/-", "Direct", "FM O1>O2", 30), ...MM(2, "Lfo4+/-", "Direct", "FiltFreq", 20), ...L(3, { RATE: 98, WAVE: 3 }), ...L(4, { RATE: 70, WAVE: 3 }) }, O(1, { WAVE: SINE }), O(2, { WAVE: SINE, COARSE: 7 }), AE(5, 90, 120, 70));
add("S&H Cloud", "FX", { MODE: POLY, MIX1: 255, MIX2: 200, F_FREQ: 140, F_RES: 45, F_LFO1: 60, RV_LEVEL: 55, DL_LEVEL: 40, DL_SYNC: 1, DL_SYNCR: ds("8th D"), DL_FB: 65, O1_LFO2: 20 }, O(1, { WAVE: SAW }), O(2, { WAVE: PUL, FINE: 8, LFO2: 20 }), L(1, { TYPE: 3, RANGE: 2, SYNC: ls("16th") }), L(2, { TYPE: 3, RANGE: 2, SYNC: ls("8th") }), AE(20, 90, 115, 80));
add("Noise Sweep", "FX", { MODE: POLY, MIX1: 0, MIXN: 255, F_SHAPE: 1, F_FREQ: 80, F_RES: 80, F_ENVMOD: 63, F_KEY: 0, RV_LEVEL: 60, RV_TIME: 100 }, AE(100, 90, 100, 90), E1(110, 80, 40, 90));
add("Impact Hit", "FX", { MODE: POLY, MIX1: 255, MIX2: 255, MIXN: 100, F_FREQ: 140, F_RES: 20, F_ENVMOD: 30, DIST: 35, RV_LEVEL: 80, RV_TIME: 110, RV_SIZE: 127 }, O(1, { WAVE: SAW, RANGE: R16, ENV2: 30 }), O(2, { WAVE: PUL, RANGE: R16, ENV2: 25 }), AE(0, 100, 0, 90), E1(0, 90, 0, 80), E2(0, 60, 0, 50));
add("Spiral Staircase", "FX", { MODE: POLY, MIX1: 255, F_FREQ: 220, F_KEY: 100, RV_LEVEL: 55, DL_LEVEL: 40, DL_TIME: 70, DL_FB: 70 }, O(1, { WAVE: MORE, MORE: wt("Spirals"), SRC: 2, SHLFO: 63 }), L(1, { RATE: 80 }), AE(20, 90, 110, 70));
add("Modem Dream", "FX", { MODE: POLY, MIX1: 255, F_FREQ: 200, F_KEY: 100, RV_LEVEL: 45, DL_LEVEL: 35 }, O(1, { WAVE: MORE, MORE: wt("Modem"), SRC: 1, SHENV: 50 }), AE(10, 90, 100, 70), E1(60, 90, 30, 70));
add("Rising Tide", "FX", { MODE: POLY, UNISON: UNI[2], UNIDET: 30, MIX1: 255, MIX2: 200, F_FREQ: 100, F_RES: 40, F_ENVMOD: 50, F_KEY: 110, RV_LEVEL: 55, RV_TIME: 105 }, O(1, { WAVE: SAW }), O(2, { WAVE: SAW, FINE: 10 }), AE(100, 90, 120, 90), E1(115, 90, 60, 90));

// ----------------------------------------------------------------- WAVETABLE SHOWCASE (BVKER + factory tables)
for (const [n, nm, cat, shp] of [
  ["Growl 01", "Growl Stack", "Bass", 0], ["Growl 09", "Throat Singer", "Bass", 10], ["FM 05", "FM Chime Keys", "Keys", 0], ["FM 12", "Bell Tower", "Keys", 0],
  ["Hyper 01", "Hyper Pad", "Pad", 0], ["Hyper 05", "Hyperdrive Lead", "Lead", 0], ["PWMc 05", "PWM Strings", "Pad", 0], ["PWMs 03", "Saw Sweep", "Pad", 0],
  ["PWMq 02", "Square Drift", "Pad", 0], ["PWMb 04", "Sub Table", "Bass", 0], ["Dst Tube", "Tube Lead", "Lead", 0], ["Dst Tape", "Tape Keys", "Keys", 0],
]) {
  const isBass = cat === "Bass", isPad = cat === "Pad", isLead = cat === "Lead";
  add(nm, cat, { MODE: isBass || isLead ? MONO : POLY, MIX1: 255, F_FREQ: isBass ? 160 : 230, F_KEY: 90, F_RES: 15, CH_LEVEL: isPad ? 55 : 25, RV_LEVEL: isPad ? 55 : 28, DL_LEVEL: isLead ? 32 : 0, DL_TIME: 66, DL_FB: 55 },
    O(1, { WAVE: MORE, MORE: wt(n), RANGE: isBass ? R16 : R8, SRC: 2, SHLFO: isPad ? 55 : 0, SHAPE: shp, ...(isLead || isBass ? { SRC: 1, SHENV: 45 } : {}) }),
    isPad ? { ...L(1, { RATE: 38 }), UNISON: UNI[2], UNIDET: 22 } : {}, isPad ? AE(70, 90, 115, 90) : isBass ? AE(0, 85, 100, 30) : AE(2, 80, 105, 45), isBass || isLead ? E1(0, 80, 20, 45) : {});
}
