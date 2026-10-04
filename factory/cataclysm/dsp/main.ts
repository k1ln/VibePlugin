// =====================================================================
//  main.ts — CATACLYSM host glue: voice pool, ratchet scheduler, FX-side
//  modulation, process loop and the ABI exports (see src/WasmAbi.h).
// =====================================================================

const voices: Voice[] = [new Voice(), new Voice(), new Voice(), new Voice()];
let hitSeq: i32 = 0;
let lastVoice: i32 = 0;

// ratchet / flam queue
const RQ: i32 = 96;
const rqT = new StaticArray<f32>(RQ);        // samples until fire
const rqVel = new StaticArray<f32>(RQ);
const rqHz = new StaticArray<f32>(RQ);
const rqNote = new StaticArray<i32>(RQ);
const rqIdx = new StaticArray<i32>(RQ);
const rqN = new StaticArray<i32>(RQ);
const rqSemi = new StaticArray<f32>(RQ);
const rqOn = new StaticArray<i32>(RQ);

// FX-side modulators (global LFOs; envelopes/velocity come from the last voice)
let gL1h0: f32 = 0.0; let gL1h1: f32 = 0.0; let gL2h0: f32 = 0.0; let gL2h1: f32 = 0.0;
let hitFlash: f32 = 0.0;
let dispPeakL: f32 = 0.0; let dispPeakR: f32 = 0.0;

export function transport(playing: i32, ppq: f64, bpm: f32): void { setHostTransport(playing, ppq, bpm); }
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

// test/diagnostic: the decoded actual value of logical parameter i
export function paramValue(i: i32): f32 { return i >= 0 && i < NP ? A[i] : <f32>0.0; }

function syncG(): void { for (let i = 0; i < NP; i++) unchecked(G[i] = A[i]); }
function refresh(): void { if (refreshParams()) syncG(); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  SR = sr; invSR = <f32>1.0 / sr;
  dcCoef = <f32>1.0 - TWO_PI * <f32>6.0 / sr;
  rng = 0x9e3779b9;
  initTables();
  for (let i = 0; i < MAX_PARAMS; i++) { params[i] = 0.0; slotCache[i] = -1.0; }
  for (let i = 0; i < NP; i++) { A[i] = 0.0; An[i] = 0.0; G[i] = 0.0; }
  setDefaults();
  refreshParams(); syncG();
  for (let v = 0; v < NV; v++) { voices[v].active = false; voices[v].choking = false; }
  for (let i = 0; i < RQ; i++) rqOn[i] = 0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  for (let i = 0; i < TICK; i++) { vbufL[i] = 0.0; vbufR[i] = 0.0; }
  gBend = 0.0; gWheel = 0.0; gPress = 0.0; gL1p = 0.0; gL2p = 0.0; hitSeq = 0; lastVoice = 0; hitCounter = 0;
  gL1h0 = white(); gL1h1 = white(); gL2h0 = white(); gL2h1 = white();
  hitFlash = 0.0; dispPeakL = 0.0; dispPeakR = 0.0; hostBpm = 0.0;
  fxInit();
}

