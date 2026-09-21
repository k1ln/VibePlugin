// =====================================================================
//  drums/tr808/voices.ts — the sixteen sounds of a 1980 rhythm composer,
//  modelled circuit-block by circuit-block.
//
//  Sources (read in full):
//   · TR-808 Operation Manual — controls per voice, accent, pre-scale.
//   · TR-808 Service Notes (Jun. 15 1981) — circuit descriptions and the
//     "typical and variable" adjustment chart: amplitude normal/accent,
//     frequency low/mid/high, decay short/mid/long for every voice.
//   · Werner, Abel & Smith, "A Physically-Informed, Circuit-Bendable,
//     Digital Model of the Roland TR-808 Bass Drum Circuit", DAFx-14 —
//     pulse shaper, attack frequency shift, retrigger pulse, pitch sigh.
//
//  Every voice is excited by the 808's 1 ms common trigger, whose height
//  carries the accent (≈4 V normal, 5–15 V accented via the ACCENT knob).
//  Amplitudes below are in "fractions of 15 V" so the circuits' amplitude-
//  dependent behaviour (bass-drum sigh, tom/conga pitch drop) follows accent
//  the way it does on the hardware. Re-triggering a sounding voice adds
//  energy to the ringing filter rather than restarting it (no "machine gun").
// =====================================================================

const V_NORMAL: f32 = 4.0 / 15.0;           // un-accented trigger height

// Output gains, calibrated so an un-accented hit at full LEVEL matches the
// chart's peak-to-peak voltages relative to each other (0.07 per Vpp).
const BD_GAIN: f32 = 3.8;
const SD_GAIN: f32 = 0.95;
const CL_GAIN: f32 = 0.84;
const RS_DRIVE: f32 = 1.0;
const RS_GAIN: f32 = 1.4;

// Trigger height for accent knob position `acc` (0..1): VR3 sets 5..15 V.
@inline function accentHeight(acc: f32): f32 { return (5.0 + 10.0 * clampf(acc, 0.0, 1.0)) / 15.0; }

// MIDI velocity → trigger height. Hardware mode: two heights, like the
// 808's accent (velocity ≥ 100 is accented). Dynamic mode: soft notes are
// softer, the top of the range rises to the accent height.
function velToHeight(vel: f32, accentKnob: f32, dynamic: bool): f32 {
  const acc = accentHeight(accentKnob);
  if (!dynamic) return vel >= 0.787 ? acc : V_NORMAL;
  if (vel < 0.8) return V_NORMAL * (0.3 + 0.7 * vel / 0.8);
  return lerpf(V_NORMAL, acc, (vel - 0.8) / 0.2);
}

// The trigger/VCA stages flatten tall pulses: the chart's accented voices
// are ~2.9× the normal ones, not the 3.75× ratio of the trigger voltages.
// Normalised so an un-accented height passes unchanged.
@inline function stageHeight(h: f32): f32 { return h / (1.0 + 0.35 * h) * 1.0934; }

// ---------------------------------------------------------------------
//  Pulse shaper shared by the bridged-T voices: the 1 ms trigger passes a
//  nonlinear low-shelf (edges through, plateau settles to ~40 %), and the
//  falling edge's negative swing is caught by a diode (≈0.71 V of 15 V).
// ---------------------------------------------------------------------
class PulseShaper {
  t: i32 = -1; len: i32 = 48; h: f32 = 0; hp: OnePole = new OnePole();
  init(): void { this.len = msToSamples(1.0); this.hp.set(520.0); this.hp.reset(); this.t = -1; this.h = 0; }
  fire(height: f32): void { this.t = 0; this.h = height; }
  active(): bool { return this.t >= 0; }
  tick(): f32 {
    if (this.t < 0) return 0.0;
    const raw: f32 = this.t < this.len ? this.h : 0.0;
    const edge = this.hp.hp(raw);
    let y: f32 = raw * 0.4 + edge * 0.6;
    y = diodeClamp(y, 0.047);
    this.t++;
    if (this.t > this.len * 6) this.t = -1;
    return y;
  }
}

