// =====================================================================
//  PATCH MONO — semi-modular monophonic synth voice
//  An original take on the classic patchable mono: two slightly detuned
//  oscillators (saw / pulse / triangle blend) with an optional ring-mod
//  flavour, feeding the characteristic AGGRESSIVE two-stage resonant
//  filter — a state-variable high-pass followed by a Sallen-Key-style
//  resonant low-pass that can self-oscillate and SCREAM. An ADSR drives
//  the amplitude and (by EnvAmount) the low-pass cutoff, with a touch of
//  pre-filter drive. Last-note priority. Pure algorithm, no samples.
//
//  Signal path per note:
//    osc1 + osc2 (detuned, ring-flavoured) -> drive
//      -> resonant HP -> resonant LP (Sallen-Key) -> ADSR amp -> level
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_OSCMIX:  i32 = 0; // 0 = osc1 only .. 1 = osc2 only (with ring blend in the middle)
const P_DETUNE:  i32 = 1; // 0..1 -> 0..~35 cents detune of osc2
const P_LPCUT:   i32 = 2; // low-pass cutoff 0..1 (exp)
const P_HPCUT:   i32 = 3; // high-pass cutoff 0..1 (exp)
const P_RESO:    i32 = 4; // resonance 0..1 (drives both filters toward scream)
const P_ENVAMT:  i32 = 5; // envelope -> LP cutoff amount 0..1
const P_ATTACK:  i32 = 6; // attack time 0..1
const P_RELEASE: i32 = 7; // release time 0..1

// ---- voice state ----
let phase1: f32 = 0.0;   // osc1 phase 0..1
let phase2: f32 = 0.0;   // osc2 phase 0..1
let freq:   f32 = 0.0;   // current note frequency (Hz)
let gate:   i32 = 0;     // 1 while a note is held
let note:   i32 = -1;    // currently sounding note id
let vel:    f32 = 0.0;   // velocity 0..1 of the current note

// ADSR
let env:    f32 = 0.0;   // current amp envelope level 0..1
let stage:  i32 = 0;     // 0 idle, 1 attack, 2 decay/sustain hold, 3 release

// state-variable high-pass state (resonant)
let hpLp: f32 = 0.0;     // hp integrator low state
let hpBp: f32 = 0.0;     // hp integrator band state

// Sallen-Key resonant low-pass state (two cascaded one-poles + feedback)
let lp1: f32 = 0.0;
let lp2: f32 = 0.0;

// DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase1 = 0.0; phase2 = 0.0;
  freq = 0.0; gate = 0; note = -1; vel = 0.0;
  env = 0.0; stage = 0;
  hpLp = 0.0; hpBp = 0.0;
  lp1 = 0.0; lp2 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_OSCMIX]  = 0.4;
  params[P_DETUNE]  = 0.25;
  params[P_LPCUT]   = 0.55;
  params[P_HPCUT]   = 0.05;
  params[P_RESO]    = 0.6;
  params[P_ENVAMT]  = 0.55;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish saturator: keeps self-oscillation screaming but finite
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Last-note priority; new notes (re)trigger ADSR.
export function noteOn(id: i32, f: f32, v: f32): void {
  freq = f > 0.0 ? f : 0.0001;
  note = id;
  gate = 1;
  vel = clampf(v, 0.0, 1.0);
  stage = 1; // (re)start attack — env continues from where it is for smoothness
}

export function noteOff(id: i32): void {
  if (id == note) {
    gate = 0;
    stage = 3; // enter release
  }
}

