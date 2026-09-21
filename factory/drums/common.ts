// =====================================================================
//  drums/common.ts — shared DSP primitives for the analog drum machines
//  (808 / 909 / 606 families). Not a module on its own: build.mjs pastes
//  it, a machine's voices.ts and one plugin wrapper into a single
//  assembly.ts, because a .vstai carries exactly one source file.
//
//  Everything here is allocation-free after module init and all-f32.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params = new StaticArray<f32>(MAX_PARAMS);
// Engine → GUI: step light, activity per voice, output peak (see WasmAbi.h).
const display = new StaticArray<f32>(16);

let SR: f32 = 48000.0;
let invSR: f32 = 1.0 / 48000.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function lerpf(a: f32, b: f32, t: f32): f32 { return a + (b - a) * t; }
@inline function msToSamples(ms: f32): i32 { return i32(ms * 0.001 * SR); }

// Per-sample multiplier that decays by 1/e in `tau` seconds.
function decayCoef(tau: f32): f32 {
  if (tau <= 0.00001) return 0.0;
  return Mathf.exp(-invSR / tau);
}

// A time printed in a service-manual chart ("decay 300 ms", read off a scope)
// is where the note has visibly died away — taken here as −20 dB — so the
// exponential time constant is t / ln(10).
@inline function chartTau(ms: f32): f32 { return ms * 0.001 / 2.302585; }

// Knob → audio-taper gain (the machines use B-taper pots into log-ish ears).
@inline function taper(x: f32): f32 { const c = clampf(x, 0.0, 1.0); return c * c; }

// ---- noise -----------------------------------------------------------
let rng: u32 = 0x9e3779b9;
@inline function white(): f32 {
  rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
  return f32(rng) * 4.656612873e-10 - 1.0;          // [-1, 1)
}

// Paul Kellet's economy pink filter.
class Pink {
  b0: f32 = 0; b1: f32 = 0; b2: f32 = 0;
  tick(w: f32): f32 {
    this.b0 = 0.99765 * this.b0 + w * 0.0990460;
    this.b1 = 0.96300 * this.b1 + w * 0.2965164;
    this.b2 = 0.57000 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25;
  }
}

// ---- filters ---------------------------------------------------------
// Topology-preserving state-variable filter (Simper). Stable under per-sample
// coefficient changes, which the resonator voices rely on (pitch sweeps).
class Svf {
  ic1: f32 = 0; ic2: f32 = 0;
  a1: f32 = 0; a2: f32 = 0; a3: f32 = 0; k: f32 = 1;
  lp: f32 = 0; bp: f32 = 0; hp: f32 = 0;

