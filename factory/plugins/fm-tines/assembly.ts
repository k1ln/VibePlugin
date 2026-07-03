// =====================================================================
//  FM TINES — a 16-voice polyphonic 6-operator FM synthesizer modelled
//  on the YAMAHA DX7 (Operating Manual, read cover to cover).
//
//  A real FM tone generator (manual pp.9-16): six sine OPERATORS, each
//  with pitch (ratio or fixed), OUTPUT LEVEL, DETUNE and a 4-stage A-D-S-R
//  envelope (a musical compaction of the DX7 R1-4/L1-4 EG). The 32
//  ALGORITHMS (p.11, exact DX7 routing table) wire the operators into
//  carrier/modulator topologies; carriers sum to the output, modulators
//  phase-modulate their targets, and one operator per algorithm has
//  FEEDBACK (p.13). A global LFO (p.13: 6 waves, speed/delay/PMD/AMD/
//  key-sync) plus pitch/amp MOD SENSITIVITY (p.14) drive vibrato/tremolo;
//  a PITCH EG (p.17) bends the attack; performance section (pp.6-8):
//  transpose, master tune, poly/mono, portamento (fingered/full-time,
//  glissando), pitch-bend range + wheel, and mod-wheel / breath /
//  after-touch each routable to pitch / amplitude / EG bias.
//
//  Switch groups are bit-packed into Op Mask + Switch Mask; the GUI
//  decodes them. Pure algorithm, no imports, alloc-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 16;
const NOPS: i32 = 6;
const NV6: i32 = NUM_VOICES * NOPS;   // per-voice-per-operator state
const HELD_MAX: i32 = 24;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;
const FM_INDEX: f32 = 6.2;   // radians of phase-mod per unit modulator signal

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
// per-operator block: 7 params (ratio,level,detune,atk,dec,sus,rel)
const OP_STRIDE: i32 = 7;
const O_RATIO: i32 = 0; const O_LEVEL: i32 = 1; const O_DETUNE: i32 = 2;
const O_ATK: i32 = 3; const O_DEC: i32 = 4; const O_SUS: i32 = 5; const O_REL: i32 = 6;

const P_ALGO: i32 = 42;
const P_FEEDBACK: i32 = 43;
const P_OPMASK: i32 = 44;     // bits0-5 op enable, bits6-11 op fixed-freq
const P_SWMASK: i32 = 45;     // routing/mode switches (see bits below)
const P_LFOSPEED: i32 = 46;
const P_LFODELAY: i32 = 47;
const P_LFOPMD: i32 = 48;
const P_LFOAMD: i32 = 49;
const P_LFOWAVE: i32 = 50;
const P_PMODSENS: i32 = 51;
const P_AMODSENS: i32 = 52;
const P_PEGAMT: i32 = 53;
const P_PEGRATE: i32 = 54;
const P_TRANSPOSE: i32 = 55;
const P_TUNE: i32 = 56;
const P_PORTA: i32 = 57;
const P_BENDRANGE: i32 = 58;
const P_PITCHWHEEL: i32 = 59;
const P_MODWHEEL: i32 = 60;
const P_BREATH: i32 = 61;
const P_AFTERTOUCH: i32 = 62;
const P_VOLUME: i32 = 63;

const NUM_PARAMS: i32 = 64;

// switch mask bits (P_SWMASK)
const SW_MONO: i32 = 1;        // bit0 1=mono 0=poly
const SW_PORTA_ON: i32 = 2;    // bit1 portamento on
const SW_GLISS: i32 = 4;       // bit2 glissando (stepped)
const SW_LFO_KEYSYNC: i32 = 8; // bit3 LFO retriggers on key
const SW_OSC_SYNC: i32 = 16;   // bit4 oscillators reset phase on key
const SW_MW_PITCH: i32 = 32;   // bit5 mod wheel -> pitch (LFO vibrato depth)
const SW_MW_AMP: i32 = 64;     // bit6 mod wheel -> amplitude (LFO tremolo)
const SW_MW_EGB: i32 = 128;    // bit7 mod wheel -> EG bias (brightness)
const SW_BR_PITCH: i32 = 256;  // bit8 breath -> pitch
const SW_BR_AMP: i32 = 512;    // bit9 breath -> amplitude
const SW_BR_EGB: i32 = 1024;   // bit10 breath -> EG bias
const SW_AT_PITCH: i32 = 2048; // bit11 after-touch -> pitch
const SW_AT_AMP: i32 = 4096;   // bit12 after-touch -> amplitude
const SW_AT_EGB: i32 = 8192;   // bit13 after-touch -> EG bias

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

