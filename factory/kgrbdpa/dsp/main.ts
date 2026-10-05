// =====================================================================
//  main.ts — KGrbdPa engine glue: the patch-bay evaluator (every jack carries
//  volts; each input jack reads the output cabled to it, or its normalled
//  connection), the per-sample signal chain
//      keyboard / arp / seq → mod LFO → envelope → VCO 1 / VCO 2 (sync, lin FM)
//      → mixer → ladder → VCA → spring reverb → volume
//  plus utilities (HP filter, bipolar attenuator, mult), MIDI CC map and the ABI
//  exports (see src/WasmAbi.h).
//
//  Evaluation order is fixed; an input that is cabled to a module evaluated LATER
//  in the same sample sees that module's previous sample (one-sample delay), so any
//  feedback patch is stable and deterministic.
// =====================================================================

const S = new StaticArray<f32>(NSRC + 1);
const SEL = new StaticArray<i32>(NDST);
@inline function inp(d: i32, dflt: f32): f32 {
  const s = unchecked(SEL[d]);
  return s == 0 ? dflt : unchecked(S[s]);
}

const osc1 = new GOsc();
const osc2 = new GOsc();
const lfo = new Lfo();
const env = new Env();
const lad = new Ladder();
const hpf = new Hp1();
const dcF = new Hp1();                      // the FILTER OUT / EURORACK OUT jacks are AC coupled (manual p.40-42)
const dcE = new Hp1();
let dcG: f32 = 0.0005;
const tank = new SpringTank();
const upA = new HbUp(); const upB = new HbUp(); const upX = new HbUp(); const upN = new HbUp(); const upF = new HbUp();
const dnM = new HbDown(); const dnF = new HbDown();

// derived / smoothed controls ---------------------------------------------------------------
let smCut: f32 = 5.0; let tCut: f32 = 5.0;
let smRes: f32 = 0.0; let tRes: f32 = 0.0;
let smO1: f32 = 0.0; let tO1: f32 = 0.0;
let smO2: f32 = 0.0; let tO2: f32 = 0.0;
let smNz: f32 = 0.0; let tNz: f32 = 0.0;
let smVol: f32 = 0.0; let tVol: f32 = 0.0;
let smRev: f32 = 0.0; let tRev: f32 = 0.0;
let smO2F: f32 = 0.0; let tO2F: f32 = 0.0;
let smEnvAmt: f32 = 0.0; let tEnvAmt: f32 = 0.0;
let smAtt: f32 = 0.0; let tAtt: f32 = 0.0;
let smCoef: f32 = 0.01;
let envA: f32 = 0.01; let envD: f32 = 0.1; let envS: f32 = 0.5; let envR: f32 = 0.1;
let lfoBaseOct: f32 = 0.0;
let hpG: f32 = 0.01;
let kbrGain: f32 = 0.0;
let kbrCoef: f32 = 0.999;
let drift1: f32 = 0.0; let drift2: f32 = 0.0;
let driftA: f32 = 0.0; let driftScale: f32 = 0.0;
let lfoSyncPrev: bool = false;
let ccBend: f32 = 0.0;
let glideEnabled: bool = true;
let rpnSel: i32 = 16383;
let rpnMsb: i32 = 127; let rpnLsb: i32 = 127;
const ccMsb = new StaticArray<i32>(128);
let peakOut: f32 = 0.0;
let lastEnv: f32 = 0.0;
let lastCutHz: f32 = 0.0;
const ENV_OCT: f32 = 7.0;                  // full ENVELOPE AMT sweeps 7 octaves of cutoff
const FM_HZ_PER_V: f32 = 120.0;            // OSC 2 LIN FM IN sensitivity

