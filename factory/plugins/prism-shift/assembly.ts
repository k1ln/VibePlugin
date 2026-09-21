// =====================================================================
//  PRISM SHIFT — pitch-tracking granular harmonizer
//  Five granular pitch-shifting voices (Main + 4 harmony voices) read one
//  mono delay line through two crossfaded, sawtooth-swept taps (the classic
//  time-domain "granular" shifter). What makes it musical:
//   • a McLeod-style normalised-autocorrelation pitch detector (decimated to
//     ~12 kHz) tracks the played note (median-filtered, voiced-gated);
//   • DIATONIC mode harmonises in scale degrees (Key + 8 scales) so a 3rd is
//     major or minor as the scale demands; CHROMATIC mode is plain semitones;
//   • CORRECT pulls the tracked note (Main and diatonic voices) onto the scale;
//   • LOCK sizes the grain to an even multiple of the detected period so the
//     two overlapping taps add in phase (PSOLA-like coherence) — far less
//     warble than a fixed grain;
//   • per-voice Level / Interval / Fine / Pan / Delay, Glide (tuned portamento
//     between tracked notes), Humanize drift and a Feedback path for
//     cascading / shimmering stacks.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// mono delay line
const DL: i32 = 131072;
const DLM: i32 = 131071;
const dl: StaticArray<f32> = new StaticArray<f32>(DL);
let wpos: i32 = 0;

// pitch-detector state
const DECN: i32 = 1024;
const decBuf: StaticArray<f32> = new StaticArray<f32>(DECN);
const nsdf: StaticArray<f32> = new StaticArray<f32>(256);
let decPos: i32 = 0;
let decAcc: f32 = 0.0;
let decCnt: i32 = 0;
let decFactor: i32 = 4;
let hopCnt: i32 = 0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;
const hist: StaticArray<f32> = new StaticArray<f32>(3);
let histN: i32 = 0;
let noteM: f32 = 60.0;          // tracked MIDI note (float)
let havePitch: bool = false;
let voicedNow: bool = false;
let unvoicedHops: i32 = 0;
let periodFrames: f32 = 0.0;    // detected period in input frames
let lastPeriodUsed: f32 = 0.0;
let snapIdx: i32 = 35;

// voices: 0 = Main, 1..4 = harmony
const NV: i32 = 5;
const vPhase: StaticArray<f32> = new StaticArray<f32>(NV);
const vRatio: StaticArray<f32> = new StaticArray<f32>(NV);
const vTarget: StaticArray<f32> = new StaticArray<f32>(NV);
const vDrift: StaticArray<f32> = new StaticArray<f32>(NV);
const vDelSm: StaticArray<f32> = new StaticArray<f32>(NV);

// scale tables
const SCN: StaticArray<i32> = new StaticArray<i32>(8);
const SC: StaticArray<i32> = new StaticArray<i32>(64);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let rngState: u32 = 0x9e3779b9;
let gSm: f32 = 2048.0;          // smoothed grain length (frames)
let gTgtCached: f32 = 2048.0;
let fbState: f32 = 0.0;
let blkCnt: i32 = 0;
let sLevel: f32 = 0.9;

const P_MODE: i32 = 0;  const P_KEY: i32 = 1;   const P_SCALE: i32 = 2;  const P_CORRECT: i32 = 3;
const P_MAIN: i32 = 4;  const P_DRY: i32 = 5;   const P_SIZE: i32 = 6;   const P_GLIDE: i32 = 7;
const P_LOCK: i32 = 8;  const P_HUM: i32 = 9;   const P_FB: i32 = 10;    const P_TRACK: i32 = 11;
const P_LEVEL: i32 = 12;
const P_VOICE0: i32 = 13;    // 5 params per voice: level, interval, fine, pan, delay

