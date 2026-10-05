// =====================================================================
//  KGrbdPa — logical parameter table (single source of truth).
//
//  A feature-for-feature model of the Moog Grandmother semi-modular analog
//  synthesizer, built from a cover-to-cover read of the Grandmother User's
//  Manual (signal-flow page, every module, the patch-point index, the Global
//  Settings, the MIDI chart and the 14 factory patch sheets).
//
//  The host gives a plugin 64 float slots (63 usable: slot 63 is the host
//  tempo). Knobs and wheels are DIRECT slots (full-resolution floats, real DAW
//  automation); the switches, the arp/seq/global settings and the whole patch
//  bay (23 destination jacks × "which output is plugged in") are small
//  integers that share slots by mixed-radix packing, exactly like KHeverest:
//        slot = Σ raw_i · Π_{j<i} steps_j        (product ≤ 2^24, exact in f32)
//
//  curve:  lin  actual = min + n·(max-min)        n = raw/(steps-1)
//          int  actual = min + raw                (steps = max-min+1)
// =====================================================================

export const SLOT_CAP = 2 ** 24;
export const SLOT_MAX = SLOT_CAP;
export const MAX_SLOTS = 63;

// ---- the patch bay ----------------------------------------------------------
// OUTPUT jacks (cable sources). Selector value 0 = nothing plugged in, value i+1 = SRC[i].
export const SRC = [
  ["GATE", "Gate Out", "ARP/SEQ"],
  ["KB", "KB Out", "ARP/SEQ"],
  ["VEL", "KB Vel Out", "ARP/SEQ"],
  ["LFO", "Mod Wave Out", "MODULATION"],
  ["SH", "Mod S/H Out", "MODULATION"],
  ["O1", "Osc 1 Wave Out", "OSCILLATORS"],
  ["O2", "Osc 2 Wave Out", "OSCILLATORS"],
  ["MIX", "Mixer Output", "MIXER"],
  ["HP", "High Pass Output", "UTILITIES"],
  ["ATT", "Attenuator Output", "UTILITIES"],
  ["MULT", "Mult", "UTILITIES"],
  ["FIL", "Filter Output", "FILTER"],
  ["ENVP", "+ Env Out", "ENVELOPE"],
  ["ENVN", "- Env Out", "ENVELOPE"],
  ["REV", "Reverb Out", "REAR"],
  ["EURO", "Eurorack Out", "REAR"],
  ["CLK", "Clock Out", "REAR"],
  ["EXT", "Instrument In", "REAR"],
];
export const SRC_IDX = Object.fromEntries(SRC.map((s, i) => [s[0], i + 1]));

// INPUT jacks (cable destinations). Each has one selector "which output feeds me".
//   kind: add  = summed with the panel setting / internal connection
//         rep  = REPLACES the normalled connection while a cable is plugged in
//         edge = rising-edge trigger input
//         none = no internal connection (silent until patched)
export const DST = [
  ["O1_PITCH", "Osc 1 Pitch In", "OSCILLATORS", "add"],
  ["O1_PWM", "PWM In", "OSCILLATORS", "add"],
  ["O2_PITCH", "Osc 2 Pitch In", "OSCILLATORS", "add"],
  ["O2_FM", "Osc 2 Lin FM In", "OSCILLATORS", "add"],
  ["LFO_RATE", "Mod Rate In", "MODULATION", "add"],
  ["LFO_SYNC", "Mod Sync In", "MODULATION", "edge"],
  ["MX_O1", "Mixer Osc 1 In", "MIXER", "rep"],
  ["MX_O2", "Mixer Osc 2 In", "MIXER", "rep"],
  ["MX_NZ", "Mixer Noise In", "MIXER", "rep"],
  ["MULT_A", "Mult jack A", "UTILITIES", "none"],
  ["MULT_B", "Mult jack B", "UTILITIES", "none"],
  ["HP_IN", "High Pass Input", "UTILITIES", "none"],
  ["ATT_IN", "Attenuator Input", "UTILITIES", "rep"],
  ["F_IN", "Filter Input", "FILTER", "rep"],
  ["F_ENVAMT", "Filter Env Amt In", "FILTER", "add"],
  ["F_CUT", "Filter Cutoff In", "FILTER", "add"],
  ["E_TRIG", "Env Trigger In", "ENVELOPE", "rep"],
  ["V_AMT", "VCA Amt In", "OUTPUT", "add"],
  ["V_IN", "VCA In", "OUTPUT", "rep"],
  ["R_IN", "Reverb In", "OUTPUT", "rep"],
  ["CLK_IN", "Clock In", "REAR", "edge"],
  ["ONOFF_IN", "On/Off In", "REAR", "none"],
  ["RESET_IN", "Reset In", "REAR", "edge"],
];
export const DST_IDX = Object.fromEntries(DST.map((d, i) => [d[0], i]));
export const SRC_NAMES = ["—", ...SRC.map((s) => s[1])];

