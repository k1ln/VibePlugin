// =====================================================================
//  AMBER CRUNCH — compressed germanium hard-clip distortion
//  Distortion+ lineage: a single high-gain op-amp stage drives a pair of
//  soft germanium/LED clipping diodes to ground. The clipping is round but
//  hard-limited, giving a smooth-yet-fuzzy, compressed and slightly dark
//  distortion. Two-knob vintage simplicity (Distortion + Output) plus a
//  gentle post tone tilt and a dry/wet Mix. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input DC/HP block
const tiltState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP
const outDc:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // output DC block

const P_DIST: i32 = 0;   // 0..1 -> gain into the clippers
const P_OUT:  i32 = 1;   // 0..1 -> output level
const P_TONE: i32 = 2;   // 0..1 -> gentle post tilt (dark<->bright)
const P_MIX:  i32 = 3;   // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { dcState[c] = 0.0; tiltState[c] = 0.0; outDc[c] = 0.0; }
  params[P_DIST] = 0.55; params[P_OUT] = 0.6; params[P_TONE] = 0.45; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Germanium/LED diode-to-ground clipper: a soft round knee that asymptotes
// hard to a forward-voltage clamp. tanh gives the round compressed shoulder;
// a slight asymmetry (germanium leakage) adds even harmonics; then a firm
// limit caps it like real diodes pinning the node voltage.
@inline function germClip(x: f32): f32 {
  // asymmetric pre-bias — germanium diodes conduct slightly differently
  const xb: f32 = x + 0.06 * x * x;            // mild even-harmonic asymmetry
  let y: f32 = f32(Mathf.tanh(xb));            // round soft knee
  // hard germanium clamp — round but bounded forward voltage (~0.92)
  const vf: f32 = 0.92;
  if (y > vf) y = vf + (y - vf) * 0.12;
  else if (y < -vf) y = -vf + (y + vf) * 0.12;
  return clampf(y, -1.0, 1.0);
}

export function process(n: i32): void {
  // Distortion: gain into clippers 1.5 .. 48 (light grit -> compressed wall)
  const dn: f32 = clampf(params[P_DIST], 0.0, 1.0);
  const gain: f32 = 1.5 + dn * dn * 46.5;
  const outLvl: f32 = clampf(params[P_OUT], 0.0, 1.0) * 1.1;
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // input HP ~30 Hz to block DC before the asymmetric clipper
  const cDc: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 30.0 / sampleRate));
  // post tone tilt low-pass: dark (1800 Hz) .. bright (7000 Hz); inherently
  // a touch dark voicing (Distortion+ rolls off highs after the clippers)
  const toneHz: f32 = 1800.0 + toneN * toneN * 5200.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate));
  // compression makeup so high Distortion stays musical, not just louder;
  // peak after clip is ~vf, so keep wet bounded well under 1.0
  const comp: f32 = 0.95 / f32(Mathf.sqrt(1.0 + dn * 3.0));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let dc: f32 = dcState[c];
    let tn: f32 = tiltState[c];
    let od: f32 = outDc[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];
      dc = dc + cDc * (x - dc);
      const hp: f32 = x - dc;                       // DC-blocked input
      const clipped: f32 = germClip(hp * gain) * comp;
      tn = tn + cTone * (clipped - tn);             // gentle dark post tilt
      // output DC block (asymmetry introduces a small offset)
      od = od + cDc * (tn - od);
      const wet: f32 = (tn - od) * outLvl;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }
    dcState[c] = dc;
    tiltState[c] = tn;
    outDc[c] = od;
  }
}
