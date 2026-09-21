// =====================================================================
//  drums/tr606/voices.ts — the 1981 battery box: seven analog voices.
//
//  Sources:
//   · TR-606 Owner's Manual (read in full) — instrument mix per voice,
//     accent, scale, last step; the open hi-hat has no decay control.
//   · TR-606 Service Notes (Jan. 1982) — block diagram (twin-T oscillators,
//     noise, six-oscillator metal through band-passes, VCAs, high-passes),
//     output 2 Vp-p un-accented / 6 Vp-p fully accented.
//   · Baratatronix, "Roland 606 Cymbal and Hi-hat Synthesis" — the six
//     Schmitt oscillators (245, 309, 368, 417, 439, 625 Hz), band-passes at
//     3440 / 7100 Hz, the open hat's decay following the tempo, closed hat
//     cutting the open hat.
//   · Robin Whittle, "Modifications for the TR-606" — snare twin-T excited
//     by a +5 V trigger rising to ~+14 V on accents; the toms' low-passed
//     noise "rumble"; the classic snare/decay mods.
//  No per-voice frequency chart was published for BD/SD/toms; those are
//  set by ear against the architecture above and stated in the README.
// =====================================================================

const V606: f32 = 5.0 / 14.0;          // un-accented trigger (≈5 V of 14)
@inline function accent606(acc: f32): f32 { return (5.0 + 9.0 * clampf(acc, 0.0, 1.0)) / 14.0; }
@inline function stage606(h: f32): f32 { return h / (1.0 + 0.06 * h) * 1.0214; }

function velToHeight606(vel: f32, accKnob: f32, dynamic: bool): f32 {
  const acc = accent606(accKnob);
  if (!dynamic) return vel >= 0.787 ? acc : V606;
  if (vel < 0.8) return V606 * (0.3 + 0.7 * vel / 0.8);
  return lerpf(V606, acc, (vel - 0.8) / 0.2);
}

// Twin-T oscillator: a decaying sine from a trigger pulse, with a touch of
// amplitude-dependent pitch like its bigger sibling.
class TwinT {
  res: Svf = new Svf(); t: i32 = -1; h: f32 = 0; fol: Follower = new Follower();
  init(): void { this.res.reset(); this.fol.setRelease(0.04); this.fol.v = 0; this.t = -1; }
  fire(h: f32): void { this.t = 0; this.h = h; }
  tick(f: f32, q: f32, lift: f32): f32 {
    let x: f32 = 0;
    if (this.t >= 0) { x = this.t < msToSamples(0.8) ? this.h : 0.0; this.t++; if (this.t > msToSamples(3.0)) this.t = -1; }
    const rel = this.fol.v / 0.25;
    this.res.set(f * (1.0 + lift * rel / (1.0 + 0.5 * rel)), q);
    this.res.tick(x);
    this.fol.tick(this.res.bp);
    return this.res.bp;
  }
}

// BASS DRUM — short and punchy with a clicky edge. Mods: decay, tune.
class BD606 {
  level: f32 = 0.8; decay: f32 = -1.0; tune: f32 = 0.0;    // decay < 0 = stock
  tt: TwinT = new TwinT(); lp: OnePole = new OnePole(); dc: OnePole = new OnePole(); click: f32 = 0; active: bool = false; q: i32 = 0;
  init(): void { this.tt.init(); this.lp.reset(); this.lp.set(2600.0); this.dc.reset(); this.dc.set(20.0); this.active = false; this.click = 0; this.q = 0; }
  trigger(h: f32): void { h = stage606(h); this.tt.fire(h); this.click = h; this.active = true; this.q = 0; }
  tick(): f32 {
    if (!this.active) return 0.0;
    const f: f32 = 64.0 * Mathf.pow(2.0, this.tune / 12.0);
    const tau: f32 = this.decay < 0.0 ? 0.075 : 0.025 * Mathf.pow(12.0, this.decay);
    const body = this.tt.tick(f, PI * f * tau, 0.12) * 5.4;
    const c = this.lp.lp(this.click * white() * 0.25 + this.click * 0.5) * 0.7;
    this.click *= decayCoef(0.0025);
    const y = this.dc.hp(body + c) * taper(this.level);
    if (Mathf.abs(y) < 0.00003 && this.tt.t < 0) { if (++this.q > 1200) { this.active = false; this.tt.init(); } } else this.q = 0;
    return y;
  }
}

