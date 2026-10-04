// =====================================================================
//  CATACLYSM — logical parameter table (single source of truth).
//
//  The host gives a plugin 64 float slots (63 usable: slot 63 is the host
//  tempo). Cataclysm has ~250 controls, so build.mjs PACKS them: every
//  logical parameter is a small integer with its own number of STEPS, and
//  several of them share one slot using mixed-radix packing
//        slot = Σ raw_i · Π_{j<i} steps_j        (product ≤ 2^24)
//  Integers up to 2^24 are exact in float32 and the host maps a slot to
//  0..1 as value/max, so with max = 2^24 (a power of two) the round trip
//  through the DAW is exact. A handful of performance controls are DIRECT
//  slots (full float, real DAW automation): the four macros + output level.
//
//  curve:  lin  actual = min + n·(max-min)        n = raw/(steps-1)
//          exp  actual = min·(max/min)^n
//          int  actual = min + raw                (steps = max-min+1)
//  fmt (GUI display): hz ms s db st ct pct x oct val int ratio  or a name list
// =====================================================================

export const SLOT_CAP = 2 ** 24;          // product of steps per slot (exact in float32)
export const SLOT_MAX = SLOT_CAP;         // host-visible max of every packed slot
export const MAX_SLOTS = 63;              // 0..62 (63 = host tempo)

export const TABS = [
  ["hit", "HIT"], ["tone", "TONE"], ["fm", "FM"], ["modal", "MODAL"], ["noise", "NOISE"],
  ["metal", "METAL"], ["click", "CLICK·X"], ["mod", "MOD"], ["drive", "DRIVE"],
  ["filter", "FILTER·COMB"], ["eqdyn", "EQ·COMP"], ["space", "SPACE·OUT"],
];

// Layer mixer shown in the header on every tab: [prefix, title, colour]
export const LAYERS = [
  ["T", "TONE", "#ff4a3d"], ["F", "FM", "#ff8a2b"], ["M", "MODAL", "#ffc233"],
  ["N", "NOISE", "#7ee06a"], ["X", "METAL", "#37d0e6"], ["C", "CLICK", "#b07bff"],
];

export const MOD_SRC = ["Off", "Velocity", "Key", "Random", "Env A", "Env B", "LFO 1", "LFO 2",
  "Mod Wheel", "Pressure", "Pitch Bend", "Ratchet #", "Macro 1", "Macro 2", "Macro 3", "Macro 4"];
export const MOD_SLOTS = 8;
export const LFO_SHAPES = ["Sine", "Tri", "Saw", "Square", "S&H", "Noise"];
export const SYNC_DIV = ["Free", "1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T", "1/32T"];
export const DIST_TYPES = ["Off", "Soft", "Hard", "Fold", "Diode", "Tube", "Rectify", "Cheby", "Sine", "Fuzz"];

export const P = [];                       // ordered logical parameters
let TAB = "hit", SEC = "";
export const sec = (tab, title) => { TAB = tab; SEC = title; };

// Fine-resolution controls keep every step; the rest are thinned so 250+ values fit.
const PRECISE = new Set(["T_PITCH", "M_PITCH", "TUNE", "X_FREQ", "F_FREQ", "CB_FREQ", "T_PE1_AMT"]);
function add(o) {
  if (P.some((p) => p.key === o.key)) throw new Error("duplicate key " + o.key);
  const p = { tab: TAB, sec: SEC, mod: false, direct: false, fmt: "val", tip: "", ...o };
  if (!p.direct && p.curve !== "int" && p.steps >= 90 && !PRECISE.has(p.key)) {
    p.steps = Math.round(p.steps * 0.8);
    if (p.min < 0 && p.max > 0 && p.steps % 2 === 0) p.steps++;
  }
  P.push(p);
  return p;
}
const odd = (n) => (n % 2 === 0 ? n + 1 : n);

