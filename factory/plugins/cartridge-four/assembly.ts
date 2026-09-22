// =====================================================================
//  CARTRIDGE FOUR — an 8-bit console sound instrument.
//  Modelled on the architecture of the Ricoh 2A03 audio unit:
//   * two PULSE channels: 8-step duty sequences (12.5/25/50/75 %), 4-bit
//     volume, hardware-style decay envelope (looping optional), sweep
//     unit, vibrato, duty animation and chord arpeggios
//   * a TRIANGLE channel: 32-step 4-bit staircase, no volume control
//   * a NOISE channel: 15-bit LFSR, long/short mode, the 16-entry period
//     table, envelope, optional key tracking
//   * a DPCM channel: 1-bit delta-modulated drums (kick / snare / toms)
//     encoded at start-up with the chip's +-2 step counter
//   * the console's NONLINEAR mixer plus its output high/low-pass chain
//   * optional timer-period pitch quantisation (why the real chip is
//     slightly out of tune up high)
//  Notes in the Drum Zone (C1-B1) play percussion; everything else is
//  pitched, either LAYERED (one note on all channels) or POLY (channels
//  take notes in turn). Pure algorithm; the drum samples are synthesised.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TWO_PI: f32 = 6.28318530717959;
const CPU: f32 = 1789773.0;
const DPCM_LEN: i32 = 10000;
const NUM_PARAMS: i32 = 38;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_MODE: i32 = 0;   const P_DRUMZ: i32 = 1;  const P_CONSOLE: i32 = 2; const P_QUANT: i32 = 3;  const P_SMOOTH: i32 = 4;
const P_DUTY1: i32 = 5;  const P_VOL1: i32 = 6;   const P_ENV1: i32 = 7;    const P_RATE1: i32 = 8;   const P_LOOP1: i32 = 9;
const P_DUTY2: i32 = 10; const P_VOL2: i32 = 11;  const P_ENV2: i32 = 12;   const P_RATE2: i32 = 13;  const P_LOOP2: i32 = 14; const P_DET2: i32 = 15;
const P_DANIM: i32 = 16; const P_SWEEP: i32 = 17; const P_SWRATE: i32 = 18; const P_VIB: i32 = 19;   const P_VIBR: i32 = 20;  const P_VIBD: i32 = 21;
const P_TLEV: i32 = 22;  const P_TOCT: i32 = 23;  const P_TLEN: i32 = 24;
const P_NLEV: i32 = 25;  const P_NPER: i32 = 26;  const P_NSHORT: i32 = 27; const P_NRATE: i32 = 28; const P_NKEY: i32 = 29;
const P_DLEV: i32 = 30;  const P_DRATE: i32 = 31; const P_ARP: i32 = 32;    const P_ARPS: i32 = 33;
const P_REL: i32 = 34;   const P_VELS: i32 = 35;  const P_BEND: i32 = 36;   const P_MASTER: i32 = 37;

let sampleRate: f32 = 48000.0;

const DUTY: StaticArray<i32> = [0x02, 0x06, 0x1E, 0xF9];        // 8-step sequences, bit n = step n
const NPER: StaticArray<f32> = [4.0, 8.0, 16.0, 32.0, 64.0, 96.0, 128.0, 160.0, 202.0, 254.0, 380.0, 508.0, 762.0, 1016.0, 2034.0, 4068.0];
const ARP: StaticArray<f32> = [
  0.0, 0.0, 0.0, 0.0,   0.0, 4.0, 7.0, 4.0,   0.0, 3.0, 7.0, 3.0,   0.0, 12.0, 0.0, 12.0,
  0.0, 4.0, 7.0, 10.0,  0.0, 4.0, 7.0, 11.0,  0.0, 5.0, 7.0, 5.0
];
const dpcm: StaticArray<f32> = new StaticArray<f32>(DPCM_LEN * 3);   // kick, snare, tom (already delta-decoded)

