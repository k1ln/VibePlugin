// =====================================================================
//  PIN MATRIX — an EMS-lineage British-modular MONO/paraphonic synth.
//
//  Original DSP inspired by the quirky patch-matrix monosynths of early
//  1970s British studios. Three oscillators (saw, triangle, pulse) feed a
//  RING MODULATOR that multiplies osc1 x osc2 for clangy, inharmonic metal,
//  then a distinctive DIODE-LADDER resonant low-pass that self-oscillates,
//  shaped by a snappy trapezoid-style envelope. The signal is deliberately
//  asymmetric and slightly unstable so it sounds idiosyncratic and metallic,
//  NOT a clean Moog. Pure algorithm, no samples, no host imports.
//
//  Two voices (paraphonic): the most-recent two held notes both sound,
//  sharing one filter+envelope path per voice for the eccentric lab feel.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 2;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_OSCMIX:  i32 = 0;  // 0..1  -> blend osc1(saw) <-> osc3(pulse), tri filler
const P_RINGMOD: i32 = 1;  // 0..1  -> ring modulator amount (osc1 x osc2)
const P_CUTOFF:  i32 = 2;  // 0..1  -> diode-ladder base cutoff
const P_RESO:    i32 = 3;  // 0..1  -> resonance (-> self-oscillation)
const P_ENVAMT:  i32 = 4;  // 0..1  -> envelope -> cutoff amount
const P_DECAY:   i32 = 5;  // 0..1  -> trapezoid decay time
const P_LEVEL:   i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for note stealing
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// oscillator phases
const vPh1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw  (osc1)
const vPh2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // tri  (osc2, the ring partner)
const vPh3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse(osc3)

// trapezoid-style envelope (snappy attack hold, then decay)
const vEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vEStg:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 3 rel

// diode-ladder filter state (4 stages per voice)
const vL0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vL1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vL2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vL3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPh1[v] = 0.0; vPh2[v] = 0.0; vPh3[v] = 0.0;
    vEnv[v] = 0.0; vEStg[v] = 0;
    vL0[v] = 0.0; vL1[v] = 0.0; vL2[v] = 0.0; vL3[v] = 0.0;
  }
  ageCounter = 0;
  params[P_OSCMIX]  = 0.5;
  params[P_RINGMOD] = 0.45;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.55;
  params[P_ENVAMT]  = 0.7;
  params[P_DECAY]   = 0.45;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// polyBLEP correction tames the worst aliasing on saw/pulse edges
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

