// =====================================================================
//  TWIN VOLT — dual-VCO monophonic synth voice (SH-2 lineage)
//  Two detuned analog-style oscillators (a band-limited saw + a pulse)
//  plus a square sub-oscillator one octave down, summed and ALSO ring-
//  modulated against each other for clangy, inharmonic metallic colour.
//  The mix feeds a punchy 4-pole resonant low-pass driven by its own
//  decay envelope (Env Amount), then an amp envelope. Pitch glides
//  (portamento) between notes. Mono — newest note steals the voice.
//
//  Params:
//    0 Cutoff      base filter cutoff           (0..1 -> ~60..11000 Hz)
//    1 Resonance   filter feedback / Q          (0..1)
//    2 Env Amount  filter envelope depth        (0..1)
//    3 Ring        ring-mod blend into the mix  (0..1)
//    4 Detune      VCO2 detune (fattens)        (0..1 -> 0..~+30 cents-ish)
//    5 Decay       filter + amp decay time      (0..1)
//    6 Level       output level                 (0..1)
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// oscillator phases (0..1)
let ph1: f32 = 0.0;   // VCO1 saw
let ph2: f32 = 0.0;   // VCO2 pulse
let phSub: f32 = 0.0; // square sub (one octave down)

// pitch / glide
let targetFreq: f32 = 0.0;  // freq commanded by the last noteOn
let curFreq: f32 = 0.0;     // glided frequency actually playing

// envelopes
let ampEnv: f32 = 0.0;   // amp envelope level
let filtEnv: f32 = 0.0;  // filter envelope level
let gate: i32 = 0;       // 1 while a note is held
let note: i32 = -1;      // currently sounding note id
let atkPhase: bool = false; // filter env still rising toward its peak

// 4-pole (ladder-style) low-pass state
let lp1: f32 = 0.0;
let lp2: f32 = 0.0;
let lp3: f32 = 0.0;
let lp4: f32 = 0.0;

// gentle DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

const PI2: f32 = 6.2831853;

const P_CUTOFF: i32 = 0;
const P_RESO:   i32 = 1;
const P_ENVAMT: i32 = 2;
const P_RING:   i32 = 3;
const P_DETUNE: i32 = 4;
const P_DECAY:  i32 = 5;
const P_LEVEL:  i32 = 6;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; phSub = 0.0;
  targetFreq = 0.0; curFreq = 0.0;
  ampEnv = 0.0; filtEnv = 0.0; gate = 0; note = -1; atkPhase = false;
  lp1 = 0.0; lp2 = 0.0; lp3 = 0.0; lp4 = 0.0;
  dcX = 0.0; dcY = 0.0;
  params[P_CUTOFF] = 0.45;
  params[P_RESO]   = 0.40;
  params[P_ENVAMT] = 0.60;
  params[P_RING]   = 0.30;
  params[P_DETUNE] = 0.30;
  params[P_DECAY]  = 0.45;
  params[P_LEVEL]  = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// PolyBLEP correction term — subtracted/added at each waveform discontinuity to
// band-limit the naive saw/pulse/square so they stay smooth and analog instead
// of buzzy/aliased digital. t = phase (0..1), dt = phase increment per sample.
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

// Fast f32 tanh (rational Padé) — warms the ladder feedback and glues the
// output, staying in f32 the whole way.
@inline function tanhf(x: f32): f32 {
  if (x > 4.0) return 1.0;
  if (x < -4.0) return -1.0;
  const x2: f32 = x * x;
  const num: f32 = x * (135135.0 + x2 * (17325.0 + x2 * (378.0 + x2)));
  const den: f32 = 135135.0 + x2 * (62370.0 + x2 * (3150.0 + x2 * 28.0));
  let r: f32 = num / den;
  if (r > 1.0) r = 1.0; else if (r < -1.0) r = -1.0;
  return r;
}

