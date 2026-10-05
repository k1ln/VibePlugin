// =====================================================================
//  mods.ts — the Moog ladder filter, the two contour generators, the noise
//  generator (white / pink / red) and the 2x oversampling half-band filters.
// =====================================================================

// ---- 4-pole Moog ladder (zero-delay feedback, saturating input + feedback) ----------------------
//  Normalised signal (±1). g = tan(pi·fc/fs), k = regeneration (self-oscillation from k = 4).
//  The input stage soft-clips (slope 1, ceiling ~1.15 — the overload that fattens the mixer);
//  the feedback path saturates like the transistor ladder's stages, which sets the amplitude of
//  the sine produced at EMPHASIS 10.
const FB_CLIP: f32 = 0.7;
class Ladder {
  s1: f32 = 0; s2: f32 = 0; s3: f32 = 0; s4: f32 = 0;
  tick(xin: f32, g: f32, k: f32): f32 {
    const G = g / (<f32>1.0 + g);
    const G2 = G * G;
    const Gm = <f32>1.0 - G;
    const S = Gm * (G2 * G * this.s1 + G2 * this.s2 + G * this.s3 + this.s4);
    const x = <f32>1.15 * softclip((xin + white() * <f32>0.00002) * <f32>0.87);
    let u = (x - k * S) / (<f32>1.0 + k * G2 * G2);
    const y4p = G2 * G2 * u + S;
    if (y4p > FB_CLIP * <f32>0.6 || y4p < -FB_CLIP * <f32>0.6) u = x - k * FB_CLIP * softclip(y4p / FB_CLIP);
    const v1 = G * (u - this.s1); const y1 = v1 + this.s1; this.s1 = denorm(y1 + v1);
    const v2 = G * (y1 - this.s2); const y2 = v2 + this.s2; this.s2 = denorm(y2 + v2);
    const v3 = G * (y2 - this.s3); const y3 = v3 + this.s3; this.s3 = denorm(y3 + v3);
    const v4 = G * (y3 - this.s4); const y4 = v4 + this.s4; this.s4 = denorm(y4 + v4);
    return y4;
  }
  reset(): void { this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; }
}

// ---- contour generator (the 93-114 board) -----------------------------------------------------------
//  Attack: a 10 µF timing capacitor charges through the ATTACK pot toward +9.3 V and a flip-flop
//  fires when the output reaches its peak (+4.0 V filter / +4.5 V loudness from a +0.1 / -0.3 V
//  rest level): v rises as kA·(1 - e^(-t/τ)) up to 1, kA = 2.36 (filter) or 2.0 (loudness).
//  Decay / release: the capacitor discharges through the DECAY pot toward about -2.5 (in peak
//  units: -10 V against a +4 V peak) and the SUSTAIN level clamps the fall. The DECAY switch off
//  releases through a 1.5 K resistor (15 ms). Re-triggering attacks from the CURRENT level, and
//  the peak creeps up a little when played rapidly (documented on the originals).
const C_IDLE: i32 = 0;
const C_ATK: i32 = 1;
const C_DEC: i32 = 2;
const C_SUS: i32 = 3;
const C_REL: i32 = 4;
const C_TARGET: f32 = 2.5;                         // discharge target, in peak units
const C_LN: f32 = 0.33647224;                      // ln((1 + 2.5) / 2.5): 1 → 0 takes T = τ · C_LN
class Contour {
  v: f32 = 0;
  peak: f32 = 1;
  stage: i32 = 0;
  gate: bool = false;
  kA: f32 = 2.0;
  creep: f32 = 0.1;
  // aT: attack time rest→peak (s); dT: decay time peak→0 (s); relT: release time (s) or <0 for the fast 1.5 K release
  tick(g: bool, aT: f32, dT: f32, s: f32, relT: f32): f32 {
    if (g && !this.gate) { this.stage = C_ATK; this.peak = <f32>1.0 + this.creep * this.v; }
    if (!g && this.gate && this.stage != C_IDLE) this.stage = C_REL;
    this.gate = g;
    const st = this.stage;
    if (st == C_ATK) {
      const tau = aT / Mathf.log(this.kA / (this.kA - <f32>1.0));
      this.v += (this.kA * this.peak - this.v) * (<f32>1.0 - Mathf.exp(-invSR / tau));
      if (this.v >= this.peak) { this.v = this.peak; this.stage = C_DEC; }
    } else if (st == C_DEC) {
      const tau = dT / C_LN;
      this.v += (-C_TARGET - this.v) * (<f32>1.0 - Mathf.exp(-invSR / tau));
      if (this.v <= s) { this.v = s; this.stage = C_SUS; }
    } else if (st == C_SUS) {
      this.v += (s - this.v) * <f32>0.004;
    } else if (st == C_REL) {
      const tau = relT < 0.0 ? <f32>0.015 : relT / C_LN;
      this.v += (-C_TARGET - this.v) * (<f32>1.0 - Mathf.exp(-invSR / tau));
      if (this.v <= 0.0) { this.v = 0.0; this.stage = C_IDLE; }
    }
    this.v = denorm(this.v);
    return this.v;
  }
  reset(): void { this.v = 0; this.stage = C_IDLE; this.gate = false; this.peak = 1; }
}

