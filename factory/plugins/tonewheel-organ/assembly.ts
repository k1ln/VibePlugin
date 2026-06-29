// =====================================================================
//  TONEWHEEL ORGAN — a polyphonic additive drawbar organ instrument.
//  Each held key is synthesised as a sum of sine partials at the classic
//  drawbar footages (16', 8', 5 1/3', 4', 2 2/3', 2', 1'), mimicking the
//  geared tonewheel generator of a vintage console organ. A short key-click
//  transient, a decaying percussion tap (selectable 2nd/3rd harmonic) and a
//  built-in rotary speaker (amplitude + pitch shimmer) round out the sound.
//  Attack is instant and the tone sustains flat while a key is held — no
//  amplitude decay — exactly like a real drawbar organ. Pure algorithm,
//  no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 12;        // generous polyphony for big chords
const NUM_BARS: i32 = 7;           // 16,8,5 1/3,4,2 2/3,2,1

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_SUB:    i32 = 0;  // 0..1  -> 16' drawbar level
const P_FUND:   i32 = 1;  // 0..1  -> 8'  drawbar level
const P_THIRD:  i32 = 2;  // 0..1  -> 5 1/3' drawbar level
const P_UPPER:  i32 = 3;  // 0..1  -> blended 4'+2 2/3'+2'+1' brightness
const P_PERC:   i32 = 4;  // 0..1  -> percussion amount
const P_PMODE:  i32 = 5;  // {0,1} -> percussion harmonic (0=2nd, 1=3rd)
const P_DRIVE:  i32 = 6;  // 0..1  -> tube-amp overdrive
const P_ROTARY: i32 = 7;  // 0..1  -> rotary speaker speed (slow..fast)

// ---- footage frequency ratios relative to the played pitch ----------
// 16'=0.5, 8'=1, 5 1/3'=1.5, 4'=2, 2 2/3'=3, 2'=4, 1'=8
const barRatio: StaticArray<f32> = new StaticArray<f32>(NUM_BARS);

// ---- per-voice state -------------------------------------------------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// one running phase per partial per voice (planar: voice*NUM_BARS + bar)
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * NUM_BARS);

// fast on/off amplitude envelope (instant attack, organ sustain, quick release)
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// percussion: a single-trigger decaying gain per voice (does NOT retrigger
// while a chord is held — classic single-trigger percussion behaviour)
const vPerc:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// key-click transient envelope (very short noise burst at note onset)
const vClick:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// rotary speaker LFOs (global, shared by all voices for a coherent cabinet)
let rotPhase: f32 = 0.0;   // tremolo / doppler phase
let rotChorus: f32 = 0.0;  // a slightly detuned second LFO for stereo width

// deterministic noise for key-click
let rng: u32 = 0x6d2b79f5;
@inline function noise(): f32 {
  rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
  return f32(i32(rng) / 1073741824.0) * 0.5; // ~ -1..1
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;

  barRatio[0] = 0.5;   // 16'
  barRatio[1] = 1.0;   // 8'
  barRatio[2] = 1.5;   // 5 1/3'
  barRatio[3] = 2.0;   // 4'
  barRatio[4] = 3.0;   // 2 2/3'
  barRatio[5] = 4.0;   // 2'
  barRatio[6] = 8.0;   // 1'

  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vEnv[v] = 0.0; vPerc[v] = 0.0; vClick[v] = 0.0;
    for (let b = 0; b < NUM_BARS; b++) vPhase[v * NUM_BARS + b] = 0.0;
  }
  ageCounter = 0;
  rotPhase = 0.0; rotChorus = 0.0;

  params[P_SUB]    = 0.6;
  params[P_FUND]   = 0.85;
  params[P_THIRD]  = 0.35;
  params[P_UPPER]  = 0.45;
  params[P_PERC]   = 0.5;
  params[P_PMODE]  = 0.0;   // 2nd harmonic
  params[P_DRIVE]  = 0.25;
  params[P_ROTARY] = 0.3;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast sine from phase 0..1 via a parabolic approximation (no Mathf in loop)
