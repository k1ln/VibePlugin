// =====================================================================
//  COLOSSUS — hybrid trailer strings.
//
//  Every note is three ensembles at once — LOW (an octave down, the celli
//  and basses), MID and HIGH (an octave up) — each up to five band-limited
//  detuned saws with their own slow drift, through a per-voice filter that
//  opens with dynamics and the BITE of the attack, plus bow-hair ROSIN noise
//  and a SUB. String-body formants and tape saturation shape the sum, a hall
//  places it. The OSTINATO engine replays the held chord in rhythm, locked
//  to the DAW's bar: 8ths, 16ths, gallop, reverse gallop, triplets, the
//  3-3-2 figure, dotted 8ths, 32nds — with note length, accent and swing.
//  EVOLVE moves the tone over time, TENSION adds a quiet minor second,
//  PUMP ducks each beat. CC1 dynamics, CC11 expression, pitch bend.
// =====================================================================
const CV: i32 = 10;            // voices
const NS: i32 = 5;             // saws per layer

@inline function blep(t: f32, dt: f32): f32 {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1.0; }
  if (t > 1.0 - dt) { const u = (t - 1.0) / dt; return u * u + u + u + 1.0; }
  return 0.0;
}

class CVoice {
  note: i32 = -1; hz: f32 = 220; vel: f32 = 0.7; gate: bool = false; active: bool = false; held: bool = false;
  env: f32 = 0; bite: f32 = 0; age: i32 = 0; shortLeft: i32 = 0; accent: f32 = 0;
  ph: StaticArray<f32> = new StaticArray<f32>(NS * 4);       // [layer*NS + i], layer 3 = tension
  det: StaticArray<f32> = new StaticArray<f32>(NS * 4);
  drift: StaticArray<f32> = new StaticArray<f32>(NS * 4);
  sub: f32 = 0;
  fL: Svf = new Svf(); fR: Svf = new Svf(); fc: f32 = -1.0;
}
const cv = new StaticArray<CVoice>(CV);
const hall = new Hall();
const fmtL = new StaticArray<Svf>(3); const fmtR = new StaticArray<Svf>(3);
const hpL = new Svf(); const hpR = new Svf();
const dynS = new Smoothed(); const exprS = new Smoothed();
let cc1: f32 = -1.0; let cc11: f32 = -1.0; let bend: f32 = 0.0; let bendS: f32 = 0.0;
let evoPh: f32 = 0.0; let peak: f32 = 0.0;
// ostinato clock
let ostPpq: f64 = 0.0; let ostLast: i64 = -1; let ostRunning: bool = false; let heldCount: i32 = 0;
let pumpEnv: f32 = 1.0; let beatLast: i64 = -1;

// Patterns on a 16-step (16th-note) bar: 0 = rest, 1 = hit, 2 = accented hit.
// Triplets use a 12-step bar (index 4), handled by stepsPerBeat.
const PAT = new StaticArray<i32>(8 * 16);
function setPattern(i: i32, s: string): void { for (let k = 0; k < 16; k++) PAT[i * 16 + k] = s.charCodeAt(k) - 48; }

// Knob vs controller: whichever moved last wins (turning the knob takes
// over from the mod wheel, and vice versa).
let lastDYN: f32 = -99.0;
let lastEXPR: f32 = -99.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  commonInit(sr); hall.init(); setDefaults();
  lastDYN = params[P_DYN]; lastEXPR = params[P_EXPR];
  for (let i = 0; i < CV; i++) {
    const v = new CVoice();
    for (let k = 0; k < NS * 4; k++) { v.ph[k] = rand01(); v.drift[k] = 0; }
    cv[i] = v;
  }
  const fz: StaticArray<f32> = [430.0, 1150.0, 2700.0];
  const fq: StaticArray<f32> = [2.0, 2.5, 2.2];
  for (let i = 0; i < 3; i++) {
    const a = new Svf(); a.set(fz[i], fq[i]); fmtL[i] = a;
    const b = new Svf(); b.set(fz[i], fq[i]); fmtR[i] = b;
  }
  hpL.reset(); hpR.reset(); hpL.set(28.0, 0.7); hpR.set(28.0, 0.7);
  setPattern(0, "2010101020101010");   // 8ths
  setPattern(1, "2111211121112111");   // 16ths
  setPattern(2, "2011201120112011");   // gallop: 8th + two 16ths
  setPattern(3, "1120112011201120");   // reverse gallop: two 16ths + 8th
  setPattern(4, "2112112112110000");   // triplets (12-step bar)
  setPattern(5, "2112112121121121");   // 3-3-2 accents across the bar
  setPattern(6, "2001200120012001");   // dotted 8th + 16th
  setPattern(7, "2111111121111111");   // 32nds (played at double rate)
  cc1 = -1; cc11 = -1; bend = 0; bendS = 0; evoPh = 0; peak = 0; ostLast = -1; ostRunning = false; heldCount = 0; beatLast = -1;
  ostPpq = 0.0; pumpEnv = 1.0;
  dynS.setTau(0.04); exprS.setTau(0.04); dynS.v = params[P_DYN]; exprS.v = params[P_EXPR];
}

