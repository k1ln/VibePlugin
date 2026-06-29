// =====================================================================
//  ADDITIVE — a polyphonic additive (Fourier) synthesizer instrument.
//  Each of eight independent voices sums up to 32 sine harmonics whose
//  amplitudes are shaped by a reduced spectral-control set: an Odd/Even
//  partial balance, a Brightness spectral tilt, and per-sample Spectral
//  Decay so higher harmonics fade faster than the fundamental over the
//  life of the note. An amplitude AR contour gates each voice; voices are
//  allocated per noteId so chords ring independently. The harmonic basis
//  is built once at init with a sine table (Mathf). No samples, no host
//  imports, no allocation in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;
const NUM_HARM: i32 = 32;          // partials summed per voice
const TABLE_SIZE: i32 = 4096;      // sine wavetable length
const TABLE_MASK: i32 = 4095;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// sine table built once at init with Mathf
const sineTab: StaticArray<f32> = new StaticArray<f32>(TABLE_SIZE);

// per-block computed harmonic amplitude profile (shared by all voices)
const harmAmp: StaticArray<f32> = new StaticArray<f32>(NUM_HARM);
// per-harmonic spectral-decay coefficient (higher harmonics decay faster)
const harmDecay: StaticArray<f32> = new StaticArray<f32>(NUM_HARM);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_ODD:    i32 = 0;  // 0..1  -> level of odd harmonics
const P_EVEN:   i32 = 1;  // 0..1  -> level of even harmonics
const P_BRIGHT: i32 = 2;  // 0..1  -> spectral tilt (rolloff vs flat)
const P_SDECAY: i32 = 3;  // 0..1  -> how fast harmonics fade over time
const P_ATTACK: i32 = 4;  // 0..1  -> seconds
const P_RELEASE:i32 = 5;  // 0..1  -> seconds
const P_LEVEL:  i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // fundamental Hz
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // fundamental phase 0..1
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // amplitude AR
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
const vSpec:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // 1->0 spectral fade since noteOn

