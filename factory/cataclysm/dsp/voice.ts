// =====================================================================
//  voice.ts — one CATACLYSM drum voice: six layers (tone, FM, modal
//  resonator, noise/clap, metal cluster, click) with cross-modulation,
//  per-voice modulation matrix and per-hit humanisation.
//
//  Control rate: every TICK samples the voice re-evaluates envelopes,
//  modulation and filter/resonator coefficients ("targets"); the audio
//  loop interpolates linearly between ticks so fast sweeps stay smooth.
// =====================================================================

const NV: i32 = 4;                      // polyphony pool
const NMODES: i32 = 12;
const NMOSC: i32 = 6;

// MAT_R (modal ratio tables) and MET_R (metal oscillator sets) are generated from
// factory/cataclysm/tables.mjs and shared with the GUI.
const MAT_LN = new StaticArray<f32>(72);
const MET_LN = new StaticArray<f32>(36);

function initTables(): void {
  for (let i = 0; i < 72; i++) MAT_LN[i] = Mathf.log(MAT_R[i]);
  for (let i = 0; i < 36; i++) MET_LN[i] = Mathf.log(MET_R[i]);
}

// ---- global performance state ------------------------------------------
let gBend: f32 = 0.0;        // -1..1
let gWheel: f32 = 0.0;       // CC1 0..1
let gPress: f32 = 0.0;       // 0..1
let gL1p: f32 = 0.0;         // free-running LFO phases (FX modulation)
let gL2p: f32 = 0.0;
let hitCounter: i32 = 0;

const vbufL = new StaticArray<f32>(TICK);
const vbufR = new StaticArray<f32>(TICK);

// ---- envelope shapes -----------------------------------------------------
// Fall of 60 dB over T seconds, bent by q: dB(t) = -60 · (t/T)^q.
function curveEnv(age: f32, T: f32, q: f32): f32 {
  if (T <= 0.00001) return 0.0;
  const u = age / T;
  const x = q == 1.0 ? u : Mathf.pow(u, q);
  if (x > 12.0) return 0.0;
  return Mathf.exp(-LN10_60 * x);
}
// Layer amplitude envelope: smooth attack, curved main decay, optional tail.
function ampEnv(age: f32, att: f32, dec: f32, crv: f32, tailDb: f32, tailT: f32, decMul: f32): f32 {
  let a: f32 = 1.0;
  if (att > 0.0001) {
    a = age / att;
    if (a >= 1.0) a = 1.0; else a = a * a * (<f32>3.0 - <f32>2.0 * a);
  }
  const e1 = curveEnv(age, dec * decMul, exp2f(<f32>2.0 * crv));
  let e2: f32 = 0.0;
  let tg: f32 = 0.0;
  if (tailDb > -59.5) {
    tg = Mathf.exp(tailDb * <f32>0.11512925);
    const tt = tailT * decMul;
    if (age < tt * 1.8) e2 = tg * Mathf.exp(-LN10_60 * age / tt);
  }
  return a * (e1 + e2) / (<f32>1.0 + <f32>0.5 * tg);
}

// ---- oscillator waves -----------------------------------------------------
@inline function triW(ph: f32): f32 {
  if (ph < 0.25) return ph * <f32>4.0;
  if (ph < 0.75) return <f32>2.0 - ph * <f32>4.0;
  return ph * <f32>4.0 - <f32>4.0;
}
@inline function sawW(ph: f32, dt: f32): f32 {
  let q = ph + <f32>0.5; if (q >= 1.0) q -= 1.0;
  return (q + q - <f32>1.0) - polyblep(q, dt);
}
@inline function pulseW(ph: f32, dt: f32, pw: f32): f32 {
  let s: f32 = ph < pw ? <f32>1.0 : <f32>-1.0;
  s += polyblep(ph, dt);
  let q = ph - pw; if (q < 0.0) q += 1.0;
  s -= polyblep(q, dt);
  return s;
}
function oscWave(ph: f32, shape: f32, pw: f32, dt: f32): f32 {
  if (shape < 0.002) return Mathf.sin(TWO_PI * ph);
  if (shape < 1.0) {
    const s = Mathf.sin(TWO_PI * ph);
    return s + (triW(ph) - s) * shape;
  }
  if (shape < 2.0) {
    const t = triW(ph);
    return t + (sawW(ph, dt) - t) * (shape - <f32>1.0);
  }
  const w = sawW(ph, dt);
  return w + (pulseW(ph, dt, pw) - (<f32>2.0 * pw - <f32>1.0) - w) * (shape - <f32>2.0);
}

// ---- LFO -----------------------------------------------------------------
// shape: 0 sine 1 tri 2 saw 3 square 4 S&H 5 smooth noise. h0/h1 are the
// random values around the current cycle (updated by the caller on wrap).
function lfoEval(shape: i32, ph: f32, h0: f32, h1: f32): f32 {
  if (shape == 0) return Mathf.sin(TWO_PI * ph);
  if (shape == 1) return triW(ph);
  if (shape == 2) return ph * <f32>2.0 - <f32>1.0;
  if (shape == 3) return ph < 0.5 ? <f32>1.0 : <f32>-1.0;
  if (shape == 4) return h1;
  return h0 + (h1 - h0) * ph;
}
@inline function lfoRate(rate: f32, sync: i32): f32 {
  if (sync == 0) return rate;
  return (hostTempo() / <f32>60.0) / syncBeats(sync);
}

// ratchet repeat spacing in beats (RAT_SYNC): free,1/8,1/16,1/32,1/64,1/8T,1/16T,1/32T
@inline function ratBeats(d: i32): f32 {
  if (d == 1) return 0.5;
  if (d == 2) return 0.25;
  if (d == 3) return 0.125;
  if (d == 4) return 0.0625;
  if (d == 5) return <f32>(1.0 / 3.0);
  if (d == 6) return <f32>(1.0 / 6.0);
  if (d == 7) return <f32>(1.0 / 12.0);
  return 0.0;
}

// Params whose 0..1 position velocity pushes (VEL_BRT).
const BRT_LIST: StaticArray<i32> = [P_N_CUT, P_X_BPF, P_X_HPF, P_C_FREQ, P_F_IDX, P_M_BRT, P_N_MODE];
const NBRT: i32 = 7;

class Voice {
  p: StaticArray<f32> = new StaticArray<f32>(NP);       // effective params for this hit
  msum: StaticArray<f32> = new StaticArray<f32>(NP);

