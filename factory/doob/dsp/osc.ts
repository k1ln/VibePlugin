// =====================================================================
//  osc.ts — the three VCOs (and the LFO).
//
//  GOsc renders the Model D's waveforms in normalised units (±1 ≈ ±1.7 V on the board):
//    kind 0  a·triangle + b·saw       triangle (a=1,b=0) · shark tooth = the saw/triangle
//                                      resistor mix of the waveform switch (R031 10 K triangle,
//                                      R030 47 K saw → 0.824 / 0.176) · saw (0,1) · reverse saw (0,-1)
//    kind 1  pulse of duty d          square 50 %, wide ≈ 33 %, narrow ≈ 17 % (AC coupled)
//  Every discontinuity (saw wrap, pulse edges) and slope change (triangle corners) is
//  band-limited with 32-tap Kaiser-windowed-sinc step / ramp tables (alias floor ≈ -70 dB)
//  applied to a 16-sample delay line, so the oscillators have a fixed 16-sample latency.
// =====================================================================

const SIN_N: i32 = 4096;
const sinT = new StaticArray<f32>(SIN_N + 2);
function initSin(): void { for (let i = 0; i < SIN_N + 2; i++) sinT[i] = Mathf.sin(TWO_PI * f32(i) / f32(SIN_N)); }
@inline function fsin(ph: f32): f32 {
  const p = ph - Mathf.floor(ph);
  const x = p * f32(SIN_N);
  const i = i32(x);
  const f = x - f32(i);
  const a = unchecked(sinT[i]);
  return a + (unchecked(sinT[i + 1]) - a) * f;
}

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
  n: i32 = 0;
  hist: StaticArray<f32> = new StaticArray<f32>(BL_RING);
  acc: StaticArray<f32> = new StaticArray<f32>(BL_RING);

  // naive waveform at phase p
  naive(p: f32, kind: i32, a: f32, b: f32, d: f32): f32 {
    if (kind == 0) {
      const tri: f32 = p < 0.5 ? <f32>4.0 * p - <f32>1.0 : <f32>3.0 - <f32>4.0 * p;
      return a * tri + b * (<f32>2.0 * p - <f32>1.0);
    }
    return p < d ? <f32>2.0 * (<f32>1.0 - d) : <f32>-2.0 * d;           // AC-coupled pulse, 2 units peak-to-peak
  }
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
  sample(inc0: f32, kind: i32, a: f32, b: f32, d: f32): f32 {
    const inc = clampf(inc0, 1.0e-7, 0.45);
    const oldPh = this.ph;
    const pu = oldPh + inc;
    let wrapped = false;
    let alphaW: f32 = 0.0;
    if (pu >= 1.0) { wrapped = true; alphaW = (pu - <f32>1.0) / inc; }
    if (kind == 0) {
      if (wrapped) {
        if (b != 0.0) this.step(<f32>-2.0 * b, alphaW);
        if (a != 0.0) this.kink(<f32>8.0 * a, inc, alphaW);
      }
      if (a != 0.0 && oldPh < 0.5 && pu >= 0.5 && pu < 1.0) this.kink(<f32>-8.0 * a, inc, (pu - <f32>0.5) / inc);
    } else {
      if (wrapped) this.step(2.0, alphaW);
      if (oldPh < d && pu >= d && pu < 1.0) this.step(-2.0, (pu - d) / inc);
    }
    let p = wrapped ? pu - <f32>1.0 : pu;
    if (p >= 1.0) p -= 1.0;
    this.ph = p;
    unchecked(this.hist[this.n & (BL_RING - 1)] = this.naive(p, kind, a, b, d));
    const oi = (this.n - BL_LAT) & (BL_RING - 1);
    const emit = unchecked(this.hist[oi]) + unchecked(this.acc[oi]);
    unchecked(this.acc[oi] = 0.0);
    this.n = this.n + 1;
    return emit;
  }
  reset(): void {
    this.ph = 0; this.n = 0;
    for (let i = 0; i < BL_RING; i++) { this.hist[i] = 0.0; this.acc[i] = 0.0; }
  }
}
