// =====================================================================
//  SPRING VERB — original model of a 2/3-spring reverb tank
//  The "boing": a long cascade of dispersive all-pass delays makes high
//  frequencies travel faster than lows along the spring, so a transient
//  smears into the characteristic chirpy "drip". That dispersive line is
//  wrapped in a damped feedback loop (the springs' multiple reflections)
//  plus two short comb taps for body, with gentle HF damping in the tail.
//  Controls: Decay (tail length), Tension (dispersion / brightness),
//  Drip (chirp / excitation amount), Mix. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831855;

// ---- dispersive all-pass chain (the "spring") ----------------------
// A long cascade of short all-pass delays. Per-stage frequency-dependent
// delay is what produces the chirp; we run it independently per channel.
const NAP: i32 = 10;          // stages of dispersion
const AP_CAP: i32 = 512;      // max samples per stage
const apBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NAP * AP_CAP);
const apPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NAP);
const apLen: StaticArray<i32> = new StaticArray<i32>(NAP);
const apBase: StaticArray<i32> = new StaticArray<i32>(NAP); // base lengths @48k

// ---- main spring feedback delay (the tank length) ------------------
const SPRING_CAP: i32 = 8192;
const springBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * SPRING_CAP);
const springPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);

// ---- two short comb reflections for body ---------------------------
const COMB_CAP: i32 = 4096;
const NCOMB: i32 = 2;
const combBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NCOMB * COMB_CAP);
const combPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NCOMB);
const combLen: StaticArray<i32> = new StaticArray<i32>(NCOMB);
const combBase: StaticArray<i32> = new StaticArray<i32>(NCOMB);

// per-channel state
const dampState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tail HF damping
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker LP
const dcPrev:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker prev in
const preEmph:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input HP state

const P_DECAY:   i32 = 0;  // tail length
const P_TENSION: i32 = 1;  // dispersion / brightness
const P_DRIP:    i32 = 2;  // chirp / excitation amount
const P_MIX:     i32 = 3;  // dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // Mutually-prime-ish short all-pass lengths give a dense, chirpy
  // dispersion without a fixed pitched ring.
  apBase[0] = 71;  apBase[1] = 89;  apBase[2] = 113; apBase[3] = 131;
  apBase[4] = 157; apBase[5] = 173; apBase[6] = 199; apBase[7] = 223;
  apBase[8] = 251; apBase[9] = 277;

  combBase[0] = 1117; combBase[1] = 1583;

  for (let i = 0; i < NAP; i++) apLen[i] = apBase[i];
  for (let i = 0; i < NCOMB; i++) combLen[i] = combBase[i];

  for (let i = 0; i < MAX_CHANNELS * NAP; i++) apPos[i] = 0;
  for (let i = 0; i < MAX_CHANNELS * NCOMB; i++) combPos[i] = 0;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    springPos[c] = 0; dampState[c] = 0.0; dcState[c] = 0.0;
    dcPrev[c] = 0.0; preEmph[c] = 0.0;
  }
  for (let i = 0; i < MAX_CHANNELS * NAP * AP_CAP; i++) apBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * SPRING_CAP; i++) springBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * NCOMB * COMB_CAP; i++) combBuf[i] = 0.0;

  params[P_DECAY] = 0.55; params[P_TENSION] = 0.5;
  params[P_DRIP] = 0.5;   params[P_MIX] = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// One dispersive all-pass stage for channel c, stage i, coefficient g.
@inline function apStage(c: i32, i: i32, x: f32, g: f32): f32 {
  const slot: i32 = c * NAP + i;
  const base: i32 = slot * AP_CAP;
  let p: i32 = apPos[slot];
  const buffered: f32 = apBuf[base + p];
  const y: f32 = -g * x + buffered;
  apBuf[base + p] = x + g * y;
  p++; if (p >= apLen[i]) p = 0;
  apPos[slot] = p;
  return y;
}