// ---- noise generator (board 3: white, pink = -3 dB/oct, red = 100 Hz low-pass) --------------------------
class Noise {
  b0: f32 = 0; b1: f32 = 0; b2: f32 = 0; b3: f32 = 0; b4: f32 = 0; b5: f32 = 0; b6: f32 = 0;
  r1: f32 = 0; r2: f32 = 0;
  rA: f32 = 0.013;
  setup(): void { this.rA = onePoleA(100.0); }
  // returns white; pink / red are produced from the same white sample
  pink(w: f32): f32 {                              // Paul Kellet's refined pink filter, normalised to ~±1 peak
    this.b0 = <f32>0.99886 * this.b0 + w * <f32>0.0555179;
    this.b1 = <f32>0.99332 * this.b1 + w * <f32>0.0750759;
    this.b2 = <f32>0.96900 * this.b2 + w * <f32>0.1538520;
    this.b3 = <f32>0.86650 * this.b3 + w * <f32>0.3104856;
    this.b4 = <f32>0.55000 * this.b4 + w * <f32>0.5329522;
    this.b5 = <f32>-0.7616 * this.b5 - w * <f32>0.0168980;
    const p = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * <f32>0.5362;
    this.b6 = w * <f32>0.115926;
    return p * <f32>0.28;
  }
  red(w: f32): f32 {                               // two-pole 100 Hz low-pass (R914/R915/R916 with C908/C915)
    this.r1 += this.rA * (w - this.r1);
    this.r2 += this.rA * (this.r1 - this.r2);
    return this.r2 * <f32>4.2;
  }
  reset(): void { this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0; this.r1 = 0; this.r2 = 0; }
}

// ---- 2x oversampling for the nonlinear stages (mixer overload + ladder) ------------------------------------
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
  for (let k = 0; k < HB_M; k++) hbH[k] = <f32>(tmp[k] / sum);
}
class HbUp {
  buf: StaticArray<f32> = new StaticArray<f32>(64);
  n: i32 = 0;
  e: f32 = 0; o: f32 = 0;
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
  push(a: f32, b: f32): f32 {
    unchecked(this.buf[this.n & 127] = a); unchecked(this.buf[(this.n + 1) & 127] = b); this.n += 2;
    const c = this.n - 2 * HB_M;
    let acc: f32 = <f32>0.5 * unchecked(this.buf[c & 127]);
    for (let k = 0; k < HB_M; k++) acc += unchecked(hbH[k]) * (unchecked(this.buf[(c - 1 - 2 * k) & 127]) + unchecked(this.buf[(c + 1 + 2 * k) & 127]));
    return acc;
  }
  reset(): void { for (let i = 0; i < 128; i++) this.buf[i] = 0.0; this.n = 0; }
}