function voiceFor(note: i32): i32 {
  for (let i = 0; i < CV; i++) if (unchecked(cv[i]).note == note && unchecked(cv[i]).active) return i;
  for (let i = 0; i < CV; i++) if (!unchecked(cv[i]).active) return i;
  let best = 0; let age = -1;
  for (let i = 0; i < CV; i++) { const v = unchecked(cv[i]); const a = v.age + (v.held ? 0 : 1 << 24); if (a > age) { age = a; best = i; } }
  return best;
}

function strike(v: CVoice, accent: f32): void {
  const spread = params[P_SPREAD];
  const fresh = !v.active;
  v.active = true; v.gate = true; v.age = 0; v.accent = accent;
  v.bite = clampf(0.4 + v.vel * params[P_VEL_BITE] + accent * 0.6, 0.0, 1.6);
  for (let k = 0; k < NS * 4; k++) {
    const i = k % NS;
    const c: f32 = (f32(i) - 2.0) / 2.0;             // −1 … 1 across the ensemble
    v.det[k] = fastExp2(c * (4.0 + 26.0 * spread) / 1200.0);
    if (fresh) v.ph[k] = rand01();
  }
  if (fresh) { v.env = 0; v.fL.reset(); v.fR.reset(); v.fc = -1; }
}

function ostinatoOn(): bool { return params[P_OSTINATO] > 0.5; }

export function noteOn(id: i32, hz: f32, vel: f32): void {
  const v = unchecked(cv[voiceFor(id)]);
  v.note = id; v.hz = hz; v.vel = vel; v.held = true;
  heldCount++;
  if (ostinatoOn()) {
    if (!ostRunning) { ostRunning = true; ostLast = -1; ostPpq = 0.0; }   // free-run starts on the first key
    v.active = true; v.gate = false; v.env = v.env > 0 ? v.env : 0.0;    // waits for the next step
    return;
  }
  strike(v, vel > 0.85 ? 1.0 : 0.0);
}

export function noteOff(id: i32): void {
  for (let i = 0; i < CV; i++) {
    const v = unchecked(cv[i]);
    if (v.note == id && v.held) { v.held = false; v.gate = false; heldCount = heldCount > 0 ? heldCount - 1 : 0; }
  }
  if (heldCount == 0) ostRunning = false;
}

export function controlChange(num: i32, value: f32): void {
  if (num == 1) cc1 = value; else if (num == 11) cc11 = value; else if (num == 128) bend = value;
}

// ---- ostinato ---------------------------------------------------------------
function stepsPerBeat(): f64 {
  const pat = i32(params[P_PATTERN] + 0.5);
  const rate = i32(params[P_RATE] + 0.5);                 // 0 half, 1 normal, 2 double
  let spb: f64 = pat == 4 ? 3.0 : 4.0;
  if (pat == 7) spb = 8.0;
  return spb * (rate == 0 ? 0.5 : (rate == 2 ? 2.0 : 1.0));
}
function patternLen(): i32 { const pat = i32(params[P_PATTERN] + 0.5); return pat == 4 ? 12 : 16; }

function ostinatoStep(step: i32, stepSec: f32): void {
  const pat = i32(params[P_PATTERN] + 0.5);
  const cell = PAT[pat * 16 + step];
  if (cell == 0) return;
  const accent: f32 = cell == 2 ? params[P_ACCENT] : 0.0;
  const len = i32(stepSec * SR * (0.08 + 0.9 * params[P_LENGTH]));
  for (let i = 0; i < CV; i++) {
    const v = unchecked(cv[i]);
    if (!v.held) continue;
    strike(v, accent);
    v.shortLeft = len;
  }
}

