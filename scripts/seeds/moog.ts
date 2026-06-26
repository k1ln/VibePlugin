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
// ---- effects -------------------------------------------------------
const P_CHO_MIX: i32 = 27;   // chorus
const P_CHO_RATE: i32 = 28;
const P_CHO_DEPTH: i32 = 29;
const P_DLY_MIX: i32 = 30;   // ping-pong delay
const P_DLY_TIME: i32 = 31;
const P_DLY_FB: i32 = 32;
const P_REV_MIX: i32 = 33;   // reverb
const P_REV_SIZE: i32 = 34;
const P_REV_DAMP: i32 = 35;
// ---- arpeggiator (DSP-level, so it follows DAW MIDI + keeps running with the GUI closed) ----
const P_ARP_ON: i32 = 36;    // 0/1
const P_ARP_RATE: i32 = 37;  // 0..1 -> ~2..18 steps/sec
const P_ARP_OCT: i32 = 38;   // 1..4 octave span
const P_ARP_GATE: i32 = 39;  // 0.1..1 note length (fraction of a step)
const P_ARP_MODE: i32 = 40;  // 0 up, 1 down, 2 up-down, 3 random
const NUM_PARAMS: i32 = 41;

let sampleRate: f32 = 44100;

// ---- oscillator state ----------------------------------------------
let ph1: f32 = 0, ph2: f32 = 0, ph3: f32 = 0;
let curFreq: f32 = 220, tgtFreq: f32 = 220;
let noiseState: i32 = 0x1234567;

// ---- ladder filter state (4 cascaded TPT one-pole lowpasses) -------
let s1f: f32 = 0, s2f: f32 = 0, s3f: f32 = 0, s4f: f32 = 0;
let fbk: f32 = 0;   // last stage output, fed back for resonance

// ---- FX: stereo chorus (one modulated mono delay line, 2 LFO phases) ----
const CHORUS_LEN: i32 = 2048;
const choBuf: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
let choW: i32 = 0;
let choPhase: f32 = 0;

// ---- FX: stereo ping-pong delay ------------------------------------
const DELAY_LEN: i32 = 96000;   // ~2 s at 48 kHz
const dlyL: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const dlyR: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
let dlyW: i32 = 0;

// ---- FX: reverb (Schroeder: 4 parallel combs -> 2 series allpass) ----
const RV_C0: i32 = 1900, RV_A0: i32 = 700;
const rc0: StaticArray<f32> = new StaticArray<f32>(RV_C0);
const rc1: StaticArray<f32> = new StaticArray<f32>(RV_C0);
const rc2: StaticArray<f32> = new StaticArray<f32>(RV_C0);
const rc3: StaticArray<f32> = new StaticArray<f32>(RV_C0);
const ra0: StaticArray<f32> = new StaticArray<f32>(RV_A0);
const ra1: StaticArray<f32> = new StaticArray<f32>(RV_A0);
let ci0: i32 = 0, ci1: i32 = 0, ci2: i32 = 0, ci3: i32 = 0, ai0: i32 = 0, ai1: i32 = 0;
let cl0: f32 = 0, cl1: f32 = 0, cl2: f32 = 0, cl3: f32 = 0;   // comb damping lowpass state
let cLen0: i32 = 1557, cLen1: i32 = 1617, cLen2: i32 = 1491, cLen3: i32 = 1422;
let aLen0: i32 = 556, aLen1: i32 = 441;

// ---- envelope state (0 off,1 atk,2 dec,3 sus,4 rel) ----------------
let aStage: i32 = 0, aLevel: f32 = 0;
let fStage: i32 = 0, fLevel: f32 = 0;
let vel: f32 = 1;

// ---- note stack (mono, last-note priority) -------------------------
const stack: StaticArray<i32> = new StaticArray<i32>(16);
const stackHz: StaticArray<f32> = new StaticArray<f32>(16);
let stackN: i32 = 0;

