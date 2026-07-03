// =====================================================================
//  AURORA VA — a polyphonic virtual-analog synthesizer modelled
//  control-for-control on the Clavia Nord Lead 2 (Nord Lead 2 English
//  User Manual v1.0, read cover to cover). Every front-panel program
//  parameter in the manual's MIDI Controller list is represented here.
//
//  OSC1 (man. p.37): sine / triangle / sawtooth / pulse.
//  OSC2 (p.38): triangle / sawtooth / pulse / noise, Semitone +/-60,
//    Fine +/-1 semitone, Keyboard-Track on/off.
//  BOTH (p.39-41): linear FM (OSC2 -> OSC1), Ring Mod, hard Sync,
//    shared Pulse Width, OSC1<->OSC2 Mix. Ring Mod + Sync combinable;
//    with Ring Mod the FM knob acts as an OSC2 tune (+/-1 oct).
//  FILTER (p.42-47): 5 types LP12 / LP24 / HP24 / BP / Notch+LP,
//    Frequency, Resonance, bipolar Env Amount + ADSR filter envelope,
//    Velocity switch, Keyboard-Track 1/3 - 2/3 - full, Distortion.
//  AMPLIFIER (p.41): ADSR + Gain.
//  LFO 1 (p.47-48): soft-rnd / square / tri / saw / random, Rate,
//    Amount, dest FM / OSC1+2 / OSC2 / Filter / PW.
//  LFO 2 / ARP (p.49-51): LFO2 triangle mod (OSC1+2 / Amp / Filter) +
//    Up/Down/U&D/Rnd/Echo arpeggiator, 1-4 oct range, Hold.
//  MOD ENV (p.51-53): Attack, Decay, bipolar Amount, dest FM/PW/OSC2.
//  MOD WHEEL (p.53-54): Morph / LFO1 / OSC2 / FM / Filter.
//  PLAY (p.54-56): Poly / Legato / Mono, Unison, Portamento + Auto,
//    Octave Shift, Bend Range, Master Tune, Volume.
//
//  Switch groups are bit-packed; the GUI decodes them. Morph is a
//  mod-wheel macro; Percussion Kits / Performances / Split / storage are
//  host concerns and out of scope. Pure algorithm, allocation-free.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 16;
const HELD_MAX: i32 = 16;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_OSC1WAVE: i32 = 0;     // 0 sine, 1 tri, 2 saw, 3 pulse
const P_OSC2WAVE: i32 = 1;     // 0 tri, 1 saw, 2 pulse, 3 noise
const P_OSC2SEMI: i32 = 2;     // -1..1 -> +/-60 semitone (quantized)
const P_OSC2FINE: i32 = 3;     // -1..1 -> +/-1 semitone
const P_FM: i32 = 4;
const P_PW: i32 = 5;
const P_MIX: i32 = 6;          // 0 = OSC1 only .. 1 = OSC2 only
const P_OSCSW: i32 = 7;        // b0 ringmod, b1 sync, b2 osc2 kbdtrack
const P_CUTOFF: i32 = 8;
const P_RESO: i32 = 9;
const P_FENV: i32 = 10;
const P_FA: i32 = 11;
const P_FD: i32 = 12;
const P_FS: i32 = 13;
const P_FR: i32 = 14;
const P_FTYPE: i32 = 15;       // 0 LP12,1 LP24,2 HP24,3 BP,4 Notch+LP
const P_FILTSW: i32 = 16;      // b0 velocity, b1-2 kbdtrack(0..3), b3 distortion
const P_AA: i32 = 17;
const P_AD: i32 = 18;
const P_AS: i32 = 19;
const P_AR: i32 = 20;
const P_GAIN: i32 = 21;
const P_L1RATE: i32 = 22;
const P_L1AMT: i32 = 23;
const P_L1WAVE: i32 = 24;      // 0 soft-rnd,1 square,2 tri,3 saw,4 random
const P_L1DEST: i32 = 25;      // 0 FM,1 OSC1+2,2 OSC2,3 Filter,4 PW
const P_L2RATE: i32 = 26;
const P_L2AMT: i32 = 27;
const P_L2DEST: i32 = 28;      // 0 OSC1+2,1 Amp,2 Filter
const P_ARPMODE: i32 = 29;     // 0 up,1 down,2 u&d,3 rnd,4 echo
const P_ARPRANGE: i32 = 30;    // 0 off,1..4 octaves / echo repeats
const P_L2SW: i32 = 31;        // b0 arp on, b1 arp hold
const P_MEA: i32 = 32;
const P_MED: i32 = 33;
const P_MEAMT: i32 = 34;       // -1..1 bipolar
const P_MEDEST: i32 = 35;      // 0 FM,1 PW,2 OSC2
const P_WHDEST: i32 = 36;      // 0 morph,1 lfo1,2 osc2,3 fm,4 filter
const P_WHEEL: i32 = 37;
const P_PLAY: i32 = 38;        // 0 poly,1 legato,2 mono
const P_PERFSW: i32 = 39;      // b0 unison, b1 porta auto
const P_PORTA: i32 = 40;
const P_OCT: i32 = 41;         // 0..4 -> -2..+2 oct
const P_BENDRANGE: i32 = 42;   // 0..24 semitones
const P_BENDER: i32 = 43;      // -1..1
const P_TUNE: i32 = 44;        // -1..1 -> +/-50 cent
const P_VOLUME: i32 = 45;
const P_MORPH: i32 = 46;

