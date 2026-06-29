// =====================================================================
//  REED PIANO — polyphonic electric reed-piano instrument
//  Models a struck-steel-reed electric piano (the warm 60s school-piano
//  voice): a reed tone with a hollow, slightly hard/barky attack and a
//  built-in tremolo. Distinct from a tine Rhodes — here the body is a
//  reed-like blend of odd-ish partials run through an ASYMMETRIC soft
//  clipper whose drive tracks both velocity and a fast "bark" envelope,
//  so hard hits growl and bark on the attack then mellow into a hollow
//  sustain. A per-voice amp envelope (snappy attack + decay/release) and
//  a one-pole tone low-pass finish each voice; a global sine tremolo
//  (amplitude modulation) wobbles the whole instrument.
//  Pure algorithm — no samples, no host imports, no allocation in process.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_VOICES: i32 = 12;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831853071795864769;
const PI:     f32 = 3.1415926535897932385;

// ---- per-voice state (parallel StaticArrays, no allocation in process) ----
const vActive: StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = in use
const vGate:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = key held
const vNote:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // note id
const vPhase:  StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // reed phase (radians)
const vFreq:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // fundamental Hz
const vVel:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // 0..1
const vAmp:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // current amp-env level
const vBark:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // fast bark env (0..1, decays)
const vAge:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // voice-steal LRU
const vTone:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // per-voice tone LP state
const vDc:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // DC blocker state (asym clip)
const vDcX:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // DC blocker prev input

let ageCounter: f32 = 0.0;
let tremPhase:  f32 = 0.0; // global tremolo LFO phase (radians)

// ---- parameter indices (MUST match spec.json) ----
const P_BARK:   i32 = 0; // attack drive / hardness of the bark   (0..1)
const P_DECAY:  i32 = 1; // body decay time while held            (0..1)
const P_TONE:   i32 = 2; // tone tilt low-pass cutoff             (0..1)
const P_TREMD:  i32 = 3; // tremolo depth                         (0..1)
const P_TREMR:  i32 = 4; // tremolo rate                          (0..1)
const P_LEVEL:  i32 = 5; // output level                          (0..1)

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let v = 0; v < MAX_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    vPhase[v] = 0.0; vFreq[v] = 0.0; vVel[v] = 0.0;
    vAmp[v] = 0.0; vBark[v] = 0.0; vAge[v] = 0.0;
    vTone[v] = 0.0; vDc[v] = 0.0; vDcX[v] = 0.0;
  }
  ageCounter = 0.0;
  tremPhase = 0.0;
  params[P_BARK]  = 0.55;
  params[P_DECAY] = 0.55;
  params[P_TONE]  = 0.5;
  params[P_TREMD] = 0.35;
  params[P_TREMR] = 0.4;
  params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Asymmetric soft clipper — the classic reed "bark". Positive and negative
// halves saturate differently (tanh-ish via a rational approx) so even
// harmonics appear, giving the hollow, hard-edged growl on hard hits.
@inline function asymShape(x: f32, drive: f32): f32 {
  const a: f32 = x * drive;
  // bias the positive lobe harder than the negative -> asymmetry -> even harmonics
  const pos: f32 = a / (1.0 + a * a);            // soft, rounds toward ±0.5
  const neg: f32 = a / (1.0 + 0.45 * a * a);     // less compressed -> sharper
  const y: f32 = a >= 0.0 ? pos : neg;
  return y * 1.6;
}

// ---- note handling: find a free (or oldest) voice ----
export function noteOn(id: i32, freq: f32, velocity: f32): void {
  if (freq <= 0.0) freq = 1.0;
  let slot: i32 = -1;
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) { slot = v; break; }
  }
  if (slot < 0) {
    for (let v = 0; v < MAX_VOICES; v++) {
      if (vActive[v] == 0) { slot = v; break; }
    }
  }
  if (slot < 0) {
    let oldest: f32 = vAge[0]; slot = 0;
    for (let v = 1; v < MAX_VOICES; v++) {
      if (vAge[v] < oldest) { oldest = vAge[v]; slot = v; }
    }
  }
  ageCounter += 1.0;
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vNote[slot]   = id;
  vFreq[slot]   = freq;
  vVel[slot]    = clampf(velocity, 0.0, 1.0);
  vPhase[slot]  = 0.0;
  vAmp[slot]    = 0.0;
  vBark[slot]   = 1.0;   // bark env starts hot, decays fast -> hard attack, mellow sustain
  vAge[slot]    = ageCounter;
  vTone[slot]   = 0.0;
  vDc[slot]     = 0.0;
  vDcX[slot]    = 0.0;
}

export function noteOff(id: i32): void {
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) vGate[v] = 0;
  }
}

