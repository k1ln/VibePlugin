// Parameter definitions for the Bridgewell family (808). One source of truth:
// build.mjs turns these into the DSP's P_* constants and setDefaults(), the
// spec.json the packer reads, and the GUI's parameter table.
const r = (key, name, def, extra = {}) => ({ key, name, min: 0, max: 1, def, ...extra });
const int = (key, name, min, max, def) => ({ key, name, min, max, def, step: 1 });

export const SLOTS_808 = ["BD", "SD", "LT", "MT", "HT", "RS", "CP", "CB", "CY", "OH", "CH", "AC"];
const ROWS_A = [0x1111, 0x1010, 0, 0, 0, 0, 0, 0, 0, 0x4444, 0x5555, 0x0001];
const ROWS_B = [0x1111, 0x1010, 0x8000, 0x4000, 0x2000, 0, 0x0880, 0, 0x0001, 0x4444, 0x1555, 0x1001];

export const FULL_808 = [
  r("AC", "Accent", 0.6),
  r("BD_LEV", "BD Level", 0.8), r("BD_TONE", "BD Tone", 0.5), r("BD_DEC", "BD Decay", 0.5),
  r("SD_LEV", "SD Level", 0.75), r("SD_TONE", "SD Tone", 0.5), r("SD_SNAP", "SD Snappy", 0.55),
  r("LT_LEV", "LT/LC Level", 0.7), r("LT_TUNE", "LT/LC Tuning", 0.5),
  r("MT_LEV", "MT/MC Level", 0.7), r("MT_TUNE", "MT/MC Tuning", 0.5),
  r("HT_LEV", "HT/HC Level", 0.7), r("HT_TUNE", "HT/HC Tuning", 0.5),
  r("RS_LEV", "RS/CL Level", 0.65), r("CP_LEV", "CP/MA Level", 0.7), r("CB_LEV", "CB Level", 0.55),
  r("CY_LEV", "CY Level", 0.55), r("CY_TONE", "CY Tone", 0.5), r("CY_DEC", "CY Decay", 0.5),
  r("OH_LEV", "OH Level", 0.6), r("OH_DEC", "OH Decay", 0.35), r("CH_LEV", "CH Level", 0.65),
  r("MASTER", "Master Volume", 0.8),
  int("SWITCH", "Voice Select", 0, 31, 0),
  int("TEMPO", "Tempo", 0, 39, 21),
  { key: "FINE", name: "Tempo Fine", min: -1, max: 1, def: 0 },
  int("SCALE", "Pre-Scale", 1, 4, 3),
  int("LAST", "Last Step", 1, 16, 16),
  int("VAR", "Basic Variation", 0, 2, 0),
  int("SOURCE", "Clock Source", 0, 2, 1),
  int("VELMODE", "Velocity Mode", 0, 1, 0),
  ...SLOTS_808.map((s, i) => int("ROW_A_" + s, "Pattern A " + s, 0, 65535, ROWS_A[i])),
  ...SLOTS_808.map((s, i) => int("ROW_B_" + s, "Pattern B " + s, 0, 65535, ROWS_B[i])),
  r("WIDTH", "Stereo Width", 0.35), r("DRIVE", "Drive", 0),
  { key: "BD_TRIM", name: "BD Tune Trim", min: -3, max: 3, def: 0 },
  { key: "SD_TRIM", name: "SD Tune Trim", min: -3, max: 3, def: 0 },
  int("RUN", "Run", 0, 1, 0),
];

// ---- single-voice plugins ---------------------------------------------------
// Every single shares ACCENT (height of velocity-100+ hits), VELOCITY MODE and
// DRIVE; the voice controls are exactly the panel's for that instrument, plus
// the service trimmer as "Tune" where the circuit has one.
const common = () => [r("AC", "Accent", 0.6), int("VELMODE", "Velocity Mode", 0, 1, 0), r("DRIVE", "Drive", 0)];
const tune = (def = 0) => ({ key: "TUNE", name: "Tune", min: -12, max: 12, def });

export const KICK_808 = [r("LEV", "Level", 0.85), r("TONE", "Tone", 0.5), r("DEC", "Decay", 0.5), tune(), ...common()];
export const SNARE_808 = [r("LEV", "Level", 0.85), r("TONE", "Tone", 0.5), r("SNAP", "Snappy", 0.55), tune(), ...common()];
export const TOMS_808 = [
  r("LT_LEV", "Low Level", 0.8), r("LT_TUNE", "Low Tuning", 0.5),
  r("MT_LEV", "Mid Level", 0.8), r("MT_TUNE", "Mid Tuning", 0.5),
  r("HT_LEV", "Hi Level", 0.8), r("HT_TUNE", "Hi Tuning", 0.5),
  int("SWITCH", "Tom/Conga", 0, 7, 0), r("WIDTH", "Stereo Width", 0.4), ...common(),
];
export const RIM_808 = [r("LEV", "Level", 0.85), int("SWITCH", "Rim/Claves", 0, 1, 0), ...common()];
export const CLAP_808 = [r("LEV", "Level", 0.85), int("SWITCH", "Clap/Maracas", 0, 1, 0), ...common()];
export const COWBELL_808 = [r("LEV", "Level", 0.8), ...common()];
export const CYMBAL_808 = [r("LEV", "Level", 0.8), r("TONE", "Tone", 0.5), r("DEC", "Decay", 0.5), ...common()];
export const HATS_808 = [r("OH_LEV", "Open Level", 0.75), r("OH_DEC", "Open Decay", 0.35), r("CH_LEV", "Closed Level", 0.8), ...common()];
export const BASS_808 = [
  r("LEV", "Level", 0.85), r("TONE", "Tone", 0.35), r("DEC", "Decay", 0.7),
  r("RELEASE", "Release", 0.55), r("GLIDE", "Glide", 0.25), int("GLIDE_MODE", "Glide Mode", 0, 1, 1),
  { key: "SIGH", name: "Pitch Sigh", min: 0, max: 3, def: 1 }, r("CLICK", "Click", 0.4),
  r("DRIVE", "Drive", 0.35), int("OCTAVE", "Octave", -2, 1, 0), int("BEND_RANGE", "Bend Range", 0, 12, 2),
  r("AC", "Accent", 0.6), int("VELMODE", "Velocity Mode", 0, 1, 1),
];
