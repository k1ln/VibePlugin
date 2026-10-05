// =====================================================================
//  CHOIRLOFT — a vocal choir / formant synthesiser, up to 100 singers.
//
//  Architecture (built so a 100-voice choir stays cheap):
//   * Every singer is only a band-limited sawtooth source with its own
//     tuning scatter, vibrato (rate / depth / onset), slow pitch drift,
//     entry time, attack/release and loudness.
//   * Formant filtering is linear, so singers are SUMMED into "formant
//     sets" (voice type x 8 stage groups) BEFORE filtering. A set owns a
//     source tilt filter, breath noise and five zero-delay (TPT) state
//     variable resonators, tuned from published vowel tables for bass,
//     tenor, alto and soprano and morphing across A-E-I-O-U. Each stage
//     group has a slightly different vocal-tract length and bandwidth
//     (Diversity), its own stage position, and a small arrival delay.
//   * Voice type "Auto" is a real SATB choir: each note's singers are split
//     across neighbouring voice types by pitch, so low notes are sung by
//     basses/tenors and high notes by altos/sopranos.
//   * Singer's-formant presence peak, then a modulated 8-line feedback
//     delay network hall (Householder matrix, frequency-dependent decay,
//     pre-delay, early reflections).
//  Pure algorithm: no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 24;
const NN: i32 = 8;            // notes
const NSG: i32 = 100;         // singers per note
const NU: i32 = NN * NSG;
const BLK: i32 = 32;          // control block (samples)
const NG: i32 = 8;            // stage groups per voice type
const NTY: i32 = 4;           // voice types
const NS: i32 = NG * NTY;     // formant sets
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_TYPE: i32 = 0;  const P_VOWEL: i32 = 1; const P_SHIFT: i32 = 2;  const P_SIZE: i32 = 3;  const P_ENS: i32 = 4;
const P_VIB: i32 = 5;   const P_VIBR: i32 = 6;  const P_HUMAN: i32 = 7;  const P_ATK: i32 = 8;   const P_REL: i32 = 9;
const P_BREATH: i32 = 10; const P_EFFORT: i32 = 11; const P_SCOOP: i32 = 12; const P_WIDTH: i32 = 13; const P_SPACE: i32 = 14;
const P_HALL: i32 = 15; const P_BEND: i32 = 16; const P_LEVEL: i32 = 17; const P_VELS: i32 = 18;
const P_DIV: i32 = 19; const P_PRES: i32 = 20; const P_PRED: i32 = 21; const P_DAMP: i32 = 22; const P_EARLY: i32 = 23;

const FMT_F: StaticArray<f32> = [600.0, 1040.0, 2250.0, 2450.0, 2750.0, 400.0, 1620.0, 2400.0, 2800.0, 3100.0, 250.0, 1750.0, 2600.0, 3050.0, 3340.0, 400.0, 750.0, 2400.0, 2600.0, 2900.0, 350.0, 600.0, 2400.0, 2675.0, 2950.0, 650.0, 1080.0, 2650.0, 2900.0, 3250.0, 400.0, 1700.0, 2600.0, 3200.0, 3580.0, 290.0, 1870.0, 2800.0, 3250.0, 3540.0, 400.0, 800.0, 2600.0, 2800.0, 3000.0, 350.0, 600.0, 2700.0, 2900.0, 3300.0, 800.0, 1150.0, 2800.0, 3500.0, 4950.0, 400.0, 1600.0, 2700.0, 3300.0, 4950.0, 350.0, 1700.0, 2700.0, 3700.0, 4950.0, 450.0, 800.0, 2830.0, 3500.0, 4950.0, 325.0, 700.0, 2530.0, 3500.0, 4950.0, 800.0, 1150.0, 2900.0, 3900.0, 4950.0, 350.0, 2000.0, 2800.0, 3600.0, 4950.0, 270.0, 2140.0, 2950.0, 3900.0, 4950.0, 450.0, 800.0, 2830.0, 3800.0, 4950.0, 325.0, 700.0, 2700.0, 3800.0, 4950.0];
const FMT_A: StaticArray<f32> = [0.0, -7.0, -9.0, -9.0, -20.0, 0.0, -12.0, -9.0, -12.0, -18.0, 0.0, -30.0, -16.0, -22.0, -28.0, 0.0, -11.0, -21.0, -20.0, -40.0, 0.0, -20.0, -32.0, -28.0, -36.0, 0.0, -6.0, -7.0, -8.0, -22.0, 0.0, -14.0, -12.0, -14.0, -20.0, 0.0, -15.0, -18.0, -20.0, -30.0, 0.0, -10.0, -12.0, -12.0, -26.0, 0.0, -20.0, -17.0, -14.0, -26.0, 0.0, -4.0, -20.0, -36.0, -60.0, 0.0, -24.0, -30.0, -35.0, -60.0, 0.0, -20.0, -30.0, -36.0, -60.0, 0.0, -9.0, -16.0, -28.0, -55.0, 0.0, -12.0, -30.0, -40.0, -64.0, 0.0, -6.0, -32.0, -20.0, -50.0, 0.0, -20.0, -15.0, -40.0, -56.0, 0.0, -12.0, -26.0, -26.0, -44.0, 0.0, -11.0, -22.0, -22.0, -50.0, 0.0, -16.0, -35.0, -40.0, -60.0];
const FMT_B: StaticArray<f32> = [60.0, 70.0, 110.0, 120.0, 130.0, 40.0, 80.0, 100.0, 120.0, 120.0, 60.0, 90.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 80.0, 90.0, 120.0, 130.0, 140.0, 70.0, 80.0, 100.0, 120.0, 120.0, 40.0, 90.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 80.0, 90.0, 120.0, 130.0, 140.0, 60.0, 80.0, 120.0, 150.0, 200.0, 50.0, 100.0, 120.0, 150.0, 200.0, 70.0, 80.0, 100.0, 130.0, 135.0, 50.0, 60.0, 170.0, 180.0, 200.0, 80.0, 90.0, 120.0, 130.0, 140.0, 60.0, 100.0, 120.0, 150.0, 200.0, 60.0, 90.0, 100.0, 120.0, 120.0, 70.0, 80.0, 100.0, 130.0, 135.0, 50.0, 60.0, 170.0, 180.0, 200.0];

