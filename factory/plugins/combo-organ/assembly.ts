// =====================================================================
//  COMBO ORGAN — a 1960s transistor "divide-down" combo organ instrument.
//  Each key fires a band-limited pulse oscillator whose octave taps are
//  read off at three footages (16', 8', 4') plus a thin reedy upper-octave
//  buzz, exactly like a divide-down organ where one master tone is divided
//  into octaves and re-summed through bright drawbar/rocker tabs. A fast
//  attack/release gate (no slow envelope — organs key instantly), a global
//  scanner-style vibrato, and a one-pole tone tilt finish the voice.
//  Polyphonic: voices are allocated per noteId so chords ring. The host
//  passes frequency in Hz. Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 12;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;   // DC blocker

// ---- parameter indices (must match spec.json) ----------------------
const P_BASS:    i32 = 0;  // 0..1  16' flute tab level
const P_MID:     i32 = 1;  // 0..1  8'  flute tab level
const P_BRIGHT:  i32 = 2;  // 0..1  4' + reed bright tab level
const P_VIBDEPTH:i32 = 3;  // 0..1  vibrato depth
const P_VIBRATE: i32 = 4;  // 0..1  vibrato rate
const P_TONE:    i32 = 5;  // 0..1  tone tilt (dark..bright)
const P_LEVEL:   i32 = 6;  // 0..1  output level

// ---- per-voice state (StaticArrays at module scope, no alloc) ------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // oldest-voice steal

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // fast gate env 0..1

// four octave-tap phases per voice (16', 8', 4', 2' reed)
const vP16: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vP8:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vP4:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vP2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// global vibrato scanner phase + tone-filter state (one per channel-free, mono sum)
let vibPhase: f32 = 0.0;
let toneState: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  dcX = 0.0; dcY = 0.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vEnv[v] = 0.0;
    vP16[v] = 0.0; vP8[v] = 0.0; vP4[v] = 0.0; vP2[v] = 0.0;
  }
  ageCounter = 0;
  vibPhase = 0.0;
  toneState = 0.0;
  params[P_BASS]     = 0.7;
  params[P_MID]      = 0.85;
  params[P_BRIGHT]   = 0.6;
  params[P_VIBDEPTH] = 0.35;
  params[P_VIBRATE]  = 0.45;
  params[P_TONE]     = 0.6;
  params[P_LEVEL]    = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// polyBLEP correction removes the worst aliasing on the pulse edges
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