// ---------------------------------------------------------------------
//  BASS DRUM — bridged-T band-pass in feedback (decay = feedback amount,
//  VR6). For the first 4 ms after a trigger Q43 shorts R165, halving the
//  network's time constant: it rings at twice its frequency ("punchier,
//  crisp"), then a retrigger pulse from C39/R161 kicks it at its inherent
//  56 Hz. Leakage through R161 at large amplitude pulls the frequency up,
//  so the note "sighs" down as it decays — more so when accented.
//  Chart: 3.5 Vpp normal / 10 Vpp accent, 56 Hz, decay 50 / 300 / 800 ms.
// ---------------------------------------------------------------------
class BD808 {
  level: f32 = 0.8; tone: f32 = 0.5; decay: f32 = 0.5; tune: f32 = 0.0;  // tune: semitones (service trimmer)
  sigh: f32 = 1.0;                  // 1 = stock circuit (808 Bass exposes it)
  // Hooks for Bridgewell Bass (stock machine leaves them at their defaults):
  freqHz: f32 = 0.0;                // > 0: ring at this pitch instead of 56 Hz · tune
  tauOverride: f32 = 0.0;           // > 0: decay time constant in seconds
  click: f32 = 0.35;                // beater click fed ahead of the tone filter
  bodyGain: f32 = 1.0;              // level compensation when played chromatically
  gate: f32 = 1.0; gateTarget: f32 = 1.0; gateCoef: f32 = 0.0;   // note-off release
  shaper: PulseShaper = new PulseShaper();
  res: Svf = new Svf();
  toneLp: OnePole = new OnePole();
  dcHp: OnePole = new OnePole();
  fol: Follower = new Follower();
  since: i32 = 1 << 30; h: f32 = 0; retrig: i32 = -1;
  active: bool = false; quiet: i32 = 0;
  out: f32 = 0;

  init(): void {
    this.shaper.init(); this.res.reset(); this.toneLp.reset(); this.dcHp.reset();
    this.dcHp.set(18.0); this.fol.setRelease(0.06); this.fol.v = 0; this.active = false;
    this.since = 1 << 30; this.retrig = -1; this.quiet = 0; this.gate = 1.0; this.gateTarget = 1.0; this.gateCoef = 0.0;
  }
  trigger(height: f32): void {
    height = stageHeight(height);
    this.shaper.fire(height); this.h = height; this.since = 0; this.retrig = -1;
    this.active = true; this.quiet = 0; this.gate = 1.0; this.gateTarget = 1.0;
  }
  // Decay knob → the ringing time constant, fitted to the chart's
  // short/mid/long (50/300/800 ms) at the knob's ends and centre.
  release(sec: f32): void { this.gateTarget = 0.0; this.gateCoef = 1.0 - decayCoef(sec < 0.002 ? 0.002 : sec); }
  tau(): f32 { if (this.tauOverride > 0.0) return this.tauOverride; return chartTau(58.0) * Mathf.pow(16.0, Mathf.pow(clampf(this.decay, 0.0, 1.0), 0.72)); }

