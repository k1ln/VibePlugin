// =====================================================================
//  osc.ts — the two VCOs and the modulation oscillator.
//
//  GOsc renders triangle / saw / square / narrow-pulse in VOLTS (±5 V, AC
//  coupled like the hardware's WAVE OUT jacks). Every discontinuity — a natural
//  wrap, the pulse's falling edge, the triangle's corners and the hard-sync
//  reset of Oscillator 2 — is band-limited with a two-sample polyBLEP /
//  polyBLAMP residual applied to the current sample and the (delayed) previous
//  one, so nothing is double counted and sync stays alias-free. Output latency
//  is exactly one sample on both oscillators.
// =====================================================================

// ---- table sine ------------------------------------------------------------
const SIN_N: i32 = 4096;
const sinT = new StaticArray<f32>(SIN_N + 2);
function initSin(): void { for (let i = 0; i < SIN_N + 2; i++) sinT[i] = Mathf.sin(TWO_PI * f32(i) / f32(SIN_N)); }
@inline function fsin(ph: f32): f32 {           // ph in cycles, any value
  const p = ph - Mathf.floor(ph);
  const x = p * f32(SIN_N);
  const i = i32(x);
  const f = x - f32(i);
  const a = unchecked(sinT[i]);
  return a + (unchecked(sinT[i + 1]) - a) * f;
}

// polyBLEP residual for a unit-amplitude saw (t = phase 0..1, dt = phase increment)
@inline function polyblep(t: f32, dt: f32): f32 {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1.0; }
  if (t > 1.0 - dt) { const u = (t - 1.0) / dt; return u * u + u + u + 1.0; }
  return 0.0;
}

const W_TRI: i32 = 0;
const W_SAW: i32 = 1;
const W_SQR: i32 = 2;
const W_NAR: i32 = 3;

// ---- band-limited step / ramp residual tables -----------------------------------------------------
//  A discontinuity of height J at time te adds J·STEP_RES(n - te) to every sample n within ±16 samples;
//  a slope change dS adds dS·RAMP_RES(n - te). STEP_RES / RAMP_RES are (band-limited step/ramp) minus
//  (ideal step/ramp): exactly what turns the naive waveform into the band-limited one. The band-limiting
//  kernel is a 32-tap Kaiser-windowed sinc (β = 7.5) with its cutoff at 0.43·fs: everything that could
//  fold back into the audible band is > 70 dB down. Tables: 32 taps × BL_P sub-sample phases, built once at init.
const BL_H: i32 = 16;                           // half width (samples)
const BL_T: i32 = 32;                           // taps per phase
const BL_P: i32 = 128;
const BL_LAT: i32 = 16;                         // output latency of the oscillators (samples)
const BL_RING: i32 = 64;
const blStep = new StaticArray<f32>((BL_P + 1) * BL_T);
const blRamp = new StaticArray<f32>((BL_P + 1) * BL_T);
function besselI0(x: f64): f64 {
  let sum: f64 = 1.0; let term: f64 = 1.0; const q: f64 = x * x * 0.25;
  for (let k = 1; k < 40; k++) { term = term * q / (<f64>k * <f64>k); sum += term; if (term < 1.0e-14 * sum) break; }
  return sum;
}
function initBlep(): void {
  const F: i32 = 128;                           // fine steps per sample
  const n: i32 = 2 * BL_H * F;                  // τ from -H .. +H
  const ws = new StaticArray<f64>(n + 1);
  const fcn: f64 = 0.43;                        // cutoff, cycles per sample
  const beta: f64 = 7.5;
  const i0b: f64 = besselI0(beta);
  let tot: f64 = 0.0;
  for (let i = 0; i <= n; i++) {
    const t: f64 = (<f64>i - <f64>(n / 2)) / <f64>F;
    const x: f64 = 2.0 * Math.PI * fcn * t;
    const sinc: f64 = t == 0.0 ? 1.0 : Math.sin(x) / x;
    let r: f64 = t / <f64>BL_H; r = 1.0 - r * r; if (r < 0.0) r = 0.0;
    const w: f64 = besselI0(beta * Math.sqrt(r)) / i0b;
    unchecked(ws[i] = sinc * w);
    tot += sinc * w;
  }
  tot = tot / <f64>F;                           // ∫ kernel (so the step ends at exactly 1)
  const st = new StaticArray<f64>(n + 1);       // band-limited step
  const rp = new StaticArray<f64>(n + 1);       // band-limited ramp
  let acc: f64 = 0.0; let acc2: f64 = 0.0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) acc += 0.5 * (unchecked(ws[i]) + unchecked(ws[i - 1])) / (<f64>F * tot);
    unchecked(st[i] = acc);
    if (i > 0) acc2 += 0.5 * (unchecked(st[i]) + unchecked(st[i - 1])) / <f64>F;
    unchecked(rp[i] = acc2);
  }
  for (let ph = 0; ph <= BL_P; ph++) {
    const alpha: f64 = <f64>ph / <f64>BL_P;
    for (let j = 0; j < BL_T; j++) {
      const tau: f64 = alpha + <f64>(j - (BL_H - 1));        // sample offset from the edge
      let fi = (tau + <f64>BL_H) * <f64>F;
      let beyond: f64 = 0.0;                                   // past the kernel's support the ramp continues linearly
      if (fi < 0.0) fi = 0.0;
      if (fi > <f64>n) { beyond = (fi - <f64>n) / <f64>F; fi = <f64>n; }
      const i0: i32 = i32(fi); const fr: f64 = fi - <f64>i0;
      const i1: i32 = i0 < n ? i0 + 1 : i0;
      const sv: f64 = unchecked(st[i0]) * (1.0 - fr) + unchecked(st[i1]) * fr;
      const rv: f64 = unchecked(rp[i0]) * (1.0 - fr) + unchecked(rp[i1]) * fr + beyond;
      const hv: f64 = tau >= 0.0 ? 1.0 : 0.0;
      unchecked(blStep[ph * BL_T + j] = <f32>(sv - hv));
      unchecked(blRamp[ph * BL_T + j] = <f32>(rv - (tau >= 0.0 ? tau : 0.0)));
    }
  }
}

