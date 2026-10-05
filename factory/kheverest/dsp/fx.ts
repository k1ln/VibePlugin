// =====================================================================
//  fx.ts — KHEVEREST effects: analogue-style distortion on the voice sum, then
//  the three digital time-domain effects (chorus / delay / reverb) in a
//  selectable parallel or serial routing, with the 4-slot FX modulation matrix.
// =====================================================================

// ---------------------------------------------------------------- chorus
const CHO_LEN: i32 = 16384;
const choL = new StaticArray<f32>(CHO_LEN);
const choR = new StaticArray<f32>(CHO_LEN);
let choW: i32 = 0;
let choPh: f32 = 0.0;
const choLpL = new OnePole(); const choLpR = new OnePole();
const choHpL = new OnePole(); const choHpR = new OnePole();
let choFbL: f32 = 0.0; let choFbR: f32 = 0.0;

@inline function readFrac(buf: StaticArray<f32>, w: i32, d: f32, mask: i32): f32 {
  const dd = d < 1.0 ? <f32>1.0 : d;
  const fi = i32(dd);
  const fr = dd - f32(fi);
  const a = unchecked(buf[(w - fi) & mask]);
  const b = unchecked(buf[(w - fi - 1) & mask]);
  return a + (b - a) * fr;
}
// level, rate(0..1), depth(0..1), fb(-1..1), lp(0..1), hp(0..1), type
function chorusTick(inL: f32, inR: f32, rate: f32, depth: f32, fb: f32, lp: f32, hp: f32, type: i32, outL: StaticArray<f32>): void {
  const f = <f32>0.05 * Mathf.pow(160.0, rate);
  choPh += f * invSR; if (choPh >= 1.0) choPh -= 1.0;
  const ms = SR * <f32>0.001;
  const dep = depth * <f32>6.0 * ms;
  choL[choW] = inL + choFbL * fb; choR[choW] = inR + choFbR * fb;
  let wl: f32, wr: f32;
  if (type == 0) {
    wl = readFrac(choL, choW, <f32>12.0 * ms + dep * fsin(choPh), CHO_LEN - 1);
    wr = readFrac(choR, choW, <f32>12.0 * ms + dep * fsin(choPh + <f32>0.5), CHO_LEN - 1);
  } else if (type == 1) {
    wl = (readFrac(choL, choW, <f32>9.0 * ms + dep * fsin(choPh), CHO_LEN - 1) + readFrac(choL, choW, <f32>15.0 * ms + dep * fsin(choPh + <f32>0.25), CHO_LEN - 1)) * <f32>0.7071;
    wr = (readFrac(choR, choW, <f32>11.0 * ms + dep * fsin(choPh + <f32>0.5), CHO_LEN - 1) + readFrac(choR, choW, <f32>17.0 * ms + dep * fsin(choPh + <f32>0.75), CHO_LEN - 1)) * <f32>0.7071;
  } else {
    const slow = choPh * <f32>0.37;
    const d0 = <f32>15.0 * ms + dep * <f32>0.9 * fsin(choPh) + dep * <f32>0.3 * fsin(slow * <f32>7.0);
    const d1 = <f32>15.0 * ms + dep * <f32>0.9 * fsin(choPh + <f32>0.3333) + dep * <f32>0.3 * fsin(slow * <f32>7.0 + <f32>0.3333);
    const d2 = <f32>15.0 * ms + dep * <f32>0.9 * fsin(choPh + <f32>0.6667) + dep * <f32>0.3 * fsin(slow * <f32>7.0 + <f32>0.6667);
    wl = (readFrac(choL, choW, d0, CHO_LEN - 1) + readFrac(choL, choW, d2, CHO_LEN - 1) * <f32>0.7) * <f32>0.6;
    wr = (readFrac(choR, choW, d1, CHO_LEN - 1) + readFrac(choR, choW, d0, CHO_LEN - 1) * <f32>0.7) * <f32>0.6;
  }
  choW = (choW + 1) & (CHO_LEN - 1);
  // wet EQ
  const aLp = onePoleA(<f32>200.0 * Mathf.pow(100.0, lp));
  const aHp = onePoleA(<f32>20.0 * Mathf.pow(100.0, hp));
  wl = choHpL.hp(choLpL.lp(wl, aLp), aHp); wr = choHpR.hp(choLpR.lp(wr, aLp), aHp);
  choFbL = wl; choFbR = wr;
  outL[0] = wl; outL[1] = wr;
}

