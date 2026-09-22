// =====================================================================
//  PLUCKWORK — a plucked-string instrument (digital waveguide).
//  Each voice is a double-course string pair: a delay-line loop with
//  fractional tuning, a loop low-pass (Brightness), two allpass stages of
//  dispersion (Stiffness), an optional nonlinear bridge (Buzz, the sitar
//  jawari), a pitch-falling Twang, and a damper felt on note-off. The
//  string is struck by a comb-filtered noise burst (Pick Position /
//  Hardness / velocity). The summed strings drive a four-resonator soundbox
//  (Body Mix / Size) and a bank of eight tuned sympathetic strings, then a
//  small stereo room. Character presets (in the GUI) configure it as nylon
//  or steel guitar, harp, harpsichord, koto, banjo or sitar.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 20;
const NV: i32 = 8;
const NS: i32 = 16;          // strings (2 per voice)
const KSN: i32 = 4096;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_CHAR: i32 = 0;   const P_POS: i32 = 1;   const P_HARD: i32 = 2;  const P_BRIGHT: i32 = 3; const P_DECAY: i32 = 4;
const P_STIFF: i32 = 5;  const P_BODY: i32 = 6;  const P_SIZE: i32 = 7;  const P_TWANG: i32 = 8;  const P_BUZZ: i32 = 9;
const P_DET: i32 = 10;   const P_DAMP: i32 = 11; const P_MUTE: i32 = 12; const P_SYMP: i32 = 13;  const P_STUN: i32 = 14;
const P_VELS: i32 = 15;  const P_WIDTH: i32 = 16; const P_SPACE: i32 = 17; const P_BEND: i32 = 18; const P_LEVEL: i32 = 19;

let sampleRate: f32 = 48000.0;

const ksBuf: StaticArray<f32> = new StaticArray<f32>(NS * KSN);
const sPos: StaticArray<i32> = new StaticArray<i32>(NS);
const sLp:  StaticArray<f32> = new StaticArray<f32>(NS);
const sAp1: StaticArray<f32> = new StaticArray<f32>(NS);
const sAp2: StaticArray<f32> = new StaticArray<f32>(NS);
const sApx1: StaticArray<f32> = new StaticArray<f32>(NS);
const sApx2: StaticArray<f32> = new StaticArray<f32>(NS);
const sFreq: StaticArray<f32> = new StaticArray<f32>(NS);
const vAct:  StaticArray<i32> = new StaticArray<i32>(NV);
const vGate: StaticArray<i32> = new StaticArray<i32>(NV);
const vNote: StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:  StaticArray<i32> = new StaticArray<i32>(NV);
const vTw:   StaticArray<f32> = new StaticArray<f32>(NV);
const vRelG: StaticArray<f32> = new StaticArray<f32>(NV);
const vLev:  StaticArray<f32> = new StaticArray<f32>(NV);

// soundbox
const bLo: StaticArray<f32> = new StaticArray<f32>(4); const bBp: StaticArray<f32> = new StaticArray<f32>(4);
const BODYF: StaticArray<f32> = [95.0, 190.0, 420.0, 1200.0];
const BODYG: StaticArray<f32> = [1.0, 0.9, 0.6, 0.4];
// sympathetic strings
const SYMF: StaticArray<f32> = [
  82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 164.81, 220.0,
  130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63,
  138.59, 155.56, 207.65, 277.18, 311.13, 415.3, 554.37, 622.25,
  110.0, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66
];
const symBuf: StaticArray<f32> = new StaticArray<f32>(8 * KSN);
const symPos: StaticArray<i32> = new StaticArray<i32>(8);
const symLp:  StaticArray<f32> = new StaticArray<f32>(8);

const RVN: i32 = 4;
const rvLen: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvBufL: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvBufR: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvPos: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvLpL: StaticArray<f32> = new StaticArray<f32>(RVN);
const rvLpR: StaticArray<f32> = new StaticArray<f32>(RVN);

