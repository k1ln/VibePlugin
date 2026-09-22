// =====================================================================
//  FOURFOLD FM — a four-operator FM instrument in the style of the
//  Yamaha OPN2 / OPM family (Mega Drive/Genesis, arcade boards).
//   * four sine operators with the chip's eight connection ALGORITHMS
//   * operator 1 self-FEEDBACK (0-7)
//   * per operator: total level (0.75 dB steps), frequency MULTIPLE
//     (0.5, 1-15), DETUNE (-3..+3), key-scale rate, and a 5-stage chip
//     envelope: attack rate, decay-1 rate, decay-1 LEVEL, decay-2 rate,
//     release rate -- all in the chip's 0-31 / 0-15 units, computed in dB
//   * LFO (8 rates) with AM sensitivity (0-3, per-operator enable) and
//     FM sensitivity (0-7)
//   * per-operator waveform choice (sine plus three OPL-style shapes)
//   * DAC "ladder" grit and stereo voice spread
//  Eight voices. Pure algorithm: no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 8;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;
const NUM_PARAMS: i32 = 54;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

// operator block: index = op * 11 + offset
const O_TL: i32 = 0;  const O_MUL: i32 = 1; const O_DT: i32 = 2;  const O_AR: i32 = 3;  const O_D1R: i32 = 4; const O_D1L: i32 = 5;
const O_D2R: i32 = 6; const O_RR: i32 = 7;  const O_KS: i32 = 8;  const O_AM: i32 = 9;  const O_WAVE: i32 = 10;
const G_ALGO: i32 = 44; const G_FB: i32 = 45; const G_LFO: i32 = 46; const G_AMS: i32 = 47; const G_FMS: i32 = 48;
const G_GRIT: i32 = 49; const G_VELS: i32 = 50; const G_WIDTH: i32 = 51; const G_BEND: i32 = 52; const G_LEVEL: i32 = 53;

let sampleRate: f32 = 48000.0;

const LFO_HZ: StaticArray<f32> = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2];
const FMS_CENTS: StaticArray<f32> = [0.0, 3.4, 6.7, 10.0, 14.0, 20.0, 40.0, 80.0];
const AMS_DB: StaticArray<f32> = [0.0, 1.4, 5.9, 11.8];
const CARRIER: StaticArray<i32> = [8, 8, 8, 8, 10, 14, 14, 15];   // bit n = operator n+1 reaches the output

// voice state [voice*4 + op]
const vAct:  StaticArray<i32> = new StaticArray<i32>(NV);
const vGate: StaticArray<i32> = new StaticArray<i32>(NV);
const vNote: StaticArray<i32> = new StaticArray<i32>(NV);
const vAge:  StaticArray<i32> = new StaticArray<i32>(NV);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NV);
const vVel:  StaticArray<f32> = new StaticArray<f32>(NV);
const vFb1:  StaticArray<f32> = new StaticArray<f32>(NV);
const vFb2:  StaticArray<f32> = new StaticArray<f32>(NV);
const oPh:   StaticArray<f32> = new StaticArray<f32>(NV * 4);
const oAtt:  StaticArray<f32> = new StaticArray<f32>(NV * 4);   // attenuation in dB, 96 = silent
const oStg:  StaticArray<i32> = new StaticArray<i32>(NV * 4);   // 0 idle 1 attack 2 decay1 3 decay2 4 release
const oInc:  StaticArray<f32> = new StaticArray<f32>(NV * 4);   // base phase increment
const oRA:   StaticArray<f32> = new StaticArray<f32>(NV * 4);   // attack coefficient
const oRD1:  StaticArray<f32> = new StaticArray<f32>(NV * 4);   // dB per sample
const oRD2:  StaticArray<f32> = new StaticArray<f32>(NV * 4);
const oRR:   StaticArray<f32> = new StaticArray<f32>(NV * 4);
const oTLdb: StaticArray<f32> = new StaticArray<f32>(NV * 4);
const oOut:  StaticArray<f32> = new StaticArray<f32>(4);