// band-limited pulse of given duty cycle from the running phase
@inline function blPulse(p: f32, inc: f32, pw: f32): f32 {
  let sq: f32 = p < pw ? 1.0 : -1.0;
  sq += polyBlep(p, inc);
  let p2: f32 = p + (1.0 - pw);
  if (p2 >= 1.0) p2 -= 1.0;
  sq -= polyBlep(p2, inc);
  return sq;
}

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
  // fresh phases, slightly offset so taps don't all phase-lock
  vP16[slot] = 0.0; vP8[slot] = 0.12; vP4[slot] = 0.27; vP2[slot] = 0.41;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const bass:   f32 = clampf(params[P_BASS],   0.0, 1.0);
  const mid:    f32 = clampf(params[P_MID],    0.0, 1.0);
  const bright: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const vibD:   f32 = clampf(params[P_VIBDEPTH],0.0, 1.0);
  const vibR:   f32 = clampf(params[P_VIBRATE], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE],   0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // footage tab gains (the reed tab adds the buzzy 4'+2' upper octaves)
  const g16: f32 = bass;
  const g8:  f32 = mid;
  const g4:  f32 = bright;            // 4' bright flute
  const g2:  f32 = bright * 0.7;      // 2' reedy buzz, rides the bright tab

  // vibrato: scanner 4.5 .. 7.5 Hz, depth up to ~+/-1.2% pitch
  const vibHz:   f32 = 4.5 + vibR * 3.0;
  const vibInc:  f32 = vibHz / sr;
  const vibAmt:  f32 = vibD * 0.012;

  // tone tilt: one-pole low-pass, 900 Hz (dark) .. 11 kHz (bright)
  const toneHz:  f32 = 900.0 + toneN * toneN * 10100.0;
  let toneG: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * toneHz / sr));
  if (toneG > 0.99) toneG = 0.99;
  // mix a little of the un-filtered signal back so very dark still has presence
  const toneMix: f32 = 0.18 + 0.82 * toneN;

  // fast organ gate: ~4 ms attack, ~12 ms release (instant, keyed)
  const atkRate: f32 = 1.0 / (0.004 * sr);
  const relRate: f32 = 1.0 / (0.012 * sr);

  // sum-of-tabs normaliser so a full chord stays bounded
  const tabSum: f32 = g16 + g8 + g4 + g2;
  let tabNorm: f32 = 1.0 / (1.0 + tabSum);    // soft headroom per voice
  const voiceScale: f32 = 0.42 * tabNorm;

  let ts: f32 = toneState;
  let vph: f32 = vibPhase;

  for (let f = 0; f < n; f++) {
    // advance global vibrato scanner
    vph += vibInc; if (vph >= 1.0) vph -= 1.0;
    const vib: f32 = 1.0 + vibAmt * f32(Mathf.sin(TWO_PI * vph));

    let mixv: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- fast keyed gate (no slow ADSR; organs speak instantly) ----
      let env: f32 = vEnv[v];
      if (vGate[v] == 1) {
        env += atkRate;
        if (env > 1.0) env = 1.0;
      } else {
        env -= relRate;
        if (env <= 0.0) {
          env = 0.0;
          vActive[v] = 0; vNote[v] = -1; vEnv[v] = 0.0;
          continue;
        }
      }
      vEnv[v] = env;

      // ---- divide-down octave taps (one master pitch, octave divisions)
      // 8' is the played pitch; 16' is an octave down, 4' / 2' octaves up.
      const f8:  f32 = vFreq[v] * vib;
      const inc8:  f32 = f8 / sr;
      const inc16: f32 = inc8 * 0.5;
      const inc4:  f32 = inc8 * 2.0;
      const inc2:  f32 = inc8 * 4.0;

      let p16: f32 = vP16[v]; p16 += inc16; if (p16 >= 1.0) p16 -= 1.0; vP16[v] = p16;
      let p8:  f32 = vP8[v];  p8  += inc8;  if (p8  >= 1.0) p8  -= 1.0; vP8[v]  = p8;
      let p4:  f32 = vP4[v];  p4  += inc4;  if (p4  >= 1.0) p4  -= 1.0; vP4[v]  = p4;
      let p2:  f32 = vP2[v];  p2  += inc2;  if (p2  >= 1.0) p2  -= 1.0; vP2[v]  = p2;

      // bright thin combo tone: narrow-ish pulses (flutey lower, reedy upper)
      const t16: f32 = blPulse(p16, inc16, 0.5);   // hollow 16'
      const t8:  f32 = blPulse(p8,  inc8,  0.42);  // 8' body
      const t4:  f32 = blPulse(p4,  inc4,  0.30);  // 4' bright, thinner pulse
      const t2:  f32 = blPulse(p2,  inc2,  0.22);  // 2' reedy buzz

      const voice: f32 = (t16 * g16 + t8 * g8 + t4 * g4 + t2 * g2)
                         * env * vVel[v];
      mixv += voice;
    }

    // ---- global tone tilt + level -----------------------------------
    let scaled: f32 = mixv * voiceScale;
    ts += toneG * (scaled - ts);
    let toned: f32 = ts * toneMix + scaled * (1.0 - toneMix);

    // gentle soft clip for transistor-organ glue, keeps peak < 1
    toned = f32(Mathf.tanh(toned * 1.15));
    let outv: f32 = toned * level;
    const dcO: f32 = outv - dcX + 0.9985 * dcY; dcX = outv; dcY = dcO; outv = dcO;

    outBuf[f] = outv;
    outBuf[MAX_FRAMES + f] = outv;
  }

  toneState = ts;
  vibPhase = vph;
}
