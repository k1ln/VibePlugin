// =====================================================================
//  JOVE EIGHT — an eight-voice, sixteen-oscillator polyphonic analog
//  synthesizer modelled control-for-control on the Roland Jupiter-8
//  (JP-8 Owner's Manual, read cover to cover). Every front-panel program
//  parameter in the manual's Specifications list is represented here.
//
//  VCO-1 (man. p.15): triangle / sawtooth / variable pulse / square,
//  ranges 16'/8'/4'/2', and a CROSS MOD slider that modulates VCO-1 pitch
//  from the output of VCO-2 (ring/FM sidebands in NORMAL, slow LFO sweep
//  when VCO-2 is in LOW FREQ).
//  VCO-2 (p.16): sine / sawtooth / variable pulse / noise, quantized
//  16'-2' ranges, FINE tune +/-50 cent, NORMAL/LOW-FREQ switch (becomes a
//  sub-audio modulator), and SYNC (hard-slaved to VCO-1).
//  VCO MODULATOR (p.17): FREQ MOD from LFO + ENV-1 routed to VCO-1 / BOTH /
//  VCO-2; PULSE WIDTH MOD in MANUAL / LFO / ENV-1 mode.
//  LFO (p.17-18): sine / sawtooth / square / random(S&H), 0.05-40 Hz, with
//  a DELAY that fades it in after a fresh note.
//  SOURCE MIX (p.18): rotary balance VCO-1 <-> VCO-2.
//  HPF (p.18): non-resonant -6 dB/oct high-pass.
//  VCF (p.18-19): resonant low-pass, -12 dB/oct vs -24 dB/oct SLOPE switch,
//  ENV MOD with ENV-1/ENV-2 selector, LFO MOD, 0-120% KEY FOLLOW.
//  VCA (p.20): ENV-2 loudness contour + 4-position LFO tremolo.
//  ENV-1 (p.21): ADSR + KEY FOLLOW time-scaler + NORMAL/INVERSE POLARITY;
//  assignable to freq mod, PWM and the VCF. ENV-2 (p.21): ADSR + KEY FOLLOW,
//  drives the VCA and (optionally) the VCF.
//  PERFORMANCE (p.14): polyphonic PORTAMENTO (off/on/upper), center-sprung
//  BENDER routable to VCO-1/VCO-2/VCF with bend sensitivity, and an
//  auxiliary LFO-MOD touch pad with RISE TIME and VCO/VCF depths.
//  ASSIGNER (p.12): POLY-1 / POLY-2 / SOLO / UNISON.
//  ARPEGGIO (p.12-13): 1-4 octave UP / DOWN / U&D / RANDOM, internal rate,
//  HOLD latch. Eight voices.
//
//  Switch groups are bit-packed; the GUI decodes them. Whole-mode single
//  patch — Dual/Split two-patch modes and tape/patch memory are host
//  concerns and out of scope. Pure algorithm, allocation-free.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;
const HELD_MAX: i32 = 16;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_LFORATE: i32 = 0;
const P_LFODELAY: i32 = 1;
const P_LFOWAVE: i32 = 2;      // 0 sine, 1 saw, 2 square, 3 random
const P_MODLFO: i32 = 3;       // VCO freq-mod depth from LFO
const P_MODENV: i32 = 4;       // VCO freq-mod depth from ENV-1
const P_MODPWM: i32 = 5;       // pulse-width mod depth
const P_VCOSW: i32 = 6;        // mask: b0-1 freqdest, b2 sync, b3 lowfreq, b4-5 pwm mode
const P_VCO1CROSS: i32 = 7;
const P_VCO1RANGE: i32 = 8;    // 0 16', 1 8', 2 4', 3 2'
const P_VCO1WAVE: i32 = 9;     // 0 tri, 1 saw, 2 pulse, 3 square
const P_VCO2RANGE: i32 = 10;
const P_VCO2FINE: i32 = 11;    // -1..1 → +/-50 cent
const P_VCO2WAVE: i32 = 12;    // 0 sine, 1 saw, 2 pulse, 3 noise
const P_MIX: i32 = 13;         // 0 = VCO1 only .. 1 = VCO2 only
const P_HPF: i32 = 14;
const P_VCFCUT: i32 = 15;
const P_VCFRES: i32 = 16;
const P_VCFENV: i32 = 17;
const P_VCFLFO: i32 = 18;
const P_VCFKYBD: i32 = 19;     // 0..1 → 0..120%
const P_FILTSW: i32 = 20;      // mask: b0 slope, b1 envsel, b2 env1kf, b3 env1pol, b4 env2kf
const P_VCALEVEL: i32 = 21;
const P_VCALFO: i32 = 22;      // 0..3 tremolo depth
const P_E1A: i32 = 23;
const P_E1D: i32 = 24;
const P_E1S: i32 = 25;
const P_E1R: i32 = 26;
const P_E2A: i32 = 27;
const P_E2D: i32 = 28;
const P_E2S: i32 = 29;
const P_E2R: i32 = 30;
const P_ARPRATE: i32 = 31;
const P_ARPRANGE: i32 = 32;    // 0..3 → 1..4 octaves
const P_ARPMODE: i32 = 33;     // 0 up, 1 down, 2 u&d, 3 random
const P_ASSIGN: i32 = 34;      // 0 poly1, 1 poly2, 2 solo, 3 unison
const P_PORTATIME: i32 = 35;
const P_PERFSW: i32 = 36;      // mask: b0 bendVCO1,b1 bendVCO2,b2 bendVCF,b3 lfoVCO,b4 lfoVCF,b5-6 portaMode
const P_BENDVCO: i32 = 37;     // bend sensitivity → VCO
const P_BENDVCF: i32 = 38;     // bend sensitivity → VCF
const P_LFOMODVCO: i32 = 39;   // aux LFO-mod depth → VCO
const P_LFOMODVCF: i32 = 40;   // aux LFO-mod depth → VCF
const P_LFOMODRISE: i32 = 41;  // aux LFO-mod rise time
const P_TRANSPORT: i32 = 42;   // mask: b0 arp on, b1 hold
const P_BENDER: i32 = 43;      // -1..1 performance
const P_LFOMODPUSH: i32 = 44;  // 0..1 performance touch pad
const P_MASTERTUNE: i32 = 45;  // -1..1 → +/-50 cent
const P_VOLUME: i32 = 46;

