// =====================================================================
//  PATCH MONO — a semi-modular monophonic synthesizer modelled
//  behaviour-for-behaviour on the KORG MS-20 (Owner's Manual read cover
//  to cover: 13 pp; block/signal-flow p.4-6, Features & functions
//  p.7-9, patch panel & caution p.10-11, specifications p.11, panel
//  diagram p.13).
//
//  Signal path (p.4 block diagram):
//   VCO-1 (p.7): SCALE 32'/16'/8'/4'; WAVE FORM triangle / sawtooth /
//     rectangle (PW variable) / white-noise; PW knob narrows the
//     rectangle from square (50%) toward silence.
//   VCO-2 (p.7): SCALE 16'/8'/4'/2'; WAVE FORM sawtooth / square /
//     narrow-pulse / RING (VCO1 x VCO2); PITCH +/-1 octave detune.
//   VCO MIXER (p.7): independent VCO-1 / VCO-2 levels.
//   MASTER TUNE (p.7): +/-1 semitone both VCOs. PORTAMENTO: glide.
//   VC HIGH-PASS FILTER (p.8): resonant, self-oscillating at max PEAK;
//     CUTOFF 0 = open (no low cut). VC LOW-PASS FILTER (p.8): resonant,
//     self-oscillating at max PEAK; in SERIES after the HPF (Korg-35).
//   FREQUENCY MODULATION (p.8): MG/T.EXT and EG1/EXT -> VCO pitch.
//   CUTOFF FREQUENCY MODULATION (p.8): MG/T.EXT and EG2/EXT -> HPF, and
//     independently -> LPF.
//   VCA (p.9): controlled by EG2 (+ external initial gain).
//   MG (p.9): LFO, WAVE FORM morph falling-ramp->triangle->rising-ramp
//     (triangle output) plus a rectangle output; FREQUENCY.
//   EG1 (p.9): DELAY / ATTACK / RELEASE modulation envelope (holds at
//     peak while gated).
//   EG2 (p.9): HOLD / ATTACK / DECAY / SUSTAIN / RELEASE.
//   SAMPLE & HOLD (p.10): white noise sampled on the MG rectangle clock.
//   EXTERNAL SIGNAL PROCESSOR (p.10-11): band-pass pre-amp + envelope
//     follower + frequency->voltage pitch converter; normalled here to
//     the internal signal so it is always live.
//   PATCH BAY (p.10): compact 4-cord source->destination routing matrix.
//   CONTROL WHEEL (p.10): programmable, with pitch & cutoff sensitivity.
//
//  Pure algorithm — no samples, no imports, allocation-free in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_V1WAVE: i32 = 0;    // 0 tri,1 saw,2 rect,3 noise
const P_V1PW: i32 = 1;
const P_V1SCALE: i32 = 2;   // 0 32',1 16',2 8',3 4'
const P_V1LEVEL: i32 = 3;
const P_V2WAVE: i32 = 4;    // 0 saw,1 square,2 pulse,3 ring
const P_V2PITCH: i32 = 5;   // -1..1  +/-1 oct
const P_V2SCALE: i32 = 6;   // 0 16',1 8',2 4',3 2'
const P_V2LEVEL: i32 = 7;
const P_TUNE: i32 = 8;      // -1..1  +/-1 semi
const P_PORTA: i32 = 9;
const P_PMG: i32 = 10;      // MG -> pitch
const P_PEG1: i32 = 11;     // EG1 -> pitch
const P_HPFCUT: i32 = 12;
const P_HPFPEAK: i32 = 13;
const P_HPFMG: i32 = 14;
const P_HPFEG2: i32 = 15;
const P_LPFCUT: i32 = 16;
const P_LPFPEAK: i32 = 17;
const P_LPFMG: i32 = 18;
const P_LPFEG2: i32 = 19;
const P_VCAEG2: i32 = 20;
const P_MGFREQ: i32 = 21;
const P_MGWAVE: i32 = 22;
const P_EG1DLY: i32 = 23;
const P_EG1ATK: i32 = 24;
const P_EG1REL: i32 = 25;
const P_EG2HOLD: i32 = 26;
const P_EG2ATK: i32 = 27;
const P_EG2DEC: i32 = 28;
const P_EG2SUS: i32 = 29;
const P_EG2REL: i32 = 30;
const P_VOLUME: i32 = 31;
const P_WHEEL: i32 = 32;
const P_WHPITCH: i32 = 33;
const P_WHLPF: i32 = 34;
const P_ESPLVL: i32 = 35;
const P_ESPLOW: i32 = 36;
const P_ESPHIGH: i32 = 37;
const P_ESPTHR: i32 = 38;
const P_ESPCV: i32 = 39;
const P_P1SRC: i32 = 40;
const P_P1DST: i32 = 41;
const P_P1AMT: i32 = 42;
const P_P2SRC: i32 = 43;
const P_P2DST: i32 = 44;
const P_P2AMT: i32 = 45;
const P_P3SRC: i32 = 46;
const P_P3DST: i32 = 47;
const P_P3AMT: i32 = 48;
const P_P4SRC: i32 = 49;
const P_P4DST: i32 = 50;
const P_P4AMT: i32 = 51;

