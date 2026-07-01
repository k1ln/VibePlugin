// =====================================================================
//  TWIN GRIT — a bright, gritty 2-oscillator semi-modular MONO synth in the
//  Japanese dual-filter lineage. Two oscillators run through TWO aggressive,
//  self-oscillating filters in series - a resonant low-pass then a resonant
//  high-pass - for the unmistakable honking, screaming character. Snappy
//  ADSR, free LFO, sample & hold and noise feed a 5x4 patch matrix
//  (LFO/Env/S&H/Noise/Osc2 -> Pitch/LP Cut/PWM/HP Cut) whose routing amounts
//  ARE parameters. Normalled Env->LP Cut + LFO->PWM. Mono, last-note.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// ---- panel params (knobs) -------------------------------------------
const P_OSC1:  i32 = 0;   // saw <-> square morph
const P_INT:   i32 = 1;   // osc2 interval / detune
const P_MIX:   i32 = 2;   // osc1 <-> osc2 blend
const P_CUT:   i32 = 3;   // ladder cutoff
const P_RES:   i32 = 4;   // ladder resonance
const P_ENVA:  i32 = 5;   // env -> cutoff amount (normalled)
const P_ATK:   i32 = 6;   // attack
const P_DEC:   i32 = 7;   // decay/release
const P_SUS:   i32 = 8;   // sustain
const P_LFO:   i32 = 9;   // lfo rate
const P_GLIDE: i32 = 10;  // portamento
const P_VERB:  i32 = 11;  // spring reverb mix
const P_DRIVE: i32 = 12;  // drive / tone
const P_LEVEL: i32 = 13;  // output level

// ---- modulation matrix routing params (5 sources x 4 dests) ---------
//  index = P_ROUTE + src*4 + dst ; src: 0 LFO 1 Env 2 S&H 3 Noise 4 Osc2
//  dst: 0 Pitch 1 Cutoff 2 PWM 3 Reverb
const P_ROUTE: i32 = 14;   // 14..33 (20 routing amounts)
const NSRC: i32 = 5;
const NDST: i32 = 4;
const NUM_PARAMS: i32 = 34;

// ---- state ----------------------------------------------------------
let sampleRate: f32 = 48000.0;
let ph1: f32 = 0.0;
let ph2: f32 = 0.0;
let lfoPh: f32 = 0.0;
let snhVal: f32 = 0.0;
let snhClk: f32 = 0.0;
let env: f32 = 0.0;
let envSt: i32 = 0;          // 0 idle, 1 atk, 2 dec, 3 sus, 4 rel
let gate: i32 = 0;
let curFreq: f32 = 220.0;
let tgtFreq: f32 = 220.0;
let noteHeld: i32 = -1;
let lastO2: f32 = 0.0;
// ladder filter state (4 one-pole stages)
let z0: f32 = 0.0; let z1: f32 = 0.0; let z2: f32 = 0.0; let z3: f32 = 0.0;
let hbp: f32 = 0.0; let hlp: f32 = 0.0;
// spring reverb: 3 modulated allpass + a short comb, per channel
let apL0: f32 = 0.0; let apL1: f32 = 0.0; let apL2: f32 = 0.0;
let apR0: f32 = 0.0; let apR1: f32 = 0.0; let apR2: f32 = 0.0;
const SPRINGN: i32 = 2400;
const springL: StaticArray<f32> = new StaticArray<f32>(SPRINGN);
const springR: StaticArray<f32> = new StaticArray<f32>(SPRINGN);
let spIdx: i32 = 0;
let rngState: i32 = 0x1a2b3c;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }
@inline function poly(ph: f32): f32 { return ph; }   // placeholder for clarity

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; lfoPh = 0.0; snhVal = 0.0; snhClk = 0.0;
  env = 0.0; envSt = 0; gate = 0; curFreq = 220.0; tgtFreq = 220.0; noteHeld = -1; lastO2 = 0.0;
  z0 = 0.0; z1 = 0.0; z2 = 0.0; z3 = 0.0; hbp = 0.0; hlp = 0.0;
  apL0 = 0.0; apL1 = 0.0; apL2 = 0.0; apR0 = 0.0; apR1 = 0.0; apR2 = 0.0; spIdx = 0;
  for (let i = 0; i < SPRINGN; i++) { springL[i] = 0.0; springR[i] = 0.0; }
  // panel defaults
  params[P_OSC1] = 0.25; params[P_INT] = 0.5; params[P_MIX] = 0.4;
  params[P_CUT] = 0.55; params[P_RES] = 0.35; params[P_ENVA] = 0.6;
  params[P_ATK] = 0.06; params[P_DEC] = 0.45; params[P_SUS] = 0.6;
  params[P_LFO] = 0.35; params[P_GLIDE] = 0.12; params[P_VERB] = 0.3;
  params[P_DRIVE] = 0.4; params[P_LEVEL] = 0.75;
  for (let i = 0; i < NSRC * NDST; i++) params[P_ROUTE + i] = 0.0;
  // normalled default patch: Env->Cutoff (src1,dst1), LFO->PWM (src0,dst2)
  params[P_ROUTE + 1 * NDST + 1] = 0.55;
  params[P_ROUTE + 0 * NDST + 2] = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function noteOn(id: i32, f: f32, v: f32): void {
  tgtFreq = f > 0.0 ? f : 220.0;
  if (noteHeld < 0) curFreq = tgtFreq;   // first note: jump; else glide
  noteHeld = id; gate = 1; envSt = 1;
}
export function noteOff(id: i32): void {
  if (id == noteHeld) { gate = 0; envSt = 4; noteHeld = -1; }
}

