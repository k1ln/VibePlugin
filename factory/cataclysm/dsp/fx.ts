// =====================================================================
//  fx.ts — CATACLYSM master chain (stereo):
//  transient shaper → distortion A → distortion B → bit crusher → master
//  filter → comb resonator → ring mod → EQ → compressor → echo → reverb →
//  width / Haas / pan → clipper-limiter.
//  Parameters are read from G[] (base values + FX-side modulation) once per
//  control tick (fxTick); fxSample() runs per sample.
// =====================================================================

let fxL: f32 = 0.0;           // result of the last fxSample()
let fxR: f32 = 0.0;
let fxGrDb: f32 = 0.0;        // compressor gain reduction (display)
let fxHitAge: f32 = 99.0;     // seconds since the last hit (filter envelope)
let fxKeyOff: f32 = 0.0;      // last played note − root

// ---- transient shaper ------------------------------------------------------
class TransientShaper {
  fast: f32 = 0.0; slow: f32 = 0.0; g: f32 = 1.0; gT: f32 = 1.0;
  aF: f32 = 0.0; rF: f32 = 0.0; aS: f32 = 0.0; rS: f32 = 0.0;
  atk: f32 = 0.0; sus: f32 = 0.0;
  setup(): void {
    this.aF = <f32>1.0 - Mathf.exp(-invSR / <f32>0.0008);
    this.rF = <f32>1.0 - Mathf.exp(-invSR / <f32>0.015);
    this.aS = <f32>1.0 - Mathf.exp(-invSR / <f32>0.025);
    this.rS = <f32>1.0 - Mathf.exp(-invSR / <f32>0.18);
  }
  reset(): void { this.fast = 0.0; this.slow = 0.0; this.g = 1.0; this.gT = 1.0; }
  tick(atk: f32, sus: f32): void {
    this.atk = atk; this.sus = sus;
    if (atk == 0.0 && sus == 0.0) { this.gT = 1.0; return; }
    const d = clampf(<f32>0.8686 * Mathf.log((this.fast + <f32>0.0001) / (this.slow + <f32>0.0001)), -1.0, 1.0);
    this.gT = dbToGain(d > 0.0 ? atk * d : sus * -d);
  }
  active(): bool { return this.atk != 0.0 || this.sus != 0.0; }
  // returns the gain for this sample
  gain(l: f32, r: f32): f32 {
    const det = (Mathf.abs(l) + Mathf.abs(r)) * <f32>0.5;
    this.fast += (det > this.fast ? this.aF : this.rF) * (det - this.fast);
    this.slow += (det > this.slow ? this.aS : this.rS) * (det - this.slow);
    this.g += (this.gT - this.g) * <f32>0.04;
    return this.g;
  }
}

// ---- distortion ---------------------------------------------------------------
function shaperF(type: i32, v: f32): f32 {
  if (type == 1) return softclip(v);
  if (type == 2) return clampf(v, -1.0, 1.0);
  if (type == 3) return foldTri(v);
  if (type == 4) return v >= 0.0 ? <f32>1.0 - Mathf.exp(-v) : <f32>-0.7 * (<f32>1.0 - Mathf.exp(<f32>0.9 * v));
  if (type == 5) return (v >= 0.0 ? v / (<f32>1.0 + v) : v / (<f32>1.0 - <f32>0.7 * v)) * <f32>0.9;
  if (type == 6) return Mathf.abs(softclip(v)) * <f32>2.0;
  if (type == 7) {
    const x = softclip(v);
    const x2 = x * x;
    return <f32>0.55 * x * (<f32>4.0 * x2 - <f32>3.0) + <f32>0.3 * x * (<f32>16.0 * x2 * x2 - <f32>20.0 * x2 + <f32>5.0) + <f32>0.15 * (<f32>2.0 * x2 - <f32>1.0);
  }
  if (type == 8) return Mathf.sin(v);
  if (type == 9) {
    const t = softclip(v * <f32>3.0);
    return t * <f32>0.75 + (Mathf.abs(t) - <f32>0.5) * <f32>0.35;
  }
  return v;
}

