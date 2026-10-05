// =====================================================================
//  main.ts — KHEVEREST engine glue: key handling (mono / mono-legato / mono-2 /
//  poly / poly-2, unison, glide + pre-glide), the arpeggiator with 33 rhythm
//  patterns, global LFO 3/4, performance controls, the process loop and the ABI
//  exports (see src/WasmAbi.h).
// =====================================================================

const voices: Voice[] = [new Voice(), new Voice(), new Voice(), new Voice(), new Voice(), new Voice(), new Voice(), new Voice()];
let grpCounter: i32 = 0;
let lastSt: f32 = 60.0;           // last played pitch (mono glide source)
let monoSet: i32 = 0;
let lastVel: f32 = 0.8;
let lastKey: f32 = 0.0;

// sounding-key stack (mono modes) -------------------------------------------
const SMAX: i32 = 40;
const sId = new StaticArray<i32>(SMAX);
const sSt = new StaticArray<f32>(SMAX);
const sVel = new StaticArray<f32>(SMAX);
let sCount: i32 = 0;

// held physical keys (arpeggiator input) -----------------------------------------
const HMAX: i32 = 32;
const hId = new StaticArray<i32>(HMAX);
const hSt = new StaticArray<f32>(HMAX);
const hVel = new StaticArray<f32>(HMAX);
const hPhys = new StaticArray<i32>(HMAX);
const hOrd = new StaticArray<i32>(HMAX);
let hCount: i32 = 0;
let hOrder: i32 = 0;

// MIDI performance (added to the direct params) ----------------------------------
let ccMod: f32 = 0.0; let ccBend: f32 = 0.0; let ccPress: f32 = 0.0; let ccEx1: f32 = 0.0; let ccEx2: f32 = 0.0;
let ccAn1: f32 = 0.0; let ccAn2: f32 = 0.0;
let an1S: f32 = 0.0; let an2S: f32 = 0.0;
let cvLp: f32 = 0.0;

// tick output buffer ---------------------------------------------------------------
const tickL = new StaticArray<f32>(TICK);
const tickR = new StaticArray<f32>(TICK);
let tickPos: i32 = TICK;
let peakL: f32 = 0.0; let peakR: f32 = 0.0;
let l3Ph: f32 = 0.0; let l4Ph: f32 = 0.0; let l3SH: f32 = 0.0; let l4SH: f32 = 0.0;
let lastArpOn: i32 = 0;
let lastLatch: i32 = 0;

export function transport(playing: i32, ppq: f64, bpm: f32): void { setHostTransport(playing, ppq, bpm); }
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
// test/diagnostic: decoded actual value of logical parameter i
export function paramValue(i: i32): f32 { return i >= 0 && i < NP ? A[i] : <f32>0.0; }

// tempo used for LFO sync / delay sync / arp
function clockBpm(): f32 {
  const src = pi(P_ARP_SRC);
  const host = hostTempo();
  if (src != 1 && host > 1.0) return host;
  return pv(P_ARP_BPM);
}
function tempoBpm(): f32 { return clockBpm(); }

// ---------------------------------------------------------------------------- init
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  SR = sr > 0.0 ? sr : <f32>48000.0; invSR = <f32>1.0 / SR;
  rng = 0x9e3779b9;
  initSin(); initWavetables();
  for (let i = 0; i < MAX_PARAMS; i++) { params[i] = 0.0; slotCache[i] = -1.0; }
  for (let i = 0; i < NP; i++) { A[i] = 0.0; An[i] = 0.0; AI[i] = 0; }
  setDefaults();
  refreshParams();
  for (let v = 0; v < NV; v++) { voices[v].init(v); }
  grpCounter = 0; lastSt = 60.0; monoSet = 0; sCount = 0; hCount = 0; hOrder = 0;
  ccMod = 0.0; ccBend = 0.0; ccPress = 0.0; ccEx1 = 0.0; ccEx2 = 0.0; ccAn1 = 0.0; ccAn2 = 0.0; an1S = 0.0; an2S = 0.0; cvLp = 0.0;
  gLfoPh[0] = 0.0; gLfoPh[1] = 0.0; gLfoSH[0] = 0.0; gLfoSH[1] = 0.0;
  l3Ph = 0.0; l4Ph = 0.0; l3SH = white(); l4SH = white();
  tickPos = TICK; peakL = 0.0; peakR = 0.0; hostBpm = 0.0;
  arpReset(); lastArpOn = 0; lastLatch = 0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  for (let i = 0; i < TICK; i++) { sumL[i] = 0.0; sumR[i] = 0.0; tickL[i] = 0.0; tickR[i] = 0.0; }
  fxInit();
}