@inline function route(src: i32, dst: i32): f32 { return params[P_ROUTE + src * NDST + dst]; }

export function process(n: i32): void {
  const osc1N: f32 = clampf(params[P_OSC1], 0.0, 1.0);
  const intN: f32  = clampf(params[P_INT], 0.0, 1.0);
  const mixN: f32  = clampf(params[P_MIX], 0.0, 1.0);
  const cutN: f32  = clampf(params[P_CUT], 0.0, 1.0);
  const resN: f32  = clampf(params[P_RES], 0.0, 1.0);
  const envAN: f32 = clampf(params[P_ENVA], 0.0, 1.0);
  const atkN: f32  = clampf(params[P_ATK], 0.0, 1.0);
  const decN: f32  = clampf(params[P_DEC], 0.0, 1.0);
  const susN: f32  = clampf(params[P_SUS], 0.0, 1.0);
  const lfoN: f32  = clampf(params[P_LFO], 0.0, 1.0);
  const glideN: f32= clampf(params[P_GLIDE], 0.0, 1.0);
  const verbN: f32 = clampf(params[P_VERB], 0.0, 1.0);
  const driveN: f32= clampf(params[P_DRIVE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // osc2 interval: -12..+12 semis quantised-ish around center
  const semis: f32 = (intN - 0.5) * 24.0;
  const ratio2: f32 = f32(Mathf.pow(2.0, semis / 12.0));
  const sq: f32 = osc1N;                                  // saw(0)->square(1) morph
  const atkInc: f32 = 1.0 / ((0.002 + atkN * atkN * 1.6) * sampleRate);
  const decT: f32 = 0.02 + decN * decN * 2.2;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decT * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / ((0.03 + decN * 1.4) * sampleRate)));
  const lfoHz: f32 = 0.05 * f32(Mathf.pow(240.0, lfoN));  // 0.05..12 Hz
  const lfoInc: f32 = lfoHz / sampleRate;
  const snhRate: f32 = 3.0 + lfoN * 12.0;   // 3..15 Hz stepped random
  const glideCoef: f32 = glideN < 0.001 ? 0.0 : f32(Mathf.exp(-1.0 / ((0.005 + glideN * 0.5) * sampleRate)));
  const baseCut: f32 = 40.0 * f32(Mathf.exp(cutN * 5.6));
  const reso: f32 = resN * 4.2;                           // up to self-oscillation
  const drive: f32 = 0.7 + driveN * 2.4;
  const out: f32 = level * 0.7;
  const springFb: f32 = 0.72;

  for (let i = 0; i < n; i++) {
    // ---- glide ----
    if (glideCoef > 0.0) curFreq = tgtFreq + (curFreq - tgtFreq) * glideCoef;
    else curFreq = tgtFreq;

    // ---- sources ----
    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfo: f32 = f32(Mathf.sin(lfoPh * TAU));
    snhClk += snhRate / sampleRate;
    if (snhClk >= 1.0) { snhClk -= 1.0; snhVal = rnd(); }
    const noise: f32 = rnd();

    // ---- envelope (ADSR) ----
    if (envSt == 1) { env += atkInc; if (env >= 1.0) { env = 1.0; envSt = 2; } }
    else if (envSt == 2) { env = susN + (env - susN) * decCoef; if (env <= susN + 0.001) { env = susN; envSt = 3; } }
    else if (envSt == 3) { env = susN; }
    else if (envSt == 4) { env *= relCoef; if (env < 0.0003) { env = 0.0; envSt = 0; } }

    // ---- destination modulations (full 5x4 matrix; osc2 = last sample) ----
    const pitchMod: f32 = lfo*route(0,0) + env*route(1,0) + snhVal*route(2,0) + noise*route(3,0) + lastO2*route(4,0);
    const cutMod:   f32 = lfo*route(0,1) + env*route(1,1) + snhVal*route(2,1) + noise*route(3,1) + lastO2*route(4,1);
    const pwmMod:   f32 = lfo*route(0,2) + env*route(1,2) + snhVal*route(2,2) + noise*route(3,2) + lastO2*route(4,2);
    const verbMod:  f32 = lfo*route(0,3) + env*route(1,3) + snhVal*route(2,3) + noise*route(3,3) + lastO2*route(4,3);

    // ---- oscillators ----
    const fmod: f32 = f32(Mathf.pow(2.0, pitchMod * 2.0));   // +-2 oct range
    const f1: f32 = curFreq * fmod;
    const f2: f32 = f1 * ratio2;
    ph1 += f1 / sampleRate; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += f2 / sampleRate; if (ph2 >= 1.0) ph2 -= 1.0;
    // pulse width (0.5 default) modulated by PWM dest
    let pw: f32 = 0.5 + pwmMod * 0.45; pw = clampf(pw, 0.05, 0.95);
    const saw1: f32 = ph1 * 2.0 - 1.0;
    const pul1: f32 = ph1 < pw ? 1.0 : -1.0;
    const o1: f32 = saw1 * (1.0 - sq) + pul1 * sq;
    const saw2: f32 = ph2 * 2.0 - 1.0;
    const pul2: f32 = ph2 < 0.5 ? 1.0 : -1.0;
    const o2: f32 = saw2 * (1.0 - sq) + pul2 * sq;
    lastO2 = o2;                                  // osc2 as an audio-rate mod source
    let oscmix: f32 = o1 * (1.0 - mixN) + o2 * mixN;
    oscmix = oscmix * 0.7;

    // ---- ladder filter cutoff (base + env + matrix) ----
    let fc: f32 = baseCut * f32(Mathf.pow(2.0, envAN * env * 3.2 + cutMod * 4.0));
    fc = clampf(fc, 20.0, sampleRate * 0.46);
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const G: f32 = g / (1.0 + g);
    // resonant 4-pole transistor-ladder: feedback around a cascade of
    // tanh-saturated one-pole stages (stable, self-oscillates at high reso).
    const inp: f32 = oscmix * drive;
    let u: f32 = f32(Mathf.tanh((inp - reso * z3) * 0.8));
    z0 = z0 + G * (u - f32(Mathf.tanh(z0)));
    z1 = z1 + G * (f32(Mathf.tanh(z0)) - f32(Mathf.tanh(z1)));
    z2 = z2 + G * (f32(Mathf.tanh(z1)) - f32(Mathf.tanh(z2)));
    z3 = z3 + G * (f32(Mathf.tanh(z2)) - f32(Mathf.tanh(z3)));
    let lpsig: f32 = z3;
    // second filter: resonant HIGH-PASS (dest3 = HP Cut), the MS-style twin
    let hpc: f32 = 25.0 * f32(Mathf.pow(2.0, clampf(verbN + verbMod * 0.6, 0.0, 1.0) * 8.5));
    if (hpc < 20.0) hpc = 20.0; if (hpc > sampleRate * 0.45) hpc = sampleRate * 0.45;
    const g2: f32 = f32(Mathf.tan(3.14159265 * hpc / sampleRate));
    const k2: f32 = 2.0 - resN * 1.7;
    const a2: f32 = 1.0 / (1.0 + g2 * (g2 + k2));
    const hp: f32 = (lpsig - (g2 + k2) * hbp - hlp) * a2;
    const bp2: f32 = g2 * hp + hbp; const lp2: f32 = g2 * bp2 + hlp;
    hbp = bp2; hlp = lp2;
    let filtered: f32 = f32(Mathf.tanh(hp * 1.1));

    let sig: f32 = filtered * env;

    // ---- output ----
    let o: f32 = f32(Mathf.tanh(sig * out * 1.5));
    outBuf[i] = o;
    outBuf[MAX_FRAMES + i] = o;
  }
}