  set(fc: f32, q: f32): void {
    const f = clampf(fc, 8.0, SR * 0.45);
    const g = Mathf.tan(PI * f * invSR);
    this.k = 1.0 / (q < 0.05 ? 0.05 : q);
    this.a1 = 1.0 / (1.0 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(x: f32): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2.0 * v1 - this.ic1;
    this.ic2 = 2.0 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
  }
  reset(): void { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
}

class OnePole {
  z: f32 = 0; a: f32 = 1;
  set(fc: f32): void { this.a = 1.0 - Mathf.exp(-TWO_PI * clampf(fc, 1.0, SR * 0.45) * invSR); }
  lp(x: f32): f32 { this.z += this.a * (x - this.z); return this.z; }
  hp(x: f32): f32 { this.z += this.a * (x - this.z); return x - this.z; }
  reset(): void { this.z = 0; }
}

// ---- band-limited square (the machines' Schmitt-trigger oscillators) --
@inline function polyblep(t: f32, dt: f32): f32 {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1.0; }
  if (t > 1.0 - dt) { const u = (t - 1.0) / dt; return u * u + u + u + 1.0; }
  return 0.0;
}
class Square {
  ph: f32 = 0; dt: f32 = 0;
  setHz(hz: f32): void { this.dt = hz * invSR; }
  tick(): f32 {
    const p = this.ph;
    let s: f32 = p < 0.5 ? 1.0 : -1.0;
    s += polyblep(p, this.dt);
    let q = p + 0.5; if (q >= 1.0) q -= 1.0;
    s -= polyblep(q, this.dt);
    this.ph = p + this.dt; if (this.ph >= 1.0) this.ph -= 1.0;
    return s;
  }
  // Advance without output (oscillators free-run even when nothing sounds).
  skip(n: i32): void { this.ph += this.dt * f32(n); this.ph -= Mathf.floor(this.ph); }
}

// ---- nonlinearities --------------------------------------------------
// Cheap tanh for output limiting (error < 0.3% on |x| < 3, saturates beyond).
@inline function softclip(x: f32): f32 {
  if (x > 3.0) return 1.0;
  if (x < -3.0) return -1.0;
  const x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

// The 808's "swing type" VCA: a transistor pair driven hard, so the product
// picks up odd harmonics and a little even-order lean (service notes p.5).
@inline function swingVca(x: f32, env: f32): f32 {
  const y = x * env * 1.6;
  return softclip(y + 0.12 * y * y) * 0.62;
}

// Diode clamp: passes positive, limits negative swing to about one diode drop.
@inline function diodeClamp(x: f32, drop: f32): f32 {
  return x >= 0.0 ? x : -drop * (1.0 - Mathf.exp(x / drop));
}

// Amplitude follower (instant attack, exponential release).
class Follower {
  v: f32 = 0; rel: f32 = 0.999;
  setRelease(tau: f32): void { this.rel = decayCoef(tau); }
  tick(x: f32): f32 {
    const a = Mathf.abs(x);
    this.v = a > this.v ? a : this.v * this.rel;
    return this.v;
  }
}

// ---- step clock -------------------------------------------------------
// Converts a musical position into step boundaries, sample by sample.
// Follows the DAW (transport(): ppq + play state) or free-runs at an internal
// tempo. `absStep` counts steps since the song/run start; a change of it is
// a trigger.
let hostPlaying: bool = false;
let hostPpq: f64 = 0.0;
let hostBpm: f32 = 0.0;
let hostSeen: bool = false;       // transport() has been called at least once

class StepClock {
  ppq: f64 = 0.0;                 // position in quarter notes
  lastStep: i64 = -1;
  running: bool = false;
  fired: bool = false;            // a new step began on this sample
  absStep: i64 = 0;

  // Start the internal clock from the downbeat.
  start(): void { this.ppq = 0.0; this.lastStep = -1; this.running = true; }
  stop(): void { this.running = false; this.lastStep = -1; }

  // Advance one sample. `spb` = steps per quarter note, `bpm` tempo.
  tick(spb: f32, bpm: f32): void {
    this.fired = false;
    if (!this.running) return;
    // Nudge by a hair so a step landing exactly on a quarter note (ppq = 1.0
    // computed as 0.99999…) still fires on the right sample.
    const s = i64(Math.floor(this.ppq * f64(spb) + 1e-9));
    if (s != this.lastStep) { this.lastStep = s; this.absStep = s; this.fired = s >= 0; }
    this.ppq += f64(bpm) / (60.0 * f64(SR));
  }
}

// Every plugin's init() starts here: sample rate, a fixed noise seed (renders
// are reproducible, and a re-init sounds the same), and no stale transport.
function commonInit(sr: f32): void {
  SR = sr; invSR = 1.0 / sr;
  rng = 0x9e3779b9;
  hostPlaying = false; hostPpq = 0.0; hostBpm = 0.0; hostSeen = false;
  for (let i = 0; i < 16; i++) display[i] = 0;
  for (let i = 0; i < 12; i++) flashes[i] = 0;
  dispPeak = 0;
}

// Called by every drum plugin's transport() export.
function setHostTransport(playing: i32, ppq: f64, bpm: f32): void {
  hostPlaying = playing != 0;
  hostPpq = ppq;
  hostBpm = bpm;
  hostSeen = true;
}

@inline function hostTempo(): f32 {
  const t = params[63];
  return t > 1.0 ? t : (hostBpm > 1.0 ? hostBpm : 120.0);
}

// A pattern row stored in one parameter as a 16-bit mask (bit n = step n+1).
@inline function stepOn(row: f32, step: i32): bool {
  const bits = i32(row + 0.5);
  return ((bits >> step) & 1) != 0;
}

// Output stage shared by every plugin: optional drive into a soft clipper,
// loudness-compensated so turning DRIVE up adds grit rather than volume.
@inline function driveStage(x: f32, drive: f32): f32 {
  const d = clampf(drive, 0.0, 1.0);
  return softclip(x * (1.0 + d * 5.0)) / (1.0 + d * 1.8);
}

// ---- display bookkeeping (engine → GUI) --------------------------------
// display[3 + i] = hit flash of voice/slot i, display[15] = output peak.
const flashes = new StaticArray<f32>(12);
let dispPeak: f32 = 0;
@inline function hitFlash(i: i32): void { flashes[i] = 1.0; }
@inline function trackPeak(a: f32): void { const b = Mathf.abs(a); if (b > dispPeak) dispPeak = b; }
function finishDisplay(n: i32): void {
  const fall = Mathf.exp(-f32(n) * invSR / 0.09);
  for (let i = 0; i < 12; i++) { display[3 + i] = flashes[i]; flashes[i] *= fall; }
  display[15] = dispPeak;
  dispPeak *= Mathf.exp(-f32(n) * invSR / 0.25);
}

// ---- ABI exports shared by every drum plugin ----------------------------
export function transport(playing: i32, ppq: f64, bpm: f32): void { setHostTransport(playing, ppq, bpm); }
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
