// =====================================================================
//  BRIDGEWELL BASS — the 808 bass drum played as a pitched instrument, the
//  way hip-hop and trap use it: the same bridged-T circuit (attack octave
//  jump, amplitude-dependent pitch sigh, beater click, passive tone filter)
//  tuned to the note you play, with a stretched decay, note-off release,
//  glide between notes, octave shift, pitch bend and a drive stage.
//
//  Monophonic, last-note priority. GLIDE MODE: always slides from the
//  previous pitch, or only when notes overlap (legato — the ring carries on
//  and just bends to the new note, no retrigger).
// =====================================================================
const bd = new BD808();
const stack = new StaticArray<i32>(16);
const stackHz = new StaticArray<f32>(16);
let depth: i32 = 0;
let curLog: f32 = 0;        // log2(Hz) the resonator is at
let targetLog: f32 = 0;
let bend: f32 = 0; let bendSm: f32 = 0;
let sounding: bool = false;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); bd.init(); setDefaults();
  depth = 0; bend = 0; bendSm = 0; sounding = false;
  curLog = Mathf.log2(55.0); targetLog = curLog;
}

function pushNote(id: i32, hz: f32): void {
  for (let i = 0; i < depth; i++) if (stack[i] == id) {       // re-press: move to top
    for (let j = i; j < depth - 1; j++) { stack[j] = stack[j + 1]; stackHz[j] = stackHz[j + 1]; }
    depth--; break;
  }
  if (depth == 16) { for (let j = 0; j < 15; j++) { stack[j] = stack[j + 1]; stackHz[j] = stackHz[j + 1]; } depth = 15; }
  stack[depth] = id; stackHz[depth] = hz; depth++;
}

// Knobs → voice fields. Also run before a note, so a hit that arrives
// before the block's process() (e.g. the very first one) uses your settings.
function applyParams(): void {
  bd.level = params[P_LEV]; bd.tone = params[P_TONE];
  bd.sigh = params[P_SIGH]; bd.click = params[P_CLICK] * 0.7;
  bd.tauOverride = 0.03 * Mathf.pow(130.0, params[P_DEC]);        // 30 ms … 4 s
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  const legato = depth > 0 && sounding;
  pushNote(id, hz);
  targetLog = Mathf.log2(hz);
  const glideAlways = params[P_GLIDE_MODE] < 0.5;
  if (legato && !glideAlways) return;                  // legato: bend, don't retrigger
  if (!(glideAlways && sounding && params[P_GLIDE] > 0.001)) curLog = targetLog;
  bd.trigger(velToHeight(vel, params[P_AC], params[P_VELMODE] > 0.5));
  sounding = true; hitFlash(0);
}

export function noteOff(id: i32): void {
  let found = -1;
  for (let i = 0; i < depth; i++) if (stack[i] == id) { found = i; break; }
  if (found < 0) return;
  for (let j = found; j < depth - 1; j++) { stack[j] = stack[j + 1]; stackHz[j] = stackHz[j + 1]; }
  depth--;
  if (depth > 0) { targetLog = Mathf.log2(stackHz[depth - 1]); return; }   // fall back to the held note
  const rel = params[P_RELEASE];
  if (rel < 0.999) bd.release(0.01 * Mathf.pow(200.0, rel));   // 10 ms … 2 s; full = let it ring
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bend = clampf(value, -1.0, 1.0);
}

export function process(n: i32): void {
  applyParams();
  const glideT = params[P_GLIDE] * 0.5;
  const gc: f32 = glideT < 0.001 ? 1.0 : 1.0 - decayCoef(glideT * 0.35);
  const oct = f32(i32(Mathf.round(params[P_OCTAVE])));
  const range = params[P_BEND_RANGE];
  const drive = params[P_DRIVE];
  const bc: f32 = 1.0 - decayCoef(0.006);
  for (let f = 0; f < n; f++) {
    curLog += (targetLog - curLog) * gc;
    bendSm += (bend - bendSm) * bc;
    const hz = Mathf.pow(2.0, curLog + oct + bendSm * range / 12.0);
    bd.freqHz = clampf(hz, 16.0, 2000.0);
    bd.bodyGain = clampf(Mathf.pow(56.0 / bd.freqHz, 0.9), 0.2, 2.6);
    const y = driveStage(bd.tick() * 1.15, drive);
    if (!bd.active) sounding = false;
    unchecked(outBuf[f] = y); unchecked(outBuf[MAX_FRAMES + f] = y); trackPeak(y);
  }
  finishDisplay(n);
}
