// =====================================================================
//  PEARL REVERB — a bright early-DIGITAL reverb engine
//
//  Original algorithm inspired by the late-1970s first generation of
//  digital studio reverbs: a dense feedback-delay network (FDN) of four
//  comb delays diffused through a chain of allpass sections, with a
//  slightly grainy / sparkly character baked in (a gentle quantiser +
//  sample-rate "grit" + a sparkle high-shelf). Three Programs reshape
//  the tail: Reverb (smooth), Space (longer, wider, more diffuse) and a
//  nonlinear Gate (a dense burst that slams shut). Pure algorithm.
//
//  Params: Mix, Decay, Tone (bright), Pre-Delay, Program (0..2 step 1).
//  Mix = 0 is bit-exact dry. All maths in f32, no alloc in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// ---- param indices (must match spec.json) ---------------------------
const P_MIX: i32 = 0;       // 0..1 dry/wet (0 == dry)
const P_DECAY: i32 = 1;     // 0..1 tail length
const P_TONE: i32 = 2;      // 0..1 dark..bright
const P_PREDELAY: i32 = 3;  // 0..0.15 seconds
const P_PROGRAM: i32 = 4;   // 0,1,2 : Reverb / Space / Gate

// ---- delay-line storage ---------------------------------------------
// All lines are sized for the longest case at 48 kHz-ish rates plus head-
// room; we mod-index so a shorter rate just uses less of each buffer.
const PRE_LEN: i32 = 8192;     // up to ~0.17 s pre-delay @ 48k
const PRE_MASK: i32 = 8191;

// Four parallel comb delays per channel (prime-ish lengths for density).
const NC: i32 = 4;
const COMB_LEN: i32 = 4096;    // max comb length (power of two for masking)
const COMB_MASK: i32 = 4095;

// Three series allpass diffusers per channel.
const NA: i32 = 3;
const AP_LEN: i32 = 2048;
const AP_MASK: i32 = 2047;

const preBuf:  StaticArray<f32> = new StaticArray<f32>(PRE_LEN * MAX_CHANNELS);
const combBuf: StaticArray<f32> = new StaticArray<f32>(COMB_LEN * NC * MAX_CHANNELS);
const apBuf:   StaticArray<f32> = new StaticArray<f32>(AP_LEN * NA * MAX_CHANNELS);

// write heads
const preWrite:  StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const combWrite: StaticArray<i32> = new StaticArray<i32>(NC * MAX_CHANNELS);
const apWrite:   StaticArray<i32> = new StaticArray<i32>(NA * MAX_CHANNELS);

// per-comb damping low-pass state (high-frequency loss in the tail)
const combDamp: StaticArray<f32> = new StaticArray<f32>(NC * MAX_CHANNELS);

// tone shelf state + dc blocker state, per channel
const toneLp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const dcX:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const dcY:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// gate envelope follower + countdown (shared, mono-controlled gate)
let gateEnv: f32 = 0.0;
let gateHold: f32 = 0.0;

// base comb delay lengths (samples @ ~48k) — mutually prime-ish, slightly
// different L/R via the channel spread applied below.
const combBase: StaticArray<i32> = new StaticArray<i32>(NC);
const apBase:   StaticArray<i32> = new StaticArray<i32>(NA);

// effective (rate-scaled) lengths, recomputed in init()
const combDelay: StaticArray<i32> = new StaticArray<i32>(NC * MAX_CHANNELS);
const apDelay:   StaticArray<i32> = new StaticArray<i32>(NA * MAX_CHANNELS);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