const NUM_PARAMS: i32 = 47;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + (params[i] >= 0.0 ? 0.5 : -0.5)); }

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

// ADSR times: Attack 1 ms..5 s ; Decay/Release 1 ms..10 s
@inline function atkTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(5000.0, clampf(n, 0.0, 1.0))); }
@inline function drTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(n, 0.0, 1.0))); }

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1b:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // unison detune copy
const vPh2b:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPrevO2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // last OSC2 out (FM)
const vPrevO2b:StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
// amp ADSR
const vAE:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAst: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
// filter ADSR
const vFE:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFst: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
// mod (AD) envelope
const vME:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vMst: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 A, 2 D, 0 done
// per-voice ladder filter
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// held-key list (mono priority / arp)
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hPhys:  StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// global LFOs + arp
let lfo1Phase: f32 = 0.0;
let lfo1SH: f32 = 0.0;
let lfo1SoftT: f32 = 0.0;   // soft-random target
let lfo1SoftC: f32 = 0.0;   // soft-random current
let lfo2Phase: f32 = 0.0;
let lastL2sw: i32 = 0;
let lastPlay: i32 = -1;

let arpPos: i32 = 0;
let arpClock: f32 = 0.0;
let echoCount: i32 = 0;
const sortIdx: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 1.0;
    vCur[v] = 261.63; vTarget[v] = 261.63; vGlideK[v] = 1.0;
    vPh1[v] = 0.11 * f32(v); vPh2[v] = 0.23 * f32(v);
    vPh1b[v] = 0.37 * f32(v); vPh2b[v] = 0.53 * f32(v);
    vPrevO2[v] = 0.0; vPrevO2b[v] = 0.0;
    vAE[v] = 0.0; vAst[v] = 0; vFE[v] = 0.0; vFst[v] = 0; vME[v] = 0.0; vMst[v] = 0;
    vLp0[v] = 0.0; vLp1[v] = 0.0; vLp2[v] = 0.0; vLp3[v] = 0.0;
  }
  hCount = 0; orderCounter = 0; ageCounter = 1; lastPlayedHz = 261.63;
  lfo1Phase = 0.0; lfo1SH = 0.0; lfo1SoftT = 0.0; lfo1SoftC = 0.0;
  lfo2Phase = 0.0; lastL2sw = 0; lastPlay = -1;
  arpPos = 0; arpClock = 0.0; echoCount = 0;

  // boot state = spec.json defaults
  params[P_OSC1WAVE] = 2.0; params[P_OSC2WAVE] = 1.0; params[P_OSC2SEMI] = 0.0;
  params[P_OSC2FINE] = 0.02; params[P_FM] = 0.0; params[P_PW] = 0.35;
  params[P_MIX] = 0.4; params[P_OSCSW] = 4.0;
  params[P_CUTOFF] = 0.5; params[P_RESO] = 0.2; params[P_FENV] = 0.4;
  params[P_FA] = 0.01; params[P_FD] = 0.4; params[P_FS] = 0.3; params[P_FR] = 0.3;
  params[P_FTYPE] = 1.0; params[P_FILTSW] = 4.0;
  params[P_AA] = 0.01; params[P_AD] = 0.5; params[P_AS] = 0.7; params[P_AR] = 0.3;
  params[P_GAIN] = 0.8;
  params[P_L1RATE] = 0.3; params[P_L1AMT] = 0.0; params[P_L1WAVE] = 2.0; params[P_L1DEST] = 1.0;
  params[P_L2RATE] = 0.4; params[P_L2AMT] = 0.0; params[P_L2DEST] = 0.0;
  params[P_ARPMODE] = 0.0; params[P_ARPRANGE] = 0.0; params[P_L2SW] = 0.0;
  params[P_MEA] = 0.0; params[P_MED] = 0.3; params[P_MEAMT] = 0.0; params[P_MEDEST] = 0.0;
  params[P_WHDEST] = 1.0; params[P_WHEEL] = 0.0;
  params[P_PLAY] = 0.0; params[P_PERFSW] = 0.0; params[P_PORTA] = 0.0;
  params[P_OCT] = 2.0; params[P_BENDRANGE] = 2.0; params[P_BENDER] = 0.0;
  params[P_TUNE] = 0.0; params[P_VOLUME] = 0.75; params[P_MORPH] = 0.3;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- portamento ------------------------------------------------------