const NUM_PARAMS: i32 = 47;

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

// ENV knob → time. Attack 1 ms..5 s ; Decay/Release 1 ms..10 s (specs p.29)
@inline function atkTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(5000.0, clampf(n, 0.0, 1.0))); }
@inline function drTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(n, 0.0, 1.0))); }

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // VCO-1 phase
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // VCO-2 phase
const vPrevOsc2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // last VCO-2 out (cross-mod)
const vDet:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // unison detune mult
// ENV-1
const vE1:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vS1:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle,1 A,2 D→S,4 R
// ENV-2
const vE2:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vS2:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
// per-voice filter state
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vHpX: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vHpY: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
// per-voice, per-block env coefficients (key-follow scaled)
const vA1k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vD1k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vR1k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vA2k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vD2k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vR2k: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// held-key list (arp / unison priority)
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hPhys:  StaticArray<i32> = new StaticArray<i32>(HELD_MAX); // physically held (0 = latched by HOLD)
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global LFO + delay + aux mod
let lfoPhase: f32 = 0.0;
let lfoDelayEnv: f32 = 1.0;
let lfoSH: f32 = 0.0;
let auxRise: f32 = 0.0;         // aux LFO-mod fade-in state
let lastAssign: i32 = -1;
let lastTransport: i32 = 0;

// arpeggiator
let arpPos: i32 = 0;
let arpClock: f32 = 0.0;
const sortIdx: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 1.0;
    vCur[v] = 261.63; vTarget[v] = 261.63; vGlideK[v] = 1.0;
    vPh1[v] = 0.11 * f32(v); vPh2[v] = 0.23 * f32(v); vPrevOsc2[v] = 0.0; vDet[v] = 1.0;
    vE1[v] = 0.0; vS1[v] = 0; vE2[v] = 0.0; vS2[v] = 0;
    vLp0[v] = 0.0; vLp1[v] = 0.0; vLp2[v] = 0.0; vLp3[v] = 0.0;
    vHpX[v] = 0.0; vHpY[v] = 0.0;
    vA1k[v] = 0.01; vD1k[v] = 0.01; vR1k[v] = 0.01;
    vA2k[v] = 0.01; vD2k[v] = 0.01; vR2k[v] = 0.01;
  }
  hCount = 0; orderCounter = 0; ageCounter = 1; lastPlayedHz = 261.63;
  lfoPhase = 0.0; lfoDelayEnv = 1.0; lfoSH = 0.0; auxRise = 0.0;
  lastAssign = -1; lastTransport = 0; arpPos = 0; arpClock = 0.0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_LFORATE] = 0.3; params[P_LFODELAY] = 0.15; params[P_LFOWAVE] = 0.0;
  params[P_MODLFO] = 0.0; params[P_MODENV] = 0.0; params[P_MODPWM] = 0.3;
  params[P_VCOSW] = 16.0; params[P_VCO1CROSS] = 0.0; params[P_VCO1RANGE] = 1.0;
  params[P_VCO1WAVE] = 1.0; params[P_VCO2RANGE] = 1.0; params[P_VCO2FINE] = 0.03;
  params[P_VCO2WAVE] = 1.0; params[P_MIX] = 0.4; params[P_HPF] = 0.0;
  params[P_VCFCUT] = 0.5; params[P_VCFRES] = 0.2; params[P_VCFENV] = 0.45;
  params[P_VCFLFO] = 0.0; params[P_VCFKYBD] = 0.35; params[P_FILTSW] = 0.0;
  params[P_VCALEVEL] = 0.8; params[P_VCALFO] = 0.0;
  params[P_E1A] = 0.02; params[P_E1D] = 0.4; params[P_E1S] = 0.35; params[P_E1R] = 0.3;
  params[P_E2A] = 0.03; params[P_E2D] = 0.5; params[P_E2S] = 0.7; params[P_E2R] = 0.35;
  params[P_ARPRATE] = 0.4; params[P_ARPRANGE] = 0.0; params[P_ARPMODE] = 0.0;
  params[P_ASSIGN] = 0.0; params[P_PORTATIME] = 0.2; params[P_PERFSW] = 11.0;
  params[P_BENDVCO] = 0.2; params[P_BENDVCF] = 0.3; params[P_LFOMODVCO] = 0.4;
  params[P_LFOMODVCF] = 0.0; params[P_LFOMODRISE] = 0.3; params[P_TRANSPORT] = 0.0;
  params[P_BENDER] = 0.0; params[P_LFOMODPUSH] = 0.0; params[P_MASTERTUNE] = 0.0;
  params[P_VOLUME] = 0.75;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- portamento (p.14: slide from previous pitch, time knob) ----------
