// =====================================================================
//  VOCAL PLATE — a bright, dense studio PLATE reverb (EMT 140 lineage).
//  The classic vocal/snare plate: brighter, denser and longer than the
//  Dattorro-style Steel Plate already in the factory. Input diffusion (4
//  series allpasses) feeds a modulated figure-of-eight tank (2 allpasses +
//  2 long delays with HF damping) for a lush metallic-to-smooth tail.
//  Controls: Mix, Decay, Tone (brightness), Pre-Delay, Size.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// predelay
const PD_LEN: i32 = 8192; const PD_MASK: i32 = PD_LEN - 1;
const pd: StaticArray<f32> = new StaticArray<f32>(PD_LEN);
let pdW: i32 = 0;

// input diffusion allpasses (fixed prime-ish lengths)
const A0L: i32 = 142; const A1L: i32 = 107; const A2L: i32 = 379; const A3L: i32 = 277;
const ap0: StaticArray<f32> = new StaticArray<f32>(A0L);
const ap1: StaticArray<f32> = new StaticArray<f32>(A1L);
const ap2: StaticArray<f32> = new StaticArray<f32>(A2L);
const ap3: StaticArray<f32> = new StaticArray<f32>(A3L);
let i0: i32 = 0; let i1: i32 = 0; let i2: i32 = 0; let i3: i32 = 0;

// tank: 2 allpasses + 2 delays (sized for the longest at high Size)
const T0L: i32 = 2186; const T1L: i32 = 2620; const TAP0: i32 = 1402; const TAP1: i32 = 1733;
const t0: StaticArray<f32> = new StaticArray<f32>(T0L);
const t1: StaticArray<f32> = new StaticArray<f32>(T1L);
const tap0: StaticArray<f32> = new StaticArray<f32>(TAP0);
const tap1: StaticArray<f32> = new StaticArray<f32>(TAP1);
let it0: i32 = 0; let it1: i32 = 0; let ita0: i32 = 0; let ita1: i32 = 0;
let dampA: f32 = 0.0; let dampB: f32 = 0.0;
let modPh: f32 = 0.0;

let sampleRate: f32 = 48000.0;

const P_MIX: i32 = 0; const P_DECAY: i32 = 1; const P_TONE: i32 = 2; const P_PRE: i32 = 3; const P_SIZE: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function allpass(buf: StaticArray<f32>, idx: i32, len: i32, x: f32, g: f32): f32 {
  const d: f32 = buf[idx];
  const y: f32 = d - g * x;
  buf[idx] = x + g * y;
  return y;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  pdW = 0; i0 = 0; i1 = 0; i2 = 0; i3 = 0; it0 = 0; it1 = 0; ita0 = 0; ita1 = 0; dampA = 0.0; dampB = 0.0; modPh = 0.0;
  for (let i = 0; i < PD_LEN; i++) pd[i] = 0.0;
  for (let i = 0; i < A0L; i++) ap0[i] = 0.0;
  for (let i = 0; i < A1L; i++) ap1[i] = 0.0;
  for (let i = 0; i < A2L; i++) ap2[i] = 0.0;
  for (let i = 0; i < A3L; i++) ap3[i] = 0.0;
  for (let i = 0; i < T0L; i++) t0[i] = 0.0;
  for (let i = 0; i < T1L; i++) t1[i] = 0.0;
  for (let i = 0; i < TAP0; i++) tap0[i] = 0.0;
  for (let i = 0; i < TAP1; i++) tap1[i] = 0.0;
  params[P_MIX] = 0.3; params[P_DECAY] = 0.7; params[P_TONE] = 0.7; params[P_PRE] = 0.06; params[P_SIZE] = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const preN: f32 = clampf(params[P_PRE], 0.0, 1.0);
  const sizeN: f32 = clampf(params[P_SIZE], 0.0, 1.0);

  const decay: f32 = 0.5 + decayN * 0.49;       // tank feedback (bounded < 1)
  const damp: f32 = 0.05 + (1.0 - toneN) * 0.8; // HF damping (low tone -> dark)
  let pdSamp: i32 = i32(preN * 0.12 * sampleRate); if (pdSamp < 0) pdSamp = 0; if (pdSamp > PD_LEN - 1) pdSamp = PD_LEN - 1;
  // size scales tank delay read lengths
  const t0len: i32 = i32(f32(T0L) * (0.55 + 0.45 * sizeN));
  const t1len: i32 = i32(f32(T1L) * (0.55 + 0.45 * sizeN));
  const ta0len: i32 = i32(f32(TAP0) * (0.55 + 0.45 * sizeN));
  const ta1len: i32 = i32(f32(TAP1) * (0.55 + 0.45 * sizeN));
  const dry: f32 = 1.0 - mix;
  const wet: f32 = mix;
  const stereo: i32 = 1;

  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[f];
    const xr: f32 = stereo ? inBuf[MAX_FRAMES + f] : xl;
    let x: f32 = (xl + xr) * 0.5;

    // predelay
    pd[pdW] = x;
    const prd: f32 = pd[(pdW - pdSamp) & PD_MASK];
    pdW = (pdW + 1) & PD_MASK;

    // input diffusion
    let s: f32 = prd;
    s = allpass(ap0, i0, A0L, s, 0.7); i0 = (i0 + 1) % A0L;
    s = allpass(ap1, i1, A1L, s, 0.7); i1 = (i1 + 1) % A1L;
    s = allpass(ap2, i2, A2L, s, 0.625); i2 = (i2 + 1) % A2L;
    s = allpass(ap3, i3, A3L, s, 0.625); i3 = (i3 + 1) % A3L;

    // tank read (with light modulation for shimmer)
    modPh += 0.7 / sampleRate * 6.2831853; if (modPh > 6.2831853) modPh -= 6.2831853;
    const mod: i32 = i32(6.0 * f32(Mathf.sin(modPh)));
    let ri0: i32 = (ita0 - ta0len + mod) % TAP0; if (ri0 < 0) ri0 += TAP0;
    let ri1: i32 = (ita1 - ta1len - mod) % TAP1; if (ri1 < 0) ri1 += TAP1;
    const r0: f32 = tap0[ri0];
    const r1: f32 = tap1[ri1];

    // figure-8: input + cross-fed delayed, through allpasses + damping
    let n0: f32 = s + r1 * decay;
    dampA += (n0 - dampA) * (1.0 - damp); n0 = dampA;
    n0 = allpass(t0, it0, T0L, n0, 0.5); it0 = (it0 + 1) % T0L;
    tap0[ita0] = n0; ita0 = (ita0 + 1) % TAP0;

    let n1: f32 = s + r0 * decay;
    dampB += (n1 - dampB) * (1.0 - damp); n1 = dampB;
    n1 = allpass(t1, it1, T1L, n1, 0.5); it1 = (it1 + 1) % T1L;
    tap1[ita1] = n1; ita1 = (ita1 + 1) % TAP1;

    // output taps
    let wl: f32 = (r0 + n1) * 0.6;
    let wr: f32 = (r1 + n0) * 0.6;

    let ol: f32 = xl * dry + wl * wet;
    let orr: f32 = xr * dry + wr * wet;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[f] = ol;
    outBuf[MAX_FRAMES + f] = orr;
  }
}
