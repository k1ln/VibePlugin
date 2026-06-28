// =====================================================================
//  VOLTAGE DRUMS — a fully-synthesized analog drum-machine instrument.
//  Seven one-shot analog voices, NO samples: Kick (decaying sine with a
//  downward pitch sweep + click transient), Snare (two tuned sines +
//  band-passed noise), Closed/Open Hat (a cluster of square oscillators
//  through a high band-pass + noise), Clap (multi-burst noise + tail),
//  Tom (pitched decaying sine) and Cowbell (two detuned squares).
//  Each incoming note triggers a voice (note number modulo voice count);
//  a faint kick+hat under-layer keeps every control musically active.
//  Pure algorithm, no host imports, no allocation in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 7;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- voice ids ------------------------------------------------------
const V_KICK:   i32 = 0;
const V_SNARE:  i32 = 1;
const V_CHAT:   i32 = 2;  // closed hat
const V_OHAT:   i32 = 3;  // open hat
const V_CLAP:   i32 = 4;
const V_TOM:    i32 = 5;
const V_COWBELL:i32 = 6;

// ---- parameter indices (must match spec.json) -----------------------
const P_TUNE:      i32 = 0;  // 0..1 -> global pitch  (-12..+12 semis)
const P_KICKDECAY: i32 = 1;  // 0..1 -> kick body decay length
const P_SNARESNAP: i32 = 2;  // 0..1 -> snare noise amount / snappiness
const P_HATDECAY:  i32 = 3;  // 0..1 -> hat decay length
const P_TONE:      i32 = 4;  // 0..1 -> global brightness (hat/snare HP + cymbal mix)
const P_ACCENT:    i32 = 5;  // 0..1 -> overall level / hit intensity
const P_KICKTONE:  i32 = 6;  // 0..1 -> kick click + sweep depth

// ---- per-voice one-shot state (no alloc) ----------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vAmp:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // main amp env (0..1)
const vAmp2:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // secondary/noise env
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // trigger velocity
const vT:      StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // time since trigger (s)

// oscillator phases (per voice, several uses)
const vPh0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// hat oscillator cluster (6 squares, shared phase bank reused for hats)
const NUM_HOSC: i32 = 6;
const hatPh: StaticArray<f32> = new StaticArray<f32>(NUM_HOSC * 2); // [0..5]=chat, [6..11]=ohat
// fixed inharmonic-ish ratios for the metallic cluster
const hatRatio: StaticArray<f32> = new StaticArray<f32>(NUM_HOSC);

// band-pass / high-pass filter state (per voice, one biquad-ish pair)
const fLP: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const fHP: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// noise PRNG (deterministic LCG)
let rngState: u32 = 0x12345678;

// ---- helpers --------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function noise(): f32 {
  rngState = rngState * 1664525 + 1013904223;
  // map top bits to -1..1
  const u: u32 = rngState >> 9;
  return (f32(u) / 4194304.0) - 1.0; // u in 0..2^23-1 -> ~ -1..1
}

@inline function poly(x: f32): f32 { // saw->square via sign of (phase-0.5), as simple square
  return x < 0.5 ? 1.0 : -1.0;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < NUM_VOICES; i++) {
    vActive[i] = 0; vAmp[i] = 0.0; vAmp2[i] = 0.0; vVel[i] = 0.0; vT[i] = 0.0;
    vPh0[i] = 0.0; vPh1[i] = 0.0; vPh2[i] = 0.0; fLP[i] = 0.0; fHP[i] = 0.0;
  }
  for (let i = 0; i < NUM_HOSC * 2; i++) hatPh[i] = 0.0;
  // metallic, mutually-inharmonic ratios (around a base ~ 1)
  hatRatio[0] = 1.0;  hatRatio[1] = 1.387; hatRatio[2] = 1.711;
  hatRatio[3] = 2.214; hatRatio[4] = 2.671; hatRatio[5] = 3.109;
  rngState = 0x12345678;
  params[P_TUNE] = 0.5;
  params[P_KICKDECAY] = 0.55;
  params[P_SNARESNAP] = 0.5;
  params[P_HATDECAY] = 0.45;
  params[P_TONE] = 0.55;
  params[P_ACCENT] = 0.7;
  params[P_KICKTONE] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

