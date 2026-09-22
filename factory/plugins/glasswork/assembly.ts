// =====================================================================
//  GLASSWORK — a modal-resonator instrument.
//  Each voice is a bank of NM two-pole resonators (one per vibrating
//  mode) tuned to a partial series that morphs between STRING -> BAR ->
//  BELL -> BOWL as Structure sweeps. A mallet burst strikes the modes;
//  optional Bow (rosin noise) and Breath (air noise) exciters keep them
//  singing while the key is held. Position combs the excitation the way
//  a pluck point does; Brightness/Damping/Tilt shape the spectrum and the
//  frequency-dependent decay. Two detuned banks per voice give width.
//  Pure algorithm: no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 8;          // voices
const NM: i32 = 24;         // max modes per bank
const NB: i32 = 2;          // banks per voice (L/R detune pair)
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const P_STRUCT: i32 = 0;   const P_BRIGHT: i32 = 1;   const P_DAMP: i32 = 2;    const P_TILT: i32 = 3;
const P_POS: i32 = 4;      const P_STRETCH: i32 = 5;  const P_MODES: i32 = 6;   const P_HARD: i32 = 7;
const P_STRIKE: i32 = 8;   const P_BOW: i32 = 9;      const P_BREATH: i32 = 10; const P_FLOW: i32 = 11;
const P_REL: i32 = 12;     const P_DETUNE: i32 = 13;  const P_WIDTH: i32 = 14;  const P_VELB: i32 = 15;
const P_VIB: i32 = 16;     const P_VIBR: i32 = 17;    const P_TUNE: i32 = 18;   const P_BEND: i32 = 19;
const P_SPACE: i32 = 20;   const P_SIZE: i32 = 21;    const P_DRIVE: i32 = 22;  const P_LEVEL: i32 = 23;
const NUM_PARAMS: i32 = 24;

let sampleRate: f32 = 48000.0;

// ---- partial tables: string / bar / bell / bowl ---------------------
const RAT: StaticArray<f32> = new StaticArray<f32>(4 * NM);

// ---- per-voice state -------------------------------------------------
const vNote:  StaticArray<i32> = new StaticArray<i32>(NV);
const vAct:   StaticArray<i32> = new StaticArray<i32>(NV);
const vGate:  StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:   StaticArray<i32> = new StaticArray<i32>(NV);
const vFreq:  StaticArray<f32> = new StaticArray<f32>(NV);
const vVel:   StaticArray<f32> = new StaticArray<f32>(NV);
const vExc:   StaticArray<f32> = new StaticArray<f32>(NV);  // mallet burst envelope
const vExcLP: StaticArray<f32> = new StaticArray<f32>(NV);
const vBowEnv: StaticArray<f32> = new StaticArray<f32>(NV);
const vBreEnv: StaticArray<f32> = new StaticArray<f32>(NV);
const vBowLP: StaticArray<f32> = new StaticArray<f32>(NV);
const vBreLP: StaticArray<f32> = new StaticArray<f32>(NV);
const vRel:   StaticArray<f32> = new StaticArray<f32>(NV);   // release gain 1..0
const vKick:  StaticArray<f32> = new StaticArray<f32>(NV);   // one-sample strike impulse
const vLevel: StaticArray<f32> = new StaticArray<f32>(NV);   // envelope follower for reaping
// resonator state: [voice][bank][mode]
const y1: StaticArray<f32> = new StaticArray<f32>(NV * NB * NM);
const y2: StaticArray<f32> = new StaticArray<f32>(NV * NB * NM);
const ca: StaticArray<f32> = new StaticArray<f32>(NV * NB * NM);  // a1 coefficient
const cr: StaticArray<f32> = new StaticArray<f32>(NV * NB * NM);  // a2 (= r^2)
const cg: StaticArray<f32> = new StaticArray<f32>(NV * NB * NM);  // input*output gain

let ageCounter: i32 = 0;
let seed: u32 = 22222;
let bendN: f32 = 0.0;
let modWheel: f32 = 0.0;
let pressure: f32 = 0.0;
let vibPh: f32 = 0.0;
let sinceCoef: i32 = 1 << 20;