// melodic channels 0=pulse1 1=pulse2 2=triangle
const cAct:  StaticArray<i32> = new StaticArray<i32>(3);
const cGate: StaticArray<i32> = new StaticArray<i32>(3);
const cNote: StaticArray<i32> = new StaticArray<i32>(3);
const cAge:  StaticArray<i32> = new StaticArray<i32>(3);
const cFreq: StaticArray<f32> = new StaticArray<f32>(3);
const cVel:  StaticArray<f32> = new StaticArray<f32>(3);
const cPh:   StaticArray<f32> = new StaticArray<f32>(3);
const cEnv:  StaticArray<i32> = new StaticArray<i32>(3);     // decay counter 15..0
const cEnvT: StaticArray<f32> = new StaticArray<f32>(3);
const cRel:  StaticArray<f32> = new StaticArray<f32>(3);     // release gain
const cAge2: StaticArray<f32> = new StaticArray<f32>(3);     // seconds since note-on
const cSw:   StaticArray<f32> = new StaticArray<f32>(3);     // sweep frequency multiplier
const cSwT:  StaticArray<f32> = new StaticArray<f32>(3);
const cMute: StaticArray<i32> = new StaticArray<i32>(3);

// held-note stack for LAYERED mode
const hId:   StaticArray<i32> = new StaticArray<i32>(8);
const hFreq: StaticArray<f32> = new StaticArray<f32>(8);
let hCount: i32 = 0;

// noise
let nLfsr: u32 = 1; let nAcc: f32 = 0.0; let nOut: f32 = 0.0;
let nGate: i32 = 0; let nEnv: i32 = 0; let nEnvT: f32 = 0.0; let nRel: f32 = 0.0; let nNote: f32 = 60.0;
let nDrum: i32 = 0; let nDrumT: f32 = 0.0; let nDrumLen: f32 = 0.0; let nDrumPer: i32 = 3; let nDrumAmp: f32 = 0.0;
// dpcm
let dSel: i32 = -1; let dPos: f32 = 0.0; let dRate: f32 = 1.0; let dAmp: f32 = 1.0;

