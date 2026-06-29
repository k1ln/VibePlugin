// =====================================================================
//  WAVE TABLE — a polyphonic wavetable synthesizer instrument.
//  Inspired by early-1980s German digital wavetable hardware: a bank of
//  eight code-generated single-cycle waves spanning sine -> harmonically
//  rich -> formant/vocal shapes. A Wave Position control SCANS smoothly
//  through the bank with linear interpolation BETWEEN tables (the classic
//  digital "scanning" timbre morph). Each of eight voices: a wavetable
//  oscillator -> resonant 4-pole low-pass with its own filter ADSR and
//  amount -> amplitude ADSR. Voices keyed by noteId so chords ring with
//  independent contours. Pure algorithm, generated at init, no samples,
//  no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const NUM_TABLES: i32 = 8;       // single-cycle waves in the bank
const TABLE_LEN: i32 = 2048;     // samples per single-cycle wave
const TABLE_MASK: i32 = 2047;    // TABLE_LEN - 1 (power of two)

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// the wavetable bank: NUM_TABLES contiguous single-cycle waves
const bank: StaticArray<f32> = new StaticArray<f32>(NUM_TABLES * TABLE_LEN);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_WAVEPOS: i32 = 0;  // 0..1  -> scan through the table bank
const P_CUTOFF:  i32 = 1;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount
const P_ATTACK:  i32 = 4;  // 0..1  -> seconds
const P_RELEASE: i32 = 5;  // 0..1  -> seconds
const P_DETUNE:  i32 = 6;  // 0..1  -> subtle unison detune spread
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhaseA: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc A phase 0..1
const vPhaseB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc B (detuned) phase