// level in dB; the minimum is true silence
const lvl = (key, name, def, o = {}) => add({ key, name, curve: "lin", min: -60, max: 12, def, steps: 73, fmt: "db", silent: true, mod: true, ...o });
const pan = (key, name, def = 0, o = {}) => add({ key, name, curve: "lin", min: -1, max: 1, def, steps: 41, fmt: "pan", ...o });
const amt = (key, name, def, o = {}) => add({ key, name, curve: "lin", min: 0, max: 1, def, steps: 33, fmt: "pct", ...o });
const bip = (key, name, def, o = {}) => add({ key, name, curve: "lin", min: -1, max: 1, def, steps: 65, fmt: "bip", ...o });
const lin = (key, name, min, max, def, steps, fmt = "val", o = {}) => add({ key, name, curve: "lin", min, max, def, steps, fmt, ...o });
const exp = (key, name, min, max, def, steps, fmt = "hz", o = {}) => add({ key, name, curve: "exp", min, max, def, steps, fmt, ...o });
const int = (key, name, min, max, def, fmt = "int", o = {}) => add({ key, name, curve: "int", min, max, def, steps: max - min + 1, fmt, ...o });
const sel = (key, name, opts, def = 0, o = {}) => add({ key, name, curve: "int", min: 0, max: opts.length - 1, def, steps: opts.length, fmt: opts, ...o });
const tog = (key, name, def = 0, o = {}) => add({ key, name, curve: "int", min: 0, max: 1, def, steps: 2, fmt: ["off", "on"], kind: "tog", ...o });
const direct = (key, name, min, max, def, fmt, o = {}) => add({ key, name, curve: "lin", min, max, def, steps: 0, direct: true, fmt, ...o });

// A layer's amplitude envelope: attack, decay (T60), curve, tail level + time
function ampEnv(p, decDef, o = {}) {
  exp(`${p}_ATT`, "Attack", 0.01, 200, 0.01, 61, "ms", { tip: "Fade-in. 0.01 ms = instant." });
  exp(`${p}_DEC`, "Decay", 2, 12000, decDef, 161, "ms", { mod: true, tip: "Time to fall 60 dB." });
  lin(`${p}_CRV`, "Curve", -1, 1, 0, 21, "bip", { tip: "<0 snaps down then lingers; >0 holds then drops (gate-like)." });
  lvl(`${p}_TAIL`, "Tail", -60, { max: 0, steps: 31, mod: false, tip: "Second, slower decay layered under the main one (the 'boom')." });
  exp(`${p}_TAILT`, "Tail Time", 20, 20000, 1500, 81, "ms");
}

// ───────────────────────── HIT ─────────────────────────────────────────────
sec("hit", "TRIGGER");
int("ROOT", "Root Note", 12, 72, 36, "note", { tip: "The MIDI note that plays every layer at its set pitch." });
lin("TUNE", "Master Tune", -24, 24, 0, 193, "st", { tip: "Transposes every layer." });
int("BEND", "Bend Range", 0, 24, 2, "int");
int("POLY", "Voices", 1, 4, 2, "int", { tip: "1 = mono (each hit chokes the last)." });
sel("GATE", "Note-Off", ["one-shot", "gate"], 0, { tip: "Gate: releasing the key fades the hit." });
exp("REL", "Release", 1, 2000, 40, 97, "ms");
amt("HUMAN", "Humanize", 0, { steps: 33, tip: "Random pitch / decay / level / detune per hit." });
sec("hit", "VELOCITY");
amt("VEL_AMP", "→ Level", 0.7, { steps: 33 });
lin("VEL_PITCH", "→ Pitch", 0, 24, 0, 49, "st");
bip("VEL_DEC", "→ Decay", 0, { steps: 33 });
bip("VEL_BRT", "→ Bright", 0, { steps: 33, tip: "Opens filters, boosts click / FM index / drive with velocity." });
sec("hit", "RATCHET · FLAM · ROLL");
int("RAT_N", "Repeats", 1, 32, 1, "int", { tip: "Re-fires the whole hit this many times." });
sel("RAT_SYNC", "Rate Sync", ["free", "1/8", "1/16", "1/32", "1/64", "1/8T", "1/16T", "1/32T"], 0, { tip: "Locks repeats to the DAW tempo." });
exp("RAT_TIME", "Spacing", 1.5, 500, 60, 145, "ms", { tip: "Down to 1.5 ms the repeats fuse into a buzzing pitch." });
bip("RAT_VEL", "Level Slope", -0.2, { steps: 41 });
lin("RAT_PITCH", "Pitch Step", -12, 12, 0, 97, "st", { tip: "Added per repeat: rising or falling rolls." });
amt("RAT_RAND", "Time Jitter", 0, { steps: 33 });
amt("RAT_PROB", "Probability", 1, { steps: 33 });
sec("hit", "MACROS (AUTOMATABLE)");
direct("MAC1", "Macro 1", 0, 1, 0, "pct", { tip: "A real DAW parameter. Route it anywhere in the MOD matrix." });
direct("MAC2", "Macro 2", 0, 1, 0, "pct");
direct("MAC3", "Macro 3", 0, 1, 0, "pct");
direct("MAC4", "Macro 4", 0, 1, 0, "pct");