// ---- half-band oversampler (31-tap Kaiser design) ----------------------------------
// x2 stage: even output = 2·Σ c[i]·x[n-i], odd output = x[n-7]; the down stage
// mirrors it. Two stages cascade for 4x. Latency: 15 base samples (2x), ~23 (4x).
const HB_C = new StaticArray<f32>(16);
function bessI0(x: f32): f32 {
  let s: f32 = 1.0; let t: f32 = 1.0; const q = x * x * <f32>0.25;
  for (let k = 1; k < 24; k++) { t = t * q / f32(k * k); s += t; }
  return s;
}
function hbInit(): void {
  const beta: f32 = 8.0; const i0b = bessI0(beta);
  let sumOdd: f32 = 0.0;
  for (let i = 0; i < 16; i++) {
    const ni: i32 = 2 * i - 15;
    const n: f32 = <f32>ni;
    const r = n / <f32>15.0;
    const w = bessI0(beta * Mathf.sqrt(maxf(<f32>0.0, <f32>1.0 - r * r))) / i0b;
    const h = Mathf.sin(PI * n * <f32>0.5) / (PI * n);
    HB_C[i] = h * w; sumOdd += HB_C[i];
  }
  // unity DC gain: 0.5 (centre) + Σ odd taps = 1
  const g = <f32>0.5 / sumOdd;
  for (let i = 0; i < 16; i++) HB_C[i] = HB_C[i] * g;
}
class HalfBand {
  xh: StaticArray<f32> = new StaticArray<f32>(32);   // base-rate history (ring)
  ve: StaticArray<f32> = new StaticArray<f32>(32);   // even high-rate samples
  vo: StaticArray<f32> = new StaticArray<f32>(32);   // odd high-rate samples
  ix: i32 = 0; ie: i32 = 0;
  u0: f32 = 0.0; u1: f32 = 0.0;
  reset(): void { for (let i = 0; i < 32; i++) { this.xh[i] = 0.0; this.ve[i] = 0.0; this.vo[i] = 0.0; } this.ix = 0; this.ie = 0; }
  up(x: f32): void {
    this.ix = (this.ix + 1) & 31;
    unchecked(this.xh[this.ix] = x);
    let e: f32 = 0.0;
    for (let i = 0; i < 16; i++) e += unchecked(HB_C[i]) * unchecked(this.xh[(this.ix - i) & 31]);
    this.u0 = e * <f32>2.0;
    this.u1 = unchecked(this.xh[(this.ix - 7) & 31]);
  }
  down(a: f32, b: f32): f32 {
    this.ie = (this.ie + 1) & 31;
    unchecked(this.ve[this.ie] = a); unchecked(this.vo[this.ie] = b);
    let z: f32 = 0.0;
    for (let i = 0; i < 16; i++) z += unchecked(HB_C[i]) * unchecked(this.ve[(this.ie - i) & 31]);
    return z + <f32>0.5 * unchecked(this.vo[(this.ie - 8) & 31]);
  }
}
class Oversampler {
  a: HalfBand = new HalfBand(); b: HalfBand = new HalfBand();
  reset(): void { this.a.reset(); this.b.reset(); }
  // run `shape` on the oversampled signal. mode 0 = off, 1 = 2x, 2 = 4x
  process(x: f32, mode: i32, type: i32): f32 {
    if (mode == 0) return shaperF(type, x);
    this.a.up(x);
    if (mode == 1) return this.a.down(shaperF(type, this.a.u0), shaperF(type, this.a.u1));
    const e = this.a.u0; const o = this.a.u1;
    this.b.up(e); const e0 = shaperF(type, this.b.u0); const e1 = shaperF(type, this.b.u1);
    const de = this.b.down(e0, e1);
    this.b.up(o); const o0 = shaperF(type, this.b.u0); const o1 = shaperF(type, this.b.u1);
    const dO = this.b.down(o0, o1);
    return this.a.down(de, dO);
  }
}
// short ring delay used to keep the dry/low paths aligned with the oversampled wet path
class AlignDelay {
  buf: StaticArray<f32> = new StaticArray<f32>(64); w: i32 = 0;
  reset(): void { for (let i = 0; i < 64; i++) this.buf[i] = 0.0; this.w = 0; }
  tick(x: f32, d: i32): f32 {
    this.w = (this.w + 1) & 63;
    unchecked(this.buf[this.w] = x);
    return unchecked(this.buf[(this.w - d) & 63]);
  }
}

class DistUnit {
  lowL: Svf = new Svf(); lowR: Svf = new Svf();
  tpL: OnePole = new OnePole(); tpR: OnePole = new OnePole();
  dcL: DcBlock = new DcBlock(); dcR: DcBlock = new DcBlock();
  type: i32 = 0; gain: f32 = 1.0; bias: f32 = 0.0; tone: f32 = 0.0; mix: f32 = 1.0;
  lowOn: bool = false; comp: f32 = 1.0; zeroOut: f32 = 0.0;
  oL: f32 = 0.0; oR: f32 = 0.0;
  osMode: i32 = 0; lat: i32 = 0;
  osL: Oversampler = new Oversampler(); osR: Oversampler = new Oversampler();
  dryL: AlignDelay = new AlignDelay(); dryR: AlignDelay = new AlignDelay();
  lowDL: AlignDelay = new AlignDelay(); lowDR: AlignDelay = new AlignDelay();
  setup(): void { this.tpL.set(900.0); this.tpR.set(900.0); }
  reset(): void {
    this.lowL.reset(); this.lowR.reset(); this.tpL.reset(); this.tpR.reset(); this.dcL.reset(); this.dcR.reset();
    this.osL.reset(); this.osR.reset(); this.dryL.reset(); this.dryR.reset(); this.lowDL.reset(); this.lowDR.reset();
  }
  tick(type: i32, driveDb: f32, bias: f32, tone: f32, low: f32, mix: f32, os: i32): void {
    this.type = type; this.mix = mix; this.tone = tone;
    if (os != this.osMode) { this.osMode = os; this.lat = os == 0 ? 0 : (os == 1 ? 15 : 22); }
    this.gain = dbToGain(driveDb);
    this.bias = bias * <f32>0.9;
    this.comp = <f32>1.0 / Mathf.pow(this.gain, <f32>0.12);
    this.zeroOut = shaperF(type, this.bias);
    this.lowOn = low > 20.5;
    if (this.lowOn) { this.lowL.set(low, 0.7071); this.lowR.set(low, 0.7071); }
  }
  active(): bool { return this.type != 0 && this.mix > 0.0; }
  chan(x: f32, lowF: Svf, tp: OnePole, dc: DcBlock, os: Oversampler, lowD: AlignDelay): f32 {
    let lowPart: f32 = 0.0;
    let hi = x;
    if (this.lowOn) { lowF.tick(x); lowPart = lowF.lp; hi = x - lowPart; }
    let y = os.process(hi * this.gain + this.bias, this.osMode, this.type) - this.zeroOut;
    y = dc.tick(y) * this.comp;
    if (this.tone != 0.0) {
      const lo = tp.lp(y);
      const hh = y - lo;
      y = lo * (<f32>1.0 - <f32>0.85 * this.tone) + hh * (<f32>1.0 + <f32>0.85 * this.tone);
    }
    if (this.lat > 0) lowPart = lowD.tick(lowPart, this.lat);
    return lowPart + y;
  }
  process(l: f32, r: f32): void {
    const wl = this.chan(l, this.lowL, this.tpL, this.dcL, this.osL, this.lowDL);
    const wr = this.chan(r, this.lowR, this.tpR, this.dcR, this.osR, this.lowDR);
    let dl = l; let dr = r;
    if (this.lat > 0) { dl = this.dryL.tick(l, this.lat); dr = this.dryR.tick(r, this.lat); }
    this.oL = finite(dl + (wl - dl) * this.mix);
    this.oR = finite(dr + (wr - dr) * this.mix);
  }
}