// stage-group layout: prefix-balanced pans, per-group tract-length / bandwidth scatter, arrival delay (ms)
const G_PAN: StaticArray<f32> = [-0.55, 0.55, 0.0, -0.92, 0.92, -0.28, 0.28, 0.12];
const G_SC:  StaticArray<f32> = [0.0, 0.03, -0.028, 0.055, -0.05, 0.018, -0.02, 0.04];
const G_BW:  StaticArray<f32> = [0.0, 0.1, -0.08, 0.15, -0.12, 0.05, -0.05, 0.1];
const G_DLY: StaticArray<f32> = [0.0, 1.9, 3.4, 0.9, 4.6, 2.6, 5.5, 1.4];
const G_ITD: StaticArray<f32> = [0.55, -0.55, 0.0, 1.05, -1.05, 0.3, -0.3, -0.12];   // ms: + delays the right ear

let sampleRate: f32 = 48000.0;

// ---- notes
const nAct:  StaticArray<i32> = new StaticArray<i32>(NN);
const nGate: StaticArray<i32> = new StaticArray<i32>(NN);
const nId:   StaticArray<i32> = new StaticArray<i32>(NN);
const nAge:  StaticArray<i32> = new StaticArray<i32>(NN);
const nTop:  StaticArray<i32> = new StaticArray<i32>(NN);
const nFreq: StaticArray<f32> = new StaticArray<f32>(NN);
const nVel:  StaticArray<f32> = new StaticArray<f32>(NN);
const nTime: StaticArray<f32> = new StaticArray<f32>(NN);
const nTyp:  StaticArray<f32> = new StaticArray<f32>(NN);

// ---- singers
const uOn:   StaticArray<i32> = new StaticArray<i32>(NU);
const uTy:   StaticArray<i32> = new StaticArray<i32>(NU);
const uSet:  StaticArray<i32> = new StaticArray<i32>(NU);
const uPh:   StaticArray<f32> = new StaticArray<f32>(NU);
const uInc:  StaticArray<f32> = new StaticArray<f32>(NU);
const uEnv:  StaticArray<f32> = new StaticArray<f32>(NU);
const uEo:   StaticArray<f32> = new StaticArray<f32>(NU);
const uEi:   StaticArray<f32> = new StaticArray<f32>(NU);
const uWt:   StaticArray<f32> = new StaticArray<f32>(NU);
const uBr:   StaticArray<f32> = new StaticArray<f32>(NU);
const uVph:  StaticArray<f32> = new StaticArray<f32>(NU);
const uVr:   StaticArray<f32> = new StaticArray<f32>(NU);
const uVd:   StaticArray<f32> = new StaticArray<f32>(NU);
const uVon:  StaticArray<f32> = new StaticArray<f32>(NU);
const uDet:  StaticArray<f32> = new StaticArray<f32>(NU);   // tuning scatter (semitones)
const uDly:  StaticArray<f32> = new StaticArray<f32>(NU);
const uDr:   StaticArray<f32> = new StaticArray<f32>(NU);   // slow pitch drift state
const uAk:   StaticArray<f32> = new StaticArray<f32>(NU);
const uRk:   StaticArray<f32> = new StaticArray<f32>(NU);
const uAmp:  StaticArray<f32> = new StaticArray<f32>(NU);
const blkU:  StaticArray<i32> = new StaticArray<i32>(NU);
let blkN: i32 = 0;

// ---- formant sets
const sA1: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sA2: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sA3: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sKA: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sI1: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sI2: StaticArray<f32> = new StaticArray<f32>(NS * 5);
const sLpA: StaticArray<f32> = new StaticArray<f32>(NS);
const sLpB: StaticArray<f32> = new StaticArray<f32>(NS);
const sNz:  StaticArray<f32> = new StaticArray<f32>(NS);
const sW2:  StaticArray<f32> = new StaticArray<f32>(NS);
const sDr:  StaticArray<f32> = new StaticArray<f32>(NS);
const sHot: StaticArray<i32> = new StaticArray<i32>(NS);
const sTch: StaticArray<i32> = new StaticArray<i32>(NS);
const hotL: StaticArray<i32> = new StaticArray<i32>(NS);
let nHot: i32 = 0;
const aA: StaticArray<f32> = new StaticArray<f32>(NS);
const aB: StaticArray<f32> = new StaticArray<f32>(NS);
const gv: StaticArray<f32> = new StaticArray<f32>(NG);
const tmpF: StaticArray<f32> = new StaticArray<f32>(5);
const tmpB: StaticArray<f32> = new StaticArray<f32>(5);
const tmpA: StaticArray<f32> = new StaticArray<f32>(5);

// ---- stage-group delays and pans
const GDL: i32 = 4096;
const gBuf: StaticArray<f32> = new StaticArray<f32>(NG * GDL);
const gDlen: StaticArray<i32> = new StaticArray<i32>(NG);
const gDlenR: StaticArray<i32> = new StaticArray<i32>(NG);
const gPL: StaticArray<f32> = new StaticArray<f32>(NG);
const gPR: StaticArray<f32> = new StaticArray<f32>(NG);
let gPos: i32 = 0;

