// =====================================================================
//  voice.ts — one KHEVEREST voice: 3 oscillators (+FM, ring mod, noise) →
//  pre-filter overdrive → 12/24 dB LP/BP/HP → post-filter drive → VCA, with
//  3 AHDSR envelopes (hold + repeats), 2 per-voice LFOs (fade modes, slew,
//  phase, repeats, common sync) and the 16-slot / 2-source modulation matrix.
//  Control rate = TICK samples; audio-rate quantities ramp linearly per tick.
// =====================================================================

// matrix sources (manual p.39) ------------------------------------------
const NSRC: i32 = 23;
const S_DIRECT: i32 = 0; const S_MOD: i32 = 1; const S_AT: i32 = 2; const S_EX1: i32 = 3; const S_EX2: i32 = 4;
const S_VEL: i32 = 5; const S_KEY: i32 = 6; const S_L1P: i32 = 7; const S_L1B: i32 = 8; const S_L2P: i32 = 9;
const S_L2B: i32 = 10; const S_AENV: i32 = 11; const S_M1: i32 = 12; const S_M2: i32 = 13; const S_AN1: i32 = 14;
const S_AN2: i32 = 15; const S_CV: i32 = 16; const S_L3P: i32 = 17; const S_L3B: i32 = 18; const S_L4P: i32 = 19;
const S_L4B: i32 = 20; const S_BP: i32 = 21; const S_BN: i32 = 22;
// matrix destinations (manual p.39) --------------------------------------
const NDST: i32 = 37;
const D_PITCH: i32 = 0;  const D_O1P: i32 = 1;  const D_VS1: i32 = 4;  const D_SH1: i32 = 7;  const D_LV1: i32 = 10;
const D_NOISE: i32 = 13; const D_RING: i32 = 14; const D_VCA: i32 = 15; const D_DRV: i32 = 16; const D_DIST: i32 = 17;
const D_FREQ: i32 = 18;  const D_RES: i32 = 19;  const D_L1R: i32 = 20; const D_L2R: i32 = 21;
const D_AEA: i32 = 22;   const D_AED: i32 = 23;  const D_AER: i32 = 24; const D_M1A: i32 = 25; const D_M1D: i32 = 26;
const D_M1R: i32 = 27;   const D_M2A: i32 = 28;  const D_M2D: i32 = 29; const D_M2R: i32 = 30;
const D_FM12: i32 = 31;  const D_FM23: i32 = 32; const D_FM31: i32 = 33; const D_FMN1: i32 = 34;
const D_O3F: i32 = 35;   const D_NSF: i32 = 36;

// global performance state, written by main.ts each tick --------------------
let gModWheel: f32 = 0.0; let gAT: f32 = 0.0; let gEx1: f32 = 0.0; let gEx2: f32 = 0.0; let gCV: f32 = 0.0;
let gBend: f32 = 0.0; let gAn1: f32 = 0.0; let gAn2: f32 = 0.0; let gL3: f32 = 0.0; let gL4: f32 = 0.0;
const gLfoPh = new StaticArray<f32>(2);      // common-sync LFO phases (LFO 1, 2)
const gLfoSH = new StaticArray<f32>(2);
let gMono: bool = false;                     // mono voice modes active (MonoTrig applies)

// per-tick voice mix buffers
const sumL = new StaticArray<f32>(TICK);
const sumR = new StaticArray<f32>(TICK);

// control-parameter base indices (generated constants + stride layout from params.mjs)
@inline function envP(e: i32, o: i32): i32 { return unchecked(ENV_P0[e]) + o; }
@inline function lfoP(l: i32, o: i32): i32 { return unchecked(LFO_P0[l]) + o; }
@inline function oscP(k: i32, o: i32): i32 { return unchecked(OSC_P0[k]) + o; }

// time maps (seconds) ---------------------------------------------------------
@inline function tAttack(v: f32): f32 { return v <= 0.0 ? <f32>0.0004 : <f32>0.0005 * Mathf.pow(36000.0, v * <f32>0.007874016); }
@inline function tDecay(v: f32): f32 { return <f32>0.003 * Mathf.pow(7300.0, v * <f32>0.007874016); }
@inline function tRelease(v: f32): f32 { return <f32>0.003 * Mathf.pow(8000.0, v * <f32>0.007874016); }
// pitch-depth taper: ±63 → ±60 semitones, ≈1 st at 8 (manual p.18)
@inline function pitchDepth(v: f32): f32 { const a = v < 0.0 ? -v : v; const r = <f32>0.1114 * a + <f32>2.119e-4 * a * a * a; return v < 0.0 ? -r : r; }