// ---- bit crusher / decimator ----------------------------------------------------
class Crusher {
  ph: f32 = 0.0; hL: f32 = 0.0; hR: f32 = 0.0;
  bits: f32 = 16.0; rate: f32 = 48000.0; jit: f32 = 0.0; mix: f32 = 1.0; law: i32 = 0;
  lev: f32 = 32768.0; oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void { this.ph = 0.0; this.hL = 0.0; this.hR = 0.0; }
  tick(bits: f32, rate: f32, jit: f32, mix: f32, law: i32): void {
    this.bits = bits; this.rate = rate; this.jit = jit; this.mix = mix; this.law = law;
    this.lev = exp2f(bits - <f32>1.0);
  }
  active(): bool { return this.mix > 0.0 && (this.bits < 15.9 || this.rate < SR * <f32>0.999 && this.rate < 47000.0); }
  q(x: f32): f32 {
    const L = this.lev;
    if (this.law == 0) return nearest<f32>(clampf(x, -1.0, 1.0) * L) / L;
    const a = Mathf.abs(clampf(x, -1.0, 1.0));
    const c = Mathf.log(<f32>1.0 + <f32>255.0 * a) * <f32>0.18033;       // / ln 256
    const qq = nearest<f32>(c * L) / L;
    const e = (Mathf.exp(qq * <f32>5.545177) - <f32>1.0) * <f32>0.0039216;
    return x < 0.0 ? -e : e;
  }
  process(l: f32, r: f32): void {
    this.ph += this.rate * invSR;
    if (this.ph >= 1.0) {
      this.ph -= 1.0;
      if (this.jit > 0.0) this.ph -= this.jit * rand01() * <f32>0.95;
      if (this.ph < 0.0) this.ph = 0.0;
      this.hL = this.q(l); this.hR = this.q(r);
    }
    this.oL = l + (this.hL - l) * this.mix;
    this.oR = r + (this.hR - r) * this.mix;
  }
}

// ---- master filter ----------------------------------------------------------------
class MasterFilter {
  a1: Svf = new Svf(); a2: Svf = new Svf(); b1: Svf = new Svf(); b2: Svf = new Svf();
  type: i32 = 0; slope24: bool = false; drive: f32 = 0.0; on: bool = false;
  oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void { this.a1.reset(); this.a2.reset(); this.b1.reset(); this.b2.reset(); }
  tick(on: bool, type: i32, cut: f32, q: f32, drv: f32, slope: bool): void {
    this.on = on; this.type = type; this.drive = drv; this.slope24 = slope;
    if (!on) return;
    this.a1.set(cut, q); this.b1.set(cut, q); this.a2.set(cut, q); this.b2.set(cut, q);
  }
  sel(f: Svf): f32 {
    const t = this.type;
    if (t == 0) return f.lp;
    if (t == 1) return f.bp * f.k;
    if (t == 2) return f.hp;
    if (t == 3) return f.lp + f.hp;
    return f.lp - f.hp;
  }
  process(l: f32, r: f32): void {
    const dg = <f32>1.0 + this.drive * <f32>7.0;
    let xl = this.drive > 0.0 ? softclip(l * dg) / (<f32>1.0 + this.drive * <f32>1.2) : l;
    let xr = this.drive > 0.0 ? softclip(r * dg) / (<f32>1.0 + this.drive * <f32>1.2) : r;
    this.a1.tick(xl); this.b1.tick(xr);
    xl = this.sel(this.a1); xr = this.sel(this.b1);
    if (this.slope24) { this.a2.tick(xl); this.b2.tick(xr); xl = this.sel(this.a2); xr = this.sel(this.b2); }
    this.oL = softclip(xl); this.oR = softclip(xr);
  }
}