@inline function clampi(x: i32, lo: i32, hi: i32): i32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // clear every buffer / state
  for (let i = 0; i < PRE_LEN * MAX_CHANNELS; i++) preBuf[i] = 0.0;
  for (let i = 0; i < COMB_LEN * NC * MAX_CHANNELS; i++) combBuf[i] = 0.0;
  for (let i = 0; i < AP_LEN * NA * MAX_CHANNELS; i++) apBuf[i] = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    preWrite[c] = 0;
    toneLp[c] = 0.0; dcX[c] = 0.0; dcY[c] = 0.0;
    for (let k = 0; k < NC; k++) { combWrite[c * NC + k] = 0; combDamp[c * NC + k] = 0.0; }
    for (let k = 0; k < NA; k++) apWrite[c * NA + k] = 0;
  }
  gateEnv = 0.0; gateHold = 0.0;

  // base lengths chosen for density without obvious flutter
  combBase[0] = 1687; combBase[1] = 1997; combBase[2] = 2389; combBase[3] = 2797;
  apBase[0] = 419; apBase[1] = 263; apBase[2] = 149;

  // scale to actual sample rate, give R a small spread for width
  const scale: f32 = sampleRate / 48000.0;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    const spread: f32 = c == 1 ? 1.037 : 1.0;   // detune the right field slightly
    for (let k = 0; k < NC; k++) {
      let d: i32 = i32(f32(combBase[k]) * scale * spread);
      combDelay[c * NC + k] = clampi(d, 8, COMB_MASK - 1);
    }
    for (let k = 0; k < NA; k++) {
      let d: i32 = i32(f32(apBase[k]) * scale * spread);
      apDelay[c * NA + k] = clampi(d, 4, AP_MASK - 1);
    }
  }

  // sensible defaults
  params[P_MIX] = 0.3;
  params[P_DECAY] = 0.6;
  params[P_TONE] = 0.65;
  params[P_PREDELAY] = 0.012;
  params[P_PROGRAM] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// one allpass section (Schroeder), reads/writes its own slot of apBuf
