// =====================================================================
//  HOLD ECHO — studio digital delay with modulation and infinite hold
//  (PCM42 lineage). A clean digital delay line whose read tap is gently
//  wobbled by an LFO (chorus / pitch-warble repeats), the feedback path
//  is band-shaped by a tilt tone filter (darken or brighten the repeats),
//  and a HOLD control pushes feedback toward ~1.0 so the buffer loops /
//  freezes without runaway. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: up to ~1.2 s per channel at 48k gives plenty of headroom and
// a generous hold-loop length. Sized fixed so process() never allocates.
const DELAY_LEN: i32 = 65536; // ~1.36 s @ 48k per channel
const dline: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel state
const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const lpState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone low-pass in fb path
const hpState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone high-pass (tilt)
const dcState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // dc blocker

// smoothed delay time (in samples) so Time moves without zipper / clicks
let smoothDelay: f32 = 12000.0;

// LFO phase for the modulation wobble (quadrature per channel for stereo width)
let lfoPhase: f32 = 0.0;

const P_TIME: i32 = 0;  // 0..1 -> delay 30..900 ms
const P_FB:   i32 = 1;  // 0..1 -> feedback 0..0.95
const P_MOD:  i32 = 2;  // 0..1 -> delay-time wobble depth
const P_TONE: i32 = 3;  // 0..1 -> tilt filter on repeats (0 dark, 1 bright)
const P_HOLD: i32 = 4;  // 0..1 -> push feedback toward ~1.0, mute input into line
const P_MIX:  i32 = 5;  // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DELAY_LEN * MAX_CHANNELS; i++) dline[i] = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0; lpState[c] = 0.0; hpState[c] = 0.0; dcState[c] = 0.0;
  }
  smoothDelay = 12000.0;
  lfoPhase = 0.0;
  params[P_TIME] = 0.35;
  params[P_FB]   = 0.45;
  params[P_MOD]  = 0.30;
  params[P_TONE] = 0.5;
  params[P_HOLD] = 0.0;
  params[P_MIX]  = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// soft saturator keeps the hold loop / high-feedback bounded (no runaway clip)
@inline function softLimit(x: f32): f32 {
  const c: f32 = clampf(x, -2.0, 2.0);
  return f32(c - 0.1481481 * c * c * c); // ~tanh-ish, unity slope at 0, bounded
}

// linear-interpolated read from a channel's delay line at fractional sample
// distance `delaySamp` behind the write head
@inline function readDelay(base: i32, wp: i32, delaySamp: f32): f32 {
  let d: f32 = delaySamp;
  if (d < 1.0) d = 1.0;
  if (d > f32(DELAY_LEN - 2)) d = f32(DELAY_LEN - 2);
  const id: i32 = i32(d);
  const frac: f32 = d - f32(id);
  let i0: i32 = wp - id;
  while (i0 < 0) i0 += DELAY_LEN;
  let i1: i32 = i0 - 1;
  while (i1 < 0) i1 += DELAY_LEN;
  const a: f32 = dline[base + i0];
  const b: f32 = dline[base + i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN:   f32 = clampf(params[P_FB],   0.0, 1.0);
  const modN:  f32 = clampf(params[P_MOD],  0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const holdN: f32 = clampf(params[P_HOLD], 0.0, 1.0);
  const mix:   f32 = clampf(params[P_MIX],  0.0, 1.0);

  // target delay in samples: 30..900 ms
  const ms: f32 = 30.0 + timeN * 870.0;
  const targetDelay: f32 = clampf(ms * 0.001 * sampleRate, 2.0, f32(DELAY_LEN - 600));

  // base feedback 0..0.95; HOLD lifts it toward ~1.0 and fades the input feed
  // into the line so the captured buffer loops/freezes (bounded by softLimit)
  const baseFb: f32 = fbN * 0.95;
  const fb: f32 = baseFb + holdN * (0.9995 - baseFb);
  const inGain: f32 = 1.0 - holdN; // at full hold, no new audio enters the loop

  // tone = tilt: low tone darkens (low-pass), high tone brightens (high-pass mix)
  // low-pass corner 700..9000 Hz, plus a fixed gentle high-pass to avoid build-up
  const lpHz: f32 = 700.0 + toneN * toneN * 8300.0;
  const cLp: f32 = f32(1.0 - Mathf.exp(-PI2 * lpHz / sampleRate));
  const cHp: f32 = f32(1.0 - Mathf.exp(-PI2 * 35.0 / sampleRate)); // dc/rumble blocker

  // modulation: LFO ~0.35 Hz, depth up to ~12 ms of delay-time wobble
  const lfoHz: f32 = 0.15 + modN * 1.2;
  const lfoInc: f32 = PI2 * lfoHz / sampleRate;
  const modDepth: f32 = modN * 0.012 * sampleRate; // samples of swing

  // delay-time smoothing coefficient (~30 ms glide)
  const smoothC: f32 = f32(1.0 - Mathf.exp(-PI2 * 6.0 / sampleRate));

  let lph: f32 = lfoPhase;

  for (let f = 0; f < n; f++) {
    // advance smoothed delay and LFO once per frame (shared across channels)
    smoothDelay += smoothC * (targetDelay - smoothDelay);
    lph += lfoInc; if (lph >= PI2) lph -= PI2;
    const modL: f32 = Mathf.sin(lph) * modDepth;
    const modR: f32 = Mathf.sin(lph + 1.5707963) * modDepth; // quadrature for width

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * DELAY_LEN;
      const wp: i32 = writePos[c];

      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // modulated read distance (wobbles the pitch of the repeats)
      const md: f32 = c == 0 ? modL : modR;
      let dd: f32 = smoothDelay + md;
      if (dd < 2.0) dd = 2.0;
      const wet: f32 = readDelay(base, wp, dd);

      // tone-shape the feedback signal: low-pass then dc/rumble high-pass
      let lp: f32 = lpState[c];
      lp = lp + cLp * (wet - lp);
      lpState[c] = lp;
      let dc: f32 = dcState[c];
      dc = dc + cHp * (lp - dc);
      dcState[c] = dc;
      const shaped: f32 = lp - dc; // band-limited repeat

      // write input + bounded feedback back into the line
      const toLine: f32 = softLimit(x * inGain + shaped * fb);
      dline[base + wp] = toLine;

      // advance write head
      let nwp: i32 = wp + 1; if (nwp >= DELAY_LEN) nwp = 0;
      writePos[c] = nwp;

      // mix: equal-ish, wet uses the shaped repeat
      const o: f32 = x * (1.0 - mix) + shaped * mix;
      outBuf[c * MAX_FRAMES + f] = clampf(o, -1.5, 1.5);
    }
  }

  lfoPhase = lph;
}
