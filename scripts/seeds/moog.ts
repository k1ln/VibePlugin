// =====================================================================
//  "Model D" — a Minimoog-style monophonic synth (gallery showpiece).
//
//  Implements the VibePlugin WASM ABI (src/WasmAbi.h) + note exports. Built to
//  show the engine can host a genuinely complex voice in the browser:
//    • 3 anti-aliased oscillators (polyBLEP saw/pulse, naive tri) with per-osc
//      octave + fine detune and a noise source
//    • classic Moog 4-pole resonant ladder filter (Stilson/Smith) with drive
//    • two ADSR envelopes (filter + amplifier)
//    • portamento (glide) and last-note-priority mono with legato
//
//  Host passes note frequency in Hz to noteOn(id, freqHz, vel).
//  Compile:  node compiler/asc-driver.mjs scripts/seeds/moog.ts out.wasm
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// ---- parameter map (must match the GUI indices) --------------------
const P_TUNE: i32 = 0;       // master tune, semitones -12..+12
const P_GLIDE: i32 = 1;      // 0..1 portamento amount
const P_O1_WAVE: i32 = 2;    // 0 tri,1 saw,2 square,3 pulse
const P_O1_OCT: i32 = 3;     // -2..+2 octaves
const P_O2_WAVE: i32 = 4;
const P_O2_OCT: i32 = 5;
const P_O2_DET: i32 = 6;     // detune, cents -50..+50
const P_O3_WAVE: i32 = 7;
const P_O3_OCT: i32 = 8;
const P_O3_DET: i32 = 9;
const P_MIX1: i32 = 10;      // 0..1
const P_MIX2: i32 = 11;
const P_MIX3: i32 = 12;
const P_NOISE: i32 = 13;
const P_CUTOFF: i32 = 14;    // 0..1 (exp to Hz)
const P_RESO: i32 = 15;      // 0..1
const P_FENV: i32 = 16;      // filter env amount 0..1
const P_FA: i32 = 17;        // filter ADSR
const P_FD: i32 = 18;
const P_FS: i32 = 19;
const P_FR: i32 = 20;
const P_AA: i32 = 21;        // amp ADSR
const P_AD: i32 = 22;
const P_AS: i32 = 23;
const P_AR: i32 = 24;
const P_DRIVE: i32 = 25;     // 0..1 pre-filter saturation
const P_VOL: i32 = 26;       // 0..1
const NUM_PARAMS: i32 = 27;

let sampleRate: f32 = 44100;

// ---- oscillator state ----------------------------------------------
let ph1: f32 = 0, ph2: f32 = 0, ph3: f32 = 0;
let curFreq: f32 = 220, tgtFreq: f32 = 220;
let noiseState: i32 = 0x1234567;

// ---- ladder filter state (4 cascaded TPT one-pole lowpasses) -------
let s1f: f32 = 0, s2f: f32 = 0, s3f: f32 = 0, s4f: f32 = 0;
let fbk: f32 = 0;   // last stage output, fed back for resonance

// ---- envelope state (0 off,1 atk,2 dec,3 sus,4 rel) ----------------
let aStage: i32 = 0, aLevel: f32 = 0;
let fStage: i32 = 0, fLevel: f32 = 0;
let vel: f32 = 1;

