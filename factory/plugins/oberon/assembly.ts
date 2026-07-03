// =====================================================================
//  OBERON — an eight-voice polyphonic analog synthesizer modelled
//  control-for-control on the ORIGINAL 1979 Oberheim OB-X
//  (OB-X Owner's Manual, 2nd Ed. / 2nd Printing, June 1980).
//
//  This is the FIRST OB-X, deliberately NOT the later OB-Xa:
//   * ONE filter only — a SEM-derived 2-pole (12 dB/oct) resonant
//     low-pass (TPT state-variable). No selectable 4-pole slope.
//   * Smoother, less-screaming SEM resonance (Q, not ladder feedback).
//   * No filter-envelope-to-oscillator routing (that was the OB-Xa).
//
//  Per voice = 2 VCOs, a 2-pole SVF, a Filter ADSR + a Loudness ADSR
//  and a VCA (manual FEATURES p.1: "Two Oscillators per Voice",
//  "Two Full ADSR Envelope Generators per Voice").
//
//  CONTROL section (manual p.9): PORTAMENTO (polyphonic glide), UNISON
//  (low-note-priority stack), OSC 2 DETUNE (flat/sharp of OSC 1),
//  MASTER TUNE (p.8).
//  MODULATION section (manual p.10): one LFO with RATE and SINE /
//  SQUARE / S&H waveforms; a FREQUENCY column (DEPTH -> OSC 1 / OSC 2 /
//  FILTER) and a PULSE WIDTH column (DEPTH -> OSC 1 / OSC 2).
//  OSCILLATORS: OSC 1 & OSC 2 each a continuous FREQUENCY control (p.4:
//  ~11 o'clock = one octave up), independent SAW + PULSE waveform
//  switches summed additively, a shared PULSE WIDTH, and SYNC (OSC 2
//  slaved to OSC 1).
//  FILTER: the OB-X mixer buttons select sources (OSC 1 on/off, OSC 2
//  off/half/full, NOISE on/off) into a FREQUENCY / RESONANCE /
//  MODULATION (filter-env amount) 2-pole low-pass with keyboard TRACK
//  (100% or off).
//  MANUAL section (p.7-8): VOLUME, HOLD (latch), MASTER TUNE. Pitch and
//  Modulation levers (p.1) — the MOD lever fades LFO vibrato in. A
//  stereo PAN SPREAD echoes the OB-X's per-voice pan pots (p.3).
//
//  Switch groups are bit-packed; the GUI decodes them. AUTO auto-tune,
//  the 32-program cassette/programmer memory and CHORD-memory transpose
//  are host/hardware concerns and out of scope. Allocation-free.
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
const P_FREQDEPTH: i32 = 1;   // FREQUENCY DEPTH (LFO -> pitch)
const P_PWDEPTH: i32 = 2;     // PULSE WIDTH DEPTH (LFO -> PW)
const P_MTUNE: i32 = 3;       // -1..1 -> +/-50 cents
const P_PORTA: i32 = 4;
const P_OSC2DET: i32 = 5;     // -1..1 -> +/-50 cents (flat/sharp)
const P_OSC1FREQ: i32 = 6;    // 0..1 continuous -> 0..30 semitones
const P_OSC2FREQ: i32 = 7;    // 0..1 continuous -> 0..30 semitones
const P_PW: i32 = 8;          // shared duty
const P_CUTOFF: i32 = 9;
const P_RESO: i32 = 10;
const P_FMOD: i32 = 11;       // MODULATION: filter-env -> filter cutoff
const P_FA: i32 = 12;
const P_FD: i32 = 13;
const P_FS: i32 = 14;
const P_FR: i32 = 15;
const P_LA: i32 = 16;
const P_LD: i32 = 17;
const P_LS: i32 = 18;
const P_LR: i32 = 19;
const P_BEND: i32 = 20;       // -1..1 performance
const P_MODLEVER: i32 = 21;   // 0..1 performance (adds LFO vibrato)
const P_BENDRANGE: i32 = 22;  // 0..12 semitones
const P_SPREAD: i32 = 23;     // 0..1 stereo pan spread (pan pots)
const P_VOLUME: i32 = 24;
const P_OSCSW: i32 = 25;      // mask: b0 o1saw,b1 o1pul,b2 o2saw,b3 o2pul,b4 sync
const P_MODSW: i32 = 26;      // mask: b0-1 lfowave,b2 fOsc1,b3 fOsc2,b4 fFilt,b5 pwOsc1,b6 pwOsc2
const P_FILTSW: i32 = 27;     // mask: b0 osc1,b1-2 osc2route(0/1/2),b3 noise,b4 track
const P_MODESW: i32 = 28;     // mask: b0 unison, b1 hold

