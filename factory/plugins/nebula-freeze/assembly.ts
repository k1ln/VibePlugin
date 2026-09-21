// =====================================================================
//  NEBULA FREEZE — live granular texture processor with freeze
//  Input is written into a stereo ring buffer (up to ~8 s @48k). A pool of
//  64 grains reads it back through a morphable window (percussive → Hann →
//  plateau), each grain with its own start position (Position + Spray),
//  pitch (Pitch + Jitter, optionally snapped to a scale), direction
//  (Reverse) and pan (Spread). Spawn timing runs from metronomic to Poisson
//  (Chaos). FREEZE stops the write head so the buffer becomes an instrument.
//  Wet path: tilt Tone → Degrade (rate+bit reduction) → Freeverb-style
//  diffuse tail. Feedback re-injects the grain cloud into the buffer.
//  Grains use 4-point Hermite interpolation; each tracks its own delay
//  trajectory so live-write-head / frozen-head crossings never click.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const RING: i32 = 393216;                      // frames per channel (8.19 s @48k)
const ring: StaticArray<f32> = new StaticArray<f32>(RING * MAX_CHANNELS);
let writePos: i32 = 0;

const MAX_GRAINS: i32 = 64;
const gActive: StaticArray<i32> = new StaticArray<i32>(MAX_GRAINS);
const gDel:    StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // delay behind write head (frames)
const gDD:     StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // delay change per frame
const gPhase:  StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS);
const gInc:    StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS);
const gFa:     StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // attack fraction
const gFr:     StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS); // release fraction
const gPanL:   StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS);
const gPanR:   StaticArray<f32> = new StaticArray<f32>(MAX_GRAINS);

// scale masks (semitone sets inside an octave) for pitch quantise
const SCALE_N: StaticArray<i32> = new StaticArray<i32>(6);
const SCALE: StaticArray<i32> = new StaticArray<i32>(6 * 8);

// Freeverb (8 combs + 4 allpass per channel)
const NCOMB: i32 = 8;
const NAP: i32 = 4;
const COMB_LEN: StaticArray<i32> = new StaticArray<i32>(NCOMB * 2);
const AP_LEN: StaticArray<i32> = new StaticArray<i32>(NAP * 2);
const COMB_CAP: i32 = 4096;
const combBuf: StaticArray<f32> = new StaticArray<f32>(NCOMB * 2 * COMB_CAP);
const combPos: StaticArray<i32> = new StaticArray<i32>(NCOMB * 2);
const combLP: StaticArray<f32> = new StaticArray<f32>(NCOMB * 2);
const AP_CAP: i32 = 1400;
const apBuf: StaticArray<f32> = new StaticArray<f32>(NAP * 2 * AP_CAP);
const apPos: StaticArray<i32> = new StaticArray<i32>(NAP * 2);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let spawnCount: f32 = 0.0;
let rngState: u32 = 0x2545f491;
let tLpL: f32 = 0.0; let tLpR: f32 = 0.0;
let tHpL: f32 = 0.0; let tHpR: f32 = 0.0;
let fbHpL: f32 = 0.0; let fbHpR: f32 = 0.0;
let fbLpL: f32 = 0.0; let fbLpR: f32 = 0.0;
let holdL: f32 = 0.0; let holdR: f32 = 0.0; let holdCnt: f32 = 0.0;
let sFreeze: f32 = 0.0;
let sMix: f32 = 0.5;

const P_POS: i32 = 0;      const P_SIZE: i32 = 1;    const P_PITCH: i32 = 2;
const P_DENS: i32 = 3;     const P_TEX: i32 = 4;     const P_SPRAY: i32 = 5;
const P_JIT: i32 = 6;      const P_REV: i32 = 7;     const P_SPREAD: i32 = 8;
const P_CHAOS: i32 = 9;    const P_FREEZE: i32 = 10; const P_WINDOW: i32 = 11;
const P_QUANT: i32 = 12;   const P_FB: i32 = 13;     const P_TONE: i32 = 14;
const P_DEGRADE: i32 = 15; const P_VERB: i32 = 16;   const P_DECAY: i32 = 17;
const P_MIX: i32 = 18;     const P_LEVEL: i32 = 19;

