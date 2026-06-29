// =====================================================================
//  ROBOT VOICE — channel vocoder (EMS / analog-bank style)
//  The input is the MODULATOR. It is split into a bank of band-pass
//  filters, each followed by an envelope follower that measures how much
//  energy lives in that band. An INTERNAL carrier (a bright sawtooth
//  blended toward white noise) is split into the SAME band bank; each
//  carrier band is then multiplied by the matching modulator envelope and
//  the bands are summed. The carrier's flat, buzzy spectrum is forced to
//  wear the spectral envelope of the input — the classic talking/robot
//  timbre. Pure algorithm, no samples.
//
//  Bands     : 8 / 12 / 16 analysis bands (0..2, step 1)
//  Carrier   : sawtooth  <->  white noise
//  Formant   : shifts the carrier-band mapping up/down (vowel bending)
//  Resonance : band-pass Q (narrow, resonant -> wide, smooth)
//  Mix       : dry input  <->  full vocoded output
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_BANDS: i32 = 16;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- band-pass state (state-variable filter), per channel x band ------
// Modulator analysis bank (one set per channel so stereo tracks correctly)
const modLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * MAX_BANDS); // low / integrator 1
const modBP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * MAX_BANDS); // band / integrator 2
const modEnv: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * MAX_BANDS); // envelope follower

// Carrier synthesis bank
const carLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * MAX_BANDS);
const carBP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * MAX_BANDS);

// Per-band tuning, recomputed when band count / formant change
const bandF: StaticArray<f32> = new StaticArray<f32>(MAX_BANDS); // SVF freq coeff (modulator)
const bandFc: StaticArray<f32> = new StaticArray<f32>(MAX_BANDS); // SVF freq coeff (carrier, formant shifted)

// Carrier oscillator + noise state (mono source, shared across channels)
const carPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
let noiseState: i32 = 0x12345678;

let curBands: i32 = 12;
let curFormant: f32 = -1.0;

const P_BANDS: i32 = 0;     // 0..2 step 1 -> 8 / 12 / 16
const P_CARRIER: i32 = 1;   // 0 = saw, 1 = noise
const P_FORMANT: i32 = 2;   // 0..1, 0.5 = neutral
const P_RES: i32 = 3;       // 0..1 resonance / Q
const P_MIX: i32 = 4;       // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < MAX_CHANNELS * MAX_BANDS; i++) {
    modLP[i] = 0.0; modBP[i] = 0.0; modEnv[i] = 0.0;
    carLP[i] = 0.0; carBP[i] = 0.0;
  }
  for (let c = 0; c < MAX_CHANNELS; c++) carPhase[c] = 0.0;
  noiseState = 0x12345678;
  curBands = 0; curFormant = -1.0; // force recompute on first process()
  params[P_BANDS] = 1.0;    // 12 bands
  params[P_CARRIER] = 0.15; // mostly saw
  params[P_FORMANT] = 0.5;  // neutral
  params[P_RES] = 0.6;      // fairly resonant
  params[P_MIX] = 1.0;      // full vocoder
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast deterministic white noise in [-1, 1]
@inline function nextNoise(): f32 {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >> 17;
  noiseState ^= noiseState << 5;
  return f32(noiseState) * f32(4.6566129e-10);
}

// Lay out band centre frequencies on a log scale 180 Hz .. ~6.5 kHz and
// convert to a state-variable-filter frequency coefficient f = 2*sin(pi*fc/sr).
function rebuildBands(nBands: i32, formant: f32): void {
  const lo: f32 = 180.0;
  const hi: f32 = 6500.0;
  const ratio: f32 = hi / lo;
  // formant: 0.5 neutral; maps to a per-band frequency multiplier 0.5x .. 2x
  const shift: f32 = f32(Mathf.pow(2.0, (formant - 0.5) * 2.0));
  const denom: f32 = nBands > 1 ? f32(nBands - 1) : 1.0;
  for (let b = 0; b < nBands; b++) {
    const frac: f32 = f32(b) / denom;
    const fc: f32 = lo * f32(Mathf.pow(ratio, frac));
    let fcShift: f32 = fc * shift;
    if (fcShift > sampleRate * 0.45) fcShift = sampleRate * 0.45;
    const fMod: f32 = 2.0 * f32(Mathf.sin(3.14159265 * fc / sampleRate));
    const fCar: f32 = 2.0 * f32(Mathf.sin(3.14159265 * fcShift / sampleRate));
    bandF[b] = clampf(fMod, 0.0, 1.4);
    bandFc[b] = clampf(fCar, 0.0, 1.4);
  }
}