  tick(): f32 {
    if (!this.active) { this.out = 0; return 0.0; }
    const f0: f32 = this.freqHz > 0.0 ? this.freqHz : 56.0 * Mathf.pow(2.0, this.tune / 12.0);
    let x = this.shaper.tick();
    const att = msToSamples(4.0);
    // Retrigger pulse as Q42 turns back on at 4 ms (shaped like a short pulse).
    if (this.since == att) this.retrig = 0;
    if (this.retrig >= 0) {
      const rl = msToSamples(0.6);
      x += 0.55 * this.h * (1.0 - f32(this.retrig) / f32(rl));
      this.retrig++; if (this.retrig >= rl) this.retrig = -1;
    }
    const env = this.fol.v;
    const rel = env / 0.30;                       // ≈1 on an un-accented hit
    const sighK: f32 = 0.16 * this.sigh * (1.35 * rel / (1.0 + 0.35 * rel));
    let f = f0 * (1.0 + sighK);
    let q = PI * f0 * this.tau();
    if (this.since < att) { f *= 2.0; q *= 0.5; }  // halved time constant
    this.res.set(f, q);
    this.res.tick(x);
    const body = this.res.bp * BD_GAIN * this.bodyGain;            // raw band-pass: ring height set by the pulse, not by Q
    this.fol.tick(body);
    // Beater click: some trigger feeds the output ahead of the passive tone LPF.
    const mixed = body + x * this.click;
    this.toneLp.set(180.0 * Mathf.pow(24.0, this.tone));
    this.gate += (this.gateTarget - this.gate) * this.gateCoef;
    const y = this.dcHp.hp(this.toneLp.lp(mixed)) * taper(this.level) * this.gate;
    this.since++;
    this.out = y;
    if ((Mathf.abs(y) < 0.00003 || this.gate < 0.0005) && !this.shaper.active() && this.since > att) {
      if (++this.quiet > 2400) { this.active = false; this.res.reset(); }
    } else this.quiet = 0;
    return y;
  }
}

// ---------------------------------------------------------------------
//  SNARE DRUM — two bridged-T networks (fundamental and a harmonic, 238 /
//  476 Hz); TONE (VR8) sets their output ratio. SNAPPY (VR9) is the height
//  of a separate envelope gating white noise through a high-pass.
// ---------------------------------------------------------------------
class SD808 {
  level: f32 = 0.8; tone: f32 = 0.5; snappy: f32 = 0.5; tune: f32 = 0.0;
  sh: PulseShaper = new PulseShaper();
  r1: Svf = new Svf(); r2: Svf = new Svf();
  nHp: Svf = new Svf(); nLp: OnePole = new OnePole();
  nEnv: f32 = 0; nCoef: f32 = 0.999;
  active: bool = false; quiet: i32 = 0; h: f32 = 0;

  init(): void {
    this.sh.init(); this.r1.reset(); this.r2.reset(); this.nHp.reset(); this.nLp.reset();
    this.nHp.set(1650.0, 0.8); this.nLp.set(9000.0); this.nCoef = decayCoef(0.062);
    this.nEnv = 0; this.active = false; this.quiet = 0;
  }
  trigger(height: f32): void {
    height = stageHeight(height);
    this.sh.fire(height); this.h = height; this.nEnv = height * 1.9; this.active = true; this.quiet = 0;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const tr = Mathf.pow(2.0, this.tune / 12.0);
    const x = this.sh.tick();
    this.r1.set(238.0 * tr, PI * 238.0 * tr * chartTau(90.0)); this.r1.tick(x);
    this.r2.set(476.0 * tr, PI * 476.0 * tr * chartTau(55.0)); this.r2.tick(x);
    const t = clampf(this.tone, 0.0, 1.0);
    const drum = (this.r1.bp * (1.05 - 0.55 * t) + this.r2.bp * (0.25 + 0.95 * t)) * SD_GAIN;
    this.nHp.tick(white());
    const noise = this.nLp.lp(this.nHp.hp) * this.nEnv * taper(this.snappy) * 0.8;
    this.nEnv *= this.nCoef;
    const y = (drum + noise) * taper(this.level);
    if (Mathf.abs(y) < 0.00003 && !this.sh.active() && this.nEnv < 0.0001) {
      if (++this.quiet > 1200) { this.active = false; this.r1.reset(); this.r2.reset(); }
    } else this.quiet = 0;
    return y;
  }
}

