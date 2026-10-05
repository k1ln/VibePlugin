// =====================================================================
//  presets-extra.mjs — the second preset bank (200 presets). Each family is
//  written as a descriptor → parameter builder (K kick, S snare, C clap, H hat,
//  Y cymbal, T tom/membrane, P percussion) so that every preset is a deliberate
//  variation of a worked recipe rather than a random patch. tests/quality.mjs
//  holds them to per-category spectral/level/decay gates and to a minimum
//  distance from every other preset.
// =====================================================================

const comp = (thr = -16, ratio = 3, make = 3, att = 8, rel = 90) => ({ CP_THR: thr, CP_RATIO: ratio, CP_MAKE: make, CP_ATT: att, CP_REL: rel });

// ───────────────────────── kick ──────────────────────────────────────────────
const K = (o = {}) => {
  const d = { f: 52, sw: 30, swT: 40, swC: 0, sw2: 0, sw2T: 300, dec: 380, crv: 0, att: 0.4, shape: 0, fold: 0, tail: -60, tailT: 600, sub: -60,
    click: -14, ct: 1, cf: 2600, cl: 1.2, d1: 1, d1drv: 5, d1low: 0, d1mix: 1, d1bias: 0, d1tone: 0, d2: 0, d2drv: 0, d2mix: 1, d2low: 0,
    cp: [-16, 3, 3, 8, 90], x: {} };
  Object.assign(d, o);
  return {
    T_LEV: 0, T_SHAPE: d.shape, T_FOLD: d.fold, T_PITCH: d.f, T_PE1_AMT: d.sw, T_PE1_TIME: d.swT, T_PE1_CRV: d.swC, T_PE2_AMT: d.sw2, T_PE2_TIME: d.sw2T,
    T_DEC: d.dec, T_CRV: d.crv, T_ATT: d.att, T_TAIL: d.tail, T_TAILT: d.tailT, T_SUB: d.sub,
    C_LEV: d.click, C_TYPE: d.ct, C_FREQ: d.cf, C_LEN: d.cl,
    D1_TYPE: d.d1, D1_DRV: d.d1drv, D1_LOW: d.d1low || 20, D1_MIX: d.d1mix, D1_BIAS: d.d1bias, D1_TONE: d.d1tone,
    D2_TYPE: d.d2, D2_DRV: d.d2drv, D2_MIX: d.d2mix, D2_LOW: d.d2low || 20, ...comp(...d.cp), EQ_HPF: 18, ...d.x,
  };
};

// ───────────────────────── snare ─────────────────────────────────────────────
const S = (o = {}) => {
  const d = { f: 190, shape: 1, sw: 10, swT: 20, dec: 130, lev: -6, f2: 330, f2L: -12, f2dec: 90, f2idx: 0,
    nLev: 3, nMode: 1, nCut: 5200, nRes: 0.05, nDec: 200, nCrv: -0.1, nType: 0, nSlope: 0, click: -10, ct: 1, cf: 4000, cl: 1.2,
    d1: 1, d1drv: 4, d1mix: 1, d2: 0, d2drv: 0, rv: 0, rvdec: 0.5, rvsize: 0.3, cp: [-16, 3, 3, 4, 70], x: {} };
  Object.assign(d, o);
  return {
    T_LEV: d.lev, T_SHAPE: d.shape, T_PITCH: d.f, T_PE1_AMT: d.sw, T_PE1_TIME: d.swT, T_DEC: d.dec,
    F_LEV: d.f2 ? d.f2L : -60, F_FREQ: d.f2 || 330, F_IDX: d.f2idx, F_DEC: d.f2dec, F_FOLLOW: 0.5,
    N_LEV: d.nLev, N_TYPE: d.nType, N_MODE: d.nMode, N_CUT: d.nCut, N_RES: d.nRes, N_DEC: d.nDec, N_CRV: d.nCrv, N_SLOPE: d.nSlope, N_KT: 0,
    C_LEV: d.click, C_TYPE: d.ct, C_FREQ: d.cf, C_LEN: d.cl,
    D1_TYPE: d.d1, D1_DRV: d.d1drv, D1_MIX: d.d1mix, D2_TYPE: d.d2, D2_DRV: d.d2drv,
    RV_MIX: d.rv, RV_DEC: d.rvdec, RV_SIZE: d.rvsize, ...comp(...d.cp), EQ_HPF: 60, ...d.x,
  };
};

// ───────────────────────── clap ──────────────────────────────────────────────
const C = (o = {}) => {
  const d = { bn: 4, bsp: 10, bjit: 0.3, blen: 7, bslope: 0.15, cut: 1200, res: 0.35, mode: 1, dec: 300, crv: -0.1, wid: 0.7, type: 0, rate: 6000,
    click: -60, ct: 4, cf: 3500, d1: 1, d1drv: 4, rv: 0.12, rvdec: 0.6, rvsize: 0.35, cp: [-18, 3, 4, 6, 80], x: {} };
  Object.assign(d, o);
  return {
    N_LEV: 0, N_TYPE: d.type, N_RATE: d.rate, N_GATE: 1, N_BN: d.bn, N_BSP: d.bsp, N_BJIT: d.bjit, N_BLEN: d.blen, N_BSLOPE: d.bslope,
    N_MODE: d.mode, N_CUT: d.cut, N_RES: d.res, N_DEC: d.dec, N_CRV: d.crv, N_WIDTH: d.wid, N_KT: 0,
    C_LEV: d.click, C_TYPE: d.ct, C_FREQ: d.cf, D1_TYPE: d.d1, D1_DRV: d.d1drv,
    RV_MIX: d.rv, RV_DEC: d.rvdec, RV_SIZE: d.rvsize, ...comp(...d.cp), EQ_HPF: 200, ...d.x,
  };
};

// ───────────────────────── hat / cymbal ─────────────────────────────────────
const H = (o = {}) => {
  const d = { set: 0, f: 205, spread: 1, bpf: 8500, bpq: 1.5, hpf: 7000, band: 0.35, dec: 45, crv: -0.1, ring: 0, fold: 0, shm: 0, pw: 0.5,
    tail: -60, tailT: 700, feAmt: 0, feT: 80, nLev: -60, nCut: 9000, nDec: 35, nMode: 2, click: -60, cp: [-20, 3, 3, 8, 90], x: {} };
  Object.assign(d, o);
  return {
    X_LEV: 0, X_SET: d.set, X_FREQ: d.f, X_KT: 0, X_SPREAD: d.spread, X_BPF: d.bpf, X_BPQ: d.bpq, X_HPF: d.hpf, X_BAND: d.band, X_DEC: d.dec, X_CRV: d.crv,
    X_RING: d.ring, X_FOLD: d.fold, X_SHM: d.shm, X_PW: d.pw, X_TAIL: d.tail, X_TAILT: d.tailT, X_FE_AMT: d.feAmt, X_FE_TIME: d.feT,
    N_LEV: d.nLev, N_MODE: d.nMode, N_CUT: d.nCut, N_RES: 0.05, N_DEC: d.nDec, N_KT: 0, C_LEV: d.click, C_TYPE: 4, C_FREQ: 6000,
    D1_TYPE: 0, ...comp(...d.cp), EQ_HPF: 300, ...d.x,
  };
};

// ───────────────────────── tom / membrane / mallet (modal) ───────────────────
const T = (o = {}) => {
  const d = { f: 100, mat: 1, num: 8, dec: 450, tilt: 1.1, brt: 0.8, pos: 0.25, excl: 0.35, excn: 0.1, tens: 7, spread: 0, mkt: 1, nl: 0,
    body: -8, bodyDec: 300, bodySw: 7, bodySwT: 60, click: -12, ct: 5, cf: 1200, cl: 6, d1: 1, d1drv: 3, rv: 0.08, rvdec: 0.5, rvsize: 0.3,
    cp: [-16, 3, 3, 8, 90], x: {} };
  Object.assign(d, o);
  return {
    M_LEV: 0, M_PITCH: d.f, M_KT: d.mkt, M_MAT: d.mat, M_NUM: d.num, M_DEC: d.dec, M_TILT: d.tilt, M_BRT: d.brt, M_POS: d.pos, M_EXCL: d.excl,
    M_EXCN: d.excn, M_TENS: d.tens, M_SPREAD: d.spread, M_NL: d.nl,
    T_LEV: d.body, T_PITCH: d.f, T_KT: d.mkt, T_PE1_AMT: d.bodySw, T_PE1_TIME: d.bodySwT, T_DEC: d.bodyDec,
    C_LEV: d.click, C_TYPE: d.ct, C_FREQ: d.cf, C_LEN: d.cl, S_CLK: 0.8,
    D1_TYPE: d.d1, D1_DRV: d.d1drv, RV_MIX: d.rv, RV_DEC: d.rvdec, RV_SIZE: d.rvsize, ...comp(...d.cp), EQ_HPF: 40, ...d.x,
  };
};

// ───────────────────────── pitched / metallic percussion ──────────────────────
const P = (o = {}) => {
  const d = { f: 900, mat: 3, num: 3, dec: 150, tilt: 0.8, brt: 0.4, pos: 0.3, excl: 0.15, excn: 0.15, mkt: 0.5, click: -8, ct: 4, cf: 2800, cl: 3,
    sends: 1, d1: 1, d1drv: 3, rv: 0, rvdec: 0.5, rvsize: 0.3, cp: [-16, 3, 3, 8, 90], x: {} };
  Object.assign(d, o);
  return {
    M_LEV: 0, M_PITCH: d.f, M_KT: d.mkt, M_MAT: d.mat, M_NUM: d.num, M_DEC: d.dec, M_TILT: d.tilt, M_BRT: d.brt, M_POS: d.pos, M_EXCL: d.excl, M_EXCN: d.excn,
    C_LEV: d.click, C_TYPE: d.ct, C_FREQ: d.cf, C_LEN: d.cl, S_CLK: d.sends, D1_TYPE: d.d1, D1_DRV: d.d1drv,
    RV_MIX: d.rv, RV_DEC: d.rvdec, RV_SIZE: d.rvsize, ...comp(...d.cp), EQ_HPF: 120, ...d.x,
  };
};

