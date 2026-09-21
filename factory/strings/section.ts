// =====================================================================
//  strings/section.ts — a bowed string SECTION built from BowedString:
//  every note is played by several players, each with their own string,
//  intonation, vibrato, bow timing and seat on the stage, so a chord is a
//  section of desks rather than one oscillator with chorus.
//
//  Articulations are properties of the bow, not samples:
//    0 SUSTAIN    bow drawn, attack speed from velocity, held
//    1 TREMOLO    bow reverses ~12–16 Hz, each player out of step
//    2 PIZZICATO  no bow: the string is plucked and rings out
//    3 SPICCATO   a short bounced stroke, length independent of the key
//    4 MARCATO    a hard bite (force + speed spike) settling to sustain
//    5 HARMONICS  light bow over the fingerboard, sounding an octave up
//    6 SUL PONT.  bow at the bridge: glassy, upper partials, weak fundamental
//    7 COL LEGNO  struck with the stick: a woody, pitched tick
// =====================================================================

const MAXV: i32 = 12;                // notes
const MAXP: i32 = 6;                 // players per note
const NPLAY: i32 = MAXV * MAXP;

// Register families and their bodies. 0 violin, 1 viola, 2 cello, 3 bass.
const bodiesL = new StaticArray<Body>(4);
const bodiesR = new StaticArray<Body>(4);
const busL = new StaticArray<f32>(4);
const busR = new StaticArray<f32>(4);

class Player {
  s: BowedString = new BowedString();
  family: i32 = 0; ratio: f32 = 1.0;         // ratio 0.5 = octave-down doubling
  detune: f32 = 1.0;                         // multiplicative intonation offset
  vibPh: f32 = 0; vibRate: f32 = 5.6; vibDepth: f32 = 1.0; vibOn: f32 = 0;
  delay: i32 = 0;                            // samples before this player's bow lands
  tremPh: f32 = 0;
  gL: f32 = 0.7; gR: f32 = 0.7;
  drift: f32 = 0;                            // slow intonation wander
  used: bool = false; plucked: bool = false;
  hpz: f32 = 0;                              // sul ponticello thins the fundamental
  wander: f32 = 0;                           // slow bow-speed wander (humanize)
  // aleatoric director (all zero in a plain section)
  offC: f32 = 0; walkC: f32 = 0; walkT: f32 = 0; walkTimer: i32 = 0; scr: f32 = 0; gain: f32 = 1.0;
}

class Voice {
  note: i32 = -1; vel: f32 = 0; art: i32 = 0;
  target: f32 = 220; freq: f32 = 220; glideC: f32 = 1.0;
  gate: bool = false; bow: f32 = 0; age: i32 = 0; relAge: i32 = 0;
  active: bool = false; np: i32 = 0; accent: f32 = 0;
  hitDone: bool = false; accEnv: f32 = 0;   // amplitude accent (marcato / hard velocity)
}

const players = new StaticArray<Player>(NPLAY);
const voices = new StaticArray<Voice>(MAXV);