// drives ------------------------------------------------------------------------
@inline function satOD(x: f32, amt: f32): f32 {            // pre-filter overdrive (gradual onset, level-matched)
  if (amt < 0.002) return x;
  const g: f32 = <f32>1.0 + <f32>14.0 * amt * amt;
  return <f32>0.4 * softclip(x * g * <f32>2.5);
}
@inline function satPost(x: f32, amt: f32): f32 {          // post-filter, asymmetric
  if (amt < 0.002) return x;
  const g: f32 = <f32>1.0 + <f32>9.0 * amt * amt;
  const b: f32 = <f32>0.1 * amt;
  return <f32>0.4 * (softclip((x + b) * g * <f32>2.5) - softclip(b * g * <f32>2.5));
}

class Voice {
  active: bool = false; gate: bool = false;
  note: i32 = -1; grp: i32 = 0; age: i32 = 0; uIdx: i32 = 0; uCnt: i32 = 1;
  pan: f32 = 0.0; uniCents: f32 = 0.0;
  vel: f32 = 1.0; keyPos: f32 = 0.0;
  tgtSt: f32 = 60.0; curSt: f32 = 60.0; glideRate: f32 = 0.0; glideLeft: f32 = 0.0; fixedBase: f32 = 60.0;
  o1: Osc = new Osc(); o2: Osc = new Osc(); o3: Osc = new Osc();
  l1: f32 = 0.0; l2: f32 = 0.0; l3: f32 = 0.0;                 // last oscillator outputs (FM)
  div1: f32 = 0.0; div2: f32 = 0.0; div3: f32 = 0.0; filtDiv: f32 = 0.0;
  dr1: f32 = 0.0; dr2: f32 = 0.0; dr3: f32 = 0.0; drT1: f32 = 0.0; drT2: f32 = 0.0; drT3: f32 = 0.0;
  nzs: f32 = 0.0;
  f1: Svf = new Svf(); f2: Svf = new Svf();
  pdx: f32 = 0.0; pdy: f32 = 0.0;                              // post-drive DC blocker
  eStage: StaticArray<i32> = new StaticArray<i32>(3);
  eLvl: StaticArray<f32> = new StaticArray<f32>(3);
  eTimer: StaticArray<f32> = new StaticArray<f32>(3);
  eReps: StaticArray<i32> = new StaticArray<i32>(3);
  eVelS: StaticArray<f32> = new StaticArray<f32>(3);
  eOut: StaticArray<f32> = new StaticArray<f32>(3);
  lPh: StaticArray<f32> = new StaticArray<f32>(2);
  lRaw: StaticArray<f32> = new StaticArray<f32>(2);
  lVal: StaticArray<f32> = new StaticArray<f32>(2);
  lSH: StaticArray<f32> = new StaticArray<f32>(2);
  lAge: StaticArray<f32> = new StaticArray<f32>(2);
  lCyc: StaticArray<i32> = new StaticArray<i32>(2);
  lDone: StaticArray<i32> = new StaticArray<i32>(2);
  acc: StaticArray<f32> = new StaticArray<f32>(37);
  src: StaticArray<f32> = new StaticArray<f32>(23);
  // ramped audio-rate state (value reached at the end of the previous tick)
  pInc: StaticArray<f32> = new StaticArray<f32>(3);
  pShp: StaticArray<f32> = new StaticArray<f32>(3);
  pLvl: StaticArray<f32> = new StaticArray<f32>(5);
  pG: f32 = 0.1; pAmp: f32 = 0.0; pPanL: f32 = 1.0; pPanR: f32 = 1.0;
  fresh: bool = true;