// ---- voice allocation: last-two-note paraphony -----------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 0) { slot = i; break; }
  }
  if (slot < 0) {
    // steal the oldest voice
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
  vEStg[slot]   = 1; // attack
  // EMS oscillators free-run; offset phases so the ring product is lively
  vPh1[slot] = 0.0;
  vPh2[slot] = 0.17;
  vPh3[slot] = 0.41;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vEStg[i] = 3; // release
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const oscMix: f32  = clampf(params[P_OSCMIX], 0.0, 1.0);
  const ringAmt: f32 = clampf(params[P_RINGMOD], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const decayN: f32  = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // trapezoid envelope rates: snappy attack (~3 ms), decay 40 ms .. ~2.2 s
  const atkRate: f32 = 1.0 / (0.003 * sr);
  const decS: f32 = 0.04 + decayN * decayN * 2.2;
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (0.12 * sr); // gate-off release

  // base cutoff in Hz, exponential ~50 Hz .. ~14 kHz
  const baseHz: f32 = 50.0 * f32(Mathf.pow(280.0, cutoffN));
  // envelope sweeps cutoff up by up to ~7 octaves
  const envOct: f32 = envAmt * 7.0;
  // diode-ladder resonance feedback (pushes to self-oscillation near top)
  const reso: f32 = resoN * 4.4;

  // osc mix weights: saw <-> pulse crossfade, with a constant triangle bed
  const sawW: f32 = (1.0 - oscMix);
  const pulW: f32 = oscMix;

  // ring-mod osc2 detuned a touch sharp + non-integer so the product is
  // strongly inharmonic and clangy (a metallic, bell-like character)
  const ringRatio: f32 = 1.4983;

  // two voices summed -> scale so both held notes stay bounded
  const voiceScale: f32 = 0.6;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let vi = 0; vi < NUM_VOICES; vi++) {
      if (vActive[vi] == 0) continue;

      // ---- trapezoid-style envelope -----------------------------
      let env: f32 = vEnv[vi];
      let stg: i32 = vEStg[vi];
      if (stg == 1) {              // attack to 1
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {       // decay toward a low plateau
        env -= decRate * (env - 0.18);
        if (env < 0.181) { /* hold near plateau while gated */ }
      } else if (stg == 3) {       // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[vi] = env;
      vEStg[vi] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[vi] = 0; vGate[vi] = 0; vNote[vi] = -1;
        continue;
      }

      const baseInc: f32 = vFreq[vi] / sr;

      // ---- osc1: band-limited saw -------------------------------
      let p1: f32 = vPh1[vi];
      p1 += baseInc; if (p1 >= 1.0) p1 -= 1.0;
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, baseInc);
      vPh1[vi] = p1;

      // ---- osc2: triangle, detuned (the ring-mod partner) -------
      const inc2: f32 = baseInc * ringRatio;
      let p2: f32 = vPh2[vi];
      p2 += inc2; if (p2 >= 1.0) p2 -= 1.0;
      // triangle from phase
      let tri: f32 = 4.0 * (p2 < 0.5 ? p2 : (1.0 - p2)) - 1.0;
      vPh2[vi] = p2;

      // ---- osc3: band-limited pulse (slightly narrow duty) ------
      const pw: f32 = 0.42;
      let p3: f32 = vPh3[vi];
      p3 += baseInc; if (p3 >= 1.0) p3 -= 1.0;
      let pul: f32 = p3 < pw ? 1.0 : -1.0;
      pul += polyBlep(p3, baseInc);
      let p3b: f32 = p3 + (1.0 - pw);
      if (p3b >= 1.0) p3b -= 1.0;
      pul -= polyBlep(p3b, baseInc);
      vPh3[vi] = p3;

      // ---- mixer: saw<->pulse crossfade + triangle bed ----------
      let dry: f32 = saw * sawW + pul * pulW + tri * 0.28;

      // ---- RING MODULATOR: osc1 x osc2 (clangy inharmonic) ------
      // multiply the saw by the detuned triangle; blend in by ringAmt.
      const ring: f32 = saw * tri;
      let osc: f32 = dry * (1.0 - ringAmt) + ring * ringAmt * 1.6;

      // a little asymmetry/grit so it is not a clean classic synth
      osc = osc + 0.12 * osc * osc;

      // ---- diode-ladder resonant low-pass -----------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * env));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vL0[vi];
      let s1: f32 = vL1[vi];
      let s2: f32 = vL2[vi];
      let s3: f32 = vL3[vi];

      // resonance feedback from the last stage; diode-ish soft nonlinearity
      // on the feedback path gives the EMS ladder its slightly unstable bite
      let fb: f32 = reso * s3;
      fb = f32(Mathf.tanh(fb * 1.3));
      let inp: f32 = osc - fb;

      // asymmetric diode shaping in the first stage
      inp = inp + 0.15 * inp * inp;

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vL0[vi] = s0; vL1[vi] = s1; vL2[vi] = s2; vL3[vi] = s3;

      let voice: f32 = s3 * env * (0.5 + 0.5 * vVel[vi]);
      outL += voice;
    }

    // ---- sum + soft saturate for that overdriven lab character ---
    let mix: f32 = outL * voiceScale;
    mix = f32(Mathf.tanh(mix * 1.4)) * level;

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
