// =====================================================================
//  CLAV — a polyphonic plucked-string funk-clav instrument.
//  Models the percussive, springy pluck of a tine-and-string electro-
//  mechanical clavier. Each of 8 voices is an independent Karplus-Strong
//  string: a short noise/impulse excitation burst is injected into a
//  tuned delay line whose feedback loop carries a damping low-pass, so
//  the string rings then decays. A one-pole "Brightness" tilt and a
//  comb-style "Pickup" tap colour the tone like the magnetic pickup of
//  the real instrument. A fast percussive amp envelope gives the snap.
//  Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

// delay-line capacity per voice: enough for the lowest expected note.
// 48000 / ~27.5 Hz (A0) ≈ 1746; round up generously.
const DLINE: i32 = 2048;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_ATTACK: i32 = 0;  // 0..1 -> pluck excitation length / softness
const P_DECAY:  i32 = 1;  // 0..1 -> string ring time (loop damping)
const P_BRIGHT: i32 = 2;  // 0..1 -> excitation/tone brightness tilt
const P_PICKUP: i32 = 3;  // 0..1 -> pickup comb tap position (tone)
const P_DAMP:   i32 = 4;  // 0..1 -> loop low-pass damping (string dullness)
const P_LEVEL:  i32 = 5;  // 0..1 -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// Karplus-Strong delay line per voice (flattened: voice v -> base v*DLINE)
const dl:      StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * DLINE);
const vWrite:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // write head
const vDelay:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // fractional loop length

const vLoopLp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // loop damping one-pole state
const vPickLp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pickup tilt state

// excitation burst: remaining samples + per-voice noise rng
const vBurst:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vRng:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// fast percussive amp envelope (attack ramp then exp release while ringing)
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 hold/decay 3 release

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vWrite[v] = 0; vDelay[v] = 100.0;
    vLoopLp[v] = 0.0; vPickLp[v] = 0.0;
    vBurst[v] = 0; vRng[v] = 0x1234 + v * 7919;
    vEnv[v] = 0.0; vStage[v] = 0;
    const base: i32 = v * DLINE;
    for (let i = 0; i < DLINE; i++) dl[base + i] = 0.0;
  }
  ageCounter = 0;
  params[P_ATTACK] = 0.15;
  params[P_DECAY]  = 0.55;
  params[P_BRIGHT] = 0.65;
  params[P_PICKUP] = 0.45;
  params[P_DAMP]   = 0.30;
  params[P_LEVEL]  = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// per-voice xorshift noise in [-1, 1]
