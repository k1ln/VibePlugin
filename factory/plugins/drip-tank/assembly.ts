// =====================================================================
//  DRIP TANK — drippy outboard spring reverb tank (effect)
//
//  Models the long, boingy "surf amp" spring sound of an outboard spring
//  tank: 3 parallel spring lines, each a CHAIN of allpass filters
//  (dispersive — high frequencies travel faster than low, giving the
//  characteristic chirpy "drip / boing" + flutter) feeding a short
//  damped delay loop. A transient detector drives an "excite/boing"
//  burst into the tank so hard hits visibly boing. Tone tilts the loop
//  damping dark->bright; Dwell sets the send level into the tank; Decay
//  sets the loop feedback (bounded < 1, never runaway).
//
//  Pure algorithm — no samples. All f32, no alloc in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const P_MIX:   i32 = 0;   // 0..1 dry/wet
const P_DWELL: i32 = 1;   // 0..1 send/level into the tank
const P_BOING: i32 = 2;   // 0..1 excitation / drip intensity
const P_TONE:  i32 = 3;   // 0..1 dark -> bright (loop damping)
const P_DECAY: i32 = 4;   // 0..1 tail length (loop feedback)

const PI: f32 = 3.14159265358979;

// ---- spring lines: 3 per channel, each = allpass chain + delay loop ----
const NUM_SPRINGS: i32 = 3;
const AP_PER_SPRING: i32 = 8;          // dispersive allpass chain length
const TOTAL_AP: i32 = NUM_SPRINGS * AP_PER_SPRING; // 24 per channel

// allpass state (one-sample, per allpass): we keep the input and output history
const apX: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * TOTAL_AP); // last input
const apY: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * TOTAL_AP); // last output
const apG: StaticArray<f32> = new StaticArray<f32>(NUM_SPRINGS * AP_PER_SPRING); // coeffs (shared L/R)

// delay loop per spring (the "tank length" / boing repeat)
const DLEN: i32 = 4096;                 // power-of-two delay buffer per spring line
const DMASK: i32 = DLEN - 1;
const delayBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_SPRINGS * DLEN);
const delayPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_SPRINGS);
const springDelay: StaticArray<i32> = new StaticArray<i32>(NUM_SPRINGS); // loop length in samples
const dampState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_SPRINGS); // loop LP state

// transient / excite detector (per channel)
const envFast: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const envSlow: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const boingEnv: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // decaying excite burst

// input conditioning + output de-mud filters (per channel)
const preHP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);   // remove DC/lows before tank
const outLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);   // tame fizz on the wet

// telemetry for the GUI (last block peak of wet signal)
let wetPeak: f32 = 0.0;
let boingMeter: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  for (let i = 0; i < MAX_CHANNELS * TOTAL_AP; i++) { apX[i] = 0.0; apY[i] = 0.0; }
  for (let i = 0; i < MAX_CHANNELS * NUM_SPRINGS * DLEN; i++) { delayBuf[i] = 0.0; }
  for (let i = 0; i < MAX_CHANNELS * NUM_SPRINGS; i++) { delayPos[i] = 0; dampState[i] = 0.0; }
  for (let c = 0; c < MAX_CHANNELS; c++) {
    envFast[c] = 0.0; envSlow[c] = 0.0; boingEnv[c] = 0.0;
    preHP[c] = 0.0; outLP[c] = 0.0;
  }

  // dispersive allpass coefficients: alternate sign + spread of values gives
  // the chirpy frequency-dependent delay that makes the "drip". Each spring
  // gets slightly different coeffs so the three lines are detuned.
  for (let s = 0; s < NUM_SPRINGS; s++) {
    const det: f32 = 1.0 + f32(s) * 0.13;
    for (let k = 0; k < AP_PER_SPRING; k++) {
      const idx: i32 = s * AP_PER_SPRING + k;
      // coefficients near +/-0.6, alternating, scaled by detune
      const base: f32 = 0.62 - f32(k) * 0.018;
      const sign: f32 = (k & 1) == 0 ? 1.0 : -1.0;
      apG[idx] = clampf(sign * base * (det > 1.4 ? 1.4 / det : 1.0), -0.85, 0.85);
    }
  }

  // spring loop lengths in samples — short, slightly different per line so the
  // boings repeat at musically-close but distinct rates (the "tank" character).
  const baseMs: f32 = 21.0; // ~21 ms base round-trip
  for (let s = 0; s < NUM_SPRINGS; s++) {
    const ms: f32 = baseMs + f32(s) * 6.5;
    let d: i32 = i32(ms * 0.001 * sampleRate);
    if (d < 16) d = 16;
    if (d > DLEN - 4) d = DLEN - 4;
    springDelay[s] = d;
  }

  params[P_MIX] = 0.35; params[P_DWELL] = 0.55; params[P_BOING] = 0.5;
  params[P_TONE] = 0.45; params[P_DECAY] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// telemetry getters for the GUI animation
export function getWetPeak(): f32  { return wetPeak; }
export function getBoing(): f32    { return boingMeter; }

