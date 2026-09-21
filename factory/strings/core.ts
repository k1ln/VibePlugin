// =====================================================================
//  strings/core.ts — shared engine for the string instruments.
//  Pasted into each plugin's assembly.ts by strings/build.mjs (a .vstai
//  carries one source file). Allocation-free after init, all f32.
//
//  The bowed string follows the digital-waveguide model of McIntyre,
//  Schumacher & Woodhouse as implemented in Perry Cook & Gary Scavone's
//  Synthesis ToolKit ("Bowed"): two delay lines either side of the bow
//  contact point, an inverting nut, a lossy low-passed bridge, and a
//  nonlinear bow-friction table — the stick-slip interaction that makes a
//  bowed string speak. Bow force shapes the friction table, bow velocity
//  drives the string, bow position splits the delay lines.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params = new StaticArray<f32>(MAX_PARAMS);
const display = new StaticArray<f32>(16);

let SR: f32 = 48000.0;
let invSR: f32 = 1.0 / 48000.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function lerpf(a: f32, b: f32, t: f32): f32 { return a + (b - a) * t; }
function decayCoef(tau: f32): f32 { if (tau <= 0.00001) return 0.0; return Mathf.exp(-invSR / tau); }
@inline function smoothCoef(tau: f32): f32 { return 1.0 - decayCoef(tau); }

let rng: u32 = 0x6d2b79f5;
@inline function white(): f32 { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return f32(rng) * 4.656612873e-10 - 1.0; }
@inline function rand01(): f32 { return (white() + 1.0) * 0.5; }
// A smooth sine-shaped LFO for ph in [0,1) (a shaped triangle) — cheap, and plenty for vibrato.
@inline function fastSin01(ph: f32): f32 {
  const x = ph < 0.5 ? ph * 4.0 - 1.0 : 3.0 - ph * 4.0;     // triangle −1..1 (−1 at 0, +1 at 0.5)
  return x * (1.5 - 0.5 * x * x) * 1.0;
}

// ---- delay line with linear interpolation (read at fractional delay) ----
class Delay {
  buf: StaticArray<f32>; size: i32; w: i32 = 0; len: f32 = 1.0; last: f32 = 0;
  constructor(size: i32) { this.size = size; this.buf = new StaticArray<f32>(size); }
  clear(): void { for (let i = 0; i < this.size; i++) unchecked(this.buf[i] = 0); this.w = 0; this.last = 0; }
  setLen(d: f32): void { this.len = clampf(d, 1.0, f32(this.size - 2)); }
  // write x, return the sample from `len` ago
  tick(x: f32): f32 {
    unchecked(this.buf[this.w] = x);
    let rp = f32(this.w) - this.len;
    if (rp < 0.0) rp += f32(this.size);
    const i0 = i32(rp); const fr = rp - f32(i0);
    const i1 = i0 + 1 >= this.size ? 0 : i0 + 1;
    this.last = unchecked(this.buf[i0]) * (1.0 - fr) + unchecked(this.buf[i1]) * fr;
    this.w++; if (this.w >= this.size) this.w = 0;
    return this.last;
  }
  // peek `d` samples back without writing
  read(d: f32): f32 {
    let rp = f32(this.w) - 1.0 - clampf(d, 0.0, f32(this.size - 2));
    if (rp < 0.0) rp += f32(this.size);
    const i0 = i32(rp); const fr = rp - f32(i0);
    const i1 = i0 + 1 >= this.size ? 0 : i0 + 1;
    return unchecked(this.buf[i0]) * (1.0 - fr) + unchecked(this.buf[i1]) * fr;
  }
}

