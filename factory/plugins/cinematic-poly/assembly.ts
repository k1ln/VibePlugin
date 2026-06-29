// =====================================================================
//  CINEMATIC POLY — a lush, grand, brass-leaning polyphonic synthesizer.
//  An original instrument inspired by the great wood-cheeked cinematic
//  polysynths: up to EIGHT voices keyed by noteId, each voice running TWO
//  independent layers. Every layer pairs a band-limited saw with a pulse
//  oscillator (slightly detuned against each other and against the other
//  layer) and feeds them through its OWN resonant low-pass filter that is
//  swept by a per-layer filter ADSR (Cutoff + FilterEnvAmt). An amplitude
//  ADSR shapes each voice, the two layers are octave/detune-stacked for a
//  thick choral body, and the summed mix passes through a gentle global
//  ensemble chorus plus a brightness tilt for the cinematic brass sheen.
//  Pure algorithm — no samples, no host imports, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;
const NUM_LAYERS: i32 = 2;
const NUM_SLOTS: i32 = 16;   // NUM_VOICES * NUM_LAYERS — one filter set per layer

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_DETUNE:  i32 = 0;  // 0..1  -> layer + osc detune spread
const P_CUTOFF:  i32 = 1;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount (octaves)
const P_ATTACK:  i32 = 4;  // 0..1  -> amp + filter attack time
const P_RELEASE: i32 = 5;  // 0..1  -> amp + filter release time
const P_BRIGHT:  i32 = 6;  // 0..1  -> global high-frequency tilt / sheen
const P_LEVEL:   i32 = 7;  // 0..1  -> master output level

// ---- per-VOICE state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// amplitude envelope (one per voice)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 3 sus 4 rel
// filter envelope (one per voice, shared by its two layers)
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// ---- per-LAYER state (NUM_SLOTS = voice*NUM_LAYERS + layer) ---------
const lPhaseA: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS); // saw phase
const lPhaseB: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS); // pulse phase
// resonant 4-pole ladder low-pass per layer (4 one-pole states)
const lF0: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS);
const lF1: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS);
const lF2: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS);
const lF3: StaticArray<f32> = new StaticArray<f32>(NUM_SLOTS);

let ageCounter: i32 = 0;

// ---- global ensemble chorus state (3 modulated delay taps) ----------
const CHORUS_LEN: i32 = 2048;
const chorusL: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
const chorusR: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
let chorusW: i32 = 0;
let lfo1: f32 = 0.0;
let lfo2: f32 = 0.0;
let lfo3: f32 = 0.0;

// global brightness tilt one-pole (per channel) for the post sheen
let tiltL: f32 = 0.0;
let tiltR: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
  }
  for (let s = 0; s < NUM_SLOTS; s++) {
    lPhaseA[s] = 0.0; lPhaseB[s] = 0.0;
    lF0[s] = 0.0; lF1[s] = 0.0; lF2[s] = 0.0; lF3[s] = 0.0;
  }
  for (let i = 0; i < CHORUS_LEN; i++) { chorusL[i] = 0.0; chorusR[i] = 0.0; }
  chorusW = 0; lfo1 = 0.0; lfo2 = 0.0; lfo3 = 0.0;
  tiltL = 0.0; tiltR = 0.0;
  ageCounter = 0;

  params[P_DETUNE] = 0.35;
  params[P_CUTOFF] = 0.5;
  params[P_RESO]   = 0.3;
  params[P_ENVAMT] = 0.55;
  params[P_ATTACK] = 0.18;
  params[P_RELEASE]= 0.4;
  params[P_BRIGHT] = 0.55;
  params[P_LEVEL]  = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

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
  vAStage[slot] = 1;   // attack
  vFStage[slot] = 1;
  vAEnv[slot]   = 0.0;
  vFEnv[slot]   = 0.0;

  // reset both layers' oscillators with offset phases so detune beats start
  // coherently but the stack is never phase-locked
  const base: i32 = slot * NUM_LAYERS;
  lPhaseA[base + 0] = 0.0;  lPhaseB[base + 0] = 0.25;
  lPhaseA[base + 1] = 0.5;  lPhaseB[base + 1] = 0.75;
  for (let k = 0; k < NUM_LAYERS; k++) {
    const s: i32 = base + k;
    lF0[s] = 0.0; lF1[s] = 0.0; lF2[s] = 0.0; lF3[s] = 0.0;
  }
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 4;  // release
      vFStage[i] = 4;
    }
  }
}

