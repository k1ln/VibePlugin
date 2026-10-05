// =====================================================================
//  core.ts — shared primitives for KGrbdPa: ABI buffers, packed-parameter
//  decoding (with MIDI-CC overrides), noise, saturators, one-pole filters.
//  Pasted after the generated tables. Everything is f32 and allocation-free
//  after init().
//
//  VOLTAGE MODEL: every jack of the patch bay carries volts, like the hardware:
//  audio ±5 V (10 Vpp), pitch CV 1 V/oct, gate 0/+8 V, envelope 0…+8 V,
//  KB VEL 0…+5 V. The host sees ±1 = ±8 V.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;
const C4_HZ: f32 = 261.6255653;           // 8' at MIDI note 60 (concert pitch)

const inBuf  = new StaticArray<f32>(MAX_FRAMES * 2);
const outBuf = new StaticArray<f32>(MAX_FRAMES * 2);
const params = new StaticArray<f32>(MAX_PARAMS);
const display = new StaticArray<f32>(16);

let SR: f32 = 48000.0;
let invSR: f32 = 1.0 / 48000.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function minf(a: f32, b: f32): f32 { return a < b ? a : b; }
@inline function maxf(a: f32, b: f32): f32 { return a > b ? a : b; }
@inline function absf(x: f32): f32 { return x < 0.0 ? -x : x; }
@inline function exp2f(x: f32): f32 { return Mathf.exp(x * <f32>0.6931472); }
@inline function finite(x: f32): f32 { return (x > -1.0e6 && x < 1.0e6) ? x : <f32>0.0; }
@inline function denorm(x: f32): f32 { return (x > 1.0e-18 || x < -1.0e-18) ? x : <f32>0.0; }

// ---- noise -------------------------------------------------------------
let rng: u32 = 0x9e3779b9;
@inline function white(): f32 {
  rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
  return f32(rng) * <f32>4.656612873e-10 - <f32>1.0;      // [-1, 1)
}
@inline function rand01(): f32 { return (white() + <f32>1.0) * <f32>0.5; }

// ---- saturators ----------------------------------------------------------
// identity near 0, saturates at ±1
@inline function softclip(x: f32): f32 {
  if (x > 3.0) return 1.0;
  if (x < -3.0) return -1.0;
  const x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}
// transparent below `knee`, smooth tanh knee up to `ceil` (both in the signal's units)
@inline function kneeClip(x: f32, knee: f32, ceil: f32): f32 {
  const a = x < 0.0 ? -x : x;
  if (a <= knee) return x;
  const w = ceil - knee;
  const m: f32 = knee + w * Mathf.tanh((a - knee) / w);
  return x < 0.0 ? -m : m;
}

// ---- packed parameters -------------------------------------------------------
// params[] holds the host slots. Every logical parameter lives in one slot as a
// mixed-radix digit (factory/kgrbdpa/params.mjs). A[] = decoded actual values,
// An[] = the same normalised 0..1, AI[] = integer value (for int/sel params).
// MIDI CCs write A/An/AI directly; the value stays until the HOST changes that
// parameter again (RH/AH remember the last host-side value per parameter).
const A = new StaticArray<f32>(NP);
const An = new StaticArray<f32>(NP);
const AI = new StaticArray<i32>(NP);
const RH = new StaticArray<i32>(NP);      // last host raw digit (packed params)
const AH = new StaticArray<f32>(NP);      // last host value (direct params)
const slotCache = new StaticArray<f32>(MAX_PARAMS);
let paramsDirty: bool = true;             // set whenever any parameter changed (host or CC)