// ---------------------------------------------------------------- delay
const DLY_LEN: i32 = 524288;
const dlyL = new StaticArray<f32>(DLY_LEN);
const dlyR = new StaticArray<f32>(DLY_LEN);
let dlyW: i32 = 0;
let dlyTL: f32 = 24000.0; let dlyTR: f32 = 24000.0;
const dlyLpL = new OnePole(); const dlyLpR = new OnePole();
const dlyHpL = new OnePole(); const dlyHpR = new OnePole();
let dlyFbL: f32 = 0.0; let dlyFbR: f32 = 0.0;

// timeL/timeR in seconds
function delayTick(inL: f32, inR: f32, timeL: f32, timeR: f32, fb: f32, lp: f32, hp: f32, slew: f32, width: f32, outL: StaticArray<f32>): void {
  const maxS = <f32>(DLY_LEN - 8);
  const tl = clampf(timeL * SR, 4.0, maxS), tr = clampf(timeR * SR, 4.0, maxS);
  const k: f32 = <f32>0.00002 + slew * slew * <f32>0.02;
  dlyTL += (tl - dlyTL) * k; dlyTR += (tr - dlyTR) * k;
  const m = (inL + inR) * <f32>0.5;
  dlyL[dlyW] = m + dlyFbL; dlyR[dlyW] = m + dlyFbR;
  let wl = readFrac(dlyL, dlyW, dlyTL, DLY_LEN - 1);
  let wr = readFrac(dlyR, dlyW, dlyTR, DLY_LEN - 1);
  dlyW = (dlyW + 1) & (DLY_LEN - 1);
  const aLp = onePoleA(<f32>200.0 * Mathf.pow(100.0, lp));
  const aHp = onePoleA(<f32>20.0 * Mathf.pow(100.0, hp));
  dlyFbL = dlyHpL.hp(dlyLpL.lp(wl, aLp), aHp) * fb;
  dlyFbR = dlyHpR.hp(dlyLpR.lp(wr, aLp), aHp) * fb;
  const mid = (wl + wr) * <f32>0.5;
  outL[0] = mid + (wl - mid) * width; outL[1] = mid + (wr - mid) * width;
}

// ---------------------------------------------------------------- reverb (8-line FDN)
const RV_LINE: i32 = 32768;
const rvBuf = new StaticArray<f32>(8 * RV_LINE);
const rvLen = new StaticArray<f32>(8);
const rvIdx = new StaticArray<i32>(8);
const rvLp = new StaticArray<f32>(8);
const rvHp = new StaticArray<f32>(8);
const rvY = new StaticArray<f32>(8);
const rvBase = new StaticArray<f32>(8);
const RV_PRE: i32 = 131072;
const rvPreL = new StaticArray<f32>(RV_PRE);
const rvPreR = new StaticArray<f32>(RV_PRE);
let rvPreW: i32 = 0;
const rvInLpL = new OnePole(); const rvInLpR = new OnePole(); const rvInHpL = new OnePole(); const rvInHpR = new OnePole();
const rvApBuf = new StaticArray<f32>(4 * 1024);
let rvApW: i32 = 0;
let rvModPh: f32 = 0.0;