  // ---------------------------------------------------------------- lifecycle
  init(seed: i32): void {
    this.div1 = white(); this.div2 = white(); this.div3 = white(); this.filtDiv = white();
    this.drT1 = white(); this.drT2 = white(); this.drT3 = white();
    this.lPh[0] = rand01(); this.lPh[1] = rand01();
    this.reset();
  }
  reset(): void {
    this.active = false; this.gate = false; this.note = -1;
    this.o1.reset(); this.o2.reset(); this.o3.reset();
    this.l1 = 0.0; this.l2 = 0.0; this.l3 = 0.0; this.nzs = 0.0;
    this.f1.reset(); this.f2.reset(); this.pdx = 0.0; this.pdy = 0.0;
    for (let e = 0; e < 3; e++) { this.eStage[e] = 0; this.eLvl[e] = 0.0; this.eTimer[e] = 0.0; this.eReps[e] = 0; this.eVelS[e] = 1.0; this.eOut[e] = 0.0; }
    for (let l = 0; l < 2; l++) { this.lRaw[l] = 0.0; this.lVal[l] = 0.0; this.lSH[l] = 0.0; this.lAge[l] = 0.0; this.lCyc[l] = 0; this.lDone[l] = 0; }
    for (let i = 0; i < NDST; i++) this.acc[i] = 0.0;
    this.fresh = true;
  }
  startEnv(e: i32): void {
    this.eStage[e] = 1; this.eTimer[e] = 0.0;
    const r = pi(envP(e, 7));
    this.eReps[e] = r;               // 0 off, 1..30 count, 31 loop
  }
  // key-on. legato = a mono-mode note played while another key is down: only the
  // envelopes / LFOs set to Re-Trig restart (manual p.23)
  trigger(note: i32, st: f32, vel: f32, legato: bool, glideFrom: f32, glide: bool, uIdx: i32, uCnt: i32, grp: i32): void {
    if (!this.active) this.fresh2 = true;
    this.note = note; this.grp = grp; this.uIdx = uIdx; this.uCnt = uCnt; this.age = 0;
    this.vel = vel; this.keyPos = clampf((st - <f32>60.0) * <f32>0.0166667, -1.0, 1.0);
    this.tgtSt = st;
    if (glide) {
      const T = <f32>0.005 * Mathf.pow(2400.0, pn(P_GLIDE));
      this.curSt = glideFrom;
      const pg = pi(P_PREGLIDE);
      if (pg != 0) this.curSt = st + f32(pg);
      this.glideLeft = T; this.glideRate = (st - this.curSt) / T;
    } else { this.curSt = st; this.glideLeft = 0.0; }
    // unison detune / pan
    if (uCnt > 1) {
      const half = f32(uCnt - 1) * <f32>0.5;
      this.uniCents = ((f32(uIdx) - half) / half) * pn(P_UNIDET) * <f32>60.0;
    } else this.uniCents = 0.0;
    const sp = pn(P_UNISPR);
    const sgn: f32 = (uCnt > 1 ? (uIdx & 1) : (grp & 1)) == 0 ? <f32>-1.0 : <f32>1.0;
    const mag: f32 = uCnt > 1 ? f32((uIdx >> 1) + 1) / f32((uCnt + 1) >> 1) : <f32>1.0;
    this.pan = sgn * mag * sp;
    // velocity scaling per envelope
    const vs = clampf(vel, 0.0, 1.0);
    for (let e = 0; e < 3; e++) {
      const a = pv(envP(e, 4)) * <f32>0.015625;
      this.eVelS[e] = a >= 0.0 ? <f32>1.0 - a + a * vs : <f32>1.0 + a + (-a) * (<f32>1.0 - vs);
    }
    if (pi(P_KEYSYNC) != 0) { this.o1.ph = 0.0; this.o2.ph = 0.0; this.o3.ph = 0.0; this.o1.vph = 0.0; this.o2.vph = 0.0; this.o3.vph = 0.0; }
    for (let e = 0; e < 3; e++) if (!legato || pi(envP(e, 5)) == 1) this.startEnv(e);
    for (let l = 0; l < 2; l++) {
      // MonoTrig: does a legato note restart the LFO phase? FadeSync: does it restart the fade?
      if (!legato || pi(lfoP(l, 8)) == 1) {
        const ph = pi(lfoP(l, 7));
        if (ph > 0) this.lPh[l] = f32(ph - 1) * <f32>6.0 / <f32>360.0;
        this.lCyc[l] = 0; this.lDone[l] = 0; this.lSH[l] = white();
      }
      if (!legato || pi(lfoP(l, 6)) == 1) this.lAge[l] = 0.0;
    }
    this.active = true; this.gate = true; this.fresh = false;
  }
  release(): void {
    this.gate = false;
    for (let e = 0; e < 3; e++) if (this.eStage[e] != 0) this.eStage[e] = 5;
  }

