// =====================================================================
//  SHARD SEQUENCER — 16-step granular slice / ratchet / glitch sequencer
//  Audio is captured into a rolling (or HELD) stereo buffer that is cut into
//  16 equal slices spanning the CAPTURE window (1/2/4/8 beats). A 16-step
//  sequence then fires "shards" — grains cut from any slice — locked to the
//  DAW playhead (ppq) with swing, falling back to a free-running clock at the
//  host/param tempo when the transport is stopped.
//   Per step: SLICE (rest, or 1 = oldest … 16 = newest), PITCH (±24 st),
//             REVERSE, RATCHET (1–4 hits inside the step) and GATE (25–100 %).
//   Global:  Tempo · Steps · Division (¼ ⅛ 1/16 1/32 ⅛T) · Swing · Capture ·
//            Hold (freeze the buffer into a locked loop) · Chance · Jitter ·
//            Fade · Tone · Crush · Spread · Duck (dry gate while shards play)
//            · Mix · Level.
//  Shards are Hermite-interpolated, raised-cosine faded voices (12-voice pool).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const RING: i32 = 393216;
const ring: StaticArray<f32> = new StaticArray<f32>(RING * MAX_CHANNELS);
let writePos: i32 = 0;

const NVOI: i32 = 12;
const vAct: StaticArray<i32> = new StaticArray<i32>(NVOI);
const vDel: StaticArray<f32> = new StaticArray<f32>(NVOI);
const vDD:  StaticArray<f32> = new StaticArray<f32>(NVOI);
const vPos: StaticArray<f32> = new StaticArray<f32>(NVOI);   // frames elapsed
const vDur: StaticArray<f32> = new StaticArray<f32>(NVOI);
const vFade: StaticArray<f32> = new StaticArray<f32>(NVOI);
const vPL:  StaticArray<f32> = new StaticArray<f32>(NVOI);
const vPR:  StaticArray<f32> = new StaticArray<f32>(NVOI);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let rngState: u32 = 0x1badf00d;

// clock
let tPlaying: i32 = 0;
let tHave: i32 = 0;
let tPpq: f64 = 0.0;
let tBpm: f32 = 0.0;
let freePpq: f64 = 0.0;
let lastStep: i64 = -1;

// ratchet scheduler
let rHitsLeft: i32 = 0;
let rCount: f32 = 0.0;
let rSub: f32 = 0.0;
let rDur: f32 = 0.0;
let rSlice: i32 = 0;
let rRate: f32 = 1.0;
let rRev: i32 = 0;

let duckEnv: f32 = 0.0;
let lpL: f32 = 0.0; let lpR: f32 = 0.0; let hpL: f32 = 0.0; let hpR: f32 = 0.0;
let holdL: f32 = 0.0; let holdR: f32 = 0.0; let holdCnt: f32 = 0.0;
let sHold: f32 = 0.0;
let sMix: f32 = 0.7;
let curStepOut: i32 = 0;

