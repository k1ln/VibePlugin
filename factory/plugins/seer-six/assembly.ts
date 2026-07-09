// =====================================================================
//  SEER SIX — a six-voice polyphonic analog instrument modelled
//  feature-for-feature on the Sequential Prophet-6 (Operation Manual 2.1,
//  read cover to cover — every program parameter in the NRPN appendix is
//  represented here).
//
//  Per voice: two VCOs with CONTINUOUSLY VARIABLE waveshape
//  (triangle→sawtooth→variable-width pulse, polyBLEP band-limited),
//  oscillator-1 hard sync (osc 2 is the master), triangle sub-octave on
//  osc 1, white noise, a resonant self-oscillating 4-pole low-pass ladder
//  and a resonant 2-pole state-variable high-pass, one shared ADSR filter
//  envelope with independent BIPOLAR amounts per filter, velocity switches
//  and off/half/full key tracking, and an ADSR amplifier envelope with
//  amount + velocity.  Global: Slop (vintage drift), Glide (4 modes:
//  fixed rate / fixed time / legato variants), LFO (tri, saw, rev-saw,
//  square, random S&H — plus the manual's hidden 6th "noise" shape when
//  Random is chosen and FREQUENCY is full clockwise), clock-syncable, with
//  the six panel destinations; Poly Mod (filter env + osc 2 → osc 1
//  freq / shape / PW, LPF, HPF); Aftertouch section (Pressure control ×
//  bipolar amount → freq 1, freq 2, LFO amt, amp, LPF, HPF); Unison with
//  1–6-voice stacking, CHORD MEMORY and all six key-assign modes
//  (LO/LOr/HI/HIr/LAS/LAr); Pan Spread (alternating per-voice pan);
//  stereo analog-style Distortion; dual digital effects in series —
//  A: bbd, ddl, chorus, 3 phasers, ring mod (with low-note tracking),
//  2 flangers; B adds hall/room/plate/spring reverbs — with per-effect
//  mix and clock-synced delay times (max 1 s, halving rule from the
//  manual); a 5-mode 1–3-octave arpeggiator with Hold relatch and the ten
//  clock divisions (dotted / swing / triplet); and a 64-step polyphonic
//  sequencer (6 notes per step, rests via noteOn id -2, ties via id -3,
//  key transpose around middle C while Rec+Play).  Spring-loaded pitch
//  wheel (0–12 semitone range) and mod wheel (adds LFO amount) included.
//
//  Switch groups are bit-packed so the whole instrument fits the 64-param
//  host pool; the GUI decodes them into the individual panel switches.
//  Pure algorithm — no samples, no host imports, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;
const HELD_MAX: i32 = 16;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_O1FREQ: i32 = 0;   // 0..60 semitones (24 = played pitch)
const P_O1SHAPE: i32 = 1;  // 0..1 tri→saw→pulse morph
const P_O1PW: i32 = 2;     // 0..1 (centre = square, edges = narrow)
const P_OSCSW: i32 = 3;    // bit0 sync, bit1 osc2 low freq, bit2 osc2 kbd OFF
const P_O2FREQ: i32 = 4;   // 0..60 semitones
const P_O2FINE: i32 = 5;   // -1..1 → ±50 cents
const P_O2SHAPE: i32 = 6;
const P_O2PW: i32 = 7;
const P_MIXO1: i32 = 8;
const P_MIXO2: i32 = 9;
const P_MIXSUB: i32 = 10;
const P_MIXNOI: i32 = 11;
const P_SLOP: i32 = 12;
const P_GLRATE: i32 = 13;
const P_GLMODE: i32 = 14;  // bit0 on; bits1-2 mode: 0 FR, 1 FRA, 2 FT, 3 FTA
const P_LPCUT: i32 = 15;
const P_LPRES: i32 = 16;
const P_LPENV: i32 = 17;   // -1..1
const P_HPCUT: i32 = 18;
const P_HPRES: i32 = 19;
const P_HPENV: i32 = 20;   // -1..1
const P_KEYTRK: i32 = 21;  // lp(0..2) + 3*hp(0..2): 0 off, 1 half, 2 full
const P_VELRT: i32 = 22;   // bit0 lp vel, bit1 hp vel, bit2 vca vel
const P_FA: i32 = 23;
const P_FD: i32 = 24;
const P_FS: i32 = 25;
const P_FR: i32 = 26;
const P_AA: i32 = 27;
const P_AD: i32 = 28;
const P_AS: i32 = 29;
const P_AR: i32 = 30;
const P_VCAAMT: i32 = 31;
const P_LFOF: i32 = 32;
const P_LFOA: i32 = 33;
const P_LFOSHP: i32 = 34;  // 0 tri, 1 saw, 2 rev saw, 3 square, 4 random
const P_LFOSYN: i32 = 35;
const P_LFODST: i32 = 36;  // bits: freq1, freq2, pw1+2, amp, lpf, hpf
const P_PMFE: i32 = 37;    // -1..1
const P_PMO2: i32 = 38;    // -1..1
const P_PMDST: i32 = 39;   // bits: freq1, shape1, pw1, lpf, hpf
const P_ATAMT: i32 = 40;   // -1..1
const P_ATDST: i32 = 41;   // bits: freq1, freq2, lfo amt, amp, lpf, hpf
const P_PRESS: i32 = 42;   // 0..1 channel pressure (performance)
const P_FXMODE: i32 = 43;  // bit0 FX on, bit1 fx1 sync, bit2 fx2 sync
const P_FX1TYP: i32 = 44;  // 0 off,1 bbd,2 ddl,3 cho,4 ph1,5 ph2,6 ph3,7 rin,8 fl1,9 fl2
const P_FX1MIX: i32 = 45;
const P_FX1P1: i32 = 46;
const P_FX1P2: i32 = 47;
const P_FX2TYP: i32 = 48;  // + 10 hal, 11 roo, 12 pla, 13 spr
const P_FX2MIX: i32 = 49;
const P_FX2P1: i32 = 50;
const P_FX2P2: i32 = 51;
const P_DIST: i32 = 52;
const P_UNISON: i32 = 53;  // 0 off, 1..6 stack of 1..6 voices, 7 chord memory
const P_KEYMODE: i32 = 54; // 0 LO,1 LOr,2 HI,3 HIr,4 LAS,5 LAr
const P_PANSPR: i32 = 55;
const P_TRANS: i32 = 56;   // bit0 arp on, bit1 hold, bit2 seq record, bit3 seq play
const P_ARPPAT: i32 = 57;  // mode(0..4) + 5*range(0..2)
const P_BPM: i32 = 58;     // 30..250
const P_CLKVAL: i32 = 59;  // 0 half,1 qtr,2 8th,3 8thD,4 8thS,5 8thT,6 16th,7 16thS,8 16thT,9 32nd
const P_PBWHEEL: i32 = 60; // -1..1 spring loaded
const P_PBRANGE: i32 = 61; // 0..12 semitones
const P_MODWHL: i32 = 62;  // 0..1 adds LFO amount
const P_VOLUME: i32 = 63;

// ---- small helpers ---------------------------------------------------
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

// continuously-variable waveshape: 0 triangle → 0.5 sawtooth → 1 pulse
@inline function morphOsc(ph: f32, inc: f32, shape: f32, pw: f32): f32 {
  // triangle (naive; lowest-harmonic shape, aliasing negligible)
  const tri: f32 = ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph;
  // band-limited saw
  let saw: f32 = 2.0 * ph - 1.0;
  saw -= polyBlep(ph, inc);
  if (shape < 0.5) {
    const t: f32 = shape * 2.0;
    return tri * (1.0 - t) + saw * t;
  }
  // band-limited pulse of width pw via two phase-shifted BLEP edges
  let sq: f32 = ph < pw ? 1.0 : -1.0;
  sq += polyBlep(ph, inc);
  let ph2: f32 = ph - pw; if (ph2 < 0.0) ph2 += 1.0;
  sq -= polyBlep(ph2, inc);
  const t2: f32 = (shape - 0.5) * 2.0;
  return saw * (1.0 - t2) + sq * t2;
}

// PULSE WIDTH knob: centre = square, hard left/right = very narrow (manual p.18)
@inline function pwFromKnob(k: f32): f32 {
  let d: f32 = k * 2.0 - 1.0; if (d < 0.0) d = -d;
  return 0.5 - 0.46 * d;
}

// knob → seconds, 1 ms .. 10 s (exponential)
@inline function envTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(n, 0.0, 1.0))); }

// ---- voice state ------------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // source id (key id, or -1000-step for seq/arp)
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // target freq Hz
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide state Hz
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // per-sample multiplier
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhSub:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vO2Last: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // poly-mod source
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vHpL: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // SVF low state
const vHpB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // SVF band state
// slop random-walk per voice per osc
const vSlop1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSlop2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSlopT1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSlopT2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
let slopCounter: i32 = 0;
let ageCounter: i32 = 0;
let lastPlayedHz: f32 = 261.63; // glide source