// SNARE — a twin-T and noise through a high-pass with its own envelope.
// Mods: tune (the classic mod lowers it), snappy.
class SD606 {
  level: f32 = 0.8; tune: f32 = 0.0; snappy: f32 = -1.0;
  tt: TwinT = new TwinT(); hp: Svf = new Svf(); n: f32 = 0; nc: f32 = 0.99; active: bool = false; q: i32 = 0;
  init(): void { this.tt.init(); this.hp.reset(); this.hp.set(2200.0, 0.8); this.nc = decayCoef(0.045); this.n = 0; this.active = false; this.q = 0; }
  trigger(h: f32): void { h = stage606(h); this.tt.fire(h); this.n = h; this.active = true; this.q = 0; }
  tick(): f32 {
    if (!this.active) return 0.0;
    const f: f32 = 285.0 * Mathf.pow(2.0, this.tune / 12.0);
    const drum = this.tt.tick(f, PI * f * 0.028, 0.06) * 1.25;
    this.hp.tick(white());
    const snap: f32 = this.snappy < 0.0 ? 0.62 : this.snappy;
    const y = (drum + this.hp.hp * this.n * 0.85 * snap) * 1.1 * taper(this.level);
    this.n *= this.nc;
    if (this.n < 0.0001 && Mathf.abs(y) < 0.00003 && this.tt.t < 0) { if (++this.q > 600) { this.active = false; this.tt.init(); } } else this.q = 0;
    return y;
  }
}

// TOMS — a twin-T each plus a short burst of low-passed noise "rumble".
class Tom606 {
  level: f32 = 0.8; base: f32 = 140.0; tune: f32 = 0.0; decay: f32 = -1.0;
  tt: TwinT = new TwinT(); lp: Svf = new Svf(); n: f32 = 0; active: bool = false; q: i32 = 0;
  init(): void { this.tt.init(); this.lp.reset(); this.lp.set(700.0, 0.6); this.n = 0; this.active = false; this.q = 0; }
  trigger(h: f32): void { h = stage606(h); this.tt.fire(h); this.n = h; this.active = true; this.q = 0; }
  tick(): f32 {
    if (!this.active) return 0.0;
    const f = this.base * Mathf.pow(2.0, this.tune / 12.0);
    const tau: f32 = this.decay < 0.0 ? 0.07 : 0.03 * Mathf.pow(10.0, this.decay);
    const body = this.tt.tick(f, PI * f * tau, 0.1) * (2.2 * 140.0 / this.base + 0.6);
    this.lp.tick(white());
    const y = (body + this.lp.lp * this.n * 0.35) * taper(this.level);
    this.n *= decayCoef(0.012);
    if (Mathf.abs(y) < 0.00003 && this.tt.t < 0) { if (++this.q > 1200) { this.active = false; this.tt.init(); } } else this.q = 0;
    return y;
  }
}