@inline function allpass(ch: i32, idx: i32, x: f32, g: f32): f32 {
  const base: i32 = (ch * NA + idx) * AP_LEN;
  const w: i32 = apWrite[ch * NA + idx];
  const d: i32 = apDelay[ch * NA + idx];
  const r: i32 = (w - d) & AP_MASK;
  const buffered: f32 = apBuf[base + r];
  const input: f32 = x + buffered * g;
  apBuf[base + (w & AP_MASK)] = input;
  apWrite[ch * NA + idx] = (w + 1) & AP_MASK;
  return f32(buffered - input * g);
}

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Mix == 0 => bit-exact dry passthrough (cheap, and the spec requires it).
  if (mix <= 0.0) {
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      for (let f = 0; f < n; f++) outBuf[base + f] = inBuf[base + f];
    }
    return;
  }

  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const preSec: f32 = clampf(params[P_PREDELAY], 0.0, 0.15);
  let prog: i32 = i32(params[P_PROGRAM] + 0.5);
  prog = clampi(prog, 0, 2);

  // pre-delay in samples
  let preD: i32 = i32(preSec * sampleRate);
  preD = clampi(preD, 0, PRE_MASK - 1);

  // Program shaping ----------------------------------------------------
  //  0 Reverb : balanced feedback, moderate diffusion
  //  1 Space  : longer feedback, extra size, very diffuse + wide
  //  2 Gate   : dense but feedback kept low; an envelope gate chops the tail
  let fbBase: f32 = 0.78 + decayN * 0.20;        // 0.78..0.98
  let sizeMul: f32 = 1.0;
  let apG: f32 = 0.62;
  let gateMode: bool = false;
  if (prog == 1) {
    fbBase = 0.84 + decayN * 0.149;              // up to ~0.989 = long
    sizeMul = 1.0;
    apG = 0.70;                                   // more diffusion
  } else if (prog == 2) {
    fbBase = 0.55 + decayN * 0.30;               // dense early energy, not endless
    apG = 0.66;
    gateMode = true;
  }
  fbBase = clampf(fbBase, 0.0, 0.991);

  // damping: Tone bright => less HF loss in tail. coeff is a one-pole LP amt.
  // dampAmt near 1 = bright (little smoothing), near 0 = dark.
  const dampAmt: f32 = 0.18 + toneN * toneN * 0.80;   // 0.18..0.98
  // sparkle high-shelf strength on the wet output (early-digital "air")
  const sparkle: f32 = 0.15 + toneN * 0.55;

  // output tone tilt low-pass coeff (post). bright => high cutoff.
  const toneHz: f32 = 1200.0 + toneN * toneN * 12000.0;
  let toneCoeff: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate));
  toneCoeff = clampf(toneCoeff, 0.0, 1.0);

  // dc-blocker coeff
  const dcR: f32 = 0.9985;

  // grainy early-digital quantiser: a coarse-ish step + tiny sample "grit".
  // step gets a touch coarser when darker (older converter feel), but stays
  // subtle so it sparkles rather than distorts.
  const qStep: f32 = 1.0 / (8192.0 + toneN * 24576.0);   // ~13..15 bit
  const invQ: f32 = 1.0 / qStep;

  // gate timing (program 2): a fixed-ish window driven by Decay.
  const gateThresh: f32 = 0.012;
  const holdSamples: f32 = (0.06 + decayN * 0.45) * sampleRate;   // 60..510 ms
  const gateRelease: f32 = f32(Mathf.exp(-1.0 / (0.012 * sampleRate)));  // ~12 ms close
  const gateAttack: f32 = f32(Mathf.exp(-1.0 / (0.0015 * sampleRate))); // fast open

  // overall wet trim so peaks stay < ~1.0 across programs
  const wetTrim: f32 = 0.34;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;

    // load per-channel state into locals
    let pw: i32 = preWrite[c];
    let tlp: f32 = toneLp[c];
    let dx: f32 = dcX[c];
    let dy: f32 = dcY[c];

    for (let f = 0; f < n; f++) {
      const dryIn: f32 = inBuf[base + f];

      // ---- pre-delay ----
      const preBase: i32 = c * PRE_LEN;
      preBuf[preBase + (pw & PRE_MASK)] = dryIn;
      const preRd: i32 = (pw - preD) & PRE_MASK;
      const pre: f32 = preBuf[preBase + preRd];
      pw = (pw + 1) & PRE_MASK;

      // ---- parallel comb bank with per-line damping ----
      let combSum: f32 = 0.0;
      for (let k = 0; k < NC; k++) {
        const ci: i32 = c * NC + k;
        const cbase: i32 = ci * COMB_LEN;
        const cw: i32 = combWrite[ci];
        const cd: i32 = combDelay[ci];
        const cr: i32 = (cw - cd) & COMB_MASK;
        const y: f32 = combBuf[cbase + cr];

        // damp the feedback path (one-pole LP), then feed back
        let dz: f32 = combDamp[ci];
        dz = dz + dampAmt * (y - dz);
        combDamp[ci] = dz;

        const fbIn: f32 = pre + dz * fbBase;
        combBuf[cbase + (cw & COMB_MASK)] = fbIn;
        combWrite[ci] = (cw + 1) & COMB_MASK;

        combSum += y;
      }
      combSum *= 0.25;

      // ---- series allpass diffusion ----
      let dif: f32 = combSum;
      for (let k = 0; k < NA; k++) dif = allpass(c, k, dif, apG);

      // ---- grainy quantiser + grit (early-digital character) ----
      // round to a coarse grid, add a tiny pseudo-random LSB dither.
      let q: f32 = f32(Mathf.floor(dif * invQ + 0.5)) * qStep;
      // cheap deterministic grit from the fractional residue
      const grit: f32 = (dif * invQ - f32(Mathf.floor(dif * invQ))) - 0.5;
      q += grit * qStep * 0.5;

      // ---- sparkle high-shelf: emphasise (x - lowpassed x) ----
      tlp = tlp + toneCoeff * (q - tlp);
      const high: f32 = q - tlp;
      let wet: f32 = tlp + high * (1.0 + sparkle);

      // ---- dc blocker ----
      const dcOut: f32 = wet - dx + dcR * dy;
      dx = wet; dy = dcOut;
      wet = dcOut;

      // ---- gate program: chop the tail with an envelope ----
      if (gateMode) {
        if (c == 0) {
          const env: f32 = wet < 0.0 ? -wet : wet;
          // open on dry transient detected at input
          const trig: f32 = dryIn < 0.0 ? -dryIn : dryIn;
          if (trig > gateThresh) gateHold = holdSamples;
          if (gateHold > 0.0) {
            gateEnv = gateEnv + (1.0 - gateEnv) * (1.0 - gateAttack);
            gateHold -= 1.0;
          } else {
            gateEnv *= gateRelease;
          }
        }
        wet *= gateEnv;
      }

      wet *= wetTrim;

      // ---- mix (equal-ish; Mix==1 still keeps a touch of dry-free wet) ----
      outBuf[base + f] = dryIn * (1.0 - mix) + wet * mix;
    }

    // store state back
    preWrite[c] = pw;
    toneLp[c] = tlp;
    dcX[c] = dx;
    dcY[c] = dy;
  }
}
