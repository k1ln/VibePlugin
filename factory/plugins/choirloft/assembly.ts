// =====================================================================
//  CHOIRLOFT — a vocal choir / formant synthesiser.
//  Each note is sung by up to four singers. A singer is a glottal-style
//  source (band-limited saw, spectral tilt set by Effort, plus breath
//  noise) run through five parallel formant resonators. The formant
//  frequencies, bandwidths and levels come from published vowel tables for
//  bass, tenor, alto and soprano voices and morph continuously across the
//  vowels A - E - I - O - U (the mod wheel pushes the morph further).
//  Singers differ in tuning, vibrato phase/rate and entry time (Ensemble,
//  Human), pitch can scoop up into each note, and a small hall finishes it.
//  Six notes, four singers each. Pure algorithm: no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 19;
const NN: i32 = 6;           // notes
const NSG: i32 = 4;          // singers per note
const NU: i32 = NN * NSG;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_TYPE: i32 = 0;  const P_VOWEL: i32 = 1; const P_SHIFT: i32 = 2;  const P_SIZE: i32 = 3;  const P_ENS: i32 = 4;
const P_VIB: i32 = 5;   const P_VIBR: i32 = 6;  const P_HUMAN: i32 = 7;  const P_ATK: i32 = 8;   const P_REL: i32 = 9;
const P_BREATH: i32 = 10; const P_EFFORT: i32 = 11; const P_SCOOP: i32 = 12; const P_WIDTH: i32 = 13; const P_SPACE: i32 = 14;
const P_HALL: i32 = 15; const P_BEND: i32 = 16; const P_LEVEL: i32 = 17; const P_VELS: i32 = 18;

const FMT_F: StaticArray<f32> = [600.0, 1040.0, 2250.0, 2450.0, 2750.0, 400.0, 1620.0, 2400.0, 2800.0, 3100.0, 250.0, 1750.0, 2600.0, 3050.0, 3340.0, 400.0, 750.0, 2400.0, 2600.0, 2900.0, 350.0, 600.0, 2400.0, 2675.0, 2950.0, 650.0, 1080.0, 2650.0, 2900.0, 3250.0, 400.0, 1700.0, 2600.0, 3200.0, 3580.0, 290.0, 1870.0, 2800.0, 3250.0, 3540.0, 400.0, 800.0, 2600.0, 2800.0, 3000.0, 350.0, 600.0, 2700.0, 2900.0, 3300.0, 800.0, 1150.0, 2800.0, 3500.0, 4950.0, 400.0, 1600.0, 2700.0, 3300.0, 4950.0, 350.0, 1700.0, 2700.0, 3700.0, 4950.0, 450.0, 800.0, 2830.0, 3500.0, 4950.0, 325.0, 700.0, 2530.0, 3500.0, 4950.0, 800.0, 1150.0, 2900.0, 3900.0, 4950.0, 350.0, 2000.0, 2800.0, 3600.0, 4950.0, 270.0, 2140.0, 2950.0, 3900.0, 4950.0, 450.0, 800.0, 2830.0, 3800.0, 4950.0, 325.0, 700.0, 2700.0, 3800.0, 4950.0];
const FMT_A: StaticArray<f32> = [0.0, -7.0, -9.0, -9.0, -20.0, 0.0, -12.0, -9.0, -12.0, -18.0, 0.0, -30.0, -16.0, -22.0, -28.0, 0.0, -11.0, -21.0, -20.0, -40.0, 0.0, -20.0, -32.0, -28.0, -36.0, 0.0, -6.0, -7.0, -8.0, -22.0, 0.0, -14.0, -12.0, -14.0, -20.0, 0.0, -15.0, -18.0, -20.0, -30.0, 0.0, -10.0, -12.0, -12.0, -26.0, 0.0, -20.0, -17.0, -14.0, -26.0, 0.0, -4.0, -20.0, -36.0, -60.0, 0.0, -24.0, -30.0, -35.0, -60.0, 0.0, -20.0, -30.0, -36.0, -60.0, 0.0, -9.0, -16.0, -28.0, -55.0, 0.0, -12.0, -30.0, -40.0, -64.0, 0.0, -6.0, -32.0, -20.0, -50.0, 0.0, -20.0, -15.0, -40.0, -56.0, 0.0, -12.0, -26.0, -26.0, -44.0, 0.0, -11.0, -22.0, -22.0, -50.0, 0.0, -16.0, -35.0, -40.0, -60.0];
const FMT_B: StaticArray<f32> = [60.0, 70.0, 110.0, 120.0, 130.0, 40.0, 80.0, 100.0, 120.0, 120.0, 60.0, 90.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 80.0, 90.0, 120.0, 130.0, 140.0, 70.0, 80.0, 100.0, 120.0, 120.0, 40.0, 90.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 40.0, 80.0, 100.0, 120.0, 120.0, 80.0, 90.0, 120.0, 130.0, 140.0, 60.0, 80.0, 120.0, 150.0, 200.0, 50.0, 100.0, 120.0, 150.0, 200.0, 70.0, 80.0, 100.0, 130.0, 135.0, 50.0, 60.0, 170.0, 180.0, 200.0, 80.0, 90.0, 120.0, 130.0, 140.0, 60.0, 100.0, 120.0, 150.0, 200.0, 60.0, 90.0, 100.0, 120.0, 120.0, 70.0, 80.0, 100.0, 130.0, 135.0, 50.0, 60.0, 170.0, 180.0, 200.0];

