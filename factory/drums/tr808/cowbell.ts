// BRIDGEWELL COWBELL — the two free-running squares through their band-pass.
const metal = new Metal808();
const cb = new Cowbell808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); metal.init(); cb.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  cb.level = params[P_LEV];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams(); cb.trigger(velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5)); hitFlash(0); }
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    let y: f32 = 0;
    if (cb.active) { metal.tick(); y = cb.tick(metal); } else metal.skip(1);
    y = driveStage(y, drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
