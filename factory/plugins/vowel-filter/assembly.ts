// =====================================================================
//  VOWEL FILTER — a formant / talkbox colour for any source
//  Three parallel band-pass resonators are tuned to the first three
//  formants of the human voice. A Vowel control morphs the bank smoothly
//  through A -> E -> I -> O -> U by interpolating the formant tables;
//  Resonance sharpens the peaks; an optional LFO auto-sweeps the Vowel
//  position for a "wah / talking" motion. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Parameter map (indices MUST match spec.json)
const P_VOWEL: i32 = 0;   // 0..4 (A E I O U), discrete selector + LFO morph target
const P_RES:   i32 = 1;   // 0..1 -> resonator Q / peak sharpness
const P_RATE:  i32 = 2;   // 0..1 -> LFO 0.02..8 Hz
const P_DEPTH: i32 = 3;   // 0..1 -> LFO sweep depth across the vowel space
const P_MIX:   i32 = 4;   // 0..1 dry/wet

// Formant tables: F1,F2,F3 (Hz) for vowels A,E,I,O,U (5 vowels).
// Roughly a male-voice formant set; good enough to read as clear vowels.
const F1: StaticArray<f32> = StaticArray.fromArray<f32>([ 800.0, 400.0, 350.0, 450.0, 325.0 ]);
const F2: StaticArray<f32> = StaticArray.fromArray<f32>([ 1150.0, 1700.0, 2000.0, 800.0, 700.0 ]);
const F3: StaticArray<f32> = StaticArray.fromArray<f32>([ 2900.0, 2600.0, 2800.0, 2830.0, 2530.0 ]);
// Relative amplitudes of each formant (so higher formants don't dominate)
const A1: StaticArray<f32> = StaticArray.fromArray<f32>([ 1.0, 1.0, 1.0, 1.0, 1.0 ]);
const A2: StaticArray<f32> = StaticArray.fromArray<f32>([ 0.63, 0.5, 0.35, 0.4, 0.2 ]);
const A3: StaticArray<f32> = StaticArray.fromArray<f32>([ 0.28, 0.25, 0.25, 0.25, 0.18 ]);

// State-variable filter state, per channel, per formant (3 bands).
const bp1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lp1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const bp2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lp2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const bp3: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lp3: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

let lfoPhase: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    bp1[c] = 0.0; lp1[c] = 0.0;
    bp2[c] = 0.0; lp2[c] = 0.0;
    bp3[c] = 0.0; lp3[c] = 0.0;
  }
  lfoPhase = 0.0;
  params[P_VOWEL] = 0.0;   // A
  params[P_RES]   = 0.6;
  params[P_RATE]  = 0.25;
  params[P_DEPTH] = 0.0;
  params[P_MIX]   = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Linear interpolation between two table entries at fractional vowel position p (0..4).
@inline function lerpTable(t: StaticArray<f32>, p: f32): f32 {
  const i0: i32 = i32(p);
  let i1: i32 = i0 + 1;
  if (i1 > 4) i1 = 4;
  const frac: f32 = p - f32(i0);
  const a: f32 = t[i0];
  const b: f32 = t[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const vowelSel: f32 = clampf(params[P_VOWEL], 0.0, 4.0);
  const res: f32 = clampf(params[P_RES], 0.0, 1.0);
  const rateN: f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depth: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Resonance -> SVF damping coefficient. Higher res => smaller q => sharper peak.
  // q in [0.05 .. 0.6]; bandgain compensates so loud Q doesn't blow up.
  const q: f32 = 0.6 - res * 0.55;
  const bandGain: f32 = 0.4 + res * 1.4;

  // LFO advances once per block start; we sweep the vowel position per-sample
  // would be ideal but coefficient recompute per sample is costly — instead we
  // recompute formant targets once per block from the LFO at block start. With
  // small blocks this is smooth enough and keeps process() cheap.
  const lfoHz: f32 = 0.02 + rateN * rateN * 7.98;
  const lfoInc: f32 = f32(2.0 * 3.14159265 * lfoHz / sampleRate);

  // LFO value at this block (triangle-ish via sine), 0..1 sweep amount.
  const lfo: f32 = f32(0.5 + 0.5 * Mathf.sin(lfoPhase));
  // Effective vowel position: base selector swept by the LFO across the bank.
  let vpos: f32 = vowelSel + depth * (lfo - 0.5) * 4.0;
  vpos = clampf(vpos, 0.0, 4.0);

  // Interpolated formant frequencies + amplitudes for this block.
  const f1: f32 = lerpTable(F1, vpos);
  const f2: f32 = lerpTable(F2, vpos);
  const f3: f32 = lerpTable(F3, vpos);
  const am1: f32 = lerpTable(A1, vpos);
  const am2: f32 = lerpTable(A2, vpos);
  const am3: f32 = lerpTable(A3, vpos);

  // SVF tuning coefficient f = 2*sin(pi*fc/sr). Clamp fc below Nyquist.
  const nyq: f32 = sampleRate * 0.45;
  const g1: f32 = f32(2.0 * Mathf.sin(3.14159265 * clampf(f1, 20.0, nyq) / sampleRate));
  const g2: f32 = f32(2.0 * Mathf.sin(3.14159265 * clampf(f2, 20.0, nyq) / sampleRate));
  const g3: f32 = f32(2.0 * Mathf.sin(3.14159265 * clampf(f3, 20.0, nyq) / sampleRate));

  // Advance LFO phase by the whole block now (next block reads the new phase).
  lfoPhase += lfoInc * f32(n);
  while (lfoPhase >= f32(6.28318531)) lfoPhase -= f32(6.28318531);

  // Overall make-up so the vowel bank sits near the dry level.
  const outScale: f32 = 0.5 * bandGain;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let b1: f32 = bp1[c]; let l1: f32 = lp1[c];
    let b2: f32 = bp2[c]; let l2: f32 = lp2[c];
    let b3: f32 = bp3[c]; let l3: f32 = lp3[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // Three Chamberlin state-variable band-passes in parallel.
      // band1
      const hp1: f32 = x - l1 - q * b1;
      b1 = f32(b1 + g1 * hp1);
      l1 = f32(l1 + g1 * b1);
      // band2
      const hp2: f32 = x - l2 - q * b2;
      b2 = f32(b2 + g2 * hp2);
      l2 = f32(l2 + g2 * b2);
      // band3
      const hp3: f32 = x - l3 - q * b3;
      b3 = f32(b3 + g3 * hp3);
      l3 = f32(l3 + g3 * b3);

      let wet: f32 = f32((b1 * am1 + b2 * am2 + b3 * am3) * outScale);
      // soft safety clip — keeps peaks bounded under high resonance
      if (wet > 1.2) wet = 1.2; else if (wet < -1.2) wet = -1.2;
      wet = f32(wet - 0.16667 * wet * wet * wet);

      outBuf[base + f] = f32(x * (1.0 - mix) + wet * mix);
    }

    bp1[c] = b1; lp1[c] = l1;
    bp2[c] = b2; lp2[c] = l2;
    bp3[c] = b3; lp3[c] = l3;
  }
}
