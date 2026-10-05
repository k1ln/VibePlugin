// =====================================================================
//  core.ts — shared primitives for KHEVEREST: ABI buffers, packed-parameter
//  decoding, noise, saturators, SVF, the 60-wavetable bank and the band-limited
//  oscillator. Pasted after the generated tables. Everything is f32 and
//  allocation-free after init().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_PARAMS: i32 = 64;
const TICK: i32 = 16;                 // control-rate block (samples)
const NV: i32 = 8;                    // voices
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

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
// triangle wavefolder: identity for |x| <= 1, reflects beyond
@inline function foldTri(x: f32): f32 {
  const a = x * <f32>0.25 + <f32>0.25;
  return <f32>4.0 * Mathf.abs(a - nearest<f32>(a)) - <f32>1.0;
}

// ---- table sine ------------------------------------------------------------
const SIN_N: i32 = 8192;
const sinT = new StaticArray<f32>(SIN_N + 2);
function initSin(): void { for (let i = 0; i < SIN_N + 2; i++) sinT[i] = Mathf.sin(TWO_PI * f32(i) / f32(SIN_N)); }
@inline function fsin(ph: f32): f32 {           // ph in cycles, any value >= 0
  let p = ph - Mathf.floor(ph);
  const x = p * f32(SIN_N);
  const i = i32(x);
  const f = x - f32(i);
  const a = unchecked(sinT[i]);
  return a + (unchecked(sinT[i + 1]) - a) * f;
}

// polyBLEP residual (t = phase 0..1, dt = phase increment)
@inline function polyblep(t: f32, dt: f32): f32 {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1.0; }
  if (t > 1.0 - dt) { const u = (t - 1.0) / dt; return u * u + u + u + 1.0; }
  return 0.0;
}

// ---- packed parameters -------------------------------------------------------
// params[] holds the host slots. Each logical parameter lives in one slot as a
// mixed-radix digit (factory/kheverest/params.mjs). A[] = decoded actual values,
// An[] = the same normalised 0..1, AI[] = integer value (for int/sel params).
const A = new StaticArray<f32>(NP);
const An = new StaticArray<f32>(NP);
const AI = new StaticArray<i32>(NP);
const slotCache = new StaticArray<f32>(MAX_PARAMS);

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
      unchecked(AI[i] = 0);
    } else {
      const steps = unchecked(PSTEPS[i]);
      const raw = (k / unchecked(PMULT[i])) % steps;
      const n: f32 = steps > 1 ? f32(raw) / f32(steps - 1) : <f32>0.0;
      unchecked(An[i] = n);
      if (unchecked(PCURVE[i]) == 2) { unchecked(A[i] = lo + f32(raw)); unchecked(AI[i] = i32(lo) + raw); }
      else { unchecked(A[i] = lo + n * (hi - lo)); unchecked(AI[i] = raw); }
    }
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
@inline function pv(i: i32): f32 { return unchecked(A[i]); }       // actual value
@inline function pn(i: i32): f32 { return unchecked(An[i]); }      // 0..1
@inline function pi(i: i32): i32 { return unchecked(AI[i]); }      // integer / list index
@inline function pb(i: i32): f32 { return unchecked(A[i]) * <f32>0.015873016; }   // ±63 → ±1
@inline function pb127(i: i32): f32 { return unchecked(A[i]) * <f32>0.007874016; } // ±127 → ±1
@inline function pn127(i: i32): f32 { return unchecked(A[i]) * <f32>0.007874016; } // 0..127 → 0..1

// ---- host transport / tempo ------------------------------------------------
let hostBpm: f32 = 0.0;
function setHostTransport(playing: i32, ppq: f64, bpm: f32): void { hostBpm = bpm; }
@inline function hostTempo(): f32 {
  const t = unchecked(params[63]);
  return t > 1.0 ? t : (hostBpm > 1.0 ? hostBpm : <f32>0.0);
}

