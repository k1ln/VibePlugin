// Parameter definitions for the Warehouse family (909). See tr808/defs.mjs.
const r = (key, name, def) => ({ key, name, min: 0, max: 1, def });
const int = (key, name, min, max, def) => ({ key, name, min, max, def, step: 1 });

export const TRIG_909 = ["BD", "SD", "LT", "MT", "HT", "RS", "HC", "CH", "OH", "CR", "RD"];
export const ACC_909 = ["BD", "SD", "LT", "MT", "HT", "CH"];       // per-instrument accent (manual p.25)
export const FLAM_909 = ["BD", "SD", "LT", "MT", "HT"];           // flam-able voices (manual p.26)
const T = { BD: 0x1111, SD: 0x1010, LT: 0, MT: 0, HT: 0, RS: 0, HC: 0x1000, CH: 0xbbbb, OH: 0x4444, CR: 0x0001, RD: 0 };

export const FULL_909 = [
  r("BD_TUNE", "BD Tune", 0.5), r("BD_LEV", "BD Level", 0.85), r("BD_ATT", "BD Attack", 0.5), r("BD_DEC", "BD Decay", 0.45),
  r("SD_TUNE", "SD Tune", 0.5), r("SD_LEV", "SD Level", 0.8), r("SD_TONE", "SD Tone", 0.5), r("SD_SNAP", "SD Snappy", 0.6),
  r("LT_TUNE", "LT Tune", 0.5), r("LT_LEV", "LT Level", 0.7), r("LT_DEC", "LT Decay", 0.5),
  r("MT_TUNE", "MT Tune", 0.5), r("MT_LEV", "MT Level", 0.7), r("MT_DEC", "MT Decay", 0.5),
  r("HT_TUNE", "HT Tune", 0.5), r("HT_LEV", "HT Level", 0.7), r("HT_DEC", "HT Decay", 0.5),
  r("RS_LEV", "RS Level", 0.65), r("HC_LEV", "HC Level", 0.7),
  r("HH_LEV", "HH Level", 0.65), r("CH_DEC", "CH Decay", 0.4), r("OH_DEC", "OH Decay", 0.45),
  r("CR_LEV", "Crash Level", 0.55), r("CR_TUNE", "Crash Tune", 0.5),
  r("RD_LEV", "Ride Level", 0.55), r("RD_TUNE", "Ride Tune", 0.5),
  r("TOTAL_AC", "Total Accent", 0.6), r("VOLUME", "Volume", 0.8),
  { key: "TEMPO", name: "Tempo", min: 37, max: 290, def: 125 },
  int("SCALE", "Scale", 0, 3, 0),              // 16ths, 8th triplets, 32nds, 16th triplets
  int("LAST", "Last Step", 1, 16, 16),
  int("SHUFFLE", "Shuffle", 1, 7, 1),
  int("FLAM", "Flam Interval", 1, 8, 4),
  int("SOURCE", "Clock Source", 0, 2, 1),
  int("RUN", "Run", 0, 1, 0),
  int("VELMODE", "Velocity Mode", 0, 1, 0),
  ...TRIG_909.map((v) => int("TRIG_" + v, v + " Steps", 0, 65535, T[v])),
  int("TA", "Total Accent Steps", 0, 65535, 0x1111),
  ...ACC_909.map((v) => int("ACC_" + v, v + " Accent Steps", 0, 65535, v === "CH" ? 0x2222 : 0)),
  ...FLAM_909.map((v) => int("FLAM_" + v, v + " Flam Steps", 0, 65535, v === "SD" ? 0x1000 : 0)),
  r("WIDTH", "Stereo Width", 0.35), r("DRIVE", "Drive", 0),
];

const common = () => [r("AC", "Accent", 0.6), int("VELMODE", "Velocity Mode", 0, 1, 0), r("DRIVE", "Drive", 0)];
export const KICK_909 = [r("TUNE", "Tune", 0.5), r("LEV", "Level", 0.85), r("ATT", "Attack", 0.5), r("DEC", "Decay", 0.45), ...common()];
export const SNARE_909 = [r("TUNE", "Tune", 0.5), r("LEV", "Level", 0.85), r("TONE", "Tone", 0.5), r("SNAP", "Snappy", 0.6), ...common()];
export const TOMS_909 = [
  r("LT_TUNE", "Low Tune", 0.5), r("LT_LEV", "Low Level", 0.8), r("LT_DEC", "Low Decay", 0.5),
  r("MT_TUNE", "Mid Tune", 0.5), r("MT_LEV", "Mid Level", 0.8), r("MT_DEC", "Mid Decay", 0.5),
  r("HT_TUNE", "Hi Tune", 0.5), r("HT_LEV", "Hi Level", 0.8), r("HT_DEC", "Hi Decay", 0.5),
  r("WIDTH", "Stereo Width", 0.4), ...common(),
];
export const RIM_909 = [r("LEV", "Level", 0.85), ...common()];
export const CLAP_909 = [r("LEV", "Level", 0.85), ...common()];
export const HATS_909 = [r("LEV", "Level", 0.8), r("CH_DEC", "Closed Decay", 0.4), r("OH_DEC", "Open Decay", 0.45), ...common()];
export const CRASH_909 = [r("LEV", "Level", 0.8), r("TUNE", "Tune", 0.5), ...common()];
export const RIDE_909 = [r("LEV", "Level", 0.8), r("TUNE", "Tune", 0.5), ...common()];