function setSc(i: i32, n: i32, a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32): void {
  SCN[i] = n;
  SC[i * 8] = a; SC[i * 8 + 1] = b; SC[i * 8 + 2] = c; SC[i * 8 + 3] = d;
  SC[i * 8 + 4] = e; SC[i * 8 + 5] = f; SC[i * 8 + 6] = g; SC[i * 8 + 7] = 0;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DL; i++) dl[i] = 0.0;
  for (let i = 0; i < DECN; i++) decBuf[i] = 0.0;
  wpos = 0; decPos = 0; decAcc = 0.0; decCnt = 0; hopCnt = 0; dcX = 0.0; dcY = 0.0;
  decFactor = i32(Mathf.round(sampleRate / 12000.0)); if (decFactor < 1) decFactor = 1;
  hist[0] = 60.0; hist[1] = 60.0; hist[2] = 60.0; histN = 0;
  noteM = 60.0; havePitch = false; voicedNow = false; unvoicedHops = 99;
  periodFrames = 0.0; lastPeriodUsed = 0.0; snapIdx = 35;
  for (let v = 0; v < NV; v++) {
    vPhase[v] = f32(v) * 0.173; vRatio[v] = 1.0; vTarget[v] = 1.0; vDrift[v] = 0.0; vDelSm[v] = 0.0;
  }
  setSc(0, 7, 0, 2, 4, 5, 7, 9, 11);   // major
  setSc(1, 7, 0, 2, 3, 5, 7, 8, 10);   // natural minor
  setSc(2, 7, 0, 2, 3, 5, 7, 9, 10);   // dorian
  setSc(3, 7, 0, 2, 4, 5, 7, 9, 10);   // mixolydian
  setSc(4, 7, 0, 2, 4, 6, 7, 9, 11);   // lydian
  setSc(5, 7, 0, 1, 3, 5, 7, 8, 10);   // phrygian
  setSc(6, 7, 0, 2, 3, 5, 7, 8, 11);   // harmonic minor
  setSc(7, 5, 0, 3, 5, 7, 10, 0, 0);   // minor pentatonic
  rngState = 0x9e3779b9;
  gSm = 0.042 * sampleRate; gTgtCached = gSm; fbState = 0.0; blkCnt = 0; sLevel = 0.9;

  params[P_MODE] = 1.0; params[P_KEY] = 0.0; params[P_SCALE] = 0.0; params[P_CORRECT] = 0.0;
  params[P_MAIN] = 0.0; params[P_DRY] = 0.8; params[P_SIZE] = 0.5; params[P_GLIDE] = 0.15;
  params[P_LOCK] = 1.0; params[P_HUM] = 0.25; params[P_FB] = 0.0; params[P_TRACK] = 0.5;
  params[P_LEVEL] = 0.9;
  // voices: level, interval, fine, pan, delay
  const d: StaticArray<f32> = [
    0.70, 2.0, 0.0, -0.6, 0.05,
    0.60, 4.0, 0.0, 0.6, 0.10,
    0.40, -7.0, 0.0, -0.2, 0.0,
    0.00, 7.0, 0.0, 0.2, 0.0
  ];
  for (let i = 0; i < 20; i++) params[P_VOICE0 + i] = d[i];
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 33; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rndf(): f32 {
  let x: u32 = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return f32(x & 0x00ffffff) / f32(0x01000000);
}

@inline function readDL(pos: f32): f32 {
  const fl: f32 = Mathf.floor(pos);
  const fr: f32 = pos - fl;
  const i1: i32 = i32(fl);
  const y0: f32 = dl[(i1 - 1) & DLM]; const y1: f32 = dl[i1 & DLM];
  const y2: f32 = dl[(i1 + 1) & DLM]; const y3: f32 = dl[(i1 + 2) & DLM];
  const c1: f32 = 0.5 * (y2 - y0);
  const c2: f32 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3: f32 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * fr + c2) * fr + c1) * fr + y1;
}