// amplitude AR envelope
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter AR envelope
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// resonant 4-pole ladder state per voice
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- build the wavetable bank in code at init -----------------------
// Each table is a single cycle, normalized to peak ~1. The bank progresses
// from a pure sine, through ever richer harmonic spectra, into bright/odd
// "formant"-style waves so scanning Wave Position clearly morphs timbre.
function buildBank(): void {
  for (let t = 0; t < NUM_TABLES; t++) {
    const base: i32 = t * TABLE_LEN;
    // morph factor 0..1 across the bank
    const m: f32 = f32(t) / f32(NUM_TABLES - 1);

    let peak: f32 = 0.0001;
    for (let i = 0; i < TABLE_LEN; i++) {
      const ph: f32 = TWO_PI * f32(i) / f32(TABLE_LEN);
      let s: f32 = 0.0;

      if (t == 0) {
        // pure sine
        s = Mathf.sin(ph);
      } else if (t < 5) {
        // additive harmonic series: more harmonics, gentler rolloff as t grows.
        // t=1 few harmonics (soft), t=4 saw-ish bright.
        const nh: i32 = 2 + t * 5;             // 7,12,17,22 harmonics
        const tilt: f32 = 1.0 - 0.15 * f32(t); // brighter rolloff for higher t
        for (let h = 1; h <= nh; h++) {
          const amp: f32 = f32(Mathf.pow(f32(1.0) / f32(h), tilt));
          s += amp * Mathf.sin(ph * f32(h));
        }
      } else {
        // formant / vocal-ish waves: a low fundamental shaped by a moving
        // formant peak (a windowed burst of harmonics) -> bright, hollow,
        // resonant tones reminiscent of the digital bank's upper region.
        const formant: f32 = 3.0 + (m - 0.57) * 14.0; // formant centre harmonic
        const width: f32 = 2.5 + (m - 0.57) * 4.0;
        const nh: i32 = 40;
        for (let h = 1; h <= nh; h++) {
          const d: f32 = (f32(h) - formant) / width;
          const amp: f32 = f32(Mathf.exp(-d * d)) + 0.18 / f32(h);
          s += amp * Mathf.sin(ph * f32(h) + 0.5 * f32(h) * m);
        }
      }

      bank[base + i] = s;
      const a: f32 = s < 0.0 ? -s : s;
      if (a > peak) peak = a;
    }
    // normalize this table to peak ~0.98
    const norm: f32 = 0.98 / peak;
    for (let i = 0; i < TABLE_LEN; i++) {
      bank[base + i] = bank[base + i] * norm;
    }
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhaseA[v] = 0.0; vPhaseB[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  buildBank();
  params[P_WAVEPOS] = 0.0;
  params[P_CUTOFF]  = 0.6;
  params[P_RESO]    = 0.3;
  params[P_ENVAMT]  = 0.5;
  params[P_ATTACK]  = 0.02;
  params[P_RELEASE] = 0.35;
  params[P_DETUNE]  = 0.2;
  params[P_LEVEL]   = 0.7;
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
  vPhaseA[slot] = 0.0;
  vPhaseB[slot] = 0.13; // slight offset so the two oscillators don't phase-lock
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

// linearly-interpolated read of one table (index t) at phase 0..1
@inline function readTable(t: i32, ph: f32): f32 {
  const base: i32 = t * TABLE_LEN;
  const fpos: f32 = ph * f32(TABLE_LEN);
  let i0: i32 = i32(fpos);
  const frac: f32 = fpos - f32(i0);
  i0 = i0 & TABLE_MASK;
  const i1: i32 = (i0 + 1) & TABLE_MASK;
  const a: f32 = bank[base + i0];
  const b: f32 = bank[base + i1];
  return a + (b - a) * frac;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const wavePos: f32 = clampf(params[P_WAVEPOS], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const atkS: f32 = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.5;
  const relS: f32 = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 2.5;
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // scan position -> table index + crossfade fraction
  const scan: f32 = wavePos * f32(NUM_TABLES - 1);
  let tIdx: i32 = i32(scan);
  if (tIdx > NUM_TABLES - 2) tIdx = NUM_TABLES - 2;
  if (tIdx < 0) tIdx = 0;
  const tFrac: f32 = scan - f32(tIdx);

  // envelope rates (linear AR)
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune in semitone fraction: up to ~ +/-0.14 semitone for gentle width
  const detSemi: f32 = detuneN * 0.14;
  const ratioUp: f32   = f32(Mathf.pow(2.0, detSemi / 12.0));
  const ratioDown: f32 = f32(Mathf.pow(2.0, -detSemi / 12.0));

  // base cutoff in Hz, exponential 60 Hz .. ~16 kHz
  const baseHz: f32 = 60.0 * f32(Mathf.pow(256.0, cutoffN));
  const envOct: f32 = envAmt * 6.0;          // envelope sweeps up to 6 octaves
  const reso: f32 = resoN * 4.0;             // feedback 0..4

  // headroom for up to 8 summed voices
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

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

      // ---- wavetable oscillator (two detuned reads) ------------
      const baseInc: f32 = vFreq[v] / sr;
      const incA: f32 = baseInc * ratioDown;
      const incB: f32 = baseInc * ratioUp;

      let pa: f32 = vPhaseA[v];
      pa += incA; if (pa >= 1.0) pa -= 1.0;
      vPhaseA[v] = pa;

      let pb: f32 = vPhaseB[v];
      pb += incB; if (pb >= 1.0) pb -= 1.0;
      vPhaseB[v] = pb;

      // scan: crossfade between adjacent tables (the PPG character)
      const a0: f32 = readTable(tIdx, pa);
      const a1: f32 = readTable(tIdx + 1, pa);
      const sA: f32 = a0 + (a1 - a0) * tFrac;

      const b0: f32 = readTable(tIdx, pb);
      const b1: f32 = readTable(tIdx + 1, pb);
      const sB: f32 = b0 + (b1 - b0) * tFrac;

      let osc: f32 = (sA + sB) * 0.5;

      // ---- resonant 4-pole low-pass ----------------------------
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
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      outL += s3 * aenv * vVel[v];
    }

    let mix: f32 = outL * voiceScale * level;
    mix = f32(Mathf.tanh(mix * 1.1));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