// ───────────────────────── TONE ────────────────────────────────────────────
sec("tone", "OSCILLATOR");
lvl("T_LEV", "Tone", 0);
pan("T_PAN", "Tone Pan");
lin("T_SHAPE", "Shape", 0, 3, 0, 91, "wave", { mod: true, tip: "Sine → triangle → saw → square (continuous)." });
lin("T_PW", "Pulse Width", 0.02, 0.5, 0.5, 33, "pct", { tip: "Narrows the square part." });
amt("T_FOLD", "Fold", 0, { mod: true, steps: 49, tip: "Wavefolder: up to 8 folds." });
lin("T_FB", "Feedback", 0, 2, 0, 65, "val", { mod: true, tip: "Oscillator phase feedback: sine → raspy → noise." });
tog("T_SYNC", "Hard Sync");
exp("T_SYNCR", "Sync Ratio", 1, 16, 2.5, 97, "x", { tip: "Slave/master ratio; sweep it with the pitch envelope for a screaming tone." });
lvl("T_SUB", "Sub", -60, { max: 6, steps: 67, mod: false });
sel("T_SUBOCT", "Sub Octave", ["-1", "-2"], 0);
sec("tone", "PITCH");
exp("T_PITCH", "Pitch", 8, 8000, 52, 801, "hz", { mod: true, tip: "Frequency at the Root Note." });
lin("T_KT", "Key Track", 0, 1.5, 1, 4, "kt");
lin("T_PE1_AMT", "Env 1 Amt", -120, 120, 30, 481, "st", { mod: true, tip: "Pitch envelope 1: starts this many semitones away, glides home." });
exp("T_PE1_TIME", "Env 1 Time", 0.1, 4000, 80, 201, "ms", { mod: true });
lin("T_PE1_CRV", "Env 1 Curve", -1, 1, 0, 21, "bip");
lin("T_PE2_AMT", "Env 2 Amt", -120, 120, 0, 241, "st", { mod: true, tip: "Second, slower pitch envelope (the 'sigh')." });
exp("T_PE2_TIME", "Env 2 Time", 0.1, 4000, 400, 161, "ms");
lin("T_TENS", "Tension", 0, 24, 0, 49, "st", { mod: true, tip: "Membrane tension modulation: pitch rises with amplitude, settles as the head rings down." });
sec("tone", "AMP ENVELOPE");
ampEnv("T", 380);

