// =====================================================================
//  GRANULAR CLOUD — a granular delay / cloud processor
//  Incoming audio is captured into a stereo ring buffer. A fixed pool of
//  overlapping grains (no allocation in process) is sprayed back out of
//  that buffer with a Hann window, each grain reading from a slightly
//  delayed, spray-randomised position at a chosen playback rate (Pitch).
//  Density sets how often new grains are spawned; the wet cloud is fed
//  back into the ring buffer (Feedback) and blended with the dry (Mix).
//  Pure algorithm on the live input — no user sample file needed.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Ring buffer — ~2 seconds per channel of recent input (+ wet feedback).
const RING: i32 = 96000;                       // 2 s @ 48k, per channel
const ring: StaticArray<f32> = new StaticArray<f32>(RING * MAX_CHANNELS);
let writePos: i32 = 0;                          // shared write head

// Fixed grain pool — NO allocation in process().
const MAX_GRAINS: i32 = 48;
const gActive: StaticArray<i32> = new StaticArray<i32>(MAX_GRAINS); // 0/1
const gPos:    StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // read head into ring (frames)
const gRate:   StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // playback rate (pitch)
const gPhase:  StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // 0..1 window phase
const gInc:    StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // window phase increment
const gPanL:   StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // equal-power pan
const gPanR:   StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// grain spawn accounting + RNG state
let spawnAccum: f32 = 0.0;
let rngState: u32 = 0x2545f491;

const P_SIZE: i32 = 0;     // 0..1 -> grain length 20..400 ms
const P_DENSITY: i32 = 1;  // 0..1 -> grains/sec (overlap)
const P_PITCH: i32 = 2;    // 0..1 -> playback rate, -12..+12 semitones
const P_SPRAY: i32 = 3;    // 0..1 -> position randomisation depth
const P_FEEDBACK: i32 = 4; // 0..1 -> wet recirculation into the ring
const P_MIX: i32 = 5;      // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  spawnAccum = 0.0;
  rngState = 0x2545f491;
  for (let i = 0; i < MAX_GRAINS; i++) {
    gActive[i] = 0; gPos[i] = 0.0; gRate[i] = 1.0;
    gPhase[i] = 0.0; gInc[i] = 0.0; gPanL[i] = 0.7071; gPanR[i] = 0.7071;
  }
  for (let i = 0; i < RING * MAX_CHANNELS; i++) ring[i] = 0.0;
  params[P_SIZE] = 0.45;
  params[P_DENSITY] = 0.5;
  params[P_PITCH] = 0.5;
  params[P_SPRAY] = 0.4;
  params[P_FEEDBACK] = 0.35;
  params[P_MIX] = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// xorshift32 -> f32 in [0,1)
@inline function rndf(): f32 {
  let x: u32 = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return f32(x & 0x00ffffff) / f32(0x01000000);
}

// read the ring buffer for channel c at fractional frame position `pos`
// (linear interpolation). pos is wrapped into [0,RING).
@inline function readRing(c: i32, pos: f32): f32 {
  let p: f32 = pos;
  const rf: f32 = f32(RING);
  while (p < 0.0) p += rf;
  while (p >= rf) p -= rf;
  const i0: i32 = i32(p);
  let i1: i32 = i0 + 1; if (i1 >= RING) i1 = 0;
  const frac: f32 = p - f32(i0);
  const base: i32 = c * RING;
  const a: f32 = ring[base + i0];
  const b: f32 = ring[base + i1];
  return f32(a + (b - a) * frac);
}

// pitch ratio for a 0..1 control mapped to -12..+12 semitones
@inline function pitchRatio(n01: f32): f32 {
  const semis: f32 = (n01 - 0.5) * 24.0;             // -12..+12
  const ln2over12: f32 = 0.05776226504666;            // ln(2)/12
  return f32(Mathf.exp(semis * ln2over12));
}