const NUM_PARAMS: i32 = 29;

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

// ENV knob -> time. Attack 1 ms..5 s ; Decay/Release 1 ms..10 s
@inline function atkTime(nn: f32): f32 { return 0.001 * f32(Mathf.pow(5000.0, clampf(nn, 0.0, 1.0))); }
@inline function drTime(nn: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(nn, 0.0, 1.0))); }

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // OSC1 phase
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // OSC2 phase
const vDet:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // unison detune mult
const vPan:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // fixed pan seat [-1..1]
// Filter ENV
const vFe:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFs:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle,1 A,2 D->S,4 R
// Loudness ENV
const vLe:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLs:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
// per-voice 2-pole SVF integrator state (Cytomic TPT SVF)
const vIc1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vIc2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// held-key list (unison / hold priority)
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hPhys:  StaticArray<i32> = new StaticArray<i32>(HELD_MAX); // physically held (0 = latched by HOLD)
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global LFO + noise + performance
let lfoPhase: f32 = 0.0;
let lfoSH: f32 = 0.0;
let noiseLp: f32 = 0.0;      // pink-ish noise state
let modLeverEnv: f32 = 0.0;  // MOD lever fade
let lastUnison: i32 = -1;
let lastMode: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 1.0;
    vCur[v] = 261.63; vTarget[v] = 261.63; vGlideK[v] = 1.0;
    vPh1[v] = 0.11 * f32(v); vPh2[v] = 0.23 * f32(v); vDet[v] = 1.0;
    vPan[v] = (f32(v) / f32(NUM_VOICES - 1)) * 2.0 - 1.0; // -1..+1 seat per voice
    vFe[v] = 0.0; vFs[v] = 0; vLe[v] = 0.0; vLs[v] = 0;
    vIc1[v] = 0.0; vIc2[v] = 0.0;
  }
  hCount = 0; orderCounter = 0; ageCounter = 1; lastPlayedHz = 261.63;
  lfoPhase = 0.0; lfoSH = 0.0; noiseLp = 0.0; modLeverEnv = 0.0;
  lastUnison = -1; lastMode = 0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_LFORATE] = 0.3; params[P_FREQDEPTH] = 0.08; params[P_PWDEPTH] = 0.12;
  params[P_MTUNE] = 0.0; params[P_PORTA] = 0.0; params[P_OSC2DET] = 0.09;
  params[P_OSC1FREQ] = 0.0; params[P_OSC2FREQ] = 0.0; params[P_PW] = 0.4;
  params[P_CUTOFF] = 0.42; params[P_RESO] = 0.2; params[P_FMOD] = 0.5;
  params[P_FA] = 0.05; params[P_FD] = 0.6; params[P_FS] = 0.3; params[P_FR] = 0.5;
  params[P_LA] = 0.12; params[P_LD] = 0.6; params[P_LS] = 0.85; params[P_LR] = 0.6;
  params[P_BEND] = 0.0; params[P_MODLEVER] = 0.0; params[P_BENDRANGE] = 2.0;
  params[P_SPREAD] = 0.5; params[P_VOLUME] = 0.8;
  params[P_OSCSW] = 5.0; params[P_MODSW] = 0.0; params[P_FILTSW] = 21.0; params[P_MODESW] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- portamento (p.9: polyphonic glide, rate knob) --------------------
function computeGlideK(v: i32): void {
  vGlideK[v] = 1.0;
  const t: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  if (t <= 0.002) { vCur[v] = vTarget[v]; return; }
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  const secPerOct: f32 = 0.006 * f32(Mathf.pow(500.0, t)); // ~0.006..3 s/oct
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
    vFs[slot] = 1; vLs[slot] = 1;
    if (vActive[slot] == 0) {
      vFe[slot] = 0.0; vLe[slot] = 0.0;
      vIc1[slot] = 0.0; vIc2[slot] = 0.0;
    }
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot);
  vAge[slot] = ageCounter++;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) { vGate[i] = 0; vFs[i] = 4; vLs[i] = 4; }
  }
}
function releaseAllVoices(): void {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vFs[i] = 4; vLs[i] = 4; }
}

