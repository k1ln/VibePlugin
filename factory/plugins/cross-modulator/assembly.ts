// =====================================================================
//  CROSS MODULATOR — a meta-modulator effect: crosses the input signal
//  against an internal complex carrier oscillator through one of four
//  algorithms (Difference/XOR-Fold, Wavefold Cross, Chebyshev Cross,
//  Hard-Sync Cross). This plugin ABI gives an effect exactly one audio
//  input — there's no second/sidechain input to cross-modulate against
//  an external signal. That's not a workaround: real meta-modulator
//  Eurorack modules of this kind behave exactly this way when nothing is
//  patched into their second input — they fall back to an internal
//  oscillator. Track Input does a rough zero-crossing pitch-follow so
//  the carrier can lock to the input's pitch instead of running free.
//  Deliberately skips plain ring-modulation and vocoder modes — Ring
//  Mod and Robot Voice already cover those elsewhere in the factory.
//  Original implementation, no code or samples borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;
const PI: f32 = 3.14159265;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const P_ALGO:  i32 = 0;   // 0 difference, 1 wavefold, 2 chebyshev, 3 hard-sync
const P_FREQ:  i32 = 1;   // carrier frequency
const P_WAVE:  i32 = 2;   // 0 sine, 1 saw, 2 tri, 3 pulse
const P_TRACK: i32 = 3;   // blend manual freq -> input-tracked freq
const P_DRIVE: i32 = 4;
const P_AMT:   i32 = 5;
const P_FB:    i32 = 6;
const P_TONE:  i32 = 7;
const P_MIX:   i32 = 8;
const P_WIDTH: i32 = 9;
const P_LEVEL: i32 = 10;
const NUM_PARAMS: i32 = 11;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function wavefold(x: f32): f32 {
  let v: f32 = x;
  for (let k = 0; k < 5; k++) {
    if (v > 1.0) v = 2.0 - v;
    else if (v < -1.0) v = -2.0 - v;
    else break;
  }
  return v;
}
@inline function carrierWave(ph: f32, wf: i32): f32 {
  if (wf == 0) return f32(Mathf.sin(ph * TAU));
  else if (wf == 1) return ph * 2.0 - 1.0;
  else if (wf == 2) return ph < 0.5 ? (ph * 4.0 - 1.0) : (3.0 - ph * 4.0);
  else return ph < 0.5 ? 1.0 : -1.0;
}

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let carPh: f32 = 0.0;
let trackedFreq: f32 = 220.0;
let zcPrevSign: i32 = 0;
let zcCount: i32 = 0;

const fbPrev: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const toneLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  carPh = 0.0; trackedFreq = 220.0; zcPrevSign = 0; zcCount = 0;
  for (let c = 0; c < MAX_CHANNELS; c++) { fbPrev[c] = 0.0; toneLP[c] = 0.0; }

  params[P_ALGO] = 0.0; params[P_FREQ] = 0.4; params[P_WAVE] = 0.0; params[P_TRACK] = 0.0;
  params[P_DRIVE] = 0.4; params[P_AMT] = 0.5; params[P_FB] = 0.15; params[P_TONE] = 0.5;
  params[P_MIX] = 0.5; params[P_WIDTH] = 0.3; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