let ageCounter: i32 = 0;
let lfoPh: f32 = 0.0;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0;
let sinceCoef: i32 = 1 << 20;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NV; v++) {
    vAct[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vFreq[v] = 440.0; vVel[v] = 0.0; vFb1[v] = 0.0; vFb2[v] = 0.0;
    for (let o = 0; o < 4; o++) { const i: i32 = v * 4 + o; oPh[i] = 0.0; oAtt[i] = 96.0; oStg[i] = 0; oInc[i] = 0.0; oRA[i] = 0.0; oRD1[i] = 0.0; oRD2[i] = 0.0; oRR[i] = 0.0; oTLdb[i] = 0.0; }
  }
  for (let o = 0; o < 4; o++) oOut[o] = 0.0;
  ageCounter = 0; lfoPh = 0.0; bendN = 0.0; modWheel = 0.0; sinceCoef = 1 << 20;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  // a bright FM electric-piano / bell patch (two 2-op stacks)
  const d: f32[] = [
    30.0, 1.0, 0.0, 31.0, 14.0, 6.0, 2.0, 8.0, 1.0, 0.0, 0.0,
     0.0, 1.0, 0.0, 31.0, 10.0, 8.0, 3.0, 8.0, 1.0, 0.0, 0.0,
    38.0, 4.0, 0.0, 31.0, 20.0, 3.0, 4.0, 8.0, 1.0, 0.0, 0.0,
     4.0, 1.0, 1.0, 31.0,  8.0, 10.0, 2.0, 9.0, 1.0, 0.0, 0.0,
    4.0, 3.0, 0.0, 0.0, 2.0, 0.0, 0.5, 0.5, 0.1667, 0.7
  ];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
}

// chip rate (0-31) -> seconds to traverse 96 dB (decay/release style)
@inline function decSecs(r: f32): f32 { return r < 0.5 ? 1.0e9 : 12.0 * f32(Mathf.pow(2.0, -r * 0.4)) + 0.002; }
@inline function attSecs(r: f32): f32 { return r < 0.5 ? 1.0e9 : 6.0 * f32(Mathf.pow(2.0, -r * 0.4)) + 0.0004; }

