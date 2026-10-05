// =====================================================================
//  keys.ts — the monophonic keyboard (LOW / HIGH / LAST priority, single trigger
//  legato), glide (LCR / LCT / exponential, legato + gated), the arpeggiator
//  (ORDR / FWD-BKWD / RNDM, 1-3 octaves, HOLD latch), the 3 × 256-step sequencer
//  (REC with REST / TIE / ACCENT, live overwrite, key transposition), and the
//  clock (internal BPM / tap tempo / host tempo with the 24 note divisions /
//  external CLOCK IN in Clock or Step-Advance mode, RESET IN, ON/OFF IN, CLOCK OUT).
// =====================================================================

const HMAX: i32 = 64;
const SEQ_N: i32 = 256;
const F_TIE: i32 = 1;
const F_ACC: i32 = 2;

// ---- held-key list (press order) ---------------------------------------------------------
const hId = new StaticArray<i32>(HMAX);
const hNote = new StaticArray<i32>(HMAX);
const hVel = new StaticArray<f32>(HMAX);
const hDown = new StaticArray<i32>(HMAX);
let hN: i32 = 0;

// ---- sequencer memory --------------------------------------------------------------------
const seqNote = new StaticArray<i32>(3 * SEQ_N);   // MIDI note, -1 = rest
const seqFlag = new StaticArray<i32>(3 * SEQ_N);
const seqLen = new StaticArray<i32>(3);
let recArmed: bool = true;
let recPendingTie: bool = false;
let recLast: i32 = -1;
let lastMode: i32 = 0;
let lastSeqSel: i32 = 0;

// ---- keyboard / output state --------------------------------------------------------------
let kTarget: f32 = 60.0;           // note the pitch glides toward (semitones, MIDI)
let kCur: f32 = 60.0;              // glided pitch
let kGlideOk: bool = true;
let kLctRate: f32 = 0.0;
let kVel: f32 = 0.8;
let kGateWant: bool = false;
let kGateOut: bool = false;
let kLowT: f32 = 1.0;              // seconds the gate has been low (guarantees a re-trigger gap)
let kAccent: f32 = 0.0;            // accent envelope 0..1
let kAccentSeq: bool = false;      // true while the sequencer drives KB VEL OUT

// ---- run / clock state -------------------------------------------------------------------
let kRunArp: bool = false;
let kRunSeq: bool = false;
let kPhase: f32 = 1.0;
let kGateOffT: f32 = 0.0;
let kGateOffArm: bool = false;
let kArpPos: i32 = 0;
let kSeqPos: i32 = 0;
let kSeqCur: i32 = 0;              // step index currently sounding
let kSeqKey: i32 = -1;             // note of the transposing key
let kStepCount: i32 = 0;
let kStepSec: f32 = 0.25;
let kPulseCnt: i32 = 0;
let kLastClkPrev: f32 = 0.0;
let kClkTimer: f32 = 0.0;
let kClkPeriod: f32 = 0.0;
let kOnoffPrev: bool = false;
let kResetPrev: bool = false;
let kHostIdx: i64 = -1;
let kPpqAcc: f64 = 0.0;
let kClkOutPh: f32 = 0.0;
let kClkOut: f32 = 0.0;
let kStepFlash: f32 = 0.0;
let kLastBend: f32 = 0.0;

function clearKeys(): void { hN = 0; }
function hFind(id: i32): i32 { for (let i = 0; i < hN; i++) if (hId[i] == id) return i; return -1; }
function hRemoveAt(i: i32): void {
  for (let j = i; j < hN - 1; j++) { hId[j] = hId[j + 1]; hNote[j] = hNote[j + 1]; hVel[j] = hVel[j + 1]; hDown[j] = hDown[j + 1]; }
  hN--;
}
function physDown(): i32 { let c = 0; for (let i = 0; i < hN; i++) if (hDown[i] != 0) c++; return c; }
@inline function sel(d: i32): i32 { return unchecked(SEL[d]); }
@inline function patched(d: i32): bool { return unchecked(SEL[d]) != 0; }

