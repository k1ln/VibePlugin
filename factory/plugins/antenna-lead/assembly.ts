// =====================================================================
//  ANTENNA LEAD — a theremin-style monophonic lead.
//  A near-sine oscillator (Timbre adds the 2nd/3rd harmonics of a real
//  instrument) glides continuously between notes; a "volume hand"
//  envelope opens and closes the sound; slow random Drift makes pitch and
//  level wander like an unsupported hand; vibrato arrives after a delay.
//  A pair of parallel formant resonators (Formant / Body) gives the
//  vocal "oo-ah" character, Beat Noise adds heterodyne hiss, Sub and
//  Octave extend the range, and a small stereo room finishes it.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 19;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_GLIDE: i32 = 0;  const P_TIMBRE: i32 = 1; const P_FORM: i32 = 2;   const P_BODY: i32 = 3;  const P_VIB: i32 = 4;
const P_VIBR: i32 = 5;   const P_VIBD: i32 = 6;   const P_DRIFT: i32 = 7;  const P_ATK: i32 = 8;   const P_REL: i32 = 9;
const P_BEAT: i32 = 10;  const P_SUB: i32 = 11;   const P_OCT: i32 = 12;   const P_LEG: i32 = 13;  const P_SPACE: i32 = 14;
const P_SIZE: i32 = 15;  const P_BEND: i32 = 16;  const P_LEVEL: i32 = 17; const P_VELS: i32 = 18;

let sampleRate: f32 = 48000.0;
const hId:   StaticArray<i32> = new StaticArray<i32>(16);
const hFreq: StaticArray<f32> = new StaticArray<f32>(16);
const hVel:  StaticArray<f32> = new StaticArray<f32>(16);
let hCount: i32 = 0;

let gate: i32 = 0; let tgtLog: f32 = 8.78; let curLog: f32 = 8.78;   // log2(Hz)
let velN: f32 = 0.8; let env: f32 = 0.0; let noteAge: f32 = 0.0;
let ph: f32 = 0.0; let phS: f32 = 0.0; let vibPh: f32 = 0.0;
let dPitch: f32 = 0.0; let dPitchT: f32 = 0.0; let dAmp: f32 = 0.0; let dAmpT: f32 = 0.0; let dTimer: i32 = 0;
let f1Lo: f32 = 0.0; let f1Bp: f32 = 0.0; let f2Lo: f32 = 0.0; let f2Bp: f32 = 0.0;
let nzLp: f32 = 0.0; let seed: u32 = 4242;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0;

const RVN: i32 = 4;
const rvLen: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvBufL: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvBufR: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvPos: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvLpL: StaticArray<f32> = new StaticArray<f32>(RVN);
const rvLpR: StaticArray<f32> = new StaticArray<f32>(RVN);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  hCount = 0; gate = 0; tgtLog = 8.78; curLog = 8.78; velN = 0.8; env = 0.0; noteAge = 0.0;
  ph = 0.0; phS = 0.0; vibPh = 0.0; dPitch = 0.0; dPitchT = 0.0; dAmp = 0.0; dAmpT = 0.0; dTimer = 0;
  f1Lo = 0.0; f1Bp = 0.0; f2Lo = 0.0; f2Bp = 0.0; nzLp = 0.0; seed = 4242; bendN = 0.0; modWheel = 0.0; pressure = 0.0;
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [0.35, 0.35, 0.5, 0.4, 0.35, 0.5, 0.4, 0.25, 0.35, 0.45, 0.1, 0.0, 0.0, 1.0, 0.3, 0.5, 0.1667, 0.7, 0.5];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
}

@inline function log2f(x: f32): f32 { return f32(Mathf.log(x) / Mathf.log(2.0)); }

export function noteOn(id: i32, f: f32, vel: f32): void {
  const fr: f32 = f > 1.0 ? f : 1.0;
  const wasHeld: bool = hCount > 0;
  if (hCount < 16) { hId[hCount] = id; hFreq[hCount] = fr; hVel[hCount] = vel; hCount++; }
  tgtLog = log2f(fr); velN = clampf(vel, 0.0, 1.0);
  const legato: bool = params[P_LEG] > 0.5 && wasHeld;
  if (!legato) { curLog = params[P_GLIDE] < 0.02 ? tgtLog : curLog; noteAge = 0.0; if (env < 0.01) curLog = tgtLog; }
  gate = 1;
}

