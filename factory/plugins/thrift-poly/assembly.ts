// =====================================================================
//  THRIFT POLY — lo-fi 8-voice paraphonic DCO poly (budget-classic lineage)
//
//  Distinctive trait: ALL voices share ONE resonant low-pass filter and ONE
//  envelope (paraphonic). Sweeping Cutoff makes whole chords gurgle together.
//  Each voice is a band-limited-ish DCO (saw + square) plus a square sub an
//  octave down. A single shared DEG-style envelope (fast attack, decay to
//  sustain, release) gates the mixed signal and also modulates the shared
//  filter cutoff. A built-in stereo chorus (two modulated delay lines) adds
//  the characteristic budget width. Deliberately slightly gritty, not hi-fi.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const NVOICES: i32 = 8;

// per-voice oscillator state
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NVOICES); // 0..1 saw phase
const vSubPh:  StaticArray<f32> = new StaticArray<f32>(NVOICES); // 0..1 sub phase
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NVOICES); // Hz
const vNote:   StaticArray<i32> = new StaticArray<i32>(NVOICES); // note id (-1 free)
const vActive: StaticArray<i32> = new StaticArray<i32>(NVOICES); // 1 while held
const vVel:    StaticArray<f32> = new StaticArray<f32>(NVOICES); // 0..1
let voiceRR: i32 = 0; // round-robin alloc pointer

// shared (paraphonic) envelope — one for the whole instrument
let env: f32 = 0.0;
let heldCount: i32 = 0;       // number of currently held notes
let envStage: i32 = 0;        // 0 idle, 1 attack, 2 decay/sustain, 3 release

// shared resonant low-pass (state-variable), processed on the SUMMED voices
let svLP: f32 = 0.0;
let svBP: f32 = 0.0;

// stereo chorus delay lines
const CHORUS_LEN: i32 = 2048; // ~42ms @48k
const chL: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
let chWrite: i32 = 0;
let chLfo: f32 = 0.0; // 0..1 phase

const PI2: f32 = 6.2831853;

const P_CUTOFF:  i32 = 0; // shared filter cutoff
const P_RES:     i32 = 1; // shared filter resonance
const P_ENVAMT:  i32 = 2; // env -> cutoff amount
const P_SUB:     i32 = 3; // sub oscillator level
const P_CHORUS:  i32 = 4; // chorus depth/mix
const P_RELEASE: i32 = 5; // release time
const P_LEVEL:   i32 = 6; // output level

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < NVOICES; i++) {
    vPhase[i] = 0.0; vSubPh[i] = 0.0; vFreq[i] = 0.0;
    vNote[i] = -1; vActive[i] = 0; vVel[i] = 0.0;
  }
  voiceRR = 0;
  env = 0.0; heldCount = 0; envStage = 0;
  svLP = 0.0; svBP = 0.0;
  for (let i = 0; i < CHORUS_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  chWrite = 0; chLfo = 0.0;
  params[P_CUTOFF] = 0.45; params[P_RES] = 0.4; params[P_ENVAMT] = 0.6;
  params[P_SUB] = 0.5; params[P_CHORUS] = 0.5; params[P_RELEASE] = 0.35;
  params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function noteOn(id: i32, f: f32, v: f32): void {
  // round-robin steal so a new note always sounds (paraphonic env retrigs)
  let slot: i32 = -1;
  for (let i = 0; i < NVOICES; i++) {
    if (vActive[i] == 0) { slot = i; break; }
  }
  if (slot < 0) { slot = voiceRR; voiceRR = (voiceRR + 1) % NVOICES; }
  vNote[slot] = id;
  vFreq[slot] = f;
  vVel[slot] = clampf(v, 0.0, 1.0);
  vActive[slot] = 1;
  // keep oscillator phase running for that lo-fi free-run feel (no reset)
  heldCount++;
  envStage = 1; // (re)trigger attack — shared, gurgly
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NVOICES; i++) {
    if (vActive[i] == 1 && vNote[i] == id) {
      vActive[i] = 0;
      vNote[i] = -1;
      if (heldCount > 0) heldCount--;
    }
  }
  if (heldCount <= 0) { heldCount = 0; envStage = 3; }
}