function reverbInit(): void {
  rvBase[0] = 1327.0; rvBase[1] = 1559.0; rvBase[2] = 1823.0; rvBase[3] = 2111.0;
  rvBase[4] = 2381.0; rvBase[5] = 2699.0; rvBase[6] = 3037.0; rvBase[7] = 3371.0;
  for (let i = 0; i < 8 * RV_LINE; i++) rvBuf[i] = 0.0;
  for (let i = 0; i < 8; i++) { rvIdx[i] = 0; rvLp[i] = 0.0; rvHp[i] = 0.0; rvY[i] = 0.0; }
  for (let i = 0; i < RV_PRE; i++) { rvPreL[i] = 0.0; rvPreR[i] = 0.0; }
  for (let i = 0; i < 4096; i++) rvApBuf[i] = 0.0;
  rvPreW = 0; rvApW = 0; rvModPh = 0.0;
}
// time(0..1) size(0..1) pre(0..1) lpd, hpd, mod, modr, lop, hip (0..1)
function reverbTick(inL: f32, inR: f32, time: f32, size: f32, pre: f32, lpd: f32, hpd: f32, mod: f32, modr: f32, lop: f32, hip: f32, outL: StaticArray<f32>): void {
  const rt60: f32 = <f32>0.2 * Mathf.pow(150.0, time);
  const sf: f32 = (<f32>0.35 + <f32>1.85 * size) * SR / <f32>48000.0;
  // pre-delay + input EQ
  const preS = clampf(pre * <f32>0.5 * SR, 1.0, f32(RV_PRE - 4));
  rvPreL[rvPreW] = inL; rvPreR[rvPreW] = inR;
  let xl = readFrac(rvPreL, rvPreW, preS, RV_PRE - 1);
  let xr = readFrac(rvPreR, rvPreW, preS, RV_PRE - 1);
  rvPreW = (rvPreW + 1) & (RV_PRE - 1);
  const aLo = onePoleA(<f32>200.0 * Mathf.pow(100.0, lop)), aHi = onePoleA(<f32>20.0 * Mathf.pow(100.0, hip));
  xl = rvInHpL.hp(rvInLpL.lp(xl, aLo), aHi); xr = rvInHpR.hp(rvInLpR.lp(xr, aLo), aHi);
  const aDamp = onePoleA(<f32>20000.0 * Mathf.pow(0.05, lpd));
  const aHpd = onePoleA(<f32>20.0 * Mathf.pow(50.0, hpd));
  rvModPh += (<f32>0.1 + modr * <f32>2.5) * invSR; if (rvModPh >= 1.0) rvModPh -= 1.0;
  // read the 8 lines
  for (let i = 0; i < 8; i++) {
    let len = unchecked(rvBase[i]) * sf;
    len += mod * <f32>6.0 * (SR / <f32>48000.0) * fsin(rvModPh + f32(i) * <f32>0.125);
    if (len > f32(RV_LINE - 4)) len = f32(RV_LINE - 4);
    unchecked(rvLen[i] = len);
    const base = i * RV_LINE;
    const w = unchecked(rvIdx[i]);
    const dd = len;
    const fi = i32(dd), fr = dd - f32(fi);
    const a = unchecked(rvBuf[base + ((w - fi) & (RV_LINE - 1))]);
    const b = unchecked(rvBuf[base + ((w - fi - 1) & (RV_LINE - 1))]);
    let y = a + (b - a) * fr;
    // per-line decay gain from RT60
    const gain = Mathf.exp(-<f32>6.9078 * len * invSR / rt60);
    y *= gain;
    // damping (LP) and slight HP
    const lp = unchecked(rvLp[i]) + aDamp * (y - unchecked(rvLp[i])); unchecked(rvLp[i] = denorm(lp));
    const hpv = unchecked(rvHp[i]) + aHpd * (lp - unchecked(rvHp[i])); unchecked(rvHp[i] = denorm(hpv));
    unchecked(rvY[i] = lp - hpv);
  }
  // Hadamard-ish mixing (orthogonal, 1/sqrt8): fast Walsh-Hadamard
  let y0 = rvY[0], y1 = rvY[1], y2 = rvY[2], y3 = rvY[3], y4 = rvY[4], y5 = rvY[5], y6 = rvY[6], y7 = rvY[7];
  let a0 = y0 + y1, a1 = y0 - y1, a2 = y2 + y3, a3 = y2 - y3, a4 = y4 + y5, a5 = y4 - y5, a6 = y6 + y7, a7 = y6 - y7;
  let b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3, b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
  const s: f32 = <f32>0.35355339;
  const m0 = (b0 + b4) * s, m1 = (b1 + b5) * s, m2 = (b2 + b6) * s, m3 = (b3 + b7) * s;
  const m4 = (b0 - b4) * s, m5 = (b1 - b5) * s, m6 = (b2 - b6) * s, m7 = (b3 - b7) * s;
  // write back with the stereo input injected alternately
  const inG: f32 = <f32>0.5;
  const wv = unchecked(rvIdx[0]);
  unchecked(rvBuf[0 * RV_LINE + rvIdx[0]] = denorm(m0 + xl * inG));
  unchecked(rvBuf[1 * RV_LINE + rvIdx[1]] = denorm(m1 + xr * inG));
  unchecked(rvBuf[2 * RV_LINE + rvIdx[2]] = denorm(m2 + xl * inG));
  unchecked(rvBuf[3 * RV_LINE + rvIdx[3]] = denorm(m3 + xr * inG));
  unchecked(rvBuf[4 * RV_LINE + rvIdx[4]] = denorm(m4 + xl * inG));
  unchecked(rvBuf[5 * RV_LINE + rvIdx[5]] = denorm(m5 + xr * inG));
  unchecked(rvBuf[6 * RV_LINE + rvIdx[6]] = denorm(m6 + xl * inG));
  unchecked(rvBuf[7 * RV_LINE + rvIdx[7]] = denorm(m7 + xr * inG));
  for (let i = 0; i < 8; i++) unchecked(rvIdx[i] = (rvIdx[i] + 1) & (RV_LINE - 1));
  outL[0] = (y0 - y2 + y4 - y6) * <f32>0.35; outL[1] = (y1 - y3 + y5 - y7) * <f32>0.35;
}

