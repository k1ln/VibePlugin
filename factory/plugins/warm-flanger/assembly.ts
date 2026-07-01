// =====================================================================
//  WARM FLANGER — a lush, BBD-style analog flanger (effect)
//
//  A bucket-brigade-flavoured flanger: a short fractional delay line is
//  swept by a slow triangle LFO around a parked centre (Manual). Width
//  sets the sweep depth, Rate the LFO speed, Regen the feedback. The
//  feedback path is gently low-passed (a "warm" BBD/companding flavour)
//  and softly saturated so heavy Regen thickens and resonates without
//  turning clangy or harsh — creamy rather than metallic. Stereo gets a
//  small LFO phase offset for a gentle moving image. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: up to ~12 ms per channel is plenty for a flanger.
// 1024 samples @ 48k ~= 21.3 ms; comfortable headroom for centre+width.
const DLINE: i32 = 1024;
const DMASK: i32 = DLINE - 1;
const delayL: StaticArray<f32> = new StaticArray<f32>(DLINE);
const delayR: StaticArray<f32> = new StaticArray<f32>(DLINE);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel running state
let writePos: i32 = 0;
let lfoPhase: f32 = 0.0;            // 0..1 triangle phase (shared, R offset applied)
let fbLpL: f32 = 0.0;              // feedback low-pass memory (warmth)
let fbLpR: f32 = 0.0;
let fbStoreL: f32 = 0.0;           // last wet sample fed back
let fbStoreR: f32 = 0.0;

const P_MANUAL: i32 = 0;  // 0..1 -> centre delay 0.3..7.0 ms
const P_WIDTH:  i32 = 1;  // 0..1 -> sweep depth (fraction of headroom)
const P_RATE:   i32 = 2;  // 0..1 -> LFO 0.05..6 Hz
const P_REGEN:  i32 = 3;  // 0..1 -> feedback 0..0.9 (signed positive, warm)
const P_MIX:    i32 = 4;  // 0..1 dry/wet

const PI: f32 = 3.14159265;
const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DLINE; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  writePos = 0;
  lfoPhase = 0.0;
  fbLpL = 0.0; fbLpR = 0.0;
  fbStoreL = 0.0; fbStoreR = 0.0;
  params[P_MANUAL] = 0.35;
  params[P_WIDTH]  = 0.55;
  params[P_RATE]   = 0.25;
  params[P_REGEN]  = 0.45;
  params[P_MIX]    = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// gentle soft clip for the feedback path — keeps heavy regen creamy
@inline function softSat(x: f32): f32 {
  const c: f32 = clampf(x, -1.5, 1.5);
  return c - (c * c * c) * (1.0 / 6.75); // mild cubic, stays < |1|-ish, smooth
}

// triangle 0..1 phase -> -1..1 bipolar triangle (smoother than saw sweep)
@inline function tri(p: f32): f32 {
  // p in 0..1; triangle peaks at 0.5
  const x: f32 = p < 0.5 ? p * 2.0 : (1.0 - p) * 2.0; // 0..1..0
  return x; // 0..1 unipolar shape (we use it as positive depth modulator)
}

// fractional read from a delay line (linear interpolation)
@inline function readFrac(line: StaticArray<f32>, wpos: i32, delaySamps: f32): f32 {
  let rp: f32 = f32(wpos) - delaySamps;
  while (rp < 0.0) rp += f32(DLINE);
  const i0: i32 = i32(rp) & DMASK;
  const i1: i32 = (i0 + 1) & DMASK;
  const frac: f32 = rp - Mathf.floor(rp);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return a + (b - a) * frac;
}

export function process(n: i32): void {
  const manual: f32 = clampf(params[P_MANUAL], 0.0, 1.0);
  const width:  f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const rateN:  f32 = clampf(params[P_RATE], 0.0, 1.0);
  const regenN: f32 = clampf(params[P_REGEN], 0.0, 1.0);
  const mix:    f32 = clampf(params[P_MIX], 0.0, 1.0);

  // centre delay 0.3..7.0 ms (parked position) in samples
  const centreMs: f32 = 0.3 + manual * 6.7;
  const centreSamps: f32 = centreMs * 0.001 * sampleRate;
  // sweep depth in samples: up to ~3.5 ms peak-to-base, scaled by Width.
  // keep total read delay safely within [1 .. DLINE-2]
  const depthMs: f32 = width * 3.5;
  const depthSamps: f32 = depthMs * 0.001 * sampleRate;

  // LFO 0.05 .. 6 Hz, exponential feel
  const rateHz: f32 = 0.05 + rateN * rateN * 5.95;
  const phaseInc: f32 = rateHz / sampleRate;

  // feedback gain 0..0.9, kept musical
  const fb: f32 = regenN * 0.9;
  // feedback warmth low-pass coefficient ~ 4 kHz (tames metallic highs)
  const lpHz: f32 = 4000.0;
  const lpC: f32 = f32(1.0 - Mathf.exp(-TWO_PI * lpHz / sampleRate));

  const maxRead: f32 = f32(DLINE - 2);

  let ph: f32 = lfoPhase;

  for (let f = 0; f < n; f++) {
    // advance LFO
    ph += phaseInc;
    if (ph >= 1.0) ph -= 1.0;

    // L channel uses ph, R channel a quarter-cycle offset for gentle stereo
    let phR: f32 = ph + 0.25;
    if (phR >= 1.0) phR -= 1.0;

    const modL: f32 = tri(ph);   // 0..1
    const modR: f32 = tri(phR);  // 0..1

    // read delay grows from centre by depth*mod (sweeps "up" from parked centre)
    let dL: f32 = centreSamps + depthSamps * modL;
    let dR: f32 = centreSamps + depthSamps * modR;
    if (dL < 1.0) dL = 1.0; if (dL > maxRead) dL = maxRead;
    if (dR < 1.0) dR = 1.0; if (dR > maxRead) dR = maxRead;

    // ---- LEFT ----
    const xL: f32 = inBuf[f];
    const wetReadL: f32 = readFrac(delayL, writePos, dL);
    // feedback: warm low-passed + softly saturated previous wet
    fbLpL = fbLpL + lpC * (fbStoreL - fbLpL);
    const inputL: f32 = xL + softSat(fbLpL * fb);
    delayL[writePos] = inputL;
    fbStoreL = wetReadL;
    const outL: f32 = xL * (1.0 - mix) + wetReadL * mix;

    // ---- RIGHT ----
    let xR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : xL;
    const wetReadR: f32 = readFrac(delayR, writePos, dR);
    fbLpR = fbLpR + lpC * (fbStoreR - fbLpR);
    const inputR: f32 = xR + softSat(fbLpR * fb);
    delayR[writePos] = inputR;
    fbStoreR = wetReadR;
    const outR: f32 = xR * (1.0 - mix) + wetReadR * mix;

    outBuf[f] = outL;
    if (channels > 1) outBuf[MAX_FRAMES + f] = outR;

    writePos = (writePos + 1) & DMASK;
  }

  lfoPhase = ph;
}
