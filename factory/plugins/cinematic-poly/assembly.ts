// =====================================================================
//  CINEMATIC POLY — an eight-voice polyphonic analog synthesizer
//  modelled on the YAMAHA CS-80 (Instruction Manual, read cover to cover).
//
//  Architecture (manual Section IV, "Overall Picture"): every voice is
//  TWO independent synthesizer channels (I and II) played simultaneously
//  and blended by the MIX I-II lever. 8 voices x 2 channels = 16 main
//  VCO/VCF/VCA sound sources, exactly as the hardware.
//
//  Per channel:
//   VCO  (p.15,32): simultaneous SAWTOOTH [24] and variable-width SQUARE
//     [23] (polyBLEP band-limited) with PULSE WIDTH [22] + PWM depth [21]
//     driven by a shared PWM SPEED [20] sub-oscillator, white NOISE [25],
//     and a pure SINE [36] that bypasses the filter.
//   VCF  (p.16,33): a resonant HIGH-PASS [26]+RES_H [27] then a resonant
//     LOW-PASS [28]+RES_L [29], in series (state-variable, 2-pole each).
//   VCF EG (p.20,33): the CS-80's unique IL-AL-A-D-R filter envelope that
//     moves BOTH cutoffs — Initial Level below the steady cutoff, Attack
//     Level above it, Attack/Decay/Release times. VCF LEVEL [35].
//   VCA EG (p.18,35): A-D-S-R amplitude envelope; SINE LEVEL [36] mix.
//
//  Global (affect both channels): MIX I-II [4], DETUNE II [6], FEET I/II
//  [5], master PITCH tune [18], BRILLIANCE [7], RESONANCE [8], the SUB
//  OSCILLATOR [11] (function/speed/VCO/VCF), RING MODULATOR [16], stereo
//  TREMOLO/CHORUS [15], PORTAMENTO/GLISSANDO [14], SUSTAIN [13], plus the
//  touch section: velocity PITCHBEND [12] & INITIAL-TOUCH brilliance [42],
//  polyphonic AFTER-TOUCH -> brilliance [44] / level [45] / vibrato-pitch,
//  and the velvet PITCH RIBBON [19].
//
//  Switch groups are bit-packed into one mask param (Osc Switch); the GUI
//  decodes them. Pure algorithm — no samples, no imports, alloc-free.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;
const NV2: i32 = NUM_VOICES * 2;   // per-voice-per-channel state slots
const HELD_MAX: i32 = 16;
const CH_LEN: i32 = 2048;
const CH_MASK: i32 = CH_LEN - 1;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
// per-channel block is 18 params; channel I at 0, channel II at 18
const CH_STRIDE: i32 = 18;
const O_PW: i32 = 0; const O_PWM: i32 = 1; const O_NOISE: i32 = 2;
const O_HPF: i32 = 3; const O_RESH: i32 = 4; const O_LPF: i32 = 5; const O_RESL: i32 = 6;
const O_VIL: i32 = 7; const O_VAL: i32 = 8; const O_VA: i32 = 9; const O_VD: i32 = 10; const O_VR: i32 = 11;
const O_VCFLVL: i32 = 12; const O_SINE: i32 = 13;
const O_AA: i32 = 14; const O_AD: i32 = 15; const O_AS: i32 = 16; const O_AR: i32 = 17;

const P_SWITCH: i32 = 36;
const P_MIX: i32 = 37;
const P_DETUNE: i32 = 38;
const P_FEET1: i32 = 39;
const P_FEET2: i32 = 40;
const P_TUNE: i32 = 41;
const P_BRILL: i32 = 42;
const P_RESO: i32 = 43;
const P_PWMSPEED: i32 = 44;
const P_SUBFUNC: i32 = 45;
const P_SUBSPEED: i32 = 46;
const P_SUBVCO: i32 = 47;
const P_SUBVCF: i32 = 48;
const P_RINGMOD: i32 = 49;
const P_RINGSPEED: i32 = 50;
const P_RINGDEPTH: i32 = 51;
const P_TREMSPEED: i32 = 52;
const P_TREMDEPTH: i32 = 53;
const P_PORTA: i32 = 54;
const P_SUSTAIN: i32 = 55;
const P_PITCHBEND: i32 = 56;
const P_INITBRILL: i32 = 57;
const P_AFTBRILL: i32 = 58;
const P_AFTLEVEL: i32 = 59;
const P_AFTVCO: i32 = 60;
const P_PRESSURE: i32 = 61;
const P_RIBBON: i32 = 62;
const P_VOLUME: i32 = 63;