const P_TEMPO: i32 = 0;  const P_STEPS: i32 = 1;  const P_DIV: i32 = 2;    const P_SWING: i32 = 3;
const P_CAPT: i32 = 4;   const P_HOLD: i32 = 5;   const P_CHANCE: i32 = 6;  const P_JIT: i32 = 7;
const P_FADE: i32 = 8;   const P_TONE: i32 = 9;   const P_CRUSH: i32 = 10;  const P_SPREAD: i32 = 11;
const P_DUCK: i32 = 12;  const P_MIX: i32 = 13;   const P_LEVEL: i32 = 14;
const P_STEP0: i32 = 15;
const P_HOSTBPM: i32 = 63;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < RING * MAX_CHANNELS; i++) ring[i] = 0.0;
  writePos = 0;
  for (let i = 0; i < NVOI; i++) { vAct[i] = 0; vPL[i] = 0.7071; vPR[i] = 0.7071; }
  rngState = 0x1badf00d;
  tPlaying = 0; tHave = 0; tPpq = 0.0; tBpm = 0.0; freePpq = 0.0; lastStep = -1;
  rHitsLeft = 0; rCount = 0.0; duckEnv = 0.0;
  lpL = 0.0; lpR = 0.0; hpL = 0.0; hpR = 0.0; holdL = 0.0; holdR = 0.0; holdCnt = 0.0;
  sHold = 0.0; sMix = 0.7; curStepOut = 0;
  params[P_TEMPO] = 120.0; params[P_STEPS] = 16.0; params[P_DIV] = 2.0; params[P_SWING] = 0.15;
  params[P_CAPT] = 2.0; params[P_HOLD] = 0.0; params[P_CHANCE] = 1.0; params[P_JIT] = 0.0;
  params[P_FADE] = 0.25; params[P_TONE] = 0.0; params[P_CRUSH] = 0.0; params[P_SPREAD] = 0.4;
  params[P_DUCK] = 0.9; params[P_MIX] = 0.85; params[P_LEVEL] = 0.9;
  const sl: StaticArray<f32> = [16, 0, 12, 0, 8, 0, 4, 3, 16, 0, 10, 0, 6, 6, 2, 1];
  const pt: StaticArray<f32> = [0, 0, 0, 0, 0, 0, -12, 0, 0, 0, 7, 0, 0, 12, 0, -5];
  const fl: StaticArray<f32> = [0, 0, 0, 0, 2, 0, 4, 0, 0, 0, 1, 0, 6, 1, 4, 3];
  for (let i = 0; i < 16; i++) {
    params[P_STEP0 + i * 3] = sl[i];
    params[P_STEP0 + i * 3 + 1] = pt[i];
    params[P_STEP0 + i * 3 + 2] = fl[i] + 24.0;   // gate 100 %
  }
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 63; }

export function transport(playing: i32, ppq: f64, bpm: f32): void {
  tHave = 1; tPlaying = playing; tPpq = ppq; tBpm = bpm;
}

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rndf(): f32 {
  let x: u32 = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return f32(x & 0x00ffffff) / f32(0x01000000);
}

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
  const c1: f32 = 0.5 * (y2 - y0);
  const c2: f32 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3: f32 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * fr + c2) * fr + c1) * fr + y1;
}

// fire one shard from a slice
function trigger(slice: i32, rate: f32, rev: i32, dur: f32, winFrames: f32, frozen: bool,
                 jitter: f32, fadeFr: f32, spread: f32): void {
  let slot: i32 = -1;
  for (let v = 0; v < NVOI; v++) { if (vAct[v] == 0) { slot = v; break; } }
  if (slot < 0) {
    // steal the oldest (most elapsed)
    let best: f32 = -1.0;
    for (let v = 0; v < NVOI; v++) { if (vPos[v] > best) { best = vPos[v]; slot = v; } }
  }
  const S: f32 = winFrames / 16.0;
  const dOld: f32 = winFrames - f32(slice - 1) * S;              // slice start (older edge)
  const lr: f32 = dur * rate;                                    // source frames consumed
  const live: f32 = frozen ? 0.0 : 1.0;
  let d0: f32;
  let dd: f32;
  if (rev == 0) { d0 = dOld; dd = live - rate; }
  else { d0 = dOld - lr; dd = live + rate; }
  d0 += (rndf() * 2.0 - 1.0) * jitter * S * 2.0;
  // keep the trajectory inside [32, RING-8]
  const dEnd: f32 = d0 + dd * dur;
  const lo: f32 = Mathf.min(d0, dEnd);
  const hi: f32 = Mathf.max(d0, dEnd);
  if (lo < 32.0) d0 += 32.0 - lo;
  else if (hi > f32(RING - 8)) d0 -= hi - f32(RING - 8);
  vDel[slot] = d0; vDD[slot] = dd; vPos[slot] = 0.0; vDur[slot] = dur;
  vFade[slot] = Mathf.min(fadeFr, dur * 0.5);
  const pn: f32 = (rndf() * 2.0 - 1.0) * spread;
  const ang: f32 = (pn * 0.5 + 0.5) * 1.5707963;
  vPL[slot] = f32(Mathf.cos(ang)); vPR[slot] = f32(Mathf.sin(ang));
  vAct[slot] = 1;
}

