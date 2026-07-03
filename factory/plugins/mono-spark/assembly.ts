// =====================================================================
//  MONO SPARK — a monophonic analog synthesizer modelled control-for-
//  control on the Roland SH-101 (Owner's Manual read cover to cover:
//  56 pp; VCO p.24, waveforms/PWM p.25, Source Mixer/VCF p.26, VCF/VCA
//  p.27, ENV p.28-29, Modulator/Keyboard p.30, Controllers p.31,
//  Arpeggio p.32, Sequencer p.33-35, Hold/Key Transpose p.36,
//  block diagram p.55, specifications p.56).
//
//  Signal path (p.55 block diagram):
//   VCO (p.24): ONE oscillator. RANGE 16'/8'/4'/2' (octave select).
//     SAW and PULSE are produced simultaneously (polyBLEP band-limited)
//     and mixed in the SOURCE MIXER. PWM MODE (MAN/LFO/ENV): MAN = PW
//     fader sets a static width (50%..min); LFO/ENV = the fader sets
//     the depth of pulse-width modulation by the LFO or the envelope.
//     VCO MOD fader = depth of LFO -> pitch (vibrato / trill).
//   SOURCE MIXER (p.26): SAW, PULSE, SUB and NOISE level faders. SUB
//     OSCILLATOR (pulse wave) with a 3-way type switch: 1 oct down
//     square / 2 oct down square / 2 oct down narrow pulse.
//   VCF (p.26-27): 4-pole (24 dB/oct) resonant low-pass. FREQ cutoff,
//     RES resonance (self-oscillates at max), ENV depth, MOD (LFO)
//     depth, KYBD key-follow (0..100%).
//   VCA (p.27): controlled by the ENV or by the plain GATE (source sw).
//   ENV (p.28): single ADSR. A 1.5 ms-4 s, D/R 2 ms-10 s, S 0-100%.
//     GATE-TRIG selector: GATE+TRIG (always retrigger) / GATE (retrigger
//     only when not legato) / LFO (envelope repeats at the LFO rate).
//   MODULATOR (p.30): LFO + S&H, 0.1-30 Hz, waveforms triangle / square
//     / random (S&H) / noise; routes to VCO pitch and VCF.
//   Controllers (p.31): VOLUME, PORTAMENTO time + OFF/ON/AUTO mode,
//     TRANSPOSE L/M/H (+/-1 oct), VCO & VCF BEND SENS, LFO-MOD depth
//     (mod-grip push), BENDER lever. TUNE +/-50 cents (master).
//   Arpeggio (p.32): auto-arpeggio UP / U&D / DOWN of the held notes.
//   Sequencer (p.33-35): built-in step sequencer, records via note
//     events (rest / legato-tie), plays back stepwise; disables the arp.
//   Hold (p.36): latches the held note (sounds at the sustain level).
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
const P_TUNE: i32 = 0;       // -1..1  +/-50 cents master tune
const P_RANGE: i32 = 1;      // 0..3   16'/8'/4'/2'
const P_VCOMOD: i32 = 2;     // 0..1   LFO -> pitch depth
const P_PWMMODE: i32 = 3;    // 0 MAN, 1 LFO, 2 ENV
const P_PW: i32 = 4;         // 0..1   pulse width / PWM depth
const P_MIXSAW: i32 = 5;
const P_MIXPULSE: i32 = 6;
const P_MIXSUB: i32 = 7;
const P_SUBTYPE: i32 = 8;    // 0 1oct sq, 1 2oct sq, 2 2oct narrow
const P_MIXNOISE: i32 = 9;
const P_VCFFREQ: i32 = 10;
const P_VCFRES: i32 = 11;
const P_VCFENV: i32 = 12;
const P_VCFMOD: i32 = 13;    // LFO -> cutoff depth
const P_VCFKYBD: i32 = 14;
const P_VCASRC: i32 = 15;    // 0 ENV, 1 GATE
const P_ENVA: i32 = 16;
const P_ENVD: i32 = 17;
const P_ENVS: i32 = 18;
const P_ENVR: i32 = 19;
const P_ENVMODE: i32 = 20;   // 0 GATE+TRIG, 1 GATE, 2 LFO
const P_LFORATE: i32 = 21;
const P_LFOWAVE: i32 = 22;   // 0 tri, 1 square, 2 random, 3 noise
const P_VOLUME: i32 = 23;
const P_PORTATIME: i32 = 24;
const P_PORTAMODE: i32 = 25; // 0 OFF, 1 ON, 2 AUTO
const P_TRANSPOSE: i32 = 26; // 0 L(-1oct), 1 M, 2 H(+1oct)
const P_VCOBEND: i32 = 27;   // bender -> pitch sens (max +/-1 oct)
const P_VCFBEND: i32 = 28;   // bender -> cutoff sens
const P_LFOMOD: i32 = 29;    // grip-push LFO depth
const P_BENDER: i32 = 30;    // -1..1 bender lever
const P_TEMPO: i32 = 31;     // 40..300 BPM (arp / seq)
const P_ARPMODE: i32 = 32;   // 0 up, 1 u&d, 2 down
const P_MODPUSH: i32 = 33;   // 0..1 mod-grip push amount
const P_TRANSPORT: i32 = 34; // bit0 arp, bit1 seq play, bit2 seq rec, bit3 hold

