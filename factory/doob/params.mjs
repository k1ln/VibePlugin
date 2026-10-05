// =====================================================================
//  Doob — logical parameter table (single source of truth).
//
//  A feature-for-feature model of the Moog Minimoog Model D, built from the original
//  Operation Manual (Moog Music, July 1971), R. J. Folkman's Technical Service Manual with
//  the factory schematics (block diagram, contour generator, keyboard / glide circuit, filter,
//  oscillator and noise-generator boards, modulation-mix amp, waveform-switching network),
//  and the documented behaviour of the 2016 / 2022 reissues (extra modulation sources, dedicated
//  LFO, key-priority / trigger options, alternative scales, adjustable bend range).
//
//  The host gives a plugin 64 float slots (63 usable: slot 63 is the host tempo). The Model D's
//  knobs and wheels are DIRECT slots (full-resolution floats, real DAW automation); its
//  switches and the settings are small integers packed by mixed radix
//        slot = Σ raw_i · Π_{j<i} steps_j        (product ≤ 2^24, exact in float32).
//
//  curve:  lin  actual = min + n·(max-min)        n = raw/(steps-1)
//          int  actual = min + raw                (steps = max-min+1)
// =====================================================================

export const SLOT_CAP = 2 ** 24;
export const SLOT_MAX = SLOT_CAP;
export const MAX_SLOTS = 63;

// ---- names (manual) ---------------------------------------------------------
export const RANGES = ["LO", "32'", "16'", "8'", "4'", "2'"];
export const WAVES12 = ["Triangle", "Shark tooth", "Sawtooth", "Square", "Wide pulse", "Narrow pulse"];
export const WAVES3 = ["Triangle", "Reverse saw", "Sawtooth", "Square", "Wide pulse", "Narrow pulse"];
export const NOISE_COL = ["White", "Pink"];
export const KEY_PRI = ["Low", "High", "Last"];
export const TRIG_MODE = ["Single", "Multi"];
export const SCALES = ["Equal temperament", "Pythagorean (C)", "Super-just 12", "Partch 43-tone"];
export const MOD_A = ["Oscillator 3", "Filter contour"];
export const MOD_B = ["Noise", "LFO"];
export const LFO_WAVE = ["Triangle", "Square"];

export const P = [];
let GRP = "";
export const grp = (g) => { GRP = g; };
function add(o) {
  if (P.some((p) => p.key === o.key)) throw new Error("duplicate key " + o.key);
  P.push({ grp: GRP, direct: false, fmt: "val", tip: "", ...o });
}
const direct = (key, name, min, max, def, fmt, tip = "") => add({ key, name, curve: "lin", min, max, def, steps: 0, direct: true, fmt, tip });
const sel = (key, name, opts, def = 0, tip = "") => add({ key, name, curve: "int", min: 0, max: opts.length - 1, def, steps: opts.length, fmt: opts, tip });
const tog = (key, name, def = 0, tip = "") => add({ key, name, curve: "int", min: 0, max: 1, def, steps: 2, fmt: ["off", "on"], kind: "tog", tip });
const int = (key, name, min, max, def, fmt = "int", tip = "") => add({ key, name, curve: "int", min, max, def, steps: max - min + 1, fmt, tip });

// ---- CONTROLLERS (left of the oscillator bank) ----------------------------------------
grp("ctl");
direct("TUNE", "Tune", -1, 1, 0, "tune", "Overall tuning of all three oscillators (±4 semitones). A-440 reference: tune oscillator 1 to the A-440 switch.");
direct("GLIDE", "Glide", 0, 1, 0, "glide", "Portamento time (exponential, up to ~10 s). Active when the GLIDE switch is on.");
direct("MODMIX", "Modulation Mix", 0, 1, 0, "mix", "Blend of the two modulation sources: fully left = Oscillator 3 (or filter contour), fully right = noise (or LFO).");
tog("OSC_MOD", "Oscillator Modulation", 0, "Sends the modulation (scaled by the MOD wheel) to the pitch of all three oscillators.");
tog("FIL_MOD", "Filter Modulation", 0, "Sends the modulation (scaled by the MOD wheel) to the filter cutoff.");
tog("O3_CTRL", "Oscillator 3 Control", 1, "On: oscillator 3 follows the keyboard. Off: it free-runs (FREQUENCY then sweeps 6 octaves) — an LFO / drone.");

// ---- OSCILLATOR BANK -----------------------------------------------------------------------
grp("osc");
sel("O1_RANGE", "Osc 1 Range", RANGES, 3, "LO / 32' / 16' / 8' / 4' / 2'.");
sel("O1_WAVE", "Osc 1 Waveform", WAVES12, 2, "Triangle, sawtooth-triangular (shark tooth), sawtooth, square, wide rectangular, narrow rectangular.");
sel("O2_RANGE", "Osc 2 Range", RANGES, 3);
direct("O2_FREQ", "Osc 2 Frequency", -1, 1, 0, "freq", "±7 semitones against oscillator 1.");
sel("O2_WAVE", "Osc 2 Waveform", WAVES12, 2);
sel("O3_RANGE", "Osc 3 Range", RANGES, 3);
direct("O3_FREQ", "Osc 3 Frequency", -1, 1, 0, "freq", "±7 semitones; ±3 octaves (six-octave sweep) when OSCILLATOR 3 CONTROL is off.");
sel("O3_WAVE", "Osc 3 Waveform", WAVES3, 2, "Oscillator 3 substitutes a reverse sawtooth for the shark tooth.");

