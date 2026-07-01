// =====================================================================
//  EDGE ECHO — a bright rack DIGITAL DELAY with a coloured input PREAMP.
//  Lineage: the early-80s programmable rackmount digital delay (Korg
//  SDD-3000 family) famous for a punchy, present "edge" tone — its input
//  PREAMP adds drive/presence before clean, slightly bright digital
//  repeats. Distinct from the pristine/tape/BBD echoes already in the
//  factory by that preamp colour + crisp rhythmic repeats.
//
//  Signal: in -> preamp drive (soft clip + presence tilt) -> delay line
//          with filtered feedback -> dry/wet mix.
//  Pure algorithm, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const DLEN: i32 = 131072;          // ~2.7 s @ 48k, power of two
const DMASK: i32 = DLEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const dlL: StaticArray<f32> = new StaticArray<f32>(DLEN);
const dlR: StaticArray<f32> = new StaticArray<f32>(DLEN);

let sampleRate: f32 = 48000.0;
let wp: i32 = 0;            // write pointer
let lpL: f32 = 0.0;        // feedback tone state
let lpR: f32 = 0.0;
let preL: f32 = 0.0;       // preamp presence-tilt state
let preR: f32 = 0.0;
let curDelay: f32 = 12000.0; // smoothed delay length in samples

const P_DRIVE: i32 = 0;    // preamp drive / presence
const P_TIME:  i32 = 1;    // delay time
const P_FB:    i32 = 2;    // feedback
const P_TONE:  i32 = 3;    // repeat tone (HF damping)
const P_MIX:   i32 = 4;    // dry/wet

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function satf(x: f32): f32 { const c: f32 = clampf(x, -3.0, 3.0); return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c)); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  wp = 0; lpL = 0.0; lpR = 0.0; preL = 0.0; preR = 0.0;
  for (let i = 0; i < DLEN; i++) { dlL[i] = 0.0; dlR[i] = 0.0; }
  curDelay = 0.18 * sampleRate;
  params[P_DRIVE] = 0.45;
  params[P_TIME]  = 0.38;
  params[P_FB]    = 0.4;
  params[P_TONE]  = 0.6;
  params[P_MIX]   = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const drive: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const timeN: f32 = clampf(params[P_TIME],  0.0, 1.0);
  const fbN:   f32 = clampf(params[P_FB],    0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE],  0.0, 1.0);
  const mix:   f32 = clampf(params[P_MIX],   0.0, 1.0);

  // delay time: ~20 ms .. ~1.2 s
  const tgtDelay: f32 = (0.02 + timeN * 1.18) * sampleRate;
  const dSmooth: f32 = 0.0006;

  // preamp: drive into a soft clip + a presence tilt (high shelf-ish)
  const preGain: f32 = 1.0 + drive * 4.0;
  const presence: f32 = 0.15 + drive * 0.55;     // amount of HF emphasis

  // feedback amount (bounded < 1 for stability)
  const fb: f32 = fbN * 0.92;
  // repeat tone: bright (toneN high) -> less damping
  const damp: f32 = 0.05 + (1.0 - toneN) * 0.85;

  const dry: f32 = 1.0 - mix * 0.5;   // gentle dry attenuation so wet sits in
  const wet: f32 = mix;
  const stereo: i32 = 1;

  for (let i = 0; i < n; i++) {
    curDelay += (tgtDelay - curDelay) * dSmooth;

    let xl: f32 = inBuf[i];
    let xr: f32 = inBuf[MAX_FRAMES + i];

    // ---- input PREAMP: presence tilt then soft drive ----
    preL += (xl - preL) * 0.5; const hpl: f32 = xl - preL; // crude HP for presence
    preR += (xr - preR) * 0.5; const hpr: f32 = xr - preR;
    let dl: f32 = satf((xl + hpl * presence) * preGain) * (0.7 / (0.7 + drive * 0.6));
    let dr: f32 = satf((xr + hpr * presence) * preGain) * (0.7 / (0.7 + drive * 0.6));

    // ---- read delayed (linear interpolation) ----
    const rp: f32 = f32(wp) - curDelay;
    let ri: i32 = i32(rp);
    const fr: f32 = rp - f32(ri);
    const a0: i32 = ri & DMASK;
    const a1: i32 = (ri + 1) & DMASK;
    let yL: f32 = dlL[a0] + (dlL[a1] - dlL[a0]) * fr;
    let yR: f32 = dlR[a0] + (dlR[a1] - dlR[a0]) * fr;

    // ---- damp the repeats (one-pole LP in feedback) ----
    lpL += (yL - lpL) * (1.0 - damp); const fbL: f32 = lpL;
    lpR += (yR - lpR) * (1.0 - damp); const fbR: f32 = lpR;

    // ---- write input + feedback ----
    dlL[wp] = clampf(dl + fbL * fb, -1.5, 1.5);
    dlR[wp] = clampf(dr + fbR * fb, -1.5, 1.5);
    wp = (wp + 1) & DMASK;

    // ---- mix ----
    let ol: f32 = xl * dry + yL * wet;
    let orr: f32 = xr * dry + yR * wet;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[i] = ol;
    outBuf[MAX_FRAMES + i] = stereo ? orr : ol;
  }
}
