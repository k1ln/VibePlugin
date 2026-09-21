// SILVERBOX SNARE — the 606 snare on its own channel. Any note plays it.
const v = new SD606();
function applyParams(): void { v.level = params[P_LEV]; v.tune = params[P_TUNE]; v.snappy = params[P_SNAP]; }
export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); v.init(); setDefaults(); }
export function noteOn(id: i32, hz: f32, vel: f32): void { applyParams(); v.trigger(velToHeight606(vel, params[P_AC], params[P_VELMODE] > 0.5)); hitFlash(0); }
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams(); const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) { const y = driveStage(v.tick(), drive); unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y); }
  finishDisplay(n);
}
