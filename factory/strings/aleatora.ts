// =====================================================================
//  ALEATORA — aleatoric string textures for film and trailer sound design.
//
//  The same bowed-string section as Tessitura, played by a director that
//  does what composers write with graphic notation: every key spawns a
//  CLUSTER of players spread by cents (optionally on a quarter-tone grid),
//  each player's pitch SWARMS toward its own random targets, the whole mass
//  can RISE or FALL over seconds (the trailer riser), players dig in with
//  overpressure SCRATCH, an octave-up flautando SHIMMER floats on top, the
//  bow can PULSE in time with the DAW, and FREEZE holds the hall forever.
//  CHAOS scales the randomness of all of it. Keyswitches C0–G0 pick the
//  articulation as in Tessitura; CC1 dynamics, CC11 expression.
// =====================================================================
const hall = new Hall();
let cc1: f32 = -1.0; let cc11: f32 = -1.0; let bend: f32 = 0.0;
const dynS = new Smoothed(); const exprS = new Smoothed();
let ksArt: i32 = -1; let lastArtParam: i32 = -1;
let pulsePh: f64 = 0.0; let pulseEnv: f32 = 1.0;
let peak: f32 = 0; let startAge: i32 = 0;

// Knob vs controller: whichever moved last wins (turning the knob takes
// over from the mod wheel, and vice versa).
let lastDYN: f32 = -99.0;
let lastEXPR: f32 = -99.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); sectionInit(); hall.init(); setDefaults();
  lastDYN = params[P_DYN]; lastEXPR = params[P_EXPR];
  cc1 = -1; cc11 = -1; bend = 0; ksArt = -1; lastArtParam = -1; pulsePh = 0; peak = 0;
  dynS.setTau(0.04); exprS.setTau(0.04); dynS.v = params[P_DYN]; exprS.v = params[P_EXPR];
}

function applyParams(): void {
  if (params[P_DYN] != lastDYN) { lastDYN = params[P_DYN]; cc1 = -1.0; }
  if (params[P_EXPR] != lastEXPR) { lastEXPR = params[P_EXPR]; cc11 = -1.0; }
  const chaos = params[P_CHAOS];
  sectionMode = i32(params[P_SECTION] + 0.5);
  playersPerNote = i32(clampf(params[P_PLAYERS], 1.0, 6.0) + 0.5);
  const ap = i32(params[P_ART] + 0.5);
  if (ap != lastArtParam) { lastArtParam = ap; ksArt = -1; }
  curArt = ksArt >= 0 ? ksArt : ap;
  clusterC = params[P_CLUSTER] * (0.5 + chaos);
  quarterTone = params[P_QUARTER] > 0.5;
  swarmC = params[P_SWARM] * 100.0 * (0.4 + 1.2 * chaos);
  swarmRate = 0.1 * Mathf.pow(80.0, params[P_SWARM_SPEED]) * (0.6 + chaos);
  swarmSlew = smoothCoef(0.02 + 1.2 * params[P_SWARM_GLIDE]);
  riseC = params[P_RISE] * 100.0; riseTime = params[P_RISE_TIME];
  scratchAmt = params[P_SCRATCH] * params[P_SCRATCH] * 3.0 * (0.4 + chaos);
  shimmer = params[P_SHIMMER];
  dynS.target = cc1 >= 0.0 ? cc1 : params[P_DYN];
  exprS.target = cc11 >= 0.0 ? cc11 : params[P_EXPR];
  vibAmt = params[P_VIB]; vibRateScale = 1.0; vibOnset = 0.4;
  attackScale = 0.3 + 3.5 * params[P_ATTACK]; releaseTime = 0.1 + 3.0 * params[P_RELEASE];
  forceBias = 0.2 + 0.8 * params[P_FORCE]; posBias = params[P_POSITION]; brightBias = params[P_BRIGHT];
  tightness = clampf(0.7 - chaos * 0.7, 0.0, 1.0); tremRate = 9.0 + 12.0 * params[P_TREM_RATE]; humanize = params[P_HUMAN];
  legato = false; bodyAmt = 0.75; octaveDouble = 0.0; width = params[P_WIDTH];
  const frozen = params[P_FREEZE] > 0.5;
  if (!frozen) { hall.freeze(false); hall.set(params[P_HALL_SIZE], params[P_HALL_TONE], 0.03); }
  else hall.freeze(true);                                // hold the tail
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  applyParams();
  if (id >= 24 && id <= 31) { ksArt = id - 24; curArt = ksArt; return; }
  startVoice(allocVoice(id), id, vel, curArt);
  startAge = 0;
}
export function noteOff(id: i32): void { if (id >= 24 && id <= 31) return; releaseNote(id); }
export function controlChange(num: i32, value: f32): void {
  if (num == 1) cc1 = value; else if (num == 11) cc11 = value; else if (num == 128) bend = value;
}

