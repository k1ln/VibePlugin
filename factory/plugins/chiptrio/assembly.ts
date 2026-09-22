// =====================================================================
//  CHIPTRIO — a three-voice home-computer sound-chip instrument.
//  Modelled on the architecture of the MOS 6581/8580 (SID):
//   * three oscillators, each with a 24-bit-style phase accumulator, a
//     12-bit waveform (triangle / sawtooth / pulse / LFSR noise, any
//     combination — combined waves are the bitwise AND of the parts)
//   * ring modulation (triangle MSB xor'd with the previous voice) and
//     hard sync from the previous voice, in the chip's 1->2->3->1 ring
//   * 8-bit ADSR with the chip's 16 attack / decay / release times
//   * one shared 12 dB state-variable filter (low / band / high, any mix)
//     with a per-voice route mask; "6581" adds the old chip's grit and
//     lower, softer cutoff, "8580" is clean
//   * 4-bit-style output stage, plus lo-fi bit/clock reduction
//  Play it POLY (notes take voices), UNISON (all three stack on one note)
//  or ARP (held notes cycle at a chip-style speed). Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

// per-voice parameter block: index = voice * 10 + offset
const V_WAVE: i32 = 0; const V_PW: i32 = 1;   const V_RING: i32 = 2;  const V_SYNC: i32 = 3;  const V_A: i32 = 4;
const V_D: i32 = 5;    const V_S: i32 = 6;    const V_R: i32 = 7;     const V_TUNE: i32 = 8;  const V_LEVEL: i32 = 9;
const G_MODE: i32 = 30;   const G_ARPRATE: i32 = 31; const G_FMODE: i32 = 32; const G_CUT: i32 = 33;  const G_RES: i32 = 34;
const G_ROUTE: i32 = 35;  const G_CHIP: i32 = 36;    const G_PWMD: i32 = 37;  const G_PWMR: i32 = 38; const G_VIB: i32 = 39;
const G_LOFI: i32 = 40;   const G_CLOCK: i32 = 41;   const G_VOL: i32 = 42;   const G_BEND: i32 = 43; const G_DETUNE: i32 = 44;
const NUM_PARAMS: i32 = 45;

let sampleRate: f32 = 48000.0;

const ATK_MS: StaticArray<f32> = [2.0, 8.0, 16.0, 24.0, 38.0, 56.0, 68.0, 80.0, 100.0, 250.0, 500.0, 800.0, 1000.0, 3000.0, 5000.0, 8000.0];

// voices
const vPh:    StaticArray<f32> = new StaticArray<f32>(3);
const vWrap:  StaticArray<i32> = new StaticArray<i32>(3);   // phase wrapped this sample
const vNote:  StaticArray<i32> = new StaticArray<i32>(3);
const vAge:   StaticArray<i32> = new StaticArray<i32>(3);
const vFreq:  StaticArray<f32> = new StaticArray<f32>(3);
const vGate:  StaticArray<i32> = new StaticArray<i32>(3);
const vStage: StaticArray<i32> = new StaticArray<i32>(3);   // 0 idle 1 attack 2 decay/sustain 3 release
const vEnv:   StaticArray<f32> = new StaticArray<f32>(3);
const vVel:   StaticArray<f32> = new StaticArray<f32>(3);
const vLfsr:  StaticArray<u32> = new StaticArray<u32>(3);
const vNoise: StaticArray<i32> = new StaticArray<i32>(3);
const vB19:   StaticArray<i32> = new StaticArray<i32>(3);