// envelope knob -> seconds (exponential). Attack ~1ms..4s ; Dec/Rel ~3ms..12s
@inline function atkTime(nn: f32): f32 { return 0.001 * f32(Mathf.pow(4000.0, clampf(nn, 0.0, 1.0))); }
@inline function decTime(nn: f32): f32 { return 0.003 * f32(Mathf.pow(4000.0, clampf(nn, 0.0, 1.0))); }

// ---- the 32 DX7 algorithms (Dexed/DX7 ROM bit-bus encoding) ----------
//  array index 0..5 = operators OP6,OP5,OP4,OP3,OP2,OP1 (slot -> op = 5-slot)
//  byte: bits0-1 out bus (0=main output), bit2 add-to-bus, bits4-5 in bus,
//        bit6 feedback-in (this op is the feedback operator).
const ALG: StaticArray<i32> = new StaticArray<i32>(32 * 6);

function initAlgorithms(): void {
  const t: i32[] = [
    0xc1,0x11,0x11,0x14,0x01,0x14,  // 1
    0x01,0x11,0x11,0x14,0xc1,0x14,  // 2
    0xc1,0x11,0x14,0x01,0x11,0x14,  // 3
    0xc1,0x11,0x94,0x01,0x11,0x14,  // 4
    0xc1,0x14,0x01,0x14,0x01,0x14,  // 5
    0xc1,0x94,0x01,0x14,0x01,0x14,  // 6
    0xc1,0x11,0x05,0x14,0x01,0x14,  // 7
    0x01,0x11,0xc5,0x14,0x01,0x14,  // 8
    0x01,0x11,0x05,0x14,0xc1,0x14,  // 9
    0x01,0x05,0x14,0xc1,0x11,0x14,  // 10
    0xc1,0x05,0x14,0x01,0x11,0x14,  // 11
    0x01,0x05,0x05,0x14,0xc1,0x14,  // 12
    0xc1,0x05,0x05,0x14,0x01,0x14,  // 13
    0xc1,0x05,0x11,0x14,0x01,0x14,  // 14
    0x01,0x05,0x11,0x14,0xc1,0x14,  // 15
    0xc1,0x11,0x02,0x25,0x05,0x14,  // 16
    0x01,0x11,0x02,0x25,0xc5,0x14,  // 17
    0x01,0x11,0x11,0xc5,0x05,0x14,  // 18
    0xc1,0x14,0x14,0x01,0x11,0x14,  // 19
    0x01,0x05,0x14,0xc1,0x14,0x14,  // 20
    0x01,0x14,0x14,0xc1,0x14,0x14,  // 21
    0xc1,0x14,0x14,0x14,0x01,0x14,  // 22
    0xc1,0x14,0x14,0x01,0x14,0x04,  // 23
    0xc1,0x14,0x14,0x14,0x04,0x04,  // 24
    0xc1,0x14,0x14,0x04,0x04,0x04,  // 25
    0xc1,0x05,0x14,0x01,0x14,0x04,  // 26
    0x01,0x05,0x14,0xc1,0x14,0x04,  // 27
    0x04,0xc1,0x11,0x14,0x01,0x14,  // 28
    0xc1,0x14,0x01,0x14,0x04,0x04,  // 29
    0x04,0xc1,0x11,0x14,0x04,0x04,  // 30
    0xc1,0x14,0x04,0x04,0x04,0x04,  // 31
    0xc4,0x04,0x04,0x04,0x04,0x04   // 32
  ];
  for (let i = 0; i < 32 * 6; i++) ALG[i] = t[i];
}

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPeg:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pitch EG value (semitones)

// per-operator state (index vo = v*6 + op)
const oPhase: StaticArray<f32> = new StaticArray<f32>(NV6);
const oEnv:   StaticArray<f32> = new StaticArray<f32>(NV6);
const oStage: StaticArray<i32> = new StaticArray<i32>(NV6); // 0 idle,1 atk,2 dec/sus,3 rel
const oFb1:   StaticArray<f32> = new StaticArray<f32>(NV6); // feedback memory
const oFb2:   StaticArray<f32> = new StaticArray<f32>(NV6);

