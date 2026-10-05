// =====================================================================
//  KHEVEREST — logical parameter table (single source of truth).
//
//  An eight-voice, three-oscillator hybrid synthesizer modelled feature-for-
//  feature on the Novation Peak (User Guide v1.2: every control, menu page,
//  modulation-matrix source/destination and the MIDI parameter appendix).
//
//  The host gives a plugin 64 float slots (63 usable: slot 63 is the host
//  tempo). The Peak has ~400 parameters, so build.mjs PACKS them exactly like
//  factory/cataclysm: every logical parameter is a small integer with its own
//  number of STEPS and several share one slot using mixed-radix packing
//        slot = Σ raw_i · Π_{j<i} steps_j        (product ≤ 2^24)
//  Integers up to 2^24 are exact in float32 and the host maps a slot to 0..1 as
//  value/2^24 (a power of two) so the round trip through the DAW is exact.
//  A few performance controls are DIRECT slots (full float, real DAW
//  automation): master volume, mod wheel, pitch wheel, two expression pedals.
//
//  curve:  lin  actual = min + n·(max-min)        n = raw/(steps-1)
//          int  actual = min + raw                (steps = max-min+1)
//  fmt: how the GUI prints the value (see gui/app.js fmtVal)
// =====================================================================

import { readFileSync, existsSync } from "node:fs";
export const SLOT_CAP = 2 ** 24;
export const SLOT_MAX = SLOT_CAP;
export const MAX_SLOTS = 63;