class GOsc {
  ph: f32 = 0;
  n: i32 = 0;                                   // running sample counter (ring index)
  hist: StaticArray<f32> = new StaticArray<f32>(BL_RING);
  acc: StaticArray<f32> = new StaticArray<f32>(BL_RING);
  wrapAlpha: f32 = -1;         // >=0 when the phase wrapped in the last sample (fraction elapsed since the wrap)

  // naive waveform in volts at phase p (pulse width / duty = d)
  naive(p: f32, wave: i32, d: f32): f32 {
    if (wave == W_TRI) return p < 0.5 ? <f32>20.0 * p - <f32>5.0 : <f32>15.0 - <f32>20.0 * p;
    if (wave == W_SAW) return <f32>10.0 * p - <f32>5.0;
    return p < d ? <f32>10.0 * (<f32>1.0 - d) : <f32>-10.0 * d;      // AC-coupled pulse
  }
  // add a band-limited step (J) or kink (dS per sample) whose edge occurred `alpha` of a sample before now
  @inline step(J: f32, alpha: f32): void { this.addTab(J, alpha, blStep); }
  @inline kink(dS: f32, inc: f32, alpha: f32): void { this.addTab(dS * inc, alpha, blRamp); }
  addTab(amp: f32, alpha: f32, tab: StaticArray<f32>): void {
    const x = alpha * <f32>BL_P;
    let i = i32(x);
    if (i >= BL_P) i = BL_P - 1;
    const fr = x - f32(i);
    const o0 = i * BL_T;
    const o1 = o0 + BL_T;
    const base = this.n - (BL_H - 1);
    for (let j = 0; j < BL_T; j++) {
      const r = unchecked(tab[o0 + j]) * (<f32>1.0 - fr) + unchecked(tab[o1 + j]) * fr;
      const idx = (base + j) & (BL_RING - 1);
      unchecked(this.acc[idx] = this.acc[idx] + amp * r);
    }
  }
  // syncAlpha < 0: free running. >= 0: the master wrapped in this sample and
  // `syncAlpha` is the fraction of the sample elapsed since that reset.
  sample(inc0: f32, wave: i32, d: f32, syncAlpha: f32): f32 {
    const inc = clampf(inc0, 1.0e-7, 0.45);
    const oldPh = this.ph;
    const pu = oldPh + inc;
    const sy = syncAlpha >= 0.0;
    let alphaW: f32 = -1.0;
    let wrapped = false;
    if (pu >= 1.0) { wrapped = true; alphaW = (pu - <f32>1.0) / inc; }
    // natural events on [oldPh, pu] — only those that precede the sync reset survive
    if (wave == W_SAW) {
      if (wrapped && (!sy || alphaW > syncAlpha)) this.step(-10.0, alphaW);
    } else if (wave == W_TRI) {
      if (wrapped && (!sy || alphaW > syncAlpha)) this.kink(40.0, inc, alphaW);
      if (oldPh < 0.5 && pu >= 0.5 && pu < 1.0) { const aH = (pu - <f32>0.5) / inc; if (!sy || aH > syncAlpha) this.kink(-40.0, inc, aH); }
    } else {
      if (wrapped && (!sy || alphaW > syncAlpha)) this.step(10.0, alphaW);
      if (oldPh < d && pu >= d && pu < 1.0) { const aP = (pu - d) / inc; if (!sy || aP > syncAlpha) this.step(-10.0, aP); }
    }
    let p = wrapped ? pu - <f32>1.0 : pu;
    if (sy) {
      let pr = oldPh + inc * (<f32>1.0 - syncAlpha);
      if (pr >= 1.0) pr -= 1.0;
      this.step(this.naive(0.0, wave, d) - this.naive(pr, wave, d), syncAlpha);
      if (wave == W_TRI) { const sb: f32 = pr < 0.5 ? <f32>20.0 : <f32>-20.0; this.kink(<f32>20.0 - sb, inc, syncAlpha); }
      p = inc * syncAlpha;
    }
    if (p >= 1.0) p -= 1.0;
    this.ph = p;
    this.wrapAlpha = (wrapped && !sy) ? alphaW : <f32>-1.0;
    // store the naive sample, emit the sample from BL_LAT samples ago with all its corrections applied
    unchecked(this.hist[this.n & (BL_RING - 1)] = this.naive(p, wave, d));
    const oi = (this.n - BL_LAT) & (BL_RING - 1);
    const emit = unchecked(this.hist[oi]) + unchecked(this.acc[oi]);
    unchecked(this.acc[oi] = 0.0);
    this.n = this.n + 1;
    return emit;
  }
  reset(): void {
    this.ph = 0; this.n = 0; this.wrapAlpha = -1;
    for (let i = 0; i < BL_RING; i++) { this.hist[i] = 0.0; this.acc[i] = 0.0; }
  }
}

// ---- the modulation oscillator -------------------------------------------------------
// WAVE OUT = ±5 V (DC coupled). Sine / sawtooth (rising) / ramp (falling) / square.
// S/H OUT samples the noise generator at the start of every wave cycle. The saw / ramp / square use
// the same band-limited core as the VCOs (the manual plays this oscillator at audio rate too).
class Lfo {
  o: GOsc = new GOsc();
  sh: f32 = 0;
  wrapped: bool = false;
  tick(inc0: f32, wave: i32): f32 {
    const inc = clampf(inc0, 1.0e-7, 0.45);
    const y = this.o.sample(inc, wave == 3 ? W_SQR : W_SAW, 0.5, -1.0);
    this.wrapped = this.o.wrapAlpha >= 0.0;
    if (this.wrapped) this.sh = white() * <f32>5.0;
    if (wave == 0) return <f32>5.0 * fsin(this.o.ph);
    if (wave == 2) return -y;
    return y;
  }
  get ph(): f32 { return this.o.ph; }
  syncReset(): void { this.o.ph = 0.0; this.sh = white() * <f32>5.0; }
  reset(): void { this.o.reset(); this.sh = 0; this.wrapped = false; }
}
