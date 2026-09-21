// WAREHOUSE KICK — one voice of Warehouse 909 on its own mixer channel.
const v = new BD909();
function applyParams(): void {
  v.tune = params[P_TUNE]; v.level = params[P_LEV]; v.attack = params[P_ATT]; v.decay = params[P_DEC];
}
export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); resetNoise909(); v.init(); setDefaults(); }
export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight909(vel, params[P_AC], params[P_VELMODE] > 0.5);
  v.trigger(h); hitFlash(0);
}
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const y = driveStage(v.tick(), drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
