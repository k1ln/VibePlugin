// =====================================================================
//  UNISON FOUR — a four-VCO unison mono/poly synthesizer instrument.
//  (Korg Mono/Poly lineage, original implementation.)
//
//  Every held note drives a VOICE that stacks FOUR oscillators. Each
//  oscillator is a band-limited saw/pulse blend; the four are spread
//  apart by a Detune control so they pile into one fat, beating unison
//  stack (a thick mono lead/bass) or, with several notes held, spread
//  across a chord. Oscillator 1 hard-syncs oscillators 2..4 (Sync) for
//  the classic resonant-formant grit. The summed stack feeds a resonant
//  4-pole low-pass driven by its own decay envelope (Cutoff + Env Amount
//  + Resonance), then an amplitude decay envelope. Pure algorithm, no
//  samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;   // notes held at once
const NUM_OSC: i32 = 4;      // the four VCOs per voice

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_DETUNE: i32 = 0;  // 0..1  -> unison spread / width of the 4-VCO stack
const P_CUTOFF: i32 = 1;  // 0..1  -> base filter cutoff
const P_RESO:   i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT: i32 = 3;  // 0..1  -> filter envelope amount (cutoff sweep)
const P_SYNC:   i32 = 4;  // 0..1  -> hard-sync amount (osc 2..4 reset to osc1)
const P_DECAY:  i32 = 5;  // 0..1  -> amp/filter decay time
const P_LEVEL:  i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// four oscillator phases per voice (flat array: voice * NUM_OSC + osc)
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * NUM_OSC);

// amplitude envelope (attack then decay-to-floor while held, release on lift)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 4 rel
// filter envelope (attack then decay)
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// resonant ladder filter state (4 one-pole stages per voice)
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// fixed per-oscillator detune directions, in cents-fraction units, so the
// stack fans symmetrically outward as Detune rises (osc0 is the anchor).
const OSC_SPREAD: StaticArray<f32> = new StaticArray<f32>(NUM_OSC);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
    for (let o = 0; o < NUM_OSC; o++) vPhase[v * NUM_OSC + o] = 0.0;
  }
  // osc0 anchor, the rest fan out: -1, +0.55, +1 (asymmetric -> richer beat)
  OSC_SPREAD[0] = 0.0;
  OSC_SPREAD[1] = -1.0;
  OSC_SPREAD[2] = 0.55;
  OSC_SPREAD[3] = 1.0;
  ageCounter = 0;
  params[P_DETUNE] = 0.45;
  params[P_CUTOFF] = 0.5;
  params[P_RESO]   = 0.4;
  params[P_ENVAMT] = 0.6;
  params[P_SYNC]   = 0.0;
  params[P_DECAY]  = 0.45;
  params[P_LEVEL]  = 0.7;
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
  vAStage[slot] = 1;   // attack
  vFStage[slot] = 1;
  vAEnv[slot]   = 0.0;
  vFEnv[slot]   = 0.0;
  // stagger the four oscillator phases so unison beating starts lively
  vPhase[slot * NUM_OSC + 0] = 0.0;
  vPhase[slot * NUM_OSC + 1] = 0.25;
  vPhase[slot * NUM_OSC + 2] = 0.5;
  vPhase[slot * NUM_OSC + 3] = 0.75;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 4;  // release
      vFStage[i] = 4;
    }
  }
}