let sampleRate: f32 = 48000.0;
const nAct:  StaticArray<i32> = new StaticArray<i32>(NN);
const nGate: StaticArray<i32> = new StaticArray<i32>(NN);
const nId:   StaticArray<i32> = new StaticArray<i32>(NN);
const nAge:  StaticArray<i32> = new StaticArray<i32>(NN);
const nFreq: StaticArray<f32> = new StaticArray<f32>(NN);
const nVel:  StaticArray<f32> = new StaticArray<f32>(NN);
const uPh:   StaticArray<f32> = new StaticArray<f32>(NU);
const uVph:  StaticArray<f32> = new StaticArray<f32>(NU);   // vibrato phase
const uVr:   StaticArray<f32> = new StaticArray<f32>(NU);   // vibrato rate factor
const uDet:  StaticArray<f32> = new StaticArray<f32>(NU);   // detune (cents)
const uDly:  StaticArray<f32> = new StaticArray<f32>(NU);   // entry delay (s)
const uEnv:  StaticArray<f32> = new StaticArray<f32>(NU);
const uAge:  StaticArray<f32> = new StaticArray<f32>(NU);
const uLp:   StaticArray<f32> = new StaticArray<f32>(NU);   // source tilt filter
const uPan:  StaticArray<f32> = new StaticArray<f32>(NU);
const uLo:   StaticArray<f32> = new StaticArray<f32>(NU * 5);
const uBp:   StaticArray<f32> = new StaticArray<f32>(NU * 5);
const fG:    StaticArray<f32> = new StaticArray<f32>(5);
const fQ:    StaticArray<f32> = new StaticArray<f32>(5);
const fA:    StaticArray<f32> = new StaticArray<f32>(5);

let ageCounter: i32 = 0; let seed: u32 = 1234;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0; let expr: f32 = 1.0;
let dcx0: f32 = 0.0; let dcy0: f32 = 0.0; let dcx1: f32 = 0.0; let dcy1: f32 = 0.0;
let sinceCoef: i32 = 1 << 20;

const RVN: i32 = 4;
const rvLen: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvBufL: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvBufR: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvPos: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvLpL: StaticArray<f32> = new StaticArray<f32>(RVN);
const rvLpR: StaticArray<f32> = new StaticArray<f32>(RVN);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }
@inline function blep(t: f32, dt: f32): f32 {
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let n = 0; n < NN; n++) { nAct[n] = 0; nGate[n] = 0; nId[n] = -1; nAge[n] = 0; nFreq[n] = 220.0; nVel[n] = 0.0; }
  for (let u = 0; u < NU; u++) { uPh[u] = 0.0; uVph[u] = 0.0; uVr[u] = 1.0; uDet[u] = 0.0; uDly[u] = 0.0; uEnv[u] = 0.0; uAge[u] = 0.0; uLp[u] = 0.0; uPan[u] = 0.0; }
  for (let i = 0; i < NU * 5; i++) { uLo[i] = 0.0; uBp[i] = 0.0; }
  for (let k = 0; k < 5; k++) { fG[k] = 0.0; fQ[k] = 0.1; fA[k] = 0.0; }
  ageCounter = 0; seed = 1234; bendN = 0.0; modWheel = 0.0; pressure = 0.0; expr = 1.0; dcx0 = 0.0; dcy0 = 0.0; dcx1 = 0.0; dcy1 = 0.0; sinceCoef = 1 << 20;
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [2.0, 0.0, 0.5, 3.0, 0.5, 0.4, 0.45, 0.5, 0.45, 0.5, 0.15, 0.55, 0.25, 0.7, 0.45, 0.6, 0.1667, 0.7, 0.3];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
  else if (num == 11) expr = 0.2 + 0.8 * clampf(value, 0.0, 1.0);
}

