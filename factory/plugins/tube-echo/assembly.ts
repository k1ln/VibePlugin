// =====================================================================
//  TUBE ECHO — single-head tape echo with tube-PREAMP warmth
//  (Echoplex EP-3 lineage, an ORIGINAL design)
//
//  Signal: input -> tube preamp warmth/saturation (always on, the famous
//  EP-3 colour, even at 100% dry) -> a single record/play tape head (one
//  delay tap) with a feedback loop. Each repeat is darkened (HF tape loss),
//  soft-saturated on tape, and pitch-wandered by a slow wow + faster flutter
//  LFO. Feedback can build toward bounded self-oscillation. Pure algorithm.
//
//  Params: Time, Feedback, Drive (preamp warmth), Tone (repeat darkening), Mix
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: up to ~1.2s per channel at 48k -> 64k samples is plenty.
const DELAY_LEN: i32 = 65536;          // power of two, ~1.36s @48k
const DELAY_MASK: i32 = DELAY_LEN - 1;
const delay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel state
const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const preLow:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // preamp pre-emph HP state
const toneState:StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // repeat darkening LP
const dcState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // feedback DC blocker
const dcPrev:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const fbSmooth: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // smoothed delay-time read

// modulation phase (shared, mono modulation feels like a single transport)
let wowPhase: f32 = 0.0;
let flutPhase: f32 = 0.0;
let timeSmooth: f32 = 0.0;

const P_TIME: i32 = 0;     // 0..1 -> 40..900 ms
const P_FEEDBACK: i32 = 1; // 0..1 -> 0..1.08 (can self-oscillate, bounded)
const P_DRIVE: i32 = 2;    // 0..1 -> preamp warmth
const P_TONE: i32 = 3;     // 0..1 -> repeat darkening cutoff
const P_MIX: i32 = 4;      // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0; preLow[c] = 0.0; toneState[c] = 0.0;
    dcState[c] = 0.0; dcPrev[c] = 0.0; fbSmooth[c] = 0.0;
  }
  for (let i = 0; i < DELAY_LEN * MAX_CHANNELS; i++) delay[i] = 0.0;
  wowPhase = 0.0; flutPhase = 0.0; timeSmooth = 0.0;
  params[P_TIME] = 0.35; params[P_FEEDBACK] = 0.4; params[P_DRIVE] = 0.4;
  params[P_TONE] = 0.5; params[P_MIX] = 0.4;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Tube-style asymmetric soft saturation. Warm even-harmonic bias + soft knee.