  // ---------------------------------------------------------------- envelopes
  envTick(e: i32, dt: f32): void {
    const st = this.eStage[e];
    if (st == 0) { this.eOut[e] = 0.0; return; }
    const modA = e == 0 ? unchecked(this.acc[D_AEA]) : unchecked(this.acc[D_M1A + (e - 1) * 3]);
    const modD = e == 0 ? unchecked(this.acc[D_AED]) : unchecked(this.acc[D_M1D + (e - 1) * 3]);
    const modR = e == 0 ? unchecked(this.acc[D_AER]) : unchecked(this.acc[D_M1R + (e - 1) * 3]);
    let lvl = this.eLvl[e];
    const sus = clampf(pn127(envP(e, 2)), 0.0, 1.0);
    if (st == 1) {
      const Ta = tAttack(clampf(pv(envP(e, 0)) + modA * <f32>64.0, 0.0, 127.0));
      lvl += dt / Ta;
      if (lvl >= 1.0) { lvl = 1.0; const th = pn127(envP(e, 6)) * <f32>0.5; this.eStage[e] = th > 0.0005 ? 2 : 3; this.eTimer[e] = 0.0; }
    } else if (st == 2) {
      this.eTimer[e] += dt;
      if (this.eTimer[e] >= pn127(envP(e, 6)) * <f32>0.5) { this.eStage[e] = 3; this.eTimer[e] = 0.0; }
    } else if (st == 3) {
      const Td = tDecay(clampf(pv(envP(e, 1)) + modD * <f32>64.0, 0.0, 127.0));
      this.eTimer[e] += dt;
      lvl = sus + (lvl - sus) * Mathf.exp(-dt * <f32>4.6 / Td);
      if (this.eTimer[e] >= Td) {
        const r = this.eReps[e];
        if (r == 31 || r > 0) { if (r != 31) this.eReps[e] = r - 1; this.eStage[e] = 1; this.eTimer[e] = 0.0; }
        else { this.eStage[e] = 4; }
      }
    } else if (st == 4) {
      lvl = sus;
    } else {
      const Tr = tRelease(clampf(pv(envP(e, 3)) + modR * <f32>64.0, 0.0, 127.0));
      lvl *= Mathf.exp(-dt * <f32>5.0 / Tr);
      if (lvl < 0.0001) { lvl = 0.0; this.eStage[e] = 0; }
    }
    this.eLvl[e] = lvl;
    this.eOut[e] = lvl * this.eVelS[e];
  }