const NUM_PARAMS: i32 = 64;

// switch mask bits
const SW_I_SQ: i32 = 1;      // bit0 channel I square on
const SW_I_SAW: i32 = 2;     // bit1 channel I saw on
const SW_II_SQ: i32 = 4;     // bit2 channel II square on
const SW_II_SAW: i32 = 8;    // bit3 channel II saw on
const SW_TREM_ON: i32 = 16;  // bit4 tremolo/chorus on
const SW_TREM_MODE: i32 = 32;// bit5 1=tremolo(fast) 0=chorus(slow)
const SW_PORTA_ON: i32 = 64; // bit6 portamento/glissando on
const SW_GLISS: i32 = 128;   // bit7 1=glissando(stepped) 0=portamento
const SW_SUS_ON: i32 = 256;  // bit8 sustain on
const SW_SUS_II: i32 = 512;  // bit9 sustain mode II

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

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

// envelope knob -> seconds (exponential). Attack ~2ms..4s ; Dec/Rel ~3ms..12s
@inline function atkTime(n: f32): f32 { return 0.002 * f32(Mathf.pow(2000.0, clampf(n, 0.0, 1.0))); }
@inline function decTime(n: f32): f32 { return 0.003 * f32(Mathf.pow(4000.0, clampf(n, 0.0, 1.0))); }

// FEET semitone offsets: 16' 8' 5-1/3' 4' 2-2/3' 2'
const feetSemi: StaticArray<f32> = new StaticArray<f32>(6);

// ---- voice state (per voice) -----------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vBend:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // velocity pitch-dip (semitones, decays)

// ---- per-voice-per-channel state (index vc = v*2 + c) ----------------
const scPh:   StaticArray<f32> = new StaticArray<f32>(NV2); // VCO phase
const scVcf:  StaticArray<f32> = new StaticArray<f32>(NV2); // VCF EG value (octaves offset)
const scVcfSt:StaticArray<i32> = new StaticArray<i32>(NV2); // VCF EG stage
const scVca:  StaticArray<f32> = new StaticArray<f32>(NV2); // VCA EG value (0..1)
const scVcaSt:StaticArray<i32> = new StaticArray<i32>(NV2); // VCA EG stage
// two state-variable filters in series: HPF (h1,h2) then LPF (l1,l2)
const scH1: StaticArray<f32> = new StaticArray<f32>(NV2);
const scH2: StaticArray<f32> = new StaticArray<f32>(NV2);
const scL1: StaticArray<f32> = new StaticArray<f32>(NV2);
const scL2: StaticArray<f32> = new StaticArray<f32>(NV2);

// held-key list (for portamento last-pitch)
const hId:   StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global modulators
let subPhase: f32 = 0.0;
let pwmPhase: f32 = 0.0;
let ringPhase: f32 = 0.0;
let tremPhase: f32 = 0.0;
// stereo chorus/tremolo delay lines
const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chWrite: i32 = 0;
let chMod: f32 = 0.0;

