// =====================================================================
//  ACID BASS — a monophonic squelch-bass synth modelled control-for-
//  control on the Roland TB-303 Bass Line (Owner's Manual read cover to
//  cover: 96 pp; TONE CONTROL section p.33-34, specifications p.89).
//
//  The 303 is "a small synthesizer control panel" (manual p.34) fronting
//  a step sequencer. Signal path implemented here:
//
//  VCO (p.34 WAVEFORM): ONE oscillator, a WAVEFORM switch picking the two
//    classic 303 waves — sawtooth or square — both polyBLEP band-limited.
//  TUNING (p.33): master tune, +/-500 cents, clockwise raises pitch.
//  VCF (p.34 CUTOFF FREQ / RESONANCE): the signature 18 dB/oct (3-pole)
//    diode-ladder-style resonant low-pass. CUTOFF shaves the upper
//    harmonics; RESONANCE emphasises the cutoff band and, near maximum,
//    pushes the filter toward self-oscillation.
//  ENV MOD (p.34): depth of the envelope sweep into the filter cutoff —
//    "the tone movement of a note", stronger clockwise.
//  DECAY (p.34): the single decay-only envelope's time. Both the volume
//    and the tone take longer to fade clockwise (one EG shapes VCA + VCF).
//  ACCENT (p.34): the accent circuit. On accented steps it boosts the
//    level, adds an extra fast resonant filter sweep and the characteristic
//    accent "wow", and — like the hardware — accumulates across consecutive
//    accents (a short-decay feedback envelope).
//  SLIDE (p.5, p.39): portamento between tied/slid steps — a fixed-time
//    glide, legato (no envelope retrigger) from the previous pitch.
//  SEQUENCER (spec p.89): 16 steps of 16th notes, each carrying pitch,
//    ACCENT, SLIDE and rest, at TEMPO 40-300 BPM. Monophonic. The panel edits
//    the pattern through a single "pattern-write" note channel (see noteOn): the
//    note number carries the step PITCH and a sentinel velocity carries the step
//    index + accent/slide/rest flags, so one click rewrites exactly one step.
//    Playback runs while the PLAY (transport bit0) bit is set.
//  VOLUME (p.8): output level.
//
//  Pure algorithm — no samples, no imports, allocation-free in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_WAVE: i32 = 0;      // 0 sawtooth, 1 square (WAVEFORM switch)
const P_TUNE: i32 = 1;      // -1..1  → +/-500 cents master tune
const P_CUTOFF: i32 = 2;    // 0..1   filter cutoff
const P_RESO: i32 = 3;      // 0..1   filter resonance
const P_ENVMOD: i32 = 4;    // 0..1   envelope → cutoff depth
const P_DECAY: i32 = 5;     // 0..1   envelope decay time
const P_ACCENT: i32 = 6;    // 0..1   accent amount
const P_VOLUME: i32 = 7;    // 0..1   output volume
const P_TEMPO: i32 = 8;     // 40..300 BPM
const P_SLIDE: i32 = 9;     // 0..1   glide time (fixed-time slide)
const P_TRANSPORT: i32 = 10;// bit0 PLAY (RUN), bit1 RECORD (WRITE)

