// =====================================================================
//  COMPANDER — a companding "noise-reduction character" processor (Dolby
//  A/SR + HX lineage). Distinct from the factory's studio compressors: a
//  level-dependent compress→expand with HF pre-emphasis that imparts the
//  characteristic tape-NR sheen and gentle "breathing" — used here as a
//  tone/dynamics colour. Controls: Squeeze (compand depth), HF (high-shelf
//  emphasis), Tone (tilt), Output, Mix. No host imports, no alloc in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let envL: f32 = 0.0; let envR: f32 = 0.0;
let hsL: f32 = 0.0; let hsR: f32 = 0.0;   // high-shelf state (one-pole HP for emphasis)
let tiltL: f32 = 0.0; let tiltR: f32 = 0.0;

const P_SQUEEZE: i32 = 0; const P_HF: i32 = 1; const P_TONE: i32 = 2; const P_OUTPUT: i32 = 3; const P_MIX: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  envL = 0.0; envR = 0.0; hsL = 0.0; hsR = 0.0; tiltL = 0.0; tiltR = 0.0;
  params[P_SQUEEZE] = 0.5; params[P_HF] = 0.5; params[P_TONE] = 0.5; params[P_OUTPUT] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const sq: f32 = clampf(params[P_SQUEEZE], 0.0, 1.0);
  const hfN: f32 = clampf(params[P_HF], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const outN: f32 = clampf(params[P_OUTPUT], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  const envCoef: f32 = f32(Mathf.exp(-1.0 / (0.01 * sampleRate)));  // ~10 ms detector
  const hfco: f32 = 0.55;                       // high-shelf split point
  const hfGain: f32 = hfN * 1.8;                // emphasis amount
  const tilt: f32 = (toneN - 0.5) * 2.0;        // -1..1 dark..bright
  const tiltco: f32 = 0.18;
  const makeup: f32 = 0.7 + outN * 1.2;
  const dry: f32 = 1.0 - mix;
  const stereo: i32 = 1;

  for (let i = 0; i < n; i++) {
    let xl: f32 = inBuf[i];
    let xr: f32 = stereo ? inBuf[MAX_FRAMES + i] : xl;

    // --- channel L ---
    // envelope
    const al: f32 = xl < 0.0 ? -xl : xl;
    envL = al > envL ? al : envL * envCoef + al * (1.0 - envCoef);
    // companding gain: quiet boosted, loud tamed (level-dependent), depth = squeeze
    let gl: f32 = 1.0 / (1.0 + sq * 2.5 * envL);     // compress
    gl = 1.0 + (gl - 1.0);                            // (identity wrap, keeps f32)
    let yl: f32 = xl * (1.0 + sq * (gl - 1.0) + sq * 0.3); // squeezed
    // HF emphasis (one-pole high-pass -> add back as shelf)
    hsL += (yl - hsL) * hfco; const hpl: f32 = yl - hsL;
    yl = yl + hpl * hfGain;
    // tilt tone
    tiltL += (yl - tiltL) * tiltco; const lowl: f32 = tiltL; const highl: f32 = yl - tiltL;
    yl = yl + (tilt > 0.0 ? highl * tilt : lowl * (-tilt));
    yl *= makeup;

    // --- channel R ---
    const ar: f32 = xr < 0.0 ? -xr : xr;
    envR = ar > envR ? ar : envR * envCoef + ar * (1.0 - envCoef);
    let gr: f32 = 1.0 / (1.0 + sq * 2.5 * envR);
    let yr: f32 = xr * (1.0 + sq * (gr - 1.0) + sq * 0.3);
    hsR += (yr - hsR) * hfco; const hpr: f32 = yr - hsR;
    yr = yr + hpr * hfGain;
    tiltR += (yr - tiltR) * tiltco; const lowr: f32 = tiltR; const highr: f32 = yr - tiltR;
    yr = yr + (tilt > 0.0 ? highr * tilt : lowr * (-tilt));
    yr *= makeup;

    let ol: f32 = xl * dry + yl * mix;
    let orr: f32 = xr * dry + yr * mix;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[i] = ol;
    outBuf[MAX_FRAMES + i] = orr;
  }
}
