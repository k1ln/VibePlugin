// =====================================================================
//  WAVELOOM — a wavetable synthesiser.
//  Three table sets (Analog, Vocal, Digital), each of eight frames, are
//  synthesised at start-up from harmonic spectra and stored as six
//  band-limited MIP levels (one per octave), so oscillators never alias
//  on the fundamental. Two oscillators scan their tables (Position, with
//  linear morph between frames); five WARP modes (none, sync, bend, mirror,
//  pulse-width) reshape the phase; up to seven-voice UNISON with detune and
//  stereo spread; a sub oscillator and noise. A multimode filter
//  (LP24 / LP12 / BP / HP / Notch) with drive, key-track and velocity; an
//  amp ADSR, a modulation envelope (-> Position and filter), two LFOs
//  (Position, filter, vibrato). Eight voices.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 35;
const NV: i32 = 8;
const NU: i32 = 7;
const TS: i32 = 1024;
const NF: i32 = 8;
const NSET: i32 = 3;
const MIPS: i32 = 6;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_SET: i32 = 0;    const P_POS1: i32 = 1;  const P_POS2: i32 = 2;   const P_LV2: i32 = 3;   const P_SEMI2: i32 = 4;  const P_FINE2: i32 = 5;
const P_WMODE: i32 = 6;  const P_WAMT: i32 = 7;  const P_UNI: i32 = 8;    const P_UDET: i32 = 9;  const P_USPR: i32 = 10;
const P_SUB: i32 = 11;   const P_NOISE: i32 = 12; const P_FMODE: i32 = 13; const P_CUT: i32 = 14; const P_RES: i32 = 15;
const P_DRIVE: i32 = 16; const P_KT: i32 = 17;   const P_FENV: i32 = 18;  const P_AA: i32 = 19;   const P_AD: i32 = 20;
const P_AS: i32 = 21;    const P_AR: i32 = 22;   const P_EA: i32 = 23;    const P_ED: i32 = 24;   const P_E2POS: i32 = 25;
const P_L1R: i32 = 26;   const P_L1S: i32 = 27;  const P_L1POS: i32 = 28; const P_L2R: i32 = 29;  const P_L2CUT: i32 = 30;
const P_L2PIT: i32 = 31; const P_VEL: i32 = 32;  const P_BEND: i32 = 33;  const P_LEVEL: i32 = 34;

let sampleRate: f32 = 48000.0;
const tbl: StaticArray<f32> = new StaticArray<f32>(NSET * NF * MIPS * TS);
const sinTab: StaticArray<f32> = new StaticArray<f32>(TS);
const amps: StaticArray<f32> = new StaticArray<f32>(260);

const vAct:  StaticArray<i32> = new StaticArray<i32>(NV);
const vGate: StaticArray<i32> = new StaticArray<i32>(NV);
const vNote: StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:  StaticArray<i32> = new StaticArray<i32>(NV);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NV);
const vVel:  StaticArray<f32> = new StaticArray<f32>(NV);
const vMidi: StaticArray<f32> = new StaticArray<f32>(NV);
const uPh1:  StaticArray<f32> = new StaticArray<f32>(NV * NU);
const uPh2:  StaticArray<f32> = new StaticArray<f32>(NV * NU);
const vSub:  StaticArray<f32> = new StaticArray<f32>(NV);
const aEnv:  StaticArray<f32> = new StaticArray<f32>(NV);
const aStg:  StaticArray<i32> = new StaticArray<i32>(NV);
const mEnv:  StaticArray<f32> = new StaticArray<f32>(NV);
const mStg:  StaticArray<i32> = new StaticArray<i32>(NV);
const fLoA:  StaticArray<f32> = new StaticArray<f32>(NV * 2); const fBpA: StaticArray<f32> = new StaticArray<f32>(NV * 2);
const fLoB:  StaticArray<f32> = new StaticArray<f32>(NV * 2); const fBpB: StaticArray<f32> = new StaticArray<f32>(NV * 2);

