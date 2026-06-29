// =====================================================================
//  VOX STRINGS — a paraphonic STRING + VOICE ensemble instrument.
//  Inspired by the classic 1970s string/voice ensemble keyboards: each
//  held note runs a stack of detuned sawtooth "strings" PLUS a breathy
//  formant-filtered "choir aah" voice layer. The two layers are blended,
//  shaped by a slow attack/release envelope, then poured through a lush
//  three-phase BBD-style ENSEMBLE chorus to spread the section across the
//  stereo field. Pure algorithm, no samples, no host imports.
//
//  Host passes frequency in Hz to noteOn(id, freq, vel); noteOff(id).
//  Paraphonic: every voice shares the same envelope/filter character but
//  tracks its own pitch, so a held chord blooms into a full choir+strings
//  pad. All math is f32 (Mathf.*), no allocation inside process().
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

// ---- parameter indices (must match spec.json) -----------------------
const P_STRINGS: i32 = 0;  // 0..1  -> sawtooth string layer level
const P_VOICE:   i32 = 1;  // 0..1  -> formant choir "aah" layer level
const P_ENSEMBLE: i32 = 2; // 0..1  -> ensemble chorus depth / width
const P_ATTACK:  i32 = 3;  // 0..1  -> slow attack seconds
const P_RELEASE: i32 = 4;  // 0..1  -> slow release seconds
const P_TONE:    i32 = 5;  // 0..1  -> master brightness (low-pass)
const P_LEVEL:   i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// per-note slow AR envelope (paraphonic — one contour per voice)
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sustain 3 rel

// each voice stacks THREE slightly detuned sawtooths for the string body
const vP1a: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vP1b: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vP1c: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
// plus one phase for the voice/choir source (a softer pulse-ish glottal tone)
const vP2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// ---- formant band-pass state for the choir "aah" vowel --------------
// Two resonant band-passes (state-variable) shape a broadband source into
// the two dominant formants of an "ah" vowel (~750 Hz and ~1150 Hz). One
// shared bank processes the SUMMED voice-layer source (paraphonic).
let f1Lo: f32 = 0.0; let f1Bp: f32 = 0.0;
let f2Lo: f32 = 0.0; let f2Bp: f32 = 0.0;

// ---- gentle breath noise for the choir air --------------------------
let noiseState: i32 = 0x1a2b3c4d;

// ---- master tone one-pole low-pass (stereo) -------------------------
let toneL: f32 = 0.0; let toneR: f32 = 0.0;

// ---- ENSEMBLE chorus: 3 modulated delay taps, BBD-style -------------
const DELAY_LEN: i32 = 2048; // ~42 ms at 48k — plenty for chorus
const dlyL: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const dlyR: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
let dlyPos: i32 = 0;
// three LFO phases at mutually detuned slow rates (the classic 3-phase ensemble)
let lfo1: f32 = 0.0;
let lfo2: f32 = 0.33;
let lfo3: f32 = 0.66;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vEnv[v] = 0.0; vStage[v] = 0;
    vP1a[v] = 0.0; vP1b[v] = 0.0; vP1c[v] = 0.0; vP2[v] = 0.0;
  }
  ageCounter = 0;
  f1Lo = 0.0; f1Bp = 0.0; f2Lo = 0.0; f2Bp = 0.0;
  noiseState = 0x1a2b3c4d;
  toneL = 0.0; toneR = 0.0;
  for (let i = 0; i < DELAY_LEN; i++) { dlyL[i] = 0.0; dlyR[i] = 0.0; }
  dlyPos = 0;
  lfo1 = 0.0; lfo2 = 0.33; lfo3 = 0.66;

  params[P_STRINGS]  = 0.7;
  params[P_VOICE]    = 0.55;
  params[P_ENSEMBLE] = 0.6;
  params[P_ATTACK]   = 0.35;
  params[P_RELEASE]  = 0.45;
  params[P_TONE]     = 0.6;
  params[P_LEVEL]    = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast deterministic white noise in [-1,1] for the breath layer