  active: bool = false;
  choking: bool = false;
  chokeG: f32 = 1.0; chokeStep: f32 = 0.0;
  released: bool = false;
  relG: f32 = 1.0; relCoef: f32 = 1.0;
  seq: i32 = 0;
  note: i32 = 0;
  vel: f32 = 0.0;
  keyOff: f32 = 0.0;          // played note − root (semitones, fractional)
  ratSemi: f32 = 0.0;
  ratNorm: f32 = 0.0;
  rnd: f32 = 0.0;
  hHum: f32 = 0.0;            // humanize pitch offset (semitones)
  velG: f32 = 1.0;
  decMul: f32 = 1.0;
  og: f32 = 1.0;              // per-hit gain (velocity, humanize)
  age: i32 = 0;
  first: bool = true;

  // modulators
  envA: f32 = 0.0; envB: f32 = 0.0;
  l1p: f32 = 0.0; l2p: f32 = 0.0; l1v: f32 = 0.0; l2v: f32 = 0.0;
  l1h0: f32 = 0.0; l1h1: f32 = 0.0; l2h0: f32 = 0.0; l2h1: f32 = 0.0;

  // layer gains (level × pan) computed per tick
  gTL: f32 = 0.0; gTR: f32 = 0.0; gFL: f32 = 0.0; gFR: f32 = 0.0;
  gNL: f32 = 0.0; gNR: f32 = 0.0; gXL: f32 = 0.0; gXR: f32 = 0.0;
  gCL: f32 = 0.0; gCR: f32 = 0.0; gM: f32 = 0.0;
  sCLK: f32 = 0.0; sNOI: f32 = 0.0; sTONE: f32 = 0.0; sMET: f32 = 0.0; sFM: f32 = 0.0;
  lvTone: f32 = 0.0;
  onT: bool = false; onF: bool = false; onN: bool = false; onX: bool = false; onC: bool = false; onM: bool = false;

  // ---- tone
  tph: f32 = 0.0; tph2: f32 = 0.0; tsub: f32 = 0.0;
  tInc: f32 = 0.0; dTInc: f32 = 0.0; tIncT: f32 = 0.0;
  eT: f32 = 0.0; dET: f32 = 0.0; eTT: f32 = 0.0;
  tFb: f32 = 0.0; tRaw: f32 = 0.0;
  tShape: f32 = 0.0; tPw: f32 = 0.5; tFold: f32 = 0.0; tFbAmt: f32 = 0.0;
  tSync: bool = false; tSyncR: f32 = 1.0; tSubG: f32 = 0.0; tSubDiv: f32 = 0.5;
  // ---- FM
  fph: f32 = 0.0; mph: f32 = 0.0; mHold: f32 = 0.0; mFb: f32 = 0.0;
  fInc: f32 = 0.0; dFInc: f32 = 0.0; fIncT: f32 = 0.0;
  fIdx: f32 = 0.0; dFIdx: f32 = 0.0; fIdxT: f32 = 0.0;
  eF: f32 = 0.0; dEF: f32 = 0.0; eFT: f32 = 0.0;
  fMr: f32 = 1.0; fRaw: f32 = 0.0; fFbAmt: f32 = 0.0; fWave: i32 = 0; fMode: i32 = 0;
  // ---- noise
  nPinkL: Pink = new Pink(); nPinkR: Pink = new Pink();
  nBL: f32 = 0.0; nBR: f32 = 0.0; nPL: f32 = 0.0; nPR: f32 = 0.0;
  nShL: f32 = 0.0; nShR: f32 = 0.0; nShCnt: i32 = 0;
  nC1L: f32 = 0.2; nC2L: f32 = 0.1; nC1R: f32 = 0.3; nC2R: f32 = 0.2;
  nF1L: Svf = new Svf(); nF2L: Svf = new Svf(); nF1R: Svf = new Svf(); nF2R: Svf = new Svf();
  nType: i32 = 0; nMode: f32 = 1.0; nSlope24: bool = false; nWidth: f32 = 0.5;
  nG0: f32 = 0.0; nQ: f32 = 1.0; nTfc: f32 = 0.0; nNorm: f32 = 1.0;
  eN: f32 = 0.0; dEN: f32 = 0.0; eNT: f32 = 0.0;
  nGate: i32 = 0; nBurstN: i32 = 1; nBurstI: i32 = 0; nBe: f32 = 0.0; nBCoef: f32 = 0.0;
  nBurstT: StaticArray<i32> = new StaticArray<i32>(16);
  nBurstA: StaticArray<f32> = new StaticArray<f32>(16);
  nTailStart: f32 = 0.0; nRatDepth: f32 = 0.0; nRaw: f32 = 0.0; nRawL: f32 = 0.0; nRawR: f32 = 0.0;
  // ---- metal
  xph: StaticArray<f32> = new StaticArray<f32>(NMOSC);
  xInc: StaticArray<f32> = new StaticArray<f32>(NMOSC);
  dXInc: StaticArray<f32> = new StaticArray<f32>(NMOSC);
  xIncT: StaticArray<f32> = new StaticArray<f32>(NMOSC);
  xShm: StaticArray<f32> = new StaticArray<f32>(NMOSC);
  xHp: Svf = new Svf(); xBp: Svf = new Svf();
  xPw: f32 = 0.5; xRing: f32 = 0.0; xFold: f32 = 0.0; xBand: f32 = 0.5; xTfm: f32 = 0.0;
  eX: f32 = 0.0; dEX: f32 = 0.0; eXT: f32 = 0.0; xRaw: f32 = 0.0;
  // ---- click
  cActive: bool = false; cAge: i32 = 0; cLen: f32 = 48.0; cCoef: f32 = 0.99; ce: f32 = 1.0;
  cType: i32 = 0; cPh: f32 = 0.0; cFreq: f32 = 3000.0; cF: Svf = new Svf(); cSign: f32 = 1.0; cRaw: f32 = 0.0;
  // ---- modal
  mx: StaticArray<f32> = new StaticArray<f32>(NMODES);
  my: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mc: StaticArray<f32> = new StaticArray<f32>(NMODES);
  ms: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mdc: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mds: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mcT: StaticArray<f32> = new StaticArray<f32>(NMODES);
  msT: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mr: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mw: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mwc: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mgl: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mgr: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mdet: StaticArray<f32> = new StaticArray<f32>(NMODES);
  mEnvF: f32 = 0.0; mEnvRel: f32 = 0.999;
  excN: i32 = 0; excLen: i32 = 1; excAmp: f32 = 1.0; excNoise: f32 = 0.0;
  excLp: OnePole = new OnePole();
  mNl: f32 = 0.0; eMT: f32 = 0.0; eM: f32 = 0.0;