export function transport(playing: i32, ppq: f64, bpm: f32): void { setHostTransport(playing, ppq, bpm); kPpqAcc = ppq; }
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
// test/diagnostic: decoded actual value of logical parameter i
export function paramValue(i: i32): f32 { return i >= 0 && i < NP ? A[i] : <f32>0.0; }
// test/diagnostic: sequencer memory + a few internals
export function dbgSeqLen(s: i32): i32 { return seqLen[s]; }
export function dbgSeqNote(s: i32, i: i32): i32 { return seqNote[s * SEQ_N + i]; }
export function dbgSeqFlag(s: i32, i: i32): i32 { return seqFlag[s * SEQ_N + i]; }
export function dbgSrc(i: i32): f32 { return S[i]; }
export function dbgState(i: i32): f32 {
  if (i == 0) return kRunArp ? <f32>1.0 : <f32>0.0;
  if (i == 1) return kRunSeq ? <f32>1.0 : <f32>0.0;
  if (i == 2) return f32(kSeqCur);
  if (i == 3) return kCur;
  if (i == 4) return f32(hN);
  if (i == 5) return kStepSec;
  if (i == 6) return kGateOut ? <f32>1.0 : <f32>0.0;
  if (i == 7) return lastCutHz;
  if (i == 8) return recArmed ? <f32>1.0 : <f32>0.0;
  return 0.0;
}

// ---------------------------------------------------------------------------- init
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  SR = sr > 0.0 ? sr : <f32>48000.0; invSR = <f32>1.0 / SR;
  rng = 0x9e3779b9;
  initSin(); initBlep(); initHalfband();
  for (let i = 0; i < MAX_PARAMS; i++) { params[i] = 0.0; slotCache[i] = -1.0; }
  for (let i = 0; i < NP; i++) { A[i] = 0.0; An[i] = 0.0; AI[i] = 0; RH[i] = -1; AH[i] = -1.0e9; }
  setDefaults();
  refreshParams();
  for (let i = 0; i < NSRC + 1; i++) S[i] = 0.0;
  for (let i = 0; i < MAX_FRAMES * 2; i++) inBuf[i] = 0.0;
  for (let i = 0; i < 128; i++) ccMsb[i] = 0;
  osc1.reset(); osc2.reset(); lfo.reset(); env.reset(); lad.reset(); hpf.s = 0.0; dcF.s = 0.0; dcE.s = 0.0;
  upA.reset(); upB.reset(); upX.reset(); upN.reset(); upF.reset(); dnM.reset(); dnF.reset();
  tank.setup(); tank.reset();
  osc1.ph = 0.0; osc2.ph = 0.37;
  smCoef = <f32>1.0 - Mathf.exp(-<f32>1.0 * invSR / <f32>0.004);
  driftA = onePoleA(0.35);
  driftScale = Mathf.sqrt(<f32>6.0 / driftA);
  drift1 = 0.0; drift2 = 0.0;
  // keyboard / sequencer
  hN = 0; kTarget = 60.0; kCur = 60.0; kGateWant = false; kGateOut = false; kLowT = 1.0; kAccent = 0.0;
  kRunArp = false; kRunSeq = false; kPhase = 1.0; kGateOffArm = false; kArpPos = 0; kSeqPos = 0; kSeqCur = 0; kSeqKey = -1;
  kClkOutPh = 0.0; kClkOut = 0.0; kPpqAcc = 0.0; kHostIdx = -1; kStepFlash = 0.0; kAccentSeq = false;
  recArmed = true; recPendingTie = false; recLast = -1; lastMode = pi(P_ARP_MODE); lastSeqSel = pi(P_OCT_SEQ);
  for (let i = 0; i < 3; i++) seqLen[i] = 0;
  loadDefaultSeqs();
  ccBend = 0.0; glideEnabled = true; rpnSel = 16383; kbrGain = 0.0;
  hostBpm = 0.0; hostPlaying = 0; peakOut = 0.0; lfoSyncPrev = false;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  paramsDirty = true;
  onParams();
  smCut = tCut; smRes = tRes; smO1 = tO1; smO2 = tO2; smNz = tNz; smVol = tVol; smRev = tRev; smO2F = tO2F; smEnvAmt = tEnvAmt; smAtt = tAtt;
}

