// =====================================================================
//  NOVA SIX — a six-voice programmable polyphonic analog synthesizer
//  modelled control-for-control on the Roland Juno-106 (Owner's Manual,
//  read cover to cover; every front-panel control is represented here).
//
//  DCO (manual p.16-17): one digitally-controlled oscillator per voice,
//  emitting sawtooth and a variable-width pulse SIMULTANEOUSLY (independent
//  on/off switches, polyBLEP band-limited), a square SUB oscillator one
//  octave down, and white NOISE, mixed per voice. 16'/8'/4' RANGE selector.
//  PWM MODE switch: MANUAL (the PW knob sets width) or LFO (the LFO
//  modulates width, the knob sets depth).
//  HPF (p.18): 4-position, non-resonant. 0 boosts the lows (organ bass),
//  1 is flat, 2 and 3 progressively cut the low end.
//  VCF (p.18-19): resonant 4-pole low-pass, self-oscillates at max RES.
//  FREQ cutoff, ENV amount + its +/- POLARITY switch (reverse ADSR), LFO
//  amount, and a 0-100% KEY FOLLOW knob.
//  VCA (p.20): CONTROL-SIGNAL switch ENV (ADSR shapes the amplitude) or
//  GATE (organ on/off), plus a LEVEL knob.
//  ENV (p.20-21): one ADSR (A 1.5 ms-3 s, D/R 1.5 ms-12 s, S 0-100%)
//  shared by the VCF and, in ENV mode, the VCA.
//  LFO (p.21): triangle, 0.1-30 Hz, with a DELAY that fades it in after a
//  fresh note; routes to DCO pitch (vibrato), pulse width and the VCF.
//  CHORUS (p.29): the Juno stereo bucket-brigade chorus, all three
//  positions — I, II and both I+II (stronger, beating) — modelled as two
//  out-of-phase modulated BBD delay lines.
//  CONTROLLERS (p.23): PORTAMENTO time + on/off switch, the bend lever
//  with independent DCO (up to +/-1 octave) and VCF bend-sensitivity, and
//  forward-push LFO vibrato with its own depth knob.
//  ASSIGN (p.22): POLY 1 (multi-trigger), POLY 2 (legato / portamento) and
//  SOLO (6-voice unison). KEY TRANSPOSE +/-1 octave (p.24).
//
//  Switch groups are bit-packed; the GUI decodes them into the individual
//  panel switches. Pure algorithm — no samples, no imports, allocation-free.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;
const HELD_MAX: i32 = 16;
const CH_LEN: i32 = 1024;
const CH_MASK: i32 = CH_LEN - 1;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_LFORATE: i32 = 0;   // 0..1 → 0.1 .. 30 Hz
const P_LFODELAY: i32 = 1;  // 0..1 → 0 .. 3 s fade-in
const P_DCOLFO: i32 = 2;    // constant vibrato depth (DCO LFO knob)
const P_PWM: i32 = 3;       // pulse width (MAN) / mod depth (LFO)
const P_SUB: i32 = 4;       // sub-oscillator level
const P_NOISE: i32 = 5;     // noise level
const P_RANGE: i32 = 6;     // 0 16', 1 8', 2 4'
const P_WAVE: i32 = 7;      // bit0 pulse on, bit1 saw on, bit2 PWM mode LFO(1)/MAN(0)
const P_HPF: i32 = 8;       // 0 boost, 1 flat, 2/3 high-pass
const P_VCFFREQ: i32 = 9;
const P_VCFRES: i32 = 10;
const P_VCFENV: i32 = 11;
const P_VCFLFO: i32 = 12;
const P_VCFKYBD: i32 = 13;
const P_VCFPOL: i32 = 14;   // 0 positive, 1 negative (reverse envelope)
const P_VCAMODE: i32 = 15;  // 0 ENV, 1 GATE
const P_VCALEVEL: i32 = 16;
const P_ATT: i32 = 17;
const P_DEC: i32 = 18;
const P_SUS: i32 = 19;
const P_REL: i32 = 20;
const P_CHORUS: i32 = 21;   // 0 off, 1 I, 2 II, 3 I+II
const P_ASSIGN: i32 = 22;   // 0 Poly1, 1 Poly2, 2 Solo
const P_PORTATIME: i32 = 23;
const P_PORTASW: i32 = 24;  // 0 off, 1 on
const P_TRANSPOSE: i32 = 25;// 0 -1oct, 1 normal, 2 +1oct
const P_DCOBEND: i32 = 26;  // 0..1 → up to +/-1 octave
const P_VCFBEND: i32 = 27;  // 0..1 VCF bend sensitivity
const P_LFOBEND: i32 = 28;  // 0..1 forward-push vibrato depth
const P_BENDER: i32 = 29;   // -1..1 bend lever (performance)
const P_MODPUSH: i32 = 30;  // 0..1 lever forward push (performance)
const P_VOLUME: i32 = 31;