function setScale(i: i32, n: i32, a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32): void {
  SCALE_N[i] = n;
  SCALE[i * 8 + 0] = a; SCALE[i * 8 + 1] = b; SCALE[i * 8 + 2] = c; SCALE[i * 8 + 3] = d;
  SCALE[i * 8 + 4] = e; SCALE[i * 8 + 5] = f; SCALE[i * 8 + 6] = g;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0; spawnCount = 0.0; rngState = 0x2545f491;
  for (let i = 0; i < MAX_GRAINS; i++) {
    gActive[i] = 0; gDel[i] = 0.0; gDD[i] = 0.0; gPhase[i] = 0.0; gInc[i] = 0.0;
    gFa[i] = 0.5; gFr[i] = 0.5; gPanL[i] = 0.7071; gPanR[i] = 0.7071;
  }
  for (let i = 0; i < RING * MAX_CHANNELS; i++) ring[i] = 0.0;
  setScale(0, 0, 0, 0, 0, 0, 0, 0, 0);            // off
  setScale(1, 1, 0, 0, 0, 0, 0, 0, 0);            // octaves
  setScale(2, 2, 0, 7, 0, 0, 0, 0, 0);            // root + fifth
  setScale(3, 5, 0, 3, 5, 7, 10, 0, 0);           // minor pentatonic
  setScale(4, 7, 0, 2, 4, 5, 7, 9, 11);           // major
  setScale(5, 6, 0, 2, 4, 6, 8, 10, 0);           // whole tone
  const sc: f32 = sampleRate / 44100.0;
  const cl: StaticArray<i32> = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  for (let i = 0; i < NCOMB; i++) {
    let a: i32 = i32(f32(cl[i]) * sc); if (a > COMB_CAP - 64) a = COMB_CAP - 64;
    let b: i32 = i32(f32(cl[i] + 23) * sc); if (b > COMB_CAP - 64) b = COMB_CAP - 64;
    COMB_LEN[i] = a; COMB_LEN[NCOMB + i] = b;
    combPos[i] = 0; combPos[NCOMB + i] = 0; combLP[i] = 0.0; combLP[NCOMB + i] = 0.0;
  }
  const al: StaticArray<i32> = [556, 441, 341, 225];
  for (let i = 0; i < NAP; i++) {
    let a: i32 = i32(f32(al[i]) * sc); if (a > AP_CAP - 8) a = AP_CAP - 8;
    let b: i32 = i32(f32(al[i] + 23) * sc); if (b > AP_CAP - 8) b = AP_CAP - 8;
    AP_LEN[i] = a; AP_LEN[NAP + i] = b; apPos[i] = 0; apPos[NAP + i] = 0;
  }
  for (let i = 0; i < NCOMB * 2 * COMB_CAP; i++) combBuf[i] = 0.0;
  for (let i = 0; i < NAP * 2 * AP_CAP; i++) apBuf[i] = 0.0;
  tLpL = 0.0; tLpR = 0.0; tHpL = 0.0; tHpR = 0.0;
  fbHpL = 0.0; fbHpR = 0.0; fbLpL = 0.0; fbLpR = 0.0;
  holdL = 0.0; holdR = 0.0; holdCnt = 0.0; sFreeze = 0.0; sMix = 0.5;
  params[P_POS] = 0.3;    params[P_SIZE] = 0.5;   params[P_PITCH] = 0.0;
  params[P_DENS] = 0.55;  params[P_TEX] = 0.5;    params[P_SPRAY] = 0.35;
  params[P_JIT] = 0.0;    params[P_REV] = 0.2;    params[P_SPREAD] = 0.7;
  params[P_CHAOS] = 0.6;  params[P_FREEZE] = 0.0; params[P_WINDOW] = 0.55;
  params[P_QUANT] = 0.0;  params[P_FB] = 0.25;    params[P_TONE] = 0.0;
  params[P_DEGRADE] = 0.0; params[P_VERB] = 0.3;  params[P_DECAY] = 0.6;
  params[P_MIX] = 0.6;    params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 20; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function rndf(): f32 {
  let x: u32 = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return f32(x & 0x00ffffff) / f32(0x01000000);
}

// 4-point Hermite read of ring channel c at fractional frame position
@inline function readRing(c: i32, pos: f32): f32 {
  let p: f32 = pos;
  const rf: f32 = f32(RING);
  if (p < 0.0) p += rf * f32(i32(-p / rf) + 1);
  if (p >= rf) p -= rf * f32(i32(p / rf));
  const i1: i32 = i32(p);
  const fr: f32 = p - f32(i1);
  let i0: i32 = i1 - 1; if (i0 < 0) i0 += RING;
  let i2: i32 = i1 + 1; if (i2 >= RING) i2 -= RING;
  let i3: i32 = i1 + 2; if (i3 >= RING) i3 -= RING;
  const b: i32 = c * RING;
  const y0: f32 = ring[b + i0]; const y1: f32 = ring[b + i1];
  const y2: f32 = ring[b + i2]; const y3: f32 = ring[b + i3];
  const c0: f32 = y1;
  const c1: f32 = 0.5 * (y2 - y0);
  const c2: f32 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3: f32 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * fr + c2) * fr + c1) * fr + c0;
}

