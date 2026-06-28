// =====================================================================
//  FET SQUEEZE — fast FET-style peak compressor
//  A very fast peak detector feeds a dB-domain gain computer with a
//  selectable ratio and a soft knee, then a program-dependent release.
//  Input drives how hard the signal hits the detector; Output is makeup
//  gain. Loud transients are clamped hard and fast for that punchy,
//  glued, in-your-face character. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (shared across channels for stereo-linked GR)
let envDb: f32 = 0.0;   // smoothed gain-reduction in dB (>= 0 means reducing by that much)
let peakEnv: f32 = 0.0; // fast peak follower of the (driven) detector signal

// program-dependent release: a slower second stage that trails the fast one
let relSlow: f32 = 0.0;

const P_INPUT: i32 = 0;   // 0..1 -> drive into detector (how hard it hits)
const P_ATTACK: i32 = 1;  // 0..1 -> higher = faster (sub-ms..ms)
const P_RELEASE: i32 = 2; // 0..1 -> higher = faster
const P_RATIO: i32 = 3;   // 0..1 -> ~2:1 .. 20:1
const P_OUTPUT: i32 = 4;  // 0..1 -> makeup gain, default near unity

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  envDb = 0.0;
  peakEnv = 0.0;
  relSlow = 0.0;
  params[P_INPUT]   = 0.5;
  params[P_ATTACK]  = 0.7;
  params[P_RELEASE] = 0.5;
  params[P_RATIO]   = 0.5;
  params[P_OUTPUT]  = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linear amplitude -> dB, guarded
@inline function lin2db(x: f32): f32 {
  const a: f32 = x > 1e-7 ? x : f32(1e-7);
  return f32(20.0 * Mathf.log10(a));
}
// dB -> linear amplitude
@inline function db2lin(d: f32): f32 {
  return f32(Mathf.pow(10.0, d * f32(0.05)));
}

// one-pole time-constant -> per-sample coefficient (guarded)
@inline function tcCoeff(ms: f32, sr: f32): f32 {
  const t: f32 = ms > 0.01 ? ms : f32(0.01);
  return f32(1.0 - Mathf.exp(-1.0 / (f32(0.001) * t * sr)));
}

export function process(n: i32): void {
  const inputN: f32   = clampf(params[P_INPUT], 0.0, 1.0);
  const attackN: f32  = clampf(params[P_ATTACK], 0.0, 1.0);
  const releaseN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const ratioN: f32   = clampf(params[P_RATIO], 0.0, 1.0);
  const outputN: f32  = clampf(params[P_OUTPUT], 0.0, 1.0);

  // Input drive: 0..1 -> -6..+30 dB into the detector. More drive => more GR.
  const driveDb: f32 = f32(-6.0) + inputN * f32(36.0);
  const drive: f32 = db2lin(driveDb);

  // Fixed FET-style threshold; the Input knob pushes the signal past it.
  const threshDb: f32 = f32(-22.0);
  const kneeDb: f32 = f32(6.0); // soft knee width

  // Ratio ~2:1 .. 20:1
  const ratio: f32 = f32(2.0) + ratioN * f32(18.0);
  const slope: f32 = f32(1.0) - f32(1.0) / ratio; // 0..~0.95

  // Attack: higher = faster. 0 -> 8 ms, 1 -> ~0.05 ms (sub-ms, FET-fast).
  const atkMs: f32 = f32(8.0) * f32(Mathf.pow(160.0, -attackN));
  // Release fast stage: higher = faster. 0 -> 800 ms, 1 -> ~30 ms.
  const relMs: f32 = f32(800.0) * f32(Mathf.pow(26.7, -releaseN));
  // program-dependent slow release stage (a few times slower, capped)
  const relSlowMs: f32 = relMs * f32(6.0);

  const atkC: f32 = tcCoeff(atkMs, sampleRate);
  const relC: f32 = tcCoeff(relMs, sampleRate);
  const relSlowC: f32 = tcCoeff(relSlowMs, sampleRate);

  // peak detector smoothing (very fast — defines the "peak" feel)
  const peakC: f32 = tcCoeff(f32(0.05), sampleRate);

  // makeup gain: 0..1 -> -12..+24 dB. Default 0.5 -> ~ +6 dB (near unity
  // perceived after typical GR). Keep headroom so broadband bed stays < 1.
  const makeupDb: f32 = f32(-12.0) + outputN * f32(36.0);
  const makeup: f32 = db2lin(makeupDb);

  let env: f32 = envDb;
  let pk: f32 = peakEnv;
  let rs: f32 = relSlow;

  for (let f = 0; f < n; f++) {
    // stereo-linked detection: max abs across channels, then drive it
    let det: f32 = 0.0;
    for (let c = 0; c < channels; c++) {
      const a: f32 = Mathf.abs(inBuf[c * MAX_FRAMES + f]);
      if (a > det) det = a;
    }
    det = det * drive;

    // fast peak follower (instant attack, quick release)
    if (det > pk) pk = det;
    else pk = pk + peakC * (det - pk);

    // dB-domain gain computer with soft knee
    const inDb: f32 = lin2db(pk);
    const over: f32 = inDb - threshDb;
    let grTarget: f32 = 0.0; // desired gain reduction (dB, >= 0)
    if (over <= -kneeDb * f32(0.5)) {
      grTarget = 0.0;
    } else if (over >= kneeDb * f32(0.5)) {
      grTarget = slope * over;
    } else {
      // quadratic soft knee
      const x: f32 = over + kneeDb * f32(0.5);
      grTarget = slope * f32(x * x) / (f32(2.0) * kneeDb);
    }
    if (grTarget < 0.0) grTarget = 0.0;

    // attack / release ballistics in the dB (gain-reduction) domain.
    // program-dependent release: env trails the slower of two release stages.
    if (grTarget > env) {
      // attacking: snap down fast
      env = env + atkC * (grTarget - env);
      rs = env; // keep slow stage primed during attack
    } else {
      // releasing: fast stage chases target, slow stage lags behind,
      // and we release toward the slower (higher) of the two for that
      // characteristic auto-release recovery.
      const fast: f32 = env + relC * (grTarget - env);
      rs = rs + relSlowC * (grTarget - rs);
      env = fast > rs ? fast : rs;
    }
    if (env < 0.0) env = 0.0;

    // apply: gain = makeup * 10^(-env/20)
    const grLin: f32 = db2lin(-env);
    const g: f32 = grLin * makeup;

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      outBuf[base + f] = f32(inBuf[base + f] * g);
    }
  }

  envDb = env;
  peakEnv = pk;
  relSlow = rs;
}