let ageCounter: i32 = 0; let seed: u32 = 31;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0;
let l1Ph: f32 = 0.0; let l2Ph: f32 = 0.0; let l1S: f32 = 0.0; let l1T: f32 = 0.0; let l1Cyc: i32 = -1;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

// fill amps[1..H] for a (set, frame); phase-free sine series
function frameSpectrum(set: i32, fr: i32, H: i32): void {
  const t: f32 = f32(fr) / f32(NF - 1);
  for (let h = 1; h <= H; h++) {
    const hf: f32 = f32(h); let a: f32 = 0.0;
    if (set == 0) {
      // analog: sine -> triangle -> saw -> square -> narrow pulses -> hollow
      if (fr == 0) a = h == 1 ? 1.0 : 0.0;
      else if (fr == 1) a = (h & 1) == 1 ? ((h >> 1) & 1 ? -1.0 : 1.0) / (hf * hf) : 0.0;
      else if (fr == 2) a = 1.0 / hf;
      else if (fr == 3) a = (h & 1) == 1 ? 1.0 / hf : 0.0;
      else if (fr == 4) a = f32(Mathf.sin(PI * hf * 0.25)) / hf;
      else if (fr == 5) a = f32(Mathf.sin(PI * hf * 0.1)) / hf;
      else if (fr == 6) a = (1.0 + ((h & 1) == 1 ? 1.0 : 0.0)) / hf;
      else a = (h & 1) == 1 ? 1.0 / f32(Mathf.sqrt(hf)) : 0.0;
    } else if (set == 1) {
      // vocal: saw spectrum shaped by vowel formants (relative to a 110 Hz fundamental)
      const f: f32 = hf * 110.0; let g: f32 = 0.0;
      let f1: f32 = 800.0; let f2: f32 = 1150.0; let f3: f32 = 2900.0;
      if (fr == 1) { f1 = 400.0; f2 = 1600.0; f3 = 2700.0; } else if (fr == 2) { f1 = 350.0; f2 = 1700.0; f3 = 2700.0; }
      else if (fr == 3) { f1 = 450.0; f2 = 800.0; f3 = 2830.0; } else if (fr == 4) { f1 = 325.0; f2 = 700.0; f3 = 2530.0; }
      else if (fr == 5) { f1 = 500.0; f2 = 1300.0; f3 = 2500.0; } else if (fr == 6) { f1 = 650.0; f2 = 1800.0; f3 = 2600.0; }
      else if (fr == 7) { f1 = 550.0; f2 = 950.0; f3 = 2450.0; }
      const d1: f32 = (f - f1) / (f1 * 0.16 + 40.0); const d2: f32 = (f - f2) / (f2 * 0.14 + 60.0); const d3: f32 = (f - f3) / (f3 * 0.12 + 90.0);
      g = f32(Mathf.exp(-d1 * d1)) + 0.55 * f32(Mathf.exp(-d2 * d2)) + 0.3 * f32(Mathf.exp(-d3 * d3));
      a = g / hf * 3.0 + 0.02 / hf;
    } else {
      // digital: comb-modulated and tilted spectra, each frame a different character
      const tilt: f32 = 0.6 + t * 1.6; const spacing: f32 = 0.31 + t * 0.23 * f32(fr & 3);
      const comb: f32 = 0.5 + 0.5 * f32(Mathf.cos(TWO_PI * hf * spacing));
      a = f32(Mathf.pow(hf, -tilt)) * (0.15 + comb * (0.4 + t)) * ((fr & 1) == 1 ? ((h & 1) == 1 ? 1.0 : 0.25) : 1.0);
    }
    amps[h] = a;
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < TS; i++) sinTab[i] = f32(Mathf.sin(TWO_PI * f32(i) / f32(TS)));
  // synthesise every (set, frame, mip): harmonics capped so the top partial stays below Nyquist for the mip's highest note
  for (let s = 0; s < NSET; s++) {
    for (let fr = 0; fr < NF; fr++) {
      for (let m = 0; m < MIPS; m++) {
        const topHz: f32 = 130.0 * f32(1 << m);
        let H: i32 = i32(0.45 * sampleRate / topHz); if (H > 250) H = 250; if (H < 3) H = 3;
        frameSpectrum(s, fr, H);
        const base: i32 = ((s * NF + fr) * MIPS + m) * TS;
        let pk: f32 = 0.0;
        for (let i = 0; i < TS; i++) {
          let acc: f32 = 0.0;
          for (let h = 1; h <= H; h++) acc += amps[h] * sinTab[(h * i) & (TS - 1)];
          tbl[base + i] = acc; const av: f32 = acc < 0.0 ? -acc : acc; if (av > pk) pk = av;
        }
        const nrm: f32 = pk > 0.0001 ? 0.85 / pk : 0.0;
        for (let i = 0; i < TS; i++) tbl[base + i] *= nrm;
      }
    }
  }
  for (let v = 0; v < NV; v++) {
    vAct[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vFreq[v] = 440.0; vVel[v] = 0.0; vMidi[v] = 60.0; vSub[v] = 0.0;
    aEnv[v] = 0.0; aStg[v] = 0; mEnv[v] = 0.0; mStg[v] = 0;
    for (let c = 0; c < 2; c++) { fLoA[v * 2 + c] = 0.0; fBpA[v * 2 + c] = 0.0; fLoB[v * 2 + c] = 0.0; fBpB[v * 2 + c] = 0.0; }
    for (let u = 0; u < NU; u++) { uPh1[v * NU + u] = 0.0; uPh2[v * NU + u] = 0.0; }
  }
  ageCounter = 0; seed = 31; bendN = 0.0; modWheel = 0.0; l1Ph = 0.0; l2Ph = 0.0; l1S = 0.0; l1T = 0.0; l1Cyc = -1;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [
    0.0, 0.2, 0.45, 0.6, 0.0, 0.5, 0.0, 0.3, 3.0, 0.3, 0.6, 0.0, 0.0, 0.0, 0.7, 0.2, 0.15, 0.5, 0.35,
    0.02, 0.4, 0.75, 0.3, 0.02, 0.5, 0.35, 0.25, 0.0, 0.25, 0.3, 0.0, 0.0, 0.5, 0.1667, 0.7
  ];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) if (vAct[i] == 0) { slot = i; break; }
  if (slot < 0) { let o: i32 = 0; for (let i = 1; i < NV; i++) if (vAge[i] < vAge[o]) o = i; slot = o; }
  const fr: f32 = f > 8.0 ? f : 8.0;
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++; vFreq[slot] = fr; vVel[slot] = clampf(vel, 0.0, 1.0);
  vMidi[slot] = 69.0 + 12.0 * f32(Mathf.log(fr / 440.0) / Mathf.log(2.0));
  aStg[slot] = 1; mStg[slot] = 1; if (aEnv[slot] > 0.9) aEnv[slot] = 0.0; mEnv[slot] = 0.0;
  for (let u = 0; u < NU; u++) { uPh1[slot * NU + u] = rnd() * 0.5 + 0.5; uPh2[slot * NU + u] = rnd() * 0.5 + 0.5; }
  vSub[slot] = 0.0;
  for (let c = 0; c < 2; c++) { fLoA[slot * 2 + c] = 0.0; fBpA[slot * 2 + c] = 0.0; fLoB[slot * 2 + c] = 0.0; fBpB[slot * 2 + c] = 0.0; }
}

