// =====================================================================
//  MAGNETIC ECHO — multi-head magnetic-drum echo
//  An original model of the vintage Italian magnetic-drum echo: a single
//  circulating loop (the rotating drum) is read by FOUR fixed playback
//  heads at 1/4, 2/4, 3/4 and 4/4 of the loop. A Head Mode (0..3) selects
//  which heads sound, giving distinct rhythmic multi-tap patterns. The
//  recirculating "Swell" feedback builds repeats; each pass is bandwidth-
//  limited (warm drum + record/playback head loss) and carries subtle
//  flutter from the drum's mechanical wobble. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay drum: a circular buffer per channel. ~1.2 s max loop at 48k headroom.
const DRUM_LEN: i32 = 96000; // per channel, ~2 s @ 48k — full drum circumference
const drum: StaticArray<f32> = new StaticArray<f32>(DRUM_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;

// per-channel filter / saturation state for the recirculating path
const lpState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // HF loss in loop
const hpState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC / rumble block
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP

// flutter LFOs (slow wow + faster flutter) — one shared phase, stereo offset
let wowPhase: f32 = 0.0;
let flutPhase: f32 = 0.0;

const P_TIME: i32 = 0;  // 0..1 -> loop length (drum speed)
const P_SWELL: i32 = 1; // 0..1 -> feedback amount
const P_HEADS: i32 = 2; // 0..3 step 1 -> head-combination mode
const P_TONE: i32 = 3;  // 0..1 -> post tone low-pass
const P_MIX: i32 = 4;   // 0..1 dry/wet

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// gentle tape/drum saturation, bounded to ±1
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -1.6, 1.6);
  return f32(c - 0.16666667 * c * c * c);
}

// read the drum at a fractional sample offset behind the write head (per channel)
@inline function readDrum(c: i32, delaySamples: f32): f32 {
  let rp: f32 = f32(writePos) - delaySamples;
  while (rp < 0.0) rp += f32(DRUM_LEN);
  while (rp >= f32(DRUM_LEN)) rp -= f32(DRUM_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= DRUM_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const base: i32 = c * DRUM_LEN;
  const a: f32 = drum[base + i0];
  const b: f32 = drum[base + i1];
  return f32(a + (b - a) * frac);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  wowPhase = 0.0;
  flutPhase = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lpState[c] = 0.0; hpState[c] = 0.0; toneState[c] = 0.0;
  }
  for (let i = 0; i < DRUM_LEN * MAX_CHANNELS; i++) drum[i] = 0.0;
  params[P_TIME] = 0.4;
  params[P_SWELL] = 0.45;
  params[P_HEADS] = 1.0;
  params[P_TONE] = 0.55;
  params[P_MIX] = 0.45;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const swell: f32 = clampf(params[P_SWELL], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // head mode 0..3 (selector). Each mode lights a different head combination.
  let mode: i32 = i32(params[P_HEADS] + 0.5);
  if (mode < 0) mode = 0; if (mode > 3) mode = 3;

  // base loop length (the longest head = full drum). 90 ms .. 750 ms.
  const baseDelay: f32 = (0.09 + timeN * 0.66) * sampleRate;

  // The four heads sit at 1/4, 2/4, 3/4, 4/4 of the loop. Gains per mode.
  // Mode 0: single head (head 4 only) — simple slap.
  // Mode 1: heads 2 + 4 — even eighths.
  // Mode 2: heads 1 + 3 + 4 — galloping triplet feel.
  // Mode 3: all four heads — dense swell.
  let g1: f32 = 0.0; let g2: f32 = 0.0; let g3: f32 = 0.0; let g4: f32 = 0.0;
  if (mode == 0) { g4 = 1.0; }
  else if (mode == 1) { g2 = 0.85; g4 = 1.0; }
  else if (mode == 2) { g1 = 0.7; g3 = 0.85; g4 = 1.0; }
  else { g1 = 0.7; g2 = 0.8; g3 = 0.9; g4 = 1.0; }

  const d1: f32 = baseDelay * 0.25;
  const d2: f32 = baseDelay * 0.50;
  const d3: f32 = baseDelay * 0.75;
  const d4: f32 = baseDelay;

  // feedback taken from the last head; bounded so the drum never runs away.
  const fb: f32 = swell * 0.92;

  // loop HF loss: warmer as repeats stack (fixed musical corner ~3.8 kHz)
  const loopHz: f32 = 3800.0;
  const cLoop: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * loopHz / sampleRate));
  // loop DC / rumble blocker corner ~45 Hz
  const cHp: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 45.0 / sampleRate));
  // post tone low-pass 700 .. 7500 Hz
  const toneHz: f32 = 700.0 + toneN * toneN * 6800.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate));

  // flutter: slow wow ~0.7 Hz + faster flutter ~6.3 Hz, depth in samples
  const wowInc: f32 = f32(0.7 / sampleRate);
  const flutInc: f32 = f32(6.3 / sampleRate);
  const flutDepth: f32 = 0.0016 * baseDelay; // proportional wobble

  for (let f = 0; f < n; f++) {
    // advance flutter phases once per frame (shared across channels)
    wowPhase += wowInc; if (wowPhase >= 1.0) wowPhase -= 1.0;
    flutPhase += flutInc; if (flutPhase >= 1.0) flutPhase -= 1.0;
    const wob: f32 = flutDepth * (Mathf.sin(wowPhase * 6.2831853) * 0.7
                                + Mathf.sin(flutPhase * 6.2831853) * 0.3);

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * DRUM_LEN;
      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // stereo flutter offset so the channels shimmer apart slightly
      const chOff: f32 = c == 0 ? wob : -wob;

      // read the four heads (longest carries the feedback)
      const h1: f32 = g1 != 0.0 ? readDrum(c, d1 + chOff) : 0.0;
      const h2: f32 = g2 != 0.0 ? readDrum(c, d2 + chOff) : 0.0;
      const h3: f32 = g3 != 0.0 ? readDrum(c, d3 + chOff) : 0.0;
      const h4: f32 = readDrum(c, d4 + chOff);

      const echoes: f32 = h1 * g1 + h2 * g2 + h3 * g3 + h4 * g4;

      // what we record onto the drum: input + recirculated last head,
      // through the warm loop band-limiting + saturation.
      let into: f32 = x + h4 * fb;

      // loop HF loss (one-pole LP toward lpState)
      let lp: f32 = lpState[c];
      lp = lp + cLoop * (into - lp);
      lpState[c] = lp;

      // rumble / DC blocker (subtract a slow LP)
      let hp: f32 = hpState[c];
      hp = hp + cHp * (lp - hp);
      hpState[c] = hp;
      let rec: f32 = lp - hp;

      rec = satf(rec);
      drum[base + writePos] = rec;

      // wet sum of selected heads, then post tone shaping
      let tn: f32 = toneState[c];
      tn = tn + cTone * (echoes - tn);
      toneState[c] = tn;

      const wet: f32 = tn;
      const y: f32 = x * (1.0 - mix) + wet * mix;
      outBuf[c * MAX_FRAMES + f] = clampf(y, -1.0, 1.0);
    }

    // advance the single shared write head AFTER both channels recorded
    writePos++;
    if (writePos >= DRUM_LEN) writePos = 0;
  }
}