let ageCounter: i32 = 0;
let arpPh: f32 = 0.0; let arpIdx: i32 = 0;
let vibPh: f32 = 0.0; let daPh: f32 = 0.0; let swTick: f32 = 0.0;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0;
let hp1: f32 = 0.0; let hp1i: f32 = 0.0; let hp2: f32 = 0.0; let hp2i: f32 = 0.0; let lpS: f32 = 0.0; let smS: f32 = 0.0;
let seedN: u32 = 99;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rndn(): f32 { seedN = seedN * 1664525 + 1013904223; return f32(seedN >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

// delta-modulate a target into the DPCM channel's 7-bit +-2 counter
function encode(slot: i32, kind: i32): void {
  let counter: i32 = 64; let ph: f32 = 0.0; let lp: f32 = 0.0;
  for (let i = 0; i < DPCM_LEN; i++) {
    const t: f32 = f32(i) / 33143.0;
    let target: f32 = 0.0;
    if (kind == 0) {            // kick: swept sine
      const fr: f32 = 42.0 + 170.0 * f32(Mathf.exp(-t / 0.028));
      ph += fr / 33143.0; ph -= f32(Math.floor(ph));
      target = f32(Mathf.sin(ph * TWO_PI)) * f32(Mathf.exp(-t / 0.11)) * 0.95;
    } else if (kind == 1) {     // snare: tone + noise burst
      const fr: f32 = 185.0 + 60.0 * f32(Mathf.exp(-t / 0.02));
      ph += fr / 33143.0; ph -= f32(Math.floor(ph));
      lp += 0.6 * (rndn() - lp);
      target = f32(Mathf.sin(ph * TWO_PI)) * f32(Mathf.exp(-t / 0.05)) * 0.5 + lp * f32(Mathf.exp(-t / 0.075)) * 0.75;
    } else {                    // tom
      const fr: f32 = 105.0 + 85.0 * f32(Mathf.exp(-t / 0.05));
      ph += fr / 33143.0; ph -= f32(Math.floor(ph));
      target = f32(Mathf.sin(ph * TWO_PI)) * f32(Mathf.exp(-t / 0.16)) * 0.9;
    }
    const want: f32 = 64.0 + target * 62.0;
    if (want > f32(counter)) { if (counter <= 125) counter += 2; } else { if (counter >= 2) counter -= 2; }
    dpcm[slot * DPCM_LEN + i] = f32(counter - 64) / 64.0;
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let c = 0; c < 3; c++) {
    cAct[c] = 0; cGate[c] = 0; cNote[c] = -1; cAge[c] = 0; cFreq[c] = 440.0; cVel[c] = 0.0; cPh[c] = 0.0; cEnv[c] = 0;
    cEnvT[c] = 0.0; cRel[c] = 0.0; cAge2[c] = 0.0; cSw[c] = 1.0; cSwT[c] = 0.0; cMute[c] = 0;
  }
  hCount = 0; nLfsr = 1; nAcc = 0.0; nOut = 0.0; nGate = 0; nEnv = 0; nEnvT = 0.0; nRel = 0.0; nNote = 60.0;
  nDrum = 0; nDrumT = 0.0; nDrumLen = 0.0; nDrumPer = 3; nDrumAmp = 0.0; dSel = -1; dPos = 0.0; dRate = 1.0; dAmp = 1.0;
  ageCounter = 0; arpPh = 0.0; arpIdx = 0; vibPh = 0.0; daPh = 0.0; swTick = 0.0;
  bendN = 0.0; modWheel = 0.0; pressure = 0.0; hp1 = 0.0; hp1i = 0.0; hp2 = 0.0; hp2i = 0.0; lpS = 0.0; smS = 0.0; seedN = 99;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  encode(0, 0); encode(1, 1); encode(2, 2);
  const d: f32[] = [
    0.0, 1.0, 1.0, 1.0, 0.25,
    1.0, 11.0, 1.0, 6.0, 0.0,
    2.0, 8.0, 1.0, 6.0, 0.0, 6.0,
    0.0, 0.0, 3.0, 0.15, 0.4, 0.4,
    1.0, -1.0, 0.0,
    3.0, 6.0, 0.0, 3.0, 0.0,
    0.8, 0.6, 0.0, 0.5,
    0.15, 0.5, 0.1667, 0.75
  ];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
}

function trigChannel(c: i32, id: i32, f: f32, vel: f32, retrig: bool): void {
  cNote[c] = id; cFreq[c] = f; cVel[c] = vel; cGate[c] = 1; cAge[c] = ageCounter++;
  if (retrig || cAct[c] == 0) {
    cAct[c] = 1; cEnv[c] = 15; cEnvT[c] = 0.0; cRel[c] = 1.0; cAge2[c] = 0.0; cSw[c] = 1.0; cSwT[c] = 0.0; cMute[c] = 0;
    if (c == 2) cPh[c] = 0.0;
  }
}
function trigNoiseLayer(f: f32, retrig: bool): void {
  nGate = 1; nNote = 69.0 + 12.0 * f32(Mathf.log(f / 440.0) / Mathf.log(2.0));
  if (retrig) { nEnv = 15; nEnvT = 0.0; nRel = 1.0; }
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  const fr: f32 = f > 1.0 ? f : 1.0;
  const vl: f32 = clampf(vel, 0.0, 1.0);
  const midi: i32 = i32(69.0 + 12.0 * f32(Mathf.log(fr / 440.0) / Mathf.log(2.0)) + 0.5);
  if (params[P_DRUMZ] > 0.5 && midi >= 24 && midi <= 35) {
    const pc: i32 = midi - 24;
    if (pc <= 1) { dSel = 0; dPos = 0.0; dRate = 1.0; dAmp = 0.5 + vl * 0.5; }
    else if (pc <= 3) { dSel = 1; dPos = 0.0; dRate = 1.0; dAmp = 0.5 + vl * 0.5; }
    else if (pc == 4) { dSel = 2; dPos = 0.0; dRate = 0.8; dAmp = 0.5 + vl * 0.5; }
    else if (pc == 5) { dSel = 2; dPos = 0.0; dRate = 1.3; dAmp = 0.5 + vl * 0.5; }
    else {
      // noise-channel percussion: 6-7 closed hat, 8-9 open hat, 10-11 crash
      nDrum = 1; nDrumT = 0.0; nDrumAmp = 0.4 + vl * 0.6;
      if (pc <= 7) { nDrumPer = 2; nDrumLen = 0.035; }
      else if (pc <= 9) { nDrumPer = 3; nDrumLen = 0.28; }
      else { nDrumPer = 4; nDrumLen = 0.9; }
    }
    return;
  }
  const mode: i32 = i32(params[P_MODE] + 0.5);
  if (mode == 1) {
    let slot: i32 = -1;
    for (let i = 0; i < 3; i++) if (cAct[i] == 0) { slot = i; break; }
    if (slot < 0) for (let i = 0; i < 3; i++) if (cGate[i] == 0) { slot = i; break; }
    if (slot < 0) { let o: i32 = 0; for (let i = 1; i < 3; i++) if (cAge[i] < cAge[o]) o = i; slot = o; }
    trigChannel(slot, id, fr, vl, true);
  } else {
    const legato: bool = hCount > 0;
    if (hCount < 8) { hId[hCount] = id; hFreq[hCount] = fr; hCount++; }
    for (let c = 0; c < 3; c++) trigChannel(c, id, fr, vl, !legato);
    trigNoiseLayer(fr, !legato);
  }
}

export function noteOff(id: i32): void {
  const mode: i32 = i32(params[P_MODE] + 0.5);
  if (mode == 1) {
    for (let c = 0; c < 3; c++) if (cNote[c] == id && cGate[c] == 1) cGate[c] = 0;
    return;
  }
  let k: i32 = -1;
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { k = i; break; }
  if (k < 0) return;
  for (let i = k; i < hCount - 1; i++) { hId[i] = hId[i + 1]; hFreq[i] = hFreq[i + 1]; }
  hCount--;
  if (hCount > 0) {
    for (let c = 0; c < 3; c++) { cFreq[c] = hFreq[hCount - 1]; cNote[c] = hId[hCount - 1]; }
    nNote = 69.0 + 12.0 * f32(Mathf.log(hFreq[hCount - 1] / 440.0) / Mathf.log(2.0));
  } else {
    for (let c = 0; c < 3; c++) cGate[c] = 0;
    nGate = 0;
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const dt: f32 = 1.0 / sr;
  const modeQ: bool = params[P_QUANT] > 0.5;
  const console: i32 = i32(params[P_CONSOLE] + 0.5);
  const smooth: f32 = params[P_SMOOTH];
  const daMode: i32 = i32(params[P_DANIM] + 0.5);
  const swS: i32 = i32(params[P_SWEEP] + (params[P_SWEEP] < 0.0 ? -0.5 : 0.5));
  const swInt: f32 = (1.0 + f32(i32(params[P_SWRATE] + 0.5))) / 120.0;
  const vibInc: f32 = (3.0 + params[P_VIBR] * 9.0) / sr;
  const vibDepth: f32 = (params[P_VIB] + modWheel * 0.8) * 0.6;
  const vibDelay: f32 = 0.02 + params[P_VIBD] * 0.6;
  const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const chord: i32 = i32(params[P_ARP] + 0.5);
  const arpInc: f32 = (15.0 + params[P_ARPS] * 105.0) / sr;
  const velS: f32 = params[P_VELS];
  const relK: f32 = f32(Mathf.exp(-1.0 / ((0.002 + params[P_REL] * params[P_REL] * 0.3) * sr)));
  const tOct: f32 = f32(i32(params[P_TOCT] - 0.5));
  const tLen: f32 = params[P_TLEN] > 0.001 ? 0.05 + params[P_TLEN] * 1.5 : 0.0;
  const tLev: f32 = params[P_TLEV];
  const nLev: f32 = params[P_NLEV];
  const nShort: bool = params[P_NSHORT] > 0.5;
  const nRate: i32 = i32(params[P_NRATE] + 0.5);
  const nKey: bool = params[P_NKEY] > 0.5;
  const dLev: f32 = params[P_DLEV];
  const dRateP: f32 = 0.5 + params[P_DRATE] * 1.1;
  const master: f32 = params[P_MASTER] * params[P_MASTER] * 3.0;
  const hpA1: f32 = f32(Mathf.exp(-TWO_PI * (console == 2 ? 90.0 : 37.0) / sr));
  const hpA2: f32 = f32(Mathf.exp(-TWO_PI * 440.0 / sr));
  const lpC: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * 14000.0 / sr));
  const smC: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * (2500.0 + (1.0 - smooth) * (1.0 - smooth) * 17500.0) / sr));
  let pAmp: f32 = 0.0; let tAmp: f32 = 0.0; let nAmpD: f32 = 0.0; let dAmpD: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    // ---- global clocks -------------------------------------------------------------
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    const vibSemi: f32 = f32(Mathf.sin(vibPh * TWO_PI)) * vibDepth;
    if (daMode > 0) {
      daPh += (daMode == 1 ? 7.5 : (daMode == 2 ? 15.0 : 30.0)) * dt;
      if (daPh >= 1.0) daPh -= 1.0;
    }
    arpPh += arpInc; if (arpPh >= 1.0) { arpPh -= 1.0; arpIdx = (arpIdx + 1) & 3; }
    const dai: i32 = daMode > 0 ? i32(daPh * 4.0) & 3 : 0;

    let p1: f32 = 0.0; let p2: f32 = 0.0; let tr: f32 = 0.0;
    for (let c = 0; c < 3; c++) {
      if (cAct[c] == 0) continue;
      cAge2[c] += dt;
      if (cGate[c] == 0) { cRel[c] *= relK; if (cRel[c] < 0.002) { cAct[c] = 0; continue; } }
      const isTri: bool = c == 2;
      // envelope (pulses): NES-style 240 Hz divider
      const envMode: bool = c == 0 ? params[P_ENV1] > 0.5 : params[P_ENV2] > 0.5;
      const rate: f32 = c == 0 ? params[P_RATE1] : params[P_RATE2];
      const loop: bool = c == 0 ? params[P_LOOP1] > 0.5 : params[P_LOOP2] > 0.5;
      if (!isTri && envMode) {
        cEnvT[c] += dt;
        const per: f32 = (1.0 + rate) / 240.0;
        if (cEnvT[c] >= per) { cEnvT[c] -= per; if (cEnv[c] > 0) cEnv[c]--; else if (loop) cEnv[c] = 15; }
      }
      // sweep unit (pulses)
      if (!isTri && swS != 0) {
        cSwT[c] += dt;
        if (cSwT[c] >= swInt) {
          cSwT[c] -= swInt;
          const sh: f32 = f32(Mathf.pow(2.0, -f32(swS < 0 ? -swS : swS)));
          cSw[c] = swS > 0 ? cSw[c] / (1.0 - sh) : cSw[c] * (1.0 - sh);
        }
      }
      // pitch
      let semi: f32 = bendSemi + vibSemi * clampf(cAge2[c] / vibDelay, 0.0, 1.0);
      if (!isTri && chord > 0) semi += ARP[chord * 4 + ((arpIdx + c) & 3)];
      if (c == 1) semi += (params[P_DET2] - 0.5) * 0.5;
      if (isTri) semi += tOct * 12.0;
      let fr: f32 = cFreq[c] * f32(Mathf.pow(2.0, semi * (1.0 / 12.0))) * cSw[c];
      if (modeQ && fr > 20.0) {
        if (isTri) { const t: f32 = f32(Math.round(CPU / (32.0 * fr))) - 1.0; if (t >= 2.0 && t <= 2047.0) fr = CPU / (32.0 * (t + 1.0)); }
        else { const t: f32 = f32(Math.round(CPU / (16.0 * fr))) - 1.0; if (t >= 8.0 && t <= 2047.0) fr = CPU / (16.0 * (t + 1.0)); }
      }
      if (!isTri && (fr > 9000.0 || fr < 30.0)) { continue; }     // sweep/period mute
      let ph: f32 = cPh[c] + fr / sr; ph -= f32(Math.floor(ph)); cPh[c] = ph;
      const velG: f32 = 1.0 - velS + velS * cVel[c];
      if (!isTri) {
        const duty: i32 = (i32((c == 0 ? params[P_DUTY1] : params[P_DUTY2]) + 0.5) + dai) & 3;
        const step: i32 = i32(ph * 8.0) & 7;
        const on: i32 = (DUTY[duty] >> step) & 1;
        const vol: f32 = c == 0 ? params[P_VOL1] : params[P_VOL2];
        let a: f32 = envMode ? f32(cEnv[c]) * vol / 15.0 : vol;
        a = f32(Math.round(a * velG));
        const o: f32 = on == 1 ? a * cRel[c] : 0.0;
        if (c == 0) p1 = o; else p2 = o;
      } else {
        const muted: bool = tLen > 0.0 && cAge2[c] > tLen;
        const stp: i32 = i32(ph * 32.0) & 31;
        const tsi: i32 = stp < 16 ? 15 - stp : stp - 16;
        const tv: f32 = f32(tsi);
        tr = muted ? 0.0 : tv * tLev * cRel[c] * (0.5 + 0.5 * velG);
      }
    }
    // ---- noise (layer or drum) -----------------------------------------------------------
    let nOutAmp: f32 = 0.0; let nPerIdx: i32 = i32(params[P_NPER] + 0.5);
    if (nKey) { nPerIdx = 15 - i32(clampf((nNote - 24.0) * 15.0 / 60.0, 0.0, 15.0)); }
    let useDrum: bool = false;
    if (nDrum == 1) {
      nDrumT += dt;
      if (nDrumT >= nDrumLen) nDrum = 0;
      else { useDrum = true; nPerIdx = nDrumPer; nOutAmp = nDrumAmp * 12.0 * f32(Mathf.exp(-4.6 * nDrumT / nDrumLen)); }
    }
    if (!useDrum) {
      if (nGate == 1 || nRel > 0.002) {
        if (nGate == 0) nRel *= relK;
        if (nRate < 15) {
          nEnvT += dt; const per: f32 = (1.0 + f32(nRate)) / 240.0;
          if (nEnvT >= per) { nEnvT -= per; if (nEnv > 0) nEnv--; }
          nOutAmp = f32(nEnv) * nLev / 15.0 * nRel;
        } else nOutAmp = nLev * nRel;
      }
    }
    if (nOutAmp > 0.0) {
      const clk: f32 = CPU / NPER[nPerIdx < 0 ? 0 : (nPerIdx > 15 ? 15 : nPerIdx)];
      nAcc += clk / sr;
      let cnt: i32 = 0; let sum: f32 = 0.0;
      while (nAcc >= 1.0) {
        nAcc -= 1.0;
        const fbBit: u32 = nShort ? ((nLfsr >> 6) & 1) : ((nLfsr >> 1) & 1);
        const x: u32 = (nLfsr & 1) ^ fbBit;
        nLfsr = (nLfsr >> 1) | (x << 14);
        nOut = (nLfsr & 1) == 1 ? 0.0 : 1.0;
        sum += nOut; cnt++;
        if (cnt >= 12) { nAcc = 0.0; break; }
      }
      if (cnt > 0) nOut = sum / f32(cnt);
    }
    const nz: f32 = nOutAmp * nOut;
    // ---- DPCM ------------------------------------------------------------------------------------
    let dv: f32 = 0.0;
    if (dSel >= 0) {
      const ix: i32 = i32(dPos);
      if (ix >= DPCM_LEN) dSel = -1;
      else { dv = (64.0 + dpcm[dSel * DPCM_LEN + ix] * 63.0) * dLev * dAmp; dPos += 33143.0 * dRate * dRateP / sr; }
    }
    dAmpD += 0.08 * (dv - dAmpD);
    // ---- console mixer (nonlinear) + output chain --------------------------------------------------
    const pin: f32 = p1 + p2;
    const pout: f32 = pin > 0.0 ? 95.88 / (8128.0 / pin + 100.0) : 0.0;
    const tnd: f32 = tr / 8227.0 + nz / 12241.0 + dAmpD / 22638.0;
    const tout: f32 = tnd > 0.0001 ? 159.79 / (1.0 / tnd + 100.0) : 0.0;
    let y: f32 = pout + tout;
    if (console == 0) { hp1 = y - hp1i + 0.9995 * hp1; hp1i = y; y = hp1; }
    else {
      hp1 = hpA1 * (hp1 + y - hp1i); hp1i = y; y = hp1;
      if (console == 2) { hp2 = hpA2 * (hp2 + y - hp2i); hp2i = y; y = hp2; }
      lpS += lpC * (y - lpS); y = lpS;
    }
    smS += smC * (y - smS); y = smS;
    y = f32(Mathf.tanh(y * master * 1.0));
    outBuf[f] = y;
    outBuf[MAX_FRAMES + f] = y;
    pAmp = p1 + p2; tAmp = tr; nAmpD = nz; dAmpD = dAmpD;
  }
  display[0] = clampf(pAmp / 30.0, 0.0, 1.0);
  display[1] = clampf(tAmp / 15.0, 0.0, 1.0);
  display[2] = clampf(nAmpD / 15.0, 0.0, 1.0);
  display[3] = clampf(dAmpD / 127.0, 0.0, 1.0);
}