export function registerExtra(addBase) {
  const add = addBase;
  // ═════════════════════════ KICKS (40) ═════════════════════════════════════
  add("808 Long Boom", "Kick", K({ f: 42, sw: 14, swT: 22, sw2: 3, sw2T: 500, dec: 2400, crv: 0.15, click: -20, ct: 0, cf: 1200, d1drv: 8, d1low: 70, cp: [-12, 2.5, 2, 20, 200] }));
  add("808 Short Punch", "Kick", K({ f: 56, sw: 20, swT: 18, dec: 420, crv: -0.1, click: -11, ct: 0, cf: 2000, d1drv: 6 }));
  add("808 Tuned F1", "Kick", K({ f: 43.65, sw: 12, swT: 26, sw2: 2, sw2T: 380, dec: 1600, click: -18, ct: 0, cf: 1400, d1drv: 5, d1low: 60 , x: { HUMAN: 0 } }));
  add("808 Tuned A1", "Kick", K({ f: 55, sw: 12, swT: 26, sw2: 2, sw2T: 320, dec: 1300, click: -18, ct: 0, cf: 1400, d1drv: 5, d1low: 60 , x: { HUMAN: 0 } }));
  add("808 Tuned D1", "Kick", K({ f: 36.7, sw: 12, swT: 30, sw2: 2, sw2T: 450, dec: 2000, click: -20, ct: 0, cf: 1100, d1drv: 6, d1low: 55 , x: { HUMAN: 0 } }));
  add("808 Saturated Boom", "Kick", K({ f: 46, sw: 16, swT: 24, dec: 1800, click: -16, ct: 0, d1: 5, d1drv: 16, d1low: 80, d1mix: 0.7, cp: [-14, 3, 3, 15, 160] }));
  add("808 Hard Clip", "Kick", K({ f: 50, sw: 18, swT: 22, dec: 1200, click: -12, ct: 4, cf: 3600, d1: 2, d1drv: 22, d1low: 90, d1mix: 0.55, cp: [-16, 4, 3, 10, 120] }));
  add("808 Clicky Tick", "Kick", K({ f: 52, sw: 18, swT: 20, dec: 700, click: -4, ct: 4, cf: 5200, cl: 0.6, d1drv: 5 }));
  add("808 Sub Pad", "Kick", K({ f: 40, sw: 6, swT: 60, dec: 3000, att: 6, crv: 0.35, click: -60, d1drv: 3, d1low: 60, cp: [-10, 2, 2, 30, 300] }));
  add("909 Classic", "Kick", K({ f: 52, sw: 44, swT: 52, swC: -0.1, shape: 0.05, dec: 470, crv: 0.1, click: -12, ct: 5, cf: 2000, cl: 3, d1: 5, d1drv: 9, d1mix: 0.6, d1low: 80, cp: [-18, 4, 4, 8, 90] }));
  add("909 Hard", "Kick", K({ f: 58, sw: 40, swT: 34, swC: -0.2, shape: 0.25, dec: 340, click: -5, ct: 1, cf: 3200, d1: 2, d1drv: 18, d1mix: 0.5, d1low: 100, cp: [-20, 5, 5, 6, 80] }));
  add("909 Deep", "Kick", K({ f: 47, sw: 34, swT: 50, shape: 0.1, dec: 560, click: -11, ct: 1, cf: 2100, d1drv: 6, d1low: 70 }));
  add("909 Tight", "Kick", K({ f: 60, sw: 36, swT: 26, swC: -0.3, shape: 0.3, dec: 210, crv: -0.15, click: -7, ct: 1, cf: 3000, d1: 2, d1drv: 9, d1mix: 0.4 }));
  add("909 Boom Tail", "Kick", K({ f: 50, sw: 34, swT: 42, shape: 0.15, dec: 360, tail: -10, tailT: 900, click: -10, ct: 1, cf: 2400, d1: 2, d1drv: 10, d1mix: 0.35, d1low: 90 }));
  add("707 Thud", "Kick", K({ f: 62, sw: 24, swT: 28, shape: 0.35, dec: 230, click: -9, ct: 1, cf: 2200, d1drv: 4 }));
  add("606 Kick", "Kick", K({ f: 72, sw: 18, swT: 20, shape: 0.2, dec: 170, crv: -0.1, click: -12, ct: 0, cf: 1800, d1drv: 3 }));
  add("Linn Kick", "Kick", K({ f: 62, sw: 30, swT: 30, shape: 0.1, dec: 300, click: -9, ct: 1, cf: 4400, cl: 0.8, d1: 1, d1drv: 7, cp: [-16, 4, 4, 5, 70] }));
  add("Simmons Boom", "Kick", K({ f: 70, sw: 42, swT: 90, swC: -0.35, dec: 520, shape: 0, click: -14, d1drv: 4, x: { F_LEV: -12, F_FREQ: 120, F_FOLLOW: 1, F_IDX: 2, F_DEC: 200 } }));
  add("House Deep", "Kick", K({ f: 50, sw: 26, swT: 34, dec: 330, click: -11, ct: 5, cf: 1500, cl: 4, d1drv: 4, x: { EQ_LM_F: 280, EQ_LM_G: -4, EQ_HS_G: 2 } }));
  add("House Piano Thump", "Kick", K({ f: 56, sw: 22, swT: 30, shape: 0.15, dec: 260, click: -9, ct: 5, cf: 1800, cl: 5, d1drv: 5, cp: [-16, 4, 4, 10, 90] }));
  add("Chicago Jack", "Kick", K({ f: 58, sw: 30, swT: 36, shape: 0.3, dec: 280, click: -6, ct: 1, cf: 3000, d1: 4, d1drv: 8, d1mix: 0.6, cp: [-18, 4, 4, 6, 80] }));
  add("Tech House Punch", "Kick", K({ f: 54, sw: 32, swT: 30, dec: 300, tail: -20, tailT: 380, click: -7, ct: 4, cf: 3800, d1: 4, d1drv: 11, d1low: 100, cp: [-18, 5, 4, 8, 90] }));
  add("Techno Rumble", "Kick", K({ f: 52, sw: 28, swT: 34, dec: 280, tail: -8, tailT: 750, click: -8, ct: 1, cf: 3000, d1: 4, d1drv: 15, d1low: 110, x: { RV_MIX: 0.35, RV_SIZE: 0.8, RV_DEC: 2.2, RV_DAMP: 0.7, RV_GATE: 1, RV_GHOLD: 220, RV_GREL: 60 }, cp: [-18, 5, 5, 10, 100] }));
  add("Berlin Warehouse", "Kick", K({ f: 48, sw: 30, swT: 40, dec: 420, tail: -6, tailT: 1100, click: -10, ct: 1, cf: 2400, d1: 3, d1drv: 14, d1low: 100, d1mix: 0.6, d2: 2, d2drv: 10, d2mix: 0.35, cp: [-20, 6, 5, 8, 120] }));
  add("Minimal Click", "Kick", K({ f: 62, sw: 16, swT: 16, dec: 150, crv: -0.2, click: -3, ct: 4, cf: 5600, cl: 0.5, d1drv: 3 }));
  add("Acid Techno Kick", "Kick", K({ f: 54, sw: 34, swT: 36, shape: 0.5, dec: 310, click: -6, ct: 1, cf: 3500, d1: 9, d1drv: 14, d1mix: 0.55, d1low: 120, cp: [-18, 5, 4, 5, 80] }));
  add("Hardstyle Classic", "Kick", K({ f: 48, sw: 46, swT: 70, swC: -0.3, sw2: -5, sw2T: 500, dec: 520, tail: -6, tailT: 700, click: -8, ct: 0, cf: 2800, d1: 3, d1drv: 20, d1low: 80, d2: 2, d2drv: 16, d2low: 160, cp: [-20, 8, 5, 3, 100], x: { OUT_CLIP: 2 } }));
  add("Euphoric Hardstyle", "Kick", K({ f: 50, sw: 44, swT: 64, swC: -0.25, sw2: -3, sw2T: 450, dec: 640, tail: -5, tailT: 900, shape: 0.1, click: -7, ct: 0, d1: 3, d1drv: 18, d1low: 90, d2: 1, d2drv: 14, d2low: 180, cp: [-20, 8, 5, 3, 110], x: { OUT_CLIP: 2, EQ_HM_G: 3, EQ_HM_F: 1800 } }));
  add("Rawstyle Distorted", "Kick", K({ f: 52, sw: 48, swT: 80, swC: -0.35, sw2: -6, sw2T: 600, dec: 700, tail: -4, tailT: 1000, click: -6, ct: 0, d1: 2, d1drv: 34, d1low: 100, d2: 3, d2drv: 14, d2mix: 0.6, cp: [-22, 10, 6, 2, 100], x: { OUT_CLIP: 1, CR_BITS: 12, CR_RATE: 32000 } }));
  add("Gabber 90s", "Kick", K({ f: 64, sw: 40, swT: 50, swC: -0.1, dec: 480, tail: -9, tailT: 320, click: -8, ct: 0, d1: 2, d1drv: 38, d1tone: 0.15, d2: 3, d2drv: 12, d2mix: 0.45, cp: [-22, 12, 6, 0.6, 60], x: { OUT_CLIP: 1, CR_BITS: 11, CR_RATE: 28000 } }));
  add("Gabber Rotterdam", "Kick", K({ f: 58, sw: 44, swT: 58, dec: 640, tail: -7, tailT: 460, click: -7, ct: 0, d1: 3, d1drv: 30, d2: 2, d2drv: 24, d2mix: 0.7, cp: [-22, 12, 7, 0.5, 70], x: { OUT_CLIP: 1, EQ_LS_G: 4, EQ_HM_G: 4, EQ_HM_F: 2200 } }));
  add("Uptempo Terror", "Kick", K({ f: 68, sw: 46, swT: 40, dec: 340, tail: -9, tailT: 260, click: -5, ct: 4, cf: 4200, d1: 9, d1drv: 30, d2: 2, d2drv: 20, cp: [-24, 16, 7, 0.4, 50], x: { OUT_CLIP: 1, CR_BITS: 9, CR_RATE: 22000 } }));
  add("DnB Sub Punch", "Kick", K({ f: 56, sw: 22, swT: 22, dec: 260, click: -8, ct: 1, cf: 3200, d1: 1, d1drv: 7, d1low: 80, cp: [-16, 4, 3, 8, 70] }));
  add("Trap 808 Glide", "Kick", K({ f: 40, sw: -10, swT: 150, swC: 0, sw2: 0, dec: 2600, att: 2, crv: 0.2, click: -16, ct: 0, cf: 1000, d1drv: 10, d1low: 70, d1mix: 0.8, x: { T_PE1_CRV: 0.3 }, cp: [-12, 3, 3, 15, 200] }));
  add("Drill Slide Kick", "Kick", K({ f: 44, sw: 22, swT: 120, swC: 0.2, dec: 1400, click: -12, ct: 0, cf: 1400, d1: 4, d1drv: 11, d1low: 70, cp: [-14, 4, 3, 10, 150] }));
  add("UK Garage Thump", "Kick", K({ f: 58, sw: 26, swT: 24, shape: 0.2, dec: 230, click: -8, ct: 1, cf: 2800, d1drv: 6, d1low: 90 }));
  add("Dubstep Weight", "Kick", K({ f: 38, sw: 20, swT: 60, dec: 1200, tail: -9, tailT: 1600, click: -10, ct: 0, cf: 1600, d1: 3, d1drv: 12, d1low: 60, d1mix: 0.55, cp: [-14, 4, 3, 12, 200] }));
  add("Rock Kick Modal", "Kick", {
    M_LEV: -2, M_PITCH: 82, M_MAT: 1, M_NUM: 6, M_DEC: 300, M_TILT: 1.5, M_BRT: 1.0, M_POS: 0.12, M_EXCL: 0.5, M_EXCN: 0.2, M_TENS: 5,
    T_LEV: -8, T_PITCH: 60, T_PE1_AMT: 16, T_PE1_TIME: 26, T_DEC: 200, C_LEV: -6, C_TYPE: 5, C_FREQ: 1100, C_LEN: 7, S_CLK: 1.2,
    N_LEV: -22, N_TYPE: 2, N_MODE: 0, N_CUT: 600, N_DEC: 180, ...comp(-16, 3.5, 3, 12, 100), EQ_HPF: 30, EQ_LM_F: 350, EQ_LM_G: -5, EQ_HM_F: 3500, EQ_HM_G: 3, RV_MIX: 0.12, RV_SIZE: 0.45, RV_DEC: 0.7 });
  add("Jazz Kick Soft", "Kick", {
    M_LEV: -2, M_PITCH: 70, M_MAT: 1, M_NUM: 5, M_DEC: 420, M_TILT: 1.2, M_BRT: 0.7, M_POS: 0.1, M_EXCL: 1.2, M_EXCN: 0.35, M_TENS: 3,
    T_LEV: -14, T_PITCH: 56, T_PE1_AMT: 8, T_PE1_TIME: 40, T_DEC: 260, C_LEV: -60, ...comp(-18, 2.5, 3, 14, 140), EQ_HPF: 30, RV_MIX: 0.18, RV_SIZE: 0.5, RV_DEC: 0.9 });
  add("Lo-Fi Dust Kick", "Kick", K({ f: 54, sw: 22, swT: 40, dec: 300, click: -12, ct: 5, cf: 1200, cl: 6, d1: 5, d1drv: 10, cp: [-16, 4, 4, 6, 90], x: { CR_BITS: 8, CR_RATE: 14000, CR_JIT: 0.15, EQ_LPF: 7000, EQ_HPF: 40 } }));
  add("8-Bit Kick", "Kick", K({ f: 60, sw: 36, swT: 60, shape: 3, dec: 220, click: -60, d1: 0, cp: [-14, 3, 2, 8, 80], x: { CR_BITS: 4, CR_RATE: 9000, T_PW: 0.5 } }));
  add("FM Kick", "Kick", {
    F_LEV: 0, F_FREQ: 56, F_KT: 1, F_FOLLOW: 1, F_MRATIO: 1.5, F_IDX: 7, F_IDXT: 45, F_DEC: 300, T_LEV: -60, T_PE1_AMT: 34, T_PE1_TIME: 36,
    C_LEV: -10, C_TYPE: 1, C_FREQ: 3000, D1_TYPE: 1, D1_DRV: 6, ...comp(-16, 3.5, 3, 8, 80), EQ_HPF: 20 });
  add("Saw Kick", "Kick", K({ f: 56, sw: 32, swT: 36, shape: 2, dec: 300, click: -10, ct: 1, d1: 1, d1drv: 6, x: { FL_ON: 1, FL_TYPE: 0, FL_CUT: 600, FL_RES: 1.5, FL_ENV: 2, FL_ENVT: 90 }, cp: [-16, 4, 4, 8, 80] }));
  add("Electro Zap Kick", "Kick", K({ f: 50, sw: 54, swT: 50, swC: -0.4, dec: 340, click: -9, ct: 3, cf: 2400, cl: 3, d1drv: 6, x: { F_LEV: -12, F_FREQ: 90, F_FOLLOW: 1, F_IDX: 5, F_IDXT: 40, F_DEC: 180 } }));
  add("Industrial Kick Crush", "Kick", K({ f: 56, sw: 34, swT: 46, shape: 2, dec: 440, fold: 0.25, click: -7, ct: 1, d1: 9, d1drv: 26, d2: 3, d2drv: 12, cp: [-20, 14, 6, 0.4, 70], x: { T_FB: 0.7, CR_BITS: 7, CR_RATE: 12000, OUT_CLIP: 1 } }));
  add("Cinematic Hit", "Kick", K({ f: 34, sw: 12, swT: 160, dec: 4000, att: 4, tail: -6, tailT: 3500, click: -14, ct: 5, cf: 600, cl: 12, d1drv: 6, d1low: 60, x: { N_LEV: -10, N_TYPE: 2, N_MODE: 0, N_CUT: 500, N_DEC: 2500, N_ATT: 5, RV_MIX: 0.5, RV_SIZE: 0.9, RV_DEC: 5, RV_DAMP: 0.6 }, cp: [-14, 3, 3, 25, 300] }));
  add("Sub Drop", "Kick", K({ f: 30, sw: 36, swT: 600, swC: -0.3, dec: 3500, att: 1, click: -60, d1drv: 4, d1low: 50, cp: [-10, 2, 2, 30, 300], x: { T_PE1_CRV: -0.2 } }));
  add("Boxing Punch", "Kick", K({ f: 64, sw: 18, swT: 14, dec: 120, crv: -0.2, click: -5, ct: 5, cf: 900, cl: 10, d1: 4, d1drv: 10, x: { N_LEV: -6, N_TYPE: 2, N_MODE: 0, N_CUT: 900, N_DEC: 90 }, cp: [-16, 4, 3, 5, 60] }));

  // ═════════════════════════ SNARES (30) ═════════════════════════════════════
  add("808 Snare Tight", "Snare", S({ f: 175, shape: 1, sw: 10, swT: 14, dec: 85, f2: 300, f2dec: 55, nMode: 0.9, nCut: 3800, nRes: 0.1, nDec: 120, nCrv: -0.3, click: -18, d1drv: 2 }));
  add("808 Snare Long", "Snare", S({ f: 185, shape: 1, sw: 9, swT: 22, dec: 170, f2dec: 130, nCut: 4400, nDec: 330, nCrv: -0.05, click: -16, rv: 0.1 }));
  add("909 Snare Fat", "Snare", S({ f: 182, shape: 0.6, sw: 8, swT: 30, dec: 140, lev: -2, f2dec: 100, nMode: 1.15, nCut: 5600, nDec: 230, nLev: 4, d1: 2, d1drv: 9, d1mix: 0.35, rv: 0.08 }));
  add("909 Snare Snappy", "Snare", S({ f: 195, shape: 0.5, sw: 7, swT: 24, dec: 95, lev: -4, f2dec: 70, nMode: 1.25, nCut: 6800, nDec: 170, nLev: 0, click: -8, d1: 2, d1drv: 8, d1mix: 0.3 }));
  add("707 Snare", "Snare", S({ f: 200, shape: 0.8, sw: 10, swT: 20, dec: 110, f2: 340, f2dec: 80, nCut: 5200, nDec: 180, click: -12 }));
  add("606 Snare", "Snare", S({ f: 230, shape: 1.4, sw: 12, swT: 14, dec: 85, f2: 360, f2L: -12, f2dec: 60, nCut: 4200, nMode: 1.3, nDec: 130, click: -16, d1drv: 2 }));
  add("Linn Snare", "Snare", S({ f: 205, shape: 0.4, sw: 8, swT: 24, dec: 120, nCut: 6500, nMode: 1.2, nDec: 260, click: -8, ct: 1, cf: 5000, rv: 0.15, rvdec: 0.8, d1: 1, d1drv: 6 }));
  add("DMX Snare", "Snare", S({ f: 210, shape: 0.2, sw: 6, swT: 20, dec: 110, nCut: 5800, nMode: 1.1, nDec: 190, click: -6, d1: 1, d1drv: 8, cp: [-18, 4, 4, 4, 60] }));
  add("Simmons Snare", "Snare", S({ f: 240, shape: 0, sw: 40, swT: 55, dec: 200, lev: -10, f2: 0, nCut: 3200, nMode: 1.6, nDec: 160, nLev: 6, click: -10, d1drv: 6, x: { T_PE1_CRV: -0.3 } }));
  add("Trap Snare Crack", "Snare", S({ f: 215, shape: 1, sw: 12, swT: 14, dec: 90, nCut: 6200, nDec: 160, nLev: -1, click: -4, ct: 4, cf: 4800, d1: 4, d1drv: 10, rv: 0.1, rvdec: 0.5, cp: [-18, 5, 4, 3, 60] }));
  add("Trap Snare Pitched", "Snare", S({ f: 260, shape: 0.3, sw: 18, swT: 24, dec: 130, f2: 520, f2L: -12, f2dec: 90, nCut: 7000, nMode: 1.2, nDec: 120, nLev: 9, click: -6, d1drv: 6, rv: 0.12 }));
  add("Boom Bap Snare", "Snare", S({ f: 175, shape: 1, sw: 8, swT: 30, dec: 160, nCut: 4000, nMode: 1, nDec: 190, nRes: 0.1, click: -10, ct: 5, cf: 2400, cl: 3, d1: 5, d1drv: 8, x: { CR_BITS: 11, CR_RATE: 22000, EQ_LPF: 10000 }, cp: [-16, 4, 4, 8, 80] }));
  add("Lo-Fi Snare", "Snare", S({ f: 180, shape: 1, sw: 6, swT: 26, dec: 150, nCut: 3600, nDec: 210, click: -14, ct: 5, cf: 1600, d1: 5, d1drv: 9, x: { CR_BITS: 8, CR_RATE: 12000, CR_JIT: 0.2, EQ_LPF: 6500 }, rv: 0.14 }));
  add("Rock Snare Big Room", "Snare", {
    M_LEV: -5, M_PITCH: 200, M_MAT: 1, M_NUM: 8, M_DEC: 300, M_TILT: 1.1, M_BRT: 0.5, M_POS: 0.4, M_EXCL: 0.4, M_EXCN: 0.35, S_CLK: 1,
    N_LEV: 0, N_GATE: 2, N_RAT: 0.8, N_MODE: 1.1, N_CUT: 5400, N_RES: 0.05, N_DEC: 330, N_KT: 0, C_LEV: -9, C_TYPE: 1, C_FREQ: 4500,
    T_LEV: -10, T_PITCH: 200, T_PE1_AMT: 8, T_PE1_TIME: 18, T_DEC: 130, RV_MIX: 0.35, RV_SIZE: 0.8, RV_DEC: 1.8, RV_DAMP: 0.4, ...comp(-18, 3.5, 4, 6, 90), EQ_HPF: 90 });
  add("Rock Snare Tight", "Snare", {
    M_LEV: -5, M_PITCH: 215, M_MAT: 1, M_NUM: 6, M_DEC: 170, M_TILT: 1.3, M_BRT: 0.6, M_POS: 0.4, M_EXCL: 0.25, M_EXCN: 0.3, S_CLK: 1,
    N_LEV: 0, N_GATE: 2, N_RAT: 0.9, N_MODE: 1.15, N_CUT: 5800, N_RES: 0.05, N_DEC: 170, N_KT: 0, C_LEV: -8, C_TYPE: 1, C_FREQ: 5000,
    RV_MIX: 0.06, RV_SIZE: 0.25, RV_DEC: 0.4, ...comp(-18, 4, 4, 4, 70), EQ_HPF: 100 });
  add("Jazz Brush Snare", "Snare", S({ f: 200, shape: 0, sw: 3, swT: 30, dec: 60, lev: -14, f2: 0, nType: 1, nMode: 1, nCut: 3800, nRes: 0.02, nDec: 260, nLev: 0, nCrv: 0.2, click: -60, d1: 0, rv: 0.1, cp: [-20, 2, 4, 15, 120], x: { N_ATT: 14 } }));
  add("Piccolo Snare", "Snare", S({ f: 290, shape: 1, sw: 9, swT: 14, dec: 70, f2: 520, f2L: -10, f2dec: 55, nCut: 7200, nMode: 1.25, nDec: 120, click: -8, rv: 0.08, cp: [-18, 4, 4, 4, 60] }));
  add("Deep Snare", "Snare", S({ f: 150, shape: 0.9, sw: 8, swT: 28, dec: 200, f2: 260, f2dec: 140, nCut: 3600, nMode: 0.9, nDec: 260, nRes: 0.1, click: -12, rv: 0.12 }));
  add("Gated Reverb Snare", "Snare", S({ f: 200, shape: 0.6, sw: 9, swT: 26, dec: 130, nCut: 5000, nMode: 1.2, nDec: 240, nLev: 0, click: -8, rv: 0.95, rvdec: 1.8, rvsize: 0.6, d1: 2, d1drv: 10, d1mix: 0.4, cp: [-24, 8, 8, 1, 80], x: { RV_GATE: 1, RV_GHOLD: 170, RV_GREL: 25 } }));
  add("80s Pop Snare", "Snare", S({ f: 215, shape: 0.5, sw: 12, swT: 30, dec: 150, nCut: 6000, nMode: 1.2, nDec: 300, click: -6, rv: 0.45, rvdec: 1.3, rvsize: 0.55, d1: 2, d1drv: 7, d1mix: 0.35, cp: [-18, 4, 4, 3, 80], x: { RV_PRE: 14 } }));
  add("Industrial Snare Smash", "Snare", S({ f: 220, shape: 2, sw: 20, swT: 18, dec: 90, nCut: 3800, nMode: 1.4, nDec: 180, click: -6, ct: 4, cf: 3200, d1: 2, d1drv: 30, d2: 3, d2drv: 12, cp: [-22, 20, 6, 0.2, 60], x: { VEL_AMP: 1, VEL_BRT: 0.9, CR_BITS: 8, CR_RATE: 16000, OUT_CLIP: 1 } }));
  add("Techno Snare Metallic", "Snare", S({ f: 240, shape: 3, sw: 14, swT: 16, dec: 100, f2: 0, nCut: 6400, nMode: 1.3, nDec: 150, click: -8, ct: 4, cf: 4000, d1: 4, d1drv: 10, x: { X_LEV: -14, X_SET: 1, X_FREQ: 300, X_DEC: 120, X_BPF: 6500, X_HPF: 3000 } }));
  add("DnB Snare Layered", "Snare", S({ f: 205, shape: 1, sw: 14, swT: 18, dec: 110, lev: -4, f2: 340, f2dec: 90, nCut: 6000, nDec: 170, nLev: -2, click: -4, ct: 4, cf: 4500, d1: 4, d1drv: 11, cp: [-18, 5, 5, 3, 60], x: { M_LEV: -8, M_PITCH: 210, M_NUM: 5, M_DEC: 150, M_EXCL: 0.2, S_CLK: 1 } }));
  add("Neurofunk Snare", "Snare", S({ f: 225, shape: 2, sw: 16, swT: 20, dec: 100, nCut: 4600, nMode: 1.4, nDec: 150, click: -6, ct: 4, cf: 3600, d1: 3, d1drv: 22, d2: 2, d2drv: 14, cp: [-22, 12, 6, 0.5, 60], x: { FL_ON: 1, FL_TYPE: 1, FL_CUT: 1800, FL_RES: 3, FL_ENV: 2, FL_ENVT: 100, OUT_CLIP: 2 } }));
  add("Rimshot Hard", "Snare", S({ f: 480, shape: 1, sw: 5, swT: 6, dec: 38, lev: -3, f2: 1700, f2L: -9, f2dec: 24, nLev: -24, click: -2, ct: 4, cf: 2800, d1drv: 6, x: { M_LEV: -10, M_PITCH: 900, M_MAT: 2, M_NUM: 4, M_DEC: 60, M_EXCL: 0.1 } }));
  add("Side Stick", "Snare", S({ f: 420, shape: 1, sw: 3, swT: 5, dec: 30, lev: -6, f2: 1300, f2L: -8, f2dec: 20, nLev: -60, click: -4, ct: 4, cf: 2400, d1: 0, x: { M_LEV: -6, M_PITCH: 800, M_MAT: 3, M_NUM: 3, M_DEC: 45, M_EXCL: 0.08 } }));
  add("Snare Roll Buzz", "Snare", S({ f: 195, sw: 9, swT: 20, dec: 70, nCut: 5400, nDec: 90, click: -10, x: { RAT_N: 12, RAT_TIME: 38, RAT_VEL: 0.04, RAT_PITCH: 0 }, cp: [-18, 4, 3, 5, 60] }));
  add("Flam Snare", "Snare", S({ f: 200, sw: 10, swT: 20, dec: 120, nCut: 5200, nDec: 190, click: -9, x: { RAT_N: 2, RAT_TIME: 28, RAT_VEL: 0.3 } }));
  add("Clap Snare Hybrid", "Snare", S({ f: 210, shape: 0.6, sw: 8, swT: 20, dec: 90, lev: -6, nCut: 2200, nMode: 1, nDec: 220, nRes: 0.3, click: -8, rv: 0.2, rvdec: 0.8, x: { N_GATE: 1, N_BN: 3, N_BSP: 8, N_BLEN: 5, N_BJIT: 0.3 } }));
  add("FM Snare", "Snare", S({ f: 0, lev: -60, f2: 280, f2L: 0, f2idx: 4, f2dec: 130, nCut: 5400, nDec: 190, click: -8, d1: 1, d1drv: 6, x: { F_MRATIO: 1.6, F_IDXT: 60, F_FOLLOW: 0 } }));
  add("Electro Snare", "Snare", S({ f: 230, shape: 0.2, sw: 24, swT: 40, dec: 130, nCut: 4400, nMode: 1.3, nDec: 170, click: -8, ct: 3, cf: 3000, cl: 3, d1: 4, d1drv: 8 }));
  add("Hardcore Snare", "Snare", S({ f: 235, shape: 0.5, sw: 20, swT: 22, dec: 120, nCut: 5000, nMode: 1.3, nDec: 200, click: -5, d1: 2, d1drv: 28, d2: 3, d2drv: 10, cp: [-22, 14, 6, 0.4, 60], x: { OUT_CLIP: 1, CR_BITS: 10, CR_RATE: 26000 } }));
  add("Glitch Snare", "Snare", S({ f: 220, sw: 14, swT: 18, dec: 80, nCut: 5800, nDec: 110, click: -8, d1: 3, d1drv: 12, x: { RAT_N: 4, RAT_TIME: 55, RAT_VEL: -0.15, RAT_PITCH: 2, CR_BITS: 6, CR_RATE: 14000, CR_JIT: 0.25 } }));

  // ═════════════════════════ CLAPS (15) ══════════════════════════════════════
  add("Clap 808 Tight", "Clap", C({ bn: 3, bsp: 8, blen: 5, cut: 1300, res: 0.4, dec: 190, rv: 0.06, wid: 0.5 }));
  add("Clap 808 Wide", "Clap", C({ bn: 5, bsp: 9, blen: 7, cut: 1150, res: 0.3, dec: 340, wid: 1, rv: 0.18, rvsize: 0.5, x: { OUT_WIDTH: 1.5 } }));
  add("Clap Big Room", "Clap", C({ bn: 4, bsp: 11, blen: 8, cut: 1250, res: 0.3, dec: 420, wid: 0.9, rv: 0.45, rvdec: 1.8, rvsize: 0.8, rvsize2: 0, x: { RV_DAMP: 0.5 } }));
  add("Clap Gated", "Clap", C({ bn: 4, bsp: 9, blen: 6, cut: 1400, res: 0.3, dec: 260, rv: 0.9, rvdec: 1.6, rvsize: 0.6, cp: [-24, 8, 8, 1, 80], x: { RV_GATE: 1, RV_GHOLD: 150, RV_GREL: 25 } }));
  add("Clap Dry Slap", "Clap", C({ bn: 2, bsp: 6, blen: 4, cut: 1700, res: 0.25, dec: 90, bjit: 0.2, rv: 0, wid: 0.3, d1: 0 }));
  add("Clap Trap Layered", "Clap", C({ bn: 3, bsp: 6.5, blen: 4, cut: 1600, res: 0.45, dec: 140, click: -9, ct: 4, cf: 3600, d1: 4, d1drv: 10, rv: 0.2, rvdec: 0.8, cp: [-20, 5, 5, 5, 70] }));
  add("Clap House", "Clap", C({ bn: 4, bsp: 12, blen: 8, cut: 1050, res: 0.3, dec: 280, wid: 0.8, rv: 0.2, rvdec: 0.9, cp: [-18, 3, 4, 8, 90] }));
  add("Clap Techno Dist", "Clap", C({ bn: 4, bsp: 8, blen: 6, cut: 1800, res: 0.4, dec: 220, d1: 3, d1drv: 16, d1mix: 0.6, rv: 0.25, rvdec: 1, cp: [-20, 6, 5, 4, 70] }));
  add("Handclap Crowd", "Clap", C({ bn: 12, bsp: 5, bjit: 0.9, blen: 6, bslope: 0.05, cut: 1500, res: 0.15, dec: 420, wid: 1, rv: 0.3, rvdec: 1.4, rvsize: 0.7, x: { OUT_WIDTH: 1.6 } }));
  add("Clap Broken Lo-Fi", "Clap", C({ bn: 5, bsp: 12, bjit: 0.8, blen: 5, cut: 2000, res: 0.2, dec: 230, type: 6, rate: 8000, d1: 5, d1drv: 10, rv: 0.12, x: { CR_BITS: 6, CR_RATE: 13000, EQ_LPF: 8000 } }));
  add("Clap 909", "Clap", C({ bn: 4, bsp: 11, blen: 8, cut: 1500, res: 0.3, dec: 300, wid: 0.8, rv: 0.28, rvdec: 1.1, rvsize: 0.5 }));
  add("Clap Distorted", "Clap", C({ bn: 4, bsp: 8, blen: 6, cut: 1700, res: 0.35, dec: 250, d1: 2, d1drv: 26, d1mix: 0.8, d2: 3, d2drv: 8, rv: 0.15, cp: [-22, 10, 6, 1, 70], x: { OUT_CLIP: 1 } }));
  add("Clap Metallic", "Clap", C({ bn: 4, bsp: 9, blen: 6, cut: 2400, res: 0.6, dec: 240, d1: 1, d1drv: 6, rv: 0.2, x: { CB_MIX: 0.5, CB_FREQ: 420, CB_FB: 0.88, CB_DAMP: 7000 } }));
  add("Clap Reversed Swell", "Clap", C({ bn: 8, bsp: 14, bjit: 0.4, blen: 12, bslope: 0.8, cut: 1300, res: 0.3, dec: 200, rv: 0.4, rvdec: 1.4, x: { N_ATT: 6 } }));
  add("Snap Finger", "Clap", C({ bn: 1, bsp: 5, blen: 3, cut: 2600, res: 0.55, dec: 55, wid: 0.2, mode: 1, click: -3, ct: 4, cf: 4800, rv: 0.18, rvdec: 0.5, cp: [-18, 3, 4, 3, 50] }));

  // ═════════════════════════ HATS (20) ═══════════════════════════════════════
  add("CH 808 Tight", "Hat", H({ dec: 30, bpf: 7600, hpf: 6000, band: 0.25, bpq: 2 }));
  add("CH 808 Loose", "Hat", H({ dec: 75, bpf: 8600, hpf: 6200, band: 0.55, bpq: 1.1, crv: 0 }));
  add("CH 909 Sharp", "Hat", H({ set: 1, f: 220, dec: 32, bpf: 11500, hpf: 9500, band: 0.6, nLev: -3, nCut: 11000, nDec: 28 }));
  add("CH Metallic Ring", "Hat", H({ set: 5, f: 260, dec: 60, bpf: 6800, bpq: 5, hpf: 4800, ring: 0.6, spread: 1.5, band: 0.1 }));
  add("CH Dry Noise", "Hat", H({ set: 0, dec: 22, nLev: 0, nCut: 10000, nDec: 24, x: { X_LEV: -60, N_SLOPE: 1 } }));
  add("CH Bright Air", "Hat", H({ set: 1, f: 320, dec: 40, bpf: 11000, bpq: 1, hpf: 9000, band: 0.7, nLev: -6, nCut: 12000, nDec: 34 }));
  add("CH Lo-Fi Dirty", "Hat", H({ set: 0, dec: 55, bpf: 6500, hpf: 4800, nLev: -10, nDec: 45, x: { CR_BITS: 7, CR_RATE: 15000, D1_TYPE: 5, D1_DRV: 10, EQ_LPF: 9000 } }));
  add("CH Crushed", "Hat", H({ set: 4, f: 380, dec: 50, bpf: 8000, hpf: 6000, ring: 0.3, x: { CR_BITS: 5.5, CR_RATE: 20000, CR_JIT: 0.1 } }));
  add("CH Industrial", "Hat", H({ set: 5, f: 300, dec: 70, bpf: 6000, bpq: 2.5, hpf: 3600, fold: 0.45, ring: 0.5, x: { VEL_AMP: 1, VEL_BRT: 0.9, D1_TYPE: 9, D1_DRV: 14 } }));
  add("CH Hi-NRG", "Hat", H({ set: 0, f: 270, dec: 24, bpf: 9800, bpq: 2.5, hpf: 8800, band: 0.85, spread: 1.4, ring: 0.2 }));
  add("OH 808 Short", "Hat", H({ dec: 220, crv: 0.1, bpf: 8500, hpf: 6800, tail: -10, tailT: 380 }));
  add("OH 808 Long", "Hat", H({ dec: 760, crv: 0.3, bpf: 7400, hpf: 5600, band: 0.25, tail: -7, tailT: 1300 }));
  add("OH 909 Sizzle", "Hat", H({ set: 1, f: 220, dec: 360, crv: 0.1, bpf: 9500, bpq: 1.2, hpf: 7500, band: 0.5, shm: 0.4, tail: -8, tailT: 700, nLev: -10, nCut: 9500, nDec: 330 }));
  add("OH Shimmer Wash", "Hat", H({ set: 4, f: 400, dec: 650, bpf: 9000, bpq: 2, hpf: 6500, ring: 0.4, shm: 0.8, spread: 1.4, feAmt: 1.2, feT: 400, x: { DL_MIX: 0.15, DL_TIME: 140, DL_FB: 0.35, RV_MIX: 0.18, RV_DEC: 1.4 } }));
  add("Pedal Hat Chick", "Hat", H({ dec: 20, bpf: 6000, bpq: 1.2, hpf: 4500, band: 0.2, click: -12 }));
  add("Shaker", "Hat", H({ dec: 70, nLev: 0, nCut: 5600, nDec: 120, nMode: 1.15, x: { X_LEV: -60, N_ATT: 22, N_CRV: 0.2, N_RES: 0.1, EQ_HPF: 700 } }));
  add("Maracas", "Hat", H({ dec: 40, nLev: 8, nCut: 6500, nDec: 50, nMode: 1.5, x: { X_LEV: -60, N_ATT: 9, N_TYPE: 5, N_RATE: 7000, EQ_HPF: 700, RAT_N: 2, RAT_TIME: 55, RAT_VEL: -0.35 } }));
  add("Tambourine", "Hat", H({ set: 1, f: 520, dec: 180, bpf: 9500, bpq: 1.2, hpf: 5200, ring: 0.2, shm: 0.5, nLev: -6, nCut: 8500, nDec: 100, x: { RAT_N: 3, RAT_TIME: 24, RAT_VEL: -0.2, EQ_HPF: 900 } }));
  add("Hat Roll 1/32", "Hat", H({ dec: 26, x: { RAT_N: 8, RAT_SYNC: 3, RAT_VEL: -0.07 } }));
  add("Trap Hat Roll Up", "Hat", H({ set: 1, f: 230, dec: 28, bpf: 9500, hpf: 7500, x: { RAT_N: 6, RAT_TIME: 46, RAT_VEL: -0.04, RAT_PITCH: 1.5 } }));

  // ═════════════════════════ CYMBALS (12) ════════════════════════════════════
  add("Crash Bright", "Cymbal", H({ set: 1, f: 280, spread: 1.2, bpf: 8000, bpq: 0.8, hpf: 4200, band: 0.6, ring: 0.3, shm: 0.5, dec: 2200, feAmt: 2, feT: 1400, tail: -6, tailT: 3200, nLev: -8, nCut: 6000, nDec: 1600 }));
  add("Crash Dark", "Cymbal", H({ set: 1, f: 220, spread: 1.0, bpf: 5500, bpq: 0.8, hpf: 2800, band: 0.5, ring: 0.3, shm: 0.5, dec: 2800, feAmt: 2.4, feT: 1800, tail: -5, tailT: 3600, nLev: -9, nCut: 4500, nDec: 2000 }));
  add("Splash Quick", "Cymbal", H({ set: 1, f: 340, spread: 1.1, bpf: 9500, hpf: 5200, ring: 0.2, dec: 620, feAmt: 1.6, feT: 450 }));
  add("China Chaos", "Cymbal", H({ set: 5, f: 300, bpf: 6500, bpq: 1, hpf: 3000, fold: 0.4, ring: 0.5, shm: 0.4, dec: 1000, x: { VEL_AMP: 1, VEL_BRT: 0.9, D1_TYPE: 9, D1_DRV: 12, D1_LOW: 800 } }));
  add("Ride Ping", "Cymbal", { ...H({ set: 1, f: 330, spread: 0.9, bpf: 7800, bpq: 1.4, hpf: 4800, band: 0.5, dec: 900, crv: 0.1 }), M_LEV: -4, M_PITCH: 580, M_MAT: 4, M_NUM: 5, M_DEC: 800, M_TILT: -0.1, M_BRT: 0.4, M_POS: 0.3, M_EXCL: 0.2, M_KT: 0, S_CLK: 0 });
  add("Ride Wash", "Cymbal", H({ set: 1, f: 320, spread: 1, bpf: 7000, bpq: 1, hpf: 4000, ring: 0.2, shm: 0.6, dec: 2600, tail: -8, tailT: 3500, nLev: -10, nCut: 6500, nDec: 2000, x: { RV_MIX: 0.12, RV_DEC: 1.2 } }));
  add("Ride Bell", "Cymbal", { ...P({ f: 780, mat: 4, num: 6, dec: 1400, tilt: -0.1, brt: 0.2, pos: 0.25, excl: 0.12, click: -10, ct: 4, cf: 5000, cl: 1.5, d1: 0, rv: 0.08 }) });
  add("Open Sizzle", "Cymbal", H({ set: 4, f: 380, bpf: 8500, hpf: 5500, ring: 0.3, shm: 0.9, dec: 1500, feAmt: 1, feT: 900, spread: 1.3, nLev: -8, nCut: 8000, nDec: 1200 }));
  add("Gong Large", "Cymbal", { ...T({ f: 85, mat: 4, num: 12, dec: 5000, tilt: -0.4, brt: 0.2, pos: 0.2, excl: 3, tens: 0, spread: 10, mkt: 0.5, body: -60, click: -60, d1: 0, rv: 0.3, rvdec: 3.2, rvsize: 0.85 }), X_LEV: -14, X_SET: 3, X_FREQ: 100, X_KT: 0, X_SHM: 0.6, X_DEC: 4500, X_BPF: 2400, X_HPF: 400, M_EXCN: 0.5 });
  add("Gong Small", "Cymbal", { ...T({ f: 190, mat: 4, num: 12, dec: 3800, tilt: -0.3, brt: 0.25, pos: 0.2, excl: 1.5, tens: 0, spread: 8, mkt: 0.5, body: -60, click: -60, d1: 0, rv: 0.25, rvdec: 3, rvsize: 0.7 }), X_LEV: -14, X_SET: 3, X_FREQ: 200, X_KT: 0, X_SHM: 0.5, X_DEC: 2600, X_BPF: 3600, X_HPF: 600 });
  add("Tam-Tam", "Cymbal", { ...T({ f: 130, mat: 2, num: 12, dec: 6000, tilt: -0.5, brt: 0.1, pos: 0.15, excl: 2.5, tens: 2, spread: 24, mkt: 0.5, body: -60, click: -60, d1: 0, nl: 0.3, rv: 0.35, rvdec: 5, rvsize: 0.9 }), N_LEV: -16, N_MODE: 2, N_CUT: 2500, N_DEC: 3000, N_ATT: 30 });
  add("Swell Crash", "Cymbal", H({ set: 1, f: 270, spread: 1.2, bpf: 7500, hpf: 3800, ring: 0.3, shm: 0.6, dec: 2400, feAmt: -1.5, feT: 1500, x: { X_ATT: 700, X_CRV: 0.5, N_LEV: -9, N_ATT: 700, N_MODE: 2, N_CUT: 5500, N_DEC: 2000, N_CRV: 0.5 } }));

  // ═════════════════════════ TOMS (15) ═══════════════════════════════════════
  add("Floor Tom", "Tom", T({ f: 78, num: 8, dec: 620, tilt: 1.0, brt: 0.7, pos: 0.2, excl: 0.4, tens: 6, bodySw: 6, bodyDec: 420, rv: 0.1, rvsize: 0.4 }));
  add("Rack Tom Low", "Tom", T({ f: 110, num: 8, dec: 480, tilt: 1.1, brt: 0.8, pos: 0.25, excl: 0.35, tens: 7 }));
  add("Rack Tom Mid", "Tom", T({ f: 150, num: 8, dec: 400, tilt: 1.15, brt: 0.85, pos: 0.25, excl: 0.3, tens: 7 }));
  add("Rack Tom High", "Tom", T({ f: 205, num: 7, dec: 320, tilt: 1.2, brt: 0.9, pos: 0.3, excl: 0.28, tens: 8 }));
  add("808 Tom Low", "Tom", { T_LEV: 0, T_PITCH: 95, T_PE1_AMT: 10, T_PE1_TIME: 75, T_DEC: 380, C_LEV: -14, C_TYPE: 0, C_FREQ: 1800, D1_TYPE: 1, D1_DRV: 2, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("808 Tom Mid", "Tom", { T_LEV: 0, T_SHAPE: 0.3, T_PITCH: 135, T_PE1_AMT: 12, T_PE1_TIME: 45, T_DEC: 230, C_LEV: -14, C_TYPE: 0, C_FREQ: 1800, D1_TYPE: 1, D1_DRV: 2, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("808 Tom High", "Tom", { T_LEV: 0, T_PITCH: 190, T_PE1_AMT: 8, T_PE1_TIME: 55, T_DEC: 260, C_LEV: -14, C_TYPE: 0, C_FREQ: 2000, D1_TYPE: 1, D1_DRV: 2, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("Electro Tom Low", "Tom", { F_LEV: 0, F_FREQ: 110, F_KT: 1, F_FOLLOW: 1, F_MRATIO: 1.4, F_IDX: 5, F_IDXT: 110, F_DEC: 300, T_PE1_AMT: 26, T_PE1_TIME: 65, C_LEV: -60, D1_TYPE: 1, D1_DRV: 4, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("Electro Tom High", "Tom", { F_LEV: 0, F_FREQ: 230, F_KT: 1, F_FOLLOW: 1, F_MRATIO: 1.4, F_IDX: 6, F_IDXT: 90, F_DEC: 220, T_PE1_AMT: 24, T_PE1_TIME: 55, C_LEV: -60, D1_TYPE: 1, D1_DRV: 4, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("Simmons Tom Sweep", "Tom", { T_LEV: 0, T_SHAPE: 0.2, T_PITCH: 120, T_PE1_AMT: 44, T_PE1_TIME: 110, T_PE1_CRV: -0.35, T_DEC: 420, C_LEV: -12, C_TYPE: 1, C_FREQ: 3000, D1_TYPE: 1, D1_DRV: 5, ...comp(-16, 3, 3), EQ_HPF: 30 });
  add("Conga Open", "Tom", T({ f: 290, num: 5, dec: 260, tilt: 1.4, brt: 0.5, pos: 0.6, excl: 0.25, tens: 3, bodySw: 4, bodyDec: 120, click: -6, ct: 2, cf: 1800, cl: 4 }));
  add("Conga Slap", "Tom", T({ f: 320, num: 6, dec: 110, tilt: 1.8, brt: 0.2, pos: 0.7, excl: 0.12, excn: 0.4, tens: 2, bodyDec: 60, click: -3, ct: 4, cf: 3200, cl: 2 }));
  add("Bongo High", "Tom", T({ f: 430, num: 5, dec: 150, tilt: 1.6, brt: 0.5, pos: 0.55, excl: 0.15, tens: 3, bodySw: 3, bodyDec: 80, click: -6, ct: 2, cf: 2600, cl: 3 }));
  add("Timbale", "Tom", { ...T({ f: 520, num: 4, dec: 300, tilt: 0.7, brt: 0.1, pos: 0.4, excl: 0.1, tens: 1, mat: 3, bodyDec: 60, click: -4, ct: 4, cf: 4500, cl: 2 }), X_LEV: -16, X_SET: 1, X_FREQ: 500, X_DEC: 80 });
  add("Taiko Big", "Tom", T({ f: 62, num: 9, dec: 1800, tilt: 0.8, brt: 0.5, pos: 0.1, excl: 0.9, excn: 0.2, tens: 5, body: -8, bodyDec: 1000, bodySw: 10, bodySwT: 150, rv: 0.3, rvsize: 0.75, rvdec: 2.8, x: { N_LEV: -15, N_TYPE: 2, N_MODE: 0, N_CUT: 500, N_DEC: 600 } }));

  // ═════════════════════════ PERCUSSION (25) ═════════════════════════════════
  add("Cowbell Bright", "Perc", { T_LEV: 0, T_SHAPE: 3, T_PITCH: 660, T_KT: 0.5, T_DEC: 260, M_LEV: -4, M_PITCH: 980, M_KT: 0.5, M_MAT: 4, M_NUM: 3, M_DEC: 300, M_EXCL: 0.15, M_BRT: 0.2, C_LEV: -6, C_TYPE: 4, C_FREQ: 4200, D1_TYPE: 4, D1_DRV: 9, ...comp(-18, 3, 3), EQ_HPF: 400, EQ_HM_F: 3600, EQ_HM_G: 4 });
  add("Cowbell Deep", "Perc", { T_LEV: 0, T_SHAPE: 3, T_PITCH: 400, T_KT: 0.5, T_DEC: 420, M_LEV: -8, M_PITCH: 590, M_KT: 0.5, M_MAT: 4, M_NUM: 3, M_DEC: 360, M_EXCL: 0.2, C_LEV: -12, C_TYPE: 4, C_FREQ: 2200, D1_TYPE: 1, D1_DRV: 8, ...comp(-18, 3, 3), EQ_HPF: 250 });
  add("Agogo High", "Perc", P({ f: 1150, mat: 3, num: 4, dec: 420, tilt: 0.5, brt: 0.1, excl: 0.1, click: -8, cf: 4000 }));
  add("Agogo Low", "Perc", P({ f: 780, mat: 3, num: 4, dec: 480, tilt: 0.5, brt: 0.1, excl: 0.1, click: -8, cf: 3600 }));
  add("Clave Hollow", "Perc", P({ f: 1750, mat: 2, num: 3, dec: 160, tilt: 1.2, brt: 0.6, excl: 0.14, click: -9, ct: 5, cf: 1500, cl: 3, rv: 0.12, rvdec: 0.6 }));
  add("Woodblock High", "Perc", P({ f: 1300, mat: 3, num: 3, dec: 90, brt: 0.4, click: -8, cf: 3000 }));
  add("Woodblock Low", "Perc", P({ f: 780, mat: 3, num: 3, dec: 110, brt: 0.4, click: -8, cf: 2600 }));
  add("Triangle", "Perc", P({ f: 3100, mat: 3, num: 5, dec: 2600, tilt: -0.1, brt: -0.1, excl: 0.06, click: -10, cf: 8000, cl: 0.5, mkt: 0, x: { HUMAN: 0, EQ_HPF: 800 } }));
  add("Tubular Bell", "Perc", P({ f: 440, mat: 4, num: 8, dec: 3500, tilt: 0.2, brt: 0.2, pos: 0.25, excl: 0.2, click: -12, ct: 5, cf: 1800, cl: 5, mkt: 1, rv: 0.25, rvdec: 2.2, rvsize: 0.7 , x: { HUMAN: 0 } }));
  add("Glass Tap", "Perc", P({ f: 1900, mat: 3, num: 4, dec: 520, tilt: 0.3, brt: 0.3, excl: 0.06, click: -6, ct: 4, cf: 6500, cl: 1, mkt: 1, rv: 0.2, rvdec: 1.2 , x: { HUMAN: 0 } }));
  add("Marimba Mallet", "Perc", P({ f: 330, mat: 3, num: 3, dec: 520, tilt: 2.2, brt: 0.8, pos: 0.4, excl: 0.5, excn: 0.1, click: -14, ct: 5, cf: 1400, cl: 4, mkt: 1, x: { HUMAN: 0, M_STR: -0.15 } }));
  add("Kalimba Pluck", "Perc", P({ f: 520, mat: 3, num: 3, dec: 900, tilt: 1.5, brt: 0.5, pos: 0.35, excl: 0.2, click: -12, ct: 4, cf: 3600, mkt: 1, rv: 0.15, rvdec: 1.1 , x: { HUMAN: 0 } }));
  add("Steel Pan", "Perc", P({ f: 440, mat: 2, num: 6, dec: 1500, tilt: 0.6, brt: 0.4, pos: 0.3, excl: 0.35, excn: 0.1, click: -14, ct: 5, cf: 1800, mkt: 1, rv: 0.2, rvdec: 1.4, x: { HUMAN: 0, M_TENS: 3 } }));
  add("Metal Pipe", "Perc", P({ f: 350, mat: 5, num: 12, dec: 1100, tilt: -0.1, brt: -0.2, pos: 0.4, excl: 0.08, click: -5, ct: 4, cf: 3500, mkt: 1, rv: 0.15, rvdec: 0.9, x: { M_SPREAD: 14 } }));
  add("Forge Hammer", "Perc", P({ f: 300, mat: 3, num: 10, dec: 3000, tilt: 0.3, brt: -0.2, pos: 0.15, excl: 0.07, click: -2, ct: 4, cf: 6500, sends: 1.6, mkt: 1, d1: 2, d1drv: 14, d1mix: 0.5, rv: 0.25, rvdec: 2.2, rvsize: 0.7, x: { M_SPREAD: 4, M_TENS: 8, X_LEV: -16, X_SET: 3, X_FREQ: 150, X_DEC: 1500, EQ_LS_G: 4 } }));
  add("Cabasa", "Perc", H({ dec: 60, nLev: 0, nCut: 10500, nDec: 45, nMode: 2, x: { X_LEV: -60, N_ATT: 4, N_TYPE: 1, N_RES: 0.2, N_SLOPE: 1, EQ_HPF: 1800 } }));
  add("Guiro Scrape", "Perc", H({ dec: 100, nLev: 0, nCut: 4500, nDec: 40, nMode: 1.2, x: { X_LEV: -60, RAT_N: 10, RAT_TIME: 30, RAT_VEL: 0.05, RAT_RAND: 0.3, N_RES: 0.3 } }));
  add("Tick Click", "Perc", { C_LEV: 0, C_TYPE: 4, C_FREQ: 5000, C_LEN: 1.5, D1_TYPE: 0, ...comp(-16, 3, 4), EQ_HPF: 300 });
  add("Rim Pop", "Perc", P({ f: 1700, mat: 2, num: 4, dec: 70, brt: 0.5, excl: 0.08, click: -3, ct: 2, cf: 2200, cl: 3, rv: 0.1, rvdec: 0.5 }));
  add("Bottle Pop", "Perc", { T_LEV: 0, T_PITCH: 260, T_PE1_AMT: -14, T_PE1_TIME: 35, T_PE1_CRV: 0.2, T_DEC: 90, C_LEV: -10, C_TYPE: 5, C_FREQ: 800, D1_TYPE: 1, D1_DRV: 4, ...comp(-16, 3, 4, 3, 50), EQ_HPF: 100, RV_MIX: 0.1, RV_DEC: 0.5 });
  add("Water Drop", "Perc", { T_LEV: 0, T_PITCH: 500, T_PE1_AMT: 18, T_PE1_TIME: 70, T_PE1_CRV: -0.3, T_DEC: 140, T_KT: 1, C_LEV: -60, D1_TYPE: 0, ...comp(-16, 3, 4), EQ_HPF: 150, RV_MIX: 0.3, RV_DEC: 1.5, RV_SIZE: 0.6, DL_MIX: 0.2, DL_TIME: 220, DL_FB: 0.4 });
  add("Finger Cymbal", "Perc", P({ f: 4200, mat: 2, num: 6, dec: 1800, tilt: -0.2, brt: -0.2, excl: 0.05, click: -12, cf: 9000, cl: 0.5, mkt: 0, rv: 0.12, x: { HUMAN: 0, EQ_HPF: 1200 } }));
  add("Vibraslap Rattle", "Perc", { ...P({ f: 900, mat: 5, num: 12, dec: 900, tilt: -0.2, brt: 0, excl: 0.1, click: -6, d1: 0 }), N_LEV: -12, N_MODE: 1.3, N_CUT: 5000, N_DEC: 700, N_GATE: 2, N_RAT: 1, RAT_N: 16, RAT_TIME: 22, RAT_VEL: -0.04 });
  add("Castanet", "Perc", P({ f: 1600, mat: 3, num: 3, dec: 55, brt: 0.5, excl: 0.1, click: -2, ct: 4, cf: 4000, cl: 1.5, rv: 0.1, rvdec: 0.4, x: { RAT_N: 2, RAT_TIME: 30, RAT_VEL: -0.2 } }));

  // ═════════════════════════ FX (20) ═════════════════════════════════════════
  const fxT = (o) => ({ T_LEV: 0, D1_TYPE: 1, D1_DRV: 6, ...comp(-16, 3, 3, 6, 80), EQ_HPF: 60, ...o });
  add("Laser Down", "FX", fxT({ T_PITCH: 220, T_PE1_AMT: 62, T_PE1_TIME: 280, T_PE1_CRV: -0.5, T_DEC: 450, T_FB: 0.4, DL_MIX: 0.2, DL_TIME: 130, DL_FB: 0.4 }));
  add("Laser Up", "FX", fxT({ T_PITCH: 200, T_PE1_AMT: -30, T_PE1_TIME: 260, T_PE1_CRV: 0.4, T_DEC: 380, T_SHAPE: 2, DL_MIX: 0.15, DL_TIME: 150 }));
  add("Zap Tri-FM", "FX", { F_LEV: 0, F_FREQ: 1800, F_FOLLOW: 1, F_MRATIO: 3.7, F_MWAVE: 1, F_IDX: 22, F_IDXT: 60, F_DEC: 130, F_KT: 0.5, T_LEV: -60, T_PE1_AMT: 60, T_PE1_TIME: 45, T_PE1_CRV: -0.5, D1_TYPE: 3, D1_DRV: 10, ...comp(-16, 4, 4), EQ_HPF: 300, RAT_N: 2, RAT_TIME: 60, RAT_PITCH: -5, RAT_VEL: -0.2 , VEL_AMP: 1, VEL_BRT: 0.9 });
  add("Blip", "FX", fxT({ T_SHAPE: 3, T_PITCH: 1200, T_PE1_AMT: 0, T_DEC: 45, T_KT: 1 }));
  add("Bleep Arp Burst", "FX", fxT({ T_SHAPE: 1, T_PITCH: 600, T_PE1_AMT: 0, T_DEC: 55, RAT_N: 6, RAT_TIME: 70, RAT_PITCH: 3, RAT_VEL: -0.05, T_KT: 1 }));
  add("Noise Sweep Down", "FX", { N_LEV: 6, N_MODE: 1, N_CUT: 600, N_RES: 0.45, N_DEC: 900, N_FE_AMT: 5, N_FE_TIME: 700, N_SLOPE: 1, N_CRV: -0.2, D1_TYPE: 0, ...comp(-18, 3, 4), RV_MIX: 0.25, RV_DEC: 2 });
  add("Noise Riser Short", "FX", { N_LEV: 0, N_MODE: 2, N_CUT: 300, N_RES: 0.4, N_DEC: 1400, N_CRV: 0.9, N_ATT: 700, N_FE_AMT: -4, N_FE_TIME: 1200, N_SLOPE: 1, D1_TYPE: 0, ...comp(-18, 3, 4), RV_MIX: 0.2, RV_DEC: 1.5 });
  add("Impact Boom FX", "FX", K({ f: 36, sw: 14, swT: 180, dec: 5000, att: 3, tail: -6, tailT: 4500, click: -12, ct: 5, cf: 700, cl: 10, d1drv: 8, d1low: 60, x: { N_WIDTH: 0, N_LEV: -8, N_TYPE: 2, N_MODE: 0, N_CUT: 450, N_DEC: 3200, RV_MIX: 0.6, RV_SIZE: 0.95, RV_DEC: 7, RV_DAMP: 0.6 }, cp: [-14, 3, 3, 25, 300] }));
  add("Reverse Swell", "FX", { N_LEV: 4, N_MODE: 1, N_CUT: 2400, N_RES: 0.3, N_ATT: 900, N_DEC: 2500, N_CRV: 1, T_LEV: -8, T_SHAPE: 2, T_PITCH: 110, T_ATT: 900, T_DEC: 2500, T_CRV: 1, D1_TYPE: 0, ...comp(-18, 3, 4), RV_MIX: 0.25, RV_DEC: 1.5 });
  add("Glitch Stutter", "FX", fxT({ T_SHAPE: 3, T_PITCH: 500, T_PE1_AMT: 12, T_PE1_TIME: 25, T_DEC: 60, RAT_N: 10, RAT_SYNC: 4, RAT_VEL: -0.06, RAT_PITCH: -1, CR_BITS: 6, CR_RATE: 12000, CR_JIT: 0.3, D1_TYPE: 3, D1_DRV: 10 }));
  add("Crush Burst", "FX", { N_LEV: 0, N_TYPE: 0, N_MODE: 1.3, N_CUT: 2500, N_DEC: 160, CR_BITS: 2.5, CR_RATE: 6000, CR_JIT: 0.5, D1_TYPE: 2, D1_DRV: 14, ...comp(-20, 8, 5, 1, 60) });
  add("Alarm Ping", "FX", fxT({ T_PITCH: 880, T_SHAPE: 0, T_PE1_AMT: 0, T_DEC: 140, T_KT: 1, RAT_N: 4, RAT_SYNC: 2, RAT_PITCH: 0, RAT_VEL: -0.1, RV_MIX: 0.2, RV_DEC: 0.9 }));
  add("Sonar Ping", "FX", fxT({ T_PITCH: 1400, T_SHAPE: 0, T_PE1_AMT: -2, T_PE1_TIME: 30, T_DEC: 900, T_ATT: 3, DL_MIX: 0.4, DL_TIME: 380, DL_FB: 0.55, RV_MIX: 0.35, RV_DEC: 3, RV_SIZE: 0.8 }));
  add("Power Down", "FX", fxT({ T_PITCH: 60, T_SHAPE: 2, T_PE1_AMT: 40, T_PE1_TIME: 1200, T_PE1_CRV: -0.6, T_DEC: 1400, T_FB: 0.3, FL_ON: 1, FL_CUT: 4000, FL_RES: 2, FL_ENV: -3, FL_ENVT: 1100 }));
  add("Whoosh", "FX", { N_LEV: 8, N_MODE: 1, N_CUT: 500, N_RES: 0.3, N_ATT: 220, N_DEC: 900, N_CRV: 0.4, N_FE_AMT: 4, N_FE_TIME: 450, N_SLOPE: 1, D1_TYPE: 0, ...comp(-18, 3, 4), RV_MIX: 0.2, OUT_WIDTH: 1.8 });
  add("Sub Drop FX", "FX", fxT({ T_PITCH: 28, T_PE1_AMT: 48, T_PE1_TIME: 1400, T_PE1_CRV: -0.3, T_DEC: 3200, T_ATT: 2, D1_DRV: 4, D1_LOW: 50 }));
  add("Metal Riser", "FX", { X_LEV: 0, X_SET: 5, X_FREQ: 200, X_KT: 0, X_BPF: 5000, X_HPF: 1200, X_RING: 0.5, X_FE_AMT: -2, X_FE_TIME: 1200, X_ATT: 800, X_DEC: 1600, X_CRV: 0.9, X_PE_AMT: -12, X_PE_TIME: 800, D1_TYPE: 0, ...comp(-18, 3, 4), RV_MIX: 0.2, RV_DEC: 1.5 });
  add("Thunder", "FX", { N_LEV: 0, N_TYPE: 2, N_MODE: 0, N_CUT: 500, N_RES: 0.1, N_ATT: 40, N_DEC: 4000, N_CRV: -0.2, N_FE_AMT: -1, N_FE_TIME: 2500, D1_TYPE: 1, D1_DRV: 8, ...comp(-16, 3, 4, 20, 300), RV_MIX: 0.5, RV_SIZE: 0.95, RV_DEC: 6, RV_DAMP: 0.6, EQ_HPF: 30 });
  add("Tape Stop", "FX", fxT({ T_PITCH: 180, T_SHAPE: 2, T_PE1_AMT: -48, T_PE1_TIME: 700, T_PE1_CRV: 0.3, T_ATT: 2, T_DEC: 800, FL_ON: 1, FL_CUT: 6000, FL_RES: 1, FL_ENV: -2, FL_ENVT: 700 }));
  add("Vinyl Pop", "FX", { N_LEV: 0, N_TYPE: 4, N_RATE: 600, N_MODE: 1.2, N_CUT: 4000, N_RES: 0.1, N_DEC: 130, D1_TYPE: 1, D1_DRV: 6, ...comp(-16, 3, 5), EQ_HPF: 400 });

  // ═════════════════════════ AGGRESSIVE (23) ═════════════════════════════════
  const agg = { OUT_CLIP: 1 };
  add("Destroyer Kick", "Aggressive", K({ f: 56, sw: 44, swT: 55, dec: 520, tail: -8, tailT: 500, click: -6, ct: 0, d1: 2, d1drv: 40, d2: 3, d2drv: 16, cp: [-24, 20, 8, 0.3, 60], x: { ...agg, CR_BITS: 8, CR_RATE: 20000, CB_MIX: 0.3, CB_FREQ: 56, CB_FB: 0.9 } }));
  add("Fold Hell", "Aggressive", K({ f: 60, sw: 36, swT: 50, shape: 0.5, dec: 420, fold: 0.8, click: -8, d1: 3, d1drv: 30, d2: 3, d2drv: 24, d2mix: 0.7, cp: [-22, 12, 6, 0.5, 60], x: { ...agg, DS_OS: 1 } }));
  add("Ring Chaos Snare", "Aggressive", S({ f: 210, shape: 2, sw: 24, swT: 24, dec: 100, nCut: 4000, nDec: 160, click: -6, d1: 3, d1drv: 20, d2: 9, d2drv: 14, cp: [-22, 12, 6, 0.4, 60], x: { ...agg, RM_FREQ: 540, RM_MIX: 0.5, X_LEV: -10, X_SET: 5, X_FREQ: 200, X_RING: 1, X_DEC: 140, X_MRM: 0.5 } }));
  add("Sync Rage", "Aggressive", K({ f: 110, sw: 24, swT: 120, shape: 2, dec: 380, click: -60, d1: 2, d1drv: 26, d2: 8, d2drv: 14, d2mix: 0.4, cp: [-22, 10, 5, 0.5, 70], x: { ...agg, T_SYNC: 1, T_SYNCR: 9, T_FOLD: 0.2, FL_ON: 1, FL_TYPE: 2, FL_CUT: 700, FL_RES: 8, FL_ENV: 3, FL_ENVT: 300 } }));
  add("Feedback Fury", "Aggressive", K({ f: 62, sw: 30, swT: 44, shape: 0, dec: 460, click: -8, d1: 9, d1drv: 24, cp: [-22, 12, 6, 0.4, 60], x: { VEL_AMP: 1, VEL_BRT: 0.9, ...agg, T_FB: 1.6, F_LEV: -6, F_FREQ: 124, F_IDX: 14, F_FB: 1.4, F_IDXT: 200, F_DEC: 400, F_FOLLOW: 1 } }));
  add("Bitcrush Brutal", "Aggressive", K({ f: 58, sw: 32, swT: 40, shape: 1, dec: 320, click: -5, ct: 1, d1: 6, d1drv: 18, cp: [-22, 12, 6, 0.3, 60], x: { ...agg, CR_BITS: 2.5, CR_RATE: 7000, CR_JIT: 0.4, N_LEV: -6, N_MODE: 1.3, N_CUT: 2800, N_DEC: 120 } }));
  add("Fuzz Wall Kick", "Aggressive", K({ f: 54, sw: 30, swT: 40, dec: 520, tail: -8, tailT: 600, click: -8, d1: 9, d1drv: 44, d2: 2, d2drv: 24, d2low: 150, cp: [-24, 20, 8, 0.3, 80], x: { ...agg, DS_OS: 2 } }));
  add("Distorted Snare Wall", "Aggressive", S({ f: 215, shape: 1, sw: 14, swT: 20, dec: 120, nCut: 4600, nDec: 240, nLev: 0, click: -6, d1: 2, d1drv: 34, d2: 3, d2drv: 16, cp: [-24, 30, 8, 0.2, 60], x: { ...agg, RV_MIX: 0.2, RV_DEC: 1, DS_OS: 1 } }));
  add("Comb Wreck", "Aggressive", { N_LEV: 0, N_MODE: 2, N_CUT: 2500, N_DEC: 120, C_LEV: -6, C_TYPE: 4, C_FREQ: 3000, CB_FREQ: 233, CB_KT: 1, CB_FB: -0.985, CB_DAMP: 6000, CB_MIX: 1, D1_TYPE: 3, D1_DRV: 26, D1_LOW: 300, D2_TYPE: 8, D2_DRV: 10, D2_MIX: 0.5, ...comp(-22, 10, 5, 0.5), OUT_CLIP: 2, EQ_HPF: 60, N_SLOPE: 1 });
  add("Comb Scream Hat", "Aggressive", H({ set: 5, f: 300, dec: 140, bpf: 7500, hpf: 4000, ring: 0.5, x: { CB_MIX: 0.9, CB_FREQ: 330, CB_FB: 0.96, CB_DAMP: 12000, D1_TYPE: 3, D1_DRV: 14, OUT_CLIP: 2 } }));
  add("Noise Cannon", "Aggressive", { N_LEV: 0, N_MODE: 1.2, N_CUT: 900, N_RES: 0.6, N_DEC: 260, N_FE_AMT: 5, N_FE_TIME: 160, N_SLOPE: 1, T_LEV: -4, T_PITCH: 60, T_PE1_AMT: 40, T_PE1_TIME: 70, T_DEC: 300, D1_TYPE: 2, D1_DRV: 30, D2_TYPE: 3, D2_DRV: 12, ...comp(-22, 12, 6, 0.4), OUT_CLIP: 1, EQ_HPF: 30 });
  add("Kick Stack Layer", "Aggressive", K({ f: 52, sw: 34, swT: 44, dec: 480, tail: -8, tailT: 520, click: -4, ct: 4, cf: 4200, d1: 2, d1drv: 26, d1low: 90, cp: [-22, 10, 6, 0.6, 80], x: { ...agg, M_LEV: -4, M_PITCH: 80, M_NUM: 6, M_DEC: 300, M_EXCL: 0.3, S_CLK: 1, F_LEV: -9, F_FREQ: 104, F_FOLLOW: 1, F_IDX: 4, F_IDXT: 80, F_DEC: 300, N_LEV: -12, N_TYPE: 2, N_MODE: 0, N_CUT: 700, N_DEC: 200 } }));
  add("Industrial Anvil", "Aggressive", P({ f: 480, mat: 3, num: 10, dec: 1400, tilt: 0.4, brt: -0.2, pos: 0.25, excl: 0.1, click: -3, ct: 4, cf: 5000, sends: 1.4, mkt: 1, d1: 3, d1drv: 20, cp: [-22, 12, 6, 0.5, 80], x: { ...agg, M_SPREAD: 20, X_LEV: -8, X_SET: 5, X_FREQ: 260, X_RING: 0.7, X_DEC: 700, CR_BITS: 9, CR_RATE: 24000 } }));
  add("Metal Scream", "Aggressive", { X_LEV: 0, X_SET: 5, X_FREQ: 220, X_KT: 0, X_RING: 1, X_FOLD: 0.6, X_BPF: 4200, X_BPQ: 1, X_HPF: 500, X_BAND: 0.7, X_DEC: 420, T_LEV: -8, T_SHAPE: 2, T_PITCH: 130, T_PE1_AMT: 30, T_PE1_TIME: 80, T_DEC: 380, X_MRM: 0.7, D1_TYPE: 3, D1_DRV: 26, D2_TYPE: 2, D2_DRV: 14, ...comp(-22, 12, 6, 0.4), OUT_CLIP: 1, EQ_HPF: 100 });
  add("Tension Slam 2", "Aggressive", T({ f: 58, num: 11, dec: 1000, tilt: 0.5, brt: -0.5, pos: 0.05, excl: 0.2, excn: 0.4, tens: 28, spread: 24, nl: 0.9, body: -4, bodyDec: 800, bodySw: 38, bodySwT: 80, d1: 7, d1drv: 24, cp: [-22, 10, 5, 1, 100], x: { OUT_CLIP: 2, D1_LOW: 90 } }));
  add("Hardcore Snare Killer", "Aggressive", S({ f: 240, shape: 2, sw: 26, swT: 20, dec: 110, nCut: 4200, nMode: 1.4, nDec: 200, click: -4, ct: 4, cf: 3400, d1: 2, d1drv: 36, d2: 3, d2drv: 14, cp: [-24, 30, 8, 0.2, 50], x: { ...agg, CR_BITS: 7, CR_RATE: 18000 } }));
  add("Saturation Smash", "Aggressive", K({ f: 56, sw: 30, swT: 42, dec: 400, click: -8, ct: 1, d1: 5, d1drv: 30, d2: 4, d2drv: 24, cp: [-26, 30, 10, 0.2, 100], x: { OUT_CLIP: 2, OUT_DRIVE: 12 } }));
  add("Gate Slam", "Aggressive", K({ f: 58, sw: 36, swT: 40, dec: 300, click: -6, d1: 2, d1drv: 20, cp: [-22, 10, 6, 1, 80], x: { ...agg, RV_MIX: 1, RV_SIZE: 0.8, RV_DEC: 2.4, RV_GATE: 1, RV_GHOLD: 140, RV_GREL: 15, DL_MIX: 0.2, DL_TIME: 90 } }));
  add("Ratchet Machinegun", "Aggressive", K({ f: 60, sw: 30, swT: 28, dec: 120, click: -6, ct: 4, cf: 4000, d1: 2, d1drv: 18, cp: [-20, 8, 5, 1, 50], x: { ...agg, RAT_N: 24, RAT_TIME: 36, RAT_VEL: -0.03, RAT_PITCH: -0.4 } }));
  add("Oversampled Fold Kick", "Aggressive", K({ f: 54, sw: 34, swT: 46, dec: 420, tail: -10, tailT: 500, click: -8, d1: 3, d1drv: 34, d1low: 80, d2: 8, d2drv: 18, d2mix: 0.5, cp: [-22, 10, 5, 0.6, 80], x: { OUT_CLIP: 2, DS_OS: 2 } }));
  add("Sub Shredder", "Aggressive", K({ f: 40, sw: 24, swT: 60, dec: 1600, tail: -6, tailT: 1400, click: -10, d1: 4, d1drv: 26, d1low: 70, d1mix: 0.8, d2: 3, d2drv: 14, d2low: 120, cp: [-22, 8, 5, 4, 160], x: { OUT_CLIP: 2, FL_ON: 1, FL_TYPE: 0, FL_CUT: 220, FL_RES: 5, FL_ENV: 2, FL_ENVT: 400 } }));
  add("Macro Monster A", "Aggressive", K({ f: 56, sw: 36, swT: 46, dec: 460, tail: -9, tailT: 480, click: -6, ct: 0, d1: 2, d1drv: 14, d2: 3, d2drv: 6, cp: [-22, 12, 5, 0.5, 70], x: { OUT_CLIP: 1, CB_FREQ: 56, CB_FB: 0.92, CB_DAMP: 5000, MX1_SRC: 12, MX1_DST: "D1_DRV", MX1_AMT: 0.7, MX2_SRC: 13, MX2_DST: "CR_BITS", MX2_AMT: -0.8, MX3_SRC: 14, MX3_DST: "CB_MIX", MX3_AMT: 0.9, MX4_SRC: 15, MX4_DST: "T_PE1_AMT", MX4_AMT: 0.35, MX5_SRC: 12, MX5_DST: "D2_DRV", MX5_AMT: 0.5, MX6_SRC: 13, MX6_DST: "CR_RATE", MX6_AMT: -0.6 } }));
  add("Macro Monster B", "Aggressive", S({ f: 220, shape: 2, sw: 20, swT: 20, dec: 100, nCut: 4600, nDec: 180, click: -6, d1: 3, d1drv: 12, d2: 2, d2drv: 6, cp: [-22, 12, 5, 0.5, 60], x: { OUT_CLIP: 1, MX1_SRC: 12, MX1_DST: "D1_DRV", MX1_AMT: 0.7, MX2_SRC: 13, MX2_DST: "FL_CUT", MX2_AMT: -0.7, MX3_SRC: 14, MX3_DST: "RV_MIX", MX3_AMT: 0.8, MX4_SRC: 15, MX4_DST: "N_CUT", MX4_AMT: 0.5, FL_ON: 1, FL_TYPE: 1, FL_CUT: 5000, FL_RES: 3 } }));
}
