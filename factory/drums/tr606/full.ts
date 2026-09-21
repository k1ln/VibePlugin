// =====================================================================
//  SILVERBOX 606 — the whole battery box: bass drum, snare, low and high
//  tom, cymbal, open and closed hi-hat; ACCENT and the six instrument-mix
//  levels, VOLUME, TEMPO; sequencer with SCALE 1–4, last step and an accent
//  row. The open hat's length follows the tempo, as on the hardware. The
//  "Mod" knobs are the classic hardware mods (decay, tune, snappy): leave
//  them fully left for the stock circuit.
// =====================================================================
const V_BD: i32 = 0; const V_SD: i32 = 1; const V_LT: i32 = 2; const V_HT: i32 = 3; const V_CY: i32 = 4; const V_OH: i32 = 5; const V_CH: i32 = 6;
const bd = new BD606(); const sd = new SD606(); const lt = new Tom606(); const ht = new Tom606();
const metal = new Metal606(); const mx = new Metals606(); const clk = new StepClock();
const PAN: StaticArray<f32> = [0.0, -0.05, -0.45, 0.4, -0.35, 0.35, 0.3];
const gL = new StaticArray<f32>(7); const gR = new StaticArray<f32>(7);
let lastRun: bool = false; let clockSource: i32 = -1;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); lt.base = 142.0; ht.base = 212.0;
  bd.init(); sd.init(); lt.init(); ht.init(); metal.init(); mx.init();
  setDefaults(); clk.stop(); lastRun = false; clockSource = -1; display[0] = -1;
}
function applyParams(): void {
  bd.level = params[P_BD_LEV]; bd.decay = params[P_BD_DEC]; bd.tune = params[P_BD_TUNE];
  sd.level = params[P_SD_LEV]; sd.tune = params[P_SD_TUNE]; sd.snappy = params[P_SD_SNAP];
  lt.level = params[P_LT_LEV]; lt.tune = params[P_LT_TUNE]; lt.decay = params[P_TOM_DEC];
  ht.level = params[P_HT_LEV]; ht.tune = params[P_HT_TUNE]; ht.decay = params[P_TOM_DEC];
  mx.cyLevel = params[P_CY_LEV]; mx.hhLevel = params[P_HH_LEV]; mx.cyDecay = params[P_CY_DEC]; mx.ohDecay = params[P_OH_DEC];
  const w = clampf(params[P_WIDTH], 0.0, 1.0);
  for (let i = 0; i < 7; i++) { const p = PAN[i] * w; gL[i] = Mathf.sqrt(0.5 * (1.0 - p)); gR[i] = Mathf.sqrt(0.5 * (1.0 + p)); }
}
function fire(v: i32, h: f32): void {
  if (v == V_BD) bd.trigger(h); else if (v == V_SD) sd.trigger(h); else if (v == V_LT) lt.trigger(h); else if (v == V_HT) ht.trigger(h);
  else if (v == V_CY) mx.cyTrigger(h); else if (v == V_OH) mx.ohTrigger(h); else if (v == V_CH) mx.chTrigger(h);
  hitFlash(v);
}
function noteVoice(n: i32): i32 {
  if (n == 35 || n == 36) return V_BD; if (n == 38 || n == 40) return V_SD;
  if (n == 41 || n == 43 || n == 45) return V_LT; if (n == 47 || n == 48 || n == 50) return V_HT;
  if (n == 49 || n == 57 || n == 51) return V_CY; if (n == 46) return V_OH; if (n == 42 || n == 44) return V_CH;
  return -1;
}
function bpmNow(): f32 { return clockSource == 1 ? hostTempo() : clampf(params[P_TEMPO], 40.0, 300.0); }
function spb(): f32 { const s = i32(params[P_SCALE] + 0.5); return s <= 1 ? 3.0 : (s == 2 ? 6.0 : (s == 3 ? 4.0 : 8.0)); }
export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams(); mx.stepSec = 60.0 / (bpmNow() * spb());
  const v = noteVoice(id); if (v >= 0) fire(v, velToHeight606(vel, params[P_AC], params[P_VELMODE] > 0.5));
}
export function noteOff(id: i32): void {}
function updateClock(): void {
  const src = i32(params[P_SOURCE] + 0.5);
  if (src != clockSource) { clockSource = src; clk.stop(); lastRun = false; }
  if (src == 1) { if (hostSeen && hostPlaying) { if (!clk.running) { clk.running = true; clk.lastStep = -1; } clk.ppq = hostPpq; } else if (clk.running) clk.stop(); }
  else if (src == 2) { const run = params[P_RUN] > 0.5; if (run && !lastRun) clk.start(); else if (!run && lastRun) clk.stop(); lastRun = run; }
}
function playStep(): void {
  const len = i32(clampf(params[P_LAST], 1.0, 16.0) + 0.5);
  const step = i32(clk.absStep % i64(len));
  const h = stepOn(params[P_ROW_AC], step) ? accent606(params[P_AC]) : V606;
  for (let v = 0; v < 7; v++) if (stepOn(params[P_ROW_BD + v], step)) fire(v, h);
  display[0] = f32(step);
}
export function process(n: i32): void {
  applyParams(); updateClock();
  const bpm = bpmNow(); const s = spb(); mx.stepSec = 60.0 / (bpm * s);
  const vol = taper(params[P_VOLUME]) * 1.5; const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    clk.tick(s, bpm); if (clk.fired) playStep();
    let l: f32 = 0; let r: f32 = 0; let x: f32;
    x = bd.tick(); l += x * gL[0]; r += x * gR[0];
    x = sd.tick(); l += x * gL[1]; r += x * gR[1];
    if (lt.active) { x = lt.tick(); l += x * gL[2]; r += x * gR[2]; }
    if (ht.active) { x = ht.tick(); l += x * gL[3]; r += x * gR[3]; }
    if (mx.any()) { metal.tick(); mx.tick(metal);
      l += mx.cyOut * gL[4] + mx.ohOut * gL[5] + mx.chOut * gL[6]; r += mx.cyOut * gR[4] + mx.ohOut * gR[5] + mx.chOut * gR[6];
    } else metal.skip(1);
    l = driveStage(l * vol, drive); r = driveStage(r * vol, drive);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r); trackPeak(l); trackPeak(r);
  }
  if (!clk.running) display[0] = -1;
  display[2] = clk.running ? 1.0 : 0.0;
  finishDisplay(n);
}