// ───────────────────────── FM ──────────────────────────────────────────────
sec("fm", "OPERATORS");
lvl("F_LEV", "FM", -60);
pan("F_PAN", "FM Pan");
exp("F_FREQ", "Carrier", 20, 8000, 180, 361, "hz", { mod: true });
lin("F_KT", "Key Track", 0, 1.5, 1, 4, "kt");
amt("F_FOLLOW", "Follow Tone Env", 1, { steps: 33, tip: "How much of Tone pitch envelope 1 the carrier inherits." });
exp("F_MRATIO", "Mod Ratio", 0.125, 32, 1.41, 241, "ratio", { mod: true, tip: "Non-integer ratios give bells, clanks and toms." });
lin("F_DET", "Mod Detune", -100, 100, 0, 101, "ct");
sel("F_MWAVE", "Mod Wave", ["sine", "tri", "square", "noise"], 0);
sel("F_MODE", "Mode", ["FM", "ring", "AM"], 0);
sec("fm", "INDEX");
lin("F_IDX", "Index", 0, 48, 3, 97, "val", { mod: true, tip: "Modulation depth in radians. Beyond ~10 it is pure noise-like grit." });
exp("F_IDXT", "Index Decay", 0.5, 4000, 90, 161, "ms", { mod: true });
lin("F_IDXC", "Index Curve", -1, 1, 0, 21, "bip");
lin("F_FB", "Feedback", 0, 2, 0, 65, "val", { mod: true });
sec("fm", "AMP ENVELOPE");
exp("F_ATT", "Attack", 0.01, 200, 0.01, 61, "ms");
exp("F_DEC", "Decay", 2, 12000, 250, 161, "ms", { mod: true });
lin("F_CRV", "Curve", -1, 1, 0, 21, "bip");

// ───────────────────────── MODAL ───────────────────────────────────────────
sec("modal", "RESONATOR");
lvl("M_LEV", "Modal", -60);
amt("M_WIDTH", "Stereo Spread", 0.5, { steps: 33, tip: "Alternate modes are panned left / right." });
exp("M_PITCH", "Pitch", 15, 4000, 180, 601, "hz", { mod: true, tip: "Lowest mode." });
lin("M_KT", "Key Track", 0, 1.5, 1, 4, "kt");
amt("M_FOLLOW", "Follow Tone Env", 0, { steps: 33 });
lin("M_MAT", "Material", 0, 5, 1, 126, "mat", { mod: true, tip: "String · Membrane · Plate · Bar · Bell · Junk — morphs continuously." });
lin("M_STR", "Stretch", -0.5, 1.5, 0, 81, "val", { mod: true, tip: "Inharmonicity: >0 spreads the modes apart (stiffer), <0 squeezes them." });
int("M_NUM", "Modes", 1, 12, 8, "int");
sec("modal", "DAMPING");
exp("M_DEC", "Decay", 5, 20000, 300, 201, "ms", { mod: true, tip: "Ring time of the lowest mode." });
lin("M_TILT", "Damping Tilt", -1, 3, 1, 81, "val", { mod: true, tip: "Higher modes die faster (>0, wood and skin) or ring longer (<0, metal)." });
sec("modal", "EXCITATION");
lin("M_POS", "Strike Pos", 0, 1, 0.3, 65, "pct", { mod: true, tip: "Where the stick lands: nodes of modes cancel them." });
lin("M_BRT", "Brightness", -1, 3, 0.6, 81, "val", { mod: true, tip: "Tilt of the excitation spectrum across the modes." });
lin("M_SPREAD", "Detune Spread", 0, 200, 0, 65, "ct", { tip: "Random detune per mode per hit." });
amt("M_EXCN", "Exciter Noise", 0.2, { steps: 33, tip: "0 = a single impulse (stick), 1 = a noise burst (brush)." });
exp("M_EXCL", "Exciter Length", 0.05, 30, 1, 101, "ms");
exp("M_EXCLP", "Exciter Tone", 100, 20000, 6000, 97, "hz");
sec("modal", "NONLINEARITY");
lin("M_TENS", "Tension", 0, 36, 0, 73, "st", { mod: true, tip: "Pitch rises with the resonator's amplitude (real membranes do this)." });
amt("M_NL", "Saturation", 0, { steps: 33, tip: "Soft-clips the mode sum: spreads energy between modes." });