@inline function vnoise(v: i32): f32 {
  let s: i32 = vRng[v];
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  vRng[v] = s;
  return f32(s) * f32(4.6566128e-10); // /2^31
}

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, vel: f32): void {
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

  const freq: f32 = f > 20.0 ? f : 20.0;
  // loop length in samples = period; clamp into the delay line
  let d: f32 = sampleRate / freq;
  if (d < 2.0) d = 2.0;
  if (d > f32(DLINE - 2)) d = f32(DLINE - 2);

  vNote[slot]   = id;
  vFreq[slot]   = freq;
  vVel[slot]    = clampf(vel, 0.0, 1.0);
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vDelay[slot]  = d;
  vWrite[slot]  = 0;
  vLoopLp[slot] = 0.0;
  vPickLp[slot] = 0.0;
  vEnv[slot]    = 0.0;
  vStage[slot]  = 1; // attack
  vAge[slot]    = ageCounter++;

  // clear this voice's delay line so a stolen voice doesn't carry old ring
  const base: i32 = slot * DLINE;
  for (let i = 0; i < DLINE; i++) dl[base + i] = 0.0;

  // excitation burst length proportional to a fraction of the period:
  // a short burst => sharp pluck; controlled by Attack (longer = softer).
  const atkN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  let burst: i32 = i32(d * (0.12 + atkN * 0.55));
  if (burst < 2) burst = 2;
  if (burst > DLINE - 1) burst = DLINE - 1;
  vBurst[slot] = burst;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3; // release -> mute the loop faster (key lift damps the string)
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const decayN:  f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const brightN: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const pickupN: f32 = clampf(params[P_PICKUP], 0.0, 1.0);
  const dampN:   f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 0.9;

  // Loop feedback gain: higher Decay -> longer ring (closer to 1.0).
  // Keep strictly < 1 for stability.
  const fb: f32 = 0.95 + decayN * 0.048; // 0.95 .. 0.998

  // Loop damping low-pass coefficient: more Damp -> duller, faster HF loss.
  // coef is the one-pole smoothing amount (0..1); lower = more damping.
  const loopLpCoef: f32 = 1.0 - (0.05 + dampN * 0.55); // 0.95 .. 0.40

  // Brightness tilt on excitation + pickup: a one-pole high-shelf-ish blend.
  // higher Bright -> more high content passed through.
  const brightCoef: f32 = 0.15 + brightN * 0.80; // 0.15 .. 0.95

  // attack ramp rate (samples): short, percussive
  const atkN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const atkRate: f32 = 1.0 / (f32(sr) * (0.0008 + atkN * 0.012)); // ~0.8..13 ms
  // natural release while key held: string keeps ringing (slow); after key-off, faster
  const relRate: f32 = 1.0 / (f32(sr) * 0.06); // ~60 ms key-off mute

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      const base: i32 = v * DLINE;
      const d: f32 = vDelay[v];

      // ---- read from the delay line (fractional, linear interp) -----
      // read position = write head - delay (one loop behind)
      let rp: f32 = f32(vWrite[v]) - d;
      while (rp < 0.0) rp += f32(DLINE);
      const ri: i32 = i32(rp);
      let ri1: i32 = ri + 1; if (ri1 >= DLINE) ri1 -= DLINE;
      const frac: f32 = rp - f32(ri);
      const a: f32 = dl[base + ri];
      const b: f32 = dl[base + ri1];
      let delayed: f32 = a + (b - a) * frac;

      // ---- loop damping low-pass (string HF loss) -------------------
      let lp: f32 = vLoopLp[v];
      lp = lp + loopLpCoef * (delayed - lp);
      vLoopLp[v] = lp;

      // ---- excitation: inject a brightness-shaped noise burst -------
      let exc: f32 = 0.0;
      if (vBurst[v] > 0) {
        // noise burst, tilted by brightness (mix of raw + smoothed noise)
        const raw: f32 = vnoise(v);
        // a touch of pluck "pick" shape: scale burst by velocity
        exc = raw * vVel[v];
        vBurst[v] -= 1;
      }

      // new sample fed into the line: damped feedback + excitation,
      // brightness controls how much HF survives in the feedback path.
      // blend the damped (lp) with the full-band delayed signal by brightCoef
      let fbSig: f32 = lp + (delayed - lp) * brightCoef;
      let newSamp: f32 = exc + fbSig * fb;

      // safety clamp inside the loop to stay bounded
      if (newSamp > 1.5) newSamp = 1.5;
      if (newSamp < -1.5) newSamp = -1.5;

      dl[base + vWrite[v]] = newSamp;

      // advance write head
      let w: i32 = vWrite[v] + 1; if (w >= DLINE) w -= DLINE;
      vWrite[v] = w;

      // ---- pickup comb: tap the line a fraction of a period back ----
      // pickup position 0..1 maps to a tap 0.06..0.5 of the period earlier;
      // (delayed - tap) emulates the magnetic pickup's comb-filter colour.
      const tapDist: f32 = d * (0.06 + pickupN * 0.44);
      let tp: f32 = f32(w) - 1.0 - tapDist; // relative to most-recent sample
      while (tp < 0.0) tp += f32(DLINE);
      const ti: i32 = i32(tp);
      let ti1: i32 = ti + 1; if (ti1 >= DLINE) ti1 -= DLINE;
      const tfrac: f32 = tp - f32(ti);
      const ta: f32 = dl[base + ti];
      const tb: f32 = dl[base + ti1];
      const tap: f32 = ta + (tb - ta) * tfrac;

      // combed output (pickup): difference gives the hollow clav tone
      let sig: f32 = delayed - tap * 0.6;

      // pickup tone tilt one-pole (slightly removes harshness, adds body)
      let pk: f32 = vPickLp[v];
      pk = pk + (0.35 + pickupN * 0.5) * (sig - pk);
      vPickLp[v] = pk;
      sig = pk;

      // ---- percussive amp envelope ----------------------------------
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {
        // held: envelope stays open; the string's own loop damping
        // provides the natural decay, so keep env at 1.
        env = 1.0;
      } else if (stg == 3) {
        // key released: quickly fade the voice out
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      let voice: f32 = sig * env;
      outL += voice;

      // ---- voice-finished detection ---------------------------------
      // when the string has rung down to silence (loop tiny) or released,
      // free the voice so it can be reused.
      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }
      // auto-cull a near-silent sustained voice (string fully damped)
      if (stg == 2 && vGate[v] == 0) {
        // (shouldn't happen: gate clears -> stage 3) — defensive no-op
      }
    }

    // ---- sum + gentle soft saturate -------------------------------
    let mix: f32 = outL * level;
    mix = f32(Mathf.tanh(mix * 1.1));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