// ---- name lists (manual pp.37-40) -------------------------------------
export const PEAK_WAVETABLES = [
  "BS sine", "Random", "Zing", "Tubey", "Octaves", "Wobbler", "Chords", "Didgery", "Harsh", "Organ",
  "E.Piano", "VoxOooEe", "VoxYahEe", "Winds", "SoftClav", "String", "BassOrgn", "Acid", "Buzzy", "Carousel",
  "Choral", "Climbing", "CoinFlip", "Deep", "Dub", "Eee", "Eris", "Flame", "Further", "GlassSaw",
  "Glassy", "Granular", "Grime", "Drow", "Heavy", "Hedge", "Hungry", "Ladders", "Lead", "Modeling",
  "Modem", "Monster", "Screech", "SeaBase", "Shmorgan", "Spirals", "Steel", "Sunrise", "Swell", "Thicker",
  "Thinner", "Tides", "Tokyo", "Tops", "V.Chord", "Variance", "Vocaloid", "Vowelled", "WeirdVox", "Yeah",
];
// expanded bank: third-party tables imported by tools/import-wavetables.mjs (wt-extra.json)
export const WT_EXTRA = existsSync(new URL("./wt-extra.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./wt-extra.json", import.meta.url), "utf8")).tables : [];
export const WAVETABLES = [...PEAK_WAVETABLES, ...WT_EXTRA.map((t) => t.name)];
export const WT_CATS = [...PEAK_WAVETABLES.map(() => "Factory"), ...WT_EXTRA.map((t) => t.cat)];
export const MOD_SRC = [
  "Direct", "ModWheel", "AftTouch", "ExprPED1", "BrthPED2", "Velocity", "Keyboard",
  "Lfo1+", "Lfo1+/-", "Lfo2+", "Lfo2+/-", "AmpEnv", "ModEnv1", "ModEnv2", "Animate1", "Animate2",
  "CV +/-", "Lfo3+", "Lfo3+/-", "Lfo4+", "Lfo4+/-", "BndWhl+", "BndWhl-",
];
export const FXMOD_SRC = [
  "Direct", "ModWheel", "AftTouch", "ExprPED1", "BrthPED2", "Velocity", "Keyboard", "Animate1",
  "Animate2", "CV +/-", "Lfo3+", "Lfo3+/-", "Lfo4+", "Lfo4+/-", "BndWhl+", "BndWhl-",
];
export const MOD_DEST = [
  "0123Ptch", "Osc1Ptch", "Osc2Ptch", "Osc3Ptch", "Osc1VSnc", "Osc2VSnc", "Osc3VSnc",
  "Osc1Shpe", "Osc2Shpe", "Osc3Shpe", "Osc1 Lev", "Osc2 Lev", "Osc3 Lev", "NoiseLev", "Ring Lev",
  "VcaLevel", "Filt Drv", "FiltDist", "FiltFreq", "Filt Res", "Lfo1Rate", "Lfo2Rate",
  "AmpEnv A", "AmpEnv D", "AmpEnv R", "ModEnv1A", "ModEnv1D", "ModEnv1R", "ModEnv2A", "ModEnv2D", "ModEnv2R",
  "FM O1>O2", "FM O2>O3", "FM O3>O1", "FM Ns>O1", "O3>FiltF", "Ns>FiltF",
];
export const FXMOD_DEST = [
  "Dist Lev", "Chor Lev", "ChorRate", "Chor Dep", "Chor FB", "Del Lev", "Del Time", "Del FB",
  "Rev Lev", "Rev Time", "Rev LPF", "Rev HPF",
];
export const LFO_SYNC = [ // LFO sync rates, cycle length in MIDI ticks (24 PPQN) — manual p.38
  ["64 beats", 1536], ["48 beats", 1152], ["42 beats", 1002], ["36 beats", 864], ["32 beats", 768], ["30 beats", 720],
  ["28 beats", 672], ["24 beats", 576], ["21 + 1/3", 512], ["20 beats", 480], ["18 + 2/3", 448], ["18 beats", 432],
  ["16 beats", 384], ["13 + 1/3", 320], ["12 beats", 288], ["10 + 2/3", 256], ["8 beats", 192], ["6 beats", 144],
  ["5 + 1/3", 128], ["4 beats", 96], ["3 beats", 72], ["2 + 2/3", 64], ["2nd", 48], ["4th D", 36], ["1 + 1/3", 32],
  ["4th", 24], ["8th D", 18], ["4th T", 16], ["8th", 12], ["16th D", 9], ["8th T", 8], ["16th", 6], ["16th T", 4],
  ["32nd", 3], ["32nd T", 2],
];
export const ARP_SYNC = [ // arp clock sync rates (ticks per step) — manual p.37
  ["8 beats", 192], ["6 beats", 144], ["5 + 1/3", 128], ["4 beats", 96], ["3 beats", 72], ["2 + 2/3", 64], ["2nd", 48],
  ["4th D", 36], ["1 + 1/3", 32], ["4th", 24], ["8th D", 18], ["4th T", 16], ["8th", 12], ["16th D", 9], ["8th T", 8],
  ["16th", 6], ["16th T", 4], ["32nd", 3], ["32nd T", 2],
];
export const DELAY_SYNC = [ // delay sync times (ticks) — manual p.37
  ["4 beats", 96], ["3 beats", 72], ["2 + 2/3", 64], ["2nd", 48], ["4th D", 36], ["1 + 1/3", 32], ["4th", 24],
  ["8th D", 18], ["4th T", 16], ["8th", 12], ["16th D", 9], ["8th T", 8], ["16th", 6], ["16th T", 4], ["32nd", 3], ["32nd T", 2],
];
export const LR_RATIOS = ["1/1", "4/3", "3/4", "3/2", "2/3", "2/1", "1/2", "3/1", "1/3", "4/1", "1/4"];
export const ARP_TYPES = ["Up", "Down", "Up-Down 1", "Up-Down 2", "Played", "Random", "Chord"];
export const FX_ROUTING = ["Parallel", "D>R>C", "D>C>R", "R>D>C", "R>C>D", "C>D>R", "C>R>D"];
export const CLOCK_SRC = ["Auto", "Internal", "Ext-Auto", "MIDI", "USB"];
export const TUNING_NAMES = [
  "Equal (12-TET)", "Just 5-limit", "Pythagorean", "1/4-comma meantone", "Werckmeister III", "Kirnberger III",
  "Vallotti", "Young", "Arabic Rast", "Arabic Bayati", "Indian Shruti", "19-tone (approx)",
  "Harmonic 7-limit", "Gamelan Pelog", "Gamelan Slendro", "Quarter-tone pairs", "Neidhardt",
];