// ---- arpeggiator state ---------------------------------------------
let arpClock: f32 = 0;     // samples until the next step fires
let arpStep: i32 = 0;      // running pattern position
let arpGate: f32 = 0;      // samples left before the current step releases
let arpVoice: i32 = 0;     // 1 while an arp-triggered note is sounding
let arpRand: i32 = 0x2f6e2b1;
const arpSorted: StaticArray<f32> = new StaticArray<f32>(16);   // held freqs, ascending

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr;
  ph1 = 0; ph2 = 0; ph3 = 0; stackN = 0;
  arpClock = 0; arpStep = 0; arpGate = 0; arpVoice = 0;
  aStage = 0; aLevel = 0; fStage = 0; fLevel = 0;
  s1f = 0; s2f = 0; s3f = 0; s4f = 0; fbk = 0;

  // FX state + sample-rate-correct reverb buffer lengths
  choW = 0; choPhase = 0; dlyW = 0;
  ci0 = ci1 = ci2 = ci3 = ai0 = ai1 = 0;
  cl0 = cl1 = cl2 = cl3 = 0;
  const rf: f32 = sr / 44100.0;
  cLen0 = <i32>(1557.0 * rf); cLen1 = <i32>(1617.0 * rf);
  cLen2 = <i32>(1491.0 * rf); cLen3 = <i32>(1422.0 * rf);
  aLen0 = <i32>(556.0 * rf);  aLen1 = <i32>(441.0 * rf);
  if (cLen1 >= RV_C0) cLen1 = RV_C0 - 1;
  if (aLen0 >= RV_A0) aLen0 = RV_A0 - 1;

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
  params[P_CHO_MIX] = 0.35; params[P_CHO_RATE] = 0.3; params[P_CHO_DEPTH] = 0.5;
  params[P_DLY_MIX] = 0.22; params[P_DLY_TIME] = 0.4; params[P_DLY_FB] = 0.4;
  params[P_REV_MIX] = 0.3; params[P_REV_SIZE] = 0.6; params[P_REV_DAMP] = 0.4;
  params[P_ARP_ON] = 1; params[P_ARP_RATE] = 0.5; params[P_ARP_OCT] = 2;
  params[P_ARP_GATE] = 0.5; params[P_ARP_MODE] = 0;
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
  vel = v;
  if (params[P_ARP_ON] > 0.5) return;                     // arp plays the held stack itself
  const wasIdle = aStage == 0 || aStage == 4;
  tgtFreq = f;
  if (wasIdle) { curFreq = f; aStage = 1; fStage = 1; }   // retrigger from idle
}

export function noteOff(id: i32): void {
  let i = 0; for (; i < stackN; i++) if (stack[i] == id) break;
  if (i == stackN) return;
  for (let j = i; j < stackN - 1; j++) { stack[j] = stack[j + 1]; stackHz[j] = stackHz[j + 1]; }
  stackN--;
  if (params[P_ARP_ON] > 0.5) return;                     // arp manages the voice
  if (stackN == 0) { aStage = 4; fStage = 4; }            // release
  else tgtFreq = stackHz[stackN - 1];                     // glide to held note
}

