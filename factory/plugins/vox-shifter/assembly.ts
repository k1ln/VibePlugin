// =====================================================================
//  VOX SHIFTER — a formant-aware vocal pitch shifter (PSOLA / phase-
//  vocoder family). A twin-grain crossfaded delay-line pitch shifter
//  moves the PITCH (Shift, +/-12 semitones) click-free, while an
//  independent FORMANT control sweeps a pair of resonant vowel formants
//  over the shifted voice — so you can pitch a voice up without the
//  "chipmunk" formant collapse, or slide the formants for gender/vowel
//  morphs. Mix blends dry/wet, Output trims level. Pure algorithm.
//  Controls: Shift, Formant, Mix, Output.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const LINE_LEN: i32 = 8192;
const WINDOW: f32 = 3600.0;
const delayL: StaticArray<f32> = new StaticArray<f32>(LINE_LEN);
const delayR: StaticArray<f32> = new StaticArray<f32>(LINE_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let writePos: i32 = 0;
let phaseA: f32 = 0.0;
let phaseB: f32 = WINDOW * 0.5;
let smoothRatio: f32 = 1.0;

// two-formant resonant filter state, per channel
const f1lp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const f1bp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const f2lp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const f2bp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_SHIFT: i32 = 0; const P_FORMANT: i32 = 1; const P_MIX: i32 = 2; const P_OUTPUT: i32 = 3;
const TWO_PI: f32 = 6.2831853;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0; phaseA = 0.0; phaseB = WINDOW * 0.5; smoothRatio = 1.0;
  for (let i = 0; i < LINE_LEN; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  for (let c = 0; c < MAX_CHANNELS; c++) { f1lp[c] = 0.0; f1bp[c] = 0.0; f2lp[c] = 0.0; f2bp[c] = 0.0; }
  params[P_SHIFT] = 5.0; params[P_FORMANT] = 0.5; params[P_MIX] = 0.6; params[P_OUTPUT] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function readLine(line: StaticArray<f32>, delaySamples: f32): f32 {
  let rp: f32 = f32(writePos) - delaySamples;
  while (rp < 0.0) rp += f32(LINE_LEN);
  while (rp >= f32(LINE_LEN)) rp -= f32(LINE_LEN);
  const i0: i32 = i32(rp); let i1: i32 = i0 + 1; if (i1 >= LINE_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  return line[i0] + (line[i1] - line[i0]) * frac;
}

export function process(n: i32): void {
  const semis: f32 = clampf(params[P_SHIFT], -12.0, 12.0);
  const formantN: f32 = clampf(params[P_FORMANT], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const output: f32 = clampf(params[P_OUTPUT], 0.0, 1.0);

  const targetRatio: f32 = f32(Mathf.pow(2.0, semis / 12.0));
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 12.0 / sampleRate));
  const stereo: bool = channels > 1;
  const invW: f32 = 1.0 / WINDOW;

  // formant centres sweep with the knob (~ah -> ee), resonant bandpass
  const f1: f32 = 320.0 + formantN * 520.0;              // 320..840 Hz
  const f2: f32 = 900.0 + formantN * 1500.0;             // 900..2400 Hz
  const g1: f32 = f32(Mathf.tan(3.14159265 * f1 / sampleRate));
  const g2: f32 = f32(Mathf.tan(3.14159265 * f2 / sampleRate));
  const kf: f32 = 0.35;                                  // resonance (narrow-ish)
  const a1f1: f32 = 1.0 / (1.0 + g1 * (g1 + kf));
  const a1f2: f32 = 1.0 / (1.0 + g2 * (g2 + kf));

  for (let f = 0; f < n; f++) {
    smoothRatio += smoothCoeff * (targetRatio - smoothRatio);
    const r: f32 = 1.0 - smoothRatio;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;
    delayL[writePos] = xL; delayR[writePos] = xR;

    const wA: f32 = f32(0.5 - 0.5 * Mathf.cos(TWO_PI * phaseA * invW));
    const wB: f32 = f32(0.5 - 0.5 * Mathf.cos(TWO_PI * phaseB * invW));

    // grain shift per channel
    const sL: f32 = readLine(delayL, phaseA) * wA + readLine(delayL, phaseB) * wB;
    const sR: f32 = stereo ? (readLine(delayR, phaseA) * wA + readLine(delayR, phaseB) * wB) : sL;

    // two-formant resonant emphasis on the shifted voice
    // channel 0
    let hp: f32 = (sL - (g1 + kf) * f1bp[0] - f1lp[0]) * a1f1;
    let bp1: f32 = g1 * hp + f1bp[0]; let lp1: f32 = g1 * bp1 + f1lp[0]; f1bp[0] = bp1; f1lp[0] = lp1;
    let hp2: f32 = (sL - (g2 + kf) * f2bp[0] - f2lp[0]) * a1f2;
    let bp2: f32 = g2 * hp2 + f2bp[0]; let lp2: f32 = g2 * bp2 + f2lp[0]; f2bp[0] = bp2; f2lp[0] = lp2;
    const vL: f32 = sL * 0.5 + (bp1 + bp2 * 0.8) * 0.9;

    let vR: f32 = vL;
    if (stereo) {
      let hpb: f32 = (sR - (g1 + kf) * f1bp[1] - f1lp[1]) * a1f1;
      let bp1b: f32 = g1 * hpb + f1bp[1]; let lp1b: f32 = g1 * bp1b + f1lp[1]; f1bp[1] = bp1b; f1lp[1] = lp1b;
      let hp2b: f32 = (sR - (g2 + kf) * f2bp[1] - f2lp[1]) * a1f2;
      let bp2b: f32 = g2 * hp2b + f2bp[1]; let lp2b: f32 = g2 * bp2b + f2lp[1]; f2bp[1] = bp2b; f2lp[1] = lp2b;
      vR = sR * 0.5 + (bp1b + bp2b * 0.8) * 0.9;
    }

    let oL: f32 = (xL * (1.0 - mix) + vL * mix) * (0.5 + output * 1.0);
    let oR: f32 = (xR * (1.0 - mix) + vR * mix) * (0.5 + output * 1.0);
    if (oL > 1.4) oL = 1.4; else if (oL < -1.4) oL = -1.4;
    if (oR > 1.4) oR = 1.4; else if (oR < -1.4) oR = -1.4;
    outBuf[f] = oL; outBuf[MAX_FRAMES + f] = oR;

    writePos += 1; if (writePos >= LINE_LEN) writePos = 0;
    phaseA += r; while (phaseA < 0.0) phaseA += WINDOW; while (phaseA >= WINDOW) phaseA -= WINDOW;
    phaseB += r; while (phaseB < 0.0) phaseB += WINDOW; while (phaseB >= WINDOW) phaseB -= WINDOW;
  }
}