const NUM_PARAMS: i32 = 11;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }
@inline function midiHz(m: f32): f32 { return 440.0 * Mathf.pow(2.0, (m - 69.0) / 12.0); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  else if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

// ---- sequencer state -------------------------------------------------
const SEQ_MAX: i32 = 16;
const seqHz:    StaticArray<f32> = new StaticArray<f32>(SEQ_MAX);
const seqGate:  StaticArray<i32> = new StaticArray<i32>(SEQ_MAX); // 1 note, 0 rest
const seqAcc:   StaticArray<i32> = new StaticArray<i32>(SEQ_MAX);
const seqSlide: StaticArray<i32> = new StaticArray<i32>(SEQ_MAX);
let seqLen: i32 = 0;
let seqPos: i32 = 0;
let clockAcc: f32 = 0.0;
let lastTransport: i32 = 0;

// ---- monophonic voice state ------------------------------------------
let vActive: i32 = 0;
let vGate:   i32 = 0;
let vCur:    f32 = 55.0;   // current pitch Hz (glide follows this)
let vTarget: f32 = 55.0;   // target pitch Hz
let vSliding:i32 = 0;
let mainEnv: f32 = 0.0;    // single decay-only envelope (VCA + VCF)
let mainStage: i32 = 0;    // 0 idle, 1 attack, 2 decay, 3 release
let accEnv:  f32 = 0.0;    // accent feedback envelope
let ph:      f32 = 0.0;    // oscillator phase
let st0: f32 = 0.0; let st1: f32 = 0.0; let st2: f32 = 0.0; // 3-pole ladder states
let liveId: i32 = -1;

// ---- default acid pattern (recognisable auto-play preview) -----------
function setStep(i: i32, midi: f32, gate: i32, acc: i32, slide: i32): void {
  seqHz[i] = midiHz(midi); seqGate[i] = gate; seqAcc[i] = acc; seqSlide[i] = slide;
}
function loadDefaultPattern(): void {
  // A minor acid riff around A1/A2 with accents, slides and rests.
  const A1: f32 = 33.0; const A2: f32 = 45.0; const C3: f32 = 48.0;
  const E3: f32 = 52.0; const G3: f32 = 55.0;
  setStep(0,  A1, 1, 1, 0);
  setStep(1,  A1, 1, 0, 0);
  setStep(2,  A2, 1, 0, 1);   // slide up
  setStep(3,  0.0,0, 0, 0);   // rest
  setStep(4,  A1, 1, 1, 0);   // accent
  setStep(5,  A1, 1, 0, 0);
  setStep(6,  C3, 1, 0, 1);   // slide
  setStep(7,  A1, 1, 0, 0);
  setStep(8,  A1, 1, 1, 0);   // accent
  setStep(9,  E3, 1, 0, 1);   // slide
  setStep(10, A1, 1, 0, 0);
  setStep(11, 0.0,0, 0, 0);   // rest
  setStep(12, A1, 1, 1, 0);   // accent
  setStep(13, G3, 1, 0, 1);   // slide
  setStep(14, A1, 1, 0, 0);
  setStep(15, A2, 1, 0, 0);
  seqLen = 16;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vActive = 0; vGate = 0; vCur = 55.0; vTarget = 55.0; vSliding = 0;
  mainEnv = 0.0; mainStage = 0; accEnv = 0.0; ph = 0.0;
  st0 = 0.0; st1 = 0.0; st2 = 0.0; liveId = -1;
  seqPos = 0; clockAcc = 0.0; lastTransport = 0;
  loadDefaultPattern();

  // boot state = spec.json defaults (host may render before pushing)
  params[P_WAVE] = 0.0; params[P_TUNE] = 0.0; params[P_CUTOFF] = 0.35;
  params[P_RESO] = 0.75; params[P_ENVMOD] = 0.6; params[P_DECAY] = 0.45;
  params[P_ACCENT] = 0.6; params[P_VOLUME] = 0.8; params[P_TEMPO] = 130.0;
  params[P_SLIDE] = 0.3; params[P_TRANSPORT] = 1.0; // PLAY on → auto-play line
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- trigger the mono voice ------------------------------------------
function trigVoice(hz: f32, accent: i32, slide: i32): void {
  vTarget = hz;
  if (slide == 1 && vActive == 1) {
    vSliding = 1;                 // legato glide, keep the envelope running
  } else {
    vCur = hz;                    // jump pitch
    vSliding = 0;
    mainStage = 1;               // retrigger the decay-only envelope
  }
  if (accent == 1) {
    const a: f32 = clampf(pget(P_ACCENT), 0.0, 1.0);
    accEnv = clampf(accEnv + 0.4 + a * 0.9, 0.0, 1.8); // accumulate (accent build-up)
  }
  vActive = 1; vGate = 1;
}

// ---- note events (host / GUI) ----------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  // ---- panel pattern-write channel ------------------------------------------
  // The WebView note bridge can only deliver a MIDI note number (0..127, which the
  // host converts into `hz`) plus a float `vel` — it can pass neither a negative
  // control id nor a raw frequency. So the panel packs each step edit into ONE note
  // event: the note number carries the step's PITCH and a sentinel velocity carries
  // the step index + flags. It is order-independent (every message names its own step
  // index) and transport-agnostic, so a click always rewrites the correct step.
  //   vel = 64 + stepIndex*8 + flags,  flags = accent(bit0) | slide(bit1) | rest(bit2)
  if (vel >= 64.0) {
    const code: i32 = i32(vel - 64.0 + 0.5);
    const idx: i32 = (code >> 3) & (SEQ_MAX - 1);
    const flags: i32 = code & 7;
    seqHz[idx] = hz;
    if ((flags & 4) != 0) { seqGate[idx] = 0; seqAcc[idx] = 0; seqSlide[idx] = 0; }
    else { seqGate[idx] = 1; seqAcc[idx] = flags & 1; seqSlide[idx] = (flags >> 1) & 1; }
    if (idx + 1 > seqLen) seqLen = idx + 1;
    return;
  }

  // ---- live keyboard play (only while the sequencer is stopped) --------------
  const tr: i32 = pbits(P_TRANSPORT);
  if ((tr & 1) == 1 && seqLen > 0) return; // sequencer owns the voice
  if (hz <= 0.0) return;

  const accent: i32 = vel >= 0.85 ? 1 : 0;
  const slide: i32 = (vActive == 1 && vGate == 1) ? 1 : 0; // overlapping keys glide
  trigVoice(hz, accent, slide);
  liveId = id;
}

export function noteOff(id: i32): void {
  const tr: i32 = pbits(P_TRANSPORT);
  if (((tr >> 1) & 1) == 1) return;            // ignore key-up while recording
  if ((tr & 1) == 1 && seqLen > 0) return;     // sequencer owns the voice
  if (id < 0) return;
  if (id == liveId) { vGate = 0; mainStage = 3; }
}

// ---- one sequencer step ----------------------------------------------
function seqAdvance(): void {
  if (seqLen == 0) return;
  if (seqPos >= seqLen) seqPos = 0;
  const s: i32 = seqPos;
  if (seqGate[s] == 0) {
    // rest → release the envelope
    if (mainStage != 0) mainStage = 3;
    vGate = 0;
  } else {
    trigVoice(seqHz[s], seqAcc[s], seqSlide[s]);
  }
  seqPos = s + 1 >= seqLen ? 0 : s + 1;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- transport edges ------------------------------------------------
  const tr: i32 = pbits(P_TRANSPORT);
  const play: i32 = tr & 1;
  const rec: i32 = (tr >> 1) & 1;
  const trWas: i32 = lastTransport;
  // A stopped→PLAY edge restarts the sequence from the top. (Pattern edits arrive on
  //  the separate pattern-write note channel and never disturb the transport.)
  if ((trWas & 1) == 0 && play == 1) { seqPos = 0; clockAcc = 0.0; }
  lastTransport = tr;
  const seqRunning: i32 = (play == 1 && seqLen > 0) ? 1 : 0;

  // ---- per-block parameter mapping ------------------------------------
  const waveSquare: i32 = pget(P_WAVE) >= 0.5 ? 1 : 0;
  const tuneMul: f32 = Mathf.pow(2.0, clampf(pget(P_TUNE), -1.0, 1.0) * (500.0 / 1200.0));

  const cutN: f32 = clampf(pget(P_CUTOFF), 0.0, 1.0);
  const fcBase: f32 = 55.0 * Mathf.pow(2.0, cutN * 7.2);   // ~55 Hz .. ~8 kHz
  const resN: f32 = clampf(pget(P_RESO), 0.0, 1.0);
  const envMod: f32 = clampf(pget(P_ENVMOD), 0.0, 1.0);

  const decN: f32 = clampf(pget(P_DECAY), 0.0, 1.0);
  const decSec: f32 = 0.03 * Mathf.pow(110.0, decN);       // ~30 ms .. ~3.3 s
  const decK: f32 = 1.0 - Mathf.exp(-1.0 / (decSec * sr));
  const atkK: f32 = 1.0 - Mathf.exp(-1.0 / (0.003 * sr));  // ~3 ms attack
  const relK: f32 = 1.0 - Mathf.exp(-1.0 / (0.012 * sr));  // ~12 ms rest-release
  const accDecK: f32 = 1.0 - Mathf.exp(-1.0 / (0.20 * sr)); // ~200 ms accent decay

  const slideSec: f32 = 0.006 + clampf(pget(P_SLIDE), 0.0, 1.0) * 0.24; // 6..246 ms
  const glideK: f32 = 1.0 - Mathf.exp(-1.0 / (slideSec * sr));

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 0.38;

  const bpm: f32 = clampf(pget(P_TEMPO), 40.0, 300.0);
  const stepSamples: f32 = (60.0 / bpm) * 0.25 * sr;       // one 16th note

  for (let f = 0; f < n; f++) {
    // ---- sequencer clock -----------------------------------------------
    if (seqRunning == 1) {
      clockAcc -= 1.0;
      if (clockAcc <= 0.0) { clockAcc += stepSamples; seqAdvance(); }
    }

    // ---- glide (fixed-time portamento) ---------------------------------
    if (vSliding == 1) {
      vCur += (vTarget - vCur) * glideK;
      if (Mathf.abs(vTarget - vCur) < 0.05) { vCur = vTarget; vSliding = 0; }
    }

    // ---- envelope (single decay-only EG) -------------------------------
    if (mainStage == 1) { mainEnv += atkK * (1.06 - mainEnv); if (mainEnv >= 1.0) { mainEnv = 1.0; mainStage = 2; } }
    else if (mainStage == 2) { mainEnv += decK * (0.0 - mainEnv); }
    else if (mainStage == 3) { mainEnv += relK * (0.0 - mainEnv); if (mainEnv <= 0.0006) { mainEnv = 0.0; mainStage = 0; } }
    if (accEnv > 0.0) { accEnv -= accEnv * accDecK; if (accEnv < 0.00005) accEnv = 0.0; }

    if (vActive == 1 && mainStage == 0 && mainEnv <= 0.0006) { vActive = 0; }

    let outAmp: f32 = 0.0;
    if (vActive == 1 || mainEnv > 0.0006) {
      // ---- oscillator (saw or square, polyBLEP) ------------------------
      const hz: f32 = vCur * tuneMul;
      let inc: f32 = hz / sr;
      if (inc > 0.45) inc = 0.45; if (inc < 0.0) inc = 0.0;
      ph += inc; if (ph >= 1.0) ph -= 1.0;
      let sig: f32;
      if (waveSquare == 1) {
        let sq: f32 = ph < 0.5 ? 1.0 : -1.0;
        sq += polyBlep(ph, inc);
        let p2: f32 = ph - 0.5; if (p2 < 0.0) p2 += 1.0;
        sq -= polyBlep(p2, inc);
        sig = sq;
      } else {
        let sw: f32 = 2.0 * ph - 1.0;
        sw -= polyBlep(ph, inc);
        sig = sw;
      }

      // ---- 3-pole (18 dB/oct) diode-ladder resonant LPF ----------------
      const cutOct: f32 = envMod * mainEnv * 4.4 + accEnv * 2.6
                        + Mathf.log2(hz / 110.0) * 0.25;  // mild key tracking
      let fc: f32 = fcBase * Mathf.pow(2.0, cutOct);
      fc = clampf(fc, 20.0, sr * 0.45);
      let g: f32 = 1.0 - Mathf.exp(-TWO_PI * fc / sr);
      if (g > 0.99) g = 0.99;
      const k: f32 = clampf(resN * 3.9 + accEnv * 0.7, 0.0, 4.4); // reso + accent emphasis

      let inp: f32 = sig - k * st2;
      inp = Mathf.tanh(inp);
      st0 += g * (inp - st0);
      st1 += g * (st0 - st1);
      st2 += g * (st1 - st2);
      const filt: f32 = st2 * (1.0 + k * 0.5); // passband makeup

      const levelBoost: f32 = 1.0 + accEnv * 0.9; // accent lifts the level
      outAmp = filt * mainEnv * levelBoost;
    }

    const out: f32 = Mathf.tanh(outAmp * outGain);
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
