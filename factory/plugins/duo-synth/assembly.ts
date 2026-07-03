// =====================================================================
//  DUO SYNTH — a duophonic analog lead/bass synthesizer modelled
//  feature-for-feature on the ARP ODYSSEY (Owner's Manual, Second
//  Edition, March 1976, read cover to cover: Getting Started p.4-5,
//  How Your Odyssey Works + block diagram p.7-9, Sound Sources
//  p.10-18 (waveforms, PWM, phase-sync, noise, FM), Modifiers p.19-27
//  (ring mod, VCA, HPF, VCF), Controllers p.28-37 (keyboard/pedals,
//  ADSR & AR, S&H, LFO, pitch bend), Panel Control Description Chart
//  p.39-40, Specifications p.55).
//
//  DUOPHONIC keyboard (Specifications p.55: "VCO 1 is low note
//  priority; VCO 2 is high note priority"): the keyboard produces two
//  control voltages — the lowest held key drives VCO 1, the highest
//  held key drives VCO 2 (p.29) — so two keys sound as two pitches and
//  a single key locks both oscillators together. It is a 2-voice
//  paraphonic instrument: the two VCOs share one VCF / HPF / VCA and
//  the envelopes.
//
//  VCO 1 & VCO 2: sawtooth or square with variable PULSE WIDTH
//  (50%->5%, p.13) and PULSE-WIDTH MODULATION (ADSR +45% / LFO +15%,
//  p.55); VCO 1 has a LOW-FREQUENCY mode that also disconnects the
//  keyboard (p.12,29); VCO 2 has hard SYNC to VCO 1 (p.15). Signature
//  ARP modulation matrix — amount sliders each with a two-position
//  source switch:  VCO1+2 FM [Sine / S&H],  VCO2 FM [Sine / ADSR],
//  VCO1 PWM & VCO2 PWM [Sine / ADSR],  VCF FM #1 [Sine / S&H],
//  VCF FM #2 [ADSR / AR],  VCF Kbd [Kbd / S&H]. Maximum frequency
//  shifts follow the spec (LFO sine +/-1/2 oct, ADSR +/-9 oct scaled,
//  S/H +/-2 oct). LFO: simultaneous SINE + SQUARE outputs (p.36).
//  SAMPLE & HOLD: its own 2-input mixer, clocked by the LFO or the
//  keyboard, with output LAG (p.33-35). AUDIO MIXER: VCO1 + VCO2 +
//  a third channel switchable between white/pink NOISE and the RING
//  MODULATOR (VCO1 x VCO2, p.20). Self-oscillating 4-pole low-pass
//  VCF (Q to 30, resonance 1/2->self-oscillate, p.55) preceded by a
//  non-resonant HIGH-PASS FILTER (p.22). VCA driven by ADSR / AR /
//  GATE with an initial-GAIN slider (p.21). Performance: PORTAMENTO,
//  master TUNE, +/-2-oct TRANSPOSE, +/-1-oct PITCH BEND with centre
//  dead-zone, PPC vibrato depth, REPEAT switch (Kbd gate / Auto /
//  Kbd-repeat: the LFO retriggers the envelopes, p.40), VOLUME.
//
//  Switch groups are bit-packed into two mask params (Mode, Src) so
//  the whole instrument fits the 64-param host pool; the panel decodes
//  every individual switch. Pure algorithm — no samples, no imports,
//  allocation-free in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_V1COARSE: i32 = 0;   // -1..1  +/-2 oct
const P_V1FINE: i32 = 1;     // -1..1  +/-50 cents
const P_V2COARSE: i32 = 2;
const P_V2FINE: i32 = 3;
const P_MIXV1: i32 = 4;
const P_MIXV2: i32 = 5;
const P_MIXNZ: i32 = 6;      // noise or ring level
const P_LFOFREQ: i32 = 7;
const P_SHIN1: i32 = 8;      // S&H mixer input 1 (VCO1)
const P_SHIN2: i32 = 9;      // S&H mixer input 2 (VCO2 or noise)
const P_SHLAG: i32 = 10;
const P_VCFCUT: i32 = 11;
const P_VCFRES: i32 = 12;
const P_HPFCUT: i32 = 13;
const P_VCAGAIN: i32 = 14;   // initial gain (drone)
const P_ADSR_A: i32 = 15;
const P_ADSR_D: i32 = 16;
const P_ADSR_S: i32 = 17;
const P_ADSR_R: i32 = 18;
const P_AR_A: i32 = 19;
const P_AR_R: i32 = 20;
const P_PORTA: i32 = 21;
const P_BEND: i32 = 22;      // -1..1  +/-1 oct with dead-zone
const P_PPCVIB: i32 = 23;    // LFO vibrato depth
const P_TUNE: i32 = 24;      // -1..1  +/-50 cents master
const P_VOLUME: i32 = 25;
const P_FM12: i32 = 26;      // VCO1+2 FM amount
const P_FMV2: i32 = 27;      // VCO2 FM amount
const P_PWM1: i32 = 28;
const P_PWM2: i32 = 29;
const P_VCFFM1: i32 = 30;
const P_VCFFM2: i32 = 31;
const P_VCFKBD: i32 = 32;
const P_V1PW: i32 = 33;
const P_V2PW: i32 = 34;
const P_MODEMASK: i32 = 35;  // bit0 noise pink, b1 vco1 square, b2 vco2 square,
                             // b3 mix3=ring, b4 vco1 LF, b5 vco2 sync,
                             // b6 S&H clock=LFO, b7 S&H in2=noise