// Pulse divisions per quarter note: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32.
function pulsePerBeat(): f64 { const d = i32(params[P_PULSE_DIV] + 0.5); return d == 0 ? 1.0 : d == 1 ? 2.0 : d == 2 ? 3.0 : d == 3 ? 4.0 : d == 4 ? 6.0 : 8.0; }

export function process(n: i32): void {
  applyParams();
  const frozen = params[P_FREEZE] > 0.5;
  const dry = params[P_DRY], wet = params[P_WET];
  const master = params[P_MASTER] * params[P_MASTER] * 0.42;
  const depth = params[P_PULSE];
  const ppb = pulsePerBeat();
  const bpm = hostTempo();
  if (hostSeen && hostPlaying) pulsePh = hostPpq * ppb;          // lock to the bar
  const inc: f64 = f64(bpm) / 60.0 * ppb / f64(SR);
  bendSemis = bend * 2.0;
  for (let f = 0; f < n; f++) {
    dyn = dynS.tick(); const expr = exprS.tick();
    // pulse: a bow swell per division (sharp attack, rounded fall)
    if (depth > 0.001) {
      const ph = f32(pulsePh - Math.floor(pulsePh));
      const shape: f32 = ph < 0.08 ? ph / 0.08 : Mathf.exp(-(ph - 0.08) * 4.5);
      pulseGain = 1.0 - depth + depth * shape * 1.25;
      pulsePh += inc;
    } else pulseGain = 1.0;
    sectionTick(); bodiesTick();
    const dl = secL * expr, dr = secR * expr;
    hall.tick(frozen ? dl * 0.15 : dl, frozen ? dr * 0.15 : dr);
    let l = dl * dry + hall.outL * wet * 1.6;
    let r = dr * dry + hall.outR * wet * 1.6;
    l = softclip(l * master); r = softclip(r * master);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r);
    const a = Mathf.max(Mathf.abs(l), Mathf.abs(r)); if (a > peak) peak = a;
    startAge++;
  }
  // display: [0] art, [1] notes, [2] rise progress, [3] pulse, [4] chaos, [5..10] player offsets of the newest cluster (−1..1), [15] peak
  display[0] = f32(curArt); display[1] = f32(activeCount());
  display[2] = riseTime > 0.01 ? clampf(f32(startAge) * invSR / riseTime, 0.0, 1.0) : 1.0;
  display[3] = pulseGain; display[4] = params[P_CHAOS];
  let newest = -1; let bestAge = 1 << 30;
  for (let i = 0; i < MAXV; i++) { const v = unchecked(voices[i]); if (v.active && v.gate && v.age < bestAge) { bestAge = v.age; newest = i; } }
  for (let j = 0; j < 6; j++) {
    if (newest < 0 || j >= unchecked(voices[newest]).np) { display[5 + j] = -9.0; continue; }
    const p = unchecked(players[newest * MAXP + j]);
    const span: f32 = clusterC + swarmC + 1.0;
    display[5 + j] = clampf((p.offC + p.walkC) / span, -1.0, 1.0);
  }
  display[15] = peak; peak *= Mathf.exp(-f32(n) * invSR / 0.25);
}
