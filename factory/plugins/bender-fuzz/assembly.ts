// =====================================================================
//  BENDER FUZZ — thick, gated germanium fuzz (effect)
//  A 3-transistor germanium-style cascade in the tone-bender lineage.
//  Each stage applies an asymmetric, leaky germanium clip; the cascade
//  builds a hard, mid-forward wall of fuzz that is grittier and more
//  aggressive than a Fuzz Face / Big Muff. A bias-starve gate tracks the
//  signal envelope and chokes the output as notes decay — giving the
//  ragged staccato cut-off and "spit" the circuit is famous for. A simple
//  tilt tone control and output level finish the chain. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel state
const hpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input DC/HP block
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post-clip DC block
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tilt LP
const envState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // envelope follower
const gateState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // smoothed gate gain

const P_FUZZ:  i32 = 0; // 0..1 -> cascade gain / density
const P_GATE:  i32 = 1; // 0..1 -> decay gating / spit amount
const P_TONE:  i32 = 2; // 0..1 -> dark..bright tilt
const P_LEVEL: i32 = 3; // 0..1 -> output level

const PI: f32 = 3.14159265;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0; dcState[c] = 0.0; toneState[c] = 0.0;
    envState[c] = 0.0; gateState[c] = 1.0;
  }
  params[P_FUZZ] = 0.7; params[P_GATE] = 0.4;
  params[P_TONE] = 0.55; params[P_LEVEL] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Asymmetric, leaky germanium-style clip: tanh hard side, softer/leaky
// negative side so even harmonics dominate -> raw, mid-forward grit.
@inline function germClip(x: f32, bias: f32): f32 {
  const b: f32 = x + bias;
  let y: f32;
  if (b >= 0.0) {
    y = f32(Mathf.tanh(b * 1.6));
  } else {
    // gentler, leaky compression on the bottom half
    y = f32(Mathf.tanh(b * 0.9)) * 0.82;
  }
  return y;
}

export function process(n: i32): void {
  const fuzzN:  f32 = clampf(params[P_FUZZ], 0.0, 1.0);
  const gateN:  f32 = clampf(params[P_GATE], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.1;

  // cascade gains: three transistor stages, density grows with Fuzz
  const g1: f32 = 2.0 + fuzzN * 14.0;
  const g2: f32 = 1.5 + fuzzN * 9.0;
  const g3: f32 = 1.5 + fuzzN * 7.0;
  // collector bias drifts with fuzz -> more asymmetric splat when cranked
  const bias: f32 = 0.04 + fuzzN * 0.22;

  // input high-pass ~80 Hz to tighten and emphasise mids
  const cHp: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 80.0 / sampleRate));
  // post-clip DC block ~18 Hz (asymmetry adds DC offset)
  const cDc: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 18.0 / sampleRate));
  // tilt tone: LP corner sweeps 1.2k (dark) .. 8k (bright)
  const toneHz: f32 = 1200.0 + toneN * toneN * 6800.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * toneHz / sampleRate));
  // a touch of the bright (HP) component mixed back for fizz
  const bright: f32 = 0.25 + toneN * 0.55;

  // envelope follower coeffs (fast attack, slow-ish release)
  const cAtt: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 200.0 / sampleRate));
  const cRel: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 12.0 / sampleRate));
  // gate threshold rises with Gate -> chokes earlier/harder on decay
  const thresh: f32 = 0.02 + gateN * 0.30;
  // gate slew: higher Gate -> snappier, more ragged cut-off / spit
  const gateSlew: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * (40.0 + gateN * 260.0) / sampleRate));
  // makeup so the wall stays controlled regardless of fuzz
  const comp: f32 = 0.9 / f32(Mathf.sqrt(1.0 + fuzzN * 6.0));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32 = hpState[c];
    let dc: f32 = dcState[c];
    let tn: f32 = toneState[c];
    let env: f32 = envState[c];
    let gate: f32 = gateState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // input high-pass
      hp = hp + cHp * (x - hp);
      const ac: f32 = x - hp;

      // --- envelope of the (pre-fuzz) input drives the gate ---
      const rect: f32 = ac < 0.0 ? -ac : ac;
      const cEnv: f32 = rect > env ? cAtt : cRel;
      env = env + cEnv * (rect - env);

      // gate target: smooth-ish above thresh, slams shut below.
      // The transition is sharpened by Gate for staccato spit.
      const over: f32 = (env - thresh) / (thresh * 0.6 + 0.0001);
      let gTarget: f32 = over;
      if (gTarget < 0.0) gTarget = 0.0;
      if (gTarget > 1.0) gTarget = 1.0;
      // bias the gate by amount so at Gate=0 it stays essentially open
      gTarget = 1.0 - gateN * (1.0 - gTarget);
      gate = gate + gateSlew * (gTarget - gate);

      // --- 3-stage germanium cascade ---
      let s: f32 = germClip(ac * g1, bias);
      s = germClip(s * g2, bias * 0.6);
      s = germClip(s * g3, bias * 0.35);

      // post-clip DC block
      dc = dc + cDc * (s - dc);
      const fuzzed: f32 = (s - dc) * comp;

      // tilt tone: blend low-passed body with a bit of bright residue
      tn = tn + cTone * (fuzzed - tn);
      const shaped: f32 = tn + (fuzzed - tn) * bright;

      // apply gate (the spit), then level
      let y: f32 = shaped * gate * level;
      // safety clamp
      y = clampf(y, -1.0, 1.0);
      outBuf[base + f] = y;
    }

    hpState[c] = hp; dcState[c] = dc; toneState[c] = tn;
    envState[c] = env; gateState[c] = gate;
  }
}