// ---------------------------------------------------------------------------- parameter-derived values
function onParams(): void {
  paramsDirty = false;
  for (let d = 0; d < NDST; d++) unchecked(SEL[d] = pi(P_PB_O1_PITCH + d));
  tCut = <f32>9.965784 * pv(P_CUTOFF);                   // octaves above 20 Hz: the panel scale is 20 Hz … 20 kHz, three decades
  tRes = <f32>4.5 * pv(P_RESO);
  tO1 = pv(P_MIX_O1) * <f32>1.6667;
  tO2 = pv(P_MIX_O2) * <f32>1.6667;
  tNz = pv(P_MIX_NZ) * <f32>1.6667;
  const v = pv(P_VOLUME);
  tVol = <f32>1.5 * v * v;
  tRev = pv(P_REV_MIX);
  tO2F = pv(P_O2_FREQ);
  tEnvAmt = pv(P_ENV_AMT);
  tAtt = pv(P_ATT);
  envA = <f32>0.0008 * Mathf.pow(<f32>10000.0, pv(P_ATK));      // 0.8 ms … 8 s
  envD = <f32>0.002 * Mathf.pow(<f32>6000.0, pv(P_DEC));        // 2 ms … 12 s
  envS = pv(P_SUS);
  envR = <f32>0.002 * Mathf.pow(<f32>6000.0, pv(P_REL));        // 2 ms … 12 s
  kbrCoef = Mathf.exp(-<f32>4.6 * invSR / envR);
  // LFO: 0.07 Hz … 1.3 kHz = 14.18 octaves
  lfoBaseOct = Mathf.log2(<f32>0.07) + <f32>14.18 * pv(P_MOD_RATE) + pv(P_MOD_FINE) * <f32>0.0833333;
  // HIGH PASS: 10 Hz … 10 kHz
  const hpHz = clampf(<f32>10.0 * exp2f(<f32>10.0 * pv(P_HP_CUT)), 5.0, SR * <f32>0.45);
  hpG = Mathf.tan(PI * hpHz * invSR);
  dcG = Mathf.tan(PI * <f32>4.0 * invSR);
  modeWatch();
  updateRun(false);
}

function loadDefaultSeqs(): void {
  SEQ_DEFAULTS();
}

