// =====================================================================
//  GLASS CHORUS — pristine hi-fi stereo chorus / flanger combo
//  A studio-grade stereo modulation effect that morphs
//  between a lush multi-voice CHORUS and a sweeping FLANGER via a single
//  Mode control. Two fractional delay lines (one per channel) are read
//  with linear interpolation and modulated by quadrature LFOs so the left
//  and right voices sweep in counter-phase for a wide, glassy stereo image.
//
//  Mode morphs the delay range + dry/wet voicing: at 0 the lines sit in
//  the long, gently detuned CHORUS region (~7..30 ms) and the wet voices
//  are summed with the dry for thick width; at 1 they collapse into the
//  short FLANGER comb region (~0.2..6 ms) where the resonant Feedback path
//  produces the metallic flange whoosh. Width spreads the stereo voices.
//  Clean signal path — no saturation, no grit. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: chorus needs up to ~30 ms. 30 ms @ 96k -> 2880 samples.
// Give generous headroom -> 4096 per channel.
const DLY_LEN: i32 = 4096;
const dline:  StaticArray<f32> = new StaticArray<f32>(DLY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // 0..1
const fbState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // last delayed out (feedback)
const dampState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // gentle wet de-fizz LP

const P_RATE:  i32 = 0;  // 0..1 -> 0.05..6 Hz
const P_DEPTH: i32 = 1;  // 0..1 sweep depth
const P_MODE:  i32 = 2;  // 0..1 chorus<->flanger morph
const P_FB:    i32 = 3;  // 0..1 -> flange resonance (feedback)
const P_WIDTH: i32 = 4;  // 0..1 stereo spread
const P_MIX:   i32 = 5;  // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0;
    lfoPhase[c] = 0.0;   // channels start in phase; Width opens the quadrature spread
    fbState[c] = 0.0;
    dampState[c] = 0.0;
  }
  for (let i = 0; i < DLY_LEN * MAX_CHANNELS; i++) dline[i] = 0.0;
  params[P_RATE] = 0.3; params[P_DEPTH] = 0.55; params[P_MODE] = 0.25;
  params[P_FB] = 0.4; params[P_WIDTH] = 0.7; params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const rateN:  f32 = clampf(params[P_RATE],  0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const modeN:  f32 = clampf(params[P_MODE],  0.0, 1.0);
  const fbN:    f32 = clampf(params[P_FB],    0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const mix:    f32 = clampf(params[P_MIX],   0.0, 1.0);

  // LFO rate: gentle exponential map 0.05..6 Hz
  const rateHz: f32 = f32(0.05 * Mathf.pow(120.0, rateN));
  const phInc:  f32 = rateHz / sampleRate;

  // --- Mode morph (chorus -> flanger) -------------------------------
  // Chorus: long, slowly detuned delays (lush). Flanger: short comb.
  // Base delay centre collapses from ~14 ms (chorus) to ~1.4 ms (flanger).
  const baseMsChorus: f32 = 14.0;
  const baseMsFlange: f32 = 1.4;
  const baseMs: f32 = baseMsChorus + (baseMsFlange - baseMsChorus) * modeN;
  // Sweep span: chorus uses a wide gentle sweep; flanger a tight fast comb.
  const sweepMsChorus: f32 = 8.0;
  const sweepMsFlange: f32 = 3.0;
  const sweepMs: f32 = (sweepMsChorus + (sweepMsFlange - sweepMsChorus) * modeN) * depthN;

  const baseSamp:  f32 = baseMs  * sampleRate * 0.001;
  const sweepSamp: f32 = sweepMs * sampleRate * 0.001;

  // Feedback (flange resonance) only meaningfully engages as we morph toward
  // flanger — but keep a little active in chorus too so the knob is alive.
  // fbGate scales from ~0.25 (chorus end) up to 1.0 (flanger end).
  const fbGate: f32 = 0.25 + 0.75 * modeN;
  const fb: f32 = clampf(fbN * 0.85 * fbGate, 0.0, 0.85);

  // Wet voicing: chorus blends dry+wet for body; flanger is a tighter comb.
  // wetGain trims the wet a touch in flanger to keep peaks bounded with fb.
  const wetGain: f32 = 0.72 - 0.12 * modeN;

  // Width: phase spread between the two channel LFOs. 0 -> mono-ish (both in
  // phase), 1 -> full counter-phase quadrature for a wide glassy image.
  const widthSpread: f32 = widthN; // applied as extra R-channel phase offset

  // Gentle wet damping LP to keep it glassy-clean (de-fizz the comb highs).
  const dampHz: f32 = 9000.0;
  const cDamp: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * dampHz / sampleRate));

  const maxD: f32 = f32(DLY_LEN - 2);

  for (let c = 0; c < channels; c++) {
    const cbase: i32 = c * DLY_LEN;
    let wp: i32  = writePos[c];
    let ph: f32  = lfoPhase[c];
    let fbs: f32 = fbState[c];
    let dmp: f32 = dampState[c];

    // Per-channel LFO phase offset scaled by Width (R leads more as width up).
    const chOffset: f32 = c == 1 ? widthSpread * 0.5 : 0.0;

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // Sine LFO 0..1 with per-channel width offset.
      let lph: f32 = ph + chOffset;
      if (lph >= 1.0) lph -= 1.0;
      const s: f32 = f32(Mathf.sin(lph * 6.2831853));
      const lfo01: f32 = 0.5 + 0.5 * s;

      let dSamp: f32 = baseSamp + lfo01 * sweepSamp;
      dSamp = clampf(dSamp, 1.0, maxD);

      // fractional read position behind the write pointer.
      // Wrap into [0, DLY_LEN) then clamp hard below the top index so f32
      // rounding (e.g. baseSamp not being exact) can never produce rp == DLY_LEN.
      let rp: f32 = f32(wp) - dSamp;
      while (rp < 0.0) rp += f32(DLY_LEN);
      if (rp >= f32(DLY_LEN)) rp -= f32(DLY_LEN);
      rp = clampf(rp, 0.0, f32(DLY_LEN) - 1.0001);
      let i0: i32 = i32(rp);
      // Belt-and-braces integer clamp: the delay read can never index out of
      // range regardless of any residual f32 rounding.
      i0 = i0 < 0 ? 0 : (i0 >= DLY_LEN ? DLY_LEN - 1 : i0);
      const frac: f32 = rp - f32(i0);
      let i1: i32 = i0 + 1;
      if (i1 >= DLY_LEN) i1 -= DLY_LEN;
      i1 = i1 < 0 ? 0 : (i1 >= DLY_LEN ? DLY_LEN - 1 : i1);
      const a0: f32 = dline[cbase + i0];
      const a1: f32 = dline[cbase + i1];
      let delayed: f32 = a0 + (a1 - a0) * frac;

      // glassy de-fizz on the delayed signal
      dmp = dmp + cDamp * (delayed - dmp);
      delayed = dmp;

      // write input + feedback (resonant flange path)
      dline[cbase + wp] = x + delayed * fb;

      // wet voice: dry body + modulated voice (chorus blends, flanger combs)
      const wet: f32 = x * 0.55 + delayed * wetGain;

      // Width: spread wet voices in stereo. Keep dry centred; pan the wet
      // voice in opposite directions per channel as width increases.
      const wetPan: f32 = c == 0 ? (1.0 + widthSpread * 0.3) : (1.0 - widthSpread * 0.3);
      const wetW: f32 = wet * wetPan;

      outBuf[c * MAX_FRAMES + f] = x * (1.0 - mix) + wetW * mix;

      fbs = delayed;

      wp++;
      if (wp >= DLY_LEN) wp = 0;
      ph += phInc;
      if (ph >= 1.0) ph -= 1.0;
    }

    writePos[c]  = wp;
    lfoPhase[c]  = ph;
    fbState[c]   = fbs;
    dampState[c] = dmp;
  }
}
