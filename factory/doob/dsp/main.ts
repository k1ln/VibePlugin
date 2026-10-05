// =====================================================================
//  main.ts — Doob engine glue: the signal path of the Minimoog Model D
//
//    keyboard S/H + glide ─┬→ OSC 1 ─┐
//    TUNE / pitch wheel ───┤ OSC 2 ──┤  mixer (5 sources, overloads) → ladder filter → VCA 1 → VCA 2 / volume
//    modulation bus ───────┤ OSC 3 ──┘                 ↑ filter contour + keyboard 1/3, 2/3 + modulation
//    noise / ext preamp ───┘                           loudness contour → VCA 1
//
//  plus the modulation mix amp (OSC 3 ⇄ noise through the MOD wheel), the two contour generators,
//  the A-440 reference, the external-input preamp with its overload lamp, the MIDI map and the ABI
//  exports (see src/WasmAbi.h).
// =====================================================================

const osc1 = new GOsc(); const osc2 = new GOsc(); const osc3 = new GOsc();
const lfo = new GOsc();
const cF = new Contour(); const cL = new Contour();
const nz = new Noise();                            // audio noise (2x rate)
const nzM = new Noise();                           // modulation noise (base rate)
const lad = new Ladder();
const dcO = new Hp1();
const upA = new HbUp(); const upB = new HbUp(); const upC = new HbUp(); const upE = new HbUp();
const dnF = new HbDown();

// derived controls -------------------------------------------------------------------------
let tCut: f32 = 0.0; let smCut: f32 = 0.0;
let tEmph: f32 = 0.0; let smEmph: f32 = 0.0;
let tV1: f32 = 0.0; let tV2: f32 = 0.0; let tV3: f32 = 0.0; let tVE: f32 = 0.0; let tVN: f32 = 0.0;
let sV1: f32 = 0.0; let sV2: f32 = 0.0; let sV3: f32 = 0.0; let sVE: f32 = 0.0; let sVN: f32 = 0.0;
let tVol: f32 = 0.0; let sVol: f32 = 0.0;
let smCoef: f32 = 0.01;
let aF: f32 = 0.01; let dF: f32 = 0.1; let sF: f32 = 0.3;
let aL: f32 = 0.01; let dL: f32 = 0.1; let sL: f32 = 1.0;
let g3n: f32 = 1.0; let gNn: f32 = 0.0;           // modulation-mix gains (osc 3 side / noise side), 1.0 = full
let hiBend: f32 = 0.0;
let lfoHz: f32 = 4.0;
let drift1: f32 = 0.0; let drift2: f32 = 0.0; let drift3: f32 = 0.0;
let driftA: f32 = 0.0; let driftScale: f32 = 0.0;
let ccBend: f32 = 0.0;
let rpnSel: i32 = 16383; let rpnMsb: i32 = 127; let rpnLsb: i32 = 127;
let a440Ph: f32 = 0.0;
let lampT: f32 = 0.0;
let lastOut: f32 = 0.0;
let peakOut: f32 = 0.0;
let lastCutHz: f32 = 440.0; let lastK: f32 = 0.0;
let nO1: f32 = 0.0; let nO2: f32 = 0.0; let nO3: f32 = 0.0;
let nMix: f32 = 0.0; let nFil: f32 = 0.0; let nVca: f32 = 0.0; let nNoise: f32 = 0.0; let nBus: f32 = 0.0;
let nF1: f32 = 0.0; let nF2: f32 = 0.0; let nF3: f32 = 0.0; let nLfo: f32 = 0.0;
const F2_HZ: f32 = 87.30706;                       // bottom F at 8'
const ENV_OCT: f32 = 8.5;                          // full AMOUNT OF CONTOUR sweeps the cutoff 8.5 octaves
const MOD_OCT: f32 = 1.0;                          // full modulation = ±1 octave on pitch / filter