// ---- globals refreshed every control block
let gSize: i32 = 1; let gNorm: f32 = 1.0; let gTypeFixed: i32 = 2;
let gVibInc: f32 = 0.0; let gVibD: f32 = 0.0; let gAtkK: f32 = 0.1; let gRelK: f32 = 0.1;
let gBreath: f32 = 0.0; let gHuman: f32 = 0.5; let gEns: f32 = 0.5; let gDiv: f32 = 0.5;
let gTiltK: f32 = 0.1; let gCLo: f32 = 1.0; let gCHi: f32 = 0.2;
let gScoop: f32 = 0.0; let gBendRatio: f32 = 1.0; let gShift: f32 = 1.0;
let gVi: i32 = 0; let gVf: f32 = 0.0;
let gDA: f32 = 0.01; let gDNorm: f32 = 10.0; let gDriftSt: f32 = 0.0;
let hotBlocks: i32 = 1000; let blkLeft: i32 = 0; let ageCounter: i32 = 0;
let seed: u32 = 1234; let lastTy: f32 = 2.0;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0; let expr: f32 = 1.0;
let dcx0: f32 = 0.0; let dcy0: f32 = 0.0; let dcx1: f32 = 0.0; let dcy1: f32 = 0.0;
let lvS: f32 = 0.0;

// ---- presence (singer's formant) peaking EQ, transposed direct form II
let pb0: f32 = 1.0; let pb1: f32 = 0.0; let pb2: f32 = 0.0; let pa1: f32 = 0.0; let pa2: f32 = 0.0;
let pzL1: f32 = 0.0; let pzL2: f32 = 0.0; let pzR1: f32 = 0.0; let pzR2: f32 = 0.0;

// ---- hall: pre-delay, early reflections, input diffusion, 8-line FDN
const RBUF: i32 = 32768; const RMASK: i32 = 32767;
const RL: i32 = 8;
const pdL: StaticArray<f32> = new StaticArray<f32>(RBUF);
const pdR: StaticArray<f32> = new StaticArray<f32>(RBUF);
const erB: StaticArray<f32> = new StaticArray<f32>(RBUF);
const fdn: StaticArray<f32> = new StaticArray<f32>(RL * RBUF);
const FD_BASE: StaticArray<f32> = [1117.0, 1303.0, 1553.0, 1801.0, 2063.0, 2371.0, 2689.0, 3049.0];
const ER_T: StaticArray<f32> = [11.0, 17.0, 23.0, 31.0, 43.0, 53.0, 67.0, 83.0];
const ER_G: StaticArray<f32> = [0.5, 0.42, 0.38, 0.3, 0.26, 0.2, 0.16, 0.12];
const fdLen: StaticArray<f32> = new StaticArray<f32>(RL);
const fdG:   StaticArray<f32> = new StaticArray<f32>(RL);
const fdLp:  StaticArray<f32> = new StaticArray<f32>(RL);
const fdPh:  StaticArray<f32> = new StaticArray<f32>(RL);
const fdInc: StaticArray<f32> = new StaticArray<f32>(RL);
const fdO:   StaticArray<f32> = new StaticArray<f32>(RL);
const erLen: StaticArray<i32> = new StaticArray<i32>(8);
const AP_N: i32 = 2048;
const apB:   StaticArray<f32> = new StaticArray<f32>(4 * AP_N);
const apLen: StaticArray<i32> = new StaticArray<i32>(4);
const apPos: StaticArray<i32> = new StaticArray<i32>(4);
let rPos: i32 = 0; let fPos: i32 = 0; let pdLen: i32 = 0;
let fdDamp: f32 = 0.5; let fdMod: f32 = 2.0; let hpL: f32 = 0.0; let hpR: f32 = 0.0; let hpK: f32 = 0.02;
let erGain: f32 = 0.3; let wetGain: f32 = 0.3; let dn: f32 = 1.0e-15;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }
@inline function rnd01(): f32 { return rnd() * 0.5 + 0.5; }
// parabolic sine of a 0..1 phase (error ~0.1%): vibrato / LFO use only
@inline function psin(x: f32): f32 {
  const z: f32 = x < 0.5 ? x * 2.0 : x * 2.0 - 2.0;
  const y: f32 = 4.0 * z * (1.0 - (z < 0.0 ? -z : z));
  return 0.775 * y + 0.225 * y * (y < 0.0 ? -y : y);
}
// 2^(semi/12) for a small |semi| (< ~4 semitones)
@inline function ex2(semi: f32): f32 {
  const x: f32 = semi * 0.057762265;
  return 1.0 + x * (1.0 + x * (0.5 + x * (0.16666667 + x * 0.041666668)));
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  const rs: f32 = sampleRate / 48000.0;
  for (let n = 0; n < NN; n++) { nAct[n] = 0; nGate[n] = 0; nId[n] = -1; nAge[n] = 0; nTop[n] = 0; nFreq[n] = 220.0; nVel[n] = 0.0; nTime[n] = 0.0; nTyp[n] = 2.0; }
  for (let u = 0; u < NU; u++) {
    uOn[u] = 0; uTy[u] = 2; uSet[u] = 0; uPh[u] = 0.0; uInc[u] = 0.0; uEnv[u] = 0.0; uEo[u] = 0.0; uEi[u] = 0.0; uWt[u] = 0.0; uBr[u] = 1.0;
    uVph[u] = 0.0; uVr[u] = 1.0; uVd[u] = 1.0; uVon[u] = 0.3; uDet[u] = 0.0; uDly[u] = 0.0; uDr[u] = 0.0; uAk[u] = 1.0; uRk[u] = 1.0; uAmp[u] = 1.0;
  }
  for (let i = 0; i < NS * 5; i++) { sA1[i] = 0.0; sA2[i] = 0.0; sA3[i] = 0.0; sKA[i] = 0.0; sI1[i] = 0.0; sI2[i] = 0.0; }
  for (let i = 0; i < NS; i++) { sLpA[i] = 0.0; sLpB[i] = 0.0; sNz[i] = 0.0; sW2[i] = 0.0; sDr[i] = 0.0; sHot[i] = 0; sTch[i] = 0; aA[i] = 0.0; aB[i] = 0.0; }
  for (let i = 0; i < NG; i++) { gv[i] = 0.0; gDlen[i] = 0; gDlenR[i] = 0; gPL[i] = 0.7; gPR[i] = 0.7; }
  for (let i = 0; i < NG * GDL; i++) gBuf[i] = 0.0;
  gPos = 0; nHot = 0; blkN = 0; blkLeft = 0; ageCounter = 0; seed = 1234; lastTy = 2.0;
  bendN = 0.0; modWheel = 0.0; pressure = 0.0; expr = 1.0; dcx0 = 0.0; dcy0 = 0.0; dcx1 = 0.0; dcy1 = 0.0; lvS = 0.0;
  pzL1 = 0.0; pzL2 = 0.0; pzR1 = 0.0; pzR2 = 0.0;
  for (let i = 0; i < RBUF; i++) { pdL[i] = 0.0; pdR[i] = 0.0; erB[i] = 0.0; }
  for (let i = 0; i < RL * RBUF; i++) fdn[i] = 0.0;
  for (let i = 0; i < RL; i++) { fdLen[i] = FD_BASE[i] * rs; fdG[i] = 0.9; fdLp[i] = 0.0; fdPh[i] = f32(i) * 0.137; fdInc[i] = (0.09 + 0.037 * f32(i)) / sampleRate; fdO[i] = 0.0; }
  for (let i = 0; i < 4 * AP_N; i++) apB[i] = 0.0;
  apLen[0] = i32(142.0 * rs); apLen[1] = i32(107.0 * rs); apLen[2] = i32(379.0 * rs); apLen[3] = i32(277.0 * rs);
  for (let i = 0; i < 4; i++) apPos[i] = 0;
  rPos = 0; fPos = 0; hpL = 0.0; hpR = 0.0;
  hotBlocks = i32(0.7 * sampleRate / f32(BLK));
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [4.0, 0.0, 0.5, 24.0, 0.5, 0.4, 0.45, 0.5, 0.45, 0.5, 0.15, 0.55, 0.25, 0.7, 0.4, 0.62, 0.1667, 0.7, 0.3, 0.5, 0.45, 0.25, 0.5, 0.5];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
  else if (num == 11) expr = 0.2 + 0.8 * clampf(value, 0.0, 1.0);
}