// ---- held-key list (arp / unison priority / chord capture) -----------
const hId:   StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq: StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hPhys: StaticArray<i32> = new StaticArray<i32>(HELD_MAX); // 1 = key physically down
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;

// ---- arpeggiator ------------------------------------------------------
let arpPos: i32 = 0;         // slot index into the expanded pattern
let arpDirUp: i32 = 1;       // for up+down
let arpGate: i32 = 0;        // samples until arp note release
let clockAcc: f32 = 0.0;     // samples until next clock step
let swingFlip: i32 = 0;

// ---- sequencer --------------------------------------------------------
const SEQ_STEPS: i32 = 64;
const seqFreq: StaticArray<f32> = new StaticArray<f32>(SEQ_STEPS * 6);
const seqVel:  StaticArray<f32> = new StaticArray<f32>(SEQ_STEPS * 6);
const seqCnt:  StaticArray<i32> = new StaticArray<i32>(SEQ_STEPS);
const seqDur:  StaticArray<i32> = new StaticArray<i32>(SEQ_STEPS); // steps held (ties extend)
let seqLen: i32 = 0;
let seqPos: i32 = 0;
let seqWait: i32 = 0;        // steps remaining in the current (possibly tied) step
let seqGate: i32 = 0;        // samples until seq voices release
let seqTranspose: f32 = 1.0; // ratio around middle C
let recHeld: i32 = 0;        // keys still down inside the step being recorded
let lastTransport: i32 = 0;
let lastUnison: i32 = -1;

// ---- chord memory -----------------------------------------------------
const chordRatio: StaticArray<f32> = new StaticArray<f32>(6);
const chordVel:   StaticArray<f32> = new StaticArray<f32>(6);
let chordCount: i32 = 1;

// ---- LFO --------------------------------------------------------------
let lfoPhase: f32 = 0.0;
let lfoSH: f32 = 0.0;        // sample & hold value
let lfoVal: f32 = 0.0;

// ---- FX engines -------------------------------------------------------
const DL_LEN: i32 = 98304;   // > 1 s at 96 kHz
const dl0L: StaticArray<f32> = new StaticArray<f32>(DL_LEN);
const dl0R: StaticArray<f32> = new StaticArray<f32>(DL_LEN);
const dl1L: StaticArray<f32> = new StaticArray<f32>(DL_LEN);
const dl1R: StaticArray<f32> = new StaticArray<f32>(DL_LEN);
const fxW:    StaticArray<i32> = new StaticArray<i32>(2);
const fxPh:   StaticArray<f32> = new StaticArray<f32>(2); // mod / carrier phase
const fxLpL:  StaticArray<f32> = new StaticArray<f32>(2); // loop-filter states
const fxLpR:  StaticArray<f32> = new StaticArray<f32>(2);
const fxFbL:  StaticArray<f32> = new StaticArray<f32>(2);
const fxFbR:  StaticArray<f32> = new StaticArray<f32>(2);
const fxLast: StaticArray<i32> = new StaticArray<i32>(2);
// phaser / spring allpass states: engine * 2ch * 8 stages
const apState: StaticArray<f32> = new StaticArray<f32>(2 * 2 * 8);
// reverb (engine 1 only): 8 combs + 4 allpasses per channel
const CMB_LEN: i32 = 4096;
const RAP_LEN: i32 = 2048;
const rvCmb: StaticArray<f32> = new StaticArray<f32>(16 * CMB_LEN);
const rvCmbI: StaticArray<i32> = new StaticArray<i32>(16);
const rvDamp: StaticArray<f32> = new StaticArray<f32>(16);
const rvAp: StaticArray<f32> = new StaticArray<f32>(8 * RAP_LEN);
const rvApI: StaticArray<i32> = new StaticArray<i32>(8);
// Freeverb-derived comb/allpass tunings (samples at 44.1 kHz)
const cmbTune: StaticArray<f32> = new StaticArray<f32>(8);
const apTune: StaticArray<f32> = new StaticArray<f32>(4);

// arp clock divisions, in beats per step (manual p.40):
// half, qtr, 8th, 8th dot, 8th swing, 8th triplet, 16th, 16th swing, 16th triplet, 32nd
const clkBeats: StaticArray<f32> = new StaticArray<f32>(10);
// synced delay-time table, in beats (manual p.31)
const syncBeats: StaticArray<f32> = new StaticArray<f32>(11);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0;
    vTarget[v] = 261.63; vCur[v] = 261.63; vGlideK[v] = 1.0; vVel[v] = 0.0;
    vPh1[v] = 0.0; vPh2[v] = 0.0; vPhSub[v] = 0.0; vO2Last[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0; vFEnv[v] = 0.0; vFStage[v] = 0;
    vLp0[v] = 0.0; vLp1[v] = 0.0; vLp2[v] = 0.0; vLp3[v] = 0.0;
    vHpL[v] = 0.0; vHpB[v] = 0.0;
    vSlop1[v] = 0.0; vSlop2[v] = 0.0; vSlopT1[v] = 0.0; vSlopT2[v] = 0.0;
  }
  hCount = 0; orderCounter = 0; ageCounter = 0; slopCounter = 0;
  arpPos = 0; arpDirUp = 1; arpGate = 0; clockAcc = 0.0; swingFlip = 0;
  seqLen = 0; seqPos = 0; seqWait = 0; seqGate = 0; seqTranspose = 1.0; recHeld = 0;
  lastTransport = 0; lastUnison = -1;
  // factory chord-memory voicing (root + fifth + octave) until one is captured
  chordCount = 3;
  chordRatio[0] = 1.0; chordRatio[1] = 1.5; chordRatio[2] = 2.0;
  chordVel[0] = 1.0; chordVel[1] = 1.0; chordVel[2] = 1.0;
  lfoPhase = 0.0; lfoSH = 0.0; lfoVal = 0.0;
  lastPlayedHz = 261.63;
  for (let i = 0; i < DL_LEN; i++) { dl0L[i] = 0.0; dl0R[i] = 0.0; dl1L[i] = 0.0; dl1R[i] = 0.0; }
  for (let i = 0; i < 16 * CMB_LEN; i++) rvCmb[i] = 0.0;
  for (let i = 0; i < 8 * RAP_LEN; i++) rvAp[i] = 0.0;
  for (let i = 0; i < 16; i++) { rvCmbI[i] = 0; rvDamp[i] = 0.0; }
  for (let i = 0; i < 8; i++) rvApI[i] = 0;
  for (let i = 0; i < 32; i++) apState[i] = 0.0;
  for (let e = 0; e < 2; e++) { fxW[e] = 0; fxPh[e] = 0.0; fxLpL[e] = 0.0; fxLpR[e] = 0.0; fxFbL[e] = 0.0; fxFbR[e] = 0.0; fxLast[e] = -1; }
  cmbTune[0] = 1116.0; cmbTune[1] = 1188.0; cmbTune[2] = 1277.0; cmbTune[3] = 1356.0;
  cmbTune[4] = 1422.0; cmbTune[5] = 1491.0; cmbTune[6] = 1557.0; cmbTune[7] = 1617.0;
  apTune[0] = 556.0; apTune[1] = 441.0; apTune[2] = 341.0; apTune[3] = 225.0;
  clkBeats[0] = 2.0; clkBeats[1] = 1.0; clkBeats[2] = 0.5; clkBeats[3] = 0.75;
  clkBeats[4] = 0.5; clkBeats[5] = 0.3333333; clkBeats[6] = 0.25; clkBeats[7] = 0.25;
  clkBeats[8] = 0.1666667; clkBeats[9] = 0.125;
  syncBeats[0] = 4.0; syncBeats[1] = 3.0; syncBeats[2] = 2.0; syncBeats[3] = 1.3333334;
  syncBeats[4] = 1.5; syncBeats[5] = 1.0; syncBeats[6] = 0.75; syncBeats[7] = 0.5;
  syncBeats[8] = 0.3333333; syncBeats[9] = 0.375; syncBeats[10] = 0.25;

  // musically sensible boot state (matches spec.json defaults)
  params[P_O1FREQ] = 24.0; params[P_O1SHAPE] = 0.5; params[P_O1PW] = 0.5; params[P_OSCSW] = 0.0;
  params[P_O2FREQ] = 24.0; params[P_O2FINE] = 0.14; params[P_O2SHAPE] = 0.5; params[P_O2PW] = 0.5;
  params[P_MIXO1] = 0.8; params[P_MIXO2] = 0.65; params[P_MIXSUB] = 0.25; params[P_MIXNOI] = 0.0;
  params[P_SLOP] = 0.08; params[P_GLRATE] = 0.12; params[P_GLMODE] = 0.0;
  params[P_LPCUT] = 0.55; params[P_LPRES] = 0.25; params[P_LPENV] = 0.4;
  params[P_HPCUT] = 0.0; params[P_HPRES] = 0.1; params[P_HPENV] = 0.0;
  params[P_KEYTRK] = 1.0; params[P_VELRT] = 5.0;
  params[P_FA] = 0.05; params[P_FD] = 0.4; params[P_FS] = 0.3; params[P_FR] = 0.25;
  params[P_AA] = 0.02; params[P_AD] = 0.5; params[P_AS] = 0.75; params[P_AR] = 0.3;
  params[P_VCAAMT] = 1.0;
  params[P_LFOF] = 0.45; params[P_LFOA] = 0.08; params[P_LFOSHP] = 0.0; params[P_LFOSYN] = 0.0; params[P_LFODST] = 3.0;
  params[P_PMFE] = 0.15; params[P_PMO2] = 0.0; params[P_PMDST] = 8.0;
  params[P_ATAMT] = 0.3; params[P_ATDST] = 16.0; params[P_PRESS] = 0.0;
  params[P_FXMODE] = 1.0; params[P_FX1TYP] = 3.0; params[P_FX1MIX] = 0.35; params[P_FX1P1] = 0.4; params[P_FX1P2] = 0.5;
  params[P_FX2TYP] = 10.0; params[P_FX2MIX] = 0.3; params[P_FX2P1] = 0.5; params[P_FX2P2] = 0.35;
  params[P_DIST] = 0.06; params[P_UNISON] = 0.0; params[P_KEYMODE] = 0.0; params[P_PANSPR] = 0.55;
  params[P_TRANS] = 0.0; params[P_ARPPAT] = 5.0; params[P_BPM] = 120.0; params[P_CLKVAL] = 2.0;
  params[P_PBWHEEL] = 0.0; params[P_PBRANGE] = 2.0; params[P_MODWHL] = 0.0; params[P_VOLUME] = 0.75;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 64; }