function playOn(): bool {
  if (patched(D_ONOFF_IN)) return unchecked(S[unchecked(SEL[D_ONOFF_IN])]) > 2.5;
  return pi(P_PLAY) != 0;
}
function holdOn(): bool { return pi(P_HOLD) != 0; }

// ---- sequencer helpers ---------------------------------------------------------------------
function seqSel(): i32 { return pi(P_OCT_SEQ); }
function seqRoot(s: i32): i32 {
  for (let i = 0; i < seqLen[s]; i++) if (seqNote[s * SEQ_N + i] >= 0) return seqNote[s * SEQ_N + i];
  return 60;
}
function seqClear(s: i32): void { seqLen[s] = 0; }

// ---- pitch target / gate --------------------------------------------------------------------
function setTarget(note: i32, vel: f32, legatoHint: bool): void {
  const legatoOnly = pi(P_GL_LEGATO) != 0;
  kGlideOk = !legatoOnly || (kGateOut && legatoHint);
  kTarget = f32(note);
  if (pi(P_GL_TYPE) == 1) {
    const gx = pv(P_GLIDE);
    const t: f32 = <f32>0.01 * Mathf.pow(<f32>600.0, clampf((gx - <f32>0.01) * <f32>1.0101, 0.0, 1.0));
    kLctRate = absf(kTarget - kCur) / t;
  }
  kVel = vel;
}
function dropGate(): void { kGateWant = false; kGateOffArm = false; }

// resolve what the plain keyboard is playing (no arp / seq running)
function keyboardUpdate(newKey: bool): void {
  const pri = pi(P_NOTE_PRI);
  let best: i32 = -1;
  for (let i = 0; i < hN; i++) {
    if (hDown[i] == 0) continue;
    if (best < 0) { best = i; continue; }
    if (pri == 0) { if (hNote[i] < hNote[best]) best = i; }
    else if (pri == 1) { if (hNote[i] > hNote[best]) best = i; }
    else best = i;                        // LAST: the most recent entry wins
  }
  if (best < 0) { dropGate(); return; }
  const wasHigh = kGateWant || kGateOut;
  if (newKey || hNote[best] != i32(kTarget) || !wasHigh) setTarget(hNote[best], hVel[best], wasHigh);
  kGateWant = true; kGateOffArm = false;
}

// ---- arpeggiator step ------------------------------------------------------------------------
function arpPick(): i32 {
  const cnt = hN;
  if (cnt <= 0) return 60;
  const oct = pi(P_OCT_SEQ) + 1;
  const n = cnt * oct;
  const dir = pi(P_ARP_DIR);
  let idx: i32 = 0;
  if (dir == 0) { idx = kArpPos % n; }
  else if (dir == 1) {
    if (n <= 1) idx = 0;
    else { const per = 2 * n - 2; const p = kArpPos % per; idx = p < n ? p : per - p; }
  } else { idx = i32(rand01() * f32(n)); if (idx >= n) idx = n - 1; }
  kArpPos++;
  const ni = idx % cnt;
  kVel = hVel[ni];
  return hNote[ni] + 12 * (idx / cnt);
}

// next sequence position (peek or commit) ---------------------------------------------------------
function seqAdvance(s: i32, pos: i32): i32 {          // returns the step index for counter value `pos`
  const len = seqLen[s];
  if (len <= 0) return 0;
  const dir = pi(P_ARP_DIR);
  if (dir == 0) return pos % len;
  if (dir == 1) { if (len <= 1) return 0; const per = 2 * len - 2; const p = pos % per; return p < len ? p : per - p; }
  return -1;                                             // random: decided at the step
}