function updateFormants(): void {
  const sr: f32 = sampleRate;
  const vt: i32 = i32(params[P_TYPE] + 0.5) & 3;
  const vw: f32 = clampf(params[P_VOWEL] + modWheel * (1.0 - params[P_VOWEL]) * 0.8, 0.0, 1.0) * 4.0;
  let vi: i32 = i32(vw); if (vi > 3) vi = 3;
  const vf: f32 = vw - f32(vi);
  const shift: f32 = f32(Mathf.pow(2.0, (params[P_SHIFT] - 0.5) * 1.2));
  for (let k = 0; k < 5; k++) {
    const b0: i32 = (vt * 5 + vi) * 5 + k; const b1: i32 = (vt * 5 + vi + 1) * 5 + k;
    const fa: f32 = FMT_F[b0]; const fb: f32 = FMT_F[b1];
    const fc: f32 = clampf((fa + (fb - fa) * vf) * shift, 80.0, sr * 0.2);
    const bwA: f32 = FMT_B[b0]; const bwB: f32 = FMT_B[b1];
    const bw: f32 = (bwA + (bwB - bwA) * vf) * (0.8 + shift * 0.2);
    const dB: f32 = FMT_A[b0] + (FMT_A[b1] - FMT_A[b0]) * vf;
    fG[k] = 2.0 * f32(Mathf.sin(PI * fc / sr));
    fQ[k] = clampf(bw / fc, 0.02, 1.5);
    fA[k] = f32(Mathf.pow(10.0, dB / 20.0));
  }
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NN; i++) if (nAct[i] == 0) { slot = i; break; }
  if (slot < 0) { let o: i32 = 0; for (let i = 1; i < NN; i++) if (nAge[i] < nAge[o]) o = i; slot = o; }
  nId[slot] = id; nAct[slot] = 1; nGate[slot] = 1; nAge[slot] = ageCounter++; nFreq[slot] = f > 20.0 ? f : 20.0; nVel[slot] = clampf(vel, 0.0, 1.0);
  const ens: f32 = params[P_ENS]; const human: f32 = params[P_HUMAN];
  for (let s = 0; s < NSG; s++) {
    const u: i32 = slot * NSG + s;
    uPh[u] = f32(s) * 0.27 + rnd() * 0.1; uVph[u] = (rnd() * 0.5 + 0.5); uVr[u] = 1.0 + rnd() * 0.12 * (0.3 + human);
    uDet[u] = rnd() * 22.0 * ens; uDly[u] = (rnd() * 0.5 + 0.5) * 0.35 * human; uEnv[u] = 0.0; uAge[u] = 0.0; uLp[u] = 0.0;
    uPan[u] = (f32(s) - 1.5) / 1.5 * (0.6 + rnd() * 0.2);
    for (let k = 0; k < 5; k++) { uLo[u * 5 + k] = 0.0; uBp[u * 5 + k] = 0.0; }
  }
  sinceCoef = 1 << 20;
}