export function transport(playing: i32, ppq: f64, bpm: f32): void { setHostTransport(playing, ppq, bpm); }
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
export function paramValue(i: i32): f32 { return i >= 0 && i < NP ? A[i] : <f32>0.0; }
// test / diagnostic probes of internal nodes (value after the last processed sample)
export function dbgNode(i: i32): f32 {
  if (i == 0) return nO1; if (i == 1) return nO2; if (i == 2) return nO3; if (i == 3) return nMix; if (i == 4) return nFil;
  if (i == 5) return nVca; if (i == 6) return nNoise; if (i == 7) return nBus; if (i == 8) return nF1; if (i == 9) return nF2;
  if (i == 10) return nF3; if (i == 11) return nLfo; if (i == 12) return lastOut; if (i == 13) return lastCutHz; if (i == 14) return lastK;
  if (i == 15) return cF.v; if (i == 16) return cL.v; if (i == 17) return kCur; if (i == 18) return kGateOut ? <f32>1.0 : <f32>0.0;
  if (i == 19) return f32(hN); if (i == 20) return lampT;
  return 0.0;
}

@inline function taper(x: f32): f32 { return (Mathf.exp(<f32>4.39 * x) - <f32>1.0) * <f32>0.012658; }   // audio taper: 10 % at mid-travel
@inline function rangeOct(r: i32): f32 { return r == 0 ? <f32>-5.0 : f32(r - 3); }                       // LO, 32', 16', 8', 4', 2'

// ---------------------------------------------------------------------------- init
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  SR = sr > 0.0 ? sr : <f32>48000.0; invSR = <f32>1.0 / SR;
  rng = 0x9e3779b9;
  initSin(); initBlep(); initHalfband();
  for (let i = 0; i < MAX_PARAMS; i++) { params[i] = 0.0; slotCache[i] = -1.0; }
  for (let i = 0; i < NP; i++) { A[i] = 0.0; An[i] = 0.0; AI[i] = 0; RH[i] = -1; AH[i] = -1.0e9; }
  setDefaults();
  refreshParams();
  for (let i = 0; i < MAX_FRAMES * 2; i++) inBuf[i] = 0.0;
  osc1.reset(); osc2.reset(); osc3.reset(); lfo.reset(); osc2.ph = 0.31; osc3.ph = 0.67;
  cF.reset(); cL.reset(); cF.kA = 2.36; cL.kA = 2.0;
  nz.reset(); nz.setup(); nzM.reset(); nzM.setup(); lad.reset(); dcO.s = 0.0;
  upA.reset(); upB.reset(); upC.reset(); upE.reset(); dnF.reset();
  smCoef = <f32>1.0 - Mathf.exp(-<f32>1.0 * invSR / <f32>0.004);
  driftA = onePoleA(0.3); driftScale = Mathf.sqrt(<f32>6.0 / driftA);
  drift1 = 0.0; drift2 = 0.0; drift3 = 0.0;
  hN = 0; kTarget = 0.0; kCur = 0.0; kHeldKey = -1000; kGateWant = false; kGateOut = false; kLowT = 1.0;
  ccBend = 0.0; rpnSel = 16383; a440Ph = 0.0; lampT = 0.0; lastOut = 0.0; peakOut = 0.0;
  for (let i = 0; i < 128; i++) ccMsb[i] = 0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  paramsDirty = true; onParams();
  smCut = tCut; smEmph = tEmph; sV1 = tV1; sV2 = tV2; sV3 = tV3; sVE = tVE; sVN = tVN; sVol = tVol;
}
const ccMsb = new StaticArray<i32>(128);

// ---------------------------------------------------------------------------- parameter-derived values
function onParams(): void {
  paramsDirty = false;
  tCut = <f32>-5.0 + <f32>10.0 * pv(P_CUTOFF);                       // panel scale -5 … +5 (octaves; 440 Hz at -1)
  const x = pv(P_EMPH);
  tEmph = x;
  tV1 = pi(P_SW_O1) != 0 ? pv(P_VOL1) : <f32>0.0; tV2 = pi(P_SW_O2) != 0 ? pv(P_VOL2) : <f32>0.0; tV3 = pi(P_SW_O3) != 0 ? pv(P_VOL3) : <f32>0.0;
  tVE = pi(P_SW_EXT) != 0 ? pv(P_VOLEXT) : <f32>0.0; tVN = pi(P_SW_NZ) != 0 ? pv(P_VOLNZ) : <f32>0.0;
  const v = pv(P_OUTVOL);
  tVol = pi(P_MAIN_ON) != 0 ? <f32>2.0 * v * v : <f32>0.0;
  const ms: f32 = 0.001;
  aF = ms + (<f32>9.0 - ms) * taper(pv(P_FATK));  dF = ms + (<f32>30.0 - ms) * taper(pv(P_FDEC)); sF = pv(P_FSUS);
  aL = ms + (<f32>14.0 - ms) * taper(pv(P_LATK)); dL = ms + (<f32>30.0 - ms) * taper(pv(P_LDEC)); sL = pv(P_LSUS);
  glideTau = <f32>0.00033 + <f32>2.2 * taper(pv(P_GLIDE));
  // modulation-mix pan pot (25 K, wiper to ground) with the 24 K input resistors: the side the wiper leaves un-shorted passes
  const p = pv(P_MODMIX);
  const ro: f32 = <f32>25.0 * (<f32>1.0 - p); const rn: f32 = <f32>25.0 * p;
  g3n = (ro / (<f32>24.0 + ro)) * <f32>1.96; gNn = (rn / (<f32>24.0 + rn)) * <f32>1.96;
  lfoHz = <f32>0.1 * Mathf.pow(<f32>300.0, pv(P_LFO_RATE));
  keyboardUpdate(false);
}

