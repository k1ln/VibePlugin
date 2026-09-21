// SILVERBOX TOMS — low and high tom. GM 41/43/45 low, 47/48/50 high; any
// other note: C–F low, F♯–B high.
const lt = new Tom606(); const ht = new Tom606();
let gl0: f32 = 0.707; let gr0: f32 = 0.707; let gl1: f32 = 0.707; let gr1: f32 = 0.707;
function applyParams(): void {
  lt.level = params[P_LT_LEV]; lt.tune = params[P_LT_TUNE]; lt.decay = params[P_DEC];
  ht.level = params[P_HT_LEV]; ht.tune = params[P_HT_TUNE]; ht.decay = params[P_DEC];
  const w = clampf(params[P_WIDTH], 0.0, 1.0) * 0.45;
  gl0 = Mathf.sqrt(0.5 * (1.0 + w)); gr0 = Mathf.sqrt(0.5 * (1.0 - w)); gl1 = gr0; gr1 = gl0;
}
export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); lt.base = 142.0; ht.base = 212.0; lt.init(); ht.init(); setDefaults(); }
export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight606(vel, params[P_AC], params[P_VELMODE] > 0.5);
  let hi = id == 47 || id == 48 || id == 50;
  if (!(hi || id == 41 || id == 43 || id == 45)) hi = ((id % 12) + 12) % 12 >= 6;
  if (hi) { ht.trigger(h); hitFlash(1); } else { lt.trigger(h); hitFlash(0); }
}
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams(); const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const a: f32 = lt.active ? lt.tick() : 0.0; const b: f32 = ht.active ? ht.tick() : 0.0;
    const l = driveStage((a * gl0 + b * gl1) * 1.41, drive); const r = driveStage((a * gr0 + b * gr1) * 1.41, drive);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r); trackPeak(l); trackPeak(r);
  }
  finishDisplay(n);
}