function computeGlideK(v: i32): void {
  const t: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  const autoMode: i32 = (pbits(P_PERFSW) >> 1) & 1;
  vGlideK[v] = 1.0;
  if (t <= 0.002) { vCur[v] = vTarget[v]; return; }
  void autoMode; // Auto handled by caller (legato flag decides glide)
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  const secPerOct: f32 = 0.006 * f32(Mathf.pow(500.0, t)); // ~6 ms .. ~3 s / octave
  const step: f32 = f32(Mathf.pow(2.0, 1.0 / (secPerOct * sampleRate)));
  vGlideK[v] = vTarget[v] > vCur[v] ? step : 1.0 / step;
}

function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function triggerVoice(slot: i32, id: i32, hz: f32, vel: f32, retrig: i32, glide: i32): void {
  vNote[slot] = id;
  vTarget[slot] = hz > 0.0 ? hz : 1.0;
  if (vActive[slot] == 0 || retrig == 1) {
    if (glide == 0) vCur[slot] = lastPlayedHz;
    vAst[slot] = 1; vFst[slot] = 1; vMst[slot] = 1; vME[slot] = 0.0;
    if (vActive[slot] == 0) {
      vAE[slot] = 0.0; vFE[slot] = 0.0;
      vLp0[slot] = 0.0; vLp1[slot] = 0.0; vLp2[slot] = 0.0; vLp3[slot] = 0.0;
    }
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot);
  vAge[slot] = ageCounter++;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++)
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) { vGate[i] = 0; vAst[i] = 4; vFst[i] = 4; }
}
function releaseAllVoices(): void {
  for (let i = 0; i < NUM_VOICES; i++)
    if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vAst[i] = 4; vFst[i] = 4; }
}
function physCount(): i32 {
  let c: i32 = 0; for (let i = 0; i < hCount; i++) if (hPhys[i] == 1) c++;
  return c;
}

// mono / legato: last-note priority single voice (slot 0)
function monoStack(newPress: i32): void {
  const play: i32 = pbits(P_PLAY);   // 1 legato, 2 mono
  if (hCount == 0) { releaseAllVoices(); return; }
  let pick: i32 = 0;
  for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i;
  const legatoPlaying: i32 = physCount() > 1 ? 1 : 0;
  // legato mode never retriggers on legato; mono always retriggers
  let retrig: i32 = 1;
  if (newPress == 1 && play == 1 && legatoPlaying == 1) retrig = 0;
  const glide: i32 = legatoPlaying == 1 ? 1 : 0;
  triggerVoice(0, hId[pick], hFreq[pick], hVel[pick], retrig, glide);
  for (let s = 1; s < NUM_VOICES; s++)
    if (vActive[s] == 1 && vGate[s] == 1) { vGate[s] = 0; vAst[s] = 4; vFst[s] = 4; }
  lastPlayedHz = hFreq[pick];
}