// ---- voice allocation -------------------------------------------------------
function fireVoice(note: i32, hz: f32, vel: f32, idx: i32, n: i32, semi: f32): void {
  const poly = i32(A[P_POLY]);
  // choke the oldest sounding voices beyond the polyphony limit
  while (true) {
    let live = 0; let oldest = -1; let oldSeq: i32 = 0x7fffffff;
    for (let v = 0; v < NV; v++) {
      const vo = unchecked(voices[v]);
      if (vo.active && !vo.choking) { live++; if (vo.seq < oldSeq) { oldSeq = vo.seq; oldest = v; } }
    }
    if (live < poly || oldest < 0) break;
    unchecked(voices[oldest]).beginChoke();
  }
  let slot = -1;
  for (let v = 0; v < NV; v++) if (!unchecked(voices[v]).active) { slot = v; break; }
  if (slot < 0) {                       // steal: prefer a choking voice, else the oldest
    let best: i32 = 0x7fffffff;
    for (let v = 0; v < NV; v++) {
      const vo = unchecked(voices[v]);
      const key = vo.choking ? vo.seq - 100000 : vo.seq;
      if (key < best) { best = key; slot = v; }
    }
  }
  hitSeq++;
  unchecked(voices[slot]).trigger(note, hz, vel, idx, n, semi, hitSeq);
  lastVoice = slot;
  hitFlash = 1.0;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  refresh();
  const v = clampf(vel, 0.02, 1.0);
  const n = i32(A[P_RAT_N]);
  fireVoice(id, hz, v, 0, n, 0.0);
  fxHitAge = 0.0;
  fxKeyOff = unchecked(voices[lastVoice]).keyOff;
  if (n > 1) {
    const sync = i32(A[P_RAT_SYNC]);
    let spacing: f32 = A[P_RAT_TIME] * <f32>0.001 * SR;
    if (sync > 0) spacing = ratBeats(sync) * <f32>60.0 / hostTempo() * SR;
    const jit = A[P_RAT_RAND];
    const slope = A[P_RAT_VEL];
    let t: f32 = 0.0;
    for (let j = 1; j < n; j++) {
      t += spacing * (<f32>1.0 + jit * <f32>0.9 * white());
      let slot = -1;
      for (let q = 0; q < RQ; q++) if (rqOn[q] == 0) { slot = q; break; }
      if (slot < 0) break;
      rqOn[slot] = 1; rqT[slot] = t; rqHz[slot] = hz; rqNote[slot] = id; rqIdx[slot] = j; rqN[slot] = n;
      rqVel[slot] = minf(<f32>1.0, v * Mathf.pow(<f32>1.0 + slope, f32(j)));
      rqSemi[slot] = f32(j) * A[P_RAT_PITCH];
    }
  }
}

export function noteOff(id: i32): void {
  if (A[P_GATE] < 0.5) return;
  for (let q = 0; q < RQ; q++) if (rqOn[q] != 0 && rqNote[q] == id) rqOn[q] = 0;
  for (let v = 0; v < NV; v++) {
    const vo = unchecked(voices[v]);
    if (vo.active && vo.note == id && !vo.choking) vo.beginRelease(A[P_REL]);
  }
}

export function controlChange(num: i32, value: f32): void {
  if (num == 1) gWheel = clampf(value, 0.0, 1.0);
  else if (num == 128) gBend = clampf(value, -1.0, 1.0);
  else if (num == 129) gPress = clampf(value, 0.0, 1.0);
}

// ---- FX-side modulation (targets in the drive / filter / eq / space tabs) ----
function fxSrcVal(s: i32, lv: Voice): f32 {
  if (s == 1) return lv.vel;
  if (s == 2) return clampf(lv.keyOff * <f32>0.0208333, -1.5, 1.5);
  if (s == 3) return lv.rnd;
  if (s == 4) return lv.envA;
  if (s == 5) return lv.envB;
  if (s == 6) return lfoEval(i32(A[P_L1_SHAPE]), gL1p, gL1h0, gL1h1);
  if (s == 7) return lfoEval(i32(A[P_L2_SHAPE]), gL2p, gL2h0, gL2h1);
  if (s == 8) return gWheel;
  if (s == 9) return gPress;
  if (s == 10) return gBend;
  if (s == 11) return lv.ratNorm;
  if (s >= 12) return pn(P_MAC1 + s - 12);
  return 0.0;
}

let fxModAny: bool = true;
function fxModulate(): void {
  const lv = unchecked(voices[lastVoice]);
  for (let s = 0; s < 8; s++) {
    const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
    if (d >= 0 && PIS_FX[d] != 0) unchecked(lv.msum[d] = 0.0);
  }
  let any = false;
  for (let s = 0; s < 8; s++) {
    const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
    const src = i32(A[P_MX1_SRC + s * 3]);
    if (d >= 0 && PIS_FX[d] != 0 && src > 0) { lv.msum[d] += fxSrcVal(src, lv) * A[P_MX1_AMT + s * 3]; any = true; }
  }
  if (!any && !fxModAny) return;
  for (let s = 0; s < 8; s++) {
    const d = MOD_DEST_PARAM[i32(A[P_MX1_DST + s * 3])];
    if (d >= 0 && PIS_FX[d] != 0) G[d] = mapNorm(d, clampf(An[d] + lv.msum[d], 0.0, 1.0));
  }
  fxModAny = any;
}

