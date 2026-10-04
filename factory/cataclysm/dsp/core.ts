// =====================================================================
//  core.ts — shared primitives for CATACLYSM: ABI buffers, packed-parameter
//  decoding, noise, filters, shapers. Pasted after the generated tables.
//  Everything is f32 and allocation-free after init().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_PARAMS: i32 = 64;
const TICK: i32 = 16;                 // control-rate block (samples)
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;
const LN10_60: f32 = 6.907755;        // ln(1000): a 60 dB fall

const inBuf  = new StaticArray<f32>(MAX_FRAMES * 2);
const outBuf = new StaticArray<f32>(MAX_FRAMES * 2);
const params = new StaticArray<f32>(MAX_PARAMS);
const display = new StaticArray<f32>(16);

let SR: f32 = 48000.0;
let invSR: f32 = 1.0 / 48000.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function lerpf(a: f32, b: f32, t: f32): f32 { return a + (b - a) * t; }
@inline function minf(a: f32, b: f32): f32 { return a < b ? a : b; }
@inline function maxf(a: f32, b: f32): f32 { return a > b ? a : b; }
@inline function exp2f(x: f32): f32 { return Mathf.exp(x * <f32>0.6931472); }
@inline function dbToGain(db: f32): f32 { return Mathf.exp(db * <f32>0.11512925); }
// layer level params are dB with true silence at the bottom of the range
@inline function lvlGain(db: f32): f32 { return db <= -59.5 ? <f32>0.0 : Mathf.exp(db * <f32>0.11512925); }
@inline function sign(x: f32): f32 { return x < 0.0 ? <f32>-1.0 : <f32>1.0; }
// kill NaN / runaway values at stage boundaries
@inline function finite(x: f32): f32 { return (x > -1.0e6 && x < 1.0e6) ? x : <f32>0.0; }
@inline function denorm(x: f32): f32 { return (x > 1.0e-18 || x < -1.0e-18) ? x : <f32>0.0; }

// ---- noise -----------------------------------------------------------
let rng: u32 = 0x9e3779b9;
@inline function white(): f32 {
  rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
  return f32(rng) * <f32>4.656612873e-10 - <f32>1.0;      // [-1, 1)
}
@inline function rand01(): f32 { return (white() + <f32>1.0) * <f32>0.5; }

// Cheap tanh-like soft clipper: identity near 0, saturates at ±1.
@inline function softclip(x: f32): f32 {
  if (x > 3.0) return 1.0;
  if (x < -3.0) return -1.0;
  const x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}
// Triangle wavefolder: identity for |x| <= 1, reflects beyond.
@inline function foldTri(x: f32): f32 {
  const a = x * <f32>0.25 + <f32>0.25;
  return <f32>4.0 * Mathf.abs(a - nearest<f32>(a)) - <f32>1.0;
}

// polyBLEP residual (t = phase 0..1, dt = phase increment)
@inline function polyblep(t: f32, dt: f32): f32 {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1.0; }
  if (t > 1.0 - dt) { const u = (t - 1.0) / dt; return u * u + u + u + 1.0; }
  return 0.0;
}

// Equal-power pan gains, centre = 1.0 on both sides.
@inline function panL(p: f32): f32 { return Mathf.cos((p + <f32>1.0) * <f32>0.7853982) * <f32>1.4142135; }
@inline function panR(p: f32): f32 { return Mathf.sin((p + <f32>1.0) * <f32>0.7853982) * <f32>1.4142135; }