// ---- init ------------------------------------------------------------
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;

  feetSemi[0] = -12.0; feetSemi[1] = 0.0; feetSemi[2] = 7.0;
  feetSemi[3] = 12.0;  feetSemi[4] = 19.0; feetSemi[5] = 24.0;

  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 0.8;
    vCur[v] = 261.63; vTarget[v] = 261.63; vBend[v] = 0.0;
  }
  for (let i = 0; i < NV2; i++) {
    scPh[i] = 0.07 * f32(i); scVcf[i] = 0.0; scVcfSt[i] = 0; scVca[i] = 0.0; scVcaSt[i] = 0;
    scH1[i] = 0.0; scH2[i] = 0.0; scL1[i] = 0.0; scL2[i] = 0.0;
  }
  hCount = 0; ageCounter = 1; lastPlayedHz = 261.63;
  subPhase = 0.0; pwmPhase = 0.0; ringPhase = 0.0; tremPhase = 0.0;
  chWrite = 0; chMod = 0.0;
  for (let i = 0; i < CH_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }

  // boot state = spec.json defaults (host may render before pushing)
  params[0]  = 0.5;  params[1]  = 0.2;  params[2]  = 0.0;  params[3]  = 0.12;
  params[4]  = 0.1;  params[5]  = 0.52; params[6]  = 0.18; params[7]  = 0.15;
  params[8]  = 0.35; params[9]  = 0.35; params[10] = 0.5;  params[11] = 0.45;
  params[12] = 0.85; params[13] = 0.12; params[14] = 0.35; params[15] = 0.5;
  params[16] = 0.8;  params[17] = 0.5;
  params[18] = 0.35; params[19] = 0.25; params[20] = 0.0;  params[21] = 0.1;
  params[22] = 0.1;  params[23] = 0.48; params[24] = 0.2;  params[25] = 0.2;
  params[26] = 0.4;  params[27] = 0.4;  params[28] = 0.5;  params[29] = 0.45;
  params[30] = 0.8;  params[31] = 0.1;  params[32] = 0.45; params[33] = 0.5;
  params[34] = 0.78; params[35] = 0.55;
  params[P_SWITCH] = 30.0; params[P_MIX] = 0.0; params[P_DETUNE] = 0.06;
  params[P_FEET1] = 1.0; params[P_FEET2] = 1.0; params[P_TUNE] = 0.0;
  params[P_BRILL] = 0.0; params[P_RESO] = 0.0; params[P_PWMSPEED] = 0.3;
  params[P_SUBFUNC] = 0.0; params[P_SUBSPEED] = 0.32; params[P_SUBVCO] = 0.14; params[P_SUBVCF] = 0.1;
  params[P_RINGMOD] = 0.0; params[P_RINGSPEED] = 0.35; params[P_RINGDEPTH] = 0.4;
  params[P_TREMSPEED] = 0.3; params[P_TREMDEPTH] = 0.3;
  params[P_PORTA] = 0.12; params[P_SUSTAIN] = 0.3;
  params[P_PITCHBEND] = 0.2; params[P_INITBRILL] = 0.3; params[P_AFTBRILL] = 0.4;
  params[P_AFTLEVEL] = 0.2; params[P_AFTVCO] = 0.3; params[P_PRESSURE] = 0.0;
  params[P_RIBBON] = 0.0; params[P_VOLUME] = 0.75;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- voice allocation ------------------------------------------------
function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function heldAdd(id: i32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) return;
  if (hCount < HELD_MAX) { hId[hCount] = id; hCount++; }
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) {
    for (let j = i + 1; j < hCount; j++) hId[j - 1] = hId[j];
    hCount--; return;
  }
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  heldAdd(id);
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  const wasIdle: i32 = vActive[slot] == 0 ? 1 : 0;
  vNote[slot] = id;
  vTarget[slot] = hz;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  // portamento: glide starts from the previously played pitch
  const portaOn: i32 = (pbits(P_SWITCH) & SW_PORTA_ON) != 0 ? 1 : 0;
  if (portaOn == 1) { if (wasIdle == 1) vCur[slot] = lastPlayedHz; }
  else vCur[slot] = hz;
  // velocity-sensitive PITCHBEND: pitch begins below and slides up (p.10)
  vBend[slot] = -clampf(pget(P_PITCHBEND), 0.0, 1.0) * vVel[slot] * 7.0; // up to ~7 semis down
  // (re)trigger envelopes
  const vc0: i32 = slot * 2; const vc1: i32 = slot * 2 + 1;
  scVcaSt[vc0] = 1; scVcaSt[vc1] = 1;
  scVcfSt[vc0] = 1; scVcfSt[vc1] = 1;
  if (wasIdle == 1) {
    scVca[vc0] = 0.0; scVca[vc1] = 0.0;
    scVcf[vc0] = -3.0 * pget(0 * CH_STRIDE + O_VIL);
    scVcf[vc1] = -3.0 * pget(1 * CH_STRIDE + O_VIL);
  }
  vActive[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++;
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  heldRemove(id);
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0; scVcaSt[i * 2] = 4; scVcaSt[i * 2 + 1] = 4;
      scVcfSt[i * 2] = 4; scVcfSt[i * 2 + 1] = 4;
    }
  }
}