// ---------------------------------------------------------------------------- MIDI in
function noteFromFreq(freq: f32): i32 {
  const m = i32(nearest<f32>(<f32>69.0 + <f32>12.0 * Mathf.log2(freq / <f32>440.0)));
  return m < 0 ? 0 : (m > 127 ? 127 : m);
}
export function noteOn(id: i32, freq: f32, vel: f32): void {
  refreshParams();
  if (paramsDirty) onParams();
  if (id == -2) { if (pi(P_ARP_MODE) == 2) recordMarker(0); return; }          // REST (HOLD button while recording)
  if (id == -3) { if (pi(P_ARP_MODE) == 2) recordMarker(1); return; }          // TIE  (PLAY button while recording)
  if (id == -4) { if (pi(P_ARP_MODE) == 2) recordMarker(2); return; }          // ACCENT (TAP button while recording)
  if (id == -5) { allNotesOff(); return; }                                      // all three LHC buttons: clear the note stack
  if (id < 0) return;
  let n = noteFromFreq(freq) + pi(P_KB_OCT) * 12 + pi(P_KB_TRANS);
  n = n < 0 ? 0 : (n > 127 ? 127 : n);
  keyOn(id, n, vel);
}
export function noteOff(id: i32): void {
  refreshParams();
  if (paramsDirty) onParams();
  if (id < 0) return;
  keyOff(id);
}
function ccSetN(p: i32, v: f32): void { setParamN(p, v); }
function applyCc(num: i32, value: f32): void {
  const v127: i32 = i32(nearest<f32>(value * <f32>127.0));
  if (num == 1) ccSetN(P_MODW, value);
  else if (num == 3) ccSetN(P_MOD_RATE, value);
  else if (num == 5) ccSetN(P_GLIDE, value);
  else if (num == 8) ccSetN(P_ARP_RATE, value);
  else if (num == 12) ccSetN(P_O2_FREQ, value);
  else if (num == 65) glideEnabled = value >= 0.5;
  else if (num == 69) setParamI(P_HOLD, value >= 0.5 ? 1 : 0);
  else if (num == 73) setParamI(P_PLAY, value >= 0.5 ? 1 : 0);
  else if (num == 74) setParamI(P_O1_OCT, v127 / 32);
  else if (num == 75) setParamI(P_O2_OCT, v127 / 32);
  else if (num == 77) setParamI(P_SYNC, value >= 0.5 ? 1 : 0);
  else if (num == 85) setParamI(P_GL_TYPE, i32(nearest<f32>(f32(v127) / <f32>42.5)));
  else if (num == 89) setParamI(P_KB_OCT, i32(nearest<f32>(f32(v127) / <f32>25.5)) - 2);
  else if (num == 90) {
    let idx = 0;
    for (let i = 0; i < 24; i++) if (v127 >= unchecked(CC90_V[i])) idx = i;
    ccSetN(P_ARP_RATE, (f32(idx) + <f32>0.5) / <f32>24.0);
  }
  else if (num == 91) setParamI(P_ARP_MODE, i32(nearest<f32>(f32(v127) / <f32>42.5)));
  else if (num == 92) setParamI(P_ARP_DIR, i32(nearest<f32>(f32(v127) / <f32>42.5)));
  else if (num == 93) setParamI(P_OCT_SEQ, i32(nearest<f32>(f32(v127) / <f32>42.5)));
  else if (num == 94) setParamI(P_GL_LEGATO, value >= 0.5 ? 1 : 0);
  else if (num == 103) setParamI(P_GL_GATED, value >= 0.5 ? 1 : 0);
  else if (num == 107) setParamI(P_BEND_UP, i32(nearest<f32>(f32(v127) * <f32>24.0 / <f32>123.0)));
  else if (num == 108) setParamI(P_BEND_DN, i32(nearest<f32>(f32(v127) * <f32>24.0 / <f32>123.0)));
  else if (num == 119) setParamI(P_KB_TRANS, i32(nearest<f32>(f32(v127) * <f32>24.0 / <f32>123.0)) - 12);
  else if (num == 122) setParamI(P_LOCAL, value >= 0.5 ? 1 : 0);
  else if (num == 101) { rpnMsb = v127; rpnSel = rpnMsb * 128 + rpnLsb; }
  else if (num == 100) { rpnLsb = v127; rpnSel = rpnMsb * 128 + rpnLsb; }
  else if (num == 6) {
    if (rpnSel == 0) { const b = v127 > 24 ? 24 : v127; setParamI(P_BEND_UP, b); setParamI(P_BEND_DN, b); }
    else if (rpnSel == 1) setParamN(P_FINE, value);
    else if (rpnSel == 2) setParamI(P_KB_TRANS, v127 - 64);
  }
}
export function controlChange(num: i32, value: f32): void {
  refreshParams();
  if (num == 128) { ccBend = value; return; }
  if (num == 129) return;
  if (num == 120 || num == 123) { allNotesOff(); return; }
  // 14-bit pairs: MSB 1/3/5/8/12 with LSB 33/35/37/40/44
  let msbNum = -1;
  if (num == 33) msbNum = 1; else if (num == 35) msbNum = 3; else if (num == 37) msbNum = 5; else if (num == 40) msbNum = 8; else if (num == 44) msbNum = 12;
  if (msbNum >= 0) {
    const lsb: i32 = i32(nearest<f32>(value * <f32>127.0));
    applyCc(msbNum, f32(ccMsb[msbNum] * 128 + lsb) / <f32>16383.0);
  } else {
    if (num < 128) ccMsb[num] = i32(nearest<f32>(value * <f32>127.0));
    applyCc(num, value);
  }
  if (paramsDirty) onParams();
}