// ---------------------------------------------------------------------
//  TOMS / CONGAS — one bridged-T each. Diodes D80/D81 conduct while the
//  ringing is large, shortening the time constant: the pitch starts high and
//  falls as the note dies. The toms add pink noise with a slightly longer
//  decay ("artificial reverberation"); congas are the same network retuned.
//  Chart frequencies (low / mid / high tuning) and mid-position decays.
// ---------------------------------------------------------------------
class Tom808 {
  level: f32 = 0.8; tuning: f32 = 0.5;
  fLo: f32 = 80; fHi: f32 = 100; decayMs: f32 = 200; isConga: bool = false; noiseAmt: f32 = 0.06; gain: f32 = 1;
  sh: PulseShaper = new PulseShaper();
  res: Svf = new Svf(); fol: Follower = new Follower();
  pink: Pink = new Pink(); nLp: Svf = new Svf(); nEnv: f32 = 0; nCoef: f32 = 0.999;
  active: bool = false; quiet: i32 = 0;

  configure(fLo: f32, fHi: f32, decayMs: f32, conga: bool, gain: f32): void {
    this.fLo = fLo; this.fHi = fHi; this.decayMs = decayMs; this.isConga = conga; this.gain = gain;
  }
  init(): void {
    this.sh.init(); this.res.reset(); this.fol.setRelease(0.05); this.nLp.reset(); this.nLp.set(650.0, 0.55);
    this.nCoef = decayCoef(chartTau(this.decayMs) * 1.35);
    this.fol.v = 0; this.nEnv = 0; this.active = false; this.quiet = 0;
  }
  trigger(height: f32): void {
    height = stageHeight(height);
    this.sh.fire(height); this.nEnv = this.isConga ? 0.0 : height; this.active = true; this.quiet = 0;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const x = this.sh.tick();
    // The chart's figures are read while the drum rings; the diode lift is
    // still ~5 % there, so the resting frequency sits that much lower.
    const base = this.fLo * 0.95 * Mathf.pow(this.fHi / this.fLo, clampf(this.tuning, 0.0, 1.0));
    const rel = this.fol.v / 0.25;
    const f = base * (1.0 + 0.14 * (rel / (1.0 + 0.4 * rel)));
    this.res.set(f, PI * base * chartTau(this.decayMs));
    this.res.tick(x);
    const body = this.res.bp * this.gain;
    this.fol.tick(body);
    let y = body;
    if (!this.isConga) {
      this.nLp.tick(this.pink.tick(white()));
      y += this.nLp.bp * this.nEnv * this.noiseAmt * 3.0;   // mid-band only: air, not rumble
      this.nEnv *= this.nCoef;
    }
    y *= taper(this.level);
    if (Mathf.abs(y) < 0.00003 && !this.sh.active()) {
      if (++this.quiet > 1200) { this.active = false; this.res.reset(); }
    } else this.quiet = 0;
    return y;
  }
}

// ---------------------------------------------------------------------
//  RIM SHOT / CLAVES. Claves: a high-Q bridged-T at 2.5 kHz, 25 ms.
//  Rim shot: two networks (455 Hz and the 1667 Hz of the chart) through
//  Q62, a swing-type VCA on a 10 ms envelope — the gritty edge comes from
//  that VCA, then a high-pass takes out the thud.
// ---------------------------------------------------------------------
class RimClave808 {
  level: f32 = 0.8; clave: bool = false;
  sh: PulseShaper = new PulseShaper();
  rA: Svf = new Svf(); rB: Svf = new Svf(); hp: Svf = new Svf();
  env: f32 = 0; coef: f32 = 0.99; active: bool = false; quiet: i32 = 0; isClave: bool = false;
  init(): void { this.sh.init(); this.rA.reset(); this.rB.reset(); this.hp.reset(); this.hp.set(260.0, 0.7); this.env = 0; this.active = false; this.quiet = 0; }
  trigger(height: f32, clave: bool): void {
    height = stageHeight(height);
    this.isClave = clave; this.sh.fire(height); this.env = 1.0;
    this.coef = decayCoef(clave ? chartTau(25.0) : chartTau(10.0));
    this.active = true; this.quiet = 0;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const x = this.sh.tick();
    let y: f32 = 0;
    if (this.isClave) {
      this.rA.set(2500.0, PI * 2500.0 * chartTau(25.0)); this.rA.tick(x);
      y = this.rA.bp * CL_GAIN;
    } else {
      this.rA.set(455.0, 8.0); this.rA.tick(x);
      this.rB.set(1667.0, 12.0); this.rB.tick(x);
      const src = (this.rA.bp + this.rB.bp * 0.9) * RS_DRIVE;
      this.hp.tick(swingVca(src, this.env));
      y = this.hp.hp * RS_GAIN;
      this.env *= this.coef;
    }
    y *= taper(this.level);
    if (Mathf.abs(y) < 0.00003 && !this.sh.active()) {
      if (++this.quiet > 600) { this.active = false; this.rA.reset(); this.rB.reset(); this.hp.reset(); }
    } else this.quiet = 0;
    return y;
  }
}