export const TABS = [
  ["osc", "OSCILLATORS"], ["mix", "MIXER·FILTER"], ["env", "ENVELOPES"], ["lfo", "LFO"], ["mod", "MOD MATRIX"],
  ["voice", "VOICE"], ["fx", "EFFECTS"], ["arp", "ARP·CLOCK"], ["set", "SETTINGS"],
];

export const P = [];
let TAB = "osc", SEC = "";
export const sec = (tab, title) => { TAB = tab; SEC = title; };

function add(o) {
  if (P.some((p) => p.key === o.key)) throw new Error("duplicate key " + o.key);
  const p = { tab: TAB, sec: SEC, direct: false, fmt: "val", tip: "", ...o };
  P.push(p);
  return p;
}
// lin: n steps between min and max (odd for a true centre)
const lin = (key, name, min, max, def, steps, fmt = "val", o = {}) => add({ key, name, curve: "lin", min, max, def, steps, fmt, ...o });
const int = (key, name, min, max, def, fmt = "int", o = {}) => add({ key, name, curve: "int", min, max, def, steps: max - min + 1, fmt, ...o });
const sel = (key, name, opts, def = 0, o = {}) => add({ key, name, curve: "int", min: 0, max: opts.length - 1, def, steps: opts.length, fmt: opts, ...o });
const tog = (key, name, def = 0, o = {}) => add({ key, name, curve: "int", min: 0, max: 1, def, steps: 2, fmt: ["off", "on"], kind: "tog", ...o });
const direct = (key, name, min, max, def, fmt, o = {}) => add({ key, name, curve: "lin", min, max, def, steps: 0, direct: true, fmt, ...o });
// the Peak's 0..127 knobs, held at 64 steps (6 bits) so the whole instrument fits 63 slots;
// the GUI still prints 0..127 (every second value), the DSP works on the normalised position.
const k127 = (key, name, def, o = {}) => lin(key, name, 0, 127, def, 64, "n127", o);
// 0..127 at full resolution (the controls that matter most for fine playing)
const f127 = (key, name, def, o = {}) => int(key, name, 0, 127, def, "n127", o);

// ===================================================================== performance (direct)
sec("set", "Performance");
direct("VOL", "Master Volume", 0, 1, 0.75, "pct", { tip: "Master volume (front panel MASTER knob)." });
direct("WHEEL_MOD", "Mod Wheel", 0, 1, 0, "pct", { tip: "Mod wheel (also MIDI CC1). Matrix source ModWheel." });
direct("WHEEL_BEND", "Pitch Wheel", -1, 1, 0, "bip", { tip: "Pitch wheel (also MIDI pitch bend). Range = each oscillator's BendRange. Matrix sources BndWhl+/-." });
direct("EXPR1", "Expression Pedal 1", 0, 1, 0, "pct", { tip: "Pedal 1 / expression (also MIDI CC11). Matrix source ExprPED1." });
direct("EXPR2", "Expression Pedal 2", 0, 1, 0, "pct", { tip: "Pedal 2 / breath (also MIDI CC2). Matrix source BrthPED2." });
lin("AFTERT", "Aftertouch", 0, 1, 0, 33, "pct", { tip: "Manual aftertouch (adds to MIDI channel/poly pressure). Matrix source AftTouch." });
lin("CVIN", "CV Mod In", -1, 1, 0, 33, "bip", { tip: "Emulates the rear CV MOD input (adds to the instrument's audio input, low-passed). Matrix source CV +/-." });
int("ANIM", "Animate", 0, 7, 0, "bits", { tip: "bit0 Animate 1 · bit1 Animate 2 · bit2 Hold (latches the Animate buttons)." });