function heldAdd(id: i32, hz: f32, vel: f32): void {
  const hold: i32 = (pbits(P_L2SW) >> 1) & 1;
  const arpOn: i32 = pbits(P_L2SW) & 1;
  if (arpOn == 1 && hold == 1 && physCount() == 0 && hCount > 0) { hCount = 0; releaseAllVoices(); }
  for (let i = 0; i < hCount; i++)
    if (hId[i] == id) { hPhys[i] = 1; hFreq[i] = hz; hVel[i] = vel; hOrder[i] = orderCounter++; return; }
  if (hCount >= HELD_MAX) {
    for (let i = 1; i < hCount; i++) {
      hId[i-1]=hId[i]; hFreq[i-1]=hFreq[i]; hVel[i-1]=hVel[i]; hPhys[i-1]=hPhys[i]; hOrder[i-1]=hOrder[i];
    }
    hCount--;
  }
  hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = vel; hPhys[hCount] = 1; hOrder[hCount] = orderCounter++;
  hCount++;
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i+1; j < hCount; j++) {
        hId[j-1]=hId[j]; hFreq[j-1]=hFreq[j]; hVel[j-1]=hVel[j]; hPhys[j-1]=hPhys[j]; hOrder[j-1]=hOrder[j];
      }
      hCount--; return;
    }
  }
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const wasIdle: i32 = hCount == 0 ? 1 : 0;
  heldAdd(id, hz, vel);
  const arpOn: i32 = pbits(P_L2SW) & 1;
  const arpActive: i32 = (arpOn == 1 && pbits(P_ARPRANGE) > 0) ? 1 : 0;
  if (wasIdle == 1) { arpPos = 0; arpClock = 0.0; echoCount = 0; }
  if (arpActive == 1) return;                       // arp owns the voices
  const play: i32 = pbits(P_PLAY);
  if (play >= 1) { monoStack(1); return; }           // legato / mono
  // poly
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  triggerVoice(slot, id, hz, vel, 1, physCount() > 1 ? 1 : 0);
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  const sw: i32 = pbits(P_L2SW);
  const arpOn: i32 = sw & 1;
  const hold: i32 = (sw >> 1) & 1;
  const arpActive: i32 = (arpOn == 1 && pbits(P_ARPRANGE) > 0) ? 1 : 0;
  if ((arpActive == 1 || arpOn == 1) && hold == 1) {
    for (let i = 0; i < hCount; i++) if (hId[i] == id) hPhys[i] = 0; return;
  }
  heldRemove(id);
  const play: i32 = pbits(P_PLAY);
  if (arpActive == 1) { if (hCount == 0) releaseAllVoices(); return; }
  if (play >= 1) { if (hCount == 0) releaseAllVoices(); else monoStack(0); return; }
  releaseId(id);
}

// ---- LFO1 shape (p.48) ----------------------------------------------
@inline function lfo1ShapeVal(shp: i32, ph: f32): f32 {
  if (shp == 0) return lfo1SoftC;              // soft random (smoothed)
  if (shp == 1) return ph < 0.5 ? 1.0 : -1.0;  // square
  if (shp == 2) return ph < 0.5 ? (4.0*ph-1.0) : (3.0-4.0*ph); // triangle
  if (shp == 3) return 1.0 - 2.0 * ph;         // sawtooth (falling)
  return lfo1SH;                               // random S&H
}