function computeGlideK(v: i32): void {
  const assign: i32 = pbits(P_ASSIGN);
  const portaMode: i32 = (pbits(P_PERFSW) >> 5) & 3;   // 0 off, 1 on, 2 upper
  const on: i32 = portaMode >= 1 ? 1 : 0;               // PORTAMENTO switch (p.14)
  void assign;
  vGlideK[v] = 1.0;
  if (on == 0) { vCur[v] = vTarget[v]; return; }
  const t: f32 = clampf(pget(P_PORTATIME), 0.0, 1.0);
  if (t <= 0.002) { vCur[v] = vTarget[v]; return; }
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  const secPerOct: f32 = 0.008 * f32(Mathf.pow(400.0, t)); // ~0.008 .. 3.2 s / octave
  const step: f32 = f32(Mathf.pow(2.0, 1.0 / (secPerOct * sampleRate)));
  vGlideK[v] = vTarget[v] > vCur[v] ? step : 1.0 / step;
}

function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function triggerVoice(slot: i32, id: i32, hz: f32, vel: f32, retrig: i32, legato: i32, detMul: f32): void {
  vNote[slot] = id;
  vTarget[slot] = hz > 0.0 ? hz : 1.0;
  vDet[slot] = detMul;
  if (vActive[slot] == 0 || retrig == 1) {
    if (legato == 0) vCur[slot] = lastPlayedHz;
    vS1[slot] = 1; vS2[slot] = 1;
    if (vActive[slot] == 0) {
      vE1[slot] = 0.0; vE2[slot] = 0.0;
      vLp0[slot] = 0.0; vLp1[slot] = 0.0; vLp2[slot] = 0.0; vLp3[slot] = 0.0;
      vHpX[slot] = 0.0; vHpY[slot] = 0.0;
    }
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot);
  vAge[slot] = ageCounter++;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) { vGate[i] = 0; vS1[i] = 4; vS2[i] = 4; }
  }
}
function releaseAllVoices(): void {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vS1[i] = 4; vS2[i] = 4; }
}

// ---- unison / solo stack ------------------------------------------------
function physCount(): i32 {
  let c: i32 = 0;
  for (let i = 0; i < hCount; i++) if (hPhys[i] == 1) c++;
  return c;
}

// SOLO (1 voice, low-note priority) / UNISON (8 voices, last-note, detuned)
function monoStack(newPress: i32): void {
  const assign: i32 = pbits(P_ASSIGN);
  if (hCount == 0) { releaseAllVoices(); return; }
  let pick: i32 = 0;
  if (assign == 2) { // solo → low note
    for (let i = 1; i < hCount; i++) if (hFreq[i] < hFreq[pick]) pick = i;
  } else {           // unison → last note
    for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i;
  }
  const legato: i32 = physCount() > 1 ? 1 : 0;
  const retrig: i32 = newPress == 1 ? (legato == 1 ? 0 : 1) : 0;
  const baseHz: f32 = hFreq[pick];
  const vel: f32 = hVel[pick];
  const stack: i32 = assign == 3 ? NUM_VOICES : 1;
  for (let s = 0; s < stack; s++) {
    let det: f32 = 1.0;
    if (stack > 1) {
      const cents: f32 = (f32(s) - f32(stack - 1) * 0.5) * 6.0; // ±~21 cent spread
      det = f32(Mathf.pow(2.0, cents / 1200.0));
    }
    triggerVoice(s, hId[pick], baseHz, vel, retrig, legato, det);
  }
  for (let s = stack; s < NUM_VOICES; s++) {
    if (vActive[s] == 1 && vGate[s] == 1) { vGate[s] = 0; vS1[s] = 4; vS2[s] = 4; }
  }
  lastPlayedHz = baseHz;
}