// ---- name lists (manual) ----------------------------------------------------
export const O1_OCT = ["32'", "16'", "8'", "4'"];
export const O2_OCT = ["16'", "8'", "4'", "2'"];
export const WAVES = ["Triangle", "Saw", "Square", "Narrow Pulse"];
export const LFO_WAVES = ["Sine", "Sawtooth", "Ramp", "Square"];
export const KBD_TRK = ["1:2", "OFF", "1:1"];
export const VCA_MODES = ["ENV", "KB RLS", "DRONE"];
export const ARP_MODES = ["ARP", "SEQ", "REC"];
export const ARP_DIRS = ["ORDR", "FWD/BKWD", "RNDM"];
export const OCT_SEQ = ["1", "2", "3"];
export const GLIDE_TYPES = ["LCR", "LCT", "Exponential"];
export const NOTE_PRI = ["LOW", "HIGH", "LAST"];
export const PPQN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 48];
// MIDI chart "Grandmother Clock Divisions" (CC 90), in quarter notes per step
export const CLOCK_DIVS = [
  ["4 whole", 16], ["3 whole", 12], ["2 whole", 8], ["dotted whole", 6], ["whole", 4], ["dotted half", 3],
  ["whole triplet", 8 / 3], ["half", 2], ["dotted quarter", 1.5], ["half triplet", 4 / 3], ["quarter", 1],
  ["dotted eighth", 0.75], ["quarter triplet", 2 / 3], ["eighth", 0.5], ["dotted 16th", 0.375],
  ["eighth triplet", 1 / 3], ["16th", 0.25], ["dotted 32nd", 0.1875], ["16th triplet", 1 / 6], ["32nd", 0.125],
  ["dotted 64th", 0.09375], ["32nd triplet", 1 / 12], ["64th", 0.0625], ["64th triplet", 1 / 24],
];
export const CLOCK_SRC = ["Internal", "Host tempo"];
export const EXT_CLK_MODE = ["Clock", "Step-Advance"];
export const KB_RANGE = ["-5V..+5V", "0V..10V"];

// ---- the table ---------------------------------------------------------------
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

grp("lhc");
direct("PITCHW", "Pitch Wheel", -1, 1, 0, "bip", "Spring-loaded pitch wheel (also MIDI pitch bend). Range = BEND UP / BEND DOWN.");
direct("MODW", "Mod Wheel", 0, 1, 0, "pct", "Scales the MODULATION section's PITCH AMT, CUTOFF AMT and PULSE WIDTH AMT from off to their panel maxima (MIDI CC1).");
direct("GLIDE", "Glide", 0, 1, 0, "glide", "Portamento time. Minimum = no glide (MIDI CC5).");
tog("PLAY", "Play", 0, "Starts the arpeggiator / sequencer (MIDI CC73).");
tog("HOLD", "Hold", 0, "Latches the arpeggiator / sequencer after the keys are released (MIDI CC69).");
sel("GL_TYPE", "Glide Type", GLIDE_TYPES, 2, "LCR = linear constant rate, LCT = linear constant time, Exponential (MIDI CC85).");
tog("GL_LEGATO", "Legato Glide", 0, "Glide only between overlapping (legato / tied) notes (MIDI CC94). On the hardware: HOLD + turn GLIDE right.");
tog("GL_GATED", "Gated Glide", 0, "Glide only runs while the gate is high (MIDI CC103).");
int("KB_OCT", "Keyboard Octave", -2, 2, 0, "sgn", "SHIFT + [<KB] / [KB>] (MIDI CC89).");
int("KB_TRANS", "Keyboard Transpose", -12, 12, 0, "st", "Semitone transpose of the keyboard (MIDI CC119).");

