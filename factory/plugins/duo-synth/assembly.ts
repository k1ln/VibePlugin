// =====================================================================
//  DUO SYNTH — a duophonic analog instrument
//  Two sawtooth oscillators that independently track the two most recent
//  held notes (duophonic allocation: lowest-priority note -> OSC 1, newest
//  -> OSC 2). With one note held both oscillators lock to it. An optional
//  hard-sync resets OSC 2's phase to OSC 1 for a buzzy, formant-rich tone.
//  Both oscillators sum into a shared resonant 4-pole low-pass swept by a
//  single ADSR (one VCF + one VCA, in the spirit of the classic duo-synth),
//  giving a sharp, punchy lead. Pure algorithm, no samples, no imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// --- parameter indices ---
const P_DETUNE: i32 = 0; // 0..1 -> osc2 spread 0..+12 semitones
const P_SYNC:   i32 = 1; // 0/1  -> hard-sync osc2 to osc1
const P_CUTOFF: i32 = 2; // 0..1 -> filter base cutoff
const P_RES:    i32 = 3; // 0..1 -> filter resonance
const P_ENVAMT: i32 = 4; // 0..1 -> how much the envelope opens the filter
const P_ATTACK: i32 = 5; // 0..1 -> attack time
const P_RELEAS: i32 = 6; // 0..1 -> release time
const P_LEVEL:  i32 = 7; // 0..1 -> output level

// --- duophonic note allocation: a tiny held-note stack (most-recent last) ---
const MAX_HELD: i32 = 16;
const heldIds:  StaticArray<i32> = new StaticArray<i32>(MAX_HELD);
const heldHz:   StaticArray<f32> = new StaticArray<f32>(MAX_HELD);
let heldCount: i32 = 0;

// --- oscillators ---
let phase1: f32 = 0.0;
let phase2: f32 = 0.0;
let freq1:  f32 = 0.0; // smoothed target Hz for osc 1
let freq2:  f32 = 0.0; // smoothed target Hz for osc 2
let tgt1:   f32 = 0.0;
let tgt2:   f32 = 0.0;

// --- envelope ---
let env:   f32 = 0.0;
let gate:  i32 = 0;
let vel:   f32 = 0.8;

// --- ladder-style 4-pole low-pass state (one shared filter) ---
let z1: f32 = 0.0;
let z2: f32 = 0.0;
let z3: f32 = 0.0;
let z4: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase1 = 0.0; phase2 = 0.0;
  freq1 = 0.0; freq2 = 0.0; tgt1 = 0.0; tgt2 = 0.0;
  env = 0.0; gate = 0; vel = 0.8;
  z1 = 0.0; z2 = 0.0; z3 = 0.0; z4 = 0.0;
  heldCount = 0;
  params[P_DETUNE] = 0.18;
  params[P_SYNC]   = 0.0;
  params[P_CUTOFF] = 0.42;
  params[P_RES]    = 0.45;
  params[P_ENVAMT] = 0.6;
  params[P_ATTACK] = 0.05;
  params[P_RELEAS] = 0.3;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Duophonic allocation. With the current held-note stack, choose the pitch
// for each oscillator: OSC 1 = lowest held note, OSC 2 = most-recent (top)
// held note. With a single note both oscillators track it. Silence (gate 0)
// is handled by the envelope, not here.
function reallocate(): void {
  if (heldCount <= 0) { gate = 0; return; }

  // most-recent note = top of stack
  const topHz: f32 = heldHz[heldCount - 1];

  // lowest held note
  let loHz: f32 = heldHz[0];
  for (let i = 1; i < heldCount; i++) {
    if (heldHz[i] < loHz) loHz = heldHz[i];
  }

  if (heldCount == 1) {
    tgt1 = topHz;
    tgt2 = topHz;
  } else {
    tgt1 = loHz;   // OSC 1 holds the lowest note
    tgt2 = topHz;  // OSC 2 takes the newest note
  }
  gate = 1;
}