export function noteOff(id: i32): void {
  for (let n = 0; n < NN; n++) if (nAct[n] == 1 && nGate[n] == 1 && nId[n] == id) nGate[n] = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const dt: f32 = 1.0 / sr;
  const size: i32 = i32(params[P_SIZE] + 0.5) < 1 ? 1 : (i32(params[P_SIZE] + 0.5) > NSG ? NSG : i32(params[P_SIZE] + 0.5));
  const vibInc: f32 = (4.2 + params[P_VIBR] * 3.5) / sr;
  const vibD: f32 = params[P_VIB] * 0.55 + modWheel * 0.3 + pressure * 0.3;
  const atkK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.03 + params[P_ATK] * params[P_ATK] * 1.6) * sr)));
  const relK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.06 + params[P_REL] * params[P_REL] * 2.5) * sr)));
  const breath: f32 = params[P_BREATH];
  const effort: f32 = params[P_EFFORT]; const tiltK: f32 = 0.06 + effort * effort * 0.75;
  const scoop: f32 = params[P_SCOOP] * 2.5;
  const width: f32 = params[P_WIDTH];
  const space: f32 = params[P_SPACE]; const fbk: f32 = 0.74 + params[P_HALL] * 0.24;
  const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 2.2;
  const velS: f32 = params[P_VELS];
  const norm: f32 = 1.0 / f32(Mathf.sqrt(f32(size)));
  let lv: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    if (sinceCoef >= 64) { updateFormants(); sinceCoef = 0; }
    sinceCoef++;
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let nt = 0; nt < NN; nt++) {
      if (nAct[nt] == 0) continue;
      let alive: bool = false;
      const gain: f32 = (1.0 - velS + velS * nVel[nt]) * expr * (1.0 + pressure * 0.4);
      for (let s = 0; s < size; s++) {
        const u: i32 = nt * NSG + s;
        uAge[u] += dt;
        // envelope (singers enter at slightly different times)
        const tgt: f32 = (nGate[nt] == 1 && uAge[u] >= uDly[u]) ? 1.0 : 0.0;
        uEnv[u] += (tgt > uEnv[u] ? atkK : relK) * (tgt - uEnv[u]);
        if (uEnv[u] > 0.0005 || nGate[nt] == 1) alive = true;
        if (uEnv[u] < 0.00005 && nGate[nt] == 0) continue;
        // pitch: vibrato (delayed in), scoop, ensemble detune
        uVph[u] += vibInc * uVr[u]; if (uVph[u] >= 1.0) uVph[u] -= 1.0;
        const vibAmt: f32 = clampf((uAge[u] - 0.25) / 0.6, 0.0, 1.0);
        const semi: f32 = bendSemi + f32(Mathf.sin(uVph[u] * TWO_PI)) * vibD * vibAmt + uDet[u] * 0.01 - scoop * f32(Mathf.exp(-uAge[u] / 0.12));
        const fr: f32 = nFreq[nt] * f32(Mathf.pow(2.0, semi * (1.0 / 12.0)));
        const dtp: f32 = clampf(fr / sr, 0.00002, 0.4);
        uPh[u] += dtp; if (uPh[u] >= 1.0) uPh[u] -= 1.0;
        // glottal-style source: saw with tilt + breath noise
        let src: f32 = 2.0 * uPh[u] - 1.0 - blep(uPh[u], dtp);
        uLp[u] += tiltK * (src - uLp[u]);
        src = uLp[u] * (0.6 + effort * 0.8) + (src - uLp[u]) * effort * 0.3;
        src += rnd() * breath * 0.5;
        // five parallel formants
        let voc: f32 = 0.0;
        const b5: i32 = u * 5;
        for (let k = 0; k < 5; k++) {
          const hp: f32 = src - uLo[b5 + k] - fQ[k] * uBp[b5 + k];
          uBp[b5 + k] += fG[k] * hp; uLo[b5 + k] += fG[k] * uBp[b5 + k];
          voc += uBp[b5 + k] * fQ[k] * fA[k];
        }
        const o: f32 = voc * uEnv[u] * gain * norm;
        const pan: f32 = clampf(uPan[u] * width, -1.0, 1.0);
        mixL += o * f32(Mathf.sqrt(0.5 * (1.0 - pan)));
        mixR += o * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
      }
      if (!alive && nGate[nt] == 0) nAct[nt] = 0;
      lv = clampf(f32(Mathf.abs(mixL)) * 3.0, 0.0, 1.0);
    }
    let l: f32 = mixL - dcx0 + 0.995 * dcy0; dcx0 = mixL; dcy0 = l;
    let r: f32 = mixR - dcx1 + 0.995 * dcy1; dcx1 = mixR; dcy1 = r;
    l *= level; r *= level;
    if (space > 0.001) {
      let wl: f32 = 0.0; let wr: f32 = 0.0;
      for (let c = 0; c < RVN; c++) {
        const len: i32 = rvLen[c]; const q: i32 = rvPos[c]; const oo: i32 = c * 2400 + q;
        const cL: f32 = rvBufL[oo]; const cR: f32 = rvBufR[oo];
        rvLpL[c] += 0.4 * (cL - rvLpL[c]); rvLpR[c] += 0.4 * (cR - rvLpR[c]);
        rvBufL[oo] = (l + r) * 0.35 + rvLpL[c] * fbk;
        rvBufR[oo] = (l - r) * 0.35 + (c & 1 ? -1.0 : 1.0) * rvLpR[c] * fbk + (l + r) * 0.2;
        rvPos[c] = q + 1 >= len ? 0 : q + 1;
        wl += cL; wr += cR;
      }
      l += wl * 0.32 * space; r += wr * 0.32 * space;
    }
    outBuf[f] = f32(Mathf.tanh(l)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r));
  }
  display[0] = lv;
}
