// =====================================================================
//  PHASE SYNTH — a polyphonic phase-distortion digital synthesizer.
//
//  Inspired by classic 80s phase-distortion synths: instead of analog
//  oscillators + filters, each voice reads a SINE wavetable through a
//  WARPED phase ramp. A non-linear phase map bends the read so a pure
//  sine morphs toward saw / square / resonant timbres. The amount of
//  warp is driven both by a static Shape control and by a per-voice
//  "DCW" (distortion control wave) envelope — the characteristic
//  phase-distortion character where the tone is bright on the attack
//  and decays toward a sine.
//
//  Per voice: PD oscillator -> amp ADSR-ish (AR + DCW decay). Voices
//  are allocated per noteId so chords ring with independent contours.
//  Pure algorithm, no samples, no host imports. All f32.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;   // DC blocker

// ---- parameter indices (must match spec.json) -----------------------
const P_SHAPE:   i32 = 0;  // 0..1  sine <-> bright (saw/square/resonant blend)
const P_DCWAMT:  i32 = 1;  // 0..1  depth of the distortion envelope
const P_DCWDEC:  i32 = 2;  // 0..1  DCW decay time (how fast brightness falls)
const P_ATTACK:  i32 = 3;  // 0..1  amp attack seconds
const P_RELEASE: i32 = 4;  // 0..1  amp release seconds
const P_DETUNE:  i32 = 5;  // 0..1  twin-osc detune spread
const P_LEVEL:   i32 = 6;  // 0..1  output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhaseA: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc 1 phase 0..1
const vPhaseB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc 2 (detuned) phase

// amplitude envelope (AR): 0 idle, 1 attack, 2 sustain(hold), 3 release
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// DCW envelope: 1.0 at note-on, decays toward 0 -> brightness falls off
const vDcw:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  dcX = 0.0; dcY = 0.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhaseA[v] = 0.0; vPhaseB[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vDcw[v] = 0.0;
  }
  ageCounter = 0;
  params[P_SHAPE]   = 0.55;
  params[P_DCWAMT]  = 0.7;
  params[P_DCWDEC]  = 0.4;
  params[P_ATTACK]  = 0.02;
  params[P_RELEASE] = 0.35;
  params[P_DETUNE]  = 0.18;
  params[P_LEVEL]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 0) { slot = i; break; }
  }
  if (slot < 0) {
    let oldest: i32 = 0;
    let oldestAge: i32 = vAge[0];
    for (let i = 1; i < NUM_VOICES; i++) {
      if (vAge[i] < oldestAge) { oldestAge = vAge[i]; oldest = i; }
    }
    slot = oldest;
  }

  vNote[slot]   = id;
  vFreq[slot]   = f > 0.0 ? f : 1.0;
  vVel[slot]    = clampf(v, 0.0, 1.0);
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vAStage[slot] = 1;     // attack
  vAEnv[slot]   = 0.0;
  vDcw[slot]    = 1.0;   // full distortion at note-on
  vPhaseA[slot] = 0.0;
  vPhaseB[slot] = 0.0;
  vAge[slot]    = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 3;    // release
    }
  }
}