grp("arp");
direct("ARP_RATE", "Arp/Seq Rate", 0, 1, 0.45, "bpm", "20-280 BPM (internal) or one of 24 note divisions (Host tempo). MIDI CC8.");
sel("ARP_MODE", "Mode", ARP_MODES, 0, "ARP / SEQ / REC (MIDI CC91).");
sel("ARP_DIR", "Direction", ARP_DIRS, 0, "ORDR / FWD-BKWD / RNDM (MIDI CC92).");
sel("OCT_SEQ", "Oct / Seq", OCT_SEQ, 0, "ARP: octave range 1-3. SEQ / REC: sequence 1-3 (MIDI CC93).");
int("TAP_BPM", "Tap Tempo", 0, 280, 0, "bpm", "0 = off; the TAP button writes the tapped tempo here.");
sel("CLK_SRC", "Clock Source", CLOCK_SRC, 0, "Internal BPM / tap tempo, or follow the host tempo (RATE then picks a note division).");
sel("EXT_MODE", "Ext Clock Mode", EXT_CLK_MODE, 0, "Global setting: CLOCK IN is a clock (PPQN) or advances one step per pulse.");
sel("EXT_PPQN", "Ext Clock PPQN", PPQN.map(String), 1, "Global setting: pulses per quarter note received at CLOCK IN (default 2).");
sel("OUT_PPQN", "Clock Out PPQN", PPQN.map(String), 1, "Global setting: pulses per quarter note sent from CLOCK OUT (default 2).");

grp("mod");
direct("MOD_RATE", "Mod Rate", 0, 1, 0.4, "lfo", "0.07 Hz - 1.3 kHz.");
direct("MOD_FINE", "Mod Rate Fine", -1, 1, 0, "bip", "SHIFT + RATE on the hardware: fine tune of the LFO rate (±1 semitone).");
sel("MOD_WAVE", "Waveform", LFO_WAVES, 0, "Sine / Sawtooth / Ramp / Square.");
direct("MOD_PITCH", "Pitch Amt", 0, 1, 0, "pct", "Maximum LFO depth on the pitch of both oscillators (needs MOD wheel).");
direct("MOD_CUT", "Cutoff Amt", 0, 1, 0, "pct", "Maximum LFO depth on the filter cutoff (needs MOD wheel).");
direct("MOD_PW", "Pulse Width Amt", 0, 1, 0, "pct", "Maximum LFO depth on the pulse width of both oscillators (needs MOD wheel).");

grp("osc");
sel("O1_OCT", "Osc 1 Octave", O1_OCT, 2, "32' / 16' / 8' / 4' (MIDI CC74).");
sel("O1_WAVE", "Osc 1 Waveform", WAVES, 1, "Triangle / Saw / Square / Narrow Pulse.");
tog("SYNC", "Sync", 0, "Hard-sync Oscillator 2 to Oscillator 1 (MIDI CC77).");
sel("O2_OCT", "Osc 2 Octave", O2_OCT, 1, "16' / 8' / 4' / 2' (MIDI CC75).");
direct("O2_FREQ", "Osc 2 Frequency", -1, 1, 0, "o2freq", "±7 semitones around Oscillator 1; much wider range while SYNC is on (MIDI CC12).");
sel("O2_WAVE", "Osc 2 Waveform", WAVES, 1, "Triangle / Saw / Square / Narrow Pulse.");

