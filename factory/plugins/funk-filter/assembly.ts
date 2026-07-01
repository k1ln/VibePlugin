// =====================================================================
//  FUNK FILTER — envelope-follower auto-wah
//  A resonant state-variable filter whose cutoff is swept by the INPUT
//  ENVELOPE: play louder and the peak sweeps further. A DIRECTION switch
//  flips the sweep (up: louder => higher; down: louder => lower); a MODE
//  switch picks low-pass or band-pass output. Sensitivity drives how hard
//  the envelope pushes the sweep, Resonance is the filter Q/peak, Range is
//  the span of the sweep. The classic funky, vocal "wow". Pure algorithm.
//
//  Signal: env-follow(|x|) -> map to cutoff Hz (Direction/Range/Sens) ->
//          TPT state-variable filter (LP or BP, Resonance=Q) -> wet/dry.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// envelope follower state (shared mono detector for a coherent stereo sweep)
let envFollow: f32 = 0.0;
// TPT SVF integrator states, per channel
const ic1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const ic2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// pre-detector DC blocker state, per channel
const dcPrev: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const dcOut:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_SENS: i32 = 0; // 0..1 envelope drive
const P_RES:  i32 = 1; // 0..1 resonance / peak (Q)
const P_RANGE:i32 = 2; // 0..1 sweep span
const P_DIR:  i32 = 3; // 0=up, 1=down (stepped)
const P_MODE: i32 = 4; // 0=LP, 1=BP (stepped)
const P_MIX:  i32 = 5; // 0..1 dry/wet

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    ic1[c] = 0.0; ic2[c] = 0.0; dcPrev[c] = 0.0; dcOut[c] = 0.0;
  }
  envFollow = 0.0;
  params[P_SENS]  = 0.6;
  params[P_RES]   = 0.6;
  params[P_RANGE] = 0.7;
  params[P_DIR]   = 0.0;
  params[P_MODE]  = 1.0; // band-pass: the classic vocal auto-wah voice
  params[P_MIX]   = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const sens:  f32 = clampf(params[P_SENS],  0.0, 1.0);
  const resN:  f32 = clampf(params[P_RES],   0.0, 1.0);
  const range: f32 = clampf(params[P_RANGE], 0.0, 1.0);
  const dir:   i32 = params[P_DIR]  >= 0.5 ? 1 : 0; // 0 up, 1 down
  const mode:  i32 = params[P_MODE] >= 0.5 ? 1 : 0; // 0 LP, 1 BP
  const mix:   f32 = clampf(params[P_MIX],   0.0, 1.0);

  // Envelope follower timing: snappy attack, musical release for the "wah" tail.
  const atkMs: f32 = 5.0;
  const relMs: f32 = 120.0;
  const aAtk: f32 = f32(Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));
  const aRel: f32 = f32(Mathf.exp(-1.0 / (relMs * 0.001 * sampleRate)));

  // Envelope -> cutoff. The sweep span grows with Range. Sensitivity sets how
  // much detected level pushes the peak. Resonance maps to filter Q (k = 1/Q).
  const baseHz: f32 = 180.0;                    // resting cutoff (quiet input)
  const span:   f32 = 220.0 + range * 4200.0;   // how far the sweep can travel
  const drive:  f32 = 1.5 + sens * 14.0;        // envelope -> sweep amount
  const q:      f32 = 0.6 + resN * resN * 11.0; // 0.6 .. ~12
  const k:      f32 = 1.0 / q;                  // SVF damping (lower = more peak)

  // mono detector source feeds a coherent stereo sweep
  const stereoIn: i32 = channels > 1 ? 1 : 0;

  for (let f = 0; f < n; f++) {
    // ---- detector: rectified, DC-blocked mono sum ----
    const xL: f32 = inBuf[f];
    const xR: f32 = stereoIn ? inBuf[MAX_FRAMES + f] : xL;
    let det: f32 = (xL + xR) * 0.5;
    // DC block the detector source (channel 0 state reused for the mono mix)
    const dcc: f32 = 0.9995;
    const y0: f32 = det - dcPrev[0] + dcc * dcOut[0];
    dcPrev[0] = det; dcOut[0] = y0;
    let rect: f32 = y0 < 0.0 ? -y0 : y0;

    // env follower (peak-style smoothing)
    if (rect > envFollow) envFollow = aAtk * (envFollow - rect) + rect;
    else                  envFollow = aRel * (envFollow - rect) + rect;

    // env -> 0..1 sweep amount (soft saturating so loud hits don't run away)
    let e: f32 = envFollow * drive;
    e = e / (1.0 + e);            // 0..1, compresses high levels
    e = clampf(e, 0.0, 1.0);

    // direction: up => louder raises cutoff; down => louder lowers it
    const sweep: f32 = dir == 1 ? (1.0 - e) : e;
    let cutoff: f32 = baseHz + sweep * span;
    // keep below Nyquist and above DC
    const maxHz: f32 = sampleRate * 0.45;
    cutoff = clampf(cutoff, 30.0, maxHz);

    // TPT-SVF coefficient
    const g: f32 = f32(Mathf.tan(PI * cutoff / sampleRate));
    const a1: f32 = 1.0 / (1.0 + g * (g + k));

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const x: f32 = inBuf[base + f];

      let s1: f32 = ic1[c];
      let s2: f32 = ic2[c];
      const v3: f32 = x - s2;
      const v1: f32 = a1 * (g * v3 + s1) - a1 * 0.0; // = a1*(g*v3 + s1)
      const bp: f32 = v1;
      const v2: f32 = s2 + g * v1;
      const lp: f32 = v2;
      // update integrator states
      s1 = 2.0 * v1 - s1;
      s2 = 2.0 * v2 - s2;
      ic1[c] = s1;
      ic2[c] = s2;

      // band-pass gets a touch of make-up so its peak rivals the LP voicing
      let filt: f32 = mode == 1 ? bp * (0.55 + resN * 0.55) : lp;
      filt = clampf(filt, -0.99, 0.99);

      const wet: f32 = filt * 0.92;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }
  }
}