// reverb (4 combs + 2 allpass per channel)
const RVN: i32 = 4;
const rvLen: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvBufL: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvBufR: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvPos: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvLpL: StaticArray<f32> = new StaticArray<f32>(RVN);
const rvLpR: StaticArray<f32> = new StaticArray<f32>(RVN);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 {
  seed = seed * 1664525 + 1013904223;
  return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  // partial ratio tables
  const bell: StaticArray<f32> = [1.0, 2.0, 2.4, 3.0, 4.1, 4.75, 5.9, 6.9, 8.0, 9.2] as StaticArray<f32>;
  for (let k = 0; k < NM; k++) {
    const kf: f32 = f32(k);
    RAT[k] = kf + 1.0;                                             // string
    const b: f32 = (2.0 * kf + 3.0) / 3.0; RAT[NM + k] = b * b;    // free-free bar
    RAT[2 * NM + k] = k < 10 ? bell[k] : 9.2 + (kf - 9.0) * 1.37;  // bell
    const w: f32 = (kf + 1.7) / 1.7; RAT[3 * NM + k] = f32(Mathf.pow(w, 1.9)); // bowl
  }
  for (let v = 0; v < NV; v++) {
    vNote[v] = -1; vAct[v] = 0; vGate[v] = 0; vAge[v] = 0; vFreq[v] = 440.0; vVel[v] = 0.0;
    vExc[v] = 0.0; vExcLP[v] = 0.0; vBowEnv[v] = 0.0; vBreEnv[v] = 0.0;
    vBowLP[v] = 0.0; vBreLP[v] = 0.0; vRel[v] = 0.0; vKick[v] = 0.0; vLevel[v] = 0.0;
  }
  for (let i = 0; i < NV * NB * NM; i++) { y1[i] = 0.0; y2[i] = 0.0; ca[i] = 0.0; cr[i] = 0.0; cg[i] = 0.0; }
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  ageCounter = 0; seed = 22222; bendN = 0.0; modWheel = 0.0; pressure = 0.0; vibPh = 0.0; sinceCoef = 1 << 20;
  const d: f32[] = [0.35, 0.6, 0.45, 0.4, 0.28, 0.1, 0.8, 0.5, 0.75, 0.0, 0.0, 0.5, 0.4, 0.25, 0.7, 0.5, 0.15, 0.4, 0.5, 0.1667, 0.25, 0.5, 0.15, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) if (vAct[i] == 0) { slot = i; break; }
  if (slot < 0) {
    let o: i32 = 0; let oa: i32 = vAge[0];
    for (let i = 1; i < NV; i++) if (vAge[i] < oa) { oa = vAge[i]; o = i; }
    slot = o;
  }
  const base: i32 = slot * NB * NM;
  for (let i = 0; i < NB * NM; i++) { y1[base + i] = 0.0; y2[base + i] = 0.0; }
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++;
  vFreq[slot] = f > 1.0 ? f : 1.0; vVel[slot] = clampf(vel, 0.0, 1.0);
  vExc[slot] = 1.0; vExcLP[slot] = 0.0; vKick[slot] = 1.0;
  vBowEnv[slot] = 0.0; vBreEnv[slot] = 0.0; vBowLP[slot] = 0.0; vBreLP[slot] = 0.0;
  vRel[slot] = 1.0; vLevel[slot] = 0.0;
  sinceCoef = 1 << 20;   // recompute coefficients before the next sample
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NV; i++) if (vAct[i] == 1 && vGate[i] == 1 && vNote[i] == id) vGate[i] = 0;
}

// ratio of mode k for Structure s (0..1 sweeps string->bar->bell->bowl), stretched
@inline function ratioOf(k: i32, s: f32, stretch: f32): f32 {
  const x: f32 = clampf(s, 0.0, 1.0) * 3.0;
  let a: i32 = i32(x); if (a > 2) a = 2;
  const t: f32 = x - f32(a);
  const r0: f32 = RAT[a * NM + k]; const r1: f32 = RAT[(a + 1) * NM + k];
  const r: f32 = r0 * f32(Mathf.pow(r1 / r0, t));       // geometric morph
  const kk: f32 = f32(k + 1);
  return r * f32(Mathf.sqrt(1.0 + stretch * 0.004 * kk * kk));
}

