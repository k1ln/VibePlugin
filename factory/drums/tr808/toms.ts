// BRIDGEWELL TOMS — the three tom/conga slots, each switchable as on the
// panel. Notes: GM toms 41/43 · 45/47 · 48/50 and congas 64 · 63 · 62 play
// those drums directly; any other note picks a slot by pitch class
// (C–D♯ low, E–G mid, G♯–B high) and plays it as the switch says.
const lt = new Tom808(); const mt = new Tom808(); const ht = new Tom808();
const lc = new Tom808(); const mc = new Tom808(); const hc = new Tom808();
const PAN3: StaticArray<f32> = [-0.45, 0.0, 0.45];
let gl: StaticArray<f32> = [0.707, 0.707, 0.707];
let gr: StaticArray<f32> = [0.707, 0.707, 0.707];

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); configureToms(lt, mt, ht, lc, mc, hc);
  lt.init(); mt.init(); ht.init(); lc.init(); mc.init(); hc.init(); setDefaults();
}
function playSlot(slot: i32, conga: bool, h: f32): void {
  if (slot == 0) { if (conga) lc.trigger(h); else lt.trigger(h); }
  else if (slot == 1) { if (conga) mc.trigger(h); else mt.trigger(h); }
  else { if (conga) hc.trigger(h); else ht.trigger(h); }
  hitFlash(slot);
}
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  lt.level = params[P_LT_LEV]; lt.tuning = params[P_LT_TUNE]; lc.level = lt.level; lc.tuning = lt.tuning;
  mt.level = params[P_MT_LEV]; mt.tuning = params[P_MT_TUNE]; mc.level = mt.level; mc.tuning = mt.tuning;
  ht.level = params[P_HT_LEV]; ht.tuning = params[P_HT_TUNE]; hc.level = ht.level; hc.tuning = ht.tuning;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5);
  const sw = i32(params[P_SWITCH] + 0.5);
  if (id == 41 || id == 43) playSlot(0, false, h);
  else if (id == 45 || id == 47) playSlot(1, false, h);
  else if (id == 48 || id == 50) playSlot(2, false, h);
  else if (id == 64) playSlot(0, true, h);
  else if (id == 63) playSlot(1, true, h);
  else if (id == 62) playSlot(2, true, h);
  else {
    const pc = ((id % 12) + 12) % 12;
    const slot = pc < 4 ? 0 : (pc < 8 ? 1 : 2);
    playSlot(slot, ((sw >> slot) & 1) != 0, h);
  }
}
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const w = clampf(params[P_WIDTH], 0.0, 1.0);
  for (let i = 0; i < 3; i++) { const p = PAN3[i] * w; gl[i] = Mathf.sqrt(0.5 * (1.0 - p)); gr[i] = Mathf.sqrt(0.5 * (1.0 + p)); }
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    let l: f32 = 0; let r: f32 = 0;
    const s0 = (lt.active ? lt.tick() : 0.0) + (lc.active ? lc.tick() : 0.0);
    const s1 = (mt.active ? mt.tick() : 0.0) + (mc.active ? mc.tick() : 0.0);
    const s2 = (ht.active ? ht.tick() : 0.0) + (hc.active ? hc.tick() : 0.0);
    l = s0 * gl[0] + s1 * gl[1] + s2 * gl[2]; r = s0 * gr[0] + s1 * gr[1] + s2 * gr[2];
    l = driveStage(l * 1.41, drive); r = driveStage(r * 1.41, drive);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r); trackPeak(l); trackPeak(r);
  }
  finishDisplay(n);
}