// ---- comb resonator -------------------------------------------------------------------
const COMB_N: i32 = 8192;
const combBufL = new StaticArray<f32>(COMB_N);
const combBufR = new StaticArray<f32>(COMB_N);
class Comb {
  wi: i32 = 0; dL: f32 = 100.0; dR: f32 = 100.0; fb: f32 = 0.0; mix: f32 = 0.0;
  dampL: OnePole = new OnePole(); dampR: OnePole = new OnePole();
  oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void {
    for (let i = 0; i < COMB_N; i++) { combBufL[i] = 0.0; combBufR[i] = 0.0; }
    this.wi = 0; this.dampL.reset(); this.dampR.reset();
  }
  tick(freq: f32, fb: f32, damp: f32, mix: f32, cents: f32): void {
    const fmin = SR / f32(COMB_N - 4);
    const fl = clampf(freq, fmin, SR * <f32>0.4);
    const fr = clampf(freq * exp2f(cents * <f32>0.000833333), fmin, SR * <f32>0.4);
    this.dL = SR / fl; this.dR = SR / fr; this.fb = fb; this.mix = mix;
    this.dampL.set(damp); this.dampR.set(damp);
  }
  rd(buf: StaticArray<f32>, d: f32): f32 {
    const p = f32(this.wi) - d;
    let ip = i32(Mathf.floor(p));
    const fr = p - f32(ip);
    ip = ip & (COMB_N - 1);
    const i1 = (ip + 1) & (COMB_N - 1);
    return unchecked(buf[ip]) * (<f32>1.0 - fr) + unchecked(buf[i1]) * fr;
  }
  process(l: f32, r: f32): void {
    const hot = Mathf.abs(this.fb) > 0.97;
    const rl = this.dampL.lp(this.rd(combBufL, this.dL));
    const rr = this.dampR.lp(this.rd(combBufR, this.dR));
    let nl = l + this.fb * rl;
    let nr = r + this.fb * rr;
    if (hot) { nl = softclip(nl * <f32>0.9) * <f32>1.1; nr = softclip(nr * <f32>0.9) * <f32>1.1; }
    unchecked(combBufL[this.wi] = denorm(nl)); unchecked(combBufR[this.wi] = denorm(nr));
    this.wi = (this.wi + 1) & (COMB_N - 1);
    const nrm = <f32>1.0 - <f32>0.5 * Mathf.abs(this.fb);
    this.oL = l + (nl * nrm - l) * this.mix;
    this.oR = r + (nr * nrm - r) * this.mix;
  }
}

// ---- compressor ------------------------------------------------------------------------
class Compressor {
  gDb: f32 = 0.0; thr: f32 = -14.0; slope: f32 = 0.0; knee: f32 = 6.0;
  atk: f32 = 0.9; rel: f32 = 0.999; make: f32 = 1.0; mix: f32 = 1.0; on: bool = false;
  hpL: OnePole = new OnePole(); hpR: OnePole = new OnePole();
  oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void { this.gDb = 0.0; this.hpL.reset(); this.hpR.reset(); }
  tick(thr: f32, ratio: f32, att: f32, rel: f32, knee: f32, make: f32, mix: f32, hpf: f32): void {
    this.on = ratio > 1.001 || make > 0.01;
    this.thr = thr; this.slope = <f32>1.0 / ratio - <f32>1.0; this.knee = knee;
    this.atk = Mathf.exp(-invSR / (att * <f32>0.001));
    this.rel = Mathf.exp(-invSR / (rel * <f32>0.001));
    this.make = dbToGain(make); this.mix = mix;
    this.hpL.set(hpf); this.hpR.set(hpf);
  }
  process(l: f32, r: f32): void {
    const sc = maxf(Mathf.abs(this.hpL.hp(l)), Mathf.abs(this.hpR.hp(r)));
    const lv = <f32>8.685889 * Mathf.log(sc + <f32>1.0e-9);
    const over = lv - this.thr;
    let gr: f32 = 0.0;
    const kn = this.knee;
    if (kn > 0.1 && over > -kn * <f32>0.5 && over < kn * <f32>0.5) {
      const t = over + kn * <f32>0.5;
      gr = this.slope * t * t / (<f32>2.0 * kn);
    } else if (over >= kn * <f32>0.5) gr = this.slope * over;
    if (gr < this.gDb) this.gDb = gr + (this.gDb - gr) * this.atk;
    else this.gDb = gr + (this.gDb - gr) * this.rel;
    const g = Mathf.exp(this.gDb * <f32>0.11512925) * this.make;
    this.oL = l + (l * g - l) * this.mix;
    this.oR = r + (r * g - r) * this.mix;
    fxGrDb = this.gDb;
  }
}