  // ---------------------------------------------------------------- LFOs
  lfoWave(t: i32, ph: f32, sh: f32): f32 {
    if (t == 0) return ph < 0.25 ? <f32>4.0 * ph : (ph < 0.75 ? <f32>2.0 - <f32>4.0 * ph : <f32>4.0 * ph - <f32>4.0);
    if (t == 1) return <f32>1.0 - <f32>2.0 * ph;
    if (t == 2) return ph < 0.5 ? <f32>1.0 : <f32>-1.0;
    return sh;
  }
  lfoTick(l: i32, dt: f32): void {
    const b = lfoP(l, 0);
    const common = pi(b + 11) != 0;
    const typ = pi(b + 0);
    const range = pi(b + 1);
    let f: f32;
    const n = pn(b + 2);
    if (range == 0) f = <f32>0.02 * Mathf.pow(10000.0, n);
    else if (range == 1) f = <f32>0.2 * Mathf.pow(8000.0, n);
    else {
      const bpm = tempoBpm();
      const ticks = unchecked(LFO_TICKS[pi(b + 3)]);
      f = bpm / <f32>60.0 / (ticks / <f32>24.0);
    }
    f *= exp2f(unchecked(this.acc[D_L1R + l]) * <f32>4.0);
    let raw: f32;
    if (common) {
      this.lPh[l] = gLfoPh[l]; raw = this.lfoWave(typ, gLfoPh[l], gLfoSH[l]);
    } else {
      let ph = this.lPh[l] + f * dt;
      if (ph >= 1.0) {
        ph -= Mathf.floor(ph);
        this.lSH[l] = white(); this.lCyc[l] += 1;
        const rep = pi(b + 10);
        if (rep > 0 && rep < 31 && this.lCyc[l] >= rep) this.lDone[l] = 1;
      }
      this.lPh[l] = ph;
      raw = this.lfoWave(typ, ph, this.lSH[l]);
    }
    if (this.lDone[l] != 0) raw = 0.0;
    // slew
    const sl = pn127(b + 9);
    if (sl > 0.001) {
      const tau = (<f32>0.5 / (f > 0.01 ? f : <f32>0.01)) * sl * sl + <f32>0.0005;
      this.lRaw[l] += (raw - this.lRaw[l]) * (<f32>1.0 - Mathf.exp(-dt / tau));
      raw = this.lRaw[l];
    } else this.lRaw[l] = raw;
    // fade
    this.lAge[l] += dt;
    const ft = pv(b + 4);
    let fade: f32 = 1.0;
    if (ft > 0.0) {
      const T = <f32>0.005 * Mathf.pow(2000.0, ft * <f32>0.007874016);
      const x = clampf(this.lAge[l] / T, 0.0, 1.0);
      const m = pi(b + 5);
      if (m == 0) fade = x; else if (m == 1) fade = <f32>1.0 - x;
      else if (m == 2) fade = x >= 1.0 ? <f32>1.0 : <f32>0.0; else fade = x >= 1.0 ? <f32>0.0 : <f32>1.0;
    }
    this.lVal[l] = raw * fade;
  }

  // free-running LFOs keep running while the voice is idle (manual p.20: 'in the background')
  idleLfo(dt: f32): void {
    for (let l = 0; l < 2; l++) {
      if (pi(lfoP(l, 7)) != 0 || pi(lfoP(l, 11)) != 0) continue;
      let ph = this.lPh[l] + lfoFreqV(l) * dt;
      if (ph >= 1.0) { ph -= Mathf.floor(ph); this.lSH[l] = white(); }
      this.lPh[l] = ph;
    }
  }

