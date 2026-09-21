// =====================================================================
//  WAREHOUSE 909 — the whole machine: BD (tune/level/attack/decay), SD
//  (tune/level/tone/snappy), three toms (tune/level/decay), rim shot, hand
//  clap, hi-hat (level, closed decay, open decay), crash and ride (level,
//  tune), TOTAL ACCENT and VOLUME — and the sequencer as the manual has it:
//  four scales (16ths, 8th triplets, 32nds, 16th triplets), last step 1–16,
//  SHUFFLE 1–7 (four settings in triplet scale), FLAM with eight intervals
//  on BD/SD/toms, a total-accent row plus per-instrument accent on BD, SD,
//  the toms and closed hat. Locked to the DAW or free-running (37–290 bpm).
// =====================================================================
// P_* and NUM_PARAMS are generated from tr909/defs.mjs.

const V_BD: i32 = 0; const V_SD: i32 = 1; const V_LT: i32 = 2; const V_MT: i32 = 3; const V_HT: i32 = 4;
const V_RS: i32 = 5; const V_HC: i32 = 6; const V_CH: i32 = 7; const V_OH: i32 = 8; const V_CR: i32 = 9; const V_RD: i32 = 10;
const NV: i32 = 11;

const bd = new BD909(); const sd = new SD909();
const lt = new Tom909(); const mt = new Tom909(); const ht = new Tom909();
const rs = new Rim909(); const hc = new Clap909();
const hh = new Hats909(); const cr = new Cymbal909(); const rd = new Cymbal909();
const clk = new StepClock();

const PAN = new StaticArray<f32>(NV);
const gL = new StaticArray<f32>(NV); const gR = new StaticArray<f32>(NV);

// Pending hits (shuffled off-beats, flam second strikes): countdown in samples.
const Q = 64;
const qWait = new StaticArray<i32>(Q); const qVoice = new StaticArray<i32>(Q); const qH = new StaticArray<f32>(Q);
let qN: i32 = 0;
function schedule(wait: i32, v: i32, h: f32): void {
  if (wait <= 0) { fire(v, h); return; }
  if (qN >= Q) return;
  qWait[qN] = wait; qVoice[qN] = v; qH[qN] = h; qN++;
}
function runQueue(): void {
  let i = 0;
  while (i < qN) {
    qWait[i]--;
    if (qWait[i] <= 0) {
      fire(qVoice[i], qH[i]);
      qN--; qWait[i] = qWait[qN]; qVoice[i] = qVoice[qN]; qH[i] = qH[qN];
    } else i++;
  }
}

let lastRun: bool = false; let clockSource: i32 = -1;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); resetNoise909();
  configureToms909(lt, mt, ht); rd.isRide = true;
  bd.init(); sd.init(); lt.init(); mt.init(); ht.init(); rs.init(); hc.init(); hh.init(); cr.init(); rd.init();
  const pan: StaticArray<f32> = [0.0, -0.06, -0.5, -0.12, 0.35, 0.22, -0.2, 0.3, 0.38, -0.4, 0.42];
  for (let i = 0; i < NV; i++) PAN[i] = pan[i];
  setDefaults();
  clk.stop(); qN = 0; lastRun = false; clockSource = -1; display[0] = -1;
}

function fire(v: i32, h: f32): void {
  if (v == V_BD) bd.trigger(h); else if (v == V_SD) sd.trigger(h);
  else if (v == V_LT) lt.trigger(h); else if (v == V_MT) mt.trigger(h); else if (v == V_HT) ht.trigger(h);
  else if (v == V_RS) rs.trigger(h); else if (v == V_HC) hc.trigger(h);
  else if (v == V_CH) hh.trigger(h, false); else if (v == V_OH) hh.trigger(h, true);
  else if (v == V_CR) cr.trigger(h); else if (v == V_RD) rd.trigger(h);
  hitFlash(v);
}

// The manual's MIDI map (35–51).
function noteVoice(n: i32): i32 {
  if (n == 35 || n == 36) return V_BD;
  if (n == 38 || n == 40) return V_SD;
  if (n == 41 || n == 43) return V_LT;
  if (n == 45 || n == 47) return V_MT;
  if (n == 48 || n == 50) return V_HT;
  if (n == 37) return V_RS;
  if (n == 39) return V_HC;
  if (n == 42 || n == 44) return V_CH;
  if (n == 46) return V_OH;
  if (n == 49 || n == 57) return V_CR;
  if (n == 51 || n == 59) return V_RD;
  return -1;
}

function applyParams(): void {
  bd.tune = params[P_BD_TUNE]; bd.level = params[P_BD_LEV]; bd.attack = params[P_BD_ATT]; bd.decay = params[P_BD_DEC];
  sd.tune = params[P_SD_TUNE]; sd.level = params[P_SD_LEV]; sd.tone = params[P_SD_TONE]; sd.snappy = params[P_SD_SNAP];
  lt.tune = params[P_LT_TUNE]; lt.level = params[P_LT_LEV]; lt.decay = params[P_LT_DEC];
  mt.tune = params[P_MT_TUNE]; mt.level = params[P_MT_LEV]; mt.decay = params[P_MT_DEC];
  ht.tune = params[P_HT_TUNE]; ht.level = params[P_HT_LEV]; ht.decay = params[P_HT_DEC];
  rs.level = params[P_RS_LEV]; hc.level = params[P_HC_LEV];
  hh.level = params[P_HH_LEV]; hh.chDecay = params[P_CH_DEC]; hh.ohDecay = params[P_OH_DEC];
  cr.level = params[P_CR_LEV]; cr.tune = params[P_CR_TUNE]; rd.level = params[P_RD_LEV]; rd.tune = params[P_RD_TUNE];
  const w = clampf(params[P_WIDTH], 0.0, 1.0);
  for (let i = 0; i < NV; i++) { const p = PAN[i] * w; gL[i] = Mathf.sqrt(0.5 * (1.0 - p)); gR[i] = Mathf.sqrt(0.5 * (1.0 + p)); }
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const v = noteVoice(id);
  if (v >= 0) fire(v, velToHeight909(vel, params[P_TOTAL_AC], params[P_VELMODE] > 0.5));
}
export function noteOff(id: i32): void {}

