// BRIDGEWELL CLAP & MARACAS — note 39 plays the clap, 70 the maracas, any
// other note plays whichever the switch selects.
const cp = new ClapMaracas808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); cp.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  cp.level = params[P_LEV];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5);
  const ma = id == 70 ? true : (id == 39 ? false : params[P_SWITCH] > 0.5);
  cp.trigger(h, ma); hitFlash(ma ? 1 : 0);
}
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const y = driveStage(cp.active ? cp.tick() : 0.0, drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