function doStep(dt: f32): void {
  kStepFlash = 1.0;
  const gl: f32 = kStepSec * <f32>0.5;
  if (kRunArp) {
    const note = arpPick();
    setTarget(note, kVel, kGateOut);
    kAccentSeq = false;
    kGateWant = true; kGateOffArm = true; kGateOffT = gl;
    return;
  }
  if (!kRunSeq) return;
  const s = seqSel();
  const len = seqLen[s];
  if (len <= 0) { dropGate(); return; }
  let idx = seqAdvance(s, kSeqPos);
  if (idx < 0) { idx = i32(rand01() * f32(len)); if (idx >= len) idx = len - 1; }
  kSeqPos++;
  kSeqCur = idx;
  const note = seqNote[s * SEQ_N + idx];
  const fl = seqFlag[s * SEQ_N + idx];
  kAccentSeq = true;
  if (note < 0) { dropGate(); return; }                 // REST
  const tr = pi(P_ARP_MODE) == 2 ? 0 : (kSeqKey >= 0 ? kSeqKey - seqRoot(s) : 0);
  const legato = (fl & F_TIE) != 0 && kGateWant;
  setTarget(note + tr, 0.8, legato);
  kGateWant = true;
  if ((fl & F_ACC) != 0) kAccent = 1.0;
  // does the next step continue this gate (tie)?
  let tied = false;
  const nxt = seqAdvance(s, kSeqPos);
  if (nxt >= 0 && nxt < len) { if ((seqFlag[s * SEQ_N + nxt] & F_TIE) != 0 && seqNote[s * SEQ_N + nxt] >= 0) tied = true; }
  if (tied) kGateOffArm = false; else { kGateOffArm = true; kGateOffT = gl; }
}

// ---- run-state management -----------------------------------------------------------------------
function startRun(): void {
  kPhase = 1.0; kArpPos = 0; kSeqPos = 0; kPulseCnt = 0; kStepCount = 0; kHostIdx = -1;
}
function updateRun(newKey: bool): void {
  const mode = pi(P_ARP_MODE);
  const po = playOn();
  const oo = patched(D_ONOFF_IN);
  const wantArp = mode == 0 && po && hN > 0;
  const wantSeq = po && ((mode == 1 && (hN > 0 || oo)) || (mode == 2 && kRunSeq));
  if (wantArp && !kRunArp) startRun();
  if (wantSeq && !kRunSeq) startRun();
  if ((kRunArp && !wantArp) || (kRunSeq && !wantSeq)) {
    kGateWant = false; kGateOffArm = false; kAccentSeq = false;
    kRunArp = false; kRunSeq = false;
  }
  kRunArp = wantArp; kRunSeq = wantSeq;
  if (wantSeq && hN > 0) kSeqKey = hNote[hN - 1];
  if (!wantArp && !wantSeq) keyboardUpdate(newKey);
}

function modeWatch(): void {
  const mode = pi(P_ARP_MODE);
  const s = seqSel();
  if (mode != lastMode || s != lastSeqSel) {
    if (mode == 2 && (lastMode != 2 || s != lastSeqSel)) { recArmed = true; recPendingTie = false; recLast = -1; }
    lastMode = mode; lastSeqSel = s;
  }
}

// ---- key events -----------------------------------------------------------------------------------
function recordKey(note: i32, vel: f32, legato: bool): void {
  const s = seqSel();
  if (kRunSeq) {                                          // live overwrite of the step that is sounding
    const i = kSeqCur;
    if (i >= 0 && i < seqLen[s]) { seqNote[s * SEQ_N + i] = note; seqFlag[s * SEQ_N + i] = recPendingTie ? F_TIE : 0; }
    recPendingTie = false;
    return;
  }
  if (recArmed) { seqClear(s); recArmed = false; }
  if (seqLen[s] < SEQ_N) {
    const i = seqLen[s];
    seqNote[s * SEQ_N + i] = note;
    seqFlag[s * SEQ_N + i] = (recPendingTie || legato) ? F_TIE : 0;
    seqLen[s] = i + 1; recLast = i;
  }
  recPendingTie = false;
}
function recordMarker(kind: i32): void {                  // 0 rest, 1 tie, 2 accent
  const s = seqSel();
  if (kind == 1) {
    if (kRunSeq) { const i = kSeqCur; if (i >= 0 && i < seqLen[s]) seqFlag[s * SEQ_N + i] |= F_TIE; }
    else recPendingTie = true;
    return;
  }
  if (kind == 2) {
    const i = kRunSeq ? kSeqCur : recLast;
    if (i >= 0 && i < seqLen[s]) seqFlag[s * SEQ_N + i] |= F_ACC;
    return;
  }
  if (kRunSeq) { const i = kSeqCur; if (i >= 0 && i < seqLen[s]) { seqNote[s * SEQ_N + i] = -1; seqFlag[s * SEQ_N + i] = 0; } return; }
  if (recArmed) { seqClear(s); recArmed = false; }
  if (seqLen[s] < SEQ_N) {
    const i = seqLen[s];
    seqNote[s * SEQ_N + i] = -1; seqFlag[s * SEQ_N + i] = 0; seqLen[s] = i + 1; recLast = i;
  }
  recPendingTie = false;
}