// held-note list for unison / arp
const hId:   StaticArray<i32> = new StaticArray<i32>(8);
const hFreq: StaticArray<f32> = new StaticArray<f32>(8);
let hCount: i32 = 0;
let arpIdx: i32 = 0;
let arpTimer: f32 = 0.0;
let ageCounter: i32 = 0;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0;
let vibPh: f32 = 0.0; let pwmPh: f32 = 0.0;
let fLo: f32 = 0.0; let fBp: f32 = 0.0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;
let holdL: f32 = 0.0; let holdCnt: i32 = 0;
let sinceCoef: i32 = 1 << 20;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < 3; v++) {
    vPh[v] = 0.0; vWrap[v] = 0; vNote[v] = -1; vAge[v] = 0; vFreq[v] = 440.0; vGate[v] = 0; vStage[v] = 0;
    vEnv[v] = 0.0; vVel[v] = 0.0; vLfsr[v] = 0x7ffff8 + u32(v); vNoise[v] = 0; vB19[v] = 0;
  }
  hCount = 0; arpIdx = 0; arpTimer = 0.0; ageCounter = 0; bendN = 0.0; modWheel = 0.0; pressure = 0.0;
  vibPh = 0.0; pwmPh = 0.0; fLo = 0.0; fBp = 0.0; dcX = 0.0; dcY = 0.0; holdL = 0.0; holdCnt = 0; sinceCoef = 1 << 20;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  // voice 1 pulse lead, voice 2 saw, voice 3 sub triangle
  const d: f32[] = [
    4.0, 0.42, 0.0, 0.0, 0.0, 9.0, 6.0, 5.0, 0.0, 0.9,
    2.0, 0.5,  0.0, 0.0, 0.0, 9.0, 6.0, 5.0, 0.0, 0.8,
    1.0, 0.5,  0.0, 0.0, 0.0, 9.0, 8.0, 5.0, -12.0, 0.8,
    1.0, 0.5, 1.0, 0.4, 0.6, 7.0, 0.0, 0.25, 0.35, 0.1, 0.0, 0.0, 0.8, 0.1667, 0.35
  ];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
}

function gateOn(v: i32, id: i32, f: f32, vel: f32, retrig: bool): void {
  vNote[v] = id; vFreq[v] = f; vVel[v] = vel; vGate[v] = 1; vAge[v] = ageCounter++;
  if (retrig || vStage[v] == 0 || vStage[v] == 3) { vStage[v] = 1; }
}
function gateOff(v: i32): void { vGate[v] = 0; if (vStage[v] != 0) vStage[v] = 3; }

export function noteOn(id: i32, f: f32, vel: f32): void {
  const fr: f32 = f > 1.0 ? f : 1.0;
  const vl: f32 = clampf(vel, 0.0, 1.0);
  const mode: i32 = i32(params[G_MODE] + 0.5);
  // held list (unison / arp)
  if (hCount < 8) { hId[hCount] = id; hFreq[hCount] = fr; hCount++; }
  if (mode == 0) {
    let slot: i32 = -1;
    for (let i = 0; i < 3; i++) if (vGate[i] == 0 && vStage[i] == 0) { slot = i; break; }
    if (slot < 0) for (let i = 0; i < 3; i++) if (vGate[i] == 0) { slot = i; break; }
    if (slot < 0) { let o: i32 = 0; for (let i = 1; i < 3; i++) if (vAge[i] < vAge[o]) o = i; slot = o; }
    gateOn(slot, id, fr, vl, true);
  } else if (mode == 1) {
    for (let i = 0; i < 3; i++) gateOn(i, id, fr, vl, true);
  } else {
    // arp: the gate stays open across steps; only the first note retriggers
    const first: bool = hCount == 1;
    for (let i = 0; i < 3; i++) gateOn(i, id, hFreq[arpIdx % hCount], vl, first);
    if (first) { arpIdx = 0; arpTimer = 0.0; }
  }
}

export function noteOff(id: i32): void {
  const mode: i32 = i32(params[G_MODE] + 0.5);
  let k: i32 = -1;
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { k = i; break; }
  if (k >= 0) { for (let i = k; i < hCount - 1; i++) { hId[i] = hId[i + 1]; hFreq[i] = hFreq[i + 1]; } hCount--; }
  if (mode == 0) {
    for (let i = 0; i < 3; i++) if (vNote[i] == id && vGate[i] == 1) gateOff(i);
  } else if (hCount > 0) {
    // fall back to the most recent held note (mono-style), keep gate open
    const nf: f32 = hFreq[hCount - 1];
    for (let i = 0; i < 3; i++) { vFreq[i] = nf; vNote[i] = hId[hCount - 1]; }
    if (arpIdx >= hCount) arpIdx = 0;
  } else {
    for (let i = 0; i < 3; i++) gateOff(i);
  }
}