// polyBLEP correction removes the worst aliasing on saw/pulse edges
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const detune: f32  = clampf(params[P_DETUNE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const brightN: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // cinematic vibe: long, expressive attacks/releases by default; sustain is full
  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.2;
  const relS: f32 = 0.02  + clampf(params[P_RELEASE], 0.0, 1.0) * 3.5;
  const decS: f32 = 0.6;            // gentle internal decay to sustain
  const susL: f32 = 0.85;           // near-full sustain for a lush pad

  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune spread (semitone fractions). One layer sits slightly sharp, one
  // slightly flat, and inside each layer the two oscillators spread further.
  const layerSemi: f32 = detune * 0.12;                 // between the two layers
  const oscSemi: f32   = detune * 0.22;                 // saw vs pulse within a layer
  const layerUp: f32   = f32(Mathf.pow(2.0,  layerSemi / 12.0));
  const layerDn: f32   = f32(Mathf.pow(2.0, -layerSemi / 12.0));
  const oscUp: f32     = f32(Mathf.pow(2.0,  oscSemi / 12.0));
  const oscDn: f32     = f32(Mathf.pow(2.0, -oscSemi / 12.0));

  // base cutoff in Hz, exponential 80 Hz .. ~14 kHz; brightness lifts it too
  const baseHz: f32 = 80.0 * f32(Mathf.pow(180.0, cutoffN)) * (0.7 + brightN * 0.8);
  const envOct: f32 = envAmt * 6.0;                     // env sweep range in octaves
  const reso: f32   = resoN * 3.8;                      // ladder feedback

  // headroom: 8 voices * 2 layers summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.34;

  // global ensemble chorus rates (slow, multi-phase) — depth tracks brightness
  const lfoInc1: f32 = TWO_PI * 0.18 / sr;
  const lfoInc2: f32 = TWO_PI * 0.27 / sr;
  const lfoInc3: f32 = TWO_PI * 0.41 / sr;
  const chDepth: f32 = 7.0 + brightN * 6.0;             // samples of delay sweep
  const chCenter: f32 = 20.0;

  // post brightness tilt: a one-pole high-shelf-ish blend. brightN raises the
  // proportion of the high (residual) band added back in.
  const tiltCoef: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 2600.0 / sr));
  const tiltAmt: f32  = -0.5 + brightN * 1.4;           // -0.5 (dark) .. +0.9 (bright)

  for (let f = 0; f < n; f++) {
    let mixL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude ADSR ---------------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {
        aenv -= decRate * (1.0 - susL);
        if (aenv <= susL) { aenv = susL; astg = 3; }
      } else if (astg == 3) {
        aenv = susL;
      } else if (astg == 4) {
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter ADSR (shared by both layers) ------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv -= decRate * (1.0 - susL);
        if (fenv <= susL) { fenv = susL; fstg = 3; }
      } else if (fstg == 3) {
        fenv = susL;
      } else if (fstg == 4) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      const baseInc: f32 = vFreq[v] / sr;
      const ampV: f32 = aenv * vVel[v];

      // layer cutoff (Hz) from base + filter envelope, clamped
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 30.0) fc = 30.0;
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      const base: i32 = v * NUM_LAYERS;

      // ---- LAYER 0 (lower, fundamental) -------------------------
      {
        const s: i32 = base + 0;
        const incA: f32 = baseInc * layerDn * oscDn;     // saw
        const incB: f32 = baseInc * layerDn * oscUp;     // pulse

        let pa: f32 = lPhaseA[s];
        pa += incA; if (pa >= 1.0) pa -= 1.0;
        let saw: f32 = 2.0 * pa - 1.0;
        saw -= polyBlep(pa, incA);
        lPhaseA[s] = pa;

        let pb: f32 = lPhaseB[s];
        pb += incB; if (pb >= 1.0) pb -= 1.0;
        const pw: f32 = 0.5;
        let sq: f32 = pb < pw ? 1.0 : -1.0;
        sq += polyBlep(pb, incB);
        let pb2: f32 = pb + (1.0 - pw); if (pb2 >= 1.0) pb2 -= 1.0;
        sq -= polyBlep(pb2, incB);
        lPhaseB[s] = pb;

        let osc: f32 = saw * 0.6 + sq * 0.42;

        let s0: f32 = lF0[s];
        let s1: f32 = lF1[s];
        let s2: f32 = lF2[s];
        let s3: f32 = lF3[s];
        let inp: f32 = osc - reso * s3;
        inp = f32(Mathf.tanh(inp));
        s0 += g * (inp - s0);
        s1 += g * (s0 - s1);
        s2 += g * (s1 - s2);
        s3 += g * (s2 - s3);
        lF0[s] = s0; lF1[s] = s1; lF2[s] = s2; lF3[s] = s3;

        mixL += s3 * ampV;
      }

      // ---- LAYER 1 (upper, brighter octave-ish stack) -----------
      {
        const s: i32 = base + 1;
        // upper layer rides a touch sharp and a hair higher in register
        const incA: f32 = baseInc * layerUp * oscUp;     // saw
        const incB: f32 = baseInc * layerUp * oscDn;     // pulse

        let pa: f32 = lPhaseA[s];
        pa += incA; if (pa >= 1.0) pa -= 1.0;
        let saw: f32 = 2.0 * pa - 1.0;
        saw -= polyBlep(pa, incA);
        lPhaseA[s] = pa;

        let pb: f32 = lPhaseB[s];
        pb += incB; if (pb >= 1.0) pb -= 1.0;
        const pw: f32 = 0.4;                              // narrower pulse = reedier
        let sq: f32 = pb < pw ? 1.0 : -1.0;
        sq += polyBlep(pb, incB);
        let pb2: f32 = pb + (1.0 - pw); if (pb2 >= 1.0) pb2 -= 1.0;
        sq -= polyBlep(pb2, incB);
        lPhaseB[s] = pb;

        let osc: f32 = saw * 0.5 + sq * 0.4;

        // upper layer opens a little brighter for the brass sheen
        let g2: f32 = g * (1.0 + brightN * 0.6);
        if (g2 > 0.99) g2 = 0.99;

        let s0: f32 = lF0[s];
        let s1: f32 = lF1[s];
        let s2: f32 = lF2[s];
        let s3: f32 = lF3[s];
        let inp: f32 = osc - reso * s3;
        inp = f32(Mathf.tanh(inp));
        s0 += g2 * (inp - s0);
        s1 += g2 * (s0 - s1);
        s2 += g2 * (s1 - s2);
        s3 += g2 * (s2 - s3);
        lF0[s] = s0; lF1[s] = s1; lF2[s] = s2; lF3[s] = s3;

        mixL += s3 * ampV * 0.85;
      }
    }

    // ---- voice sum + analog glue -------------------------------
    let dry: f32 = mixL * voiceScale;
    dry = f32(Mathf.tanh(dry * 1.1));

    // ---- post brightness tilt (residual high band) -------------
    tiltL += tiltCoef * (dry - tiltL);
    const high: f32 = dry - tiltL;                // high-frequency residual
    let toned: f32 = dry + high * tiltAmt;

    // ---- global ensemble chorus (stereo) -----------------------
    lfo1 += lfoInc1; if (lfo1 > TWO_PI) lfo1 -= TWO_PI;
    lfo2 += lfoInc2; if (lfo2 > TWO_PI) lfo2 -= TWO_PI;
    lfo3 += lfoInc3; if (lfo3 > TWO_PI) lfo3 -= TWO_PI;

    // write current sample into the ring buffers
    chorusL[chorusW] = toned;
    chorusR[chorusW] = toned;

    const d1: f32 = chCenter + chDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo1)));
    const d2: f32 = chCenter + chDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo2)));
    const d3: f32 = chCenter + chDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo3)));

    const wetL: f32 = readDelay(chorusL, d1) * 0.6 + readDelay(chorusL, d3) * 0.4;
    const wetR: f32 = readDelay(chorusR, d2) * 0.6 + readDelay(chorusR, d3) * 0.4;

    chorusW++; if (chorusW >= CHORUS_LEN) chorusW = 0;

    // gentle ensemble blend — always present, a touch wider with brightness
    const chMix: f32 = 0.4 + brightN * 0.15;
    let outL: f32 = toned * (1.0 - chMix * 0.5) + wetL * chMix;
    let outR: f32 = toned * (1.0 - chMix * 0.5) + wetR * chMix;

    // ---- master level + safety clip ----------------------------
    const gain: f32 = level * 1.05;
    outL = f32(Mathf.tanh(outL * gain));
    outR = f32(Mathf.tanh(outR * gain));

    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }
}

// read a fractional delay from a chorus ring buffer (linear interp)
@inline function readDelay(buf: StaticArray<f32>, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 1.0) d = 1.0;
  if (d > f32(CHORUS_LEN - 2)) d = f32(CHORUS_LEN - 2);
  let rp: f32 = f32(chorusW) - d;
  while (rp < 0.0) rp += f32(CHORUS_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= CHORUS_LEN) i1 -= CHORUS_LEN;
  const frac: f32 = rp - f32(i0);
  const a: f32 = buf[i0];
  const b: f32 = buf[i1];
  return f32(a + (b - a) * frac);
}
