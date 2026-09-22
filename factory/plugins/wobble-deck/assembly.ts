// =====================================================================
//  WOBBLE DECK — a tape / cassette degrader.
//  The signal runs through a modulated delay line whose length wanders:
//  slow WOW, faster FLUTTER (both speed-dependent) and random DRIFT, with a
//  stereo link control. Random DROPOUTS dip the level like oxide loss.
//  A tape-style saturator (asymmetric, drive-controlled) and a fast
//  SQUASH compressor follow, then the head: HEAD BUMP (low resonance),
//  Age/speed-dependent high-frequency loss, azimuth error (a small
//  delay and treble loss between channels), hiss and mains hum. The dry
//  path is delay-matched so Mix never combs.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 18;
const DN: i32 = 4096;
const BASE: f32 = 900.0;          // base delay in samples (at 48 kHz-ish); wet and dry are both delayed by this
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_WOW: i32 = 0;   const P_WOWR: i32 = 1;  const P_FLUT: i32 = 2;  const P_DRIFT: i32 = 3;  const P_LINK: i32 = 4;
const P_DROPR: i32 = 5; const P_DROPD: i32 = 6; const P_SAT: i32 = 7;   const P_SQUASH: i32 = 8; const P_AGE: i32 = 9;
const P_BUMP: i32 = 10; const P_HISS: i32 = 11; const P_HUM: i32 = 12;  const P_AZ: i32 = 13;    const P_SPEED: i32 = 14;
const P_MIX: i32 = 15;  const P_DRIVEIN: i32 = 16; const P_OUT: i32 = 17;