// Performance state the plugin sets each block (from params + controllers).
let sectionMode: i32 = 0;      // 0 auto, 1 violins, 2 violas, 3 celli, 4 basses, 5 full orchestra
let playersPerNote: i32 = 4;
let curArt: i32 = 0;
let dyn: f32 = 0.6;            // 0..1 dynamics (bow speed + force + brightness)
let vibAmt: f32 = 0.5; let vibRateScale: f32 = 1.0; let vibOnset: f32 = 0.35;
let attackScale: f32 = 1.0; let releaseTime: f32 = 0.35;
let forceBias: f32 = 0.5; let posBias: f32 = 0.5; let brightBias: f32 = 0.5;
let tightness: f32 = 0.6; let tremRate: f32 = 14.0; let humanize: f32 = 0.5;
let legato: bool = false; let portamento: f32 = 0.4;
let bodyAmt: f32 = 0.8; let octaveDouble: f32 = 0.0; let width: f32 = 0.7;
let bendSemis: f32 = 0.0;      // current pitch bend in semitones
let fineTune: f32 = 1.0;
let velToDyn: f32 = 0.4;
// Aleatoric controls (Aleatora). Zero = off, so a plain section pays nothing.
let clusterC: f32 = 0.0;       // half-width of the cluster, cents
let quarterTone: bool = false; // snap cluster offsets to a 50-cent grid
let swarmC: f32 = 0.0;         // how far each player wanders, cents
let swarmRate: f32 = 1.0;      // new wander targets per second
let swarmSlew: f32 = 0.001;    // glide coefficient toward the target
let riseC: f32 = 0.0;          // total glissando, cents (±)
let riseTime: f32 = 8.0;       // seconds to complete it
let scratchAmt: f32 = 0.0;     // overpressure bursts per second (per player)
let shimmer: f32 = 0.0;        // level of an octave-up flautando player
let pulseGain: f32 = 1.0;      // bow multiplier from the pulse engine (set per sample)
let aleaFirstVoice: i32 = -1;  // voice whose players the display shows

function sectionInit(): void {
  for (let i = 0; i < 4; i++) {
    const bl = new Body(); bl.configure(i); bodiesL[i] = bl;
    const br = new Body(); br.configure(i); bodiesR[i] = br;
  }
  for (let i = 0; i < NPLAY; i++) { const p = new Player(); p.s.clear(); players[i] = p; }
  for (let i = 0; i < MAXV; i++) voices[i] = new Voice();
  hpL.reset(); hpR.reset(); hpL.set(30.0, 0.7); hpR.set(30.0, 0.7); toneL.reset(); toneR.reset(); toneFc = -1.0;
}

function familyFor(note: i32): i32 {
  if (sectionMode == 1) return 0;
  if (sectionMode == 2) return 1;
  if (sectionMode == 3) return 2;
  if (sectionMode == 4) return 3;
  // auto / full: by register (basses below C2, celli below A2, violas below D4)
  if (note < 36) return 3;
  if (note < 45) return 2;
  if (note < 62) return 1;
  return 0;
}

// Seat on the stage for a family (classic American seating: violins left,
// violas centre-right, celli right, basses far right) with a spread per desk.
@inline function seatPan(family: i32, j: i32): f32 {
  const centre: f32 = family == 0 ? -0.55 : (family == 1 ? 0.15 : (family == 2 ? 0.45 : 0.7));
  return clampf(centre + (f32(j) - 2.5) * 0.09, -1.0, 1.0);
}

function allocVoice(note: i32): i32 {
  for (let i = 0; i < MAXV; i++) if (unchecked(voices[i]).note == note && unchecked(voices[i]).active) return i;
  for (let i = 0; i < MAXV; i++) if (!unchecked(voices[i]).active) return i;
  // steal the oldest releasing voice, else the oldest
  let best = 0; let bestAge = -1;
  for (let i = 0; i < MAXV; i++) { const v = unchecked(voices[i]); const a = v.age + (v.gate ? 0 : 1 << 24); if (a > bestAge) { bestAge = a; best = i; } }
  return best;
}

@inline function noteHz(note: i32): f32 { return 440.0 * Mathf.pow(2.0, (f32(note) - 69.0) / 12.0) * fineTune; }