  // ---------------------------------------------------------------- one tick
  // renders TICK samples into sumL/sumR (accumulating)
  tick(dt: f32): void {
    const A_ = this.acc;
    // --- envelopes & LFOs (use last tick's accumulators for time / rate modulation)
    this.envTick(0, dt); this.envTick(1, dt); this.envTick(2, dt);
    this.lfoTick(0, dt); this.lfoTick(1, dt);
    if (!this.gate && this.eStage[0] == 0) { this.active = false; return; }
    this.age += 1;
    // --- glide
    if (this.glideLeft > 0.0) {
      const s = minf(dt, this.glideLeft);
      this.curSt += this.glideRate * s; this.glideLeft -= s;
      if (this.glideLeft <= 0.0) this.curSt = this.tgtSt;
    }
    // --- drift random walk (very slow)
    const dr = pn(P_DRIFT);
    if (dr > 0.0) {
      if (rand01() < dt * <f32>0.6) { this.drT1 = white(); }
      if (rand01() < dt * <f32>0.6) { this.drT2 = white(); }
      if (rand01() < dt * <f32>0.6) { this.drT3 = white(); }
      const k = dt * <f32>1.5;
      this.dr1 += (this.drT1 - this.dr1) * k; this.dr2 += (this.drT2 - this.dr2) * k; this.dr3 += (this.drT3 - this.dr3) * k;
    }
    // --- sources
    const s = this.src;
    const l1 = this.lVal[0], l2 = this.lVal[1];
    s[S_DIRECT] = 1.0; s[S_MOD] = gModWheel; s[S_AT] = gAT; s[S_EX1] = gEx1; s[S_EX2] = gEx2;
    s[S_VEL] = this.vel; s[S_KEY] = this.keyPos;
    s[S_L1P] = (l1 + <f32>1.0) * <f32>0.5; s[S_L1B] = l1; s[S_L2P] = (l2 + <f32>1.0) * <f32>0.5; s[S_L2B] = l2;
    s[S_AENV] = this.eOut[0]; s[S_M1] = this.eOut[1]; s[S_M2] = this.eOut[2];
    s[S_AN1] = gAn1; s[S_AN2] = gAn2; s[S_CV] = gCV;
    s[S_L3P] = (gL3 + <f32>1.0) * <f32>0.5; s[S_L3B] = gL3; s[S_L4P] = (gL4 + <f32>1.0) * <f32>0.5; s[S_L4B] = gL4;
    s[S_BP] = gBend; s[S_BN] = -gBend;
    // --- matrix → accumulators
    for (let i = 0; i < NDST; i++) unchecked(A_[i] = 0.0);
    for (let m = 0; m < 16; m++) {
      const b = MM_P0 + m * 4;
      const depth = unchecked(A[b + 3]);
      if (depth == 0.0) continue;
      const d = unchecked(AI[b + 2]);
      unchecked(A_[d] += unchecked(s[unchecked(AI[b])]) * unchecked(s[unchecked(AI[b + 1])]) * depth * <f32>0.015625);
    }
    // --- oscillator targets
    const e1 = this.eOut[1], e2 = this.eOut[2];
    const bendNow = gBend;
    const tune = pv(P_TUNECENTS) * <f32>0.01;
    const divn = pn(P_DIVERGE) * <f32>0.12, drn = dr * <f32>0.3;
    const baseSt: f32 = this.curSt;
    for (let k = 0; k < 3; k++) {
      const b = oscP(k, 0);
      const octR = pi(b + 0) - 1;                   // 16' = -1 octave … 2' = +2
      let st: f32 = pi(b + 14) > 0 ? f32(pi(b + 14)) : baseSt;
      st += f32(octR) * <f32>12.0 + pv(b + 1) + pv(b + 2) * <f32>0.01 + tune + this.uniCents * <f32>0.01;
      st += pv(b + 15) * bendNow;
      st += (k == 0 ? this.div1 : (k == 1 ? this.div2 : this.div3)) * divn;
      st += (k == 0 ? this.dr1 : (k == 1 ? this.dr2 : this.dr3)) * drn;
      st += (A_[D_PITCH] + A_[D_O1P + k]) * <f32>60.0;
      st += pitchDepth(pv(b + 5)) * e2;
      st += pitchDepth(pv(b + 6) * <f32>0.496063) * l2;
      let hz: f32 = <f32>440.0 * exp2f((st - <f32>69.0) * <f32>0.083333333);
      let inc = hz * invSR;
      if (inc > 0.45) inc = 0.45;
      if (inc < 0.000001) inc = 0.000001;
      const ns: f32 = clampf(pb(b + 8) + pb(b + 9) * e1 + pb(b + 10) * l1 + A_[D_SH1 + k], -1.0, 1.0);
      unchecked(this.tInc[k] = inc); unchecked(this.tShp[k] = ns);
    }
    // levels
    this.tLvl[0] = clampf(pn(P_MIX1) + A_[D_LV1], 0.0, 1.0);
    this.tLvl[1] = clampf(pn(P_MIX2) + A_[D_LV1 + 1], 0.0, 1.0);
    this.tLvl[2] = clampf(pn(P_MIX3) + A_[D_LV1 + 2], 0.0, 1.0);
    this.tLvl[3] = clampf(pn(P_MIXR) + A_[D_RING], 0.0, 1.0);
    this.tLvl[4] = clampf(pn(P_MIXN) + A_[D_NOISE], 0.0, 1.0);
    // filter
    let oct: f32 = pn127(P_F_KEY) * (baseSt - <f32>60.0) * <f32>0.083333333;
    oct += pb(P_F_ENVAMP) * this.eOut[0] * <f32>8.0 + pb(P_F_ENVMOD) * e1 * <f32>8.0;
    oct += pb127(P_F_LFO1) * l1 * <f32>8.0 + A_[D_FREQ] * <f32>8.0 + this.filtDiv * pn(P_F_DIV) * <f32>0.3;
    const fHz: f32 = <f32>20.0 * Mathf.pow(1000.0, pn(P_F_FREQ)) * exp2f(oct);
    const gT = Mathf.tan(PI * clampf(fHz, 10.0, SR * <f32>0.45) * invSR);
    const res = clampf(pn(P_F_RES) + A_[D_RES], 0.0, 1.0);
    this.tK = <f32>1.45 * Mathf.pow(<f32>1.0 - res, 1.3) + <f32>0.002;
    // amp
    const vcaG = pn(P_VCAGAIN);
    let ampG = this.eOut[0] + A_[D_VCA];
    if (ampG < 0.0) ampG = 0.0;
    const pan = clampf(this.pan, -1.0, 1.0);
    const panL = Mathf.cos((pan + <f32>1.0) * <f32>0.7853982) * <f32>1.4142135;
    const panR = Mathf.sin((pan + <f32>1.0) * <f32>0.7853982) * <f32>1.4142135;
    if (this.fresh2) {
      for (let k = 0; k < 3; k++) { this.pInc[k] = this.tInc[k]; this.pShp[k] = this.tShp[k]; }
      for (let i = 0; i < 5; i++) this.pLvl[i] = this.tLvl[i];
      this.pG = gT; this.pAmp = ampG; this.pPanL = panL; this.pPanR = panR; this.fresh2 = false;
    }
    // --- render
    const w1 = pi(oscP(0, 3)), w2 = pi(oscP(1, 3)), w3 = pi(oscP(2, 3));
    const wt1 = pi(oscP(0, 4)), wt2 = pi(oscP(1, 4)), wt3 = pi(oscP(2, 4));
    if (w1 == 4 && wtBuilt[wt1] == 0) buildWT(wt1);
    if (w2 == 4 && wtBuilt[wt2] == 0) buildWT(wt2);
    if (w3 == 4 && wtBuilt[wt3] == 0) buildWT(wt3);
    const vs1 = clampf(pv(oscP(0, 11)) + A_[D_VS1] * <f32>127.0, 0.0, 127.0);
    const vs2 = clampf(pv(oscP(1, 11)) + A_[D_VS1 + 1] * <f32>127.0, 0.0, 127.0);
    const vs3 = clampf(pv(oscP(2, 11)) + A_[D_VS1 + 2] * <f32>127.0, 0.0, 127.0);
    const vr1: f32 = <f32>1.0 + vs1 * <f32>0.0625, vr2: f32 = <f32>1.0 + vs2 * <f32>0.0625, vr3: f32 = <f32>1.0 + vs3 * <f32>0.0625;
    const de1 = pn(oscP(0, 12)), de2 = pn(oscP(1, 12)), de3 = pn(oscP(2, 12));
    const dd1 = pn(oscP(0, 13)) * <f32>0.012, dd2 = pn(oscP(1, 13)) * <f32>0.012, dd3 = pn(oscP(2, 13)) * <f32>0.012;
    const fm12 = maxf(0.0, A_[D_FM12]) * <f32>3.0, fm23 = maxf(0.0, A_[D_FM23]) * <f32>3.0;
    const fm31 = maxf(0.0, A_[D_FM31]) * <f32>3.0, fmn1 = maxf(0.0, A_[D_FMN1]) * <f32>3.0;
    const o3f = (pn127(P_F_OSC3) + maxf(0.0, A_[D_O3F])) * <f32>4.0, nsf = maxf(0.0, A_[D_NSF]) * <f32>4.0;
    const od = clampf(pn127(P_F_OD) + A_[D_DRV], 0.0, 1.0);
    const post = clampf(pn(P_F_POST) + A_[D_DIST], 0.0, 1.0);
    const slope24 = pi(P_F_SLOPE) == 1;
    const shape = pi(P_F_SHAPE);
    const nzA = onePoleA(<f32>60.0 * Mathf.pow(300.0, pn(P_NOISELPF)));
    const k2 = this.tK;
    const audioMod = o3f > 0.0 || nsf > 0.0;
    const inv: f32 = <f32>1.0 / f32(TICK);
    let mip1: i32 = 0, mip2: i32 = 0, mip3: i32 = 0;
    // per-sample ramps
    let i1 = this.pInc[0], i2 = this.pInc[1], i3 = this.pInc[2];
    const di1 = (this.tInc[0] - i1) * inv, di2 = (this.tInc[1] - i2) * inv, di3 = (this.tInc[2] - i3) * inv;
    let s1 = this.pShp[0], s2 = this.pShp[1], s3 = this.pShp[2];
    const ds1 = (this.tShp[0] - s1) * inv, ds2 = (this.tShp[1] - s2) * inv, ds3 = (this.tShp[2] - s3) * inv;
    let a1 = this.pLvl[0], a2 = this.pLvl[1], a3 = this.pLvl[2], ar = this.pLvl[3], an = this.pLvl[4];
    const da1 = (this.tLvl[0] - a1) * inv, da2 = (this.tLvl[1] - a2) * inv, da3 = (this.tLvl[2] - a3) * inv;
    const dar = (this.tLvl[3] - ar) * inv, dan = (this.tLvl[4] - an) * inv;
    let g = this.pG; const dg = (gT - g) * inv;
    let amp = this.pAmp; const dam = (ampG - amp) * inv;
    let pl = this.pPanL, pr = this.pPanR;
    const dpl = (panL - pl) * inv, dpr = (panR - pr) * inv;
    const mixScale: f32 = <f32>0.4 * vcaG;
    for (let n = 0; n < TICK; n++) {
      i1 += di1; i2 += di2; i3 += di3; s1 += ds1; s2 += ds2; s3 += ds3;
      a1 += da1; a2 += da2; a3 += da3; ar += dar; an += dan; g += dg; amp += dam; pl += dpl; pr += dpr;
      const w = white();
      let e1i = i1, e2i = i2, e3i = i3;
      if (fm31 > 0.0 || fmn1 > 0.0) e1i = i1 * exp2f(fm31 * this.l3 + fmn1 * w);
      if (fm12 > 0.0) e2i = i2 * exp2f(fm12 * this.l1);
      if (fm23 > 0.0) e3i = i3 * exp2f(fm23 * this.l2);
      if ((n & 3) == 0) { mip1 = wtMip(e1i * vr1); mip2 = wtMip(e2i * vr2); mip3 = wtMip(e3i * vr3); }
      const y1 = this.o1.sample(e1i, w1, s1, wt1, mip1, vr1, de1, dd1);
      const y2 = this.o2.sample(e2i, w2, s2, wt2, mip2, vr2, de2, dd2);
      const y3 = this.o3.sample(e3i, w3, s3, wt3, mip3, vr3, de3, dd3);
      this.l1 = y1; this.l2 = y2; this.l3 = y3;
      this.nzs += nzA * (w - this.nzs);
      let x = (y1 * a1 + y2 * a2 + y3 * a3 + y1 * y2 * ar * <f32>1.5 + this.nzs * an * <f32>1.4) * mixScale;
      x = satOD(x, od);
      let gg = g;
      if (audioMod) gg = g * exp2f(o3f * y3 + nsf * w);
      if (gg > 12.0) gg = 12.0;
      let y: f32;
      if (slope24) {
        this.f1.tick(x, gg, <f32>1.41);
        let m1: f32 = shape == 0 ? this.f1.lp : (shape == 1 ? this.f1.bp * <f32>1.41 : this.f1.hp);
        this.f2.tick(m1, gg, k2);
        y = shape == 0 ? this.f2.lp : (shape == 1 ? this.f2.bp * k2 : this.f2.hp);
      } else {
        this.f1.tick(x, gg, k2 + <f32>0.0);
        y = shape == 0 ? this.f1.lp : (shape == 1 ? this.f1.bp * k2 : this.f1.hp);
      }
      if (post > 0.002) y = satPost(y, post);
      { const dcy = y - this.pdx + <f32>0.9993 * this.pdy; this.pdx = y; this.pdy = denorm(dcy); y = dcy; }   // AC coupling (sync/pulse DC)
      y = finite(y) * amp;
      unchecked(sumL[n] += y * pl);
      unchecked(sumR[n] += y * pr);
    }
    for (let k = 0; k < 3; k++) { this.pInc[k] = this.tInc[k]; this.pShp[k] = this.tShp[k]; }
    for (let i = 0; i < 5; i++) this.pLvl[i] = this.tLvl[i];
    this.pG = gT; this.pAmp = ampG; this.pPanL = panL; this.pPanR = panR;
  }
  tInc: StaticArray<f32> = new StaticArray<f32>(3);
  tShp: StaticArray<f32> = new StaticArray<f32>(3);
  tLvl: StaticArray<f32> = new StaticArray<f32>(5);
  tK: f32 = 1.0;
  fresh2: bool = true;
}