const NUM_PARAMS: i32 = 32;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 { // white noise -1..1, deterministic
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  else if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

// ENV knob → time. Attack 1.5 ms .. 3 s ; Decay/Release 1.5 ms .. 12 s (specs p.32)
@inline function atkTime(n: f32): f32 { return 0.0015 * f32(Mathf.pow(2000.0, clampf(n, 0.0, 1.0))); }
@inline function decTime(n: f32): f32 { return 0.0015 * f32(Mathf.pow(8000.0, clampf(n, 0.0, 1.0))); }

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // main osc phase
const vPhSub:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // sub (half rate)
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // shared ADSR
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle,1 A,2 D→S,4 R
const vGateEnv:StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // VCA gate-mode amp
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vHpX: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // HPF one-pole prev in
const vHpY: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // HPF one-pole prev out
const vShelf: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // bass-boost low-pass
const vDet: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);  // unison detune mult

// held-key list
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global LFO + delay + chorus
let lfoPhase: f32 = 0.0;
let lfoDelayEnv: f32 = 1.0;
let chPh1: f32 = 0.0;
let chPh2: f32 = 0.0;
const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chWrite: i32 = 0;
let lastAssign: i32 = -1;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 1.0;
    vCur[v] = 261.63; vTarget[v] = 261.63; vGlideK[v] = 1.0;
    vPh[v] = 0.11 * f32(v); vPhSub[v] = 0.23 * f32(v);
    vEnv[v] = 0.0; vStage[v] = 0; vGateEnv[v] = 0.0;
    vLp0[v] = 0.0; vLp1[v] = 0.0; vLp2[v] = 0.0; vLp3[v] = 0.0;
    vHpX[v] = 0.0; vHpY[v] = 0.0; vShelf[v] = 0.0; vDet[v] = 1.0;
  }
  hCount = 0; orderCounter = 0; ageCounter = 1; lastPlayedHz = 261.63;
  lfoPhase = 0.0; lfoDelayEnv = 1.0; chPh1 = 0.0; chPh2 = 0.37; chWrite = 0;
  for (let i = 0; i < CH_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  lastAssign = -1;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_LFORATE] = 0.32; params[P_LFODELAY] = 0.2; params[P_DCOLFO] = 0.0;
  params[P_PWM] = 0.4; params[P_SUB] = 0.3; params[P_NOISE] = 0.0;
  params[P_RANGE] = 1.0; params[P_WAVE] = 7.0; params[P_HPF] = 0.0;
  params[P_VCFFREQ] = 0.45; params[P_VCFRES] = 0.15; params[P_VCFENV] = 0.5;
  params[P_VCFLFO] = 0.06; params[P_VCFKYBD] = 0.4; params[P_VCFPOL] = 0.0;
  params[P_VCAMODE] = 0.0; params[P_VCALEVEL] = 0.8;
  params[P_ATT] = 0.03; params[P_DEC] = 0.5; params[P_SUS] = 0.7; params[P_REL] = 0.4;
  params[P_CHORUS] = 1.0; params[P_ASSIGN] = 0.0;
  params[P_PORTATIME] = 0.2; params[P_PORTASW] = 0.0; params[P_TRANSPOSE] = 1.0;
  params[P_DCOBEND] = 0.2; params[P_VCFBEND] = 0.0; params[P_LFOBEND] = 0.3;
  params[P_BENDER] = 0.0; params[P_MODPUSH] = 0.0; params[P_VOLUME] = 0.75;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- portamento (p.23: slide from previous pitch, time knob) ----------