function startVoice(vi: i32, note: i32, vel: f32, art: i32): void {
  const v = unchecked(voices[vi]);
  const fresh = !v.active;
  v.note = note; v.vel = vel; v.art = art; v.gate = true; v.active = true; v.age = 0; v.relAge = 0; v.hitDone = false;
  v.target = noteHz(note) * (art == 5 ? 2.0 : 1.0);
  v.freq = v.target; v.glideC = 1.0;
  v.accent = art == 4 ? 1.0 : (vel > 0.85 ? (vel - 0.85) * 4.0 : 0.0);
  v.accEnv = art == 4 ? 1.4 : v.accent * 0.6;
  const fam = familyFor(note);
  const np = art == 2 || art == 7 ? clampf(f32(playersPerNote), 1.0, 4.0) : f32(playersPerNote);
  v.np = i32(np);
  const spread: f32 = 1.0 - tightness;
  for (let j = 0; j < MAXP; j++) {
    const p = unchecked(players[vi * MAXP + j]);
    p.used = j < v.np;
    if (!p.used) continue;
    const dbl = sectionMode == 5 && octaveDouble > 0.01 && j == v.np - 1 && fam >= 1;
    p.family = dbl ? (fam == 1 ? 2 : 3) : fam;
    p.ratio = dbl ? 0.5 : 1.0;
    p.detune = Mathf.pow(2.0, (white() * (4.0 + 18.0 * spread)) / 1200.0);   // a few cents apart
    p.vibRate = (5.0 + 1.4 * rand01()) * vibRateScale;
    p.vibDepth = 0.6 + 0.8 * rand01();
    p.vibPh = rand01(); p.vibOn = 0;
    p.delay = i32((rand01() * (0.004 + 0.05 * spread) * (0.5 + humanize)) * SR);
    p.tremPh = rand01(); p.plucked = false;
    p.gain = 1.0; p.walkC = 0.0; p.walkT = 0.0; p.walkTimer = 0; p.scr = 0.0;
    if (clusterC > 0.0) {
      let o = white() * clusterC;
      if (quarterTone) o = Mathf.round(o / 50.0) * 50.0;
      p.offC = o;
    } else p.offC = 0.0;
    if (shimmer > 0.01 && v.np > 1 && j == v.np - 1) { p.ratio = 2.0; p.gain = shimmer * 1.3; }
    const pan = seatPan(p.family, j) * width;
    p.gL = Mathf.sqrt(0.5 * (1.0 - pan)); p.gR = Mathf.sqrt(0.5 * (1.0 + pan));
    if (fresh) p.s.clear();
    p.s.beta = clampf(0.127 + (posBias - 0.5) * 0.14 + (art == 6 ? -0.085 : 0.0) + (art == 5 ? 0.09 : 0.0), 0.03, 0.3);
  }
  if (fresh) v.bow = 0.0;
}

// Legato: glide the sounding voice to the new note instead of re-bowing.
// Slow velocity = expressive slide (portamento), fast velocity = bow change.
function legatoTo(vi: i32, note: i32, vel: f32): void {
  const v = unchecked(voices[vi]);
  v.note = note; v.target = noteHz(note) * (v.art == 5 ? 2.0 : 1.0);
  const slow = vel < 0.55;
  const t: f32 = slow ? (0.08 + 0.35 * portamento) * (1.1 - vel) : 0.012 + 0.02 * portamento;
  v.glideC = smoothCoef(t * 0.25);          // reaches the new pitch within the slide time
  v.gate = true; v.relAge = 0;
  if (!slow) v.bow *= 0.75;          // the dip of a bow change
}

