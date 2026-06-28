// =====================================================================
//  GERMANIUM FUZZ — vintage two-transistor germanium fuzz model
//  An original model of the classic 1960s germanium fuzz circuit: an AC-
//  coupled, very high-gain stage feeding an asymmetric clipper (soft knee
//  into a hard ceiling) that mimics a cascaded transistor pair. A Bias
//  control shifts the operating point — turned down it starves the
//  "circuit", producing the gated, spitty, note-collapsing fuzz the real
//  thing is famous for. A passive Tone tilt and output Volume finish it.
//  Pure algorithm, no samples, bounded output.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel filter / coupling state
const inHpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input AC-coupling LP (for HP)
const midHpState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // inter-stage AC coupling LP (for HP)
const biasEnv:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // slow envelope -> dynamic bias sag/gate
const toneLpState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone low-pass
const outHpState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // output DC blocker LP (for HP)

const P_FUZZ:   i32 = 0; // 0..1 -> gain into the clipper
const P_BIAS:   i32 = 1; // 0..1 -> circuit bias (low = starved/gated, high = open/fat)
const P_TONE:   i32 = 2; // 0..1 -> dark .. bright
const P_VOLUME: i32 = 3; // 0..1 -> output level

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    inHpState[c] = 0.0;
    midHpState[c] = 0.0;
    biasEnv[c] = 0.0;
    toneLpState[c] = 0.0;
    outHpState[c] = 0.0;
  }
  params[P_FUZZ] = 0.75;
  params[P_BIAS] = 0.65;
  params[P_TONE] = 0.5;
  params[P_VOLUME] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// one-pole low-pass coefficient for a given corner frequency
@inline function lpCoeff(hz: f32, sr: f32): f32 {
  return f32(1.0 - Mathf.exp(-2.0 * PI * hz / sr));
}

// Asymmetric soft->hard saturator. tanh gives the soft knee of a transistor
// stage; the asymmetry from the shifted bias makes the positive and negative
// halves clip differently (even-harmonic, "vocal" germanium character), and a
// hard ceiling caps the runaway high-gain output.
@inline function fuzzStage(x: f32, bias: f32): f32 {
  // bias is a small DC offset injected before the nonlinearity
  const b: f32 = x + bias;
  let y: f32 = f32(Mathf.tanh(b));
  // remove the resulting DC so the asymmetry stays as waveform shape, not offset
  y = y - f32(Mathf.tanh(bias));
  // hard ceiling for the most extreme excursions (saturated transistor)
  return clampf(y, -0.98, 0.98);
}

export function process(n: i32): void {
  const fuzzN: f32 = clampf(params[P_FUZZ], 0.0, 1.0);
  const biasN: f32 = clampf(params[P_BIAS], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const volN:  f32 = clampf(params[P_VOLUME], 0.0, 1.0);

  // FUZZ -> drive into the first clipper. Very high range like the real thing.
  const drive1: f32 = f32(2.0 + fuzzN * fuzzN * 120.0);
  // second cascaded stage adds the extra grind at high settings
  const drive2: f32 = f32(1.5 + fuzzN * 6.0);

  // BIAS -> static operating-point offset. Low bias = large offset that the
  // signal cannot fully overcome on every cycle -> gating/spitty fuzz. High
  // bias = near-symmetric, fat and open.
  // staticBias is large & negative-leaning when starved.
  const starve: f32 = 1.0 - biasN;                 // 0 (open) .. 1 (starved)
  const staticBias: f32 = f32(0.05 + starve * 1.6); // offset magnitude
  // how strongly the program-dependent envelope pulls the bias around (sag)
  const sagAmt: f32 = f32(0.2 + starve * 1.3);

  // input AC coupling ~ 80 Hz (sensitive, lets low end push the gain stage)
  const cInHp: f32 = lpCoeff(80.0, sampleRate);
  // inter-stage coupling ~ 160 Hz tightens before the second clip
  const cMidHp: f32 = lpCoeff(160.0, sampleRate);
  // bias envelope follower (slow): ~ 25 Hz response
  const cEnv: f32 = lpCoeff(25.0, sampleRate);
  // TONE -> post low-pass, dark 700 Hz .. bright 6500 Hz
  const toneHz: f32 = f32(700.0 + toneN * toneN * 5800.0);
  const cTone: f32 = lpCoeff(toneHz, sampleRate);
  // output DC blocker ~ 25 Hz
  const cOutHp: f32 = lpCoeff(25.0, sampleRate);

  // output level; level-compensated a touch so cranking Fuzz isn't just louder
  const comp: f32 = f32(0.9 / (1.0 + fuzzN * 0.6));
  const vol: f32 = f32(volN * 1.2 * comp);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let inLp: f32 = inHpState[c];
    let midLp: f32 = midHpState[c];
    let env: f32 = biasEnv[c];
    let tn: f32 = toneLpState[c];
    let outLp: f32 = outHpState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- input AC coupling (high-pass) ---
      inLp = inLp + cInHp * (x - inLp);
      const hpIn: f32 = x - inLp;

      // --- envelope of the input drives dynamic bias sag (gating) ---
      const rect: f32 = hpIn < 0.0 ? -hpIn : hpIn;
      env = env + cEnv * (rect - env);
      // when starved, a louder signal momentarily "opens" the bias (sag),
      // so quiet tails collapse/gate and transients spit through.
      const dynBias: f32 = f32(-staticBias + env * sagAmt * 3.0);

      // --- first high-gain germanium stage (asymmetric) ---
      const s1: f32 = fuzzStage(hpIn * drive1, dynBias);

      // --- inter-stage AC coupling, then second cascaded clip ---
      midLp = midLp + cMidHp * (s1 - midLp);
      const hpMid: f32 = s1 - midLp;
      const s2: f32 = fuzzStage(hpMid * drive2, dynBias * 0.5);

      // --- passive tone low-pass ---
      tn = tn + cTone * (s2 - tn);

      // --- output DC blocker ---
      outLp = outLp + cOutHp * (tn - outLp);
      const dcFree: f32 = tn - outLp;

      let y: f32 = f32(dcFree * vol);
      // final safety clamp — always bounded
      y = clampf(y, -1.0, 1.0);
      outBuf[base + f] = y;
    }

    inHpState[c] = inLp;
    midHpState[c] = midLp;
    biasEnv[c] = env;
    toneLpState[c] = tn;
    outHpState[c] = outLp;
  }
}