function computeGlideK(v: i32): void {
  const assign: i32 = pbits(P_ASSIGN);
  const on: i32 = (pbits(P_PORTASW) == 1 || assign >= 1) ? 1 : 0; // Poly2/Solo also glide
  vGlideK[v] = 1.0;
  if (on == 0) { vCur[v] = vTarget[v]; return; }
  const t: f32 = clampf(pget(P_PORTATIME), 0.0, 1.0);
  if (t <= 0.002) { vCur[v] = vTarget[v]; return; }
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  const secPerOct: f32 = 0.01 * f32(Mathf.pow(300.0, t)); // 0.01 .. 3 s / octave
  const step: f32 = f32(Mathf.pow(2.0, 1.0 / (secPerOct * sampleRate)));
  vGlideK[v] = vTarget[v] > vCur[v] ? step : 1.0 / step;
}

function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function triggerVoice(slot: i32, id: i32, hz: f32, vel: f32, retrig: i32, detMul: f32): void {
  vNote[slot] = id;
  vTarget[slot] = hz > 0.0 ? hz : 1.0;
  vDet[slot] = detMul;
  if (vActive[slot] == 0 || retrig == 1) {
    vCur[slot] = lastPlayedHz;
    vStage[slot] = 1;
    if (vActive[slot] == 0) {
      vEnv[slot] = 0.0; vGateEnv[slot] = 0.0;
      vLp0[slot] = 0.0; vLp1[slot] = 0.0; vLp2[slot] = 0.0; vLp3[slot] = 0.0;
      vHpX[slot] = 0.0; vHpY[slot] = 0.0; vShelf[slot] = 0.0;
    }
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot);
  vAge[slot] = ageCounter++;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) { vGate[i] = 0; vStage[i] = 4; }
  }
}
function releaseAll(): void {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vStage[i] = 4; }
}

// held-list maintenance
function heldAdd(id: i32, hz: f32, vel: f32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) { hFreq[i] = hz; hVel[i] = vel; hOrder[i] = orderCounter++; return; }
  }
  if (hCount >= HELD_MAX) {
    for (let i = 1; i < hCount; i++) { hId[i-1]=hId[i]; hFreq[i-1]=hFreq[i]; hVel[i-1]=hVel[i]; hOrder[i-1]=hOrder[i]; }
    hCount--;
  }
  hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = vel; hOrder[hCount] = orderCounter++;
  hCount++;
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i+1; j < hCount; j++) { hId[j-1]=hId[j]; hFreq[j-1]=hFreq[j]; hVel[j-1]=hVel[j]; hOrder[j-1]=hOrder[j]; }
      hCount--; return;
    }
  }
}