function physCount(): i32 {
  let c: i32 = 0;
  for (let i = 0; i < hCount; i++) if (hPhys[i] == 1) c++;
  return c;
}

// UNISON (p.9): all voices sound one key, low-note priority, detuned stack
function unisonStack(newPress: i32): void {
  if (hCount == 0) { releaseAllVoices(); return; }
  let pick: i32 = 0;
  for (let i = 1; i < hCount; i++) if (hFreq[i] < hFreq[pick]) pick = i; // low-note priority
  const legato: i32 = physCount() > 1 ? 1 : 0;
  const retrig: i32 = newPress == 1 ? (legato == 1 ? 0 : 1) : 0;
  const baseHz: f32 = hFreq[pick];
  const vel: f32 = hVel[pick];
  for (let s = 0; s < NUM_VOICES; s++) {
    const cents: f32 = (f32(s) - f32(NUM_VOICES - 1) * 0.5) * 8.0; // ~+/-28c spread
    const det: f32 = f32(Mathf.pow(2.0, cents / 1200.0));
    triggerVoice(s, hId[pick], baseHz, vel, retrig, legato, det);
  }
  lastPlayedHz = baseHz;
}

// ---- held-list maintenance -------------------------------------------
function heldAdd(id: i32, hz: f32, vel: f32): void {
  const hold: i32 = (pbits(P_MODESW) >> 1) & 1;
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

// ---- note events (host / GUI) ----------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  heldAdd(id, hz, vel);
  const unison: i32 = pbits(P_MODESW) & 1;
  if (unison == 1) { unisonStack(1); return; }
  // POLY: 8-voice, multi-trigger
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  triggerVoice(slot, id, hz, vel, 1, 0, 1.0);
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  const hold: i32 = (pbits(P_MODESW) >> 1) & 1;
  if (hold == 1) { for (let i = 0; i < hCount; i++) if (hId[i] == id) hPhys[i] = 0; return; }
  heldRemove(id);
  const unison: i32 = pbits(P_MODESW) & 1;
  if (unison == 1) { if (hCount == 0) releaseAllVoices(); else unisonStack(0); return; }
  releaseId(id);
}