function keyOn(id: i32, note: i32, vel: f32): void {
  modeWatch();
  const mode = pi(P_ARP_MODE);
  const po = playOn();
  const wasDown = physDown();
  // a new pattern starts when every finger was up and the old notes were only latched
  if (wasDown == 0 && holdOn() && po) hN = 0;
  const f = hFind(id);
  if (f >= 0) hRemoveAt(f);
  if (hN >= HMAX) hRemoveAt(0);
  hId[hN] = id; hNote[hN] = note; hVel[hN] = vel; hDown[hN] = 1; hN++;
  if (mode == 2) recordKey(note, vel, wasDown > 0);
  updateRun(true);
  if (kRunSeq && hN > 0) kSeqKey = note;
}
function keyOff(id: i32): void {
  const f = hFind(id);
  if (f < 0) return;
  if (holdOn() && playOn()) hDown[f] = 0; else hRemoveAt(f);
  updateRun(false);
}
function allNotesOff(): void {
  hN = 0; kGateWant = false; kGateOffArm = false; kRunArp = false; kRunSeq = false; kAccentSeq = false;
}

// ---- the clock ---------------------------------------------------------------------------------------
@inline function divQ(i: i32): f32 { return unchecked(CLOCK_DIV[i]); }
function bpmNow(): f32 {
  const tap = pi(P_TAP_BPM);
  if (tap > 0) return f32(clampi(tap, 20, 280));
  return <f32>20.0 + <f32>260.0 * pv(P_ARP_RATE);
}
function stepSeconds(): f32 {
  if (pi(P_CLK_SRC) == 1) {
    const hb = hostTempo();
    if (hb > 1.0) {
      let idx = i32(pn(P_ARP_RATE) * <f32>23.999);
      if (idx > 23) idx = 23;
      return divQ(idx) * <f32>60.0 / hb;
    }
  }
  return <f32>30.0 / bpmNow();              // one step = an eighth note at the BPM
}
@inline function ppqnVal(i: i32): i32 { return unchecked(PPQN_V[i]); }

// advance the clock by one sample; returns true on a step event
function clockTick(dt: f32): bool {
  let ev = false;
  const run = kRunArp || kRunSeq;
  // CLOCK IN edge (pulse > 2.5 V)
  const ci = patched(D_CLK_IN);
  let clkNow: f32 = 0.0;
  if (ci) clkNow = unchecked(S[unchecked(SEL[D_CLK_IN])]);
  const rise = ci && clkNow > 2.5 && kLastClkPrev <= 2.5;
  kLastClkPrev = clkNow;
  kClkTimer += dt;
  if (ci) {
    if (rise) {
      if (kClkTimer > 0.0005) kClkPeriod = kClkTimer;
      kClkTimer = 0.0;
      if (run) {
        const stepMode = pi(P_EXT_MODE) == 1;
        let per = stepMode ? 1 : ppqnVal(pi(P_EXT_PPQN)) / 2;
        if (per < 1) per = 1;
        kPulseCnt++;
        if (kPulseCnt >= per) { kPulseCnt = 0; ev = true; }
        kStepSec = (stepMode ? kClkPeriod : kClkPeriod * f32(per));
        if (kStepSec < 0.001) kStepSec = 0.001;
      }
    }
    kPhase = 0.0;
  } else {
    kStepSec = stepSeconds();
    const host = pi(P_CLK_SRC) == 1 && hostTempo() > 1.0 && hostPlaying != 0;
    if (host) {
      if (run) {
        let idx2 = i32(pn(P_ARP_RATE) * <f32>23.999); if (idx2 > 23) idx2 = 23;
        const q = <f64>divQ(idx2);
        const hi: i64 = i64(Math.floor(kPpqAcc / q));
        if (kHostIdx < 0) kHostIdx = hi;                 // first step lands on the next grid line
        else if (hi != kHostIdx) { kHostIdx = hi; ev = true; }
      } else kHostIdx = -1;
      kPhase = 0.0;
    } else {
      kHostIdx = -1;
      if (run) { kPhase += dt / kStepSec; if (kPhase >= 1.0) { kPhase -= 1.0; if (kPhase > 1.0) kPhase = 0.0; ev = true; } }
    }
  }
  return ev;
}

