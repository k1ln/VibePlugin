// =====================================================================
//  PATCH 2600 — semi-modular monophonic synth voice
//  An original tribute to the patchable "bench" synths of the early
//  seventies: THREE oscillators (saw / pulse / triangle) spread by a
//  shared Detune, optionally cross-multiplied by a RING MODULATOR for
//  metallic clangor, summed into an aggressive resonant low-pass with
//  pre-filter drive. A dedicated FILTER ADSR (scaled by FilterEnvAmt)
//  sweeps the cutoff while a separate AMP ADSR shapes the level. Glide
//  (portamento) slews pitch between notes; last-note priority.
//
//  Signal path per note:
//    osc1(saw) + osc2(pulse) + osc3(tri)  [+ ringmod]
//      -> drive -> resonant low-pass (filter-env swept) -> amp env -> level
//  Pure algorithm, no samples, no imports. All math in f32.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_DETUNE:  i32 = 0; // 0..1 -> osc spread in cents
const P_RINGMOD: i32 = 1; // 0 or 1 (step) -> engage ring modulator
const P_CUTOFF:  i32 = 2; // 0..1 -> low-pass base cutoff (exp)
const P_RESO:    i32 = 3; // 0..1 -> resonance toward self-oscillation
const P_ENVAMT:  i32 = 4; // 0..1 -> filter-env -> cutoff sweep amount
const P_ATTACK:  i32 = 5; // 0..1 -> attack time (both envelopes)
const P_RELEASE: i32 = 6; // 0..1 -> release time (both envelopes)
const P_GLIDE:   i32 = 7; // 0..1 -> portamento time
const P_LEVEL:   i32 = 8; // 0..1 -> output level

// ---- voice state ----
let phase1: f32 = 0.0;    // saw  phase 0..1
let phase2: f32 = 0.0;    // pulse phase 0..1
let phase3: f32 = 0.0;    // tri   phase 0..1
let phaseR: f32 = 0.0;    // ring carrier phase 0..1
let targetFreq: f32 = 0.0; // note frequency goal (Hz)
let glideFreq:  f32 = 0.0; // current (slewed) frequency (Hz)
let gate:  i32 = 0;       // 1 while a note is held
let note:  i32 = -1;      // currently sounding note id
let vel:   f32 = 0.0;     // velocity 0..1 of the current note

// amp ADSR
let ampEnv:   f32 = 0.0;
let ampStage: i32 = 0;    // 0 idle, 1 attack, 2 decay/sustain, 3 release

// filter ADSR
let filEnv:   f32 = 0.0;
let filStage: i32 = 0;

// resonant low-pass state (two cascaded one-poles + feedback)
let lp1: f32 = 0.0;
let lp2: f32 = 0.0;

// DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase1 = 0.0; phase2 = 0.0; phase3 = 0.0; phaseR = 0.0;
  targetFreq = 0.0; glideFreq = 0.0;
  gate = 0; note = -1; vel = 0.0;
  ampEnv = 0.0; ampStage = 0;
  filEnv = 0.0; filStage = 0;
  lp1 = 0.0; lp2 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_DETUNE]  = 0.30;
  params[P_RINGMOD] = 0.0;
  params[P_CUTOFF]  = 0.50;
  params[P_RESO]    = 0.45;
  params[P_ENVAMT]  = 0.55;
  params[P_ATTACK]  = 0.05;
  params[P_RELEASE] = 0.35;
  params[P_GLIDE]   = 0.20;
  params[P_LEVEL]   = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 9; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish saturator: keeps resonance screaming but finite
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Last-note priority; new notes (re)trigger ADSR.
export function noteOn(id: i32, f: f32, v: f32): void {
  targetFreq = f > 0.0 ? f : 0.0001;
  // First note of the session glides up from a low pitch so Glide is audible.
  if (glideFreq <= 0.0) glideFreq = targetFreq * 0.5;
  note = id;
  gate = 1;
  vel = clampf(v, 0.0, 1.0);
  ampStage = 1;
  filStage = 1;
}

export function noteOff(id: i32): void {
  if (id == note) {
    gate = 0;
    ampStage = 3;
    filStage = 3;
  }
}

