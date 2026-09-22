// =====================================================================
//  POLYHEDRA — a nine-engine macro-oscillator voice with a low-pass gate.
//  ENGINE picks the sound source; HARMONICS / TIMBRE / MORPH are re-mapped
//  by each engine to its three most musical axes:
//   0 ANALOG   detuned/interval saw+pulse pair      (interval, width, saw>pulse)
//   1 FM       two-operator FM with feedback        (ratio, index, feedback)
//   2 FOLD     wavefolder on sine/triangle          (bias, fold, sine>tri)
//   3 ADDITIVE 12-harmonic spectrum                 (tilt, odd/even, formant peak)
//   4 STRING   Karplus-Strong plucked string        (pluck point, damping, pick colour)
//   5 BELL     inharmonic modal partials            (inharmonicity, brightness, damping tilt)
//   6 NOISE    resonant filtered noise / dust       (density, centre, Q)
//   7 VOWEL    saw through three formant filters    (vowel, Q, formant shift)
//   8 KICK     pitch-swept sine drum                (sweep depth, drive/click, sweep time)
//  A struck-or-gated envelope drives both loudness and a low-pass gate.
//  Eight voices, stereo spread, vibrato/LFO/velocity/envelope modulation,
//  ping-pong echo. Pure algorithm: no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 8;
const KSN: i32 = 4096;
const NH: i32 = 12;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;
const ECHO_N: i32 = 65536;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const P_ENGINE: i32 = 0;  const P_HARM: i32 = 1;    const P_TIMBRE: i32 = 2;  const P_MORPH: i32 = 3;
const P_DECAY: i32 = 4;   const P_ATTACK: i32 = 5;  const P_GATE: i32 = 6;    const P_REL: i32 = 7;
const P_COLOR: i32 = 8;   const P_ENVMOD: i32 = 9;  const P_LFOMOD: i32 = 10; const P_LFORATE: i32 = 11;
const P_VELMOD: i32 = 12; const P_SUB: i32 = 13;    const P_AIR: i32 = 14;    const P_SPREAD: i32 = 15;
const P_VIB: i32 = 16;    const P_VIBR: i32 = 17;   const P_TUNE: i32 = 18;   const P_BEND: i32 = 19;
const P_ECHO: i32 = 20;   const P_ETIME: i32 = 21;  const P_DRIVE: i32 = 22;  const P_LEVEL: i32 = 23;
const NUM_PARAMS: i32 = 24;

let sampleRate: f32 = 48000.0;

const vNote:  StaticArray<i32> = new StaticArray<i32>(NV);
const vAct:   StaticArray<i32> = new StaticArray<i32>(NV);
const vGate:  StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:   StaticArray<i32> = new StaticArray<i32>(NV);
const vStage: StaticArray<i32> = new StaticArray<i32>(NV);
const vFreq:  StaticArray<f32> = new StaticArray<f32>(NV);
const vVel:   StaticArray<f32> = new StaticArray<f32>(NV);
const vEnv:   StaticArray<f32> = new StaticArray<f32>(NV);
const vPh:    StaticArray<f32> = new StaticArray<f32>(NV);
const vPh2:   StaticArray<f32> = new StaticArray<f32>(NV);
const vPhM:   StaticArray<f32> = new StaticArray<f32>(NV);
const vPhS:   StaticArray<f32> = new StaticArray<f32>(NV);
const vFb:    StaticArray<f32> = new StaticArray<f32>(NV);
const vLp1:   StaticArray<f32> = new StaticArray<f32>(NV);
const vLp2:   StaticArray<f32> = new StaticArray<f32>(NV);
const vPEnv:  StaticArray<f32> = new StaticArray<f32>(NV);   // kick pitch env
const vHP:    StaticArray<f32> = new StaticArray<f32>(NV);
const svLo:   StaticArray<f32> = new StaticArray<f32>(NV * 3);
const svBp:   StaticArray<f32> = new StaticArray<f32>(NV * 3);
const hPh:    StaticArray<f32> = new StaticArray<f32>(NV * NH);  // bell / additive partial phases
const hAmp:   StaticArray<f32> = new StaticArray<f32>(NV * NH);  // bell partial amplitudes
const ksBuf:  StaticArray<f32> = new StaticArray<f32>(NV * KSN);
const ksPos:  StaticArray<i32> = new StaticArray<i32>(NV);
const ksLp:   StaticArray<f32> = new StaticArray<f32>(NV);
const echoL:  StaticArray<f32> = new StaticArray<f32>(ECHO_N);
const echoR:  StaticArray<f32> = new StaticArray<f32>(ECHO_N);