const hId: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global LFO
let lfoPhase: f32 = 0.0;
let lfoSH: f32 = 0.0;      // sample & hold value
let lfoDelay: f32 = 1.0;   // delay ramp 0..1

// ---- init ------------------------------------------------------------
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  initAlgorithms();

  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 0.8;
    vCur[v] = 261.63; vTarget[v] = 261.63; vPeg[v] = 0.0;
  }
  for (let i = 0; i < NV6; i++) {
    oPhase[i] = 0.0; oEnv[i] = 0.0; oStage[i] = 0; oFb1[i] = 0.0; oFb2[i] = 0.0;
  }
  hCount = 0; ageCounter = 1; lastPlayedHz = 261.63;
  lfoPhase = 0.0; lfoSH = 0.0; lfoDelay = 1.0;

  // boot defaults = spec.json (host may render before pushing params)
  // operators (7 each): ratio, level, detune, atk, dec, sus, rel
  setOp(0, 1.0,  0.99, 0.0,  0.01, 0.55, 0.28, 0.35);
  setOp(1, 14.0, 0.62, 0.0,  0.005,0.30, 0.0,  0.30);
  setOp(2, 1.0,  0.70, 0.22, 0.01, 0.60, 0.30, 0.40);
  setOp(3, 1.0,  0.45, 0.0,  0.01, 0.50, 0.15, 0.40);
  setOp(4, 1.0,  0.55, -0.22,0.02, 0.70, 0.35, 0.45);
  setOp(5, 1.0,  0.32, 0.0,  0.01, 0.40, 0.10, 0.40);
  params[P_ALGO] = 4.0; params[P_FEEDBACK] = 3.0;
  params[P_OPMASK] = 63.0; params[P_SWMASK] = 32.0;
  params[P_LFOSPEED] = 0.35; params[P_LFODELAY] = 0.0;
  params[P_LFOPMD] = 0.10; params[P_LFOAMD] = 0.0; params[P_LFOWAVE] = 4.0;
  params[P_PMODSENS] = 3.0; params[P_AMODSENS] = 0.0;
  params[P_PEGAMT] = 0.0; params[P_PEGRATE] = 0.5;
  params[P_TRANSPOSE] = 0.0; params[P_TUNE] = 0.0; params[P_PORTA] = 0.10;
  params[P_BENDRANGE] = 2.0; params[P_PITCHWHEEL] = 0.0;
  params[P_MODWHEEL] = 0.0; params[P_BREATH] = 0.0; params[P_AFTERTOUCH] = 0.0;
  params[P_VOLUME] = 0.70;
}

function setOp(op: i32, ratio: f32, level: f32, detune: f32, a: f32, d: f32, s: f32, r: f32): void {
  const b = op * OP_STRIDE;
  params[b + O_RATIO] = ratio; params[b + O_LEVEL] = level; params[b + O_DETUNE] = detune;
  params[b + O_ATK] = a; params[b + O_DEC] = d; params[b + O_SUS] = s; params[b + O_REL] = r;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- voice allocation ------------------------------------------------
function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function heldAdd(id: i32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) return;
  if (hCount < HELD_MAX) { hId[hCount] = id; hCount++; }
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) {
    for (let j = i + 1; j < hCount; j++) hId[j - 1] = hId[j];
    hCount--; return;
  }
}
function anyActive(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1) return 1;
  return 0;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const mono: i32 = (pbits(P_SWMASK) & SW_MONO) != 0 ? 1 : 0;
  const wasSilent: i32 = anyActive() == 0 ? 1 : 0;
  heldAdd(id);

  let slot: i32 = -1;
  if (mono == 1) {
    for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1) { slot = i; break; }
  } else {
    for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  }
  if (slot < 0) slot = allocVoice();
  const wasIdle: i32 = vActive[slot] == 0 ? 1 : 0;

  vNote[slot] = id;
  vTarget[slot] = hz;
  vVel[slot] = clampf(vel, 0.0, 1.0);

  const portaOn: i32 = (pbits(P_SWMASK) & SW_PORTA_ON) != 0 ? 1 : 0;
  if (portaOn == 1) { if (wasIdle == 1 || mono == 1) vCur[slot] = lastPlayedHz; }
  else vCur[slot] = hz;

  // pitch EG initial offset (semitones), decays to 0
  vPeg[slot] = clampf(pget(P_PEGAMT), -1.0, 1.0) * 24.0;

  // (re)trigger operator envelopes
  const oscSync: i32 = (pbits(P_SWMASK) & SW_OSC_SYNC) != 0 ? 1 : 0;
  for (let op = 0; op < NOPS; op++) {
    const vo = slot * NOPS + op;
    oStage[vo] = 1;
    if (wasIdle == 1) { oEnv[vo] = 0.0; oFb1[vo] = 0.0; oFb2[vo] = 0.0; }
    if (oscSync == 1) oPhase[vo] = 0.0;
  }
  vActive[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++;
  lastPlayedHz = hz;

  // LFO key sync / delay restart
  if ((pbits(P_SWMASK) & SW_LFO_KEYSYNC) != 0) lfoPhase = 0.0;
  if (wasSilent == 1) lfoDelay = 0.0;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  heldRemove(id);
  const mono: i32 = (pbits(P_SWMASK) & SW_MONO) != 0 ? 1 : 0;
  if (mono == 1 && hCount > 0) {
    // mono legato: fall back to the most-recent still-held key
    const nid = hId[hCount - 1];
    for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1) {
      vNote[i] = nid; vTarget[i] = 440.0 * f32(Mathf.pow(2.0, f32(nid - 69) / 12.0));
      return;
    }
  }
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      for (let op = 0; op < NOPS; op++) oStage[i * NOPS + op] = 3;
    }
  }
}