// ===================================================================== oscillators
const OSC_RANGES = ["16'", "8'", "4'", "2'"];
const SHAPE_SRC = ["Manual", "Mod Env 1", "LFO 1"];
const WAVES = ["Sine", "Triangle", "Saw", "Pulse", "more"];
for (const n of [1, 2, 3]) {
  const o = `O${n}_`;
  sec("osc", `Oscillator ${n}`);
  sel(o + "RANGE", "Range", OSC_RANGES, 1, { tip: "Organ-stop range. 8' = concert pitch (A3 = 440 Hz)." });
  lin(o + "COARSE", "Coarse", -12, 12, 0, 49, "st", { tip: "Pitch ±1 octave (half-semitone steps; use Fine for the rest)." });
  lin(o + "FINE", "Fine", -100, 100, 0, 101, "ct", { tip: "Pitch ±100 cents." });
  sel(o + "WAVE", "Wave", WAVES, 2, { tip: "Sine / triangle / sawtooth / pulse, or 'more' = one of the wavetables." });
  add({ key: o + "MORE", name: "WaveMore", curve: "int", min: 0, max: WAVETABLES.length - 1, def: 0, steps: WAVETABLES.length, fmt: "wt", tip: "Wavetable used when Wave = more (Shape Amount sweeps the five waveforms of the table)." });
  lin(o + "ENV2", "Mod Env 2 Depth", -63, 63, 0, 65, "sgn", { tip: "Pitch modulation by Mod Envelope 2." });
  lin(o + "LFO2", "LFO 2 Depth", -127, 127, 0, 129, "sgn", { tip: "Pitch modulation by LFO 2 (finer resolution at low values)." });
  sel(o + "SRC", "Shape Source", SHAPE_SRC, 0, { tip: "Which of the three additive shape sources the SHAPE AMOUNT knob edits (all three always act)." });
  int(o + "SHAPE", "Shape: Manual", -63, 63, 0, "sgn", { tip: "Manual shape: PW on pulse, distortion on sine, symmetry on triangle, fold/pulse on saw, position in the table on 'more'." });
  lin(o + "SHENV", "Shape: Mod Env 1", -63, 63, 0, 65, "sgn", { tip: "Mod Env 1 → shape." });
  lin(o + "SHLFO", "Shape: LFO 1", -63, 63, 0, 65, "sgn", { tip: "LFO 1 → shape." });
  f127(o + "VSYNC", "Vsync", 0, { tip: "Virtual-oscillator hard sync. Multiples of 16 are musical harmonics." });
  k127(o + "SAWD", "SawDense", 0, { tip: "Two extra detuned virtual saws (sawtooth only)." });
  k127(o + "DDET", "DenseDet", 64, { tip: "Detune of the density saws." });
  add({ key: o + "FIXED", name: "FixedNote", curve: "int", min: 0, max: 88, def: 0, steps: 89, fmt: "fixnote", tip: "Off, or every key plays this single note (C#-2 … E5)." });
  int(o + "BEND", "BendRange", -24, 24, 12, "st", { tip: "Pitch-wheel range in semitones (negative reverses)." });
}
sec("osc", "Oscillator common");
k127("DIVERGE", "Diverge", 0, { tip: "Tiny fixed per-voice tuning differences." });
k127("DRIFT", "Drift", 0, { tip: "Very slow meandering detune of all 24 oscillators." });
k127("NOISELPF", "Noise LPF", 127, { tip: "Low-pass filter on the noise generator." });
tog("KEYSYNC", "KeySync", 0, { tip: "Oscillators restart their cycle at every key-on." });
int("TUNING", "Tuning Table", 0, 16, 0, "tuning", { tip: "0 = equal temperament; 1-16 factory alternative tunings." });

// ===================================================================== mixer
sec("mix", "Mixer");
lin("MIX1", "Osc 1", 0, 255, 255, 128, "n255", { tip: "Oscillator 1 level." });
lin("MIX2", "Osc 2", 0, 255, 0, 128, "n255");
lin("MIX3", "Osc 3", 0, 255, 0, 128, "n255");
lin("MIXR", "Ring 1*2", 0, 255, 0, 128, "n255", { tip: "Ring modulator (oscillators 1 × 2)." });
lin("MIXN", "Noise", 0, 255, 0, 128, "n255");
f127("VCAGAIN", "VCA Gain", 127, { tip: "Mixer output level, before overdrive / filter / amp envelope." });
lin("PATCHLVL", "Patch Level", 0, 128, 64, 65, "n127", { tip: "Per-patch level trim (0 = half, 127 = double)." });