let dcLx: f32 = 0.0; let dcLy: f32 = 0.0; let dcRx: f32 = 0.0; let dcRy: f32 = 0.0;
let ageCounter: i32 = 0; let seed: u32 = 31337;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let vibPh: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < NS * KSN; i++) ksBuf[i] = 0.0;
  for (let i = 0; i < NS; i++) { sPos[i] = 0; sLp[i] = 0.0; sAp1[i] = 0.0; sAp2[i] = 0.0; sApx1[i] = 0.0; sApx2[i] = 0.0; sFreq[i] = 440.0; }
  for (let v = 0; v < NV; v++) { vAct[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vTw[v] = 0.0; vRelG[v] = 1.0; vLev[v] = 0.0; }
  for (let i = 0; i < 4; i++) { bLo[i] = 0.0; bBp[i] = 0.0; }
  for (let i = 0; i < 8 * KSN; i++) symBuf[i] = 0.0;
  for (let i = 0; i < 8; i++) { symPos[i] = 0; symLp[i] = 0.0; }
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  dcLx = 0.0; dcLy = 0.0; dcRx = 0.0; dcRy = 0.0; ageCounter = 0; seed = 31337; bendN = 0.0; modWheel = 0.0; vibPh = 0.0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  // nylon guitar
  const d: f32[] = [0.0, 0.17, 0.35, 0.55, 0.5, 0.05, 0.55, 0.5, 0.0, 0.0, 0.0, 0.4, 0.0, 0.25, 1.0, 0.6, 0.55, 0.25, 0.1667, 0.75];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  const sr: f32 = sampleRate;
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) if (vAct[i] == 0) { slot = i; break; }
  if (slot < 0) { let o: i32 = 0; for (let i = 1; i < NV; i++) if (vAge[i] < vAge[o]) o = i; slot = o; }
  const fr: f32 = f > 20.0 ? f : 20.0;
  const vl: f32 = clampf(vel, 0.0, 1.0);
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++; vTw[slot] = 1.0; vRelG[slot] = 1.0; vLev[slot] = 0.0;
  const det: f32 = params[P_DET] * 20.0;
  const pick: f32 = 0.04 + params[P_POS] * 0.46;
  const col: f32 = 0.08 + params[P_HARD] * 0.9;
  const amp: f32 = (0.25 + 0.75 * f32(Mathf.pow(vl, 0.5 + params[P_VELS] * 1.2))) * 1.1;
  for (let s = 0; s < 2; s++) {
    const i: i32 = slot * 2 + s;
    const cents: f32 = s == 0 ? -det : det;
    const fs: f32 = fr * f32(Mathf.pow(2.0, cents / 1200.0));
    sFreq[i] = fs;
    let L: i32 = i32(sr / fs); if (L < 8) L = 8; if (L > KSN - 3) L = KSN - 3;
    const base: i32 = i * KSN;
    for (let k = 0; k < KSN; k++) ksBuf[base + k] = 0.0;
    let lp: f32 = 0.0; let mean: f32 = 0.0;
    for (let k = 0; k < L; k++) { lp += col * (rnd() - lp); ksBuf[base + k] = lp; mean += lp; }
    mean /= f32(L);
    const pd: i32 = i32(pick * f32(L));
    for (let k = L - 1; k >= 0; k--) { let x: f32 = ksBuf[base + k] - mean; if (k >= pd && pd > 0) x -= (ksBuf[base + k - pd] - mean); ksBuf[base + k] = x * amp; }
    sPos[i] = L; sLp[i] = 0.0; sAp1[i] = 0.0; sAp2[i] = 0.0; sApx1[i] = 0.0; sApx2[i] = 0.0;
  }
}

