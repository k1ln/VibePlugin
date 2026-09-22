// =====================================================================
//  MODAL STRIKE — a general-purpose modal resonator instrument: excite
//  it (Strike/Bow/Blow/Pluck) and it rings like a bar, string, tube or
//  bell, depending on Structure. Six parallel damped resonators tuned to
//  a partial-frequency set that morphs from a plain harmonic stack
//  (Structure=0) to a stretched, inharmonic bell/bar series (Structure=1).
//  Position emulates striking/plucking at a point along the resonant
//  body: partial k is weighted by |sin(pi*(k+1)*position)|, the same
//  node-suppression a real struck/plucked string shows. Brightness tilts
//  how much extra damping the higher partials get; Damping sets the
//  overall ring length via each resonator's own Q (no separate decay
//  multiplier bolted on — the resonator's feedback IS the decay).
//  Distinct from Pluckwork (a single dedicated guitar/harp/koto/sitar
//  waveguide): this is the general "hit/bow/blow anything" resonator —
//  metal bar, glass, tube, drum skin, string — one shared algorithm.
//  Original implementation, no code or samples borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;
const PI: f32 = 3.14159265;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// ---- panel params -------------------------------------------------------
const P_EXCITER: i32 = 0;   // 0 strike, 1 bow, 2 blow, 3 pluck
const P_STRUCT:  i32 = 1;
const P_BRIGHT:  i32 = 2;
const P_DAMP:    i32 = 3;
const P_POS:     i32 = 4;
const P_STRENGTH:i32 = 5;
const P_HARD:    i32 = 6;
const P_OCT:     i32 = 7;
const P_GLIDE:   i32 = 8;
const P_ATK:     i32 = 9;
const P_DEC:     i32 = 10;
const P_SUS:     i32 = 11;
const P_REL:     i32 = 12;
const P_LFORATE: i32 = 13;
const P_LFOAMT:  i32 = 14;
const P_LFODEST: i32 = 15;  // 0 structure, 1 brightness, 2 position
const P_LEVEL:   i32 = 16;
const P_PAN:     i32 = 17;
const P_WIDTH:   i32 = 18;
const P_VELSENS: i32 = 19;
const NUM_PARAMS: i32 = 20;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }
let rngState: i32 = 0x71a2b3;
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

// six-partial ratio sets: plain harmonic stack vs a stretched, inharmonic
// bell/bar series (loosely modelled on a free-bar overtone series, tamed so
// the top partials stay in-range across the keyboard).
const NRES: i32 = 6;
const HARM_RATIO: StaticArray<f32> = StaticArray.fromArray<f32>([ 1.0, 2.0, 3.0, 4.0, 5.0, 6.0 ]);
const BELL_RATIO: StaticArray<f32> = StaticArray.fromArray<f32>([ 1.0, 2.4, 3.8, 5.3, 6.9, 8.6 ]);

// resonator state (Chamberlin SVF bandpass bank, one per partial)
const resBP: StaticArray<f32> = new StaticArray<f32>(NRES);
const resLP: StaticArray<f32> = new StaticArray<f32>(NRES);

// ---- voice / envelope state ----------------------------------------------
let sampleRate: f32 = 48000.0;
let curFreq: f32 = 220.0;
let tgtFreq: f32 = 220.0;
let noteHeld: i32 = -1;
let gate: i32 = 0;
let envSt: i32 = 0;
let env: f32 = 0.0;
let vel: f32 = 1.0;

let lfoPh: f32 = 0.0;

// exciter state
let excBurstAge: f32 = 0.0;
let bowLP: f32 = 0.0;
let blowLP: f32 = 0.0;