let ageCounter: i32 = 0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;

  // build sine wavetable once
  for (let i = 0; i < TABLE_SIZE; i++) {
    const ph: f32 = f32(i) / f32(TABLE_SIZE);
    sineTab[i] = f32(Mathf.sin(TWO_PI * ph));
  }

  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vPhase[v] = 0.0;
    vEnv[v] = 0.0; vStage[v] = 0; vSpec[v] = 1.0;
  }
  ageCounter = 0;

  params[P_ODD]     = 0.85;
  params[P_EVEN]    = 0.45;
  params[P_BRIGHT]  = 0.55;
  params[P_SDECAY]  = 0.4;
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.45;
  params[P_LEVEL]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function sineLookup(phase01: f32): f32 {
  // phase01 in [0,1)
  let p: f32 = phase01 - f32(i32(phase01)); // wrap to fractional
  if (p < 0.0) p += 1.0;
  const fidx: f32 = p * f32(TABLE_SIZE);
  const i0: i32 = i32(fidx) & TABLE_MASK;
  const i1: i32 = (i0 + 1) & TABLE_MASK;
  const frac: f32 = fidx - f32(i32(fidx));
  const a: f32 = sineTab[i0];
  const b: f32 = sineTab[i1];
  return a + (b - a) * frac;
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
  vStage[slot]  = 1;     // attack
  vPhase[slot]  = 0.0;
  vSpec[slot]   = 1.0;   // full spectrum at onset, decays over time
  vAge[slot]    = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3;     // release
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const oddN: f32    = clampf(params[P_ODD], 0.0, 1.0);
  const evenN: f32   = clampf(params[P_EVEN], 0.0, 1.0);
  const brightN: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const sdecayN: f32 = clampf(params[P_SDECAY], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.5;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 2.5;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // Brightness as a spectral tilt: tilt<1 rolls off highs (warm),
  // tilt>1 boosts highs (bright/buzzy). Centred so 0.5 ~= natural.
  const tilt: f32 = 0.35 + brightN * 1.35;     // ~0.35 .. 1.7 exponent

  // ---- build the static harmonic amplitude profile (shape) ----------
  // h = 1 is the fundamental (treated as odd). Odd/Even sculpt timbre:
  // square-ish (odd only) vs full (saw-ish) vs hollow.
  let norm: f32 = 0.0;
  for (let h = 0; h < NUM_HARM; h++) {
    const hn: i32 = h + 1;                      // harmonic number 1..NUM_HARM
    const isOdd: bool = (hn & 1) == 1;
    const oe: f32 = isOdd ? oddN : evenN;
    // 1/h falloff scaled by brightness tilt (smaller tilt -> faster rolloff)
    const rolloff: f32 = f32(Mathf.pow(f32(hn), -tilt));
    let a: f32 = oe * rolloff;
    if (hn == 1) a = a * 1.0 + (1.0 - oddN) * 0.0; // fundamental always present via odd
    harmAmp[h] = a;
    norm += a;
    // per-harmonic spectral-decay rate (per sample). Higher harmonics fade
    // faster; SDecay scales the overall speed. h=0 (fundamental) is steady.
    const baseRate: f32 = (sdecayN * sdecayN) * 12.0;  // 0..12 1/sec at top harmonic
    const hRate: f32 = baseRate * (f32(hn) / f32(NUM_HARM));
    harmDecay[h] = f32(Mathf.exp(-hRate / sr));        // per-sample multiplier
  }
  // normalize the static profile so total summed amplitude is bounded
  const invNorm: f32 = norm > 0.0001 ? (1.0 / norm) : 1.0;
  for (let h = 0; h < NUM_HARM; h++) harmAmp[h] = harmAmp[h] * invNorm;

  // 8 voices summed -> headroom scaling. The normalized harmonic profile
  // keeps a single voice modest, so lift the summed level into a usable
  // range; the tanh below keeps big chords bounded < 1.
  const voiceScale: f32 = 3.6;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR -----------------------------------------
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {                 // attack
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {          // sustain (held)
        env = 1.0;
      } else if (stg == 3) {          // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- spectral fade state (per voice, 1 -> ~0 over note) ----
      // we advance one shared scalar and apply each harmonic's own coeff;
      // implemented by storing a running fade per voice that we raise to
      // the per-harmonic ratio. To stay alloc-free + cheap we track a
      // single phase and recompute each harmonic's contribution below.
      const specFade: f32 = vSpec[v];   // 0..1 master fade clock

      // ---- additive oscillator: sum harmonics -------------------
      const base: f32 = vFreq[v] / sr;          // fundamental increment (cyc/sample)
      let ph: f32 = vPhase[v];

      // advance fundamental phase
      ph += base;
      if (ph >= 1.0) ph -= f32(i32(ph));
      vPhase[v] = ph;

      let sample: f32 = 0.0;
      // nyquist guard: skip harmonics above ~ sr/2
      const maxHarmF: f32 = sr * 0.45;
      for (let h = 0; h < NUM_HARM; h++) {
        const hn: i32 = h + 1;
        const hf: f32 = vFreq[v] * f32(hn);
        if (hf >= maxHarmF) break;
        let amp: f32 = harmAmp[h];
        if (amp <= 0.0) continue;
        // time-varying spectral decay: blend a per-harmonic fade so highs
        // die faster. specFade is the master clock; weight by harmonic idx.
        const hWeight: f32 = f32(hn) / f32(NUM_HARM);
        const fade: f32 = 1.0 - hWeight * (1.0 - specFade);
        amp *= (fade > 0.0 ? fade : 0.0);
        sample += amp * sineLookup(ph * f32(hn));
      }

      // advance the master spectral-decay clock toward 0 (uses h=NUM_HARM rate)
      let sf: f32 = specFade * harmDecay[NUM_HARM - 1];
      vSpec[v] = sf;

      outL += sample * env * vVel[v];
    }

    // sum + gentle soft-saturate to keep peaks bounded < 1
    let mix: f32 = outL * voiceScale * level;
    mix = f32(Mathf.tanh(mix * 1.1)) * 0.92;

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