// ===================================================================== filter
sec("mix", "Filter");
sel("F_SHAPE", "Shape", ["LP", "BP", "HP"], 0);
sel("F_SLOPE", "Slope", ["12 dB", "24 dB"], 1);
lin("F_FREQ", "Frequency", 0, 255, 255, 256, "n255", { tip: "Cut-off / centre frequency." });
f127("F_RES", "Resonance", 0);
sel("F_ENVSEL", "Env Source", ["Amp Env", "Mod Env 1"], 1, { tip: "Which envelope the ENV DEPTH knob edits (both always act)." });
lin("F_ENVAMP", "Env Depth: Amp Env", -63, 63, 0, 65, "sgn", { tip: "Amp envelope → filter frequency (±8 octaves)." });
lin("F_ENVMOD", "Env Depth: Mod Env 1", -63, 63, 0, 65, "sgn", { tip: "Mod envelope 1 → filter frequency (±8 octaves)." });
lin("F_LFO1", "LFO 1 Depth", -127, 127, 0, 129, "sgn", { tip: "LFO 1 → filter frequency (±8 octaves)." });
k127("F_OSC3", "Osc 3 Filter Mod", 0, { tip: "Oscillator 3 audio frequency-modulates the filter." });
f127("F_OD", "Overdrive", 0, { tip: "Analogue-style drive BEFORE the filter." });
f127("F_KEY", "Key Tracking", 127, { tip: "127 = filter follows pitch 1:1." });
k127("F_POST", "Filter Post Drive", 0, { tip: "Distortion after the filter, before the amplifier." });
k127("F_DIV", "Filter Divergence", 0, { tip: "Per-voice filter mistuning (poor-calibration emulation)." });

// ===================================================================== envelopes
sec("env", "Envelopes");
const ENV = [["A", "Amp"], ["M1", "Mod 1"], ["M2", "Mod 2"]];
for (const [e, nm] of ENV) {
  const dA = e === "A" ? 2 : 2;
  f127(`E${e}_A`, `${nm} Attack`, dA);
  f127(`E${e}_D`, `${nm} Decay`, e === "A" ? 90 : 75);
  f127(`E${e}_S`, `${nm} Sustain`, e === "A" ? 127 : 35);
  f127(`E${e}_R`, `${nm} Release`, e === "A" ? 40 : 45);
  lin(`E${e}_VEL`, `${nm} Velocity`, -64, 64, 0, 65, "sgn", { tip: "Velocity sensitivity (negative = inverse)." });
  sel(`E${e}_TRIG`, `${nm} MonoTrig`, ["Legato", "Re-Trig"], e === "A" ? 0 : 1, { tip: "Mono modes only: Re-Trig restarts the envelope on every note." });
  k127(`E${e}_HOLD`, `${nm} Hold`, 0, { fmt: "hold", tip: "Hold stage between attack and decay (0-500 ms)." });
  int(`E${e}_REP`, `${nm} Repeats`, 0, 31, 0, "rep", { tip: "Attack-hold-decay repeats before sustain. Off, 1-30, On (31 = loop until key-up)." });
}
sel("ENV_SEL", "Mod Envelope Select", ["Mod 1", "Mod 2"], 0, { tip: "Which modulation envelope the sliders edit." });