// ---------------------------------------------------------------- distortion (post-VCA, on the sum)
function distTick(x: f32, amt: f32): f32 {
  if (amt < 0.002) return x;
  const g: f32 = <f32>1.0 + <f32>22.0 * amt * amt;
  const ref: f32 = <f32>0.7;
  const y = ref * softclip(x * g / ref);
  return y * (<f32>1.0 - <f32>0.25 * amt);
}

const fxTmp = new StaticArray<f32>(2);
// FX-matrix accumulators (set per tick): index = FXMOD_DEST
const fxAcc = new StaticArray<f32>(12);
const fxSrc = new StaticArray<f32>(16);

function fxMatrixTick(lastVel: f32, lastKey: f32): void {
  for (let i = 0; i < 12; i++) fxAcc[i] = 0.0;
  const s = fxSrc;
  s[0] = 1.0; s[1] = gModWheel; s[2] = gAT; s[3] = gEx1; s[4] = gEx2; s[5] = lastVel; s[6] = lastKey;
  s[7] = gAn1; s[8] = gAn2; s[9] = gCV; s[10] = (gL3 + <f32>1.0) * <f32>0.5; s[11] = gL3;
  s[12] = (gL4 + <f32>1.0) * <f32>0.5; s[13] = gL4; s[14] = gBend; s[15] = -gBend;
  for (let m = 0; m < 4; m++) {
    const b = FM_P0 + m * 4;
    const depth = unchecked(A[b + 3]);
    if (depth == 0.0) continue;
    const d = unchecked(AI[b + 2]);
    fxAcc[d] += unchecked(s[unchecked(AI[b])]) * unchecked(s[unchecked(AI[b + 1])]) * depth * <f32>0.015625;
  }
}

// per-tick resolved FX settings
let fxChLevel: f32 = 0.0; let fxChRate: f32 = 0.0; let fxChDepth: f32 = 0.0; let fxChFb: f32 = 0.0;
let fxDlLevel: f32 = 0.0; let fxDlTime: f32 = 0.0; let fxDlFb: f32 = 0.0;
let fxRvLevel: f32 = 0.0; let fxRvTime: f32 = 0.0; let fxRvLop: f32 = 0.0; let fxRvHip: f32 = 0.0;
let fxDist: f32 = 0.0;
let dlyTimeLs: f32 = 0.4; let dlyTimeRs: f32 = 0.4;

function fxResolve(bpm: f32): void {
  const a = fxAcc;
  fxDist = clampf(pn127(P_DIST) + a[0], 0.0, 1.0);
  fxChLevel = clampf(pn127(P_CH_LEVEL) + a[1], 0.0, 1.0);
  fxChRate = clampf(pn127(P_CH_RATE) + a[2], 0.0, 1.0);
  fxChDepth = clampf(pn(P_CH_DEPTH) + a[3], 0.0, 1.0);
  fxChFb = clampf(pv(P_CH_FB) * <f32>0.015625 + a[4], -1.0, 1.0) * <f32>0.9;
  fxDlLevel = clampf(pn127(P_DL_LEVEL) + a[5], 0.0, 1.0);
  fxDlFb = clampf(pn127(P_DL_FB) + a[7], 0.0, 1.0) * <f32>0.995;
  fxRvLevel = clampf(pn127(P_RV_LEVEL) + a[8], 0.0, 1.0);
  fxRvTime = clampf(pn127(P_RV_TIME) + a[9], 0.0, 1.0);
  fxRvLop = clampf(pn(P_RV_LOP) + a[10], 0.0, 1.0);
  fxRvHip = clampf(pn(P_RV_HIP) + a[11], 0.0, 1.0);
  // delay time
  let T: f32;
  if (pi(P_DL_SYNC) != 0 && bpm > 1.0) {
    const ticks = unchecked(DLY_TICKS[pi(P_DL_SYNCR)]);
    T = ticks / <f32>24.0 * <f32>60.0 / bpm;
    while (T > 1.4) T *= 0.5;
  } else {
    const n = clampf(pn127(P_DL_TIME) + a[6], 0.0, 1.0);
    T = <f32>0.001 + <f32>1.399 * Mathf.pow(n, 1.8);
  }
  const lr = pi(P_DL_LR);
  const num = unchecked(LR_NUM[lr]), den = unchecked(LR_DEN[lr]);
  const mx = num > den ? num : den;
  dlyTimeLs = T * num / mx; dlyTimeRs = T * den / mx;
}