// ---- filters ---------------------------------------------------------
// Simper state-variable filter: stable under per-sample coefficient changes.
class Svf {
  ic1: f32 = 0; ic2: f32 = 0;
  a1: f32 = 0; a2: f32 = 0; a3: f32 = 0; k: f32 = 1;
  lp: f32 = 0; bp: f32 = 0; hp: f32 = 0;
  set(fc: f32, q: f32): void {
    const f = clampf(fc, 5.0, SR * 0.46);
    this.setG(Mathf.tan(PI * f * invSR), q);
  }
  setG(g: f32, q: f32): void {
    this.k = <f32>1.0 / (q < 0.05 ? <f32>0.05 : q);
    this.a1 = <f32>1.0 / (<f32>1.0 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(x: f32): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = denorm(<f32>2.0 * v1 - this.ic1);
    this.ic2 = denorm(<f32>2.0 * v2 - this.ic2);
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
  }
  reset(): void { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
}

class OnePole {
  z: f32 = 0; a: f32 = 1;
  set(fc: f32): void { this.a = <f32>1.0 - Mathf.exp(-TWO_PI * clampf(fc, 1.0, SR * 0.45) * invSR); }
  lp(x: f32): f32 { this.z = denorm(this.z + this.a * (x - this.z)); return this.z; }
  hp(x: f32): f32 { this.z = denorm(this.z + this.a * (x - this.z)); return x - this.z; }
  reset(): void { this.z = 0; }
}

// RBJ biquad, direct form II transposed
class Biquad {
  b0: f32 = 1; b1: f32 = 0; b2: f32 = 0; a1: f32 = 0; a2: f32 = 0;
  z1: f32 = 0; z2: f32 = 0;
  // kind: 0 lowshelf 1 highshelf 2 peak 3 highpass 4 lowpass
  set(kind: i32, f0: f32, q: f32, gainDb: f32): void {
    const f = clampf(f0, 10.0, SR * 0.45);
    const w = TWO_PI * f * invSR;
    const cw = Mathf.cos(w), sw = Mathf.sin(w);
    const al = sw / (<f32>2.0 * q);
    const A = Mathf.exp(gainDb * <f32>0.05756463);          // 10^(dB/40)
    let b0: f32 = 1, b1: f32 = 0, b2: f32 = 0, a0: f32 = 1, a1: f32 = 0, a2: f32 = 0;
    if (kind == 2) {
      b0 = <f32>1.0 + al * A; b1 = <f32>-2.0 * cw; b2 = <f32>1.0 - al * A;
      a0 = <f32>1.0 + al / A; a1 = b1; a2 = <f32>1.0 - al / A;
    } else if (kind == 3) {
      b0 = (<f32>1.0 + cw) * <f32>0.5; b1 = -(<f32>1.0 + cw); b2 = b0;
      a0 = <f32>1.0 + al; a1 = <f32>-2.0 * cw; a2 = <f32>1.0 - al;
    } else if (kind == 4) {
      b0 = (<f32>1.0 - cw) * <f32>0.5; b1 = <f32>1.0 - cw; b2 = b0;
      a0 = <f32>1.0 + al; a1 = <f32>-2.0 * cw; a2 = <f32>1.0 - al;
    } else {
      const sa = <f32>2.0 * Mathf.sqrt(A) * (sw / (<f32>2.0 * <f32>0.7071));
      if (kind == 0) {
        b0 = A * ((A + <f32>1.0) - (A - <f32>1.0) * cw + sa);
        b1 = <f32>2.0 * A * ((A - <f32>1.0) - (A + <f32>1.0) * cw);
        b2 = A * ((A + <f32>1.0) - (A - <f32>1.0) * cw - sa);
        a0 = (A + <f32>1.0) + (A - <f32>1.0) * cw + sa;
        a1 = <f32>-2.0 * ((A - <f32>1.0) + (A + <f32>1.0) * cw);
        a2 = (A + <f32>1.0) + (A - <f32>1.0) * cw - sa;
      } else {
        b0 = A * ((A + <f32>1.0) + (A - <f32>1.0) * cw + sa);
        b1 = <f32>-2.0 * A * ((A - <f32>1.0) + (A + <f32>1.0) * cw);
        b2 = A * ((A + <f32>1.0) + (A - <f32>1.0) * cw - sa);
        a0 = (A + <f32>1.0) - (A - <f32>1.0) * cw + sa;
        a1 = <f32>2.0 * ((A - <f32>1.0) - (A + <f32>1.0) * cw);
        a2 = (A + <f32>1.0) - (A - <f32>1.0) * cw - sa;
      }
    }
    const ia = <f32>1.0 / a0;
    this.b0 = b0 * ia; this.b1 = b1 * ia; this.b2 = b2 * ia; this.a1 = a1 * ia; this.a2 = a2 * ia;
  }
  tick(x: f32): f32 {
    const y = this.b0 * x + this.z1;
    this.z1 = denorm(this.b1 * x - this.a1 * y + this.z2);
    this.z2 = denorm(this.b2 * x - this.a2 * y);
    return y;
  }
  reset(): void { this.z1 = 0; this.z2 = 0; }
}

let dcCoef: f32 = 0.9992;     // ~6 Hz corner, set in init()
class DcBlock {
  x1: f32 = 0; y1: f32 = 0;
  tick(x: f32): f32 {
    const y = x - this.x1 + dcCoef * this.y1;
    this.x1 = x; this.y1 = denorm(y);
    return y;
  }
  reset(): void { this.x1 = 0; this.y1 = 0; }
}

// Paul Kellet's economy pink filter.
class Pink {
  b0: f32 = 0; b1: f32 = 0; b2: f32 = 0;
  tick(w: f32): f32 {
    this.b0 = <f32>0.99765 * this.b0 + w * <f32>0.0990460;
    this.b1 = <f32>0.96300 * this.b1 + w * <f32>0.2965164;
    this.b2 = <f32>0.57000 * this.b2 + w * <f32>1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * <f32>0.1848) * <f32>0.25;
  }
  reset(): void { this.b0 = 0; this.b1 = 0; this.b2 = 0; }
}

// ---- packed parameters ------------------------------------------------
// params[] holds the host slots. Each logical parameter lives in one slot as
// a mixed-radix digit (see factory/cataclysm/params.mjs). A[] = decoded
// actual values, An[] = the same as 0..1 (the domain modulation works in).
const A = new StaticArray<f32>(NP);
const An = new StaticArray<f32>(NP);
const G = new StaticArray<f32>(NP);          // FX-side effective values (A + FX modulation)
const slotCache = new StaticArray<f32>(MAX_PARAMS);

@inline function mapNorm(i: i32, n: f32): f32 {
  const lo = unchecked(PMIN[i]);
  if (unchecked(PCURVE[i]) == 1) return lo * Mathf.exp(unchecked(PLNR[i]) * n);
  return lo + n * (unchecked(PMAX[i]) - lo);
}

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
      unchecked(A[i] = a);
      unchecked(An[i] = (a - lo) / (hi - lo));
    } else {
      const steps = unchecked(PSTEPS[i]);
      const raw = (k / unchecked(PMULT[i])) % steps;
      const n: f32 = steps > 1 ? f32(raw) / f32(steps - 1) : <f32>0.0;
      unchecked(An[i] = n);
      if (unchecked(PCURVE[i]) == 2) unchecked(A[i] = lo + f32(raw));
      else unchecked(A[i] = mapNorm(i, n));
    }
  }
}

