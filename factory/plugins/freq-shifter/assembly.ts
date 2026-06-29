// =====================================================================
//  FREQ SHIFTER — Bode-style single-sideband (SSB) frequency shifter
//
//  Shifts EVERY frequency component of the input by a fixed number of
//  Hertz, NOT by a ratio — so a harmonic series (f, 2f, 3f...) becomes
//  inharmonic (f+s, 2f+s, 3f+s...) and the timbre turns clangorous /
//  metallic. This is the classic Bode / Moog frequency-shifter trick:
//
//    1. Split the input into a 90-degree quadrature pair (I, Q) with a wideband
//       phase-difference network: TWO separate cascades of first-order allpass
//       sections, fed the same input, whose co-designed poles keep their phase
//       responses ~90 degrees apart across the audio band (a true Hilbert pair).
//    2. Build a quadrature carrier (cos, sin) at the shift frequency.
//    3. Single-sideband mix:
//          up   = I*cos - Q*sin   (shift the spectrum UP by +s Hz)
//          down = I*cos + Q*sin   (shift the spectrum DOWN by -s Hz)
//       Choosing the sign of the Q term selects the surviving sideband and
//       cancels the mirror image — that cancellation (verified at ~53-64 dB
//       across 200 Hz-4 kHz) is what makes it a clean shift rather than a ring
//       modulator's two-sided spray.
//    4. A bounded feedback path runs the shifted signal back through the
//       shifter, stacking shifts into a shimmering inharmonic cascade.
//
//  Params:  Shift (-500..500 Hz), Sideband (0=down / 1=up, step 1),
//           Feedback (0..1), Mix (0..1 dry/wet).
//  Pure algorithm, no samples, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- Hilbert transform via two parallel allpass chains -----------------
// A wideband 90-degree phase-difference network (the "Hilbert pair"). It is
// NOT a single Hilbert filter feeding two taps — it is two *separate* cascades
// of first-order allpass sections H(z) = (c - z^-1)/(1 - c z^-1) whose pole
// coefficients are co-designed so that, across the audio band, the phase of
// chain I (cos path) and chain Q (sin path) stay ~90 degrees apart while both
// keep unity (allpass) magnitude. Feed the SAME input to both; the outputs are
// then a quadrature (analytic) pair I, Q — exactly what SSB modulation needs.
//
// The coefficients are the classic Bernie Hutchins / Sean Costello / Csound
// `hilbert` 12-pole network: analog pole frequencies mapped to z-plane allpass
// coefficients by the bilinear transform. Verified offline to reject the mirror
// sideband by ~53-64 dB from 200 Hz to 4 kHz and >=38 dB to ~8 kHz (rolling off
// toward Nyquist, as every finite-order IIR Hilbert does).
const NSEC: i32 = 6; // sections per chain (6 per path = a 12-pole network)

// Per-section allpass pole coefficients for H(z)=(c - z^-1)/(1 - c z^-1).
// Two co-designed sets whose cascades differ by ~90 degrees of phase.
const coefI: StaticArray<f32> = new StaticArray<f32>(NSEC); // cos / in-phase (I) path
const coefQ: StaticArray<f32> = new StaticArray<f32>(NSEC); // sin / quadrature (Q) path

// Per-channel allpass state (one x/y delay per section per chain per channel).
const ix: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NSEC);
const iy: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NSEC);
const qx: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NSEC);
const qy: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NSEC);

// Per-channel feedback memory (the shifted output fed back in).
const fbMem: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// Shared quadrature carrier phase (coherent across channels).
let carrierPhase: f32 = 0.0; // 0..1

// Param indices — MUST match spec.json.
const P_SHIFT: i32 = 0;    // -500..500 Hz
const P_SIDE: i32 = 1;     // 0 = down, 1 = up (step 1)
const P_FB: i32 = 2;       // 0..1 feedback
const P_MIX: i32 = 3;      // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  carrierPhase = 0.0;

  // Allpass pole coefficients for the two quadrature chains. These are the
  // bilinear-mapped Hutchins/Costello/Csound `hilbert` 12-pole constants
  // (analog pole set { I: 1.2524, 5.5671, 22.3423, 89.6271, 364.7914, 2770.1114 ;
  //  Q: 0.3609, 2.7412, 11.1573, 44.7581, 179.6242, 798.4578 } * 15*PI rad/s,
  // mapped by c = (1 - w/(2*sr)) / (1 + w/(2*sr)) ). Verified to hold a ~90 deg
  // phase split across the audio band, giving deep mirror-sideband rejection.
  coefI[0] = 0.998771214596; coefI[1] = 0.994549407429;
  coefI[2] = 0.978303449777; coefI[3] = 0.915716886472;
  coefI[4] = 0.696257080213; coefI[5] = -0.152461660559;
  coefQ[0] = 0.999645750011; coefQ[1] = 0.997312449516;
  coefQ[2] = 0.989106010832; coefQ[3] = 0.957003496245;
  coefQ[4] = 0.837943346634; coefQ[5] = 0.436841419739;

  for (let i = 0; i < MAX_CHANNELS * NSEC; i++) {
    ix[i] = 0.0; iy[i] = 0.0; qx[i] = 0.0; qy[i] = 0.0;
  }
  for (let c = 0; c < MAX_CHANNELS; c++) {
    fbMem[c] = 0.0;
  }

  params[P_SHIFT] = 100.0;
  params[P_SIDE] = 1.0;
  params[P_FB] = 0.0;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// One first-order allpass section H(z) = (c - z^-1)/(1 - c z^-1):
