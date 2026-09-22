// =====================================================================
//  TINEBAR ELECTRIC — a modal electric-piano model.
//  A struck tine is a cantilever beam: its partials are inharmonic
//  (1 : 6.27 : 17.55 : 34.4). It is coupled to a tuned tonebar whose slight
//  detune produces the slow chorus-like beating of the real instrument.
//  A hammer burst (Hardness, velocity) excites the modes, a low thump
//  resonator adds the felt hit, and a NONLINEAR PICKUP (Bark) turns the
//  clean sine into growl on hard strikes -- an asymmetric electromagnetic
//  pickup for the Rhodes model, a stronger electrostatic 2nd-harmonic
//  pickup for the reed (Wurlitzer) model. Damper felt on release, a
//  preamp, tone control, suitcase tremolo or auto-pan, key-dependent
//  stereo and a small room complete it. Twelve voices.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 19;
const NV: i32 = 12;
const NM: i32 = 6;                  // modes per voice: 0 tine, 1 tonebar, 2 bar-beat partner, 3 upper1, 4 upper2, 5 thump
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_MODEL: i32 = 0; const P_DECAY: i32 = 1; const P_BAR: i32 = 2;  const P_BEAT: i32 = 3;  const P_BELL: i32 = 4;
const P_HARD: i32 = 5;  const P_THUMP: i32 = 6; const P_BARK: i32 = 7; const P_TONE: i32 = 8;  const P_VELS: i32 = 9;
const P_REL: i32 = 10;  const P_TREMD: i32 = 11; const P_TREMR: i32 = 12; const P_TREMM: i32 = 13; const P_DRIVE: i32 = 14;
const P_WIDTH: i32 = 15; const P_SPACE: i32 = 16; const P_BEND: i32 = 17; const P_LEVEL: i32 = 18;

let sampleRate: f32 = 48000.0;
const vAct:  StaticArray<i32> = new StaticArray<i32>(NV);
const vGate: StaticArray<i32> = new StaticArray<i32>(NV);
const vNote: StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:  StaticArray<i32> = new StaticArray<i32>(NV);
const vVel:  StaticArray<f32> = new StaticArray<f32>(NV);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NV);
const vExc:  StaticArray<f32> = new StaticArray<f32>(NV);
const vExcLp: StaticArray<f32> = new StaticArray<f32>(NV);
const vRel:  StaticArray<f32> = new StaticArray<f32>(NV);
const vLev:  StaticArray<f32> = new StaticArray<f32>(NV);
const vPan:  StaticArray<f32> = new StaticArray<f32>(NV);
const y1: StaticArray<f32> = new StaticArray<f32>(NV * NM);
const y2: StaticArray<f32> = new StaticArray<f32>(NV * NM);
const ca: StaticArray<f32> = new StaticArray<f32>(NV * NM);
const cb: StaticArray<f32> = new StaticArray<f32>(NV * NM);
const cg: StaticArray<f32> = new StaticArray<f32>(NV * NM);
const excK: StaticArray<f32> = new StaticArray<f32>(NV);        // strike drive
const dcx: StaticArray<f32> = new StaticArray<f32>(2);
const dcy: StaticArray<f32> = new StaticArray<f32>(2);

let ageCounter: i32 = 0; let seed: u32 = 555;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let bendMulG: f32 = 1.0;
let tremPh: f32 = 0.0; let toneL: f32 = 0.0; let toneR: f32 = 0.0;

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
  for (let v = 0; v < NV; v++) { vAct[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 0.0; vFreq[v] = 440.0; vExc[v] = 0.0; vExcLp[v] = 0.0; vRel[v] = 1.0; vLev[v] = 0.0; vPan[v] = 0.0; excK[v] = 0.0; }
  for (let i = 0; i < NV * NM; i++) { y1[i] = 0.0; y2[i] = 0.0; ca[i] = 0.0; cb[i] = 0.0; cg[i] = 0.0; }
  for (let i = 0; i < 2; i++) { dcx[i] = 0.0; dcy[i] = 0.0; }
  ageCounter = 0; seed = 555; bendMulG = 1.0; bendN = 0.0; modWheel = 0.0; tremPh = 0.0; toneL = 0.0; toneR = 0.0;
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [0.0, 0.55, 0.5, 0.3, 0.45, 0.5, 0.35, 0.4, 0.55, 0.6, 0.35, 0.35, 0.3, 0.0, 0.25, 0.5, 0.2, 0.1667, 0.75];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) {
    bendN = clampf(value, -1.0, 1.0);
    bendMulG = f32(Mathf.pow(2.0, bendN * f32(i32(params[P_BEND] * 12.0 + 0.5)) / 12.0));
    for (let v = 0; v < NV; v++) if (vAct[v] == 1) tuneVoice(v);
  } else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
}