// ---------------------------------------------------------------------
//  HAND CLAP / MARACAS. Clap: white noise through a band-pass (IC21) feeds
//  two VCAs — IC22's sawtooth envelope, re-fired by the comparator IC23 so
//  it slaps three times before the fourth ramp is left to fall (the clap
//  itself), and Q70's slower envelope (the "reverberation"). Maracas: noise
//  gated by Q65 through a high-pass (Q68), 25–35 ms.
// ---------------------------------------------------------------------
class ClapMaracas808 {
  level: f32 = 0.8;
  bp: Svf = new Svf(); maHp: Svf = new Svf();
  t: i32 = -1; h: f32 = 0; maracas: bool = false;
  saw: f32 = 0; tail: f32 = 0; sawCoef: f32 = 0.99; tailCoef: f32 = 0.999; maCoef: f32 = 0.99;
  active: bool = false;
  init(): void {
    this.bp.reset(); this.bp.set(1000.0, 1.6); this.maHp.reset(); this.maHp.set(5200.0, 0.9);
    this.sawCoef = decayCoef(0.0032); this.tailCoef = decayCoef(chartTau(100.0)); this.maCoef = decayCoef(chartTau(30.0));
    this.t = -1; this.saw = 0; this.tail = 0; this.active = false;
  }
  trigger(height: f32, ma: bool): void {
    height = stageHeight(height);
    this.maracas = ma; this.t = 0; this.h = height; this.active = true;
    this.saw = 0; this.tail = ma ? height : 0.0;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const n = white();
    let y: f32 = 0;
    if (this.maracas) {
      this.maHp.tick(n);
      y = this.maHp.hp * this.tail * 1.25;
      this.tail *= this.maCoef;
      if (this.tail < 0.00005) this.active = false;
    } else {
      // Sawtooth re-fired every ~10 ms: slaps at 0, 10, 20 ms; the 4th ramp
      // at ~30 ms is the clap and is left to decay with the long tail.
      const period = msToSamples(10.0);
      if (this.t == 0 || this.t == period || this.t == period * 2 || this.t == period * 3) this.saw = this.h;
      if (this.t == period * 3) this.tail = this.h * 0.8;
      this.bp.tick(n);
      const src = this.bp.bp * this.bp.k;
      y = src * (this.saw * 2.6 + this.tail * 1.25) * 2.5;
      this.saw *= this.sawCoef;
      this.tail *= this.tailCoef;
      this.t++;
      if (this.t > period * 4 && this.tail < 0.00005 && this.saw < 0.00005) this.active = false;
    }
    return y * taper(this.level);
  }
}

