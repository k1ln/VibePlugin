// =====================================================================
//  DIGI WAVE — a hybrid DIGITAL/ANALOG polyphonic synthesizer instrument.
//  Lineage of the early-80s "digital wave generator + analog filter" poly:
//  each voice reads a SELECTABLE single-cycle DIGITAL waveform from a small
//  bank of harmonically-distinct DWGS-style tables (organ, reed, square-ish,
//  piano-ish, buzzy/saw, hollow, bell, sync-buzz) built once at init, then
//  runs it through a warm resonant ANALOG-style 4-pole low-pass with its own
//  Attack/Release amplitude+filter contour. A built-in stereo delay/chorus
//  adds the signature shimmer. >=6 voices; pure algorithm, no host imports.
//
//  Digital edge (quantised wavetable harmonics) + analog warmth (tanh ladder
//  filter and saturated summing bus).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

// digital-wave bank: 8 single-cycle tables, power-of-two length for cheap wrap
const NUM_WAVES: i32 = 8;
const TBL_LEN: i32 = 1024;
const TBL_MASK: i32 = 1023;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// the wave bank, laid out flat: wave w, sample i -> waveBank[w*TBL_LEN + i]
const waveBank: StaticArray<f32> = new StaticArray<f32>(NUM_WAVES * TBL_LEN);

// stereo delay / chorus lines (signature shimmer)
const DLY_LEN: i32 = 65536;      // ~1.36 s @ 48k, power of two
const DLY_MASK: i32 = 65535;
const dlyL: StaticArray<f32> = new StaticArray<f32>(DLY_LEN);
const dlyR: StaticArray<f32> = new StaticArray<f32>(DLY_LEN);
let dlyPos: i32 = 0;
let chorusPhase: f32 = 0.0;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_WAVE:   i32 = 0;  // 0..7  -> stepped digital waveform select
const P_CUTOFF: i32 = 1;  // 0..1  -> analog low-pass base cutoff
const P_RESO:   i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT: i32 = 3;  // 0..1  -> filter envelope amount
const P_ATTACK: i32 = 4;  // 0..1  -> attack seconds
const P_RELEASE:i32 = 5;  // 0..1  -> release seconds
const P_DELAY:  i32 = 6;  // 0..1  -> onboard delay/chorus mix
const P_LEVEL:  i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // 0..1 table phase