function stepsPerBeat(): f32 {
  const s = i32(params[P_SCALE] + 0.5);
  return s == 1 ? 3.0 : (s == 2 ? 8.0 : (s == 3 ? 6.0 : 4.0));
}
// Shuffle as a fraction of one step for the off-beat (even-numbered) steps.
// 16ths: 1 = straight … 7 = heaviest (2/24 of a step per click, the 909's 96-ppq
// resolution). 8th triplets: 1=2, 3=4, 5=6 and 7 (manual p.26). Others: none.
function shuffleFrac(): f32 {
  const s = i32(params[P_SCALE] + 0.5);
  const k = i32(params[P_SHUFFLE] + 0.5) - 1;
  if (s == 0) return f32(k) / 12.0;
  if (s == 1) return f32(k & ~1) / 12.0;
  return 0.0;
}

function updateClock(): void {
  const src = i32(params[P_SOURCE] + 0.5);
  if (src != clockSource) { clockSource = src; clk.stop(); lastRun = false; qN = 0; }
  if (src == 1) {
    if (hostSeen && hostPlaying) { if (!clk.running) { clk.running = true; clk.lastStep = -1; } clk.ppq = hostPpq; }
    else if (clk.running) clk.stop();
  } else if (src == 2) {
    const run = params[P_RUN] > 0.5;
    if (run && !lastRun) clk.start(); else if (!run && lastRun) clk.stop();
    lastRun = run;
  }
}

function playStep(stepSamples: f32): void {
  const len = i32(clampf(params[P_LAST], 1.0, 16.0) + 0.5);
  const step = i32(clk.absStep % i64(len));
  const total = stepOn(params[P_TA], step);
  const totalAdd: f32 = total ? totalAccentAdd(params[P_TOTAL_AC]) : 0.0;
  const delay = (step & 1) == 1 ? i32(shuffleFrac() * stepSamples) : 0;
  const flamGap = msToSamples(4.0 + (clampf(params[P_FLAM], 1.0, 8.0) - 1.0) * 3.5);
  for (let v = 0; v < NV; v++) {
    if (!stepOn(params[P_TRIG_BD + v], step)) continue;
    let h = N909 + totalAdd;
    const ai = v <= V_HT ? v : (v == V_CH ? 5 : -1);            // BD SD LT MT HT … CH
    if (ai >= 0 && stepOn(params[P_ACC_BD + ai], step)) h += LOCAL_ACC;
    if (v <= V_HT && stepOn(params[P_FLAM_BD + v], step)) {
      schedule(delay, v, h * 0.6);                             // grace note on the step…
      schedule(delay + flamGap, v, h);                         // …the main strike after the interval
    } else schedule(delay, v, h);
  }
  display[0] = f32(step);
}

export function process(n: i32): void {
  applyParams();
  updateClock();
  const bpm = clockSource == 1 ? hostTempo() : clampf(params[P_TEMPO], 37.0, 290.0);
  const spb = stepsPerBeat();
  const stepSamples = SR * 60.0 / (bpm * spb);
  const vol = taper(params[P_VOLUME]) * 1.5;
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    clk.tick(spb, bpm);
    if (clk.fired) playStep(stepSamples);
    if (qN > 0) runQueue();
    let l: f32 = 0; let r: f32 = 0; let s: f32;
    s = bd.tick(); l += s * gL[V_BD]; r += s * gR[V_BD];
    s = sd.tick(); l += s * gL[V_SD]; r += s * gR[V_SD];
    if (lt.active) { s = lt.tick(); l += s * gL[V_LT]; r += s * gR[V_LT]; }
    if (mt.active) { s = mt.tick(); l += s * gL[V_MT]; r += s * gR[V_MT]; }
    if (ht.active) { s = ht.tick(); l += s * gL[V_HT]; r += s * gR[V_HT]; }
    if (rs.active) { s = rs.tick(); l += s * gL[V_RS]; r += s * gR[V_RS]; }
    if (hc.active) { s = hc.tick(); l += s * gL[V_HC]; r += s * gR[V_HC]; }
    if (hh.active) { const vi = hh.isOpen ? V_OH : V_CH; s = hh.tick(); l += s * gL[vi]; r += s * gR[vi]; }
    if (cr.active) { s = cr.tick(); l += s * gL[V_CR]; r += s * gR[V_CR]; }
    if (rd.active) { s = rd.tick(); l += s * gL[V_RD]; r += s * gR[V_RD]; }
    l = driveStage(l * vol, drive); r = driveStage(r * vol, drive);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r);
    trackPeak(l); trackPeak(r);
  }
  if (!clk.running) display[0] = -1;
  display[2] = clk.running ? 1.0 : 0.0;
  finishDisplay(n);
}