// Returns true when any slot changed since the last call.
function refreshParams(): bool {
  let changed = false;
  for (let s = 0; s < NUM_PARAMS; s++) {
    const v = unchecked(params[s]);
    if (v != unchecked(slotCache[s])) {
      unchecked(slotCache[s] = v);
      decodeSlot(s, v);
      changed = true;
    }
  }
  return changed;
}

@inline function pv(i: i32): f32 { return unchecked(A[i]); }       // base actual value
@inline function pn(i: i32): f32 { return unchecked(An[i]); }      // base 0..1

// ---- host transport / tempo --------------------------------------------
let hostBpm: f32 = 0.0;
function setHostTransport(playing: i32, ppq: f64, bpm: f32): void { hostBpm = bpm; }
@inline function hostTempo(): f32 {
  const t = unchecked(params[63]);
  return t > 1.0 ? t : (hostBpm > 1.0 ? hostBpm : <f32>120.0);
}
// beats per cycle for the 8 sync divisions (0 = free)
@inline function syncBeats(d: i32): f32 {
  if (d == 1) return 1.0;
  if (d == 2) return 0.5;
  if (d == 3) return 0.25;
  if (d == 4) return 0.125;
  if (d == 5) return <f32>(1.0 / 3.0);
  if (d == 6) return <f32>(1.0 / 6.0);
  if (d == 7) return <f32>(1.0 / 12.0);
  return 0.0;
}
