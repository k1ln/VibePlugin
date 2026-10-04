// =====================================================================
//  Factory presets. { name, cat, set } — `set` holds ACTUAL values by key;
//  everything unlisted comes from OFF (all layers silent, FX neutral).
//  Output levels are normalised by tests/tune-levels.mjs → presets.levels.json
//  (so every preset peaks near −3 dBFS regardless of how it was built).
// =====================================================================
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const LEVELS = existsSync(join(here, "presets.levels.json")) ? JSON.parse(readFileSync(join(here, "presets.levels.json"), "utf8")) : {};

// the neutral starting point every preset builds on
export const OFF = {
  T_LEV: -60, F_LEV: -60, M_LEV: -60, N_LEV: -60, X_LEV: -60, C_LEV: -60,
  T_PE1_AMT: 0, T_PE2_AMT: 0, T_TENS: 0, T_SUB: -60, T_TAIL: -60, N_TAIL: -60, X_TAIL: -60,
  D1_TYPE: 0, D2_TYPE: 0, CR_BITS: 16, CR_RATE: 48000, CB_MIX: 0, RM_MIX: 0, FL_ON: 0, DL_MIX: 0, RV_MIX: 0,
  CP_RATIO: 1, CP_MAKE: 0, TS_ATK: 0, TS_SUS: 0, OUT_CLIP: 0, OUT_CEIL: -0.5, OUT_LEVEL: 0, OUT_WIDTH: 1,
  RAT_N: 1, POLY: 2, GATE: 0, HUMAN: 0.12,
};

const mk = (name, cat, set) => ({ name, cat, set: { ...set } });
export const PRESETS = [];
const add = (name, cat, set) => PRESETS.push(mk(name, cat, set));