// fill tmpF/tmpB/tmpA with the vowel-morphed formants of one voice type (frequency shifted, linear amplitude)
function formantsFor(ty: i32): void {
  const sr: f32 = sampleRate;
  const vi: i32 = gVi; const vf: f32 = gVf;
  for (let k = 0; k < 5; k++) {
    const b0: i32 = (ty * 5 + vi) * 5 + k; const b1: i32 = (ty * 5 + vi + 1) * 5 + k;
    const fa: f32 = FMT_F[b0]; const fb: f32 = FMT_F[b1];
    tmpF[k] = clampf((fa + (fb - fa) * vf) * gShift, 80.0, sr * 0.4);
    const bwA: f32 = FMT_B[b0]; const bwB: f32 = FMT_B[b1];
    tmpB[k] = (bwA + (bwB - bwA) * vf) * (0.8 + gShift * 0.2) * (1.0 + gBreath * 0.5);
    const dB: f32 = FMT_A[b0] + (FMT_A[b1] - FMT_A[b0]) * vf;
    tmpA[k] = f32(Mathf.exp(dB * 0.115129255));
  }
}

function initSinger(nt: i32, s: i32, u: i32, late: bool): void {
  const ens: f32 = params[P_ENS]; const human: f32 = params[P_HUMAN];
  const multi: f32 = gSize > 1 ? 1.0 : 0.0;
  uOn[u] = 1;
  uPh[u] = rnd01(); uEnv[u] = 0.0; uEo[u] = 0.0; uEi[u] = 0.0; uDr[u] = 0.0;
  uVph[u] = rnd01(); uVr[u] = 1.0 + rnd() * 0.13 * (0.3 + human); uVd[u] = 1.0 + rnd() * 0.45 * (0.3 + human);
  uVon[u] = 0.25 + rnd01() * 0.6 * (0.2 + human);
  uDet[u] = ((rnd() + rnd()) * 0.5 * (ens * 26.0 + 2.5 * multi)) * 0.01;
  uDly[u] = (late ? nTime[nt] : 0.0) + rnd01() * rnd01() * 0.5 * human * (1.0 + multi * 0.6);
  uAk[u] = 1.0 + rnd() * 0.4 * human; uRk[u] = 1.0 + rnd() * 0.4 * human;
  uAmp[u] = 1.0 - 0.35 * rnd01() * (0.3 + human);
  let ty: i32 = 2;
  if (gTypeFixed >= 0) ty = gTypeFixed;
  else {
    const t: f32 = nTyp[nt]; ty = i32(t); const fr: f32 = t - f32(ty);
    if (ty < 3 && rnd01() < fr) ty++;
  }
  uTy[u] = ty;
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NN; i++) if (nAct[i] == 0) { slot = i; break; }
  if (slot < 0) {                                       // steal the oldest released note, else the oldest
    let o: i32 = -1;
    for (let i = 0; i < NN; i++) if (nGate[i] == 0 && (o < 0 || nAge[i] < nAge[o])) o = i;
    if (o < 0) { o = 0; for (let i = 1; i < NN; i++) if (nAge[i] < nAge[o]) o = i; }
    slot = o;
  }
  const size: i32 = i32(params[P_SIZE] + 0.5) < 1 ? 1 : (i32(params[P_SIZE] + 0.5) > NSG ? NSG : i32(params[P_SIZE] + 0.5));
  gSize = size;
  const tp: i32 = i32(params[P_TYPE] + 0.5);
  gTypeFixed = tp >= 4 ? -1 : (tp < 0 ? 0 : tp);
  nId[slot] = id; nAct[slot] = 1; nGate[slot] = 1; nAge[slot] = ageCounter++; nFreq[slot] = f > 20.0 ? f : 20.0; nVel[slot] = clampf(vel, 0.0, 1.0);
  nTime[slot] = 0.0; nTop[slot] = size;
  // pitch -> choir section position (E2 bass .. D4 alto .. D5 soprano)
  const m: f32 = 69.0 + 17.3123404 * f32(Mathf.log(nFreq[slot] / 440.0));
  let t: f32 = 0.0;
  if (m <= 40.0) t = 0.0;
  else if (m < 52.0) t = (m - 40.0) / 12.0;
  else if (m < 62.0) t = 1.0 + (m - 52.0) / 10.0;
  else if (m < 76.0) t = 2.0 + (m - 62.0) / 14.0;
  else t = 3.0;
  nTyp[slot] = t; lastTy = t;
  for (let s = 0; s < NSG; s++) {
    const u: i32 = slot * NSG + s;
    uOn[u] = 0; uEnv[u] = 0.0; uEo[u] = 0.0; uEi[u] = 0.0;
    if (s < size) initSinger(slot, s, u, false);
  }
}