export function process(n: i32): void {
  const cutoffN:  f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:     f32 = clampf(params[P_RES], 0.0, 1.0);
  const envAmt:   f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const subLvl:   f32 = clampf(params[P_SUB], 0.0, 1.0) * 0.7;
  const chorusN:  f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const releaseN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const level:    f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 0.9;

  // shared envelope rates (per-sample one-pole coefficients)
  const atkCoef: f32 = 1.0 - Mathf.exp(-1.0 / (0.004 * sampleRate));        // ~4ms
  const decCoef: f32 = 1.0 - Mathf.exp(-1.0 / (0.25 * sampleRate));          // ~250ms to sustain
  const relTime: f32 = 0.03 + releaseN * releaseN * 2.5;                     // 30ms..~2.5s
  const relCoef: f32 = 1.0 - Mathf.exp(-1.0 / (relTime * sampleRate));
  const sustain: f32 = 0.75;

  // chorus LFO ~0.6 Hz, depth scales delay modulation
  const chRate: f32 = 0.6 / sampleRate;
  const chDepth: f32 = 220.0 * chorusN;   // samples of sweep
  const chBase: f32 = 320.0;              // base delay (~6.7ms @48k)
  const chMix: f32 = chorusN * 0.5;

  // mono voice sum scaling — keep big chords bounded
  const voiceScale: f32 = 0.16;

  for (let f = 0; f < n; f++) {
    // ---- advance shared envelope ----
    if (envStage == 1) {
      env += atkCoef * (1.0 - env);
      if (env >= 0.999) { env = 1.0; envStage = 2; }
    } else if (envStage == 2) {
      env += decCoef * (sustain - env);
    } else if (envStage == 3) {
      env += relCoef * (0.0 - env);
      if (env < 0.0003) { env = 0.0; envStage = 0; }
    }

    // ---- sum all voices (paraphonic: shared filter downstream) ----
    let mono: f32 = 0.0;
    for (let i = 0; i < NVOICES; i++) {
      const fr: f32 = vFreq[i];
      if (fr <= 0.0) continue;
      // skip fully released free voices to save cycles (env gone)
      if (vActive[i] == 0 && envStage == 0) continue;

      const inc: f32 = fr / sampleRate;
      let ph: f32 = vPhase[i] + inc;
      if (ph >= 1.0) ph -= 1.0;
      vPhase[i] = ph;

      // DCO saw + square blend (slightly gritty, not band-limited = lo-fi)
      const saw: f32 = ph * 2.0 - 1.0;
      const sq:  f32 = ph < 0.5 ? 1.0 : -1.0;
      let osc: f32 = saw * 0.6 + sq * 0.4;

      // square sub one octave down
      let sp: f32 = vSubPh[i] + inc * 0.5;
      if (sp >= 1.0) sp -= 1.0;
      vSubPh[i] = sp;
      const sub: f32 = sp < 0.5 ? 1.0 : -1.0;

      osc += sub * subLvl;
      // per-voice velocity weighting (use stored vel even after release)
      mono += osc * (0.4 + 0.6 * vVel[i]);
    }
    mono *= voiceScale;

    // ---- shared resonant low-pass (state-variable), env modulates cutoff ----
    // base cutoff 40Hz.. caps ~ for lo-fi gurgle; env pushes it up
    const cmod: f32 = clampf(cutoffN + envAmt * env * 0.6, 0.0, 1.0);
    let fc: f32 = 40.0 + cmod * cmod * 9000.0;
    if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
    const g: f32 = Mathf.tan(3.14159265 * fc / sampleRate);
    const res: f32 = 0.05 + (1.0 - resN) * 1.4; // damping (lower = more resonant)
    const denom: f32 = 1.0 + g * (g + res);
    // SVF (Chamberlin-ish, zero-delay-ish)
    const hp: f32 = (mono - (res + g) * svBP - svLP) / denom;
    const bp: f32 = g * hp + svBP;
    const lp: f32 = g * bp + svLP;
    svBP = g * hp + bp;
    svLP = g * bp + lp;

    // gate by shared envelope + soft saturation for budget grit
    let v: f32 = lp * env;
    // soft clip
    v = clampf(v, -1.4, 1.4);
    v = 1.5 * v - 0.5 * v * v * v;
    v *= level;

    // ---- stereo chorus ----
    chLfo += chRate; if (chLfo >= 1.0) chLfo -= 1.0;
    const lfoL: f32 = Mathf.sin(PI2 * chLfo);
    const lfoR: f32 = Mathf.sin(PI2 * chLfo + 1.5708); // 90deg for width

    chL[chWrite] = v;
    chR[chWrite] = v;

    const dL: f32 = chBase + chDepth * (0.5 + 0.5 * lfoL);
    const dR: f32 = chBase + chDepth * (0.5 + 0.5 * lfoR);

    let rL: f32 = f32(chWrite) - dL;
    let rR: f32 = f32(chWrite) - dR;
    while (rL < 0.0) rL += f32(CHORUS_LEN);
    while (rR < 0.0) rR += f32(CHORUS_LEN);

    const iL0: i32 = i32(rL); const fracL: f32 = rL - f32(iL0);
    const iR0: i32 = i32(rR); const fracR: f32 = rR - f32(iR0);
    const iL1: i32 = (iL0 + 1) % CHORUS_LEN;
    const iR1: i32 = (iR0 + 1) % CHORUS_LEN;

    const wetL: f32 = chL[iL0] + fracL * (chL[iL1] - chL[iL0]);
    const wetR: f32 = chR[iR0] + fracR * (chR[iR1] - chR[iR0]);

    chWrite = (chWrite + 1) % CHORUS_LEN;

    const outL: f32 = v * (1.0 - chMix) + wetL * chMix;
    const outR: f32 = v * (1.0 - chMix) + wetR * chMix;

    outBuf[f] = f32(Mathf.tanh(outL * 2.5));
    if (channels > 1) outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(outR * 2.5));
  }
}