// ---- note stack (mono, last-note priority) -------------------------
const stack: StaticArray<i32> = new StaticArray<i32>(16);
const stackHz: StaticArray<f32> = new StaticArray<f32>(16);
let stackN: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr;
  ph1 = 0; ph2 = 0; ph3 = 0; stackN = 0;
  aStage = 0; aLevel = 0; fStage = 0; fLevel = 0;
  s1f = 0; s2f = 0; s3f = 0; s4f = 0; fbk = 0;

  params[P_TUNE] = 0;
  params[P_GLIDE] = 0.05;
  params[P_O1_WAVE] = 1; params[P_O1_OCT] = 0;
  params[P_O2_WAVE] = 1; params[P_O2_OCT] = 0; params[P_O2_DET] = 7;
  params[P_O3_WAVE] = 2; params[P_O3_OCT] = -1; params[P_O3_DET] = -5;
  params[P_MIX1] = 0.9; params[P_MIX2] = 0.7; params[P_MIX3] = 0.5; params[P_NOISE] = 0.06;
  params[P_CUTOFF] = 0.42; params[P_RESO] = 0.55; params[P_FENV] = 0.6;
  params[P_FA] = 0.04; params[P_FD] = 0.5; params[P_FS] = 0.25; params[P_FR] = 0.4;
  params[P_AA] = 0.02; params[P_AD] = 0.4; params[P_AS] = 0.8; params[P_AR] = 0.35;
  params[P_DRIVE] = 0.3; params[P_VOL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function noteOn(id: i32, f: f32, v: f32): void {
  // push onto the stack (replace if already present)
  let i = 0; for (; i < stackN; i++) if (stack[i] == id) break;
  if (i == stackN && stackN < 16) stackN++;
  stack[i] = id; stackHz[i] = f;
  const wasIdle = aStage == 0 || aStage == 4;
  tgtFreq = f; vel = v;
  if (wasIdle) { curFreq = f; aStage = 1; fStage = 1; }   // retrigger from idle
}

export function noteOff(id: i32): void {
  let i = 0; for (; i < stackN; i++) if (stack[i] == id) break;
  if (i == stackN) return;
  for (let j = i; j < stackN - 1; j++) { stack[j] = stack[j + 1]; stackHz[j] = stackHz[j + 1]; }
  stackN--;
  if (stackN == 0) { aStage = 4; fStage = 4; }            // release
  else tgtFreq = stackHz[stackN - 1];                     // glide to held note
}

// ---- helpers -------------------------------------------------------
// anti-aliasing residual for saw/pulse discontinuities
function blep(t: f32, dt: f32): f32 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}
function osc(wave: i32, ph: f32, dt: f32): f32 {
  if (wave == 0) {                                   // triangle (naive — low aliasing)
    return 4.0 * Mathf.abs(ph - 0.5) - 1.0;
  } else if (wave == 1) {                            // saw (polyBLEP)
    return (2.0 * ph - 1.0) - blep(ph, dt);
  } else {                                           // square / pulse (polyBLEP)
    const pw: f32 = wave == 3 ? 0.25 : 0.5;
    let s: f32 = ph < pw ? 1.0 : -1.0;
    s += blep(ph, dt);
    let t2 = ph - pw; if (t2 < 0.0) t2 += 1.0;
    s -= blep(t2, dt);
    return s;
  }
}
function adsr(stage: i32, level: f32, a: f32, d: f32, s: f32, r: f32, sr: f32): f32 {
  // times: ~2 ms .. ~4 s, exponential feel
  const ta = 0.002 + a * a * 3.0, td = 0.002 + d * d * 3.0, tr = 0.002 + r * r * 4.0;
  if (stage == 1) {                                  // attack
    level += <f32>(1.0 / (ta * sr));
    if (level >= 1.0) { level = 1.0; }
  } else if (stage == 2) {                           // decay
    level += <f32>((s - level) * (1.0 / (td * sr)) * 4.0);
  } else if (stage == 4) {                           // release
    level += <f32>((0.0 - level) * (1.0 / (tr * sr)) * 4.0);
  }
  return level;
}