// ---- echo ----------------------------------------------------------------------------------
const ECHO_N: i32 = 294912;           // 1.5 s at 192 kHz (power-of-two mask below)
const echoBufL = new StaticArray<f32>(ECHO_N);
const echoBufR = new StaticArray<f32>(ECHO_N);
class Echo {
  wi: i32 = 0; cur: f32 = 8000.0; tgt: f32 = 8000.0; fb: f32 = 0.35; ping: f32 = 0.5; mix: f32 = 0.0;
  dl: OnePole = new OnePole(); dr: OnePole = new OnePole();
  oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void {
    for (let i = 0; i < ECHO_N; i++) { echoBufL[i] = 0.0; echoBufR[i] = 0.0; }
    this.wi = 0; this.dl.reset(); this.dr.reset();
  }
  tick(timeMs: f32, sync: i32, fb: f32, damp: f32, ping: f32, mix: f32): void {
    let t = timeMs * <f32>0.001;
    if (sync > 0) t = syncBeats(sync) * <f32>60.0 / hostTempo();
    this.tgt = clampf(t * SR, 2.0, f32(ECHO_N - 8));
    this.fb = fb; this.ping = ping; this.mix = mix;
    this.dl.set(damp); this.dr.set(damp);
  }
  rd(buf: StaticArray<f32>, d: f32): f32 {
    const p = f32(this.wi) - d;
    let ip = i32(Mathf.floor(p));
    const fr = p - f32(ip);
    while (ip < 0) ip += ECHO_N;
    if (ip >= ECHO_N) ip -= ECHO_N;
    let i1 = ip + 1; if (i1 >= ECHO_N) i1 = 0;
    return unchecked(buf[ip]) * (<f32>1.0 - fr) + unchecked(buf[i1]) * fr;
  }
  process(l: f32, r: f32): void {
    this.cur += (this.tgt - this.cur) * <f32>0.0006;
    const rl = this.rd(echoBufL, this.cur);
    const rr = this.rd(echoBufR, this.cur);
    const fl = this.dl.lp(rl + (rr - rl) * this.ping);
    const fr = this.dr.lp(rr + (rl - rr) * this.ping);
    unchecked(echoBufL[this.wi] = denorm(l + softclip(fl * this.fb)));
    unchecked(echoBufR[this.wi] = denorm(r + softclip(fr * this.fb)));
    this.wi++; if (this.wi >= ECHO_N) this.wi = 0;
    this.oL = l + rl * this.mix;
    this.oR = r + rr * this.mix;
  }
}

// ---- reverb: 4 allpass diffusers into an 8-line feedback delay network ------------------------
const FDN_N: i32 = 8192;
const FDN_LINES: i32 = 8;
const fdnBuf = new StaticArray<f32>(FDN_N * FDN_LINES);
const fdnBase: StaticArray<f32> = [1117.0, 1303.0, 1523.0, 1741.0, 1949.0, 2203.0, 2411.0, 2683.0];
const apBase: StaticArray<f32> = [142.0, 107.0, 379.0, 277.0];
const PRE_N: i32 = 16384;
const preBuf = new StaticArray<f32>(PRE_N);
const apBuf = new StaticArray<f32>(4 * 1024);
class Reverb {
  wi: i32 = 0; pwi: i32 = 0;
  len: StaticArray<i32> = new StaticArray<i32>(FDN_LINES);
  gain: StaticArray<f32> = new StaticArray<f32>(FDN_LINES);
  lp: StaticArray<f32> = new StaticArray<f32>(FDN_LINES);
  apLen: StaticArray<i32> = new StaticArray<i32>(4);
  apIdx: StaticArray<i32> = new StaticArray<i32>(4);
  dampA: f32 = 0.5; preD: i32 = 100; mix: f32 = 0.0;
  gate: bool = false; hold: i32 = 0; holdN: i32 = 1; relCoef: f32 = 0.99; gEnv: f32 = 0.0; gG: f32 = 1.0; openEnv: f32 = 0.0;
  oL: f32 = 0.0; oR: f32 = 0.0;
  reset(): void {
    for (let i = 0; i < FDN_N * FDN_LINES; i++) fdnBuf[i] = 0.0;
    for (let i = 0; i < PRE_N; i++) preBuf[i] = 0.0;
    for (let i = 0; i < 4 * 1024; i++) apBuf[i] = 0.0;
    for (let j = 0; j < FDN_LINES; j++) this.lp[j] = 0.0;
    for (let j = 0; j < 4; j++) this.apIdx[j] = 0;
    this.wi = 0; this.pwi = 0; this.gEnv = 0.0; this.gG = 1.0; this.hold = 0; this.openEnv = 0.0;
  }
  tick(size: f32, rt60: f32, damp: f32, preMs: f32, mix: f32, gate: bool, holdMs: f32, relMs: f32): void {
    const sc = (<f32>0.5 + size * <f32>1.4) * SR / <f32>48000.0;
    for (let j = 0; j < FDN_LINES; j++) {
      let l = i32(fdnBase[j] * sc);
      if (l > FDN_N - 4) l = FDN_N - 4;
      if (l < 16) l = 16;
      this.len[j] = l;
      this.gain[j] = Mathf.exp(-LN10_60 * f32(l) * invSR / rt60);
    }
    const asc = SR / <f32>48000.0;
    for (let j = 0; j < 4; j++) { let l = i32(apBase[j] * asc); if (l > 1020) l = 1020; this.apLen[j] = l; }
    this.dampA = lerpf(<f32>0.92, <f32>0.10, damp);
    this.preD = i32(clampf(preMs * <f32>0.001 * SR, 1.0, f32(PRE_N - 4)));
    this.mix = mix; this.gate = gate;
    this.holdN = i32(holdMs * <f32>0.001 * SR);
    this.relCoef = Mathf.exp(-LN10_60 / maxf(<f32>8.0, relMs * <f32>0.001 * SR));
  }
  process(l: f32, r: f32): void {
    const m = (l + r) * <f32>0.5;
    unchecked(preBuf[this.pwi] = m);
    let x = unchecked(preBuf[(this.pwi - this.preD) & (PRE_N - 1)]);
    this.pwi = (this.pwi + 1) & (PRE_N - 1);
    // diffusion
    for (let j = 0; j < 4; j++) {
      const L = unchecked(this.apLen[j]);
      const base = j * 1024;
      const ix = unchecked(this.apIdx[j]);
      const d = unchecked(apBuf[base + ix]);
      const w = x - <f32>0.6 * d;
      unchecked(apBuf[base + ix] = denorm(w));
      x = d + <f32>0.6 * w;
      let nx = ix + 1; if (nx >= L) nx = 0;
      unchecked(this.apIdx[j] = nx);
    }
    // FDN
    let sum: f32 = 0.0;
    let oL: f32 = 0.0; let oR: f32 = 0.0;
    const rd = this.wi;
    // read + damp
    let v0: f32 = 0.0; let v1: f32 = 0.0; let v2: f32 = 0.0; let v3: f32 = 0.0;
    let v4: f32 = 0.0; let v5: f32 = 0.0; let v6: f32 = 0.0; let v7: f32 = 0.0;
    for (let j = 0; j < FDN_LINES; j++) {
      const idx = j * FDN_N + ((rd - unchecked(this.len[j])) & (FDN_N - 1));
      const raw = unchecked(fdnBuf[idx]);
      const z = unchecked(this.lp[j]);
      const d = denorm(z + this.dampA * (raw - z));
      unchecked(this.lp[j] = d);
      sum += d;
      if (j == 0) v0 = d; else if (j == 1) v1 = d; else if (j == 2) v2 = d; else if (j == 3) v3 = d;
      else if (j == 4) v4 = d; else if (j == 5) v5 = d; else if (j == 6) v6 = d; else v7 = d;
    }
    oL = v0 - v1 + v2 - v3 + v4 - v5 + v6 - v7;
    oR = v0 + v1 - v2 - v3 + v4 + v5 - v6 - v7;
    const hs = sum * <f32>0.25;
    for (let j = 0; j < FDN_LINES; j++) {
      const dj = j == 0 ? v0 : j == 1 ? v1 : j == 2 ? v2 : j == 3 ? v3 : j == 4 ? v4 : j == 5 ? v5 : j == 6 ? v6 : v7;
      const fbv = (dj - hs) * unchecked(this.gain[j]);
      unchecked(fdnBuf[j * FDN_N + this.wi] = denorm(x * <f32>0.35 + fbv));
    }
    this.wi = (this.wi + 1) & (FDN_N - 1);
    // gate
    let gg: f32 = 1.0;
    if (this.gate) {
      const a = Mathf.abs(m);
      if (a > 0.004) this.hold = this.holdN;
      else if (this.hold > 0) this.hold--;
      if (this.hold > 0) this.gG += (<f32>1.0 - this.gG) * <f32>0.05;
      else this.gG *= this.relCoef;
      gg = this.gG;
    }
    const w = this.mix * gg * <f32>0.45;
    this.oL = l + oL * w;
    this.oR = r + oR * w;
  }
}