export function process(n: i32): void {
  // discrete band selector: 0->8, 1->12, 2->16
  let sel: i32 = i32(clampf(params[P_BANDS], 0.0, 2.0) + 0.5);
  const nBands: i32 = sel == 0 ? 8 : (sel == 1 ? 12 : 16);

  const carrierMix: f32 = clampf(params[P_CARRIER], 0.0, 1.0); // 0 saw .. 1 noise
  const formant: f32 = clampf(params[P_FORMANT], 0.0, 1.0);
  const res: f32 = clampf(params[P_RES], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // recompute band table only when shape changes (no alloc, just writes)
  if (nBands != curBands || formant != curFormant) {
    rebuildBands(nBands, formant);
    curBands = nBands; curFormant = formant;
  }

  // SVF damping: high res -> low damping -> narrow, resonant bands.
  // map res 0..1 to q-damping 0.9 (wide) .. 0.06 (sharp)
  const damp: f32 = 0.9 - res * 0.84;

  // envelope follower coefficients (attack fast, release slower)
  const atk: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 80.0 / sampleRate));
  const rel: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 12.0 / sampleRate));

  // carrier saw frequency: a low buzzy fundamental ~ 90 Hz
  const carHz: f32 = 90.0;
  const carInc: f32 = carHz / sampleRate;

  // output normalisation: more bands -> divide by sqrt(bands) so peak bounded
  const norm: f32 = 2.4 / f32(Mathf.sqrt(f32(nBands)));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const sb: i32 = c * MAX_BANDS;
    let ph: f32 = carPhase[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f]; // modulator

      // --- internal carrier: bright saw blended toward white noise ---
      ph += carInc; if (ph >= 1.0) ph -= 1.0;
      const saw: f32 = ph * 2.0 - 1.0;
      const noise: f32 = nextNoise();
      const carrier: f32 = saw * (1.0 - carrierMix) + noise * carrierMix;

      let acc: f32 = 0.0;
      for (let b = 0; b < nBands; b++) {
        const idx: i32 = sb + b;

        // --- modulator band-pass (state variable filter) ---
        const fM: f32 = bandF[b];
        let lpM: f32 = modLP[idx];
        let bpM: f32 = modBP[idx];
        let hpM: f32 = x - lpM - damp * bpM;
        bpM = bpM + fM * hpM;
        lpM = lpM + fM * bpM;
        modLP[idx] = lpM; modBP[idx] = bpM;

        // --- envelope follower on the modulator band ---
        const rect: f32 = bpM < 0.0 ? -bpM : bpM;
        let e: f32 = modEnv[idx];
        const coef: f32 = rect > e ? atk : rel;
        e = e + coef * (rect - e);
        modEnv[idx] = e;

        // --- carrier band-pass (formant-shifted centre) ---
        const fC: f32 = bandFc[b];
        let lpC: f32 = carLP[idx];
        let bpC: f32 = carBP[idx];
        let hpC: f32 = carrier - lpC - damp * bpC;
        bpC = bpC + fC * hpC;
        lpC = lpC + fC * bpC;
        carLP[idx] = lpC; carBP[idx] = bpC;

        // impose the modulator's band energy on the carrier band
        acc += bpC * e;
      }

      const wet: f32 = clampf(acc * norm, -1.0, 1.0);
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }
    carPhase[c] = ph;
  }
}
