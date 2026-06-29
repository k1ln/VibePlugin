// =====================================================================
//  WHAMMY — extreme expression-pedal pitch shifter (effect)
//  A delay-line (overlap-add) pitch shifter with two crossfaded read
//  pointers chasing a write pointer at a speed set by the target ratio.
//  The Pedal control sweeps the dry signal toward the shifted target
//  (heel = dry, toe = full shift) so you can dive-bomb or soar in real
//  time. Mode picks the direction: 0 up, 1 down, 2 dual octaves (a
//  shimmering ±octave blend). Wide ±24-semitone Pitch range, Mix sets
//  the wet balance. Crossfaded pointers keep big dives click-free.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// pitch-shift delay line: a generous ring buffer per channel
const DLINE: i32 = 16384;               // power of two -> cheap wrap mask
const DMASK: i32 = DLINE - 1;
const WIN: f32 = 3072.0;                 // crossfade grain length, in samples (~64ms @48k)
const ring: StaticArray<f32> = new StaticArray<f32>(DLINE * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel write position into the ring buffer
const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
// two read phases (in samples behind write), wrapped to [0, WIN)
const phaseA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const phaseB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// second grain pair for the dual-octave mirror voice
const mphaseA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mphaseB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// smoothed pitch ratio (one-pole) so pedal sweeps glide
const ratioState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// DC-blocker state (per channel)
const dcX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const dcY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_PITCH: i32 = 0;  // -24..24 semitones (target at full pedal)
const P_PEDAL: i32 = 1;  // 0..1 blends dry(1.0x) -> target ratio
const P_MODE: i32  = 2;  // 0 up, 1 down, 2 dual octaves
const P_MIX: i32   = 3;  // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0;
    phaseA[c] = 0.0;
    phaseB[c] = WIN * 0.5;   // second pointer half a grain away
    mphaseA[c] = 0.0;
    mphaseB[c] = WIN * 0.5;
    ratioState[c] = 1.0;
    dcX1[c] = 0.0;
    dcY1[c] = 0.0;
  }
  for (let i = 0; i < DLINE * MAX_CHANNELS; i++) ring[i] = 0.0;
  params[P_PITCH] = 12.0;
  params[P_PEDAL] = 1.0;
  params[P_MODE]  = 0.0;
  params[P_MIX]   = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linear read from the ring buffer at a fractional position `behind` write
@inline function readRing(base: i32, wp: i32, behind: f32): f32 {
  let pos: f32 = f32(wp) - behind;
  // wrap into [0, DLINE)
  while (pos < 0.0) pos += f32(DLINE);
  const i0: i32 = i32(pos) & DMASK;
  const i1: i32 = (i0 + 1) & DMASK;
  const fr: f32 = pos - f32(i32(pos));
  const a: f32 = ring[base + i0];
  const b: f32 = ring[base + i1];
  return a + (b - a) * fr;
}