export function process(n: i32): void {
  const detuneN:  f32 = clampf(params[P_DETUNE],  0.0, 1.0);
  const ringOn:   bool = params[P_RINGMOD] >= 0.5;
  const cutoffN:  f32 = clampf(params[P_CUTOFF],  0.0, 1.0);
  const resoN:    f32 = clampf(params[P_RESO],    0.0, 1.0);
  const envAmtN:  f32 = clampf(params[P_ENVAMT],  0.0, 1.0);
  const attackN:  f32 = clampf(params[P_ATTACK],  0.0, 1.0);
  const releaseN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const glideN:   f32 = clampf(params[P_GLIDE],   0.0, 1.0);
  const level:    f32 = clampf(params[P_LEVEL],   0.0, 1.0) * 0.9;

  const nyq: f32 = sampleRate * 0.5;

  // ---- ADSR coefficients (shared attack/release; fixed musical D/S) ----
  const attackSec: f32 = 0.001 + attackN * attackN * 1.5;
  const attackRate: f32 = f32(1.0 / (attackSec * sampleRate));
  const sustain: f32 = 0.72;
  const decaySec: f32 = 0.20;
  const decayCoef: f32 = f32(Mathf.exp(-1.0 / (decaySec * sampleRate)));
  const releaseSec: f32 = 0.005 + releaseN * releaseN * 2.5;
  const releaseCoef: f32 = f32(Mathf.exp(-1.0 / (releaseSec * sampleRate)));
  // filter env decays a touch faster/lower for a snappy "pluck" on the cutoff
  const filSustain: f32 = 0.35;
  const filDecaySec: f32 = 0.30;
  const filDecayCoef: f32 = f32(Mathf.exp(-1.0 / (filDecaySec * sampleRate)));

  // ---- oscillator detune spread (cents). osc1 centred, osc2 up, osc3 down ----
  const cents: f32 = detuneN * 24.0;
  const ratioUp:   f32 = f32(Mathf.exp(cents * 0.00057762265));      // ln(2)/1200
  const ratioDown: f32 = f32(Mathf.exp(-cents * 0.00057762265));

  // ---- glide coefficient: 0 = instant, up to ~0.4 s slew ----
  const glideSec: f32 = glideN * glideN * 0.4;
  const glideCoef: f32 = glideSec > 0.00001
    ? f32(Mathf.exp(-1.0 / (glideSec * sampleRate)))
    : 0.0;

  // ---- filter base cutoff: ~50 Hz .. ~13 kHz (exponential) ----
  const cutBaseHz: f32 = f32(50.0 * Mathf.exp(cutoffN * 5.55)); // 50 * e^5.55 ~ 12900
  const reso: f32 = resoN;
  const lpFb: f32 = 0.15 + reso * 3.6;     // feedback toward self-oscillation
  const sweepSpan: f32 = envAmtN * 10000.0; // env -> cutoff sweep (Hz)
  const drive: f32 = 1.0 + reso * 0.7 + detuneN * 0.3; // pre-filter drive

  for (let i = 0; i < n; i++) {
    // ---- glide (portamento) toward target frequency ----
    glideFreq = targetFreq + (glideFreq - targetFreq) * glideCoef;
    const freq: f32 = glideFreq;

    // ---- amp ADSR ----
    if (ampStage == 1) {
      ampEnv += attackRate;
      if (ampEnv >= 1.0) { ampEnv = 1.0; ampStage = 2; }
    } else if (ampStage == 2) {
      ampEnv = sustain + (ampEnv - sustain) * decayCoef;
    } else if (ampStage == 3) {
      ampEnv *= releaseCoef;
      if (ampEnv < 0.00002) { ampEnv = 0.0; ampStage = 0; }
    }

    // ---- filter ADSR ----
    if (filStage == 1) {
      filEnv += attackRate;
      if (filEnv >= 1.0) { filEnv = 1.0; filStage = 2; }
    } else if (filStage == 2) {
      filEnv = filSustain + (filEnv - filSustain) * filDecayCoef;
    } else if (filStage == 3) {
      filEnv *= releaseCoef;
      if (filEnv < 0.00002) { filEnv = 0.0; filStage = 0; }
    }

    // ---- oscillator phases ----
    const inc1: f32 = clampf(freq / sampleRate, 0.0, 0.49);
    const inc2: f32 = clampf((freq * ratioUp) / sampleRate, 0.0, 0.49);
    const inc3: f32 = clampf((freq * ratioDown) / sampleRate, 0.0, 0.49);
    const incR: f32 = clampf((freq * 1.5) / sampleRate, 0.0, 0.49); // ring carrier

    phase1 += inc1; if (phase1 >= 1.0) phase1 -= 1.0;
    phase2 += inc2; if (phase2 >= 1.0) phase2 -= 1.0;
    phase3 += inc3; if (phase3 >= 1.0) phase3 -= 1.0;
    phaseR += incR; if (phaseR >= 1.0) phaseR -= 1.0;

    // osc1: saw
    const saw: f32 = phase1 * 2.0 - 1.0;
    // osc2: pulse (40% duty)
    const pulse: f32 = phase2 < 0.4 ? 1.0 : -1.0;
    // osc3: triangle
    const tri: f32 = phase3 < 0.5 ? (phase3 * 4.0 - 1.0) : (3.0 - phase3 * 4.0);

    let oscSum: f32 = saw * 0.5 + pulse * 0.32 + tri * 0.42;

    // ---- ring modulator: cross-multiply the osc sum by a sine carrier ----
    if (ringOn) {
      const ringCar: f32 = Mathf.sin(phaseR * (2.0 * PI));
      const ringed: f32 = oscSum * ringCar;
      oscSum = oscSum * 0.35 + ringed * 0.95; // metallic clangor blended in
    }

    oscSum *= drive;

    // ---- filter-env modulated cutoff ----
    let cutHz: f32 = cutBaseHz + sweepSpan * filEnv;
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;
    const lpF: f32 = f32(2.0 * Mathf.sin(PI * clampf(cutHz / sampleRate, 0.0, 0.49)));

    // ---- resonant low-pass (two one-poles + feedback) ----
    const fb: f32 = lpFb * satf(lp2);
    const drv: f32 = satf(oscSum - fb);
    lp1 += lpF * (drv - lp1);
    lp2 += lpF * (lp1 - lp2);
    let y: f32 = satf(lp2 * 1.25);

    // ---- amp envelope + velocity ----
    let s: f32 = y * ampEnv * (0.55 + 0.45 * vel) * level;

    // DC blocker
    const yo: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = yo;
    s = yo;

    // final headroom guard (peak < ~1.0)
    s = satf(s * 1.05) * 0.82;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
