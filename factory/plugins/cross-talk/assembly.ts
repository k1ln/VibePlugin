// =====================================================================
//  CROSS-TALK — a two-signal cross-modulator and 16-band vocoder.
//  Modulator = right input (or the mono sum); carrier = an internal
//  four-note oscillator chord, or the left input. ALGORITHM sweeps one
//  continuous path through six ways of making the two signals talk:
//   0 crossfade -> 1 cross-fold -> 2 ring modulation -> 3 bitwise
//   (AND/XOR/OR) -> 4 comparator (max/min/gate) -> 5 channel vocoder.
//  TIMBRE is re-mapped by each stage. The vocoder is a 16-band filter
//  bank (steep two-stage band-passes, formant shift, adjustable width,
//  attack/release followers, gate, freeze, sibilance). Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NB: i32 = 16;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;
const DLY_N: i32 = 2048;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_ALGO: i32 = 0;   const P_TIMBRE: i32 = 1;  const P_CSRC: i32 = 2;   const P_MODLV: i32 = 3;
const P_CARLV: i32 = 4;  const P_PITCH: i32 = 5;   const P_CHORD: i32 = 6;  const P_WAVE: i32 = 7;
const P_DETUNE: i32 = 8; const P_SHIFT: i32 = 9;   const P_WIDTHQ: i32 = 10; const P_ATK: i32 = 11;
const P_REL: i32 = 12;   const P_FREEZE: i32 = 13; const P_SIBIL: i32 = 14; const P_GATE: i32 = 15;
const P_DRYMOD: i32 = 16; const P_DRIVE: i32 = 17; const P_WIDTH: i32 = 18; const P_LEVEL: i32 = 19;
const NUM_PARAMS: i32 = 20;

let sampleRate: f32 = 48000.0;

// vocoder bank
const bandF:  StaticArray<f32> = new StaticArray<f32>(NB);
const mLo1: StaticArray<f32> = new StaticArray<f32>(NB); const mBp1: StaticArray<f32> = new StaticArray<f32>(NB);
const mLo2: StaticArray<f32> = new StaticArray<f32>(NB); const mBp2: StaticArray<f32> = new StaticArray<f32>(NB);
const cLo1: StaticArray<f32> = new StaticArray<f32>(NB); const cBp1: StaticArray<f32> = new StaticArray<f32>(NB);
const cLo2: StaticArray<f32> = new StaticArray<f32>(NB); const cBp2: StaticArray<f32> = new StaticArray<f32>(NB);
const bEnv: StaticArray<f32> = new StaticArray<f32>(NB);
const mG:   StaticArray<f32> = new StaticArray<f32>(NB);   // modulator SVF coefficients
const cG:   StaticArray<f32> = new StaticArray<f32>(NB);   // carrier SVF coefficients

