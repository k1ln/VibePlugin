// BRIDGEWELL KICK — the 808 bass drum alone, for its own mixer channel.
// Same circuit model as inside Bridgewell 80; any MIDI note plays it.
const bd = new BD808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); bd.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  bd.level = params[P_LEV]; bd.tone = params[P_TONE]; bd.decay = params[P_DEC]; bd.tune = params[P_TUNE];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams(); bd.trigger(velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5)); hitFlash(0); }
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const y = driveStage(bd.tick(), drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
