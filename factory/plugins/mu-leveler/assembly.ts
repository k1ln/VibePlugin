// =====================================================================
//  MU LEVELER — a vari-mu tube-style compressor / leveler
//  Models the gentle, program-dependent behaviour of a variable-mu valve
//  gain stage: as the signal gets louder the tube's effective gain (its
//  "mu") falls, so compression is soft, rounded and self-adjusting rather
//  than the hard, fixed-ratio bite of a VCA/FET. Detection is in the dB
//  domain; the release "breathes" — it speeds up under heavy program and
//  relaxes when the music opens out (program-dependent recovery). A touch
//  of warm, mostly even-harmonic valve saturation is added on the way out,
//  and the amount grows with Input drive. Pure algorithm, no samples.
//
//  Params: Input (drive into the tube), Threshold, Recovery (release),
//          Makeup, Mix.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (stereo-linked, like a real vari-mu sidechain)
let detState: f32 = 0.0;   // smoothed detector level (linear, for the slow RMS-ish window)
let grDb: f32 = 0.0;       // current gain reduction in dB (>= 0), the "breathing" envelope
let fastDb: f32 = 0.0;     // faster envelope used to sense program density for recovery

const P_INPUT:   i32 = 0;  // 0..1 -> drive into the tube  (gain 1..6x + more warmth)
const P_THRESH:  i32 = 1;  // 0..1 -> threshold  -40..0 dBFS (low = more leveling)
const P_RECOV:   i32 = 2;  // 0..1 -> recovery / release base  0.1..3.0 s
const P_MAKEUP:  i32 = 3;  // 0..1 -> makeup     0..+18 dB
const P_MIX:     i32 = 4;  // 0..1 -> dry/wet

const LN10_20: f32 = 0.11512925; // ln(10)/20, for dB<->linear
const PI: f32 = 3.14159265;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

@inline function lin2db(x: f32): f32 {
  const a: f32 = x < 1e-9 ? 1e-9 : x;
  return f32(8.6858896 * Mathf.log(a)); // 20/ln(10) * ln(a)
}
@inline function db2lin(db: f32): f32 {
  return f32(Mathf.exp(db * LN10_20));
}

