// =====================================================================
//  BRIDGEWELL 80 — the whole machine: 16 sounds on 11 instrument slots,
//  per-voice LEVEL/TONE/DECAY/SNAPPY/TUNING exactly as on the panel,
//  ACCENT, the five instrument-select switches (LT/LC, MT/MC, HT/HC,
//  RS/CL, CP/MA), MASTER VOLUME, TEMPO + FINE, and the step sequencer:
//  16 steps, PRE-SCALE 1–4 (3/6/4/8 steps per beat), last step 1–16,
//  BASIC VARIATION A / AB / B, and an accent row. Modern additions are
//  kept apart from the panel: stereo placement, output drive, the two
//  service trimmers (BD / SD tuning) and DAW-sync for the sequencer.
// =====================================================================

// Parameter indices P_* and NUM_PARAMS are generated from tr808/defs.mjs.
// Pattern rows are 12 consecutive params per variation, BD first.
const P_ROW_A: i32 = P_ROW_A_BD;
const P_ROW_B: i32 = P_ROW_B_BD;

// ---- voices ------------------------------------------------------------
const V_BD: i32 = 0; const V_SD: i32 = 1;
const V_LT: i32 = 2; const V_MT: i32 = 3; const V_HT: i32 = 4;
const V_LC: i32 = 5; const V_MC: i32 = 6; const V_HC: i32 = 7;
const V_RS: i32 = 8; const V_CL: i32 = 9; const V_CP: i32 = 10; const V_MA: i32 = 11;
const V_CB: i32 = 12; const V_CY: i32 = 13; const V_OH: i32 = 14; const V_CH: i32 = 15;
const NUM_VOICES: i32 = 16;

const bd = new BD808();
const sd = new SD808();
const lt = new Tom808(); const mt = new Tom808(); const ht = new Tom808();
const lc = new Tom808(); const mc = new Tom808(); const hc = new Tom808();
const rs = new RimClave808();
const cp = new ClapMaracas808();
const metal = new Metal808();
const cb = new Cowbell808();
const hats = new Hats808();
const clk = new StepClock();

// Stereo placement at full width (0 = the hardware's mono sum).
const PAN = new StaticArray<f32>(NUM_VOICES);
const gainL = new StaticArray<f32>(NUM_VOICES);
const gainR = new StaticArray<f32>(NUM_VOICES);
const flash = new StaticArray<f32>(12);     // step-light flashes per slot (display)
let peak: f32 = 0;
let lastRun: bool = false;
let clockSource: i32 = -1;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr);
  configureToms(lt, mt, ht, lc, mc, hc);
  bd.init(); sd.init(); lt.init(); mt.init(); ht.init(); lc.init(); mc.init(); hc.init();
  rs.init(); cp.init(); metal.init(); cb.init(); hats.init();
  const pan: StaticArray<f32> = [0.0, -0.08, -0.55, -0.15, 0.3, -0.45, 0.1, 0.45, 0.2, 0.25, -0.2, 0.35, 0.18, -0.4, 0.38, 0.3];
  for (let i = 0; i < NUM_VOICES; i++) PAN[i] = pan[i];
  setDefaults();
  clk.stop(); lastRun = false; clockSource = -1; peak = 0;
  display[0] = -1;
}

// ---- triggering ----------------------------------------------------------
function fire(v: i32, h: f32): void {
  if (v == V_BD) bd.trigger(h);
  else if (v == V_SD) sd.trigger(h);
  else if (v == V_LT) lt.trigger(h); else if (v == V_MT) mt.trigger(h); else if (v == V_HT) ht.trigger(h);
  else if (v == V_LC) lc.trigger(h); else if (v == V_MC) mc.trigger(h); else if (v == V_HC) hc.trigger(h);
  else if (v == V_RS) rs.trigger(h, false); else if (v == V_CL) rs.trigger(h, true);
  else if (v == V_CP) cp.trigger(h, false); else if (v == V_MA) cp.trigger(h, true);
  else if (v == V_CB) cb.trigger(h);
  else if (v == V_CY) hats.cyTrigger(h); else if (v == V_OH) hats.ohTrigger(h); else if (v == V_CH) hats.chTrigger(h);
}

