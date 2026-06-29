// =====================================================================
//  TINE PIANO — a polyphonic electric tine-piano instrument.
//  Each voice models a struck metal tine with 2-operator FM: a sine
//  CARRIER at the note pitch plus a higher-RATIO MODULATOR whose index
//  decays fast, giving the bright bell/"bark" attack that melts into a
//  mellow sine body. Velocity drives both the bark amount and brightness.
//  A natural two-stage amplitude decay (fast initial, slow tail) plus a
//  release tail keeps notes singing; a gentle stereo tremolo (opposed
//  L/R amplitude wobble) adds the classic suitcase-piano sway. Up to
//  twelve voices; chords ring with independent contours. No samples, no
//  host imports — pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 12;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_BELL:   i32 = 0;  // 0..1  -> attack FM modulation depth (bark/bell)
const P_DECAY:  i32 = 1;  // 0..1  -> note decay time
const P_TONE:   i32 = 2;  // 0..1  -> overall brightness (body LP + mod ratio mix)
const P_TREMD:  i32 = 3;  // 0..1  -> tremolo depth
const P_TREMR:  i32 = 4;  // 0..1  -> tremolo rate (Hz)
const P_LEVEL:  i32 = 5;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhC:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // carrier phase (0..1)
const vPhM:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // modulator phase (0..1)

// amplitude envelope (multiplicative decay + release)
const vAmp:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // current amp 0..1
const vAtk:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // attack ramp 0..1
const vGate2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // release gate smoother 0..1

// FM modulation index envelope (the bark: starts high, decays fast)
const vMEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// per-voice body low-pass state (one pole, mellows the sine body)
const vLP:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// global tremolo LFO phase (shared so the whole instrument sways together)
let tremPhase: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhC[v] = 0.0; vPhM[v] = 0.0;
    vAmp[v] = 0.0; vAtk[v] = 0.0; vGate2[v] = 0.0;
    vMEnv[v] = 0.0; vLP[v] = 0.0;
  }
  ageCounter = 0;
  tremPhase = 0.0;
  params[P_BELL]  = 0.55;
  params[P_DECAY] = 0.55;
  params[P_TONE]  = 0.5;
  params[P_TREMD] = 0.35;
  params[P_TREMR] = 0.3;
  params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast sine from a normalized phase (0..1) using Mathf.sin
