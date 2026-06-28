// =====================================================================
//  FM TINES — bright FM electric-piano / bell synth
//  A polyphonic 2-operator phase-modulation engine: a modulator operator
//  phase-modulates a carrier, with a fast-decaying modulation-index
//  envelope that gives the classic struck-tine "bell" attack that mellows
//  into a pure sine body. A per-voice amp envelope (attack + exponential
//  decay/release) and a one-pole brightness tilt finish the tone.
//  Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_VOICES: i32 = 16;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831853071795864769;

// ---- per-voice state (parallel StaticArrays, no allocation in process) ----
const vActive:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = in use
const vGate:     StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = key held
const vNote:     StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // note id
const vCarPh:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // carrier phase (radians)
const vModPh:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // modulator phase (radians)
const vFreq:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // carrier Hz
const vVel:      StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // 0..1
const vAmp:      StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // current amp-env level
const vIdxEnv:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // current mod-index env (0..1)
const vAge:      StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // for voice-steal LRU
const vTilt:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // brightness one-pole state

let ageCounter: f32 = 0.0;

// ---- parameter indices (MUST match spec.json) ----
const P_RATIO:    i32 = 0; // modulator:carrier frequency ratio  (0.5 .. 14)
const P_FMAMOUNT: i32 = 1; // modulation index depth             (0 .. 1)
const P_MODDECAY: i32 = 2; // mod-index env decay time           (0 .. 1)
const P_ATTACK:   i32 = 3; // amp attack                         (0 .. 1)
const P_RELEASE:  i32 = 4; // amp decay/release                  (0 .. 1)
const P_BRIGHT:   i32 = 5; // brightness tilt                    (0 .. 1)
const P_LEVEL:    i32 = 6; // output level                       (0 .. 1)

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let v = 0; v < MAX_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    vCarPh[v] = 0.0; vModPh[v] = 0.0; vFreq[v] = 0.0;
    vVel[v] = 0.0; vAmp[v] = 0.0; vIdxEnv[v] = 0.0; vAge[v] = 0.0; vTilt[v] = 0.0;
  }
  ageCounter = 0.0;
  params[P_RATIO]    = 0.5;   // -> ~3.5 ratio area (bell/tine sweet spot)
  params[P_FMAMOUNT] = 0.55;
  params[P_MODDECAY] = 0.45;
  params[P_ATTACK]   = 0.04;
  params[P_RELEASE]  = 0.55;
  params[P_BRIGHT]   = 0.6;
  params[P_LEVEL]    = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- note handling: find a free (or oldest) voice ----
export function noteOn(id: i32, freq: f32, velocity: f32): void {
  if (freq <= 0.0) freq = 1.0;
  // reuse a voice already playing this id, else a free slot, else steal oldest
  let slot: i32 = -1;
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) { slot = v; break; }
  }
  if (slot < 0) {
    for (let v = 0; v < MAX_VOICES; v++) {
      if (vActive[v] == 0) { slot = v; break; }
    }
  }
  if (slot < 0) {
    let oldest: f32 = vAge[0]; slot = 0;
    for (let v = 1; v < MAX_VOICES; v++) {
      if (vAge[v] < oldest) { oldest = vAge[v]; slot = v; }
    }
  }
  ageCounter += 1.0;
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vNote[slot]   = id;
  vFreq[slot]   = freq;
  vVel[slot]    = clampf(velocity, 0.0, 1.0);
  vCarPh[slot]  = 0.0;
  vModPh[slot]  = 0.0;
  vAmp[slot]    = 0.0;
  vIdxEnv[slot] = 1.0;   // index env starts bright, then decays
  vAge[slot]    = ageCounter;
  vTilt[slot]   = 0.0;
}

export function noteOff(id: i32): void {
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) vGate[v] = 0;
  }
}