export function noteOff(id: i32): void {
  for (let v = 0; v < NV; v++) if (vAct[v] == 1 && vGate[v] == 1 && vNote[v] == id) { vGate[v] = 0; aStg[v] = 4; }
}

// band-limited table lookup with frame morph: set, position (0..NF-1), mip, phase (0..1)
@inline function readTable(set: i32, pos: f32, mip: i32, ph: f32): f32 {
  const pf: f32 = clampf(pos, 0.0, f32(NF - 1) - 0.0001);
  const f0: i32 = i32(pf); const ff: f32 = pf - f32(f0);
  const x: f32 = ph * f32(TS); const i0: i32 = i32(x) & (TS - 1); const i1: i32 = (i0 + 1) & (TS - 1); const fx: f32 = x - f32(i32(x));
  const b0: i32 = ((set * NF + f0) * MIPS + mip) * TS; const b1: i32 = ((set * NF + f0 + 1) * MIPS + mip) * TS;
  const a: f32 = tbl[b0 + i0] * (1.0 - fx) + tbl[b0 + i1] * fx;
  const b: f32 = tbl[b1 + i0] * (1.0 - fx) + tbl[b1 + i1] * fx;
  return a + (b - a) * ff;
}

@inline function warpPhase(mode: i32, ph: f32, amt: f32): f32 {
  if (mode == 1) { const q: f32 = ph * (1.0 + amt * 7.0); return q - f32(Math.floor(q)); }
  if (mode == 2) { return f32(Mathf.pow(ph, f32(Mathf.pow(2.0, (amt - 0.5) * 4.0)))); }
  if (mode == 3) { const t: f32 = ph < 0.5 ? ph * 2.0 : 2.0 - ph * 2.0; return ph + (t * 0.5 - ph) * amt; }
  if (mode == 4) { const pw: f32 = clampf(0.5 - amt * 0.47, 0.03, 0.97); return ph < pw ? ph * 0.5 / pw : 0.5 + (ph - pw) * 0.5 / (1.0 - pw); }
  return ph;
}