// ---- filters ------------------------------------------------------------
class Svf {
  ic1: f32 = 0; ic2: f32 = 0; a1: f32 = 0; a2: f32 = 0; a3: f32 = 0; k: f32 = 1;
  lp: f32 = 0; bp: f32 = 0; hp: f32 = 0;
  set(fc: f32, q: f32): void {
    const g = Mathf.tan(PI * clampf(fc, 8.0, SR * 0.45) * invSR);
    this.k = 1.0 / (q < 0.05 ? 0.05 : q);
    this.a1 = 1.0 / (1.0 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  tick(x: f32): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1; this.ic2 = 2.0 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
  }
  reset(): void { this.ic1 = 0; this.ic2 = 0; }
}
class OnePole {
  z: f32 = 0; a: f32 = 1;
  set(fc: f32): void { this.a = 1.0 - Mathf.exp(-TWO_PI * clampf(fc, 1.0, SR * 0.45) * invSR); }
  lp(x: f32): f32 { this.z += this.a * (x - this.z); return this.z; }
  hp(x: f32): f32 { this.z += this.a * (x - this.z); return x - this.z; }
}

// 2^x, fast: polynomial on the fraction, exponent bits for the integer part
// (≈0.2 cent error) — for per-player pitch offsets computed every sample.
@inline function fastExp2(x: f32): f32 {
  const xi = Mathf.floor(x); const f = x - xi;
  const p: f32 = 1.0 + f * (0.6931472 + f * (0.2402265 + f * 0.0555041));
  const e = i32(xi) + 127;
  if (e <= 0) return 0.0;
  return p * reinterpret<f32>((e < 255 ? e : 254) << 23);
}

@inline function softclip(x: f32): f32 {
  if (x > 3.0) return 1.0; if (x < -3.0) return -1.0;
  const x2 = x * x; return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

// ---- the bowed string ----------------------------------------------------
// STK bow table: friction reflection vs. relative velocity. slope sets how
// "grippy" the bow is (lower = more force = more rasp).
@inline function bowTable(dv: f32, slope: f32): f32 {
  let s = Mathf.abs((dv + 0.001) * slope) + 0.75;
  s = s * s; s = 1.0 / (s * s);                    // s^-4
  return s > 0.98 ? 0.98 : (s < 0.01 ? 0.01 : s);
}

const MAX_STRING_DELAY: i32 = 2600;                // ≥ SR/lowest note at 96 kHz headroom
class BowedString {
  neck: Delay = new Delay(MAX_STRING_DELAY);
  bridge: Delay = new Delay(MAX_STRING_DELAY);
  loss: OnePole = new OnePole();                    // bridge losses (brightness)
  lossGain: f32 = 0.995;
  freq: f32 = 220; beta: f32 = 0.127;                // bow position (fraction from bridge)
  bowVel: f32 = 0;                                   // target set per sample by the player
  force: f32 = 0.5;                                  // 0..1 → friction slope
  pluck: f32 = 0;                                    // pluck energy to inject (pizzicato)
  out: f32 = 0;
  clear(): void { this.neck.clear(); this.bridge.clear(); this.loss.z = 0; this.out = 0; this.delayF = -1.0; }
  // The loss filter's phase delay is cached: it only moves noticeably when
  // the pitch moves by more than ~1 % or the brightness changes, so vibrato
  // doesn't pay for atan2/sin/cos every sample.
  lossFc: f32 = -1.0; lossDelay: f32 = 0.0; delayF: f32 = -1.0;
  setFreq(f: f32): void {
    this.freq = f;
    if (this.delayF <= 0.0 || Mathf.abs(f - this.delayF) > this.delayF * 0.01) {
      const w = TWO_PI * f * invSR;
      const c: f32 = 1.0 - this.loss.a;
      this.lossDelay = Mathf.atan2(c * Mathf.sin(w), 1.0 - c * Mathf.cos(w)) / w;
      this.delayF = f;
    }
    // loop = both delay lines + 1 sample latency each + the loss filter's
    // phase delay: subtract the last two so the loop is exactly one period
    const base = SR / f - 2.0 - this.lossDelay;
    this.bridge.setLen(base * this.beta);
    this.neck.setLen(base * (1.0 - this.beta));
  }
  setBrightness(fc: f32): void {
    if (Mathf.abs(fc - this.lossFc) < 1.0) return;
    this.loss.set(fc); this.lossFc = fc; this.delayF = -1.0;
  }
  tick(): f32 {
    const bridgeRefl = -this.loss.lp(this.bridge.last) * this.lossGain;
    const nutRefl = -this.neck.last;
    const stringVel = bridgeRefl + nutRefl;
    const dv = this.bowVel - stringVel;
    let nv: f32 = 0.0;
    if (this.bowVel != 0.0) nv = dv * bowTable(dv, 5.0 - 4.0 * this.force);
    let inj: f32 = 0.0;
    if (this.pluck != 0.0) { inj = this.pluck; this.pluck = 0.0; }
    this.neck.tick(bridgeRefl + nv + inj);
    this.bridge.tick(nutRefl + nv + inj);
    this.out = this.bridge.last;
    return this.out;
  }
}

// ---- instrument bodies: modal resonators on the bridge force ---------------
// Mode frequencies/Qs for each family, from published violin-family
// acoustics (air mode A0, main corpus modes, and the ~2–3 kHz bridge hill),
// scaled by body size for viola/cello/bass.
class Body {
  modes: StaticArray<Svf> = new StaticArray<Svf>(7);
  gains: StaticArray<f32> = new StaticArray<f32>(7);
  hp: OnePole = new OnePole();
  constructor() { for (let i = 0; i < 7; i++) this.modes[i] = new Svf(); }
  // kind: 0 violin, 1 viola, 2 cello, 3 bass
  configure(kind: i32): void {
    const f: StaticArray<f32> = [275.0, 460.0, 550.0, 700.0, 1100.0, 2400.0, 3300.0];
    const q: StaticArray<f32> = [12.0, 14.0, 12.0, 8.0, 5.0, 2.2, 3.0];
    const g: StaticArray<f32> = [0.9, 0.8, 1.0, 0.55, 0.45, 0.85, 0.35];
    const scale: f32 = kind == 0 ? 1.0 : (kind == 1 ? 0.83 : (kind == 2 ? 0.45 : 0.29));
    for (let i = 0; i < 7; i++) {
      // the bridge hill scales far less than the corpus modes
      const s: f32 = i >= 5 ? Mathf.sqrt(scale) : scale;
      unchecked(this.modes[i]).set(f[i] * s, q[i]);
      unchecked(this.modes[i]).reset();
      this.gains[i] = g[i];
    }
    this.hp.set(kind >= 2 ? 30.0 : 80.0);
  }
  tick(x: f32): f32 {
    let y: f32 = x * 0.35;
    for (let i = 0; i < 7; i++) { const m = unchecked(this.modes[i]); m.tick(x); y += m.bp * m.k * unchecked(this.gains[i]); }
    return this.hp.hp(y);
  }
}

// ---- a small stereo hall: early reflections + an 8-line FDN ----------------
const FDN_N: i32 = 8;
class Hall {
  lines: StaticArray<Delay> = new StaticArray<Delay>(FDN_N);
  lens: StaticArray<f32> = new StaticArray<f32>(FDN_N);
  damp: StaticArray<OnePole> = new StaticArray<OnePole>(FDN_N);
  pre: Delay = new Delay(9600);
  early: Delay = new Delay(4800);
  outL: f32 = 0; outR: f32 = 0; fb: f32 = 0.8;
  constructor() {
    const base: StaticArray<f32> = [1123.0, 1319.0, 1511.0, 1723.0, 1931.0, 2141.0, 2357.0, 2591.0];
    for (let i = 0; i < FDN_N; i++) { this.lines[i] = new Delay(4096); this.lens[i] = base[i]; this.damp[i] = new OnePole(); }
  }
  init(): void {
    for (let i = 0; i < FDN_N; i++) {
      const l = unchecked(this.lines[i]); l.clear(); l.setLen(this.lens[i] * SR / 48000.0);
      unchecked(this.damp[i]).z = 0;
    }
    this.pre.clear(); this.early.clear(); this.outL = 0; this.outR = 0;
  }
  // size 0..1 → decay time; tone 0..1 → damping; predelay seconds
  set(size: f32, tone: f32, predelay: f32): void {
    const rt60: f32 = 0.8 + 5.2 * size * size;
    const meanLen: f32 = 1800.0 * SR / 48000.0;
    this.fb = Mathf.pow(10.0, -3.0 * meanLen * invSR / rt60);
    for (let i = 0; i < FDN_N; i++) unchecked(this.damp[i]).set(2500.0 + 11000.0 * tone);
    this.pre.setLen(clampf(predelay, 0.0, 0.19) * SR + 1.0);
  }
  // Freeze: the Householder matrix is lossless, so with feedback at unity
  // and the damping opened right up the network holds its tail indefinitely.
  frozen: bool = false;
  freeze(on: bool): void {
    if (on == this.frozen) return;
    this.frozen = on;
    if (on) { this.fb = 0.99995; for (let i = 0; i < FDN_N; i++) unchecked(this.damp[i]).set(20000.0); }
  }
  tick(inL: f32, inR: f32): void {
    const x = this.pre.tick((inL + inR) * 0.5);
    // early reflections: a few taps off a short line
    this.early.tick(x);
    const er = this.early.read(0.011 * SR) * 0.5 + this.early.read(0.017 * SR) * 0.4 - this.early.read(0.023 * SR) * 0.35 + this.early.read(0.031 * SR) * 0.3;
    // FDN with a Householder feedback matrix (energy-preserving mixing)
    let sum: f32 = 0;
    for (let i = 0; i < FDN_N; i++) sum += unchecked(this.lines[i]).last;
    const hh = sum * (2.0 / f32(FDN_N));
    let l: f32 = 0; let r: f32 = 0;
    for (let i = 0; i < FDN_N; i++) {
      const line = unchecked(this.lines[i]);
      const v = line.last;
      const fbv = unchecked(this.damp[i]).lp((v - hh) * this.fb);
      line.tick(fbv + (x + er * 0.3) * 0.35);
      if ((i & 1) == 0) l += v; else r += v;
    }
    this.outL = er * 0.6 + l * 0.5;
    this.outR = -er * 0.45 + r * 0.5 + er * 0.2;
  }
}

// ---- controllers (CC arrive in steps: smooth them) --------------------------
class Smoothed {
  v: f32 = 0; target: f32 = 0; c: f32 = 0.01;
  setTau(t: f32): void { this.c = smoothCoef(t); }
  tick(): f32 { this.v += (this.target - this.v) * this.c; return this.v; }
}

// ---- host transport (for tempo-synced engines) ---------------------------------
let hostPlaying: bool = false; let hostPpq: f64 = 0.0; let hostBpm: f32 = 0.0; let hostSeen: bool = false;
export function transport(playing: i32, ppq: f64, bpm: f32): void { hostPlaying = playing != 0; hostPpq = ppq; hostBpm = bpm; hostSeen = true; }
@inline function hostTempo(): f32 { const t = params[63]; return t > 1.0 ? t : (hostBpm > 1.0 ? hostBpm : 120.0); }

function commonInit(sr: f32): void {
  SR = sr; invSR = 1.0 / sr; rng = 0x6d2b79f5;
  hostPlaying = false; hostPpq = 0.0; hostBpm = 0.0; hostSeen = false;
  for (let i = 0; i < 16; i++) display[i] = 0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