// one dispersive allpass: y = -g*x + xPrev + g*yPrev  (first-order allpass)
@inline function allpass(ch: i32, idx: i32, x: f32): f32 {
  const si: i32 = ch * TOTAL_AP + idx;
  const g: f32 = apG[idx];
  const xPrev: f32 = apX[si];
  const yPrev: f32 = apY[si];
  const y: f32 = f32(-g * x + xPrev + g * yPrev);
  apX[si] = x;
  apY[si] = y;
  return y;
}

export function process(n: i32): void {
  const mix: f32   = clampf(params[P_MIX], 0.0, 1.0);
  const dwell: f32 = clampf(params[P_DWELL], 0.0, 1.0);
  const boing: f32 = clampf(params[P_BOING], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);

  // pre high-pass corner ~140 Hz (springs hate low end — keeps the tank from booming)
  const cHP: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 140.0 / sampleRate));
  // wet output low-pass: Tone moves brightness 1.8k (dark) -> 8k (bright)
  const toneHz: f32 = 1800.0 + toneN * toneN * 6200.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * toneHz / sampleRate));
  // loop damping LP: darker tone => more damping in the feedback path
  const dampHz: f32 = 2200.0 + toneN * 5000.0;
  const cDamp: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * dampHz / sampleRate));

  // feedback (decay) — strictly < 1 so the tank can never run away
  const fb: f32 = 0.45 + decayN * 0.52;       // 0.45..0.97
  const sendLevel: f32 = dwell * 1.4;          // into the tank
  const exciteAmt: f32 = 0.5 + boing * 2.5;    // transient spike gain

  // transient detector time constants
  const aFast: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.0006 * sampleRate)));
  const aSlow: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.030 * sampleRate)));
  const boingDecay: f32 = f32(Mathf.exp(-1.0 / (0.040 * sampleRate))); // ~40ms boing burst

  // output normalisation: more springs + feedback => scale down to keep peak<~1
  const wetGain: f32 = 0.42;

  let blockPeak: f32 = 0.0;
  let blockBoing: f32 = boingMeter;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32 = preHP[c];
    let lp: f32 = outLP[c];
    let ef: f32 = envFast[c];
    let es: f32 = envSlow[c];
    let be: f32 = boingEnv[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // --- input conditioning: high-pass ---
      hp = hp + cHP * (dry - hp);
      const cond: f32 = dry - hp;

      // --- transient detection -> boing excitation burst ---
      const rect: f32 = cond < 0.0 ? -cond : cond;
      ef = ef + aFast * (rect - ef);
      es = es + aSlow * (rect - es);
      const trans: f32 = ef - es;                 // positive on attacks
      if (trans > 0.02) {
        const hit: f32 = trans * exciteAmt;
        if (hit > be) be = hit;                   // retrigger the burst
      }
      be = be * boingDecay;
      if (be > blockBoing) blockBoing = be;

      // excitation fed into the tank: conditioned signal + a sharp boing spike
      const exc: f32 = (cond + be * (cond >= 0.0 ? 1.0 : -1.0)) * sendLevel;

      // --- run the 3 parallel spring lines ---
      let wet: f32 = 0.0;
      for (let s = 0; s < NUM_SPRINGS; s++) {
        const dBase: i32 = (c * NUM_SPRINGS + s) * DLEN;
        const li: i32 = c * NUM_SPRINGS + s;
        const dlen: i32 = springDelay[s];
        let wp: i32 = delayPos[li];
        const rp: i32 = (wp - dlen) & DMASK;
        const delayed: f32 = delayBuf[dBase + rp];

        // loop damping low-pass in the feedback path
        let ds: f32 = dampState[li];
        ds = ds + cDamp * (delayed - ds);

        // dispersive allpass chain produces the chirpy drip
        let v: f32 = exc + ds * fb;
        for (let k = 0; k < AP_PER_SPRING; k++) {
          v = allpass(c, s * AP_PER_SPRING + k, v);
        }
        // soft saturation in the loop keeps it bounded even at high decay
        if (v > 1.5) v = 1.5; else if (v < -1.5) v = -1.5;
        const vsoft: f32 = f32(v - 0.18 * v * v * v * 0.296296); // gentle cubic limit

        delayBuf[dBase + wp] = vsoft;
        wp = (wp + 1) & DMASK;
        delayPos[li] = wp;
        dampState[li] = ds;

        // weight the three lines slightly differently (stereo spread of character)
        const w: f32 = s == 0 ? 1.0 : (s == 1 ? 0.82 : 0.66);
        wet += vsoft * w;
      }

      wet = wet * wetGain;

      // --- output tone low-pass ---
      lp = lp + cTone * (wet - lp);
      const wetOut: f32 = lp;

      const wpk: f32 = wetOut < 0.0 ? -wetOut : wetOut;
      if (wpk > blockPeak) blockPeak = wpk;

      outBuf[base + f] = dry * (1.0 - mix) + wetOut * mix;
    }

    preHP[c] = hp;
    outLP[c] = lp;
    envFast[c] = ef;
    envSlow[c] = es;
    boingEnv[c] = be;
  }

  wetPeak = blockPeak;
  boingMeter = blockBoing * 0.9; // slow visual decay between blocks
}