// modal resonator coefficients: frequency, T60 (s), gain
function setMode(i: i32, f: f32, t60: f32, gain: f32): void {
  const sr: f32 = sampleRate;
  if (f >= sr * 0.45 || t60 <= 0.0) { cg[i] = 0.0; ca[i] = 0.0; cb[i] = 0.0; return; }
  const r: f32 = f32(Mathf.exp(-6.908 / (t60 * sr)));
  const w: f32 = TWO_PI * f / sr;
  ca[i] = 2.0 * r * f32(Mathf.cos(w)); cb[i] = r * r;
  cg[i] = gain * (1.0 - r) * f32(Mathf.sin(w)) * 60.0;
}

// (re)tune every mode of a voice from its base frequency, the current parameters and the pitch-bend state
function tuneVoice(slot: i32): void {
  const fr: f32 = vFreq[slot] * bendMulG;
  const vl: f32 = vVel[slot];
  const wurli: bool = params[P_MODEL] > 0.5;
  const b: i32 = slot * NM;
  const hi: f32 = f32(Mathf.pow(261.6 / clampf(fr, 40.0, 3000.0), 0.55));
  const T: f32 = (0.5 + params[P_DECAY] * params[P_DECAY] * 9.0) * hi * (wurli ? 0.7 : 1.0);
  const vs: f32 = params[P_VELS];
  const bell: f32 = params[P_BELL] * (0.3 + vl * vs * 1.4 + (1.0 - vs) * 0.7);
  const beat: f32 = params[P_BEAT] * 2.6 * (fr / 261.6 > 1.0 ? f32(Mathf.pow(fr / 261.6, 0.3)) : 1.0);
  const r2: f32 = wurli ? 5.6 : 6.27; const r3: f32 = wurli ? 15.0 : 17.55;
  setMode(b + 0, fr, T, 1.0);
  setMode(b + 1, fr + beat, T * 1.25, params[P_BAR] * (wurli ? 0.35 : 0.9));       // coupled tonebar: slow beating
  setMode(b + 2, fr * 0.5 + beat * 0.5, T * 0.6, params[P_BAR] * 0.18);           // tonebar sub-octave
  setMode(b + 3, fr * r2, T * 0.09 + 0.05, bell * 0.55);
  setMode(b + 4, fr * r3, T * 0.035 + 0.02, bell * 0.28);
  setMode(b + 5, 110.0 + fr * 0.15, 0.05, params[P_THUMP] * 1.2);                 // felt thump
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) if (vAct[i] == 0) { slot = i; break; }
  if (slot < 0) { let o: i32 = 0; for (let i = 1; i < NV; i++) if (vAge[i] < vAge[o]) o = i; slot = o; }
  const fr: f32 = f > 20.0 ? f : 20.0;
  const vl: f32 = clampf(vel, 0.0, 1.0);
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++; vVel[slot] = vl; vFreq[slot] = fr;
  vExc[slot] = 1.0; vExcLp[slot] = 0.0; vRel[slot] = 1.0; vLev[slot] = 0.0;
  const midi: f32 = 69.0 + 12.0 * f32(Mathf.log(fr / 440.0) / Mathf.log(2.0));
  vPan[slot] = clampf((midi - 60.0) / 36.0, -1.0, 1.0);
  const b: i32 = slot * NM;
  for (let m = 0; m < NM; m++) { y1[b + m] = 0.0; y2[b + m] = 0.0; }
  tuneVoice(slot);
  excK[slot] = 0.25 + vl * 0.95;
}