export function noteOff(id: i32): void {
  for (let n = 0; n < NN; n++) if (nAct[n] == 1 && nGate[n] == 1 && nId[n] == id) nGate[n] = 0;
}

// ---------------------------------------------------------------------
//  per control block: refresh globals, advance singers, retune formants
// ---------------------------------------------------------------------
function prepBlock(): void {
  const sr: f32 = sampleRate;
  const blkDt: f32 = f32(BLK) / sr;
  const size: i32 = i32(params[P_SIZE] + 0.5) < 1 ? 1 : (i32(params[P_SIZE] + 0.5) > NSG ? NSG : i32(params[P_SIZE] + 0.5));
  gSize = size;
  const tp: i32 = i32(params[P_TYPE] + 0.5);
  gTypeFixed = tp >= 4 ? -1 : (tp < 0 ? 0 : tp);
  gNorm = 1.0 / f32(Mathf.sqrt(f32(size)));
  gHuman = params[P_HUMAN]; gEns = params[P_ENS]; gDiv = params[P_DIV]; gBreath = params[P_BREATH];
  const effort: f32 = params[P_EFFORT];
  gVibInc = (4.2 + params[P_VIBR] * 3.5) / sr;
  gVibD = params[P_VIB] * 0.5 + modWheel * 0.3 + pressure * 0.3;
  gAtkK = 1.0 - f32(Mathf.exp(-f32(BLK) / ((0.03 + params[P_ATK] * params[P_ATK] * 1.6) * sr)));
  gRelK = 1.0 - f32(Mathf.exp(-f32(BLK) / ((0.06 + params[P_REL] * params[P_REL] * 2.5) * sr)));
  const fcT: f32 = 450.0 + effort * effort * 6500.0;
  gTiltK = 1.0 - f32(Mathf.exp(-TWO_PI * fcT / sr));
  gCLo = 0.6 + effort * 0.8; gCHi = effort * 0.3 + 0.04;
  gScoop = params[P_SCOOP] * 2.5;
  gBendRatio = f32(Mathf.pow(2.0, bendN * f32(i32(params[P_BEND] * 12.0 + 0.5)) * (1.0 / 12.0)));
  gShift = f32(Mathf.pow(2.0, (params[P_SHIFT] - 0.5) * 1.2));
  const vw: f32 = clampf(params[P_VOWEL] + modWheel * (1.0 - params[P_VOWEL]) * 0.8, 0.0, 1.0) * 4.0;
  gVi = i32(vw); if (gVi > 3) gVi = 3; gVf = vw - f32(gVi);
  gDA = 1.0 - f32(Mathf.exp(-blkDt / 0.9));
  gDNorm = f32(Mathf.sqrt((2.0 - gDA) / gDA)) * 1.7320508;
  gDriftSt = (0.012 + gHuman * 0.05);
  const velS: f32 = params[P_VELS];
  const blkF: f32 = f32(BLK);

  for (let st = 0; st < NS; st++) { sW2[st] = 0.0; sTch[st] = 0; }
  blkN = 0;
  for (let nt = 0; nt < NN; nt++) {
    if (nAct[nt] == 0) continue;
    nTime[nt] += blkDt;
    const tNote: f32 = nTime[nt];
    const gated: bool = nGate[nt] == 1;
    const velG: f32 = 1.0 - velS + velS * nVel[nt];
    const gain: f32 = velG * expr * (1.0 + pressure * 0.4) * gNorm;
    const br: f32 = (0.55 + 0.5 * velG) * (1.0 + pressure * 0.5);
    const fbase: f32 = nFreq[nt] * gBendRatio / sr;
    const top: i32 = nTop[nt] > size ? nTop[nt] : size;
    let newTop: i32 = 0; let live: bool = false;
    for (let s = 0; s < top; s++) {
      const u: i32 = nt * NSG + s;
      const want: bool = gated && s < size;
      if (uOn[u] == 0) { if (!want) continue; initSinger(nt, s, u, true); }
      const t: f32 = tNote - uDly[u];
      const tgt: f32 = (want && t >= 0.0) ? 1.0 : 0.0;
      let env: f32 = uEnv[u];
      if (tgt == 0.0 && env < 0.0002) {
        uEnv[u] = 0.0; uEo[u] = 0.0; uEi[u] = 0.0;
        if (!want) uOn[u] = 0; else { newTop = s + 1; live = true; }
        continue;
      }
      newTop = s + 1; live = true;
      let k: f32 = tgt > env ? gAtkK * uAk[u] : gRelK * uRk[u];
      if (k > 1.0) k = 1.0;
      env += k * (tgt - env); uEnv[u] = env;
      const sh: f32 = env * env * (3.0 - 2.0 * env);
      uEi[u] = (sh - uEo[u]) * (1.0 / blkF);

      // pitch: tuning scatter, vibrato (fades in per singer), slow drift, scoop
      let vp: f32 = uVph[u] + gVibInc * uVr[u] * blkF; if (vp >= 1.0) vp -= 1.0; uVph[u] = vp;
      const vs: f32 = psin(vp);
      const tt: f32 = t < 0.0 ? 0.0 : t;
      const vibT: f32 = clampf((tt - uVon[u]) * (1.0 / 0.6), 0.0, 1.0);
      const dr: f32 = uDr[u] + gDA * (rnd() - uDr[u]); uDr[u] = dr;
      const drift: f32 = dr * gDNorm;
      let semi: f32 = uDet[u] + gVibD * uVd[u] * vs * vibT + drift * gDriftSt + rnd() * 0.004 * gHuman;
      if (tt < 1.2) semi -= gScoop * f32(Mathf.exp(-tt * 8.3333));
      let inc: f32 = fbase * ex2(semi);
      inc = clampf(inc, 0.00002, 0.45);
      uInc[u] = inc;

      const w: f32 = gain * uAmp[u] * (1.0 + 0.2 * clampf(gVibD * 2.0, 0.0, 1.0) * vs * vibT) * (1.0 + 0.08 * gHuman * clampf(drift, -2.0, 2.0));
      uWt[u] = w; uBr[u] = br;
      const ty: i32 = gTypeFixed >= 0 ? gTypeFixed : uTy[u];
      const st: i32 = ty * NG + (s & 7);
      uSet[u] = st; sTch[st] = 1;
      const ew: f32 = sh * w; sW2[st] += ew * ew;
      blkU[blkN] = u; blkN++;
    }
    nTop[nt] = newTop;
    if (!gated && !live) nAct[nt] = 0;
  }

  // active formant sets (touched now, or still ringing out)
  nHot = 0;
  let tyNeed: i32 = 0;
  for (let st = 0; st < NS; st++) {
    if (sTch[st] == 1) sHot[st] = hotBlocks;
    else if (sHot[st] > 0) {
      sHot[st]--;
      if (sHot[st] == 0) {
        for (let k = 0; k < 5; k++) { sI1[st * 5 + k] = 0.0; sI2[st * 5 + k] = 0.0; }
        sLpA[st] = 0.0; sLpB[st] = 0.0; aA[st] = 0.0; aB[st] = 0.0; sNz[st] = 0.0;
      }
    }
    if (sHot[st] > 0) { hotL[nHot] = st; nHot++; tyNeed |= 1 << (st >> 3); }
    sNz[st] = gBreath * 0.5 * f32(Mathf.sqrt(sW2[st]));
  }
  if (nHot > 0) {
    const div: f32 = gDiv * 1.6;
    for (let ty = 0; ty < NTY; ty++) {
      if ((tyNeed & (1 << ty)) == 0) continue;
      formantsFor(ty);
      for (let g = 0; g < NG; g++) {
        const st: i32 = ty * NG + g;
        if (sHot[st] == 0) continue;
        sDr[st] += gDA * (rnd() - sDr[st]);
        const drf: f32 = 1.0 + sDr[st] * gDNorm * 0.0035 * (0.3 + gHuman);
        const scl: f32 = (1.0 + G_SC[g] * div) * drf;
        const bws: f32 = 1.0 + G_BW[g] * div;
        for (let k = 0; k < 5; k++) {
          const fc: f32 = clampf(tmpF[k] * scl, 60.0, sr * 0.42);
          const gg: f32 = f32(Mathf.tan(PI * fc / sr));
          const q: f32 = clampf(tmpB[k] * bws / fc, 0.02, 1.5);
          const a1: f32 = 1.0 / (1.0 + gg * (gg + q));
          const i5: i32 = st * 5 + k;
          sA1[i5] = a1; sA2[i5] = gg * a1; sA3[i5] = gg * gg * a1; sKA[i5] = q * tmpA[k];
          if (sI1[i5] > -1.0e-18 && sI1[i5] < 1.0e-18) sI1[i5] = 0.0;
          if (sI2[i5] > -1.0e-18 && sI2[i5] < 1.0e-18) sI2[i5] = 0.0;
        }
      }
    }
  }

  // stage layout, widths, arrival delays
  const width: f32 = params[P_WIDTH];
  const ng: i32 = size < NG ? size : NG;
  for (let g = 0; g < NG; g++) {
    const p: f32 = ng == 1 ? 0.0 : clampf(G_PAN[g] * width * 1.05, -1.0, 1.0);
    gPL[g] = f32(Mathf.sqrt(0.5 * (1.0 - p))); gPR[g] = f32(Mathf.sqrt(0.5 * (1.0 + p)));
    const dm: f32 = ng == 1 ? 0.0 : G_DLY[g] * width;
    const it: f32 = ng == 1 ? 0.0 : G_ITD[g] * width;
    gDlen[g] = i32((dm + (it < 0.0 ? -it : 0.0)) * 0.001 * sr);       // left ear
    gDlenR[g] = i32((dm + (it > 0.0 ? it : 0.0)) * 0.001 * sr);       // right ear
  }

  // singer's-formant presence: peaking EQ at 2.9 kHz
  {
    const dBp: f32 = params[P_PRES] * 9.0;
    const A: f32 = f32(Mathf.pow(10.0, dBp / 40.0));
    const w0: f32 = TWO_PI * 2900.0 / sr; const cw: f32 = f32(Mathf.cos(w0)); const al: f32 = f32(Mathf.sin(w0)) / (2.0 * 1.1);
    const a0: f32 = 1.0 + al / A;
    pb0 = (1.0 + al * A) / a0; pb1 = (-2.0 * cw) / a0; pb2 = (1.0 - al * A) / a0; pa1 = (-2.0 * cw) / a0; pa2 = (1.0 - al / A) / a0;
  }

  // hall
  {
    const hall: f32 = params[P_HALL];
    const rs: f32 = sr / 48000.0;
    const sizeScale: f32 = (0.6 + hall * 0.9) * rs;
    const rt: f32 = (0.9 + f32(Mathf.pow(hall, 1.5)) * 7.0) * 1.12;
    for (let i = 0; i < RL; i++) {
      const len: f32 = FD_BASE[i] * sizeScale;
      fdLen[i] = len;
      fdG[i] = f32(Mathf.exp(-6.9078 * len / (sr * rt)));
    }
    const fd: f32 = 1500.0 + (1.0 - params[P_DAMP]) * 11000.0;
    fdDamp = 1.0 - f32(Mathf.exp(-TWO_PI * fd / sr));
    fdMod = (1.5 + hall * 3.5) * rs;
    pdLen = i32(params[P_PRED] * 0.12 * sr);
    const es: f32 = 0.7 + hall * 0.8;
    for (let i = 0; i < 8; i++) erLen[i] = i32(ER_T[i] * 0.001 * sr * es);
    erGain = params[P_EARLY] * 0.9;
    wetGain = params[P_SPACE];
    hpK = 1.0 - f32(Mathf.exp(-TWO_PI * 160.0 / sr));
  }
}

