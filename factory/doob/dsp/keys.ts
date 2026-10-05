// =====================================================================
//  keys.ts — the 44-key keyboard (F … C), its sample-and-hold pitch CV and the glide.
//
//  The hardware: a constant-current source feeds a string of 43 × 10 Ω 1 % resistors, so each key
//  taps ~84 mV (1 V/oct) above the bottom F (0 V). The lowest key held wins (reissue: HIGH / LAST
//  too). A sample-and-hold keeps the pitch after the last key is released (so the release tail sounds
//  at the last pitch); GLIDE is the S/H capacitor charging through a 5 MΩ audio pot — an exponential
//  approach in pitch. The trigger bus is high while ANY key is down: overlapped keys do not
//  re-trigger the contours (single trigger); the reissue's MULTI mode does.
// =====================================================================

const HMAX: i32 = 64;
const hId = new StaticArray<i32>(HMAX);
const hKey = new StaticArray<i32>(HMAX);           // key index: 0 = bottom F (MIDI 41)
let hN: i32 = 0;

let kTarget: f32 = 0.0;           // pitch the S/H follows (semitones above the bottom F)
let kCur: f32 = 0.0;              // glided pitch
let kHeldKey: i32 = -1000;        // key currently selected
let kGateWant: bool = false;
let kGateOut: bool = false;
let kLowT: f32 = 1.0;
let glideTau: f32 = 0.0;          // seconds (0 = no glide)

function hFind(id: i32): i32 { for (let i = 0; i < hN; i++) if (hId[i] == id) return i; return -1; }
function hRemoveAt(i: i32): void {
  for (let j = i; j < hN - 1; j++) { hId[j] = hId[j + 1]; hKey[j] = hKey[j + 1]; }
  hN--;
}

// key index → pitch in semitones above the bottom F, through the selected scale (+ vintage resistor error)
function keyPitch(idx: i32): f32 {
  const sc = pi(P_SCALE);
  let st: f32 = f32(idx);
  if (sc == 1 || sc == 2) {
    const m = 41 + idx;                                       // MIDI note of this key
    const pc = ((m % 12) + 12) % 12;
    st += unchecked(SCALE_DEV[(sc - 1) * 12 + pc]);
  } else if (sc == 3) {
    const oct = idx >= 0 ? idx / 43 : -((-idx + 42) / 43);
    const r = idx - oct * 43;
    st = f32(oct * 12) + unchecked(PARTCH[r]);
  }
  if (pi(P_KEY_ERR) != 0 && idx >= 0 && idx < 44) st += unchecked(KEYERR[idx]);
  return st;
}

function keyboardUpdate(newKey: bool): void {
  if (hN == 0 || pi(P_LOCAL) == 0) { kGateWant = false; return; }
  const pri = pi(P_KEY_PRI);
  let best: i32 = 0;
  for (let i = 1; i < hN; i++) {
    if (pri == 0) { if (hKey[i] < hKey[best]) best = i; }
    else if (pri == 1) { if (hKey[i] > hKey[best]) best = i; }
    else best = i;                                            // LAST
  }
  const k = hKey[best];
  const wasHigh = kGateWant || kGateOut;
  if (k != kHeldKey) {
    kHeldKey = k;
    kTarget = keyPitch(k);
    if (glideTau <= 0.0 || pi(P_GLIDE_ON) == 0) kCur = kTarget;
  }
  // multi-trigger: ANY new key while the gate is high drops the gate for a moment (even if the lower key keeps the pitch)
  if (newKey && wasHigh && pi(P_TRIG_MODE) == 1) { kGateOut = false; kLowT = 0.0; }
  kGateWant = true;
}

function keyOn(id: i32, key: i32): void {
  const f = hFind(id);
  if (f >= 0) hRemoveAt(f);
  if (hN >= HMAX) hRemoveAt(0);
  hId[hN] = id; hKey[hN] = key; hN++;
  keyboardUpdate(true);
}
function keyOff(id: i32): void {
  const f = hFind(id);
  if (f < 0) return;
  hRemoveAt(f);
  keyboardUpdate(false);
}
function allNotesOff(): void { hN = 0; kGateWant = false; }

function keysTick(dt: f32): void {
  if (kGateWant) {
    if (!kGateOut) { if (kLowT >= 0.0015) kGateOut = true; else kLowT += dt; }
  } else { if (kGateOut) kLowT = 0.0; else if (kLowT < 1.0) kLowT += dt; kGateOut = false; }
  const diff = kTarget - kCur;
  if (pi(P_GLIDE_ON) == 0 || glideTau <= 0.0) kCur = kTarget;
  else kCur += diff * (<f32>1.0 - Mathf.exp(-dt / glideTau));
}