export function process(n: i32): void {
  const decay:   f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const tension: f32 = clampf(params[P_TENSION], 0.0, 1.0);
  const drip:    f32 = clampf(params[P_DRIP], 0.0, 1.0);
  const mix:     f32 = clampf(params[P_MIX], 0.0, 1.0);

  const srRatio: f32 = sampleRate / 48000.0;

  // Tension scales the dispersive all-pass coefficient and shortens the
  // springs (tighter spring -> brighter, faster chirp).
  const apG: f32 = 0.55 + tension * 0.4;            // 0.55..0.95
  const apScale: f32 = 1.25 - tension * 0.55;       // longer (boingier) when slack

  // spring loop length & comb lengths scale with tension/sr
  let springLen: i32 = i32(f32(2400) * apScale * srRatio);
  if (springLen < 64) springLen = 64;
  if (springLen >= SPRING_CAP - 4) springLen = SPRING_CAP - 4;

  for (let i = 0; i < NAP; i++) {
    let L: i32 = i32(f32(apBase[i]) * apScale * srRatio);
    if (L < 2) L = 2; if (L >= AP_CAP) L = AP_CAP - 1;
    apLen[i] = L;
  }
  for (let i = 0; i < NCOMB; i++) {
    let L: i32 = i32(f32(combBase[i]) * apScale * srRatio);
    if (L < 2) L = 2; if (L >= COMB_CAP) L = COMB_CAP - 1;
    combLen[i] = L;
  }

  // Decay -> feedback gain of the spring loop. Kept comfortably < 1 so the
  // LINEAR loop is stable on its own (no reliance on the saturator). The
  // round trip is: all-pass chain (unity gain) * combMix (<=1) * fb, so fb
  // is the hard cap on loop gain and must stay below 1.
  const fb: f32 = clampf(0.45 + decay * 0.47, 0.0, 0.92);     // 0.45..0.92
  const combFb: f32 = clampf(0.10 + decay * 0.45, 0.0, 0.6);  // 0.10..0.55

  // HF damping in the tail: brighter (more tension) -> less damping.
  const dampCoef: f32 = clampf(0.12 + (1.0 - tension) * 0.55, 0.0, 0.95);

  // Drip = how much we drive the dispersive chain (chirp/excitation).
  const driveAmt: f32 = 0.5 + drip * 1.4;           // 0.5..1.9
  // Drip also adds a touch of input pre-emphasis (sharper transient -> more chirp)
  const emphAmt: f32 = drip * 0.85;

  const outScale: f32 = 0.6;

  for (let c = 0; c < channels; c++) {
    const inBase: i32 = c * MAX_FRAMES;
    const sBase: i32 = c * SPRING_CAP;
    let sp: i32 = springPos[c];
    let dmp: f32 = dampState[c];
    let dcs: f32 = dcState[c];
    let dcp: f32 = dcPrev[c];
    let emp: f32 = preEmph[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[inBase + f];

      // pre-emphasis: high-pass-ish transient boost driven by Drip
      const hp: f32 = x - emp;
      emp = emp + 0.6 * hp;
      const exc: f32 = (x + emphAmt * hp) * driveAmt;

      // read spring loop (one tank length behind write)
      let rp: i32 = sp - springLen;
      if (rp < 0) rp += SPRING_CAP;
      const tap: f32 = springBuf[sBase + rp];

      // damp the recirculating tail (one-pole LP)
      dmp = dmp + dampCoef * (tap - dmp);

      // excite the dispersive chain with input + damped feedback
      let v: f32 = exc + dmp * fb;

      // cascade of dispersive all-pass stages -> the chirpy "boing"
      v = apStage(c, 0, v, apG);
      v = apStage(c, 1, v, apG);
      v = apStage(c, 2, v, apG);
      v = apStage(c, 3, v, apG);
      v = apStage(c, 4, v, apG);
      v = apStage(c, 5, v, apG);
      v = apStage(c, 6, v, apG);
      v = apStage(c, 7, v, apG);
      v = apStage(c, 8, v, apG);
      v = apStage(c, 9, v, apG);

      // two short comb reflections for body / multiple spring coupling.
      // Each comb is its own stable recirculation (combFb < 1) fed by v.
      // We BLEND the comb body into v (normalized convex mix) instead of
      // ADDING it on top, so this stage never increases the loop's energy:
      //   v <- (1-combMix)*v + combMix*(avg comb output)
      // worst-case stage gain is therefore <= 1.
      let combSum: f32 = 0.0;
      for (let k = 0; k < NCOMB; k++) {
        const cslot: i32 = c * NCOMB + k;
        const cbase: i32 = cslot * COMB_CAP;
        const cp: i32 = combPos[cslot];
        const cTap: f32 = combBuf[cbase + cp];
        combBuf[cbase + cp] = v + cTap * combFb;
        let np: i32 = cp + 1; if (np >= combLen[k]) np = 0;
        combPos[cslot] = np;
        combSum += cTap;
      }
      // average the comb taps, then normalize by the comb's own steady-state
      // gain (1/(1-combFb)) so the blended body stays at roughly unit level.
      const combBody: f32 = combSum * (0.5 * (1.0 - combFb));
      const combMix: f32 = 0.22;
      v = (1.0 - combMix) * v + combMix * combBody;

      // soft saturation keeps the loop bounded ("spring overload" character)
      if (v > 1.2) v = 1.2; else if (v < -1.2) v = -1.2;
      v = v - 0.18 * v * v * v;

      // DC blocker before re-injecting into the loop
      const dcOut: f32 = v - dcp + 0.9995 * dcs;
      dcp = v; dcs = dcOut;

      // write back into the spring loop
      springBuf[sBase + sp] = dcOut;
      sp++; if (sp >= SPRING_CAP) sp = 0;

      const wet: f32 = dcOut * outScale;
      outBuf[inBase + f] = x * (1.0 - mix) + wet * mix;
    }

    dampState[c] = dmp; dcState[c] = dcs; dcPrev[c] = dcp;
    preEmph[c] = emp; springPos[c] = sp;
  }

  // mirror mono input to a silent second channel if host is mono-in/stereo-out
  if (channels < 2) {
    for (let f = 0; f < n; f++) outBuf[MAX_FRAMES + f] = outBuf[f];
  }
}