// run the three effects according to routing; returns the wet sum in wetL/wetR
let wetL: f32 = 0.0; let wetR: f32 = 0.0;
const chOut = new StaticArray<f32>(2);
const dlOut = new StaticArray<f32>(2);
const rvOut = new StaticArray<f32>(2);
function fxTick(inL: f32, inR: f32): void {
  const route = pi(P_FX_ROUTE);
  const chT = pi(P_CH_TYPE);
  const chLp = pn(P_CH_LP), chHp = pn(P_CH_HP);
  const dlLp = pn(P_DL_LP), dlHp = pn(P_DL_HP), dlSl = pn(P_DL_SLEW), dlW = pn(P_DL_WIDTH);
  const rvSize = pn(P_RV_SIZE), rvPre = (pv(P_RV_PRE)) * <f32>0.007874016;
  const rvLpd = pn(P_RV_LP), rvHpd = pn(P_RV_HP), rvMod = pn(P_RV_MOD) , rvModR = pn(P_RV_MODR);
  // order of processing, as three digits: 0 chorus, 1 delay, 2 reverb
  let o0: i32 = 0, o1: i32 = 1, o2: i32 = 2;
  if (route == 1) { o0 = 1; o1 = 2; o2 = 0; }        // D>R>C
  else if (route == 2) { o0 = 1; o1 = 0; o2 = 2; }   // D>C>R
  else if (route == 3) { o0 = 2; o1 = 1; o2 = 0; }   // R>D>C
  else if (route == 4) { o0 = 2; o1 = 0; o2 = 1; }   // R>C>D
  else if (route == 5) { o0 = 0; o1 = 1; o2 = 2; }   // C>D>R
  else if (route == 6) { o0 = 0; o1 = 2; o2 = 1; }   // C>R>D
  const serial = route != 0;
  // every effect runs every sample (so tails keep ringing); only the order of their inputs changes
  let cl = inL, cr = inR;                 // chorus input
  let dl = inL, dr = inR;
  let rl = inL, rr = inR;
  if (serial) {
    // build the chain input for each effect from the preceding wet contributions
    let accL = inL, accR = inR;
    for (let k = 0; k < 3; k++) {
      const e = k == 0 ? o0 : (k == 1 ? o1 : o2);
      if (e == 0) { cl = accL; cr = accR; chorusTick(cl, cr, fxChRate, fxChDepth, fxChFb, chLp, chHp, chT, chOut); accL += chOut[0] * fxChLevel; accR += chOut[1] * fxChLevel; }
      else if (e == 1) { dl = accL; dr = accR; delayTick(dl, dr, dlyTimeLs, dlyTimeRs, fxDlFb, dlLp, dlHp, dlSl, dlW, dlOut); accL += dlOut[0] * fxDlLevel; accR += dlOut[1] * fxDlLevel; }
      else { rl = accL; rr = accR; reverbTick(rl, rr, fxRvTime, rvSize, rvPre, rvLpd, rvHpd, rvMod, rvModR, fxRvLop, fxRvHip, rvOut); accL += rvOut[0] * fxRvLevel; accR += rvOut[1] * fxRvLevel; }
    }
    wetL = accL - inL; wetR = accR - inR;
  } else {
    chorusTick(inL, inR, fxChRate, fxChDepth, fxChFb, chLp, chHp, chT, chOut);
    delayTick(inL, inR, dlyTimeLs, dlyTimeRs, fxDlFb, dlLp, dlHp, dlSl, dlW, dlOut);
    reverbTick(inL, inR, fxRvTime, rvSize, rvPre, rvLpd, rvHpd, rvMod, rvModR, fxRvLop, fxRvHip, rvOut);
    wetL = chOut[0] * fxChLevel + dlOut[0] * fxDlLevel + rvOut[0] * fxRvLevel;
    wetR = chOut[1] * fxChLevel + dlOut[1] * fxDlLevel + rvOut[1] * fxRvLevel;
  }
}
function fxInit(): void {
  for (let i = 0; i < CHO_LEN; i++) { choL[i] = 0.0; choR[i] = 0.0; }
  for (let i = 0; i < DLY_LEN; i++) { dlyL[i] = 0.0; dlyR[i] = 0.0; }
  choW = 0; choPh = 0.0; choFbL = 0.0; choFbR = 0.0; dlyW = 0; dlyFbL = 0.0; dlyFbR = 0.0;
  dlyTL = 24000.0; dlyTR = 24000.0;
  reverbInit();
}
