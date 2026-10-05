// =====================================================================
//  mods.ts — the Moog ladder filter, the ADSR envelope, the VCA modes and the
//  spring reverb tank.
// =====================================================================

// ---- 4-pole Moog ladder (zero-delay feedback, saturating input stage) ------------------
//  Four trapezoidal one-pole low-passes in series with global resonance feedback.
//  The feedback loop is solved algebraically (no unit delay) so the cutoff — and the
//  self-oscillation pitch — is exact at every frequency; the transistor-pair
//  nonlinearity is a soft clip on the stage-1 input. Works in volts (±5 V nominal).
const FB_CLIP: f32 = 0.7;
class Ladder {
  s1: f32 = 0; s2: f32 = 0; s3: f32 = 0; s4: f32 = 0;
  y: f32 = 0;
  // g = tan(pi*fc/sr), k = resonance feedback 0..4.5 (self-oscillation from k = 4)
  tick(xv: f32, g: f32, k: f32): f32 {
    const G = g / (<f32>1.0 + g);
    const G2 = G * G;
    const Gm = <f32>1.0 - G;
    const S = Gm * (G2 * G * this.s1 + G2 * this.s2 + G * this.s3 + this.s4);
    // input stage: soft clip (slope 1 at the origin, ~1.15 ceiling) — the audio overdrive of the ladder
    const x = <f32>1.15 * softclip((xv * <f32>0.2 + white() * <f32>0.00002) * <f32>0.87);   // ±5 V → ±1, plus a trace of noise to start oscillation
    let u = (x - k * S) / (<f32>1.0 + k * G2 * G2);
    // the feedback path saturates like the transistor ladder's stages: re-evaluate the loop with the
    // linear prediction of the output clipped to ±FB_CLIP (transparent for small signals); this is what
    // sets the self-oscillation amplitude
    const y4p = G2 * G2 * u + S;
    if (y4p > FB_CLIP * <f32>0.6 || y4p < -FB_CLIP * <f32>0.6) u = x - k * FB_CLIP * softclip(y4p / FB_CLIP);
    const us = u;
    const v1 = G * (us - this.s1); const y1 = v1 + this.s1; this.s1 = denorm(y1 + v1);
    const v2 = G * (y1 - this.s2); const y2 = v2 + this.s2; this.s2 = denorm(y2 + v2);
    const v3 = G * (y2 - this.s3); const y3 = v3 + this.s3; this.s3 = denorm(y3 + v3);
    const v4 = G * (y3 - this.s4); const y4 = v4 + this.s4; this.s4 = denorm(y4 + v4);
    this.y = y4;
    return y4 * <f32>5.0;
  }
  reset(): void { this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; this.y = 0; }
}

// ---- the ADSR ------------------------------------------------------------------------
//  Analog-style exponential segments (RC charge/discharge). Output level 0..1 (×8 V).
//  The attack aims at 1.2 so it reaches the top in the set time and then hands over to
//  the decay, like a real ADSR chip; it always starts from the CURRENT level.
const E_IDLE: i32 = 0;
const E_ATK: i32 = 1;
const E_DEC: i32 = 2;
const E_SUS: i32 = 3;
const E_REL: i32 = 4;
class Env {
  lvl: f32 = 0;
  stage: i32 = 0;
  gate: bool = false;
  // times in seconds, s = sustain level 0..1
  tick(g: bool, aT: f32, dT: f32, s: f32, rT: f32): f32 {
    if (g && !this.gate) this.stage = E_ATK;
    if (!g && this.gate && this.stage != E_IDLE) this.stage = E_REL;
    this.gate = g;
    const st = this.stage;
    if (st == E_ATK) {
      this.lvl += (<f32>1.2 - this.lvl) * (<f32>1.0 - Mathf.exp(-<f32>1.7917595 * invSR / aT));
      if (this.lvl >= 1.0) { this.lvl = 1.0; this.stage = E_DEC; }
    } else if (st == E_DEC) {
      this.lvl += (s - <f32>0.002 - this.lvl) * (<f32>1.0 - Mathf.exp(-<f32>4.6 * invSR / dT));
      if (this.lvl <= s + <f32>0.0005) { this.lvl = s; this.stage = E_SUS; }
    } else if (st == E_SUS) {
      this.lvl += (s - this.lvl) * <f32>0.01;                   // follows the SUSTAIN slider smoothly
    } else if (st == E_REL) {
      this.lvl += (<f32>-0.002 - this.lvl) * (<f32>1.0 - Mathf.exp(-<f32>4.6 * invSR / rT));
      if (this.lvl <= 0.0) { this.lvl = 0.0; this.stage = E_IDLE; }
    }
    this.lvl = denorm(this.lvl);
    return this.lvl;
  }
  reset(): void { this.lvl = 0; this.stage = E_IDLE; this.gate = false; }
}