let sampleRate: f32 = 48000.0;
const dlyW: StaticArray<f32> = new StaticArray<f32>(DN);      // wet path
const dlyDry: StaticArray<f32> = new StaticArray<f32>(DN);    // dry path (delay-matched)
const dlyWR: StaticArray<f32> = new StaticArray<f32>(DN);
const dlyDryR: StaticArray<f32> = new StaticArray<f32>(DN);
const azBuf: StaticArray<f32> = new StaticArray<f32>(256);
let wIdx: i32 = 0; let azIdx: i32 = 0;
let wowPh: f32 = 0.0; let flPh1: f32 = 0.0; let flPh2: f32 = 0.0; let scrPh: f32 = 0.0;
let driftS: f32 = 0.0; let driftT: f32 = 0.0; let driftTimer: i32 = 0; let wowJit: f32 = 0.0; let wowJitT: f32 = 0.0;
let dropG: f32 = 1.0; let dropT: f32 = 1.0; let dropLeft: i32 = 0; let dropWait: i32 = 0;
let envS: f32 = 0.0;
let lp1L: f32 = 0.0; let lp2L: f32 = 0.0; let lp1R: f32 = 0.0; let lp2R: f32 = 0.0; let azLp: f32 = 0.0;
let bumpL: f32 = 0.0; let bumpR: f32 = 0.0;
let hxL: f32 = 0.0; let hyL: f32 = 0.0; let hxR: f32 = 0.0; let hyR: f32 = 0.0;
let hissLpL: f32 = 0.0; let hissLpR: f32 = 0.0; let humPh: f32 = 0.0;
let seed: u32 = 2468;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < DN; i++) { dlyW[i] = 0.0; dlyDry[i] = 0.0; dlyWR[i] = 0.0; dlyDryR[i] = 0.0; }
  for (let i = 0; i < 256; i++) azBuf[i] = 0.0;
  wIdx = 0; azIdx = 0; wowPh = 0.0; flPh1 = 0.0; flPh2 = 0.0; scrPh = 0.0; driftS = 0.0; driftT = 0.0; driftTimer = 0; wowJit = 0.0; wowJitT = 0.0;
  dropG = 1.0; dropT = 1.0; dropLeft = 0; dropWait = i32(sampleRate * 0.8); envS = 0.0;
  lp1L = 0.0; lp2L = 0.0; lp1R = 0.0; lp2R = 0.0; azLp = 0.0; bumpL = 0.0; bumpR = 0.0;
  hxL = 0.0; hyL = 0.0; hxR = 0.0; hyR = 0.0; hissLpL = 0.0; hissLpR = 0.0; humPh = 0.0; seed = 2468;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [0.4, 0.35, 0.3, 0.3, 0.6, 0.25, 0.5, 0.4, 0.3, 0.4, 0.4, 0.15, 0.0, 0.2, 1.0, 1.0, 0.4, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

// linear-interpolated read `d` samples behind the write index
@inline function tap(buf: StaticArray<f32>, w: i32, d: f32): f32 {
  let rp: f32 = f32(w) - d; if (rp < 0.0) rp += f32(DN);
  const i0: i32 = i32(rp); const fr: f32 = rp - f32(i0);
  const a: i32 = i0 >= DN ? i0 - DN : i0; const b: i32 = a + 1 >= DN ? 0 : a + 1;
  return buf[a] * (1.0 - fr) + buf[b] * fr;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const dt: f32 = 1.0 / sr;
  const spd: i32 = i32(params[P_SPEED] + 0.5);
  const spdF: f32 = spd == 0 ? 1.0 : (spd == 1 ? 0.55 : 0.3);                 // slower tape wobbles more, and faster
  const baseHz: f32 = spd == 0 ? 9500.0 : (spd == 1 ? 13000.0 : 17500.0);
  const hfHz: f32 = clampf(baseHz * (1.0 - params[P_AGE] * 0.82), 1200.0, sr * 0.45);
  const hfK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * hfHz / sr));
  const scale: f32 = sr / 48000.0;
  const wow: f32 = params[P_WOW] * (0.4 + spdF * 0.9); const flut: f32 = params[P_FLUT] * (0.4 + spdF * 0.9); const drift: f32 = params[P_DRIFT];
  const wowInc: f32 = (0.25 + params[P_WOWR] * 2.2) / sr;
  const flInc1: f32 = (5.0 + spdF * 4.0) / sr; const flInc2: f32 = (9.7 + spdF * 5.0) / sr;
  const link: f32 = params[P_LINK];
  const dropRate: f32 = params[P_DROPR]; const dropDepth: f32 = params[P_DROPD];
  const sat: f32 = params[P_SAT]; const drv: f32 = 1.0 + params[P_DRIVEIN] * 3.0;
  const squash: f32 = params[P_SQUASH];
  const bump: f32 = params[P_BUMP]; const bumpK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * (spd == 2 ? 70.0 : (spd == 1 ? 90.0 : 120.0)) / sr));
  const hiss: f32 = params[P_HISS] * (spd == 0 ? 1.0 : (spd == 1 ? 0.6 : 0.35)) * 0.03;
  const hum: f32 = params[P_HUM] * 0.02; const humInc: f32 = 50.0 / sr;
  const az: f32 = params[P_AZ];
  const mix: f32 = params[P_MIX]; const outG: f32 = params[P_OUT] * params[P_OUT] * 2.0;
  const envA: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.004 * sr))); const envR: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.16 * sr)));
  const dropSm: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.004 * sr)));
  const baseD: f32 = BASE * scale;
  let lvl: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    const xL0: f32 = inBuf[f];
    const xR0: f32 = inBuf[MAX_FRAMES + f];
    // ---- transport instability ------------------------------------------------------------------
    wowPh += wowInc; if (wowPh >= 1.0) wowPh -= 1.0;
    flPh1 += flInc1; if (flPh1 >= 1.0) flPh1 -= 1.0;
    flPh2 += flInc2; if (flPh2 >= 1.0) flPh2 -= 1.0;
    driftTimer--; if (driftTimer <= 0) { driftTimer = i32(0.35 * sr); driftT = rnd(); wowJitT = rnd(); }
    driftS += (driftT - driftS) * 0.00006; wowJit += (wowJitT - wowJit) * 0.0004;
    const wSin: f32 = f32(Mathf.sin(wowPh * TWO_PI)) + wowJit * 0.5;
    const fSin: f32 = f32(Mathf.sin(flPh1 * TWO_PI)) * 0.6 + f32(Mathf.sin(flPh2 * TWO_PI)) * 0.4;
    const modL: f32 = (wSin * wow * 3.2 + fSin * flut * 0.34 + driftS * drift * 5.0) * 0.001 * sr;
    const modR: f32 = (f32(Mathf.sin((wowPh + (1.0 - link) * 0.31) * TWO_PI) + wowJit * 0.5) * wow * 3.2 + f32(Mathf.sin((flPh1 + (1.0 - link) * 0.17) * TWO_PI)) * flut * 0.34 * 0.6 + f32(Mathf.sin((flPh2 + (1.0 - link) * 0.23) * TWO_PI)) * flut * 0.34 * 0.4 + driftS * drift * 5.0 * (1.0 - (1.0 - link) * 0.4)) * 0.001 * sr;
    dlyW[wIdx] = xL0; dlyDry[wIdx] = xL0; dlyWR[wIdx] = xR0; dlyDryR[wIdx] = xR0;
    let wetL: f32 = tap(dlyW, wIdx, clampf(baseD + modL, 4.0, f32(DN - 4)));
    let wetR: f32 = tap(dlyWR, wIdx, clampf(baseD + modR, 4.0, f32(DN - 4)));
    const dryL: f32 = tap(dlyDry, wIdx, baseD); const dryR: f32 = tap(dlyDryR, wIdx, baseD);
    wIdx = wIdx + 1 >= DN ? 0 : wIdx + 1;
    // ---- dropouts --------------------------------------------------------------------------------
    if (dropLeft > 0) { dropLeft--; if (dropLeft == 0) dropT = 1.0; }
    else {
      dropWait--;
      if (dropWait <= 0) {
        const avg: f32 = 3.5 - dropRate * 3.2;                       // seconds between dropouts
        dropWait = i32(sr * avg * (0.4 + f32(Mathf.abs(rnd())) * 1.2));
        if (dropRate > 0.01) { dropLeft = i32(sr * (0.015 + f32(Mathf.abs(rnd())) * 0.22)); dropT = 1.0 - dropDepth * (0.35 + f32(Mathf.abs(rnd())) * 0.65); }
      }
    }
    dropG += dropSm * (dropT - dropG);
    wetL *= dropG; wetR *= dropG;
    // ---- tape: drive, saturation, squash ---------------------------------------------------------------
    let l: f32 = wetL * drv; let r: f32 = wetR * drv;
    const bias: f32 = 0.12 * sat;
    l = (f32(Mathf.tanh(l * (1.0 + sat * 3.0) + bias)) - f32(Mathf.tanh(bias))) / (1.0 + sat * 1.2);
    r = (f32(Mathf.tanh(r * (1.0 + sat * 3.0) + bias)) - f32(Mathf.tanh(bias))) / (1.0 + sat * 1.2);
    const pk: f32 = f32(Mathf.abs(l)) > f32(Mathf.abs(r)) ? f32(Mathf.abs(l)) : f32(Mathf.abs(r));
    envS += (pk > envS ? envA : envR) * (pk - envS);
    const sq: f32 = 1.0 / (1.0 + squash * 3.5 * envS);
    l *= sq * (1.0 + squash * 0.8); r *= sq * (1.0 + squash * 0.8);
    // ---- head: bump, HF loss, azimuth ----------------------------------------------------------------------
    bumpL += bumpK * (l - bumpL); bumpR += bumpK * (r - bumpR);
    l += bumpL * bump * 1.1; r += bumpR * bump * 1.1;
    lp1L += hfK * (l - lp1L); lp2L += hfK * (lp1L - lp2L); l = lp2L;
    const hfKr: f32 = hfK * (1.0 - az * 0.75);
    lp1R += hfKr * (r - lp1R); lp2R += hfKr * (lp1R - lp2R); r = lp2R;
    if (az > 0.001) {
      azBuf[azIdx] = r;
      const ad: i32 = i32(az * 14.0 * scale + 0.5);
      let rp: i32 = azIdx - ad; if (rp < 0) rp += 256;
      r = azBuf[rp]; azIdx = azIdx + 1 >= 256 ? 0 : azIdx + 1;
    }
    // ---- noise floor: hiss (tape-shaped) and hum -------------------------------------------------------------
    hissLpL += hfK * (rnd() - hissLpL); hissLpR += hfK * (rnd() - hissLpR);
    humPh += humInc; if (humPh >= 1.0) humPh -= 1.0;
    const hm: f32 = (f32(Mathf.sin(humPh * TWO_PI)) + 0.5 * f32(Mathf.sin(humPh * TWO_PI * 2.0)) + 0.3 * f32(Mathf.sin(humPh * TWO_PI * 3.0))) * hum;
    l += hissLpL * hiss * 3.0 + hm; r += hissLpR * hiss * 3.0 + hm;
    // DC / subsonic block
    const yl: f32 = l - hxL + 0.997 * hyL; hxL = l; hyL = yl; l = yl;
    const yr: f32 = r - hxR + 0.997 * hyR; hxR = r; hyR = yr; r = yr;
    const oL: f32 = (dryL * (1.0 - mix) + l * mix) * outG;
    const oR: f32 = (dryR * (1.0 - mix) + r * mix) * outG;
    outBuf[f] = f32(Mathf.tanh(oL)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(oR));
    lvl = f32(Mathf.abs(oL));
  }
  display[0] = clampf(lvl * 2.0, 0.0, 1.0);
}