function lfoShape(kind: i32, p: f32, sh: f32): f32 {
  if (kind == 0) return f32(Mathf.sin(p * TWO_PI));
  if (kind == 1) return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
  if (kind == 2) return 1.0 - 2.0 * p;
  if (kind == 3) return p < 0.5 ? 1.0 : -1.0;
  return sh;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const set: i32 = i32(params[P_SET] + 0.5);
  const pos1: f32 = params[P_POS1] * f32(NF - 1); const pos2: f32 = params[P_POS2] * f32(NF - 1);
  const lv2: f32 = params[P_LV2];
  const semi2: f32 = f32(i32(params[P_SEMI2] - (params[P_SEMI2] < 0.0 ? 0.5 : -0.5)));
  const fine2: f32 = (params[P_FINE2] - 0.5) * 100.0;
  const wmode: i32 = i32(params[P_WMODE] + 0.5); const wamt: f32 = params[P_WAMT];
  const uni: i32 = i32(params[P_UNI] + 0.5) < 1 ? 1 : (i32(params[P_UNI] + 0.5) > NU ? NU : i32(params[P_UNI] + 0.5));
  const udet: f32 = params[P_UDET] * 55.0; const uspr: f32 = params[P_USPR];
  const sub: f32 = params[P_SUB]; const noiseL: f32 = params[P_NOISE] * 0.6;
  const fmode: i32 = i32(params[P_FMODE] + 0.5);
  const cutBase: f32 = params[P_CUT]; const res: f32 = params[P_RES]; const drive: f32 = 1.0 + params[P_DRIVE] * 5.0;
  const kt: f32 = params[P_KT]; const fenv: f32 = (params[P_FENV] - 0.5) * 2.0 * 5.0;
  const aA: f32 = 0.001 + params[P_AA] * params[P_AA] * 4.0; const aD: f32 = 0.005 + params[P_AD] * params[P_AD] * 5.0;
  const aS: f32 = params[P_AS]; const aR: f32 = 0.005 + params[P_AR] * params[P_AR] * 6.0;
  const eA: f32 = 0.001 + params[P_EA] * params[P_EA] * 4.0; const eD: f32 = 0.01 + params[P_ED] * params[P_ED] * 5.0;
  const e2pos: f32 = (params[P_E2POS] - 0.5) * 2.0 * f32(NF - 1);
  const l1Inc: f32 = (0.05 + params[P_L1R] * params[P_L1R] * 25.0) / sr; const l1Kind: i32 = i32(params[P_L1S] + 0.5); const l1pos: f32 = (params[P_L1POS] - 0.5) * 2.0 * f32(NF - 1) * 0.5;
  const l2Inc: f32 = (0.05 + params[P_L2R] * params[P_L2R] * 25.0) / sr; const l2cut: f32 = (params[P_L2CUT] - 0.5) * 2.0 * 3.0; const l2pit: f32 = params[P_L2PIT] * 0.6 + modWheel * 0.6;
  const velS: f32 = params[P_VEL]; const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.5;
  const dt: f32 = 1.0 / sr;
  const gA: f32 = dt / aA; const kAD: f32 = 1.0 - f32(Mathf.exp(-4.6 * dt / aD)); const kAR: f32 = 1.0 - f32(Mathf.exp(-4.6 * dt / aR));
  const gE: f32 = dt / eA; const kED: f32 = 1.0 - f32(Mathf.exp(-4.6 * dt / eD));
  let lvOut: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    l1Ph += l1Inc; if (l1Ph >= 1.0) l1Ph -= 1.0;
    l2Ph += l2Inc; if (l2Ph >= 1.0) l2Ph -= 1.0;
    const c1: i32 = i32(l1Ph * 1.0); if (l1Cyc != c1 && l1Ph < l1Inc * 2.0) { l1Cyc = c1; l1T = rnd(); } if (l1Ph > 0.5) l1Cyc = -1;
    l1S += (l1T - l1S) * 0.02;
    const lfo1: f32 = lfoShape(l1Kind, l1Ph, l1S); const lfo2: f32 = f32(Mathf.sin(l2Ph * TWO_PI));
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      // ---- envelopes --------------------------------------------------------------------------------------------
      let ae: f32 = aEnv[v]; const ast: i32 = aStg[v];
      if (ast == 1) { ae += gA; if (ae >= 1.0) { ae = 1.0; aStg[v] = 2; } }
      else if (ast == 2) { ae += (aS - ae) * kAD; }
      else if (ast == 4) { ae -= ae * kAR; if (ae < 0.0004) { ae = 0.0; vAct[v] = 0; } }
      aEnv[v] = ae;
      let me: f32 = mEnv[v]; const mst: i32 = mStg[v];
      if (mst == 1) { me += gE; if (me >= 1.0) { me = 1.0; mStg[v] = 2; } } else if (mst == 2) { me -= me * kED; }
      mEnv[v] = me;
      if (vAct[v] == 0) continue;
      // ---- pitch ------------------------------------------------------------------------------------------------------------
      const semiAll: f32 = bendSemi + lfo2 * l2pit * 0.5;
      const fBase: f32 = vFreq[v] * f32(Mathf.pow(2.0, semiAll * (1.0 / 12.0)));
      const f2: f32 = fBase * f32(Mathf.pow(2.0, (semi2 + fine2 * 0.01) * (1.0 / 12.0)));
      // mip level from the fundamental (one per octave above ~130 Hz)
      let mip1: i32 = 0; { let x: f32 = fBase / 130.0; while (x >= 1.0 && mip1 < MIPS - 1) { mip1++; x *= 0.5; } }
      let mip2: i32 = 0; { let x: f32 = f2 / 130.0; while (x >= 1.0 && mip2 < MIPS - 1) { mip2++; x *= 0.5; } }
      // ---- modulated positions ------------------------------------------------------------------------------------------------
      const modPos: f32 = me * e2pos + lfo1 * l1pos;
      const p1: f32 = pos1 + modPos; const p2: f32 = pos2 + modPos;
      let sL: f32 = 0.0; let sR: f32 = 0.0;
      for (let u = 0; u < uni; u++) {
        const spreadPos: f32 = uni > 1 ? (f32(u) / f32(uni - 1) * 2.0 - 1.0) : 0.0;
        const detMul: f32 = f32(Mathf.pow(2.0, spreadPos * udet / 1200.0));
        const i: i32 = v * NU + u;
        let a: f32 = uPh1[i] + fBase * detMul / sr; if (a >= 1.0) a -= 1.0; uPh1[i] = a;
        let b: f32 = uPh2[i] + f2 * detMul / sr; if (b >= 1.0) b -= 1.0; uPh2[i] = b;
        let o: f32 = readTable(set, p1, mip1, warpPhase(wmode, a, wamt));
        o += lv2 * readTable(set, p2, mip2, warpPhase(wmode, b, wamt));
        const pan: f32 = spreadPos * uspr;
        sL += o * f32(Mathf.sqrt(0.5 * (1.0 - pan))); sR += o * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
      }
      const un: f32 = 1.0 / f32(Mathf.sqrt(f32(uni))) * 0.55;
      sL *= un; sR *= un;
      // sub oscillator (sine, one octave down) and noise
      if (sub > 0.001) { vSub[v] += fBase * 0.5 / sr; if (vSub[v] >= 1.0) vSub[v] -= 1.0; const sb: f32 = f32(Mathf.sin(vSub[v] * TWO_PI)) * sub * 0.6; sL += sb; sR += sb; }
      if (noiseL > 0.001) { const nz: f32 = rnd() * noiseL; sL += nz; sR += nz; }
      // ---- filter ---------------------------------------------------------------------------------------------------------------------
      const cutOct: f32 = (cutBase * 10.0) + (vMidi[v] - 60.0) / 12.0 * kt + fenv * me + lfo2 * l2cut + (vVel[v] - 0.5) * velS * 3.0;
      let fc: f32 = 20.0 * f32(Mathf.pow(2.0, cutOct)); fc = clampf(fc, 20.0, sr * 0.3);
      const g: f32 = 2.0 * f32(Mathf.sin(PI * fc / (2.0 * sr)));
      const qd: f32 = 1.0 / (0.55 + (1.0 - res) * (1.0 - res) * 3.5);
      let outL: f32 = 0.0; let outR: f32 = 0.0;
      for (let c = 0; c < 2; c++) {
        let x: f32 = f32(Mathf.tanh((c == 0 ? sL : sR) * drive));
        const ix: i32 = v * 2 + c;
        let hp: f32 = 0.0;
        for (let k = 0; k < 2; k++) { hp = x - fLoA[ix] - qd * fBpA[ix]; fBpA[ix] += g * hp; fLoA[ix] += g * fBpA[ix]; }
        let y: f32 = 0.0;
        if (fmode == 0) {
          let hp2: f32 = 0.0; const xin2: f32 = fLoA[ix];
          for (let k = 0; k < 2; k++) { hp2 = xin2 - fLoB[ix] - qd * fBpB[ix]; fBpB[ix] += g * hp2; fLoB[ix] += g * fBpB[ix]; }
          y = fLoB[ix];
        } else if (fmode == 1) y = fLoA[ix];
        else if (fmode == 2) y = fBpA[ix] * qd * 1.2;
        else if (fmode == 3) y = hp;
        else y = hp + fLoA[ix];
        if (c == 0) outL = y; else outR = y;
      }
      const vg: f32 = ae * (1.0 - velS * 0.5 + velS * 0.5 * vVel[v]);
      mixL += outL * vg; mixR += outR * vg;
    }
    outBuf[f] = f32(Mathf.tanh(mixL * level)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(mixR * level));
    lvOut = f32(Mathf.abs(mixL));
  }
  display[0] = clampf(lvOut * 1.5, 0.0, 1.0);
}