// recompute all resonator coefficients (called ~every 64 samples, and after noteOn)
function updateCoefs(): void {
  const sr: f32 = sampleRate;
  const st: f32 = params[P_STRUCT];
  const bright: f32 = params[P_BRIGHT];
  const dampN: f32 = params[P_DAMP];
  const tilt: f32 = params[P_TILT];
  const pos: f32 = params[P_POS];
  const stretch: f32 = params[P_STRETCH];
  const nModes: i32 = 4 + i32(params[P_MODES] * f32(NM - 4) + 0.5);
  const detune: f32 = params[P_DETUNE];
  const vibSemi: f32 = (params[P_VIB] * 0.6 + modWheel * 0.9) * f32(Mathf.sin(vibPh * TWO_PI)) * 0.35;
  const bendSemi: f32 = bendN * (1.0 + f32(i32(params[P_BEND] * 12.0 + 0.5)) - 1.0);
  const tuneC: f32 = (params[P_TUNE] - 0.5) * 1.0;   // +-50 cents
  const T0: f32 = 0.08 + dampN * dampN * 9.0 * (1.0 + pressure * 0.0);
  const slope: f32 = 2.6 - bright * 2.2;             // spectral tilt of mode gains
  const posArg: f32 = 0.06 + pos * 0.44;

  for (let v = 0; v < NV; v++) {
    if (vAct[v] == 0) continue;
    const semis: f32 = bendSemi + vibSemi + tuneC * 0.01 * 0.0 + tuneC;
    const f0: f32 = vFreq[v] * f32(Mathf.pow(2.0, semis / 12.0));
    const velB: f32 = 1.0 + (vVel[v] - 0.5) * params[P_VELB] * 2.4;   // velocity opens the top
    for (let b = 0; b < NB; b++) {
      const dt: f32 = (b == 0 ? -1.0 : 1.0) * detune * 0.012;         // +-1.2% partial detune
      const base: i32 = (v * NB + b) * NM;
      for (let k = 0; k < NM; k++) {
        const idx: i32 = base + k;
        if (k >= nModes) { cg[idx] = 0.0; ca[idx] = 0.0; cr[idx] = 0.0; continue; }
        const rt: f32 = ratioOf(k, st, stretch);
        const fk: f32 = f0 * rt * (1.0 + dt * f32(k + 1) * 0.5);
        if (fk >= sr * 0.45) { cg[idx] = 0.0; ca[idx] = 0.0; cr[idx] = 0.0; continue; }
        // frequency-dependent decay: high modes die sooner as Tilt rises
        const t60: f32 = T0 / (1.0 + tilt * 6.0 * f32(Mathf.pow(rt, 0.8)) * 0.35);
        const r: f32 = f32(Mathf.exp(-6.908 / (clampf(t60, 0.01, 30.0) * sr)));
        const w: f32 = TWO_PI * fk / sr;
        // gain: brightness slope, pluck-position comb, velocity brightness
        const kk: f32 = f32(k + 1);
        let g: f32 = f32(Mathf.pow(kk, -slope * 0.5 * velB));
        const comb: f32 = f32(Mathf.abs(f32(Mathf.sin(3.14159265 * kk * posArg))));
        g *= 0.25 + 0.75 * comb;
        ca[idx] = 2.0 * r * f32(Mathf.cos(w));
        cr[idx] = r * r;
        cg[idx] = g * (1.0 - r) * f32(Mathf.sin(w)) * 100.0;
      }
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const hardN: f32 = params[P_HARD];
  const strike: f32 = params[P_STRIKE];
  const bowAmt: f32 = params[P_BOW];
  const breAmt: f32 = params[P_BREATH];
  const flow: f32 = params[P_FLOW];
  const relT: f32 = 0.03 + params[P_REL] * params[P_REL] * 3.0;
  const relK: f32 = f32(Mathf.exp(-1.0 / (relT * sr)));
  const width: f32 = params[P_WIDTH];
  const drive: f32 = 1.0 + params[P_DRIVE] * 5.0;
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.6;
  const space: f32 = params[P_SPACE];
  const fb: f32 = 0.72 + params[P_SIZE] * 0.25;
  const vibInc: f32 = (0.5 + params[P_VIBR] * 7.0) / sr;
  const excLPc: f32 = 0.02 + hardN * hardN * 0.9;                 // mallet brightness
  const excDec: f32 = f32(Mathf.exp(-1.0 / ((0.0012 + (1.0 - hardN) * 0.012) * sr)));
  const bowLPc: f32 = 0.05 + bowAmt * 0.12 + pressure * 0.15;
  const breLPc: f32 = 0.03 + flow * 0.14;
  const envAtk: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.01 + (1.0 - flow) * 0.25) * sr)));
  const kV: f32 = 0.5;

  for (let f = 0; f < n; f++) {
    if (sinceCoef >= 64) { updateCoefs(); sinceCoef = 0; }
    sinceCoef++;
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;

    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      const vel: f32 = vVel[v];
      // ---- exciters -------------------------------------------------
      let x: f32 = 0.0;
      let ex: f32 = vExc[v];
      if (ex > 0.0005) {
        vExcLP[v] += excLPc * (rnd() - vExcLP[v]);
        x += (vExcLP[v] * ex * 3.0 + vKick[v] * 0.6) * strike * (0.25 + vel * 0.9);
        vExc[v] = ex * excDec;
      }
      vKick[v] = 0.0;
      if (vGate[v] == 1) {
        vBowEnv[v] += envAtk * (bowAmt - vBowEnv[v]);
        vBreEnv[v] += envAtk * (breAmt - vBreEnv[v]);
      } else {
        vBowEnv[v] *= 0.9990; vBreEnv[v] *= 0.9990;
      }
      const nz: f32 = rnd();
      vBowLP[v] += bowLPc * (nz - vBowLP[v]);
      vBreLP[v] += breLPc * (nz - vBreLP[v]);
      x += (vBowLP[v] * 0.9 * vBowEnv[v] * (0.4 + vel * 0.9 + pressure) + vBreLP[v] * 1.1 * vBreEnv[v] * (0.4 + vel)) * 0.7;

      // ---- release gain ---------------------------------------------
      if (vGate[v] == 0) vRel[v] *= relK;
      const rg: f32 = vRel[v];
      // ---- resonator banks -------------------------------------------
      let sL: f32 = 0.0; let sR: f32 = 0.0;
      const base: i32 = v * NB * NM;
      for (let k = 0; k < NM; k++) {
        const iL: i32 = base + k;
        const iR: i32 = base + NM + k;
        const gL: f32 = cg[iL];
        if (gL != 0.0) {
          const yl: f32 = ca[iL] * y1[iL] - cr[iL] * y2[iL] + gL * x;
          y2[iL] = y1[iL]; y1[iL] = yl; sL += yl;
        }
        const gR: f32 = cg[iR];
        if (gR != 0.0) {
          const yr: f32 = ca[iR] * y1[iR] - cr[iR] * y2[iR] + gR * x;
          y2[iR] = y1[iR]; y1[iR] = yr; sR += yr;
        }
      }
      sL *= rg; sR *= rg;
      // reap quiet voices
      const lv: f32 = f32(Mathf.abs(sL)) + f32(Mathf.abs(sR)) + vExc[v] + vBowEnv[v] + vBreEnv[v];
      vLevel[v] = vLevel[v] * 0.999 + lv * 0.001;
      if (vGate[v] == 0 && vLevel[v] < 0.00002) vAct[v] = 0;
      if (rg < 0.0005) vAct[v] = 0;
      // stereo: width crossfades between the mono sum and the L/R bank pair
      const mid: f32 = (sL + sR) * 0.5;
      mixL += mid + (sL - mid) * width;
      mixR += mid + (sR - mid) * width;
    }
    let l: f32 = f32(Mathf.tanh(mixL * drive * kV)) * level;
    let r: f32 = f32(Mathf.tanh(mixR * drive * kV)) * level;
    // ---- space (small stereo comb reverb) ------------------------------
    if (space > 0.001) {
      let wl: f32 = 0.0; let wr: f32 = 0.0;
      for (let c = 0; c < RVN; c++) {
        const len: i32 = rvLen[c]; const p: i32 = rvPos[c];
        const oL: i32 = c * 2400 + p;
        const cL: f32 = rvBufL[oL]; const cR: f32 = rvBufR[oL];
        rvLpL[c] += 0.45 * (cL - rvLpL[c]); rvLpR[c] += 0.45 * (cR - rvLpR[c]);
        rvBufL[oL] = (l + r) * 0.35 + rvLpL[c] * fb;
        rvBufR[oL] = (l - r) * 0.35 + (c & 1 ? -1.0 : 1.0) * rvLpR[c] * fb + (l + r) * 0.2;
        rvPos[c] = p + 1 >= len ? 0 : p + 1;
        wl += cL; wr += cR;
      }
      l += wl * 0.28 * space; r += wr * 0.28 * space;
    }
    outBuf[f] = l;
    outBuf[MAX_FRAMES + f] = r;
  }
}