@inline function sine01(p: f32): f32 {
  // map 0..1 to -PI..PI then use the Bhaskara-style parabola, refined once
  let x: f32 = p - f32(i32(p));    // wrap to 0..1
  if (x < 0.0) x += 1.0;
  const t: f32 = x * 2.0 - 1.0;    // -1..1
  // 4th-order-ish sine approximation on -1..1 (zero at +-1, peak mid)
  const a: f32 = t < 0.0 ? -t : t;
  let s: f32 = t * (3.1 - 2.1 * a); // rough sine, smooth and bounded ~ +-1
  // light shaping to tame the peak so partial sums stay bounded
  return s;
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
  vEnv[slot]    = 0.0;   // ramps to 1 almost instantly
  vPerc[slot]   = 1.0;   // trigger percussion tap
  vClick[slot]  = 1.0;   // trigger key-click
  // reset partial phases so the click attack is coherent
  for (let b = 0; b < NUM_BARS; b++) vPhase[slot * NUM_BARS + b] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;   // enter release
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const sub: f32   = clampf(params[P_SUB], 0.0, 1.0);
  const fund: f32  = clampf(params[P_FUND], 0.0, 1.0);
  const third: f32 = clampf(params[P_THIRD], 0.0, 1.0);
  const upper: f32 = clampf(params[P_UPPER], 0.0, 1.0);
  const perc: f32  = clampf(params[P_PERC], 0.0, 1.0);
  const pmode: i32 = params[P_PMODE] >= 0.5 ? 1 : 0;  // 0=2nd,1=3rd
  const drive: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const rotN: f32  = clampf(params[P_ROTARY], 0.0, 1.0);

  // per-bar levels. Upper knob fades in the bright footages 4',2 2/3',2',1'.
  const lvl0: f32 = sub;            // 16'
  const lvl1: f32 = fund;           // 8'
  const lvl2: f32 = third;          // 5 1/3'
  const lvl3: f32 = upper * 0.85;   // 4'
  const lvl4: f32 = upper * 0.6;    // 2 2/3'
  const lvl5: f32 = upper * 0.5;    // 2'
  const lvl6: f32 = upper * 0.35;   // 1'

  // normalise so a full chord of drawbars stays bounded
  const barSum: f32 = lvl0 + lvl1 + lvl2 + lvl3 + lvl4 + lvl5 + lvl6 + 0.0001;
  const barNorm: f32 = 0.85 / barSum;

  // percussion harmonic ratio (2nd = 2x, 3rd = 3x the played pitch)
  const percRatio: f32 = pmode == 1 ? 3.0 : 2.0;
  const percDecay: f32 = f32(Mathf.exp(-1.0 / (0.18 * sr))); // ~180 ms tap
  const percAmt: f32   = perc * 0.9;

  // key-click: short ~3 ms noisy burst
  const clickDecay: f32 = f32(Mathf.exp(-1.0 / (0.003 * sr)));

  // on/off amp envelope rates (instant-ish attack, snappy release)
  const atkRate: f32 = 1.0 / (0.002 * sr);   // ~2 ms attack
  const relRate: f32 = 1.0 / (0.02 * sr);    // ~20 ms release

  // rotary speaker: speed scales from slow (~0.8 Hz) to fast (~7 Hz)
  const rotHz: f32 = 0.8 + rotN * 6.2;
  const rotInc: f32 = rotHz / sr;
  const chorusInc: f32 = (rotHz * 0.93) / sr; // slightly different -> stereo motion
  // depth of the rotary effect: amplitude tremolo + a gentle pitch shimmer
  const tremDepth: f32 = 0.12 + rotN * 0.28;       // 0.12..0.40
  const pitchDepth: f32 = (0.0006 + rotN * 0.0020); // tiny vibrato (doppler hint)

  // tube drive: maps to a pre-gain into a tanh-style soft clip
  const driveGain: f32 = 1.0 + drive * 5.0;
  const driveComp: f32 = 1.0 / (1.0 + drive * 1.6); // keep level musical

  for (let f = 0; f < n; f++) {
    // advance rotary LFOs once per frame
    rotPhase += rotInc; if (rotPhase >= 1.0) rotPhase -= 1.0;
    rotChorus += chorusInc; if (rotChorus >= 1.0) rotChorus -= 1.0;

    const tremL: f32 = 1.0 - tremDepth * (0.5 - 0.5 * sine01(rotPhase));
    const tremR: f32 = 1.0 - tremDepth * (0.5 - 0.5 * sine01(rotChorus + 0.25));
    // pitch shimmer common to all voices (doppler suggestion)
    const pitchMod: f32 = 1.0 + pitchDepth * sine01(rotPhase);

    let mixL: f32 = 0.0;
    let mixR: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- on/off envelope (organ: flat sustain while held) ---------
      let env: f32 = vEnv[v];
      if (vGate[v] == 1) {
        env += atkRate;
        if (env > 1.0) env = 1.0;
      } else {
        env -= relRate;
        if (env <= 0.0) {
          env = 0.0;
          vActive[v] = 0; vNote[v] = -1; vEnv[v] = 0.0; vPerc[v] = 0.0; vClick[v] = 0.0;
          continue;
        }
      }
      vEnv[v] = env;

      const baseInc: f32 = (vFreq[v] * pitchMod) / sr;
      const pb: i32 = v * NUM_BARS;

      // ---- sum the drawbar partials ---------------------------------
      let s0: f32 = vPhase[pb + 0]; s0 += baseInc * barRatio[0]; if (s0 >= 1.0) s0 -= 1.0; vPhase[pb + 0] = s0;
      let s1: f32 = vPhase[pb + 1]; s1 += baseInc * barRatio[1]; if (s1 >= 1.0) s1 -= 1.0; vPhase[pb + 1] = s1;
      let s2: f32 = vPhase[pb + 2]; s2 += baseInc * barRatio[2]; if (s2 >= 1.0) s2 -= 1.0; vPhase[pb + 2] = s2;
      let s3: f32 = vPhase[pb + 3]; s3 += baseInc * barRatio[3]; if (s3 >= 1.0) s3 -= 1.0; vPhase[pb + 3] = s3;
      let s4: f32 = vPhase[pb + 4]; s4 += baseInc * barRatio[4]; if (s4 >= 1.0) s4 -= 1.0; vPhase[pb + 4] = s4;
      let s5: f32 = vPhase[pb + 5]; s5 += baseInc * barRatio[5]; if (s5 >= 1.0) s5 -= 1.0; vPhase[pb + 5] = s5;
      let s6: f32 = vPhase[pb + 6]; s6 += baseInc * barRatio[6]; if (s6 >= 1.0) s6 -= 1.0; vPhase[pb + 6] = s6;

      let tone: f32 =
          sine01(s0) * lvl0 +
          sine01(s1) * lvl1 +
          sine01(s2) * lvl2 +
          sine01(s3) * lvl3 +
          sine01(s4) * lvl4 +
          sine01(s5) * lvl5 +
          sine01(s6) * lvl6;
      tone *= barNorm;

      // ---- percussion tap (decaying harmonic, single-trigger) -------
      let pc: f32 = vPerc[v];
      if (pc > 0.0001) {
        // reuse a phase that runs at percRatio of the fundamental
        // (derive from the 8' phase scaled — cheap & coherent)
        const pph: f32 = s1 * percRatio;
        tone += sine01(pph) * pc * percAmt;
        pc *= percDecay;
      } else {
        pc = 0.0;
      }
      vPerc[v] = pc;

      // ---- key-click transient --------------------------------------
      let ck: f32 = vClick[v];
      if (ck > 0.001) {
        tone += noise() * ck * 0.35;
        ck *= clickDecay;
      } else {
        ck = 0.0;
      }
      vClick[v] = ck;

      const voice: f32 = tone * env * (0.5 + 0.5 * vVel[v]);
      mixL += voice;
      mixR += voice;
    }

    // ---- tube overdrive (shared output stage) ---------------------
    let dl: f32 = mixL * driveGain;
    let dr: f32 = mixR * driveGain;
    // cubic-ish soft clip
    dl = clampf(dl, -1.5, 1.5); dl = dl - 0.18 * dl * dl * dl;
    dr = clampf(dr, -1.5, 1.5); dr = dr - 0.18 * dr * dr * dr;
    dl *= driveComp;
    dr *= driveComp;

    // ---- rotary speaker amplitude motion + output level -----------
    let outL: f32 = dl * tremL * 0.7;
    let outR: f32 = dr * tremR * 0.7;

    outBuf[f] = clampf(outL, -1.0, 1.0);
    outBuf[MAX_FRAMES + f] = clampf(outR, -1.0, 1.0);
  }
}