const NUM_PARAMS: i32 = 35;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 { // -1..1 white noise
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
const SEQ_MAX: i32 = 64;
const seqHz:    StaticArray<f32> = new StaticArray<f32>(SEQ_MAX);
const seqGate:  StaticArray<i32> = new StaticArray<i32>(SEQ_MAX); // 1 note, 0 rest
const seqTie:   StaticArray<i32> = new StaticArray<i32>(SEQ_MAX); // 1 legato/slur
let seqLen: i32 = 0;
let seqPos: i32 = 0;
let clockAcc: f32 = 0.0;
let lastTransport: i32 = 0;

// ---- held-note pool (for the arpeggiator) ----------------------------
const HELD_MAX: i32 = 8;
const heldHz: StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const heldId: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let heldCount: i32 = 0;
let arpPos: i32 = 0;
let arpDir: i32 = 1; // for up&down

// arp pool (distinct pitches, sorted ascending) rebuilt each step
const arpHz: StaticArray<f32> = new StaticArray<f32>(SEQ_MAX);
let arpLen: i32 = 0;

// ---- monophonic voice state ------------------------------------------
let vActive: i32 = 0;
let vGate:   i32 = 0;
let vCur:    f32 = 110.0;   // current pitch Hz (glide follows this)
let vTarget: f32 = 110.0;   // target pitch Hz
let vLegato: i32 = 0;       // this note slurs from previous (no retrigger)
let env: f32 = 0.0;
let envStage: i32 = 0;      // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
let gateSmooth: f32 = 0.0;  // smoothed gate for GATE-mode VCA
let ph:  f32 = 0.0;         // main oscillator phase
let subPh: f32 = 0.0;       // sub oscillator phase
let lfoPh: f32 = 0.0;       // LFO phase
let lfoSH: f32 = 0.0;       // sample&hold value
let lfoEnvPh: f32 = 0.0;    // env-in-LFO-mode phase tracker
let lp0: f32 = 0.0; let lp1: f32 = 0.0; let lp2: f32 = 0.0; let lp3: f32 = 0.0; // ladder
let liveId: i32 = -1;

// ---- default pattern (a recognisable SH-101 bass line, auto-plays) ---
function midiHz(m: f32): f32 { return 440.0 * Mathf.pow(2.0, (m - 69.0) / 12.0); }
function setStep(i: i32, midi: f32, gate: i32, tie: i32): void {
  seqHz[i] = midiHz(midi); seqGate[i] = gate; seqTie[i] = tie;
}
function loadDefaultPattern(): void {
  // A minor riff around A1/A2 with an octave jump, a tie and rests.
  const A1: f32 = 33.0; const A2: f32 = 45.0; const C3: f32 = 48.0;
  const E2: f32 = 40.0; const G2: f32 = 43.0;
  setStep(0,  A1, 1, 0);
  setStep(1,  A1, 1, 0);
  setStep(2,  A2, 1, 1);   // tie/slur up (glide)
  setStep(3,  0.0,0, 0);   // rest
  setStep(4,  A1, 1, 0);
  setStep(5,  C3, 1, 0);
  setStep(6,  A1, 1, 0);
  setStep(7,  0.0,0, 0);   // rest
  setStep(8,  E2, 1, 0);
  setStep(9,  A1, 1, 0);
  setStep(10, G2, 1, 0);
  setStep(11, A1, 1, 0);
  setStep(12, A2, 1, 1);   // tie/slur up
  setStep(13, A1, 1, 0);
  setStep(14, C3, 1, 0);
  setStep(15, A1, 1, 0);
  seqLen = 16;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vActive = 0; vGate = 0; vCur = 110.0; vTarget = 110.0; vLegato = 0;
  env = 0.0; envStage = 0; gateSmooth = 0.0;
  ph = 0.0; subPh = 0.0; lfoPh = 0.0; lfoSH = 0.0; lfoEnvPh = 0.0;
  lp0 = 0.0; lp1 = 0.0; lp2 = 0.0; lp3 = 0.0; liveId = -1;
  seqPos = 0; clockAcc = 0.0; lastTransport = 0;
  heldCount = 0; arpPos = 0; arpDir = 1; arpLen = 0;
  loadDefaultPattern();

  // boot state = spec.json defaults (host may render before pushing)
  params[P_TUNE] = 0.0; params[P_RANGE] = 1.0; params[P_VCOMOD] = 0.0;
  params[P_PWMMODE] = 0.0; params[P_PW] = 0.5;
  params[P_MIXSAW] = 0.85; params[P_MIXPULSE] = 0.0; params[P_MIXSUB] = 0.6;
  params[P_SUBTYPE] = 0.0; params[P_MIXNOISE] = 0.0;
  params[P_VCFFREQ] = 0.35; params[P_VCFRES] = 0.35; params[P_VCFENV] = 0.6;
  params[P_VCFMOD] = 0.0; params[P_VCFKYBD] = 0.5;
  params[P_VCASRC] = 0.0;
  params[P_ENVA] = 0.02; params[P_ENVD] = 0.4; params[P_ENVS] = 0.12; params[P_ENVR] = 0.15;
  params[P_ENVMODE] = 0.0;
  params[P_LFORATE] = 0.3; params[P_LFOWAVE] = 0.0;
  params[P_VOLUME] = 0.75;
  params[P_PORTATIME] = 0.2; params[P_PORTAMODE] = 0.0; params[P_TRANSPOSE] = 1.0;
  params[P_VCOBEND] = 0.17; params[P_VCFBEND] = 0.0; params[P_LFOMOD] = 0.3;
  params[P_BENDER] = 0.0;
  params[P_TEMPO] = 130.0; params[P_ARPMODE] = 0.0; params[P_MODPUSH] = 0.0;
  params[P_TRANSPORT] = 2.0; // seq PLAY on -> auto-play the default line
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- trigger the mono voice ------------------------------------------
function trigVoice(hz: f32, legato: i32): void {
  vTarget = hz;
  const portaMode: i32 = pbits(P_PORTAMODE); // 0 OFF, 1 ON, 2 AUTO
  let glide: i32 = 0;
  if (portaMode == 1) glide = 1;
  else if (portaMode == 2 && legato == 1) glide = 1; // AUTO = legato only
  if (glide == 0) vCur = hz;
  vLegato = legato;
  // retrigger the envelope unless this is a legato/slur note
  const envMode: i32 = pbits(P_ENVMODE);
  if (legato == 0 || envMode == 0) { // GATE+TRIG always retriggers
    if (legato == 0) envStage = 1;
  }
  vActive = 1; vGate = 1;
}

function releaseVoice(): void {
  vGate = 0;
  if (envStage != 0) envStage = 4;
}

// ---- note events (host / GUI) ----------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  const tr: i32 = pbits(P_TRANSPORT);
  const arp: i32 = tr & 1;
  const play: i32 = (tr >> 1) & 1;
  const rec: i32 = (tr >> 2) & 1;

  if (rec == 1) {
    // recording: id -4 clear; id -2 rest; hz>0 note (id==1 => legato/tie)
    if (id == -4) { seqLen = 0; seqPos = 0; return; }
    if (id == -2) {
      if (seqLen < SEQ_MAX) { seqGate[seqLen] = 0; seqTie[seqLen] = 0; seqHz[seqLen] = 110.0; seqLen++; }
      return;
    }
    if (hz <= 0.0) return;
    if (seqLen < SEQ_MAX) {
      seqGate[seqLen] = 1; seqHz[seqLen] = hz; seqTie[seqLen] = (id == 1) ? 1 : 0; seqLen++;
    }
    return;
  }

  if (hz <= 0.0) return;

  // track held notes (used by the arpeggiator)
  if (heldCount < HELD_MAX) {
    // insert keeping ascending order
    let k: i32 = heldCount;
    while (k > 0 && heldHz[k - 1] > hz) { heldHz[k] = heldHz[k - 1]; heldId[k] = heldId[k - 1]; k--; }
    heldHz[k] = hz; heldId[k] = id; heldCount++;
  }

  if (play == 1 && seqLen > 0) return; // sequencer owns the voice
  if (arp == 1) return;                // arpeggiator drives the voice in process()

  // plain live play: legato if a key was already down
  const legato: i32 = (vActive == 1 && vGate == 1) ? 1 : 0;
  trigVoice(hz, legato);
  liveId = id;
}

export function noteOff(id: i32): void {
  const tr: i32 = pbits(P_TRANSPORT);
  const hold: i32 = (tr >> 3) & 1;

  // remove from held pool
  let idx: i32 = -1;
  for (let i = 0; i < heldCount; i++) { if (heldId[i] == id) { idx = i; break; } }
  if (idx >= 0) { for (let i = idx; i < heldCount - 1; i++) { heldHz[i] = heldHz[i + 1]; heldId[i] = heldId[i + 1]; } heldCount--; }

  if (((tr >> 2) & 1) == 1) return;        // ignore key-up while recording
  if (hold == 1) return;                   // HOLD latches the sound
  if ((tr & 1) == 1) {                     // arp: release when no keys remain
    if (heldCount == 0) releaseVoice();
    return;
  }
  if ((tr >> 1) & 1) { if (seqLen > 0) return; } // sequencer owns the voice
  if (id < 0) return;
  if (id == liveId) releaseVoice();
}

// ---- build the ascending arp pool ------------------------------------
function buildArpPool(): void {
  // With a stored pattern loaded, the ARP button arpeggiates the pattern's
  // distinct pitches (up/u&d/down); with no pattern it arpeggiates the keys
  // you hold. (Deviation: the SH-101 always arpeggiates held keys — here a
  // loaded sequence takes priority so the auto-arpeggio has notes to play.)
  arpLen = 0;
  if (seqLen == 0) {
    for (let i = 0; i < heldCount; i++) { arpHz[arpLen] = heldHz[i]; arpLen++; }
  } else {
    for (let i = 0; i < seqLen; i++) {
      if (seqGate[i] == 0) continue;
      const h: f32 = seqHz[i];
      let dup: i32 = 0;
      for (let j = 0; j < arpLen; j++) { if (Mathf.abs(arpHz[j] - h) < 0.5) { dup = 1; break; } }
      if (dup == 0) {
        // insert ascending
        let k: i32 = arpLen;
        while (k > 0 && arpHz[k - 1] > h) { arpHz[k] = arpHz[k - 1]; k--; }
        arpHz[k] = h; arpLen++;
      }
    }
  }
}

// ---- one arpeggiator step --------------------------------------------
function arpAdvance(): void {
  buildArpPool();
  if (arpLen == 0) { releaseVoice(); return; }
  const mode: i32 = pbits(P_ARPMODE); // 0 up, 1 u&d, 2 down
  if (arpPos >= arpLen) arpPos = arpLen - 1;
  let idx: i32 = arpPos;
  if (mode == 2) idx = arpLen - 1 - arpPos; // down
  trigVoice(arpHz[idx], 0);
  // advance
  if (mode == 1) { // up & down
    arpPos += arpDir;
    if (arpPos >= arpLen - 1) { arpPos = arpLen - 1; arpDir = -1; if (arpLen == 1) arpDir = 1; }
    else if (arpPos <= 0) { arpPos = 0; arpDir = 1; }
  } else {
    arpPos++;
    if (arpPos >= arpLen) arpPos = 0;
  }
}

// ---- one sequencer step ----------------------------------------------
function seqAdvance(): void {
  if (seqLen == 0) return;
  if (seqPos >= seqLen) seqPos = 0;
  const s: i32 = seqPos;
  if (seqGate[s] == 0) { releaseVoice(); }
  else { trigVoice(seqHz[s], seqTie[s]); }
  seqPos = s + 1 >= seqLen ? 0 : s + 1;
}

// ---- LFO (bipolar -1..1) ---------------------------------------------
@inline function lfoValue(wave: i32, phase: f32): f32 {
  if (wave == 0) { // triangle
    return phase < 0.5 ? (phase * 4.0 - 1.0) : (3.0 - phase * 4.0);
  } else if (wave == 1) { // square
    return phase < 0.5 ? 1.0 : -1.0;
  } else if (wave == 2) { // random (sample & hold) — held value updated on wrap
    return lfoSH;
  }
  return rngf(); // noise
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- transport edges ------------------------------------------------
  const tr: i32 = pbits(P_TRANSPORT);
  const arpOn: i32 = tr & 1;
  const play: i32 = (tr >> 1) & 1;
  const rec: i32 = (tr >> 2) & 1;
  const trWas: i32 = lastTransport;
  if (((trWas >> 1) & 1) == 0 && play == 1) { seqPos = 0; clockAcc = 0.0; }
  if ((trWas & 1) == 0 && arpOn == 1) { arpPos = 0; arpDir = 1; clockAcc = 0.0; }
  lastTransport = tr;
  const seqRunning: i32 = (play == 1 && rec == 0 && seqLen > 0) ? 1 : 0;
  const arpRunning: i32 = (arpOn == 1 && rec == 0 && seqRunning == 0) ? 1 : 0;

  // ---- per-block parameter mapping ------------------------------------
  const tuneMul: f32 = Mathf.pow(2.0, clampf(pget(P_TUNE), -1.0, 1.0) * (50.0 / 1200.0));
  const rangeSel: i32 = pbits(P_RANGE);            // 0=16',1=8',2=4',3=2'
  const rangeMul: f32 = Mathf.pow(2.0, f32(rangeSel) - 1.0); // 16'=0.5 .. 2'=4
  const transSel: i32 = pbits(P_TRANSPOSE);        // 0 down,1 mid,2 up
  // transpose switch is disabled while the sequencer plays (manual p.31)
  const transMul: f32 = seqRunning == 1 ? 1.0 : Mathf.pow(2.0, f32(transSel - 1));

  const vcoModDepth: f32 = clampf(pget(P_VCOMOD), 0.0, 1.0);
  const pwmMode: i32 = pbits(P_PWMMODE);           // 0 MAN,1 LFO,2 ENV
  const pwN: f32 = clampf(pget(P_PW), 0.0, 1.0);

  const mixSaw: f32 = clampf(pget(P_MIXSAW), 0.0, 1.0);
  const mixPulse: f32 = clampf(pget(P_MIXPULSE), 0.0, 1.0);
  const mixSub: f32 = clampf(pget(P_MIXSUB), 0.0, 1.0);
  const subType: i32 = pbits(P_SUBTYPE);
  const mixNoise: f32 = clampf(pget(P_MIXNOISE), 0.0, 1.0);

  const cutN: f32 = clampf(pget(P_VCFFREQ), 0.0, 1.0);
  const fcBase: f32 = 10.0 * Mathf.pow(2000.0, cutN);   // 10 Hz .. 20 kHz
  const resN: f32 = clampf(pget(P_VCFRES), 0.0, 1.0);
  const kRes: f32 = resN * 4.2;                          // up to self-oscillation
  const vcfEnvAmt: f32 = clampf(pget(P_VCFENV), 0.0, 1.0);
  const vcfModAmt: f32 = clampf(pget(P_VCFMOD), 0.0, 1.0);
  const vcfKybd: f32 = clampf(pget(P_VCFKYBD), 0.0, 1.0);

  const vcaSrc: i32 = pbits(P_VCASRC);                   // 0 ENV, 1 GATE

  const aN: f32 = clampf(pget(P_ENVA), 0.0, 1.0);
  const dN: f32 = clampf(pget(P_ENVD), 0.0, 1.0);
  const sN: f32 = clampf(pget(P_ENVS), 0.0, 1.0);
  const rN: f32 = clampf(pget(P_ENVR), 0.0, 1.0);
  const atkSec: f32 = 0.0015 * Mathf.pow(2666.0, aN);    // 1.5 ms .. 4 s
  const decSec: f32 = 0.002 * Mathf.pow(5000.0, dN);     // 2 ms .. 10 s
  const relSec: f32 = 0.002 * Mathf.pow(5000.0, rN);     // 2 ms .. 10 s
  const atkK: f32 = 1.0 - Mathf.exp(-1.0 / (atkSec * sr));
  const decK: f32 = 1.0 - Mathf.exp(-1.0 / (decSec * sr));
  const relK: f32 = 1.0 - Mathf.exp(-1.0 / (relSec * sr));
  const envMode: i32 = pbits(P_ENVMODE);                 // 0 GATE+TRIG,1 GATE,2 LFO

  const lfoRateN: f32 = clampf(pget(P_LFORATE), 0.0, 1.0);
  const lfoHz: f32 = 0.1 * Mathf.pow(300.0, lfoRateN);   // 0.1 .. 30 Hz
  const lfoInc: f32 = lfoHz / sr;
  const lfoWave: i32 = pbits(P_LFOWAVE);

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 0.7;

  const portaN: f32 = clampf(pget(P_PORTATIME), 0.0, 1.0);
  const portaSec: f32 = 0.002 + portaN * 5.0;            // up to ~5 s
  const glideK: f32 = 1.0 - Mathf.exp(-1.0 / (portaSec * sr));

  const bender: f32 = clampf(pget(P_BENDER), -1.0, 1.0);
  const vcoBend: f32 = clampf(pget(P_VCOBEND), 0.0, 1.0);   // max +/-1 oct
  const vcfBend: f32 = clampf(pget(P_VCFBEND), 0.0, 1.0);
  const lfoModDepth: f32 = clampf(pget(P_LFOMOD), 0.0, 1.0);
  const modPush: f32 = clampf(pget(P_MODPUSH), 0.0, 1.0);
  const gripAmt: f32 = modPush * lfoModDepth;
  const benderPitchOct: f32 = bender * vcoBend;             // +/-1 oct
  const benderCutOct: f32 = bender * vcfBend * 6.0;

  const bpm: f32 = clampf(pget(P_TEMPO), 40.0, 300.0);
  const stepSamples: f32 = (60.0 / bpm) * 0.25 * sr;       // one 16th note

  for (let f = 0; f < n; f++) {
    // ---- clock (arp / seq) --------------------------------------------
    if (seqRunning == 1 || arpRunning == 1) {
      clockAcc -= 1.0;
      if (clockAcc <= 0.0) {
        clockAcc += stepSamples;
        if (seqRunning == 1) seqAdvance(); else arpAdvance();
      }
    }

    // ---- LFO ----------------------------------------------------------
    const lfoPhPrev: f32 = lfoPh;
    lfoPh += lfoInc; if (lfoPh >= 1.0) { lfoPh -= 1.0; lfoSH = rngf(); } // S&H update on wrap
    const lfo: f32 = lfoValue(lfoWave, lfoPh);            // -1..1
    const lfoTri: f32 = lfoPh < 0.5 ? (lfoPh * 4.0 - 1.0) : (3.0 - lfoPh * 4.0);

    // ---- glide (portamento) -------------------------------------------
    if (vCur != vTarget) {
      vCur += (vTarget - vCur) * glideK;
      if (Mathf.abs(vTarget - vCur) < 0.02) vCur = vTarget;
    }

    // ---- envelope -----------------------------------------------------
    if (envMode == 2) {
      // LFO mode: envelope repeats at the LFO rate while the gate is on
      if (vGate == 1) {
        lfoEnvPh += lfoInc; if (lfoEnvPh >= 1.0) lfoEnvPh -= 1.0;
        // rising then falling shape synced to the LFO cycle
        env = lfoEnvPh < 0.5 ? (lfoEnvPh * 2.0) : (2.0 - lfoEnvPh * 2.0);
        envStage = 3;
      } else {
        env += relK * (0.0 - env); if (env < 0.0004) { env = 0.0; envStage = 0; }
      }
    } else {
      if (envStage == 1) { env += atkK * (1.04 - env); if (env >= 1.0) { env = 1.0; envStage = 2; } }
      else if (envStage == 2) { env += decK * (sN - env); if (Mathf.abs(env - sN) < 0.001) envStage = 3; }
      else if (envStage == 3) { env += decK * (sN - env); }
      else if (envStage == 4) { env += relK * (0.0 - env); if (env < 0.0004) { env = 0.0; envStage = 0; } }
    }
    if (vActive == 1 && envStage == 0 && env <= 0.0004) vActive = 0;

    // ---- gate smoothing (for GATE-mode VCA) ---------------------------
    const gTarget: f32 = vGate == 1 ? 1.0 : 0.0;
    gateSmooth += (gTarget - gateSmooth) * 0.005;

    let outSig: f32 = 0.0;
    if (vActive == 1 || env > 0.0004 || gateSmooth > 0.001) {
      // ---- pitch --------------------------------------------------------
      let pitchOct: f32 = benderPitchOct
        + lfo * vcoModDepth * 0.5           // LFO -> pitch (up to +/- half oct)
        + lfoTri * gripAmt * 0.25;          // mod-grip vibrato
      let hz: f32 = vCur * tuneMul * rangeMul * transMul * Mathf.pow(2.0, pitchOct);
      if (hz < 0.001) hz = 0.001;
      let inc: f32 = hz / sr; if (inc > 0.45) inc = 0.45;

      // ---- main oscillator (saw + pulse, polyBLEP) ----------------------
      ph += inc; if (ph >= 1.0) ph -= 1.0;
      // saw
      let saw: f32 = 2.0 * ph - 1.0;
      saw -= polyBlep(ph, inc);
      // pulse width
      let pw: f32;
      if (pwmMode == 0) pw = 0.5 - pwN * 0.45;            // MANUAL: 50% .. ~5%
      else if (pwmMode == 1) pw = 0.5 - pwN * 0.45 * (lfo * 0.5 + 0.5); // LFO
      else pw = 0.5 - pwN * 0.45 * env;                   // ENV
      pw = clampf(pw, 0.03, 0.97);
      let pulse: f32 = ph < pw ? 1.0 : -1.0;
      pulse += polyBlep(ph, inc);
      let p2: f32 = ph - pw; if (p2 < 0.0) p2 += 1.0;
      pulse -= polyBlep(p2, inc);

      // ---- sub oscillator ----------------------------------------------
      let subDiv: f32; let subPwCmp: f32;
      if (subType == 0) { subDiv = 0.5; subPwCmp = 0.5; }        // 1 oct down square
      else if (subType == 1) { subDiv = 0.25; subPwCmp = 0.5; }  // 2 oct down square
      else { subDiv = 0.25; subPwCmp = 0.25; }                   // 2 oct down narrow
      const subInc: f32 = inc * subDiv;
      subPh += subInc; if (subPh >= 1.0) subPh -= 1.0;
      let sub: f32 = subPh < subPwCmp ? 1.0 : -1.0;
      sub += polyBlep(subPh, subInc);
      let sp2: f32 = subPh - subPwCmp; if (sp2 < 0.0) sp2 += 1.0;
      sub -= polyBlep(sp2, subInc);

      const noise: f32 = rngf();

      let mixed: f32 = saw * mixSaw + pulse * mixPulse + sub * mixSub + noise * mixNoise * 0.7;

      // ---- VCF (4-pole ladder LPF) --------------------------------------
      let cutOct: f32 = env * vcfEnvAmt * 7.0
        + lfo * vcfModAmt * 4.0
        + lfoTri * gripAmt * 2.0
        + benderCutOct
        + Mathf.log2(hz / 261.6) * vcfKybd;
      let fc: f32 = fcBase * Mathf.pow(2.0, cutOct);
      fc = clampf(fc, 10.0, sr * 0.45);
      let g: f32 = 1.0 - Mathf.exp(-TWO_PI * fc / sr);
      if (g > 0.99) g = 0.99;
      let x: f32 = mixed - kRes * lp3;
      x = Mathf.tanh(x);
      lp0 += g * (x - lp0);
      lp1 += g * (lp0 - lp1);
      lp2 += g * (lp1 - lp2);
      lp3 += g * (lp2 - lp3);
      const filt: f32 = lp3 * (1.0 + kRes * 0.75);          // passband makeup

      // ---- VCA ----------------------------------------------------------
      const amp: f32 = vcaSrc == 1 ? gateSmooth : env;
      outSig = filt * amp;
    }

    const out: f32 = Mathf.tanh(outSig * outGain);
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