// ---- the spring reverb tank ---------------------------------------------------------
//  Two parallel springs. Each is a feedback loop of: delay (the round trip of the spring)
//  → a long cascade of first-order all-pass sections with a NEGATIVE coefficient
//  (low frequencies are held back longer than highs — the dispersion that makes a spring
//  "boing" and chirp) → loss low-pass → loop gain. Input and output are band-limited like
//  a real tank transducer pair (~120 Hz … 5 kHz).
const SPR_BUF: i32 = 16384;
const SPR_STAGES_MAX: i32 = 256;
class Ap1 {
  z: f32 = 0;
  @inline tick(x: f32, a: f32): f32 { const y = a * x + this.z; this.z = x - a * y; return y; }
}
class Spring {
  buf: StaticArray<f32> = new StaticArray<f32>(SPR_BUF);
  ap: StaticArray<f32> = new StaticArray<f32>(SPR_STAGES_MAX);
  w: i32 = 0;
  d: i32 = 1000;
  nst: i32 = 32;
  g: f32 = 0.88;
  a: f32 = -0.65;
  lp: f32 = 0;
  lpA: f32 = 0.5;
  dc: f32 = 0;
  setup(delaySec: f32, t60: f32, stages: f32, ap: f32, lossHz: f32): void {
    this.d = clampi(i32(delaySec * SR), 16, SPR_BUF - 2);
    this.nst = clampi(i32(stages * SR / <f32>48000.0 + <f32>0.5), 8, SPR_STAGES_MAX);
    this.g = Mathf.pow(<f32>10.0, -<f32>3.0 * delaySec / t60);
    this.a = ap;
    this.lpA = onePoleA(lossHz);
  }
  @inline tick(x: f32): f32 {
    const rd = (this.w - this.d) & (SPR_BUF - 1);
    const yd = unchecked(this.buf[rd]);
    let v = yd;
    const a = this.a;
    for (let i = 0; i < this.nst; i++) {
      const z = unchecked(this.ap[i]);
      const y = a * v + z;
      unchecked(this.ap[i] = denorm(v - a * y));
      v = y;
    }
    this.lp = denorm(this.lp + this.lpA * (v - this.lp));
    // remove DC from the loop so offsets can't pile up
    this.dc = denorm(this.dc + <f32>0.0006 * (this.lp - this.dc));
    unchecked(this.buf[this.w] = x + this.g * (this.lp - this.dc));
    this.w = (this.w + 1) & (SPR_BUF - 1);
    return yd;
  }
  reset(): void {
    for (let i = 0; i < SPR_BUF; i++) unchecked(this.buf[i] = 0.0);
    for (let i = 0; i < SPR_STAGES_MAX; i++) unchecked(this.ap[i] = 0.0);
    this.w = 0; this.lp = 0; this.dc = 0;
  }
}
@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }

class SpringTank {
  s1: Spring = new Spring();
  s2: Spring = new Spring();
  inHp: OnePole = new OnePole(); inLp: OnePole = new OnePole();
  outHp: OnePole = new OnePole(); outLp: OnePole = new OnePole();
  aInHp: f32 = 0.01; aInLp: f32 = 0.4; aOutHp: f32 = 0.02; aOutLp: f32 = 0.4;
  setup(): void {
    this.s1.setup(0.0416, 2.3, 60.0, -0.80, 3400.0);
    this.s2.setup(0.0567, 2.0, 48.0, -0.78, 3000.0);
    this.aInHp = onePoleA(110.0); this.aInLp = onePoleA(5200.0);
    this.aOutHp = onePoleA(90.0); this.aOutLp = onePoleA(4800.0);
  }
  // x: audio in volts/5 (±1 nominal) → wet out (±1 nominal)
  tick(x: f32): f32 {
    let v = this.inHp.hp(x, this.aInHp);
    v = this.inLp.lp(v, this.aInLp);
    v = softclip(v * <f32>0.9) * <f32>1.05;                    // transducer overload
    const o = (this.s1.tick(v * <f32>0.5) + this.s2.tick(v * <f32>0.5)) * <f32>1.9;
    return this.outLp.lp(this.outHp.hp(o, this.aOutHp), this.aOutLp);
  }
  reset(): void { this.s1.reset(); this.s2.reset(); this.inHp.z = 0; this.inLp.z = 0; this.outHp.z = 0; this.outLp.z = 0; }
}

// ---- 2x oversampling for the nonlinear stages (mixer overdrive + ladder) ------------------------------
//  47-tap Kaiser half-band filters (β = 7): the upsampler interpolates the odd phase, the decimator
//  low-passes the 2x signal before dropping every other sample. Latency: HB_M samples each way.
const HB_M: i32 = 12;
const hbH = new StaticArray<f32>(HB_M);          // h[2k+1], k = 0 .. HB_M-1 (centre tap h[0] = 0.5)
function initHalfband(): void {
  const beta: f64 = 7.0; const i0b: f64 = besselI0(beta);
  let sum: f64 = 0.5;
  const tmp = new StaticArray<f64>(HB_M);
  for (let k = 0; k < HB_M; k++) {
    const j: f64 = <f64>(2 * k + 1);
    const sgn: f64 = (k & 1) == 0 ? 1.0 : -1.0;
    let r: f64 = j / <f64>(2 * HB_M); r = 1.0 - r * r; if (r < 0.0) r = 0.0;
    const w: f64 = besselI0(beta * Math.sqrt(r)) / i0b;
    tmp[k] = sgn / (Math.PI * j) * w;
    sum += 2.0 * tmp[k];
  }
  for (let k = 0; k < HB_M; k++) hbH[k] = <f32>(tmp[k] / sum);          // unity DC gain
}
class HbUp {
  buf: StaticArray<f32> = new StaticArray<f32>(64);
  n: i32 = 0;
  e: f32 = 0; o: f32 = 0;                         // the two 2x samples that belong to the base sample delayed by HB_M
  push(x: f32): void {
    unchecked(this.buf[this.n & 63] = x); this.n++;
    const c = this.n - 1 - HB_M;
    let acc: f32 = 0.0;
    for (let k = 0; k < HB_M; k++) acc += unchecked(hbH[k]) * (unchecked(this.buf[(c - k) & 63]) + unchecked(this.buf[(c + 1 + k) & 63]));
    this.o = <f32>2.0 * acc;
    this.e = unchecked(this.buf[c & 63]);
  }
  reset(): void { for (let i = 0; i < 64; i++) this.buf[i] = 0.0; this.n = 0; this.e = 0.0; this.o = 0.0; }
}
class HbDown {
  buf: StaticArray<f32> = new StaticArray<f32>(128);
  n: i32 = 0;
  y: f32 = 0;
  // a = first (even-phase) 2x sample, b = second (odd-phase) 2x sample of the same base-rate frame → one output sample
  push(a: f32, b: f32): f32 {
    unchecked(this.buf[this.n & 127] = a); unchecked(this.buf[(this.n + 1) & 127] = b); this.n += 2;
    const c = this.n - 2 * HB_M;
    let acc: f32 = <f32>0.5 * unchecked(this.buf[c & 127]);
    for (let k = 0; k < HB_M; k++) acc += unchecked(hbH[k]) * (unchecked(this.buf[(c - 1 - 2 * k) & 127]) + unchecked(this.buf[(c + 1 + 2 * k) & 127]));
    this.y = acc; return acc;
  }
  reset(): void { for (let i = 0; i < 128; i++) this.buf[i] = 0.0; this.n = 0; this.y = 0.0; }
}