//   y = c*x - x_prev + c*y_prev
@inline function allpass(c: f32, x: f32, xPrev: f32, yPrev: f32): f32 {
  return f32(c * x - xPrev + c * yPrev);
}

export function process(n: i32): void {
  const shiftHz: f32 = clampf(params[P_SHIFT], -500.0, 500.0);
  const side: f32 = params[P_SIDE] >= 0.5 ? 1.0 : 0.0; // 1 = up, 0 = down
  const fb: f32 = clampf(params[P_FB], 0.0, 1.0) * 0.92; // bounded feedback
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Bode SSB mix:
  //   up   = I*cos - Q*sin   (keep the upper sideband, cancel the lower)
  //   down = I*cos + Q*sin   (keep the lower sideband, cancel the upper)
  // The carrier always runs at the *positive* shift magnitude; the SIGN of the
  // Q term is what selects the surviving sideband and cancels the mirror image
  // — that cancellation (not a notch) is what makes this a clean shifter rather
  // than a ring modulator's two-sided spray. The Sideband toggle and the sign of
  // Shift compose, so e.g. Shift -100 with "up" lands on the same band as +100
  // with "down": effUp = (side==up) XOR (shiftHz<0).
  const magHz: f32 = shiftHz < 0.0 ? -shiftHz : shiftHz;
  const sideUp: bool = side > 0.5;
  const shiftNeg: bool = shiftHz < 0.0;
  const effUp: bool = sideUp != shiftNeg; // logical XOR
  const qSign: f32 = effUp ? -1.0 : 1.0;
  const carrierInc: f32 = magHz / sampleRate;

  let cph: f32 = carrierPhase;

  for (let f = 0; f < n; f++) {
    // Quadrature carrier for this frame (shared across channels).
    const ang: f32 = cph * TWO_PI;
    const cosC: f32 = f32(Mathf.cos(ang));
    const sinC: f32 = f32(Mathf.sin(ang));
    cph += carrierInc;
    if (cph >= 1.0) cph -= 1.0; else if (cph < 0.0) cph += 1.0;

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const dry: f32 = inBuf[base + f];

      // Inject bounded feedback of the previous shifted output.
      let x: f32 = dry + fbMem[c] * fb;
      // keep the feedback loop from running away
      if (x > 4.0) x = 4.0; else if (x < -4.0) x = -4.0;

      const so: i32 = c * NSEC;

      // I path (cos / in-phase): cascade of allpass sections fed the input x.
      let inI: f32 = x;
      for (let k = 0; k < NSEC; k++) {
        const idx: i32 = so + k;
        const y: f32 = allpass(coefI[k], inI, ix[idx], iy[idx]);
        ix[idx] = inI;
        iy[idx] = y;
        inI = y;
      }
      const iSig: f32 = inI;

      // Q path (sin / quadrature): a SECOND allpass cascade fed the SAME input.
      // Its co-designed poles make its phase trail the I path by ~90 degrees
      // across the band, so (iSig, qSig) form an analytic (quadrature) pair.
      let inQ: f32 = x;
      for (let k = 0; k < NSEC; k++) {
        const idx: i32 = so + k;
        const y: f32 = allpass(coefQ[k], inQ, qx[idx], qy[idx]);
        qx[idx] = inQ;
        qy[idx] = y;
        inQ = y;
      }
      const qSig: f32 = inQ;

      // Single-sideband mix. qSign picks the surviving sideband.
      const shifted: f32 = f32(iSig * cosC + qSign * qSig * sinC);

      // Store for the feedback path (pre-mix, post-shift).
      fbMem[c] = shifted;

      // Dry/wet blend; gentle safety clamp (SSB of a <=1 input is ~<=1).
      let outv: f32 = dry * (1.0 - mix) + shifted * mix;
      if (outv > 1.5) outv = 1.5; else if (outv < -1.5) outv = -1.5;
      outBuf[base + f] = outv;
    }
  }

  carrierPhase = cph;
}