// width output stage
const WBUF: i32 = 64;
const widthBuf: StaticArray<f32> = new StaticArray<f32>(WBUF);
let widthIdx: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  curFreq = 220.0; tgtFreq = 220.0; noteHeld = -1; gate = 0; envSt = 0; env = 0.0; vel = 1.0;
  lfoPh = 0.0;
  excBurstAge = 0.0; bowLP = 0.0; blowLP = 0.0;
  for (let k = 0; k < NRES; k++) { resBP[k] = 0.0; resLP[k] = 0.0; }
  for (let k = 0; k < WBUF; k++) widthBuf[k] = 0.0;
  widthIdx = 0;

  params[P_EXCITER] = 0.0; params[P_STRUCT] = 0.2; params[P_BRIGHT] = 0.6; params[P_DAMP] = 0.55; params[P_POS] = 0.3;
  params[P_STRENGTH] = 0.7; params[P_HARD] = 0.5;
  params[P_OCT] = 0.5; params[P_GLIDE] = 0.08;
  params[P_ATK] = 0.01; params[P_DEC] = 0.3; params[P_SUS] = 0.5; params[P_REL] = 0.55;
  params[P_LFORATE] = 0.3; params[P_LFOAMT] = 0.0; params[P_LFODEST] = 0.0;
  params[P_LEVEL] = 0.8; params[P_PAN] = 0.5; params[P_WIDTH] = 0.3; params[P_VELSENS] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function noteOn(id: i32, f: f32, v: f32): void {
  tgtFreq = f > 0.0 ? f : 220.0;
  if (noteHeld < 0) curFreq = tgtFreq;
  noteHeld = id; gate = 1; envSt = 1; vel = v > 0.0 ? v : 0.9;
  excBurstAge = 0.0;
}
export function noteOff(id: i32): void {
  if (id == noteHeld) { gate = 0; envSt = 4; noteHeld = -1; }
}

// ---- exciter --------------------------------------------------------------
@inline function exciterSignal(etype: i32, hardness: f32, strength: f32, envVal: f32): f32 {
  if (etype == 0 || etype == 3) {
    excBurstAge += 1.0 / sampleRate;
    const rate: f32 = etype == 0 ? (35.0 + hardness * 300.0) : (12.0 + hardness * 110.0);
    const burstEnv: f32 = f32(Mathf.exp(-excBurstAge * rate));
    return rnd() * burstEnv * strength * 1.6;
  } else if (etype == 1) {
    const n: f32 = rnd();
    bowLP = f32(bowLP + (n - bowLP) * 0.35);
    return bowLP * envVal * strength * 1.4;
  } else {
    const n: f32 = rnd();
    const hp: f32 = n - blowLP;
    blowLP = f32(blowLP + (n - blowLP) * 0.6);
    return hp * envVal * strength * 1.8;
  }
}

// ---- resonator bank (per-sample retuned so glide/LFO track cleanly) -------
@inline function resonate(freq: f32, structure: f32, brightness: f32, qBase: f32, posInternal: f32, exc: f32): f32 {
  const nyq: f32 = sampleRate * 0.45;
  let sum: f32 = 0.0;
  for (let k = 0; k < NRES; k++) {
    const ratio: f32 = f32(HARM_RATIO[k] + (BELL_RATIO[k] - HARM_RATIO[k]) * structure);
    const fk: f32 = clampf(freq * ratio, 20.0, nyq);
    const g: f32 = f32(2.0 * Mathf.sin(PI * fk / sampleRate));
    const q: f32 = clampf(qBase + f32(k) * (1.0 - brightness) * 0.06, 0.012, 0.9);
    const posGain: f32 = f32(Mathf.abs(Mathf.sin(PI * f32(k + 1) * posInternal)));
    const outGain: f32 = 1.0 / (1.0 + f32(k) * 0.5);
    const drive: f32 = exc * posGain;
    const hp: f32 = drive - resLP[k] - q * resBP[k];
    resBP[k] = f32(resBP[k] + g * hp);
    resLP[k] = f32(resLP[k] + g * resBP[k]);
    sum += resBP[k] * outGain;
  }
  return sum;
}

