// WAREHOUSE TOMS — the three toms. GM 41/43 · 45/47 · 48/50; any other note
// by pitch class: C–D♯ low, E–G mid, G♯–B high.
const lt = new Tom909(); const mt = new Tom909(); const ht = new Tom909();
const PAN3: StaticArray<f32> = [-0.45, 0.0, 0.45];
const gl: StaticArray<f32> = [0.707, 0.707, 0.707];
const gr: StaticArray<f32> = [0.707, 0.707, 0.707];
function applyParams(): void {
  lt.tune = params[P_LT_TUNE]; lt.level = params[P_LT_LEV]; lt.decay = params[P_LT_DEC];
  mt.tune = params[P_MT_TUNE]; mt.level = params[P_MT_LEV]; mt.decay = params[P_MT_DEC];
  ht.tune = params[P_HT_TUNE]; ht.level = params[P_HT_LEV]; ht.decay = params[P_HT_DEC];
  const w = clampf(params[P_WIDTH], 0.0, 1.0);
  for (let i = 0; i < 3; i++) { const p = PAN3[i] * w; gl[i] = Mathf.sqrt(0.5 * (1.0 - p)); gr[i] = Mathf.sqrt(0.5 * (1.0 + p)); }
}
export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); resetNoise909(); configureToms909(lt, mt, ht); lt.init(); mt.init(); ht.init(); setDefaults();
}
export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight909(vel, params[P_AC], params[P_VELMODE] > 0.5);
  let slot = -1;
  if (id == 41 || id == 43) slot = 0; else if (id == 45 || id == 47) slot = 1; else if (id == 48 || id == 50) slot = 2;
  else { const pc = ((id % 12) + 12) % 12; slot = pc < 4 ? 0 : (pc < 8 ? 1 : 2); }
  if (slot == 0) lt.trigger(h); else if (slot == 1) mt.trigger(h); else ht.trigger(h);
  hitFlash(slot);
}
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const a = lt.active ? lt.tick() : 0.0, b = mt.active ? mt.tick() : 0.0, c = ht.active ? ht.tick() : 0.0;
    const l = driveStage((a * gl[0] + b * gl[1] + c * gl[2]) * 1.41, drive);
    const r = driveStage((a * gr[0] + b * gr[1] + c * gr[2]) * 1.41, drive);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r); trackPeak(l); trackPeak(r);
  }
  finishDisplay(n);
}