// ---------------------------------------------------------------------------- one sample of the instrument
@inline function slew(c: f32, t: f32): f32 { return c + (t - c) * smCoef; }

function renderSample(inL: f32, inR: f32): f32 {
  const local = pi(P_LOCAL) != 0;
  // smoothed knob values
  smCut = slew(smCut, tCut); smRes = slew(smRes, tRes);
  smO1 = slew(smO1, tO1); smO2 = slew(smO2, tO2); smNz = slew(smNz, tNz);
  smVol = slew(smVol, tVol); smRev = slew(smRev, tRev); smO2F = slew(smO2F, tO2F);
  smEnvAmt = slew(smEnvAmt, tEnvAmt); smAtt = slew(smAtt, tAtt);

  // ---- ARP/SEQ module -----------------------------------------------------------------------
  keysTick(invSR);
  if (!glideEnabled) kCur = kTarget;
  const bn = clampf(pv(P_PITCHW) + ccBend, -1.0, 1.0);
  const bendSemi: f32 = bn >= 0.0 ? bn * f32(pi(P_BEND_UP)) : bn * f32(pi(P_BEND_DN));
  const kbV: f32 = (kCur + bendSemi - <f32>60.0) * <f32>0.0833333;
  const kbInt: f32 = local ? kbV : <f32>0.0;
  let kbOut = clampf(kbV, -5.0, 5.0);
  if (pi(P_KB_RANGE) == 1) kbOut = clampf(kbV + <f32>5.0, 0.0, 10.0);
  unchecked(S[S_GATE] = kGateOut ? <f32>8.0 : <f32>0.0);
  unchecked(S[S_KB] = kbOut);
  unchecked(S[S_VEL] = kAccentSeq ? kAccent * <f32>5.0 : kVel * <f32>5.0);
  unchecked(S[S_CLK] = kClkOut);
  unchecked(S[S_EXT] = (inL + inR) * <f32>0.5 * <f32>5.0 * pv(P_INST_LVL));

  // ---- MODULATION oscillator ------------------------------------------------------------------
  const rateCv = inp(D_LFO_RATE, 0.0);
  if (patched(D_LFO_SYNC)) {
    const sv = unchecked(S[unchecked(SEL[D_LFO_SYNC])]) > 1.2;
    if (sv && !lfoSyncPrev) lfo.syncReset();
    lfoSyncPrev = sv;
  } else lfoSyncPrev = false;
  const lfoInc = exp2f(lfoBaseOct + rateCv) * invSR;
  const lfoV = lfo.tick(lfoInc, pi(P_MOD_WAVE));
  unchecked(S[S_LFO] = lfoV);
  unchecked(S[S_SH] = lfo.sh);

  // ---- ENVELOPE ---------------------------------------------------------------------------------------
  const trig = inp(D_E_TRIG, local ? unchecked(S[S_GATE]) : <f32>0.0);
  const gateHi = trig > 1.2;
  const e = env.tick(gateHi, envA, envD, envS, envR);
  lastEnv = e;
  unchecked(S[S_ENVP] = e * <f32>8.0);
  unchecked(S[S_ENVN] = -e * <f32>8.0);

  // ---- OSCILLATORS --------------------------------------------------------------------------------------
  const modW = pv(P_MODW);
  const lfoN = lfoV * <f32>0.2;
  const pitchMod = lfoN * modW * pv(P_MOD_PITCH);
  const dr = pv(P_DRIFT);
  drift1 += (white() - drift1) * driftA; drift2 += (white() - drift2) * driftA;
  const dc1 = drift1 * driftScale * dr * <f32>0.0025;           // ~±3 cents at full DRIFT (octaves)
  const dc2 = drift2 * driftScale * dr * <f32>0.0025;
  const fine = pv(P_FINE) * <f32>0.0833333;
  const pwm = inp(D_O1_PWM, 0.0) * <f32>0.09;
  const pwMod = lfoN * modW * pv(P_MOD_PW) * <f32>0.45 + pwm;
  // oscillator 1
  const w1 = pi(P_O1_WAVE);
  const v1 = kbInt + f32(pi(P_O1_OCT) - 2) + fine + dc1 + pitchMod + inp(D_O1_PITCH, 0.0);
  const f1 = C4_HZ * exp2f(clampf(v1, -9.0, 6.0));
  const d1 = clampf((w1 == W_NAR ? <f32>0.25 : <f32>0.5) + pwMod, 0.04, 0.96);
  const o1 = osc1.sample(f1 * invSR, w1, d1, -1.0);
  const alphaM = osc1.wrapAlpha;
  unchecked(S[S_O1] = o1);
  // oscillator 2
  const w2 = pi(P_O2_WAVE);
  const sync = pi(P_SYNC) != 0;
  const o2semi: f32 = smO2F * (sync ? <f32>36.0 : <f32>7.0);
  const v2 = kbInt + f32(pi(P_O2_OCT) - 1) + fine + o2semi * <f32>0.0833333 + dc2 + pitchMod + inp(D_O2_PITCH, 0.0);
  const f2 = C4_HZ * exp2f(clampf(v2, -9.0, 6.0));
  const fmHz = inp(D_O2_FM, 0.0) * FM_HZ_PER_V;
  const d2 = clampf((w2 == W_NAR ? <f32>0.25 : <f32>0.5) + pwMod, 0.04, 0.96);
  const o2 = osc2.sample(maxf((f2 + fmHz) * invSR, 0.0), w2, d2, sync ? alphaM : <f32>-1.0);
  unchecked(S[S_O2] = o2);

  // ---- MIXER + FILTER at 2x the sample rate -------------------------------------------------------------
  //  The mixer's overdrive and the ladder's saturation are the nonlinear stages; they run on 2x oversampled
  //  copies of their inputs (half-band interpolation) and the result is decimated back. (The noise generator is
  //  wide-band: ±5 V in the audio band means ±7.07 V at 2x, because the decimator discards half the spectrum.)
  const in1 = inp(D_MX_O1, o1), in2 = inp(D_MX_O2, o2), inx = unchecked(S[S_EXT]);
  const fpat = patched(D_F_IN);
  upA.push(in1); upB.push(in2); upX.push(inx);
  if (patched(D_MX_NZ)) upN.push(inp(D_MX_NZ, 0.0));
  if (fpat) upF.push(inp(D_F_IN, 0.0));
  const trkMode = pi(P_KBD_TRK);
  const trk: f32 = (trkMode == 0 ? <f32>0.5 : (trkMode == 2 ? <f32>1.0 : <f32>0.0)) * kbInt;
  const envAmt = clampf(smEnvAmt + inp(D_F_ENVAMT, 0.0) * <f32>0.125, -1.5, 1.5);
  const cutOct = smCut + trk + envAmt * e * ENV_OCT + inp(D_F_CUT, 0.0) + lfoN * modW * pv(P_MOD_CUT) * <f32>5.0;
  const fc = clampf(<f32>20.0 * exp2f(clampf(cutOct, -3.0, 14.0)), 10.0, SR * <f32>0.45);
  lastCutHz = fc;
  const gF = Mathf.tan(PI * fc * invSR * <f32>0.5);                    // the ladder runs at 2·SR
  let mixA: f32 = 0.0; let mixB: f32 = 0.0; let filA: f32 = 0.0; let filB: f32 = 0.0;
  for (let ph = 0; ph < 2; ph++) {
    const a1 = ph == 0 ? upA.e : upA.o, a2 = ph == 0 ? upB.e : upB.o, ax = ph == 0 ? upX.e : upX.o;
    const x1 = kneeClip(a1 * smO1, 3.5, 8.0);
    const x2 = kneeClip(a2 * smO2, 3.5, 8.0);
    const xn = kneeClip(smNz == 0.0 ? <f32>0.0 : (patched(D_MX_NZ) ? (ph == 0 ? upN.e : upN.o) : white() * <f32>7.0710678) * smNz, 3.5, 8.0);
    const mixv = kneeClip(x1 + x2 + xn + ax, 6.0, 10.0);
    const fin = fpat ? (ph == 0 ? upF.e : upF.o) : mixv;
    const y = lad.tick(fin, gF, smRes);
    if (ph == 0) { mixA = mixv; filA = y; } else { mixB = mixv; filB = y; }
  }
  const mix = dnM.push(mixA, mixB);
  unchecked(S[S_MIX] = mix);
  const fil = dcF.tick(dnF.push(filA, filB), dcG);
  unchecked(S[S_FIL] = fil);

  // ---- UTILITIES ------------------------------------------------------------------------------------------------------
  const hpo = hpf.tick(inp(D_HP_IN, 0.0), hpG);
  unchecked(S[S_HP] = hpo);
  unchecked(S[S_ATT] = inp(D_ATT_IN, 8.0) * smAtt);
  unchecked(S[S_MULT] = inp(D_MULT_A, 0.0) + inp(D_MULT_B, 0.0));

  // ---- OUTPUT: VCA --------------------------------------------------------------------------------------------------------
  if (gateHi) kbrGain = 1.0; else kbrGain = denorm(kbrGain * kbrCoef);
  const vm = pi(P_VCA_MODE);
  const vamtPatched = patched(D_V_AMT);
  const vamt = inp(D_V_AMT, 0.0) * <f32>0.125;
  let gain: f32 = 1.0;
  if (vm == 2) gain = vamtPatched ? clampf(vamt, 0.0, 1.0) : <f32>1.0;
  else gain = clampf((vm == 0 ? e : kbrGain) + vamt, 0.0, 1.25);
  const vca = inp(D_V_IN, fil) * gain;

  // ---- spring reverb + mix --------------------------------------------------------------------------------------------------------
  const wet = tank.tick(inp(D_R_IN, vca) * <f32>0.2) * <f32>5.0;
  unchecked(S[S_REV] = wet);
  const euro = kneeClip(dcE.tick(vca * (<f32>1.0 - smRev) + wet * smRev, dcG), 5.0, 8.0);
  unchecked(S[S_EURO] = euro);
  return euro;
}