export function process(n: i32): void {
  // ---- resolve params once per block ----
  const barkN:  f32 = clampf(params[P_BARK],  0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE],  0.0, 1.0);
  const tremD:  f32 = clampf(params[P_TREMD], 0.0, 1.0);
  const tremR:  f32 = clampf(params[P_TREMR], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 0.9;

  const invSr: f32 = 1.0 / sampleRate;

  // amp attack: fast, reed-like (1.5 ms .. 8 ms) — always snappy
  const attackSec: f32 = 0.0015 + (1.0 - barkN) * 0.0065;
  const attackCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (attackSec * sampleRate)));

  // body decay while held: 0.6 s .. 6 s
  const decSec: f32 = 0.6 + decayN * decayN * 5.4;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decSec * sampleRate)));
  // release after note-off: a fraction of the held decay, min ~0.12 s
  const relSec: f32 = 0.12 + decayN * 0.9;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relSec * sampleRate)));

  // bark envelope decay: the hard edge mellows in 18 ms .. 80 ms.
  // More Bark = a touch longer growl before it settles.
  const barkSec: f32 = 0.018 + barkN * 0.062;
  const barkCoef: f32 = f32(Mathf.exp(-1.0 / (barkSec * sampleRate)));

  // peak asymmetric drive from Bark (1.2 .. ~9)
  const peakDrive: f32 = 1.2 + barkN * 7.8;

  // tone low-pass cutoff: 700 Hz .. 7 kHz (mellow .. open)
  let toneHz: f32 = 700.0 + toneN * toneN * 6300.0;
  if (toneHz > sampleRate * 0.45) toneHz = sampleRate * 0.45;
  let toneCoef: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  toneCoef = clampf(toneCoef, 0.0, 1.0);

  // tremolo: 3 Hz .. 9 Hz, depth 0..0.9 of amplitude
  const tremHz: f32 = 3.0 + tremR * 6.0;
  const tremInc: f32 = TWO_PI * tremHz * invSr;
  const tremDepth: f32 = tremD * 0.9;

  // DC-blocker pole (asymmetric shaping adds DC offset we must remove)
  const dcR: f32 = 0.9985;

  // ---- clear output block ----
  for (let f = 0; f < n; f++) {
    outBuf[f] = 0.0;
    outBuf[MAX_FRAMES + f] = 0.0;
  }

  // ---- render each active voice (mono sum, copied to both channels) ----
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] == 0) continue;

    const f0: f32 = vFreq[v];
    const inc: f32 = TWO_PI * f0 * invSr;
    const vel: f32 = vVel[v];
    const ampTarget: f32 = 0.25 + vel * 0.75; // velocity sets sustain level
    const gate: i32 = vGate[v];

    let phase: f32 = vPhase[v];
    let amp: f32 = vAmp[v];
    let bark: f32 = vBark[v];
    let tone: f32 = vTone[v];
    let dc: f32 = vDc[v];
    let dcX: f32 = vDcX[v];
    let reachedAttack: bool = amp >= ampTarget * 0.999;

    for (let f = 0; f < n; f++) {
      // bark envelope decays toward 0 -> attack drive collapses to a mellow body
      bark *= barkCoef;

      // amp envelope: snappy attack to target, then decay (held) / release (off)
      if (gate != 0 && !reachedAttack) {
        amp += attackCoef * (ampTarget - amp);
        if (amp >= ampTarget * 0.999) { amp = ampTarget; reachedAttack = true; }
      } else if (gate != 0) {
        amp *= decCoef;
      } else {
        amp *= relCoef;
      }

      // ---- reed tone: a hollow blend of partials (fundamental + odd-ish stack) ----
      const s1: f32 = Mathf.sin(phase);
      const s2: f32 = Mathf.sin(phase * 2.0);
      const s3: f32 = Mathf.sin(phase * 3.0);
      const s4: f32 = Mathf.sin(phase * 4.0);
      // hollow reed: strong fundamental, present 3rd, scooped 2nd, a little 4th
      let reed: f32 = s1 + 0.22 * s2 + 0.55 * s3 + 0.18 * s4;
      reed *= 0.55;

      // asymmetric bark drive: harder on the attack (velocity + bark env),
      // mellowing as the bark env decays toward the clean reed body.
      const drive: f32 = 1.0 + (peakDrive - 1.0) * bark * (0.4 + 0.6 * vel);
      let shaped: f32 = asymShape(reed, drive);

      // DC blocker (asymmetry introduces DC) — high-pass at ~few Hz
      const hp: f32 = shaped - dcX + dcR * dc;
      dcX = shaped;
      dc = hp;

      // per-voice tone low-pass (mellow body, opens with Tone)
      tone += toneCoef * (hp - tone);

      const voiceOut: f32 = tone * amp;
      outBuf[f] += voiceOut;

      phase += inc; if (phase >= TWO_PI) phase -= TWO_PI;
    }

    vPhase[v] = phase;
    vAmp[v] = amp;
    vBark[v] = bark;
    vTone[v] = tone;
    vDc[v] = dc;
    vDcX[v] = dcX;

    // retire voice once faded and key released
    if (gate == 0 && amp < 0.00008) {
      vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    }
  }

  // ---- global tremolo + output level + soft safety clip, mono->stereo ----
  for (let f = 0; f < n; f++) {
    // sine tremolo modulating amplitude (1 at trough.. )
    const lfo: f32 = Mathf.sin(tremPhase);
    const trem: f32 = 1.0 - tremDepth * (0.5 - 0.5 * lfo); // 1.0 .. (1-depth)
    tremPhase += tremInc; if (tremPhase >= TWO_PI) tremPhase -= TWO_PI;

    let s: f32 = outBuf[f] * level * trem;
    // gentle soft clip keeps dense chords < 1.0
    if (s > 1.4) s = 1.4; else if (s < -1.4) s = -1.4;
    s = f32(s - 0.14285714 * s * s * s);
    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