export function noteOff(id: i32): void {
  let k: i32 = -1;
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { k = i; break; }
  if (k < 0) return;
  for (let i = k; i < hCount - 1; i++) { hId[i] = hId[i + 1]; hFreq[i] = hFreq[i + 1]; hVel[i] = hVel[i + 1]; }
  hCount--;
  if (hCount > 0) { tgtLog = log2f(hFreq[hCount - 1]); velN = hVel[hCount - 1]; }
  else gate = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const glideT: f32 = 0.002 + params[P_GLIDE] * params[P_GLIDE] * 0.9;
  const gK: f32 = 1.0 - f32(Mathf.exp(-1.0 / (glideT * sr)));
  const tim: f32 = params[P_TIMBRE];
  const form: f32 = params[P_FORM]; const body: f32 = params[P_BODY];
  const vibD: f32 = params[P_VIB] + modWheel * 0.7 + pressure * 0.5;
  const vibInc: f32 = (3.5 + params[P_VIBR] * 4.5) / sr;
  const vibDelay: f32 = 0.05 + params[P_VIBD] * 1.2;
  const drift: f32 = params[P_DRIFT];
  const aK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.004 + params[P_ATK] * params[P_ATK] * 0.6) * sr)));
  const rK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.01 + params[P_REL] * params[P_REL] * 1.2) * sr)));
  const beat: f32 = params[P_BEAT]; const sub: f32 = params[P_SUB];
  const oct: f32 = f32(i32(params[P_OCT] - (params[P_OCT] < 0.0 ? 0.5 : -0.5)));
  const space: f32 = params[P_SPACE]; const fb: f32 = 0.72 + params[P_SIZE] * 0.25;
  const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.6;
  const velS: f32 = params[P_VELS];
  const F1: f32 = clampf(300.0 + form * 600.0, 60.0, sr * 0.2);
  const F2: f32 = clampf(900.0 + form * 1500.0, 60.0, sr * 0.2);
  const g1: f32 = 2.0 * f32(Mathf.sin(PI * F1 / sr)); const g2: f32 = 2.0 * f32(Mathf.sin(PI * F2 / sr));
  const qd: f32 = 1.0 / (2.0 + (1.0 - body) * 6.0);
  const dt: f32 = 1.0 / sr;
  let lvl: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    // hand drift: slow random walk, retargeted every ~120 ms
    dTimer--;
    if (dTimer <= 0) { dTimer = i32(0.12 * sr); dPitchT = rnd() * 18.0 * drift; dAmpT = rnd() * 0.35 * drift; }
    dPitch += (dPitchT - dPitch) * 0.0004; dAmp += (dAmpT - dAmp) * 0.0004;
    curLog += (tgtLog - curLog) * gK;
    noteAge += dt;
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    const vibAmt: f32 = clampf((noteAge - vibDelay * 0.4) / vibDelay, 0.0, 1.0);
    const semi: f32 = bendSemi + oct * 12.0 + f32(Mathf.sin(vibPh * TWO_PI)) * vibD * 0.9 * vibAmt + dPitch * 0.01;
    const fr: f32 = f32(Mathf.pow(2.0, curLog + semi / 12.0));
    // volume hand
    const tg: f32 = gate == 1 ? (1.0 - velS + velS * velN) * (1.0 + dAmp) : 0.0;
    env += ((tg > env) ? aK : rK) * (tg - env);
    // oscillator
    ph += fr / sr; if (ph >= 1.0) ph -= 1.0;
    const x: f32 = ph * TWO_PI;
    let s: f32 = f32(Mathf.sin(x)) + tim * 0.55 * f32(Mathf.sin(2.0 * x + 0.6)) + tim * 0.3 * f32(Mathf.sin(3.0 * x + 1.1)) + tim * 0.12 * f32(Mathf.sin(5.0 * x));
    s = f32(Mathf.tanh(s * (0.7 + tim * 0.6))) * 0.9;
    if (sub > 0.001) { phS += fr * 0.5 / sr; if (phS >= 1.0) phS -= 1.0; s += f32(Mathf.sin(phS * TWO_PI)) * sub * 0.6; }
    // body: parallel formant resonators
    let hp: f32 = s - f1Lo - qd * f1Bp; f1Bp += g1 * hp; f1Lo += g1 * f1Bp; const b1: f32 = f1Bp;
    hp = s - f2Lo - qd * f2Bp; f2Bp += g2 * hp; f2Lo += g2 * f2Bp; const b2: f32 = f2Bp;
    let y: f32 = s * (1.0 - body * 0.5) + (b1 + 0.6 * b2) * body * 0.9;
    // heterodyne hiss
    nzLp += 0.6 * (rnd() - nzLp);
    y += (rnd() - nzLp) * beat * 0.12 * (0.3 + env);
    y = y * env;
    lvl = env;
    let l: f32 = y * level; let r: f32 = y * level;
    if (space > 0.001) {
      let wl: f32 = 0.0; let wr: f32 = 0.0;
      for (let c = 0; c < RVN; c++) {
        const len: i32 = rvLen[c]; const p: i32 = rvPos[c];
        const oo: i32 = c * 2400 + p;
        const cL: f32 = rvBufL[oo]; const cR: f32 = rvBufR[oo];
        rvLpL[c] += 0.45 * (cL - rvLpL[c]); rvLpR[c] += 0.45 * (cR - rvLpR[c]);
        rvBufL[oo] = (l + r) * 0.35 + rvLpL[c] * fb;
        rvBufR[oo] = (l - r) * 0.35 + (c & 1 ? -1.0 : 1.0) * rvLpR[c] * fb + (l + r) * 0.2;
        rvPos[c] = p + 1 >= len ? 0 : p + 1;
        wl += cL; wr += cR;
      }
      l += wl * 0.3 * space; r += wr * 0.3 * space;
    }
    outBuf[f] = f32(Mathf.tanh(l)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r));
  }
  display[0] = lvl;
}