  // ===================================================================
  //  trigger
  // ===================================================================
  trigger(note: i32, hz: f32, vel: f32, ratIdx: i32, ratN: i32, ratSemi: f32, hit: i32): void {
    for (let i = 0; i < NP; i++) unchecked(this.p[i] = A[i]);
    this.note = note; this.vel = vel; this.seq = hit;
    const noteF = <f32>69.0 + <f32>17.312340 * Mathf.log(hz / <f32>440.0);
    this.keyOff = noteF - pv(P_ROOT);
    this.ratSemi = ratSemi;
    this.ratNorm = ratN > 1 ? f32(ratIdx) / f32(ratN - 1) : <f32>0.0;
    this.rnd = white();
    const hum = pv(P_HUMAN);
    this.hHum = hum * <f32>0.5 * white();
    const hDec = exp2f(hum * <f32>0.6 * white());
    const hLev = dbToGain(hum * <f32>1.5 * white());
    const va = pv(P_VEL_AMP);
    this.velG = (<f32>1.0 - va) + va * vel * vel;
    this.decMul = hDec * exp2f(pv(P_VEL_DEC) * (vel - <f32>0.75) * <f32>3.0);
    this.og = this.velG * hLev;
    this.age = 0; this.first = true;
    this.active = true; this.choking = false; this.chokeG = 1.0; this.released = false; this.relG = 1.0;
    // modulators
    this.l1p = A[P_L1_RETRIG] > 0.5 ? <f32>0.0 : gL1p;
    this.l2p = A[P_L2_RETRIG] > 0.5 ? <f32>0.0 : gL2p;
    this.l1h0 = white(); this.l1h1 = white(); this.l2h0 = white(); this.l2h1 = white();

    // tone / fm / metal oscillators restart (kick phase must be repeatable)
    this.tph = 0.0; this.tph2 = 0.0; this.tsub = 0.0; this.tFb = 0.0; this.tRaw = 0.0;
    this.fph = 0.0; this.mph = 0.0; this.mHold = white(); this.mFb = 0.0; this.fRaw = 0.0;
    for (let k = 0; k < NMOSC; k++) { this.xph[k] = rand01(); this.xShm[k] = 0.0; }
    this.xHp.reset(); this.xBp.reset(); this.xRaw = 0.0;
    // noise
    this.nF1L.reset(); this.nF2L.reset(); this.nF1R.reset(); this.nF2R.reset();
    this.nPinkL.reset(); this.nPinkR.reset();
    this.nBL = 0.0; this.nBR = 0.0; this.nPL = 0.0; this.nPR = 0.0; this.nShCnt = 0;
    this.nRaw = 0.0; this.nRawL = 0.0; this.nRawR = 0.0;
    // modal
    for (let k = 0; k < NMODES; k++) {
      this.mx[k] = 0.0; this.my[k] = 0.0;
      this.mdet[k] = exp2f((white() * pv(P_M_SPREAD) + this.hHum * <f32>40.0) * <f32>0.000833333);
    }
    this.mEnvF = 0.0;
    this.excN = 0;
    this.excLp.reset();
    // click
    this.initClick();
    // clap bursts
    this.initBursts();

    this.mNl = 0.0;
    this.evalTargets(0.0);
    this.eT = this.eTT; this.eF = this.eFT; this.eN = this.eNT; this.eX = this.eXT;
  }

  initClick(): void {
    const p = this.p;
    this.cActive = A[P_C_LEV] > -59.5 || (A[P_M_LEV] > -59.5 && A[P_S_CLK] > 0.0);
    this.cAge = 0;
    this.cType = i32(A[P_C_TYPE]);
    this.cFreq = A[P_C_FREQ];
    this.cLen = maxf(<f32>1.0, A[P_C_LEN] * <f32>0.001 * SR);
    this.cCoef = Mathf.exp(-LN10_60 / this.cLen);
    this.ce = 1.0; this.cPh = 0.0;
    this.cSign = A[P_C_INV] > 0.5 ? <f32>-1.0 : <f32>1.0;
    this.cF.reset();
  }

  initBursts(): void {
    const n = i32(A[P_N_BN]);
    this.nBurstN = n; this.nBurstI = 0; this.nBe = 0.0;
    this.nGate = i32(A[P_N_GATE]);
    const sp = A[P_N_BSP] * <f32>0.001 * SR;
    const jit = A[P_N_BJIT];
    const slope = A[P_N_BSLOPE];
    let t: f32 = 0.0;
    let mx: f32 = 0.0;
    for (let i = 0; i < n; i++) {
      this.nBurstT[i] = i32(t);
      const a = Mathf.exp(slope * f32(i) * <f32>0.45);
      this.nBurstA[i] = a;
      if (a > mx) mx = a;
      t += sp * (<f32>1.0 + jit * (rand01() * <f32>1.6 - <f32>0.8));
    }
    for (let i = 0; i < n; i++) this.nBurstA[i] = this.nBurstA[i] / mx;
    this.nTailStart = f32(this.nBurstT[n - 1]) * invSR;
    const blen = maxf(<f32>2.0, A[P_N_BLEN] * <f32>0.001 * SR);
    this.nBCoef = Mathf.exp(-LN10_60 / blen);
  }

  // ===================================================================
  //  modulation matrix → p[]
  // ===================================================================
  srcVal(s: i32): f32 {
    if (s == 1) return this.vel;
    if (s == 2) return clampf(this.keyOff * <f32>0.0208333, -1.5, 1.5);
    if (s == 3) return this.rnd;
    if (s == 4) return this.envA;
    if (s == 5) return this.envB;
    if (s == 6) return this.l1v;
    if (s == 7) return this.l2v;
    if (s == 8) return gWheel;
    if (s == 9) return gPress;
    if (s == 10) return gBend;
    if (s == 11) return this.ratNorm;
    if (s >= 12) return pn(P_MAC1 + s - 12);
    return 0.0;
  }

  applyMods(ageS: f32): void {
    // live base values (so knob moves are heard on ringing voices), then modulation on top
    for (let i = 0; i < NP; i++) unchecked(this.p[i] = A[i]);
    // internal modulators
    this.envA = this.env2(ageS, P_EA_ATT, P_EA_DEC, P_EA_CRV);
    this.envB = this.env2(ageS, P_EB_ATT, P_EB_DEC, P_EB_CRV);
    this.l1v = lfoEval(i32(A[P_L1_SHAPE]), this.l1p, this.l1h0, this.l1h1);
    this.l2v = lfoEval(i32(A[P_L2_SHAPE]), this.l2p, this.l2h0, this.l2h1);

    const bo = pv(P_VEL_BRT) * (this.vel - <f32>0.75) * <f32>0.6;
    for (let j = 0; j < NBRT; j++) unchecked(this.msum[BRT_LIST[j]] = 0.0);
    // zero, accumulate, assign — user slots first
    for (let s = 0; s < 8; s++) {
      const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
      if (d >= 0 && PIS_FX[d] == 0) this.msum[d] = 0.0;
    }
    for (let s = 0; s < 8; s++) {
      const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
      const src = i32(A[P_MX1_SRC + s * 3]);
      if (d >= 0 && PIS_FX[d] == 0 && src > 0) this.msum[d] += this.srcVal(src) * A[P_MX1_AMT + s * 3];
    }
    for (let j = 0; j < NBRT; j++) { const d = BRT_LIST[j]; this.msum[d] += (j == 6 ? bo * <f32>0.5 : bo); }
    for (let j = 0; j < NBRT; j++) { const d = BRT_LIST[j]; this.p[d] = mapNorm(d, clampf(An[d] + this.msum[d], 0.0, 1.0)); }
    for (let s = 0; s < 8; s++) {
      const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
      if (d >= 0 && PIS_FX[d] == 0) this.p[d] = mapNorm(d, clampf(An[d] + this.msum[d], 0.0, 1.0));
    }
  }