export function noteOff(id: i32): void {
  for (let v = 0; v < NV; v++) if (vAct[v] == 1 && vGate[v] == 1 && vNote[v] == id) vGate[v] = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const bright: f32 = params[P_BRIGHT]; const kk: f32 = 0.22 + bright * 0.75;
  const decT: f32 = 0.25 + params[P_DECAY] * params[P_DECAY] * 12.0;
  const stiff: f32 = params[P_STIFF] * 0.55;
  const apA: f32 = -stiff;                                        // allpass coefficient
  const apDelay: f32 = stiff > 0.001 ? 2.0 * (1.0 - apA) / (1.0 + apA) : 0.0;
  const lpDelay: f32 = (1.0 - kk) / kk;
  const twang: f32 = params[P_TWANG]; const twK: f32 = f32(Mathf.exp(-1.0 / (0.14 * sr)));
  const buzz: f32 = params[P_BUZZ]; const bzk: f32 = 1.0 + buzz * 7.0;
  const dampRel: f32 = params[P_DAMP]; const relT: f32 = 0.03 + (1.0 - dampRel) * (1.0 - dampRel) * 4.0;
  const mute: f32 = params[P_MUTE];
  const bodyMix: f32 = params[P_BODY]; const bsz: f32 = f32(Mathf.pow(2.0, (params[P_SIZE] - 0.5) * 2.0));
  const symAmt: f32 = params[P_SYMP]; const stun: i32 = i32(params[P_STUN] + 0.5);
  const width: f32 = params[P_WIDTH]; const space: f32 = params[P_SPACE]; const fbk: f32 = 0.78;
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.8;
  const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const vibInc: f32 = 5.5 / sr;
  const dcoef: i32 = 0;
  let lvOut: f32 = 0.0;
  // body coefficients
  const bg0: f32 = 2.0 * f32(Mathf.sin(PI * clampf(BODYF[0] * bsz, 40.0, sr * 0.2) / sr));
  const bg1: f32 = 2.0 * f32(Mathf.sin(PI * clampf(BODYF[1] * bsz, 40.0, sr * 0.2) / sr));
  const bg2: f32 = 2.0 * f32(Mathf.sin(PI * clampf(BODYF[2] * bsz, 40.0, sr * 0.2) / sr));
  const bg3: f32 = 2.0 * f32(Mathf.sin(PI * clampf(BODYF[3] * bsz, 40.0, sr * 0.2) / sr));
  const bqd: f32 = 0.09;

  for (let f = 0; f < n; f++) {
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    const pm: f32 = f32(Mathf.pow(2.0, (bendSemi + f32(Mathf.sin(vibPh * TWO_PI)) * modWheel * 0.5) * (1.0 / 12.0)));
    let mono: f32 = 0.0; let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      vTw[v] *= twK;
      const tw: f32 = 1.0 + twang * 0.035 * vTw[v];
      let vs: f32 = 0.0;
      for (let s = 0; s < 2; s++) {
        const i: i32 = v * 2 + s; const base: i32 = i * KSN;
        const fs: f32 = sFreq[i] * pm * tw;
        let D: f32 = sr / fs - lpDelay - apDelay; if (D < 2.0) D = 2.0; if (D > f32(KSN - 3)) D = f32(KSN - 3);
        const wp: i32 = sPos[i];
        let rp: f32 = f32(wp) - D; if (rp < 0.0) rp += f32(KSN);
        const ri: i32 = i32(rp); const rf: f32 = rp - f32(ri);
        const r0: i32 = ri >= KSN ? ri - KSN : ri; const r1: i32 = r0 + 1 >= KSN ? 0 : r0 + 1;
        let y: f32 = ksBuf[base + r0] * (1.0 - rf) + ksBuf[base + r1] * rf;
        vs += y;
        // dispersion (two allpass stages)
        if (stiff > 0.001) {
          let a1: f32 = apA * y + sApx1[i] - apA * sAp1[i]; sApx1[i] = y; sAp1[i] = a1;
          let a2: f32 = apA * a1 + sApx2[i] - apA * sAp2[i]; sApx2[i] = a1; sAp2[i] = a2;
          y = a2;
        }
        // damping: loop low-pass; per-cycle gain from decay time (shorter for high notes) and mutes
        let t60: f32 = decT * f32(Mathf.pow(220.0 / clampf(fs, 55.0, 3000.0), 0.35)) / (1.0 + mute * 14.0);
        if (vGate[v] == 0) t60 = t60 * relT / (t60 + relT);
        const g: f32 = f32(Mathf.exp(-6.908 / (clampf(t60, 0.02, 40.0) * fs)));
        let lp: f32 = sLp[i]; lp += kk * (y - lp); sLp[i] = lp;
        let w: f32 = lp * g;
        if (buzz > 0.001) w = f32(Mathf.tanh(w * bzk)) / bzk;
        ksBuf[base + wp] = w;
        sPos[i] = wp + 1 >= KSN ? 0 : wp + 1;
      }
      vs *= 0.5;
      vLev[v] = vLev[v] * 0.9995 + f32(Mathf.abs(vs)) * 0.0005;
      if (vLev[v] < 0.000015 && vGate[v] == 0) vAct[v] = 0;
      if (vLev[v] < 0.000004 && vAge[v] + 0 >= 0 && vTw[v] < 0.001) vAct[v] = 0;
      mono += vs;
      const pr: i32 = (v >> 1) + 1;
      const pan: f32 = clampf(((v & 1) == 1 ? -1.0 : 1.0) * f32(pr) * 0.16 * width, -1.0, 1.0);
      mixL += vs * f32(Mathf.sqrt(0.5 * (1.0 - pan)));
      mixR += vs * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
    }
    // soundbox
    let bo: f32 = 0.0;
    if (bodyMix > 0.001) {
      let hp: f32 = mono - bLo[0] - bqd * bBp[0]; bBp[0] += bg0 * hp; bLo[0] += bg0 * bBp[0]; bo += bBp[0] * BODYG[0];
      hp = mono - bLo[1] - bqd * bBp[1]; bBp[1] += bg1 * hp; bLo[1] += bg1 * bBp[1]; bo += bBp[1] * BODYG[1];
      hp = mono - bLo[2] - bqd * bBp[2]; bBp[2] += bg2 * hp; bLo[2] += bg2 * bBp[2]; bo += bBp[2] * BODYG[2];
      hp = mono - bLo[3] - bqd * bBp[3]; bBp[3] += bg3 * hp; bLo[3] += bg3 * bBp[3]; bo += bBp[3] * BODYG[3];
      bo *= bodyMix * 0.32;
    }
    // sympathetic strings
    let sy: f32 = 0.0;
    if (stun > 0 && symAmt > 0.001) {
      for (let k = 0; k < 8; k++) {
        const sb: i32 = k * KSN; let dl: i32 = i32(sr / SYMF[(stun - 1) * 8 + k] + 0.5); if (dl > KSN - 2) dl = KSN - 2;
        let rp: i32 = symPos[k] - dl; if (rp < 0) rp += KSN;
        const yy: f32 = symBuf[sb + rp];
        symLp[k] += 0.5 * (yy - symLp[k]);
        symBuf[sb + symPos[k]] = mono * 0.02 + symLp[k] * 0.9985;
        symPos[k] = symPos[k] + 1 >= KSN ? 0 : symPos[k] + 1;
        sy += yy;
      }
      sy *= symAmt * 3.0;
    }
    let l: f32 = (mixL * (1.0 - bodyMix * 0.3) + bo + sy) * level;
    let r: f32 = (mixR * (1.0 - bodyMix * 0.3) + bo + sy) * level;
    if (space > 0.001) {
      let wl: f32 = 0.0; let wr: f32 = 0.0;
      for (let c = 0; c < RVN; c++) {
        const len: i32 = rvLen[c]; const p: i32 = rvPos[c]; const oo: i32 = c * 2400 + p;
        const cL: f32 = rvBufL[oo]; const cR: f32 = rvBufR[oo];
        rvLpL[c] += 0.45 * (cL - rvLpL[c]); rvLpR[c] += 0.45 * (cR - rvLpR[c]);
        rvBufL[oo] = (l + r) * 0.35 + rvLpL[c] * fbk;
        rvBufR[oo] = (l - r) * 0.35 + (c & 1 ? -1.0 : 1.0) * rvLpR[c] * fbk + (l + r) * 0.2;
        rvPos[c] = p + 1 >= len ? 0 : p + 1;
        wl += cL; wr += cR;
      }
      l += wl * 0.3 * space; r += wr * 0.3 * space;
    }
    const ly: f32 = l - dcLx + 0.996 * dcLy; dcLx = l; dcLy = ly; l = ly;
    const ry: f32 = r - dcRx + 0.996 * dcRy; dcRx = r; dcRy = ry; r = ry;
    lvOut = f32(Mathf.abs(l)) + f32(Mathf.abs(r));
    outBuf[f] = f32(Mathf.tanh(l)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r));
  }
  display[0] = clampf(lvOut * 1.5, 0.0, 1.0);
}