// SID-style 24-bit accumulator bit 19 + 23-bit LFSR noise
@inline function clockNoise(v: i32): void {
  let l: u32 = vLfsr[v];
  const bit: u32 = ((l >> 22) ^ (l >> 17)) & 1;
  l = ((l << 1) | bit) & 0x7fffff;
  vLfsr[v] = l;
  vNoise[v] = i32(((l >> 22) & 1) << 7 | ((l >> 20) & 1) << 6 | ((l >> 16) & 1) << 5 | ((l >> 13) & 1) << 4
    | ((l >> 11) & 1) << 3 | ((l >> 7) & 1) << 2 | ((l >> 4) & 1) << 1 | (l & 1)) << 4;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const mode: i32 = i32(params[G_MODE] + 0.5);
  const arpStep: f32 = sr / (4.0 + params[G_ARPRATE] * 44.0);
  const fmode: i32 = i32(params[G_FMODE] + 0.5);
  const route: i32 = i32(params[G_ROUTE] + 0.5);
  const chip6581: bool = params[G_CHIP] < 0.5;
  const res: f32 = params[G_RES];
  const pwmD: f32 = params[G_PWMD]; const pwmInc: f32 = (0.2 + params[G_PWMR] * params[G_PWMR] * 8.0) / sr;
  const vibInc: f32 = 5.5 / sr;
  const bendSemi: f32 = bendN * f32(i32(params[G_BEND] * 12.0 + 0.5));
  const lofi: f32 = params[G_LOFI];
  const bits: f32 = 12.0 - lofi * 9.0;
  const qLevels: f32 = f32(Mathf.pow(2.0, bits));
  const holdN: i32 = 1 + i32(params[G_CLOCK] * 14.0);
  const vol: f32 = params[G_VOL] * params[G_VOL] * 1.4;
  const detCents: f32 = params[G_DETUNE] * 30.0;

  for (let f = 0; f < n; f++) {
    // ---- arp / lfos ----------------------------------------------------------------
    if (mode == 2 && hCount > 0) {
      arpTimer += 1.0;
      if (arpTimer >= arpStep) {
        arpTimer = 0.0; arpIdx = (arpIdx + 1) % hCount;
        const nf: f32 = hFreq[arpIdx];
        for (let i = 0; i < 3; i++) vFreq[i] = nf;
      }
    }
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    pwmPh += pwmInc; if (pwmPh >= 1.0) pwmPh -= 1.0;
    const vib: f32 = (params[G_VIB] * 0.5 + modWheel * 0.8) * f32(Mathf.sin(vibPh * TWO_PI)) * 0.5;

    // ---- pass 1: phases, wrap, sync ------------------------------------------------------
    for (let v = 0; v < 3; v++) {
      if (vStage[v] == 0) { vWrap[v] = 0; continue; }
      const b: i32 = v * 10;
      const det: f32 = (v == 0 ? -detCents : (v == 2 ? detCents : 0.0)) * 0.01;
      const semi: f32 = params[b + V_TUNE] + det + vib + bendSemi;
      const fr: f32 = vFreq[v] * f32(Mathf.pow(2.0, semi * (1.0 / 12.0)));
      let p: f32 = vPh[v] + fr / sr;
      let wr: i32 = 0;
      if (p >= 1.0) { p -= 1.0; wr = 1; }
      vWrap[v] = wr;
      vPh[v] = p;
    }
    for (let v = 0; v < 3; v++) {
      const src: i32 = v == 0 ? 2 : v - 1;
      if (params[v * 10 + V_SYNC] > 0.5 && vWrap[src] == 1) vPh[v] = 0.0;
    }

    // ---- pass 2: waveform, envelope ------------------------------------------------------------
    let dirt: f32 = 0.0; let filt: f32 = 0.0;
    for (let v = 0; v < 3; v++) {
      const stg: i32 = vStage[v];
      if (stg == 0) continue;
      const b: i32 = v * 10;
      // envelope (SID rate table; decay/release are 3x slower)
      const ai: i32 = i32(params[b + V_A] + 0.5); const di: i32 = i32(params[b + V_D] + 0.5); const ri: i32 = i32(params[b + V_R] + 0.5);
      const sl: f32 = clampf(params[b + V_S], 0.0, 15.0) / 15.0;
      let e: f32 = vEnv[v];
      if (stg == 1) {
        e += 1.0 / (ATK_MS[ai < 0 ? 0 : (ai > 15 ? 15 : ai)] * 0.001 * sr);
        if (e >= 1.0) { e = 1.0; vStage[v] = 2; }
      } else if (stg == 2) {
        const dt: f32 = ATK_MS[di < 0 ? 0 : (di > 15 ? 15 : di)] * 3.0 * 0.001;
        e += (sl - e) * (1.0 - f32(Mathf.exp(-4.6 / (dt * sr))));
      } else {
        const rt: f32 = ATK_MS[ri < 0 ? 0 : (ri > 15 ? 15 : ri)] * 3.0 * 0.001;
        e -= e * (1.0 - f32(Mathf.exp(-4.6 / (rt * sr))));
        if (e < 0.0005) { e = 0.0; vStage[v] = 0; }
      }
      vEnv[v] = e;

      // 12-bit waveform
      const p: f32 = vPh[v];
      const acc12: i32 = i32(p * 4096.0) & 4095;
      const src: i32 = v == 0 ? 2 : v - 1;
      const msbSrc: i32 = i32(vPh[src] * 2.0) & 1;
      const b19: i32 = i32(p * 32.0) & 1;
      if (b19 == 1 && vB19[v] == 0) clockNoise(v);
      vB19[v] = b19;
      const wmask: i32 = i32(params[b + V_WAVE] + 0.5);
      let w: i32 = 4095; let any: bool = false;
      if ((wmask & 1) != 0) {
        let msb: i32 = (acc12 >> 11) & 1;
        if (params[b + V_RING] > 0.5) msb ^= msbSrc;
        const ramp: i32 = msb == 1 ? (~acc12) & 2047 : acc12 & 2047;
        w &= ramp << 1; any = true;
      }
      if ((wmask & 2) != 0) { w &= acc12; any = true; }
      if ((wmask & 4) != 0) {
        const pw: f32 = clampf(params[b + V_PW] + pwmD * 0.45 * f32(Mathf.sin((pwmPh + f32(v) * 0.33) * TWO_PI)), 0.02, 0.98);
        w &= (acc12 >= i32(pw * 4096.0)) ? 4095 : 0; any = true;
      }
      if ((wmask & 8) != 0) { w &= vNoise[v] & 4095; any = true; }
      let o: f32 = any ? f32(w - 2048) / 2048.0 : 0.0;
      // combined waves on the real chip thin out: soften when several are stacked
      o *= e * params[b + V_LEVEL] * (0.35 + vVel[v] * 0.65);
      const routed: bool = (route & (1 << v)) != 0;
      if (routed) filt += o; else dirt += o;
    }

    // ---- shared filter (2x oversampled Chamberlin SVF) -------------------------------------------
    let cutN: f32 = params[G_CUT];
    let fc: f32 = 30.0 * f32(Mathf.pow(chip6581 ? 150.0 : 300.0, cutN));
    if (chip6581) fc *= 1.0 + 0.25 * f32(Mathf.exp(-cutN * 6.0));
    fc = clampf(fc, 20.0, sr * 0.3);
    const g: f32 = 2.0 * f32(Mathf.sin(PI * fc / (2.0 * sr)));
    const qd: f32 = 1.0 / (0.6 + (1.0 - res) * (1.0 - res) * 4.0);   // damping: res 1 -> near self-oscillation
    let xin: f32 = filt;
    if (chip6581) xin = f32(Mathf.tanh(xin * 1.6 + 0.02)) * 0.75;    // 6581 input overload + DC bump
    let hp: f32 = 0.0;
    for (let k = 0; k < 2; k++) {
      hp = xin - fLo - qd * fBp;
      fBp += g * hp; fLo += g * fBp;
      if (chip6581) { fBp = f32(Mathf.tanh(fBp)); }
    }
    let fo: f32 = 0.0;
    if ((fmode & 1) != 0) fo += fLo;
    if ((fmode & 2) != 0) fo += fBp;
    if ((fmode & 4) != 0) fo += hp;
    if (fmode == 0) fo = 0.0;

    let y: f32 = (dirt + fo) * 0.55 * vol;
    // ---- lo-fi output stage --------------------------------------------------------------------------
    if (holdN > 1) { holdCnt++; if (holdCnt >= holdN) { holdCnt = 0; holdL = y; } y = holdL; }
    if (lofi > 0.001) y = f32(Math.round(y * qLevels * 0.5)) / (qLevels * 0.5);
    const yd: f32 = y - dcX + 0.997 * dcY; dcX = y; dcY = yd; y = yd;
    y = f32(Mathf.tanh(y * 1.1));
    outBuf[f] = y;
    outBuf[MAX_FRAMES + f] = y;
  }
  display[0] = vEnv[0]; display[1] = vEnv[1]; display[2] = vEnv[2];
  display[3] = params[G_CUT];
  for (let v = 0; v < 3; v++) display[4 + v] = vStage[v] != 0 ? 1.0 : 0.0;
}
