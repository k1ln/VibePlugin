// SILVERBOX HATS — open and closed hat together (closed cuts open). The
// stock open hat has no decay knob: its length follows the tempo — the
// DAW's when FOLLOW is on, otherwise the Tempo knob. 42/44 closed, 46 open;
// other notes: C–F closed, F♯–B open.
const metal = new Metal606(); const mx = new Metals606();
function applyParams(): void {
  mx.hhLevel = params[P_LEV]; mx.ohDecay = params[P_OH_DEC];
  const bpm = params[P_FOLLOW] > 0.5 ? hostTempo() : clampf(params[P_TEMPO], 40.0, 300.0);
  mx.stepSec = 60.0 / (bpm * 4.0);
}
export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); metal.init(); mx.init(); setDefaults(); }
export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const h = velToHeight606(vel, params[P_AC], params[P_VELMODE] > 0.5);
  let open = id == 46;
  if (id != 42 && id != 44 && id != 46) open = ((id % 12) + 12) % 12 >= 6;
  if (open) { mx.ohTrigger(h); hitFlash(1); } else { mx.chTrigger(h); hitFlash(0); }
}
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams(); const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    let y: f32 = 0;
    if (mx.any()) { metal.tick(); mx.tick(metal); y = mx.ohOut + mx.chOut; } else metal.skip(1);
    y = driveStage(y, drive); unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