// ───────────────────────── NOISE ───────────────────────────────────────────
sec("noise", "SOURCE");
lvl("N_LEV", "Noise", -60);
pan("N_PAN", "Noise Pan");
amt("N_WIDTH", "Stereo Width", 0.5, { steps: 33, tip: "Decorrelates left and right noise." });
sel("N_TYPE", "Colour", ["white", "pink", "brown", "blue", "dust", "S&H", "crackle"], 0);
exp("N_RATE", "Rate / Density", 20, 20000, 6000, 97, "hz", { tip: "S&H clock, dust density, crackle speed." });
sec("noise", "FILTER");
lin("N_MODE", "Mode", 0, 2, 1, 65, "fmode", { mod: true, tip: "Low-pass → band-pass → high-pass." });
exp("N_CUT", "Cutoff", 20, 20000, 3000, 241, "hz", { mod: true });
amt("N_RES", "Resonance", 0.2, { steps: 49, mod: true, tip: "Up to Q = 200: the filter rings like a tuned metal plate." });
tog("N_SLOPE", "24 dB", 0);
lin("N_KT", "Key Track", 0, 1.5, 0, 4, "kt");
lin("N_FE_AMT", "Env Amount", -8, 8, 0, 65, "oct", { mod: true });
exp("N_FE_TIME", "Env Time", 1, 4000, 100, 129, "ms");
sec("noise", "AMP ENVELOPE");
ampEnv("N", 150);
sec("noise", "GATE · CLAP BURSTS");
sel("N_GATE", "Gate Mode", ["normal", "clap", "rattle"], 0, { tip: "Clap: stuttering bursts then a tail. Rattle: snare wires that buzz only while the modal body rings." });
int("N_BN", "Bursts", 1, 16, 4, "int");
exp("N_BSP", "Spacing", 0.5, 80, 9, 97, "ms");
amt("N_BJIT", "Jitter", 0.25, { steps: 33 });
exp("N_BLEN", "Burst Decay", 0.3, 60, 6, 97, "ms");
bip("N_BSLOPE", "Burst Slope", 0.2, { steps: 33 });
amt("N_RAT", "Rattle Depth", 0.7, { steps: 33 });

// ───────────────────────── METAL ───────────────────────────────────────────
sec("metal", "OSCILLATOR CLUSTER");
lvl("X_LEV", "Metal", -60);
pan("X_PAN", "Metal Pan");
exp("X_FREQ", "Base Freq", 20, 4000, 330, 361, "hz", { mod: true });
lin("X_KT", "Key Track", 0, 1.5, 0.5, 4, "kt");
lin("X_SET", "Ratio Set", 0, 5, 0, 126, "mset", { mod: true, tip: "808 · classic 2/3/4.16/5.43/6.79/8.21 · harmonic · fifths · cluster · chaos." });
lin("X_SPREAD", "Spread", 0.25, 2.5, 1, 91, "val", { mod: true, tip: "Compresses (<1) or expands (>1) the ratios around their centre." });
lin("X_PW", "Pulse Width", 0.05, 0.5, 0.5, 46, "pct");
amt("X_RING", "Ring Mix", 0, { steps: 49, mod: true, tip: "Crossfades the summed oscillators into pairwise ring-modulated products." });
amt("X_FOLD", "Fold", 0, { steps: 49, mod: true });
amt("X_SHM", "Shimmer", 0, { steps: 33, tip: "Random-walk drift of every oscillator: cymbal shimmer." });
sec("metal", "FILTER");
exp("X_BPF", "Band Centre", 400, 18000, 8000, 241, "hz", { mod: true });
exp("X_BPQ", "Band Q", 0.3, 30, 2, 65, "val");
exp("X_HPF", "High-Pass", 50, 16000, 5000, 193, "hz", { mod: true });
amt("X_BAND", "Band ↔ High", 0.5, { steps: 33 });
lin("X_FE_AMT", "Env Amount", -6, 6, 0, 49, "oct");
exp("X_FE_TIME", "Env Time", 1, 4000, 80, 97, "ms");
sec("metal", "PITCH");
lin("X_PE_AMT", "Env Amount", -48, 48, 0, 193, "st");
exp("X_PE_TIME", "Env Time", 0.1, 2000, 30, 97, "ms");
sec("metal", "AMP ENVELOPE");
ampEnv("X", 80);