@inline function nextNoise(): f32 {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >> 17;
  noiseState ^= noiseState << 5;
  return f32(noiseState) * f32(4.6566128e-10); // /2^31
}

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
  vStage[slot]  = 1;   // attack
  // offset the three string phases so the detuned saws never phase-lock
  vP1a[slot] = 0.0;
  vP1b[slot] = 0.37;
  vP1c[slot] = 0.71;
  vP2[slot]  = 0.15;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3;  // release
    }
  }
}

// linearly read the delay line at a fractional sample offset behind dlyPos
@inline function readDelay(buf: StaticArray<f32>, delay: f32): f32 {
  let rp: f32 = f32(dlyPos) - delay;
  while (rp < 0.0) rp += f32(DELAY_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= DELAY_LEN) i1 -= DELAY_LEN;
  const frac: f32 = rp - f32(i0);
  const a: f32 = buf[i0];
  const b: f32 = buf[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const strLvl: f32 = clampf(params[P_STRINGS], 0.0, 1.0);
  const voxLvl: f32 = clampf(params[P_VOICE], 0.0, 1.0);
  const ensN:   f32 = clampf(params[P_ENSEMBLE], 0.0, 1.0);
  const atkN:   f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const relN:   f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE], 0.0, 1.0);
  const outLvl: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // slow attack/release (string-machine character): 5 ms .. ~2 s
  const atkS: f32 = 0.005 + atkN * 2.0;
  const relS: f32 = 0.02 + relN * 2.5;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune spread for the three stacked saws (cents -> ratio)
  const detUp:   f32 = f32(Mathf.pow(2.0,  6.5 / 1200.0));  // +6.5 cents
  const detDown: f32 = f32(Mathf.pow(2.0, -7.0 / 1200.0));  // -7.0 cents

  // master tone low-pass: 1.2 kHz .. ~14 kHz
  const toneHz: f32 = 1200.0 + toneN * toneN * 12800.0;
  let toneG: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * toneHz / sr));
  if (toneG > 0.99) toneG = 0.99;

  // formant band-pass coefficients (two "ah" formants), state-variable filter
  const fHz1: f32 = 750.0;
  const fHz2: f32 = 1150.0;
  const fF1: f32 = 2.0 * f32(Mathf.sin(PI * fHz1 / sr));
  const fF2: f32 = 2.0 * f32(Mathf.sin(PI * fHz2 / sr));
  const fQ: f32 = 0.18; // damping (lower = more resonant/vowel-like)

  // ensemble chorus: depth in samples and slow LFO increments
  const depth: f32 = ensN * 9.0;          // up to ~9 samples modulation
  const baseDelay: f32 = 12.0;            // ~0.25 ms center tap
  const wet: f32 = 0.25 + ensN * 0.55;    // chorus presence
  const inc1: f32 = 0.50 / sr;            // 0.50 Hz
  const inc2: f32 = 0.71 / sr;            // 0.71 Hz
  const inc3: f32 = 0.93 / sr;            // 0.93 Hz

  // headroom: 8 voices x (strings+voice) summed -> keep peak < 1
  const voiceScale: f32 = 0.16;

  for (let f = 0; f < n; f++) {
    let strSum: f32 = 0.0;   // summed string (saw stack) layer
    let voxSum: f32 = 0.0;   // summed voice glottal source

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- slow AR envelope -------------------------------------
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {              // attack
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {       // sustain (held)
        env = 1.0;
      } else if (stg == 3) {       // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      const amp: f32 = env * (0.5 + 0.5 * vVel[v]);
      const baseInc: f32 = vFreq[v] / sr;

      // ---- STRING layer: three detuned sawtooths ----------------
      let a: f32 = vP1a[v]; a += baseInc;         if (a >= 1.0) a -= 1.0; vP1a[v] = a;
      let b: f32 = vP1b[v]; b += baseInc * detUp; if (b >= 1.0) b -= 1.0; vP1b[v] = b;
      let c: f32 = vP1c[v]; c += baseInc * detDown; if (c >= 1.0) c -= 1.0; vP1c[v] = c;
      const saw: f32 = ((a * 2.0 - 1.0) + (b * 2.0 - 1.0) + (c * 2.0 - 1.0)) * f32(0.3333333);
      strSum += saw * amp;

      // ---- VOICE layer source: narrow pulse ~ glottal buzz -------
      let p2: f32 = vP2[v]; p2 += baseInc; if (p2 >= 1.0) p2 -= 1.0; vP2[v] = p2;
      // asymmetric pulse rich in harmonics -> good formant excitation
      const glott: f32 = p2 < 0.18 ? 1.0 : -0.22;
      voxSum += glott * amp;
    }

    // ---- choir "aah": formant band-passes on the summed source ----
    // add a touch of breath noise (only matters when notes sound)
    const breath: f32 = nextNoise() * 0.06;
    const src: f32 = voxSum * 0.5 + breath * (voxSum != 0.0 ? 1.0 : 0.0);

    // state-variable band-pass 1
    f1Bp += fF1 * (src - f1Lo - fQ * f1Bp);
    f1Lo += fF1 * f1Bp;
    // band-pass 2
    f2Bp += fF2 * (src - f2Lo - fQ * f2Bp);
    f2Lo += fF2 * f2Bp;
    // formant mix ("ah": F1 stronger than F2)
    const vowel: f32 = f1Bp * 0.75 + f2Bp * 0.45;

    // ---- blend the two layers -------------------------------------
    let mono: f32 = strSum * strLvl + vowel * voxLvl * 1.4;
    mono *= voiceScale;
    // gentle saturation glues the section
    mono = f32(Mathf.tanh(mono));

    // ---- write into the ensemble delay lines ----------------------
    dlyL[dlyPos] = mono;
    dlyR[dlyPos] = mono;

    // ---- ENSEMBLE chorus: 3 phases, spread L/R --------------------
    lfo1 += inc1; if (lfo1 >= 1.0) lfo1 -= 1.0;
    lfo2 += inc2; if (lfo2 >= 1.0) lfo2 -= 1.0;
    lfo3 += inc3; if (lfo3 >= 1.0) lfo3 -= 1.0;
    const m1: f32 = f32(Mathf.sin(TWO_PI * lfo1));
    const m2: f32 = f32(Mathf.sin(TWO_PI * lfo2));
    const m3: f32 = f32(Mathf.sin(TWO_PI * lfo3));

    const d1: f32 = baseDelay + depth * (1.0 + m1);
    const d2: f32 = baseDelay + depth * (1.0 + m2);
    const d3: f32 = baseDelay + depth * (1.0 + m3);

    // L favours taps 1 & 3, R favours taps 2 & 3 -> wide stereo image
    const chL: f32 = readDelay(dlyL, d1) * 0.6 + readDelay(dlyL, d3) * 0.5;
    const chR: f32 = readDelay(dlyR, d2) * 0.6 + readDelay(dlyR, d3) * 0.5;

    dlyPos++; if (dlyPos >= DELAY_LEN) dlyPos = 0;

    let oL: f32 = mono * (1.0 - wet) + chL * wet;
    let oR: f32 = mono * (1.0 - wet) + chR * wet;

    // ---- master tone low-pass -------------------------------------
    toneL += toneG * (oL - toneL); oL = toneL;
    toneR += toneG * (oR - toneR); oR = toneR;

    // ---- output level + safety clamp ------------------------------
    oL *= outLvl * 1.3;
    oR *= outLvl * 1.3;
    if (oL > 1.0) oL = 1.0; else if (oL < -1.0) oL = -1.0;
    if (oR > 1.0) oR = 1.0; else if (oR < -1.0) oR = -1.0;

    outBuf[f] = oL;
    outBuf[MAX_FRAMES + f] = oR;
  }
}