// ===================================================================== LFOs
sec("lfo", "LFOs");
const LTYPE = ["Triangle", "Sawtooth", "Square", "S&H"];
const LFADE = ["FadeIn", "FadeOut", "GateIn", "GateOut"];
for (const l of [1, 2]) {
  const q = `L${l}_`;
  sel(q + "TYPE", `LFO ${l} Type`, LTYPE, 0);
  sel(q + "RANGE", `LFO ${l} Range`, ["Low", "High", "Sync"], 0, { tip: "Low 0-200 Hz · High 0-1.6 kHz · Sync = tempo divisions." });
  lin(q + "RATE", `LFO ${l} Rate`, 0, 255, l === 1 ? 127 : 128, 128, "n255");
  add({ key: q + "SYNC", name: `LFO ${l} RateSync`, curve: "int", min: 0, max: 34, def: 16, steps: 35, fmt: LFO_SYNC.map((x) => x[0]), tip: "Tempo division when Range = Sync." });
  lin(q + "FADE", `LFO ${l} Fade Time`, 0, 127, 0, 64, "n127");
  sel(q + "FMODE", `LFO ${l} FadeMode`, LFADE, 0);
  tog(q + "FSYNC", `LFO ${l} FadeSync`, 1, { tip: "Mono: restart the fade on every key (on) or only the first (off)." });
  int(q + "PHASE", `LFO ${l} Phase`, 0, 60, 0, "phase", { tip: "Free, or restart at a fixed phase on every key (6° steps)." });
  sel(q + "MONO", `LFO ${l} MonoTrig`, ["Legato", "Re-Trig"], 0);
  k127(q + "SLEW", `LFO ${l} Slew`, 0);
  int(q + "REP", `LFO ${l} Repeats`, 0, 31, 0, "rep", { tip: "Number of LFO cycles per key (Off = continuous)." });
  tog(q + "COMMON", `LFO ${l} Common`, 0, { tip: "Polyphonic: all voices share one LFO phase." });
}
for (const l of [3, 4]) {
  const q = `L${l}_`;
  sel(q + "WAVE", `LFO ${l} Waveform`, LTYPE, 0);
  k127(q + "RATE", `LFO ${l} Rate`, 64, { tip: "Global (not per-voice) LFO — wide frequency range." });
  add({ key: q + "SYNC", name: `LFO ${l} RateSync`, curve: "int", min: 0, max: 35, def: 0, steps: 36, fmt: ["Off", ...LFO_SYNC.map((x) => x[0])] });
}

// ===================================================================== voice
sec("voice", "Voice");
sel("UNISON", "Unison", ["1", "2", "3", "4", "8"], 0, { tip: "Voices stacked per note (reduces polyphony)." });
k127("UNIDET", "UniDeTune", 25, { tip: "Detune between unison voices." });
k127("UNISPR", "UniSpread", 0, { tip: "Stereo spread of voices (odd left, even right)." });
int("PREGLIDE", "PreGlide", -12, 12, 0, "preglide", { tip: "Each note starts this many semitones away and glides in (needs Glide on)." });
sel("MODE", "Mode", ["Mono", "MonoLG", "Mono2", "Poly", "Poly2"], 3);
k127("GLIDE", "Glide Time", 60, { tip: "Portamento time." });
tog("GLIDE_ON", "Glide On", 0);
int("KBDOCT", "Keyboard Octave", -3, 3, 0, "oct");