@inline function sinp(phase: f32): f32 {
  return f32(Mathf.sin(phase * TWO_PI));
}

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  // prefer a free voice, else steal the oldest
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
  vPhC[slot]    = 0.0;
  vPhM[slot]    = 0.0;
  vAmp[slot]    = 1.0;   // struck: full amplitude, then decays
  vAtk[slot]    = 0.0;   // quick attack ramp removes the click
  vGate2[slot]  = 1.0;
  vMEnv[slot]   = 1.0;   // bark starts fully open
  vLP[slot]     = 0.0;
  vAge[slot]    = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;   // start release tail (gate smoother falls to 0)
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const bellN:  f32 = clampf(params[P_BELL],  0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE],  0.0, 1.0);
  const tremD:  f32 = clampf(params[P_TREMD], 0.0, 1.0);
  const tremRN: f32 = clampf(params[P_TREMR], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 0.9;

  // bark depth: modulation index at the strike (peak FM amount)
  const bellPeak: f32 = 1.2 + bellN * 7.0;        // ~1.2..8.2 radians

  // bark decay: the bell/bark fades quickly (independent of body decay).
  // time constant ~30..120 ms -> per-sample multiplier
  const barkT: f32 = 0.03 + bellN * 0.09;
  const barkDec: f32 = f32(Mathf.exp(-1.0 / (barkT * sr)));

  // body decay time: short (~0.5 s) to long (~9 s) tail
  const decT: f32 = 0.5 + decayN * decayN * 8.5;
  const ampDec: f32 = f32(Mathf.exp(-1.0 / (decT * sr)));

  // attack ramp speed (~3 ms) — soft enough to avoid clicks, fast enough to bark
  const atkRate: f32 = 1.0 / (0.003 * sr);

  // release smoother time constant (~0.18 s) after key up
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.18 * sr)));

  // modulator ratio: classic tine bell is a non-integer ratio (~ 2x..14x).
  // Tone leans the spectrum brighter by raising the ratio a touch.
  const modRatio: f32 = 3.0 + toneN * 11.0;

  // body low-pass cutoff follows Tone (mellow to open) — softens the sine tail
  const bodyHz: f32 = 700.0 + toneN * toneN * 6500.0;
  const bodyG: f32 = clampf(f32(1.0 - Mathf.exp(-TWO_PI * bodyHz / sr)), 0.0, 0.999);

  // tremolo: rate 0.5..7 Hz, opposed stereo wobble
  const tremHz: f32 = 0.5 + tremRN * 6.5;
  const tremInc: f32 = tremHz / sr;
  const tremAmt: f32 = tremD * 0.5;   // up to +/-50% amplitude swing

  // 12 voices summed -> scale so a full chord stays bounded
  const voiceScale: f32 = 0.42;

  let tp: f32 = tremPhase;

  for (let f = 0; f < n; f++) {
    // ---- stereo tremolo gains (opposed phase L/R) -------------------
    tp += tremInc; if (tp >= 1.0) tp -= 1.0;
    const lfo: f32 = sinp(tp);
    const gL: f32 = 1.0 - tremAmt * (0.5 - 0.5 * lfo);
    const gR: f32 = 1.0 - tremAmt * (0.5 + 0.5 * lfo);

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- attack ramp ------------------------------------------
      let atk: f32 = vAtk[v];
      if (atk < 1.0) { atk += atkRate; if (atk > 1.0) atk = 1.0; }
      vAtk[v] = atk;

      // ---- release gate smoother --------------------------------
      let g2: f32 = vGate2[v];
      if (vGate[v] == 0) {
        g2 += relCoef * (0.0 - g2);
      }
      vGate2[v] = g2;

      // ---- body amplitude decay ---------------------------------
      let amp: f32 = vAmp[v];
      amp *= ampDec;
      vAmp[v] = amp;

      const env: f32 = amp * atk * g2;

      // voice finished? (decayed below threshold)
      if (env <= 0.0002 && (vGate[v] == 0 || amp <= 0.0002)) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        vAmp[v] = 0.0; vMEnv[v] = 0.0; vLP[v] = 0.0;
        continue;
      }

      // ---- FM bark envelope -------------------------------------
      let menv: f32 = vMEnv[v];
      menv *= barkDec;
      vMEnv[v] = menv;

      // ---- 2-operator FM ----------------------------------------
      const incC: f32 = vFreq[v] / sr;
      const incM: f32 = incC * modRatio;

      let phM: f32 = vPhM[v];
      phM += incM; if (phM >= 1.0) phM -= 1.0; if (phM < 0.0) phM += 1.0;
      vPhM[v] = phM;

      // modulation index: velocity makes harder strikes bark harder/brighter
      const vel: f32 = vVel[v];
      const velBark: f32 = 0.35 + vel * 0.85;
      const modIndex: f32 = bellPeak * menv * velBark;
      const modOut: f32 = sinp(phM) * modIndex;

      let phC: f32 = vPhC[v];
      phC += incC; if (phC >= 1.0) phC -= 1.0;
      vPhC[v] = phC;

      // carrier phase-modulated by the modulator
      let car: f32 = f32(Mathf.sin(phC * TWO_PI + modOut));

      // ---- per-voice body low-pass (mellow tail) ----------------
      let lp: f32 = vLP[v];
      lp += bodyG * (car - lp);
      vLP[v] = lp;
      // blend a little of the un-filtered carrier back so the bark stays present
      const body: f32 = lp + (car - lp) * (0.25 + toneN * 0.5);

      // velocity scales overall loudness too
      const voiceAmp: f32 = env * (0.45 + vel * 0.55);
      mono += body * voiceAmp;
    }

    let m: f32 = mono * voiceScale;
    // gentle soft saturation for warmth + safety on big chords
    m = f32(Mathf.tanh(m * 1.1)) * level;

    outBuf[f] = m * gL;
    outBuf[MAX_FRAMES + f] = m * gR;
  }

  tremPhase = tp;
}