  env2(age: f32, pa: i32, pd: i32, pc: i32): f32 {
    const att = A[pa] * <f32>0.001;
    if (age < att) return age / att;
    return curveEnv(age - att, A[pd] * <f32>0.001, exp2f(<f32>2.0 * A[pc]));
  }

  // ===================================================================
  //  evaluate every tick-rate target for time `ageS`
  // ===================================================================
  evalTargets(ageS: f32): void {
    this.applyMods(ageS);
    const p = this.p;
    const nyq = SR * <f32>0.46;
    // which layers need computing (a hidden layer still runs if it feeds the resonator or a cross-mod)
    this.onM = p[P_M_LEV] > -59.5;
    this.onT = p[P_T_LEV] > -59.5 || (this.onM && p[P_S_TONE] > 0.0) || p[P_X_TFC] > 0.0 || p[P_X_TFM] > 0.0;
    this.onF = p[P_F_LEV] > -59.5 || (this.onM && p[P_S_FM] > 0.0);
    this.onN = p[P_N_LEV] > -59.5 || (this.onM && p[P_S_NOI] > 0.0) || p[P_X_NFM] > 0.0;
    this.onX = p[P_X_LEV] > -59.5 || (this.onM && p[P_S_MET] > 0.0) || p[P_X_MRM] > 0.0;
    this.onC = p[P_C_LEV] > -59.5 || (this.onM && p[P_S_CLK] > 0.0);
    const dm = this.decMul;
    const bend = gBend * pv(P_BEND);
    const common = pv(P_TUNE) + bend + pv(P_VEL_PITCH) * this.vel + this.hHum + this.ratSemi;

    // ---- tone ----------------------------------------------------------
    this.tShape = p[P_T_SHAPE]; this.tPw = p[P_T_PW]; this.tFold = p[P_T_FOLD];
    this.tFbAmt = p[P_T_FB]; this.tSync = p[P_T_SYNC] > 0.5; this.tSyncR = p[P_T_SYNCR];
    const pe1 = p[P_T_PE1_AMT] * curveEnv(ageS, p[P_T_PE1_TIME] * <f32>0.001, exp2f(<f32>2.0 * p[P_T_PE1_CRV]));
    const pe2 = p[P_T_PE2_AMT] * curveEnv(ageS, p[P_T_PE2_TIME] * <f32>0.001, 1.0);
    this.eTT = ampEnv(ageS, p[P_T_ATT] * <f32>0.001, p[P_T_DEC] * <f32>0.001, p[P_T_CRV], p[P_T_TAIL], p[P_T_TAILT] * <f32>0.001, dm);
    const semiT = p[P_T_KT] * this.keyOff + common + pe1 + pe2 + p[P_T_TENS] * this.eTT * this.eTT;
    this.tIncT = clampf(p[P_T_PITCH] * exp2f(semiT * <f32>0.0833333), 0.5, nyq) * invSR;
    this.tSubG = lvlGain(p[P_T_SUB]);
    this.tSubDiv = p[P_T_SUBOCT] > 0.5 ? <f32>0.25 : <f32>0.5;
    this.lvTone = lvlGain(p[P_T_LEV]);

    // ---- FM ------------------------------------------------------------
    this.eFT = ampEnv(ageS, p[P_F_ATT] * <f32>0.001, p[P_F_DEC] * <f32>0.001, p[P_F_CRV], -60.0, 1.0, dm);
    const semiF = p[P_F_KT] * this.keyOff + common + pe1 * p[P_F_FOLLOW];
    this.fIncT = clampf(p[P_F_FREQ] * exp2f(semiF * <f32>0.0833333), 0.5, nyq) * invSR;
    this.fMr = p[P_F_MRATIO] * exp2f(p[P_F_DET] * <f32>0.000833333);
    this.fIdxT = p[P_F_IDX] * curveEnv(ageS, p[P_F_IDXT] * <f32>0.001, exp2f(<f32>2.0 * p[P_F_IDXC]));
    this.fFbAmt = p[P_F_FB]; this.fWave = i32(p[P_F_MWAVE]); this.fMode = i32(p[P_F_MODE]);

    // ---- noise ---------------------------------------------------------
    const ageN = maxf(<f32>0.0, ageS - (this.nGate == 1 ? this.nTailStart : <f32>0.0));
    this.eNT = ampEnv(ageN, p[P_N_ATT] * <f32>0.001, p[P_N_DEC] * <f32>0.001, p[P_N_CRV], p[P_N_TAIL], p[P_N_TAILT] * <f32>0.001, dm);
    const feN = curveEnv(ageS, p[P_N_FE_TIME] * <f32>0.001, 1.0);
    const octN = p[P_N_KT] * this.keyOff * <f32>0.0833333 + p[P_N_FE_AMT] * feN;
    const fcN = clampf(p[P_N_CUT] * exp2f(octN), 20.0, nyq);
    this.nQ = <f32>0.5 * Mathf.exp(p[P_N_RES] * <f32>5.9914645);
    this.nMode = p[P_N_MODE]; this.nSlope24 = p[P_N_SLOPE] > 0.5; this.nWidth = p[P_N_WIDTH];
    this.nType = i32(p[P_N_TYPE]);
    this.nTfc = p[P_X_TFC];
    this.nG0 = Mathf.tan(PI * fcN * invSR);
    if (this.nTfc <= 0.0) {
      this.nF1L.setG(this.nG0, this.nQ); this.nF2L.setG(this.nG0, this.nQ);
      this.nF1R.setG(this.nG0, this.nQ); this.nF2R.setG(this.nG0, this.nQ);
    }
    this.nRatDepth = p[P_N_RAT];
    {
      const md0 = p[P_N_MODE];
      const bwBp = fcN / this.nQ;
      const bw = md0 < 1.0 ? lerpf(fcN, bwBp, md0) : lerpf(bwBp, nyq - fcN, md0 - <f32>1.0);
      this.nNorm = clampf(<f32>0.5 * Mathf.sqrt(nyq / maxf(bw, <f32>40.0)), 0.5, 8.0);
    }

    // ---- metal ---------------------------------------------------------
    if (this.onX) {
    const pem = p[P_X_PE_AMT] * curveEnv(ageS, p[P_X_PE_TIME] * <f32>0.001, 1.0);
    const semiX = p[P_X_KT] * this.keyOff + common + pem;
    const fX = p[P_X_FREQ] * exp2f(semiX * <f32>0.0833333);
    const ms = clampf(p[P_X_SET], 0.0, 5.0);
    let ia = i32(ms); if (ia > 4) ia = 4;
    const fr = ms - f32(ia);
    let lnMean: f32 = 0.0;
    for (let k = 0; k < NMOSC; k++) lnMean += lerpf(MET_LN[ia * 6 + k], MET_LN[ia * 6 + 6 + k], fr);
    lnMean = lnMean * <f32>0.1666667;
    const spread = p[P_X_SPREAD];
    const shm = p[P_X_SHM];
    for (let k = 0; k < NMOSC; k++) {
      const ln = lerpf(MET_LN[ia * 6 + k], MET_LN[ia * 6 + 6 + k], fr);
      this.xShm[k] += (white() - this.xShm[k]) * <f32>0.18;
      const f = fX * Mathf.exp(lnMean + (ln - lnMean) * spread) * (<f32>1.0 + shm * <f32>0.03 * this.xShm[k]);
      this.xIncT[k] = clampf(f, 1.0, nyq) * invSR;
    }
    this.xPw = p[P_X_PW]; this.xRing = p[P_X_RING]; this.xFold = p[P_X_FOLD];
    this.xBand = p[P_X_BAND]; this.xTfm = p[P_X_TFM];
    const feX = curveEnv(ageS, p[P_X_FE_TIME] * <f32>0.001, 1.0);
    const fBp = clampf(p[P_X_BPF] * exp2f(p[P_X_FE_AMT] * feX), 100.0, nyq);
    this.xBp.set(fBp, p[P_X_BPQ]);
    this.xHp.set(clampf(p[P_X_HPF], 20.0, nyq), 0.7);
    this.eXT = ampEnv(ageS, p[P_X_ATT] * <f32>0.001, p[P_X_DEC] * <f32>0.001, p[P_X_CRV], p[P_X_TAIL], p[P_X_TAILT] * <f32>0.001, dm);
    }

    // ---- click ---------------------------------------------------------
    this.cFreq = p[P_C_FREQ];
    if (this.cType == 1) this.cF.set(this.cFreq, 1.2);
    else if (this.cType == 4) this.cF.set(this.cFreq, 10.0);
    else if (this.cType == 5) this.cF.set(this.cFreq, 0.7);
    else if (this.cType == 0) this.cF.set(this.cFreq, 0.7);

    // ---- modal ---------------------------------------------------------
    const useM = this.onM;
    if (useM) {
    this.eM = curveEnv(ageS, p[P_M_DEC] * <f32>0.001 * dm, 1.0);
    const semiM = p[P_M_KT] * this.keyOff + common + pe1 * p[P_M_FOLLOW] + p[P_M_TENS] * this.eM * this.vel;
    const fM = p[P_M_PITCH] * exp2f(semiM * <f32>0.0833333);
    const mat = clampf(p[P_M_MAT], 0.0, 5.0);
    let ma = i32(mat); if (ma > 4) ma = 4;
    const mf = mat - f32(ma);
    const stretch = <f32>1.0 + p[P_M_STR];
    const nm = i32(p[P_M_NUM]);
    const dec = p[P_M_DEC] * <f32>0.001 * dm;
    const tilt = p[P_M_TILT];
    const brt = p[P_M_BRT];
    const pos = p[P_M_POS] * <f32>0.9;
    const width = p[P_M_WIDTH];
    let wsum: f32 = 0.0;
    for (let k = 0; k < NMODES; k++) {
      const lnr = lerpf(MAT_LN[ma * 12 + k], MAT_LN[ma * 12 + 12 + k], mf) * stretch;
      const ratio = Mathf.exp(lnr);
      const f = fM * ratio * this.mdet[k];
      let w: f32 = 0.0;
      if (k < nm && f < nyq) {
        w = (<f32>0.1 + <f32>0.9 * Mathf.abs(Mathf.cos(PI * ratio * pos))) * Mathf.exp(-brt * lnr);
        if (k == nm - 1 && nm > 1) w *= <f32>0.8;
      }
      this.mw[k] = w; wsum += w * w;
      const ww = TWO_PI * f * invSR;
      this.mcT[k] = Mathf.cos(ww); this.msT[k] = Mathf.sin(ww);
      const t60 = maxf(<f32>0.0004, dec * Mathf.exp(-tilt * lnr));
      this.mr[k] = Mathf.exp(-LN10_60 / (t60 * SR));
      const pk: f32 = k == 0 ? <f32>0.0 : ((k & 1) == 0 ? <f32>-1.0 : <f32>1.0) * width * minf(<f32>1.0, <f32>0.4 + <f32>0.1 * f32(k));
      this.mgl[k] = panL(pk); this.mgr[k] = panR(pk);
    }
    const nrm: f32 = wsum > 0.0 ? <f32>1.0 / Mathf.sqrt(wsum) : <f32>0.0;
    for (let k = 0; k < NMODES; k++) {
      this.mw[k] = this.mw[k] * nrm;
      this.mwc[k] = this.mw[k] * (<f32>1.0 - this.mr[k]) * <f32>1.5;
    }
    this.mNl = p[P_M_NL];
    this.mEnvRel = Mathf.exp(-LN10_60 / maxf(<f32>8.0, dec * SR));
    this.excLen = i32(maxf(<f32>1.0, p[P_M_EXCL] * <f32>0.001 * SR));
    this.excNoise = p[P_M_EXCN];
    this.excLp.set(p[P_M_EXCLP]);
    this.excAmp = <f32>1.0 / (<f32>0.64 * f32(this.excLen));
    }
    this.gM = useM ? lvlGain(p[P_M_LEV]) : <f32>0.0;

    // ---- layer gains & sends -------------------------------------------
    const bri = <f32>1.0 + pv(P_VEL_BRT) * (this.vel - <f32>0.75) * <f32>0.8;
    this.gTL = lvlGain(p[P_T_LEV]) * panL(p[P_T_PAN]); this.gTR = lvlGain(p[P_T_LEV]) * panR(p[P_T_PAN]);
    this.gFL = lvlGain(p[P_F_LEV]) * panL(p[P_F_PAN]); this.gFR = lvlGain(p[P_F_LEV]) * panR(p[P_F_PAN]);
    this.gNL = lvlGain(p[P_N_LEV]) * panL(p[P_N_PAN]); this.gNR = lvlGain(p[P_N_LEV]) * panR(p[P_N_PAN]);
    this.gXL = lvlGain(p[P_X_LEV]) * panL(p[P_X_PAN]); this.gXR = lvlGain(p[P_X_LEV]) * panR(p[P_X_PAN]);
    this.gCL = lvlGain(p[P_C_LEV]) * panL(p[P_C_PAN]) * bri; this.gCR = lvlGain(p[P_C_LEV]) * panR(p[P_C_PAN]) * bri;
    this.sCLK = p[P_S_CLK]; this.sNOI = p[P_S_NOI]; this.sTONE = p[P_S_TONE]; this.sMET = p[P_S_MET]; this.sFM = p[P_S_FM];

    // ---- modulators advance (phases at tick rate) -------------------------
    // (applied in tick(), not here, so evalTargets stays idempotent)
  }