// ---- per-sample tick ------------------------------------------------------------------------------------
function keysTick(dt: f32): void {
  modeWatch();
  // external play / reset jacks
  const oo = patched(D_ONOFF_IN);
  if (oo) {
    const on = unchecked(S[unchecked(SEL[D_ONOFF_IN])]) > 2.5;
    if (on != kOnoffPrev) { kOnoffPrev = on; updateRun(false); }
  } else kOnoffPrev = false;
  if (patched(D_RESET_IN)) {
    const r = unchecked(S[unchecked(SEL[D_RESET_IN])]) > 2.5;
    if (r && !kResetPrev) { kArpPos = 0; kSeqPos = 0; kPulseCnt = 0; kPhase = 1.0; }
    kResetPrev = r;
  } else kResetPrev = false;

  if (clockTick(dt)) doStep(dt);
  if (kHostIdx == -1 && !(kRunArp || kRunSeq)) kPhase = 1.0;

  // gate-length timer
  if (kGateOffArm) { kGateOffT -= dt; if (kGateOffT <= 0.0) { kGateWant = false; kGateOffArm = false; } }
  // gate output with a 1 ms re-trigger gap
  if (kGateWant) {
    if (!kGateOut) { if (kLowT >= 0.001) { kGateOut = true; } else kLowT += dt; }
  } else { if (kGateOut) kLowT = 0.0; else if (kLowT < 1.0) kLowT += dt; kGateOut = false; }

  // accent envelope (fast attack, short release) — drives KB VEL OUT during sequencer playback
  if (kAccent > 0.0) { kAccent -= dt / <f32>0.12; if (kAccent < 0.0) kAccent = 0.0; }
  if (kStepFlash > 0.0) { kStepFlash -= dt * 12.0; if (kStepFlash < 0.0) kStepFlash = 0.0; }

  // glide
  const gx = pv(P_GLIDE);
  const diff = kTarget - kCur;
  if (gx < 0.01 || !kGlideOk || (pi(P_GL_GATED) != 0 && !kGateOut)) kCur = kTarget;
  else {
    const t: f32 = <f32>0.01 * Mathf.pow(<f32>600.0, clampf((gx - <f32>0.01) * <f32>1.0101, 0.0, 1.0));
    const ty = pi(P_GL_TYPE);
    if (ty == 0) { const st = <f32>12.0 * dt / t; kCur = absf(diff) <= st ? kTarget : kCur + (diff > 0.0 ? st : -st); }
    else if (ty == 1) { const st = kLctRate * dt; kCur = absf(diff) <= st ? kTarget : kCur + (diff > 0.0 ? st : -st); }
    else kCur += diff * (<f32>1.0 - Mathf.exp(-<f32>4.6 * dt / t));
  }

  // CLOCK OUT: pulse train at the output PPQN while the arp / sequencer runs
  if (kRunArp || kRunSeq) {
    const stepPer = patched(D_CLK_IN) ? kStepSec : kStepSec;
    const pps = f32(ppqnVal(pi(P_OUT_PPQN))) * <f32>0.5;          // pulses per step (a step is an eighth note)
    kClkOutPh += dt * pps / stepPer;
    if (kClkOutPh >= 1.0) kClkOutPh -= Mathf.floor(kClkOutPh);
    kClkOut = kClkOutPh < 0.5 ? <f32>5.0 : <f32>0.0;
  } else { kClkOutPh = 0.0; kClkOut = 0.0; }
}
