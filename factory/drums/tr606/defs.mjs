// Parameter definitions for the Silverbox family (606). See tr808/defs.mjs.
const r = (key, name, def) => ({ key, name, min: 0, max: 1, def });
const int = (key, name, min, max, def) => ({ key, name, min, max, def, step: 1 });
// "Mod" knobs sit at −0.05 … 1: anything below 0 is the stock circuit.
const mod = (key, name) => ({ key, name, min: -0.05, max: 1, def: -0.05 });

export const SLOTS_606 = ["BD", "SD", "LT", "HT", "CY", "OH", "CH", "AC"];
const ROWS = [0x1111, 0x1010, 0, 0, 0x0001, 0x4444, 0xbbbb, 0x1111];

export const FULL_606 = [
  r("AC", "Accent", 0.6),
  r("BD_LEV", "BD Level", 0.8), r("SD_LEV", "SD Level", 0.75), r("LT_LEV", "LT Level", 0.7), r("HT_LEV", "HT Level", 0.7),
  r("CY_LEV", "CY Level", 0.6), r("HH_LEV", "HH Level", 0.7),
  r("VOLUME", "Volume", 0.8),
  { key: "TEMPO", name: "Tempo", min: 40, max: 300, def: 128 },
  int("SCALE", "Scale", 1, 4, 3), int("LAST", "Last Step", 1, 16, 16),
  int("SOURCE", "Clock Source", 0, 2, 1), int("RUN", "Run", 0, 1, 0), int("VELMODE", "Velocity Mode", 0, 1, 0),
  ...SLOTS_606.map((s, i) => int("ROW_" + s, s + " Steps", 0, 65535, ROWS[i])),
  mod("BD_DEC", "Mod BD Decay"), { key: "BD_TUNE", name: "Mod BD Tune", min: -12, max: 12, def: 0 },
  { key: "SD_TUNE", name: "Mod SD Tune", min: -12, max: 12, def: 0 }, mod("SD_SNAP", "Mod SD Snappy"),
  { key: "LT_TUNE", name: "Mod LT Tune", min: -12, max: 12, def: 0 }, { key: "HT_TUNE", name: "Mod HT Tune", min: -12, max: 12, def: 0 },
  mod("TOM_DEC", "Mod Tom Decay"), mod("CY_DEC", "Mod CY Decay"), mod("OH_DEC", "Mod OH Decay"),
  r("WIDTH", "Stereo Width", 0.3), r("DRIVE", "Drive", 0),
];

const common = () => [r("AC", "Accent", 0.6), int("VELMODE", "Velocity Mode", 0, 1, 0), r("DRIVE", "Drive", 0)];
export const KICK_606 = [r("LEV", "Level", 0.85), mod("DEC", "Mod Decay"), { key: "TUNE", name: "Mod Tune", min: -12, max: 12, def: 0 }, ...common()];
export const SNARE_606 = [r("LEV", "Level", 0.85), { key: "TUNE", name: "Mod Tune", min: -12, max: 12, def: 0 }, mod("SNAP", "Mod Snappy"), ...common()];
export const TOMS_606 = [r("LT_LEV", "Low Level", 0.8), r("HT_LEV", "High Level", 0.8),
  { key: "LT_TUNE", name: "Mod Low Tune", min: -12, max: 12, def: 0 }, { key: "HT_TUNE", name: "Mod High Tune", min: -12, max: 12, def: 0 },
  mod("DEC", "Mod Decay"), r("WIDTH", "Stereo Width", 0.4), ...common()];
export const CYMBAL_606 = [r("LEV", "Level", 0.8), mod("DEC", "Mod Decay"), ...common()];
export const HATS_606 = [r("LEV", "Level", 0.8), mod("OH_DEC", "Mod OH Decay"), { key: "TEMPO", name: "Tempo (OH decay)", min: 40, max: 300, def: 128 }, int("FOLLOW", "Follow DAW Tempo", 0, 1, 1), ...common()];