// ---------------------------------------------------------------------
//  The six Schmitt-trigger square oscillators shared by cowbell, cymbal and
//  both hi-hats. They run all the time, so every hit meets them in a
//  different phase relationship — part of why no two 808 hats are alike.
// ---------------------------------------------------------------------
class Metal808 {
  o: StaticArray<Square> = new StaticArray<Square>(6);
  init(): void {
    const hz: StaticArray<f32> = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
    for (let i = 0; i < 6; i++) { const s = new Square(); s.setHz(hz[i]); s.ph = f32(i) * 0.137; this.o[i] = s; }
  }
  // Last computed values, so the cowbell can reuse its two oscillators.
  c540: f32 = 0; c800: f32 = 0;
  tick(): f32 {
    let sum: f32 = 0;
    for (let i = 0; i < 6; i++) {
      const v = unchecked(this.o[i]).tick();
      sum += v;
      if (i == 4) this.c540 = v; else if (i == 5) this.c800 = v;
    }
    return sum * 0.1667;
  }
  skip(n: i32): void { for (let i = 0; i < 6; i++) unchecked(this.o[i]).skip(n); }
}

// COWBELL — the 540 and 800 Hz squares through their own gates, mixed into a
// band-pass (IC2). The envelope drops abruptly at the trigger's trailing edge
// and then rings on (R82/C34 across C9). Chart: 50 ms.
class Cowbell808 {
  level: f32 = 0.8;
  bp: Svf = new Svf(); hp: OnePole = new OnePole();
  fast: f32 = 0; slow: f32 = 0; fc: f32 = 0.9; sc: f32 = 0.99; active: bool = false;
  init(): void { this.bp.reset(); this.bp.set(2640.0, 1.4); this.hp.reset(); this.hp.set(420.0); this.fc = decayCoef(0.0025); this.sc = decayCoef(chartTau(50.0) * 1.4); this.fast = 0; this.slow = 0; this.active = false; }
  trigger(height: f32): void { height = stageHeight(height); this.fast = height * 0.62; this.slow = height * 0.38; this.active = true; }
  tick(m: Metal808): f32 {
    if (!this.active) return 0.0;
    const src = m.c540 * 0.9 + m.c800;
    this.bp.tick(src);
    const tone = this.hp.hp(this.bp.bp * this.bp.k + src * 0.35);
    const y = tone * (this.fast + this.slow) * 1.18 * taper(this.level);
    this.fast *= this.fc; this.slow *= this.sc;
    if (this.fast + this.slow < 0.00004) this.active = false;
    return y;
  }
}

// CYMBAL / OPEN HAT / CLOSED HAT — the six squares split into a low band
// (3.44 kHz) and a high band (7.1 kHz). Cymbal: the high band splits again —
// its top (Q16) dies fast, the next range down (Q17) follows DECAY — and
// TONE (VR4) sets the ratio of those three. Hats: the high band only, each
// through its own swing-type VCA and high-pass; a closed hat cuts an open
// hat's decay short (Q23). Chart: CY 350/800/1200, OH 90/450/600, CH 50 ms.
class Hats808 {
  cyLevel: f32 = 0.8; cyTone: f32 = 0.5; cyDecay: f32 = 0.5;
  ohLevel: f32 = 0.8; ohDecay: f32 = 0.5; chLevel: f32 = 0.8;
  lowBand: Svf = new Svf(); highBand: Svf = new Svf();
  topHp: Svf = new Svf(); cyHp: Svf = new Svf(); ohHp: Svf = new Svf(); chHp: Svf = new Svf();
  cyTop: f32 = 0; cyMid: f32 = 0; cyLow: f32 = 0; oh: f32 = 0; ch: f32 = 0;
  topC: f32 = 0.99; midC: f32 = 0.999; lowC: f32 = 0.999; ohC: f32 = 0.999; chC: f32 = 0.99; chokeC: f32 = 0.9;
  choking: bool = false;
  cyActive: bool = false; ohActive: bool = false; chActive: bool = false;
  cyOut: f32 = 0; ohOut: f32 = 0; chOut: f32 = 0;