export function process(n: i32): void {
  const size01: f32 = clampf(params[P_SIZE], 0.0, 1.0);
  const dens01: f32 = clampf(params[P_DENSITY], 0.0, 1.0);
  const pitch01: f32 = clampf(params[P_PITCH], 0.0, 1.0);
  const spray01: f32 = clampf(params[P_SPRAY], 0.0, 1.0);
  const fb: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0) * 0.85;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // grain length in frames: 20..400 ms
  const grainMs: f32 = 20.0 + size01 * 380.0;
  const grainLen: f32 = clampf(grainMs * 0.001 * sampleRate, 32.0, f32(RING) * 0.45);
  const winInc: f32 = 1.0 / grainLen;            // window phase per frame

  // density -> spawn rate (grains/sec). Higher density = thicker cloud.
  const rate: f32 = 4.0 + dens01 * dens01 * 120.0;
  const spawnPerFrame: f32 = rate / sampleRate;

  // base playback rate for this block
  const baseRate: f32 = pitchRatio(pitch01);

  // spray depth in frames: up to ~0.5 s of position scatter
  const sprayFrames: f32 = spray01 * 0.5 * sampleRate;

  // small fixed delay so grains read already-recorded audio (granular delay)
  const baseDelay: f32 = 0.10 * sampleRate;      // 100 ms behind the write head

  // gain compensation: with overlap the cloud can sum loud; scale by density.
  const wetGain: f32 = 0.9 / f32(Mathf.sqrt(1.0 + rate * grainLen / sampleRate));

  for (let f = 0; f < n; f++) {
    const dryL: f32 = inBuf[f];
    const dryR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : dryL;

    // --- spawn grains for this frame ---
    spawnAccum += spawnPerFrame;
    while (spawnAccum >= 1.0) {
      spawnAccum -= 1.0;
      // find a free slot
      let slot: i32 = -1;
      for (let g = 0; g < MAX_GRAINS; g++) {
        if (gActive[g] == 0) { slot = g; break; }
      }
      if (slot >= 0) {
        gActive[slot] = 1;
        gPhase[slot] = 0.0;
        gInc[slot] = winInc;
        // read start: behind the write head by base delay + sprayed offset
        const scatter: f32 = (rndf() * 2.0 - 1.0) * sprayFrames;
        let start: f32 = f32(writePos) - baseDelay - scatter;
        gPos[slot] = start;
        // small per-grain pitch jitter for an organic cloud
        const jitter: f32 = 1.0 + (rndf() * 2.0 - 1.0) * 0.01;
        gRate[slot] = baseRate * jitter;
        // random equal-power pan -> stereo spread
        const pan: f32 = rndf();                  // 0..1
        const ang: f32 = pan * 1.5707963;         // 0..pi/2
        gPanL[slot] = f32(Mathf.cos(ang));
        gPanR[slot] = f32(Mathf.sin(ang));
      }
    }

    // --- render all active grains ---
    let wetL: f32 = 0.0;
    let wetR: f32 = 0.0;
    for (let g = 0; g < MAX_GRAINS; g++) {
      if (gActive[g] == 0) continue;
      const ph: f32 = gPhase[g];
      // Hann window 0..1
      const win: f32 = f32(0.5 - 0.5 * Mathf.cos(6.2831853 * ph));
      const pos: f32 = gPos[g];
      const sL: f32 = readRing(0, pos);
      const sR: f32 = channels > 1 ? readRing(1, pos) : sL;
      const wv: f32 = win;
      wetL += sL * wv * gPanL[g];
      wetR += sR * wv * gPanR[g];
      // advance grain read head + window
      gPos[g] = pos + gRate[g];
      const np: f32 = ph + gInc[g];
      if (np >= 1.0) { gActive[g] = 0; } else { gPhase[g] = np; }
    }

    wetL *= wetGain;
    wetR *= wetGain;

    // soft saturation to keep the recirculating cloud bounded
    wetL = f32(Mathf.tanh(wetL));
    wetR = f32(Mathf.tanh(wetR));

    // --- write input (+ feedback of the wet cloud) into the ring ---
    const wIdx: i32 = writePos;
    ring[wIdx] = clampf(dryL + wetL * fb, -1.5, 1.5);
    ring[RING + wIdx] = clampf(dryR + wetR * fb, -1.5, 1.5);
    writePos = wIdx + 1; if (writePos >= RING) writePos = 0;

    // --- mix dry/wet ---
    const outL: f32 = dryL * (1.0 - mix) + wetL * mix;
    const outR: f32 = dryR * (1.0 - mix) + wetR * mix;
    outBuf[f] = clampf(outL, -1.2, 1.2);
    outBuf[MAX_FRAMES + f] = clampf(outR, -1.2, 1.2);
  }
}