// ───────────────────────── CLICK · CROSS ───────────────────────────────────
sec("click", "CLICK / BEATER");
lvl("C_LEV", "Click", -16);
pan("C_PAN", "Click Pan");
sel("C_TYPE", "Type", ["impulse", "noise", "ping", "chirp", "tick", "thud"], 1, { tip: "The transient: DC impulse, noise burst, pinged sine, falling chirp, filtered tick, felt thud." });
exp("C_FREQ", "Frequency", 100, 16000, 3000, 193, "hz", { mod: true });
exp("C_LEN", "Length", 0.02, 20, 1, 101, "ms");
tog("C_INV", "Invert");
sec("click", "CROSS-MODULATION");
amt("X_NFM", "Noise → Tone FM", 0, { steps: 33, tip: "Noise phase-modulates the tone oscillator: snare-like rasp, zaps." });
amt("X_MRM", "Metal × Tone", 0, { steps: 49, tip: "Ring-modulates the tone oscillator with the metal cluster." });
lin("X_TFC", "Tone → Noise Cutoff", 0, 4, 0, 33, "oct", { tip: "Audio-rate filter FM: the tone sweeps the noise filter." });
amt("X_TFM", "Tone → Metal FM", 0, { steps: 33 });
sec("click", "RESONATOR SENDS (INTO MODAL)");
lin("S_CLK", "Click →", 0, 2, 1, 41, "val", { tip: "How hard each layer excites the modal resonator." });
lin("S_NOI", "Noise →", 0, 2, 0, 41, "val");
lin("S_TONE", "Tone →", 0, 2, 0, 41, "val");
lin("S_MET", "Metal →", 0, 2, 0, 41, "val");
lin("S_FM", "FM →", 0, 2, 0, 41, "val");

// ───────────────────────── MOD ─────────────────────────────────────────────
for (const n of [1, 2]) {
  sec("mod", `LFO ${n}`);
  sel(`L${n}_SHAPE`, "Shape", LFO_SHAPES, 0);
  exp(`L${n}_RATE`, "Rate", 0.05, 200, 4, 161, "hz");
  sel(`L${n}_SYNC`, "Sync", SYNC_DIV, 0);
  tog(`L${n}_RETRIG`, "Retrigger", 1);
}
for (const n of ["A", "B"]) {
  sec("mod", `ENV ${n}`);
  exp(`E${n}_ATT`, "Attack", 0.1, 2000, 0.1, 81, "ms");
  exp(`E${n}_DEC`, "Decay", 1, 8000, 200, 129, "ms");
  lin(`E${n}_CRV`, "Curve", -1, 1, 0, 21, "bip");
}
sec("mod", "MODULATION MATRIX");
for (let i = 1; i <= MOD_SLOTS; i++) {
  sel(`MX${i}_SRC`, "Source", MOD_SRC, 0, { kind: "mx" });
  add({ key: `MX${i}_DST`, name: "Target", curve: "int", min: 0, max: 63, def: 0, steps: 64, fmt: "dst", kind: "mx" });
  bip(`MX${i}_AMT`, "Amount", 0.5, { steps: 65, kind: "mx" });
}