// ---------------------------------------------------------------------------- MIDI in
function noteFromFreq(freq: f32): i32 {
  const m = i32(nearest<f32>(<f32>69.0 + <f32>12.0 * Mathf.log2(freq / <f32>440.0)));
  return m < 0 ? 0 : (m > 127 ? 127 : m);
}
export function noteOn(id: i32, freq: f32, vel: f32): void {
  refreshParams(); if (paramsDirty) onParams();
  if (id == -5) { allNotesOff(); return; }
  if (id < 0) return;
  keyOn(id, noteFromFreq(freq) - 41);
}
export function noteOff(id: i32): void {
  refreshParams(); if (paramsDirty) onParams();
  if (id < 0) return;
  keyOff(id);
}
export function controlChange(num: i32, value: f32): void {
  refreshParams();
  const v127: i32 = i32(nearest<f32>(value * <f32>127.0));
  if (num == 128) { ccBend = value; return; }
  if (num == 129) return;
  if (num == 120 || num == 123) { allNotesOff(); return; }
  if (num == 1) setParamN(P_MODW, value);
  else if (num == 33) setParamN(P_MODW, f32(ccMsb[1] * 128 + v127) / <f32>16383.0);
  else if (num == 122) setParamI(P_LOCAL, value >= 0.5 ? 1 : 0);
  else if (num == 101) { rpnMsb = v127; rpnSel = rpnMsb * 128 + rpnLsb; }
  else if (num == 100) { rpnLsb = v127; rpnSel = rpnMsb * 128 + rpnLsb; }
  else if (num == 6) { if (rpnSel == 0) setParamI(P_BEND, v127 < 1 ? 1 : (v127 > 12 ? 12 : v127)); }
  if (num < 128) ccMsb[num] = v127;
  if (paramsDirty) onParams();
}

// ---------------------------------------------------------------------------- one sample of the instrument
@inline function slew(c: f32, t: f32): f32 { return c + (t - c) * smCoef; }
@inline function waveA(w: i32, o3: bool): f32 { return w == 0 ? <f32>1.0 : (w == 1 ? (o3 ? <f32>0.0 : <f32>0.824) : <f32>0.0); }
@inline function waveB(w: i32, o3: bool): f32 { return w == 1 ? (o3 ? <f32>-1.0 : <f32>0.176) : (w == 2 ? <f32>1.0 : <f32>0.0); }
@inline function waveD(w: i32): f32 { return w == 3 ? <f32>0.5 : (w == 4 ? <f32>0.3333 : <f32>0.16667); }