// ---- main process -----------------------------------------------------------
export function process(n: i32): void {
  const etype: i32 = clampi(i32(params[P_EXCITER] + 0.5), 0, 3);
  const structureN: f32 = clampf(params[P_STRUCT], 0.0, 1.0);
  const brightnessN: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const dampingN: f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const positionN: f32 = clampf(params[P_POS], 0.0, 1.0);
  const strengthN: f32 = clampf(params[P_STRENGTH], 0.0, 1.0);
  const hardnessN: f32 = clampf(params[P_HARD], 0.0, 1.0);
  const oct: f32 = clampf(params[P_OCT], 0.0, 1.0);
  const glideN: f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const atkN: f32 = clampf(params[P_ATK], 0.0, 1.0);
  const decN: f32 = clampf(params[P_DEC], 0.0, 1.0);
  const susN: f32 = clampf(params[P_SUS], 0.0, 1.0);
  const relN: f32 = clampf(params[P_REL], 0.0, 1.0);
  const lfoRateN: f32 = clampf(params[P_LFORATE], 0.0, 1.0);
  const lfoAmtN: f32 = clampf(params[P_LFOAMT], 0.0, 1.0);
  const lfoDest: i32 = clampi(i32(params[P_LFODEST] + 0.5), 0, 2);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);
  const panN: f32 = clampf(params[P_PAN], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const velSensN: f32 = clampf(params[P_VELSENS], 0.0, 1.0);

  const semis: f32 = (oct - 0.5) * 48.0;
  const octRatio: f32 = f32(Mathf.pow(2.0, semis / 12.0));
  const atkInc: f32 = 1.0 / ((0.002 + atkN * atkN * 1.2) * sampleRate);
  const decT: f32 = 0.02 + decN * decN * 2.5;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decT * sampleRate)));
  const relT: f32 = 0.03 + relN * relN * 4.0;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relT * sampleRate)));
  const lfoHz: f32 = 0.03 * f32(Mathf.pow(300.0, lfoRateN));
  const lfoInc: f32 = lfoHz / sampleRate;
  const glideCoef: f32 = glideN < 0.001 ? 0.0 : f32(Mathf.exp(-1.0 / ((0.003 + glideN * 0.6) * sampleRate)));
  const qBase: f32 = 0.015 + (1.0 - dampingN) * 0.4;
  const ampVel: f32 = (1.0 - velSensN) + velSensN * vel;
  const outLevel: f32 = level * 0.9;
  const panBi: f32 = panN * 2.0 - 1.0;
  const lGain: f32 = clampf(1.0 - panBi, 0.0, 1.0);
  const rGain: f32 = clampf(1.0 + panBi, 0.0, 1.0);
  const delaySamps: i32 = clampi(1 + i32(widthN * 30.0), 1, WBUF - 1);

  for (let i = 0; i < n; i++) {
    if (glideCoef > 0.0) curFreq = curFreq + (tgtFreq - curFreq) * (1.0 - glideCoef);
    else curFreq = tgtFreq;

    if (envSt == 1) { env += atkInc; if (env >= 1.0) { env = 1.0; envSt = 2; } }
    else if (envSt == 2) { env = susN + (env - susN) * decCoef; if (env <= susN + 0.001) { env = susN; envSt = 3; } }
    else if (envSt == 3) { env = susN; }
    else if (envSt == 4) { env *= relCoef; if (env < 0.0003) { env = 0.0; envSt = 0; } }

    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfo: f32 = f32(Mathf.sin(lfoPh * TAU));

    let structUse: f32 = structureN;
    let brightUse: f32 = brightnessN;
    let posUse: f32 = positionN;
    if (lfoDest == 0) structUse = clampf(structureN + lfo * lfoAmtN * 0.6, 0.0, 1.0);
    else if (lfoDest == 1) brightUse = clampf(brightnessN + lfo * lfoAmtN * 0.6, 0.0, 1.0);
    else posUse = clampf(positionN + lfo * lfoAmtN * 0.5, 0.0, 1.0);

    const freq: f32 = curFreq * octRatio;
    const posInternal: f32 = 0.02 + posUse * 0.48;

    const exc: f32 = exciterSignal(etype, hardnessN, strengthN, env);
    const core: f32 = resonate(freq, structUse, brightUse, qBase, posInternal, exc);

    const sig: f32 = core * env * ampVel;

    widthBuf[widthIdx] = sig;
    let ri: i32 = widthIdx - delaySamps; while (ri < 0) ri += WBUF;
    const delayed: f32 = widthBuf[ri];
    widthIdx = (widthIdx + 1) % WBUF;
    const rSig: f32 = sig * (1.0 - widthN) + delayed * widthN;

    const outL: f32 = f32(Mathf.tanh(sig * lGain * outLevel * 2.2));
    const outR: f32 = f32(Mathf.tanh(rSig * rGain * outLevel * 2.2));
    outBuf[i] = outL;
    outBuf[MAX_FRAMES + i] = outR;
  }
}
