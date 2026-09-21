// SILVERBOX CYMBAL — both metal bands, two VCAs on one envelope.
const metal = new Metal606(); const mx = new Metals606();
function applyParams(): void { mx.cyLevel = params[P_LEV]; mx.cyDecay = params[P_DEC]; }
export function init(sr: f32, maxFrames: i32, numChannels: i32): void { commonInit(sr); metal.init(); mx.init(); setDefaults(); }
export function noteOn(id: i32, hz: f32, vel: f32): void { applyParams(); mx.cyTrigger(velToHeight606(vel, params[P_AC], params[P_VELMODE] > 0.5)); hitFlash(0); }
export function noteOff(id: i32): void {}
export function process(n: i32): void {
  applyParams(); const drive = params[P_DRIVE];
  for (let f = 0; f < n; f++) {
    let y: f32 = 0;
    if (mx.any()) { metal.tick(); mx.tick(metal); y = mx.cyOut; } else metal.skip(1);
    y = driveStage(y, drive); unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
