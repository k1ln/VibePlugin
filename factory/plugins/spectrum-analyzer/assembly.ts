// =====================================================================
//  SPECTRUM ANALYZER — a 16-band real-time spectrum display. Audio
//  passes through unaltered (safe on a master bus) except for the Input
//  Trim gain stage, which also feeds the analysis. A bank of 16
//  log-spaced (60 Hz - 16 kHz) Chamberlin state-variable bandpass
//  filters (the same proven per-band math as Vowel Filter's 3-formant
//  bank, extended to 16 fixed bands) each drive an attack/release
//  envelope follower; the 16 band magnitudes are written straight into
//  the getDisplayPtr() telemetry channel every block, at whatever rate
//  the host calls process() - the GUI reads them via onDisplay() at
//  ~30 Hz and draws the bars (see gui.html). 16 floats is the entire
//  DSP->GUI channel this plugin format provides, so 16 bands is the
//  real ceiling, not an arbitrary choice - many real hardware analyzers
//  are 10-31 band for the same practical reason.
//  Original implementation, no code or samples borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_TRIM:  i32 = 0;
const P_BALL:  i32 = 1;
const P_TILT:  i32 = 2;
const P_CHAN:  i32 = 3;   // 0 L, 1 R, 2 Sum
const P_FREEZE:i32 = 4;
const NUM_PARAMS: i32 = 5;
const LN10: f32 = 2.30258509;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }

const NB: i32 = 16;
// log-spaced centre frequencies, 60 Hz .. 16 kHz
const BAND_HZ: StaticArray<f32> = StaticArray.fromArray<f32>([
  60.0, 90.0, 135.0, 200.0, 300.0, 440.0, 650.0, 950.0,
  1400.0, 2050.0, 3000.0, 4400.0, 6400.0, 9400.0, 12500.0, 16000.0,
]);

const bandBP: StaticArray<f32> = new StaticArray<f32>(NB);
const bandLP: StaticArray<f32> = new StaticArray<f32>(NB);
const bandEnv: StaticArray<f32> = new StaticArray<f32>(NB);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let k = 0; k < NB; k++) { bandBP[k] = 0.0; bandLP[k] = 0.0; bandEnv[k] = 0.0; }
  for (let k = 0; k < 16; k++) display[k] = 0.0;

  params[P_TRIM] = 0.5; params[P_BALL] = 0.4; params[P_TILT] = 0.5;
  params[P_CHAN] = 2.0; params[P_FREEZE] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function process(n: i32): void {
  const trimN: f32 = clampf(params[P_TRIM], 0.0, 1.0);
  const ballN: f32 = clampf(params[P_BALL], 0.0, 1.0);
  const tiltN: f32 = clampf(params[P_TILT], 0.0, 1.0);
  const chan: i32 = clampi(i32(params[P_CHAN] + 0.5), 0, 2);
  const frozen: bool = params[P_FREEZE] > 0.5;

  const trimGain: f32 = f32(Mathf.pow(10.0, (trimN * 2.0 - 1.0) * 12.0 / 20.0));
  // faster attack than release always; Ballistics scales both together
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / ((0.001 + (1.0 - ballN) * 0.02) * sampleRate)));
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / ((0.05 + ballN * 0.9) * sampleRate)));
  const nyq: f32 = sampleRate * 0.45;
  const q: f32 = 0.09;

  for (let i = 0; i < n; i++) {
    const l: f32 = inBuf[i] * trimGain;
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + i] * trimGain : l;

    outBuf[i] = l;
    outBuf[MAX_FRAMES + i] = r;

    if (!frozen) {
      const src: f32 = chan == 0 ? l : (chan == 1 ? r : (l + r) * 0.5);
      for (let k = 0; k < NB; k++) {
        const fc: f32 = clampf(BAND_HZ[k], 20.0, nyq);
        const g: f32 = f32(2.0 * Mathf.sin(PI * fc / sampleRate));
        const hp: f32 = src - bandLP[k] - q * bandBP[k];
        bandBP[k] = f32(bandBP[k] + g * hp);
        bandLP[k] = f32(bandLP[k] + g * bandBP[k]);
        const mag: f32 = f32(Mathf.abs(bandBP[k]));
        const tilt: f32 = f32(Mathf.pow(f32(k) / f32(NB - 1), tiltN * 0.9));
        const target: f32 = mag * (0.5 + tilt * 3.5);
        if (target > bandEnv[k]) bandEnv[k] = f32(bandEnv[k] + (target - bandEnv[k]) * atkCoef);
        else bandEnv[k] = f32(bandEnv[k] + (target - bandEnv[k]) * relCoef);
      }
    }
  }

  // Peak-hold caps are computed client-side from these live values (same
  // pattern as the existing meter widgets) - no DSP-side peak state needed,
  // which keeps the full 16-float channel available for live band data.
  // dB-normalise (-60..0 dB -> 0..1) so the display reads like a real
  // analyzer (log amplitude) instead of linear magnitude, where quiet bands
  // would otherwise be invisible.
  for (let k = 0; k < NB; k++) {
    const db: f32 = f32(20.0 * (Mathf.log(bandEnv[k] + 0.000001) / LN10));
    display[k] = clampf((db + 60.0) / 60.0, 0.0, 1.0);
  }
}