// ---- phase-distortion core ------------------------------------------
// Given a linear phase p in 0..1 and a warp amount d in 0..1, bend the
// phase so the sine read accelerates through one region and stalls in
// another. With d=0 the map is identity (pure sine). As d rises the
// "knee" moves and the read crowds energy into a fast sweep -> higher
// harmonics, approaching saw/resonant timbres. `tilt` selects the kind
// of warp (toward saw-ish vs resonant/formant-ish) for the Shape blend.
@inline function pdWarp(p: f32, d: f32, knee: f32): f32 {
  // knee in (0,1): fraction of the cycle spent in the first (slow) segment.
  // two-piece linear phase map -> classic CZ "saw" shape when sine-read.
  // d scales how far the knee is pushed away from 0.5 (no distortion at d=0).
  let k: f32 = 0.5 + (knee - 0.5) * d;
  if (k < 0.02) k = 0.02;
  if (k > 0.98) k = 0.98;
  let w: f32;
  if (p < k) {
    w = 0.5 * (p / k);
  } else {
    w = 0.5 + 0.5 * ((p - k) / (1.0 - k));
  }
  return w;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const shapeN: f32 = clampf(params[P_SHAPE], 0.0, 1.0);
  const dcwAmt: f32 = clampf(params[P_DCWAMT], 0.0, 1.0);
  const dcwDecN: f32 = clampf(params[P_DCWDEC], 0.0, 1.0);
  const atkS: f32   = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0) * 1.2;
  const relS: f32   = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 2.5;
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // DCW decay: per-sample multiplicative decay. Longer time => slower fall.
  const dcwDecS: f32 = 0.02 + dcwDecN * 2.5;
  const dcwCoef: f32 = f32(Mathf.exp(-1.0 / (dcwDecS * sr)));

  // Shape picks where the phase knee sits AND blends in a second,
  // resonant-style warp at the bright end for richer harmonics.
  // shape 0 -> knee near 0.5 (gentle), shape 1 -> knee pushed to 0.9 (saw/bright).
  const knee: f32 = 0.5 + shapeN * 0.42;
  // resonant content: a windowed higher-harmonic burst, fades in at bright end.
  const resoMix: f32 = shapeN * shapeN;        // 0..1
  // how many cycles of the inner "formant" sine per phase window (2..7)
  const resoMult: f32 = 1.0 + shapeN * 6.0;

  // detune: up to ~ +/-0.12 semitone -> slow chorusy beating
  const detSemi: f32 = detuneN * 0.12;
  const ratioUp: f32   = f32(Mathf.pow(2.0, detSemi / 12.0));
  const ratioDown: f32 = f32(Mathf.pow(2.0, -detSemi / 12.0));

  // headroom: up to 8 voices, two oscillators each
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR envelope --------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // hold while gated
        aenv = 1.0;
      } else if (astg == 3) {     // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- DCW (distortion) envelope ----------------------------
      let dcw: f32 = vDcw[v];
      dcw *= dcwCoef;          // decays toward 0
      vDcw[v] = dcw;
      // effective distortion depth: base Shape always active, plus the
      // decaying DCW contour scaled by its amount. Clamped to 0..1.
      let d: f32 = shapeN * 0.35 + dcwAmt * dcw;
      if (d > 1.0) d = 1.0;

      // ---- twin phase-distortion oscillators --------------------
      const baseInc: f32 = vFreq[v] / sr;
      const incA: f32 = baseInc * ratioDown;
      const incB: f32 = baseInc * ratioUp;

      let pa: f32 = vPhaseA[v];
      pa += incA; if (pa >= 1.0) pa -= 1.0;
      vPhaseA[v] = pa;
      let pb: f32 = vPhaseB[v];
      pb += incB; if (pb >= 1.0) pb -= 1.0;
      vPhaseB[v] = pb;

      // warp each phase then read the sine table (Mathf.sin)
      const waA: f32 = pdWarp(pa, d, knee);
      const waB: f32 = pdWarp(pb, d, knee);

      // primary saw-ish phase-distortion tone
      let oscA: f32 = f32(Mathf.sin(waA * TWO_PI));
      let oscB: f32 = f32(Mathf.sin(waB * TWO_PI));

      // resonant/formant layer: a higher sine windowed by a falling ramp,
      // gated by the bright end of Shape and the DCW depth -> the classic
      // "resonant" CZ waveforms. Window = (1 - phase) so it rings then dies.
      if (resoMix > 0.001) {
        const winA: f32 = 1.0 - pa;
        const winB: f32 = 1.0 - pb;
        const rA: f32 = f32(Mathf.sin(waA * TWO_PI * resoMult)) * winA;
        const rB: f32 = f32(Mathf.sin(waB * TWO_PI * resoMult)) * winB;
        const rg: f32 = resoMix * (0.4 + 0.6 * d);
        oscA = oscA * (1.0 - rg) + rA * rg;
        oscB = oscB * (1.0 - rg) + rB * rg;
      }

      const osc: f32 = (oscA + oscB) * 0.5;
      const voice: f32 = osc * aenv * vVel[v];
      outL += voice;
    }

    // ---- sum + gentle soft-saturate for digital glue ------------
    let mix: f32 = outL * voiceScale * level;
    mix = f32(Mathf.tanh(mix * 1.1));
    const dcO: f32 = mix - dcX + 0.9985 * dcY; dcX = mix; dcY = dcO; mix = dcO;

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