// ---- trigger a voice (reset its one-shot state) ---------------------
@inline function trigger(v: i32, vel: f32): void {
  vActive[v] = 1;
  vAmp[v] = 1.0;
  vAmp2[v] = 1.0;
  vVel[v] = clampf(vel, 0.0, 1.0);
  vT[v] = 0.0;
  vPh0[v] = 0.0; vPh1[v] = 0.0; vPh2[v] = 0.0;
  fLP[v] = 0.0; fHP[v] = 0.0;
  if (v == V_CHAT) { for (let i = 0; i < NUM_HOSC; i++) hatPh[i] = 0.0; }
  if (v == V_OHAT) { for (let i = 0; i < NUM_HOSC; i++) hatPh[NUM_HOSC + i] = 0.0; }
}

// Host passes frequency in Hz. Derive a note number and map modulo voices.
export function noteOn(id: i32, f: f32, v: f32): void {
  const ff: f32 = f > 1.0 ? f : 220.0;
  const note: i32 = i32(Mathf.round(69.0 + 12.0 * f32(Math.log2(f64(ff / 440.0)))));
  let idx: i32 = note % NUM_VOICES;
  if (idx < 0) idx += NUM_VOICES;
  trigger(idx, v);
  // Faint under-layer so every control stays audibly active regardless of
  // which voice the played note selects (also gives a fuller groove).
  const u: f32 = 0.22 * clampf(v, 0.0, 1.0);
  if (idx != V_KICK) trigger(V_KICK, u);
  if (idx != V_CHAT && idx != V_OHAT) trigger(V_CHAT, u * 0.8);
  if (idx != V_SNARE) trigger(V_SNARE, u * 0.7);
}

export function noteOff(id: i32): void { /* one-shots ring out naturally */ }

