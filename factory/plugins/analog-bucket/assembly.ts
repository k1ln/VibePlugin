// =====================================================================
//  ANALOG BUCKET — a generic bucket-brigade (BBD) model: short, dark,
//  companded delay that doubles as a chorus/vibrato. A modulated BBD delay
//  line with progressively darker repeats and gentle compander grit; at
//  short times + high Mod it's a lush chorus, at longer times a warm
//  analog echo. Controls: Time, Feedback, Mod (chorus depth), Tone (BBD
//  darkness), Mix. No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const DLEN: i32 = 32768; const DMASK: i32 = DLEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const dl: StaticArray<f32> = new StaticArray<f32>(DLEN);
let wp: i32 = 0;
let lpFb: f32 = 0.0;
let lfoPh: f32 = 0.0;
let curD: f32 = 1000.0;
let sampleRate: f32 = 48000.0;

const P_TIME: i32 = 0; const P_FB: i32 = 1; const P_MOD: i32 = 2; const P_TONE: i32 = 3; const P_MIX: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function satf(x: f32): f32 { const c: f32 = clampf(x, -2.5, 2.5); return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c)); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  wp = 0; lpFb = 0.0; lfoPh = 0.0; curD = 0.02 * sampleRate;
  for (let i = 0; i < DLEN; i++) dl[i] = 0.0;
  params[P_TIME] = 0.3; params[P_FB] = 0.4; params[P_MOD] = 0.35; params[P_TONE] = 0.5; params[P_MIX] = 0.4;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FB], 0.0, 1.0);
  const modN: f32 = clampf(params[P_MOD], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // BBD range: ~3 ms (chorus) .. ~600 ms (echo)
  const tgtD: f32 = (0.003 + timeN * timeN * 0.6) * sampleRate;
  const fb: f32 = fbN * 0.9;
  const damp: f32 = 0.05 + (1.0 - toneN) * 0.8;          // darker = more BBD HF loss
  const modDepth: f32 = modN * 0.004 * sampleRate;        // up to ~4 ms wobble
  const lfoInc: f32 = 0.9 / sampleRate * 6.2831853;
  const dry: f32 = 1.0 - mix * 0.5;
  const wet: f32 = mix;
  const stereo: i32 = 1;

  for (let i = 0; i < n; i++) {
    curD += (tgtD - curD) * 0.0005;
    lfoPh += lfoInc; if (lfoPh > 6.2831853) lfoPh -= 6.2831853;
    const d: f32 = curD + modDepth * f32(Mathf.sin(lfoPh));
    const xl: f32 = inBuf[i];
    const xr: f32 = stereo ? inBuf[MAX_FRAMES + i] : xl;
    const x: f32 = (xl + xr) * 0.5;

    const rp: f32 = f32(wp) - d;
    let ri: i32 = i32(rp); const fr: f32 = rp - f32(ri);
    const a0: i32 = ri & DMASK; const a1: i32 = (ri + 1) & DMASK;
    let y: f32 = dl[a0] + (dl[a1] - dl[a0]) * fr;
    // BBD darkening + compander grit in the feedback
    lpFb += (y - lpFb) * (1.0 - damp); const yd: f32 = lpFb;
    dl[wp] = clampf(satf(x + yd * fb), -1.5, 1.5);
    wp = (wp + 1) & DMASK;

    // stereo: slight L/R offset read for width
    const rp2: f32 = f32(wp) - d * 0.97;
    let ri2: i32 = i32(rp2); const fr2: f32 = rp2 - f32(ri2);
    const b0: i32 = ri2 & DMASK; const b1: i32 = (ri2 + 1) & DMASK;
    const y2: f32 = dl[b0] + (dl[b1] - dl[b0]) * fr2;

    let ol: f32 = xl * dry + y * wet;
    let orr: f32 = xr * dry + y2 * wet;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[i] = ol; outBuf[MAX_FRAMES + i] = orr;
  }
}