function updateVoice(v: i32): void {
  const sr: f32 = sampleRate;
  const f0: f32 = vFreq[v];
  const midi: f32 = 69.0 + 12.0 * f32(Mathf.log(f0 / 440.0) / Mathf.log(2.0));
  const keycode: f32 = clampf((midi - 12.0) / 3.0, 0.0, 31.0);
  const velS: f32 = params[G_VELS];
  const carr: i32 = CARRIER[i32(params[G_ALGO] + 0.5) & 7];
  for (let o = 0; o < 4; o++) {
    const b: i32 = o * 11; const i: i32 = v * 4 + o;
    const mulI: i32 = i32(params[b + O_MUL] + 0.5);
    const mul: f32 = mulI == 0 ? 0.5 : f32(mulI);
    const dt: f32 = f32(i32(params[b + O_DT] + (params[b + O_DT] < 0.0 ? -0.5 : 0.5)));
    const cents: f32 = dt * 4.0 * (0.6 + f0 / 1500.0);
    oInc[i] = f0 * mul * f32(Mathf.pow(2.0, cents / 1200.0)) / sr;
    const ks: f32 = f32(i32(params[b + O_KS] + 0.5));
    const kadd: f32 = keycode * ks / 3.0 * 0.5;    // rate scaling: higher notes run their envelopes faster
    const rA: f32 = clampf(params[b + O_AR] * 1.0 + kadd, 0.0, 31.0);
    const rD1: f32 = clampf(params[b + O_D1R] + kadd, 0.0, 31.0);
    const rD2: f32 = clampf(params[b + O_D2R] + kadd, 0.0, 31.0);
    const rR: f32 = clampf(params[b + O_RR] * 2.0 + 1.0 + kadd, 0.0, 31.0);
    const tA: f32 = attSecs(rA);
    oRA[i] = rA >= 30.5 ? 1.0 : 1.0 - f32(Mathf.exp(-1.0 / (tA * sr * 0.3)));
    oRD1[i] = 96.0 / (decSecs(rD1) * sr);
    oRD2[i] = 96.0 / (decSecs(rD2) * sr);
    oRR[i] = 96.0 / (decSecs(rR) * sr);
    const isCar: bool = (carr & (1 << o)) != 0;
    oTLdb[i] = params[b + O_TL] * 0.75 + (1.0 - vVel[v]) * velS * (isCar ? 30.0 : 14.0);
  }
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) if (vAct[i] == 0) { slot = i; break; }
  if (slot < 0) { let o: i32 = 0; for (let i = 1; i < NV; i++) if (vAge[i] < vAge[o]) o = i; slot = o; }
  vNote[slot] = id; vAct[slot] = 1; vGate[slot] = 1; vAge[slot] = ageCounter++;
  vFreq[slot] = f > 1.0 ? f : 1.0; vVel[slot] = clampf(vel, 0.0, 1.0); vFb1[slot] = 0.0; vFb2[slot] = 0.0;
  for (let o = 0; o < 4; o++) { const i: i32 = slot * 4 + o; oPh[i] = 0.0; oStg[i] = 1; if (oAtt[i] < 60.0) oAtt[i] = 60.0; else oAtt[i] = 96.0; }
  updateVoice(slot);
  for (let o = 0; o < 4; o++) { const i: i32 = slot * 4 + o; if (oRA[i] >= 1.0) oAtt[i] = 0.0; }
}

export function noteOff(id: i32): void {
  for (let v = 0; v < NV; v++) if (vAct[v] == 1 && vGate[v] == 1 && vNote[v] == id) {
    vGate[v] = 0;
    for (let o = 0; o < 4; o++) { const i: i32 = v * 4 + o; if (oStg[i] != 0) oStg[i] = 4; }
  }
}

