// =====================================================================
//  OBERON — a fat discrete-oscillator analog polyphonic synthesizer.
//  Six voices, each with TWO oscillators (a band-limited saw + a pulse)
//  fed through a slightly raw resonant 2-pole (12 dB/oct SEM-flavour)
//  low-pass driven by its own envelope (Cutoff + Env Amount + Resonance),
//  then an amplitude envelope. A wide unison Spread detunes the two
//  oscillators AND pans the voice across the stereo field for huge,
//  brassy late-70s American-poly stabs. Deliberately fatter and rawer
//  than a clean ladder-filter poly. Pure algorithm, no samples, no imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 1;  // 0..1  -> filter resonance (raw)
const P_ENVAMT:  i32 = 2;  // 0..1  -> filter envelope amount
const P_SPREAD:  i32 = 3;  // 0..1  -> unison detune + stereo width
const P_ATTACK:  i32 = 4;  // 0..1  -> seconds (both envelopes)
const P_RELEASE: i32 = 5;  // 0..1  -> seconds
const P_LEVEL:   i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPan:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // -1..1 deterministic per slot

const vPhase1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw phase
const vPhase2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse phase
const vPhase3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // sub/detune saw phase

// amplitude envelope (attack -> sustain(=1) -> release)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 3 sus 4 rel
// filter envelope
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// 2-pole state-variable-ish filter state (2 one-pole stages per voice)
const vS1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vS2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase1[v] = 0.0; vPhase2[v] = 0.0; vPhase3[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vS1[v] = 0.0; vS2[v] = 0.0;
    // spread voices across the stereo field deterministically
    vPan[v] = (f32(v) / f32(NUM_VOICES - 1)) * 2.0 - 1.0;
  }
  ageCounter = 0;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.4;
  params[P_ENVAMT]  = 0.55;
  params[P_SPREAD]  = 0.4;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.35;
  params[P_LEVEL]   = 0.6;
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
  // offset phases so detuned layers don't start phase-locked (fatter onset)
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.33;
  vPhase3[slot] = 0.66;
  vS1[slot] = 0.0; vS2[slot] = 0.0;
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
  const spread: f32  = clampf(params[P_SPREAD], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.6;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 2.4;
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.1;

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune spread: up to ~ +/-0.32 semitone between the layers (fat, beaty)
  const detSemi: f32 = spread * 0.32;
  const ratioUp: f32   = f32(Mathf.pow(2.0,  detSemi / 12.0));
  const ratioDn: f32   = f32(Mathf.pow(2.0, -detSemi / 12.0));
  // a wider third layer detune for thickness
  const ratioWide: f32 = f32(Mathf.pow(2.0, (detSemi * 1.7) / 12.0));
  // stereo width grows with spread
  const width: f32 = spread;

  // base cutoff in Hz, exponential ~70 Hz .. ~15 kHz
  const baseHz: f32 = 70.0 * f32(Mathf.pow(214.0, cutoffN));
  // envelope sweeps cutoff up by up to ~5.5 octaves
  const envOct: f32 = envAmt * 5.5;
  // resonance feedback 0..~1.9 (raw, can ring hard but stays bounded)
  const reso: f32 = resoN * 1.9;

  // headroom: up to 6 fat voices -> scale so big chords stay < 1
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;
    let outR: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope (A / sustain=1 / R) ---------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 3; }
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

      // ---- filter envelope --------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 3; }
      } else if (fstg == 4) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- oscillators (saw + pulse + wide saw, detuned) --------
      const baseInc: f32 = vFreq[v] / sr;
      const inc1: f32 = baseInc * ratioDn;     // saw, tuned down
      const inc2: f32 = baseInc * ratioUp;     // pulse, tuned up
      const inc3: f32 = baseInc * ratioWide;   // wide saw (fatness layer)

      // saw 1
      let p1: f32 = vPhase1[v];
      p1 += inc1; if (p1 >= 1.0) p1 -= 1.0;
      let saw1: f32 = 2.0 * p1 - 1.0;
      saw1 -= polyBlep(p1, inc1);
      vPhase1[v] = p1;

      // pulse (asymmetric ~45% duty -> richer, hollower OB-style tone)
      let p2: f32 = vPhase2[v];
      p2 += inc2; if (p2 >= 1.0) p2 -= 1.0;
      const pw: f32 = 0.45;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, inc2);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, inc2);
      vPhase2[v] = p2;

      // saw 3 (wide-detuned, scaled by spread for extra fat/beating)
      let p3: f32 = vPhase3[v];
      p3 += inc3; if (p3 >= 1.0) p3 -= 1.0;
      let saw3: f32 = 2.0 * p3 - 1.0;
      saw3 -= polyBlep(p3, inc3);
      vPhase3[v] = p3;

      // mix oscillators: saw body + hollow pulse + spread-driven fat layer
      let osc: f32 = saw1 * 0.6 + sq * 0.42 + saw3 * (0.18 + 0.4 * spread);

      // ---- raw resonant 2-pole low-pass (SEM-ish, 12 dB/oct) ----
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s1: f32 = vS1[v];
      let s2: f32 = vS2[v];

      // resonance feedback from 2nd stage; soft drive for raw analog edge
      let inp: f32 = osc - reso * s2;
      inp = f32(Mathf.tanh(inp * 1.3));   // slight pre-filter grit
      s1 += g * (inp - s1);
      s2 += g * (s1 - s2);

      vS1[v] = s1; vS2[v] = s2;

      const voice: f32 = s2 * aenv * (0.4 + 0.6 * vVel[v]);

      // ---- per-voice stereo pan scaled by Spread -----------------
      const pan: f32 = vPan[v] * width;            // -1..1
      const lg: f32 = 0.5 + 0.5 * (1.0 - pan);     // simple equal-ish pan
      const rg: f32 = 0.5 + 0.5 * (1.0 + pan);
      outL += voice * lg;
      outR += voice * rg;
    }

    // ---- sum + soft saturate for analog glue --------------------
    let mL: f32 = f32(Mathf.tanh(outL * voiceScale * 1.15)) * level;
    let mR: f32 = f32(Mathf.tanh(outR * voiceScale * 1.15)) * level;

    outBuf[f] = mL;
    outBuf[MAX_FRAMES + f] = mR;
  }
}