  // ===================================================================
  //  one control tick: move cur → target, evaluate the next target
  // ===================================================================
  tick(m: i32): void {
    // current ← last target
    this.eT = this.eTT; this.eF = this.eFT; this.eN = this.eNT; this.eX = this.eXT;
    this.tInc = this.tIncT; this.fInc = this.fIncT; this.fIdx = this.fIdxT;
    for (let k = 0; k < NMOSC; k++) this.xInc[k] = this.xIncT[k];
    for (let k = 0; k < NMODES; k++) { this.mc[k] = this.mcT[k]; this.ms[k] = this.msT[k]; }

    // advance modulators one tick
    const dtT = f32(m) * invSR;
    const r1 = lfoRate(A[P_L1_RATE], i32(A[P_L1_SYNC]));
    const r2 = lfoRate(A[P_L2_RATE], i32(A[P_L2_SYNC]));
    this.l1p += r1 * dtT; if (this.l1p >= 1.0) { this.l1p -= Mathf.floor(this.l1p); this.l1h0 = this.l1h1; this.l1h1 = white(); }
    this.l2p += r2 * dtT; if (this.l2p >= 1.0) { this.l2p -= Mathf.floor(this.l2p); this.l2h0 = this.l2h1; this.l2h1 = white(); }

    const ageE = f32(this.age + m) * invSR;
    this.evalTargets(ageE);
    const inv = <f32>1.0 / f32(m);
    this.dET = (this.eTT - this.eT) * inv; this.dEF = (this.eFT - this.eF) * inv;
    this.dEN = (this.eNT - this.eN) * inv; this.dEX = (this.eXT - this.eX) * inv;
    this.dTInc = (this.tIncT - this.tInc) * inv; this.dFInc = (this.fIncT - this.fInc) * inv;
    this.dFIdx = (this.fIdxT - this.fIdx) * inv;
    for (let k = 0; k < NMOSC; k++) this.dXInc[k] = (this.xIncT[k] - this.xInc[k]) * inv;
    for (let k = 0; k < NMODES; k++) { this.mdc[k] = (this.mcT[k] - this.mc[k]) * inv; this.mds[k] = (this.msT[k] - this.ms[k]) * inv; }
  }