// ---- arpeggiator step (p.49-51) -------------------------------------
function arpStep(): void {
  if (hCount == 0) return;
  const mode: i32 = pbits(P_ARPMODE);
  const range: i32 = pbits(P_ARPRANGE);   // 1..4 octaves

  // ECHO mode: replay the most-recent note repeatedly with fading velocity
  if (mode == 4) {
    let pick: i32 = 0;
    for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i;
    const repeats: i32 = range * 2;         // 0..8 echoes
    if (echoCount >= repeats) return;
    echoCount++;
    const vel: f32 = hVel[pick] * f32(Mathf.pow(0.72, f32(echoCount)));
    const slot: i32 = allocVoice();
    triggerVoice(slot, -900, hFreq[pick], vel, 1, 0);
    lastPlayedHz = hFreq[pick];
    return;
  }

  const total: i32 = hCount * range;
  for (let i = 0; i < hCount; i++) sortIdx[i] = i;
  for (let i = 1; i < hCount; i++) {
    const key: i32 = sortIdx[i]; let j: i32 = i - 1;
    while (j >= 0 && hFreq[sortIdx[j]] > hFreq[key]) { sortIdx[j+1] = sortIdx[j]; j--; }
    sortIdx[j+1] = key;
  }
  let slotPos: i32 = 0;
  if (mode == 0) { slotPos = arpPos % total; arpPos++; }
  else if (mode == 1) { slotPos = total - 1 - (arpPos % total); arpPos++; }
  else if (mode == 2) {
    if (total <= 1) slotPos = 0;
    else { const period: i32 = total*2-2; const p: i32 = arpPos % period; slotPos = p < total ? p : period - p; }
    arpPos++;
  } else {
    let r: i32 = rngState; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; rngState = r;
    slotPos = (r & 0x7fffffff) % total;
  }
  const noteI: i32 = sortIdx[slotPos % hCount];
  const oct: i32 = slotPos / hCount;
  const hz: f32 = hFreq[noteI] * f32(1 << oct);
  const slot: i32 = allocVoice();
  triggerVoice(slot, -900, hz, hVel[noteI], 1, 0);
  lastPlayedHz = hz;
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- edges: arp/hold + play mode -----------------------------------
  const sw: i32 = pbits(P_L2SW);
  const arpOn: i32 = sw & 1;
  const hold: i32 = (sw >> 1) & 1;
  const arpActive: i32 = (arpOn == 1 && pbits(P_ARPRANGE) > 0) ? 1 : 0;
  if (((lastL2sw & 1) == 1) && arpOn == 0) {
    for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == -900) { vGate[i] = 0; vAst[i] = 4; vFst[i] = 4; }
  }
  if (((lastL2sw >> 1) & 1) == 1 && hold == 0) {
    for (let i = hCount - 1; i >= 0; i--) if (hPhys[i] == 0) { heldRemove(hId[i]); }
    if (hCount == 0) releaseAllVoices();
  }
  lastL2sw = sw;

  const play: i32 = pbits(P_PLAY);
  if (play != lastPlay && lastPlay >= 0) {
    if (play >= 1) { if (hCount > 0 && arpActive == 0) monoStack(0); }
    else if (lastPlay >= 1) {
      releaseAllVoices();
      if (arpActive == 0) for (let i = 0; i < hCount && i < NUM_VOICES; i++) { const s: i32 = allocVoice(); triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0); }
    }
  }
  lastPlay = play;

  // ---- per-block parameter mapping -----------------------------------
  const w1: i32 = pbits(P_OSC1WAVE);
  const w2: i32 = pbits(P_OSC2WAVE);
  const semi: f32 = f32(Mathf.round(clampf(pget(P_OSC2SEMI), -1.0, 1.0) * 60.0));
  const fine: f32 = clampf(pget(P_OSC2FINE), -1.0, 1.0);
  const oscSw: i32 = pbits(P_OSCSW);
  const ringMod: i32 = oscSw & 1;
  const sync: i32 = (oscSw >> 1) & 1;
  const osc2Kbd: i32 = (oscSw >> 2) & 1;

  const fmKnob: f32 = clampf(pget(P_FM), 0.0, 1.0);
  const fmBase: f32 = ringMod == 1 ? 0.0 : fmKnob;                 // ring: FM knob -> tune
  const ringTuneMul: f32 = ringMod == 1 ? f32(Mathf.pow(2.0, (fmKnob*2.0-1.0))) : 1.0; // +/-1 oct
  const pwKnob: f32 = clampf(pget(P_PW), 0.0, 1.0);
  const mix: f32 = clampf(pget(P_MIX), 0.0, 1.0);

  const cutN: f32 = clampf(pget(P_CUTOFF), 0.0, 1.0);
  const fcBase: f32 = 16.0 * f32(Mathf.pow(2.0, cutN * 10.3));
  const resN: f32 = clampf(pget(P_RESO), 0.0, 1.0);
  const kRes: f32 = resN * 4.3;
  const fEnvAmt: f32 = clampf(pget(P_FENV), 0.0, 1.0);
  const ftype: i32 = pbits(P_FTYPE);
  const filtSw: i32 = pbits(P_FILTSW);
  const fVelOn: i32 = filtSw & 1;
  const fKbd: i32 = (filtSw >> 1) & 3;         // 0 off,1 1/3,2 2/3,3 full
  const fKbdAmt: f32 = f32(fKbd) / 3.0;
  const distOn: i32 = (filtSw >> 3) & 1;

  const gain: f32 = clampf(pget(P_GAIN), 0.0, 1.0);

  // envelope base times
  const aa: f32 = atkTime(pget(P_AA)); const ad: f32 = drTime(pget(P_AD));
  const asu: f32 = clampf(pget(P_AS),0.0,1.0); const ar: f32 = drTime(pget(P_AR));
  const fa: f32 = atkTime(pget(P_FA)); const fd: f32 = drTime(pget(P_FD));
  const fsu: f32 = clampf(pget(P_FS),0.0,1.0); const fr: f32 = drTime(pget(P_FR));
  const mea: f32 = atkTime(pget(P_MEA)); const med: f32 = drTime(pget(P_MED));
  const aAk: f32 = 1.0/(aa*sr); const aDk: f32 = 1.0-f32(Mathf.exp(-4.0/(ad*sr))); const aRk: f32 = 1.0-f32(Mathf.exp(-4.0/(ar*sr)));
  const fAk: f32 = 1.0/(fa*sr); const fDk: f32 = 1.0-f32(Mathf.exp(-4.0/(fd*sr))); const fRk: f32 = 1.0-f32(Mathf.exp(-4.0/(fr*sr)));
  const mAk: f32 = 1.0/(mea*sr); const mDk: f32 = 1.0-f32(Mathf.exp(-4.0/(med*sr)));
  const meAmt: f32 = clampf(pget(P_MEAMT), -1.0, 1.0);
  const meDest: i32 = pbits(P_MEDEST);

  // LFO1
  const l1Hz: f32 = 0.03 * f32(Mathf.pow(1000.0, clampf(pget(P_L1RATE),0.0,1.0))); // 0.03..30 Hz
  const l1Inc: f32 = l1Hz / sr;
  const l1Amt: f32 = clampf(pget(P_L1AMT), 0.0, 1.0);
  const l1Wave: i32 = pbits(P_L1WAVE);
  const l1Dest: i32 = pbits(P_L1DEST);
  // LFO2
  const l2Hz: f32 = 0.03 * f32(Mathf.pow(1000.0, clampf(pget(P_L2RATE),0.0,1.0)));
  const l2Inc: f32 = l2Hz / sr;
  const l2Amt: f32 = clampf(pget(P_L2AMT), 0.0, 1.0);
  const l2Dest: i32 = pbits(P_L2DEST);
  const arpInc: f32 = (2.0 + clampf(pget(P_L2RATE),0.0,1.0)*18.0) / sr; // 2..20 Hz

  // mod wheel
  const whDest: i32 = pbits(P_WHDEST);
  const wheel: f32 = clampf(pget(P_WHEEL), 0.0, 1.0);
  const morphAmt: f32 = clampf(pget(P_MORPH), 0.0, 1.0);
  const whMorph: f32 = whDest == 0 ? wheel * morphAmt : 0.0;
  const whL1: f32 = whDest == 1 ? wheel : 0.0;
  const whOsc2: f32 = whDest == 2 ? wheel : 0.0;
  const whFM: f32 = whDest == 3 ? wheel : 0.0;
  const whFilt: f32 = whDest == 4 ? wheel : 0.0;

  // performance
  const unison: i32 = pbits(P_PERFSW) & 1;
  const octShift: f32 = f32(pbits(P_OCT) - 2);  // -2..+2 oct
  const bendRange: f32 = clampf(pget(P_BENDRANGE), 0.0, 24.0);
  const bender: f32 = clampf(pget(P_BENDER), -1.0, 1.0);
  const bendOct: f32 = bender * bendRange / 12.0;
  const tuneMul: f32 = f32(Mathf.pow(2.0, clampf(pget(P_TUNE),-1.0,1.0) * 50.0/1200.0));
  const globalMul: f32 = tuneMul * f32(Mathf.pow(2.0, octShift + bendOct));
  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.6;
  const voiceScale: f32 = 0.42;

  // Unison spread widens in Mono/Legato (4-voice stack) vs Poly (2-voice), p.55
  const uniCents: f32 = play >= 1 ? 15.0 : 7.0;
  const uniDet: f32 = f32(Mathf.pow(2.0, uniCents/1200.0));

  for (let f = 0; f < n; f++) {
    // ---- LFO1 ---------------------------------------------------------
    const p1prev: f32 = lfo1Phase;
    lfo1Phase += l1Inc;
    if (lfo1Phase >= 1.0) {
      lfo1Phase -= 1.0;
      lfo1SH = rngf();
      lfo1SoftT = rngf();
    }
    lfo1SoftC += (lfo1SoftT - lfo1SoftC) * clampf(l1Inc * 6.0, 0.0005, 0.5);
    void p1prev;
    const l1raw: f32 = lfo1ShapeVal(l1Wave, lfo1Phase);
    // LFO2 (always triangle)
    lfo2Phase += l2Inc; if (lfo2Phase >= 1.0) lfo2Phase -= 1.0;
    const l2raw: f32 = lfo2Phase < 0.5 ? (4.0*lfo2Phase-1.0) : (3.0-4.0*lfo2Phase);

    // ---- arp clock ----------------------------------------------------
    if (arpActive == 1 && hCount > 0) {
      arpClock += arpInc;
      if (arpClock >= 1.0) { arpClock -= 1.0; arpStep(); }
    }

    // LFO1 effective amount (mod wheel -> LFO1)
    const l1eff: f32 = clampf(l1Amt + whL1, 0.0, 1.0);
    const l1v: f32 = l1raw * l1eff;
    const l2v: f32 = l2raw * l2Amt;

    // LFO/wheel routing to shared destinations
    const lfoFM: f32   = (l1Dest == 0 ? l1v : 0.0);
    const lfoOsc12: f32= (l1Dest == 1 ? l1v : 0.0) + (l2Dest == 0 ? l2v : 0.0);
    const lfoOsc2: f32 = (l1Dest == 2 ? l1v : 0.0);
    const lfoFilt: f32 = (l1Dest == 3 ? l1v : 0.0) + (l2Dest == 2 ? l2v : 0.0);
    const lfoPW: f32   = (l1Dest == 4 ? l1v : 0.0);

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // glide
      let cur: f32 = vCur[v]; const tgt: f32 = vTarget[v];
      if (cur != tgt) {
        const gk: f32 = vGlideK[v];
        if (gk == 1.0) cur = tgt;
        else { cur *= gk; if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt; }
        vCur[v] = cur;
      }

      // amp ADSR
      let ae: f32 = vAE[v]; const ast: i32 = vAst[v];
      if (ast == 1) { ae += aAk; if (ae >= 1.0) { ae = 1.0; vAst[v] = 2; } }
      else if (ast == 2) { ae += (asu - ae) * aDk; }
      else if (ast == 4) { ae += (0.0 - ae) * aRk; if (ae <= 0.0004) ae = 0.0; }
      vAE[v] = ae;
      if (vGate[v] == 0 && ae <= 0.0005 && ast == 4) { vActive[v] = 0; continue; }

      // filter ADSR
      let fe: f32 = vFE[v]; const fst: i32 = vFst[v];
      if (fst == 1) { fe += fAk; if (fe >= 1.0) { fe = 1.0; vFst[v] = 2; } }
      else if (fst == 2) { fe += (fsu - fe) * fDk; }
      else if (fst == 4) { fe += (0.0 - fe) * fRk; if (fe <= 0.0004) fe = 0.0; }
      vFE[v] = fe;

      // mod AD env (restart from 0 each note, p.52)
      let me: f32 = vME[v]; const mst: i32 = vMst[v];
      if (mst == 1) { me += mAk; if (me >= 1.0) { me = 1.0; vMst[v] = 2; } }
      else if (mst == 2) { me += (0.0 - me) * mDk; if (me <= 0.0004) { me = 0.0; vMst[v] = 0; } }
      vME[v] = me;
      const meSig: f32 = me * meAmt;   // bipolar

      // ---- oscillator frequency assembly -------------------------------
      const pitchOsc12: f32 = lfoOsc12;                 // octaves (vibrato)
      const meOsc2: f32 = meDest == 2 ? meSig * 4.0 : 0.0;
      const pitchOsc2Extra: f32 = lfoOsc2 + whOsc2 * 2.0 + meOsc2;

      const baseHz: f32 = cur * globalMul * f32(Mathf.pow(2.0, pitchOsc12));
      let hz1: f32 = baseHz;
      // OSC2 tuning: semitone + fine (+ ring tune) + kbd-track
      let osc2Root: f32 = osc2Kbd == 1 ? baseHz : 261.63 * globalMul * f32(Mathf.pow(2.0, pitchOsc12));
      let hz2: f32 = osc2Root * f32(Mathf.pow(2.0, semi/12.0 + fine/12.0 + pitchOsc2Extra)) * ringTuneMul;

      // FM depth (osc + modenv + lfo + wheel)
      let fmDepth: f32 = fmBase;
      if (meDest == 0) fmDepth += meSig;
      fmDepth += lfoFM + whFM;
      if (fmDepth < 0.0) fmDepth = 0.0;

      // pulse width (base + LFO/PW + modenv/PW)
      let pw: f32 = 0.5 - pwKnob * 0.45;
      pw += lfoPW * 0.4;
      if (meDest == 1) pw += meSig * 0.4;
      pw = clampf(pw, 0.05, 0.95);

      // ---- render one oscillator pair (a = primary, optional b = unison)
      let sig: f32 = renderPair(v, hz1, hz2, w1, w2, pw, fmDepth, ringMod, sync, mix, 0);
      if (unison == 1) {
        sig = sig * 0.6 + renderPair(v, hz1*uniDet, hz2/uniDet, w1, w2, pw, fmDepth, ringMod, sync, mix, 1) * 0.6;
      }

      // ---- filter cutoff assembly -------------------------------------
      const keyOct: f32 = f32(Mathf.log2(clampf(cur, 8.0, 8000.0) / 261.63));
      let velScale: f32 = fVelOn == 1 ? vVel[v] : 1.0;
      let fcOct: f32 = fEnvAmt * velScale * fe * 7.0
                     + fKbdAmt * keyOct
                     + lfoFilt * 4.0
                     + whFilt * 4.0
                     + whMorph * 5.0;
      let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
      fc = clampf(fc, 8.0, sr * 0.45);
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr)); if (g > 0.99) g = 0.99;

      let s0: f32 = vLp0[v]; let s1: f32 = vLp1[v]; let s2: f32 = vLp2[v]; let s3: f32 = vLp3[v];
      let inp: f32 = sig - kRes * s3;
      inp = f32(Mathf.tanh(inp));
      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);
      vLp0[v] = s0; vLp1[v] = s1; vLp2[v] = s2; vLp3[v] = s3;

      // filter type taps (p.43-44)
      let y: f32;
      const mk: f32 = 1.0 + kRes * 0.5;
      if (ftype == 0)      y = s1 * mk;                     // LP 12dB
      else if (ftype == 1) y = s3 * (1.0 + kRes * 0.75);    // LP 24dB
      else if (ftype == 2) y = (sig - s3) * (1.0 + kRes * 0.5); // HP 24dB (steep)
      else if (ftype == 3) y = (s0 - s3) * (1.0 + kRes);    // BP
      else                 y = (sig - (s0 - s3));           // Notch + LP

      // distortion (p.47)
      if (distOn == 1) y = f32(Mathf.tanh(y * 3.0)) * 0.7;

      // VCA (amp env + LFO2 tremolo, p.51)
      let amp: f32 = ae * gain;
      if (l2Dest == 1) amp *= (1.0 - 0.5 * l2Amt * (0.5 + 0.5 * l2raw));

      mono += y * amp;
    }

    mono *= voiceScale;
    let outv: f32 = f32(Mathf.tanh(mono * outGain));
    outBuf[f] = outv;
    outBuf[MAX_FRAMES + f] = outv;
  }
}