const P_SRCMASK: i32 = 36;   // b0 FM12=S&H, b1 FMV2=ADSR, b2 PWM1=ADSR,
                             // b3 PWM2=ADSR, b4 VCFFM1=S&H, b5 VCFFM2=AR,
                             // b6 VCFKbd=S&H
const P_TRANSPOSE: i32 = 37; // 0 -2oct, 1 normal, 2 +2oct
const P_VCAMODE: i32 = 38;   // 0 ADSR, 1 AR, 2 GATE
const P_REPEAT: i32 = 39;    // 0 Kbd, 1 Auto, 2 Kbd-repeat

const NUM_PARAMS: i32 = 40;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 { // -1..1 white noise
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  else if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

// ---- duophonic voice state -------------------------------------------
let gate: i32 = 0;
let cur1: f32 = 110.0; let target1: f32 = 110.0;  // VCO1 = low note
let cur2: f32 = 110.0; let target2: f32 = 110.0;  // VCO2 = high note

let ph1: f32 = 0.0; let ph2: f32 = 0.0;
let pinkA: f32 = 0.0; let pinkB: f32 = 0.0; let pinkC: f32 = 0.0; // pink filter state
let v1prev: f32 = 0.0; let v2prev: f32 = 0.0;  // for S&H mixer (1-sample delay)

// LFO
let lfoPh: f32 = 0.0;
let lfoSqPrev: i32 = 0;

// Sample & Hold
let shTarget: f32 = 0.0; let shOut: f32 = 0.0;
let shPendingKbd: i32 = 0;

// Envelopes: ADSR stage 0 idle,1 atk,2 dec,3 sus,4 rel ; AR 0 idle,1 atk,3 hold,4 rel
let adsr: f32 = 0.0; let adsrStage: i32 = 0;
let ar: f32 = 0.0; let arStage: i32 = 0;

// VCF 4-pole ladder + HPF states
let l0: f32 = 0.0; let l1: f32 = 0.0; let l2: f32 = 0.0; let l3: f32 = 0.0;
let hp1: f32 = 0.0; let hp2: f32 = 0.0;

// held-note stack for duophonic low/high assignment
const HELD_MAX: i32 = 16;
const heldHz: StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const heldId: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let heldCount: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0;
  cur1 = 110.0; target1 = 110.0; cur2 = 110.0; target2 = 110.0;
  ph1 = 0.0; ph2 = 0.0; pinkA = 0.0; pinkB = 0.0; pinkC = 0.0;
  v1prev = 0.0; v2prev = 0.0;
  lfoPh = 0.0; lfoSqPrev = 0;
  shTarget = 0.0; shOut = 0.0; shPendingKbd = 0;
  adsr = 0.0; adsrStage = 0; ar = 0.0; arStage = 0;
  l0 = 0.0; l1 = 0.0; l2 = 0.0; l3 = 0.0; hp1 = 0.0; hp2 = 0.0;
  heldCount = 0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_V1COARSE] = 0.0; params[P_V1FINE] = 0.0;
  params[P_V2COARSE] = 0.0; params[P_V2FINE] = 0.04;
  params[P_MIXV1] = 0.8; params[P_MIXV2] = 0.7; params[P_MIXNZ] = 0.0;
  params[P_LFOFREQ] = 0.35;
  params[P_SHIN1] = 0.5; params[P_SHIN2] = 0.5; params[P_SHLAG] = 0.0;
  params[P_VCFCUT] = 0.5; params[P_VCFRES] = 0.3; params[P_HPFCUT] = 0.0;
  params[P_VCAGAIN] = 0.0;
  params[P_ADSR_A] = 0.02; params[P_ADSR_D] = 0.4; params[P_ADSR_S] = 0.7; params[P_ADSR_R] = 0.25;
  params[P_AR_A] = 0.02; params[P_AR_R] = 0.3;
  params[P_PORTA] = 0.08; params[P_BEND] = 0.0; params[P_PPCVIB] = 0.0;
  params[P_TUNE] = 0.0; params[P_VOLUME] = 0.8;
  params[P_FM12] = 0.0; params[P_FMV2] = 0.0; params[P_PWM1] = 0.0; params[P_PWM2] = 0.0;
  params[P_VCFFM1] = 0.0; params[P_VCFFM2] = 0.3; params[P_VCFKBD] = 0.3;
  params[P_V1PW] = 0.5; params[P_V2PW] = 0.5;
  params[P_MODEMASK] = 0.0; params[P_SRCMASK] = 0.0;
  params[P_TRANSPOSE] = 1.0; params[P_VCAMODE] = 0.0; params[P_REPEAT] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- retrigger both envelopes (a keystroke or an LFO auto-repeat) -----