export function process(n: i32): void {
  const tempoP: f32 = clampf(params[P_TEMPO], 30.0, 300.0);
  const steps: i32 = i32(clampf(params[P_STEPS], 1.0, 16.0) + 0.5);
  const div: i32 = i32(clampf(params[P_DIV], 0.0, 4.0) + 0.5);
  const swing: f32 = clampf(params[P_SWING], 0.0, 0.6);
  const capt: i32 = i32(clampf(params[P_CAPT], 0.0, 3.0) + 0.5);
  const holdT: f32 = params[P_HOLD] >= 0.5 ? 1.0 : 0.0;
  const chance: f32 = clampf(params[P_CHANCE], 0.0, 1.0);
  const jit: f32 = clampf(params[P_JIT], 0.0, 1.0);
  const fade01: f32 = clampf(params[P_FADE], 0.0, 1.0);
  const tone: f32 = clampf(params[P_TONE], -1.0, 1.0);
  const crush: f32 = clampf(params[P_CRUSH], 0.0, 1.0);
  const spread: f32 = clampf(params[P_SPREAD], 0.0, 1.0);
  const duck: f32 = clampf(params[P_DUCK], 0.0, 1.0);
  const mixT: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.5);

  // tempo: DAW transport > host tempo slot > Tempo param
  let bpm: f32 = tempoP;
  if (tHave == 1 && tBpm > 20.0) bpm = tBpm;
  else if (params[P_HOSTBPM] > 20.0) bpm = params[P_HOSTBPM];
  const followDaw: bool = tHave == 1 && tPlaying == 1;
  const beatFrames: f32 = 60.0 / bpm * sampleRate;
  const stepBeats: f32 = div == 0 ? 1.0 : (div == 1 ? 0.5 : (div == 2 ? 0.25 : (div == 3 ? 0.125 : 0.3333333)));
  const stepFrames: f32 = beatFrames * stepBeats;
  const capBeats: f32 = capt == 0 ? 1.0 : (capt == 1 ? 2.0 : (capt == 2 ? 4.0 : 8.0));
  let winFrames: f32 = capBeats * beatFrames;
  if (winFrames > f32(RING - 4096)) winFrames = f32(RING - 4096);
  const ppqInc: f64 = f64(bpm) / (60.0 * f64(sampleRate));
  const fadeFr: f32 = (0.5 + fade01 * fade01 * 30.0) * 0.001 * sampleRate;
  const holdSlew: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.005 * sampleRate)));

  const lpHz: f32 = tone < 0.0 ? 20000.0 * f32(Mathf.pow(0.02, -tone)) : 20000.0;
  const hpHz: f32 = tone > 0.0 ? 20.0 + 3000.0 * tone * tone : 20.0;
  const lpA: f32 = 1.0 - f32(Mathf.exp(-6.2831853 * Mathf.min(lpHz, 0.45 * sampleRate) / sampleRate));
  const hpA: f32 = 1.0 - f32(Mathf.exp(-6.2831853 * hpHz / sampleRate));
  const holdStep: f32 = 1.0 + crush * crush * 30.0;
  const qLevels: f32 = f32(Mathf.pow(2.0, 15.0 - crush * 11.0));
  const duckA: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.003 * sampleRate)));


  for (let f = 0; f < n; f++) {
    const dryL: f32 = inBuf[f];
    const dryR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : dryL;
    sHold += (holdT - sHold) * holdSlew;
    sMix += (mixT - sMix) * 0.002;
    const frozen: bool = sHold > 0.5;

    // ---- clock → step index (swing = late odd steps) ----
    let ppq: f64;
    if (followDaw) { ppq = tPpq; tPpq += ppqInc; }
    else { ppq = freePpq; freePpq += ppqInc; }
    const stepPos: f64 = ppq / f64(stepBeats);
    const pairIdx: i64 = i64(Math.floor(stepPos * 0.5));
    const fr: f64 = stepPos * 0.5 - f64(pairIdx);
    const boundary: f64 = 0.5 + f64(swing) * 0.25;
    const stepIdx: i64 = fr < boundary ? pairIdx * 2 : pairIdx * 2 + 1;
    if (stepIdx != lastStep) {
      lastStep = stepIdx;
      let si: i32 = i32(stepIdx % i64(steps)); if (si < 0) si += steps;
      curStepOut = si;
      const b: i32 = P_STEP0 + si * 3;
      const slice: i32 = i32(clampf(params[b], 0.0, 16.0) + 0.5);
      const pitch: f32 = clampf(params[b + 1], -24.0, 24.0);
      const flags: i32 = i32(clampf(params[b + 2], 0.0, 31.0) + 0.5);
      rHitsLeft = 0;
      if (slice > 0 && (chance >= 0.999 || rndf() < chance)) {
        const R: i32 = ((flags >> 1) & 3) + 1;
        const gate: f32 = 0.25 * f32(((flags >> 3) & 3) + 1);
        rHitsLeft = R;
        rSub = stepFrames / f32(R);
        rDur = Mathf.max(rSub * gate, 16.0);
        rCount = 0.0;
        rSlice = slice;
        rRate = f32(Mathf.exp(pitch * 0.05776226504666));
        rRev = flags & 1;
      }
    }
    if (rHitsLeft > 0) {
      rCount -= 1.0;
      if (rCount <= 0.0) {
        trigger(rSlice, rRate, rRev, rDur, winFrames, frozen, jit, fadeFr, spread);
        rHitsLeft -= 1;
        rCount += rSub;
      }
    }

    // ---- render shards ----
    let wetL: f32 = 0.0; let wetR: f32 = 0.0; let any: f32 = 0.0;
    const wf: f32 = f32(writePos);
    for (let v = 0; v < NVOI; v++) {
      if (vAct[v] == 0) continue;
      const p: f32 = vPos[v];
      const rem: f32 = vDur[v] - p;
      let e: f32 = 1.0;
      const fd: f32 = vFade[v];
      if (p < fd) e = f32(Mathf.sin(1.5707963 * p / fd));
      if (rem < fd) e = e * f32(Mathf.sin(1.5707963 * Mathf.max(rem, 0.0) / fd));
      const rp: f32 = wf - vDel[v];
      const sL: f32 = readRing(0, rp);
      const sR: f32 = channels > 1 ? readRing(1, rp) : sL;
      wetL += sL * e * vPL[v] * 1.414;
      wetR += sR * e * vPR[v] * 1.414;
      any = 1.0;
      vDel[v] += vDD[v];
      vPos[v] = p + 1.0;
      if (vPos[v] >= vDur[v] || vDel[v] < 2.0 || vDel[v] > f32(RING - 8)) vAct[v] = 0;
    }
    duckEnv += ((any > 0.5 ? 1.0 : 0.0) - duckEnv) * duckA;

    // ---- write capture buffer ----
    if (!frozen) {
      ring[writePos] = dryL; ring[RING + writePos] = dryR;
      writePos += 1; if (writePos >= RING) writePos = 0;
    }

    // ---- tone + crush on the wet path ----
    lpL += (wetL - lpL) * lpA; lpR += (wetR - lpR) * lpA;
    let tL: f32 = lpL; let tR: f32 = lpR;
    hpL += (tL - hpL) * hpA; hpR += (tR - hpR) * hpA;
    tL -= hpL; tR -= hpR;
    if (crush > 0.001) {
      holdCnt -= 1.0;
      if (holdCnt <= 0.0) {
        holdCnt += holdStep;
        holdL = Mathf.round(tL * qLevels) / qLevels;
        holdR = Mathf.round(tR * qLevels) / qLevels;
      }
      tL = holdL; tR = holdR;
    }

    const dg: f32 = 1.0 - sMix * duck * duckEnv;
    const oL: f32 = (dryL * dg + tL * sMix) * level;
    const oR: f32 = (dryR * dg + tR * sMix) * level;
    outBuf[f] = f32(Mathf.tanh(oL));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(oR));
  }
}