// render OSC1+OSC2 for a voice; which=0 primary phase set, 1 unison set
function renderPair(v: i32, hz1: f32, hz2: f32, w1: i32, w2: i32, pw: f32,
                    fmDepth: f32, ringMod: i32, sync: i32, mix: f32, which: i32): f32 {
  const sr: f32 = sampleRate;
  const prevO2: f32 = which == 0 ? vPrevO2[v] : vPrevO2b[v];

  // OSC1 frequency FM-modulated by OSC2's previous output (1-sample delay)
  let f1: f32 = hz1 * (1.0 + fmDepth * prevO2 * 3.0);
  let inc1: f32 = f1 / sr; if (inc1 > 0.45) inc1 = 0.45; if (inc1 < 0.0) inc1 = 0.0;
  let ph1: f32 = (which == 0 ? vPh1[v] : vPh1b[v]) + inc1;
  const wrap1: i32 = ph1 >= 1.0 ? 1 : 0; if (ph1 >= 1.0) ph1 -= 1.0;
  if (which == 0) vPh1[v] = ph1; else vPh1b[v] = ph1;

  let inc2: f32 = hz2 / sr; if (inc2 > 0.45) inc2 = 0.45; if (inc2 < 0.0) inc2 = 0.0;
  let ph2: f32 = (which == 0 ? vPh2[v] : vPh2b[v]) + inc2; if (ph2 >= 1.0) ph2 -= 1.0;
  if (sync == 1 && wrap1 == 1) ph2 = 0.0;
  if (which == 0) vPh2[v] = ph2; else vPh2b[v] = ph2;

  // OSC2 (tri / saw / pulse / noise)
  let osc2: f32 = 0.0;
  if (w2 == 0) osc2 = ph2 < 0.5 ? (4.0*ph2-1.0) : (3.0-4.0*ph2);
  else if (w2 == 1) { osc2 = 2.0*ph2 - 1.0; osc2 -= polyBlep(ph2, inc2); }
  else if (w2 == 2) { osc2 = ph2 < pw ? 1.0 : -1.0; osc2 += polyBlep(ph2, inc2);
                      let q: f32 = ph2 - pw; if (q < 0.0) q += 1.0; osc2 -= polyBlep(q, inc2); }
  else osc2 = rngf();
  if (which == 0) vPrevO2[v] = osc2; else vPrevO2b[v] = osc2;

  // OSC1 (sine / tri / saw / pulse)
  let osc1: f32 = 0.0;
  if (w1 == 0) osc1 = Mathf.sin(TWO_PI * ph1);
  else if (w1 == 1) osc1 = ph1 < 0.5 ? (4.0*ph1-1.0) : (3.0-4.0*ph1);
  else if (w1 == 2) { osc1 = 2.0*ph1 - 1.0; osc1 -= polyBlep(ph1, inc1); }
  else { osc1 = ph1 < pw ? 1.0 : -1.0; osc1 += polyBlep(ph1, inc1);
         let q: f32 = ph1 - pw; if (q < 0.0) q += 1.0; osc1 -= polyBlep(q, inc1); }

  // mix + ring mod (ring multiplies the two, affects the OSC2 leg)
  const o2leg: f32 = ringMod == 1 ? osc1 * osc2 : osc2;
  return osc1 * (1.0 - mix) + o2leg * mix;
}