export function process(n: i32): void {
  if (params[P_DYN] != lastDYN) { lastDYN = params[P_DYN]; cc1 = -1.0; }
  if (params[P_EXPR] != lastEXPR) { lastEXPR = params[P_EXPR]; cc11 = -1.0; }
  const drive = params[P_TAPE];
  const master = params[P_MASTER] * params[P_MASTER] * 0.9;
  const lv0 = params[P_LOW] * params[P_LOW], lv1 = params[P_MID] * params[P_MID], lv2 = params[P_HIGH] * params[P_HIGH];
  const lvSub = params[P_SUB] * params[P_SUB] * 0.8, tension = params[P_TENSION] * 0.35;
  const nsaw = i32(clampf(params[P_SIZE], 2.0, 5.0) + 0.5);
  const tone = params[P_TONE]; const res: f32 = 0.6 + 2.4 * params[P_RES];
  const rosin = params[P_ROSIN] * 0.12;
  const atk: f32 = 0.004 + 1.5 * params[P_ATTACK] * params[P_ATTACK];
  const rel: f32 = 0.05 + 2.5 * params[P_RELEASE] * params[P_RELEASE];
  const atkC = smoothCoef(atk), relC = smoothCoef(rel);
  const evoDepth = params[P_EVOLVE]; const evoInc: f32 = (0.02 + 0.5 * params[P_EVOLVE_RATE] * params[P_EVOLVE_RATE]) * invSR;
  const bodyAmt = params[P_BODY]; const width = params[P_WIDTH];
  const pump = params[P_PUMP]; const swing = params[P_SWING];
  const range = params[P_BEND_RANGE];
  const bpm = hostTempo(); const spb = stepsPerBeat(); const plen = patternLen();
  const stepSec: f32 = f32(60.0 / (f64(bpm) * spb));
  const ost = ostinatoOn();
  // the DAW's position drives both the ostinato and the pump while it plays
  if (hostSeen && hostPlaying) { ostPpq = hostPpq; if (ost && heldCount > 0) ostRunning = true; }
  hall.set(params[P_HALL_SIZE], 0.5, 0.02);
  const hallMix = params[P_HALL];
  dynS.target = cc1 >= 0.0 ? cc1 : params[P_DYN];
  exprS.target = cc11 >= 0.0 ? cc11 : params[P_EXPR];
  const ppqInc: f64 = f64(bpm) / (60.0 * f64(SR));
  const decayShort = smoothCoef(0.012);

  for (let f = 0; f < n; f++) {
    const dyn = dynS.tick(); const expr = exprS.tick();
    bendS += (bend * range - bendS) * 0.002;
    const bendR = fastExp2(bendS / 12.0);
    evoPh += evoInc; if (evoPh >= 1.0) evoPh -= 1.0;
    const evo = fastSin01(evoPh) * evoDepth;
    // --- ostinato clock (swing delays the off-beat 16ths) ---
    if (ost && ostRunning) {
      const pos = ostPpq * spb;
      let s = i64(Math.floor(pos + 1e-9));
      const frac = f32(pos - Math.floor(pos));
      if ((s & 1) == 1 && frac < swing * 0.5) s -= 1;      // hold the off-beat back
      if (s != ostLast && s >= 0) { ostLast = s; ostinatoStep(i32(s % i64(plen)), stepSec); }
      ostPpq += ppqInc;
    }
    // --- pump: duck on every beat, recover within it ---
    if (pump > 0.001) {
      const beat = i64(Math.floor(ostPpq + 1e-9));
      if (beat != beatLast) { beatLast = beat; pumpEnv = 1.0 - pump * 0.85; }
      pumpEnv += (1.0 - pumpEnv) * 0.00025;
      if (!ost) ostPpq += ppqInc;
    } else pumpEnv = 1.0;

    let l: f32 = 0; let r: f32 = 0;
    for (let vi = 0; vi < CV; vi++) {
      const v = unchecked(cv[vi]);
      if (!v.active) continue;
      // envelope: short notes (ostinato) close after shortLeft samples
      let target: f32 = v.gate ? 1.0 : 0.0;
      if (ost && v.shortLeft > 0) { v.shortLeft--; target = 1.0; if (v.shortLeft == 0) target = 0.0; }
      else if (ost) target = 0.0;
      v.env += (target - v.env) * (target > v.env ? (ost ? decayShort * 4.0 : atkC) : (ost ? decayShort : relC));
      v.bite *= 0.99975;                                  // ~80 ms marcato bite
      if (v.env < 0.0003 && target == 0.0 && !v.held) { v.active = false; v.note = -1; continue; }
      if (v.env < 0.0003 && target == 0.0) continue;
      v.age++;
      let sl: f32 = 0; let sr2: f32 = 0;
      for (let layer = 0; layer < 4; layer++) {
        const gain: f32 = layer == 0 ? lv0 : (layer == 1 ? lv1 : (layer == 2 ? lv2 : tension));
        if (gain < 0.0005) continue;
        const ratio: f32 = layer == 0 ? 0.5 : (layer == 1 ? 1.0 : (layer == 2 ? 2.0 : 1.0594631));
        for (let i = 0; i < nsaw; i++) {
          const k = layer * NS + i;
          let dr = unchecked(v.drift[k]); dr = dr * 0.9998 + white() * 0.00003; unchecked(v.drift[k] = dr);
          const dt = v.hz * ratio * unchecked(v.det[k]) * bendR * (1.0 + dr) * invSR;
          let ph = unchecked(v.ph[k]);
          const saw: f32 = ph * 2.0 - 1.0 - blep(ph, dt);
          ph += dt; if (ph >= 1.0) ph -= 1.0;
          unchecked(v.ph[k] = ph);
          const pan: f32 = (f32(i) - f32(nsaw - 1) * 0.5) / f32(nsaw) * width * 1.6;
          sl += saw * gain * (pan * -0.5 + 0.5); sr2 += saw * gain * (pan * 0.5 + 0.5);
        }
      }
      // sub: a sine two octaves down
      v.sub += v.hz * 0.25 * bendR * invSR; if (v.sub >= 1.0) v.sub -= 1.0;
      const sub = fastSin01(v.sub) * lvSub * 2.0;
      // rosin: bow-hair noise riding the level
      const nz = white() * rosin * (0.4 + dyn);
      // per-voice filter: tone, dynamics, bite, evolve
      const fc: f32 = clampf((300.0 + 7000.0 * tone * tone) * (0.35 + 1.4 * dyn) * (1.0 + 2.2 * v.bite) * (1.0 + 0.6 * evo), 60.0, 18000.0);
      if (Mathf.abs(fc - v.fc) > v.fc * 0.02) { v.fL.set(fc, res); v.fR.set(fc, res); v.fc = fc; }
      v.fL.tick(sl + nz); v.fR.tick(sr2 - nz);
      const g = v.env * (0.55 + 0.45 * v.vel) * (1.0 + v.accent * 0.5) / f32(nsaw);
      l += (v.fL.lp + sub) * g; r += (v.fR.lp + sub) * g;
    }
    // string-body formants, high-pass, tape, pump, hall
    let bl: f32 = 0; let br: f32 = 0;
    for (let i = 0; i < 3; i++) { const a = unchecked(fmtL[i]); a.tick(l); bl += a.bp * a.k; const b = unchecked(fmtR[i]); b.tick(r); br += b.bp * b.k; }
    l = l * (1.0 - bodyAmt * 0.6) + bl * bodyAmt * 0.9; r = r * (1.0 - bodyAmt * 0.6) + br * bodyAmt * 0.9;
    hpL.tick(l); hpR.tick(r); l = hpL.hp * expr * pumpEnv; r = hpR.hp * expr * pumpEnv;
    if (drive > 0.001) { l = softclip(l * (1.0 + 3.0 * drive)) / (1.0 + drive); r = softclip(r * (1.0 + 3.0 * drive)) / (1.0 + drive); }
    hall.tick(l, r);
    l = l * (1.0 - hallMix * 0.5) + hall.outL * hallMix * 1.3;
    r = r * (1.0 - hallMix * 0.5) + hall.outR * hallMix * 1.3;
    l = softclip(l * master); r = softclip(r * master);
    unchecked(outBuf[f] = l); unchecked(outBuf[MAX_FRAMES + f] = r);
    const a = Mathf.max(Mathf.abs(l), Mathf.abs(r)); if (a > peak) peak = a;
  }
  // display: [0] ostinato step (-1 off), [1] pattern length, [2] dynamics, [3] evolve, [4] pump, [5] held notes, [15] peak
  display[0] = ost && ostRunning ? f32(ostLast % i64(plen)) : -1.0;
  display[1] = f32(plen); display[2] = dynS.v; display[3] = fastSin01(evoPh) * evoDepth; display[4] = pumpEnv;
  display[5] = f32(heldCount); display[15] = peak; peak *= Mathf.exp(-f32(n) * invSR / 0.25);
}
