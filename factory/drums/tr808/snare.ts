// BRIDGEWELL SNARE — the 808 snare alone. Any MIDI note plays it.
const sd = new SD808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); sd.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  sd.level = params[P_LEV]; sd.tone = params[P_TONE]; sd.snappy = params[P_SNAP]; sd.tune = params[P_TUNE];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams(); sd.trigger(velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5)); hitFlash(0); }
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const y = driveStage(sd.tick(), drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