// Pick the arpeggiated note frequency for sequence index `idx` across `octs` octaves:
// the held notes sorted ascending, repeated up by octaves.
function arpNoteFreq(idx: i32, octs: i32): f32 {
  for (let i = 0; i < stackN; i++) {                      // insertion sort held freqs -> arpSorted
    const x = stackHz[i]; let j = i - 1;
    while (j >= 0 && arpSorted[j] > x) { arpSorted[j + 1] = arpSorted[j]; j--; }
    arpSorted[j + 1] = x;
  }
  const within: i32 = idx % stackN;
  const oct: i32 = idx / stackN;
  let f: f32 = arpSorted[within];
  for (let o = 0; o < oct; o++) f *= 2.0;
  return f;
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

// interpolated read from the chorus delay line, `d` samples behind the write head
function choRead(d: f32): f32 {
  let rp: f32 = <f32>choW - d;
  while (rp < 0.0) rp += <f32>CHORUS_LEN;
  const i0: i32 = <i32>rp;
  const frac: f32 = rp - <f32>i0;
  let i1: i32 = i0 + 1; if (i1 >= CHORUS_LEN) i1 -= CHORUS_LEN;
  return choBuf[i0] * (1.0 - frac) + choBuf[i1] * frac;
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

  // FX params (read once per block)
  const choMix: f32 = params[P_CHO_MIX];
  const choInc: f32 = (0.1 + params[P_CHO_RATE] * 5.9) / sampleRate;
  const choBase: f32 = 0.012 * sampleRate;
  const choDepth: f32 = params[P_CHO_DEPTH] * 0.006 * sampleRate;
  const dlyMix: f32 = params[P_DLY_MIX];
  let dlySamp: i32 = <i32>((0.03 + params[P_DLY_TIME] * 0.67) * sampleRate);
  if (dlySamp >= DELAY_LEN) dlySamp = DELAY_LEN - 1;
  const dlyFb: f32 = params[P_DLY_FB] * 0.85;
  const revMix: f32 = params[P_REV_MIX];
  const revFb: f32 = 0.7 + params[P_REV_SIZE] * 0.28;
  const revDamp: f32 = params[P_REV_DAMP] * 0.4;

  const arpOn: bool = params[P_ARP_ON] > 0.5;

  for (let i = 0; i < n; i++) {
    // --- arpeggiator: steps through the held-note stack, retriggering the voice.
    //     Runs in the audio thread, so it follows DAW MIDI and survives a closed GUI.
    if (arpOn) {
      if (stackN == 0) {
        if (arpVoice == 1) { aStage = 4; fStage = 4; arpVoice = 0; }   // no notes held -> release
      } else {
        const stepLen: f32 = sampleRate / (2.0 + params[P_ARP_RATE] * 16.0);   // ~2..18 steps/sec
        if (arpVoice == 1) { arpGate -= 1.0; if (arpGate <= 0.0) { aStage = 4; fStage = 4; arpVoice = 0; } }
        arpClock -= 1.0;
        if (arpClock <= 0.0) {
          arpClock += stepLen;
          let octs: i32 = <i32>(params[P_ARP_OCT] + 0.5); if (octs < 1) octs = 1; if (octs > 4) octs = 4;
          const seqN: i32 = stackN * octs;
          const mode: i32 = <i32>(params[P_ARP_MODE] + 0.5);
          let idx: i32;
          if (mode == 1) {                                    // down
            idx = seqN - 1 - (arpStep % seqN);
          } else if (mode == 2) {                             // up-down (no doubled endpoints)
            const period: i32 = seqN > 1 ? 2 * seqN - 2 : 1;
            const p: i32 = arpStep % period;
            idx = p < seqN ? p : period - p;
          } else if (mode == 3) {                             // random
            arpRand = (arpRand * 1103515245 + 12345) & 0x7fffffff;
            idx = arpRand % seqN;
          } else {                                            // up
            idx = arpStep % seqN;
          }
          arpStep++;
          const nf: f32 = arpNoteFreq(idx, octs);
          tgtFreq = nf; curFreq = nf;                         // jump pitch (no glide between steps)
          aStage = 1; fStage = 1;                             // retrigger both envelopes (pluck)
          arpVoice = 1;
          arpGate = stepLen * (0.1 + params[P_ARP_GATE] * 0.9);
        }
      }
    }

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

    const dry: f32 = fbk * aLevel * vel * vol;

    // --- stereo chorus ---
    choBuf[choW] = dry;
    choPhase += choInc; if (choPhase >= 1.0) choPhase -= 1.0;
    const lfoL: f32 = 0.5 + 0.5 * Mathf.sin(6.2831853 * choPhase);
    const lfoR: f32 = 0.5 + 0.5 * Mathf.sin(6.2831853 * choPhase + 1.5707963);
    const wetCL: f32 = choRead(choBase + choDepth * lfoL);
    const wetCR: f32 = choRead(choBase + choDepth * lfoR);
    choW++; if (choW >= CHORUS_LEN) choW = 0;
    let lch: f32 = dry + (wetCL - dry) * choMix;
    let rch: f32 = dry + (wetCR - dry) * choMix;

    // --- ping-pong delay (cross-fed) ---
    let rp: i32 = dlyW - dlySamp; if (rp < 0) rp += DELAY_LEN;
    const rdL: f32 = dlyL[rp];
    const rdR: f32 = dlyR[rp];
    dlyL[dlyW] = lch + rdR * dlyFb;
    dlyR[dlyW] = rch + rdL * dlyFb;
    dlyW++; if (dlyW >= DELAY_LEN) dlyW = 0;
    lch = lch + (rdL - lch) * dlyMix;
    rch = rch + (rdR - rch) * dlyMix;

    // --- reverb: 4 parallel combs -> 2 series allpass ---
    const rin: f32 = (lch + rch) * 0.5 * 0.015;
    let cout: f32 = 0;
    let rd: f32 = rc0[ci0]; cl0 = rd * (1.0 - revDamp) + cl0 * revDamp; rc0[ci0] = rin + cl0 * revFb; ci0++; if (ci0 >= cLen0) ci0 = 0; cout += rd;
    rd = rc1[ci1];        cl1 = rd * (1.0 - revDamp) + cl1 * revDamp; rc1[ci1] = rin + cl1 * revFb; ci1++; if (ci1 >= cLen1) ci1 = 0; cout += rd;
    rd = rc2[ci2];        cl2 = rd * (1.0 - revDamp) + cl2 * revDamp; rc2[ci2] = rin + cl2 * revFb; ci2++; if (ci2 >= cLen2) ci2 = 0; cout += rd;
    rd = rc3[ci3];        cl3 = rd * (1.0 - revDamp) + cl3 * revDamp; rc3[ci3] = rin + cl3 * revFb; ci3++; if (ci3 >= cLen3) ci3 = 0; cout += rd;
    const ar0: f32 = ra0[ai0]; const ao0: f32 = -cout + ar0; ra0[ai0] = cout + ar0 * 0.5; ai0++; if (ai0 >= aLen0) ai0 = 0;
    const ar1: f32 = ra1[ai1]; const ao1: f32 = -ao0 + ar1; ra1[ai1] = ao0 + ar1 * 0.5; ai1++; if (ai1 >= aLen1) ai1 = 0;
    lch = lch + (ao0 - lch) * revMix;   // slight L/R decorrelation: 1 vs 2 allpass
    rch = rch + (ao1 - rch) * revMix;

    if (lch > 1.5) lch = 1.5; else if (lch < -1.5) lch = -1.5;
    if (rch > 1.5) rch = 1.5; else if (rch < -1.5) rch = -1.5;
    outBuf[i] = lch;
    outBuf[MAX_FRAMES + i] = rch;
  }
}