// formant-envelope bars for the GUI (display[1..15]) — current vowel/voice, log-spaced 120 Hz .. 7.5 kHz
function updateDisplay(): void {
  const tp: i32 = i32(params[P_TYPE] + 0.5);
  let ty: i32 = tp >= 4 ? i32(lastTy + 0.5) : tp;
  if (ty < 0) ty = 0; if (ty > 3) ty = 3;
  formantsFor(ty);
  for (let b = 0; b < 15; b++) {
    const f: f32 = 120.0 * f32(Mathf.pow(62.5, f32(b) / 14.0));
    let mag: f32 = 0.0;
    for (let k = 0; k < 5; k++) {
      const fc: f32 = tmpF[k]; const bw: f32 = tmpB[k];
      const d: f32 = fc * fc - f * f; const e: f32 = bw * f;
      mag += tmpA[k] * e / f32(Mathf.sqrt(d * d + e * e + 1.0));
    }
    mag = mag / f32(Mathf.sqrt(1.0 + (f / 1800.0) * (f / 1800.0)));
    const db: f32 = 8.685889 * f32(Mathf.log(mag + 0.0003));
    display[1 + b] = clampf((db + 52.0) / 52.0, 0.0, 1.0);
  }
}

export function process(n: i32): void {
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 2.6;
  let peak: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    if (blkLeft == 0) { prepBlock(); blkLeft = BLK; }
    blkLeft--;

    // ---- singers: band-limited saw sources, summed per formant set
    for (let i = 0; i < blkN; i++) {
      const u: i32 = blkU[i];
      const inc: f32 = uInc[u];
      let ph: f32 = uPh[u] + inc; if (ph >= 1.0) ph -= 1.0; uPh[u] = ph;
      let s: f32 = 2.0 * ph - 1.0;
      if (ph < inc) { const x: f32 = ph / inc; s -= x + x - x * x - 1.0; }
      else if (ph > 1.0 - inc) { const x: f32 = (ph - 1.0) / inc; s -= x * x + x + x + 1.0; }
      const e: f32 = uEo[u] + uEi[u]; uEo[u] = e;
      const a: f32 = s * e * uWt[u];
      const st: i32 = uSet[u];
      aA[st] += a; aB[st] += a * uBr[u];
    }

    // ---- formant sets: tilt, breath, five parallel resonators
    for (let h = 0; h < nHot; h++) {
      const st: i32 = hotL[h];
      const xa: f32 = aA[st]; const xb: f32 = aB[st]; aA[st] = 0.0; aB[st] = 0.0;
      sLpA[st] += gTiltK * (xa - sLpA[st]); sLpB[st] += gTiltK * (xb - sLpB[st]);
      const x: f32 = sLpA[st] * gCLo + (xb - sLpB[st]) * gCHi + rnd() * sNz[st];
      let voc: f32 = 0.0;
      const b5: i32 = st * 5;
      for (let k = 0; k < 5; k++) {
        const i5: i32 = b5 + k;
        const ic1: f32 = sI1[i5]; const ic2: f32 = sI2[i5];
        const v3: f32 = x - ic2;
        const v1: f32 = sA1[i5] * ic1 + sA2[i5] * v3;
        const v2: f32 = ic2 + sA2[i5] * ic1 + sA3[i5] * v3;
        sI1[i5] = 2.0 * v1 - ic1; sI2[i5] = 2.0 * v2 - ic2;
        voc += v1 * sKA[i5];
      }
      gv[st & 7] += voc;
    }

    // ---- stage groups: arrival delay + pan
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let g = 0; g < NG; g++) {
      const gb: i32 = g * GDL;
      gBuf[gb + gPos] = gv[g]; gv[g] = 0.0;
      mixL += gBuf[gb + ((gPos - gDlen[g]) & (GDL - 1))] * gPL[g];
      mixR += gBuf[gb + ((gPos - gDlenR[g]) & (GDL - 1))] * gPR[g];
    }
    gPos = (gPos + 1) & (GDL - 1);

    let l: f32 = mixL - dcx0 + 0.995 * dcy0; dcx0 = mixL; dcy0 = l;
    let r: f32 = mixR - dcx1 + 0.995 * dcy1; dcx1 = mixR; dcy1 = r;
    // presence peak
    { const y: f32 = pb0 * l + pzL1; pzL1 = pb1 * l - pa1 * y + pzL2; pzL2 = pb2 * l - pa2 * y; l = y; }
    { const y: f32 = pb0 * r + pzR1; pzR1 = pb1 * r - pa1 * y + pzR2; pzR2 = pb2 * r - pa2 * y; r = y; }
    l *= level; r *= level;
    const lvIn: f32 = (l < 0.0 ? -l : l); if (lvIn > peak) peak = lvIn;

    // ---- hall
    let wl: f32 = 0.0; let wr: f32 = 0.0;
    if (wetGain > 0.001) {
      dn = -dn;
      // early reflections from the dry signal
      erB[rPos] = (l + r) * 0.5 + dn;
      let el: f32 = 0.0; let er: f32 = 0.0;
      for (let i = 0; i < 8; i++) {
        const v: f32 = erB[(rPos - erLen[i]) & RMASK] * ER_G[i];
        if (((i * 5) & 2) == 0) el += v; else er += v;
      }
      // pre-delay -> low-cut -> diffusion
      pdL[rPos] = l; pdR[rPos] = r;
      let il: f32 = pdL[(rPos - pdLen) & RMASK]; let ir: f32 = pdR[(rPos - pdLen) & RMASK];
      hpL += hpK * (il - hpL); il -= hpL; hpR += hpK * (ir - hpR); ir -= hpR;
      for (let a = 0; a < 2; a++) {
        let p: i32 = apPos[a]; let o: i32 = a * AP_N + p; let bz: f32 = apB[o]; let vv: f32 = il - 0.6 * bz; il = bz + 0.6 * vv; apB[o] = vv;
        apPos[a] = p + 1 >= apLen[a] ? 0 : p + 1;
        p = apPos[a + 2]; o = (a + 2) * AP_N + p; bz = apB[o]; vv = ir - 0.6 * bz; ir = bz + 0.6 * vv; apB[o] = vv;
        apPos[a + 2] = p + 1 >= apLen[a + 2] ? 0 : p + 1;
      }
      // 8-line FDN, Householder feedback, damped, modulated
      let sum: f32 = 0.0;
      for (let i = 0; i < RL; i++) {
        let ph: f32 = fdPh[i] + fdInc[i]; if (ph >= 1.0) ph -= 1.0; fdPh[i] = ph;
        const dl: f32 = fdLen[i] + psin(ph) * fdMod;
        const di: i32 = i32(dl); const fr: f32 = dl - f32(di);
        const base: i32 = i * RBUF;
        const y: f32 = fdn[base + ((fPos - di) & RMASK)] * (1.0 - fr) + fdn[base + ((fPos - di - 1) & RMASK)] * fr;
        fdLp[i] += fdDamp * (y - fdLp[i]);
        const o: f32 = fdLp[i] * fdG[i];
        fdO[i] = o; sum += o;
      }
      const hh: f32 = sum * 0.25;
      for (let i = 0; i < RL; i++) {
        const inp: f32 = (i & 1) == 0 ? il : ir;
        fdn[i * RBUF + fPos] = fdO[i] - hh + inp * (((i >> 1) & 1) == 0 ? 0.35 : -0.35) + dn;
      }
      fPos = (fPos + 1) & RMASK;
      const tl: f32 = (fdO[0] - fdO[2] + fdO[4] - fdO[6]) * 0.5;
      const tr: f32 = (fdO[1] - fdO[3] + fdO[5] - fdO[7]) * 0.5;
      wl = (tl + el * erGain) * wetGain * 0.7; wr = (tr + er * erGain) * wetGain * 0.7;
    }
    rPos = (rPos + 1) & RMASK;
    l += wl; r += wr;
    outBuf[f] = f32(Mathf.tanh(l)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r));
  }
  const lv: f32 = clampf(peak * 3.0, 0.0, 1.0);
  lvS = lv > lvS ? lv : lvS * 0.85 + lv * 0.15;
  display[0] = lvS;
  updateDisplay();
}