export function process(n: i32): void {
  refreshParams();
  if (paramsDirty) onParams();
  for (let i = 0; i < n; i++) {
    const inl = unchecked(inBuf[i]);
    const inr = unchecked(inBuf[MAX_FRAMES + i]);
    if (hostPlaying != 0) kPpqAcc += <f64>hostTempo() * <f64>0.0166666667 * <f64>invSR;
    const v = renderSample(inl, inr);
    let o = v * <f32>0.125 * smVol;
    // transparent below 0.85, smooth ceiling at 1.0
    o = kneeClip(finite(o), 0.85, 1.0);
    unchecked(outBuf[i] = o);
    unchecked(outBuf[MAX_FRAMES + i] = o);
    const ao = absf(o);
    peakOut = ao > peakOut ? ao : peakOut * <f32>0.99995;
  }
  // GUI display
  display[0] = lfo.ph < 0.5 ? <f32>1.0 : <f32>0.0;
  display[1] = kStepFlash;
  display[2] = lastEnv;
  display[3] = kGateOut ? <f32>1.0 : <f32>0.0;
  display[4] = (kRunSeq ? f32(kSeqCur + 1) : <f32>0.0) * <f32>0.00390625;
  display[5] = f32(seqLen[pi(P_OCT_SEQ)]) * <f32>0.00390625;
  display[6] = (kRunArp ? <f32>1.0 : <f32>0.0) + (kRunSeq ? <f32>2.0 : <f32>0.0);
  display[7] = recArmed ? <f32>1.0 : <f32>0.0;
  display[8] = peakOut;
  display[9] = kCur;
  display[10] = Mathf.log2(lastCutHz * <f32>0.05) * <f32>0.1003;
  display[11] = kVel;
}
