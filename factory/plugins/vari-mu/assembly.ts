// =====================================================================
//  VARI-MU — program-dependent variable-mu tube compressor
//  Models the smooth, rising-ratio behaviour of a classic vari-mu valve
//  limiter: the more the input level exceeds the threshold, the more the
//  gain reduction tube "bends", so loud signals are squeezed harder than
//  quiet ones (a soft, progressive knee with no fixed ratio). A slow,
//  level-dependent attack and a DUAL time-constant release (a fast first
//  stage feeding a slow tail) give the characteristic gentle recovery,
//  and a touch of even-order tube harmonics adds valve warmth.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// envelope state: fast detector stage + slow release tail (shared sidechain,
// stereo-linked so the image doesn't wander), plus a DC blocker per channel.
let envFast: f32 = 0.0;
let envSlow: f32 = 0.0;
const dcX: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const dcY: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_INPUT: i32 = 0;   // 0..1 -> input drive into the tube (gain)
const P_THRESH: i32 = 1;  // 0..1 -> threshold (high=less compression)
const P_TIME: i32 = 2;    // 0..1 -> time-constant pair (attack+release scale)
const P_OUTPUT: i32 = 3;  // 0..1 -> make-up / output trim

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  envFast = 0.0;
  envSlow = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) { dcX[c] = 0.0; dcY[c] = 0.0; }
  params[P_INPUT] = 0.5;
  params[P_THRESH] = 0.5;
  params[P_TIME] = 0.4;
  params[P_OUTPUT] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  // ---- map params -------------------------------------------------
  const inN: f32 = clampf(params[P_INPUT], 0.0, 1.0);
  const thN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const tmN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const outN: f32 = clampf(params[P_OUTPUT], 0.0, 1.0);

  // Input drive into the tube: 0.25x .. 4x (the harder we push, the more
  // the program-dependent knee bites).
  const inGain: f32 = f32(0.25) * f32(Mathf.pow(16.0, inN));
  // Threshold in linear amplitude: 0.04 (squeeze a lot) .. 0.9 (barely).
  const thresh: f32 = f32(0.04) + thN * f32(0.86);

  // Time-constant pair. Vari-mu attack is slow; here ~3..40 ms. Release is
  // dual-stage: a fast first coefficient and a much slower tail.
  const atkMs: f32 = f32(3.0) + tmN * f32(37.0);
  const relFastMs: f32 = f32(60.0) + tmN * f32(240.0);
  const relSlowMs: f32 = f32(400.0) + tmN * f32(2600.0);
  const atkC: f32  = f32(Mathf.exp(-1.0 / (f32(0.001) * atkMs * sampleRate)));
  const relF: f32  = f32(Mathf.exp(-1.0 / (f32(0.001) * relFastMs * sampleRate)));
  const relS: f32  = f32(Mathf.exp(-1.0 / (f32(0.001) * relSlowMs * sampleRate)));

  // DC blocker pole.
  const dcR: f32 = f32(0.999);

  // Output make-up trim: 0.5x .. 2x. Slight bias toward unity so a loud
  // squeezed signal stays bounded (peak < ~1.0).
  const outGain: f32 = f32(0.5) * f32(Mathf.pow(4.0, outN));

  let eF: f32 = envFast;
  let eS: f32 = envSlow;

  for (let f = 0; f < n; f++) {
    // ---- stereo-linked detector (max of |L|,|R| after input drive) ----
    let detect: f32 = 0.0;
    for (let c = 0; c < channels; c++) {
      const a: f32 = f32(Mathf.abs(inBuf[c * MAX_FRAMES + f] * inGain));
      if (a > detect) detect = a;
    }

    // Fast envelope: slow attack (charge), fast release (first stage).
    if (detect > eF) eF = atkC * eF + (f32(1.0) - atkC) * detect;
    else             eF = relF * eF + (f32(1.0) - relF) * detect;
    // Slow tail follows the fast stage -> dual time-constant recovery.
    if (eF > eS) eS = atkC * eS + (f32(1.0) - atkC) * eF;
    else         eS = relS * eS + (f32(1.0) - relS) * eF;

    // Effective control envelope = blend of fast + slow stages.
    const env: f32 = f32(0.55) * eF + f32(0.45) * eS;

    // ---- program-dependent rising-ratio gain computer ----------------
    // over = how far the envelope sits above threshold (in "tube units").
    // We compute reduction as a smooth, bounded function whose local slope
    // (ratio) GROWS with level: gentle near threshold, firmer when loud.
    let gr: f32 = 1.0; // gain (1 = no reduction)
    if (env > thresh) {
      const over: f32 = env / thresh;                 // >1 when above thresh
      const x: f32 = f32(Mathf.log(over));             // natural-log overshoot
      // soft rising-ratio curve: reduction in log domain grows ~quadratically
      // for small overshoot then is bounded by a tanh so it never collapses.
      const bend: f32 = x + f32(0.6) * x * x;          // accelerating knee
      const shaped: f32 = f32(2.4) * f32(Mathf.tanh(bend * f32(0.45)));
      gr = f32(Mathf.exp(-shaped));                    // <1, bounded > ~0.09
    }

    // ---- apply gain reduction + gentle even-order tube warmth ---------
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const driven: f32 = inBuf[base + f] * inGain;
      let y: f32 = driven * gr;
      // soft tube transfer: a small 2nd-harmonic bias + tanh saturation that
      // only acts on the loud peaks (warmth, keeps peaks < ~1.0).
      const warm: f32 = y + f32(0.08) * y * y;         // even-order asymmetry
      y = f32(Mathf.tanh(warm * f32(0.9))) * f32(1.0526);
      // DC blocker (removes the bias offset from the even-order term).
      const yb: f32 = y - dcX[c] + dcR * dcY[c];
      dcX[c] = y;
      dcY[c] = yb;
      outBuf[base + f] = clampf(yb * outGain, -1.0, 1.0);
    }
  }

  envFast = eF;
  envSlow = eS;
}