  // ===================================================================
  //  audio: render m (<= TICK) samples, adding into vbufL / vbufR
  // ===================================================================
  render(m: i32): void {
    const sat = this.nType;
    const wid = this.nWidth;
    const tfc = this.nTfc;
    const nGate = this.nGate;
    const og = this.og * this.chokeG * this.relG;
    const shape = this.tShape;
    const doFold = this.tFold > 0.0;
    const foldK = <f32>1.0 + this.tFold * <f32>7.0;
    const nm = i32(this.p[P_M_NUM]);
    const wetNoise = this.onN;
    const dens: f32 = this.p[P_N_RATE] * invSR;
    const shHold: i32 = i32(maxf(<f32>1.0, SR / this.p[P_N_RATE]));
    const cLenI = this.cLen;
    const ratio = this.tSyncR;
    const sync = this.tSync;
    const tfm = this.xTfm;
    const mrmAmt = this.p[P_X_MRM];
    const nfmAmt = this.p[P_X_NFM];

    for (let i = 0; i < m; i++) {
      // ---- interpolate -----------------------------------------------------
      this.eT += this.dET; this.eF += this.dEF; this.eN += this.dEN; this.eX += this.dEX;
      this.tInc += this.dTInc; this.fInc += this.dFInc; this.fIdx += this.dFIdx;
      const ageI = this.age + i;

      // ---- click -----------------------------------------------------------
      let cl: f32 = 0.0;
      if (this.cActive) {
        const t = this.cType;
        if (t == 0) {
          // rectangular pulse, half a period of the click frequency wide, with a short fade
          cl = f32(this.cAge) < <f32>0.5 * SR / this.cFreq + <f32>1.0 ? this.ce : <f32>0.0;
        } else if (t == 1) {
          this.cF.tick(white());
          cl = this.cF.bp * this.cF.k * this.ce * <f32>1.2;
        } else if (t == 2) {
          cl = Mathf.sin(TWO_PI * this.cPh) * this.ce;
          this.cPh += this.cFreq * invSR; if (this.cPh >= 1.0) this.cPh -= 1.0;
        } else if (t == 3) {
          const f = this.cFreq * (<f32>1.0 + <f32>5.0 * this.ce * this.ce);
          cl = Mathf.sin(TWO_PI * this.cPh) * this.ce;
          this.cPh += clampf(f, 20.0, SR * 0.45) * invSR; if (this.cPh >= 1.0) this.cPh -= 1.0;
        } else if (t == 4) {
          const imp2: f32 = this.cAge == 0 ? <f32>1.0 / maxf(this.cF.a2, <f32>0.001) : <f32>0.0;
          this.cF.tick(imp2);
          cl = this.cF.bp * this.ce;
        } else {
          this.cF.tick(white());
          cl = this.cF.lp * this.ce * <f32>2.0;
        }
        this.ce *= this.cCoef;
        this.cAge++;
        if (f32(this.cAge) > cLenI * <f32>6.0) this.cActive = false;
        cl *= this.cSign;
      }
      this.cRaw = cl;

      // ---- noise ---------------------------------------------------------
      let nL: f32 = 0.0; let nR: f32 = 0.0;
      let nOutL: f32 = 0.0; let nOutR: f32 = 0.0;
      if (wetNoise) {
        let wL = white(); let wR = white();
        if (sat == 1) { wL = this.nPinkL.tick(wL) * <f32>2.6; wR = this.nPinkR.tick(wR) * <f32>2.6; }
        else if (sat == 2) {
          this.nBL = (this.nBL + <f32>0.02 * wL) / <f32>1.02; this.nBR = (this.nBR + <f32>0.02 * wR) / <f32>1.02;
          wL = this.nBL * <f32>6.0; wR = this.nBR * <f32>6.0;
        } else if (sat == 3) {
          const bl = (wL - this.nPL) * <f32>0.7; const br = (wR - this.nPR) * <f32>0.7;
          this.nPL = wL; this.nPR = wR; wL = bl; wR = br;
        } else if (sat == 4) {
          wL = rand01() < dens ? wL * <f32>1.6 : <f32>0.0;
          wR = rand01() < dens ? wR * <f32>1.6 : <f32>0.0;
        } else if (sat == 5) {
          this.nShCnt--;
          if (this.nShCnt <= 0) { this.nShL = wL; this.nShR = wR; this.nShCnt = shHold; }
          wL = this.nShL; wR = this.nShR;
        } else if (sat == 6) {
          const ca = <f32>1.1 + <f32>0.85 * clampf(Mathf.log(this.p[P_N_RATE] * <f32>0.05) * <f32>0.1448, 0.0, 1.0);
          let cl2 = Mathf.abs(ca * this.nC1L - this.nC2L - <f32>0.05); if (cl2 > 4.0) cl2 = 0.3;
          this.nC2L = this.nC1L; this.nC1L = cl2;
          let cr2 = Mathf.abs(ca * this.nC1R - this.nC2R - <f32>0.05); if (cr2 > 4.0) cr2 = 0.4;
          this.nC2R = this.nC1R; this.nC1R = cr2;
          wL = clampf((cl2 - <f32>0.5) * <f32>2.0, -1.0, 1.0); wR = clampf((cr2 - <f32>0.5) * <f32>2.0, -1.0, 1.0);
        }
        // filter (optionally with audio-rate cutoff FM from the tone oscillator)
        if (tfc > 0.0) {
          const g = this.nG0 * Mathf.exp(tfc * this.tRaw * <f32>0.6931472);
          this.nF1L.setG(g, this.nQ); this.nF2L.setG(g, this.nQ);
          this.nF1R.setG(g, this.nQ); this.nF2R.setG(g, this.nQ);
        }
        const md = this.nMode;
        this.nF1L.tick(wL);
        let yl = md < 1.0 ? this.nF1L.lp * (<f32>1.0 - md) + this.nF1L.bp * this.nF1L.k * md
                          : this.nF1L.bp * this.nF1L.k * (<f32>2.0 - md) + this.nF1L.hp * (md - <f32>1.0);
        if (this.nSlope24) {
          this.nF2L.tick(yl);
          yl = md < 1.0 ? this.nF2L.lp * (<f32>1.0 - md) + this.nF2L.bp * this.nF2L.k * md
                        : this.nF2L.bp * this.nF2L.k * (<f32>2.0 - md) + this.nF2L.hp * (md - <f32>1.0);
        }
        yl *= this.nNorm;
        nL = softclip(yl);
        if (wid > 0.001) {
          this.nF1R.tick(wR);
          let yr = md < 1.0 ? this.nF1R.lp * (<f32>1.0 - md) + this.nF1R.bp * this.nF1R.k * md
                            : this.nF1R.bp * this.nF1R.k * (<f32>2.0 - md) + this.nF1R.hp * (md - <f32>1.0);
          if (this.nSlope24) {
            this.nF2R.tick(yr);
            yr = md < 1.0 ? this.nF2R.lp * (<f32>1.0 - md) + this.nF2R.bp * this.nF2R.k * md
                          : this.nF2R.bp * this.nF2R.k * (<f32>2.0 - md) + this.nF2R.hp * (md - <f32>1.0);
          }
          nR = nL + (softclip(yr * this.nNorm) - nL) * wid;
        } else nR = nL;

        // gate
        let g: f32 = this.eN;
        if (nGate == 1) {
          if (this.nBurstI < this.nBurstN - 1 && ageI >= this.nBurstT[this.nBurstI]) {
            this.nBe = this.nBurstA[this.nBurstI]; this.nBurstI++;
          }
          this.nBe *= this.nBCoef;
          g = this.nBe + (ageI >= this.nBurstT[this.nBurstN - 1] ? this.eN * this.nBurstA[this.nBurstN - 1] : <f32>0.0);
        } else if (nGate == 2) {
          g = this.eN * ((<f32>1.0 - this.nRatDepth) + this.nRatDepth * minf(<f32>1.0, this.mEnvF * <f32>3.0));
        }
        nOutL = nL * g; nOutR = nR * g;
      }
      this.nRawL = nOutL; this.nRawR = nOutR;
      const nMono = (nOutL + nOutR) * <f32>0.5;
      this.nRaw = nMono;

      // ---- metal -------------------------------------------------------------
      let xOut: f32 = 0.0;
      if (this.onX) {
        const fmk = <f32>1.0 + tfm * this.tRaw * <f32>0.5;
        let sum: f32 = 0.0;
        let o0: f32 = 0.0; let o1: f32 = 0.0; let o2: f32 = 0.0; let o3: f32 = 0.0; let o4: f32 = 0.0; let o5: f32 = 0.0;
        for (let k = 0; k < NMOSC; k++) {
          const inc = (this.xInc[k] + this.dXInc[k] * f32(i)) * fmk;
          let ph = this.xph[k] + inc; if (ph >= 1.0) ph -= 1.0; if (ph < 0.0) ph += 1.0;
          this.xph[k] = ph;
          const o = pulseW(ph, inc, this.xPw) - (<f32>2.0 * this.xPw - <f32>1.0);
          sum += o;
          if (k == 0) o0 = o; else if (k == 1) o1 = o; else if (k == 2) o2 = o; else if (k == 3) o3 = o; else if (k == 4) o4 = o; else o5 = o;
        }
        let mm = sum * <f32>0.28;
        if (this.xRing > 0.0) mm = mm * (<f32>1.0 - this.xRing) + (o0 * o1 + o2 * o3 + o4 * o5) * <f32>0.55 * this.xRing;
        if (this.xFold > 0.0) mm = foldTri(mm * (<f32>1.0 + this.xFold * <f32>6.0));
        this.xHp.tick(mm);
        const hpo = this.xHp.hp;
        this.xBp.tick(hpo);
        const bpo = this.xBp.bp * this.xBp.k * <f32>1.6;
        xOut = softclip((bpo + (hpo - bpo) * this.xBand) * this.eX * <f32>4.5);
      }
      this.xRaw = xOut;

      // ---- tone ----------------------------------------------------------------
      let tOut: f32 = 0.0;
      if (this.onT) {
        const inc = this.tInc;
        this.tph += inc;
        let wrapped = false;
        if (this.tph >= 1.0) { this.tph -= Mathf.floor(this.tph); wrapped = true; }
        let pp = this.tph;
        if (sync) {
          if (wrapped) this.tph2 = this.tph * ratio; else this.tph2 += inc * ratio;
          this.tph2 -= Mathf.floor(this.tph2);
          pp = this.tph2;
        }
        let po = pp + this.tFbAmt * <f32>0.25 * this.tFb + nfmAmt * <f32>0.5 * this.nRaw;
        po -= Mathf.floor(po);
        let y = oscWave(po, shape, this.tPw, inc);
        if (doFold) y = foldTri(y * foldK);
        if (mrmAmt > 0.0) y += (y * this.xRaw * <f32>2.0 - y) * mrmAmt;
        this.tsub += inc * this.tSubDiv; if (this.tsub >= 1.0) this.tsub -= 1.0;
        if (this.tSubG > 0.0) y += Mathf.sin(TWO_PI * this.tsub) * this.tSubG;
        this.tFb = y;
        tOut = y * this.eT;
      }
      this.tRaw = tOut;

      // ---- FM ---------------------------------------------------------------------
      let fOut: f32 = 0.0;
      if (this.onF) {
        this.fph += this.fInc; if (this.fph >= 1.0) this.fph -= 1.0;
        const minc = this.fInc * this.fMr;
        this.mph += minc;
        let mod: f32 = 0.0;
        if (this.mph >= 1.0) { this.mph -= Mathf.floor(this.mph); this.mHold = white(); }
        let mp = this.mph + this.fFbAmt * <f32>0.25 * this.mFb; mp -= Mathf.floor(mp);
        const fw = this.fWave;
        if (fw == 0) mod = Mathf.sin(TWO_PI * mp);
        else if (fw == 1) mod = triW(mp);
        else if (fw == 2) mod = softclip(Mathf.sin(TWO_PI * mp) * <f32>4.0);
        else mod = this.mHold;
        this.mFb = mod;
        const car = Mathf.sin(TWO_PI * this.fph);
        if (this.fMode == 0) fOut = Mathf.sin(TWO_PI * this.fph + this.fIdx * mod);
        else if (this.fMode == 1) { const r = minf(<f32>1.0, this.fIdx * <f32>0.1); fOut = car * (<f32>1.0 - r + r * mod); }
        else { const r = this.fIdx / (this.fIdx + <f32>2.0); fOut = car * (<f32>1.0 - r * <f32>0.5 + r * <f32>0.5 * mod); }
        fOut *= this.eF;
      }
      this.fRaw = fOut;

      // ---- modal ----------------------------------------------------------------------
      let mL: f32 = 0.0; let mR: f32 = 0.0;
      if (this.gM > 0.0) {
        let exc: f32 = 0.0;
        if (this.excN < this.excLen) {
          const ph = f32(this.excN) / f32(this.excLen);
          const pulse = Mathf.sin(PI * ph);
          let nz: f32 = 0.0;
          if (this.excNoise > 0.0) nz = this.excLp.lp(white()) * <f32>1.7;
          exc = (pulse * (<f32>1.0 - this.excNoise) + pulse * nz * this.excNoise) * this.excAmp * this.vel;
          this.excN++;
        }
        const sends = this.sCLK * cl + this.sNOI * nMono + this.sTONE * tOut + this.sMET * xOut + this.sFM * fOut;
        for (let k = 0; k < NMODES; k++) {
          if (k >= nm) break;
          const w = unchecked(this.mw[k]);
          const r = unchecked(this.mr[k]);
          const c = unchecked(this.mc[k]); const s = unchecked(this.ms[k]);
          const x0 = unchecked(this.mx[k]); const y0 = unchecked(this.my[k]);
          const nx = r * (c * x0 - s * y0) + w * exc + unchecked(this.mwc[k]) * sends;
          const ny = r * (s * x0 + c * y0);
          unchecked(this.mx[k] = denorm(nx)); unchecked(this.my[k] = denorm(ny));
          unchecked(this.mc[k] = c + this.mdc[k]); unchecked(this.ms[k] = s + this.mds[k]);
          mL += ny * unchecked(this.mgl[k]); mR += ny * unchecked(this.mgr[k]);
        }
        if (this.mNl > 0.0) {
          const nk = <f32>1.0 + this.mNl * <f32>7.0;
          mL = softclip(mL * nk) / (<f32>1.0 + this.mNl * <f32>1.5);
          mR = softclip(mR * nk) / (<f32>1.0 + this.mNl * <f32>1.5);
        }
        const mo = (Mathf.abs(mL) + Mathf.abs(mR)) * <f32>0.5;
        this.mEnvF = mo > this.mEnvF ? mo : this.mEnvF * this.mEnvRel;
      }

      // ---- mix -------------------------------------------------------------------------------
      const oL = (tOut * this.gTL + fOut * this.gFL + nOutL * this.gNL + xOut * this.gXL + cl * this.gCL + mL * this.gM) * og;
      const oR = (tOut * this.gTR + fOut * this.gFR + nOutR * this.gNR + xOut * this.gXR + cl * this.gCR + mR * this.gM) * og;
      unchecked(vbufL[i] += oL); unchecked(vbufR[i] += oR);

      // release / choke ramps
      if (this.released) this.relG *= this.relCoef;
      if (this.choking) { this.chokeG -= this.chokeStep; if (this.chokeG <= 0.0) { this.chokeG = 0.0; this.active = false; } }
    }
    this.age += m;

    // ---- liveness ------------------------------------------------------------------------------
    if (this.age > 48) {
      let tot: f32 = 0.0;
      if (this.onT) tot += this.eT;
      if (this.onF) tot += this.eF;
      if (this.onN) tot += this.eN + this.nBe;
      if (this.onX) tot += this.eX;
      if (this.onM) tot += this.mEnvF;
      if (this.cActive) tot += 1.0;
      if (this.nGate == 1 && this.nBurstI < this.nBurstN - 1) tot += 1.0;
      // a long fade-in (swells, reverse hits) is silent at first but not finished
      let att: f32 = 0.0;
      if (this.onT) att = maxf(att, this.p[P_T_ATT]);
      if (this.onF) att = maxf(att, this.p[P_F_ATT]);
      if (this.onN) att = maxf(att, this.p[P_N_ATT]);
      if (this.onX) att = maxf(att, this.p[P_X_ATT]);
      if (f32(this.age) * invSR < att * <f32>0.0015) tot += 1.0;
      if (tot < 0.00003 || this.relG < 0.00003) this.active = false;
    }
  }

  beginRelease(ms: f32): void {
    if (this.released) return;
    this.released = true;
    this.relCoef = Mathf.exp(-LN10_60 / maxf(<f32>8.0, ms * <f32>0.001 * SR));
  }
  beginChoke(): void {
    if (this.choking) return;
    this.choking = true;
    this.chokeStep = <f32>1.0 / (<f32>0.004 * SR);
  }
}
