// =====================================================================
//  drums/tr909/voices.ts — a 1983 hybrid rhythm composer: analog drums,
//  6-bit PCM cymbals.
//
//  Sources (read in full):
//   · TR-909 Owner's Manual — controls per instrument, total accent vs
//     per-instrument accent, flam, shuffle, scales, last step, MIDI map.
//   · TR-909 Service Notes — voice circuits: the snare's VCO-1/VCO-2
//     (triangle, reset together on the trigger, pitch bent for ~20 ms,
//     separate VCAs), SNAPPY (noise high-passed and low-passed, recombined,
//     ENV5 from the accent), the shared 32-stage shift-register noise, and
//     the digital voices: hats/crash/ride read out of PCM ROM at ~30 kHz,
//     open and closed hi-hat being ONE sample (closed stops the address
//     counter at 0x2000, open at 0x6000), decays restored by analog VCAs
//     (hats) or from the ROM address through an anti-log stage (crash/ride).
//   · Sound On Sound, "Synth Secrets" — bass drum as a sawtooth VCO with a
//     pitch contour through a waveshaper to a near-sine, plus a separate
//     noise + pulse click path (the ATTACK knob).
//
//  The ROM data here is NOT Roland's: the three cymbal "ROMs" are
//  synthesised at load time (inharmonic metal + noise, dynamics flattened
//  as the service notes describe), then quantised to 6 bits and played back
//  through the same zero-order-hold, fixed-clock path, so the grain,
//  aliasing and tuning behaviour follow the hardware's architecture.
// =====================================================================

const N909: f32 = 0.42;                 // normal hit height
const LOCAL_ACC: f32 = 0.24;            // per-instrument accent (fixed intensity)
@inline function totalAccentAdd(knob: f32): f32 { return 0.45 * clampf(knob, 0.0, 1.0); }

// MIDI velocity → height (same two modes as the 808 family).
function velToHeight909(vel: f32, totalAcc: f32, dynamic: bool): f32 {
  const acc = N909 + LOCAL_ACC + totalAccentAdd(totalAcc);
  if (!dynamic) return vel >= 0.787 ? acc : N909;
  if (vel < 0.8) return N909 * (0.3 + 0.7 * vel / 0.8);
  return lerpf(N909, acc, (vel - 0.8) / 0.2);
}

// The shared noise generator: 32-stage shift register clocked fast (service
// notes). An LFSR at audio rate, so it has the digital "sheen" of the real one.
let lfsr: u32 = 0x1234567;
function resetNoise909(): void { lfsr = 0x1234567; }
@inline function noise909(): f32 {
  const b = ((lfsr >> 31) ^ (lfsr >> 21) ^ (lfsr >> 1) ^ lfsr) & 1;
  lfsr = (lfsr << 1) | b;
  return f32(lfsr & 0xffff) * 0.0000305 - 1.0;
}

// Near-sine from a phase, as the waveshaper leaves the sawtooth: a trace of
// second and third harmonic remains.
@inline function shapedSine(ph: f32): f32 {
  const s = Mathf.sin(TWO_PI * ph);
  return s + 0.045 * Mathf.sin(2.0 * TWO_PI * ph) - 0.02 * s * s * s;
}