  init(): void {
    this.lowBand.reset(); this.highBand.reset(); this.topHp.reset(); this.cyHp.reset(); this.ohHp.reset(); this.chHp.reset();
    this.lowBand.set(3440.0, 2.2); this.highBand.set(7100.0, 2.2);
    this.topHp.set(9500.0, 0.7); this.cyHp.set(3000.0, 0.7);
    this.ohHp.set(6200.0, 0.8); this.chHp.set(6800.0, 0.8);
    this.topC = decayCoef(0.028); this.chC = decayCoef(chartTau(50.0)); this.chokeC = decayCoef(0.004);
    this.cyTop = 0; this.cyMid = 0; this.cyLow = 0; this.oh = 0; this.ch = 0; this.choking = false;
    this.cyActive = false; this.ohActive = false; this.chActive = false; this.cyOut = 0; this.ohOut = 0; this.chOut = 0;
  }
  cyTrigger(h: f32): void {
    h = stageHeight(h);
    const tau = chartTau(350.0) * Mathf.pow(1200.0 / 350.0, Mathf.pow(clampf(this.cyDecay, 0.0, 1.0), 0.576));
    this.midC = decayCoef(tau); this.lowC = decayCoef(tau * 0.85);
    this.cyTop = h; this.cyMid = h; this.cyLow = h; this.cyActive = true;
  }
  ohTrigger(h: f32): void {
    h = stageHeight(h);
    this.ohC = decayCoef(chartTau(90.0) * Mathf.pow(600.0 / 90.0, Mathf.pow(clampf(this.ohDecay, 0.0, 1.0), 0.238)));
    this.oh = h; this.choking = false; this.ohActive = true;
  }
  chTrigger(h: f32): void {
    h = stageHeight(h);
    this.ch = h; this.chActive = true;
    if (this.ohActive) this.choking = true;      // Q23: CH ends the OH decay
  }
  any(): bool { return this.cyActive || this.ohActive || this.chActive; }

  tick(metal: f32): void {
    this.cyOut = 0; this.ohOut = 0; this.chOut = 0;
    this.lowBand.tick(metal); this.highBand.tick(metal);
    const lo = this.lowBand.bp * this.lowBand.k;
    const hi = this.highBand.bp * this.highBand.k;
    if (this.cyActive) {
      this.topHp.tick(hi);
      const t = clampf(this.cyTone, 0.0, 1.0);
      const s = swingVca(this.topHp.hp, this.cyTop) * (0.35 + 0.9 * t)
              + swingVca(hi, this.cyMid) * (0.45 + 0.4 * t)
              + swingVca(lo, this.cyLow) * (1.05 - 0.85 * t);
      this.cyHp.tick(s);
      this.cyOut = this.cyHp.hp * 10.0 * taper(this.cyLevel);
      this.cyTop *= this.topC; this.cyMid *= this.midC; this.cyLow *= this.lowC;
      if (this.cyMid < 0.00004 && this.cyTop < 0.00004) this.cyActive = false;
    }
    if (this.ohActive) {
      this.ohHp.tick(swingVca(hi, this.oh));
      this.ohOut = this.ohHp.hp * 11.8 * taper(this.ohLevel);
      this.oh *= this.choking ? this.chokeC : this.ohC;
      if (this.oh < 0.00004) { this.ohActive = false; this.choking = false; }
    }
    if (this.chActive) {
      this.chHp.tick(swingVca(hi, this.ch));
      this.chOut = this.chHp.hp * 12.0 * taper(this.chLevel);
      this.ch *= this.chC;
      if (this.ch < 0.00004) this.chActive = false;
    }
  }
}

// Chart frequencies (low…high tuning), mid decays and level calibration for
// the six drums on the three tom/conga slots.
function configureToms(lt: Tom808, mt: Tom808, ht: Tom808, lc: Tom808, mc: Tom808, hc: Tom808): void {
  lt.configure(80.0, 100.0, 200.0, false, 3.6);
  mt.configure(120.0, 160.0, 130.0, false, 2.2);
  ht.configure(165.0, 220.0, 100.0, false, 2.1);
  lc.configure(165.0, 220.0, 180.0, true, 2.6);
  mc.configure(250.0, 310.0, 100.0, true, 1.55);
  hc.configure(370.0, 455.0, 80.0, true, 1.2);
}