// ---------------------------------------------------------------------------- key handling
@inline function unisonCount(): i32 { const u = pi(P_UNISON); return u == 0 ? 1 : (u == 1 ? 2 : (u == 2 ? 3 : (u == 3 ? 4 : 8))); }
function tuneCents(midi: i32): f32 {
  const t = pi(P_TUNING);
  return unchecked(TUNE[t * 12 + (((midi % 12) + 12) % 12)]) * <f32>0.01;
}
function velCurve(v: f32): f32 {
  const x = clampf(v, 0.0, 1.0);
  const e = exp2f((pv(P_VELSHAPE) - <f32>64.0) * <f32>0.0208333);
  return Mathf.pow(x, e);
}

function pickVoice(exclude: i32): i32 {
  // free first, then oldest releasing, then oldest gated
  let best: i32 = -1; let bestScore: i32 = -1;
  for (let v = 0; v < NV; v++) {
    const vo = voices[v];
    let sc: i32;
    if (!vo.active) sc = 3000000;
    else if (!vo.gate) sc = 2000000 + vo.age;
    else sc = 1000000 + vo.age;
    if (vo.grp == exclude && vo.active) sc -= 900000;   // avoid stealing the chord we are building
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return best;
}
const pickList = new StaticArray<i32>(8);

function sPush(id: i32, st: f32, vel: f32): void {
  for (let i = 0; i < sCount; i++) if (sId[i] == id) { for (let j = i; j < sCount - 1; j++) { sId[j] = sId[j + 1]; sSt[j] = sSt[j + 1]; sVel[j] = sVel[j + 1]; } sCount--; break; }
  if (sCount >= SMAX) { for (let j = 0; j < sCount - 1; j++) { sId[j] = sId[j + 1]; sSt[j] = sSt[j + 1]; sVel[j] = sVel[j + 1]; } sCount--; }
  sId[sCount] = id; sSt[sCount] = st; sVel[sCount] = vel; sCount++;
}
function sRemove(id: i32): bool {
  for (let i = 0; i < sCount; i++) if (sId[i] == id) {
    for (let j = i; j < sCount - 1; j++) { sId[j] = sId[j + 1]; sSt[j] = sSt[j + 1]; sVel[j] = sVel[j + 1]; }
    sCount--; return true;
  }
  return false;
}
function anyActive(): bool { for (let v = 0; v < NV; v++) if (voices[v].active) return true; return false; }

// trigger a key (already tuned/transposed). st = semitone pitch with tuning offset.
function triggerKey(id: i32, st0: f32, vel: f32): void {
  const mode = pi(P_MODE);
  const U = unisonCount();
  const glideOn = pi(P_GLIDE_ON) != 0;
  const st = st0 + f32(pi(P_KBDOCT) * 12);
  gMono = mode <= 2;
  lastVel = vel; lastKey = clampf((st - <f32>60.0) * <f32>0.0166667, -1.0, 1.0);
  if (!anyActive()) {
    for (let l = 0; l < 2; l++) if (pi(lfoP(l, 11)) != 0) {
      const ph = pi(lfoP(l, 7));
      if (ph > 0) gLfoPh[l] = f32(ph - 1) * <f32>6.0 / <f32>360.0;
    }
  }
  if (mode >= 3) {
    // ---- polyphonic
    grpCounter++;
    let n = 0;
    if (mode == 4) {                                   // Poly2: reuse the voices that already play this note
      for (let v = 0; v < NV && n < U; v++) if (voices[v].note == id && voices[v].active) pickList[n++] = v;
    }
    while (n < U) {
      let v = pickVoice(grpCounter);
      // avoid picking the same voice twice
      let dup = true; let guard = 0;
      while (dup && guard < 9) {
        dup = false;
        for (let k = 0; k < n; k++) if (pickList[k] == v) dup = true;
        if (dup) { voices[v].grp = grpCounter; voices[v].active = voices[v].active; v = (v + 1) & 7; }
        guard++;
      }
      pickList[n++] = v;
    }
    for (let u = 0; u < U; u++) {
      const vo = voices[pickList[u]];
      const from: f32 = glideOn ? vo.curSt : st;
      vo.trigger(id, st, vel, false, from, glideOn, u, U, grpCounter);
    }
    lastSt = st;
    return;
  }
  // ---- monophonic family
  sPush(id, st, vel);
  const anyDown = sCount > 1;                          // another key is already sounding
  let legato = false;
  let base = 0;
  if (mode == 2) {                                     // Mono 2: rotate voice sets
    const sets = 8 / U;
    for (let v = 0; v < NV; v++) if (voices[v].grp == grpCounter && voices[v].gate) voices[v].release();
    monoSet = (monoSet + 1) % sets; base = monoSet * U; grpCounter++;
  } else { legato = anyDown && voices[0].gate; grpCounter = 1000; }
  const glide = glideOn && (mode == 0 || mode == 2 || legato);
  for (let u = 0; u < U; u++) {
    const vo = voices[base + u];
    const from = glide ? (mode == 2 ? lastSt : (vo.active ? vo.curSt : lastSt)) : st;
    vo.trigger(id, st, vel, legato, from, glide, u, U, grpCounter);
  }
  // other voices of a different set: release (mono family = one note at a time)
  if (mode != 2) for (let v = U; v < NV; v++) if (voices[v].gate) voices[v].release();
  lastSt = st;
}
function releaseKey(id: i32): void {
  const mode = pi(P_MODE);
  if (mode >= 3) {
    for (let v = 0; v < NV; v++) if (voices[v].note == id && voices[v].gate) voices[v].release();
    return;
  }
  const wasTop = sCount > 0 && sId[sCount - 1] == id;
  sRemove(id);
  if (sCount > 0 && wasTop) {
    // fall back to the previous key, legato
    const U = unisonCount();
    const glideOn = pi(P_GLIDE_ON) != 0;
    const nid = sId[sCount - 1], nst = sSt[sCount - 1], nvel = sVel[sCount - 1];
    const base = mode == 2 ? monoSet * U : 0;
    const glide = glideOn && mode != 1 ? true : (glideOn && mode == 1);
    for (let u = 0; u < U; u++) {
      const vo = voices[base + u];
      vo.trigger(nid, nst, nvel, true, vo.curSt, glide, u, U, vo.grp);
    }
    lastSt = nst;
  } else if (sCount == 0) {
    for (let v = 0; v < NV; v++) if (voices[v].note == id && voices[v].gate) voices[v].release();
    for (let v = 0; v < NV; v++) if (voices[v].gate && mode != 2) voices[v].release();
  } else {
    // a non-top key was released: nothing sounding changes
  }
}

// ---------------------------------------------------------------------------- arpeggiator
const ARP_ID: i32 = 5000;
let arpClock: f32 = 0.0; let arpStepIdx: i32 = 0; let arpPatPos: i32 = 0; let arpSeqPos: i32 = 0; let arpDir: i32 = 1;
let arpRel: f32 = 0.0; let arpCounter: i32 = 0; let arpWasHeld: bool = false;
const arpPlaying = new StaticArray<i32>(32);
let arpPlayN: i32 = 0;
const seqSt = new StaticArray<f32>(256);
const seqVel = new StaticArray<f32>(256);
let seqN: i32 = 0;
function arpReset(): void { arpClock = 0.0; arpStepIdx = 0; arpPatPos = 0; arpSeqPos = 0; arpDir = 1; arpRel = 0.0; arpPlayN = 0; arpWasHeld = false; }
function arpReleaseAll(): void { for (let i = 0; i < arpPlayN; i++) releaseKey(arpPlaying[i]); arpPlayN = 0; arpRel = 0.0; }

function hAdd(id: i32, st: f32, vel: f32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { hSt[i] = st; hVel[i] = vel; hPhys[i] = 1; hOrd[i] = hOrder++; return; }
  if (hCount >= HMAX) return;
  hId[hCount] = id; hSt[hCount] = st; hVel[hCount] = vel; hPhys[hCount] = 1; hOrd[hCount] = hOrder++; hCount++;
}
function hRemoveAt(i: i32): void { for (let j = i; j < hCount - 1; j++) { hId[j] = hId[j + 1]; hSt[j] = hSt[j + 1]; hVel[j] = hVel[j + 1]; hPhys[j] = hPhys[j + 1]; hOrd[j] = hOrd[j + 1]; } hCount--; }
function anyPhys(): bool { for (let i = 0; i < hCount; i++) if (hPhys[i] != 0) return true; return false; }

function arpKeyDown(id: i32, st: f32, vel: f32): void {
  const wasEmpty = hCount == 0;
  if (pi(P_ARP_LATCH) != 0 && hCount > 0 && !anyPhys()) {      // a new chord replaces the latched one
    hCount = 0;
    if (pi(P_ARP_KSYNC) != 0) { arpSeqPos = 0; arpPatPos = 0; arpClock = 0.0; arpStepIdx = 0; arpDir = 1; }
  }
  hAdd(id, st, vel);
  if (wasEmpty) { arpClock = 0.0; arpPatPos = 0; arpSeqPos = 0; arpStepIdx = 0; arpDir = 1; }
}
function arpKeyUp(id: i32): void {
  for (let i = 0; i < hCount; i++) if (hId[i] == id) {
    if (pi(P_ARP_LATCH) != 0) hPhys[i] = 0; else hRemoveAt(i);
    break;
  }
  if (hCount == 0) arpReleaseAll();
}

function buildSeq(): void {
  // sorted ascending copy of held keys
  const n = hCount;
  const tp = pi(P_ARP_TYPE);
  const octs = pi(P_ARP_OCT);
  const idx = new StaticArray<i32>(HMAX);
  for (let i = 0; i < n; i++) idx[i] = i;
  if (tp == 4) { for (let i = 1; i < n; i++) { const k = idx[i]; let j = i - 1; while (j >= 0 && hOrd[idx[j]] > hOrd[k]) { idx[j + 1] = idx[j]; j--; } idx[j + 1] = k; } }
  else { for (let i = 1; i < n; i++) { const k = idx[i]; let j = i - 1; while (j >= 0 && hSt[idx[j]] > hSt[k]) { idx[j + 1] = idx[j]; j--; } idx[j + 1] = k; } }
  // ascending expansion
  let m = 0;
  const upSt = new StaticArray<f32>(256); const upVel = new StaticArray<f32>(256);
  for (let o = 0; o < octs; o++) for (let i = 0; i < n && m < 256; i++) { upSt[m] = hSt[idx[i]] + f32(o * 12); upVel[m] = hVel[idx[i]]; m++; }
  seqN = 0;
  if (tp == 1) { for (let i = m - 1; i >= 0; i--) { seqSt[seqN] = upSt[i]; seqVel[seqN] = upVel[i]; seqN++; } }
  else if (tp == 2 || tp == 3) {
    for (let i = 0; i < m; i++) { seqSt[seqN] = upSt[i]; seqVel[seqN] = upVel[i]; seqN++; }
    const lo = tp == 2 ? 1 : 0; const hi = tp == 2 ? m - 2 : m - 1;
    for (let i = hi; i >= lo && seqN < 256; i--) { seqSt[seqN] = upSt[i]; seqVel[seqN] = upVel[i]; seqN++; }
    if (tp == 2 && m == 1) { /* single note: just the one */ }
  } else { for (let i = 0; i < m; i++) { seqSt[seqN] = upSt[i]; seqVel[seqN] = upVel[i]; seqN++; } }
}

function arpStepSamples(): f32 {
  const bpm = clockBpm();
  const ticks = unchecked(ARP_TICKS[pi(P_ARP_SYNC)]);
  return ticks / <f32>24.0 * <f32>60.0 / bpm * SR;
}
function arpStep(): void {
  if (hCount == 0) return;
  arpReleaseAll();
  const pat = pi(P_ARP_RHYTHM) - 1;
  const p0 = unchecked(PAT_START[pat]), p1 = unchecked(PAT_START[pat + 1]);
  const len = p1 - p0;
  const ch = unchecked(PAT_DATA[p0 + (arpPatPos % len)]);
  arpPatPos++;
  const base = arpStepSamples();
  const sw = f32(pi(P_ARP_SWING)) * <f32>0.01;
  const stepLen = (arpStepIdx & 1) == 0 ? base * <f32>2.0 * sw : base * <f32>2.0 * (<f32>1.0 - sw);
  arpStepIdx++;
  arpClock += stepLen;
  if (ch == 0) return;                                           // rest
  if (ch == 4) {                                                 // tie: nothing new, previous gate extended (not re-triggered)
    return;
  }
  const gate = clampf(pv(P_ARP_GATE) * <f32>0.007874016, 0.04, 1.0) * (ch == 2 ? <f32>0.5 : <f32>1.0);
  let tieLen = stepLen;
  // look ahead for ties
  let la = arpPatPos;
  while (unchecked(PAT_DATA[p0 + (la % len)]) == 4 && tieLen < stepLen * <f32>16.0 && (la - arpPatPos) < len) { tieLen += base; la++; }
  arpRel = tieLen * gate;
  if (pi(P_ARP_TYPE) == 6) {                                    // chord
    const oct = (arpSeqPos % pi(P_ARP_OCT)) * 12; arpSeqPos++;
    for (let i = 0; i < hCount && arpPlayN < 30; i++) {
      const id = ARP_ID + (arpCounter++ & 255);
      arpPlaying[arpPlayN++] = id;
      triggerKey(id, hSt[i] + f32(oct), ch == 3 ? <f32>1.0 : hVel[i]);
    }
    return;
  }
  buildSeq();
  if (seqN == 0) return;
  let k: i32;
  if (pi(P_ARP_TYPE) == 5) k = i32(rand01() * f32(seqN)) % seqN; else { k = arpSeqPos % seqN; arpSeqPos++; }
  const id = ARP_ID + (arpCounter++ & 255);
  arpPlaying[arpPlayN++] = id;
  triggerKey(id, seqSt[k], ch == 3 ? <f32>1.0 : seqVel[k]);
}
function arpTick(dt: f32): void {
  const on = pi(P_ARP_ON);
  if (on != lastArpOn) {
    if (on == 0) { arpReleaseAll(); hCount = 0; for (let v = 0; v < NV; v++) if (voices[v].gate) voices[v].release(); sCount = 0; }
    else { for (let v = 0; v < NV; v++) if (voices[v].gate) voices[v].release(); sCount = 0; arpReset(); }
    lastArpOn = on;
  }
  const latch = pi(P_ARP_LATCH);
  if (latch != lastLatch) {
    if (latch == 0) { for (let i = hCount - 1; i >= 0; i--) if (hPhys[i] == 0) hRemoveAt(i); if (hCount == 0) arpReleaseAll(); }
    lastLatch = latch;
  }
  if (on == 0) return;
  const dts = dt * SR;
  if (arpPlayN > 0) { arpRel -= dts; if (arpRel <= 0.0) { for (let i = 0; i < arpPlayN; i++) releaseKey(arpPlaying[i]); arpPlayN = 0; } }
  if (hCount == 0) return;
  arpClock -= dts;
  if (arpClock <= 0.0) arpStep();
}

// ---------------------------------------------------------------------------- MIDI in
export function noteOn(id: i32, freq: f32, vel: f32): void {
  refreshParams();
  let midi = i32(nearest<f32>(<f32>69.0 + <f32>12.0 * Mathf.log2(freq / <f32>440.0)));
  midi += pi(P_TRANSPOSE);
  if (midi < 0) midi = 0; if (midi > 127) midi = 127;
  const st = f32(midi) + tuneCents(midi);
  const v = velCurve(vel);
  if (pi(P_ARP_ON) != 0) arpKeyDown(id, st, v); else triggerKey(id, st, v);
}
export function noteOff(id: i32): void {
  refreshParams();
  if (pi(P_ARP_ON) != 0) arpKeyUp(id); else releaseKey(id);
}
export function controlChange(num: i32, value: f32): void {
  refreshParams();
  if (num == 1) ccMod = value;
  else if (num == 128) ccBend = value;
  else if (num == 129) ccPress = value;
  else if (num == 11) ccEx1 = value;
  else if (num == 2) ccEx2 = value;
  else if (num == 114) ccAn1 = value;
  else if (num == 115) ccAn2 = value;
  else if (num == 120 || num == 123) {
    for (let v = 0; v < NV; v++) if (voices[v].gate) voices[v].release();
    sCount = 0; hCount = 0; arpReleaseAll();
  }
}

// ---------------------------------------------------------------------------- global LFOs 3/4
function lfoWaveG(t: i32, ph: f32, sh: f32): f32 {
  if (t == 0) return ph < 0.25 ? <f32>4.0 * ph : (ph < 0.75 ? <f32>2.0 - <f32>4.0 * ph : <f32>4.0 * ph - <f32>4.0);
  if (t == 1) return <f32>1.0 - <f32>2.0 * ph;
  if (t == 2) return ph < 0.5 ? <f32>1.0 : <f32>-1.0;
  return sh;
}
function lfoFreqG(l: i32): f32 {
  const b = l == 3 ? P_L3_WAVE : P_L4_WAVE;
  const sy = pi(b + 2);
  if (sy > 0) { const ticks = unchecked(LFO_TICKS[sy - 1]); return clockBpm() / <f32>60.0 / (ticks / <f32>24.0); }
  return <f32>0.02 * Mathf.pow(20000.0, pn(b + 1));
}
function lfoFreqV(l: i32): f32 {                    // LFO 1/2 base frequency (for the common phase)
  const b = lfoP(l, 0);
  const range = pi(b + 1);
  if (range == 0) return <f32>0.02 * Mathf.pow(10000.0, pn(b + 2));
  if (range == 1) return <f32>0.2 * Mathf.pow(8000.0, pn(b + 2));
  return clockBpm() / <f32>60.0 / (unchecked(LFO_TICKS[pi(b + 3)]) / <f32>24.0);
}

// transparent below 0.8, smooth knee up to a 1.25 ceiling
@inline function limitOut(x: f32): f32 {
  const a = absf(x);
  if (a <= 0.8) return x;
  const m: f32 = <f32>0.8 + <f32>0.45 * Mathf.tanh((a - <f32>0.8) / <f32>0.45);
  return x < 0.0 ? -m : m;
}

// ---------------------------------------------------------------------------- one control tick
function renderTick(): void {
  const dt: f32 = f32(TICK) * invSR;
  refreshParams();
  // performance sources
  gModWheel = clampf(pv(P_WHEEL_MOD) + ccMod, 0.0, 1.0);
  gBend = clampf(pv(P_WHEEL_BEND) + ccBend, -1.0, 1.0);
  gAT = clampf(maxf(pv(P_AFTERT), ccPress), 0.0, 1.0);
  gEx1 = clampf(pv(P_EXPR1) + ccEx1, 0.0, 1.0);
  gEx2 = clampf(pv(P_EXPR2) + ccEx2, 0.0, 1.0);
  let cva: f32 = 0.0;
  for (let i = 0; i < TICK; i++) cva += unchecked(inBuf[i]);
  cvLp += (cva * <f32>0.0625 - cvLp) * <f32>0.2;
  gCV = clampf(pv(P_CVIN) + cvLp, -1.0, 1.0);
  const an = pi(P_ANIM);
  const t1: f32 = ((an & 1) != 0 || ccAn1 >= 0.5) ? <f32>1.0 : <f32>0.0;
  const t2: f32 = ((an & 2) != 0 || ccAn2 >= 0.5) ? <f32>1.0 : <f32>0.0;
  const ak = <f32>1.0 - Mathf.exp(-dt / <f32>0.006);
  an1S += (t1 - an1S) * ak; an2S += (t2 - an2S) * ak;
  gAn1 = an1S; gAn2 = an2S;
  // global LFOs
  l3Ph += lfoFreqG(3) * dt; if (l3Ph >= 1.0) { l3Ph -= Mathf.floor(l3Ph); l3SH = white(); }
  l4Ph += lfoFreqG(4) * dt; if (l4Ph >= 1.0) { l4Ph -= Mathf.floor(l4Ph); l4SH = white(); }
  gL3 = lfoWaveG(pi(P_L3_WAVE), l3Ph, l3SH); gL4 = lfoWaveG(pi(P_L4_WAVE), l4Ph, l4SH);
  for (let l = 0; l < 2; l++) {
    let ph = gLfoPh[l] + lfoFreqV(l) * dt;
    if (ph >= 1.0) { ph -= Mathf.floor(ph); gLfoSH[l] = white(); }
    gLfoPh[l] = ph;
  }
  gMono = pi(P_MODE) <= 2;
  arpTick(dt);
  // voices
  for (let i = 0; i < TICK; i++) { sumL[i] = 0.0; sumR[i] = 0.0; }
  let act: f32 = 0.0;
  for (let v = 0; v < NV; v++) {
    const vo = voices[v];
    if (vo.active) { vo.tick(dt); } else { vo.idleLfo(dt); }
    display[v] = vo.active ? vo.eOut[0] : <f32>0.0;
    if (vo.active) act += 1.0;
  }
  // FX matrix + resolved settings
  fxMatrixTick(lastVel, lastKey);
  const bpm = clockBpm();
  fxResolve(bpm);
  const patchG = exp2f((pv(P_PATCHLVL) - <f32>64.0) * <f32>0.015625);
  const vr = pi(P_VOLRANGE);
  const master = pv(P_VOL) * (vr == 0 ? <f32>1.0 : (vr == 1 ? <f32>0.70795 : <f32>0.501187)) * <f32>0.7;
  const wet = pn(P_FX_WET), dry = pn(P_FX_DRY);
  const bypass = pi(P_FX_BYPASS) != 0;
  for (let i = 0; i < TICK; i++) {
    let l = unchecked(sumL[i]) * patchG, r = unchecked(sumR[i]) * patchG;
    l = distTick(l, fxDist); r = distTick(r, fxDist);
    let ol = l * dry, or = r * dry;
    if (!bypass) {
      fxTick(l, r);
      ol += wetL * wet; or += wetR * wet;
    }
    ol *= master; or *= master;
    ol = limitOut(finite(ol)); or = limitOut(finite(or));
    unchecked(tickL[i] = ol); unchecked(tickR[i] = or);
    const al = absf(ol), ar = absf(or);
    peakL = al > peakL ? al : peakL * <f32>0.9995; peakR = ar > peakR ? ar : peakR * <f32>0.9995;
  }
  display[8] = peakL; display[9] = peakR; display[10] = act / f32(NV);
  display[11] = f32(arpStepIdx & 15); display[12] = arpPlayN > 0 ? <f32>1.0 : <f32>0.0;
}

export function process(n: i32): void {
  refreshParams();
  let done = 0;
  while (done < n) {
    if (tickPos >= TICK) { renderTick(); tickPos = 0; }
    let take = TICK - tickPos;
    if (take > n - done) take = n - done;
    for (let i = 0; i < take; i++) {
      unchecked(outBuf[done + i] = tickL[tickPos + i]);
      unchecked(outBuf[MAX_FRAMES + done + i] = tickR[tickPos + i]);
    }
    done += take; tickPos += take;
  }
}