// ===================================================================== effects
sec("fx", "FX global");
tog("FX_BYPASS", "FX Bypass", 0, { tip: "Bypasses chorus / delay / reverb (not the analogue distortion)." });
sel("FX_ROUTE", "Routing", FX_ROUTING, 0);
k127("FX_WET", "WetLevel", 127);
k127("FX_DRY", "DryLevel", 127);
sec("fx", "Distortion");
f127("DIST", "Distortion Level", 0, { tip: "Analogue distortion on the sum of all voices (after the VCA, before the FX)." });
sec("fx", "Chorus");
f127("CH_LEVEL", "Level", 0);
sel("CH_TYPE", "Type", ["1", "2", "3"], 1, { tip: "1 = two-tap, 2 = four-tap, 3 = ensemble." });
f127("CH_RATE", "Rate", 20);
k127("CH_DEPTH", "ChorDepth", 64);
int("CH_FB", "ChorFback", -64, 63, 0, "sgn", { tip: "Feedback (negative = phase reversed → flanger)." });
k127("CH_LP", "LoPass", 90);
k127("CH_HP", "HiPass", 2);
sec("fx", "Delay");
f127("DL_LEVEL", "Level", 0);
f127("DL_TIME", "Time", 64, { tip: "0 … ~1.4 s." });
f127("DL_FB", "Feedback", 64);
tog("DL_SYNC", "Sync", 0, { tip: "Time follows tempo (host or ClockRate)." });
add({ key: "DL_SYNCR", name: "DelaySync", curve: "int", min: 0, max: 15, def: 8, steps: 16, fmt: DELAY_SYNC.map((x) => x[0]) });
k127("DL_LP", "LP Damp", 85);
k127("DL_HP", "HP Damp", 0);
sel("DL_LR", "L/R Ratio", LR_RATIOS, 0, { tip: "Left/right time ratio (1/1 = centred echoes)." });
k127("DL_SLEW", "SlewRate", 32, { tip: "How fast the delay time follows changes (low = more pitch-shift)." });
k127("DL_WIDTH", "Width", 127);
sec("fx", "Reverb");
f127("RV_LEVEL", "Level", 0);
sel("RV_TYPE", "Type", ["1", "2", "3"], 1, { tip: "Sets the size to small / medium / large." });
f127("RV_TIME", "Time", 90);
int("RV_PRE", "PreDelay", 1, 127, 40, "n127", { tip: "0 … ~0.5 s." });
k127("RV_LP", "LP Damp", 50);
k127("RV_HP", "HP Damp", 1);
k127("RV_SIZE", "RevSize", 64);
k127("RV_MOD", "ModDepth", 64);
k127("RV_MODR", "ModRate", 4);
k127("RV_LOP", "LoPass", 74);
k127("RV_HIP", "HiPass", 0);
sec("fx", "FX modulation matrix");
for (let s = 1; s <= 4; s++) {
  sel(`FM${s}_A`, `Slot ${s} Source A`, FXMOD_SRC, 0);
  sel(`FM${s}_B`, `Slot ${s} Source B`, FXMOD_SRC, 0);
  sel(`FM${s}_DEST`, `Slot ${s} Destination`, FXMOD_DEST, 0);
  lin(`FM${s}_DEPTH`, `Slot ${s} Depth`, -64, 64, 0, 65, "sgn");
}

// ===================================================================== arp / clock
sec("arp", "Arpeggiator");
tog("ARP_ON", "Arp On", 0);
tog("ARP_LATCH", "Key Latch", 0);
k127("ARP_GATE", "Gate", 64);
int("ARP_BPM", "ClockRate", 40, 240, 120, "bpm");
sel("ARP_SRC", "Clock Source", CLOCK_SRC, 0, { tip: "Auto/Ext-Auto/MIDI/USB follow the host tempo when it reports one; Internal always uses ClockRate." });
sel("ARP_TYPE", "Type", ARP_TYPES, 0);
int("ARP_RHYTHM", "Rhythm", 1, 33, 1, "int", { tip: "33 rhythm patterns." });
int("ARP_OCT", "Octaves", 1, 6, 1, "int");
int("ARP_SWING", "Swing", 20, 80, 50, "int");
add({ key: "ARP_SYNC", name: "SyncRate", curve: "int", min: 0, max: 18, def: 15, steps: 19, fmt: ARP_SYNC.map((x) => x[0]) });
tog("ARP_KSYNC", "KeySync", 0, { tip: "Latch mode: restart the pattern when new keys are pressed." });

// ===================================================================== settings
sec("set", "Settings");
lin("VELSHAPE", "VelShape", 0, 128, 64, 65, "n127", { tip: "Velocity curve (64 = linear)." });
int("TUNECENTS", "TuneCents", -50, 50, 0, "ct");
int("TRANSPOSE", "Transpose", -12, 12, 0, "st", { tip: "Shifts incoming MIDI notes (not the oscillator tuning)." });
sel("VOLRANGE", "VolRange", ["0 dB", "-3 dB", "-6 dB"], 0);

// ===================================================================== modulation matrix (16 slots)
sec("mod", "Modulation matrix");
export const MOD_SLOTS = 16;
for (let s = 1; s <= MOD_SLOTS; s++) {
  sel(`MM${s}_A`, `Slot ${s} Source A`, MOD_SRC, 0);
  sel(`MM${s}_B`, `Slot ${s} Source B`, MOD_SRC, 0);
  sel(`MM${s}_DEST`, `Slot ${s} Destination`, MOD_DEST, 0);
  int(`MM${s}_DEPTH`, `Slot ${s} Depth`, -64, 63, 0, "sgn", { tip: "Both sources multiply; Direct = constant 1." });
}