// ---- glide setup ------------------------------------------------------
function computeGlideK(v: i32, legato: i32): void {
  const gm: i32 = pbits(P_GLMODE);
  const on: i32 = gm & 1;
  const mode: i32 = (gm >> 1) & 3; // 0 FR, 1 FRA, 2 FT, 3 FTA
  const rate: f32 = clampf(pget(P_GLRATE), 0.0, 1.0);
  vGlideK[v] = 1.0; // 1 = jump instantly
  if (on == 0 || rate <= 0.0) { vCur[v] = vTarget[v]; return; }
  if ((mode == 1 || mode == 3) && legato == 0) { vCur[v] = vTarget[v]; return; } // legato-only variants
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  // gk is the per-sample multiplicative step, already pointing at the target
  if (mode < 2) {
    // FIXED RATE: constant octaves/second → bigger intervals take longer
    const octPerSec: f32 = 80.0 * f32(Mathf.pow(0.008, rate)); // 80 → 0.64 oct/s
    const step: f32 = f32(Mathf.pow(2.0, octPerSec / sampleRate));
    vGlideK[v] = vTarget[v] > vCur[v] ? step : 1.0 / step;
  } else {
    // FIXED TIME: the whole interval always takes the same time
    const t: f32 = 0.01 + rate * rate * 4.0; // 10 ms .. 4 s
    const nSmp: f32 = t * sampleRate;
    const ratio: f32 = vTarget[v] / vCur[v];
    vGlideK[v] = f32(Mathf.pow(ratio, 1.0 / nSmp));
  }
}

// ---- internal voice trigger / release ---------------------------------
function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function triggerVoice(slot: i32, id: i32, hz: f32, vel: f32, retrig: i32, legato: i32): void {
  vNote[slot] = id;
  vTarget[slot] = hz > 0.0 ? hz : 1.0;
  if (vActive[slot] == 0 || retrig == 1) {
    vCur[slot] = lastPlayedHz;
    vAStage[slot] = 1; vFStage[slot] = 1;
    if (vActive[slot] == 0) { vAEnv[slot] = 0.0; vFEnv[slot] = 0.0; }
    vPh1[slot] = 0.0; vPh2[slot] = 0.37; vPhSub[slot] = 0.0;
    vLp0[slot] = 0.0; vLp1[slot] = 0.0; vLp2[slot] = 0.0; vLp3[slot] = 0.0;
    vHpL[slot] = 0.0; vHpB[slot] = 0.0;
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot, legato);
  vAge[slot] = ageCounter++;
  lastPlayedHz = hz;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4;
    }
  }
}
function releaseAllVoices(): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4; }
  }
}

// ---- unison / key-assign ----------------------------------------------
function physCount(): i32 {
  let c: i32 = 0;
  for (let i = 0; i < hCount; i++) if (hPhys[i] == 1) c++;
  return c;
}

// pick the sounding key per KEY MODE priority (unison): LO/HI/LAS (+r variants)
function unisonRetune(newPress: i32): void {
  const uni: i32 = pbits(P_UNISON);
  if (uni == 0) return;
  if (hCount == 0) { releaseAllVoices(); return; }
  const km: i32 = pbits(P_KEYMODE);
  let pick: i32 = 0;
  if (km <= 1) {         // low note
    for (let i = 1; i < hCount; i++) if (hFreq[i] < hFreq[pick]) pick = i;
  } else if (km <= 3) {  // high note
    for (let i = 1; i < hCount; i++) if (hFreq[i] > hFreq[pick]) pick = i;
  } else {               // last note
    for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i;
  }
  const retrigMode: i32 = km & 1; // LOr(1) HIr(3) LAr(5) → retrigger every keystroke
  let retrig: i32 = 0;
  if (newPress == 1) retrig = retrigMode == 1 ? 1 : (physCount() > 1 ? 0 : 1);
  const legato: i32 = physCount() > 1 ? 1 : 0;
  const baseHz: f32 = hFreq[pick];
  const vel: f32 = hVel[pick];
  // stack: 1..6 voices, or the memorized chord
  let stack: i32 = uni;
  let isChord: i32 = 0;
  if (uni == 7) { stack = chordCount; isChord = 1; }
  if (stack > NUM_VOICES) stack = NUM_VOICES;
  for (let s = 0; s < stack; s++) {
    const hz: f32 = isChord == 1 ? baseHz * chordRatio[s] : baseHz;
    triggerVoice(s, hId[pick], hz, vel, retrig, legato);
  }
  for (let s = stack; s < NUM_VOICES; s++) {
    if (vActive[s] == 1 && vGate[s] == 1) { vGate[s] = 0; vAStage[s] = 4; vFStage[s] = 4; }
  }
}

// ---- held-list maintenance ---------------------------------------------
function heldAdd(id: i32, hz: f32, vel: f32): void {
  const hold: i32 = (pbits(P_TRANS) >> 1) & 1;
  // HOLD relatch: all keys were released → a new key starts a fresh latch
  if (hold == 1 && physCount() == 0 && hCount > 0) {
    hCount = 0;
    releaseAllVoices();
  }
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) { hPhys[i] = 1; hFreq[i] = hz; hVel[i] = vel; hOrder[i] = orderCounter++; return; }
  }
  if (hCount >= HELD_MAX) { // drop the oldest entry
    for (let i = 1; i < hCount; i++) {
      hId[i - 1] = hId[i]; hFreq[i - 1] = hFreq[i]; hVel[i - 1] = hVel[i];
      hPhys[i - 1] = hPhys[i]; hOrder[i - 1] = hOrder[i];
    }
    hCount--;
  }
  hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = vel;
  hPhys[hCount] = 1; hOrder[hCount] = orderCounter++;
  hCount++;
}

function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i + 1; j < hCount; j++) {
        hId[j - 1] = hId[j]; hFreq[j - 1] = hFreq[j]; hVel[j - 1] = hVel[j];
        hPhys[j - 1] = hPhys[j]; hOrder[j - 1] = hOrder[j];
      }
      hCount--;
      return;
    }
  }
}

// ---- sequencer recording ------------------------------------------------
function seqRecordNote(hz: f32, vel: f32): void {
  if (seqLen >= SEQ_STEPS && recHeld == 0) return;
  if (recHeld > 0 && seqLen > 0) {
    // chord: keys still down inside this step → append to it
    const s: i32 = seqLen - 1;
    const c: i32 = seqCnt[s];
    if (c < 6) { seqFreq[s * 6 + c] = hz; seqVel[s * 6 + c] = vel; seqCnt[s] = c + 1; }
  } else if (seqLen < SEQ_STEPS) {
    const s: i32 = seqLen;
    seqFreq[s * 6] = hz; seqVel[s * 6] = vel; seqCnt[s] = 1; seqDur[s] = 1;
    seqLen++;
  }
  recHeld++;
}
function seqRecordRest(): void {
  if (seqLen < SEQ_STEPS) { seqCnt[seqLen] = 0; seqDur[seqLen] = 1; seqLen++; }
}
function seqRecordTie(): void {
  if (seqLen > 0) seqDur[seqLen - 1] = seqDur[seqLen - 1] + 1;
}

