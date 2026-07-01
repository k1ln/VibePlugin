// =====================================================================
//  CHORAL BANK — a fully-polyphonic organ / string-ensemble synth.
//  Lineage of the big paraphonic-string / fully-poly organ machines: a
//  divide-down-style FULL-KEYBOARD source (every note is a stack of
//  harmonically related partials, like an organ's drawbar/footage mix)
//  runs through its OWN gentle resonant low-pass with a SLOW ADSR — one
//  filter per note, so dense chords each breathe independently. The whole
//  bank is then poured into a rich 4-tap ENSEMBLE chorus (slow quadrature
//  LFOs modulating short delay lines, hard-panned) that widens the sound
//  into a huge, shimmering, angelic choir. Pure algorithm, no samples,
//  no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 16;        // fully-polyphonic — play big stacked chords

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF:     i32 = 0;  // 0..1 -> base filter cutoff
const P_RESO:       i32 = 1;  // 0..1 -> filter resonance
const P_ATTACK:     i32 = 2;  // 0..1 -> seconds (slow swell)
const P_RELEASE:    i32 = 3;  // 0..1 -> seconds (slow fade)
const P_ENSEMBLE:   i32 = 4;  // 0..1 -> chorus depth / width
const P_BRIGHTNESS: i32 = 5;  // 0..1 -> upper-partial / drawbar balance
const P_LEVEL:      i32 = 6;  // 0..1 -> output

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice steal
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// four divide-down partial phases per voice (footages 16'/8'/4'/2-2/3')
const vPh0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// amplitude ADSR-ish (slow attack / release, full sustain)
const vEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel

// per-voice 2-pole resonant low-pass state (one filter per note)
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// ---- ensemble (chorus) state: 4 modulated delay lines, stereo -------
const ENS_LEN: i32 = 2048;  // ~42 ms @ 48k — plenty for slow ensemble sweep
const ensL: StaticArray<f32> = new StaticArray<f32>(ENS_LEN);
const ensR: StaticArray<f32> = new StaticArray<f32>(ENS_LEN);
let ensWrite: i32 = 0;
let ensLfo0: f32 = 0.0;
let ensLfo1: f32 = 0.0;
let ensLfo2: f32 = 0.0;
let ensLfo3: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPh0[v] = 0.0; vPh1[v] = 0.0; vPh2[v] = 0.0; vPh3[v] = 0.0;
    vEnv[v] = 0.0; vStage[v] = 0;
    vLp0[v] = 0.0; vLp1[v] = 0.0;
  }
  ageCounter = 0;
  for (let i = 0; i < ENS_LEN; i++) { ensL[i] = 0.0; ensR[i] = 0.0; }
  ensWrite = 0;
  ensLfo0 = 0.0; ensLfo1 = 0.25; ensLfo2 = 0.5; ensLfo3 = 0.75;

  params[P_CUTOFF]     = 0.55;
  params[P_RESO]       = 0.22;
  params[P_ATTACK]     = 0.30;
  params[P_RELEASE]    = 0.45;
  params[P_ENSEMBLE]   = 0.7;
  params[P_BRIGHTNESS] = 0.5;
  params[P_LEVEL]      = 0.55;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 0) { slot = i; break; }
  }
  if (slot < 0) {
    let oldest: i32 = 0;
    let oldestAge: i32 = vAge[0];
    for (let i = 1; i < NUM_VOICES; i++) {
      if (vAge[i] < oldestAge) { oldestAge = vAge[i]; oldest = i; }
    }
    slot = oldest;
  }

  vNote[slot]   = id;
  vFreq[slot]   = f > 0.0 ? f : 1.0;
  vVel[slot]    = clampf(v, 0.0, 1.0);
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vStage[slot]  = 1;   // attack
  // staggered phases so the divide-down stack starts coherent but not pin-sharp
  vPh0[slot] = 0.0; vPh1[slot] = 0.13; vPh2[slot] = 0.37; vPh3[slot] = 0.61;
  vLp0[slot] = 0.0; vLp1[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3;  // release
    }
  }
}