// Instrument slot (sequencer row / panel column) → the voice it plays now.
function slotVoice(slot: i32): i32 {
  const sw = i32(params[P_SWITCH] + 0.5);
  if (slot == 0) return V_BD;
  if (slot == 1) return V_SD;
  if (slot == 2) return (sw & 1) != 0 ? V_LC : V_LT;
  if (slot == 3) return (sw & 2) != 0 ? V_MC : V_MT;
  if (slot == 4) return (sw & 4) != 0 ? V_HC : V_HT;
  if (slot == 5) return (sw & 8) != 0 ? V_CL : V_RS;
  if (slot == 6) return (sw & 16) != 0 ? V_MA : V_CP;
  if (slot == 7) return V_CB;
  if (slot == 8) return V_CY;
  if (slot == 9) return V_OH;
  return V_CH;
}
function voiceSlot(v: i32): i32 {
  if (v <= V_SD) return v;
  if (v == V_LT || v == V_LC) return 2;
  if (v == V_MT || v == V_MC) return 3;
  if (v == V_HT || v == V_HC) return 4;
  if (v == V_RS || v == V_CL) return 5;
  if (v == V_CP || v == V_MA) return 6;
  if (v == V_CB) return 7;
  if (v == V_CY) return 8;
  if (v == V_OH) return 9;
  return 10;
}

// General-MIDI drum map, extended with the 808's alternates.
function noteVoice(n: i32): i32 {
  if (n == 35 || n == 36) return V_BD;
  if (n == 38 || n == 40) return V_SD;
  if (n == 41 || n == 43) return V_LT;
  if (n == 45 || n == 47) return V_MT;
  if (n == 48 || n == 50) return V_HT;
  if (n == 64) return V_LC;
  if (n == 63) return V_MC;
  if (n == 62) return V_HC;
  if (n == 37) return V_RS;
  if (n == 75) return V_CL;
  if (n == 39) return V_CP;
  if (n == 70) return V_MA;
  if (n == 56) return V_CB;
  if (n == 49 || n == 57 || n == 51) return V_CY;
  if (n == 46) return V_OH;
  if (n == 42 || n == 44) return V_CH;
  return -1;
}

function velHeight(vel: f32): f32 { return velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5); }

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();                        // a note may arrive before this block's process()
  const v = noteVoice(id);
  if (v < 0) return;
  fire(v, velHeight(vel));
  flash[voiceSlot(v)] = 1.0;
}
export function noteOff(id: i32): void {}


// ---- parameters → voices ---------------------------------------------
function applyParams(): void {
  bd.level = params[P_BD_LEV]; bd.tone = params[P_BD_TONE]; bd.decay = params[P_BD_DEC]; bd.tune = params[P_BD_TRIM];
  sd.level = params[P_SD_LEV]; sd.tone = params[P_SD_TONE]; sd.snappy = params[P_SD_SNAP]; sd.tune = params[P_SD_TRIM];
  lt.level = params[P_LT_LEV]; lt.tuning = params[P_LT_TUNE]; lc.level = lt.level; lc.tuning = lt.tuning;
  mt.level = params[P_MT_LEV]; mt.tuning = params[P_MT_TUNE]; mc.level = mt.level; mc.tuning = mt.tuning;
  ht.level = params[P_HT_LEV]; ht.tuning = params[P_HT_TUNE]; hc.level = ht.level; hc.tuning = ht.tuning;
  rs.level = params[P_RS_LEV]; cp.level = params[P_CP_LEV]; cb.level = params[P_CB_LEV];
  hats.cyLevel = params[P_CY_LEV]; hats.cyTone = params[P_CY_TONE]; hats.cyDecay = params[P_CY_DEC];
  hats.ohLevel = params[P_OH_LEV]; hats.ohDecay = params[P_OH_DEC]; hats.chLevel = params[P_CH_LEV];
  const w = clampf(params[P_WIDTH], 0.0, 1.0);
  for (let i = 0; i < NUM_VOICES; i++) {
    const p = PAN[i] * w;                                   // equal-power pan
    gainL[i] = Mathf.sqrt(0.5 * (1.0 - p)); gainR[i] = Mathf.sqrt(0.5 * (1.0 + p));
  }
}

function internalBpm(): f32 {
  const click = clampf(params[P_TEMPO], 0.0, 39.0) + clampf(params[P_FINE], -1.0, 1.0) * 0.5;
  return 40.0 * Mathf.pow(7.5, click / 39.0);
}

function stepsPerBeat(): f32 {
  const s = i32(params[P_SCALE] + 0.5);
  if (s <= 1) return 3.0;          // 8th-note triplets
  if (s == 2) return 6.0;          // 16th-note triplets
  if (s == 3) return 4.0;          // 16ths
  return 8.0;                      // 32nds
}