// ---------------------------------------------------------------------
//  BASS DRUM: VCO → waveshaper → VCA (EG1) ; noise → LPF + pulse → VCA (EG2).
//  TUNE sets the pitch contour (how high it starts and how fast it falls),
//  ATTACK the click, DECAY EG1. Accent raises EG1's height and lengthens it.
// ---------------------------------------------------------------------
class BD909 {
  level: f32 = 0.8; tune: f32 = 0.5; attack: f32 = 0.5; decay: f32 = 0.5;
  ph: f32 = 0; t: i32 = 0; amp: f32 = 0; ampC: f32 = 0.999; clickEnv: f32 = 0;
  nLp: Svf = new Svf(); dc: OnePole = new OnePole();
  h: f32 = 0; active: bool = false;
  init(): void { this.nLp.reset(); this.nLp.set(3200.0, 0.7); this.dc.reset(); this.dc.set(15.0); this.active = false; this.amp = 0; this.clickEnv = 0; this.t = 0; }
  trigger(h: f32): void {
    this.h = h; this.t = 0; this.ph = 0.0; this.active = true;
    const accent = clampf((h - N909) / 0.6, 0.0, 1.0);
    this.amp = h;
    this.ampC = decayCoef((0.06 + 0.42 * Mathf.pow(this.decay, 1.6)) * (1.0 + 0.25 * accent));
    this.clickEnv = h;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const t = f32(this.t) * invSR;
    const fEnd: f32 = 47.0 + 12.0 * this.tune;
    const depth: f32 = 1.6 + 2.6 * this.tune;                   // start = fEnd × (1 + depth)
    const tauP: f32 = 0.016 + 0.018 * (1.0 - this.tune);
    const f = fEnd * (1.0 + depth * Mathf.exp(-t / tauP));
    this.ph += f * invSR; if (this.ph >= 1.0) this.ph -= 1.0;
    const body = shapedSine(this.ph) * this.amp;
    this.amp *= this.ampC;
    // click: 1.5 ms pulse plus low-passed noise, both on a very short EG2
    this.nLp.tick(noise909());
    const pulse: f32 = this.t < msToSamples(1.5) ? 1.0 : 0.0;
    const click = (pulse * 0.9 + this.nLp.lp * 1.3) * this.clickEnv * this.attack * 0.9;
    this.clickEnv *= decayCoef(0.0045);
    this.t++;
    const y = this.dc.hp(body * 1.05 + click) * taper(this.level);
    if (this.amp < 0.00005 && this.t > msToSamples(30.0)) this.active = false;
    return y;
  }
}

// ---------------------------------------------------------------------
//  SNARE: VCO-1 (low) and VCO-2 (high) triangles reset together at the
//  trigger, bent down over ~20 ms, each on its own VCA/decay. TUNE moves
//  both, TONE opens the noise low-pass, SNAPPY sets the high-passed noise.
// ---------------------------------------------------------------------
@inline function tri(ph: f32): f32 { return ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph; }
class SD909 {
  level: f32 = 0.8; tune: f32 = 0.5; tone: f32 = 0.5; snappy: f32 = 0.5;
  p1: f32 = 0; p2: f32 = 0; t: i32 = 0; a1: f32 = 0; a2: f32 = 0; nA: f32 = 0; nB: f32 = 0;
  c1: f32 = 0.99; c2: f32 = 0.99; cn: f32 = 0.99; cs: f32 = 0.99;
  lp: Svf = new Svf(); hp: Svf = new Svf(); active: bool = false;
  init(): void {
    this.lp.reset(); this.hp.reset(); this.hp.set(2600.0, 0.9);
    this.c1 = decayCoef(0.045); this.c2 = decayCoef(0.028); this.cn = decayCoef(0.05); this.cs = decayCoef(0.075);
    this.active = false; this.a1 = 0; this.a2 = 0; this.nA = 0; this.nB = 0;
  }
  trigger(h: f32): void {
    this.p1 = 0; this.p2 = 0; this.t = 0; this.active = true;
    this.a1 = h; this.a2 = h * 0.75; this.nA = h; this.nB = h;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const tf = Mathf.pow(2.0, (this.tune - 0.5) * 0.9);             // ≈ ±5 semitones
    const bendT = f32(this.t) * invSR;
    const bend: f32 = 1.0 + 0.55 * Mathf.exp(-bendT / 0.007) * (bendT < 0.02 ? 1.0 : 0.0);
    this.p1 += 180.0 * tf * bend * invSR; if (this.p1 >= 1.0) this.p1 -= 1.0;
    this.p2 += 330.0 * tf * bend * invSR; if (this.p2 >= 1.0) this.p2 -= 1.0;
    const drum = tri(this.p1) * this.a1 + tri(this.p2) * this.a2 * 0.7;
    this.a1 *= this.c1; this.a2 *= this.c2;
    const n = noise909();
    // one low-pass (TONE) before the noise splits into the direct path and
    // the high-passed snappy path, so TONE brightens both
    this.lp.set(2400.0 * Mathf.pow(5.0, this.tone), 0.6); this.lp.tick(n);
    this.hp.tick(this.lp.lp);
    const noise = this.lp.lp * this.nA * 0.45 + this.hp.hp * this.nB * 1.5 * taper(this.snappy);
    this.nA *= this.cn; this.nB *= this.cs;
    this.t++;
    const y = (drum * 0.62 + noise * 0.8) * 1.4 * taper(this.level);
    if (this.nB < 0.0001 && this.a1 < 0.0001 && this.nA < 0.0001) this.active = false;
    return y;
  }
}