// operator waveform: 0 sine, 1 half-sine, 2 abs-sine, 3 quarter-pulse sine
@inline function opWave(w: i32, ph: f32): f32 {
  const s: f32 = f32(Mathf.sin(ph * TWO_PI));
  if (w == 0) return s;
  const fp: f32 = ph - f32(Math.floor(ph));
  if (w == 1) return s > 0.0 ? s : 0.0;
  if (w == 2) return s < 0.0 ? -s : s;
  return (fp < 0.25 || (fp >= 0.5 && fp < 0.75)) ? f32(Mathf.abs(s)) : 0.0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const algo: i32 = i32(params[G_ALGO] + 0.5) & 7;
  const fbI: i32 = i32(params[G_FB] + 0.5);
  const fbAmt: f32 = fbI <= 0 ? 0.0 : f32(Mathf.pow(2.0, f32(fbI) - 6.0)) * PI;
  const lfoInc: f32 = LFO_HZ[i32(params[G_LFO] + 0.5) & 7] / sr;
  const amsDb: f32 = AMS_DB[i32(params[G_AMS] + 0.5) & 3];
  const fmsC: f32 = FMS_CENTS[i32(params[G_FMS] + 0.5) & 7] + modWheel * 40.0;
  const bendSemi: f32 = bendN * f32(i32(params[G_BEND] * 12.0 + 0.5));
  const grit: f32 = params[G_GRIT];
  const gq: f32 = f32(Mathf.pow(2.0, 14.0 - grit * 7.0));
  const width: f32 = params[G_WIDTH];
  const level: f32 = params[G_LEVEL] * params[G_LEVEL] * 1.5;
  const MODK: f32 = 4.0 * PI;
  const carr: i32 = CARRIER[algo];
  let am0: i32 = i32(params[O_AM] + 0.5); let am1: i32 = i32(params[11 + O_AM] + 0.5);
  let am2: i32 = i32(params[22 + O_AM] + 0.5); let am3: i32 = i32(params[33 + O_AM] + 0.5);
  const w0: i32 = i32(params[O_WAVE] + 0.5); const w1: i32 = i32(params[11 + O_WAVE] + 0.5);
  const w2: i32 = i32(params[22 + O_WAVE] + 0.5); const w3: i32 = i32(params[33 + O_WAVE] + 0.5);
  let m0: f32 = 0.0; let m1: f32 = 0.0; let m2: f32 = 0.0; let m3: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    if (sinceCoef >= 128) { for (let v = 0; v < NV; v++) if (vAct[v] == 1) updateVoice(v); sinceCoef = 0; }
    sinceCoef++;
    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfo: f32 = f32(Mathf.sin(lfoPh * TWO_PI));
    const pitchMul: f32 = f32(Mathf.pow(2.0, (bendSemi + fmsC * lfo * 0.01) * (1.0 / 12.0)));
    const amLfo: f32 = (lfo * 0.5 + 0.5) * amsDb;   // dB of attenuation swing
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    m0 = 0.0; m1 = 0.0; m2 = 0.0; m3 = 0.0;

    for (let v = 0; v < NV; v++) {
      if (vAct[v] == 0) continue;
      // ---- envelopes ---------------------------------------------------------------
      for (let o = 0; o < 4; o++) {
        const i: i32 = v * 4 + o;
        const stg: i32 = oStg[i];
        let a: f32 = oAtt[i];
        if (stg == 1) { a -= (a + 0.5) * oRA[i]; if (a <= 0.05) { a = 0.0; oStg[i] = 2; } }
        else if (stg == 2) { a += oRD1[i]; const lim: f32 = params[o * 11 + O_D1L] * 3.0; if (a >= lim) { a = lim; oStg[i] = 3; } }
        else if (stg == 3) { a += oRD2[i]; if (a >= 96.0) { a = 96.0; oStg[i] = 0; } }
        else if (stg == 4) { a += oRR[i]; if (a >= 96.0) { a = 96.0; oStg[i] = 0; } }
        oAtt[i] = a;
      }
      // voice finished when every carrier is silent
      let audible: bool = false;
      for (let o = 0; o < 4; o++) if ((carr & (1 << o)) != 0 && oAtt[v * 4 + o] < 95.5) audible = true;
      if (!audible) { vAct[v] = 0; continue; }

      // ---- operator outputs -----------------------------------------------------------
      const b: i32 = v * 4;
      for (let o = 0; o < 4; o++) {
        oPh[b + o] += oInc[b + o] * pitchMul;
        if (oPh[b + o] >= 1.0) oPh[b + o] -= f32(Math.floor(oPh[b + o]));
      }
      const amOn0: bool = am0 > 0; const amOn1: bool = am1 > 0; const amOn2: bool = am2 > 0; const amOn3: bool = am3 > 0;
      const g0: f32 = f32(Mathf.exp(-(oAtt[b] + oTLdb[b] + (amOn0 ? amLfo : 0.0)) * 0.1151293));
      const g1: f32 = f32(Mathf.exp(-(oAtt[b + 1] + oTLdb[b + 1] + (amOn1 ? amLfo : 0.0)) * 0.1151293));
      const g2: f32 = f32(Mathf.exp(-(oAtt[b + 2] + oTLdb[b + 2] + (amOn2 ? amLfo : 0.0)) * 0.1151293));
      const g3: f32 = f32(Mathf.exp(-(oAtt[b + 3] + oTLdb[b + 3] + (amOn3 ? amLfo : 0.0)) * 0.1151293));
      // operator 1: self-feedback
      const fb: f32 = (vFb1[v] + vFb2[v]) * 0.5 * fbAmt;
      const o1: f32 = opWave(w0, oPh[b] + fb / TWO_PI) * g0;
      vFb2[v] = vFb1[v]; vFb1[v] = o1;
      let o2: f32 = 0.0; let o3: f32 = 0.0; let o4: f32 = 0.0; let outS: f32 = 0.0;
      const K: f32 = MODK / TWO_PI;    // modulation index expressed in cycles
      if (algo == 0) {
        o2 = opWave(w1, oPh[b + 1] + o1 * K) * g1; o3 = opWave(w2, oPh[b + 2] + o2 * K) * g2; o4 = opWave(w3, oPh[b + 3] + o3 * K) * g3; outS = o4;
      } else if (algo == 1) {
        o2 = opWave(w1, oPh[b + 1]) * g1; o3 = opWave(w2, oPh[b + 2] + (o1 + o2) * K) * g2; o4 = opWave(w3, oPh[b + 3] + o3 * K) * g3; outS = o4;
      } else if (algo == 2) {
        o2 = opWave(w1, oPh[b + 1]) * g1; o3 = opWave(w2, oPh[b + 2] + o2 * K) * g2; o4 = opWave(w3, oPh[b + 3] + (o1 + o3) * K) * g3; outS = o4;
      } else if (algo == 3) {
        o2 = opWave(w1, oPh[b + 1] + o1 * K) * g1; o3 = opWave(w2, oPh[b + 2]) * g2; o4 = opWave(w3, oPh[b + 3] + (o2 + o3) * K) * g3; outS = o4;
      } else if (algo == 4) {
        o2 = opWave(w1, oPh[b + 1] + o1 * K) * g1; o3 = opWave(w2, oPh[b + 2]) * g2; o4 = opWave(w3, oPh[b + 3] + o3 * K) * g3; outS = o2 + o4;
      } else if (algo == 5) {
        o2 = opWave(w1, oPh[b + 1] + o1 * K) * g1; o3 = opWave(w2, oPh[b + 2] + o1 * K) * g2; o4 = opWave(w3, oPh[b + 3] + o1 * K) * g3; outS = o2 + o3 + o4;
      } else if (algo == 6) {
        o2 = opWave(w1, oPh[b + 1] + o1 * K) * g1; o3 = opWave(w2, oPh[b + 2]) * g2; o4 = opWave(w3, oPh[b + 3]) * g3; outS = o2 + o3 + o4;
      } else {
        o2 = opWave(w1, oPh[b + 1]) * g1; o3 = opWave(w2, oPh[b + 2]) * g2; o4 = opWave(w3, oPh[b + 3]) * g3; outS = o1 + o2 + o3 + o4;
      }
      if (g0 > m0) m0 = g0; if (g1 > m1) m1 = g1; if (g2 > m2) m2 = g2; if (g3 > m3) m3 = g3;
      // stereo voice spread
      const pr: i32 = (v >> 1) + 1;
      const pan: f32 = clampf(((v & 1) == 1 ? -1.0 : 1.0) * f32(pr) * 0.22 * width, -1.0, 1.0);
      mixL += outS * f32(Mathf.sqrt(0.5 * (1.0 - pan)));
      mixR += outS * f32(Mathf.sqrt(0.5 * (1.0 + pan)));
    }
    let l: f32 = mixL * 0.35; let r: f32 = mixR * 0.35;
    if (grit > 0.001) {
      l = f32(Math.round(l * gq)) / gq + (l >= 0.0 ? 1.0 : -1.0) * grit * 0.003;
      r = f32(Math.round(r * gq)) / gq + (r >= 0.0 ? 1.0 : -1.0) * grit * 0.003;
    }
    outBuf[f] = f32(Mathf.tanh(l * 1.4)) * level;
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r * 1.4)) * level;
  }
  display[0] = m0; display[1] = m1; display[2] = m2; display[3] = m3;
}