function retrigEnvelopes(): void {
  adsrStage = 1; arStage = 1;
}

// ---- duophonic assignment: low->VCO1, high->VCO2 ---------------------
function reassign(retrig: i32): void {
  if (heldCount == 0) { gate = 0; return; }
  let lo: f32 = heldHz[0]; let hi: f32 = heldHz[0];
  for (let i = 1; i < heldCount; i++) {
    if (heldHz[i] < lo) lo = heldHz[i];
    if (heldHz[i] > hi) hi = heldHz[i];
  }
  target1 = lo; target2 = hi;
  const porta: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  if (porta <= 0.0005) { cur1 = lo; cur2 = hi; } // glide always runs from the last note (built-in memory, p.29)
  gate = 1;
  if (retrig == 1) { retrigEnvelopes(); shPendingKbd = 1; }
}

// ---- note events (host / GUI) ---------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  // update existing entry or push
  for (let i = 0; i < heldCount; i++) if (heldId[i] == id) { heldHz[i] = hz; reassign(1); return; }
  if (heldCount < HELD_MAX) { heldHz[heldCount] = hz; heldId[heldCount] = id; heldCount++; }
  reassign(1);
}

export function noteOff(id: i32): void {
  let idx: i32 = -1;
  for (let i = 0; i < heldCount; i++) { if (heldId[i] == id) { idx = i; break; } }
  if (idx >= 0) { for (let i = idx; i < heldCount - 1; i++) { heldHz[i] = heldHz[i + 1]; heldId[i] = heldId[i + 1]; } heldCount--; }
  if (heldCount > 0) { reassign(0); return; } // re-derive low/high (no retrigger)
  // all released: enter release
  gate = 0;
  if (adsrStage != 0) adsrStage = 4;
  if (arStage != 0) arStage = 4;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- per-block parameter mapping ------------------------------------
  const v1coarse: f32 = clampf(pget(P_V1COARSE), -1.0, 1.0) * 2.0;   // +/-2 oct
  const v1fine: f32 = clampf(pget(P_V1FINE), -1.0, 1.0) * (0.5 / 12.0); // +/-50c
  const v2coarse: f32 = clampf(pget(P_V2COARSE), -1.0, 1.0) * 2.0;
  const v2fine: f32 = clampf(pget(P_V2FINE), -1.0, 1.0) * (0.5 / 12.0);
  const mixV1: f32 = clampf(pget(P_MIXV1), 0.0, 1.0);
  const mixV2: f32 = clampf(pget(P_MIXV2), 0.0, 1.0);
  const mixNz: f32 = clampf(pget(P_MIXNZ), 0.0, 1.0);

  const lfoN: f32 = clampf(pget(P_LFOFREQ), 0.0, 1.0);
  const lfoHz: f32 = 0.1 * Mathf.pow(300.0, lfoN);   // 0.1 .. 30 Hz
  const lfoInc: f32 = lfoHz / sr;

  const shIn1: f32 = clampf(pget(P_SHIN1), 0.0, 1.0);
  const shIn2: f32 = clampf(pget(P_SHIN2), 0.0, 1.0);
  const shLagN: f32 = clampf(pget(P_SHLAG), 0.0, 1.0);
  const shLagHz: f32 = 200.0 * Mathf.pow(0.01, shLagN); // 200 -> 2 Hz smoothing
  const shLagK: f32 = 1.0 - Mathf.exp(-TWO_PI * shLagHz / sr);

  const vcfCutN: f32 = clampf(pget(P_VCFCUT), 0.0, 1.0);
  const vcfBase: f32 = 16.0 * Mathf.pow(1000.0, vcfCutN);            // 16 Hz .. 16 kHz
  const vcfResN: f32 = clampf(pget(P_VCFRES), 0.0, 1.0);
  const vcfK: f32 = vcfResN * 4.3;                                   // 0 .. >4 self-osc
  const hpfN: f32 = clampf(pget(P_HPFCUT), 0.0, 1.0);
  const hpfHz: f32 = 15.0 * Mathf.pow(400.0, hpfN);                  // 15 Hz .. 6 kHz
  const hpfG: f32 = 1.0 - Mathf.exp(-TWO_PI * hpfHz / sr);

  const vcaGain: f32 = clampf(pget(P_VCAGAIN), 0.0, 1.0);

  const adA: f32 = 0.001 * Mathf.pow(5000.0, clampf(pget(P_ADSR_A), 0.0, 1.0));
  const adD: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_ADSR_D), 0.0, 1.0));
  const adS: f32 = clampf(pget(P_ADSR_S), 0.0, 1.0);
  const adR: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_ADSR_R), 0.0, 1.0));
  const adAk: f32 = 1.0 - Mathf.exp(-1.0 / (adA * sr));
  const adDk: f32 = 1.0 - Mathf.exp(-1.0 / (adD * sr));
  const adRk: f32 = 1.0 - Mathf.exp(-1.0 / (adR * sr));
  const arAsec: f32 = 0.001 * Mathf.pow(5000.0, clampf(pget(P_AR_A), 0.0, 1.0));
  const arRsec: f32 = 0.002 * Mathf.pow(5000.0, clampf(pget(P_AR_R), 0.0, 1.0));
  const arAk: f32 = 1.0 - Mathf.exp(-1.0 / (arAsec * sr));
  const arRk: f32 = 1.0 - Mathf.exp(-1.0 / (arRsec * sr));

  const porta: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  const portaSec: f32 = 0.002 + porta * porta * 4.0;                 // up to ~1.5 s/oct
  const glideK: f32 = 1.0 - Mathf.exp(-1.0 / (portaSec * sr));

  // pitch bend +/-1 oct with centre dead-zone (p.36)
  let bendRaw: f32 = clampf(pget(P_BEND), -1.0, 1.0);
  let bendOct: f32 = 0.0;
  if (bendRaw > 0.08) bendOct = (bendRaw - 0.08) / 0.92;
  else if (bendRaw < -0.08) bendOct = (bendRaw + 0.08) / 0.92;
  const ppcVib: f32 = clampf(pget(P_PPCVIB), 0.0, 1.0);
  const tuneOct: f32 = clampf(pget(P_TUNE), -1.0, 1.0) * (0.5 / 12.0); // +/-50c
  const transI: i32 = pbits(P_TRANSPOSE);
  const transOct: f32 = f32(transI - 1) * 2.0;                       // -2 / 0 / +2
  const globalOct: f32 = bendOct + tuneOct + transOct;

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 1.15;

  const fm12: f32 = clampf(pget(P_FM12), 0.0, 1.0);
  const fmV2: f32 = clampf(pget(P_FMV2), 0.0, 1.0);
  const pwm1: f32 = clampf(pget(P_PWM1), 0.0, 1.0);
  const pwm2: f32 = clampf(pget(P_PWM2), 0.0, 1.0);
  const vcfFm1: f32 = clampf(pget(P_VCFFM1), 0.0, 1.0);
  const vcfFm2: f32 = clampf(pget(P_VCFFM2), 0.0, 1.0);
  const vcfKbd: f32 = clampf(pget(P_VCFKBD), 0.0, 1.0);
  const v1pwKnob: f32 = clampf(pget(P_V1PW), 0.0, 1.0);
  const v2pwKnob: f32 = clampf(pget(P_V2PW), 0.0, 1.0);

  const mode: i32 = pbits(P_MODEMASK);
  const noisePink: i32 = mode & 1;
  const v1square: i32 = (mode >> 1) & 1;
  const v2square: i32 = (mode >> 2) & 1;
  const mix3ring: i32 = (mode >> 3) & 1;
  const v1lf: i32 = (mode >> 4) & 1;
  const v2sync: i32 = (mode >> 5) & 1;
  const shClockLfo: i32 = (mode >> 6) & 1;
  const shIn2noise: i32 = (mode >> 7) & 1;

  const src: i32 = pbits(P_SRCMASK);
  const s_fm12: i32 = src & 1;          // 0 sine, 1 s&h
  const s_fmv2: i32 = (src >> 1) & 1;   // 0 sine, 1 adsr
  const s_pwm1: i32 = (src >> 2) & 1;   // 0 sine, 1 adsr
  const s_pwm2: i32 = (src >> 3) & 1;   // 0 sine, 1 adsr
  const s_vcffm1: i32 = (src >> 4) & 1; // 0 sine, 1 s&h
  const s_vcffm2: i32 = (src >> 5) & 1; // 0 adsr, 1 ar
  const s_vcfkbd: i32 = (src >> 6) & 1; // 0 kbd, 1 s&h

  const vcaMode: i32 = pbits(P_VCAMODE);
  const repeat: i32 = pbits(P_REPEAT);

  for (let f = 0; f < n; f++) {
    // ---- glide (per oscillator; duophonic) ----------------------------
    if (cur1 != target1) { cur1 += (target1 - cur1) * glideK; if (Mathf.abs(target1 - cur1) < 0.02) cur1 = target1; }
    if (cur2 != target2) { cur2 += (target2 - cur2) * glideK; if (Mathf.abs(target2 - cur2) < 0.02) cur2 = target2; }

    // ---- LFO (sine + square outputs) ----------------------------------
    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfoSine: f32 = Mathf.sin(TWO_PI * lfoPh);
    const lfoSqState: i32 = lfoPh < 0.5 ? 1 : 0;
    const lfoRise: i32 = (lfoSqState == 1 && lfoSqPrev == 0) ? 1 : 0;
    lfoSqPrev = lfoSqState;

    // ---- REPEAT: LFO retriggers the envelopes (p.40) ------------------
    if (lfoRise == 1) {
      if (repeat == 1) retrigEnvelopes();                   // Auto-repeat
      else if (repeat == 2 && gate == 1) retrigEnvelopes(); // Kbd-repeat
    }

    // ---- Sample & Hold: clock, sample its 2-input mixer, lag ----------
    const shClock: i32 = shClockLfo == 1 ? lfoRise : shPendingKbd;
    if (shClock == 1) {
      const in2src: f32 = shIn2noise == 1 ? rngf() : v2prev;
      shTarget = clampf(shIn1 * v1prev + shIn2 * in2src, -1.0, 1.0);
    }
    shPendingKbd = 0;
    shOut += (shTarget - shOut) * shLagK;

    // ---- envelopes ----------------------------------------------------
    if (adsrStage == 1) { adsr += adAk * (1.04 - adsr); if (adsr >= 1.0) { adsr = 1.0; adsrStage = 2; } }
    else if (adsrStage == 2) { adsr += adDk * (adS - adsr); if (Mathf.abs(adsr - adS) < 0.001) adsrStage = 3; }
    else if (adsrStage == 3) { adsr += adDk * (adS - adsr); }
    else if (adsrStage == 4) { adsr += adRk * (0.0 - adsr); if (adsr < 0.0003) { adsr = 0.0; adsrStage = 0; } }
    if (arStage == 1) { ar += arAk * (1.04 - ar); if (ar >= 1.0) { ar = 1.0; arStage = 3; } }
    else if (arStage == 3) { ar = 1.0; }  // hold at peak while gated (AR = ADSR with sustain=max)
    else if (arStage == 4) { ar += arRk * (0.0 - ar); if (ar < 0.0003) { ar = 0.0; arStage = 0; } }

    // ---- keyboard CV (VCO1's key, low note) --------------------------
    const kbdCV: f32 = clampf(Mathf.log2(cur1 / 261.6) * 0.5, -2.0, 2.0);

    // ---- resolve modulation source switches ---------------------------
    const modFm12: f32 = (s_fm12 == 1 ? shOut : lfoSine) * fm12;
    const modFmV2: f32 = (s_fmv2 == 1 ? adsr : lfoSine) * fmV2;
    const modPwm1: f32 = (s_pwm1 == 1 ? adsr : lfoSine) * pwm1;
    const modPwm2: f32 = (s_pwm2 == 1 ? adsr : lfoSine) * pwm2;
    const modVcfFm1: f32 = (s_vcffm1 == 1 ? shOut : lfoSine) * vcfFm1;
    const modVcfFm2: f32 = (s_vcffm2 == 1 ? ar : adsr) * vcfFm2;
    const modVcfKbd: f32 = (s_vcfkbd == 1 ? shOut : kbdCV) * vcfKbd;

    // pitch modulation in octaves (spec p.55 max shifts):
    // LFO sine +/-1/2 oct, S&H +/-2 oct, ADSR +/-9 oct (scaled musically here)
    const fm12Oct: f32 = s_fm12 == 1 ? modFm12 * 2.0 : modFm12 * 0.5;
    const fmV2Oct: f32 = s_fmv2 == 1 ? modFmV2 * 4.0 : modFmV2 * 0.5;
    const vibOct: f32 = lfoSine * ppcVib * 0.5;

    // ---- oscillator frequencies (DUOPHONIC) ---------------------------
    let hz1: f32;
    if (v1lf == 1) {
      // LOW-FREQUENCY mode: keyboard disconnected, subsonic (p.12,29)
      hz1 = 3.0 * Mathf.pow(2.0, v1coarse + v1fine);
    } else {
      const oct1: f32 = v1coarse + v1fine + globalOct + fm12Oct + vibOct;
      hz1 = cur1 * Mathf.pow(2.0, oct1);
    }
    const oct2: f32 = v2coarse + v2fine + globalOct + fm12Oct + fmV2Oct + vibOct;
    let hz2: f32 = cur2 * Mathf.pow(2.0, oct2);
    if (hz1 < 0.01) hz1 = 0.01; if (hz2 < 0.01) hz2 = 0.01;
    let inc1: f32 = hz1 / sr; if (inc1 > 0.45) inc1 = 0.45;
    let inc2: f32 = hz2 / sr; if (inc2 > 0.45) inc2 = 0.45;

    // ---- VCO 1 --------------------------------------------------------
    ph1 += inc1;
    let syncReset: i32 = 0;
    if (ph1 >= 1.0) { ph1 -= 1.0; syncReset = 1; }
    let v1: f32;
    if (v1square == 1) {
      const pw: f32 = clampf(0.5 - (v1pwKnob * 0.45 + modPwm1 * 0.45), 0.02, 0.98);
      v1 = ph1 < pw ? 1.0 : -1.0;
      v1 += polyBlep(ph1, inc1);
      let pp: f32 = ph1 - pw; if (pp < 0.0) pp += 1.0;
      v1 -= polyBlep(pp, inc1);
    } else {
      v1 = 2.0 * ph1 - 1.0; v1 -= polyBlep(ph1, inc1);
    }

    // ---- VCO 2 (hard SYNC to VCO 1 when enabled) ----------------------
    ph2 += inc2; if (ph2 >= 1.0) ph2 -= 1.0;
    if (v2sync == 1 && syncReset == 1) ph2 = 0.0;
    let v2: f32;
    if (v2square == 1) {
      const pw: f32 = clampf(0.5 - (v2pwKnob * 0.45 + modPwm2 * 0.45), 0.02, 0.98);
      v2 = ph2 < pw ? 1.0 : -1.0;
      v2 += polyBlep(ph2, inc2);
      let pp: f32 = ph2 - pw; if (pp < 0.0) pp += 1.0;
      v2 -= polyBlep(pp, inc2);
    } else {
      v2 = 2.0 * ph2 - 1.0; v2 -= polyBlep(ph2, inc2);
    }

    v1prev = v1; v2prev = v2; // feed the S&H mixer (next sample)

    // ---- noise (white / pink) & ring modulator ------------------------
    const white: f32 = rngf();
    // Paul Kellet pink filter
    pinkA = 0.99765 * pinkA + white * 0.0990460;
    pinkB = 0.96300 * pinkB + white * 0.2965164;
    pinkC = 0.57000 * pinkC + white * 1.0526913;
    const pink: f32 = (pinkA + pinkB + pinkC + white * 0.1848) * 0.25;
    const noise: f32 = noisePink == 1 ? pink : white;
    const ring: f32 = v1 * v2;                          // VCO1 x VCO2 (p.20)
    const third: f32 = mix3ring == 1 ? ring : noise;

    // ---- AUDIO MIXER --------------------------------------------------
    const mixed: f32 = (v1 * mixV1 + v2 * mixV2 + third * mixNz) * 0.5;

    // ---- HIGH-PASS FILTER (non-resonant, 2-pole, p.22) ----------------
    hp1 += hpfG * (mixed - hp1);
    let afterHp: f32 = mixed - hp1;
    hp2 += hpfG * (afterHp - hp2);
    afterHp = afterHp - hp2;

    // ---- VCF: self-oscillating 4-pole low-pass ladder -----------------
    const cutOct: f32 = modVcfFm1 * 4.0 + modVcfFm2 * 6.0 + modVcfKbd * 5.0;
    const fc: f32 = clampf(vcfBase * Mathf.pow(2.0, cutOct), 12.0, sr * 0.45);
    const g: f32 = 1.0 - Mathf.exp(-TWO_PI * fc / sr);
    const seed: f32 = white * 0.0012;                   // seeds self-oscillation
    let input: f32 = (afterHp + seed) - vcfK * l3;
    input = Mathf.tanh(input);
    l0 += g * (input - l0);
    l1 += g * (l0 - l1);
    l2 += g * (l1 - l2);
    l3 += g * (l2 - l3);
    const filt: f32 = l3 * (1.0 + vcfK * 0.5);          // passband makeup

    // ---- VCA (ADSR / AR / GATE + initial gain, p.21) -----------------
    let env: f32;
    if (vcaMode == 1) env = ar;
    else if (vcaMode == 2) env = f32(gate);             // straight gate / drone
    else env = adsr;
    const amp: f32 = clampf(vcaGain + env, 0.0, 1.3);
    const outSig: f32 = filt * amp;

    const out: f32 = Mathf.tanh(outSig * outGain);
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