// ---- output stage -------------------------------------------------------------------------------
const HAAS_N: i32 = 8192;
const haasBuf = new StaticArray<f32>(HAAS_N);
class OutStage {
  width: f32 = 1.0; haas: i32 = 0; hwi: i32 = 0; panGl: f32 = 1.0; panGr: f32 = 1.0;
  drive: f32 = 1.0; level: f32 = 1.0; mode: i32 = 0; ceil: f32 = 0.94; lim: f32 = 1.0; limRel: f32 = 0.999;
  dcL: DcBlock = new DcBlock(); dcR: DcBlock = new DcBlock();
  reset(): void {
    for (let i = 0; i < HAAS_N; i++) haasBuf[i] = 0.0;
    this.hwi = 0; this.lim = 1.0; this.dcL.reset(); this.dcR.reset();
  }
  setup(): void { this.limRel = Mathf.exp(-invSR / <f32>0.06); }
  tick(width: f32, haasMs: f32, pan: f32, driveDb: f32, lev: f32, mode: i32, ceilDb: f32): void {
    this.width = width;
    this.haas = i32(clampf(haasMs * <f32>0.001 * SR, 0.0, f32(HAAS_N - 4)));
    this.panGl = panL(pan); this.panGr = panR(pan);
    this.drive = dbToGain(driveDb); this.level = lvlGain(lev); this.mode = mode;
    this.ceil = dbToGain(ceilDb);
  }
  process(l0: f32, r0: f32): void {
    let l = this.dcL.tick(l0); let r = this.dcR.tick(r0);
    if (this.width != 1.0) {
      const mid = (l + r) * <f32>0.5; const side = (l - r) * <f32>0.5 * this.width;
      l = mid + side; r = mid - side;
    }
    if (this.haas > 0) {
      unchecked(haasBuf[this.hwi] = r);
      r = unchecked(haasBuf[(this.hwi - this.haas) & (HAAS_N - 1)]);
      this.hwi = (this.hwi + 1) & (HAAS_N - 1);
    }
    const g = this.level * this.drive;
    l *= g * this.panGl; r *= g * this.panGr;
    const c = this.ceil;
    if (this.mode == 0) { l = c * softclip(l / c); r = c * softclip(r / c); }
    else if (this.mode == 2) {
      const pk = maxf(Mathf.abs(l), Mathf.abs(r));
      const need = pk > c ? c / pk : <f32>1.0;
      if (need < this.lim) this.lim = need; else this.lim += (<f32>1.0 - this.lim) * (<f32>1.0 - this.limRel);
      l *= this.lim; r *= this.lim;
    }
    // hard clip is both the 'hard' mode and the final safety net
    if (!(l == l)) l = 0.0; if (!(r == r)) r = 0.0;
    fxL = clampf(l, -c, c); fxR = clampf(r, -c, c);
  }
}