// scale ladder: note for (possibly negative) degree index
function ladder(idx: i32, key: i32, sc: i32): f32 {
  const n: i32 = SCN[sc];
  let o: i32 = idx / n;
  let k: i32 = idx - o * n;
  if (k < 0) { k += n; o -= 1; }
  return f32(key + o * 12 + SC[sc * 8 + k]);
}
function nearestIdx(m: f32, key: i32, sc: i32): i32 {
  const n: i32 = SCN[sc];
  const o: i32 = i32(Mathf.floor((m - f32(key)) / 12.0));
  let best: i32 = o * n; let bd: f32 = 1000.0;
  for (let i = (o - 1) * n; i < (o + 2) * n; i++) {
    const d: f32 = Mathf.abs(ladder(i, key, sc) - m);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---- pitch detection (McLeod-style NSDF on a decimated window) --------
function analyse(sensitivity: f32): void {
  const W: i32 = 384;
  const decRate: f32 = sampleRate / f32(decFactor);
  let tauMin: i32 = i32(decRate / 1000.0); if (tauMin < 4) tauMin = 4;
  let tauMax: i32 = i32(decRate / 65.0); if (tauMax > 200) tauMax = 200;
  const newest: i32 = decPos - 1;
  // energy gate
  let e: f32 = 0.0;
  for (let i = 0; i < W; i++) { const x: f32 = decBuf[(newest - i) & (DECN - 1)]; e += x * x; }
  if (e / f32(W) < 0.000004) { unvoicedHops += 1; if (unvoicedHops > 6) voicedNow = false; return; }
  let maxV: f32 = -1.0;
  for (let tau = tauMin - 1; tau <= tauMax + 1; tau++) {
    let acf: f32 = 0.0; let m: f32 = 0.0;
    for (let i = 0; i < W; i++) {
      const a: f32 = decBuf[(newest - i) & (DECN - 1)];
      const b: f32 = decBuf[(newest - i - tau) & (DECN - 1)];
      acf += a * b; m += a * a + b * b;
    }
    const v: f32 = m > 0.0 ? 2.0 * acf / m : 0.0;
    nsdf[tau] = v;
    if (tau >= tauMin && tau <= tauMax && v > maxV) maxV = v;
  }
  // first prominent local maximum after the first positive-going zero crossing
  const thr: f32 = 0.95 - sensitivity * 0.35;
  let pick: i32 = -1;
  let seenNeg: bool = false;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (nsdf[tau] < 0.0) seenNeg = true;
    if (!seenNeg && tau > tauMin + 2) { /* still on the zero-lag lobe */ }
    if (seenNeg && nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && nsdf[tau] >= 0.9 * maxV) { pick = tau; break; }
  }
  if (pick < 0 || nsdf[pick] < thr) { unvoicedHops += 1; if (unvoicedHops > 6) voicedNow = false; return; }
  const a: f32 = nsdf[pick - 1]; const b: f32 = nsdf[pick]; const c: f32 = nsdf[pick + 1];
  const den: f32 = a - 2.0 * b + c;
  let tauF: f32 = f32(pick);
  if (den < -1e-6) tauF += 0.5 * (a - c) / den;
  const f0: f32 = decRate / tauF;
  const midi: f32 = 69.0 + 12.0 * f32(Mathf.log(f0 / 440.0) / 0.6931472);
  if (midi < 28.0 || midi > 100.0) { unvoicedHops += 1; if (unvoicedHops > 6) voicedNow = false; return; }
  unvoicedHops = 0; voicedNow = true; havePitch = true;
  // median-of-3 to reject octave blips
  hist[2] = hist[1]; hist[1] = hist[0]; hist[0] = midi;
  if (histN < 3) { histN += 1; noteM = midi; }
  else {
    const h0: f32 = hist[0]; const h1: f32 = hist[1]; const h2: f32 = hist[2];
    noteM = Mathf.max(Mathf.min(h0, h1), Mathf.min(Mathf.max(h0, h1), h2));
  }
  periodFrames = tauF * f32(decFactor);
}

function computeTargets(): void {
  const mode: i32 = params[P_MODE] >= 0.5 ? 1 : 0;
  const key: i32 = i32(clampf(params[P_KEY], 0.0, 11.0) + 0.5);
  const sc: i32 = i32(clampf(params[P_SCALE], 0.0, 7.0) + 0.5);
  const corr: f32 = clampf(params[P_CORRECT], 0.0, 1.0);
  const hum: f32 = clampf(params[P_HUM], 0.0, 1.0);
  // snap tracked note onto the scale, with hysteresis
  const ni: i32 = nearestIdx(noteM, key, sc);
  if (ni != snapIdx) {
    const dn: f32 = Mathf.abs(ladder(ni, key, sc) - noteM);
    const dc: f32 = Mathf.abs(ladder(snapIdx, key, sc) - noteM);
    if (dn < dc - 0.15) snapIdx = ni;
  }
  const snapNote: f32 = ladder(snapIdx, key, sc);
  for (let v = 0; v < NV; v++) {
    let semis: f32 = 0.0;
    if (v == 0) {
      semis = havePitch ? corr * (snapNote - noteM) : 0.0;
    } else {
      const b: i32 = P_VOICE0 + (v - 1) * 5;
      const iv: i32 = i32(Mathf.round(clampf(params[b + 1], -12.0, 12.0)));
      const fine: f32 = clampf(params[b + 2], -50.0, 50.0) * 0.01;
      if (mode == 1) {
        const tgt: f32 = ladder(snapIdx + iv, key, sc);
        semis = tgt - corr * noteM - (1.0 - corr) * snapNote + fine;
      } else {
        semis = f32(iv) + fine;
      }
    }
    // humanize: slow drift up to ~±18 cents
    vDrift[v] = vDrift[v] * 0.9995 + (rndf() * 2.0 - 1.0) * 0.0009;
    semis += vDrift[v] * hum * 3.0;
    vTarget[v] = f32(Mathf.exp(semis * 0.05776226504666));
  }
}

export function process(n: i32): void {
  const sizeMs: f32 = 15.0 * f32(Mathf.pow(8.0, clampf(params[P_SIZE], 0.0, 1.0)));
  const glideP: f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const glideMs: f32 = glideP * glideP * 500.0;
  const ga: f32 = glideMs < 1.0 ? 1.0 : 1.0 - f32(Mathf.exp(-1.0 / (0.001 * glideMs * sampleRate)));
  const lock: bool = params[P_LOCK] >= 0.5;
  const fb: f32 = clampf(params[P_FB], 0.0, 1.0) * 0.8;
  const sens: f32 = clampf(params[P_TRACK], 0.0, 1.0);
  const dryG: f32 = clampf(params[P_DRY], 0.0, 1.5);
  const mainG: f32 = clampf(params[P_MAIN], 0.0, 1.5);
  const levelT: f32 = clampf(params[P_LEVEL], 0.0, 1.5);

  // per-block voice gains / pans / base delays
  let lvl0: f32 = mainG;
  let lvl1: f32 = clampf(params[P_VOICE0 + 0], 0.0, 1.0);
  let lvl2: f32 = clampf(params[P_VOICE0 + 5], 0.0, 1.0);
  let lvl3: f32 = clampf(params[P_VOICE0 + 10], 0.0, 1.0);
  let lvl4: f32 = clampf(params[P_VOICE0 + 15], 0.0, 1.0);

  const gWant: f32 = sizeMs * 0.001 * sampleRate;
  const gSlew: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.25 * sampleRate)));

  for (let f = 0; f < n; f++) {
    const inL: f32 = inBuf[f];
    const inR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : inL;
    const mono: f32 = 0.5 * (inL + inR);
    sLevel += (levelT - sLevel) * 0.002;

    // ---- delay-line write (with harmonic feedback) ----
    dl[wpos] = mono + fbState * fb;

    // ---- pitch detector feed ----
    dcY = mono - dcX + 0.995 * dcY; dcX = mono;
    decAcc += dcY; decCnt += 1;
    if (decCnt >= decFactor) {
      decBuf[decPos & (DECN - 1)] = decAcc / f32(decFactor);
      decPos += 1; decAcc = 0.0; decCnt = 0;
      hopCnt += 1;
      if (hopCnt >= 64) { hopCnt = 0; analyse(sens); }
    }

    // ---- refresh targets every 64 frames ----
    if ((blkCnt & 63) == 0) {
      computeTargets();
      // grain length: even multiple of the detected period when locked
      let gt: f32 = gWant;
      if (lock && voicedNow && periodFrames > 8.0) {
        if (lastPeriodUsed <= 0.0 || Mathf.abs(periodFrames - lastPeriodUsed) > 0.06 * lastPeriodUsed) lastPeriodUsed = periodFrames;
        let k: f32 = Mathf.round(gWant / (2.0 * lastPeriodUsed)); if (k < 1.0) k = 1.0;
        gt = 2.0 * k * lastPeriodUsed;
        if (gt > 0.22 * sampleRate) gt = gt * 0.5;
      }
      gTgtCached = gt;
    }
    blkCnt += 1;
    gSm += (gTgtCached - gSm) * gSlew;

    // ---- voices ----
    let outL: f32 = inL * dryG;
    let outR: f32 = inR * dryG;
    let sumMono: f32 = 0.0;
    for (let v = 0; v < NV; v++) {
      let lv: f32;
      let pan: f32 = 0.0; let dms: f32 = 0.0;
      if (v == 0) lv = lvl0;
      else {
        const b: i32 = P_VOICE0 + (v - 1) * 5;
        lv = v == 1 ? lvl1 : (v == 2 ? lvl2 : (v == 3 ? lvl3 : lvl4));
        pan = clampf(params[b + 3], -1.0, 1.0);
        dms = clampf(params[b + 4], 0.0, 1.0) * 300.0;
      }
      if (lv < 0.001) continue;
      vRatio[v] += (vTarget[v] - vRatio[v]) * ga;
      const r: f32 = vRatio[v];
      let ph: f32 = vPhase[v] + (1.0 - r) / gSm;
      ph -= Mathf.floor(ph);
      vPhase[v] = ph;
      vDelSm[v] += (dms * 0.001 * sampleRate - vDelSm[v]) * 0.0005;
      const base: f32 = vDelSm[v] + 2.0;
      const d1: f32 = ph * gSm + base;
      let ph2: f32 = ph + 0.5; if (ph2 >= 1.0) ph2 -= 1.0;
      const d2: f32 = ph2 * gSm + base;
      const c: f32 = f32(Mathf.cos(6.2831853 * ph));
      const w1: f32 = 0.5 - 0.5 * c;
      const w2: f32 = 0.5 + 0.5 * c;
      const s: f32 = (readDL(f32(wpos) - d1) * w1 + readDL(f32(wpos) - d2) * w2) * lv;
      const ang: f32 = (pan * 0.5 + 0.5) * 1.5707963;
      outL += s * f32(Mathf.cos(ang)) * 1.414;
      outR += s * f32(Mathf.sin(ang)) * 1.414;
      sumMono += s;
    }
    fbState = f32(Mathf.tanh(sumMono));
    wpos = (wpos + 1) & DLM;
    outBuf[f] = f32(Mathf.tanh(outL * sLevel));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(outR * sLevel));
  }
}