export function noteOff(id: i32): void {
  for (let v = 0; v < NV; v++) if (vAct[v] == 1 && vGate[v] == 1 && vNote[v] == id) vGate[v] = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const hard: f32 = params[P_HARD];
  const excDec: f32 = f32(Mathf.exp(-1.0 / ((0.0006 + (1.0 - hard) * 0.004) * sr)));
  const excLp: f32 = 0.05 + hard * hard * 0.9;
  const relK: f32 = f32(Mathf.exp(-6.908 / ((0.03 + params[P_REL] * params[P_REL] * 2.5) * sr)));
  const wurli: bool = params[P_MODEL] > 0.5;
  const bark: f32 = params[P_BARK];
  const tone: f32 = params[P_TONE]; const toneK: f32 = 0.04 + tone * tone * 0.9;
  const tremD: f32 = params[P_TREMD]; const tremInc: f32 = (1.0 + params[P_TREMR] * 8.0) / sr;
  const autoPan: bool = params[P_TREMM] > 0.5;
  const drive: f32 = 1.0 + params[P_DRIVE] * 5.0;
  const width: f32 = params[P_WIDTH]; const space: f32 = params[P_SPACE]; const fbk: f32 = 0.78;
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.5;
  let lvOut: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    tremPh += tremInc; if (tremPh >= 1.0) tremPh -= 1.0;
    const lfo: f32 = f32(Mathf.sin(tremPh * TWO_PI));
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      // hammer burst
      let x: f32 = 0.0;
      const ex: f32 = vExc[v];
      if (ex > 0.001) { vExcLp[v] += excLp * (rnd() - vExcLp[v]); x = (vExcLp[v] * 0.8 + ex * 0.6) * ex * excK[v]; vExc[v] = ex * excDec; }
      if (vGate[v] == 0) vRel[v] *= relK;
      const b: i32 = v * NM;
      let s: f32 = 0.0;
      for (let m = 0; m < NM; m++) {
        const i: i32 = b + m;
        const g: f32 = cg[i];
        if (g == 0.0) continue;
        const y: f32 = ca[i] * y1[i] - cb[i] * y2[i] + g * x;
        y2[i] = y1[i]; y1[i] = y; s += y;
      }
      s *= vRel[v];
      vLev[v] = vLev[v] * 0.9995 + f32(Mathf.abs(s)) * 0.0005;
      if (vGate[v] == 0 && vLev[v] < 0.00002) vAct[v] = 0;
      if (vRel[v] < 0.0005) vAct[v] = 0;
      // nonlinear pickup: asymmetric electromagnetic (Rhodes) / electrostatic 2nd-harmonic (reed)
      const xn: f32 = s * (0.6 + vVel[v] * 0.7);
      let p: f32;
      if (wurli) p = (xn + bark * 1.1 * xn * xn) / (1.0 + bark * 1.6 * f32(Mathf.abs(xn)));
      else p = (xn + bark * 0.65 * xn * xn) / (1.0 + bark * 2.2 * xn * xn + bark * 0.4 * f32(Mathf.abs(xn)));
      const pan: f32 = clampf(vPan[v] * width, -1.0, 1.0);
      mixL += p * f32(Mathf.sqrt(0.5 * (1.0 - pan)));
      mixR += p * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
    }
    // DC block (asymmetric pickup) + preamp + tone
    let l: f32 = mixL - dcx[0] + 0.995 * dcy[0]; dcx[0] = mixL; dcy[0] = l;
    let r: f32 = mixR - dcx[1] + 0.995 * dcy[1]; dcx[1] = mixR; dcy[1] = r;
    l = f32(Mathf.tanh(l * drive * 0.7)); r = f32(Mathf.tanh(r * drive * 0.7));
    toneL += toneK * (l - toneL); toneR += toneK * (r - toneR);
    l = toneL + (l - toneL) * 0.35; r = toneR + (r - toneR) * 0.35;
    // suitcase tremolo (amplitude) or auto-pan
    if (autoPan) { const pan: f32 = lfo * tremD; const gl: f32 = f32(Mathf.sqrt(0.5 * (1.0 - pan))) * 1.414; const gr: f32 = f32(Mathf.sqrt(0.5 * (1.0 + pan))) * 1.414; l *= gl; r *= gr; }
    else { const g: f32 = 1.0 - tremD * (0.5 + 0.5 * lfo) * 0.8; l *= g; r *= g; }
    l *= level; r *= level;
    if (space > 0.001) {
      let wl: f32 = 0.0; let wr: f32 = 0.0;
      for (let c = 0; c < RVN; c++) {
        const len: i32 = rvLen[c]; const q: i32 = rvPos[c]; const oo: i32 = c * 2400 + q;
        const cL: f32 = rvBufL[oo]; const cR: f32 = rvBufR[oo];
        rvLpL[c] += 0.45 * (cL - rvLpL[c]); rvLpR[c] += 0.45 * (cR - rvLpR[c]);
        rvBufL[oo] = (l + r) * 0.35 + rvLpL[c] * fbk;
        rvBufR[oo] = (l - r) * 0.35 + (c & 1 ? -1.0 : 1.0) * rvLpR[c] * fbk + (l + r) * 0.2;
        rvPos[c] = q + 1 >= len ? 0 : q + 1;
        wl += cL; wr += cR;
      }
      l += wl * 0.28 * space; r += wr * 0.28 * space;
    }
    lvOut = f32(Mathf.abs(l)) + f32(Mathf.abs(r));
    outBuf[f] = l; outBuf[MAX_FRAMES + f] = r;
  }
  display[0] = clampf(lvOut, 0.0, 1.0);
}