// ---- the chain ---------------------------------------------------------------------------------------
const ts = new TransientShaper();
const d1 = new DistUnit();
const d2 = new DistUnit();
const crush = new Crusher();
const mfil = new MasterFilter();
const comb = new Comb();
const comp = new Compressor();
const echo = new Echo();
const verb = new Reverb();
const outst = new OutStage();
const eqHpf = new Biquad(); const eqHpf2 = new Biquad();
const eqLs = new Biquad(); const eqLm = new Biquad(); const eqHm = new Biquad(); const eqHs = new Biquad();
const eqLpf = new Biquad(); const eqLpf2 = new Biquad();
const eqHpfR = new Biquad(); const eqHpfR2 = new Biquad();
const eqLsR = new Biquad(); const eqLmR = new Biquad(); const eqHmR = new Biquad(); const eqHsR = new Biquad();
const eqLpfR = new Biquad(); const eqLpfR2 = new Biquad();
let eqOnHpf: bool = false; let eqOnLs: bool = false; let eqOnLm: bool = false;
let eqOnHm: bool = false; let eqOnHs: bool = false; let eqOnLpf: bool = false;
let rmPh: f32 = 0.0; let rmInc: f32 = 0.0; let rmMix: f32 = 0.0;
let combOn: bool = false; let rvOn: bool = false; let dlOn: bool = false;

function fxInit(): void {
  hbInit();
  ts.setup(); ts.reset();
  d1.setup(); d1.reset(); d2.setup(); d2.reset();
  crush.reset(); mfil.reset(); comb.reset(); comp.reset(); echo.reset(); verb.reset();
  outst.setup(); outst.reset();
  eqHpf.reset(); eqHpf2.reset(); eqLs.reset(); eqLm.reset(); eqHm.reset(); eqHs.reset(); eqLpf.reset(); eqLpf2.reset();
  eqHpfR.reset(); eqHpfR2.reset(); eqLsR.reset(); eqLmR.reset(); eqHmR.reset(); eqHsR.reset(); eqLpfR.reset(); eqLpfR2.reset();
  rmPh = 0.0; fxHitAge = 99.0; fxKeyOff = 0.0; fxGrDb = 0.0; fxL = 0.0; fxR = 0.0;
}

// Clear all tails (used if a runaway value is detected).
function fxPanicReset(): void {
  ts.reset(); d1.reset(); d2.reset(); crush.reset(); mfil.reset(); comb.reset(); comp.reset(); echo.reset(); verb.reset();
  outst.reset();
  eqHpf.reset(); eqHpf2.reset(); eqLs.reset(); eqLm.reset(); eqHm.reset(); eqHs.reset(); eqLpf.reset(); eqLpf2.reset();
  eqHpfR.reset(); eqHpfR2.reset(); eqLsR.reset(); eqLmR.reset(); eqHmR.reset(); eqHsR.reset(); eqLpfR.reset(); eqLpfR2.reset();
}