// The six Schmitt oscillators, band-passed at 3440 / 7100 Hz.
class Metal606 {
  o: StaticArray<Square> = new StaticArray<Square>(6);
  lo: Svf = new Svf(); hi: Svf = new Svf(); loOut: f32 = 0; hiOut: f32 = 0;
  init(): void {
    const hz: StaticArray<f32> = [245.1, 308.6, 367.6, 416.6, 438.5, 625.0];
    for (let i = 0; i < 6; i++) { const s = new Square(); s.setHz(hz[i]); s.ph = f32(i) * 0.173; this.o[i] = s; }
    this.lo.reset(); this.hi.reset(); this.lo.set(3440.0, 2.2); this.hi.set(7100.0, 2.2);
  }
  tick(): void {
    let m: f32 = 0;
    for (let i = 0; i < 6; i++) m += unchecked(this.o[i]).tick();
    m *= 0.1667;
    this.lo.tick(m); this.hi.tick(m);
    this.loOut = this.lo.bp * this.lo.k; this.hiOut = this.hi.bp * this.hi.k;
  }
  skip(n: i32): void { for (let i = 0; i < 6; i++) unchecked(this.o[i]).skip(n); }
}

// CYMBAL (both bands, two VCAs on one envelope, two high-passes) and the
// HATS (upper band, resonant high-pass up in the 10 kHz region). The open
// hat has no decay knob: its length follows the tempo. A closed hat cuts it.
class Metals606 {
  cyLevel: f32 = 0.8; hhLevel: f32 = 0.8; cyDecay: f32 = -1.0; ohDecay: f32 = -1.0; stepSec: f32 = 0.125;
  cyHpA: Svf = new Svf(); cyHpB: Svf = new Svf(); ohHp: Svf = new Svf(); chHp: Svf = new Svf();
  cy: f32 = 0; oh: f32 = 0; ch: f32 = 0; cyC: f32 = 0.999; ohC: f32 = 0.999; choke: bool = false;
  cyOut: f32 = 0; ohOut: f32 = 0; chOut: f32 = 0;
  init(): void {
    this.cyHpA.reset(); this.cyHpB.reset(); this.ohHp.reset(); this.chHp.reset();
    this.cyHpA.set(5200.0, 1.1); this.cyHpB.set(2400.0, 0.7); this.ohHp.set(9500.0, 1.4); this.chHp.set(10500.0, 1.4);
    this.cy = 0; this.oh = 0; this.ch = 0; this.choke = false; this.cyOut = 0; this.ohOut = 0; this.chOut = 0;
  }
  any(): bool { return this.cy > 0.00003 || this.oh > 0.00003 || this.ch > 0.00003; }
  cyTrigger(h: f32): void { this.cy = stage606(h); this.cyC = decayCoef(this.cyDecay < 0.0 ? 0.32 : 0.08 * Mathf.pow(12.0, this.cyDecay)); }
  ohTrigger(h: f32): void {
    this.oh = stage606(h); this.choke = false;
    // stock: the envelope length is tied to the step clock (≈ two steps)
    this.ohC = decayCoef(this.ohDecay < 0.0 ? clampf(this.stepSec * 0.85, 0.03, 0.5) : 0.03 * Mathf.pow(15.0, this.ohDecay));
  }
  chTrigger(h: f32): void { this.ch = stage606(h); if (this.oh > 0.00003) this.choke = true; }
  tick(m: Metal606): void {
    this.cyOut = 0; this.ohOut = 0; this.chOut = 0;
    if (this.cy > 0.00003) {
      this.cyHpA.tick(swingVca(m.hiOut, this.cy)); this.cyHpB.tick(swingVca(m.loOut, this.cy));
      this.cyOut = (this.cyHpA.hp * 1.1 + this.cyHpB.hp * 0.9) * 12.0 * taper(this.cyLevel);
      this.cy *= this.cyC;
    }
    if (this.oh > 0.00003) {
      this.ohHp.tick(swingVca(m.hiOut, this.oh));
      this.ohOut = this.ohHp.hp * 24.0 * taper(this.hhLevel);
      this.oh *= this.choke ? decayCoef(0.004) : this.ohC;
    }
    if (this.ch > 0.00003) {
      this.chHp.tick(swingVca(m.hiOut, this.ch));
      this.chOut = this.chHp.hp * 30.0 * taper(this.hhLevel);
      this.ch *= decayCoef(0.016);
    }
  }
}