// snap a semitone offset to the nearest member of scale `q` (1..5)
function snapSemis(s: f32, q: i32): f32 {
  const n: i32 = SCALE_N[q];
  const oct: i32 = i32(Mathf.floor(s / 12.0));
  let best: f32 = s; let bd: f32 = 1000.0;
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (let k = 0; k < n; k++) {
      const cand: f32 = f32(o * 12 + SCALE[q * 8 + k]);
      const d: f32 = Mathf.abs(cand - s);
      if (d < bd) { bd = d; best = cand; }
    }
    if (n == 1) { /* octaves only */ }
  }
  return best;
}

export function process(n: i32): void {
  const pos01: f32 = clampf(params[P_POS], 0.0, 1.0);
  const size01: f32 = clampf(params[P_SIZE], 0.0, 1.0);
  const pitchSt: f32 = clampf(params[P_PITCH], -24.0, 24.0);
  const dens01: f32 = clampf(params[P_DENS], 0.0, 1.0);
  const tex: f32 = clampf(params[P_TEX], 0.0, 1.0);
  const spray: f32 = clampf(params[P_SPRAY], 0.0, 1.0);
  const jit: f32 = clampf(params[P_JIT], 0.0, 1.0);
  const revP: f32 = clampf(params[P_REV], 0.0, 1.0);
  const spread: f32 = clampf(params[P_SPREAD], 0.0, 1.0);
  const chaos: f32 = clampf(params[P_CHAOS], 0.0, 1.0);
  const freezeT: f32 = params[P_FREEZE] >= 0.5 ? 1.0 : 0.0;
  const win01: f32 = clampf(params[P_WINDOW], 0.0, 1.0);
  const quant: i32 = i32(clampf(params[P_QUANT], 0.0, 5.0) + 0.5);
  const fb: f32 = clampf(params[P_FB], 0.0, 1.0) * 0.92;
  const tone: f32 = clampf(params[P_TONE], -1.0, 1.0);
  const degrade: f32 = clampf(params[P_DEGRADE], 0.0, 1.0);
  const verb: f32 = clampf(params[P_VERB], 0.0, 1.0);
  const decay: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const mixT: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.5);

  // buffer window (0.25 s .. ~8 s, exponential), grain size 10 ms .. 1.2 s
  let bufLen: f32 = 0.25 * sampleRate * f32(Mathf.pow(32.0, win01));
  if (bufLen > f32(RING - 4096)) bufLen = f32(RING - 4096);
  const grainLenBase: f32 = 0.010 * sampleRate * f32(Mathf.pow(120.0, size01));
  const meanInterval: f32 = sampleRate / (1.0 + 199.0 * f32(Mathf.pow(dens01, 2.0)));
  const expected: f32 = grainLenBase / meanInterval;                 // mean overlap
  const wetGain: f32 = 1.0 / f32(Mathf.sqrt(1.0 + expected * 0.5));

  // window morph: <0.5 percussive→Hann, >0.5 Hann→plateau
  let fa: f32; let fr: f32;
  if (tex < 0.5) { const t: f32 = tex * 2.0; fa = 0.02 + t * 0.48; fr = 1.0 - fa; }
  else { const t: f32 = (tex - 0.5) * 2.0; fa = 0.5 - t * 0.44; fr = fa; }

  // tone tilt coefficients
  const lpHz: f32 = tone < 0.0 ? 20000.0 * f32(Mathf.pow(0.02, -tone)) : 20000.0;
  const hpHz: f32 = tone > 0.0 ? 20.0 + 3000.0 * tone * tone : 20.0;
  const lpA: f32 = 1.0 - f32(Mathf.exp(-6.2831853 * Mathf.min(lpHz, 0.45 * sampleRate) / sampleRate));
  const hpA: f32 = 1.0 - f32(Mathf.exp(-6.2831853 * hpHz / sampleRate));

  // degrade: sample-hold rate + bit depth
  const holdStep: f32 = 1.0 + degrade * degrade * 30.0;
  const bits: f32 = 16.0 - degrade * 11.0;
  const qLevels: f32 = f32(Mathf.pow(2.0, bits - 1.0));

  // reverb constants
  const fbk: f32 = 0.70 + decay * 0.28;
  const damp: f32 = 0.35;
  const verbSend: f32 = 0.05;

  const freezeSlew: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.010 * sampleRate)));

  for (let f = 0; f < n; f++) {
    const dryL: f32 = inBuf[f];
    const dryR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : dryL;
    sFreeze += (freezeT - sFreeze) * freezeSlew;
    sMix += (mixT - sMix) * 0.002;
    const frozen: bool = sFreeze > 0.5;

    // ---- spawn ----
    spawnCount -= 1.0;
    if (spawnCount <= 0.0) {
      // interval: metronomic ↔ exponential (Poisson) via chaos
      let u: f32 = rndf(); if (u < 0.0001) u = 0.0001;
      const mult: f32 = 1.0 + chaos * (-f32(Mathf.log(u)) - 1.0);
      spawnCount += meanInterval * mult;
      let slot: i32 = -1;
      for (let g = 0; g < MAX_GRAINS; g++) { if (gActive[g] == 0) { slot = g; break; } }
      if (slot >= 0) {
        // pitch (semitones): base + jitter, optionally snapped
        let semis: f32 = pitchSt;
        if (jit > 0.0) semis += (rndf() * 2.0 - 1.0) * jit * 12.0;
        if (quant > 0) semis = snapSemis(semis, quant);
        let rate: f32 = f32(Mathf.exp(semis * 0.05776226504666));
        const backward: bool = rndf() < revP;
        const glen: f32 = grainLenBase * (0.85 + rndf() * 0.3);
        const dir: f32 = backward ? -1.0 : 1.0;
        const dd: f32 = (frozen ? 0.0 : 1.0) - dir * rate;
        // start delay: position (0 = newest .. 1 = oldest) + spray scatter
        let d0: f32 = pos01 * bufLen + (rndf() * 2.0 - 1.0) * spray * 0.5 * bufLen;
        // keep both ends of the trajectory inside [minD, bufLen]
        let lo: f32 = 64.0; let hi: f32 = bufLen;
        const span: f32 = dd * glen;
        if (span < 0.0) lo = lo - span;    // delay shrinks: start later
        else hi = hi - span;               // delay grows: start earlier
        if (hi < lo) { d0 = 0.5 * (lo + hi); } else { d0 = clampf(d0, lo, hi); }
        gDel[slot] = d0; gDD[slot] = dd;
        gPhase[slot] = 0.0; gInc[slot] = 1.0 / glen;
        gFa[slot] = fa; gFr[slot] = fr; gActive[slot] = 1;
        // rate sign handled through gDD; store as delay motion
        const pn: f32 = (rndf() * 2.0 - 1.0) * spread;       // -1..1
        const ang: f32 = (pn * 0.5 + 0.5) * 1.5707963;
        gPanL[slot] = f32(Mathf.cos(ang)); gPanR[slot] = f32(Mathf.sin(ang));
      }
    }

    // ---- render grains ----
    let wetL: f32 = 0.0; let wetR: f32 = 0.0;
    const wf: f32 = f32(writePos);
    for (let g = 0; g < MAX_GRAINS; g++) {
      if (gActive[g] == 0) continue;
      const ph: f32 = gPhase[g];
      let w: f32 = 1.0;
      const a: f32 = gFa[g];
      if (ph < a) w = 0.5 - 0.5 * f32(Mathf.cos(3.14159265 * ph / a));
      else if (ph > 1.0 - gFr[g]) w = 0.5 + 0.5 * f32(Mathf.cos(3.14159265 * (ph - (1.0 - gFr[g])) / gFr[g]));
      const rp: f32 = wf - gDel[g];
      const sL: f32 = readRing(0, rp);
      const sR: f32 = channels > 1 ? readRing(1, rp) : sL;
      wetL += sL * w * gPanL[g];
      wetR += sR * w * gPanR[g];
      gDel[g] += gDD[g];
      const np: f32 = ph + gInc[g];
      if (np >= 1.0 || gDel[g] < 2.0 || gDel[g] > f32(RING - 8)) gActive[g] = 0; else gPhase[g] = np;
    }
    wetL *= wetGain * 1.6; wetR *= wetGain * 1.6;

    // ---- tone tilt ----
    tLpL += (wetL - tLpL) * lpA; tLpR += (wetR - tLpR) * lpA;
    let tL: f32 = tLpL; let tR: f32 = tLpR;
    tHpL += (tL - tHpL) * hpA; tHpR += (tR - tHpR) * hpA;
    tL -= tHpL; tR -= tHpR;

    // ---- degrade ----
    if (degrade > 0.001) {
      holdCnt -= 1.0;
      if (holdCnt <= 0.0) {
        holdCnt += holdStep;
        holdL = Mathf.round(tL * qLevels) / qLevels;
        holdR = Mathf.round(tR * qLevels) / qLevels;
      }
      tL = holdL; tR = holdR;
    }
    tL = f32(Mathf.tanh(tL)); tR = f32(Mathf.tanh(tR));

    // ---- feedback into the buffer (skipped while frozen) ----
    if (!frozen) {
      fbLpL += (tL - fbLpL) * 0.6; fbLpR += (tR - fbLpR) * 0.6;   // tame HF build-up
      fbHpL += (fbLpL - fbHpL) * 0.002; fbHpR += (fbLpR - fbHpR) * 0.002;
      ring[writePos] = clampf(dryL + (fbLpL - fbHpL) * fb, -2.0, 2.0);
      ring[RING + writePos] = clampf(dryR + (fbLpR - fbHpR) * fb, -2.0, 2.0);
      writePos += 1; if (writePos >= RING) writePos = 0;
    }

    // ---- reverb tail (Freeverb topology) ----
    let rvL: f32 = 0.0; let rvR: f32 = 0.0;
    if (verb > 0.001) {
      const inV: f32 = (tL + tR) * verbSend * 4.0;
      for (let c = 0; c < NCOMB; c++) {
        // left
        let idx: i32 = c * COMB_CAP + combPos[c];
        let y: f32 = combBuf[idx];
        combLP[c] = y * (1.0 - damp) + combLP[c] * damp;
        combBuf[idx] = inV + combLP[c] * fbk;
        combPos[c] += 1; if (combPos[c] >= COMB_LEN[c]) combPos[c] = 0;
        rvL += y;
        // right
        const cr: i32 = NCOMB + c;
        idx = cr * COMB_CAP + combPos[cr];
        y = combBuf[idx];
        combLP[cr] = y * (1.0 - damp) + combLP[cr] * damp;
        combBuf[idx] = inV + combLP[cr] * fbk;
        combPos[cr] += 1; if (combPos[cr] >= COMB_LEN[cr]) combPos[cr] = 0;
        rvR += y;
      }
      for (let a = 0; a < NAP; a++) {
        let idx: i32 = a * AP_CAP + apPos[a];
        let bo: f32 = apBuf[idx];
        apBuf[idx] = rvL + bo * 0.5;
        rvL = bo - rvL;
        apPos[a] += 1; if (apPos[a] >= AP_LEN[a]) apPos[a] = 0;
        const ar: i32 = NAP + a;
        idx = ar * AP_CAP + apPos[ar];
        bo = apBuf[idx];
        apBuf[idx] = rvR + bo * 0.5;
        rvR = bo - rvR;
        apPos[ar] += 1; if (apPos[ar] >= AP_LEN[ar]) apPos[ar] = 0;
      }
      rvL *= 0.25; rvR *= 0.25;
    }

    const wetOutL: f32 = tL + rvL * verb * 2.0;
    const wetOutR: f32 = tR + rvR * verb * 2.0;
    const oL: f32 = (dryL * (1.0 - sMix) + wetOutL * sMix) * level;
    const oR: f32 = (dryR * (1.0 - sMix) + wetOutR * sMix) * level;
    outBuf[f] = f32(Mathf.tanh(oL));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(oR));
  }
}
