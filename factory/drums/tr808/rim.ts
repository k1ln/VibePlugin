// BRIDGEWELL RIM & CLAVES — note 37 plays the rim shot, 75 the claves, any
// other note plays whichever the switch selects.
const rs = new RimClave808();

export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); rs.init(); setDefaults(); }
// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  rs.level = params[P_LEV];
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5);
  const clave = id == 75 ? true : (id == 37 ? false : params[P_SWITCH] > 0.5);
  rs.trigger(h, clave); hitFlash(clave ? 1 : 0);
}
export function noteOff(id: i32): void {}

export function process(n: i32): void {
  applyParams();
  const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    const y = driveStage(rs.active ? rs.tick() : 0.0, drive);
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