// ───────────────────────── DRIVE ───────────────────────────────────────────
sec("drive", "TRANSIENT SHAPER");
lin("TS_ATK", "Attack", -30, 30, 0, 121, "db", { mod: true, tip: "Boost or squash the first few ms of each hit." });
lin("TS_SUS", "Sustain", -30, 30, 0, 121, "db", { mod: true, tip: "Boost or squash everything after the attack." });
sec("drive", "OVERSAMPLING");
sel("DS_OS", "Distortion OS", ["off", "2×", "4×"], 0, { tip: "Runs the clippers/folders at 2× or 4× the sample rate (half-band filters) to tame aliasing. Off keeps the raw, digital, aliased bite." });
for (const [id, def] of [["D1", 1], ["D2", 0]]) {
  sec("drive", id === "D1" ? "DISTORTION A" : "DISTORTION B");
  sel(`${id}_TYPE`, "Type", DIST_TYPES, def);
  lin(`${id}_DRV`, "Drive", 0, 72, def ? 6 : 12, 73, "db", { mod: true, tip: "Up to +72 dB." });
  bip(`${id}_BIAS`, "Bias", 0, { steps: 41, mod: id === "D1", tip: "Asymmetry: adds even harmonics, or rectifies." });
  bip(`${id}_TONE`, "Tone", 0, { steps: 41, tip: "Tilt EQ after the clipper (− dark, + bright)." });
  exp(`${id}_LOW`, "Low Bypass", 20, 800, 20, 97, "hz", { tip: "Only distorts above this frequency; the sub below stays clean. Minimum = off." });
  amt(`${id}_MIX`, "Mix", 1, { steps: 33, mod: id === "D1" });
}
sec("drive", "BIT CRUSHER · DECIMATOR");
lin("CR_BITS", "Bits", 1, 16, 16, 61, "bits", { mod: true, tip: "Fractional bit depths are allowed. 1 bit = square-wave mush." });
exp("CR_RATE", "Rate", 100, 48000, 48000, 121, "hz", { mod: true, tip: "Sample-rate reduction. Maximum = off." });
amt("CR_JIT", "Jitter", 0, { steps: 33, tip: "Random clock jitter: shatters the aliasing into noise." });
sel("CR_MODE", "Law", ["linear", "µ-law"], 0);
amt("CR_MIX", "Mix", 1, { steps: 33 });
sec("drive", "RING MODULATOR");
exp("RM_FREQ", "Frequency", 5, 8000, 300, 161, "hz");
amt("RM_MIX", "Mix", 0, { steps: 33 });

// ───────────────────────── FILTER · COMB ───────────────────────────────────
sec("filter", "MASTER FILTER");
tog("FL_ON", "On", 0);
sel("FL_TYPE", "Type", ["low-pass", "band-pass", "high-pass", "notch", "peak"], 0);
exp("FL_CUT", "Cutoff", 15, 20000, 4000, 321, "hz", { mod: true });
exp("FL_RES", "Resonance Q", 0.4, 120, 1, 97, "val", { mod: true, tip: "Self-oscillates above ~60. The output limiter keeps it civil." });
amt("FL_DRV", "Drive", 0, { steps: 33, tip: "Saturates into the filter." });
lin("FL_ENV", "Env Amount", -6, 6, 0, 49, "oct", { tip: "Cutoff follows each hit." });
exp("FL_ENVT", "Env Time", 5, 4000, 200, 97, "ms");
lin("FL_KT", "Key Track", 0, 1.5, 0, 4, "kt");
tog("FL_SLOPE", "24 dB", 0);
sec("filter", "COMB RESONATOR");
exp("CB_FREQ", "Pitch", 20, 4000, 110, 289, "hz", { mod: true, tip: "A tuned feedback delay: turns any hit into a pitched, metallic, resonant instrument." });
lin("CB_KT", "Key Track", 0, 1.5, 0, 4, "kt");
lin("CB_FB", "Feedback", -1.05, 1.05, 0, 211, "fb", { mod: true, tip: "Negative = hollow (odd harmonics). Beyond ±1 it self-oscillates into saturation." });
exp("CB_DAMP", "Damping", 400, 20000, 8000, 65, "hz");
amt("CB_MIX", "Mix", 0, { steps: 33, mod: true });
lin("CB_STEREO", "Stereo Detune", 0, 50, 0, 26, "ct");