grp("mix");
direct("MIX_O1", "Oscillator 1", 0, 1, 0.6, "pct", "Mixer level; above 1 o'clock the stage starts to overdrive.");
direct("MIX_O2", "Oscillator 2", 0, 1, 0.6, "pct", "Mixer level; above 1 o'clock the stage starts to overdrive.");
direct("MIX_NZ", "Noise", 0, 1, 0, "pct", "White noise level.");

grp("util");
direct("HP_CUT", "High Pass", 0, 1, 0.3, "hz", "-6 dB/oct high-pass filter cutoff (patch it in with INPUT / OUTPUT).");
direct("ATT", "Attenuator", -1, 1, 0, "bip", "Bipolar attenuator: centre = zero, right = signal, left = inverted signal. Input is normalled to +8 V.");

grp("filt");
direct("CUTOFF", "Cutoff", 0, 1, 0.7, "cut", "20 Hz - 20 kHz (the panel scale: 200 Hz at 10 o'clock, 2 kHz at 2 o'clock); envelope / CV / LFO can push it down to 10 Hz.");
direct("RESO", "Resonance", 0, 1, 0.15, "pct", "Resonance feedback; the filter self-oscillates (a clean sine that follows the cutoff) from ~90% to maximum.");
direct("ENV_AMT", "Envelope Amt", -1, 1, 0.25, "bip", "Bipolar envelope depth on the cutoff (negative inverts).");
sel("KBD_TRK", "Kbd Track", KBD_TRK, 0, "Keyboard tracking of the cutoff: 1:2 (half), OFF, 1:1 (full).");

grp("env");
direct("ATK", "Attack", 0, 1, 0.1, "time");
direct("DEC", "Decay", 0, 1, 0.45, "time");
direct("SUS", "Sustain", 0, 1, 0.55, "pct");
direct("REL", "Release", 0, 1, 0.3, "time");

grp("out");
direct("VOLUME", "Volume", 0, 1, 0.7, "pct", "Main output level (after the reverb mix; the EURORACK OUT jack is not affected).");
sel("VCA_MODE", "VCA Mode", VCA_MODES, 0, "ENV = envelope, KB RLS = instant attack + release time, DRONE = always on.");
direct("REV_MIX", "Reverb Mix", 0, 1, 0, "pct", "Spring reverb dry/wet balance (REVERB OUT is always 100% wet).");

grp("rear");
direct("FINE", "Fine Tune", -1, 1, 0, "bip", "Rear-panel FINE TUNE: overall tuning of both oscillators (±1 semitone).");
direct("INST_LVL", "Instrument In", 0, 1, 1, "pct", "Level of the rear INSTRUMENT IN (host audio input) entering the mixer.");
direct("DRIFT", "Analog Drift", 0, 1, 0.25, "pct", "Slow oscillator pitch drift of a real analog instrument.");
sel("NOTE_PRI", "Note Priority", NOTE_PRI, 2, "Global setting: which held key wins on the monophonic keyboard (default LAST).");
int("BEND_UP", "Bend Up", 0, 24, 2, "st", "Pitch-wheel range up in semitones (MIDI CC107, RPN 0).");
int("BEND_DN", "Bend Down", 0, 24, 2, "st", "Pitch-wheel range down in semitones (MIDI CC108, RPN 0).");
sel("KB_RANGE", "KB Out Range", KB_RANGE, 0, "Global setting: voltage range of the KB OUT jack.");
tog("LOCAL", "Local", 1, "Global setting: LOCAL OFF disconnects the keyboard / wheel / arp from the internal engine (they still drive the jacks).");

// ---- the patch bay: one selector per input jack --------------------------------
grp("patch");
for (const [key, name] of DST) sel("PB_" + key, name, SRC_NAMES, 0, "Which output jack is cabled into this input (— = no cable, the normalled connection applies).");

// derived: counts the DSP needs
export const NSRC = SRC.length;
export const NDST = DST.length;
