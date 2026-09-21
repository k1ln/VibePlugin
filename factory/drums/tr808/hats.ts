// BRIDGEWELL HATS — open and closed hi-hat together, because a closed hat
// cuts a ringing open hat short (Q23) and that only works in one plugin.
// Notes: 42/44 closed, 46 open; any other note: C–F closed, F♯–B open.
const metal = new Metal808();
const hats = new Hats808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); metal.init(); hats.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  hats.ohLevel = params[P_OH_LEV]; hats.ohDecay = params[P_OH_DEC]; hats.chLevel = params[P_CH_LEV];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5);
  let open = id == 46;
  if (id != 42 && id != 44 && id != 46) open = ((id % 12) + 12) % 12 >= 6;
  if (open) { hats.ohTrigger(h); hitFlash(1); } else { hats.chTrigger(h); hitFlash(0); }
}
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    let y: f32 = 0;
    if (hats.any()) { hats.tick(metal.tick()); y = hats.ohOut + hats.chOut; } else metal.skip(1);
    y = driveStage(y, drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