function renderSample(inL: f32, inR: f32): f32 {
  smCut = slew(smCut, tCut); smEmph = slew(smEmph, tEmph);
  sV1 = slew(sV1, tV1); sV2 = slew(sV2, tV2); sV3 = slew(sV3, tV3); sVE = slew(sVE, tVE); sVN = slew(sVN, tVN); sVol = slew(sVol, tVol);

  // ---- keyboard / S&H / glide ----------------------------------------------------------------
  keysTick(invSR);
  const gate = (pi(P_STRIG) != 0) ? true : kGateOut;

  // ---- contours ---------------------------------------------------------------------------------
  const decOn = pi(P_DECAY_ON) != 0;
  const cf = cF.tick(gate, aF, dF, sF, decOn ? dF : <f32>-1.0);
  const cl = cL.tick(gate, aL, dL, sL, decOn ? dL : <f32>-1.0);

  // ---- modulation mix -> wheel ------------------------------------------------------------------------
  const wf = pv(P_MODW);
  const wheel = taper(wf);
  const lfoV = lfo.sample(lfoHz * invSR, pi(P_LFO_WAVE) == 0 ? 0 : 1, 1.0, 0.0, 0.5);
  nLfo = lfoV;
  const wn = white();
  const nModColor = pi(P_NZ_COLOR) == 0 ? nzM.pink(wn) : nzM.red(wn);          // WHITE position → pink mod noise; PINK → red
  const srcA: f32 = pi(P_MOD_A) == 0 ? nO3 : cf;
  const srcB: f32 = pi(P_MOD_B) == 0 ? nModColor : lfoV;
  const bus: f32 = wheel * (g3n * srcA + gNn * srcB) * MOD_OCT;                // octaves
  nBus = bus;

  // ---- oscillators -----------------------------------------------------------------------------------------
  const local = pi(P_LOCAL) != 0;
  const bn = clampf(pv(P_PITCHW) + ccBend, -1.0, 1.0);
  const bendOct: f32 = bn * f32(pi(P_BEND)) * <f32>0.0833333;
  const tuneOct: f32 = pv(P_TUNE) * <f32>0.3333333;
  const kbOct: f32 = local ? kCur * <f32>0.0833333 : <f32>0.0;
  const modOct: f32 = pi(P_OSC_MOD) != 0 ? bus : <f32>0.0;
  const dr = pv(P_DRIFT);
  drift1 += (white() - drift1) * driftA; drift2 += (white() - drift2) * driftA; drift3 += (white() - drift3) * driftA;
  const dk = driftScale * dr * <f32>0.0022;                                   // ~±2.6 cents at full DRIFT (octaves)
  const bl = pv(P_BLEED) * <f32>0.002;
  const o3ctl = pi(P_O3_CTRL) != 0;
  const base: f32 = tuneOct + bendOct + modOct;
  const cv1 = rangeOct(pi(P_O1_RANGE)) + kbOct + base + drift1 * dk + bl * nO2;
  const cv2 = rangeOct(pi(P_O2_RANGE)) + kbOct + base + drift2 * dk + pv(P_O2_FREQ) * <f32>0.5833333 + bl * nO1;
  const cv3 = rangeOct(pi(P_O3_RANGE)) + (o3ctl ? kbOct : <f32>0.0) + base + drift3 * dk + (o3ctl ? pv(P_O3_FREQ) * <f32>0.5833333 : pv(P_O3_FREQ) * <f32>3.0) + bl * nO2;
  nF1 = F2_HZ * exp2f(clampf(cv1, -9.0, 7.0)); nF2 = F2_HZ * exp2f(clampf(cv2, -9.0, 7.0)); nF3 = F2_HZ * exp2f(clampf(cv3, -9.0, 7.0));
  const w1 = pi(P_O1_WAVE), w2 = pi(P_O2_WAVE), w3 = pi(P_O3_WAVE);
  const k1: i32 = w1 >= 3 ? 1 : 0, k2: i32 = w2 >= 3 ? 1 : 0, k3: i32 = w3 >= 3 ? 1 : 0;
  nO1 = osc1.sample(nF1 * invSR, k1, waveA(w1, false), waveB(w1, false), waveD(w1));
  nO2 = osc2.sample(nF2 * invSR, k2, waveA(w2, false), waveB(w2, false), waveD(w2));
  nO3 = osc3.sample(nF3 * invSR, k3, waveA(w3, true), waveB(w3, true), waveD(w3));

  // ---- external input preamp + overload lamp ----------------------------------------------------------------
  const fbOn = pi(P_FEEDBACK) != 0;
  const extRaw = (inL + inR) * <f32>0.5 + (fbOn ? lastOut * <f32>0.9 : <f32>0.0);
  const pre = extRaw * pv(P_VOLEXT) * <f32>8.0;
  if (absf(pre) > 1.0) lampT = 0.06; else if (lampT > 0.0) lampT -= invSR;
  const extN = softclip(pre * <f32>0.8) * <f32>1.25;

  // ---- MIXER + FILTER at 2x the sample rate ---------------------------------------------------------------------
  upA.push(nO1); upB.push(nO2); upC.push(nO3); upE.push(extN);
  const trkMode = (pi(P_KB1) != 0 ? <f32>0.3333 : <f32>0.0) + (pi(P_KB2) != 0 ? <f32>0.6667 : <f32>0.0);
  const filModOct: f32 = pi(P_FIL_MOD) != 0 ? bus : <f32>0.0;
  const cutOct = smCut + <f32>1.0 + trkMode * (local ? kCur * <f32>0.0833333 : <f32>0.0) + ENV_OCT * pv(P_CONTOUR) * cf + filModOct;
  const fc = clampf(<f32>440.0 * exp2f(clampf(cutOct, -7.0, 9.0)), 10.0, SR * <f32>0.8);
  lastCutHz = fc;
  const gF = Mathf.tan(PI * fc * invSR * <f32>0.5);                              // the ladder runs at 2·SR
  // EMPHASIS: audio-taper pot. Regeneration starts at 7.5 (k = 4); the loop gain droops at low cutoff frequencies
  const kRaw: f32 = <f32>4.0 * taper(smEmph) / <f32>0.3278;
  const kDroop: f32 = clampf(<f32>0.62 + <f32>0.38 * Mathf.log2(fc * <f32>0.0125) * <f32>0.4, 0.62, 1.0);
  const kk = minf(kRaw, <f32>7.0) * kDroop;
  lastK = kk;
  const col = pi(P_NZ_COLOR);
  let sumA: f32 = 0.0; let sumB: f32 = 0.0; let filA: f32 = 0.0; let filB: f32 = 0.0;
  for (let ph = 0; ph < 2; ph++) {
    const a1 = ph == 0 ? upA.e : upA.o, a2 = ph == 0 ? upB.e : upB.o, a3 = ph == 0 ? upC.e : upC.o, ae = ph == 0 ? upE.e : upE.o;
    const w = white();
    const nzv: f32 = col == 0 ? w : nz.pink(w) * <f32>3.2;
    const sm: f32 = a1 * sV1 + a2 * sV2 + a3 * sV3 + ae * sVE + nzv * sVN;
    const y = lad.tick(sm, gF, kk);
    if (ph == 0) { sumA = sm; filA = y; } else { sumB = sm; filB = y; }
  }
  nMix = <f32>0.5 * (sumA + sumB);
  nNoise = wn;
  const fil = dnF.push(filA, filB);
  nFil = fil;

  // ---- loudness: VCA 1 (contour), A-440 into VCA 2, volume ---------------------------------------------------------
  const vca = fil * cl;
  nVca = vca;
  a440Ph += <f32>440.0 * invSR; if (a440Ph >= 1.0) a440Ph -= 1.0;
  const ref: f32 = pi(P_A440) != 0 ? (fsin(a440Ph) + <f32>0.035 * fsin(a440Ph * <f32>2.0) + <f32>0.012 * fsin(a440Ph * <f32>3.0)) * <f32>0.28 : <f32>0.0;
  const out = dcO.tick((vca + ref) * <f32>0.8 * sVol, <f32>0.0005);
  lastOut = out;
  return out;
}

export function process(n: i32): void {
  refreshParams();
  if (paramsDirty) onParams();
  for (let i = 0; i < n; i++) {
    const inl = unchecked(inBuf[i]);
    const inr = unchecked(inBuf[MAX_FRAMES + i]);
    let o = kneeClip(finite(renderSample(inl, inr)), 0.85, 1.0);
    unchecked(outBuf[i] = o);
    unchecked(outBuf[MAX_FRAMES + i] = o);
    const ao = absf(o);
    peakOut = ao > peakOut ? ao : peakOut * <f32>0.99995;
  }
  display[0] = lampT > 0.0 ? <f32>1.0 : <f32>0.0;
  display[1] = kGateOut ? <f32>1.0 : <f32>0.0;
  display[2] = cF.v; display[3] = cL.v;
  display[4] = lfo.ph < 0.5 ? <f32>1.0 : <f32>0.0;
  display[5] = peakOut;
  display[6] = kCur;
}