// SOLO (unison) — 6 voices stacked on the last-played note, gently detuned
function soloRetune(newPress: i32): void {
  if (hCount == 0) { releaseAll(); return; }
  let pick: i32 = 0;
  for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i;
  const baseHz: f32 = hFreq[pick];
  const vel: f32 = hVel[pick];
  const wasSilent: i32 = 1; // legato feel: only retrig from silence
  for (let s = 0; s < NUM_VOICES; s++) {
    const cents: f32 = (f32(s) - 2.5) * 5.0; // ±~12 cents spread
    const det: f32 = f32(Mathf.pow(2.0, cents / 1200.0));
    let rt: i32 = 0;
    if (newPress == 1 && vActive[s] == 0) rt = 1;
    triggerVoice(s, hId[pick], baseHz, vel, rt, det);
  }
  void wasSilent;
  lastPlayedHz = baseHz;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const wasIdle: i32 = hCount == 0 ? 1 : 0;
  heldAdd(id, hz, vel);
  if (wasIdle == 1) lfoDelayEnv = 0.0; // LFO delay restarts on a fresh note (p.21)
  const assign: i32 = pbits(P_ASSIGN);
  if (assign == 2) { soloRetune(1); return; }
  // POLY 1 (multi-trigger) / POLY 2 (legato single-trigger)
  const multiTrig: i32 = assign == 0 ? 1 : 0;
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  triggerVoice(slot, id, hz, vel, multiTrig, 1.0);
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  heldRemove(id);
  const assign: i32 = pbits(P_ASSIGN);
  if (assign == 2) { if (hCount == 0) releaseAll(); else soloRetune(0); return; }
  releaseId(id);
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // assign-mode change: SOLO restack / poly redistribute
  const assign: i32 = pbits(P_ASSIGN);
  if (assign != lastAssign && lastAssign >= 0) {
    if (assign == 2) { if (hCount > 0) soloRetune(0); }
    else if (lastAssign == 2) {
      releaseAll();
      for (let i = 0; i < hCount && i < NUM_VOICES; i++) {
        const s: i32 = allocVoice();
        triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 1.0);
      }
    }
  }
  lastAssign = assign;

  // ---- per-block parameter mapping -----------------------------------
  const lfoHz: f32 = 0.1 * f32(Mathf.pow(300.0, clampf(pget(P_LFORATE), 0.0, 1.0))); // 0.1..30 Hz
  const lfoInc: f32 = lfoHz / sr;
  const lfoDelayT: f32 = clampf(pget(P_LFODELAY), 0.0, 1.0) * 3.0; // 0..3 s
  const lfoDelayStep: f32 = lfoDelayT <= 0.001 ? 1.0 : 1.0 / (lfoDelayT * sr);

  const dcoLfo: f32 = clampf(pget(P_DCOLFO), 0.0, 1.0);
  const modPush: f32 = clampf(pget(P_MODPUSH), 0.0, 1.0);
  const lfoBend: f32 = clampf(pget(P_LFOBEND), 0.0, 1.0);
  const vibDepth: f32 = dcoLfo + modPush * lfoBend; // semitone-ish scaling later

  const wave: i32 = pbits(P_WAVE);
  const pulseOn: f32 = f32(wave & 1);
  const sawOn: f32 = f32((wave >> 1) & 1);
  const pwmLfo: i32 = (wave >> 2) & 1;
  const pwmKnob: f32 = clampf(pget(P_PWM), 0.0, 1.0);
  const subLvl: f32 = clampf(pget(P_SUB), 0.0, 1.0);
  const noiseLvl: f32 = clampf(pget(P_NOISE), 0.0, 1.0);

  const rangeSel: i32 = pbits(P_RANGE);
  const rangeMul: f32 = rangeSel == 0 ? 0.5 : (rangeSel == 2 ? 2.0 : 1.0); // 16'/8'/4'
  const transSel: i32 = pbits(P_TRANSPOSE);
  const transMul: f32 = transSel == 0 ? 0.5 : (transSel == 2 ? 2.0 : 1.0);

  const bender: f32 = clampf(pget(P_BENDER), -1.0, 1.0);
  const dcoBendOct: f32 = bender * clampf(pget(P_DCOBEND), 0.0, 1.0);       // ±1 octave max
  const bendMul: f32 = f32(Mathf.pow(2.0, dcoBendOct));
  const baseMul: f32 = rangeMul * transMul * bendMul;
  const vcfBendOct: f32 = bender * clampf(pget(P_VCFBEND), 0.0, 1.0) * 4.0; // VCF bend range

  const hpfSel: i32 = pbits(P_HPF);

  const cutN: f32 = clampf(pget(P_VCFFREQ), 0.0, 1.0);
  const fcBase: f32 = 18.0 * f32(Mathf.pow(2.0, cutN * 10.2)); // ~18 Hz .. ~20 kHz
  const resN: f32 = clampf(pget(P_VCFRES), 0.0, 1.0);
  const kRes: f32 = resN * 4.3; // self-oscillates near max (p.18)
  const vcfEnvAmt: f32 = clampf(pget(P_VCFENV), 0.0, 1.0);
  const vcfPol: f32 = pbits(P_VCFPOL) == 1 ? -1.0 : 1.0;
  const vcfLfoAmt: f32 = clampf(pget(P_VCFLFO), 0.0, 1.0);
  const vcfKybd: f32 = clampf(pget(P_VCFKYBD), 0.0, 1.0);

  const vcaMode: i32 = pbits(P_VCAMODE); // 0 env, 1 gate
  const vcaLevel: f32 = clampf(pget(P_VCALEVEL), 0.0, 1.0);

  const atkStep: f32 = 1.0 / (atkTime(pget(P_ATT)) * sr);
  const decK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(P_DEC)) * sr)));
  const sus: f32 = clampf(pget(P_SUS), 0.0, 1.0);
  const relK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(P_REL)) * sr)));
  const gateAtkK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (0.003 * sr)));
  const gateRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (0.008 * sr)));

  const chorusMode: i32 = pbits(P_CHORUS); // 0 off,1 I,2 II,3 both
  const chInc1: f32 = 0.513 / sr;
  const chInc2: f32 = 0.863 / sr;
  const chCenter: f32 = 0.0055 * sr;   // ~5.5 ms
  const chDepth1: f32 = 0.0019 * sr;
  const chDepth2: f32 = 0.0030 * sr;

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.4;
  const voiceScale: f32 = assign == 2 ? 0.30 : 0.44;

  for (let f = 0; f < n; f++) {
    // ---- LFO (triangle) + delay fade-in --------------------------------
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) lfoPhase -= 1.0;
    const lfoTri: f32 = lfoPhase < 0.5 ? lfoPhase * 4.0 - 1.0 : 3.0 - lfoPhase * 4.0;
    if (lfoDelayEnv < 1.0) { lfoDelayEnv += lfoDelayStep; if (lfoDelayEnv > 1.0) lfoDelayEnv = 1.0; }
    const lfo: f32 = lfoTri * lfoDelayEnv;

    // pitch vibrato multiplier (shared by all voices)
    const vibSemi: f32 = vibDepth * lfo * 1.2; // up to ~1.2 semitones
    const vibMul: f32 = vibSemi != 0.0 ? f32(Mathf.pow(2.0, vibSemi / 12.0)) : 1.0;

    // pulse width for this sample
    let pw: f32;
    if (pwmLfo == 1) pw = 0.5 + lfo * pwmKnob * 0.42;
    else pw = 0.5 - pwmKnob * 0.45;
    pw = clampf(pw, 0.05, 0.95);

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- glide ---------------------------------------------------------
      let cur: f32 = vCur[v];
      const tgt: f32 = vTarget[v];
      if (cur != tgt) {
        const gk: f32 = vGlideK[v];
        if (gk == 1.0) cur = tgt;
        else { cur *= gk; if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt; }
        vCur[v] = cur;
      }

      // ---- shared ADSR ---------------------------------------------------
      let env: f32 = vEnv[v];
      const st: i32 = vStage[v];
      if (st == 1) { env += atkStep; if (env >= 1.0) { env = 1.0; vStage[v] = 2; } }
      else if (st == 2) { env += (sus - env) * decK; }
      else if (st == 4) { env += (0.0 - env) * relK; if (env <= 0.0004) env = 0.0; }
      vEnv[v] = env;

      // VCA gate-mode amplitude (organ on/off)
      let genv: f32 = vGateEnv[v];
      if (vGate[v] == 1) genv += (1.0 - genv) * gateAtkK;
      else genv += (0.0 - genv) * gateRelK;
      vGateEnv[v] = genv;

      const amp: f32 = vcaMode == 1 ? genv : env;
      if (vGate[v] == 0 && env <= 0.0005 && genv <= 0.0005) { vActive[v] = 0; continue; }

      // ---- oscillator (saw + pulse simultaneously) ----------------------
      const hz: f32 = cur * vDet[v] * baseMul * vibMul;
      let inc: f32 = hz / sr;
      if (inc > 0.45) inc = 0.45; if (inc < 0.0) inc = 0.0;
      let ph: f32 = vPh[v]; ph += inc; if (ph >= 1.0) ph -= 1.0; vPh[v] = ph;

      let osc: f32 = 0.0;
      if (sawOn != 0.0) { let s: f32 = 2.0 * ph - 1.0; s -= polyBlep(ph, inc); osc += s; }
      if (pulseOn != 0.0) {
        let sq: f32 = ph < pw ? 1.0 : -1.0;
        sq += polyBlep(ph, inc);
        let p2: f32 = ph - pw; if (p2 < 0.0) p2 += 1.0;
        sq -= polyBlep(p2, inc);
        osc += sq;
      }
      // sub oscillator: square one octave below
      const incSub: f32 = inc * 0.5;
      let phs: f32 = vPhSub[v]; phs += incSub; if (phs >= 1.0) phs -= 1.0; vPhSub[v] = phs;
      let sub: f32 = phs < 0.5 ? 1.0 : -1.0;
      sub += polyBlep(phs, incSub);
      let p2s: f32 = phs - 0.5; if (p2s < 0.0) p2s += 1.0;
      sub -= polyBlep(p2s, incSub);

      let sig: f32 = osc * 0.5 + sub * subLvl * 0.7 + rngf() * noiseLvl * 0.5;

      // ---- HPF (non-resonant, 4 positions p.18) --------------------------
      // one-pole high-pass whose cutoff rises 0→3; position 0 boosts lows
      if (hpfSel == 0) {
        // bass boost: low shelf via one-pole low-pass added back in
        const lp: f32 = vShelf[v] + 0.10 * (sig - vShelf[v]);
        vShelf[v] = lp;
        sig = sig + lp * 0.7;
      } else if (hpfSel >= 2) {
        const fc: f32 = hpfSel == 2 ? 240.0 : 750.0;
        const a: f32 = 1.0 / (1.0 + TWO_PI * fc / sr);
        const y: f32 = a * (vHpY[v] + sig - vHpX[v]);
        vHpX[v] = sig; vHpY[v] = y;
        sig = y;
      }
      // hpfSel == 1 → flat (unprocessed)

      // ---- VCF cutoff assembly ------------------------------------------
      const keyOct: f32 = f32(Mathf.log2(cur / 261.63));
      let fcOct: f32 = vcfPol * vcfEnvAmt * env * 6.5
                     + vcfKybd * keyOct
                     + vcfLfoAmt * lfo * 3.5
                     + vcfBendOct;
      let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
      fc = clampf(fc, 8.0, sr * 0.45);
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      // 4-pole ladder with saturation + passband makeup (self-oscillates)
      let st0: f32 = vLp0[v]; let st1: f32 = vLp1[v]; let st2: f32 = vLp2[v]; let st3: f32 = vLp3[v];
      let inp: f32 = sig - kRes * st3;
      inp = f32(Mathf.tanh(inp));
      st0 += g * (inp - st0);
      st1 += g * (st0 - st1);
      st2 += g * (st1 - st2);
      st3 += g * (st2 - st3);
      vLp0[v] = st0; vLp1[v] = st1; vLp2[v] = st2; vLp3[v] = st3;
      const y: f32 = st3 * (1.0 + kRes * 0.75);

      mono += y * amp * vcaLevel;
    }

    mono *= voiceScale;

    // ---- CHORUS (stereo BBD, p.29) --------------------------------------
    chWrite = (chWrite + 1) & CH_MASK;
    chL[chWrite] = mono; chR[chWrite] = mono;
    chPh1 += chInc1; if (chPh1 >= 1.0) chPh1 -= 1.0;
    chPh2 += chInc2; if (chPh2 >= 1.0) chPh2 -= 1.0;
    let outL: f32 = mono;
    let outR: f32 = mono;
    if (chorusMode > 0) {
      const m1: f32 = Mathf.sin(TWO_PI * chPh1) * chDepth1;
      const m2: f32 = Mathf.sin(TWO_PI * chPh2) * chDepth2;
      let modS: f32 = 0.0;
      if (chorusMode == 1) modS = m1;
      else if (chorusMode == 2) modS = m2 * 1.15;      // II: faster/deeper
      else modS = m1 + m2;                             // I+II: both, beating
      // L reads center + mod, R reads center - mod → stereo width
      const dL: f32 = chCenter + modS;
      const dR: f32 = chCenter - modS;
      const wetL: f32 = chRead(chL, dL);
      const wetR: f32 = chRead(chR, dR);
      outL = mono * 0.5 + wetL * 0.7;
      outR = mono * 0.5 + wetR * 0.7;
    }

    outL = f32(Mathf.tanh(outL * outGain));
    outR = f32(Mathf.tanh(outR * outGain));
    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }
}

// fractional-delay read from a chorus buffer (linear interp)
@inline function chRead(buf: StaticArray<f32>, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 1.0) d = 1.0;
  const readPos: f32 = f32(chWrite) - d;
  let i0: i32 = i32(Mathf.floor(readPos));
  const frac: f32 = readPos - f32(i0);
  i0 = i0 & CH_MASK;
  let i1: i32 = (i0 + 1) & CH_MASK;
  return buf[i0] + (buf[i1] - buf[i0]) * frac;
}