// ---------------------------------------------------------------------
//  TOMS: a VCO with a downward pitch contour and a burst of "tom noise";
//  TUNE, DECAY, LEVEL. A second, fainter partial at 1.5× gives the shell.
// ---------------------------------------------------------------------
class Tom909 {
  level: f32 = 0.8; tune: f32 = 0.5; decay: f32 = 0.5;
  fLo: f32 = 80; fHi: f32 = 130;
  ph: f32 = 0; ph2: f32 = 0; t: i32 = 0; amp: f32 = 0; ampC: f32 = 0.999; nz: f32 = 0; nzC: f32 = 0.99;
  bp: Svf = new Svf(); active: bool = false;
  configure(lo: f32, hi: f32): void { this.fLo = lo; this.fHi = hi; }
  init(): void { this.bp.reset(); this.nzC = decayCoef(0.035); this.active = false; this.amp = 0; this.nz = 0; }
  trigger(h: f32): void {
    this.t = 0; this.ph = 0; this.ph2 = 0.25; this.amp = h; this.nz = h; this.active = true;
    this.ampC = decayCoef(0.05 + 0.34 * Mathf.pow(this.decay, 1.4));
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const base = this.fLo * Mathf.pow(this.fHi / this.fLo, clampf(this.tune, 0.0, 1.0));
    const t = f32(this.t) * invSR;
    const f = base * (1.0 + 0.45 * Mathf.exp(-t / 0.035));
    this.ph += f * invSR; if (this.ph >= 1.0) this.ph -= 1.0;
    this.ph2 += f * 1.5 * invSR; if (this.ph2 >= 1.0) this.ph2 -= 1.0;
    this.bp.set(base * 3.0, 0.8); this.bp.tick(noise909());
    const y = (shapedSine(this.ph) * this.amp + Mathf.sin(TWO_PI * this.ph2) * this.amp * 0.18
             + this.bp.bp * this.nz * 0.5) * 1.8 * taper(this.level);
    this.amp *= this.ampC; this.nz *= this.nzC; this.t++;
    if (this.amp < 0.00005) this.active = false;
    return y;
  }
}

// ---------------------------------------------------------------------
//  RIM SHOT: bridged-T resonators excited by the trigger — sharper and
//  brighter than its predecessor. HAND CLAP: noise, band-pass, a four-slap
//  re-triggered envelope and a reverb tail.
// ---------------------------------------------------------------------
class Rim909 {
  level: f32 = 0.8;
  rA: Svf = new Svf(); rB: Svf = new Svf(); hp: Svf = new Svf();
  t: i32 = -1; env: f32 = 0; h: f32 = 0; active: bool = false;
  init(): void { this.rA.reset(); this.rB.reset(); this.hp.reset(); this.rA.set(500.0, 9.0); this.rB.set(1720.0, 14.0); this.hp.set(380.0, 0.7); this.active = false; this.t = -1; }
  trigger(h: f32): void { this.t = 0; this.h = h; this.env = 1.0; this.active = true; }
  tick(): f32 {
    if (!this.active) return 0.0;
    const x: f32 = this.t >= 0 && this.t < msToSamples(0.6) ? this.h : 0.0;
    this.rA.tick(x); this.rB.tick(x);
    const src = (this.rA.bp + this.rB.bp * 0.95) * 1.2;
    this.hp.tick(swingVca(src, this.env));
    this.env *= decayCoef(0.0055);
    this.t++;
    if (this.t > msToSamples(80.0)) this.active = false;
    return this.hp.hp * 2.1 * taper(this.level);
  }
}

class Clap909 {
  level: f32 = 0.8;
  bp: Svf = new Svf(); hp: OnePole = new OnePole();
  t: i32 = -1; h: f32 = 0; saw: f32 = 0; tail: f32 = 0; sc: f32 = 0.99; tc: f32 = 0.999; active: bool = false;
  init(): void { this.bp.reset(); this.bp.set(1150.0, 1.4); this.hp.reset(); this.hp.set(300.0); this.sc = decayCoef(0.0028); this.tc = decayCoef(0.055); this.active = false; this.t = -1; this.saw = 0; this.tail = 0; }
  trigger(h: f32): void { this.t = 0; this.h = h; this.active = true; this.saw = 0; this.tail = 0; }
  tick(): f32 {
    if (!this.active) return 0.0;
    const p = msToSamples(8.5);
    if (this.t == 0 || this.t == p || this.t == 2 * p || this.t == 3 * p) this.saw = this.h;
    if (this.t == 3 * p) this.tail = this.h * 0.9;
    this.bp.tick(noise909());
    const y = this.hp.hp(this.bp.bp * this.bp.k * (this.saw * 2.4 + this.tail * 1.35));
    this.saw *= this.sc; this.tail *= this.tc; this.t++;
    if (this.t > 4 * p && this.tail < 0.00005) this.active = false;
    return y * 1.7 * taper(this.level);
  }
}