// ---- audio ---------------------------------------------------------------------
export function process(n: i32): void {
  refresh();
  let f = 0;
  let nanSeen = false;
  while (f < n) {
    const m = n - f < TICK ? n - f : TICK;

    // free-running LFOs (FX modulation)
    const dtT = f32(m) * invSR;
    gL1p += lfoRate(A[P_L1_RATE], i32(A[P_L1_SYNC])) * dtT;
    if (gL1p >= 1.0) { gL1p -= Mathf.floor(gL1p); gL1h0 = gL1h1; gL1h1 = white(); }
    gL2p += lfoRate(A[P_L2_RATE], i32(A[P_L2_SYNC])) * dtT;
    if (gL2p >= 1.0) { gL2p -= Mathf.floor(gL2p); gL2h0 = gL2h1; gL2h1 = white(); }

    // ratchets due within this slice
    for (let q = 0; q < RQ; q++) {
      if (rqOn[q] == 0) continue;
      rqT[q] -= f32(m);
      if (rqT[q] <= 0.0) {
        rqOn[q] = 0;
        if (rand01() <= A[P_RAT_PROB]) {
          fireVoice(rqNote[q], rqHz[q], rqVel[q], rqIdx[q], rqN[q], rqSemi[q]);
        }
      }
    }

    for (let i = 0; i < m; i++) { unchecked(vbufL[i] = 0.0); unchecked(vbufR[i] = 0.0); }
    for (let v = 0; v < NV; v++) {
      const vo = unchecked(voices[v]);
      if (!vo.active) continue;
      vo.tick(m);
      vo.render(m);
    }
    fxModulate();
    fxTick(m);
    for (let i = 0; i < m; i++) {
      const l = unchecked(vbufL[i]); const r = unchecked(vbufR[i]);
      if (!(l > -1.0e4 && l < 1.0e4 && r > -1.0e4 && r < 1.0e4)) { nanSeen = true; fxSample(0.0, 0.0); }
      else fxSample(l, r);
      unchecked(outBuf[f + i] = fxL); unchecked(outBuf[MAX_FRAMES + f + i] = fxR);
      const al = Mathf.abs(fxL); const ar = Mathf.abs(fxR);
      if (al > dispPeakL) dispPeakL = al;
      if (ar > dispPeakR) dispPeakR = ar;
    }
    f += m;
  }
  if (nanSeen) {
    fxPanicReset();
    for (let v = 0; v < NV; v++) unchecked(voices[v]).active = false;
  }

  // display: layer activity, output peaks, gain reduction
  let aT: f32 = 0.0; let aF: f32 = 0.0; let aM: f32 = 0.0; let aN: f32 = 0.0; let aX: f32 = 0.0; let aC: f32 = 0.0;
  let live = 0;
  for (let v = 0; v < NV; v++) {
    const vo = unchecked(voices[v]);
    if (!vo.active) continue;
    live++;
    if (vo.lvTone > 0.0) aT = maxf(aT, vo.eT * minf(<f32>1.0, vo.lvTone));
    aF = maxf(aF, vo.eF * (vo.gFL > 0.0 ? <f32>1.0 : <f32>0.0));
    aM = maxf(aM, minf(<f32>1.0, vo.mEnvF * <f32>2.0));
    aN = maxf(aN, vo.eN * (vo.gNL > 0.0 ? <f32>1.0 : <f32>0.0));
    aX = maxf(aX, vo.eX * (vo.gXL > 0.0 ? <f32>1.0 : <f32>0.0));
    aC = maxf(aC, vo.cActive ? vo.ce : <f32>0.0);
  }
  const fall = Mathf.exp(-f32(n) * invSR / <f32>0.12);
  display[0] = maxf(aT, display[0] * fall); display[1] = maxf(aF, display[1] * fall);
  display[2] = maxf(aM, display[2] * fall); display[3] = maxf(aN, display[3] * fall);
  display[4] = maxf(aX, display[4] * fall); display[5] = maxf(aC, display[5] * fall);
  display[6] = dispPeakL; display[7] = dispPeakR;
  const pf = Mathf.exp(-f32(n) * invSR / <f32>0.3);
  dispPeakL *= pf; dispPeakR *= pf;
  display[8] = clampf(-fxGrDb * <f32>0.0416667, 0.0, 1.0);
  display[9] = f32(live) * <f32>0.25;
  display[10] = hitFlash; hitFlash *= Mathf.exp(-f32(n) * invSR / <f32>0.1);
}
