// =====================================================================
//  GRIT DISTORTION — hard-edged, high-gain diode distortion
//  A high-gain input stage drives an asymmetric hard/diode clipper for an
//  aggressive, cutting fuzz-into-distortion character. The signature
//  "Filter" control is a REVERSED tone low-pass: turning it UP makes the
//  sound DARKER (rolls off treble), the opposite of a normal tone knob.
//  Followed by output Volume and a dry/wet Mix. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel filter state
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip DC/sub blocker
const filtState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post "Filter" LP (1)
const filtState2:StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post "Filter" LP (2, 2-pole)

const P_DIST: i32 = 0;   // 0..1 -> input gain 1..150 (high-gain stage)
const P_FILTER: i32 = 1; // 0..1 -> REVERSED tone: 0=bright(~12kHz), 1=dark(~500Hz)
const P_VOLUME: i32 = 2; // 0..1 -> 0..1 output level
const P_MIX: i32 = 3;    // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    dcState[c] = 0.0; filtState[c] = 0.0; filtState2[c] = 0.0;
  }
  params[P_DIST] = 0.5; params[P_FILTER] = 0.4; params[P_VOLUME] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Asymmetric hard/diode clipper: tanh soft knee blended toward a hard
// diode-style clip. Asymmetry adds even harmonics for grit & bite.
@inline function diodeClip(x: f32): f32 {
  // tanh-style saturation gives the aggressive but smooth high-gain edge
  const s: f32 = f32(Mathf.tanh(x));
  // hard clip ceiling — the diodes pin the signal
  const h: f32 = clampf(x, -1.0, 1.0);
  // blend: mostly the hard diode pin, with tanh rounding for less fizz
  return f32(0.78 * h + 0.22 * s);
}

export function process(n: i32): void {
  const distN: f32 = clampf(params[P_DIST], 0.0, 1.0);
  const filterN: f32 = clampf(params[P_FILTER], 0.0, 1.0);
  const volume: f32 = clampf(params[P_VOLUME], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // high-gain input stage: 1..150 (exponential feel)
  const gain: f32 = f32(1.0 + distN * distN * 149.0);

  // pre-clip DC/sub high-pass corner ~30 Hz keeps the low end tight
  const cDc: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 30.0 / sampleRate));

  // asymmetry bias scaled down at high gain so DC doesn't run away
  const bias: f32 = f32(0.12);

  // REVERSED tone: filterN 0 -> bright ~12kHz, filterN 1 -> dark ~500Hz.
  // map exponentially so the darkening sweep feels smooth.
  const fHz: f32 = f32(500.0 + (1.0 - filterN) * (1.0 - filterN) * 11500.0);
  const fHzC: f32 = clampf(fHz, 200.0, sampleRate * 0.45);
  const cFilt: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * fHzC / sampleRate));

  // gain compensation: keep perceived level steady as Dist climbs, and
  // hold the broadband peak well under 1.0.
  const comp: f32 = f32(2.6 / Mathf.sqrt(gain));

  const out: f32 = volume;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let dc: f32 = dcState[c];
    let lp: f32 = filtState[c];
    let lp2: f32 = filtState2[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // pre-clip DC/sub blocker (high-pass)
      dc = f32(dc + cDc * (x - dc));
      const hp: f32 = f32(x - dc);

      // high-gain stage + asymmetric bias into the diode clipper
      const driven: f32 = f32(diodeClip(hp * gain + bias) - diodeClip(bias));
      let y: f32 = f32(driven * comp);

      // post "Filter" — 2-pole low-pass, darker as filterN rises
      lp = f32(lp + cFilt * (y - lp));
      lp2 = f32(lp2 + cFilt * (lp - lp2));
      y = lp2;

      const wet: f32 = f32(y * out);
      outBuf[base + f] = f32(x * (1.0 - mix) + wet * mix);
    }
    dcState[c] = dc;
    filtState[c] = lp;
    filtState2[c] = lp2;
  }
}