// ---------------------------------------------------------------------
//  The PCM voices. ROM_RATE: the address clock (~60 kHz ÷ 2). Output is a
//  zero-order hold of 6-bit words into an analog reconstruction low-pass,
//  which is where the 909 cymbals' grit and hiss come from.
// ---------------------------------------------------------------------
const ROM_RATE: f32 = 30000.0;
const HAT_LEN: i32 = 0x6000;            // open hat stops here…
const HAT_CLOSED_END: i32 = 0x2000;     // …closed hat here (same sample)
const CYM_LEN: i32 = 0xC000;
const hatRom = new StaticArray<f32>(HAT_LEN);
const crashRom = new StaticArray<f32>(CYM_LEN);
const rideRom = new StaticArray<f32>(CYM_LEN);
let romsBuilt: bool = false;

// Deterministic generator for ROM synthesis (independent of the audio noise).
let romSeed: u32 = 0x2468ace1;
function romRand(): f32 { romSeed = romSeed * 1664525 + 1013904223; return f32(romSeed >> 8) * 1.1920929e-7 - 1.0; }

@inline function q6(v: f32): f32 { return Mathf.round(clampf(v, -1.0, 1.0) * 31.0) / 31.0; }

// Fill `rom` with a metal: `n` inharmonic square-ish partials between fLo and
// fHi (ring-modulated in pairs) plus noise, band-shaped, with a gentle
// ("compressed") decay; normalised and quantised to 6 bits.
function buildMetal(rom: StaticArray<f32>, len: i32, n: i32, fLo: f32, fHi: f32, noiseAmt: f32, hpHz: f32, tau: f32, bell: f32): void {
  const ph = new StaticArray<f32>(24);
  const inc = new StaticArray<f32>(24);
  for (let i = 0; i < n; i++) {
    const f = fLo * Mathf.pow(fHi / fLo, (f32(i) + 0.5 * (romRand() + 1.0)) / f32(n));
    inc[i] = f / ROM_RATE; ph[i] = (romRand() + 1.0) * 0.5;
  }
  // one-pole high-pass and a two-pole-ish band limit at ROM rate
  let hz: f32 = 0; let lpz: f32 = 0; let peak: f32 = 0;
  const hpA: f32 = 1.0 - Mathf.exp(-TWO_PI * hpHz / ROM_RATE);
  for (let s = 0; s < len; s++) {
    let m: f32 = 0;
    for (let i = 0; i < n; i += 2) {
      ph[i] += inc[i]; if (ph[i] >= 1.0) ph[i] -= 1.0;
      ph[i + 1] += inc[i + 1]; if (ph[i + 1] >= 1.0) ph[i + 1] -= 1.0;
      const a: f32 = ph[i] < 0.5 ? 1.0 : -1.0;
      const b: f32 = ph[i + 1] < 0.5 ? 1.0 : -1.0;
      m += a * b;                                   // ring-mod pair: inharmonic sidebands
    }
    m = m / f32(n / 2);
    const t = f32(s) / ROM_RATE;
    let v = m * (1.0 - noiseAmt) + romRand() * noiseAmt;
    if (bell > 0.0) v += bell * Mathf.sin(TWO_PI * 3950.0 * t) * Mathf.sin(TWO_PI * 5510.0 * t) * Mathf.exp(-t / (tau * 0.6));
    hz += hpA * (v - hz); v = v - hz;               // high-pass
    lpz += 0.55 * (v - lpz); v = lpz;               // soften the very top
    // "compressed before digitising": a slow, flattened decay (analog VCAs
    // restore the real envelope at playback)
    v *= Mathf.exp(-t / tau) * (1.0 - Mathf.exp(-t / 0.0006));
    rom[s] = v;
    const a = Mathf.abs(v); if (a > peak) peak = a;
  }
  const g: f32 = peak > 0.0 ? 0.98 / peak : 1.0;
  for (let s = 0; s < len; s++) rom[s] = q6(rom[s] * g);
}