@inline function crossModChannel(c: i32, x: f32, carrier: f32, algo: i32, drive: f32, amount: f32, feedbackAmt: f32, toneN: f32, toneCoef: f32): f32 {
  const inDrv: f32 = x * drive;
  let wet: f32 = 0.0;
  if (algo == 0) {
    const d: f32 = (inDrv - carrier) * amount * 3.0;
    wet = wavefold(d);
  } else if (algo == 1) {
    const foldAmt: f32 = 1.0 + f32(Mathf.abs(inDrv)) * amount * 8.0;
    wet = wavefold(carrier * foldAmt);
  } else if (algo == 2) {
    const cc: f32 = clampf(carrier, -1.0, 1.0);
    const c2: f32 = cc * cc;
    const t1: f32 = cc;
    const t2: f32 = 2.0 * c2 - 1.0;
    const t3: f32 = (4.0 * c2 - 3.0) * cc;
    const t4: f32 = 8.0 * c2 * c2 - 8.0 * c2 + 1.0;
    const sel: f32 = clampf(f32(Mathf.abs(inDrv)) * amount * 2.0, 0.0, 1.0);
    if (sel < 0.333) { const f: f32 = sel / 0.333; wet = t1 * (1.0 - f) + t2 * f; }
    else if (sel < 0.667) { const f: f32 = (sel - 0.333) / 0.334; wet = t2 * (1.0 - f) + t3 * f; }
    else { const f: f32 = (sel - 0.667) / 0.333; wet = t3 * (1.0 - f) + t4 * f; }
  } else {
    wet = carrier * (0.4 + amount * 0.6) + inDrv * (1.0 - amount) * 0.3;
  }

  wet = wet + fbPrev[c] * feedbackAmt * 0.5;
  if (wet > 1.5) wet = 1.5; else if (wet < -1.5) wet = -1.5;

  toneLP[c] = f32(toneLP[c] + (wet - toneLP[c]) * toneCoef);
  const hp: f32 = wet - toneLP[c];
  const toned: f32 = f32(toneLP[c] * (1.0 - toneN) * 1.6 + hp * toneN * 1.6 + wet * 0.3);
  fbPrev[c] = wet;
  return toned;
}

export function process(n: i32): void {
  const algo: i32 = clampi(i32(params[P_ALGO] + 0.5), 0, 3);
  const freqN: f32 = clampf(params[P_FREQ], 0.0, 1.0);
  const wf: i32 = clampi(i32(params[P_WAVE] + 0.5), 0, 3);
  const trackN: f32 = clampf(params[P_TRACK], 0.0, 1.0);
  const drive: f32 = 0.2 + clampf(params[P_DRIVE], 0.0, 1.0) * clampf(params[P_DRIVE], 0.0, 1.0) * 6.0;
  const amount: f32 = clampf(params[P_AMT], 0.0, 1.0);
  const feedbackAmt: f32 = clampf(params[P_FB], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mixN: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const levelOut: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 0.95;

  const manualFreq: f32 = 20.0 * f32(Mathf.pow(200.0, freqN));
  const toneCoef: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 1200.0 / sampleRate));

  for (let i = 0; i < n; i++) {
    const in0: f32 = inBuf[i];
    const s: i32 = (in0 * drive) > 0.001 ? 1 : ((in0 * drive) < -0.001 ? -1 : 0);
    zcCount += 1;
    let syncTrigger: bool = false;
    if (s > 0 && zcPrevSign <= 0) {
      if (zcCount > 8) {
        const instFreq: f32 = sampleRate / f32(zcCount);
        if (instFreq >= 20.0 && instFreq <= 4000.0) trackedFreq = f32(trackedFreq + (instFreq - trackedFreq) * 0.2);
      }
      zcCount = 0;
      syncTrigger = true;
    }
    if (s != 0) zcPrevSign = s;

    const carFreq: f32 = manualFreq * (1.0 - trackN) + trackedFreq * trackN;
    if (algo == 3 && syncTrigger) carPh = 0.0;
    carPh += carFreq / sampleRate; if (carPh >= 1.0) carPh -= 1.0;
    const carrier: f32 = carrierWave(carPh, wf);

    const xL: f32 = inBuf[i];
    const xR: f32 = channels > 1 ? inBuf[MAX_FRAMES + i] : xL;
    const wetL: f32 = crossModChannel(0, xL, carrier, algo, drive, amount, feedbackAmt, toneN, toneCoef);
    const wetR: f32 = channels > 1 ? crossModChannel(1, xR, carrier, algo, drive, amount, feedbackAmt, toneN, toneCoef) : wetL;

    let mixL: f32 = f32(xL * (1.0 - mixN) + wetL * mixN * 0.8);
    let mixR: f32 = f32(xR * (1.0 - mixN) + wetR * mixN * 0.8);
    if (channels > 1) {
      const mid: f32 = (mixL + mixR) * 0.5;
      const side: f32 = (mixL - mixR) * 0.5;
      const ws: f32 = widthN * 2.0;
      mixL = f32(mid + side * ws);
      mixR = f32(mid - side * ws);
    }

    outBuf[i] = f32(Mathf.tanh(mixL * levelOut));
    outBuf[MAX_FRAMES + i] = f32(Mathf.tanh(mixR * levelOut));
  }
}