// ---- note events (host / GUI) -------------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  const tr: i32 = pbits(P_TRANS);
  const arpOn: i32 = tr & 1;
  const seqRec: i32 = (tr >> 2) & 1;
  const seqPlay: i32 = (tr >> 3) & 1;

  // rest / tie markers while recording (GUI sends noteOn with id -2 / -3)
  if (id == -2) { if (seqRec == 1) seqRecordRest(); return; }
  if (id == -3) { if (seqRec == 1) seqRecordTie(); return; }
  if (hz <= 0.0) return;

  if (seqRec == 1 && seqPlay == 1 && seqLen > 0) {
    // Rec+Play = transpose mode: the key sets the transpose around middle C
    seqTranspose = hz / 261.63;
    return;
  }
  if (seqRec == 1 && seqPlay == 0) seqRecordNote(hz, vel);

  heldAdd(id, hz, vel);

  const uni: i32 = pbits(P_UNISON);
  const seqRunning: i32 = (seqPlay == 1 && seqLen > 0) ? 1 : 0;
  if (arpOn == 1 && seqRunning == 0) return;         // arp owns the voices
  if (uni > 0) { unisonRetune(1); return; }          // mono stack w/ key priority
  const slot: i32 = allocVoice();
  triggerVoice(slot, id, hz, vel, 1, physCount() > 1 ? 1 : 0);
}

export function noteOff(id: i32): void {
  const tr: i32 = pbits(P_TRANS);
  const arpOn: i32 = tr & 1;
  const hold: i32 = (tr >> 1) & 1;
  const seqRec: i32 = (tr >> 2) & 1;
  if (id < 0) return;

  if (seqRec == 1 && recHeld > 0) recHeld--;

  if (hold == 1) {
    // latch: mark released but keep the note in the list (and sounding)
    for (let i = 0; i < hCount; i++) if (hId[i] == id) hPhys[i] = 0;
    return;
  }
  heldRemove(id);

  const uni: i32 = pbits(P_UNISON);
  if (arpOn == 1) return;
  if (uni > 0) {
    if (hCount == 0) releaseAllVoices(); else unisonRetune(0);
    return;
  }
  releaseId(id);
}

// ---- LFO shapes ---------------------------------------------------------
// triangle & random are bipolar; saw, rev saw and square are positive-only
// (manual p.34); shape 4 at full FREQUENCY = hidden white-noise shape.
function lfoShapeVal(shp: i32, ph: f32, freqKnob: f32): f32 {
  if (shp == 0) return ph < 0.5 ? ph * 4.0 - 1.0 : 3.0 - ph * 4.0;
  if (shp == 1) return 1.0 - ph;         // sawtooth (falling)
  if (shp == 2) return ph;               // reverse sawtooth (rising)
  if (shp == 3) return ph < 0.5 ? 1.0 : 0.0;
  if (freqKnob >= 0.99) return rngf();   // hidden noise shape
  return lfoSH;                          // random (sample & hold)
}

// ---- reverb helpers -------------------------------------------------------
@inline function combRun(ci: i32, len: i32, x: f32, fb: f32, damp: f32): f32 {
  const base: i32 = ci * CMB_LEN;
  let idx: i32 = rvCmbI[ci];
  if (idx >= len) idx = 0;
  const y: f32 = rvCmb[base + idx];
  // damped feedback (one-pole low-pass inside the loop)
  rvDamp[ci] = y * (1.0 - damp) + rvDamp[ci] * damp;
  rvCmb[base + idx] = x + rvDamp[ci] * fb;
  rvCmbI[ci] = idx + 1 >= len ? 0 : idx + 1;
  return y;
}
@inline function apRun(ai: i32, len: i32, x: f32): f32 {
  const base: i32 = ai * RAP_LEN;
  let idx: i32 = rvApI[ai];
  if (idx >= len) idx = 0;
  const bufout: f32 = rvAp[base + idx];
  const y: f32 = bufout - x;
  rvAp[base + idx] = x + bufout * 0.5;
  rvApI[ai] = idx + 1 >= len ? 0 : idx + 1;
  return y;
}
@inline function dlRead(line: StaticArray<f32>, w: i32, delay: f32): f32 {
  let rp: f32 = f32(w) - delay;
  while (rp < 0.0) rp += f32(DL_LEN);
  if (rp >= f32(DL_LEN)) rp -= f32(DL_LEN); // f32(w-delay)+DL_LEN can round up to exactly DL_LEN
  let i0: i32 = i32(rp);
  if (i0 >= DL_LEN) i0 = DL_LEN - 1;        // guard: i32(rp) may still land on DL_LEN
  let i1: i32 = i0 + 1; if (i1 >= DL_LEN) i1 -= DL_LEN;
  const fr: f32 = rp - f32(i0);
  return line[i0] + (line[i1] - line[i0]) * fr;
}
// first-order allpass (phaser stage)
@inline function apStage(i: i32, x: f32, k: f32): f32 {
  const s: f32 = apState[i];
  const y: f32 = -x + s;
  apState[i] = x + y * k;
  return y;
}

let lowestHz: f32 = 261.63; // ring-mod low-note tracking source

