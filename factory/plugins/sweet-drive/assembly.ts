// =====================================================================
//  SWEET DRIVE — warm ASYMMETRIC soft-clip overdrive (SD-1 lineage)
//  A boutique-pedal break-up: the input is band-limited to clean the low
//  end, then driven into an ASYMMETRIC soft-clipper. A small DC bias is
//  added before the waveshaper so the positive and negative halves clip
//  by different amounts — one half stays rounder than the other. That
//  asymmetry generates EVEN harmonics for a sweeter, slightly fatter
//  break-up, sitting over a gentle mid-hump. A post tone low-pass shapes
//  brightness; output level and dry/wet mix finish the chain.
//  Pure algorithm, no samples, no imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const hpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip LP (for HP)
const midState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip band-pass-ish state (mid-hump)
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post-clip DC blocker LP
const envState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // touch-sensitivity envelope

const P_DRIVE: i32 = 0;  // 0..1 -> gain 1..36
const P_TONE:  i32 = 1;  // 0..1 -> post LP 700..6500 Hz
const P_LEVEL: i32 = 2;  // 0..1 -> 0..1.2 output
const P_MIX:   i32 = 3;  // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0; midState[c] = 0.0; toneState[c] = 0.0; dcState[c] = 0.0; envState[c] = 0.0;
  }
  params[P_DRIVE] = 0.5; params[P_TONE] = 0.5; params[P_LEVEL] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Asymmetric soft clip via tanh on a biased signal. The bias shifts the
// waveshaper's operating point so the positive lobe saturates harder than
// the negative one (or vice-versa), producing even harmonics. We subtract
// the shaped bias (DC) afterwards so static offset is removed but the
// dynamic asymmetry stays.
@inline function asymClip(x: f32, bias: f32): f32 {
  return f32(Mathf.tanh(x + bias));
}

export function process(n: i32): void {
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.2;
  const mix:    f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Drive: clean -> singing overdrive. Squared curve for musical taper.
  const drive: f32 = 1.0 + driveN * driveN * 35.0;

  // Pre-clip high-pass corner ~110 Hz (clean low end -> tighter mid-hump).
  const cHp: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 110.0 / sampleRate));
  // Mild mid-hump: a gentle resonant emphasis around ~720 Hz applied to the
  // high-passed signal before clipping (extra weight in the mids).
  const cMid: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 720.0 / sampleRate));
  // Post tone low-pass 700..6500 Hz.
  const toneHz: f32 = 700.0 + toneN * toneN * 5800.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate));
  // Slow DC blocker (~12 Hz) to strip the static bias offset after clipping.
  const cDc: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 12.0 / sampleRate));
  // Touch envelope follower coefficient (~30 ms).
  const cEnv: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 5.3 / sampleRate));

  // Asymmetry bias grows a little with drive: harder you push, sweeter the
  // even-harmonic break-up. Bounded so it never collapses the waveform.
  const bias: f32 = 0.18 + driveN * 0.22;

  // Output compensation so Drive sings rather than just getting louder.
  const comp: f32 = 1.7 / f32(Mathf.sqrt(drive));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32  = hpState[c];
    let md: f32  = midState[c];
    let tn: f32  = toneState[c];
    let dc: f32  = dcState[c];
    let env: f32 = envState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // high-pass: remove sub-bass before clipping
      hp = hp + cHp * (x - hp);
      const hpd: f32 = x - hp;

      // mild mid emphasis: blend the band toward 720 Hz back in
      md = md + cMid * (hpd - md);
      const shaped: f32 = hpd + (md * 0.45);

      // touch sensitivity: envelope scales effective drive a touch so the
      // break-up responds to playing dynamics (amp-like).
      const rect: f32 = shaped < 0.0 ? -shaped : shaped;
      env = env + cEnv * (rect - env);
      const touch: f32 = 0.85 + env * 0.6; // louder input pushes harder

      // asymmetric soft clip
      const pre: f32 = shaped * drive * touch;
      const clipped: f32 = asymClip(pre, bias);

      // DC blocker: remove static offset from the bias, keep dynamic asym
      dc = dc + cDc * (clipped - dc);
      const noDc: f32 = clipped - dc;

      const driven: f32 = noDc * comp;

      // post tone low-pass
      tn = tn + cTone * (driven - tn);

      const wet: f32 = tn * level;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    hpState[c] = hp; midState[c] = md; toneState[c] = tn; dcState[c] = dc; envState[c] = env;
  }
}