@inline function tubeSat(x: f32, drive: f32): f32 {
  const g: f32 = x * drive;
  // asymmetric: slightly different curvature for +/- gives even harmonics
  let y: f32;
  if (g >= 0.0) {
    y = g / (1.0 + 0.6 * g);
  } else {
    y = g / (1.0 - 0.45 * g);
  }
  // tanh-like rounding on top for graceful ceiling
  const t: f32 = clampf(y, -1.6, 1.6);
  return t - (t * t * t) * f32(0.111111);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32   = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const driveN: f32= clampf(params[P_DRIVE], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32   = clampf(params[P_MIX], 0.0, 1.0);

  // Delay time 40..900 ms
  const targetMs: f32 = 40.0 + timeN * 860.0;
  const targetSamp: f32 = targetMs * 0.001 * sampleRate;

  // Feedback 0..1.08 — bounded but can reach sustained self-oscillation
  const feedback: f32 = fbN * 1.08;

  // Preamp drive: 1..7 gain into the tube stage; compensate to keep level musical
  const drive: f32 = 1.0 + driveN * 6.0;
  const comp: f32 = 1.0 / (1.0 + 0.55 * driveN * 6.0) * 1.7;

  // Repeat darkening: tone closes the LP on the feedback path. 1200..7000 Hz.
  const toneHz: f32 = 1200.0 + toneN * toneN * 5800.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate));

  // Preamp gentle high-shelf-ish pre-emphasis (subtle ~180Hz tilt) for warmth
  const cPre: f32 = f32(1.0 - Mathf.exp(-PI2 * 180.0 / sampleRate));

  // Wow ~0.6 Hz, flutter ~6.5 Hz; depth scaled to samples
  const wowInc: f32 = PI2 * 0.6 / sampleRate;
  const flutInc: f32 = PI2 * 6.5 / sampleRate;
  const wowDepth: f32 = 0.0022 * targetSamp + 1.2;   // samples
  const flutDepth: f32 = 0.0009 * targetSamp + 0.4;  // samples

  // time smoothing coefficient (slew the delay length)
  const cTime: f32 = 0.0008;

  let wp: f32 = wowPhase;
  let fpz: f32 = flutPhase;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * DELAY_LEN;
    let wpos: i32 = writePos[c];
    let pl: f32 = preLow[c];
    let tn: f32 = toneState[c];
    let dcS: f32 = dcState[c];
    let dcP: f32 = dcPrev[c];
    let tsm: f32 = (c == 0) ? timeSmooth : fbSmooth[c];

    // re-init smoothing on first run
    if (tsm <= 0.0) tsm = targetSamp;

    // local copies of modulation phase so both channels stay coherent
    let lw: f32 = wp;
    let lf: f32 = fpz;

    for (let f = 0; f < n; f++) {
      const xin: f32 = inBuf[c * MAX_FRAMES + f];

      // --- Tube preamp warmth (always on, even at 100% dry) ---
      pl = pl + cPre * (xin - pl);
      const emph: f32 = xin + 0.25 * (xin - pl); // mild presence lift pre-tube
      const pre: f32 = tubeSat(emph, drive) * comp;

      // --- modulation: wow + flutter pitch wander ---
      lw += wowInc; if (lw > PI2) lw -= PI2;
      lf += flutInc; if (lf > PI2) lf -= PI2;
      const mod: f32 = wowDepth * f32(Mathf.sin(lw)) + flutDepth * f32(Mathf.sin(lf));

      // smooth delay length toward target
      tsm += cTime * (targetSamp - tsm);
      let readPos: f32 = f32(wpos) - (tsm + mod);
      // wrap
      while (readPos < 0.0) readPos += f32(DELAY_LEN);

      // fractional read (linear interp)
      const ri: i32 = i32(readPos);
      const frac: f32 = readPos - f32(ri);
      const i0: i32 = ri & DELAY_MASK;
      const i1: i32 = (ri + 1) & DELAY_MASK;
      const d0: f32 = delay[base + i0];
      const d1: f32 = delay[base + i1];
      const delayed: f32 = d0 + frac * (d1 - d0);

      // --- repeat darkening (HF tape loss on each pass) ---
      tn = tn + cTone * (delayed - tn);

      // --- feedback DC blocker so self-osc doesn't drift to a rail ---
      const fbIn: f32 = tn;
      const dcOut: f32 = fbIn - dcP + 0.9985 * dcS;
      dcP = fbIn; dcS = dcOut;

      // tape soft-saturate the recirculating signal (keeps self-osc bounded)
      const recirc: f32 = tubeSat(dcOut * feedback + pre, 1.0);

      // write to head
      delay[base + (wpos & DELAY_MASK)] = recirc;
      wpos = (wpos + 1) & DELAY_MASK;

      // --- output: dry is the WARMED preamp signal (so Drive colours dry too),
      //     wet adds the darkened repeat ---
      const wet: f32 = tn;
      const dryOut: f32 = pre; // tube-warmed dry path
      let outv: f32 = dryOut * (1.0 - mix) + wet * mix;
      // safety ceiling
      outv = clampf(outv, -1.2, 1.2);
      outBuf[c * MAX_FRAMES + f] = outv;
    }

    writePos[c] = wpos;
    preLow[c] = pl;
    toneState[c] = tn;
    dcState[c] = dcS;
    dcPrev[c] = dcP;
    if (c == 0) { timeSmooth = tsm; wp = lw; fpz = lf; }
    else { fbSmooth[c] = tsm; }
  }

  wowPhase = wp;
  flutPhase = fpz;
}