// operator fixed-frequency mapping: ratio knob -> Hz (~20..2000 Hz)
@inline function fixedHz(ratio: f32): f32 {
  return 20.0 * f32(Mathf.pow(2.0, clampf(ratio, 0.5, 32.0) * 0.22));
}

// LFO waveform (0 tri,1 saw dn,2 saw up,3 square,4 sine,5 S&H), phase 0..1
@inline function lfoWave(w: i32, ph: f32): f32 {
  if (w == 0) return 1.0 - 4.0 * Mathf.abs(ph - 0.5);          // triangle
  if (w == 1) return 1.0 - 2.0 * ph;                           // saw down
  if (w == 2) return 2.0 * ph - 1.0;                           // saw up
  if (w == 3) return ph < 0.5 ? 1.0 : -1.0;                    // square
  if (w == 4) return Mathf.sin(TWO_PI * ph);                   // sine
  return lfoSH;                                                 // sample & hold
}

// per-op cached params (module scope so process() stays alloc-free)
const ratios  = new StaticArray<f32>(6);
const levels  = new StaticArray<f32>(6);
const detCents= new StaticArray<f32>(6);
const atkIncA = new StaticArray<f32>(6);
const decKA   = new StaticArray<f32>(6);
const susLA   = new StaticArray<f32>(6);
const relKA   = new StaticArray<f32>(6);
const fixedMode = new StaticArray<i32>(6);

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  let algIdx: i32 = pbits(P_ALGO); if (algIdx < 0) algIdx = 0; if (algIdx > 31) algIdx = 31;
  const algBase: i32 = algIdx * 6;
  const opMask: i32 = pbits(P_OPMASK);
  const swMask: i32 = pbits(P_SWMASK);

  const fbAmt: f32 = clampf(pget(P_FEEDBACK), 0.0, 7.0) / 7.0 * 3.3;

  // count carriers for output normalisation
  let nCar: i32 = 0;
  for (let slot = 0; slot < 6; slot++) {
    const op = 5 - slot;
    if ((opMask & (1 << op)) == 0) continue;
    if ((ALG[algBase + slot] & 0x03) == 0) nCar++;
  }
  if (nCar < 1) nCar = 1;
  const carScale: f32 = 0.9 / f32(Mathf.sqrt(f32(nCar)));

  for (let op = 0; op < 6; op++) {
    const b = op * OP_STRIDE;
    ratios[op] = clampf(pget(b + O_RATIO), 0.5, 32.0);
    levels[op] = clampf(pget(b + O_LEVEL), 0.0, 1.0);
    detCents[op] = clampf(pget(b + O_DETUNE), -1.0, 1.0) * 14.0; // +/-14 cents
    atkIncA[op] = 1.0 / (atkTime(pget(b + O_ATK)) * sr);
    decKA[op] = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(b + O_DEC)) * sr)));
    susLA[op] = clampf(pget(b + O_SUS), 0.0, 1.0);
    relKA[op] = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(b + O_REL)) * sr)));
    fixedMode[op] = (opMask & (1 << (op + 6))) != 0 ? 1 : 0;
  }

  // global controls
  const transpose: f32 = f32(pbits(P_TRANSPOSE));
  const tuneSemi: f32 = clampf(pget(P_TUNE), -1.0, 1.0) * 0.75; // +/-75 cents
  const bendSemi: f32 = clampf(pget(P_PITCHWHEEL), -1.0, 1.0) * f32(pbits(P_BENDRANGE));
  const pModSens: f32 = clampf(pget(P_PMODSENS), 0.0, 7.0) / 7.0;
  const aModSens: f32 = clampf(pget(P_AMODSENS), 0.0, 3.0) / 3.0;
  const pmd: f32 = clampf(pget(P_LFOPMD), 0.0, 1.0);
  const amd: f32 = clampf(pget(P_LFOAMD), 0.0, 1.0);
  const lfoWaveN: i32 = pbits(P_LFOWAVE);
  const lfoHz: f32 = 0.1 * f32(Mathf.pow(300.0, clampf(pget(P_LFOSPEED), 0.0, 1.0)));
  const lfoInc: f32 = lfoHz / sr;
  const delaySec: f32 = 0.002 + clampf(pget(P_LFODELAY), 0.0, 1.0) * 4.0;
  const delayInc: f32 = 1.0 / (delaySec * sr);

  // controller routing
  const mw: f32 = clampf(pget(P_MODWHEEL), 0.0, 1.0);
  const br: f32 = clampf(pget(P_BREATH), 0.0, 1.0);
  const at: f32 = clampf(pget(P_AFTERTOUCH), 0.0, 1.0);
  let ctlPitch: f32 = 0.0, ctlAmp: f32 = 0.0, ctlEgb: f32 = 0.0;
  if ((swMask & SW_MW_PITCH) != 0) ctlPitch += mw;
  if ((swMask & SW_BR_PITCH) != 0) ctlPitch += br;
  if ((swMask & SW_AT_PITCH) != 0) ctlPitch += at;
  if ((swMask & SW_MW_AMP) != 0) ctlAmp += mw;
  if ((swMask & SW_BR_AMP) != 0) ctlAmp += br;
  if ((swMask & SW_AT_AMP) != 0) ctlAmp += at;
  if ((swMask & SW_MW_EGB) != 0) ctlEgb += mw;
  if ((swMask & SW_BR_EGB) != 0) ctlEgb += br;
  if ((swMask & SW_AT_EGB) != 0) ctlEgb += at;
  const egBias: f32 = clampf(ctlEgb, 0.0, 3.0) * 0.25; // brightness/level lift

  const portaOn: i32 = (swMask & SW_PORTA_ON) != 0 ? 1 : 0;
  const glissOn: i32 = (swMask & SW_GLISS) != 0 ? 1 : 0;
  const portaT: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  const pegRateK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(P_PEGRATE)) * sr)));

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 1.05;

  for (let f = 0; f < n; f++) {
    // ---- global LFO advance ----
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) { lfoPhase -= 1.0; lfoSH = rngf(); }
    if (lfoDelay < 1.0) { lfoDelay += delayInc; if (lfoDelay > 1.0) lfoDelay = 1.0; }
    const lfo: f32 = lfoWave(lfoWaveN, lfoPhase) * lfoDelay;

    // LFO -> pitch (vibrato) depth in semitones; controllers add on top
    const pitchModDepth: f32 = pmd * pModSens + ctlPitch;
    const lfoPitchSemi: f32 = lfo * pitchModDepth * 2.0;
    // LFO -> amplitude (tremolo) depth; controllers add on top
    const ampModDepth: f32 = amd * (0.34 + 0.66 * aModSens) + ctlAmp;
    const ampGainMod: f32 = 1.0 - clampf(ampModDepth, 0.0, 1.0) * 0.5 * (0.5 + 0.5 * lfo);

    let outMono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // portamento glide
      let cur: f32 = vCur[v]; const tgt: f32 = vTarget[v];
      if (portaOn == 1 && cur != tgt) {
        const secPerOct: f32 = 0.004 * f32(Mathf.pow(700.0, portaT));
        const step: f32 = f32(Mathf.pow(2.0, 1.0 / (secPerOct * sr)));
        if (tgt > cur) { cur *= step; if (cur > tgt) cur = tgt; }
        else { cur /= step; if (cur < tgt) cur = tgt; }
        vCur[v] = cur;
      } else if (portaOn == 0 && cur != tgt) { cur = tgt; vCur[v] = tgt; }
      let noteHz: f32 = cur;
      if (portaOn == 1 && glissOn == 1) {
        const semi: f32 = Mathf.round(12.0 * f32(Mathf.log2(noteHz / 261.63)));
        noteHz = 261.63 * f32(Mathf.pow(2.0, semi / 12.0));
      }

      // pitch EG decays toward 0
      let peg: f32 = vPeg[v];
      if (peg > 0.0001 || peg < -0.0001) { peg += (0.0 - peg) * pegRateK; vPeg[v] = peg; }
      else { peg = 0.0; vPeg[v] = 0.0; }

      const vel: f32 = vVel[v];
      const velGain: f32 = 0.30 + 0.70 * vel;

      // total pitch offset for this voice (semitones)
      const pitchSemi: f32 = transpose + tuneSemi + bendSemi + lfoPitchSemi + peg;
      const pitchMul: f32 = f32(Mathf.pow(2.0, pitchSemi / 12.0));

      // ---- FM operator graph ----
      let bus1: f32 = 0.0, bus2: f32 = 0.0;
      let carrierSum: f32 = 0.0;
      let carEnvSum: f32 = 0.0;

      for (let slot = 0; slot < 6; slot++) {
        const op = 5 - slot;
        const vo = v * NOPS + op;
        const byte = ALG[algBase + slot];

        // envelope
        let e: f32 = oEnv[vo]; const st = oStage[vo];
        if (st == 1) { e += atkIncA[op]; if (e >= 1.0) { e = 1.0; oStage[vo] = 2; } }
        else if (st == 2) { e += (susLA[op] - e) * decKA[op]; }
        else if (st == 3) { e += (0.0 - e) * relKA[op]; if (e <= 0.0003) e = 0.0; }
        oEnv[vo] = e;

        const enabled: i32 = (opMask & (1 << op)) != 0 ? 1 : 0;
        const lvl: f32 = enabled == 0 ? 0.0 : clampf(levels[op] * velGain + egBias, 0.0, 1.4);

        // frequency
        let opHz: f32;
        if (fixedMode[op] == 1) opHz = fixedHz(ratios[op]);
        else opHz = noteHz * ratios[op];
        opHz *= pitchMul * f32(Mathf.pow(2.0, detCents[op] / 1200.0));
        let inc: f32 = opHz / sr; if (inc > 0.5) inc = 0.5; if (inc < 0.0) inc = 0.0;
        let ph: f32 = oPhase[vo] + inc; if (ph >= 1.0) ph -= f32(i32(ph)); oPhase[vo] = ph;

        // modulation input (radians)
        const inbus = (byte >> 4) & 0x03;
        let modr: f32 = inbus == 1 ? bus1 : (inbus == 2 ? bus2 : 0.0);
        if ((byte & 0x40) != 0) modr += fbAmt * (oFb1[vo] + oFb2[vo]) * 0.5;

        const s: f32 = Mathf.sin(TWO_PI * ph + modr);
        const opSig: f32 = lvl * e * s;

        if ((byte & 0x40) != 0) { oFb2[vo] = oFb1[vo]; oFb1[vo] = opSig; }

        const outbus = byte & 0x03;
        if (outbus == 0) {
          carrierSum += opSig;               // carrier -> output
          carEnvSum += e * f32(enabled);
        } else {
          const contrib: f32 = opSig * FM_INDEX;
          const add: i32 = (byte & 0x04) != 0 ? 1 : 0;
          if (outbus == 1) { if (add == 1) bus1 += contrib; else bus1 = contrib; }
          else { if (add == 1) bus2 += contrib; else bus2 = contrib; }
        }
      }

      outMono += carrierSum * ampGainMod;

      // free voice when released and carriers silent
      if (vGate[v] == 0 && carEnvSum <= 0.0004) vActive[v] = 0;
    }

    const sample: f32 = f32(Mathf.tanh(outMono * carScale * outGain));
    outBuf[f] = sample;
    outBuf[MAX_FRAMES + f] = sample;
  }
}
