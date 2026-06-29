// =====================================================================
//  DE-ESSER — sibilance tamer for vocals
//  A sidechain band-pass (~5-9 kHz, Frequency) isolates the sibilant
//  energy; a fast peak follower drives a downward compressor that ducks
//  ONLY the high band when it crosses Threshold, by up to Amount dB. The
//  ducked high band is recombined with the untouched body (Linkwitz-style
//  split), so vocals lose the harsh "sss" without going dull. Mix blends
//  the processed signal against the dry input. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel crossover state (one-pole low/high split for the audio path)
const splitLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low band (body)
// per-channel sidechain band-pass state (low-pass then high-pass -> band)
const scLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const scHP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// per-channel envelope follower (linear amplitude of the sibilant band)
const env: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_FREQ: i32 = 0;   // 0..1 -> band centre 4000..10000 Hz
const P_THRESH: i32 = 1; // 0..1 -> threshold -50..0 dB
const P_AMOUNT: i32 = 2; // 0..1 -> max reduction 0..24 dB
const P_MIX: i32 = 3;    // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    splitLP[c] = 0.0;
    scLP[c] = 0.0;
    scHP[c] = 0.0;
    env[c] = 0.0;
  }
  params[P_FREQ] = 0.45;   // ~6.7 kHz
  params[P_THRESH] = 0.45; // ~ -27 dB
  params[P_AMOUNT] = 0.6;  // ~14 dB max reduction
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole coefficient for a given corner frequency
@inline function coeff(hz: f32, sr: f32): f32 {
  const c: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * hz / sr));
  return clampf(c, 0.0, 1.0);
}

export function process(n: i32): void {
  const freqN: f32 = clampf(params[P_FREQ], 0.0, 1.0);
  const threshN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const amountN: f32 = clampf(params[P_AMOUNT], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // sibilant band centre 4..10 kHz; the detector band-pass spans ~0.6x..1.6x of it
  const centre: f32 = 4000.0 + freqN * 6000.0;
  const bandLoHz: f32 = clampf(centre * 0.62, 1000.0, sampleRate * 0.45);
  const bandHiHz: f32 = clampf(centre * 1.7, bandLoHz + 500.0, sampleRate * 0.49);

  // audio-path crossover: split body (low) from highs at the band's lower edge
  const xoverHz: f32 = bandLoHz;
  const cXover: f32 = coeff(xoverHz, sampleRate);

  // sidechain band-pass = LP(bandHi) then HP(bandLo)
  const cScLP: f32 = coeff(bandHiHz, sampleRate);
  const cScHP: f32 = coeff(bandLoHz, sampleRate);

  // threshold in linear amplitude (-50..0 dB)
  const threshDb: f32 = -50.0 + threshN * 50.0;
  const threshLin: f32 = f32(Mathf.exp(threshDb * 0.11512925)); // 10^(dB/20)

  // max reduction 0..24 dB -> minimum gain on the high band
  const maxRedDb: f32 = amountN * 24.0;
  const minGain: f32 = f32(Mathf.exp(-maxRedDb * 0.11512925));

  // fast attack / moderate release envelope (ms -> per-sample coeff)
  const atkCoeff: f32 = coeff(1000.0 / 0.5, sampleRate);  // ~0.5 ms attack
  const relCoeff: f32 = coeff(1000.0 / 35.0, sampleRate); // ~35 ms release

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let lpS: f32 = splitLP[c];
    let scl: f32 = scLP[c];
    let sch: f32 = scHP[c];
    let e: f32 = env[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- audio-path split into body (low) + highs ---
      lpS = lpS + cXover * (x - lpS);
      const low: f32 = lpS;
      const high: f32 = x - lpS;

      // --- sidechain band-pass detector ---
      scl = scl + cScLP * (x - scl); // low-pass
      const bp: f32 = scl - sch;     // minus the high-passed running low
      sch = sch + cScHP * (scl - sch);

      // envelope follow the rectified band-pass
      const rect: f32 = bp < 0.0 ? -bp : bp;
      if (rect > e) e = e + atkCoeff * (rect - e);
      else e = e + relCoeff * (rect - e);

      // --- gain computer: downward compression above threshold ---
      let g: f32 = 1.0;
      if (e > threshLin && e > 0.0000001) {
        // reduce proportionally to how far the band exceeds the threshold.
        // ratio ~ infinity-ish: target the band down toward the threshold.
        const desired: f32 = threshLin / e; // <1
        g = desired < minGain ? minGain : desired;
      }

      const duckedHigh: f32 = high * g;
      const wet: f32 = low + duckedHigh;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    splitLP[c] = lpS;
    scLP[c] = scl;
    scHP[c] = sch;
    env[c] = e;
  }
}