// The sequencer, run once per block before the sample loop hands out steps.
function updateClock(): void {
  const src = i32(params[P_SOURCE] + 0.5);
  if (src != clockSource) { clockSource = src; clk.stop(); lastRun = false; }
  if (src == 1) {
    if (hostSeen && hostPlaying) {
      if (!clk.running) { clk.running = true; clk.lastStep = -1; }
      clk.ppq = hostPpq;
    } else if (clk.running) clk.stop();
  } else if (src == 2) {
    const run = params[P_RUN] > 0.5;
    if (run && !lastRun) clk.start();
    else if (!run && lastRun) clk.stop();
    lastRun = run;
  }
}

function playStep(): void {
  const len = i32(clampf(params[P_LAST], 1.0, 16.0) + 0.5);
  const abs = clk.absStep;
  const step = i32(abs % i64(len));
  const bar = i32(abs / i64(len));
  const vmode = i32(params[P_VAR] + 0.5);
  const useB = vmode == 2 || (vmode == 1 && (bar & 1) == 1);
  const base = useB ? P_ROW_B : P_ROW_A;
  const accent = stepOn(params[base + 11], step);
  const h = accent ? accentHeight(params[P_AC]) : V_NORMAL;
  for (let slot = 0; slot < 11; slot++) {
    if (stepOn(params[base + slot], step)) { fire(slotVoice(slot), h); flash[slot] = 1.0; }
  }
  if (accent) flash[11] = 1.0;
  display[0] = f32(step);
  display[1] = useB ? 1.0 : 0.0;
}

export function process(n: i32): void {
  applyParams();
  updateClock();
  const bpm = clockSource == 1 ? hostTempo() : internalBpm();
  const spb = stepsPerBeat();
  const master = taper(params[P_MASTER]) * 1.6;
  const drive = clampf(params[P_DRIVE], 0.0, 1.0);
  const metalOn = cb.active || hats.any();

  for (let f = 0; f < n; f++) {
    clk.tick(spb, bpm);
    if (clk.fired) playStep();

    let l: f32 = 0; let r: f32 = 0; let s: f32;
    s = bd.tick();  l += s * gainL[V_BD]; r += s * gainR[V_BD];
    s = sd.tick();  l += s * gainL[V_SD]; r += s * gainR[V_SD];
    if (lt.active) { s = lt.tick(); l += s * gainL[V_LT]; r += s * gainR[V_LT]; }
    if (mt.active) { s = mt.tick(); l += s * gainL[V_MT]; r += s * gainR[V_MT]; }
    if (ht.active) { s = ht.tick(); l += s * gainL[V_HT]; r += s * gainR[V_HT]; }
    if (lc.active) { s = lc.tick(); l += s * gainL[V_LC]; r += s * gainR[V_LC]; }
    if (mc.active) { s = mc.tick(); l += s * gainL[V_MC]; r += s * gainR[V_MC]; }
    if (hc.active) { s = hc.tick(); l += s * gainL[V_HC]; r += s * gainR[V_HC]; }
    if (rs.active) { const vi = rs.isClave ? V_CL : V_RS; s = rs.tick(); l += s * gainL[vi]; r += s * gainR[vi]; }
    if (cp.active) { const vi = cp.maracas ? V_MA : V_CP; s = cp.tick(); l += s * gainL[vi]; r += s * gainR[vi]; }
    if (metalOn || cb.active || hats.any()) {
      const m = metal.tick();
      if (cb.active) { s = cb.tick(metal); l += s * gainL[V_CB]; r += s * gainR[V_CB]; }
      if (hats.any()) {
        hats.tick(m);
        l += hats.cyOut * gainL[V_CY] + hats.ohOut * gainL[V_OH] + hats.chOut * gainL[V_CH];
        r += hats.cyOut * gainR[V_CY] + hats.ohOut * gainR[V_OH] + hats.chOut * gainR[V_CH];
      }
    } else metal.skip(1);

    l = driveStage(l * master, drive);
    r = driveStage(r * master, drive);
    unchecked(outBuf[f] = l);
    unchecked(outBuf[MAX_FRAMES + f] = r);
    const a = Mathf.max(Mathf.abs(l), Mathf.abs(r));
    if (a > peak) peak = a;
  }

  // Display: [0] step (-1 stopped), [1] variation B playing, [2] running,
  // [3..14] slot flashes (BD SD LT MT HT RS CP CB CY OH CH AC), [15] peak.
  if (!clk.running) display[0] = -1;
  display[2] = clk.running ? 1.0 : 0.0;
  const fall = Mathf.exp(-f32(n) * invSR / 0.09);
  for (let i = 0; i < 12; i++) { display[3 + i] = flash[i]; flash[i] *= fall; }
  display[15] = peak;
  peak *= Mathf.exp(-f32(n) * invSR / 0.25);
}