// linear-interpolated read from an ensemble delay line, `d` samples back
@inline function tapL(d: f32): f32 {
  let rp: f32 = f32(ensWrite) - d;
  while (rp < 0.0) rp += f32(ENS_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= ENS_LEN) i1 -= ENS_LEN;
  const fr: f32 = rp - f32(i0);
  return f32(ensL[i0] + (ensL[i1] - ensL[i0]) * fr);
}
@inline function tapR(d: f32): f32 {
  let rp: f32 = f32(ensWrite) - d;
  while (rp < 0.0) rp += f32(ENS_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= ENS_LEN) i1 -= ENS_LEN;
  const fr: f32 = rp - f32(i0);
  return f32(ensR[i0] + (ensR[i1] - ensR[i0]) * fr);
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const atkS: f32    = 0.005 + clampf(params[P_ATTACK], 0.0, 1.0)  * 3.5;   // up to ~3.5 s slow swell
  const relS: f32    = 0.02  + clampf(params[P_RELEASE], 0.0, 1.0) * 4.0;   // up to ~4 s fade
  const ensN: f32    = clampf(params[P_ENSEMBLE], 0.0, 1.0);
  const brightN: f32 = clampf(params[P_BRIGHTNESS], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // base cutoff in Hz, exponential 120 Hz .. ~12 kHz
  const baseHz: f32 = 120.0 * f32(Mathf.pow(100.0, cutoffN));
  // resonance 0..~1.6 (gentle — never screaming; this is a choir, not a synth lead)
  const reso: f32 = resoN * 1.6;

  // divide-down "drawbar" footage gains. Brightness tilts energy from the
  // fundamental toward the upper partials (2', 1') for an airy choir top.
  const g0: f32 = 0.95;                         // 16'/fundamental — always present
  const g1: f32 = 0.85;                          // 8' octave
  const g2: f32 = 0.30 + brightN * 0.55;         // 4' two-octave
  const g3: f32 = 0.08 + brightN * 0.60;         // ~2-2/3' fifth/airy top
  const gNorm: f32 = 1.0 / (g0 + g1 + g2 + g3);  // keep stack peak bounded

  // ensemble LFO rates (slow, slightly incommensurate -> living, never static)
  const lfoInc0: f32 = 0.082 / sr * TWO_PI;
  const lfoInc1: f32 = 0.114 / sr * TWO_PI;
  const lfoInc2: f32 = 0.151 / sr * TWO_PI;
  const lfoInc3: f32 = 0.197 / sr * TWO_PI;

  // ensemble depth/center in samples (msec * sr) — widens with Ensemble
  const baseDelay: f32 = 0.012 * sr;             // ~12 ms center
  const depth: f32 = (0.001 + ensN * 0.006) * sr; // ±1..7 ms sweep
  const wet: f32 = 0.25 + ensN * 0.55;           // dry/wet of ensemble
  const dry: f32 = 1.0 - 0.5 * ensN;             // keep some center as it widens

  // headroom: many voices summed -> scale so big chords stay < 1
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope (slow attack / sustain / release) ----
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {            // attack
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {     // sustain (organ holds full)
        env = 1.0;
      } else if (stg == 3) {     // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- divide-down organ source: stacked octave/fifth partials --
      const baseInc: f32 = vFreq[v] / sr;

      let p0: f32 = vPh0[v]; p0 += baseInc;        if (p0 >= 1.0) p0 -= 1.0;
      let p1: f32 = vPh1[v]; p1 += baseInc * 2.0;  if (p1 >= 1.0) p1 -= 1.0;
      let p2: f32 = vPh2[v]; p2 += baseInc * 4.0;  if (p2 >= 1.0) p2 -= 1.0;
      let p3: f32 = vPh3[v]; p3 += baseInc * 6.0;  if (p3 >= 1.0) p3 -= 1.0;
      vPh0[v] = p0; vPh1[v] = p1; vPh2[v] = p2; vPh3[v] = p3;

      // sine partials (smooth, organ-like, no aliasing) summed as a drawbar mix
      const s0: f32 = f32(Mathf.sin(p0 * TWO_PI));
      const s1: f32 = f32(Mathf.sin(p1 * TWO_PI));
      const s2: f32 = f32(Mathf.sin(p2 * TWO_PI));
      const s3: f32 = f32(Mathf.sin(p3 * TWO_PI));
      let osc: f32 = (s0 * g0 + s1 * g1 + s2 * g2 + s3 * g3) * gNorm;

      // ---- per-note resonant 2-pole low-pass with slow ADSR --------
      let fc: f32 = baseHz;
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let lp0: f32 = vLp0[v];
      let lp1: f32 = vLp1[v];
      const inp: f32 = osc - reso * lp1;       // resonance feedback from 2nd stage
      lp0 += g * (inp - lp0);
      lp1 += g * (lp0 - lp1);
      vLp0[v] = lp0;
      vLp1[v] = lp1;

      mono += lp1 * env * vVel[v];
    }

    let sig: f32 = mono * voiceScale;

    // ---- write into ensemble delay lines (same mono source both sides)
    ensL[ensWrite] = sig;
    ensR[ensWrite] = sig;

    // ---- 4 quadrature-ish modulated taps, hard-spread for width -----
    const m0: f32 = f32(Mathf.sin(ensLfo0));
    const m1: f32 = f32(Mathf.sin(ensLfo1));
    const m2: f32 = f32(Mathf.sin(ensLfo2));
    const m3: f32 = f32(Mathf.sin(ensLfo3));

    const d0: f32 = baseDelay + depth * m0;
    const d1: f32 = baseDelay + depth * m1;
    const d2: f32 = baseDelay + depth * m2;
    const d3: f32 = baseDelay + depth * m3;

    // left favours taps 0/2, right favours 1/3 -> wide shimmering choir
    const wetL: f32 = (tapL(d0) * 0.8 + tapL(d2) * 0.6 + tapR(d1) * 0.3);
    const wetR: f32 = (tapR(d1) * 0.8 + tapR(d3) * 0.6 + tapL(d2) * 0.3);

    let outL: f32 = sig * dry + wetL * wet * 0.7;
    let outR: f32 = sig * dry + wetR * wet * 0.7;

    // gentle soft saturation for choral glue, then output level
    outL = f32(Mathf.tanh(outL * 3.6)) * level;
    outR = f32(Mathf.tanh(outR * 3.6)) * level;

    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;

    // advance ensemble write head + LFOs
    ensWrite++; if (ensWrite >= ENS_LEN) ensWrite = 0;
    ensLfo0 += lfoInc0; if (ensLfo0 >= TWO_PI) ensLfo0 -= TWO_PI;
    ensLfo1 += lfoInc1; if (ensLfo1 >= TWO_PI) ensLfo1 -= TWO_PI;
    ensLfo2 += lfoInc2; if (ensLfo2 >= TWO_PI) ensLfo2 -= TWO_PI;
    ensLfo3 += lfoInc3; if (ensLfo3 >= TWO_PI) ensLfo3 -= TWO_PI;
  }
}
