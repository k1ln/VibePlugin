// =====================================================================
//  COMET SIX — a six-voice analog-style polyphonic synthesizer.
//  Lineage of the early-80s multimode analog flagships: each voice runs
//  TWO oscillators (a band-limited saw + a band-limited pulse) with
//  OSCILLATOR CROSS-MODULATION and a touch of hard-sync grit, then a
//  resonant state-variable filter whose MODE continuously MORPHS between
//  LOW-PASS, BAND-PASS and HIGH-PASS (so you can get hollow, bright and
//  nasal poly tones a plain low-pass cannot), driven by its own ADSR.
//  Six voices are allocated per noteId so chords ring independently.
//  Pure algorithm — no samples, no host imports, no alloc in process().
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
const P_CUTOFF:   i32 = 0;  // 0..1  -> base filter cutoff (exp)
const P_RESO:     i32 = 1;  // 0..1  -> filter resonance
const P_MODE:     i32 = 2;  // 0,1,2 -> LP / BP / HP morph (discrete)
const P_ENVAMT:   i32 = 3;  // 0..1  -> filter envelope amount
const P_CROSS:    i32 = 4;  // 0..1  -> osc cross-mod + sync grit
const P_ATTACK:   i32 = 5;  // 0..1  -> seconds
const P_RELEASE:  i32 = 6;  // 0..1  -> seconds
const P_LEVEL:    i32 = 7;  // 0..1  -> output level

// ---- per-voice state (module-scope StaticArrays, no alloc) ----------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // oldest-voice stealing

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase1:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw (osc1)
const vPhase2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse (osc2)

// amplitude envelope (AR, with held sustain at 1.0)
const vAEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter envelope
const vFEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// state-variable filter state (per voice): two integrators
const vIc1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vIc2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase1[v] = 0.0; vPhase2[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vIc1[v] = 0.0; vIc2[v] = 0.0;
  }
  ageCounter = 0;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.35;
  params[P_MODE]    = 0.0;   // LP
  params[P_ENVAMT]  = 0.55;
  params[P_CROSS]   = 0.3;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.35;
  params[P_LEVEL]   = 0.7;
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
  // offset phases so cross-mod has something to chew on immediately
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.33;
  vIc1[slot] = 0.0; vIc2[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 3;  // release
      vFStage[i] = 3;
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
  const modeN: f32   = clampf(params[P_MODE], 0.0, 2.0); // 0..2 morph axis
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const cross: f32   = clampf(params[P_CROSS], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.6;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 2.4;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // base cutoff in Hz, exponential 50 Hz .. ~15 kHz
  const baseHz: f32 = 50.0 * f32(Mathf.pow(280.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6 octaves
  const envOct: f32 = envAmt * 6.0;
  // SVF resonance: damping factor k (lower = more resonant). 2.0 -> ~0.4
  const kRes: f32 = 2.0 - resoN * 1.6;

  // ---- multimode morph weights (LP -> BP -> HP) ---------------------
  // modeN in [0,1]: blend LP->BP; in [1,2]: blend BP->HP.
  let wLP: f32 = 0.0; let wBP: f32 = 0.0; let wHP: f32 = 0.0;
  if (modeN <= 1.0) {
    const t: f32 = modeN;
    wLP = 1.0 - t; wBP = t; wHP = 0.0;
  } else {
    const t: f32 = modeN - 1.0;
    wLP = 0.0; wBP = 1.0 - t; wHP = t;
  }
  // BP is naturally quieter than LP/HP — lift it so the mode change is
  // an audible character shift, not just a level dip.
  wBP *= 1.7;

  // cross-mod / sync amount
  const xfm: f32 = cross * 0.9;      // FM-ish modulation depth
  const syncAmt: f32 = cross;        // 0..1 chance/strength of soft sync

  // headroom: up to 6 voices summed
  const voiceScale: f32 = 0.46;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR envelope --------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // sustain (held)
        aenv = 1.0;
      } else if (astg == 3) {     // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter AR envelope -----------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv = 1.0;
      } else if (fstg == 3) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- oscillators with CROSS-MOD + soft SYNC ---------------
      const baseInc: f32 = vFreq[v] / sr;
      // osc2 (pulse) runs slightly higher; it modulates osc1 (saw).
      const inc2: f32 = baseInc * 1.4983;   // detuned ratio for metallic edge

      // advance pulse first so it can modulate the saw
      let p2: f32 = vPhase2[v];
      let wrapped2: i32 = 0;
      p2 += inc2; if (p2 >= 1.0) { p2 -= 1.0; wrapped2 = 1; }
      // band-limited pulse (50% duty) from two saws
      const pw: f32 = 0.5;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, inc2);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, inc2);
      vPhase2[v] = p2;

      // osc1 (saw): cross-modulated in frequency by osc2's output
      const inc1: f32 = baseInc * (1.0 + xfm * sq * 0.5);
      let p1: f32 = vPhase1[v];
      p1 += inc1; if (p1 >= 1.0) p1 -= 1.0; else if (p1 < 0.0) p1 += 1.0;
      // soft sync: when osc2 wraps, nudge osc1's phase toward reset
      if (wrapped2 == 1 && syncAmt > 0.0) {
        p1 -= syncAmt * p1;   // partial reset = sync grit without harshness
        if (p1 < 0.0) p1 += 1.0;
      }
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, inc1 < 0.0 ? -inc1 : inc1);
      vPhase1[v] = p1;

      // mix oscillators (saw body + pulse edge)
      let osc: f32 = saw * 0.6 + sq * 0.5;

      // ---- resonant state-variable filter (multimode) -----------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      // TPT/Zavalishin SVF coefficient
      const g: f32 = f32(Mathf.tan(PI * fc / sr));
      const a1: f32 = 1.0 / (1.0 + g * (g + kRes));

      let ic1: f32 = vIc1[v];
      let ic2: f32 = vIc2[v];

      const v3: f32 = osc - ic2;
      const v1: f32 = a1 * (g * v3 + ic1);
      const v2: f32 = ic2 + g * v1;
      ic1 = 2.0 * v1 - ic1;
      ic2 = 2.0 * v2 - ic2;
      vIc1[v] = ic1;
      vIc2[v] = ic2;

      // v2 = low-pass, v1 = band-pass, hp = input - k*bp - lp
      const lp: f32 = v2;
      const bp: f32 = v1;
      const hp: f32 = osc - kRes * v1 - v2;

      // morph between the three responses
      let filtered: f32 = lp * wLP + bp * wBP + hp * wHP;

      // gentle saturation for analog glue / stability
      filtered = f32(Mathf.tanh(filtered));

      const voice: f32 = filtered * aenv * vVel[v];
      outL += voice;
    }

    // ---- sum + soft saturate + output level ---------------------
    let mix: f32 = outL * voiceScale;
    mix = f32(Mathf.tanh(mix * 1.1));
    mix *= level;

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