function decodeSlot(s: i32, v: f32): void {
  let k: i32 = i32(nearest<f32>(v));
  if (k < 0) k = 0;
  if (k > 16777215) k = 16777215;
  for (let i = 0; i < NP; i++) {
    if (unchecked(PSLOT[i]) != s) continue;
    const lo = unchecked(PMIN[i]);
    const hi = unchecked(PMAX[i]);
    if (unchecked(PDIRECT[i]) != 0) {
      const a = clampf(v, lo, hi);
      if (a == unchecked(AH[i])) continue;
      unchecked(AH[i] = a);
      unchecked(A[i] = a);
      unchecked(An[i] = (a - lo) / (hi - lo));
      unchecked(AI[i] = 0);
    } else {
      const steps = unchecked(PSTEPS[i]);
      const raw = (k / unchecked(PMULT[i])) % steps;
      if (raw == unchecked(RH[i])) continue;
      unchecked(RH[i] = raw);
      const n: f32 = steps > 1 ? f32(raw) / f32(steps - 1) : <f32>0.0;
      unchecked(An[i] = n);
      unchecked(A[i] = lo + f32(raw));
      unchecked(AI[i] = i32(lo) + raw);
    }
    paramsDirty = true;
  }
}
// Returns true when any slot changed since the last call.
function refreshParams(): bool {
  let changed = false;
  for (let s = 0; s < NUM_PARAMS; s++) {
    const v = unchecked(params[s]);
    if (v != unchecked(slotCache[s])) { unchecked(slotCache[s] = v); decodeSlot(s, v); changed = true; }
  }
  return changed;
}
// MIDI CC → parameter, n = 0..1 across the control's whole range
function setParamN(i: i32, n: f32): void {
  const nn = clampf(n, 0.0, 1.0);
  const lo = unchecked(PMIN[i]);
  const hi = unchecked(PMAX[i]);
  if (unchecked(PDIRECT[i]) != 0) {
    unchecked(A[i] = lo + nn * (hi - lo));
    unchecked(An[i] = nn);
  } else {
    const steps = unchecked(PSTEPS[i]);
    let raw: i32 = i32(nearest<f32>(nn * f32(steps - 1)));
    if (raw < 0) raw = 0; if (raw > steps - 1) raw = steps - 1;
    unchecked(An[i] = steps > 1 ? f32(raw) / f32(steps - 1) : <f32>0.0);
    unchecked(A[i] = lo + f32(raw));
    unchecked(AI[i] = i32(lo) + raw);
  }
  paramsDirty = true;
}
function setParamI(i: i32, v: i32): void {
  const lo = i32(unchecked(PMIN[i]));
  const steps = unchecked(PSTEPS[i]);
  let raw = v - lo;
  if (raw < 0) raw = 0; if (raw > steps - 1) raw = steps - 1;
  unchecked(An[i] = steps > 1 ? f32(raw) / f32(steps - 1) : <f32>0.0);
  unchecked(A[i] = f32(lo + raw));
  unchecked(AI[i] = lo + raw);
  paramsDirty = true;
}
@inline function pv(i: i32): f32 { return unchecked(A[i]); }       // actual value
@inline function pn(i: i32): f32 { return unchecked(An[i]); }      // 0..1
@inline function pi(i: i32): i32 { return unchecked(AI[i]); }      // integer / list index

// ---- host transport / tempo ------------------------------------------------
let hostBpm: f32 = 0.0;
let hostPlaying: i32 = 0;
let hostPpq: f64 = 0.0;
let hostPpqFresh: bool = false;
function setHostTransport(playing: i32, ppq: f64, bpm: f32): void {
  hostBpm = bpm; hostPlaying = playing; hostPpq = ppq; hostPpqFresh = true;
}
@inline function hostTempo(): f32 {
  const t = unchecked(params[63]);
  return t > 1.0 ? t : (hostBpm > 1.0 ? hostBpm : <f32>0.0);
}

// ---- one-pole filters -------------------------------------------------------
class OnePole {
  z: f32 = 0;
  lp(x: f32, a: f32): f32 { this.z = denorm(this.z + a * (x - this.z)); return this.z; }
  hp(x: f32, a: f32): f32 { this.z = denorm(this.z + a * (x - this.z)); return x - this.z; }
}
@inline function onePoleA(fc: f32): f32 { return <f32>1.0 - Mathf.exp(-TWO_PI * clampf(fc, 0.01, SR * 0.45) * invSR); }
// zero-delay (trapezoidal) one-pole high-pass: exact at fc, used by the HIGH PASS filter
class Hp1 {
  s: f32 = 0;
  tick(x: f32, g: f32): f32 {
    const G = g / (<f32>1.0 + g);
    const v = (x - this.s) * G;
    const lp = v + this.s;
    this.s = denorm(lp + v);
    return x - lp;
  }
}