// sub-oscillator waveform (function select p.9): 0 sine,1 saw,2 inv-saw,3 square,4 noise,5 ext(off)
@inline function subWave(fn: i32, ph: f32): f32 {
  if (fn == 0) return Mathf.sin(TWO_PI * ph);
  if (fn == 1) return 1.0 - 2.0 * ph;           // saw: rapid begin, slow decay
  if (fn == 2) return 2.0 * ph - 1.0;           // inverted saw
  if (fn == 3) return ph < 0.5 ? 1.0 : -1.0;    // square
  if (fn == 4) return rngf();                    // noise
  return 0.0;                                     // ext -> off
}

// fractional-delay read for chorus/tremolo
@inline function chRead(buf: StaticArray<f32>, delay: f32): f32 {
  let d: f32 = delay; if (d < 1.0) d = 1.0;
  const readPos: f32 = f32(chWrite) - d;
  let i0: i32 = i32(Mathf.floor(readPos));
  const frac: f32 = readPos - f32(i0);
  i0 = i0 & CH_MASK; const i1: i32 = (i0 + 1) & CH_MASK;
  return buf[i0] + (buf[i1] - buf[i0]) * frac;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const sw: i32 = pbits(P_SWITCH);

  // ---- per-block global params ---------------------------------------
  const iSaw: f32 = (sw & SW_I_SAW) != 0 ? 1.0 : 0.0;
  const iSq:  f32 = (sw & SW_I_SQ)  != 0 ? 1.0 : 0.0;
  const iiSaw: f32 = (sw & SW_II_SAW) != 0 ? 1.0 : 0.0;
  const iiSq:  f32 = (sw & SW_II_SQ)  != 0 ? 1.0 : 0.0;

  // FEET + detune + master tune -> semitone offset per channel
  const feet1: i32 = pbits(P_FEET1); const feet2: i32 = pbits(P_FEET2);
  const semiI:  f32 = feetSemi[feet1 < 0 ? 0 : (feet1 > 5 ? 5 : feet1)] + pget(P_TUNE) * 2.0;
  const semiII: f32 = feetSemi[feet2 < 0 ? 0 : (feet2 > 5 ? 5 : feet2)] + pget(P_TUNE) * 2.0
                    + clampf(pget(P_DETUNE), -1.0, 1.0) * 1.0; // Detune II up to +/-1 semitone
  const ribbonSemi: f32 = clampf(pget(P_RIBBON), -1.0, 1.0) * 12.0; // +/-1 octave

  // MIX I-II equal-power balance (-1 = I only, +1 = II only)
  const mixN: f32 = (clampf(pget(P_MIX), -1.0, 1.0) + 1.0) * 0.5;
  const gI: f32 = Mathf.cos(mixN * 1.5707963);
  const gII: f32 = Mathf.sin(mixN * 1.5707963);

  // sub oscillator (LFO) — vibrato / wah / growl
  const subFn: i32 = pbits(P_SUBFUNC);
  const subHz: f32 = 0.1 * f32(Mathf.pow(200.0, clampf(pget(P_SUBSPEED), 0.0, 1.0))); // 0.1..20 Hz
  const subInc: f32 = subHz / sr;
  const subVcoDepth: f32 = clampf(pget(P_SUBVCO), 0.0, 1.0);
  const subVcfDepth: f32 = clampf(pget(P_SUBVCF), 0.0, 1.0);

  // pwm sub-oscillator (shared speed, per-channel depth p.15)
  const pwmHz: f32 = 0.1 * f32(Mathf.pow(300.0, clampf(pget(P_PWMSPEED), 0.0, 1.0)));
  const pwmInc: f32 = pwmHz / sr;
  const iPwmDepth: f32 = clampf(pget(O_PWM), 0.0, 1.0);
  const iiPwmDepth: f32 = clampf(pget(CH_STRIDE + O_PWM), 0.0, 1.0);
  const iPwBase: f32 = clampf(pget(O_PW), 0.0, 1.0);
  const iiPwBase: f32 = clampf(pget(CH_STRIDE + O_PW), 0.0, 1.0);

  // touch section
  const pressure: f32 = clampf(pget(P_PRESSURE), 0.0, 1.0);
  const aftBrill: f32 = pressure * clampf(pget(P_AFTBRILL), 0.0, 1.0) * 3.0;   // octaves
  const aftLevel: f32 = pressure * clampf(pget(P_AFTLEVEL), 0.0, 1.0);          // 0..1 gain add
  const aftVco: f32   = pressure * clampf(pget(P_AFTVCO), 0.0, 1.0);            // extra vibrato depth
  const initBrillAmt: f32 = clampf(pget(P_INITBRILL), 0.0, 1.0) * 2.5;          // octaves per velocity

  // overall brilliance/resonance (bipolar, nominal centre) p.38
  const brillOct: f32 = clampf(pget(P_BRILL), -1.0, 1.0) * 3.0;     // down/up shifts cutoffs
  const resoAdd: f32 = clampf(pget(P_RESO), -1.0, 1.0) * 0.45;      // adds Q

  // ring modulator (processes both channels) p.13
  const ringAmt: f32 = clampf(pget(P_RINGMOD), 0.0, 1.0);
  const ringDepth: f32 = clampf(pget(P_RINGDEPTH), 0.0, 1.0);
  const ringHz: f32 = 1.0 * f32(Mathf.pow(600.0, clampf(pget(P_RINGSPEED), 0.0, 1.0))); // 1..600 Hz (audio-rate = gong/clangor)
  const ringInc: f32 = ringHz / sr;

  // tremolo/chorus p.13
  const tremOn: i32 = (sw & SW_TREM_ON) != 0 ? 1 : 0;
  const tremMode: i32 = (sw & SW_TREM_MODE) != 0 ? 1 : 0; // 1 tremolo(fast), 0 chorus(slow)
  const tremDepth: f32 = clampf(pget(P_TREMDEPTH), 0.0, 1.0);
  const tremHzC: f32 = 0.3 + clampf(pget(P_TREMSPEED), 0.0, 1.0) * 4.7;   // chorus 0.3..5 Hz
  const tremHzT: f32 = 4.0 + clampf(pget(P_TREMSPEED), 0.0, 1.0) * 16.0;  // tremolo 4..20 Hz
  const tremInc: f32 = (tremMode == 1 ? tremHzT : tremHzC) / sr;

  // sustain (extends release) p.11
  const susOn: i32 = (sw & SW_SUS_ON) != 0 ? 1 : 0;
  const susTime: f32 = clampf(pget(P_SUSTAIN), 0.0, 1.0);

  // envelope rate coefficients (per channel)
  const iVcaAtk: f32 = 1.0 / (atkTime(pget(O_AA)) * sr);
  const iVcaDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(O_AD)) * sr)));
  const iVcaSus: f32 = clampf(pget(O_AS), 0.0, 1.0);
  const iVcaRelBase: f32 = decTime(pget(O_AR));
  const iiVcaAtk: f32 = 1.0 / (atkTime(pget(CH_STRIDE + O_AA)) * sr);
  const iiVcaDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(CH_STRIDE + O_AD)) * sr)));
  const iiVcaSus: f32 = clampf(pget(CH_STRIDE + O_AS), 0.0, 1.0);
  const iiVcaRelBase: f32 = decTime(pget(CH_STRIDE + O_AR));
  // sustain lengthens release (up to +10 s)
  const susExtra: f32 = susOn == 1 ? susTime * 10.0 : 0.0;
  const iVcaRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / ((iVcaRelBase + susExtra) * sr)));
  const iiVcaRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / ((iiVcaRelBase + susExtra) * sr)));

  // VCF EG rates + IL/AL octave offsets per channel
  const iVcfAtk: f32 = 1.0 / (atkTime(pget(O_VA)) * sr);
  const iVcfDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(O_VD)) * sr)));
  const iVcfRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(O_VR)) * sr)));
  const iIL: f32 = -3.0 * pget(O_VIL); const iAL: f32 = 4.2 * pget(O_VAL);
  const iiVcfAtk: f32 = 1.0 / (atkTime(pget(CH_STRIDE + O_VA)) * sr);
  const iiVcfDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(CH_STRIDE + O_VD)) * sr)));
  const iiVcfRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(CH_STRIDE + O_VR)) * sr)));
  const iiIL: f32 = -3.0 * pget(CH_STRIDE + O_VIL); const iiAL: f32 = 4.2 * pget(CH_STRIDE + O_VAL);

  // filter base cutoffs (octaves relative to a reference) + resonance
  const iHpfN: f32 = clampf(pget(O_HPF), 0.0, 1.0); const iLpfN: f32 = clampf(pget(O_LPF), 0.0, 1.0);
  const iResH: f32 = clampf(pget(O_RESH), 0.0, 1.0); const iResL: f32 = clampf(pget(O_RESL), 0.0, 1.0);
  const iiHpfN: f32 = clampf(pget(CH_STRIDE + O_HPF), 0.0, 1.0); const iiLpfN: f32 = clampf(pget(CH_STRIDE + O_LPF), 0.0, 1.0);
  const iiResH: f32 = clampf(pget(CH_STRIDE + O_RESH), 0.0, 1.0); const iiResL: f32 = clampf(pget(CH_STRIDE + O_RESL), 0.0, 1.0);

  // mix levels
  const iVcfLvl: f32 = clampf(pget(O_VCFLVL), 0.0, 1.0); const iSineLvl: f32 = clampf(pget(O_SINE), 0.0, 1.0);
  const iNoise: f32 = clampf(pget(O_NOISE), 0.0, 1.0);
  const iiVcfLvl: f32 = clampf(pget(CH_STRIDE + O_VCFLVL), 0.0, 1.0); const iiSineLvl: f32 = clampf(pget(CH_STRIDE + O_SINE), 0.0, 1.0);
  const iiNoise: f32 = clampf(pget(CH_STRIDE + O_NOISE), 0.0, 1.0);

  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 3.0;

  for (let f = 0; f < n; f++) {
    // ---- global modulators advance ------------------------------------
    subPhase += subInc; if (subPhase >= 1.0) subPhase -= 1.0;
    pwmPhase += pwmInc; if (pwmPhase >= 1.0) pwmPhase -= 1.0;
    ringPhase += ringInc; if (ringPhase >= 1.0) ringPhase -= 1.0;
    tremPhase += tremInc; if (tremPhase >= 1.0) tremPhase -= 1.0;

    const subV: f32 = subWave(subFn, subPhase);   // -1..1
    const pwmV: f32 = Mathf.sin(TWO_PI * pwmPhase); // -1..1

    // vibrato multiplier (sub-osc VCO + aftertouch VCO), semitone scaled
    const vibSemi: f32 = subV * (subVcoDepth + aftVco) * 1.5;
    // filter wah offset (octaves) from sub-osc VCF
    const wahOct: f32 = subV * subVcfDepth * 2.5;

    // per-channel pulse width this sample
    let iPw: f32 = iPwBase * 0.9 + pwmV * iPwmDepth * 0.4;
    iPw = clampf(0.5 + (iPw - 0.5), 0.05, 0.95);
    let iiPw: f32 = iiPwBase * 0.9 + pwmV * iiPwmDepth * 0.4;
    iiPw = clampf(0.5 + (iiPw - 0.5), 0.05, 0.95);

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- glide (portamento / glissando) ------------------------------
      let cur: f32 = vCur[v]; const tgt: f32 = vTarget[v];
      const portaOn: i32 = (sw & SW_PORTA_ON) != 0 ? 1 : 0;
      if (portaOn == 1 && cur != tgt) {
        const t: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
        const secPerOct: f32 = 0.005 * f32(Mathf.pow(600.0, t)); // ~5ms..3s per octave
        const step: f32 = f32(Mathf.pow(2.0, 1.0 / (secPerOct * sr)));
        if (tgt > cur) { cur *= step; if (cur > tgt) cur = tgt; }
        else { cur /= step; if (cur < tgt) cur = tgt; }
        vCur[v] = cur;
      } else if (portaOn == 0) { cur = tgt; vCur[v] = tgt; }
      // glissando: quantise the audible pitch to semitone steps (p.12)
      let glidHz: f32 = cur;
      if (portaOn == 1 && (sw & SW_GLISS) != 0) {
        const semi: f32 = Mathf.round(12.0 * f32(Mathf.log2(cur / 261.63)));
        glidHz = 261.63 * f32(Mathf.pow(2.0, semi / 12.0));
      }

      // velocity pitch-dip decays toward 0
      let bend: f32 = vBend[v];
      if (bend < 0.0) { bend += (0.0 - bend) * 0.0016; if (bend > -0.001) bend = 0.0; vBend[v] = bend; }

      const vel: f32 = vVel[v];
      const keyOct: f32 = f32(Mathf.log2(glidHz / 261.63));

      // ---- two channels ------------------------------------------------
      for (let c = 0; c < 2; c++) {
        const vc: i32 = v * 2 + c;

        // ---- VCA envelope --------------------------------------------
        let aenv: f32 = scVca[vc]; const ast: i32 = scVcaSt[vc];
        const atkA: f32 = c == 0 ? iVcaAtk : iiVcaAtk;
        const decKA: f32 = c == 0 ? iVcaDecK : iiVcaDecK;
        const susA: f32 = c == 0 ? iVcaSus : iiVcaSus;
        const relKA: f32 = c == 0 ? iVcaRelK : iiVcaRelK;
        if (ast == 1) { aenv += atkA; if (aenv >= 1.0) { aenv = 1.0; scVcaSt[vc] = 2; } }
        else if (ast == 2) { aenv += (susA - aenv) * decKA; }
        else if (ast == 4) { aenv += (0.0 - aenv) * relKA; if (aenv <= 0.0004) aenv = 0.0; }
        scVca[vc] = aenv;

        // ---- VCF envelope (IL-AL-A-D-R) ------------------------------
        let fenv: f32 = scVcf[vc]; const fst: i32 = scVcfSt[vc];
        const vAtk: f32 = c == 0 ? iVcfAtk : iiVcfAtk;
        const vDecK: f32 = c == 0 ? iVcfDecK : iiVcfDecK;
        const vRelK: f32 = c == 0 ? iVcfRelK : iiVcfRelK;
        const alV: f32 = c == 0 ? iAL : iiAL;
        const ilV: f32 = c == 0 ? iIL : iiIL;
        if (fst == 1) {   // attack: rise from IL toward AL
          fenv += (alV - fenv) * (vAtk * 4.0);
          if ((alV >= 0.0 && fenv >= alV - 0.01) || (alV < 0.0 && fenv <= alV + 0.01)) { fenv = alV; scVcfSt[vc] = 2; }
        } else if (fst == 2) { fenv += (0.0 - fenv) * vDecK; }  // decay toward steady (0)
        else if (fst == 4) { fenv += (ilV - fenv) * vRelK; }    // release toward IL
        scVcf[vc] = fenv;

        // both envelopes done -> free the voice
        // (checked after channel loop)

        // ---- oscillator ---------------------------------------------
        const sawOn: f32 = c == 0 ? iSaw : iiSaw;
        const sqOn: f32 = c == 0 ? iSq : iiSq;
        const pw: f32 = c == 0 ? iPw : iiPw;
        const noiseLvl: f32 = c == 0 ? iNoise : iiNoise;

        const semiCh: f32 = c == 0 ? semiI : semiII;
        const totalSemi: f32 = semiCh + ribbonSemi + vibSemi + bend;
        const hz: f32 = glidHz * f32(Mathf.pow(2.0, totalSemi / 12.0));
        let inc: f32 = hz / sr; if (inc > 0.45) inc = 0.45; if (inc < 0.0) inc = 0.0;
        let ph: f32 = scPh[vc]; ph += inc; if (ph >= 1.0) ph -= 1.0; scPh[vc] = ph;

        let osc: f32 = 0.0;
        if (sawOn != 0.0) { let s: f32 = 2.0 * ph - 1.0; s -= polyBlep(ph, inc); osc += s; }
        if (sqOn != 0.0) {
          let sq: f32 = ph < pw ? 1.0 : -1.0;
          sq += polyBlep(ph, inc);
          let p2: f32 = ph - pw; if (p2 < 0.0) p2 += 1.0;
          sq -= polyBlep(p2, inc);
          osc += sq;
        }
        osc *= 0.5;
        osc += rngf() * noiseLvl * 0.6;
        const sine: f32 = Mathf.sin(TWO_PI * ph);

        // ---- VCF (HPF then LPF, each resonant SVF) -------------------
        const hpfN: f32 = c == 0 ? iHpfN : iiHpfN;
        const lpfN: f32 = c == 0 ? iLpfN : iiLpfN;
        const resHn: f32 = clampf((c == 0 ? iResH : iiResH) + resoAdd, 0.0, 0.97);
        const resLn: f32 = clampf((c == 0 ? iResL : iiResL) + resoAdd, 0.0, 0.97);

        // env + brilliance + touch + wah move BOTH cutoffs (octaves)
        const cutMod: f32 = fenv + brillOct + wahOct + keyOct * 0.35
                          + initBrillAmt * vel + aftBrill;
        // HPF cutoff Hz
        let hpHz: f32 = 20.0 * f32(Mathf.pow(2.0, hpfN * 9.0 + cutMod));
        hpHz = clampf(hpHz, 12.0, sr * 0.45);
        // LPF cutoff Hz
        let lpHz: f32 = 30.0 * f32(Mathf.pow(2.0, lpfN * 9.0 + cutMod));
        lpHz = clampf(lpHz, 20.0, sr * 0.47);

        // HPF SVF
        let gh: f32 = f32(Mathf.tan(PI * hpHz / sr)); if (gh > 8.0) gh = 8.0;
        const kh: f32 = 2.0 - 1.94 * resHn;
        let h1: f32 = scH1[vc]; let h2: f32 = scH2[vc];
        const ah1: f32 = 1.0 / (1.0 + gh * (gh + kh));
        const hv3: f32 = osc - h2;
        const hv1: f32 = ah1 * h1 + (gh * ah1) * hv3;
        const hv2: f32 = h2 + gh * hv1;
        scH1[vc] = 2.0 * hv1 - h1; scH2[vc] = 2.0 * hv2 - h2;
        let hp: f32 = osc - kh * hv1 - hv2;   // high-pass output

        // LPF SVF
        let gl: f32 = f32(Mathf.tan(PI * lpHz / sr)); if (gl > 8.0) gl = 8.0;
        const kl: f32 = 2.0 - 1.94 * resLn;
        let l1: f32 = scL1[vc]; let l2: f32 = scL2[vc];
        const al1: f32 = 1.0 / (1.0 + gl * (gl + kl));
        const lv3: f32 = hp - l2;
        const lv1: f32 = al1 * l1 + (gl * al1) * lv3;
        const lv2: f32 = l2 + gl * lv1;
        scL1[vc] = 2.0 * lv1 - l1; scL2[vc] = 2.0 * lv2 - l2;
        let lp: f32 = lv2;   // low-pass output

        // passband makeup so resonant/filtered patches aren't whisper-quiet
        lp *= 1.0 + resLn * 0.7 + resHn * 0.3;

        // VCF LEVEL + SINE mix into VCA
        const vcfLvl: f32 = c == 0 ? iVcfLvl : iiVcfLvl;
        const sineLvl: f32 = c == 0 ? iSineLvl : iiSineLvl;
        let chSig: f32 = lp * vcfLvl + sine * sineLvl;

        // VCA
        const amp: f32 = aenv * (1.0 + aftLevel) * (0.35 + 0.65 * vel);
        chSig *= amp;

        // channel balance (MIX I-II)
        mono += chSig * (c == 0 ? gI : gII);
      }

      // free voice when both channels silent & released
      if (vGate[v] == 0 && scVca[v * 2] <= 0.0005 && scVca[v * 2 + 1] <= 0.0005) {
        vActive[v] = 0;
      }
    }

    mono *= 0.34; // voice sum scale

    // ---- RING MODULATOR (both channels) p.13 --------------------------
    if (ringAmt > 0.0) {
      const ro: f32 = Mathf.sin(TWO_PI * ringPhase);
      const ringed: f32 = mono * ((1.0 - ringDepth) + ringDepth * ro);
      mono = mono * (1.0 - ringAmt) + ringed * ringAmt;
    }

    // ---- TREMOLO / CHORUS (stereo) p.13 -------------------------------
    chWrite = (chWrite + 1) & CH_MASK;
    chL[chWrite] = mono; chR[chWrite] = mono;
    let outL: f32 = mono; let outR: f32 = mono;
    if (tremOn == 1) {
      const lfo: f32 = Mathf.sin(TWO_PI * tremPhase);
      if (tremMode == 0) {
        // CHORUS: slow modulated BBD, L/R opposite -> rotary width
        const center: f32 = 0.006 * sr;
        const depthS: f32 = 0.0022 * sr * (0.3 + tremDepth);
        const wetL: f32 = chRead(chL, center + lfo * depthS);
        const wetR: f32 = chRead(chR, center - lfo * depthS);
        outL = mono * 0.5 + wetL * 0.7;
        outR = mono * 0.5 + wetR * 0.7;
      } else {
        // TREMOLO: faster amplitude modulation, L/R out of phase
        const aL: f32 = 1.0 - tremDepth * 0.5 * (0.5 + 0.5 * lfo);
        const aR: f32 = 1.0 - tremDepth * 0.5 * (0.5 - 0.5 * lfo);
        outL = mono * aL; outR = mono * aR;
      }
    }

    outL = f32(Mathf.tanh(outL * outGain));
    outR = f32(Mathf.tanh(outR * outGain));
    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }
}