// ---- one effect engine, one sample ------------------------------------
// e: 0 = FX A slot, 1 = FX B slot. Writes wet into wetLR (module lets us
// return two floats via globals).
let wetL: f32 = 0.0;
let wetR: f32 = 0.0;
function fxRun(e: i32, typ: i32, inL: f32, inR: f32, p1: f32, p2: f32, sync: i32, beatSec: f32): void {
  const sr: f32 = sampleRate;
  const dlL: StaticArray<f32> = e == 0 ? dl0L : dl1L;
  const dlR: StaticArray<f32> = e == 0 ? dl0R : dl1R;
  let w: i32 = fxW[e];
  wetL = 0.0; wetR = 0.0;

  if (typ == 1 || typ == 2) {
    // ---- bbd (dark bucket-brigade) / ddl (clean digital delay) --------
    let dSec: f32 = 0.0;
    if (sync == 1) {
      // clock-synced repeats; > 1 s halves until legal (manual p.31)
      let idx: i32 = i32(p1 * 10.0 + 0.5); if (idx > 10) idx = 10;
      dSec = syncBeats[idx] * beatSec;
      while (dSec > 1.0) dSec *= 0.5;
    } else {
      dSec = typ == 1 ? 0.02 + p1 * p1 * 0.98 : 0.001 + p1 * p1 * 0.999;
    }
    let dSmp: f32 = dSec * sr;
    if (dSmp > f32(DL_LEN - 4)) dSmp = f32(DL_LEN - 4);
    const fb: f32 = p2 * 0.95;
    let rdL: f32 = dlRead(dlL, w, dSmp);
    let rdR: f32 = dlRead(dlR, w, dSmp);
    if (typ == 1) {
      // BBD: darker every pass + gentle saturation
      fxLpL[e] += (rdL - fxLpL[e]) * 0.22;
      fxLpR[e] += (rdR - fxLpR[e]) * 0.22;
      rdL = f32(Mathf.tanh(fxLpL[e] * 1.2));
      rdR = f32(Mathf.tanh(fxLpR[e] * 1.2));
    }
    dlL[w] = inL + rdL * fb;
    dlR[w] = inR + rdR * fb;
    wetL = rdL; wetR = rdR;
  } else if (typ == 3) {
    // ---- vintage chorus ------------------------------------------------
    const rate: f32 = 0.05 + p1 * p1 * 6.0;
    fxPh[e] += rate / sr; if (fxPh[e] >= 1.0) fxPh[e] -= 1.0;
    const depth: f32 = (0.0005 + p2 * 0.0045) * sr;
    const base: f32 = 0.012 * sr;
    const m1: f32 = Mathf.sin(TWO_PI * fxPh[e]);
    const m2: f32 = Mathf.sin(TWO_PI * fxPh[e] + 1.5708);
    dlL[w] = inL; dlR[w] = inR;
    wetL = dlRead(dlL, w, base + depth * (1.0 + m1));
    wetR = dlRead(dlR, w, base + depth * (1.0 + m2));
  } else if (typ == 4 || typ == 5 || typ == 6) {
    // ---- three vintage phasers (6-stage hi-res, 6-stage lo-res, 8-stage) --
    const stages: i32 = typ == 6 ? 8 : 6;
    const fbAmt: f32 = typ == 4 ? 0.72 : (typ == 5 ? 0.35 : 0.55);
    const rate: f32 = 0.02 + p1 * p1 * 4.0;
    fxPh[e] += rate / sr; if (fxPh[e] >= 1.0) fxPh[e] -= 1.0;
    // triangle sweep of the allpass corner
    const swp: f32 = fxPh[e] < 0.5 ? fxPh[e] * 2.0 : 2.0 - fxPh[e] * 2.0;
    const minF: f32 = typ == 6 ? 120.0 : 200.0;
    const fc: f32 = minF + (300.0 + 3800.0 * p2) * swp;
    let k: f32 = (1.0 - f32(Mathf.tan(PI * fc / sr))) / (1.0 + f32(Mathf.tan(PI * fc / sr)));
    k = clampf(k, -0.98, 0.98);
    let xl: f32 = inL + fxFbL[e] * fbAmt;
    let xr: f32 = inR + fxFbR[e] * fbAmt;
    const baseIdx: i32 = e * 16;
    for (let s = 0; s < stages; s++) {
      xl = apStage(baseIdx + s, xl, k);
      xr = apStage(baseIdx + 8 + s, xr, k);
    }
    fxFbL[e] = xl; fxFbR[e] = xr;
    wetL = (inL + xl) * 0.7;
    wetR = (inR + xr) * 0.7;
  } else if (typ == 7) {
    // ---- ring modulator (freq + low-note pitch tracking, manual p.33) --
    let carHz: f32 = 0.5 * f32(Mathf.pow(8000.0, p1));
    if (p2 >= 0.5) carHz = lowestHz; // track the lowest sounding note
    fxPh[e] += carHz / sr; if (fxPh[e] >= 1.0) fxPh[e] -= 1.0;
    const car: f32 = Mathf.sin(TWO_PI * fxPh[e]);
    wetL = inL * car; wetR = inR * car;
  } else if (typ == 8 || typ == 9) {
    // ---- two vintage flangers (high / low resonance) --------------------
    const fbAmt: f32 = typ == 8 ? 0.85 : 0.45;
    const rate: f32 = 0.03 + p1 * p1 * 3.0;
    fxPh[e] += rate / sr; if (fxPh[e] >= 1.0) fxPh[e] -= 1.0;
    const tri: f32 = fxPh[e] < 0.5 ? fxPh[e] * 2.0 : 2.0 - fxPh[e] * 2.0;
    const dSmp: f32 = (0.0004 + (0.0006 + 0.005 * p2) * tri) * sr;
    const rdL: f32 = dlRead(dlL, w, dSmp);
    const rdR: f32 = dlRead(dlR, w, dSmp + 11.0);
    dlL[w] = inL + rdL * fbAmt;
    dlR[w] = inR + rdR * fbAmt;
    wetL = (inL + rdL) * 0.7; wetR = (inR + rdR) * 0.7;
  } else if (typ == 10 || typ == 11 || typ == 12) {
    // ---- hall / room / plate reverbs (time + early reflections) --------
    const mono: f32 = (inL + inR) * 0.5;
    const scl: f32 = (sr / 44100.0) * (typ == 10 ? 1.0 : (typ == 11 ? 0.55 : 0.78));
    const fb: f32 = 0.72 + p1 * (typ == 10 ? 0.26 : (typ == 11 ? 0.21 : 0.24));
    const damp: f32 = typ == 12 ? 0.12 : (typ == 11 ? 0.45 : 0.3);
    let lsum: f32 = 0.0; let rsum: f32 = 0.0;
    for (let c = 0; c < 8; c++) {
      let lenL: i32 = i32(cmbTune[c] * scl); if (lenL >= CMB_LEN) lenL = CMB_LEN - 1; if (lenL < 8) lenL = 8;
      let lenR: i32 = i32((cmbTune[c] + 23.0) * scl); if (lenR >= CMB_LEN) lenR = CMB_LEN - 1; if (lenR < 8) lenR = 8;
      lsum += combRun(c, lenL, mono, fb, damp);
      rsum += combRun(8 + c, lenR, mono, fb, damp);
    }
    lsum *= 0.125; rsum *= 0.125;
    for (let a = 0; a < 3; a++) {
      let lenL: i32 = i32(apTune[a] * scl); if (lenL >= RAP_LEN) lenL = RAP_LEN - 1; if (lenL < 8) lenL = 8;
      let lenR: i32 = i32((apTune[a] + 19.0) * scl); if (lenR >= RAP_LEN) lenR = RAP_LEN - 1; if (lenR < 8) lenR = 8;
      lsum = apRun(a, lenL, lsum);
      rsum = apRun(4 + a, lenR, rsum);
    }
    // early reflections: a handful of discrete taps off the input line
    dlL[w] = inL; dlR[w] = inR;
    const er: f32 = p2;
    const erL: f32 = dlRead(dlL, w, 0.013 * sr) * 0.9 + dlRead(dlL, w, 0.029 * sr) * 0.62 + dlRead(dlL, w, 0.047 * sr) * 0.45;
    const erR: f32 = dlRead(dlR, w, 0.019 * sr) * 0.9 + dlRead(dlR, w, 0.037 * sr) * 0.62 + dlRead(dlR, w, 0.053 * sr) * 0.45;
    wetL = lsum * 1.6 + erL * er;
    wetR = rsum * 1.6 + erR * er;
  } else if (typ == 13) {
    // ---- vintage guitar-amp spring (decay + tone) -----------------------
    const mono: f32 = (inL + inR) * 0.5;
    // dispersive chirp: 4 modulated short allpasses
    let x: f32 = mono;
    const baseIdx: i32 = e * 16;
    fxPh[e] += 0.9 / sr; if (fxPh[e] >= 1.0) fxPh[e] -= 1.0;
    for (let s = 0; s < 4; s++) x = apStage(baseIdx + s, x, 0.62);
    // boingy loop through one long comb with tone filter
    const scl: f32 = sr / 44100.0;
    let len: i32 = i32(1687.0 * scl); if (len >= CMB_LEN) len = CMB_LEN - 1;
    const fb: f32 = 0.55 + p1 * 0.42;
    const toneHz: f32 = 500.0 + p2 * 5500.0;
    const tk: f32 = clampf(TWO_PI * toneHz / sr, 0.0, 1.0);
    const y: f32 = combRun(0, len, x, fb, 1.0 - tk);
    let len2: i32 = i32(2103.0 * scl); if (len2 >= CMB_LEN) len2 = CMB_LEN - 1;
    const y2: f32 = combRun(1, len2, x, fb * 0.92, 1.0 - tk);
    wetL = (y + y2 * 0.8) * 1.2;
    wetR = (y2 + y * 0.8) * 1.2;
  }
  w++; if (w >= DL_LEN) w = 0;
  fxW[e] = w;
}

function fxClear(e: i32): void {
  const dlL: StaticArray<f32> = e == 0 ? dl0L : dl1L;
  const dlR: StaticArray<f32> = e == 0 ? dl0R : dl1R;
  for (let i = 0; i < DL_LEN; i++) { dlL[i] = 0.0; dlR[i] = 0.0; }
  for (let i = 0; i < 16; i++) apState[e * 16 + i] = 0.0;
  fxLpL[e] = 0.0; fxLpR[e] = 0.0; fxFbL[e] = 0.0; fxFbR[e] = 0.0; fxPh[e] = 0.0;
  if (e == 1) {
    for (let i = 0; i < 16 * CMB_LEN; i++) rvCmb[i] = 0.0;
    for (let i = 0; i < 8 * RAP_LEN; i++) rvAp[i] = 0.0;
    for (let i = 0; i < 16; i++) { rvCmbI[i] = 0; rvDamp[i] = 0.0; }
    for (let i = 0; i < 8; i++) rvApI[i] = 0;
  }
}