export function process(n: i32): void {
  const pitchSemi: f32 = clampf(params[P_PITCH], -24.0, 24.0);
  const pedal: f32 = clampf(params[P_PEDAL], 0.0, 1.0);
  const mode: i32 = i32(clampf(params[P_MODE], 0.0, 2.0) + 0.5);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // smoothing coefficient: gentle glide on the ratio (~30ms)
  const smooth: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * 12.0 / sampleRate)), 0.0, 1.0);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * DLINE;
    const abase: i32 = c * MAX_FRAMES;
    let wp: i32 = writePos[c];
    let pa: f32 = phaseA[c];
    let pb: f32 = phaseB[c];
    let ma: f32 = mphaseA[c];
    let mb: f32 = mphaseB[c];
    let rs: f32 = ratioState[c];
    let dx1: f32 = dcX1[c];
    let dy1: f32 = dcY1[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[abase + f];

      // write current input into the ring
      ring[base + wp] = x;

      // ---- target pitch ratio for this mode -----------------------
      // ratioUp/ratioDown derived from the pedal-swept semitone amount.
      // Pedal blends the *semitone* target from 0 (dry) to full Pitch.
      let target: f32 = 1.0;
      if (mode == 0) {
        // UP: bend toward +|pitch| (heel dry -> toe up)
        const semis: f32 = pedal * (pitchSemi >= 0.0 ? pitchSemi : -pitchSemi);
        target = f32(Mathf.pow(2.0, semis / 12.0));
      } else if (mode == 1) {
        // DOWN: bend toward -|pitch| (heel dry -> toe down)
        const semis: f32 = pedal * (pitchSemi >= 0.0 ? pitchSemi : -pitchSemi);
        target = f32(Mathf.pow(2.0, -semis / 12.0));
      } else {
        // DUAL OCTAVES: pedal sweeps the magnitude; sign of Pitch chooses
        // which octave leads, but always a blend of +1oct and -1oct flavour.
        const semis: f32 = pedal * pitchSemi; // signed so dual differs from up
        target = f32(Mathf.pow(2.0, semis / 12.0));
      }

      // smooth the ratio so dives don't zipper
      rs += smooth * (target - rs);

      // Per output sample the read pointer's distance "behind" the write head
      // must change by (1 - ratio): a ratio > 1 (pitch UP) shrinks the gap so
      // we read samples FASTER, chasing the write head and raising pitch.
      const delta: f32 = 1.0 - rs;
      pa += delta;
      pb += delta;
      // keep grain phases inside [0, WIN)
      if (pa >= WIN) pa -= WIN; else if (pa < 0.0) pa += WIN;
      if (pb >= WIN) pb -= WIN; else if (pb < 0.0) pb += WIN;

      // two read taps, each its own grain position; crossfade with a
      // raised-cosine so a tap is silent exactly where it would wrap.
      const ga: f32 = 0.5 - 0.5 * f32(Mathf.cos(PI2 * pa / WIN));
      const gb: f32 = 0.5 - 0.5 * f32(Mathf.cos(PI2 * pb / WIN));
      const sa: f32 = readRing(base, wp, pa + 2.0);
      const sb: f32 = readRing(base, wp, pb + 2.0);
      let wet: f32 = sa * ga + sb * gb;

      // dual-octave mode: add a mirror voice at the reciprocal ratio so the
      // two voices straddle the dry pitch (classic shimmering ±octave stack).
      if (mode == 2) {
        const mrec: f32 = rs > 0.0001 ? 1.0 / rs : 1.0;
        const mdelta: f32 = 1.0 - mrec;
        ma += mdelta;
        mb += mdelta;
        if (ma >= WIN) ma -= WIN; else if (ma < 0.0) ma += WIN;
        if (mb >= WIN) mb -= WIN; else if (mb < 0.0) mb += WIN;
        const mga: f32 = 0.5 - 0.5 * f32(Mathf.cos(PI2 * ma / WIN));
        const mgb: f32 = 0.5 - 0.5 * f32(Mathf.cos(PI2 * mb / WIN));
        const mir: f32 = readRing(base, wp, ma + 2.0) * mga
                       + readRing(base, wp, mb + 2.0) * mgb;
        wet = wet * 0.6 + mir * 0.6;
      }

      // DC blocker (one-pole high-pass) so crossfaded taps sum cleanly.
      const dy: f32 = wet - dx1 + 0.999 * dy1;
      dx1 = wet;
      dy1 = dy;
      wet = dy;

      // gentle limiter to keep peaks bounded on big stacks
      wet = clampf(wet, -1.2, 1.2);

      outBuf[abase + f] = x * (1.0 - mix) + wet * mix;

      // advance write pointer
      wp = (wp + 1) & DMASK;
    }

    writePos[c] = wp;
    phaseA[c] = pa;
    phaseB[c] = pb;
    mphaseA[c] = ma;
    mphaseB[c] = mb;
    ratioState[c] = rs;
    dcX1[c] = dx1;
    dcY1[c] = dy1;
  }
}
