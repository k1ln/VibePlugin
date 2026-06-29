// =====================================================================
//  COSMO POLY — a lush 8-voice analog poly synthesizer instrument in the
//  Yamaha CS lineage. Each voice runs two band-limited oscillators (a saw
//  + a pulse) plus a sub-octave, fed into a smooth resonant 4-pole
//  low-pass driven by its OWN ADSR-style filter envelope (Cutoff + Env
//  Amount), then an amplitude envelope (Attack/Release). A built-in RING
//  MODULATOR multiplies the voice against a slightly-detuned carrier to
//  mix in clangy, inharmonic metallic shimmer. A Brilliance tilt opens
//  the top end for the cinematic "Blade Runner" string-pad character.
//  Voices are allocated per noteId so chords ring independently. Pure
//  algorithm, no samples, no host imports.
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
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 1;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 2;  // 0..1  -> filter envelope amount
const P_RING:    i32 = 3;  // 0..1  -> ring-modulation amount
const P_BRILL:   i32 = 4;  // 0..1  -> brilliance / high tilt
const P_ATTACK:  i32 = 5;  // 0..1  -> seconds
const P_RELEASE: i32 = 6;  // 0..1  -> seconds
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPan:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // -1..1 stereo placement

// oscillator phases
const vPhSaw:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhPul:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhSub:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhRing: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // ring carrier phase

// amplitude envelope (attack -> sustain while held -> release)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter envelope (attack -> decay-to-floor while held -> release)
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// 4-pole low-pass state per voice
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// brilliance high-shelf state (one-pole HP per voice for the tilt)
const vHP: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vPan[v] = 0.0;
    vPhSaw[v] = 0.0; vPhPul[v] = 0.0; vPhSub[v] = 0.0; vPhRing[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
    vHP[v] = 0.0;
  }
  ageCounter = 0;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.3;
  params[P_ENVAMT]  = 0.55;
  params[P_RING]    = 0.25;
  params[P_BRILL]   = 0.5;
  params[P_ATTACK]  = 0.25;
  params[P_RELEASE] = 0.45;
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
  // staggered phases so detune beating starts naturally
  vPhSaw[slot]  = 0.0;
  vPhPul[slot]  = 0.25;
  vPhSub[slot]  = 0.0;
  vPhRing[slot] = 0.0;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vHP[slot] = 0.0;
  // wide stereo spread across the keyboard for a cinematic field
  let pan: f32 = f32((id % 12) - 6) / 6.0;
  vPan[slot] = clampf(pan, -1.0, 1.0) * 0.6;
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
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const ringN: f32   = clampf(params[P_RING], 0.0, 1.0);
  const brillN: f32  = clampf(params[P_BRILL], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.5;
  const relS: f32 = 0.02  + clampf(params[P_RELEASE], 0.0, 1.0) * 4.0;

  // per-sample envelope rates
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);
  // filter envelope falls from its peak toward a sustain floor over ~0.8 s
  const fDecRate: f32 = 1.0 / (0.8 * sr);
  const fSustain: f32 = 0.35;

  // base cutoff in Hz, exponential 80 Hz .. ~14 kHz
  const baseHz: f32 = 80.0 * f32(Mathf.pow(180.0, cutoffN));
  // envelope sweeps cutoff up by up to ~5 octaves
  const envOct: f32 = envAmt * 5.0;
  // resonance feedback 0..~3.6 (smooth, never fully self-oscillating)
  const reso: f32 = resoN * 3.6;

  // ring carrier sits slightly above the note (inharmonic clang)
  const ringRatio: f32 = 1.4983; // ~ a detuned tritone-ish carrier
  const ringMix: f32 = ringN;    // 0 = clean, 1 = fully clangy

  // brilliance: how much of the high-passed signal to add back on top
  const brillAmt: f32 = brillN * 1.2;
  // brilliance HP corner ~ 1.8 kHz
  const cHP: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 1800.0 / sr));

  // headroom: 8 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;
    let outR: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope -----------------------------------
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

      // ---- filter envelope --------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {            // attack to peak
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {     // decay toward sustain floor
        fenv -= fDecRate * (1.0 - fSustain);
        if (fenv <= fSustain) { fenv = fSustain; }
      } else if (fstg == 3) {     // release
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      const baseInc: f32 = vFreq[v] / sr;

      // ---- saw oscillator (slightly flat) -----------------------
      const incSaw: f32 = baseInc * 0.9985;
      let pS: f32 = vPhSaw[v];
      pS += incSaw; if (pS >= 1.0) pS -= 1.0;
      let saw: f32 = 2.0 * pS - 1.0;
      saw -= polyBlep(pS, incSaw);
      vPhSaw[v] = pS;

      // ---- pulse oscillator (slightly sharp, 45% duty) ----------
      const incPul: f32 = baseInc * 1.0015;
      let pP: f32 = vPhPul[v];
      pP += incPul; if (pP >= 1.0) pP -= 1.0;
      const pw: f32 = 0.45;
      let sq: f32 = pP < pw ? 1.0 : -1.0;
      sq += polyBlep(pP, incPul);
      let pPb: f32 = pP + (1.0 - pw);
      if (pPb >= 1.0) pPb -= 1.0;
      sq -= polyBlep(pPb, incPul);
      vPhPul[v] = pP;

      // ---- sub oscillator (one octave down, soft sine-ish) ------
      const incSub: f32 = baseInc * 0.5;
      let pSub: f32 = vPhSub[v];
      pSub += incSub; if (pSub >= 1.0) pSub -= 1.0;
      const sub: f32 = f32(Mathf.sin(TWO_PI * pSub));
      vPhSub[v] = pSub;

      // ---- mix oscillators --------------------------------------
      let osc: f32 = saw * 0.55 + sq * 0.42 + sub * 0.38;

      // ---- ring modulator ---------------------------------------
      // multiply the voice against a detuned carrier; blend in for clang
      const incRing: f32 = baseInc * ringRatio;
      let pR: f32 = vPhRing[v];
      pR += incRing; if (pR >= 1.0) pR -= 1.0;
      const carrier: f32 = f32(Mathf.sin(TWO_PI * pR));
      vPhRing[v] = pR;
      const ringed: f32 = osc * carrier;
      osc = osc * (1.0 - ringMix) + ringed * ringMix * 1.4;

      // ---- resonant 4-pole low-pass -----------------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

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

      // ---- brilliance: add high-passed energy back on top -------
      let hp: f32 = vHP[v];
      hp += cHP * (s3 - hp);          // low-passed copy
      vHP[v] = hp;
      const high: f32 = s3 - hp;       // high-passed component
      let voice: f32 = s3 + high * brillAmt;

      voice = voice * aenv * vVel[v];

      // ---- stereo placement -------------------------------------
      const pan: f32 = vPan[v];
      const gL: f32 = f32(Mathf.sqrt(0.5 * (1.0 - pan)));
      const gR: f32 = f32(Mathf.sqrt(0.5 * (1.0 + pan)));
      outL += voice * gL;
      outR += voice * gR;
    }

    // ---- sum + soft saturate for analog glue --------------------
    let mixL: f32 = outL * voiceScale * level;
    let mixR: f32 = outR * voiceScale * level;
    mixL = f32(Mathf.tanh(mixL * 1.1));
    mixR = f32(Mathf.tanh(mixR * 1.1));

    outBuf[f] = mixL;
    outBuf[MAX_FRAMES + f] = mixR;
  }
}
