// =====================================================================
//  VIVID POLY — a bright, punchy 8-voice analog polyphonic synthesizer.
//  Italian-poly lineage (vivid, forward, cutting). Each voice runs two
//  DCOs — a band-limited saw and a band-limited variable-width pulse with
//  PWM — summed, with a "Ring" control that morphs in oscillator-sync /
//  ring-modulation grit for extra bite. The mix feeds a snappy resonant
//  2x2-pole (24 dB/oct) low-pass driven by a FAST punchy filter envelope
//  (Attack + Env Amount), then a fast amplitude AR. Voices are allocated
//  per noteId so chords ring independently. Pure algorithm, no samples,
//  no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff (bright)
const P_RESO:    i32 = 1;  // 0..1  -> filter resonance / bite
const P_ENVAMT:  i32 = 2;  // 0..1  -> filter envelope amount
const P_PWM:     i32 = 3;  // 0..1  -> pulse width (thin <-> hollow)
const P_RING:    i32 = 4;  // 0..1  -> sync / ring grit amount
const P_ATTACK:  i32 = 5;  // 0..1  -> seconds (fast)
const P_RELEASE: i32 = 6;  // 0..1  -> seconds
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase1:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw phase
const vPhase2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse phase
const vPhaseS:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // sync/ring master phase

// amplitude envelope (AR): 0 idle 1 atk 2 sustain 4 rel
const vAEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
// filter envelope (AR, snappy decay-to-zero feel via release on gate-off)
const vFEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// 4-pole ladder state per voice
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase1[v] = 0.0; vPhase2[v] = 0.0; vPhaseS[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  params[P_CUTOFF]  = 0.62;
  params[P_RESO]    = 0.40;
  params[P_ENVAMT]  = 0.65;
  params[P_PWM]     = 0.35;
  params[P_RING]    = 0.25;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.30;
  params[P_LEVEL]   = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

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
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.2;
  vPhaseS[slot] = 0.0;
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
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const pwmN: f32    = clampf(params[P_PWM], 0.0, 1.0);
  const ringN: f32   = clampf(params[P_RING], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // FAST punchy envelope: attack 1..~120 ms, release 5 ms..~1.6 s
  const atkS: f32 = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0) * 0.12;
  const relS: f32 = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 1.6;

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);
  // filter env has its own snappy decay even while held -> punch
  const fDecRate: f32 = 1.0 / (0.18 * sr);

  // base cutoff in Hz: bright range 120 Hz .. ~18 kHz (forward, not mellow)
  const baseHz: f32 = 120.0 * f32(Mathf.pow(150.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6.5 octaves -> snappy zing
  const envOct: f32 = envAmt * 6.5;
  // resonance feedback 0..~4 (sharp bite, near self-oscillation at top)
  const reso: f32 = resoN * 4.0;

  // pulse width: 0.5 (square) .. 0.92 (thin/nasal) for PWM bite
  const pw: f32 = 0.5 + pwmN * 0.42;

  // ring/sync grit: how much sync+ring replaces the clean osc mix
  const ringMix: f32 = ringN;
  // sync master runs a fixed ratio above the voice -> hard-sync edge
  const syncRatio: f32 = 1.0 + ringN * 1.5;   // 1.0 .. 2.5

  // headroom: 8 voices summed -> scale so big chords stay bounded
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR -----------------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // sustain (held at full)
        aenv = 1.0;
      } else if (astg == 4) {     // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter AR (snappy: attack to 1, decays toward a floor) ----
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {            // fast attack
        fenv += atkRate * 1.5;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {     // punchy decay toward 0.25 floor while held
        fenv -= fDecRate * (fenv - 0.25);
        if (fenv < 0.25) fenv = 0.25;
      } else if (fstg == 4) {     // release to zero
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- oscillators ------------------------------------------
      const baseInc: f32 = vFreq[v] / sr;

      // DCO1: band-limited saw (a touch flat for slight analog drift)
      let p1: f32 = vPhase1[v];
      p1 += baseInc; if (p1 >= 1.0) p1 -= 1.0;
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, baseInc);
      vPhase1[v] = p1;

      // DCO2: band-limited variable-width pulse (PWM) a touch sharp
      const inc2: f32 = baseInc * 1.003;
      let p2: f32 = vPhase2[v];
      p2 += inc2; if (p2 >= 1.0) p2 -= 1.0;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, inc2);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, inc2);
      vPhase2[v] = p2;

      // clean DCO mix (saw for body, pulse for buzz)
      let osc: f32 = saw * 0.6 + sq * 0.5;

      // ---- ring / hard-sync grit --------------------------------
      // a master oscillator at syncRatio; ring-mod its saw with the mix,
      // and crossfade in for an aggressive metallic edge.
      let ps: f32 = vPhaseS[v];
      const incS: f32 = baseInc * syncRatio;
      ps += incS; if (ps >= 1.0) ps -= 1.0;
      vPhaseS[v] = ps;
      const masterSaw: f32 = 2.0 * ps - 1.0;
      // ring modulation product (bipolar, metallic)
      const ring: f32 = osc * masterSaw;
      // blend: more Ring -> more grit replacing the clean tone
      osc = osc * (1.0 - ringMix * 0.85) + ring * (ringMix * 1.1);

      // ---- resonant 4-pole low-pass -----------------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 30.0) fc = 30.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      // slight high-frequency emphasis (s2-s3) keeps it vivid, not mellow
      let voice: f32 = (s3 + (s2 - s3) * 0.35) * aenv * vVel[v];
      outL += voice;
    }

    // ---- sum + bright soft saturate for Italian-poly glue ----------
    let mix: f32 = outL * voiceScale * (0.4 + level * 1.2);
    mix = f32(Mathf.tanh(mix));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