// polyBLEP correction removes the worst aliasing on saw/pulse edges
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const detune: f32  = clampf(params[P_DETUNE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const syncN: f32   = clampf(params[P_SYNC], 0.0, 1.0);
  const decN: f32    = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0) * 1.1;

  // envelope rates -----------------------------------------------------
  const atkS: f32 = 0.004;                       // snappy attack (mono stab)
  const decS: f32 = 0.02 + decN * decN * 2.4;    // decay time 20 ms .. ~2.4 s
  const relS: f32 = 0.03 + decN * 1.2;           // release tracks decay
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);
  // while held the amp decays toward this floor (longer Decay -> louder avg)
  const susFloor: f32 = 0.18 + decN * 0.62;

  // unison spread: up to ~ +/-0.5 semitone across the stack -> fat & wide
  const spreadSemi: f32 = detune * 0.5;

  // base cutoff in Hz, exponential ~50 Hz .. ~17 kHz
  const baseHz: f32 = 50.0 * f32(Mathf.pow(340.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6.5 octaves
  const envOct: f32 = envAmt * 6.5;
  // resonance feedback 0..~4.2 (screaming near top)
  const reso: f32 = resoN * 4.2;

  // sync depth: how strongly osc1's reset drags osc2..4 (0 = free, 1 = hard)
  const sync: f32 = syncN;

  // headroom: 6 voices * 4 oscillators summed -> scale so chords stay bounded
  // pushed hot into the saturator so a single unison stack is thick, not thin
  const voiceScale: f32 = 1.2;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope (attack -> decay-to-floor -> release) -
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {
        aenv -= decRate * (aenv - susFloor);
        if (aenv < susFloor + 0.0005) aenv = susFloor;
      } else if (astg == 4) {
        aenv -= relRate * aenv + 0.000002;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter envelope (attack -> decay to zero) ----------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv -= decRate * fenv;
        if (fenv < 0.0008) fenv = 0.0;
      } else if (fstg == 4) {
        fenv -= relRate * fenv + 0.000002;
        if (fenv <= 0.0) fenv = 0.0;
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- the four unison oscillators ------------------------------
      const baseInc: f32 = vFreq[v] / sr;
      const pbase: i32 = v * NUM_OSC;

      // advance osc0 (the sync master) first, detect its wrap
      let p0: f32 = vPhase[pbase + 0];
      const inc0: f32 = baseInc;   // anchor pitch (OSC_SPREAD[0] == 0)
      p0 += inc0;
      let masterWrapped: bool = false;
      if (p0 >= 1.0) { p0 -= 1.0; masterWrapped = true; }
      vPhase[pbase + 0] = p0;

      let stack: f32 = 0.0;
      for (let o = 0; o < NUM_OSC; o++) {
        // per-oscillator detune ratio (anchor osc0 unshifted)
        const semi: f32 = spreadSemi * OSC_SPREAD[o];
        const inc: f32 = baseInc * f32(Mathf.pow(2.0, semi / 12.0));

        let p: f32;
        if (o == 0) {
          p = p0;
        } else {
          p = vPhase[pbase + o];
          p += inc;
          if (p >= 1.0) p -= 1.0;
          // hard sync: when the master wraps, drag this osc's phase back
          // toward 0 by the sync amount (1 = full reset -> bright formant)
          if (masterWrapped && sync > 0.0) {
            p = p * (1.0 - sync);
          }
          vPhase[pbase + o] = p;
        }

        // band-limited saw + pulse blend for a thick, edgy timbre
        let saw: f32 = 2.0 * p - 1.0;
        saw -= polyBlep(p, inc);

        const pw: f32 = 0.42;
        let sq: f32 = p < pw ? 1.0 : -1.0;
        sq += polyBlep(p, inc);
        let pb: f32 = p + (1.0 - pw);
        if (pb >= 1.0) pb -= 1.0;
        sq -= polyBlep(pb, inc);

        stack += saw * 0.65 + sq * 0.42;
      }
      // average the four so adding oscillators fattens without exploding
      stack *= 0.25;

      // ---- resonant 4-pole low-pass (per voice) ---------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      let inp: f32 = stack - reso * s3;
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      outL += s3 * aenv * vVel[v];
    }

    // ---- sum + soft saturate for analog-monster glue ----------------
    let mix: f32 = outL * voiceScale * level;
    mix = f32(Mathf.tanh(mix * 1.4));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