function fxTick(m: i32): void {
  fxHitAge += f32(m) * invSR;
  ts.tick(G[P_TS_ATK], G[P_TS_SUS]);
  d1.tick(i32(G[P_D1_TYPE]), G[P_D1_DRV], G[P_D1_BIAS], G[P_D1_TONE], G[P_D1_LOW], G[P_D1_MIX], i32(G[P_DS_OS]));
  d2.tick(i32(G[P_D2_TYPE]), G[P_D2_DRV], G[P_D2_BIAS], G[P_D2_TONE], G[P_D2_LOW], G[P_D2_MIX], i32(G[P_DS_OS]));
  crush.tick(G[P_CR_BITS], G[P_CR_RATE], G[P_CR_JIT], G[P_CR_MIX], i32(G[P_CR_MODE]));
  rmInc = G[P_RM_FREQ] * invSR; rmMix = G[P_RM_MIX];

  // master filter (cutoff follows each hit's envelope and the played key)
  const henv = curveEnv(fxHitAge, G[P_FL_ENVT] * <f32>0.001, 1.0);
  const cut = clampf(G[P_FL_CUT] * exp2f(G[P_FL_ENV] * henv + G[P_FL_KT] * fxKeyOff * <f32>0.0833333), 15.0, SR * <f32>0.46);
  mfil.tick(G[P_FL_ON] > 0.5, i32(G[P_FL_TYPE]), cut, G[P_FL_RES], G[P_FL_DRV], G[P_FL_SLOPE] > 0.5);

  combOn = G[P_CB_MIX] > 0.0;
  comb.tick(G[P_CB_FREQ] * exp2f(G[P_CB_KT] * fxKeyOff * <f32>0.0833333), G[P_CB_FB], G[P_CB_DAMP], G[P_CB_MIX], G[P_CB_STEREO]);

  // EQ
  eqOnHpf = G[P_EQ_HPF] > 10.5;
  if (eqOnHpf) { eqHpf.set(3, G[P_EQ_HPF], 0.7071, 0.0); eqHpf2.set(3, G[P_EQ_HPF], 0.7071, 0.0); eqHpfR.set(3, G[P_EQ_HPF], 0.7071, 0.0); eqHpfR2.set(3, G[P_EQ_HPF], 0.7071, 0.0); }
  eqOnLs = Mathf.abs(G[P_EQ_LS_G]) > 0.05;
  if (eqOnLs) { eqLs.set(0, G[P_EQ_LS_F], 0.7071, G[P_EQ_LS_G]); eqLsR.set(0, G[P_EQ_LS_F], 0.7071, G[P_EQ_LS_G]); }
  eqOnLm = Mathf.abs(G[P_EQ_LM_G]) > 0.05;
  if (eqOnLm) { eqLm.set(2, G[P_EQ_LM_F], G[P_EQ_LM_Q], G[P_EQ_LM_G]); eqLmR.set(2, G[P_EQ_LM_F], G[P_EQ_LM_Q], G[P_EQ_LM_G]); }
  eqOnHm = Mathf.abs(G[P_EQ_HM_G]) > 0.05;
  if (eqOnHm) { eqHm.set(2, G[P_EQ_HM_F], G[P_EQ_HM_Q], G[P_EQ_HM_G]); eqHmR.set(2, G[P_EQ_HM_F], G[P_EQ_HM_Q], G[P_EQ_HM_G]); }
  eqOnHs = Mathf.abs(G[P_EQ_HS_G]) > 0.05;
  if (eqOnHs) { eqHs.set(1, G[P_EQ_HS_F], 0.7071, G[P_EQ_HS_G]); eqHsR.set(1, G[P_EQ_HS_F], 0.7071, G[P_EQ_HS_G]); }
  eqOnLpf = G[P_EQ_LPF] < 19900.0;
  if (eqOnLpf) { eqLpf.set(4, G[P_EQ_LPF], 0.7071, 0.0); eqLpf2.set(4, G[P_EQ_LPF], 0.7071, 0.0); eqLpfR.set(4, G[P_EQ_LPF], 0.7071, 0.0); eqLpfR2.set(4, G[P_EQ_LPF], 0.7071, 0.0); }

  comp.tick(G[P_CP_THR], G[P_CP_RATIO], G[P_CP_ATT], G[P_CP_REL], G[P_CP_KNEE], G[P_CP_MAKE], G[P_CP_MIX], G[P_CP_HPF]);
  dlOn = G[P_DL_MIX] > 0.0;
  echo.tick(G[P_DL_TIME], i32(G[P_DL_SYNC]), G[P_DL_FB], G[P_DL_DAMP], G[P_DL_PING], G[P_DL_MIX]);
  rvOn = G[P_RV_MIX] > 0.0;
  verb.tick(G[P_RV_SIZE], G[P_RV_DEC], G[P_RV_DAMP], G[P_RV_PRE], G[P_RV_MIX], G[P_RV_GATE] > 0.5, G[P_RV_GHOLD], G[P_RV_GREL]);
  outst.tick(G[P_OUT_WIDTH], G[P_OUT_HAAS], G[P_OUT_PAN], G[P_OUT_DRIVE], G[P_OUT_LEVEL], i32(G[P_OUT_CLIP]), G[P_OUT_CEIL]);
}

function fxSample(l0: f32, r0: f32): void {
  let l = l0; let r = r0;
  if (ts.active()) { const g = ts.gain(l, r); l *= g; r *= g; }
  else ts.gain(l, r);
  if (d1.active()) { d1.process(l, r); l = d1.oL; r = d1.oR; }
  if (d2.active()) { d2.process(l, r); l = d2.oL; r = d2.oR; }
  if (crush.active()) { crush.process(l, r); l = crush.oL; r = crush.oR; }
  if (mfil.on) { mfil.process(l, r); l = mfil.oL; r = mfil.oR; }
  if (combOn) { comb.process(l, r); l = comb.oL; r = comb.oR; }
  if (rmMix > 0.0) {
    rmPh += rmInc; if (rmPh >= 1.0) rmPh -= 1.0;
    const c = Mathf.sin(TWO_PI * rmPh);
    l += (l * c - l) * rmMix; r += (r * c - r) * rmMix;
  }
  if (eqOnHpf) { l = eqHpf2.tick(eqHpf.tick(l)); r = eqHpfR2.tick(eqHpfR.tick(r)); }
  if (eqOnLs) { l = eqLs.tick(l); r = eqLsR.tick(r); }
  if (eqOnLm) { l = eqLm.tick(l); r = eqLmR.tick(r); }
  if (eqOnHm) { l = eqHm.tick(l); r = eqHmR.tick(r); }
  if (eqOnHs) { l = eqHs.tick(l); r = eqHsR.tick(r); }
  if (eqOnLpf) { l = eqLpf2.tick(eqLpf.tick(l)); r = eqLpfR2.tick(eqLpfR.tick(r)); }
  if (comp.on) { comp.process(l, r); l = comp.oL; r = comp.oR; }
  else fxGrDb = 0.0;
  if (dlOn) { echo.process(l, r); l = echo.oL; r = echo.oR; }
  if (rvOn) { verb.process(l, r); l = verb.oL; r = verb.oR; }
  outst.process(l, r);
}