// One sample of the whole section into the family buses.
function sectionTick(): void {
  for (let b = 0; b < 4; b++) { busL[b] = 0; busR[b] = 0; }
  const bend = Mathf.pow(2.0, bendSemis / 12.0);
  const dynV: f32 = 0.06 + 0.3 * dyn;                 // bow speed
  const accDecay: f32 = decayCoef(0.11);
  const dynF: f32 = clampf(forceBias * (0.25 + 1.0 * dyn), 0.02, 0.98);
  const bright: f32 = 2200.0 + 9500.0 * clampf(brightBias * 0.6 + dyn * 0.5, 0.0, 1.2);
  for (let vi = 0; vi < MAXV; vi++) {
    const v = unchecked(voices[vi]);
    if (!v.active) continue;
    v.freq += (v.target - v.freq) * v.glideC;
    const art = v.art;
    const tSec = f32(v.age) * invSR;
    // --- bow envelope per articulation ---
    let bowTarget: f32 = 0.0;
    if (art == 0 || art == 5 || art == 6) {
      bowTarget = v.gate ? 1.0 : 0.0;
      const atk: f32 = (0.02 + 0.45 * (1.0 - v.vel)) * attackScale;
      v.bow += (bowTarget - v.bow) * smoothCoef(v.gate ? atk : releaseTime * 0.5);
    } else if (art == 1) {
      bowTarget = v.gate ? 1.0 : 0.0;
      v.bow += (bowTarget - v.bow) * smoothCoef(v.gate ? 0.04 * attackScale : releaseTime * 0.4);
    } else if (art == 3) {                           // spiccato: ~90 ms bounced stroke
      v.bow = tSec < 0.012 ? tSec / 0.012 : Mathf.exp(-(tSec - 0.012) / 0.045);
    } else if (art == 4) {                           // marcato: bite then settle
      const settle: f32 = v.gate ? 0.55 : 0.0;
      v.bow = tSec < 0.03 ? 1.6 : settle + (1.6 - settle) * Mathf.exp(-(tSec - 0.03) / 0.12);
      if (!v.gate) v.bow *= Mathf.exp(-f32(v.relAge) * invSR / (releaseTime * 0.5));
    } else { v.bow = 0.0; }                          // pizz / col legno: no bow
    if (!v.gate) v.relAge++;
    const accGain: f32 = 1.0 + v.accEnv; v.accEnv *= accDecay;
    let alive = false;
    for (let j = 0; j < v.np; j++) {
      const p = unchecked(players[vi * MAXP + j]);
      if (!p.used) continue;
      if (p.delay > 0) { p.delay--; continue; }
      const s = p.s;
      // plucks happen on the first sample the player is "on"
      if ((art == 2 || art == 7) && !p.plucked) {
        s.pluck = (art == 2 ? 0.55 : 0.3) * (0.4 + 0.8 * v.vel) * (0.8 + 0.4 * rand01());
        p.plucked = true;
      }
      // vibrato: fades in after the onset delay, not on short notes
      const vibWanted: bool = (art == 0 || art == 4 || art == 5 || art == 6) && tSec > vibOnset;
      p.vibOn += ((vibWanted ? 1.0 : 0.0) - p.vibOn) * 0.0004;
      p.vibPh += p.vibRate * invSR; if (p.vibPh >= 1.0) p.vibPh -= 1.0;
      const vib = fastSin01(p.vibPh) * vibAmt * p.vibDepth * p.vibOn * 0.0035;   // up to ~±20 cents
      p.drift = p.drift * 0.9997 + white() * 0.000012 * (0.3 + humanize);
      let aleaRatio: f32 = 1.0;
      if (clusterC > 0.0 || swarmC > 0.0 || riseC != 0.0) {
        if (swarmC > 0.0) {
          if (--p.walkTimer <= 0) { p.walkT = white() * swarmC; p.walkTimer = i32(SR / (swarmRate * (0.4 + 1.2 * rand01()))); }
          p.walkC += (p.walkT - p.walkC) * swarmSlew;
        }
        const rp: f32 = riseTime > 0.01 ? clampf(tSec / riseTime, 0.0, 1.0) : 1.0;
        aleaRatio = fastExp2((p.offC + p.walkC + riseC * rp * rp) / 1200.0);
      }
      s.setFreq(v.freq * p.ratio * p.detune * bend * aleaRatio * (1.0 + vib + p.drift));
      s.setBrightness(art == 7 ? 3500.0 : (art == 2 ? bright * 0.7 : (art == 6 ? clampf(bright * 1.9, 4000.0, 19000.0) : bright)));
      // a released note is damped by the player's fingers; plucks ring longer
      const damp: f32 = v.gate ? 0.0 : clampf(f32(v.relAge) * invSR / releaseTime, 0.0, 1.0);
      s.lossGain = (art == 2 ? 0.998 : (art == 7 ? 0.985 : 0.996)) - (art == 2 ? 0.006 : 0.03) * damp;
      // bow speed and force for this player
      p.wander += (white() * 0.5 - p.wander) * 0.0006;            // a bow arm drifts, it doesn't jitter
      let bv = v.bow * (dynV + 0.12 * v.accent) * (1.0 + velToDyn * (v.vel - 0.5)) * (1.0 + p.wander * 0.25 * humanize);
      let bf = dynF + (art == 4 ? 0.25 * v.bow : 0.0);
      if (art == 1) {                                // tremolo: alternating strokes
        p.tremPh += tremRate * (0.9 + 0.2 * p.detune) * invSR; if (p.tremPh >= 1.0) p.tremPh -= 1.0;
        bv *= p.tremPh < 0.5 ? 1.0 : -1.0;
      }
      if (art == 5 || p.ratio == 2.0) { bf *= 0.35; bv *= 0.7; }
      if (scratchAmt > 0.0) {                          // overpressure: slow bow, heavy force = crunch
        if (rand01() < scratchAmt * invSR) p.scr = 1.0;
        if (p.scr > 0.001) { bf = clampf(bf + 0.7 * p.scr, 0.01, 0.99); bv *= 1.0 - 0.65 * p.scr; p.scr *= 0.99985; }
      }
      bv *= pulseGain;
      if (art == 6) { bf = clampf(bf * 1.25 + 0.1, 0.01, 0.99); }
      s.bowVel = bv; s.force = clampf(bf, 0.01, 0.99);
      let y = s.tick();
      if (art == 6) { p.hpz += 0.06 * (y - p.hpz); y = (y - p.hpz) * 1.6; }   // weak fundamental, glassy top
      y *= accGain * p.gain;
      busL[p.family] += y * p.gL; busR[p.family] += y * p.gR;
      if (Mathf.abs(y) > 0.00002 || v.bow > 0.001) alive = true;
    }
    v.age++;
    if (!alive && !v.gate && v.age > 2400) { v.active = false; v.note = -1; }
    if (!alive && (art == 2 || art == 7 || art == 3) && v.age > 4800) { v.active = false; v.note = -1; }
  }
}