// ---- LFO shape (p.10): SINE / SQUARE / S&H ----------------------------
@inline function lfoShapeVal(shp: i32, ph: f32): f32 {
  if (shp == 0) return Mathf.sin(TWO_PI * ph);
  if (shp == 1) return ph < 0.5 ? 1.0 : -1.0;  // square
  return lfoSH;                                 // sample & hold
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- mode edges (UNISON / HOLD) ------------------------------------
  const mode: i32 = pbits(P_MODESW);
  const unison: i32 = mode & 1;
  const hold: i32 = (mode >> 1) & 1;
  const modeWas: i32 = lastMode;
  if ((modeWas & 1) != unison) {
    if (unison == 1) { if (hCount > 0) unisonStack(0); }
    else {
      releaseAllVoices();
      for (let i = 0; i < hCount && i < NUM_VOICES; i++) { const s: i32 = allocVoice(); triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0, 1.0); }
    }
  }
  if (((modeWas >> 1) & 1) == 1 && hold == 0) {
    for (let i = hCount - 1; i >= 0; i--) if (hPhys[i] == 0) { releaseId(hId[i]); heldRemove(hId[i]); }
    if (unison == 1) { if (hCount == 0) releaseAllVoices(); else unisonStack(0); }
  }
  lastMode = mode;
  lastUnison = unison;

  // ---- per-block parameter mapping -----------------------------------
  const lfoHz: f32 = 0.1 * f32(Mathf.pow(200.0, clampf(pget(P_LFORATE), 0.0, 1.0))); // ~0.1..20 Hz
  const lfoInc: f32 = lfoHz / sr;

  const modSw: i32 = pbits(P_MODSW);
  const lfoWave: i32 = modSw & 3;              // 0 sine,1 square,2 s&h
  const fOsc1: i32 = (modSw >> 2) & 1;
  const fOsc2: i32 = (modSw >> 3) & 1;
  const fFilt: i32 = (modSw >> 4) & 1;
  const pwOsc1: i32 = (modSw >> 5) & 1;
  const pwOsc2: i32 = (modSw >> 6) & 1;

  const lfoFreqDepth: f32 = clampf(pget(P_FREQDEPTH), 0.0, 1.0);
  const pwmDepth: f32 = clampf(pget(P_PWDEPTH), 0.0, 1.0);

  const oscSw: i32 = pbits(P_OSCSW);
  const o1saw: i32 = oscSw & 1;
  const o1pul: i32 = (oscSw >> 1) & 1;
  const o2saw: i32 = (oscSw >> 2) & 1;
  const o2pul: i32 = (oscSw >> 3) & 1;
  const sync: i32 = (oscSw >> 4) & 1;

  // OSC 1 / OSC 2 continuous frequency: 0..1 -> 0..30 semitones
  // (manual p.4: ~11 o'clock ~= +1 octave). Not quantized -> allows detuning.
  const osc1Mul: f32 = f32(Mathf.pow(2.0, clampf(pget(P_OSC1FREQ), 0.0, 1.0) * 30.0 / 12.0));
  const osc2Mul: f32 = f32(Mathf.pow(2.0, clampf(pget(P_OSC2FREQ), 0.0, 1.0) * 30.0 / 12.0));
  const det2: f32 = f32(Mathf.pow(2.0, clampf(pget(P_OSC2DET), -1.0, 1.0) * 50.0 / 1200.0));
  const masterMul: f32 = f32(Mathf.pow(2.0, clampf(pget(P_MTUNE), -1.0, 1.0) * 50.0 / 1200.0));

  const pwBase: f32 = 0.5 + clampf(pget(P_PW), 0.0, 1.0) * 0.45; // 50%..95%

  const filtSw: i32 = pbits(P_FILTSW);
  const srcOsc1: i32 = filtSw & 1;
  const srcOsc2: i32 = (filtSw >> 1) & 3;       // 0 off,1 half,2 full
  const srcNoise: i32 = (filtSw >> 3) & 1;
  const track: i32 = (filtSw >> 4) & 1;         // keyboard track (100% / off)
  const osc2Lvl: f32 = srcOsc2 == 2 ? 1.0 : (srcOsc2 == 1 ? 0.56 : 0.0);

  const cutN: f32 = clampf(pget(P_CUTOFF), 0.0, 1.0);
  const fcBase: f32 = 16.0 * f32(Mathf.pow(2.0, cutN * 10.3)); // ~16 Hz..~20 kHz
  const resN: f32 = clampf(pget(P_RESO), 0.0, 1.0);
  // SEM 2-pole: damping k = 1/Q. res 0 -> k=2.0 (gentle), res 1 -> k~0.06
  // (Q~17). Smoother than a ladder -- the OB-X never self-oscillated wildly.
  const svfK: f32 = 2.0 - 1.94 * resN;
  const fMod: f32 = clampf(pget(P_FMOD), 0.0, 1.0);

  // envelope base times
  const faT: f32 = atkTime(pget(P_FA)); const fdT: f32 = drTime(pget(P_FD));
  const fsV: f32 = clampf(pget(P_FS), 0.0, 1.0); const frT: f32 = drTime(pget(P_FR));
  const laT: f32 = atkTime(pget(P_LA)); const ldT: f32 = drTime(pget(P_LD));
  const lsV: f32 = clampf(pget(P_LS), 0.0, 1.0); const lrT: f32 = drTime(pget(P_LR));
  const faK: f32 = 1.0 / (faT * sr);
  const fdK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (fdT * sr)));
  const frK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (frT * sr)));
  const laK: f32 = 1.0 / (laT * sr);
  const ldK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (ldT * sr)));
  const lrK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (lrT * sr)));

  // performance
  const bender: f32 = clampf(pget(P_BEND), -1.0, 1.0);
  const bendRange: f32 = clampf(pget(P_BENDRANGE), 0.0, 12.0);
  const bendOct: f32 = bender * bendRange / 12.0;
  const modLever: f32 = clampf(pget(P_MODLEVER), 0.0, 1.0);
  const spread: f32 = clampf(pget(P_SPREAD), 0.0, 1.0);

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.3;
  const voiceScale: f32 = unison == 1 ? 0.30 : 0.44;

  for (let f = 0; f < n; f++) {
    // ---- LFO -----------------------------------------------------------
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) { lfoPhase -= 1.0; if (lfoWave >= 2) lfoSH = rngf(); }
    const lfo: f32 = lfoShapeVal(lfoWave, lfoPhase);
    // MOD lever fades LFO vibrato in (p.1 modulation lever); adds to freq depth
    if (modLeverEnv < modLever) { modLeverEnv += 1.0 / (0.25 * sr); if (modLeverEnv > modLever) modLeverEnv = modLever; }
    else modLeverEnv = modLever;
    const freqLfoAmt: f32 = clampf(lfoFreqDepth + modLeverEnv, 0.0, 1.0);
    const lfoPitchOct: f32 = lfo * freqLfoAmt * 0.5;   // up to +/-0.5 oct
    const lfoFiltOct: f32 = fFilt == 1 ? lfo * lfoFreqDepth * 3.5 : 0.0;

    // pink-ish noise (one-pole smoothed white)
    const wn: f32 = rngf();
    noiseLp = noiseLp * 0.85 + wn * 0.15;
    const noise: f32 = (noiseLp * 3.2 + wn * 0.3);

    // pulse width w/ LFO PWM
    let pw1: f32 = pwOsc1 == 1 ? pwBase + lfo * pwmDepth * 0.4 : pwBase;
    let pw2: f32 = pwOsc2 == 1 ? pwBase + lfo * pwmDepth * 0.4 : pwBase;
    pw1 = clampf(pw1, 0.05, 0.95); pw2 = clampf(pw2, 0.05, 0.95);

    let leftOut: f32 = 0.0;
    let rightOut: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- glide ------------------------------------------------------
      let cur: f32 = vCur[v];
      const tgt: f32 = vTarget[v];
      if (cur != tgt) {
        const gk: f32 = vGlideK[v];
        if (gk == 1.0) cur = tgt;
        else { cur *= gk; if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt; }
        vCur[v] = cur;
      }

      // ---- Filter ENV -------------------------------------------------
      let fe: f32 = vFe[v]; const fst: i32 = vFs[v];
      if (fst == 1) { fe += faK; if (fe >= 1.0) { fe = 1.0; vFs[v] = 2; } }
      else if (fst == 2) { fe += (fsV - fe) * fdK; }
      else if (fst == 4) { fe += (0.0 - fe) * frK; if (fe <= 0.0004) fe = 0.0; }
      vFe[v] = fe;

      // ---- Loudness ENV -----------------------------------------------
      let le: f32 = vLe[v]; const lst: i32 = vLs[v];
      if (lst == 1) { le += laK; if (le >= 1.0) { le = 1.0; vLs[v] = 2; } }
      else if (lst == 2) { le += (lsV - le) * ldK; }
      else if (lst == 4) { le += (0.0 - le) * lrK; if (le <= 0.0004) le = 0.0; }
      vLe[v] = le;

      if (vGate[v] == 0 && le <= 0.0005 && lst == 4) { vActive[v] = 0; continue; }

      const det: f32 = vDet[v];
      const baseHz: f32 = cur * det * masterMul;

      // pitch mod offsets (octaves)
      const octLfo1: f32 = fOsc1 == 1 ? lfoPitchOct : 0.0;
      const octLfo2: f32 = fOsc2 == 1 ? lfoPitchOct : 0.0;

      // ---- OSC 1 (master) --------------------------------------------
      let hz1: f32 = baseHz * osc1Mul * f32(Mathf.pow(2.0, octLfo1 + bendOct));
      let inc1: f32 = hz1 / sr; if (inc1 > 0.45) inc1 = 0.45; if (inc1 < 0.0) inc1 = 0.0;
      let ph1: f32 = vPh1[v] + inc1; const wrapped1: i32 = ph1 >= 1.0 ? 1 : 0; if (ph1 >= 1.0) ph1 -= 1.0;
      vPh1[v] = ph1;

      // ---- OSC 2 (coarse + detune; SYNC slave) ------------------------
      let hz2: f32 = baseHz * osc2Mul * det2 * f32(Mathf.pow(2.0, octLfo2 + bendOct));
      let inc2: f32 = hz2 / sr; if (inc2 > 0.45) inc2 = 0.45; if (inc2 < 0.0) inc2 = 0.0;
      let ph2: f32 = vPh2[v] + inc2; if (ph2 >= 1.0) ph2 -= 1.0;
      if (sync == 1 && wrapped1 == 1) ph2 = 0.0;  // OSC2 slaved to OSC1
      vPh2[v] = ph2;

      // ---- OSC 1 output (SAW + PULSE additive) ------------------------
      let osc1: f32 = 0.0;
      if (o1saw == 1) { let s: f32 = 2.0 * ph1 - 1.0; s -= polyBlep(ph1, inc1); osc1 += s * 0.6; }
      if (o1pul == 1) {
        let p: f32 = ph1 < pw1 ? 1.0 : -1.0; p += polyBlep(ph1, inc1);
        let q: f32 = ph1 - pw1; if (q < 0.0) q += 1.0; p -= polyBlep(q, inc1);
        p -= (2.0 * pw1 - 1.0);          // remove pulse DC offset
        osc1 += p * 0.5;
      }
      // ---- OSC 2 output (SAW + PULSE additive) ------------------------
      let osc2: f32 = 0.0;
      if (o2saw == 1) { let s: f32 = 2.0 * ph2 - 1.0; s -= polyBlep(ph2, inc2); osc2 += s * 0.6; }
      if (o2pul == 1) {
        let p: f32 = ph2 < pw2 ? 1.0 : -1.0; p += polyBlep(ph2, inc2);
        let q: f32 = ph2 - pw2; if (q < 0.0) q += 1.0; p -= polyBlep(q, inc2);
        p -= (2.0 * pw2 - 1.0);          // remove pulse DC offset
        osc2 += p * 0.5;
      }

      // ---- source select into filter (OB-X mixer buttons) -------------
      let sig: f32 = 0.0;
      if (srcOsc1 == 1) sig += osc1;
      if (osc2Lvl > 0.0) sig += osc2 * osc2Lvl;
      if (srcNoise == 1) sig += noise * 0.5;

      // ---- filter cutoff assembly -------------------------------------
      const keyOct: f32 = f32(Mathf.log2(clampf(cur, 8.0, 8000.0) / 261.63));
      let fcOct: f32 = fMod * fe * 6.0 + lfoFiltOct;
      if (track == 1) fcOct += keyOct;
      let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
      fc = clampf(fc, 8.0, sr * 0.45);

      // ---- SEM-style 2-pole TPT state-variable low-pass (12 dB/oct) ---
      // Cytomic's zero-delay-feedback SVF; low-pass output = v2.
      const g: f32 = f32(Mathf.tan(PI * fc / sr));
      const a1: f32 = 1.0 / (1.0 + g * (g + svfK));
      const a2: f32 = g * a1;
      const a3: f32 = g * a2;
      let ic1: f32 = vIc1[v]; let ic2: f32 = vIc2[v];
      const drive: f32 = f32(Mathf.tanh(sig * 0.8)); // gentle SEM input warmth
      const v3: f32 = drive - ic2;
      const v1: f32 = a1 * ic1 + a2 * v3;
      const v2: f32 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2.0 * v1 - ic1;
      ic2 = 2.0 * v2 - ic2;
      vIc1[v] = ic1; vIc2[v] = ic2;
      const y: f32 = v2 * (1.0 + resN * 0.5); // small make-up as Q rises

      // ---- VCA (Loudness ENV) + pan (per-voice pan pots) --------------
      const amp: f32 = y * le;
      const pan: f32 = vPan[v] * spread;               // -1..1
      const pn: f32 = (pan + 1.0) * 0.25 * PI;          // 0..PI/2
      leftOut  += amp * f32(Mathf.cos(pn));
      rightOut += amp * f32(Mathf.sin(pn));
    }

    leftOut *= voiceScale; rightOut *= voiceScale;
    outBuf[f] = f32(Mathf.tanh(leftOut * outGain));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(rightOut * outGain));
  }
}