export function process(n: i32): void {
  const oscMix:  f32 = clampf(params[P_OSCMIX],  0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE],  0.0, 1.0);
  const lpCutN:  f32 = clampf(params[P_LPCUT],   0.0, 1.0);
  const hpCutN:  f32 = clampf(params[P_HPCUT],   0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],    0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT],  0.0, 1.0);
  const attackN: f32 = clampf(params[P_ATTACK],  0.0, 1.0);
  const releaseN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);

  const nyq: f32 = sampleRate * 0.5;

  // ---- ADSR coefficients ----
  // Attack: ~1 ms .. ~1.5 s (linear ramp rate per sample toward 1.0).
  const attackSec: f32 = 0.001 + attackN * attackN * 1.5;
  const attackRate: f32 = f32(1.0 / (attackSec * sampleRate));
  // Decay to sustain while held (fixed musical decay), sustain level fixed.
  const sustain: f32 = 0.72;
  const decaySec: f32 = 0.18;
  const decayCoef: f32 = f32(Mathf.exp(-1.0 / (decaySec * sampleRate)));
  // Release: ~5 ms .. ~2.2 s exponential toward 0.
  const releaseSec: f32 = 0.005 + releaseN * releaseN * 2.2;
  const releaseCoef: f32 = f32(Mathf.exp(-1.0 / (releaseSec * sampleRate)));

  // ---- oscillator detune ----
  // osc2 detuned up by up to ~35 cents -> ratio = 2^(cents/1200).
  const cents: f32 = detuneN * 35.0;
  const ratio: f32 = f32(Mathf.exp(cents * 0.00057762265)); // ln(2)/1200
  const inc1: f32 = clampf(freq / sampleRate, 0.0, 0.49);
  const inc2: f32 = clampf((freq * ratio) / sampleRate, 0.0, 0.49);

  // ---- oscillator blend weights ----
  // OscMix crossfades osc1 -> osc2; the centre region adds ring-mod flavour.
  const w1: f32 = 1.0 - oscMix;
  const w2: f32 = oscMix;
  // ring amount peaks mid-mix (where both oscs are present), fades at extremes.
  const ringAmt: f32 = 4.0 * oscMix * (1.0 - oscMix) * 0.6;

  // ---- filter base coefficients ----
  // Low-pass base cutoff: ~60 Hz .. ~12 kHz (exponential, musical).
  const lpBaseHz: f32 = f32(60.0 * Mathf.exp(lpCutN * 5.3)); // 60 * e^5.3 ~ 12000
  // High-pass cutoff: ~20 Hz .. ~2.4 kHz (exponential).
  const hpHz: f32 = f32(20.0 * Mathf.exp(hpCutN * 4.8));     // 20 * e^4.8 ~ 2400

  // Resonance: shared scream control. Map to feedback for both stages.
  // Push close to (but below) self-oscillation; satf bounds it at max.
  const reso: f32 = resoN;
  const lpFb: f32 = 0.2 + reso * 3.4;   // LP feedback 0.2 .. 3.6
  const hpRes: f32 = 0.5 + reso * 1.4;  // HP resonance (damping inverse)

  // HP coefficient (state-variable). Pre-warp the cutoff frequency.
  let hpF: f32 = f32(2.0 * Mathf.sin(PI * clampf(hpHz / sampleRate, 0.0, 0.49)));
  const hpDamp: f32 = clampf(1.0 / hpRes, 0.05, 2.0);

  // Envelope -> LP cutoff sweep span (Hz) on top of the base.
  const sweepSpan: f32 = envAmtN * 9000.0;

  // pre-filter drive
  const drive: f32 = 1.0 + reso * 0.8;

  for (let i = 0; i < n; i++) {
    // ---- ADSR ----
    if (stage == 1) {
      env += attackRate;
      if (env >= 1.0) { env = 1.0; stage = 2; }
    } else if (stage == 2) {
      env = sustain + (env - sustain) * decayCoef; // decay toward sustain
    } else if (stage == 3) {
      env *= releaseCoef;
      if (env < 0.00002) { env = 0.0; stage = 0; }
    }

    // ---- oscillators ----
    phase1 += inc1; if (phase1 >= 1.0) phase1 -= 1.0;
    phase2 += inc2; if (phase2 >= 1.0) phase2 -= 1.0;

    // osc1: saw
    const saw1: f32 = phase1 * 2.0 - 1.0;
    // osc2: pulse (25% duty) with a triangle undertone for body
    const pulse2: f32 = phase2 < 0.5 ? 1.0 : -1.0;
    const tri2: f32 = (phase2 < 0.5 ? (phase2 * 4.0 - 1.0) : (3.0 - phase2 * 4.0));
    const osc2: f32 = pulse2 * 0.7 + tri2 * 0.3;

    // ring-mod flavour: product of the two oscillators, blended in mid-mix
    const ring: f32 = saw1 * osc2;
    let osc: f32 = saw1 * w1 + osc2 * w2 + ring * ringAmt;
    osc *= drive;

    // ---- envelope-modulated low-pass cutoff ----
    let lpHz: f32 = lpBaseHz + sweepSpan * env;
    if (lpHz < 20.0) lpHz = 20.0;
    if (lpHz > nyq * 0.49) lpHz = nyq * 0.49;
    const lpF: f32 = f32(2.0 * Mathf.sin(PI * clampf(lpHz / sampleRate, 0.0, 0.49)));

    // ---- resonant state-variable HIGH-PASS ----
    // standard SVF: hp = in - lp - damp*bp ; bp += f*hp ; lp += f*bp
    const hp: f32 = osc - hpLp - hpDamp * hpBp;
    hpBp += hpF * hp;
    hpBp = satf(hpBp);              // bound the band-pass state
    hpLp += hpF * hpBp;
    // the high-passed signal is `hp`
    let x: f32 = hp;

    // ---- resonant Sallen-Key style LOW-PASS (two one-poles + feedback) ----
    const fb: f32 = lpFb * satf(lp2);
    const drv: f32 = satf(x - fb);  // feedback subtracted then soft-clipped
    lp1 += lpF * (drv - lp1);
    lp2 += lpF * (lp1 - lp2);
    let y: f32 = lp2;

    // saturate the resonant output for analog warmth + hard safety
    y = satf(y * 1.3);

    // ---- amp envelope + velocity ----
    let s: f32 = y * env * (0.5 + 0.5 * vel);

    // DC blocker
    const yo: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = yo;
    s = yo;

    // final headroom guard
    s = satf(s * 1.1) * 0.8;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