export function noteOn(id: i32, f: f32, v: f32): void {
  // if this id is already held, drop the old entry first
  let w: i32 = 0;
  for (let r = 0; r < heldCount; r++) {
    if (heldIds[r] != id) {
      heldIds[w] = heldIds[r];
      heldHz[w]  = heldHz[r];
      w++;
    }
  }
  heldCount = w;

  if (heldCount >= MAX_HELD) {
    // drop the oldest to make room
    for (let r = 1; r < heldCount; r++) {
      heldIds[r - 1] = heldIds[r];
      heldHz[r - 1]  = heldHz[r];
    }
    heldCount--;
  }

  heldIds[heldCount] = id;
  heldHz[heldCount]  = f > 1.0 ? f : 1.0;
  heldCount++;

  vel = clampf(v, 0.0, 1.0);
  if (vel < 0.05) vel = 0.8;
  reallocate();
}

export function noteOff(id: i32): void {
  let w: i32 = 0;
  for (let r = 0; r < heldCount; r++) {
    if (heldIds[r] != id) {
      heldIds[w] = heldIds[r];
      heldHz[w]  = heldHz[r];
      w++;
    }
  }
  heldCount = w;
  reallocate();
}

export function process(n: i32): void {
  const detune: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const sync:   i32 = params[P_SYNC] >= 0.5 ? 1 : 0;
  const cutN:   f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:   f32 = clampf(params[P_RES], 0.0, 1.0);
  const envAmt: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const atkN:   f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const relN:   f32 = clampf(params[P_RELEAS], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // OSC 2 detune: up to +1 octave above its own note (spread the two voices)
  const detRatio: f32 = f32(Mathf.exp(detune * 0.69314718 * 1.0)); // up to ~ +12 semis

  // envelope rates (per-sample one-pole coefficients)
  const atkSec: f32 = 0.001 + atkN * atkN * 1.2;          // ~1ms .. ~1.2s
  const relSec: f32 = 0.005 + relN * relN * 2.0;          // ~5ms .. ~2s
  const atkC: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkSec * sampleRate)));
  const relC: f32 = f32(1.0 - Mathf.exp(-1.0 / (relSec * sampleRate)));

  // pitch glide smoothing (very fast — keeps things in tune, kills zipper)
  const glide: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.004 * sampleRate)));

  // filter resonance feedback (bounded well below self-destruction)
  const res: f32 = resN * 3.8;

  for (let f = 0; f < n; f++) {
    // smooth oscillator frequencies toward their allocated targets
    freq1 += glide * (tgt1 - freq1);
    freq2 += glide * (tgt2 - freq2);

    // envelope: attack toward vel while gated, release toward 0 when not
    if (gate == 1) env += atkC * (vel - env);
    else           env += relC * (0.0 - env);
    if (env < 0.0) env = 0.0;

    // --- oscillator 1 (saw) ---
    const inc1: f32 = freq1 / sampleRate;
    phase1 += inc1;
    let wrapped1: bool = false;
    if (phase1 >= 1.0) { phase1 -= 1.0; wrapped1 = true; }
    const saw1: f32 = phase1 * 2.0 - 1.0;

    // --- oscillator 2 (saw, detuned, optionally hard-synced to osc1) ---
    const inc2: f32 = (freq2 * detRatio) / sampleRate;
    phase2 += inc2;
    if (phase2 >= 1.0) phase2 -= 1.0;
    if (sync == 1 && wrapped1) phase2 = phase1;  // hard sync reset
    const saw2: f32 = phase2 * 2.0 - 1.0;

    // mix the two oscillators
    let mix: f32 = (saw1 + saw2) * 0.5;

    // --- shared resonant 4-pole low-pass (ladder approximation) ---
    // envelope opens the filter; base cutoff + env modulation
    const fenv: f32 = cutN + envAmt * env * (1.0 - cutN);
    let fc: f32 = fenv;
    if (fc < 0.0) fc = 0.0; if (fc > 1.0) fc = 1.0;
    // map normalized cutoff to a one-pole coefficient (musical, exp-ish)
    const cutHz: f32 = 30.0 + fc * fc * 11000.0;
    let g: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * cutHz / sampleRate));
    if (g > 0.99) g = 0.99;

    // resonance feedback from the 4th stage
    let inp: f32 = mix - res * z4;
    // mild saturation on the feedback path keeps resonance bounded & analog
    inp = inp - (inp * inp * inp) * 0.16;

    z1 += g * (inp - z1);
    z2 += g * (z1 - z2);
    z3 += g * (z2 - z3);
    z4 += g * (z3 - z4);

    const filtered: f32 = z4;

    let s: f32 = filtered * env * vel * level * 1.6;
    // final safety clip — keep peak under ~1.0
    if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;

    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
