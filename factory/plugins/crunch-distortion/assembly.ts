// =====================================================================
//  CRUNCH DISTORTION — bright transistor-boost + asymmetric op-amp clip
//  An original model of the classic orange-box distortion pedal: a
//  transistor input boost shapes a hard midrange, an asymmetric op-amp
//  clipping stage adds even-harmonic grit and bias, then an ACTIVE tone
//  tilt cuts lows while boosting highs (and vice-versa). Output level and
//  a dry/wet Mix finish. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel filter state
const hpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip DC/low blocker (one-pole LP for HP)
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post-clip DC blocker (removes asym bias offset)
const tiltLoSt:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone tilt: low-band one-pole LP
const tiltHiSt:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone tilt: high-band one-pole LP (for HP)

const P_DIST:  i32 = 0;  // 0..1 -> input boost gain 1..120 (transistor + op-amp drive)
const P_TONE:  i32 = 1;  // 0..1 -> active tilt: 0 = dark (boost lows), 1 = bright (boost highs)
const P_LEVEL: i32 = 2;  // 0..1 -> output 0..1.2
const P_MIX:   i32 = 3;  // 0..1 dry/wet

const PI: f32 = 3.14159265;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0; dcState[c] = 0.0; tiltLoSt[c] = 0.0; tiltHiSt[c] = 0.0;
  }
  params[P_DIST] = 0.5; params[P_TONE] = 0.5; params[P_LEVEL] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole smoothing coefficient for a corner frequency in Hz
@inline function onePole(hz: f32): f32 {
  return f32(1.0 - Mathf.exp(-2.0 * PI * hz / sampleRate));
}

// Asymmetric op-amp clipping. tanh-style soft saturation but with a small
// positive bias so the positive and negative halves clip differently —
// this is the signature even-harmonic grit of the orange-box circuit.
@inline function clipAsym(x: f32): f32 {
  // bias shifts the operating point; positive excursions saturate sooner
  const b: f32 = f32(x + 0.18);
  const t: f32 = f32(Mathf.tanh(b));
  // harder edge on the positive lobe: blend tanh with a steeper folded curve
  const hard: f32 = f32(t * (1.0 + 0.25 * t * t));
  return f32(hard - 0.178);  // remove most of the static bias offset
}

export function process(n: i32): void {
  const dist01: f32 = clampf(params[P_DIST], 0.0, 1.0);
  const tone01: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.2;
  const mix:    f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Transistor boost: exponential-ish gain so the knob has musical taper.
  const drive: f32 = f32(1.0 + dist01 * dist01 * 119.0);

  // Pre-clip high-pass ~110 Hz: tightens lows so the midrange stays articulate.
  const cHP: f32 = onePole(110.0);
  // Post-clip DC blocker corner (slow) to null the asymmetric bias offset.
  const cDC: f32 = onePole(15.0);

  // Active tone tilt. Split into a low band (LP @ ~720 Hz) and a high band
  // (HP @ ~720 Hz). tone01=0 -> lows up / highs down; tone01=1 -> opposite.
  const cTilt: f32 = onePole(720.0);
  const loGain: f32 = f32(1.4 - tone01 * 1.1);   // 1.4 .. 0.3
  const hiGain: f32 = f32(0.3 + tone01 * 1.7);   // 0.3 .. 2.0

  // Gain compensation so increasing Dist crunches rather than just gets louder.
  const comp: f32 = f32(0.62 / Mathf.sqrt(drive) + 0.18);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32 = hpState[c];
    let dc: f32 = dcState[c];
    let tl: f32 = tiltLoSt[c];
    let th: f32 = tiltHiSt[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- pre-clip tightening high-pass ---
      hp = f32(hp + cHP * (x - hp));
      const pre: f32 = f32(x - hp);

      // --- transistor boost into asymmetric op-amp clipping ---
      const clipped: f32 = f32(clipAsym(pre * drive) * comp);

      // --- post-clip DC blocker (removes residual asymmetric offset) ---
      dc = f32(dc + cDC * (clipped - dc));
      const noDC: f32 = f32(clipped - dc);

      // --- active tone tilt (low band vs high band) ---
      tl = f32(tl + cTilt * (noDC - tl));   // low band
      const lowB: f32 = tl;
      th = f32(th + cTilt * (noDC - th));   // tracking LP for HP
      const highB: f32 = f32(noDC - th);
      const toned: f32 = f32(lowB * loGain + highB * hiGain);

      const wet: f32 = f32(toned * level);
      outBuf[base + f] = f32(x * (1.0 - mix) + wet * mix);
    }
    hpState[c] = hp;
    dcState[c] = dc;
    tiltLoSt[c] = tl;
    tiltHiSt[c] = th;
  }
}