// Host passes frequency in Hz.
export function noteOn(id: i32, f: f32, v: f32): void {
  note = id;
  targetFreq = f;
  if (curFreq <= 0.0) curFreq = f;   // first note: no glide from silence
  gate = 1;
  atkPhase = true;                   // retrigger the filter pluck
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmt:  f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const ringN:   f32 = clampf(params[P_RING],   0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // glide coefficient — longer glide at higher Detune feel is NOT desired;
  // keep a fixed musical portamento (~25 ms).
  const glide: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.025 * sampleRate)));

  // detune VCO2 up by up to ~+0.6 semitone (musical fattening, not a chord)
  const detRatio: f32 = f32(Mathf.pow(2.0, (detuneN * 0.6) / 12.0));

  // envelope decay/release time: 40 ms .. ~2.2 s
  const decaySec: f32 = 0.04 + decayN * decayN * 2.2;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decaySec * sampleRate)));
  // fast attack (~3 ms)
  const atkCoef: f32 = f32(Mathf.exp(-1.0 / (0.003 * sampleRate)));

  // base cutoff 60 .. 11000 Hz (exponential)
  const baseHz: f32 = f32(60.0 * Mathf.pow(183.0, cutoffN)); // 60 * 183 ~= 11000
  // resonance feedback 0..~4 (self-oscillation near top)
  const reso: f32 = resoN * 4.2;

  const ringAmt: f32 = ringN;
  const dryAmt: f32 = 1.0 - 0.6 * ringN; // ring crowds the dry a touch as it comes up
  // resonance robs the low end; lift the drive a touch as reso climbs so the
  // voice stays fat instead of thinning out.
  const resComp: f32 = 1.0 + 0.6 * resoN;

  // VCO2 pulse duty — slightly narrower than square for a richer, hollow-reedy
  // tone with more body than a plain 50% square.
  const DUTY: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    // --- glide pitch ---
    curFreq += glide * (targetFreq - curFreq);
    const inc1: f32 = curFreq / sampleRate;
    const inc2: f32 = (curFreq * detRatio) / sampleRate;
    const incSub: f32 = (curFreq * 0.5) / sampleRate;

    // --- oscillators (all PolyBLEP band-limited: no aliasing / digital buzz) ---
    ph1 += inc1; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += inc2; if (ph2 >= 1.0) ph2 -= 1.0;
    phSub += incSub; if (phSub >= 1.0) phSub -= 1.0;

    // VCO1: band-limited saw
    let saw: f32 = ph1 * 2.0 - 1.0;
    saw -= polyBlep(ph1, inc1);

    // VCO2: band-limited pulse (two edges: rising at 0, falling at DUTY)
    let pulse: f32 = ph2 < DUTY ? 1.0 : -1.0;
    pulse += polyBlep(ph2, inc2);
    let ph2b: f32 = ph2 - DUTY; if (ph2b < 0.0) ph2b += 1.0;
    pulse -= polyBlep(ph2b, inc2);

    // square sub one octave down, band-limited then tamed
    let sub: f32 = phSub < 0.5 ? 1.0 : -1.0;
    sub += polyBlep(phSub, incSub);
    let phSubB: f32 = phSub - 0.5; if (phSubB < 0.0) phSubB += 1.0;
    sub -= polyBlep(phSubB, incSub);
    sub *= 0.7; // slightly tamed

    // --- ring modulation of the two (band-limited) VCOs ---
    const ring: f32 = saw * pulse;                    // clangy product

    // dry oscillator blend
    const dry: f32 = 0.55 * saw + 0.45 * pulse;
    let mix: f32 = dryAmt * dry + ringAmt * ring + 0.5 * sub;
    mix *= 0.6 * resComp; // headroom before the filter (+ resonance make-up)

    // --- envelopes ---
    if (gate) {
      // amp: fast attack toward 1 and hold (sustain)
      ampEnv = ampEnv + (1.0 - atkCoef) * (1.0 - ampEnv);
      // filter env: snap up to 1, then decay toward a 0.30 sustain floor for
      // the classic plucky sweep even on held notes.
      if (atkPhase) {
        filtEnv = filtEnv + (1.0 - atkCoef) * (1.0 - filtEnv);
        if (filtEnv > 0.96) atkPhase = false;
      } else {
        filtEnv = 0.30 + (filtEnv - 0.30) * decCoef;
      }
    } else {
      ampEnv *= decCoef;
      filtEnv *= decCoef;
    }

    // --- filter cutoff with envelope ---
    let fcHz: f32 = baseHz * f32(Mathf.pow(40.0, envAmt * filtEnv));
    if (fcHz > sampleRate * 0.45) fcHz = sampleRate * 0.45;
    if (fcHz < 20.0) fcHz = 20.0;
    // one-pole coefficient per stage
    let g: f32 = f32(1.0 - Mathf.exp(-PI2 * fcHz / sampleRate));
    if (g > 0.99) g = 0.99;

    // --- resonant 4-pole ladder ---
    let inp: f32 = mix - reso * lp4;
    // tanh drive in the feedback loop — the warm, singing analog character
    // (and it keeps the resonance stable near self-oscillation).
    inp = tanhf(inp);
    lp1 += g * (inp - lp1);
    lp2 += g * (lp1 - lp2);
    lp3 += g * (lp2 - lp3);
    lp4 += g * (lp3 - lp4);

    let voice: f32 = lp4 * ampEnv;

    // --- DC blocker ---
    const dc: f32 = voice - dcX + 0.995 * dcY;
    dcX = voice;
    dcY = dc;
    voice = dc;

    // output gain stage — gentle tanh glue/limit instead of a hard clip
    let s: f32 = tanhf(voice * level * 1.7);
    if (s > 1.0) s = 1.0; else if (s < -1.0) s = -1.0;

    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