// ───────────────────────── EQ · COMP ───────────────────────────────────────
sec("eqdyn", "EQUALISER");
exp("EQ_HPF", "High-Pass", 10, 800, 10, 73, "hz", { tip: "Minimum = off." });
exp("EQ_LS_F", "Low Shelf Freq", 30, 500, 100, 65, "hz");
lin("EQ_LS_G", "Low Gain", -30, 30, 0, 81, "db");
exp("EQ_LM_F", "Low-Mid Freq", 50, 2000, 300, 97, "hz");
lin("EQ_LM_G", "LM Gain", -30, 30, 0, 81, "db", { mod: true });
exp("EQ_LM_Q", "LM Q", 0.3, 12, 1, 49, "val");
exp("EQ_HM_F", "High-Mid Freq", 500, 10000, 3000, 97, "hz");
lin("EQ_HM_G", "HM Gain", -30, 30, 0, 81, "db", { mod: true });
exp("EQ_HM_Q", "HM Q", 0.3, 12, 1, 49, "val");
exp("EQ_HS_F", "High Shelf Freq", 2000, 18000, 8000, 65, "hz");
lin("EQ_HS_G", "High Gain", -30, 30, 0, 81, "db", { mod: true });
exp("EQ_LPF", "Low-Pass", 1000, 20000, 20000, 73, "hz", { tip: "Maximum = off." });
sec("eqdyn", "COMPRESSOR (PARALLEL)");
lin("CP_THR", "Threshold", -60, 0, -14, 61, "db");
exp("CP_RATIO", "Ratio", 1, 100, 1, 73, "ratio", { tip: "Maximum is effectively ∞:1." });
exp("CP_ATT", "Attack", 0.01, 100, 5, 97, "ms", { tip: "0.01 ms flattens even the click." });
exp("CP_REL", "Release", 5, 2000, 120, 97, "ms");
lin("CP_KNEE", "Knee", 0, 24, 6, 25, "db");
lin("CP_MAKE", "Makeup", 0, 30, 0, 61, "db");
amt("CP_MIX", "Mix", 1, { steps: 33, tip: "Below 100 % = parallel ('New York') compression." });
exp("CP_HPF", "Sidechain HPF", 20, 500, 60, 49, "hz", { tip: "Keeps the sub from ducking the whole sound." });

// ───────────────────────── SPACE · OUT ─────────────────────────────────────
sec("space", "ECHO");
amt("DL_MIX", "Mix", 0, { steps: 33, mod: true });
exp("DL_TIME", "Time", 1, 1500, 180, 193, "ms");
sel("DL_SYNC", "Sync", SYNC_DIV, 0);
lin("DL_FB", "Feedback", 0, 1.15, 0.35, 47, "pct", { mod: true, tip: "Above 100 % it runs away into saturation." });
exp("DL_DAMP", "Damping", 500, 20000, 7000, 49, "hz");
amt("DL_PING", "Ping-Pong", 0.5, { steps: 33 });
sec("space", "REVERB");
amt("RV_MIX", "Mix", 0, { steps: 33, mod: true });
amt("RV_SIZE", "Size", 0.5, { steps: 33 });
exp("RV_DEC", "Decay", 0.1, 20, 1.2, 97, "s");
amt("RV_DAMP", "Damping", 0.4, { steps: 33 });
lin("RV_PRE", "Pre-Delay", 0, 200, 8, 41, "ms");
tog("RV_GATE", "Gate", 0, { tip: "Gated reverb: the tail is chopped after the hold time." });
exp("RV_GHOLD", "Gate Hold", 20, 800, 150, 49, "ms");
exp("RV_GREL", "Gate Release", 5, 400, 30, 49, "ms");
sec("space", "OUTPUT");
lin("OUT_WIDTH", "Width", 0, 3, 1, 49, "pct", { mod: true, tip: "Mid/side width. 0 = mono, 300 % = extreme." });
lin("OUT_HAAS", "Haas", 0, 30, 0, 31, "ms", { tip: "Micro-delay on one side." });
pan("OUT_PAN", "Pan", 0);
lin("OUT_DRIVE", "Clip Drive", 0, 24, 0, 25, "db", { tip: "Pushed into the final clipper." });
sel("OUT_CLIP", "Limiter", ["soft", "hard", "limit"], 0, { tip: "Soft: tanh. Hard: brick clip. Limit: instant-attack limiter." });
lin("OUT_CEIL", "Ceiling", -24, 0, -0.5, 49, "db");
lvl("OUT_LEVEL", "Output", 0, { mod: false });

// ---------------------------------------------------------------------
//  Modulation destinations: every param flagged mod:true gets an index
//  1..63 (0 = none). 'norm' domain modulation (see DSP).
// ---------------------------------------------------------------------
export const MOD_DESTS = P.filter((p) => p.mod && !p.direct);
if (MOD_DESTS.length > 63) throw new Error(`${MOD_DESTS.length} modulation targets — max 63`);