const rat: StaticArray<f32> = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0];
const F1: StaticArray<f32> = [800.0, 400.0, 350.0, 450.0, 325.0];
const F2: StaticArray<f32> = [1150.0, 1600.0, 1700.0, 800.0, 700.0];
const F3: StaticArray<f32> = [2900.0, 2700.0, 2700.0, 2830.0, 2530.0];

let echoW: i32 = 0;
let ageCounter: i32 = 0;
let seed: u32 = 12345;
let bendN: f32 = 0.0;
let modWheel: f32 = 0.0;
let pressure: f32 = 0.0;
let vibPh: f32 = 0.0;
let lfoPh: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 {
  seed = seed * 1664525 + 1013904223;
  return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0;
}
@inline function blep(t: f32, dt: f32): f32 {
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}
@inline function sinp(p: f32): f32 { return f32(Mathf.sin(p * TWO_PI)); }
@inline function fold(x: f32): f32 {
  let p: f32 = x * 0.25 + 0.25; p = p - f32(Math.floor(p));
  return f32(Mathf.abs(p * 4.0 - 2.0)) - 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NV; v++) {
    vNote[v] = -1; vAct[v] = 0; vGate[v] = 0; vAge[v] = 0; vStage[v] = 0; vFreq[v] = 440.0; vVel[v] = 0.0;
    vEnv[v] = 0.0; vPh[v] = 0.0; vPh2[v] = 0.0; vPhM[v] = 0.0; vPhS[v] = 0.0; vFb[v] = 0.0;
    vLp1[v] = 0.0; vLp2[v] = 0.0; vPEnv[v] = 0.0; vHP[v] = 0.0; ksPos[v] = 0; ksLp[v] = 0.0;
  }
  for (let i = 0; i < NV * 3; i++) { svLo[i] = 0.0; svBp[i] = 0.0; }
  for (let i = 0; i < NV * NH; i++) { hPh[i] = 0.0; hAmp[i] = 0.0; }
  for (let i = 0; i < NV * KSN; i++) ksBuf[i] = 0.0;
  for (let i = 0; i < ECHO_N; i++) { echoL[i] = 0.0; echoR[i] = 0.0; }
  echoW = 0; ageCounter = 0; seed = 12345; bendN = 0.0; modWheel = 0.0; pressure = 0.0; vibPh = 0.0; lfoPh = 0.0;
  const d: f32[] = [0.0, 0.5, 0.5, 0.5, 0.45, 0.1, 0.0, 0.4, 0.7, 0.3, 0.25, 0.3, 0.4, 0.0, 0.0, 0.5, 0.1, 0.4, 0.5, 0.1667, 0.2, 0.4, 0.15, 0.7];
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
  const fr: f32 = f > 1.0 ? f : 1.0;
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++; vStage[slot] = 0;
  vFreq[slot] = fr; vVel[slot] = clampf(vel, 0.0, 1.0); vEnv[slot] = 0.0;
  vPh[slot] = 0.0; vPh2[slot] = 0.0; vPhM[slot] = 0.0; vPhS[slot] = 0.0; vFb[slot] = 0.0;
  vLp1[slot] = 0.0; vLp2[slot] = 0.0; vPEnv[slot] = 1.0; vHP[slot] = 0.0;
  for (let k = 0; k < 3; k++) { svLo[slot * 3 + k] = 0.0; svBp[slot * 3 + k] = 0.0; }
  const eng: i32 = i32(params[P_ENGINE] + 0.5);
  if (eng == 4) {
    // Karplus-Strong: fill the loop with a picked (comb-filtered, coloured) noise burst
    const sr: f32 = sampleRate;
    let L: i32 = i32(sr / fr); if (L < 8) L = 8; if (L > KSN - 2) L = KSN - 2;
    const base: i32 = slot * KSN;
    const pick: f32 = 0.05 + params[P_HARM] * 0.45;
    const col: f32 = 0.15 + params[P_MORPH] * 0.8;
    let lp: f32 = 0.0;
    for (let i = 0; i < KSN; i++) ksBuf[base + i] = 0.0;
    for (let i = 0; i < L; i++) { lp += col * (rnd() - lp); ksBuf[base + i] = lp; }
    const pd: i32 = i32(pick * f32(L));
    for (let i = L - 1; i >= pd; i--) ksBuf[base + i] = ksBuf[base + i] - ksBuf[base + i - pd];
    ksPos[slot] = L; ksLp[slot] = 0.0;   // write head sits one period after the burst
  }
  if (eng == 5 || eng == 3) {
    for (let k = 0; k < NH; k++) { hPh[slot * NH + k] = 0.0; hAmp[slot * NH + k] = 1.0; }
  }
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NV; i++) if (vAct[i] == 1 && vGate[i] == 1 && vNote[i] == id) vGate[i] = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const eng: i32 = i32(params[P_ENGINE] + 0.5);
  const harm0: f32 = params[P_HARM];
  const timb0: f32 = params[P_TIMBRE];
  const morph0: f32 = params[P_MORPH];
  const decT: f32 = 0.04 + params[P_DECAY] * params[P_DECAY] * 5.0;
  const decK: f32 = f32(Mathf.exp(-6.908 / (decT * sr)));
  const atkT: f32 = 0.0005 + params[P_ATTACK] * params[P_ATTACK] * 0.6;
  const atkInc: f32 = 1.0 / (atkT * sr);
  const gateMode: bool = params[P_GATE] > 0.5;
  const relT: f32 = 0.02 + params[P_REL] * params[P_REL] * 2.5;
  const relK: f32 = f32(Mathf.exp(-6.908 / (relT * sr)));
  const color: f32 = params[P_COLOR];
  const envMod: f32 = params[P_ENVMOD] * 2.0 - 1.0;
  const lfoMod: f32 = params[P_LFOMOD];
  const lfoInc: f32 = (0.1 + params[P_LFORATE] * params[P_LFORATE] * 12.0) / sr;
  const velMod: f32 = params[P_VELMOD];
  const sub: f32 = params[P_SUB];
  const air: f32 = params[P_AIR];
  const spread: f32 = params[P_SPREAD];
  const vibInc: f32 = (0.5 + params[P_VIBR] * 7.0) / sr;
  const tuneSemi: f32 = (params[P_TUNE] - 0.5) * 1.0;
  const bendRange: f32 = f32(i32(params[P_BEND] * 12.0 + 0.5));
  const echoAmt: f32 = params[P_ECHO];
  let echoDel: i32 = i32((0.06 + params[P_ETIME] * 0.55) * sr); if (echoDel > ECHO_N - 2) echoDel = ECHO_N - 2;
  const drive: f32 = 1.0 + params[P_DRIVE] * 5.0;
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.4;
  const sus: f32 = 0.6;

  for (let f = 0; f < n; f++) {
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfo: f32 = sinp(lfoPh);
    const vibSemi: f32 = (params[P_VIB] * 0.7 + modWheel * 0.9) * sinp(vibPh) * 0.4;
    const pitchMul: f32 = f32(Mathf.pow(2.0, (bendN * bendRange + vibSemi + tuneSemi) * (1.0 / 12.0)));
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;

    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      // ---- envelope -----------------------------------------------------
      let env: f32 = vEnv[v];
      const stg: i32 = vStage[v];
      if (stg == 0) { env += atkInc; if (env >= 1.0) { env = 1.0; vStage[v] = 1; } }
      else if (stg == 1) {
        if (gateMode) env = sus + (env - sus) * decK; else env *= decK;
        if (gateMode && vGate[v] == 0) vStage[v] = 2;
      } else { env *= relK; }
      if (stg == 1 && !gateMode && env < 0.0003) vAct[v] = 0;
      if (stg == 2 && env < 0.0003) vAct[v] = 0;
      vEnv[v] = env;
      if (gateMode && vGate[v] == 0 && stg == 0) vStage[v] = 2;
      const vel: f32 = vVel[v];
      const fr: f32 = vFreq[v] * pitchMul;
      const dt: f32 = clampf(fr / sr, 0.00002, 0.45);

      // ---- macro controls with modulation ---------------------------------
      const H: f32 = clampf(harm0, 0.0, 1.0);
      const T: f32 = clampf(timb0 + envMod * env * 0.6 + (vel - 0.5) * velMod * 1.2 + pressure * 0.3, 0.0, 1.0);
      const M: f32 = clampf(morph0 + lfo * lfoMod * 0.5, 0.0, 1.0);
      let s: f32 = 0.0;

      if (eng == 0) {
        // ANALOG: saw/pulse pair, second osc offset by an interval
        const ivt: f32 = H < 0.2 ? H * 0.5 : f32(i32(3.0 + (H - 0.2) * 12.0));   // detune first, then intervals in semitones
        const r2: f32 = f32(Mathf.pow(2.0, ivt / 12.0));
        let p1: f32 = vPh[v] + dt; if (p1 >= 1.0) p1 -= 1.0; vPh[v] = p1;
        let p2: f32 = vPh2[v] + dt * r2; if (p2 >= 1.0) p2 -= 1.0; vPh2[v] = p2;
        const pw: f32 = 0.5 - T * 0.46;
        const d2: f32 = dt * r2;
        const saw1: f32 = 2.0 * p1 - 1.0 - blep(p1, dt);
        const saw2: f32 = 2.0 * p2 - 1.0 - blep(p2, d2);
        let q1: f32 = p1 + pw; if (q1 >= 1.0) q1 -= 1.0;
        let q2: f32 = p2 + pw; if (q2 >= 1.0) q2 -= 1.0;
        const pul1: f32 = (p1 < pw ? 1.0 : -1.0) + blep(p1, dt) - blep(q1, dt);
        const pul2: f32 = (p2 < pw ? 1.0 : -1.0) + blep(p2, d2) - blep(q2, d2);
        s = ((saw1 + saw2 * 0.8) * (1.0 - M) + (pul1 + pul2 * 0.8) * M) * 0.4;
      } else if (eng == 1) {
        // FM: ratio (H), index (T), modulator feedback (M)
        const rp: f32 = H * 8.0; let ri: i32 = i32(rp); if (ri > 7) ri = 7;
        const rf: f32 = rp - f32(ri);
        const ratio: f32 = rat[ri] + (rat[ri + 1] - rat[ri]) * (rf > 0.85 ? (rf - 0.85) / 0.15 : 0.0);
        let pm: f32 = vPhM[v] + dt * ratio; pm -= f32(Math.floor(pm)); vPhM[v] = pm;
        const modv: f32 = sinp(pm + vFb[v] * M * 0.25);
        vFb[v] = modv;
        let pc: f32 = vPh[v] + dt; if (pc >= 1.0) pc -= 1.0; vPh[v] = pc;
        s = sinp(pc + modv * T * T * 1.3) * 0.7;
      } else if (eng == 2) {
        // FOLD: sine->tri source through a wavefolder with bias
        let pc: f32 = vPh[v] + dt; if (pc >= 1.0) pc -= 1.0; vPh[v] = pc;
        const sn: f32 = sinp(pc);
        const tr: f32 = 4.0 * f32(Mathf.abs(pc - 0.5)) - 1.0;
        const src: f32 = sn + (tr - sn) * M;
        s = fold(src * (0.3 + T * 5.5) + (H - 0.5) * 1.6) * 0.7;
      } else if (eng == 3) {
        // ADDITIVE: 12 harmonics, tilt (H), odd/even (T), formant peak (M)
        const tilt: f32 = 2.6 - H * 2.4;
        const pk: f32 = M * 9.0;
        let acc: f32 = 0.0;
        let p1: f32 = vPh[v] + dt; if (p1 >= 1.0) p1 -= 1.0; vPh[v] = p1;
        for (let k = 1; k <= NH; k++) {
          if (fr * f32(k) > sr * 0.45) break;
          const kf: f32 = f32(k);
          let a: f32 = f32(Mathf.pow(kf, -tilt));
          const odd: bool = (k & 1) == 1;
          a *= odd ? clampf((1.0 - T) * 2.0, 0.0, 1.0) : clampf(T * 2.0, 0.0, 1.0);
          const dd: f32 = kf - 1.0 - pk;
          a *= 1.0 + 3.0 * f32(Mathf.exp(-dd * dd * 0.5));
          let ph: f32 = p1 * kf; ph -= f32(Math.floor(ph));
          acc += a * sinp(ph);
        }
        s = acc * 0.45;
      } else if (eng == 4) {
        // STRING: Karplus-Strong loop; T = damping brightness, decay time from Decay
        const base: i32 = v * KSN;
        const kk: f32 = 0.25 + T * 0.7;
        let D: f32 = sr / fr - (1.0 - kk) / kk; if (D < 2.0) D = 2.0; if (D > f32(KSN - 3)) D = f32(KSN - 3);
        const wp: i32 = ksPos[v];
        let rp: f32 = f32(wp) - D; if (rp < 0.0) rp += f32(KSN);
        const ri: i32 = i32(rp); const rf2: f32 = rp - f32(ri);
        const r0: i32 = ri >= KSN ? ri - KSN : ri;
        const r1: i32 = r0 + 1 >= KSN ? 0 : r0 + 1;
        const y: f32 = ksBuf[base + r0] * (1.0 - rf2) + ksBuf[base + r1] * rf2;
        const g: f32 = f32(Mathf.exp(-6.908 / (clampf(decT * 1.5, 0.05, 20.0) * fr)));
        let lp: f32 = ksLp[v]; lp += kk * (y - lp); ksLp[v] = lp;
        ksBuf[base + wp] = lp * g;
        ksPos[v] = wp + 1 >= KSN ? 0 : wp + 1;
        s = y * 1.2;
      } else if (eng == 5) {
        // BELL: inharmonic partials; H = inharmonicity, T = brightness, M = damping tilt
        const bb: i32 = v * NH;
        const inh: f32 = H;
        let acc: f32 = 0.0;
        for (let k = 0; k < 8; k++) {
          const kf: f32 = f32(k);
          const bar: f32 = (2.0 * kf + 3.0) / 3.0;
          const rt: f32 = (kf + 1.0) + ((bar * bar) - (kf + 1.0)) * inh + inh * kf * 0.31;
          const fk: f32 = fr * rt;
          if (fk > sr * 0.45) continue;
          let ph: f32 = hPh[bb + k] + fk / sr; ph -= f32(Math.floor(ph)); hPh[bb + k] = ph;
          const dk: f32 = f32(Mathf.exp(-6.908 / (clampf(decT * 1.2 / (1.0 + M * kf * 1.4), 0.03, 20.0) * sr)));
          let am: f32 = hAmp[bb + k] * dk; hAmp[bb + k] = am;
          acc += sinp(ph) * am * f32(Mathf.pow(kf + 1.0, -(2.4 - T * 2.2)));
        }
        s = acc * 0.8;
      } else if (eng == 6) {
        // NOISE: resonant band-pass noise, dust clicks blended in by H
        const fc: f32 = clampf(fr * (0.5 + T * 3.0), 40.0, sr * 0.4);
        const g: f32 = 2.0 * f32(Mathf.sin(PI * fc / sr));
        const q: f32 = 1.0 / (2.0 + M * 60.0);
        const dust: f32 = f32(Mathf.abs(rnd())) > (1.0 - H * H * 0.2) ? rnd() * 3.0 : 0.0;
        const nz: f32 = rnd() * (1.0 - H * 0.7) + dust;
        const hp: f32 = nz - svLo[v * 3] - q * svBp[v * 3] * 2.0;
        svBp[v * 3] += g * hp; svLo[v * 3] += g * svBp[v * 3];
        s = svBp[v * 3] * (0.4 + M * 1.2);
      } else if (eng == 7) {
        // VOWEL: saw through three formant band-passes
        const vw: f32 = H * 4.0; let vi: i32 = i32(vw); if (vi > 3) vi = 3; const vf: f32 = vw - f32(vi);
        const sh: f32 = 0.7 + M * 0.8;
        let p1: f32 = vPh[v] + dt; if (p1 >= 1.0) p1 -= 1.0; vPh[v] = p1;
        const src: f32 = 2.0 * p1 - 1.0 - blep(p1, dt);
        const q: f32 = 1.0 / (3.0 + T * 14.0);
        let acc: f32 = 0.0;
        for (let k = 0; k < 3; k++) {
          const fa: f32 = k == 0 ? F1[vi] : (k == 1 ? F2[vi] : F3[vi]);
          const fb: f32 = k == 0 ? F1[vi + 1] : (k == 1 ? F2[vi + 1] : F3[vi + 1]);
          const fc: f32 = clampf((fa + (fb - fa) * vf) * sh, 80.0, sr * 0.4);
          const g: f32 = 2.0 * f32(Mathf.sin(PI * fc / sr));
          const i3: i32 = v * 3 + k;
          const hp: f32 = src - svLo[i3] - q * svBp[i3];
          svBp[i3] += g * hp; svLo[i3] += g * svBp[i3];
          acc += svBp[i3] * (k == 0 ? 1.0 : (k == 1 ? 0.7 : 0.4));
        }
        s = acc * 1.6;
      } else {
        // KICK: pitch-swept sine, H = sweep depth, T = drive/click, M = sweep time
        const pe: f32 = vPEnv[v];
        vPEnv[v] = pe * f32(Mathf.exp(-1.0 / ((0.004 + M * 0.09) * sr)));
        const ff: f32 = fr * 0.5 * (1.0 + H * 8.0 * pe);
        let pc: f32 = vPh[v] + ff / sr; pc -= f32(Math.floor(pc)); vPh[v] = pc;
        s = f32(Mathf.tanh(sinp(pc) * (1.0 + T * 4.0)));
        s += rnd() * pe * pe * T * 0.4;
        s *= 0.8;
      }

      // ---- sub + air, then the low-pass gate ----------------------------
      if (sub > 0.001) {
        vPhS[v] += dt * 0.5; if (vPhS[v] >= 1.0) vPhS[v] -= 1.0;
        s += sinp(vPhS[v]) * sub * 0.5;
      }
      if (air > 0.001) {
        const nz: f32 = rnd(); vHP[v] += 0.2 * (nz - vHP[v]);
        s += (nz - vHP[v]) * air * 0.35;
      }
      const cutN: f32 = clampf(color * (0.3 + 0.75 * env), 0.0, 1.0);
      const fcut: f32 = 60.0 * f32(Mathf.pow(300.0, cutN));
      const gk: f32 = clampf(1.0 - f32(Mathf.exp(-TWO_PI * fcut / sr)), 0.0005, 0.99);
      vLp1[v] += gk * (s - vLp1[v]);
      vLp2[v] += gk * (vLp1[v] - vLp2[v]);
      const out: f32 = vLp2[v] * env * (0.35 + vel * 0.75);

      // ---- stereo spread ----------------------------------------------------
      const pr: i32 = (v >> 1) + 1;
      const mg: f32 = ((v & 1) == 1 ? -1.0 : 1.0) * f32(pr) * 0.25 * spread;
      const pan: f32 = clampf(mg, -1.0, 1.0);
      mixL += out * f32(Mathf.sqrt(0.5 * (1.0 - pan)));
      mixR += out * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
    }

    let l: f32 = f32(Mathf.tanh(mixL * drive * 0.8)) * level;
    let r: f32 = f32(Mathf.tanh(mixR * drive * 0.8)) * level;
    // ---- ping-pong echo ---------------------------------------------------------
    if (echoAmt > 0.001) {
      let rp: i32 = echoW - echoDel; if (rp < 0) rp += ECHO_N;
      const eL: f32 = echoL[rp]; const eR: f32 = echoR[rp];
      echoL[echoW] = l * 0.7 + eR * 0.45;
      echoR[echoW] = r * 0.7 + eL * 0.45;
      l += eL * echoAmt * 0.8; r += eR * echoAmt * 0.8;
    } else { echoL[echoW] = 0.0; echoR[echoW] = 0.0; }
    echoW = echoW + 1 >= ECHO_N ? 0 : echoW + 1;
    outBuf[f] = l;
    outBuf[MAX_FRAMES + f] = r;
  }
}