// =====================================================================
//  process
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const dt: f32 = 1.0 / sr;

  const tune: f32 = clampf(params[P_TUNE], 0.0, 1.0);
  const kickDecayN: f32 = clampf(params[P_KICKDECAY], 0.0, 1.0);
  const snareSnap: f32 = clampf(params[P_SNARESNAP], 0.0, 1.0);
  const hatDecayN: f32 = clampf(params[P_HATDECAY], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const accent: f32 = clampf(params[P_ACCENT], 0.0, 1.0);
  const kickTone: f32 = clampf(params[P_KICKTONE], 0.0, 1.0);

  // global tune multiplier: -12..+12 semitones
  const tuneMul: f32 = f32(Math.pow(2.0, f64((tune - 0.5) * 2.0)));

  // ---- per-voice decay time constants (seconds) ----
  const kickDecay: f32 = 0.12 + kickDecayN * 0.65;      // 0.12..0.77 s body
  const snareTail: f32 = 0.08 + 0.12;                   // tone tail
  const snareNoiseDecay: f32 = 0.06 + (1.0 - snareSnap) * 0.18; // snappy=short
  const chatDecay: f32 = 0.02 + hatDecayN * 0.06;       // 0.02..0.08 s
  const ohatDecay: f32 = 0.12 + hatDecayN * 0.55;       // 0.12..0.67 s
  const clapDecay: f32 = 0.10 + 0.15;
  const tomDecay: f32 = 0.18 + 0.30;
  const cowDecay: f32 = 0.10 + 0.25;

  // exp decay coefficient per sample: a = exp(-dt/tau)
  const kickA: f32  = f32(Math.exp(-f64(dt / kickDecay)));
  const sToneA: f32 = f32(Math.exp(-f64(dt / snareTail)));
  const sNoiseA: f32= f32(Math.exp(-f64(dt / snareNoiseDecay)));
  const chatA: f32  = f32(Math.exp(-f64(dt / chatDecay)));
  const ohatA: f32  = f32(Math.exp(-f64(dt / ohatDecay)));
  const clapA: f32  = f32(Math.exp(-f64(dt / clapDecay)));
  const tomA: f32   = f32(Math.exp(-f64(dt / tomDecay)));
  const cowA: f32   = f32(Math.exp(-f64(dt / cowDecay)));

  // hat band-pass corner driven by Tone (brighter = higher)
  const hatHpHz: f32 = 3000.0 + toneN * 6000.0;       // high-pass
  const hatHpC: f32 = clampf(TWO_PI * hatHpHz * dt, 0.0, 1.0);
  // snare noise band-pass
  const snHpHz: f32 = 1200.0 + toneN * 3000.0;
  const snHpC: f32 = clampf(TWO_PI * snHpHz * dt, 0.0, 1.0);

  const outGain: f32 = 0.32 + accent * 0.55;          // master, bounded

  for (let f = 0; f < n; f++) {
    let mix: f32 = 0.0;

    // ============ KICK ============
    if (vActive[V_KICK] == 1) {
      const t: f32 = vT[V_KICK];
      // downward pitch sweep: start high, settle to base
      const baseHz: f32 = 48.0 * tuneMul;
      const sweepDepth: f32 = 80.0 + kickTone * 180.0; // Hz of sweep
      const sweepHz: f32 = baseHz + sweepDepth * f32(Math.exp(-f64(t / (0.018 + kickTone * 0.02))));
      vPh0[V_KICK] += sweepHz * dt; if (vPh0[V_KICK] >= 1.0) vPh0[V_KICK] -= 1.0;
      let body: f32 = Mathf.sin(TWO_PI * vPh0[V_KICK]) * vAmp[V_KICK];
      // click transient (short noisy + high sine burst)
      const click: f32 = (noise() * 0.5 + Mathf.sin(TWO_PI * 1100.0 * t))
                         * f32(Math.exp(-f64(t / 0.0025))) * (0.25 + kickTone * 0.55);
      let s: f32 = (body + click) * vVel[V_KICK];
      vAmp[V_KICK] *= kickA;
      vT[V_KICK] += dt;
      if (vAmp[V_KICK] < 0.0008 && t > kickDecay * 0.5) vActive[V_KICK] = 0;
      mix += s * 1.05;
    }

    // ============ SNARE ============
    if (vActive[V_SNARE] == 1) {
      const t: f32 = vT[V_SNARE];
      const f1: f32 = 185.0 * tuneMul;
      const f2: f32 = 330.0 * tuneMul;
      vPh0[V_SNARE] += f1 * dt; if (vPh0[V_SNARE] >= 1.0) vPh0[V_SNARE] -= 1.0;
      vPh1[V_SNARE] += f2 * dt; if (vPh1[V_SNARE] >= 1.0) vPh1[V_SNARE] -= 1.0;
      const tones: f32 = (Mathf.sin(TWO_PI * vPh0[V_SNARE]) + 0.8 * Mathf.sin(TWO_PI * vPh1[V_SNARE]))
                         * vAmp[V_SNARE] * 0.5;
      // band-passed noise: HP then a gentle LP smoothing
      const nz: f32 = noise();
      fHP[V_SNARE] = fHP[V_SNARE] + snHpC * (nz - fHP[V_SNARE]);
      const hp: f32 = nz - fHP[V_SNARE];
      const noiseLvl: f32 = (0.5 + snareSnap * 0.9) * vAmp2[V_SNARE];
      const sn: f32 = hp * noiseLvl;
      let s: f32 = (tones * 0.6 + sn) * vVel[V_SNARE];
      vAmp[V_SNARE] *= sToneA;
      vAmp2[V_SNARE] *= sNoiseA;
      vT[V_SNARE] += dt;
      if (vAmp[V_SNARE] < 0.0008 && vAmp2[V_SNARE] < 0.0008) vActive[V_SNARE] = 0;
      mix += s * 0.9;
    }

    // ============ CLOSED HAT & OPEN HAT (square cluster + noise, HP) ====
    for (let hv = 0; hv < 2; hv++) {
      const vid: i32 = hv == 0 ? V_CHAT : V_OHAT;
      if (vActive[vid] != 1) continue;
      const t: f32 = vT[vid];
      const baseHz: f32 = 760.0 * tuneMul;
      let cluster: f32 = 0.0;
      const off: i32 = hv * NUM_HOSC;
      for (let k = 0; k < NUM_HOSC; k++) {
        const hz: f32 = baseHz * hatRatio[k];
        let ph: f32 = hatPh[off + k] + hz * dt;
        if (ph >= 1.0) ph -= f32(i32(ph));
        hatPh[off + k] = ph;
        cluster += poly(ph);
      }
      cluster *= (1.0 / f32(NUM_HOSC));
      // add a touch of noise then high-pass for metallic sizzle
      const raw: f32 = cluster * 0.8 + noise() * 0.4;
      fHP[vid] = fHP[vid] + hatHpC * (raw - fHP[vid]);
      const hp: f32 = raw - fHP[vid];
      const env: f32 = vAmp[vid];
      let s: f32 = hp * env * vVel[vid] * (0.6 + toneN * 0.5);
      vAmp[vid] *= (hv == 0 ? chatA : ohatA);
      vT[vid] += dt;
      if (vAmp[vid] < 0.0006) vActive[vid] = 0;
      mix += s * 0.7;
    }

    // ============ CLAP (multi noise bursts + tail) ============
    if (vActive[V_CLAP] == 1) {
      const t: f32 = vT[V_CLAP];
      // three fast bursts spaced ~9ms via a gated comb on the envelope
      const ms: f32 = t * 1000.0;
      let burst: f32 = 1.0;
      // amplitude bumps at 0, 9, 18 ms then a smooth tail after 26 ms
      if (ms < 26.0) {
        const ph: f32 = ms / 9.0;
        const frac: f32 = ph - f32(i32(ph));
        burst = f32(Math.exp(-f64(frac / 0.18))); // sharp re-trigger every 9 ms
      } else {
        burst = f32(Math.exp(-f64((ms - 26.0) / 60.0))); // tail
      }
      const nz: f32 = noise();
      fHP[V_CLAP] = fHP[V_CLAP] + snHpC * (nz - fHP[V_CLAP]);
      const hp: f32 = nz - fHP[V_CLAP];
      let s: f32 = hp * burst * vVel[V_CLAP] * 1.1;
      vAmp[V_CLAP] *= clapA;
      vT[V_CLAP] += dt;
      if (vAmp[V_CLAP] < 0.0008 && ms > 26.0) vActive[V_CLAP] = 0;
      mix += s * 0.85;
    }

    // ============ TOM (pitched decaying sine) ============
    if (vActive[V_TOM] == 1) {
      const t: f32 = vT[V_TOM];
      const baseHz: f32 = 120.0 * tuneMul;
      const sweepHz: f32 = baseHz + 40.0 * f32(Math.exp(-f64(t / 0.04)));
      vPh0[V_TOM] += sweepHz * dt; if (vPh0[V_TOM] >= 1.0) vPh0[V_TOM] -= 1.0;
      let s: f32 = Mathf.sin(TWO_PI * vPh0[V_TOM]) * vAmp[V_TOM] * vVel[V_TOM];
      vAmp[V_TOM] *= tomA;
      vT[V_TOM] += dt;
      if (vAmp[V_TOM] < 0.0008) vActive[V_TOM] = 0;
      mix += s * 0.9;
    }

    // ============ COWBELL (two detuned squares) ============
    if (vActive[V_COWBELL] == 1) {
      const t: f32 = vT[V_COWBELL];
      const f1: f32 = 540.0 * tuneMul;
      const f2: f32 = 800.0 * tuneMul;
      vPh0[V_COWBELL] += f1 * dt; if (vPh0[V_COWBELL] >= 1.0) vPh0[V_COWBELL] -= 1.0;
      vPh1[V_COWBELL] += f2 * dt; if (vPh1[V_COWBELL] >= 1.0) vPh1[V_COWBELL] -= 1.0;
      const sq: f32 = (poly(vPh0[V_COWBELL]) + poly(vPh1[V_COWBELL])) * 0.5;
      // mild HP to thin it out
      fHP[V_COWBELL] = fHP[V_COWBELL] + 0.25 * (sq - fHP[V_COWBELL]);
      const hp: f32 = sq - fHP[V_COWBELL];
      let s: f32 = hp * vAmp[V_COWBELL] * vVel[V_COWBELL] * (0.7 + toneN * 0.4);
      vAmp[V_COWBELL] *= cowA;
      vT[V_COWBELL] += dt;
      if (vAmp[V_COWBELL] < 0.0008) vActive[V_COWBELL] = 0;
      mix += s * 0.8;
    }

    // ---- master gain + soft saturation (bounded peak) ----
    let outS: f32 = mix * outGain;
    // gentle tanh-ish soft clip to keep peaks < 1.0
    outS = clampf(outS, -2.0, 2.0);
    outS = outS - (outS * outS * outS) * 0.16;
    outS = clampf(outS, -0.98, 0.98);

    outBuf[f] = outS;
    outBuf[MAX_FRAMES + f] = outS;
  }
}