// internal carrier: 4 voices
const oPh:  StaticArray<f32> = new StaticArray<f32>(4);
const oInc: StaticArray<f32> = new StaticArray<f32>(4);
const CHORDS: StaticArray<f32> = [
  0.0, 0.0, 0.0, 0.0,     0.0, 12.0, -12.0, 0.0,   0.0, 7.0, 12.0, -12.0,  0.0, 3.0, 7.0, 12.0,
  0.0, 4.0, 7.0, 12.0,    0.0, 5.0, 7.0, 12.0,     0.0, 4.0, 7.0, 11.0
];
const dly: StaticArray<f32> = new StaticArray<f32>(DLY_N);
let dlyW: i32 = 0;
let seed: u32 = 777;
let sibEnv: f32 = 0.0; let hfLp: f32 = 0.0; let modLp: f32 = 0.0; let gateEnv: f32 = 0.0; let dcX: f32 = 0.0; let dcY: f32 = 0.0;
let sinceCoef: i32 = 1 << 20;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }
@inline function blep(t: f32, dt: f32): f32 {
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}
@inline function fold(x: f32): f32 {
  let p: f32 = x * 0.25 + 0.25; p = p - f32(Math.floor(p));
  return f32(Mathf.abs(p * 4.0 - 2.0)) - 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < NB; i++) {
    bandF[i] = 100.0 * f32(Mathf.pow(80.0, f32(i) / f32(NB - 1)));
    mLo1[i] = 0.0; mBp1[i] = 0.0; mLo2[i] = 0.0; mBp2[i] = 0.0;
    cLo1[i] = 0.0; cBp1[i] = 0.0; cLo2[i] = 0.0; cBp2[i] = 0.0; bEnv[i] = 0.0; mG[i] = 0.0; cG[i] = 0.0;
    display[i] = 0.0;
  }
  for (let i = 0; i < 4; i++) { oPh[i] = f32(i) * 0.23; oInc[i] = 0.0; }
  for (let i = 0; i < DLY_N; i++) dly[i] = 0.0;
  dlyW = 0; seed = 777; sibEnv = 0.0; hfLp = 0.0; modLp = 0.0; gateEnv = 0.0; dcX = 0.0; dcY = 0.0; sinceCoef = 1 << 20;
  const d: f32[] = [0.85, 0.5, 0.0, 0.6, 0.6, 0.35, 3.0, 0.15, 0.25, 0.5, 0.5, 0.25, 0.35, 0.0, 0.4, 0.05, 0.0, 0.15, 0.5, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

function updateCoefs(): void {
  const sr: f32 = sampleRate;
  const shift: f32 = f32(Mathf.pow(2.0, (params[P_SHIFT] - 0.5) * 2.0));
  const cmax: f32 = sr * 0.16;
  for (let i = 0; i < NB; i++) {
    const fm: f32 = clampf(bandF[i], 60.0, cmax);
    const fc: f32 = clampf(bandF[i] * shift, 60.0, cmax);
    mG[i] = 2.0 * f32(Mathf.sin(PI * fm / sr));
    cG[i] = 2.0 * f32(Mathf.sin(PI * fc / sr));
  }
  // carrier chord frequencies
  const base: f32 = 440.0 * f32(Mathf.pow(2.0, (24.0 + params[P_PITCH] * 60.0 - 69.0) / 12.0));
  let ci: i32 = i32(params[P_CHORD] + 0.5); if (ci < 0) ci = 0; if (ci > 6) ci = 6;
  const det: f32 = params[P_DETUNE] * 30.0;   // spread in cents, alternating sign per voice
  for (let v = 0; v < 4; v++) {
    const cents: f32 = (v & 1) == 1 ? det : -det;
    oInc[v] = base * f32(Mathf.pow(2.0, (CHORDS[ci * 4 + v] + cents * 0.01) / 12.0)) / sr;
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const algo: f32 = clampf(params[P_ALGO], 0.0, 1.0) * 5.0;
  const T: f32 = clampf(params[P_TIMBRE], 0.0, 1.0);
  const extCar: bool = params[P_CSRC] > 0.5;
  const modG: f32 = params[P_MODLV] * 4.0;
  const carG: f32 = params[P_CARLV] * 2.0;
  const wave: f32 = params[P_WAVE];
  const q: f32 = 1.0 / (2.5 + params[P_WIDTHQ] * 14.0);      // higher control = narrower bands
  const atk: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.0005 + params[P_ATK] * params[P_ATK] * 0.06) * sr)));
  const rel: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.004 + params[P_REL] * params[P_REL] * 0.6) * sr)));
  const freeze: bool = params[P_FREEZE] > 0.5;
  const sibil: f32 = params[P_SIBIL];
  const thr: f32 = params[P_GATE] * 0.02;
  const dryMod: f32 = params[P_DRYMOD];
  const drive: f32 = 1.0 + params[P_DRIVE] * 5.0;
  const wdt: i32 = i32(params[P_WIDTH] * 24.0);
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.6;
  let stA: i32 = i32(algo); if (stA > 4) stA = 4;
  const fr: f32 = algo - f32(stA);                            // crossfade toward the next stage
  const cross: f32 = fr;

  for (let f = 0; f < n; f++) {
    if (sinceCoef >= 64) { updateCoefs(); sinceCoef = 0; }
    sinceCoef++;
    const inL: f32 = inBuf[f];
    const inR: f32 = inBuf[MAX_FRAMES + f];
    // modulator: right input (falls back to mono sum if right is empty)
    const mod: f32 = (inR != 0.0 ? inR : inL) * modG;
    // carrier: internal chord oscillator or left input
    let car: f32 = 0.0;
    if (extCar) car = inL * carG;
    else {
      let acc: f32 = 0.0;
      for (let v = 0; v < 4; v++) {
        let p: f32 = oPh[v] + oInc[v]; if (p >= 1.0) p -= 1.0; oPh[v] = p;
        const dt: f32 = clampf(oInc[v], 0.00002, 0.45);
        const saw: f32 = 2.0 * p - 1.0 - blep(p, dt);
        let q2: f32 = p + 0.5; if (q2 >= 1.0) q2 -= 1.0;
        const pul: f32 = (p < 0.5 ? 1.0 : -1.0) + blep(p, dt) - blep(q2, dt);
        const nz: f32 = rnd();
        const o: f32 = wave < 0.5 ? saw + (pul - saw) * (wave * 2.0) : pul + (nz - pul) * ((wave - 0.5) * 2.0);
        acc += o;
      }
      car = acc * 0.28 * carG * 1.6;
    }
    const cc: f32 = clampf(car, -1.5, 1.5);
    const mm: f32 = clampf(mod, -1.5, 1.5);

    // ---- stage outputs ------------------------------------------------------
    let a: f32 = 0.0; let b: f32 = 0.0;
    for (let pass = 0; pass < 2; pass++) {
      const k: i32 = stA + pass;
      if (pass == 1 && cross < 0.001) break;
      let o: f32 = 0.0;
      if (k == 0) {
        const th: f32 = T * 1.5707963;
        o = cc * f32(Mathf.cos(th)) + mm * f32(Mathf.sin(th));
      } else if (k == 1) {
        const x: f32 = cc * 0.5 * (1.0 - T) + mm * 0.5 * (0.3 + T * 0.7) * 2.0;
        o = fold(x * (1.0 + T * 6.0)) * 0.8;
      } else if (k == 2) {
        o = f32(Mathf.tanh(cc * mm * (2.0 + T * 6.0))) * 0.9 + cc * (1.0 - T) * 0.25;
      } else if (k == 3) {
        const ia: i32 = i32(clampf(cc, -1.0, 1.0) * 32000.0); const ib: i32 = i32(clampf(mm, -1.0, 1.0) * 32000.0);
        const an: f32 = f32(ia & ib) / 32768.0; const xo: f32 = f32(ia ^ ib) / 32768.0; const orr: f32 = f32(ia | ib) / 32768.0;
        o = T < 0.5 ? an + (xo - an) * (T * 2.0) : xo + (orr - xo) * ((T - 0.5) * 2.0);
        o *= 0.9;
      } else if (k == 4) {
        const mx: f32 = cc > mm ? cc : mm; const mn: f32 = cc < mm ? cc : mm;
        const gt: f32 = (cc > mm ? 0.5 : -0.5) * 0.9;
        o = T < 0.5 ? mx + (mn - mx) * (T * 2.0) : mn + (gt - mn) * ((T - 0.5) * 2.0);
      } else {
        // ---- 16-band vocoder ------------------------------------------------------
        let sum: f32 = 0.0;
        for (let i = 0; i < NB; i++) {
          // modulator side: two cascaded band-passes (steep skirts)
          const x: f32 = mm;
          let hp: f32 = x - mLo1[i] - q * mBp1[i];
          mBp1[i] += mG[i] * hp; mLo1[i] += mG[i] * mBp1[i];
          const y1: f32 = mBp1[i] * q;
          hp = y1 - mLo2[i] - q * mBp2[i];
          mBp2[i] += mG[i] * hp; mLo2[i] += mG[i] * mBp2[i];
          const y2: f32 = mBp2[i];
          // envelope follower
          const rect: f32 = f32(Mathf.abs(y2 * q * 2.0));
          let e: f32 = bEnv[i];
          if (!freeze) { e += (rect > e ? atk : rel) * (rect - e); bEnv[i] = e; }
          // carrier side
          let ch: f32 = cc - cLo1[i] - q * cBp1[i];
          cBp1[i] += cG[i] * ch; cLo1[i] += cG[i] * cBp1[i];
          const c1: f32 = cBp1[i] * q;
          ch = c1 - cLo2[i] - q * cBp2[i];
          cBp2[i] += cG[i] * ch; cLo2[i] += cG[i] * cBp2[i];
          let ev: f32 = e - thr; if (ev < 0.0) ev = 0.0;
          sum += cBp2[i] * ev;
        }
        o = sum * (8.0 + T * 24.0) * (1.0 + q * 3.0);
      }
      if (pass == 0) a = o; else b = o;
    }
    let y: f32 = cross < 0.001 ? a : a * f32(Mathf.cos(cross * 1.5707963)) + b * f32(Mathf.sin(cross * 1.5707963));

    // ---- sibilance: modulator's own hiss keeps consonants intelligible ----------------
    if (sibil > 0.001) {
      modLp += 0.5 * (mm - modLp);
      hfLp += 0.5 * ((mm - modLp) - hfLp);
      const hf: f32 = mm - modLp - hfLp;
      const rc: f32 = f32(Mathf.abs(hf));
      sibEnv += (rc > sibEnv ? 0.05 : 0.002) * (rc - sibEnv);
      y += rnd() * sibEnv * sibil * 2.5;
    }
    y += mm * dryMod;
    // gentle DC block
    const yd: f32 = y - dcX + 0.995 * dcY; dcX = y; dcY = yd;
    y = f32(Mathf.tanh(yd * drive * 0.9)) * level;

    // ---- width: short Haas-style delay on the right ------------------------------------
    dly[dlyW] = y;
    let rp: i32 = dlyW - wdt; if (rp < 0) rp += DLY_N;
    outBuf[f] = y;
    outBuf[MAX_FRAMES + f] = wdt > 0 ? dly[rp] * 0.95 + y * 0.05 : y;
    dlyW = dlyW + 1 >= DLY_N ? 0 : dlyW + 1;
  }
  for (let i = 0; i < NB; i++) display[i] = clampf(f32(Mathf.sqrt(bEnv[i])) * 2.0, 0.0, 1.0);
}