// ---- held-list maintenance ---------------------------------------------
function heldAdd(id: i32, hz: f32, vel: f32): void {
  const hold: i32 = (pbits(P_TRANSPORT) >> 1) & 1;
  if (hold == 1 && physCount() == 0 && hCount > 0) { hCount = 0; releaseAllVoices(); } // relatch
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) { hPhys[i] = 1; hFreq[i] = hz; hVel[i] = vel; hOrder[i] = orderCounter++; return; }
  }
  if (hCount >= HELD_MAX) {
    for (let i = 1; i < hCount; i++) {
      hId[i-1]=hId[i]; hFreq[i-1]=hFreq[i]; hVel[i-1]=hVel[i]; hPhys[i-1]=hPhys[i]; hOrder[i-1]=hOrder[i];
    }
    hCount--;
  }
  hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = vel; hPhys[hCount] = 1; hOrder[hCount] = orderCounter++;
  hCount++;
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i+1; j < hCount; j++) {
        hId[j-1]=hId[j]; hFreq[j-1]=hFreq[j]; hVel[j-1]=hVel[j]; hPhys[j-1]=hPhys[j]; hOrder[j-1]=hOrder[j];
      }
      hCount--; return;
    }
  }
}

// ---- note events (host / GUI) -------------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const wasIdle: i32 = hCount == 0 ? 1 : 0;
  heldAdd(id, hz, vel);
  if (wasIdle == 1) { lfoDelayEnv = 0.0; arpPos = 0; arpClock = 0.0; }
  const tr: i32 = pbits(P_TRANSPORT);
  const arpOn: i32 = tr & 1;
  const assign: i32 = pbits(P_ASSIGN);
  if (arpOn == 1) return;                              // arp owns the voices
  if (assign >= 2) { monoStack(1); return; }           // solo / unison
  // POLY-1 (multi-trigger) / POLY-2 (single-trigger legato)
  const multiTrig: i32 = assign == 0 ? 1 : 0;
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  triggerVoice(slot, id, hz, vel, multiTrig, physCount() > 1 ? 1 : 0, 1.0);
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  const tr: i32 = pbits(P_TRANSPORT);
  const arpOn: i32 = tr & 1;
  const hold: i32 = (tr >> 1) & 1;
  if (hold == 1) { for (let i = 0; i < hCount; i++) if (hId[i] == id) hPhys[i] = 0; return; }
  heldRemove(id);
  const assign: i32 = pbits(P_ASSIGN);
  if (arpOn == 1) { if (hCount == 0) releaseAllVoices(); return; } // last key up → arp notes release
  if (assign >= 2) { if (hCount == 0) releaseAllVoices(); else monoStack(0); return; }
  releaseId(id);
}

// ---- LFO shape (p.17) : sine / saw / square / random(S&H) ---------------
@inline function lfoShapeVal(shp: i32, ph: f32): f32 {
  if (shp == 0) return Mathf.sin(TWO_PI * ph);
  if (shp == 1) return 1.0 - 2.0 * ph;         // falling sawtooth
  if (shp == 2) return ph < 0.5 ? 1.0 : -1.0;  // square
  return lfoSH;                                 // random sample & hold
}