// ---- arpeggiator step --------------------------------------------------
const sortIdx: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
function arpStep(gateSamples: i32): void {
  if (hCount == 0) return;
  const pat: i32 = pbits(P_ARPPAT);
  const mode: i32 = pat % 5;          // up, down, up+down, random, assign
  const range: i32 = pat / 5 + 1;     // 1..3 octaves
  const total: i32 = hCount * range;

  // order the chord
  for (let i = 0; i < hCount; i++) sortIdx[i] = i;
  if (mode <= 2) { // pitch-sorted for up / down / up+down
    for (let i = 1; i < hCount; i++) {
      const key: i32 = sortIdx[i];
      let j: i32 = i - 1;
      while (j >= 0 && hFreq[sortIdx[j]] > hFreq[key]) { sortIdx[j + 1] = sortIdx[j]; j--; }
      sortIdx[j + 1] = key;
    }
  } else if (mode == 4) { // assign = the order the keys were pressed
    for (let i = 1; i < hCount; i++) {
      const key: i32 = sortIdx[i];
      let j: i32 = i - 1;
      while (j >= 0 && hOrder[sortIdx[j]] > hOrder[key]) { sortIdx[j + 1] = sortIdx[j]; j--; }
      sortIdx[j + 1] = key;
    }
  }

  let slotPos: i32 = 0;
  if (mode == 0 || mode == 4) {           // up / assign
    slotPos = arpPos % total;
    arpPos++;
  } else if (mode == 1) {                 // down
    slotPos = total - 1 - (arpPos % total);
    arpPos++;
  } else if (mode == 2) {                 // up + down (ends not repeated)
    if (total <= 1) slotPos = 0;
    else {
      const period: i32 = total * 2 - 2;
      const p: i32 = arpPos % period;
      slotPos = p < total ? p : period - p;
    }
    arpPos++;
  } else {                                // random
    let r: i32 = rngState; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; rngState = r;
    slotPos = (r & 0x7fffffff) % total;
  }

  const noteI: i32 = sortIdx[slotPos % hCount];
  const oct: i32 = slotPos / hCount;
  const hz: f32 = hFreq[noteI] * f32(1 << oct);

  // steal round-robin through the pool via normal allocation
  const uni: i32 = pbits(P_UNISON);
  if (uni > 0) {
    let stack: i32 = uni; let isChord: i32 = 0;
    if (uni == 7) { stack = chordCount; isChord = 1; }
    if (stack > NUM_VOICES) stack = NUM_VOICES;
    for (let s = 0; s < stack; s++) {
      const shz: f32 = isChord == 1 ? hz * chordRatio[s] : hz;
      triggerVoice(s, -900, shz, hVel[noteI], 1, 1);
    }
  } else {
    const slot: i32 = allocVoice();
    // legato=1: the arp stream counts as legato so FRA/FTA glide modes sing
    triggerVoice(slot, -900, hz, hVel[noteI], 1, 1);
  }
  arpGate = gateSamples;
}