export function process(n: i32): void {
  // ---- resolve params once per block ----
  const ratio: f32    = 0.5 + clampf(params[P_RATIO], 0.0, 1.0) * 13.5;        // 0.5 .. 14
  const fmAmt: f32     = clampf(params[P_FMAMOUNT], 0.0, 1.0);
  const modDecayN: f32 = clampf(params[P_MODDECAY], 0.0, 1.0);
  const attackN: f32   = clampf(params[P_ATTACK], 0.0, 1.0);
  const releaseN: f32  = clampf(params[P_RELEASE], 0.0, 1.0);
  const brightN: f32   = clampf(params[P_BRIGHT], 0.0, 1.0);
  const level: f32     = clampf(params[P_LEVEL], 0.0, 1.0) * 0.85;

  // modulation index depth: scale so timbre clearly opens up with FMAmount
  const peakIndex: f32 = fmAmt * 9.0;

  // mod-index env decay: 30 ms (snappy bell) .. 2.5 s (slow chime)
  const idxDecaySec: f32 = 0.03 + modDecayN * modDecayN * 2.47;
  const idxDecayCoef: f32 = f32(Mathf.exp(-1.0 / (idxDecaySec * sampleRate)));

  // amp attack: 1 ms .. 250 ms (one-pole rise toward velocity)
  const attackSec: f32 = 0.001 + attackN * attackN * 0.249;
  const attackCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (attackSec * sampleRate)));

  // amp decay (while held) and release (after note-off).
  // Electric-piano body: held notes ring out and fade; longer with Release.
  const relSec: f32 = 0.08 + releaseN * releaseN * 5.0;          // 80 ms .. ~5 s
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relSec * sampleRate)));
  // sustained decay is a gentle fraction of release so held tines slowly fade
  const decSec: f32 = relSec * 3.0;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decSec * sampleRate)));

  // brightness tilt: low-pass that opens with brightN (1.5 kHz .. ~18 kHz)
  let cutHz: f32 = 1500.0 + brightN * brightN * 16500.0;
  if (cutHz > sampleRate * 0.45) cutHz = sampleRate * 0.45;
  let tiltCoef: f32 = f32(1.0 - Mathf.exp(-TWO_PI * cutHz / sampleRate));
  tiltCoef = clampf(tiltCoef, 0.0, 1.0);
  // mix the tilt in: at high brightness pass more of the raw (bright) signal
  const tiltMix: f32 = 0.25 + brightN * 0.75;

  const invSr: f32 = 1.0 / sampleRate;

  // ---- clear output block ----
  for (let f = 0; f < n; f++) {
    outBuf[f] = 0.0;
    outBuf[MAX_FRAMES + f] = 0.0;
  }

  // ---- render each active voice (mono sum, copied to both channels) ----
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] == 0) continue;

    const f0: f32 = vFreq[v];
    const carInc: f32 = TWO_PI * f0 * invSr;
    const modInc: f32 = TWO_PI * f0 * ratio * invSr;
    const vel: f32 = vVel[v];
    const ampTarget: f32 = vel;          // attack rises to velocity
    const gate: i32 = vGate[v];

    let carPh: f32 = vCarPh[v];
    let modPh: f32 = vModPh[v];
    let amp: f32 = vAmp[v];
    let idxEnv: f32 = vIdxEnv[v];
    let tilt: f32 = vTilt[v];
    let reachedAttack: bool = amp >= ampTarget * 0.999 || ampTarget <= 0.0001;

    for (let f = 0; f < n; f++) {
      // mod-index envelope: decays from 1 toward 0
      idxEnv *= idxDecayCoef;
      const index: f32 = peakIndex * idxEnv;

      // amp envelope: attack to velocity, then decay (held) / release (off)
      if (gate != 0 && !reachedAttack) {
        amp += attackCoef * (ampTarget - amp);
        if (amp >= ampTarget * 0.999) { amp = ampTarget; reachedAttack = true; }
      } else if (gate != 0) {
        amp *= decCoef;     // held: slow electric-piano decay
      } else {
        amp *= relCoef;     // released: faster fade
      }

      // 2-operator FM: modulator sine phase-modulates the carrier
      const modOut: f32 = Mathf.sin(modPh) * index;
      let s: f32 = Mathf.sin(carPh + modOut);

      // velocity scales brightness a touch (harder hits = more index already)
      s *= amp;

      // brightness tilt (one-pole LP) mixed with raw for an airy top
      tilt += tiltCoef * (s - tilt);
      const shaped: f32 = tilt + (s - tilt) * tiltMix;

      outBuf[f] += shaped;

      carPh += carInc; if (carPh >= TWO_PI) carPh -= TWO_PI;
      modPh += modInc; if (modPh >= TWO_PI) modPh -= TWO_PI;
    }

    vCarPh[v] = carPh;
    vModPh[v] = modPh;
    vAmp[v] = amp;
    vIdxEnv[v] = idxEnv;
    vTilt[v] = tilt;

    // retire voice once it has faded out and the key is released
    if (gate == 0 && amp < 0.00008) {
      vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    }
  }

  // ---- output level + soft safety limit, copy mono to stereo ----
  for (let f = 0; f < n; f++) {
    let s: f32 = outBuf[f] * level;
    // gentle soft clip keeps dense chords < 1.0 without audible harshness
    if (s > 1.2) s = 1.2; else if (s < -1.2) s = -1.2;
    s = f32(s - 0.16666667 * s * s * s);
    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