// gentle valve saturation: asymmetric so it adds mostly even harmonics,
// bounded (tanh-ish via a rational soft-clip), warmth scales with `amt`.
@inline function tubeSat(x: f32, amt: f32): f32 {
  // small DC-ish bias makes the curve asymmetric -> even harmonics ("warmth")
  const b: f32 = x + 0.10 * amt;
  // bounded soft clip
  const s: f32 = b / f32(1.0 + Mathf.abs(b));
  // remove the bias offset, blend back toward dry by `amt`
  const off: f32 = (0.10 * amt) / f32(1.0 + Mathf.abs(0.10 * amt));
  const shaped: f32 = s - off;
  return x + (shaped - x) * amt;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  detState = 0.0;
  grDb = 0.0;
  fastDb = 0.0;
  params[P_INPUT]  = 0.45; // moderate drive into the tube
  params[P_THRESH] = 0.40; // ~ -24 dBFS — levels the test bed
  params[P_RECOV]  = 0.40; // medium recovery
  params[P_MAKEUP] = 0.35; // ~ +6.3 dB makeup
  params[P_MIX]    = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  // ---- map params to engineering units ----
  const inN: f32 = clampf(params[P_INPUT], 0.0, 1.0);
  const drive: f32 = 1.0 + inN * 5.0;                  // 1..6x into the tube
  const warmth: f32 = 0.15 + inN * 0.55;               // saturation amount 0.15..0.70

  const tN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -40.0 + tN * 40.0;             // -40..0 dBFS

  const recN: f32 = clampf(params[P_RECOV], 0.0, 1.0);
  const recBaseS: f32 = 0.10 + recN * recN * 2.90;     // 0.1..3.0 s base recovery (curved)

  const makeupDb: f32 = clampf(params[P_MAKEUP], 0.0, 1.0) * 12.0; // 0..+12 dB
  const makeup: f32 = db2lin(makeupDb);
  // output trim keeps the gain stage bounded (~peak < 1.0) at typical settings
  const outTrim: f32 = 0.7;

  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Vari-mu ballistics: a fixed, gentle, slowish attack (the tube can't grab
  // fast); the release is the user "Recovery" but it's PROGRAM-DEPENDENT.
  const atkMs: f32 = 12.0;                              // slow, rounded attack
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));

  // detector window ~ 8 ms (slow RMS-ish — vari-mu units read average, not peak)
  const detCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.008 * sampleRate)));
  // a faster sensor (~40 ms) to gauge program density for breathing recovery
  const fastCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.040 * sampleRate)));

  // soft, wide knee — the signature rounded vari-mu transition
  const KNEE_DB: f32 = 12.0;
  const halfKnee: f32 = KNEE_DB * 0.5;
  // gentle program-dependent ratio: grows slightly as we push past threshold,
  // bounded so it stays a "leveler" not a limiter.
  const baseSlope: f32 = 0.30;                          // ~1.4:1 at the knee
  const maxSlope: f32 = 0.62;                           // ~2.6:1 deep in

  // input gain compensation so Input drives the tube without just getting louder
  const inComp: f32 = 1.0 / f32(Mathf.sqrt(drive));

  let det: f32 = detState;
  let gr: f32 = grDb;
  let fast: f32 = fastDb;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const dryL: f32 = inBuf[baseL + f];
    const dryR: f32 = stereo ? inBuf[baseR + f] : dryL;

    // drive into the tube (this is what the sidechain & saturator see)
    const xL: f32 = dryL * drive;
    const xR: f32 = dryR * drive;

    // ---- detector: slow, stereo-linked mean-square (average-reading) ----
    const sq: f32 = (xL * xL + xR * xR) * 0.5;
    det = det + detCoef * (sq - det);
    const detAmp: f32 = f32(Mathf.sqrt(det));
    const detDb: f32 = lin2db(detAmp);

    // ---- gain computer: soft wide knee, program-dependent gentle ratio ----
    const over: f32 = detDb - threshDb;
    let targetGr: f32;
    if (over <= -halfKnee) {
      targetGr = 0.0;
    } else {
      // how deep past the knee start (0..) drives a slowly rising slope
      const depth: f32 = over + halfKnee;                // >0
      // slope eases from baseSlope toward maxSlope as we go deeper (vari-mu)
      const ease: f32 = depth / (depth + 8.0);           // 0..1, saturating
      const slope: f32 = baseSlope + (maxSlope - baseSlope) * ease;
      if (over >= halfKnee) {
        targetGr = slope * over;                          // above knee
      } else {
        // quadratic blend across the soft knee
        const t: f32 = over + halfKnee;                   // 0..KNEE_DB
        targetGr = slope * (t * t) / (2.0 * KNEE_DB);
      }
    }
    if (targetGr < 0.0) targetGr = 0.0;

    // ---- breathing program-dependent recovery ----
    // track a faster envelope to sense how "busy" the program is
    fast = fast + (targetGr > fast ? fastCoef * 4.0 : fastCoef) * (targetGr - fast);
    if (fast < 0.0) fast = 0.0;
    // density 0..1: more recent GR -> denser program -> faster recovery
    const density: f32 = fast / (fast + 6.0);            // 0..~1
    // effective recovery time shrinks with density (down to ~35% of base)
    const recS: f32 = recBaseS * (1.0 - 0.65 * density);
    const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (recS * sampleRate)));

    // ---- ballistics: slow attack down, breathing recovery up ----
    const coef: f32 = targetGr > gr ? atkCoef : relCoef;
    gr = gr + coef * (targetGr - gr);

    // ---- apply gain reduction (the falling mu) ----
    const g: f32 = db2lin(-gr);
    let wL: f32 = xL * g;
    let wR: f32 = xR * g;

    // ---- warm valve saturation on the way out (grows with Input) ----
    wL = tubeSat(wL, warmth);
    wR = tubeSat(wR, warmth);

    // ---- makeup + input compensation, then dry/wet ----
    wL = wL * makeup * inComp * outTrim;
    wR = wR * makeup * inComp * outTrim;

    outBuf[baseL + f] = dryL * (1.0 - mix) + wL * mix;
    if (stereo) outBuf[baseR + f] = dryR * (1.0 - mix) + wR * mix;
  }

  detState = det;
  grDb = gr;
  fastDb = fast;
}