// ---- sequencer step ------------------------------------------------------
function seqStepAdvance(stepSamples: f32): void {
  if (seqLen == 0) return;
  if (seqWait > 1) { seqWait--; return; } // inside a tied step
  if (seqPos >= seqLen) seqPos = 0;
  // release previous step's voices
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] <= -1000) {
      vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4;
    }
  }
  const s: i32 = seqPos;
  const cnt: i32 = seqCnt[s];
  const dur: i32 = seqDur[s] < 1 ? 1 : seqDur[s];
  for (let n = 0; n < cnt; n++) {
    const slot: i32 = allocVoice();
    triggerVoice(slot, -1000 - s, seqFreq[s * 6 + n] * seqTranspose, seqVel[s * 6 + n], 1, 0);
  }
  seqGate = i32(stepSamples * f32(dur) * 0.9);
  seqWait = dur;
  seqPos = s + 1 >= seqLen ? 0 : s + 1;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- transport edges ------------------------------------------------
  const tr: i32 = pbits(P_TRANS);
  const arpOn: i32 = tr & 1;
  const hold: i32 = (tr >> 1) & 1;
  const seqRec: i32 = (tr >> 2) & 1;
  const seqPlay: i32 = (tr >> 3) & 1;
  const trWas: i32 = lastTransport;
  if (((trWas >> 2) & 1) == 0 && seqRec == 1 && seqPlay == 0) { seqLen = 0; recHeld = 0; } // REC pressed → new sequence
  if (((trWas >> 3) & 1) == 0 && seqPlay == 1) { seqPos = 0; seqWait = 0; clockAcc = 0.0; } // PLAY pressed → from the top
  if ((trWas & 1) == 0 && arpOn == 1) { arpPos = 0; clockAcc = 0.0; }
  if ((trWas & 1) == 1 && arpOn == 0) {
    // arp switched off: silence arp voices, resume held keys polyphonically
    for (let i = 0; i < NUM_VOICES; i++) {
      if (vActive[i] == 1 && vNote[i] == -900) { vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4; }
    }
    if (pbits(P_UNISON) == 0) {
      for (let i = 0; i < hCount; i++) {
        const slot: i32 = allocVoice();
        triggerVoice(slot, hId[i], hFreq[i], hVel[i], 1, 0);
      }
    } else if (hCount > 0) unisonRetune(0);
  }
  if (((trWas >> 1) & 1) == 1 && hold == 0) {
    // HOLD released: drop latched (not physically held) notes
    for (let i = hCount - 1; i >= 0; i--) {
      if (hPhys[i] == 0) {
        releaseId(hId[i]);
        heldRemove(hId[i]);
      }
    }
    if (pbits(P_UNISON) > 0) { if (hCount == 0) releaseAllVoices(); else unisonRetune(0); }
  }
  lastTransport = tr;

  // chord memory capture on switching Unison to CHd (7)
  const uniNow: i32 = pbits(P_UNISON);
  if (uniNow == 7 && lastUnison != 7) {
    chordCount = 0;
    // lowest held note is the root
    let root: f32 = 1.0e9;
    for (let i = 0; i < hCount; i++) if (hFreq[i] < root) root = hFreq[i];
    if (hCount > 0 && root < 1.0e8) {
      for (let i = 0; i < hCount && chordCount < 6; i++) {
        chordRatio[chordCount] = hFreq[i] / root;
        chordVel[chordCount] = hVel[i];
        chordCount++;
      }
    }
    if (chordCount == 0) { chordCount = 1; chordRatio[0] = 1.0; chordVel[0] = 1.0; }
  }
  if (uniNow != lastUnison && lastUnison >= 0) {
    if (uniNow == 0) { releaseAllVoices(); if (hCount > 0) { for (let i = 0; i < hCount; i++) { const s: i32 = allocVoice(); triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0); } } }
    else if (hCount > 0 && arpOn == 0) unisonRetune(0);
  }
  lastUnison = uniNow;

  // ---- per-block parameter mapping -------------------------------------
  const oscSw: i32 = pbits(P_OSCSW);
  const syncOn: i32 = oscSw & 1;
  const o2Low: i32 = (oscSw >> 1) & 1;
  const o2KbdOff: i32 = (oscSw >> 2) & 1;
  const o1Semi: f32 = f32(pbits(P_O1FREQ) - 24);       // FREQUENCY in semitone steps
  const o2Semi: f32 = f32(pbits(P_O2FREQ) - 24);
  const o2FineCents: f32 = clampf(pget(P_O2FINE), -1.0, 1.0) * 50.0;
  const shape1: f32 = clampf(pget(P_O1SHAPE), 0.0, 1.0);
  const shape2: f32 = clampf(pget(P_O2SHAPE), 0.0, 1.0);
  const pwk1: f32 = clampf(pget(P_O1PW), 0.0, 1.0);
  const pwk2: f32 = clampf(pget(P_O2PW), 0.0, 1.0);
  const mixO1: f32 = clampf(pget(P_MIXO1), 0.0, 1.0);
  const mixO2: f32 = clampf(pget(P_MIXO2), 0.0, 1.0);
  const mixSub: f32 = clampf(pget(P_MIXSUB), 0.0, 1.0);
  const mixNoi: f32 = clampf(pget(P_MIXNOI), 0.0, 1.0);
  const slop: f32 = clampf(pget(P_SLOP), 0.0, 1.0);
  const slopCents: f32 = slop * 30.0 + slop * slop * slop * slop * 45.0;

  const lpCutN: f32 = clampf(pget(P_LPCUT), 0.0, 1.0);
  const lpResN: f32 = clampf(pget(P_LPRES), 0.0, 1.0);
  const lpEnvA: f32 = clampf(pget(P_LPENV), -1.0, 1.0);
  const hpCutN: f32 = clampf(pget(P_HPCUT), 0.0, 1.0);
  const hpResN: f32 = clampf(pget(P_HPRES), 0.0, 1.0);
  const hpEnvA: f32 = clampf(pget(P_HPENV), -1.0, 1.0);
  const keyTrk: i32 = pbits(P_KEYTRK);
  const lpTrk: f32 = f32(keyTrk % 3) * 0.5;            // off / half / full
  const hpTrk: f32 = f32(keyTrk / 3) * 0.5;
  const velRt: i32 = pbits(P_VELRT);

  const lpBase: f32 = 12.0 * f32(Mathf.pow(1600.0, lpCutN));  // 12 Hz .. ~19 kHz
  const hpBase: f32 = 16.0 * f32(Mathf.pow(500.0, hpCutN));   // 16 Hz .. 8 kHz
  const lpReso: f32 = lpResN * 4.1;                            // self-oscillates near the top
  const hpQ: f32 = 1.9 - hpResN * 1.75;

  // envelope rates
  const fAtk: f32 = 1.0 / (envTime(pget(P_FA)) * sr);
  const fDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (envTime(pget(P_FD)) * sr)));
  const fSus: f32 = clampf(pget(P_FS), 0.0, 1.0);
  const fRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (envTime(pget(P_FR)) * sr)));
  const aAtk: f32 = 1.0 / (envTime(pget(P_AA)) * sr);
  const aDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (envTime(pget(P_AD)) * sr)));
  const aSus: f32 = clampf(pget(P_AS), 0.0, 1.0);
  const aRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (envTime(pget(P_AR)) * sr)));
  const vcaAmt: f32 = clampf(pget(P_VCAAMT), 0.0, 1.0);

  // clock
  const bpm: f32 = clampf(pget(P_BPM), 30.0, 250.0);
  const beatSec: f32 = 60.0 / bpm;
  const clkIdx: i32 = pbits(P_CLKVAL);
  const isSwing: i32 = (clkIdx == 4 || clkIdx == 7) ? 1 : 0;
  const baseBeats: f32 = clkBeats[clkIdx];

  // LFO
  const lfoShp: i32 = pbits(P_LFOSHP);
  const lfoFreqN: f32 = clampf(pget(P_LFOF), 0.0, 1.0);
  let lfoHz: f32 = 0.03 * f32(Mathf.pow(1000.0, lfoFreqN)); // 0.03 .. 30 Hz
  if (pbits(P_LFOSYN) == 1) {
    // synced: FREQUENCY picks a musical division of the clock step
    const divs: i32 = 1 + i32(lfoFreqN * 7.0);
    lfoHz = f32(divs) / (baseBeats * beatSec * 4.0);
  }
  const lfoInc: f32 = lfoHz / sr;
  const lfoDst: i32 = pbits(P_LFODST);
  const lfoInitAmt: f32 = clampf(pget(P_LFOA), 0.0, 1.0);
  const modWhl: f32 = clampf(pget(P_MODWHL), 0.0, 1.0);

  // poly mod
  const pmFE: f32 = clampf(pget(P_PMFE), -1.0, 1.0);
  const pmO2: f32 = clampf(pget(P_PMO2), -1.0, 1.0);
  const pmDst: i32 = pbits(P_PMDST);

  // aftertouch
  const atVal: f32 = clampf(pget(P_PRESS), 0.0, 1.0) * clampf(pget(P_ATAMT), -1.0, 1.0);
  const atDst: i32 = pbits(P_ATDST);

  // pitch wheel
  const bendSemi: f32 = clampf(pget(P_PBWHEEL), -1.0, 1.0) * f32(pbits(P_PBRANGE));

  const dist: f32 = clampf(pget(P_DIST), 0.0, 1.0);
  const panSpr: f32 = clampf(pget(P_PANSPR), 0.0, 1.0);
  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.4;

  // FX
  const fxMode: i32 = pbits(P_FXMODE);
  const fxOn: i32 = fxMode & 1;
  let fx1Typ: i32 = fxOn == 1 ? pbits(P_FX1TYP) : 0;
  if (fx1Typ > 9) fx1Typ = 9;   // reverbs live in slot B only (manual p.29)
  let fx2Typ: i32 = fxOn == 1 ? pbits(P_FX2TYP) : 0;
  if (fx2Typ > 13) fx2Typ = 13;
  if (fx1Typ != fxLast[0]) { fxClear(0); fxLast[0] = fx1Typ; }
  if (fx2Typ != fxLast[1]) { fxClear(1); fxLast[1] = fx2Typ; }
  const fx1Mix: f32 = clampf(pget(P_FX1MIX), 0.0, 1.0);
  const fx2Mix: f32 = clampf(pget(P_FX2MIX), 0.0, 1.0);
  const fx1P1: f32 = clampf(pget(P_FX1P1), 0.0, 1.0);
  const fx1P2: f32 = clampf(pget(P_FX1P2), 0.0, 1.0);
  const fx2P1: f32 = clampf(pget(P_FX2P1), 0.0, 1.0);
  const fx2P2: f32 = clampf(pget(P_FX2P2), 0.0, 1.0);
  const fx1Sync: i32 = (fxMode >> 1) & 1;
  const fx2Sync: i32 = (fxMode >> 2) & 1;

  const seqRunning: i32 = (seqPlay == 1 && seqLen > 0) ? 1 : 0;
  const arpRunning: i32 = (arpOn == 1 && seqRunning == 0 && hCount > 0) ? 1 : 0; // seq playing disables arp (manual p.41)

  const voiceScale: f32 = 0.5;

  for (let f = 0; f < n; f++) {
    // ---- clock: arp / seq stepping ------------------------------------
    if (arpRunning == 1 || seqRunning == 1) {
      clockAcc -= 1.0;
      if (clockAcc <= 0.0) {
        let stepBeats: f32 = baseBeats;
        if (isSwing == 1) stepBeats = swingFlip == 0 ? baseBeats * 1.3333334 : baseBeats * 0.6666667;
        swingFlip = 1 - swingFlip;
        const stepSamples: f32 = stepBeats * beatSec * sr;
        clockAcc += stepSamples;
        if (seqRunning == 1) seqStepAdvance(stepSamples);
        else arpStep(i32(stepSamples * 0.5));
      }
    }
    if (arpGate > 0) {
      arpGate--;
      if (arpGate == 0) {
        for (let i = 0; i < NUM_VOICES; i++) {
          if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == -900) { vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4; }
        }
      }
    }
    if (seqGate > 0) {
      seqGate--;
      if (seqGate == 0) {
        for (let i = 0; i < NUM_VOICES; i++) {
          if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] <= -1000) { vGate[i] = 0; vAStage[i] = 4; vFStage[i] = 4; }
        }
      }
    }

    // ---- slop random-walk targets (updated slowly) ---------------------
    slopCounter--;
    if (slopCounter <= 0) {
      slopCounter = i32(sr * 0.35);
      for (let v = 0; v < NUM_VOICES; v++) { vSlopT1[v] = rngf(); vSlopT2[v] = rngf(); }
    }

    // ---- LFO -----------------------------------------------------------
    lfoPhase += lfoInc;
    if (lfoPhase >= 1.0) { lfoPhase -= 1.0; lfoSH = rngf(); }
    lfoVal = lfoShapeVal(lfoShp, lfoPhase, lfoFreqN);
    // effective amount: INITIAL AMOUNT + mod wheel (+ aftertouch LFO AMT dest,
    // which inverts the waveform when it drives the total negative — manual p.61)
    let lfoAmt: f32 = lfoInitAmt + modWhl;
    if ((atDst & 4) != 0) lfoAmt += atVal;
    let lfoEff: f32 = lfoVal;
    if (lfoAmt < 0.0) { lfoAmt = -lfoAmt; lfoEff = -lfoEff; }
    if (lfoAmt > 1.0) lfoAmt = 1.0;
    const lfoMod: f32 = lfoEff * lfoAmt;

    // shared modulation terms
    let semiO1: f32 = o1Semi + bendSemi;
    let semiO2: f32 = o2Semi + bendSemi + o2FineCents * 0.01;
    if ((lfoDst & 1) != 0) semiO1 += lfoMod * 2.0;   // LFO → FREQ 1
    if ((lfoDst & 2) != 0) semiO2 += lfoMod * 2.0;   // LFO → FREQ 2
    if ((atDst & 1) != 0) semiO1 += atVal * 2.0;     // pressure → FREQ 1
    if ((atDst & 2) != 0) semiO2 += atVal * 2.0;     // pressure → FREQ 2
    let pwMod: f32 = 0.0;
    if ((lfoDst & 4) != 0) pwMod = lfoMod * 0.4;     // LFO → PW 1+2
    let lpModOct: f32 = 0.0;
    let hpModOct: f32 = 0.0;
    if ((lfoDst & 16) != 0) lpModOct += lfoMod * 3.0;
    if ((lfoDst & 32) != 0) hpModOct += lfoMod * 3.0;
    if ((atDst & 16) != 0) lpModOct += atVal * 3.0;
    if ((atDst & 32) != 0) hpModOct += atVal * 3.0;
    let ampMod: f32 = 0.0;
    if ((lfoDst & 8) != 0) ampMod += lfoMod;         // LFO → AMP (additive VCA drive)
    if ((atDst & 8) != 0) ampMod += atVal;

    const o1Mul: f32 = f32(Mathf.pow(2.0, semiO1 / 12.0));
    const o2MulBase: f32 = f32(Mathf.pow(2.0, semiO2 / 12.0));

    let sumL: f32 = 0.0;
    let sumR: f32 = 0.0;
    let lowTrack: f32 = 1.0e9;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplifier envelope ----------------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) { aenv += aAtk; if (aenv >= 1.0) { aenv = 1.0; astg = 2; } }
      else if (astg == 2) { aenv += (aSus - aenv) * aDecK; }
      else if (astg == 4) { aenv += (0.0 - aenv) * aRelK; if (aenv <= 0.0005) { aenv = 0.0; astg = 0; } }
      vAEnv[v] = aenv; vAStage[v] = astg;
      if (astg == 0) { vActive[v] = 0; vNote[v] = -1; continue; }

      // ---- filter envelope --------------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) { fenv += fAtk; if (fenv >= 1.0) { fenv = 1.0; fstg = 2; } }
      else if (fstg == 2) { fenv += (fSus - fenv) * fDecK; }
      else if (fstg == 4) { fenv += (0.0 - fenv) * fRelK; if (fenv <= 0.0005) fenv = 0.0; }
      vFEnv[v] = fenv; vFStage[v] = fstg;

      // ---- glide -------------------------------------------------------
      let cur: f32 = vCur[v];
      const tgt: f32 = vTarget[v];
      const gk: f32 = vGlideK[v];
      if (cur != tgt) {
        if (gk == 1.0) cur = tgt;
        else {
          cur *= gk;
          if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt;
        }
        vCur[v] = cur;
      }
      if (cur < lowTrack) lowTrack = cur;

      // ---- slop drift ----------------------------------------------------
      let s1: f32 = vSlop1[v]; s1 += (vSlopT1[v] - s1) * 0.00002; vSlop1[v] = s1;
      let s2: f32 = vSlop2[v]; s2 += (vSlopT2[v] - s2) * 0.00002; vSlop2[v] = s2;
      const slopMul1: f32 = 1.0 + s1 * slopCents * 0.000577; // ≈ 2^(cents/1200)-1
      const slopMul2: f32 = 1.0 + s2 * slopCents * 0.000577;

      // ---- poly mod source ------------------------------------------------
      const pmSrc: f32 = pmFE * fenv + pmO2 * vO2Last[v];

      // ---- oscillator 2 (master for sync; LO FREQ / KEYBOARD switches) ----
      let o2Hz: f32 = 0.0;
      if (o2KbdOff == 1) o2Hz = 32.7 * o2MulBase * slopMul2;       // keyboard off: fixed C1 base
      else o2Hz = cur * o2MulBase * slopMul2;
      if (o2Low == 1) o2Hz *= 0.0078125;                            // LOW FREQ: 7 octaves down
      let inc2: f32 = o2Hz / sr;
      if (inc2 > 0.45) inc2 = 0.45;
      let p2: f32 = vPh2[v]; p2 += inc2;
      let wrapped2: i32 = 0;
      if (p2 >= 1.0) { p2 -= 1.0; wrapped2 = 1; }
      vPh2[v] = p2;
      let pw2: f32 = pwFromKnob(pwk2) + pwMod;
      pw2 = clampf(pw2, 0.04, 0.96);
      const osc2: f32 = morphOsc(p2, inc2, shape2, pw2);
      vO2Last[v] = osc2;

      // ---- oscillator 1 (slave; poly-mod destinations) --------------------
      let o1Mul2: f32 = o1Mul;
      if ((pmDst & 1) != 0 && pmSrc != 0.0) o1Mul2 *= f32(Mathf.pow(2.0, pmSrc * 4.0)); // FREQ 1
      let sh1: f32 = shape1;
      if ((pmDst & 2) != 0) sh1 = clampf(sh1 + pmSrc, 0.0, 1.0);                        // SHAPE 1
      let pw1: f32 = pwFromKnob(pwk1) + pwMod;
      if ((pmDst & 4) != 0) pw1 += pmSrc * 0.5;                                          // PW 1
      pw1 = clampf(pw1, 0.04, 0.96);
      let inc1: f32 = cur * o1Mul2 * slopMul1 / sr;
      if (inc1 > 0.45) inc1 = 0.45;
      if (inc1 < 0.0) inc1 = 0.0;
      let p1: f32 = vPh1[v]; p1 += inc1;
      if (p1 >= 1.0) p1 -= 1.0;
      if (syncOn == 1 && wrapped2 == 1) p1 = p2 * (inc2 > 0.0 ? inc1 / inc2 : 0.0); // hard sync: osc2 restarts osc1
      vPh1[v] = p1;
      const osc1: f32 = morphOsc(p1, inc1, sh1, pw1);

      // ---- sub octave (triangle, one octave below osc 1) -------------------
      let psub: f32 = vPhSub[v]; psub += inc1 * 0.5; if (psub >= 1.0) psub -= 1.0; vPhSub[v] = psub;
      const sub: f32 = psub < 0.5 ? 4.0 * psub - 1.0 : 3.0 - 4.0 * psub;

      const noi: f32 = rngf();

      // ---- mixer ------------------------------------------------------------
      let sig: f32 = osc1 * mixO1 + osc2 * mixO2 + sub * mixSub + noi * mixNoi;
      sig *= 0.5;

      // ---- key tracking + envelope + modulation → filter cutoffs -------------
      const keyOct: f32 = f32(Mathf.log2(cur / 261.63));
      const lpVel: f32 = (velRt & 1) != 0 ? vVel[v] : 1.0;
      const hpVel: f32 = (velRt & 2) != 0 ? vVel[v] : 1.0;
      let lpOct: f32 = lpEnvA * lpVel * fenv * 8.0 + lpTrk * keyOct + lpModOct;
      if ((pmDst & 8) != 0) lpOct += pmSrc * 5.0;
      let hpOct: f32 = hpEnvA * hpVel * fenv * 8.0 + hpTrk * keyOct + hpModOct;
      if ((pmDst & 16) != 0) hpOct += pmSrc * 5.0;

      // ---- 4-pole resonant low-pass ladder -----------------------------------
      let lpFc: f32 = lpBase * f32(Mathf.pow(2.0, lpOct));
      lpFc = clampf(lpFc, 4.0, sr * 0.45);
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * lpFc / sr));
      if (g > 0.99) g = 0.99;
      let st0: f32 = vLp0[v]; let st1: f32 = vLp1[v]; let st2: f32 = vLp2[v]; let st3: f32 = vLp3[v];
      let inp: f32 = sig - lpReso * st3;
      inp = f32(Mathf.tanh(inp));
      st0 += g * (inp - st0);
      st1 += g * (st0 - st1);
      st2 += g * (st1 - st2);
      st3 += g * (st2 - st3);
      vLp0[v] = st0; vLp1[v] = st1; vLp2[v] = st2; vLp3[v] = st3;
      // make up the ladder's passband loss of 1/(1+k) as resonance rises
      let y: f32 = st3 * (1.0 + lpReso * 0.75);

      // ---- 2-pole resonant high-pass (state variable) -------------------------
      let hpFc: f32 = hpBase * f32(Mathf.pow(2.0, hpOct));
      hpFc = clampf(hpFc, 4.0, sr * 0.28);
      let fsv: f32 = 2.0 * Mathf.sin(PI * hpFc / sr);
      if (fsv > 1.1) fsv = 1.1;
      let low: f32 = vHpL[v]; let band: f32 = vHpB[v];
      low += fsv * band;
      const high: f32 = y - low - hpQ * band;
      band += fsv * high;
      // keep the SVF bounded when resonating hard
      low = clampf(low, -3.0, 3.0); band = clampf(band, -3.0, 3.0);
      vHpL[v] = low; vHpB[v] = band;
      y = high;

      // ---- VCA: envelope × amount (+ additive AMP modulation) -----------------
      const vcaVel: f32 = (velRt & 4) != 0 ? (0.2 + 0.8 * vVel[v]) : 1.0;
      let vca: f32 = aenv * vcaAmt * vcaVel + ampMod;
      vca = clampf(vca, 0.0, 1.2);
      y *= vca;

      // ---- pan spread (alternating per-voice pan, manual p.59) ----------------
      const off: f32 = f32(((v & 1) == 0 ? -1 : 1)) * (0.33 + 0.335 * f32(v >> 1)) * panSpr;
      const pan: f32 = clampf(0.5 + off * 0.5, 0.0, 1.0);
      sumL += y * (1.0 - pan);
      sumR += y * pan;
    }

    if (lowTrack < 1.0e8) lowestHz = lowTrack;

    let L: f32 = sumL * voiceScale;
    let R: f32 = sumR * voiceScale;

    // ---- stereo analog-style distortion --------------------------------------
    if (dist > 0.0005) {
      const drive: f32 = 1.0 + dist * 21.0;
      L = L * (1.0 - dist) + f32(Mathf.tanh(L * drive)) * dist;
      R = R * (1.0 - dist) + f32(Mathf.tanh(R * drive)) * dist;
    }

    // ---- dual effects, A then B in series (manual p.29) -----------------------
    if (fx1Typ > 0) {
      fxRun(0, fx1Typ, L, R, fx1P1, fx1P2, fx1Sync, beatSec);
      L = L * (1.0 - fx1Mix) + wetL * fx1Mix;
      R = R * (1.0 - fx1Mix) + wetR * fx1Mix;
    }
    if (fx2Typ > 0) {
      fxRun(1, fx2Typ, L, R, fx2P1, fx2P2, fx2Sync, beatSec);
      L = L * (1.0 - fx2Mix) + wetL * fx2Mix;
      R = R * (1.0 - fx2Mix) + wetR * fx2Mix;
    }

    L *= outGain;
    R *= outGain;

    // gentle output stage: transparent at normal level, saves big chords
    outBuf[f] = f32(Mathf.tanh(L));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(R));
  }
}