export function process(n: i32): void {
  const tuneRatio: f32 = Mathf.pow(2.0, params[P_TUNE] / 12.0);
  const o1r: f32 = Mathf.pow(2.0, params[P_O1_OCT]);
  const o2r: f32 = Mathf.pow(2.0, params[P_O2_OCT] + params[P_O2_DET] / 1200.0);
  const o3r: f32 = Mathf.pow(2.0, params[P_O3_OCT] + params[P_O3_DET] / 1200.0);
  const w1 = <i32>params[P_O1_WAVE], w2 = <i32>params[P_O2_WAVE], w3 = <i32>params[P_O3_WAVE];
  const m1 = params[P_MIX1], m2 = params[P_MIX2], m3 = params[P_MIX3], mn = params[P_NOISE];
  const drive: f32 = 1.0 + params[P_DRIVE] * 6.0;
  const vol: f32 = params[P_VOL];
  const fenv: f32 = params[P_FENV];
  const reso: f32 = params[P_RESO] * 4.0;

  // glide coefficient
  const glideT: f32 = params[P_GLIDE] * params[P_GLIDE] * 0.6;
  const glide: f32 = glideT < 0.0005 ? 1.0 : 1.0 - Mathf.exp(-1.0 / (glideT * sampleRate));

  for (let i = 0; i < n; i++) {
    // pitch glide
    curFreq += (tgtFreq - curFreq) * glide;
    const base: f32 = curFreq * tuneRatio;

    // envelopes + stage transitions
    aLevel = adsr(aStage, aLevel, params[P_AA], params[P_AD], params[P_AS], params[P_AR], sampleRate);
    fLevel = adsr(fStage, fLevel, params[P_FA], params[P_FD], params[P_FS], params[P_FR], sampleRate);
    if (aStage == 1 && aLevel >= 1.0) aStage = 2;
    if (aStage == 2 && Mathf.abs(aLevel - params[P_AS]) < 0.001) aStage = 3;
    if (fStage == 1 && fLevel >= 1.0) fStage = 2;
    if (fStage == 2 && Mathf.abs(fLevel - params[P_FS]) < 0.001) fStage = 3;
    if (aStage == 4 && aLevel < 0.0005) { aStage = 0; aLevel = 0; }

    // oscillators
    const f1hz = base * o1r, f2hz = base * o2r, f3hz = base * o3r;
    const d1 = f1hz / sampleRate, d2 = f2hz / sampleRate, d3 = f3hz / sampleRate;
    ph1 += d1; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += d2; if (ph2 >= 1.0) ph2 -= 1.0;
    ph3 += d3; if (ph3 >= 1.0) ph3 -= 1.0;
    noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff;
    const noise: f32 = (<f32>noiseState / <f32>0x3fffffff) - 1.0;

    let sig: f32 = osc(w1, ph1, d1) * m1 + osc(w2, ph2, d2) * m2
                 + osc(w3, ph3, d3) * m3 + noise * mn;
    sig *= 0.35;

    // pre-filter drive (soft saturation)
    sig = Mathf.tanh(sig * drive);

    // cutoff from env: exponential 20 Hz .. ~14 kHz
    let cut: f32 = params[P_CUTOFF] + fenv * fLevel;
    if (cut > 1.0) cut = 1.0; if (cut < 0.0) cut = 0.0;
    let fcHz: f32 = 20.0 * Mathf.pow(700.0, cut);
    const fcMax: f32 = sampleRate * 0.45;
    if (fcHz > fcMax) fcHz = fcMax;

    // Moog ladder via 4 cascaded TPT one-pole lowpasses (stable, self-oscillates)
    const g: f32 = Mathf.tan(PI * fcHz / sampleRate);
    const G: f32 = g / (1.0 + g);
    const x0: f32 = Mathf.tanh(sig - reso * fbk);    // resonance feedback, soft-limited
    let v: f32; let y: f32;
    v = (x0 - s1f) * G; y = v + s1f; s1f = y + v; const a1 = y;
    v = (a1 - s2f) * G; y = v + s2f; s2f = y + v; const a2 = y;
    v = (a2 - s3f) * G; y = v + s3f; s3f = y + v; const a3 = y;
    v = (a3 - s4f) * G; y = v + s4f; s4f = y + v; fbk = y;

    const out: f32 = fbk * aLevel * vel * vol;
    outBuf[i] = out;
    outBuf[MAX_FRAMES + i] = out;
  }
}