// ───────────────────────── KICKS ─────────────────────────────────────────────
add("808 Sub", "Kick", {
  T_LEV: 0, T_SHAPE: 0, T_PITCH: 49, T_KT: 1, T_PE1_AMT: 17, T_PE1_TIME: 28, T_PE2_AMT: 4, T_PE2_TIME: 350,
  T_ATT: 0.4, T_DEC: 1400, T_CRV: 0.1, C_LEV: -14, C_TYPE: 0, C_FREQ: 1500, C_LEN: 1.2,
  D1_TYPE: 1, D1_DRV: 6, EQ_HPF: 20, CP_THR: -14, CP_RATIO: 2.5, CP_ATT: 15, CP_REL: 160, CP_MAKE: 2,
});
add("909 Punch", "Kick", {
  T_LEV: 0, T_SHAPE: 0.35, T_PITCH: 54, T_KT: 1, T_PE1_AMT: 36, T_PE1_TIME: 42, T_PE1_CRV: -0.2, T_DEC: 380,
  C_LEV: -8, C_TYPE: 1, C_FREQ: 2600, C_LEN: 1.3,
  D1_TYPE: 2, D1_DRV: 11, D1_MIX: 0.35, D1_LOW: 90, CP_THR: -18, CP_RATIO: 4, CP_ATT: 8, CP_REL: 90, CP_MAKE: 4,
  EQ_LM_F: 320, EQ_LM_G: -3, EQ_HS_F: 6000, EQ_HS_G: 2,
});
add("Techno Thump", "Kick", {
  T_LEV: 0, T_SHAPE: 0.15, T_PITCH: 57, T_PE1_AMT: 30, T_PE1_TIME: 34, T_DEC: 270, T_TAIL: -18, T_TAILT: 420,
  C_LEV: -9, C_TYPE: 4, C_FREQ: 3800, D1_TYPE: 4, D1_DRV: 14, D1_LOW: 110, D1_MIX: 0.8,
  EQ_LM_F: 300, EQ_LM_G: -5, EQ_HS_F: 5000, EQ_HS_G: 3, CP_THR: -16, CP_RATIO: 5, CP_ATT: 12, CP_REL: 110, CP_MAKE: 4,
});
add("Gabber Distorted", "Kick", {
  T_LEV: 0, T_PITCH: 62, T_PE1_AMT: 44, T_PE1_TIME: 55, T_PE1_CRV: -0.15, T_DEC: 520, T_TAIL: -8, T_TAILT: 350,
  C_LEV: -8, C_TYPE: 0, C_FREQ: 2500, D1_TYPE: 2, D1_DRV: 42, D1_TONE: 0.2, D2_TYPE: 3, D2_DRV: 14, D2_MIX: 0.5,
  CR_BITS: 11, CR_RATE: 30000, EQ_LS_G: 4, EQ_HM_G: 3, EQ_HM_F: 2500, CP_THR: -22, CP_RATIO: 12, CP_ATT: 0.6, CP_REL: 60, CP_MAKE: 6,
  OUT_CLIP: 1, OUT_CEIL: -0.3,
});
add("Hardstyle Scream", "Kick", {
  T_LEV: 0, T_PITCH: 46, T_PE1_AMT: 50, T_PE1_TIME: 90, T_PE1_CRV: -0.4, T_PE2_AMT: -7, T_PE2_TIME: 700,
  T_DEC: 700, T_TAIL: -4, T_TAILT: 900, D1_TYPE: 3, D1_DRV: 26, D1_LOW: 70, D2_TYPE: 2, D2_DRV: 20, D2_LOW: 180,
  EQ_HPF: 28, EQ_HM_F: 1800, EQ_HM_G: 3, CP_THR: -20, CP_RATIO: 10, CP_ATT: 1, CP_REL: 120, CP_MAKE: 6, OUT_CLIP: 2,
});
add("Trap Boom", "Kick", {
  T_LEV: 0, T_PITCH: 36, T_PE1_AMT: 10, T_PE1_TIME: 90, T_ATT: 1.5, T_DEC: 2800, T_CRV: 0.3,
  D1_TYPE: 1, D1_DRV: 14, D1_LOW: 90, EQ_LS_F: 70, EQ_LS_G: 3, EQ_HPF: 18, CP_THR: -10, CP_RATIO: 2, CP_ATT: 25, CP_REL: 300, CP_MAKE: 2,
});
add("Acoustic Kick", "Kick", {
  M_LEV: -2, M_PITCH: 78, M_MAT: 1, M_NUM: 6, M_DEC: 380, M_TILT: 1.4, M_BRT: 0.9, M_POS: 0.15, M_EXCL: 0.6, M_EXCN: 0.15, M_TENS: 6,
  T_LEV: -7, T_PITCH: 58, T_PE1_AMT: 14, T_PE1_TIME: 30, T_DEC: 220, C_LEV: -9, C_TYPE: 5, C_FREQ: 900, C_LEN: 8,
  RV_MIX: 0.1, RV_SIZE: 0.3, RV_DEC: 0.5, EQ_LM_F: 350, EQ_LM_G: -4, EQ_HS_G: 2, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("House Click", "Kick", {
  T_LEV: 0, T_PITCH: 55, T_PE1_AMT: 24, T_PE1_TIME: 28, T_DEC: 300, C_LEV: -5, C_TYPE: 4, C_FREQ: 4200,
  D1_TYPE: 1, D1_DRV: 6, EQ_HPF: 24, CP_THR: -14, CP_RATIO: 4, CP_ATT: 6, CP_REL: 90, CP_MAKE: 3,
});
add("Industrial Crush", "Kick", {
  T_LEV: 0, T_SHAPE: 2, T_PITCH: 55, T_PE1_AMT: 30, T_PE1_TIME: 50, T_DEC: 420, T_FB: 0.8, T_FOLD: 0.3,
  F_LEV: -6, F_FREQ: 110, F_IDX: 8, F_IDXT: 120, F_DEC: 300, D1_TYPE: 9, D1_DRV: 30, D2_TYPE: 3, D2_DRV: 12,
  CR_BITS: 7, CR_RATE: 11000, EQ_HM_F: 1500, EQ_HM_G: 4, CP_THR: -20, CP_RATIO: 20, CP_ATT: 0.3, CP_REL: 70, CP_MAKE: 6, OUT_CLIP: 1,
});
add("Impact Boom", "Kick", {
  T_LEV: 0, T_PITCH: 32, T_PE1_AMT: 12, T_PE1_TIME: 200, T_ATT: 3, T_DEC: 6000, T_TAIL: -6, T_TAILT: 5000,
  N_LEV: -8, N_TYPE: 2, N_MODE: 0, N_CUT: 400, N_DEC: 3000, N_ATT: 4, RV_MIX: 0.5, RV_SIZE: 0.9, RV_DEC: 6, RV_DAMP: 0.6,
  D1_TYPE: 1, D1_DRV: 8, D1_LOW: 80, CP_THR: -14, CP_RATIO: 3, CP_ATT: 30, CP_REL: 400, CP_MAKE: 3,
});
add("Rolling Kick", "Kick", {
  T_LEV: 0, T_PITCH: 52, T_PE1_AMT: 28, T_PE1_TIME: 35, T_DEC: 180, C_LEV: -9, C_TYPE: 1, C_FREQ: 2800,
  RAT_N: 8, RAT_TIME: 70, RAT_VEL: -0.08, RAT_PITCH: -0.6, D1_TYPE: 4, D1_DRV: 12, D1_LOW: 100,
  CP_THR: -16, CP_RATIO: 4, CP_ATT: 5, CP_REL: 80, CP_MAKE: 3,
});

// ───────────────────────── SNARES ────────────────────────────────────────────
add("808 Snare", "Snare", {
  T_LEV: -4, T_SHAPE: 1, T_PITCH: 190, T_KT: 1, T_PE1_AMT: 10, T_PE1_TIME: 18, T_DEC: 140,
  F_LEV: -8, F_FREQ: 330, F_KT: 1, F_IDX: 0, F_DEC: 100, F_FOLLOW: 0,
  N_LEV: -3, N_MODE: 1, N_CUT: 4800, N_RES: 0.05, N_DEC: 220, N_CRV: -0.2, C_LEV: -14, C_TYPE: 1, C_FREQ: 4000,
  D1_TYPE: 1, D1_DRV: 3, EQ_HM_F: 5000, EQ_HM_G: 2, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 2,
});
add("909 Snare", "Snare", {
  T_LEV: -3, T_SHAPE: 0.6, T_PITCH: 185, T_PE1_AMT: 7, T_PE1_TIME: 30, T_DEC: 110,
  F_LEV: -9, F_FREQ: 330, F_IDX: 0, F_DEC: 90, N_LEV: -1, N_MODE: 1.15, N_CUT: 5800, N_RES: 0.05, N_DEC: 190,
  C_LEV: -10, C_TYPE: 1, C_FREQ: 5000, D1_TYPE: 2, D1_DRV: 8, D1_MIX: 0.3, RV_MIX: 0.08, RV_SIZE: 0.25, RV_DEC: 0.4,
  CP_THR: -16, CP_RATIO: 4, CP_ATT: 4, CP_REL: 70, CP_MAKE: 3,
});
add("Acoustic Snare", "Snare", {
  M_LEV: -2, M_PITCH: 185, M_MAT: 1, M_NUM: 7, M_DEC: 260, M_TILT: 1.2, M_BRT: 0.4, M_POS: 0.45, M_EXCL: 0.5, M_EXCN: 0.35, S_CLK: 1,
  N_LEV: -5, N_GATE: 2, N_RAT: 0.85, N_MODE: 1.1, N_CUT: 5200, N_RES: 0.05, N_DEC: 280, N_KT: 0,
  C_LEV: -12, C_TYPE: 1, C_FREQ: 4000, RV_MIX: 0.12, RV_SIZE: 0.35, RV_DEC: 0.6, EQ_HM_F: 4500, EQ_HM_G: 2, CP_THR: -18, CP_RATIO: 3, CP_MAKE: 3,
});
add("Gated 80s Snare", "Snare", {
  T_LEV: -3, T_SHAPE: 0.6, T_PITCH: 200, T_PE1_AMT: 9, T_PE1_TIME: 28, T_DEC: 130,
  N_LEV: 0, N_MODE: 1.2, N_CUT: 5000, N_RES: 0.1, N_DEC: 240, C_LEV: -8, C_TYPE: 1, C_FREQ: 3500,
  RV_MIX: 0.95, RV_SIZE: 0.6, RV_DEC: 1.8, RV_GATE: 1, RV_GHOLD: 170, RV_GREL: 25, D1_TYPE: 2, D1_DRV: 10, D1_MIX: 0.4,
  CP_THR: -24, CP_RATIO: 8, CP_ATT: 1, CP_REL: 80, CP_MAKE: 8,
});
add("Industrial Snare", "Snare", {
  T_LEV: -2, T_SHAPE: 2, T_PITCH: 215, T_PE1_AMT: 18, T_PE1_TIME: 20, T_DEC: 90,
  N_LEV: 0, N_MODE: 1.4, N_CUT: 4000, N_RES: 0.15, N_DEC: 170, C_LEV: -8, C_TYPE: 4, C_FREQ: 3000,
  D1_TYPE: 2, D1_DRV: 28, D2_TYPE: 3, D2_DRV: 10, CR_BITS: 8, CR_RATE: 16000, CP_THR: -22, CP_RATIO: 30, CP_ATT: 0.1, CP_REL: 60, CP_MAKE: 6, OUT_CLIP: 1,
});
add("Rimshot", "Snare", {
  C_LEV: -2, C_TYPE: 4, C_FREQ: 2800, T_LEV: -3, T_SHAPE: 1, T_PITCH: 480, T_PE1_AMT: 5, T_PE1_TIME: 6, T_DEC: 40,
  F_LEV: -9, F_FREQ: 1700, F_IDX: 0, F_DEC: 25, M_LEV: -10, M_PITCH: 900, M_MAT: 2, M_NUM: 4, M_DEC: 60, M_EXCL: 0.1,
  D1_TYPE: 1, D1_DRV: 6, CP_THR: -16, CP_RATIO: 4, CP_MAKE: 3,
});

// ───────────────────────── CLAPS ─────────────────────────────────────────────
add("Clap 808", "Clap", {
  N_LEV: 0, N_GATE: 1, N_BN: 4, N_BSP: 10, N_BJIT: 0.3, N_BLEN: 7, N_BSLOPE: 0.15, N_MODE: 1, N_CUT: 1100, N_RES: 0.35, N_DEC: 330, N_CRV: -0.1,
  N_WIDTH: 0.7, D1_TYPE: 1, D1_DRV: 4, RV_MIX: 0.12, RV_SIZE: 0.3, RV_DEC: 0.5, CP_THR: -18, CP_RATIO: 3, CP_MAKE: 4,
});
add("Clap 909 Room", "Clap", {
  N_LEV: 0, N_GATE: 1, N_BN: 3, N_BSP: 14, N_BJIT: 0.35, N_BLEN: 9, N_MODE: 1, N_CUT: 1600, N_RES: 0.3, N_DEC: 240, N_WIDTH: 0.8,
  RV_MIX: 0.3, RV_SIZE: 0.5, RV_DEC: 1.1, D1_TYPE: 1, D1_DRV: 4, CP_THR: -18, CP_RATIO: 3, CP_MAKE: 4,
});
add("Wide Clap Stack", "Clap", {
  N_LEV: 0, N_GATE: 1, N_BN: 7, N_BSP: 7, N_BJIT: 0.6, N_BLEN: 5, N_BSLOPE: 0.1, N_MODE: 1, N_CUT: 1300, N_RES: 0.3, N_DEC: 380, N_WIDTH: 1,
  OUT_WIDTH: 1.6, DL_MIX: 0.15, DL_TIME: 90, DL_FB: 0.3, RV_MIX: 0.2, RV_SIZE: 0.6, RV_DEC: 1.4, CP_THR: -18, CP_RATIO: 4, CP_MAKE: 4,
});
add("Trap Clap", "Clap", {
  N_LEV: 0, N_GATE: 1, N_BN: 3, N_BSP: 6.5, N_BJIT: 0.2, N_BLEN: 4, N_MODE: 1, N_CUT: 1500, N_RES: 0.45, N_DEC: 130,
  C_LEV: -9, C_TYPE: 4, C_FREQ: 3500, D1_TYPE: 4, D1_DRV: 10, RV_MIX: 0.18, RV_SIZE: 0.4, RV_DEC: 0.7, CP_THR: -20, CP_RATIO: 5, CP_MAKE: 5,
});
add("Broken Clap", "Clap", {
  N_LEV: 0, N_TYPE: 6, N_RATE: 9000, N_GATE: 1, N_BN: 5, N_BSP: 12, N_BJIT: 0.8, N_BLEN: 5, N_MODE: 1, N_CUT: 2200, N_RES: 0.2, N_DEC: 220,
  CR_BITS: 6, CR_RATE: 14000, D1_TYPE: 3, D1_DRV: 10, RV_MIX: 0.1, CP_THR: -18, CP_RATIO: 5, CP_MAKE: 4,
});

// ───────────────────────── HATS & CYMBALS ────────────────────────────────────
add("Closed Hat 808", "Hat", {
  X_LEV: 0, X_SET: 0, X_FREQ: 205, X_KT: 0, X_BPF: 8500, X_BPQ: 1.5, X_HPF: 7000, X_BAND: 0.35, X_DEC: 45, X_CRV: -0.1,
  CP_THR: -20, CP_RATIO: 3, CP_MAKE: 3,
});
add("Open Hat 808", "Hat", {
  X_LEV: 0, X_SET: 0, X_FREQ: 205, X_KT: 0, X_BPF: 8500, X_BPQ: 1.5, X_HPF: 7000, X_BAND: 0.35, X_DEC: 420, X_CRV: 0.2, X_TAIL: -10, X_TAILT: 700,
  CP_THR: -20, CP_RATIO: 3, CP_MAKE: 3,
});
add("Closed Hat 909", "Hat", {
  X_LEV: 0, X_SET: 1, X_FREQ: 220, X_KT: 0, X_BPF: 9500, X_BPQ: 1.2, X_HPF: 7500, X_BAND: 0.5, X_DEC: 38,
  N_LEV: -8, N_MODE: 2, N_CUT: 9000, N_RES: 0.05, N_DEC: 35, N_KT: 0, CP_THR: -20, CP_RATIO: 3, CP_MAKE: 3,
});
add("Pedal Hat", "Hat", {
  X_LEV: 0, X_SET: 0, X_FREQ: 190, X_KT: 0, X_BPF: 6000, X_BPQ: 1.2, X_HPF: 4500, X_BAND: 0.2, X_DEC: 22,
  C_LEV: -12, C_TYPE: 5, C_FREQ: 1800, C_LEN: 5, CP_THR: -20, CP_RATIO: 3, CP_MAKE: 3,
});
add("Shimmer Hat", "Hat", {
  X_LEV: 0, X_SET: 4, X_FREQ: 400, X_KT: 0, X_SPREAD: 1.4, X_SHM: 0.8, X_RING: 0.4, X_BPF: 9000, X_BPQ: 2, X_HPF: 6500, X_DEC: 160,
  X_FE_AMT: 1, X_FE_TIME: 120, DL_MIX: 0.1, DL_TIME: 120, DL_FB: 0.3, CP_THR: -20, CP_RATIO: 3, CP_MAKE: 3,
});
add("Crash", "Cymbal", {
  X_LEV: 0, X_SET: 1, X_FREQ: 260, X_KT: 0, X_SPREAD: 1.2, X_RING: 0.3, X_SHM: 0.5, X_BPF: 7000, X_BPQ: 0.8, X_HPF: 3500, X_BAND: 0.6,
  X_DEC: 2400, X_FE_AMT: 2, X_FE_TIME: 1500, X_TAIL: -6, X_TAILT: 3500,
  N_LEV: -8, N_MODE: 2, N_CUT: 5000, N_DEC: 1800, N_KT: 0, RV_MIX: 0.15, RV_SIZE: 0.5, RV_DEC: 1.2, CP_THR: -22, CP_RATIO: 3, CP_MAKE: 4,
});
add("Ride", "Cymbal", {
  X_LEV: -2, X_SET: 1, X_FREQ: 330, X_KT: 0, X_SPREAD: 0.9, X_BPF: 7500, X_BPQ: 1.4, X_HPF: 4500, X_BAND: 0.5, X_DEC: 1500, X_CRV: 0.1,
  M_LEV: -6, M_PITCH: 560, M_MAT: 4, M_NUM: 6, M_DEC: 1100, M_TILT: -0.2, M_BRT: 0.3, M_POS: 0.3, M_EXCL: 0.2, M_KT: 0,
  CP_THR: -22, CP_RATIO: 3, CP_MAKE: 4,
});
add("China Trash", "Cymbal", {
  X_LEV: 0, X_SET: 5, X_FREQ: 300, X_KT: 0, X_FOLD: 0.35, X_RING: 0.5, X_SHM: 0.4, X_BPF: 6500, X_BPQ: 1, X_HPF: 3000, X_DEC: 900,
  D1_TYPE: 9, D1_DRV: 12, D1_LOW: 800, CP_THR: -22, CP_RATIO: 5, CP_MAKE: 4,
});
add("Splash", "Cymbal", {
  X_LEV: 0, X_SET: 1, X_FREQ: 340, X_KT: 0, X_SPREAD: 1.1, X_RING: 0.2, X_BPF: 9000, X_BPQ: 1, X_HPF: 5000, X_DEC: 700, X_FE_AMT: 1.5, X_FE_TIME: 500,
  CP_THR: -22, CP_RATIO: 3, CP_MAKE: 4,
});
add("Gong", "Cymbal", {
  M_LEV: 0, M_PITCH: 110, M_MAT: 4, M_NUM: 12, M_DEC: 6000, M_TILT: -0.4, M_BRT: 0.2, M_POS: 0.2, M_EXCL: 2, M_KT: 0.5, M_SPREAD: 8,
  X_LEV: -14, X_SET: 3, X_FREQ: 120, X_KT: 0, X_SHM: 0.6, X_DEC: 4000, X_BPF: 2500, X_HPF: 400, RV_MIX: 0.3, RV_SIZE: 0.8, RV_DEC: 4, RV_DAMP: 0.5,
  CP_THR: -20, CP_RATIO: 2, CP_ATT: 20, CP_MAKE: 3,
});

// ───────────────────────── TOMS & PERCUSSION ─────────────────────────────────
add("Tom Low", "Tom", {
  M_LEV: 0, M_PITCH: 95, M_KT: 1, M_MAT: 1, M_NUM: 8, M_DEC: 450, M_TILT: 1.1, M_BRT: 0.8, M_POS: 0.25, M_EXCL: 0.35, M_EXCN: 0.1, M_TENS: 7,
  T_LEV: -8, T_PITCH: 95, T_PE1_AMT: 7, T_PE1_TIME: 60, T_DEC: 300, C_LEV: -12, C_TYPE: 5, C_FREQ: 1200, C_LEN: 6,
  D1_TYPE: 1, D1_DRV: 3, RV_MIX: 0.08, RV_SIZE: 0.3, RV_DEC: 0.5, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Tom 808", "Tom", {
  T_LEV: 0, T_PITCH: 120, T_KT: 1, T_PE1_AMT: 9, T_PE1_TIME: 70, T_DEC: 320, C_LEV: -14, C_TYPE: 0, C_FREQ: 1800,
  D1_TYPE: 1, D1_DRV: 2, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Electro Tom FM", "Tom", {
  F_LEV: 0, F_FREQ: 150, F_KT: 1, F_FOLLOW: 1, F_MRATIO: 1.4, F_IDX: 6, F_IDXT: 120, F_DEC: 250,
  T_PE1_AMT: 24, T_PE1_TIME: 60, D1_TYPE: 1, D1_DRV: 4, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Conga", "Tom", {
  M_LEV: 0, M_PITCH: 280, M_KT: 1, M_MAT: 1, M_NUM: 5, M_DEC: 220, M_TILT: 1.4, M_BRT: 0.5, M_POS: 0.6, M_EXCL: 0.25, M_EXCN: 0.1,
  C_LEV: -6, C_TYPE: 2, C_FREQ: 1800, C_LEN: 4, S_CLK: 0.6, D1_TYPE: 1, D1_DRV: 2, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Taiko", "Tom", {
  M_LEV: 0, M_PITCH: 70, M_KT: 1, M_MAT: 1, M_NUM: 9, M_DEC: 1400, M_TILT: 0.9, M_BRT: 0.5, M_POS: 0.1, M_EXCL: 0.8, M_EXCN: 0.2, M_TENS: 5,
  T_LEV: -8, T_PITCH: 55, T_PE1_AMT: 12, T_PE1_TIME: 150, T_DEC: 900, N_LEV: -14, N_TYPE: 2, N_MODE: 0, N_CUT: 500, N_DEC: 500,
  RV_MIX: 0.25, RV_SIZE: 0.7, RV_DEC: 2.5, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Cowbell", "Perc", {
  T_LEV: 0, T_SHAPE: 3, T_PITCH: 540, T_KT: 0.5, T_DEC: 360, T_PE1_AMT: 0,
  M_LEV: -6, M_PITCH: 800, M_KT: 0.5, M_MAT: 4, M_NUM: 3, M_DEC: 300, M_EXCL: 0.15, M_BRT: 0.2,
  C_LEV: -10, C_TYPE: 4, C_FREQ: 2600, D1_TYPE: 1, D1_DRV: 6, EQ_HM_F: 2600, EQ_HM_G: 3, CP_THR: -18, CP_RATIO: 3, CP_MAKE: 3,
});
add("Clave", "Perc", {
  C_LEV: -3, C_TYPE: 2, C_FREQ: 2500, C_LEN: 4, M_LEV: -4, M_PITCH: 2400, M_KT: 0.5, M_MAT: 3, M_NUM: 2, M_DEC: 90, M_EXCL: 0.1, S_CLK: 1,
  CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Wood Block", "Perc", {
  M_LEV: 0, M_PITCH: 900, M_KT: 1, M_MAT: 3, M_NUM: 3, M_DEC: 120, M_BRT: 0.4, M_POS: 0.3, M_EXCL: 0.15, M_EXCN: 0.15,
  C_LEV: -8, C_TYPE: 4, C_FREQ: 2800, S_CLK: 1, D1_TYPE: 1, D1_DRV: 3, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Metal Clank", "Perc", {
  M_LEV: 0, M_PITCH: 380, M_KT: 1, M_MAT: 5, M_NUM: 12, M_DEC: 700, M_TILT: -0.2, M_BRT: -0.3, M_POS: 0.4, M_EXCL: 0.1, M_SPREAD: 12,
  X_LEV: -10, X_SET: 5, X_FREQ: 250, X_KT: 0, X_DEC: 120, C_LEV: -6, C_TYPE: 4, C_FREQ: 3500, S_CLK: 1,
  CP_THR: -18, CP_RATIO: 4, CP_MAKE: 4,
});
add("Anvil", "Perc", {
  M_LEV: 0, M_PITCH: 520, M_KT: 1, M_MAT: 3, M_NUM: 8, M_DEC: 1800, M_TILT: 0.6, M_BRT: 0.1, M_POS: 0.25, M_EXCL: 0.12, M_SPREAD: 6,
  X_LEV: -12, X_SET: 1, X_FREQ: 300, X_KT: 0, X_RING: 0.6, X_DEC: 800, C_LEV: -4, C_TYPE: 4, C_FREQ: 4500, S_CLK: 1.2,
  RV_MIX: 0.12, RV_SIZE: 0.5, RV_DEC: 1.2, CP_THR: -18, CP_RATIO: 4, CP_MAKE: 4,
});

// ───────────────────────── FX · SYNTH PERC · AGGRESSIVE ──────────────────────
add("Zap", "FX", {
  T_LEV: -6, T_PITCH: 800, T_PE1_AMT: 48, T_PE1_TIME: 90, T_PE1_CRV: -0.3, T_DEC: 220,
  F_LEV: 0, F_FREQ: 900, F_FOLLOW: 1, F_MRATIO: 2.5, F_IDX: 12, F_IDXT: 120, F_DEC: 220, F_KT: 0.5,
  D1_TYPE: 1, D1_DRV: 8, CP_THR: -16, CP_RATIO: 4, CP_MAKE: 4,
});
add("Laser", "FX", {
  T_LEV: 0, T_SHAPE: 0, T_PITCH: 200, T_PE1_AMT: 60, T_PE1_TIME: 250, T_PE1_CRV: -0.5, T_DEC: 400, T_FB: 0.5,
  D1_TYPE: 1, D1_DRV: 6, DL_MIX: 0.2, DL_TIME: 140, DL_FB: 0.4, CP_THR: -16, CP_RATIO: 3, CP_MAKE: 3,
});
add("Glitch Blip", "FX", {
  T_LEV: 0, T_SHAPE: 3, T_PITCH: 800, T_PE1_AMT: 0, T_DEC: 40, RAT_N: 4, RAT_TIME: 55, RAT_PITCH: 3, RAT_VEL: -0.1,
  CR_BITS: 4, CR_RATE: 8000, D1_TYPE: 3, D1_DRV: 10, CP_THR: -16, CP_RATIO: 4, CP_MAKE: 3,
});
add("Noise Burst", "FX", {
  N_LEV: 0, N_TYPE: 0, N_MODE: 2, N_CUT: 800, N_RES: 0.4, N_DEC: 900, N_CRV: -0.3, N_FE_AMT: 4, N_FE_TIME: 600, N_SLOPE: 1,
  RV_MIX: 0.3, RV_DEC: 2, RV_SIZE: 0.7, CP_THR: -18, CP_RATIO: 3, CP_MAKE: 3,
});
add("Obliterator (Macros)", "Aggressive", {
  T_LEV: 0, T_PITCH: 58, T_PE1_AMT: 40, T_PE1_TIME: 60, T_DEC: 480, T_TAIL: -9, T_TAILT: 380, C_LEV: -8, C_TYPE: 0, C_FREQ: 2500,
  D1_TYPE: 2, D1_DRV: 18, D2_TYPE: 3, D2_DRV: 8, CB_FREQ: 58, CB_FB: 0.9, CB_DAMP: 5000,
  MX1_SRC: 12, MX1_DST: "D1_DRV", MX1_AMT: 0.6, MX2_SRC: 13, MX2_DST: "CR_BITS", MX2_AMT: -0.75,
  MX3_SRC: 14, MX3_DST: "CB_MIX", MX3_AMT: 0.8, MX4_SRC: 15, MX4_DST: "T_PE1_AMT", MX4_AMT: 0.3,
  CP_THR: -22, CP_RATIO: 12, CP_ATT: 0.5, CP_REL: 70, CP_MAKE: 5, OUT_CLIP: 1,
});
add("Comb Destroyer", "Aggressive", {
  N_LEV: 0, N_MODE: 2, N_CUT: 2500, N_DEC: 120, C_LEV: -6, C_TYPE: 4, C_FREQ: 3000,
  CB_FREQ: 164, CB_KT: 1, CB_FB: -0.97, CB_DAMP: 9000, CB_MIX: 1, D1_TYPE: 9, D1_DRV: 18, D1_LOW: 200,
  CP_THR: -22, CP_RATIO: 10, CP_ATT: 0.5, CP_MAKE: 5, OUT_CLIP: 2,
});
add("Ring Mod Mayhem", "Aggressive", {
  X_LEV: 0, X_SET: 5, X_FREQ: 180, X_KT: 0, X_RING: 1, X_FOLD: 0.5, X_BPF: 4000, X_BPQ: 0.8, X_HPF: 400, X_BAND: 0.7, X_DEC: 260,
  T_LEV: -6, T_SHAPE: 2, T_PITCH: 90, T_PE1_AMT: 36, T_PE1_TIME: 60, T_DEC: 260, X_MRM: 0.6,
  RM_FREQ: 460, RM_MIX: 0.5, D1_TYPE: 3, D1_DRV: 20, CP_THR: -22, CP_RATIO: 10, CP_ATT: 0.5, CP_MAKE: 6, OUT_CLIP: 1,
});
add("Sync Scream", "Aggressive", {
  T_LEV: 0, T_SHAPE: 2, T_PITCH: 120, T_PE1_AMT: 24, T_PE1_TIME: 120, T_SYNC: 1, T_SYNCR: 9, T_DEC: 360, T_FOLD: 0.2,
  D1_TYPE: 2, D1_DRV: 24, D2_TYPE: 8, D2_DRV: 14, D2_MIX: 0.4, FL_ON: 1, FL_TYPE: 2, FL_CUT: 700, FL_RES: 8, FL_ENV: 3, FL_ENVT: 300,
  CP_THR: -22, CP_RATIO: 10, CP_ATT: 0.5, CP_MAKE: 5, OUT_CLIP: 1,
});
add("Bitcrushed Breaker", "Aggressive", {
  T_LEV: 0, T_SHAPE: 1, T_PITCH: 62, T_PE1_AMT: 30, T_PE1_TIME: 40, T_DEC: 300, N_LEV: -3, N_MODE: 1.3, N_CUT: 2800, N_RES: 0.3, N_DEC: 120,
  C_LEV: -6, C_TYPE: 1, C_FREQ: 4000, CR_BITS: 3.5, CR_RATE: 9000, CR_JIT: 0.4, D1_TYPE: 6, D1_DRV: 16,
  CP_THR: -22, CP_RATIO: 12, CP_ATT: 0.3, CP_MAKE: 6, OUT_CLIP: 1,
});
add("Tension Slam", "Aggressive", {
  M_LEV: 0, M_PITCH: 60, M_KT: 1, M_MAT: 1, M_NUM: 10, M_DEC: 900, M_TILT: 0.6, M_BRT: -0.4, M_POS: 0.05, M_EXCL: 0.2, M_EXCN: 0.3, M_TENS: 24, M_NL: 0.8, M_SPREAD: 20,
  T_LEV: -4, T_PITCH: 50, T_PE1_AMT: 36, T_PE1_TIME: 70, T_TENS: 12, T_DEC: 700,
  D1_TYPE: 7, D1_DRV: 22, D1_LOW: 90, CP_THR: -22, CP_RATIO: 10, CP_ATT: 1, CP_MAKE: 5, OUT_CLIP: 2,
});

// ---------------------------------------------------------------------
//  Resolve: OFF + set, destination names → indices, loudness trim
// ---------------------------------------------------------------------
import { MOD_DESTS, MOD_SRC } from "./params.mjs";
for (const p of PRESETS) {
  const s = { ...OFF, ...p.set };
  for (const k of Object.keys(s)) if (/^MX\d_DST$/.test(k) && typeof s[k] === "string") {
    const i = MOD_DESTS.findIndex((d) => d.key === s[k]);
    if (i < 0) throw new Error(`preset ${p.name}: ${s[k]} is not a modulation target`);
    s[k] = i + 1;
  }
  if (LEVELS[p.name] !== undefined) s.OUT_LEVEL = LEVELS[p.name];
  p.set = s;
}