// ---- arpeggiator step (p.12-13) -----------------------------------------
function arpStep(): void {
  if (hCount == 0) return;
  const range: i32 = pbits(P_ARPRANGE) + 1;   // 1..4 octaves
  const mode: i32 = pbits(P_ARPMODE);         // 0 up, 1 down, 2 u&d, 3 random
  const total: i32 = hCount * range;

  // order the chord by pitch
  for (let i = 0; i < hCount; i++) sortIdx[i] = i;
  for (let i = 1; i < hCount; i++) {
    const key: i32 = sortIdx[i];
    let j: i32 = i - 1;
    while (j >= 0 && hFreq[sortIdx[j]] > hFreq[key]) { sortIdx[j+1] = sortIdx[j]; j--; }
    sortIdx[j+1] = key;
  }

  let slotPos: i32 = 0;
  if (mode == 0) { slotPos = arpPos % total; arpPos++; }
  else if (mode == 1) { slotPos = total - 1 - (arpPos % total); arpPos++; }
  else if (mode == 2) {
    if (total <= 1) slotPos = 0;
    else { const period: i32 = total * 2 - 2; const p: i32 = arpPos % period; slotPos = p < total ? p : period - p; }
    arpPos++;
  } else {
    let r: i32 = rngState; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; rngState = r;
    slotPos = (r & 0x7fffffff) % total;
  }

  const noteI: i32 = sortIdx[slotPos % hCount];
  const oct: i32 = slotPos / hCount;
  const hz: f32 = hFreq[noteI] * f32(1 << oct);

  const assign: i32 = pbits(P_ASSIGN);
  const stack: i32 = assign == 3 ? NUM_VOICES : 1;
  if (stack > 1) {
    for (let s = 0; s < stack; s++) {
      const cents: f32 = (f32(s) - f32(stack - 1) * 0.5) * 6.0;
      const det: f32 = f32(Mathf.pow(2.0, cents / 1200.0));
      triggerVoice(s, -900, hz, hVel[noteI], 1, 0, det);
    }
    for (let s = stack; s < NUM_VOICES; s++) if (vActive[s] == 1) { vGate[s] = 0; vS1[s] = 4; vS2[s] = 4; }
  } else {
    const slot: i32 = allocVoice();
    triggerVoice(slot, -900, hz, hVel[noteI], 1, 0, 1.0);
  }
  lastPlayedHz = hz;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- transport / assign edges --------------------------------------
  const tr: i32 = pbits(P_TRANSPORT);
  const arpOn: i32 = tr & 1;
  const hold: i32 = (tr >> 1) & 1;
  const trWas: i32 = lastTransport;
  if ((trWas & 1) == 0 && arpOn == 1) { arpPos = 0; arpClock = 0.0; }
  if ((trWas & 1) == 1 && arpOn == 0) {
    // arp off: silence arp voices, resume held keys
    for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == -900) { vGate[i] = 0; vS1[i] = 4; vS2[i] = 4; }
    const assign: i32 = pbits(P_ASSIGN);
    if (assign >= 2) { if (hCount > 0) monoStack(0); }
    else for (let i = 0; i < hCount && i < NUM_VOICES; i++) { const s: i32 = allocVoice(); triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0, 1.0); }
  }
  if (((trWas >> 1) & 1) == 1 && hold == 0) {
    for (let i = hCount - 1; i >= 0; i--) if (hPhys[i] == 0) { releaseId(hId[i]); heldRemove(hId[i]); }
    if (pbits(P_ASSIGN) >= 2) { if (hCount == 0) releaseAllVoices(); else monoStack(0); }
  }
  lastTransport = tr;

  const assign: i32 = pbits(P_ASSIGN);
  if (assign != lastAssign && lastAssign >= 0) {
    if (assign >= 2) { if (hCount > 0 && arpOn == 0) monoStack(0); }
    else if (lastAssign >= 2) {
      releaseAllVoices();
      if (arpOn == 0) for (let i = 0; i < hCount && i < NUM_VOICES; i++) { const s: i32 = allocVoice(); triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0, 1.0); }
    }
  }
  lastAssign = assign;

  // ---- per-block parameter mapping -----------------------------------
  const lfoHz: f32 = 0.05 * f32(Mathf.pow(800.0, clampf(pget(P_LFORATE), 0.0, 1.0))); // 0.05..40 Hz
  const lfoInc: f32 = lfoHz / sr;
  const lfoWave: i32 = pbits(P_LFOWAVE);
  const lfoDelayT: f32 = clampf(pget(P_LFODELAY), 0.0, 1.0) * 4.0; // 0..4 s
  const lfoDelayStep: f32 = lfoDelayT <= 0.001 ? 1.0 : 1.0 / (lfoDelayT * sr);

  const vcoSw: i32 = pbits(P_VCOSW);
  const freqDest: i32 = vcoSw & 3;            // 0 vco1, 1 both, 2 vco2
  const sync: i32 = (vcoSw >> 2) & 1;
  const lowFreq: i32 = (vcoSw >> 3) & 1;
  const pwmMode: i32 = (vcoSw >> 4) & 3;      // 0 lfo, 1 manual, 2 env1

  const modLfoAmt: f32 = clampf(pget(P_MODLFO), 0.0, 1.0);
  const modEnvAmt: f32 = clampf(pget(P_MODENV), 0.0, 1.0);
  const pwmDepth: f32 = clampf(pget(P_MODPWM), 0.0, 1.0);
  const crossAmt: f32 = clampf(pget(P_VCO1CROSS), 0.0, 1.0);

  const wave1: i32 = pbits(P_VCO1WAVE);
  const wave2: i32 = pbits(P_VCO2WAVE);
  const range1Sel: i32 = pbits(P_VCO1RANGE);
  const range2Sel: i32 = pbits(P_VCO2RANGE);
  const range1Mul: f32 = f32(Mathf.pow(2.0, f32(range1Sel - 1))); // 16'=.5 8'=1 4'=2 2'=4
  const range2Mul: f32 = f32(Mathf.pow(2.0, f32(range2Sel - 1)));
  const fine2: f32 = f32(Mathf.pow(2.0, clampf(pget(P_VCO2FINE), -1.0, 1.0) * 50.0 / 1200.0));
  const masterMul: f32 = f32(Mathf.pow(2.0, clampf(pget(P_MASTERTUNE), -1.0, 1.0) * 50.0 / 1200.0));

  const mix: f32 = clampf(pget(P_MIX), 0.0, 1.0);
  const mixV1: f32 = 1.0 - mix;   // p.18: CCW=VCO1 only, CW=VCO2 only
  const mixV2: f32 = mix;

  const hpfN: f32 = clampf(pget(P_HPF), 0.0, 1.0);
  const hpfFc: f32 = 12.0 * f32(Mathf.pow(2.0, hpfN * 8.5)); // ~12 Hz .. ~4 kHz, -6 dB/oct
  const hpfA: f32 = 1.0 / (1.0 + TWO_PI * hpfFc / sr);

  const cutN: f32 = clampf(pget(P_VCFCUT), 0.0, 1.0);
  const fcBase: f32 = 16.0 * f32(Mathf.pow(2.0, cutN * 10.3)); // ~16 Hz .. ~20 kHz
  const resN: f32 = clampf(pget(P_VCFRES), 0.0, 1.0);
  const kRes: f32 = resN * 4.2;
  const vcfEnvAmt: f32 = clampf(pget(P_VCFENV), 0.0, 1.0);
  const vcfLfoAmt: f32 = clampf(pget(P_VCFLFO), 0.0, 1.0);
  const vcfKybd: f32 = clampf(pget(P_VCFKYBD), 0.0, 1.0) * 1.2; // 0..120%

  const filtSw: i32 = pbits(P_FILTSW);
  const slope12: i32 = filtSw & 1;              // 0 = -24 dB, 1 = -12 dB
  const vcfEnvSel: i32 = (filtSw >> 1) & 1;      // 0 ENV1, 1 ENV2
  const e1KF: i32 = (filtSw >> 2) & 1;
  const e1Pol: f32 = ((filtSw >> 3) & 1) == 1 ? -1.0 : 1.0;
  const e2KF: i32 = (filtSw >> 4) & 1;

  const vcaLevel: f32 = clampf(pget(P_VCALEVEL), 0.0, 1.0);
  const vcaTrem: i32 = pbits(P_VCALFO);          // 0..3
  const tremDepth: f32 = f32(vcaTrem) * 0.28;

  // base env times (per-voice key-follow scaling applied below)
  const a1t: f32 = atkTime(pget(P_E1A)); const d1t: f32 = drTime(pget(P_E1D));
  const s1v: f32 = clampf(pget(P_E1S), 0.0, 1.0); const r1t: f32 = drTime(pget(P_E1R));
  const a2t: f32 = atkTime(pget(P_E2A)); const d2t: f32 = drTime(pget(P_E2D));
  const s2v: f32 = clampf(pget(P_E2S), 0.0, 1.0); const r2t: f32 = drTime(pget(P_E2R));

  // performance controls
  const perfSw: i32 = pbits(P_PERFSW);
  const bendV1: i32 = perfSw & 1;
  const bendV2: i32 = (perfSw >> 1) & 1;
  const bendVcf: i32 = (perfSw >> 2) & 1;
  const lfoModV: i32 = (perfSw >> 3) & 1;
  const lfoModF: i32 = (perfSw >> 4) & 1;
  const bender: f32 = clampf(pget(P_BENDER), -1.0, 1.0);
  const bendVcoSens: f32 = clampf(pget(P_BENDVCO), 0.0, 1.0);
  const bendVcfSens: f32 = clampf(pget(P_BENDVCF), 0.0, 1.0);
  const lfoModVcoSens: f32 = clampf(pget(P_LFOMODVCO), 0.0, 1.0);
  const lfoModVcfSens: f32 = clampf(pget(P_LFOMODVCF), 0.0, 1.0);
  const push: f32 = clampf(pget(P_LFOMODPUSH), 0.0, 1.0);
  const riseT: f32 = clampf(pget(P_LFOMODRISE), 0.0, 1.0) * 3.0; // 0..3 s
  const riseStep: f32 = riseT <= 0.001 ? 1.0 : 1.0 / (riseT * sr);

  const bendOct1: f32 = bendV1 == 1 ? bender * bendVcoSens : 0.0;   // ±1 oct
  const bendOct2: f32 = bendV2 == 1 ? bender * bendVcoSens : 0.0;
  const bendVcfOct: f32 = bendVcf == 1 ? bender * bendVcfSens * 4.0 : 0.0;

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.6;
  const voiceScale: f32 = assign == 3 ? 0.26 : 0.42;

  // arpeggiator clock
  const arpHz: f32 = 1.0 + clampf(pget(P_ARPRATE), 0.0, 1.0) * 19.0; // 1..20 Hz
  const arpInc: f32 = arpHz / sr;

  // per-voice env coefficients (key-follow scaled) — pitch stable per block
  for (let v = 0; v < NUM_VOICES; v++) {
    if (vActive[v] == 0) continue;
    const keyOct: f32 = f32(Mathf.log2(clampf(vCur[v], 8.0, 8000.0) / 261.63));
    const ks1: f32 = e1KF == 1 ? clampf(f32(Mathf.pow(2.0, -keyOct * 0.75)), 0.12, 4.0) : 1.0;
    const ks2: f32 = e2KF == 1 ? clampf(f32(Mathf.pow(2.0, -keyOct * 0.75)), 0.12, 4.0) : 1.0;
    vA1k[v] = 1.0 / (a1t * ks1 * sr);
    vD1k[v] = 1.0 - f32(Mathf.exp(-4.0 / (d1t * ks1 * sr)));
    vR1k[v] = 1.0 - f32(Mathf.exp(-4.0 / (r1t * ks1 * sr)));
    vA2k[v] = 1.0 / (a2t * ks2 * sr);
    vD2k[v] = 1.0 - f32(Mathf.exp(-4.0 / (d2t * ks2 * sr)));
    vR2k[v] = 1.0 - f32(Mathf.exp(-4.0 / (r2t * ks2 * sr)));
  }

  for (let f = 0; f < n; f++) {
    // ---- LFO + delay + aux rise ---------------------------------------
    const prevPh: f32 = lfoPhase;
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) { lfoPhase -= 1.0; if (lfoWave == 3) lfoSH = rngf(); }
    if (lfoDelayEnv < 1.0) { lfoDelayEnv += lfoDelayStep; if (lfoDelayEnv > 1.0) lfoDelayEnv = 1.0; }
    const lfoRaw: f32 = lfoShapeVal(lfoWave, lfoPhase);
    const lfo: f32 = lfoRaw * lfoDelayEnv;
    const lfo01: f32 = 0.5 + 0.5 * lfo;
    // aux LFO-mod fades in while the touch pad is pressed (p.14)
    const auxTarget: f32 = push;
    if (auxRise < auxTarget) { auxRise += riseStep; if (auxRise > auxTarget) auxRise = auxTarget; }
    else auxRise = auxTarget;
    const auxLfo: f32 = lfo * auxRise;

    // aux LFO-mod pitch/cutoff (performance)
    const auxOctVco: f32 = lfoModV == 1 ? auxLfo * lfoModVcoSens : 0.0;
    const auxOctVcf: f32 = lfoModF == 1 ? auxLfo * lfoModVcfSens * 4.0 : 0.0;

    // programmed LFO→pitch (VCO modulator)
    const lfoPitchOct: f32 = modLfoAmt * lfo;

    // ---- arpeggiator clock --------------------------------------------
    if (arpOn == 1 && hCount > 0) {
      arpClock += arpInc;
      if (arpClock >= 1.0) { arpClock -= 1.0; arpStep(); }
    }

    // pulse width (global for LFO/manual modes)
    let pwGlobal: f32;
    if (pwmMode == 0) pwGlobal = 0.5 + lfo * pwmDepth * 0.45;      // LFO
    else if (pwmMode == 1) pwGlobal = 0.5 - pwmDepth * 0.45;        // manual
    else pwGlobal = 0.5;                                            // ENV-1 (per voice below)
    pwGlobal = clampf(pwGlobal, 0.05, 0.95);

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- glide -------------------------------------------------------
      let cur: f32 = vCur[v];
      const tgt: f32 = vTarget[v];
      if (cur != tgt) {
        const gk: f32 = vGlideK[v];
        if (gk == 1.0) cur = tgt;
        else { cur *= gk; if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt; }
        vCur[v] = cur;
      }

      // ---- ENV-1 (assignable) -----------------------------------------
      let e1: f32 = vE1[v]; const st1: i32 = vS1[v];
      if (st1 == 1) { e1 += vA1k[v]; if (e1 >= 1.0) { e1 = 1.0; vS1[v] = 2; } }
      else if (st1 == 2) { e1 += (s1v - e1) * vD1k[v]; }
      else if (st1 == 4) { e1 += (0.0 - e1) * vR1k[v]; if (e1 <= 0.0004) e1 = 0.0; }
      vE1[v] = e1;
      const e1sig: f32 = e1 * e1Pol;

      // ---- ENV-2 (VCA / VCF) ------------------------------------------
      let e2: f32 = vE2[v]; const st2: i32 = vS2[v];
      if (st2 == 1) { e2 += vA2k[v]; if (e2 >= 1.0) { e2 = 1.0; vS2[v] = 2; } }
      else if (st2 == 2) { e2 += (s2v - e2) * vD2k[v]; }
      else if (st2 == 4) { e2 += (0.0 - e2) * vR2k[v]; if (e2 <= 0.0004) e2 = 0.0; }
      vE2[v] = e2;

      if (vGate[v] == 0 && e2 <= 0.0005 && st2 == 4) { vActive[v] = 0; continue; }

      // ---- VCO frequencies --------------------------------------------
      const det: f32 = vDet[v];
      const modPitch1: f32 = (freqDest == 2) ? 0.0 : (lfoPitchOct + modEnvAmt * e1sig * 2.0);
      const modPitch2: f32 = (freqDest == 0) ? 0.0 : (lfoPitchOct + modEnvAmt * e1sig * 2.0);
      const octV1: f32 = modPitch1 + bendOct1 + auxOctVco;
      const octV2: f32 = modPitch2 + bendOct2 + auxOctVco;

      const baseHz: f32 = cur * det * masterMul;
      let hz1: f32 = baseHz * range1Mul * f32(Mathf.pow(2.0, octV1));

      // ---- VCO-1 (master) — cross-modulated by VCO-2's previous output ---
      // (1-sample delay avoids a cross-mod / sync feedback loop; p.15)
      if (crossAmt > 0.0) hz1 *= f32(Mathf.pow(2.0, crossAmt * vPrevOsc2[v] * 2.0));
      let inc1: f32 = hz1 / sr; if (inc1 > 0.45) inc1 = 0.45; if (inc1 < 0.0) inc1 = 0.0;
      let ph1: f32 = vPh1[v] + inc1; const wrapped1: i32 = ph1 >= 1.0 ? 1 : 0; if (ph1 >= 1.0) ph1 -= 1.0;
      vPh1[v] = ph1;

      // ---- VCO-2 (slave) — SYNC hard-resets it to VCO-1 (p.16) ----------
      let hz2: f32;
      if (lowFreq == 1) hz2 = 0.3 * range2Mul * fine2 * f32(Mathf.pow(2.0, octV2)); // sub-audio, not key-tracked
      else hz2 = baseHz * range2Mul * fine2 * f32(Mathf.pow(2.0, octV2));
      let inc2: f32 = hz2 / sr; if (inc2 > 0.45) inc2 = 0.45; if (inc2 < 0.0) inc2 = 0.0;
      let ph2: f32 = vPh2[v] + inc2; if (ph2 >= 1.0) ph2 -= 1.0;
      if (sync == 1 && wrapped1 == 1) ph2 = 0.0;   // slave reset on master wrap
      vPh2[v] = ph2;

      // VCO-2 output (sine / saw / pulse / noise)
      let osc2: f32 = 0.0;
      if (wave2 == 0) osc2 = Mathf.sin(TWO_PI * ph2);
      else if (wave2 == 1) { osc2 = 2.0 * ph2 - 1.0; osc2 -= polyBlep(ph2, inc2); }
      else if (wave2 == 2) {
        let pw: f32 = pwmMode == 2 ? clampf(0.5 + e1sig * pwmDepth * 0.45, 0.05, 0.95) : pwGlobal;
        osc2 = ph2 < pw ? 1.0 : -1.0; osc2 += polyBlep(ph2, inc2);
        let q: f32 = ph2 - pw; if (q < 0.0) q += 1.0; osc2 -= polyBlep(q, inc2);
      } else osc2 = rngf(); // noise
      vPrevOsc2[v] = osc2;

      // VCO-1 output (tri / saw / pulse / square)
      let osc1: f32 = 0.0;
      if (wave1 == 0) { // triangle from integrated square-ish; use direct tri
        osc1 = ph1 < 0.5 ? (4.0 * ph1 - 1.0) : (3.0 - 4.0 * ph1);
      } else if (wave1 == 1) { osc1 = 2.0 * ph1 - 1.0; osc1 -= polyBlep(ph1, inc1); }
      else if (wave1 == 2) {
        let pw: f32 = pwmMode == 2 ? clampf(0.5 + e1sig * pwmDepth * 0.45, 0.05, 0.95) : pwGlobal;
        osc1 = ph1 < pw ? 1.0 : -1.0; osc1 += polyBlep(ph1, inc1);
        let q: f32 = ph1 - pw; if (q < 0.0) q += 1.0; osc1 -= polyBlep(q, inc1);
      } else { // square (fixed 50%)
        osc1 = ph1 < 0.5 ? 1.0 : -1.0; osc1 += polyBlep(ph1, inc1);
        let q: f32 = ph1 - 0.5; if (q < 0.0) q += 1.0; osc1 -= polyBlep(q, inc1);
      }

      // ---- source mix --------------------------------------------------
      let sig: f32 = osc1 * mixV1 + osc2 * mixV2;

      // ---- HPF (non-resonant, -6 dB/oct, p.18) ------------------------
      if (hpfN > 0.001) {
        const y: f32 = hpfA * (vHpY[v] + sig - vHpX[v]);
        vHpX[v] = sig; vHpY[v] = y; sig = y;
      }

      // ---- VCF cutoff assembly ----------------------------------------
      const keyOct: f32 = f32(Mathf.log2(clampf(cur, 8.0, 8000.0) / 261.63));
      const envForVcf: f32 = vcfEnvSel == 0 ? e1sig : e2;
      let fcOct: f32 = vcfEnvAmt * envForVcf * 6.0
                     + vcfKybd * keyOct
                     + vcfLfoAmt * lfo * 3.5
                     + auxOctVcf + bendVcfOct;
      let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
      fc = clampf(fc, 8.0, sr * 0.45);
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr)); if (g > 0.99) g = 0.99;

      let s0: f32 = vLp0[v]; let s1: f32 = vLp1[v]; let s2: f32 = vLp2[v]; let s3: f32 = vLp3[v];
      let inp: f32 = sig - kRes * s3;
      inp = f32(Mathf.tanh(inp));
      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);
      vLp0[v] = s0; vLp1[v] = s1; vLp2[v] = s2; vLp3[v] = s3;
      // SLOPE switch: -12 dB/oct taps the 2nd pole, -24 dB/oct the 4th (p.19)
      let y: f32 = slope12 == 1 ? s1 * (1.0 + kRes * 0.5) : s3 * (1.0 + kRes * 0.75);

      // ---- VCA (ENV-2 + LFO tremolo, p.20) ----------------------------
      let amp: f32 = e2 * vcaLevel;
      if (tremDepth > 0.0) amp *= (1.0 - tremDepth * (1.0 - lfo01));

      mono += y * amp;
    }

    mono *= voiceScale;
    let outv: f32 = f32(Mathf.tanh(mono * outGain));
    outBuf[f] = outv;
    outBuf[MAX_FRAMES + f] = outv;
  }
}