// ---- state-variable filter (Simper / ZDF) ---------------------------------
// integrator-state limiter: transparent below |1.5|, smooth knee up to ±3.5 (keeps resonance stable)
@inline function satS(x: f32): f32 {
  const a = x < 0.0 ? -x : x;
  if (a <= 1.5) return x;
  const m: f32 = <f32>1.5 + <f32>2.0 * Mathf.tanh((a - <f32>1.5) * <f32>0.5);
  return x < 0.0 ? -m : m;
}
class Svf {
  ic1: f32 = 0; ic2: f32 = 0;
  lp: f32 = 0; bp: f32 = 0; hp: f32 = 0;
  tick(x: f32, g: f32, k: f32): void {
    const a1: f32 = <f32>1.0 / (<f32>1.0 + g * (g + k));
    const a2: f32 = g * a1;
    const a3: f32 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = denorm(satS(<f32>2.0 * v1 - this.ic1));
    this.ic2 = denorm(satS(<f32>2.0 * v2 - this.ic2));
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2;
  }
  reset(): void { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
}
class OnePole {
  z: f32 = 0;
  lp(x: f32, a: f32): f32 { this.z = denorm(this.z + a * (x - this.z)); return this.z; }
  hp(x: f32, a: f32): f32 { this.z = denorm(this.z + a * (x - this.z)); return x - this.z; }
}
@inline function onePoleA(fc: f32): f32 { return <f32>1.0 - Mathf.exp(-TWO_PI * clampf(fc, 1.0, SR * 0.45) * invSR); }

// =====================================================================
//  Wavetable bank — 60 tables × 5 columns × 6 mip levels (64/32/16/8/4/2
//  harmonics). Spectra come from the generated WT_B64 string; the band-limited
//  tables are synthesised lazily the first time a table is used.
// =====================================================================
// WT_TABLES (generated) tables × WT_COLS columns × 6 mip levels. Spectra come from the generated
// WT_B64 string: per column 64 harmonics × (sine, cosine) int8, sqrt-companded.
const WT_COLS: i32 = 8;
const WT_H: i32 = 64;
const WT_PER_COL: i32 = 2016;                  // 1024+512+256+128+64+32
const WT_BYTES: i32 = WT_COLS * WT_H * 2;
const wtSpec = new StaticArray<i8>(WT_TABLES * WT_BYTES);
const wtTab = new StaticArray<f32>(WT_TABLES * WT_COLS * WT_PER_COL);
const wtBuilt = new StaticArray<u8>(WT_TABLES);
const wtCs = new StaticArray<f32>(WT_H);
const wtCc = new StaticArray<f32>(WT_H);
const mipLen = new StaticArray<i32>(6);
const mipOff = new StaticArray<i32>(6);
const mipHarm = new StaticArray<i32>(6);

function b64val(c: i32): i32 {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57) return c + 4;
  if (c == 43) return 62;
  return 63;
}
function initWavetables(): void {
  mipLen[0] = 1024; mipLen[1] = 512; mipLen[2] = 256; mipLen[3] = 128; mipLen[4] = 64; mipLen[5] = 32;
  mipHarm[0] = 64; mipHarm[1] = 32; mipHarm[2] = 16; mipHarm[3] = 8; mipHarm[4] = 4; mipHarm[5] = 2;
  let o = 0;
  for (let m = 0; m < 6; m++) { mipOff[m] = o; o += mipLen[m]; }
  const n = WT_B64.length;
  const total = WT_TABLES * WT_BYTES;
  let outI = 0;
  for (let i = 0; i + 3 < n && outI < total; i += 4) {
    const a = b64val(WT_B64.charCodeAt(i)), b = b64val(WT_B64.charCodeAt(i + 1));
    const c = b64val(WT_B64.charCodeAt(i + 2)), d = b64val(WT_B64.charCodeAt(i + 3));
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (outI < total) wtSpec[outI++] = i8((v >> 16) & 255);
    if (outI < total) wtSpec[outI++] = i8((v >> 8) & 255);
    if (outI < total) wtSpec[outI++] = i8(v & 255);
  }
  for (let w = 0; w < WT_TABLES; w++) wtBuilt[w] = 0;
}
function buildWT(w: i32): void {
  for (let c = 0; c < WT_COLS; c++) {
    const sbase = (w * WT_COLS + c) * WT_H * 2;
    const tbase = (w * WT_COLS + c) * WT_PER_COL;
    for (let h = 0; h < WT_H; h++) {
      const qs = f32(unchecked(wtSpec[sbase + h * 2])) * <f32>0.007874016;
      const qc = f32(unchecked(wtSpec[sbase + h * 2 + 1])) * <f32>0.007874016;
      unchecked(wtCs[h] = qs * (qs < 0.0 ? -qs : qs));
      unchecked(wtCc[h] = qc * (qc < 0.0 ? -qc : qc));
    }
    let scale: f32 = 1.0;
    for (let m = 0; m < 6; m++) {
      const len = unchecked(mipLen[m]);
      const nh = unchecked(mipHarm[m]);
      const off = tbase + unchecked(mipOff[m]);
      const stride = SIN_N / len;                    // sine-table stride
      const quarter = SIN_N >> 2;
      let peak: f32 = 0.0;
      for (let i = 0; i < len; i++) {
        let s: f32 = 0.0;
        for (let h = 1; h <= nh; h++) {
          const ph = (h * i * stride) & (SIN_N - 1);
          s += unchecked(wtCs[h - 1]) * unchecked(sinT[ph]) + unchecked(wtCc[h - 1]) * unchecked(sinT[(ph + quarter) & (SIN_N - 1)]);
        }
        unchecked(wtTab[off + i] = s);
        const a = s < 0.0 ? -s : s;
        if (a > peak) peak = a;
      }
      if (m == 0) scale = peak > 1.0e-6 ? <f32>0.9 / peak : <f32>1.0;
      for (let i = 0; i < len; i++) unchecked(wtTab[off + i] = wtTab[off + i] * scale);
    }
  }
  wtBuilt[w] = 1;
}
// 4-point Hermite read of one column at one mip level, ph in cycles [0,1)
@inline function wtRead(w: i32, col: i32, mip: i32, ph: f32): f32 {
  const len = unchecked(mipLen[mip]);
  const base = (w * WT_COLS + col) * WT_PER_COL + unchecked(mipOff[mip]);
  const x = ph * f32(len);
  const i = i32(x);
  const f = x - f32(i);
  const m = len - 1;
  const y0 = unchecked(wtTab[base + ((i - 1) & m)]);
  const y1 = unchecked(wtTab[base + (i & m)]);
  const y2 = unchecked(wtTab[base + ((i + 1) & m)]);
  const y3 = unchecked(wtTab[base + ((i + 2) & m)]);
  const c1 = <f32>0.5 * (y2 - y0);
  const c2 = y0 - <f32>2.5 * y1 + <f32>2.0 * y2 - <f32>0.5 * y3;
  const c3 = <f32>0.5 * (y3 - y0) + <f32>1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}