const NUM_PARAMS: i32 = 52;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 { // -1..1 white noise
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  else if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

// ---- monophonic voice state ------------------------------------------
let vActive: i32 = 0;
let vGate:   i32 = 0;
let vCur:    f32 = 110.0;   // current pitch Hz (glide follows this)
let vTarget: f32 = 110.0;   // target pitch Hz
let liveId:  i32 = -1;

let ph1: f32 = 0.0;   // VCO1 phase
let ph2: f32 = 0.0;   // VCO2 phase
let mgPh: f32 = 0.0;  // MG phase
let mgRectPrev: i32 = 0; // MG rectangle state for S&H clock edge
let shVal: f32 = 0.0; // sample & hold value
let mgRateModPrev: f32 = 0.0; // MG-rate patch modulation (octaves, 1-sample latency)

// EG1 (delay/attack/release): stage 0 idle,1 delay,2 attack,3 hold,4 release
let eg1: f32 = 0.0; let eg1Stage: i32 = 0; let eg1DlyT: f32 = 0.0;
// EG2 (hold/attack/decay/sustain/release): 0 idle,1 atk,2 dec,3 sus,4 hold(post-gate),5 rel
let eg2: f32 = 0.0; let eg2Stage: i32 = 0; let eg2HoldT: f32 = 0.0;

// filters (TPT state-variable, one each)
let hp_ic1: f32 = 0.0; let hp_ic2: f32 = 0.0;
let lp_ic1: f32 = 0.0; let lp_ic2: f32 = 0.0;

// ESP state
let espBp1: f32 = 0.0; let espBp2: f32 = 0.0; // band-pass (2 x 1-pole)
let espHp: f32 = 0.0;
let espEnv: f32 = 0.0;      // envelope follower
let espPitch: f32 = 0.0;    // F->V (normalised -1..1)
let espZprev: f32 = 0.0; let espPeriod: f32 = 0.0; let espSince: f32 = 0.0;
let prevOut: f32 = 0.0;     // last output sample (ESP internal-normal input)

// held-note stack for last-note priority
const HELD_MAX: i32 = 16;
const heldHz: StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const heldId: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let heldCount: i32 = 0;

function midiHz(m: f32): f32 { return 440.0 * Mathf.pow(2.0, (m - 69.0) / 12.0); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vActive = 0; vGate = 0; vCur = 110.0; vTarget = 110.0; liveId = -1;
  ph1 = 0.0; ph2 = 0.0; mgPh = 0.0; mgRectPrev = 0; shVal = 0.0;
  eg1 = 0.0; eg1Stage = 0; eg1DlyT = 0.0;
  eg2 = 0.0; eg2Stage = 0; eg2HoldT = 0.0;
  hp_ic1 = 0.0; hp_ic2 = 0.0; lp_ic1 = 0.0; lp_ic2 = 0.0;
  espBp1 = 0.0; espBp2 = 0.0; espHp = 0.0; espEnv = 0.0; espPitch = 0.0;
  espZprev = 0.0; espPeriod = 0.0; espSince = 0.0; prevOut = 0.0;
  heldCount = 0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_V1WAVE] = 1.0; params[P_V1PW] = 0.5; params[P_V1SCALE] = 2.0; params[P_V1LEVEL] = 0.85;
  params[P_V2WAVE] = 1.0; params[P_V2PITCH] = 0.02; params[P_V2SCALE] = 1.0; params[P_V2LEVEL] = 0.6;
  params[P_TUNE] = 0.0; params[P_PORTA] = 0.12;
  params[P_PMG] = 0.0; params[P_PEG1] = 0.0;
  params[P_HPFCUT] = 0.15; params[P_HPFPEAK] = 0.2; params[P_HPFMG] = 0.0; params[P_HPFEG2] = 0.0;
  params[P_LPFCUT] = 0.5; params[P_LPFPEAK] = 0.45; params[P_LPFMG] = 0.0; params[P_LPFEG2] = 0.55;
  params[P_VCAEG2] = 1.0;
  params[P_MGFREQ] = 0.35; params[P_MGWAVE] = 0.5;
  params[P_EG1DLY] = 0.0; params[P_EG1ATK] = 0.1; params[P_EG1REL] = 0.3;
  params[P_EG2HOLD] = 0.0; params[P_EG2ATK] = 0.02; params[P_EG2DEC] = 0.4; params[P_EG2SUS] = 0.35; params[P_EG2REL] = 0.2;
  params[P_VOLUME] = 0.8;
  params[P_WHEEL] = 0.0; params[P_WHPITCH] = 0.1; params[P_WHLPF] = 0.2;
  params[P_ESPLVL] = 0.0; params[P_ESPLOW] = 0.2; params[P_ESPHIGH] = 0.7; params[P_ESPTHR] = 0.3; params[P_ESPCV] = 0.5;
  params[P_P1SRC] = 0.0; params[P_P1DST] = 0.0; params[P_P1AMT] = 0.5;
  params[P_P2SRC] = 0.0; params[P_P2DST] = 0.0; params[P_P2AMT] = 0.5;
  params[P_P3SRC] = 0.0; params[P_P3DST] = 0.0; params[P_P3AMT] = 0.5;
  params[P_P4SRC] = 0.0; params[P_P4DST] = 0.0; params[P_P4AMT] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- note events (last-note priority) --------------------------------
function trigVoice(hz: f32, legato: i32): void {
  vTarget = hz;
  const portaN: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  if (portaN <= 0.0005) vCur = hz;
  if (legato == 0) {
    // retrigger both envelopes
    eg1Stage = 1; eg1DlyT = 0.0;
    eg2Stage = 1;
  }
  vActive = 1; vGate = 1;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const legato: i32 = (vActive == 1 && vGate == 1) ? 1 : 0;
  if (heldCount < HELD_MAX) { heldHz[heldCount] = hz; heldId[heldCount] = id; heldCount++; }
  trigVoice(hz, legato);
  liveId = id;
}

export function noteOff(id: i32): void {
  // remove from held stack
  let idx: i32 = -1;
  for (let i = 0; i < heldCount; i++) { if (heldId[i] == id) { idx = i; break; } }
  if (idx >= 0) { for (let i = idx; i < heldCount - 1; i++) { heldHz[i] = heldHz[i + 1]; heldId[i] = heldId[i + 1]; } heldCount--; }
  if (heldCount > 0) {
    // fall back to the most recent still-held note (last-note priority)
    trigVoice(heldHz[heldCount - 1], 1);
    liveId = heldId[heldCount - 1];
    return;
  }
  vGate = 0;
  if (eg2Stage != 0) { eg2Stage = 4; eg2HoldT = 0.0; } // enter post-gate HOLD then release
  if (eg1Stage != 0) eg1Stage = 4;
}

// ---- MG waveform: morphing triangle (falling ramp -> tri -> rising) --
@inline function mgTriShape(phase: f32, morph: f32): f32 {
  // morph 0 -> peak at start (falling ramp); 0.5 -> centre triangle;
  // 1 -> peak at end (rising ramp). Output -1..1.
  let pk: f32 = clampf(morph, 0.02, 0.98);
  if (phase < pk) return (phase / pk) * 2.0 - 1.0;
  return (1.0 - (phase - pk) / (1.0 - pk)) * 2.0 - 1.0;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- per-block parameter mapping ------------------------------------
  const v1wave: i32 = pbits(P_V1WAVE);
  const v1pw: f32 = clampf(pget(P_V1PW), 0.0, 1.0);
  const v1scale: i32 = pbits(P_V1SCALE);            // 0 32'..3 4'
  const v1mul: f32 = Mathf.pow(2.0, f32(v1scale) - 2.0); // 8' = 1
  const v1lvl: f32 = clampf(pget(P_V1LEVEL), 0.0, 1.0);

  const v2wave: i32 = pbits(P_V2WAVE);
  const v2pitchOct: f32 = clampf(pget(P_V2PITCH), -1.0, 1.0);   // +/-1 oct
  const v2scale: i32 = pbits(P_V2SCALE);            // 0 16'..3 2'
  const v2mul: f32 = Mathf.pow(2.0, f32(v2scale) - 1.0); // 8' = 1
  const v2lvl: f32 = clampf(pget(P_V2LEVEL), 0.0, 1.0);

  const tuneMul: f32 = Mathf.pow(2.0, clampf(pget(P_TUNE), -1.0, 1.0) * (1.0 / 12.0)); // +/-1 semi
  const portaN: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  const portaSec: f32 = 0.002 + portaN * portaN * 4.0;
  const glideK: f32 = 1.0 - Mathf.exp(-1.0 / (portaSec * sr));

  const pMG: f32 = clampf(pget(P_PMG), 0.0, 1.0);
  const pEG1: f32 = clampf(pget(P_PEG1), 0.0, 1.0);

  const hpfCutN: f32 = clampf(pget(P_HPFCUT), 0.0, 1.0);
  const hpfBase: f32 = 20.0 * Mathf.pow(1000.0, hpfCutN);
  const hpfPeak: f32 = clampf(pget(P_HPFPEAK), 0.0, 1.0);
  const hpfK: f32 = 1.4 - hpfPeak * 1.42;                 // damping; <0 at max PEAK = self-osc
  const hpfMG: f32 = clampf(pget(P_HPFMG), 0.0, 1.0);
  const hpfEG2: f32 = clampf(pget(P_HPFEG2), 0.0, 1.0);

  const lpfCutN: f32 = clampf(pget(P_LPFCUT), 0.0, 1.0);
  const lpfBase: f32 = 20.0 * Mathf.pow(1000.0, lpfCutN);
  const lpfPeak: f32 = clampf(pget(P_LPFPEAK), 0.0, 1.0);
  const lpfK: f32 = 1.4 - lpfPeak * 1.42;                 // damping; <0 at max PEAK = self-osc
  const lpfMG: f32 = clampf(pget(P_LPFMG), 0.0, 1.0);
  const lpfEG2: f32 = clampf(pget(P_LPFEG2), 0.0, 1.0);

  const vcaEG2: f32 = clampf(pget(P_VCAEG2), 0.0, 1.0);

  const mgRateN: f32 = clampf(pget(P_MGFREQ), 0.0, 1.0);
  const mgBaseHz: f32 = 0.1 * Mathf.pow(300.0, mgRateN);   // 0.1..30 Hz
  const mgMorph: f32 = clampf(pget(P_MGWAVE), 0.0, 1.0);

  const eg1DlySec: f32 = 0.001 + clampf(pget(P_EG1DLY),0.0,1.0) * clampf(pget(P_EG1DLY),0.0,1.0) * 5.0;
  const eg1AtkSec: f32 = 0.001 * Mathf.pow(5000.0, clampf(pget(P_EG1ATK),0.0,1.0));
  const eg1RelSec: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_EG1REL),0.0,1.0));
  const eg1AtkK: f32 = 1.0 - Mathf.exp(-1.0 / (eg1AtkSec * sr));
  const eg1RelK: f32 = 1.0 - Mathf.exp(-1.0 / (eg1RelSec * sr));

  const eg2HoldSec: f32 = clampf(pget(P_EG2HOLD),0.0,1.0) * clampf(pget(P_EG2HOLD),0.0,1.0) * 5.0;
  const eg2AtkSec: f32 = 0.001 * Mathf.pow(5000.0, clampf(pget(P_EG2ATK),0.0,1.0));
  const eg2DecSec: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_EG2DEC),0.0,1.0));
  const eg2Sus: f32 = clampf(pget(P_EG2SUS), 0.0, 1.0);
  const eg2RelSec: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_EG2REL),0.0,1.0));
  const eg2AtkK: f32 = 1.0 - Mathf.exp(-1.0 / (eg2AtkSec * sr));
  const eg2DecK: f32 = 1.0 - Mathf.exp(-1.0 / (eg2DecSec * sr));
  const eg2RelK: f32 = 1.0 - Mathf.exp(-1.0 / (eg2RelSec * sr));

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 1.2;

  const wheel: f32 = clampf(pget(P_WHEEL), 0.0, 1.0);
  const whPitch: f32 = clampf(pget(P_WHPITCH), 0.0, 1.0);
  const whLPF: f32 = clampf(pget(P_WHLPF), 0.0, 1.0);

  const espLvl: f32 = clampf(pget(P_ESPLVL), 0.0, 1.0);
  const espLowN: f32 = clampf(pget(P_ESPLOW), 0.0, 1.0);
  const espHighN: f32 = clampf(pget(P_ESPHIGH), 0.0, 1.0);
  const espThr: f32 = clampf(pget(P_ESPTHR), 0.0, 1.0);
  const espCV: f32 = clampf(pget(P_ESPCV), 0.0, 1.0);
  const espLowHz: f32 = 40.0 * Mathf.pow(50.0, espLowN);   // 40..2000 Hz HPF
  const espHighHz: f32 = 300.0 * Mathf.pow(50.0, espHighN); // 0.3..15 kHz LPF
  const espLowG: f32 = 1.0 - Mathf.exp(-TWO_PI * espLowHz / sr);
  const espHighG: f32 = 1.0 - Mathf.exp(-TWO_PI * espHighHz / sr);

  // patch cords
  const pSrc0 = pbits(P_P1SRC), pDst0 = pbits(P_P1DST); const pAmt0 = clampf(pget(P_P1AMT),0.0,1.0);
  const pSrc1 = pbits(P_P2SRC), pDst1 = pbits(P_P2DST); const pAmt1 = clampf(pget(P_P2AMT),0.0,1.0);
  const pSrc2 = pbits(P_P3SRC), pDst2 = pbits(P_P3DST); const pAmt2 = clampf(pget(P_P3AMT),0.0,1.0);
  const pSrc3 = pbits(P_P4SRC), pDst3 = pbits(P_P4DST); const pAmt3 = clampf(pget(P_P4AMT),0.0,1.0);

  for (let f = 0; f < n; f++) {
    // ---- glide --------------------------------------------------------
    if (vCur != vTarget) {
      vCur += (vTarget - vCur) * glideK;
      if (Mathf.abs(vTarget - vCur) < 0.02) vCur = vTarget;
    }

    // ---- MG (two outputs) ---------------------------------------------
    mgPh += (mgBaseHz * Mathf.pow(2.0, mgRateModPrev)) / sr; // MG-rate patch (1-samp latency)
    if (mgPh >= 1.0) mgPh -= 1.0;
    const mgTri: f32 = mgTriShape(mgPh, mgMorph);       // -1..1
    const mgRectWidth: f32 = clampf(mgMorph, 0.05, 0.95);
    const mgRectV: f32 = mgPh < mgRectWidth ? 1.0 : -1.0;
    const mgRectState: i32 = mgPh < mgRectWidth ? 1 : 0;
    // S&H clock: sample noise on rising edge of MG rectangle
    if (mgRectState == 1 && mgRectPrev == 0) shVal = rngf();
    mgRectPrev = mgRectState;

    // ---- EG1 (delay/attack/hold/release) ------------------------------
    if (eg1Stage == 1) {
      eg1DlyT += 1.0 / sr;
      if (eg1DlyT >= eg1DlySec) eg1Stage = 2;
    } else if (eg1Stage == 2) {
      eg1 += eg1AtkK * (1.04 - eg1); if (eg1 >= 1.0) { eg1 = 1.0; eg1Stage = 3; }
    } else if (eg1Stage == 3) {
      // hold at peak while gated
    } else if (eg1Stage == 4) {
      eg1 += eg1RelK * (0.0 - eg1); if (eg1 < 0.0004) { eg1 = 0.0; eg1Stage = 0; }
    }

    // ---- EG2 (hold/attack/decay/sustain/release) ----------------------
    if (eg2Stage == 1) {
      eg2 += eg2AtkK * (1.04 - eg2); if (eg2 >= 1.0) { eg2 = 1.0; eg2Stage = 2; }
    } else if (eg2Stage == 2) {
      eg2 += eg2DecK * (eg2Sus - eg2); if (Mathf.abs(eg2 - eg2Sus) < 0.001) eg2Stage = 3;
    } else if (eg2Stage == 3) {
      eg2 += eg2DecK * (eg2Sus - eg2);
    } else if (eg2Stage == 4) {
      // HOLD: sustain the trigger for a variable time after key release
      eg2HoldT += 1.0 / sr;
      if (eg2HoldT >= eg2HoldSec) eg2Stage = 5;
    } else if (eg2Stage == 5) {
      eg2 += eg2RelK * (0.0 - eg2); if (eg2 < 0.0004) { eg2 = 0.0; eg2Stage = 0; }
    }

    // ---- patch sources ------------------------------------------------
    // kbd CV (key tracking, ~ -1..1 around C4)
    const kbdCV: f32 = clampf(Mathf.log2(vCur / 261.6) * 0.5, -2.0, 2.0);

    // ---- resolve patch cords into destination accumulators ------------
    let mPitch: f32 = 0.0;   // octaves, both VCOs
    let mPitch2: f32 = 0.0;  // octaves, VCO2 only
    let mPW: f32 = 0.0;
    let mHPF: f32 = 0.0;     // octaves
    let mLPF: f32 = 0.0;     // octaves
    let mVCA: f32 = 0.0;     // linear
    let mMGrate: f32 = 0.0;  // octaves (rate), unused per-sample (approx)

    // cord application helper is inlined 4x (no closures in AS)
    // cord 0
    for (let c = 0; c < 4; c++) {
      let src: i32; let dst: i32; let amt: f32;
      if (c == 0) { src = pSrc0; dst = pDst0; amt = pAmt0; }
      else if (c == 1) { src = pSrc1; dst = pDst1; amt = pAmt1; }
      else if (c == 2) { src = pSrc2; dst = pDst2; amt = pAmt2; }
      else { src = pSrc3; dst = pDst3; amt = pAmt3; }
      if (src == 0 || dst == 0 || amt <= 0.0) continue;
      let sv: f32 = 0.0;
      if (src == 1) sv = mgTri;
      else if (src == 2) sv = mgRectV;
      else if (src == 3) sv = eg1;
      else if (src == 4) sv = eg2;
      else if (src == 5) sv = shVal;
      else if (src == 6) sv = rngf();
      else if (src == 7) sv = wheel;
      else if (src == 8) sv = kbdCV;
      else if (src == 9) sv = espEnv;
      else sv = espPitch;
      const a: f32 = sv * amt;
      if (dst == 1) mPitch += a * 3.0;
      else if (dst == 2) mPitch2 += a * 3.0;
      else if (dst == 3) mPW += a * 0.4;
      else if (dst == 4) mHPF += a * 5.0;
      else if (dst == 5) mLPF += a * 6.0;
      else if (dst == 6) mVCA += a * 0.5;
      else mMGrate += a * 3.0;
    }
    mgRateModPrev = mMGrate;

    // ---- pitch --------------------------------------------------------
    const pitchOct: f32 = mgTri * pMG * 0.5
      + eg1 * pEG1 * 3.0
      + wheel * whPitch * 1.0
      + mPitch;
    const baseHz: f32 = vCur * tuneMul * Mathf.pow(2.0, pitchOct);
    let hz1: f32 = baseHz * v1mul;
    let hz2: f32 = baseHz * v2mul * Mathf.pow(2.0, v2pitchOct + mPitch2);
    if (hz1 < 0.01) hz1 = 0.01; if (hz2 < 0.01) hz2 = 0.01;
    let inc1: f32 = hz1 / sr; if (inc1 > 0.45) inc1 = 0.45;
    let inc2: f32 = hz2 / sr; if (inc2 > 0.45) inc2 = 0.45;

    // ---- VCO-1 --------------------------------------------------------
    ph1 += inc1; if (ph1 >= 1.0) ph1 -= 1.0;
    let v1: f32 = 0.0;
    if (v1wave == 0) {            // triangle
      v1 = ph1 < 0.5 ? (ph1 * 4.0 - 1.0) : (3.0 - ph1 * 4.0);
    } else if (v1wave == 1) {     // sawtooth
      v1 = 2.0 * ph1 - 1.0; v1 -= polyBlep(ph1, inc1);
    } else if (v1wave == 2) {     // rectangle (PW)
      let pw: f32 = clampf(0.5 - (v1pw + mPW) * 0.47, 0.02, 0.98);
      v1 = ph1 < pw ? 1.0 : -1.0;
      v1 += polyBlep(ph1, inc1);
      let p2: f32 = ph1 - pw; if (p2 < 0.0) p2 += 1.0;
      v1 -= polyBlep(p2, inc1);
    } else {                      // white noise
      v1 = rngf();
    }

    // ---- VCO-2 --------------------------------------------------------
    ph2 += inc2; if (ph2 >= 1.0) ph2 -= 1.0;
    let v2: f32 = 0.0;
    if (v2wave == 0) {            // sawtooth
      v2 = 2.0 * ph2 - 1.0; v2 -= polyBlep(ph2, inc2);
    } else if (v2wave == 1) {     // square
      v2 = ph2 < 0.5 ? 1.0 : -1.0;
      v2 += polyBlep(ph2, inc2);
      let p2: f32 = ph2 - 0.5; if (p2 < 0.0) p2 += 1.0;
      v2 -= polyBlep(p2, inc2);
    } else if (v2wave == 2) {     // narrow pulse
      const pw: f32 = 0.15;
      v2 = ph2 < pw ? 1.0 : -1.0;
      v2 += polyBlep(ph2, inc2);
      let p2: f32 = ph2 - pw; if (p2 < 0.0) p2 += 1.0;
      v2 -= polyBlep(p2, inc2);
    } else {                      // ring modulator: VCO1 x VCO2(square)
      const sq2: f32 = ph2 < 0.5 ? 1.0 : -1.0;
      const base1: f32 = (v1wave == 3) ? v1 : (2.0 * ph1 - 1.0);
      v2 = base1 * sq2;
    }

    // ---- VCO MIXER ----------------------------------------------------
    let mixed: f32 = v1 * v1lvl + v2 * v2lvl;
    mixed *= 0.6;

    // ---- ESP band-pass pre-amp (internal-normal input = prev output) --
    const espIn: f32 = prevOut;
    espHp += espLowG * (espIn - espHp);          // low-cut: subtract lp
    let espHiPass: f32 = espIn - espHp;
    espBp1 += espHighG * (espHiPass - espBp1);   // high-cut lowpass
    const espBand: f32 = espBp1;
    // envelope follower (rectify + smooth, gated by threshold)
    let rectv: f32 = espBand < 0.0 ? -espBand : espBand;
    rectv = rectv > espThr ? (rectv - espThr) : 0.0;
    espEnv += (rectv * 2.0 - espEnv) * 0.002;
    if (espEnv < 0.0) espEnv = 0.0; if (espEnv > 1.0) espEnv = 1.0;
    // F->V pitch converter (period from zero-crossings)
    espSince += 1.0;
    if (espZprev <= 0.0 && espBand > 0.0 && espEnv > 0.02) {
      if (espSince > 1.0 && espSince < sr) espPeriod = espSince;
      espSince = 0.0;
    }
    espZprev = espBand;
    if (espPeriod > 0.0) {
      const espFreq: f32 = sr / espPeriod;
      espPitch = clampf(Mathf.log2(espFreq / 261.6) * espCV, -2.0, 2.0);
    }
    // mix ESP band-pass back into the audio path (per manual: instrument
    // sound can be mixed with the synth)
    mixed += espBand * espLvl * 1.5;

    // ---- HPF (self-oscillating SVF, high-pass out) --------------------
    let hpfCutOct: f32 = mgTri * hpfMG * 4.0 + eg2 * hpfEG2 * 5.0 + mHPF;
    let hpFc: f32 = clampf(hpfBase * Mathf.pow(2.0, hpfCutOct), 10.0, sr * 0.45);
    let hpfG: f32 = Mathf.tan(PI * hpFc / sr);
    let hpfA1: f32 = 1.0 / (1.0 + hpfG * (hpfG + hpfK));
    const hpfSeed: f32 = rngf() * 0.0015; // seeds self-oscillation
    let hpfV3: f32 = (mixed + hpfSeed) - hp_ic2;
    let hpfV1: f32 = hpfA1 * hp_ic1 + hpfA1 * hpfG * hpfV3;
    let hpfV2: f32 = hp_ic2 + hpfG * hpfV1;
    // soft-clip the resonance integrator so self-oscillation limits (analog-like)
    hp_ic1 = 2.0 * Mathf.tanh((2.0 * hpfV1 - hp_ic1) * 0.5);
    hp_ic2 = 2.0 * hpfV2 - hp_ic2;
    let afterHP: f32 = (mixed + hpfSeed) - hpfK * hpfV1 - hpfV2; // hp output
    afterHP = Mathf.tanh(afterHP);

    // ---- LPF (self-oscillating SVF, low-pass out) --------------------
    let lpfCutOct: f32 = mgTri * lpfMG * 4.0 + eg2 * lpfEG2 * 6.0
      + wheel * whLPF * 4.0 + mLPF;
    let lpFc: f32 = clampf(lpfBase * Mathf.pow(2.0, lpfCutOct), 10.0, sr * 0.45);
    let lpfG: f32 = Mathf.tan(PI * lpFc / sr);
    let lpfA1: f32 = 1.0 / (1.0 + lpfG * (lpfG + lpfK));
    const lpfSeed: f32 = rngf() * 0.0015;
    let lpfV3: f32 = (afterHP + lpfSeed) - lp_ic2;
    let lpfV1: f32 = lpfA1 * lp_ic1 + lpfA1 * lpfG * lpfV3;
    let lpfV2: f32 = lp_ic2 + lpfG * lpfV1;
    // soft-clip the resonance integrator so self-oscillation limits (analog-like)
    lp_ic1 = 2.0 * Mathf.tanh((2.0 * lpfV1 - lp_ic1) * 0.5);
    lp_ic2 = 2.0 * lpfV2 - lp_ic2;
    let filt: f32 = Mathf.tanh(lpfV2); // low-pass output

    // ---- VCA ----------------------------------------------------------
    const amp: f32 = clampf(eg2 * vcaEG2 + mVCA, 0.0, 1.6);
    let outSig: f32 = filt * amp;

    if (vActive == 1 && eg2Stage == 0 && eg2 <= 0.0004 && vGate == 0) vActive = 0;

    const out: f32 = Mathf.tanh(outSig * outGain);
    prevOut = out;
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