// amplitude AR envelope
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 hold/sus 3 rel
// filter AR envelope
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// analog ladder filter state (4 one-pole stages per voice)
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- build the DWGS-style digital wave bank -------------------------
//  Each table is an additive sum of harmonics with a hand-picked spectral
//  recipe, so the 8 waves are clearly distinct timbres. Normalised to ~1.
function buildWaves(): void {
  for (let w = 0; w < NUM_WAVES; w++) {
    const base: i32 = w * TBL_LEN;
    let peak: f32 = 0.0001;
    for (let i = 0; i < TBL_LEN; i++) {
      const ph: f32 = TWO_PI * f32(i) / f32(TBL_LEN);
      let s: f32 = 0.0;
      // up to 32 harmonics; amplitude recipe depends on wave index
      for (let h = 1; h <= 32; h++) {
        const hf: f32 = f32(h);
        let amp: f32 = 0.0;
        if (w == 0) {
          // 0 ORGAN: a few strong low harmonics (drawbar-ish)
          if (h == 1) amp = 1.0;
          else if (h == 2) amp = 0.5;
          else if (h == 3) amp = 0.35;
          else if (h == 4) amp = 0.25;
          else if (h == 6) amp = 0.18;
          else if (h == 8) amp = 0.12;
        } else if (w == 1) {
          // 1 REED: odd-weighted with a formant bump around 5th
          if ((h & 1) == 1) amp = 1.0 / hf;
          if (h == 5) amp += 0.6;
          if (h == 7) amp += 0.3;
        } else if (w == 2) {
          // 2 SQUARE-ish hollow: odd harmonics 1/h
          if ((h & 1) == 1) amp = 1.0 / hf;
        } else if (w == 3) {
          // 3 PIANO-ish: gentle rolloff, slight inharmonic emphasis mid
          amp = f32(Mathf.exp(-0.18 * (hf - 1.0)));
          if (h == 3 || h == 4) amp *= 1.3;
        } else if (w == 4) {
          // 4 BUZZY SAW: full 1/h spectrum, bright
          amp = 1.0 / hf;
        } else if (w == 5) {
          // 5 HOLLOW (pulse ~25%): harmonics weighted by sin(h*pi*0.25)
          amp = f32(Mathf.abs(Mathf.sin(hf * PI * 0.25))) / hf;
        } else if (w == 6) {
          // 6 BELL/METALLIC: sparse high partials, slightly stretched
          if (h == 1) amp = 0.7;
          else if (h == 4) amp = 0.5;
          else if (h == 7) amp = 0.6;
          else if (h == 11) amp = 0.45;
          else if (h == 16) amp = 0.3;
        } else {
          // 7 SYNC-BUZZ: rising then falling band — aggressive digital edge
          amp = f32(Mathf.exp(-0.5 * (f32(h) - 8.0) * (f32(h) - 8.0) * 0.06));
        }
        if (amp != 0.0) s += amp * f32(Mathf.sin(ph * hf));
      }
      waveBank[base + i] = s;
      const a: f32 = s < 0.0 ? -s : s;
      if (a > peak) peak = a;
    }
    // normalise this table to +/-0.95
    const norm: f32 = 0.95 / peak;
    for (let i = 0; i < TBL_LEN; i++) waveBank[base + i] *= norm;
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vPhase[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  for (let i = 0; i < DLY_LEN; i++) { dlyL[i] = 0.0; dlyR[i] = 0.0; }
  dlyPos = 0; chorusPhase = 0.0;

  buildWaves();

  params[P_WAVE]    = 0.0;
  params[P_CUTOFF]  = 0.55;
  params[P_RESO]    = 0.30;
  params[P_ENVAMT]  = 0.55;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.35;
  params[P_DELAY]   = 0.30;
  params[P_LEVEL]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

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
  vAStage[slot] = 1;   // attack
  vFStage[slot] = 1;
  vAEnv[slot]   = 0.0;
  vFEnv[slot]   = 0.0;
  vPhase[slot]  = 0.0;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 3;  // release
      vFStage[i] = 3;
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  // Wave: stepped 0..7 -> integer table index
  let waveIdx: i32 = i32(clampf(params[P_WAVE], 0.0, f32(NUM_WAVES - 1)) + 0.5);
  if (waveIdx < 0) waveIdx = 0;
  if (waveIdx > NUM_WAVES - 1) waveIdx = NUM_WAVES - 1;
  const waveBase: i32 = waveIdx * TBL_LEN;

  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);

  const atkS: f32 = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.8;
  const relS: f32 = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 2.5;

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // base cutoff in Hz, exponential 60 Hz .. ~16 kHz
  const baseHz: f32 = 60.0 * f32(Mathf.pow(256.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6 octaves
  const envOct: f32 = envAmt * 6.0;
  // resonance feedback 0..~4 (warm, just shy of self-oscillation)
  const reso: f32 = resoN * 3.8;

  // delay / chorus controls
  const dlyMix: f32 = clampf(params[P_DELAY], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0) * 1.1;

  // chorus/delay times: short modulated delay -> ensemble shimmer
  const baseDelaySamp: f32 = 0.013 * sr;   // ~13 ms base
  const chorusDepth: f32   = 0.004 * sr;   // +/- 4 ms sweep
  const chorusInc: f32     = TWO_PI * 0.45 / sr; // ~0.45 Hz LFO
  const feedback: f32      = 0.32;          // gentle repeats

  // headroom: up to 8 voices summed -> scale so big chords stay < 1
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let dry: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR ----------------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // sustain (held)
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

      // ---- filter AR -------------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv = 1.0;
      } else if (fstg == 3) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- digital wavetable oscillator (linear-interp read) ----
      let ph: f32 = vPhase[v];
      const inc: f32 = vFreq[v] / sr;   // cycles per sample (0..1)
      ph += inc; if (ph >= 1.0) ph -= 1.0;
      vPhase[v] = ph;

      const fp: f32 = ph * f32(TBL_LEN);
      const i0: i32 = i32(fp) & TBL_MASK;
      const i1: i32 = (i0 + 1) & TBL_MASK;
      const frac: f32 = fp - f32(i32(fp));
      const a0: f32 = waveBank[waveBase + i0];
      const a1: f32 = waveBank[waveBase + i1];
      const osc: f32 = a0 + (a1 - a0) * frac;

      // ---- analog resonant 4-pole low-pass ----------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));     // analog warmth on the feedback path

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      dry += s3 * aenv * vVel[v];
    }

    // ---- analog summing bus: scale + soft saturate ----------------
    let mono: f32 = f32(Mathf.tanh(dry * voiceScale * 1.15));

    // ---- stereo delay / chorus (the DW shimmer) -------------------
    chorusPhase += chorusInc; if (chorusPhase >= TWO_PI) chorusPhase -= TWO_PI;
    const modL: f32 = f32(Mathf.sin(chorusPhase));
    const modR: f32 = f32(Mathf.sin(chorusPhase + PI * 0.5)); // 90° apart -> width

    const dL: f32 = baseDelaySamp + chorusDepth * modL;
    const dR: f32 = baseDelaySamp + chorusDepth * modR + 0.003 * sr; // slight R offset

    const rdL: f32 = readDelay(dlyL, f32(dlyPos) - dL);
    const rdR: f32 = readDelay(dlyR, f32(dlyPos) - dR);

    // write input + feedback into the lines
    dlyL[dlyPos] = mono + rdL * feedback;
    dlyR[dlyPos] = mono + rdR * feedback;
    dlyPos = (dlyPos + 1) & DLY_MASK;

    const wetL: f32 = rdL;
    const wetR: f32 = rdR;

    let outL: f32 = (mono * (1.0 - dlyMix * 0.6) + wetL * dlyMix) * level;
    let outR: f32 = (mono * (1.0 - dlyMix * 0.6) + wetR * dlyMix) * level;

    // final safety limit
    outL = clampf(outL, -1.0, 1.0);
    outR = clampf(outR, -1.0, 1.0);

    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }
}

// fractional-delay read with linear interpolation; wraps the ring buffer
@inline function readDelay(line: StaticArray<f32>, fpos: f32): f32 {
  let p: f32 = fpos;
  // bring into [0, DLY_LEN)
  while (p < 0.0) p += f32(DLY_LEN);
  const ip: i32 = i32(p) & DLY_MASK;
  const ip1: i32 = (ip + 1) & DLY_MASK;
  const fr: f32 = p - f32(i32(p));
  const a: f32 = line[ip];
  const b: f32 = line[ip1];
  return a + (b - a) * fr;
}
