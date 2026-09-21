// =====================================================================
//  TESSITURA — a physically modelled string section.
//
//  Every note is bowed by up to six players (bowed-waveguide strings on
//  violin, viola, cello or bass bodies), seated across the stage, each with
//  their own intonation, vibrato and bow timing. Eight articulations switch
//  on keyswitches C0–G0 (MIDI 24–31) or the Articulation control; the
//  orchestral controllers work as in sample libraries: CC1 dynamics (bow
//  speed, pressure and brightness together), CC11 expression, CC21 vibrato.
//  LEGATO makes it a monophonic line: overlapping notes slide (slow
//  velocity) or change bow (fast velocity) instead of re-attacking.
//  A stage with close, tree and ambient microphones feeds a hall.
// =====================================================================
const hall = new Hall();
let cc1: f32 = -1.0; let cc11: f32 = -1.0; let cc21: f32 = -1.0; let bend: f32 = 0.0;
const dynS = new Smoothed(); const exprS = new Smoothed(); const vibS = new Smoothed(); const bendS = new Smoothed();
let ksArt: i32 = -1;          // last keyswitch (overrides the Articulation control until it changes)
let lastArtParam: i32 = -1;
let held: i32 = 0;            // keys down (legato)
let legVoice: i32 = -1;
const heldNotes = new StaticArray<i32>(16); let heldN: i32 = 0;
let peak: f32 = 0;

// Knob vs controller: whichever moved last wins (turning the knob takes
// over from the mod wheel, and vice versa).
let lastDYN: f32 = -99.0;
let lastEXPR: f32 = -99.0;
let lastVIB: f32 = -99.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); sectionInit(); hall.init(); setDefaults();
  lastDYN = params[P_DYN]; lastEXPR = params[P_EXPR]; lastVIB = params[P_VIB];
  cc1 = -1; cc11 = -1; cc21 = -1; bend = 0; ksArt = -1; lastArtParam = -1; heldN = 0; legVoice = -1; peak = 0;
  dynS.setTau(0.03); exprS.setTau(0.03); vibS.setTau(0.05); bendS.setTau(0.008);
  dynS.v = params[P_DYN]; exprS.v = params[P_EXPR]; vibS.v = params[P_VIB];
}

function applyParams(): void {
  if (params[P_DYN] != lastDYN) { lastDYN = params[P_DYN]; cc1 = -1.0; }
  if (params[P_EXPR] != lastEXPR) { lastEXPR = params[P_EXPR]; cc11 = -1.0; }
  if (params[P_VIB] != lastVIB) { lastVIB = params[P_VIB]; cc21 = -1.0; }
  sectionMode = i32(params[P_SECTION] + 0.5);
  playersPerNote = i32(clampf(params[P_PLAYERS], 1.0, 6.0) + 0.5);
  const ap = i32(params[P_ART] + 0.5);
  if (ap != lastArtParam) { lastArtParam = ap; ksArt = -1; }      // moving the control takes over again
  curArt = ksArt >= 0 ? ksArt : ap;
  dynS.target = cc1 >= 0.0 ? cc1 : params[P_DYN];
  exprS.target = cc11 >= 0.0 ? cc11 : params[P_EXPR];
  vibS.target = cc21 >= 0.0 ? cc21 : params[P_VIB];
  vibRateScale = 0.75 + 0.5 * params[P_VIB_RATE];
  vibOnset = 0.05 + 0.9 * params[P_VIB_DELAY];
  attackScale = 0.3 + 2.4 * params[P_ATTACK];
  releaseTime = 0.08 + 1.6 * params[P_RELEASE];
  forceBias = 0.2 + 0.8 * params[P_FORCE]; posBias = params[P_POSITION]; brightBias = params[P_BRIGHT];
  tightness = params[P_TIGHT]; tremRate = 9.0 + 10.0 * params[P_TREM_RATE]; humanize = params[P_HUMAN];
  legato = params[P_LEGATO] > 0.5; portamento = params[P_PORTA]; velToDyn = params[P_VEL_DYN];
  bodyAmt = params[P_BODY]; octaveDouble = params[P_DOUBLE]; width = params[P_WIDTH];
  fineTune = Mathf.pow(2.0, params[P_TUNE] / 1200.0);
  hall.set(params[P_HALL_SIZE], params[P_HALL_TONE], 0.005 + 0.09 * params[P_PREDELAY]);
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  if (id >= 24 && id <= 31) { ksArt = id - 24; curArt = ksArt; return; }   // keyswitch C0–G0
  if (legato) {
    if (heldN < 16) { heldNotes[heldN] = id; heldN++; }
    if (legVoice >= 0 && unchecked(voices[legVoice]).active && unchecked(voices[legVoice]).gate) { legatoTo(legVoice, id, vel); return; }
    legVoice = allocVoice(id);
    startVoice(legVoice, id, vel, curArt);
    return;
  }
  startVoice(allocVoice(id), id, vel, curArt);
}

export function noteOff(id: i32): void {
  if (id >= 24 && id <= 31) return;
  if (legato) {
    let k = -1; for (let i = 0; i < heldN; i++) if (heldNotes[i] == id) { k = i; break; }
    if (k >= 0) { for (let i = k; i < heldN - 1; i++) heldNotes[i] = heldNotes[i + 1]; heldN--; }
    if (legVoice >= 0 && unchecked(voices[legVoice]).note == id) {
      if (heldN > 0) legatoTo(legVoice, heldNotes[heldN - 1], 0.4);        // fall back to the held note
      else { releaseNote(id); legVoice = -1; }
    }
    return;
  }
  releaseNote(id);
}

export function controlChange(num: i32, value: f32): void {
  if (num == 1) cc1 = value;
  else if (num == 11) cc11 = value;
  else if (num == 21) cc21 = value;
  else if (num == 128) bend = value;
}

export function process(n: i32): void {
  applyParams();
  const range = params[P_BEND];
  const close = params[P_MIC_CLOSE], tree = params[P_MIC_TREE], amb = params[P_MIC_AMB];
  const master = params[P_MASTER] * params[P_MASTER] * 0.42;
  for (let f = 0; f < n; f++) {
    dyn = dynS.tick(); vibAmt = vibS.tick(); const expr = exprS.tick();
    bendS.target = bend * range; bendSemis = bendS.tick();
    sectionTick(); bodiesTick();
    const dl = secL * expr, dr = secR * expr;
    hall.tick(dl, dr);
    // close: dry, full width · tree: narrower with the early field · ambient: the hall
    const mid = (dl + dr) * 0.5;
    let l = dl * close * 1.1 + (mid * 0.55 + dl * 0.45) * tree * 0.9 + hall.outL * amb * 1.4;
    let r = dr * close * 1.1 + (mid * 0.55 + dr * 0.45) * tree * 0.9 + hall.outR * amb * 1.4;
    l = softclip(l * master); r = softclip(r * master);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r);
    const a = Mathf.max(Mathf.abs(l), Mathf.abs(r)); if (a > peak) peak = a;
  }
  // display: [0] articulation, [1] active notes, [2] dynamics, [3] vibrato, [4] expression, [15] peak
  display[0] = f32(curArt); display[1] = f32(activeCount()); display[2] = dyn; display[3] = vibAmt; display[4] = exprS.v;
  display[15] = peak; peak *= Mathf.exp(-f32(n) * invSR / 0.25);
}