// Sum the families through their bodies. Returns via outs.
let secL: f32 = 0; let secR: f32 = 0;
const toneL = new Svf(); const toneR = new Svf(); let toneFc: f32 = -1.0;
const hpL = new Svf(); const hpR = new Svf();      // 30 Hz: below the double bass's low E
function bodiesTick(): void {
  let l: f32 = 0; let r: f32 = 0;
  for (let b = 0; b < 4; b++) {
    const xl = busL[b]; const xr = busR[b];
    if (xl == 0.0 && xr == 0.0) continue;
    const bl = unchecked(bodiesL[b]).tick(xl); const br = unchecked(bodiesR[b]).tick(xr);
    l += xl * (1.0 - bodyAmt) * 0.6 + bl * bodyAmt; r += xr * (1.0 - bodyAmt) * 0.6 + br * bodyAmt;
  }
  // orchestral dynamics are timbre as much as level: pp dark, ff open
  const fc: f32 = 1400.0 + 15000.0 * dyn * dyn;
  if (Mathf.abs(fc - toneFc) > 20.0) { toneL.set(fc, 0.62); toneR.set(fc, 0.62); toneFc = fc; }
  toneL.tick(l); toneR.tick(r);
  hpL.tick(toneL.lp); hpR.tick(toneR.lp);
  secL = hpL.hp; secR = hpR.hp;
}

function releaseNote(note: i32): void {
  for (let i = 0; i < MAXV; i++) { const v = unchecked(voices[i]); if (v.active && v.note == note && v.gate) { v.gate = false; v.relAge = 0; } }
}
function activeCount(): i32 { let c = 0; for (let i = 0; i < MAXV; i++) if (unchecked(voices[i]).active) c++; return c; }