// ---- MIXER ------------------------------------------------------------------------------------------
grp("mix");
tog("SW_O1", "Osc 1 switch", 1); direct("VOL1", "Oscillator 1", 0, 1, 0.7, "dial", "Mixer level (0-10). The mixer overloads into the filter at high settings — that is the fat Minimoog sound.");
tog("SW_O2", "Osc 2 switch", 0); direct("VOL2", "Oscillator 2", 0, 1, 0, "dial");
tog("SW_O3", "Osc 3 switch", 0); direct("VOL3", "Oscillator 3", 0, 1, 0, "dial", "Switching oscillator 3 off here does not affect its modulation signal.");
tog("SW_EXT", "External input switch", 0); direct("VOLEXT", "External Input", 0, 1, 0.5, "dial", "Microphone preamp on the host audio input. Set so the OVERLOAD lamp only blinks on loud peaks.");
tog("SW_NZ", "Noise switch", 0); direct("VOLNZ", "Noise", 0, 1, 0, "dial");
sel("NZ_COLOR", "Noise Quality", NOISE_COL, 0, "WHITE / PINK. (The modulation noise is the next colour down: pink / red.)");

// ---- MODIFIERS: filter ----------------------------------------------------------------------------------
grp("filt");
direct("CUTOFF", "Cutoff Frequency", 0, 1, 0.55, "cut", "-5 … +5 on the panel: ten octaves, 440 Hz at -1 (27 Hz - 28 kHz).");
direct("EMPH", "Emphasis", 0, 1, 0.15, "dial", "Resonance. Regeneration begins between 7 and 8; at 10 the filter oscillates (a pure sine, the 'sixth sound source').");
direct("CONTOUR", "Amount of Contour", 0, 1, 0.3, "dial", "How far the filter contour sweeps the cutoff (up to ~8.5 octaves).");
direct("FATK", "Filter Attack", 0, 1, 0.1, "time");
direct("FDEC", "Filter Decay", 0, 1, 0.45, "time");
direct("FSUS", "Filter Sustain", 0, 1, 0.3, "dial");
tog("KB1", "Keyboard Control 1", 1, "Couples one third of the keyboard CV to the filter cutoff.");
tog("KB2", "Keyboard Control 2", 0, "Couples two thirds of the keyboard CV to the filter cutoff (both on = full tracking).");

// ---- MODIFIERS: loudness contour -----------------------------------------------------------------------------
grp("loud");
direct("LATK", "Loudness Attack", 0, 1, 0.05, "time");
direct("LDEC", "Loudness Decay", 0, 1, 0.5, "time");
direct("LSUS", "Loudness Sustain", 0, 1, 1, "dial");

// ---- OUTPUT --------------------------------------------------------------------------------------------------------
grp("out");
direct("OUTVOL", "Main Output Volume", 0, 1, 0.7, "dial");
tog("MAIN_ON", "Main Output", 1, "MAIN OUTPUT switch: off silences the output (the headphone jack stays live on the hardware).");
tog("A440", "A-440", 0, "Tuning reference: a Wien-bridge sine (with a little harmonic content, as on the hardware) added to the output.");

// ---- LEFT-HAND CONTROLLER ------------------------------------------------------------------------------------------------
grp("lhc");
direct("PITCHW", "Pitch Wheel", -1, 1, 0, "bip", "Bends the oscillators (not the filter). Spring-centred.");
direct("MODW", "Modulation Wheel", 0, 1, 0, "pct", "A level control for the Modulation Mix (audio taper, like the 50 K pot on the hardware).");
tog("GLIDE_ON", "Glide switch", 0, "GLIDE on/off (rocker switch left of the keyboard).");
tog("DECAY_ON", "Decay switch", 0, "On: after the key is released both contours fall at the DECAY time instead of cutting off.");

// ---- REAR PANEL / REISSUE / GLOBAL ---------------------------------------------------------------------------------------------
grp("rear");
tog("STRIG", "S-Trig plug", 0, "The shorting plug in the rear TRIGGER INPUT: both contours are held at their sustain level, with or without a key.");
tog("FEEDBACK", "Output → External In", 0, "Patch the output back into the external input (the classic Minimoog feedback mod; the reissue has it as a switch).");
direct("DRIFT", "Oscillator Drift", 0, 1, 0.3, "pct", "Slow pitch instability of the three analog oscillators.");
direct("BLEED", "Oscillator Bleed", 0, 1, 0.15, "pct", "Cross-modulation between the oscillators (they pull toward each other when nearly in tune).");
sel("KEY_PRI", "Key Priority", KEY_PRI, 0, "Original: LOW (the lowest held key wins). Reissue options: HIGH, LAST.");
sel("TRIG_MODE", "Triggering", TRIG_MODE, 0, "SINGLE (original: overlapped keys do not re-trigger the contours) or MULTI.");
int("BEND", "Pitch Bend Range", 1, 12, 7, "st", "Semitones of the pitch wheel (7 is the authentic Model D range; 'half an octave' in the manual).");
sel("SCALE", "Scale", SCALES, 0, "Reissue scales: Equal, Pythagorean (C), Super-just, Partch 43-tone (one tone per key).");
tog("KEY_ERR", "Vintage keyboard error", 0, "The original keyboard's 43-resistor string has ±1 % parts: each key is a few cents off (reissue option).");
sel("MOD_A", "Modulation source A", MOD_A, 0, "Reissue: Oscillator 3 (original) or the filter contour.");
sel("MOD_B", "Modulation source B", MOD_B, 0, "Reissue: Noise (original) or the dedicated LFO.");
direct("LFO_RATE", "LFO Rate", 0, 1, 0.4, "lfo", "Reissue LFO: 0.1 - 30 Hz.");
sel("LFO_WAVE", "LFO Waveform", LFO_WAVE, 0);
tog("LOCAL", "Local", 1, "Off: the keyboard drives nothing internally (gate / pitch ignored).");