@inline function wtMip(inc: f32): i32 {
  const maxH = <f32>0.47 / (inc > 1.0e-6 ? inc : <f32>1.0e-6);
  let m: i32 = 0;
  while (m < 5 && f32(unchecked(mipHarm[m])) > maxH) m++;
  return m;
}

// =====================================================================
//  Oscillator — one per voice per oscillator. Analytic polyBLEP sawtooth /
//  pulse, table sine, blendable triangle, wavetables, virtual-oscillator
//  hard sync (with BLEP-corrected resets) and the "density" saw stack.
// =====================================================================
const OSC_SINE: i32 = 0;
const OSC_TRI: i32 = 1;
const OSC_SAW: i32 = 2;
const OSC_PULSE: i32 = 3;
const OSC_MORE: i32 = 4;

class Osc {
  ph: f32 = 0; vph: f32 = 0; d1: f32 = 0; d2: f32 = 0;
  prevY: f32 = 0; corr: f32 = 0;
  // naive waveform at phase p (no band-limiting) — used to size sync steps
  naive(p: f32, wave: i32, shp: f32, wt: i32, mip: i32): f32 {
    if (wave == OSC_SINE) return fsin(p);
    if (wave == OSC_TRI) return p < 0.5 ? <f32>4.0 * p - <f32>1.0 : <f32>3.0 - <f32>4.0 * p;
    if (wave == OSC_SAW) return <f32>2.0 * p - <f32>1.0;
    if (wave == OSC_PULSE) { const pw: f32 = <f32>0.5 + <f32>0.47 * shp; return p < pw ? <f32>1.0 - (<f32>2.0 * pw - <f32>1.0) : <f32>-1.0 - (<f32>2.0 * pw - <f32>1.0); }
    return this.table(p, shp, wt, mip);
  }
  table(p: f32, shp: f32, wt: i32, mip: i32): f32 {
    const pos = (shp + <f32>1.0) * <f32>0.5 * f32(WT_COLS - 1);
    let c0 = i32(pos); if (c0 > WT_COLS - 2) c0 = WT_COLS - 2; if (c0 < 0) c0 = 0;
    const fr = clampf(pos - f32(c0), 0.0, 1.0);
    const a = wtRead(wt, c0, mip, p);
    if (fr <= 0.0001) return a;
    return a + (wtRead(wt, c0 + 1, mip, p) - a) * fr;
  }
  // render one sample. inc = phase increment per sample, shp = -1..1,
  // vr = hard-sync ratio (>=1), dens = density amount 0..1, dd = density detune ratio.
  sample(inc: f32, wave: i32, shp: f32, wt: i32, mip: i32, vr: f32, dens: f32, dd: f32): f32 {
    const oldPh = this.ph;
    let p = oldPh + inc;
    let wrapped = false;
    if (p >= 1.0) { p -= 1.0; wrapped = true; }
    let cAfter: f32 = 0.0;
    if (vr > 1.0005) {
      this.vph += inc * vr;
      if (this.vph >= 1.0) {
        this.vph -= 1.0;
        let alpha: f32 = this.vph / (inc * vr);       // fraction of this sample since the reset
        if (alpha > 1.0) alpha = 1.0;
        let pReset = oldPh + inc * (<f32>1.0 - alpha);
        if (pReset >= 1.0) pReset -= 1.0;
        const J = this.naive(0.0, wave, shp, wt, mip) - this.naive(pReset, wave, shp, wt, mip);
        cAfter = -(J * <f32>0.5) * (<f32>1.0 - alpha) * (<f32>1.0 - alpha);
        this.corr += (J * <f32>0.5) * alpha * alpha;
        p = inc * alpha; wrapped = false;
      }
    } else { this.vph = 0.0; }
    this.ph = p;
    let y: f32 = 0.0;
    if (wave == OSC_SINE) {
      if (shp > 0.0) { const a = shp * <f32>3.5; y = fsin(p + a * fsin(p)); }
      else if (shp < 0.0) { const a = -shp * <f32>6.0; y = fsin(p); y = Mathf.tanh(a * y) / Mathf.tanh(a + <f32>0.01); }
      else y = fsin(p);
    } else if (wave == OSC_TRI) {
      const tri: f32 = p < 0.5 ? <f32>4.0 * p - <f32>1.0 : <f32>3.0 - <f32>4.0 * p;
      if (shp == 0.0) y = tri;
      else {
        const s = shp > 0.0 ? shp : -shp;
        let saw: f32 = <f32>2.0 * p - <f32>1.0; saw -= polyblep(p, inc);
        if (shp < 0.0) saw = -saw;
        y = tri * (<f32>1.0 - s) + saw * s;
      }
    } else if (wave == OSC_SAW) {
      let saw: f32 = <f32>2.0 * p - <f32>1.0; saw -= polyblep(p, inc);
      if (dens > 0.001) {
        const i1 = inc * (<f32>1.0 + dd), i2 = inc * (<f32>1.0 - dd);
        this.d1 += i1; if (this.d1 >= 1.0) this.d1 -= 1.0;
        this.d2 += i2; if (this.d2 >= 1.0) this.d2 -= 1.0;
        const s1: f32 = <f32>2.0 * this.d1 - <f32>1.0 - polyblep(this.d1, i1);
        const s2: f32 = <f32>2.0 * this.d2 - <f32>1.0 - polyblep(this.d2, i2);
        saw = (saw + dens * (s1 + s2)) / (<f32>1.0 + <f32>1.6 * dens);
      }
      if (shp > 0.0) {
        let sq: f32 = p < 0.5 ? <f32>1.0 : <f32>-1.0; sq += polyblep(p, inc);
        let p2 = p + <f32>0.5; if (p2 >= 1.0) p2 -= 1.0; sq -= polyblep(p2, inc);
        y = saw * (<f32>1.0 - shp) + sq * shp;
      } else if (shp < 0.0) y = foldTri(saw * (<f32>1.0 - shp * <f32>3.0)) ;
      else y = saw;
    } else if (wave == OSC_PULSE) {
      const pw: f32 = <f32>0.5 + <f32>0.47 * shp;
      let sq: f32 = p < pw ? <f32>1.0 : <f32>-1.0;
      sq += polyblep(p, inc);
      let p2 = p - pw; if (p2 < 0.0) p2 += 1.0;
      sq -= polyblep(p2, inc);
      y = sq - (<f32>2.0 * pw - <f32>1.0);
    } else {
      y = this.table(p, shp, wt, mip);
    }
    y += cAfter;
    const emit = this.prevY + this.corr;
    this.prevY = y; this.corr = 0.0;
    return emit;
  }
  reset(): void { this.ph = 0; this.vph = 0; this.d1 = 0.31; this.d2 = 0.67; this.prevY = 0; this.corr = 0; }
}

// ---- deterministic tiny helpers used by several modules ---------------------
@inline function dbGain(db: f32): f32 { return Mathf.exp(db * <f32>0.11512925); }