function buildRoms(): void {
  if (romsBuilt) return;
  romSeed = 0x2468ace1;
  buildMetal(hatRom, HAT_LEN, 12, 1400.0, 9800.0, 0.38, 5200.0, 0.55, 0.0);
  buildMetal(crashRom, CYM_LEN, 16, 700.0, 8500.0, 0.46, 2400.0, 0.95, 0.0);
  buildMetal(rideRom, CYM_LEN, 10, 1800.0, 7200.0, 0.22, 2200.0, 1.3, 0.42);
  romsBuilt = true;
}

// A ROM reader: fixed address clock (ROM_RATE × tune), zero-order hold,
// reconstruction low-pass. `end` stops the address counter.
class RomVoice {
  pos: f32 = 0; end: i32 = 0; running: bool = false; clock: f32 = 1.0;
  recon: Svf = new Svf(); held: f32 = 0; last: i32 = -1;
  init(): void { this.recon.reset(); this.recon.set(12500.0, 0.6); this.running = false; this.pos = 0; this.held = 0; this.last = -1; }
  start(end: i32): void { this.pos = 0; this.end = end; this.running = true; this.last = -1; }
  // returns the held 6-bit word, filtered; `rom` is read at the current address
  tick(rom: StaticArray<f32>): f32 {
    if (this.running) {
      const a = i32(this.pos);
      if (a >= this.end) { this.running = false; this.held = 0; }
      else { if (a != this.last) { this.held = unchecked(rom[a]); this.last = a; } this.pos += ROM_RATE * this.clock * invSR; }
    }
    this.recon.tick(this.held);
    return this.recon.lp;
  }
}

// HI-HAT: one sample; CLOSED stops the counter at 0x2000, OPEN at 0x6000.
// The analog VCA after the DAC restores the decay (CH DECAY / OH DECAY), and
// a closed hat cuts an open one.
class Hats909 {
  level: f32 = 0.8; chDecay: f32 = 0.5; ohDecay: f32 = 0.5;
  rom: RomVoice = new RomVoice(); vca: f32 = 0; vc: f32 = 0.999; hp: OnePole = new OnePole();
  isOpen: bool = false; active: bool = false;
  init(): void { buildRoms(); this.rom.init(); this.hp.reset(); this.hp.set(4200.0); this.vca = 0; this.active = false; }
  trigger(h: f32, open: bool): void {
    this.isOpen = open; this.rom.start(open ? HAT_LEN : HAT_CLOSED_END);
    this.vca = h;
    this.vc = open ? decayCoef(0.09 + 0.75 * Mathf.pow(this.ohDecay, 1.3)) : decayCoef(0.018 + 0.1 * Mathf.pow(this.chDecay, 1.3));
    this.active = true;
  }
  tick(): f32 {
    if (!this.active) return 0.0;
    const y = this.hp.hp(this.rom.tick(hatRom)) * this.vca * 6.0 * taper(this.level);
    this.vca *= this.vc;
    if (!this.rom.running || this.vca < 0.00003) this.active = false;
    return y;
  }
}

// CRASH / RIDE: TUNE varies the ROM clock; the decay comes from the address
// itself through an anti-log stage, so a higher tune also shortens the note.
class Cymbal909 {
  level: f32 = 0.8; tune: f32 = 0.5; isRide: bool = false;
  rom: RomVoice = new RomVoice(); h: f32 = 0; hp: OnePole = new OnePole(); active: bool = false;
  init(): void { buildRoms(); this.rom.init(); this.hp.reset(); this.hp.set(this.isRide ? 1900.0 : 900.0); this.active = false; }
  trigger(h: f32): void { this.h = h; this.rom.start(CYM_LEN); this.active = true; }
  tick(): f32 {
    if (!this.active) return 0.0;
    this.rom.clock = Mathf.pow(2.0, (this.tune - 0.5) * 1.2);      // ≈ ±7 semitones
    const s = this.rom.tick(this.isRide ? rideRom : crashRom);
    const x = this.rom.pos / f32(CYM_LEN);
    const env = Mathf.exp(-x * (this.isRide ? 3.6 : 4.8));           // anti-log of the address
    const y = this.hp.hp(s) * env * this.h * (this.isRide ? 5.2 : 4.6) * taper(this.level);
    if (!this.rom.running) this.active = false;
    return y;
  }
}

function configureToms909(lt: Tom909, mt: Tom909, ht: Tom909): void {
  lt.configure(78.0, 135.0); mt.configure(115.0, 195.0); ht.configure(160.0, 270.0);
}
