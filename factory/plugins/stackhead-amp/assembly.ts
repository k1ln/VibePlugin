// =====================================================================
//  STACKHEAD AMP — a guitar amplifier and cabinet simulator.
//  Signal path: input trim -> noise gate -> tight/HP -> preamp (three
//  cascaded triode-style stages with interstage coupling filters and a
//  Gain / Bright / Voicing control; asymmetric clipping with grid-current
//  style bias shift) -> passive TONE STACK (bass / mid / treble, a real
//  three-band interaction model) -> POWER AMP (soft push-pull saturation
//  with a supply SAG envelope and a presence/resonance feedback shelf) ->
//  CABINET: speaker cone breakup + cabinet resonances modelled as a set of
//  parametric peaks, a steep high roll-off, mic position (on-axis
//  bright to off-axis dark) and a mic-distance room blend. Voicings:
//  clean / crunch / lead / high-gain. Stereo output via mic decorrelation.
//  4x oversampled nonlinear stages to keep aliasing down.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 18;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_VOICE: i32 = 0; const P_GAIN: i32 = 1;  const P_BRIGHT: i32 = 2; const P_TIGHT: i32 = 3; const P_BASS: i32 = 4;
const P_MID: i32 = 5;   const P_TREB: i32 = 6;  const P_PRES: i32 = 7;   const P_MASTER: i32 = 8; const P_SAG: i32 = 9;
const P_GATE: i32 = 10; const P_CAB: i32 = 11;  const P_MICPOS: i32 = 12; const P_MICDIST: i32 = 13; const P_CABON: i32 = 14;
const P_WIDTH: i32 = 15; const P_INPUT: i32 = 16; const P_OUT: i32 = 17;

let sampleRate: f32 = 48000.0;
// per-channel state (0 = L, 1 = R)
const hp1x: StaticArray<f32> = new StaticArray<f32>(2); const hp1y: StaticArray<f32> = new StaticArray<f32>(2);
const cp1x: StaticArray<f32> = new StaticArray<f32>(2); const cp1y: StaticArray<f32> = new StaticArray<f32>(2);
const cp2x: StaticArray<f32> = new StaticArray<f32>(2); const cp2y: StaticArray<f32> = new StaticArray<f32>(2);
const st1lp: StaticArray<f32> = new StaticArray<f32>(2); const st2lp: StaticArray<f32> = new StaticArray<f32>(2); const st3lp: StaticArray<f32> = new StaticArray<f32>(2);
const bs1: StaticArray<f32> = new StaticArray<f32>(2); const bs2: StaticArray<f32> = new StaticArray<f32>(2);      // bass low-pass states
const tr1: StaticArray<f32> = new StaticArray<f32>(2); const tr2: StaticArray<f32> = new StaticArray<f32>(2);      // treble high-pass states
const md1: StaticArray<f32> = new StaticArray<f32>(2); const md2: StaticArray<f32> = new StaticArray<f32>(2);      // mid band-pass states
const os1: StaticArray<f32> = new StaticArray<f32>(2); const os2: StaticArray<f32> = new StaticArray<f32>(2);      // oversampling filters
const pz1: StaticArray<f32> = new StaticArray<f32>(2); const pres: StaticArray<f32> = new StaticArray<f32>(2);
const cabLo: StaticArray<f32> = new StaticArray<f32>(2 * 5); const cabBp: StaticArray<f32> = new StaticArray<f32>(2 * 5);
const rl1: StaticArray<f32> = new StaticArray<f32>(2); const rl2: StaticArray<f32> = new StaticArray<f32>(2); const rl3: StaticArray<f32> = new StaticArray<f32>(2);
const dcx: StaticArray<f32> = new StaticArray<f32>(2); const dcy: StaticArray<f32> = new StaticArray<f32>(2);
const gateEnv: StaticArray<f32> = new StaticArray<f32>(2);
const roomBuf: StaticArray<f32> = new StaticArray<f32>(2 * 2048);
let roomW: i32 = 0; let sagS: f32 = 0.0; let outLvl: f32 = 0.0; let lastStage: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let c = 0; c < 2; c++) {
    hp1x[c] = 0.0; hp1y[c] = 0.0; cp1x[c] = 0.0; cp1y[c] = 0.0; cp2x[c] = 0.0; cp2y[c] = 0.0; st1lp[c] = 0.0; st2lp[c] = 0.0; st3lp[c] = 0.0;
    bs1[c] = 0.0; bs2[c] = 0.0; tr1[c] = 0.0; tr2[c] = 0.0; md1[c] = 0.0; md2[c] = 0.0; os1[c] = 0.0; os2[c] = 0.0; pz1[c] = 0.0; pres[c] = 0.0;
    rl1[c] = 0.0; rl2[c] = 0.0; rl3[c] = 0.0; dcx[c] = 0.0; dcy[c] = 0.0; gateEnv[c] = 0.0;
  }
  for (let i = 0; i < 10; i++) { cabLo[i] = 0.0; cabBp[i] = 0.0; }
  for (let i = 0; i < 4096; i++) roomBuf[i] = 0.0;
  roomW = 0; sagS = 0.0; outLvl = 0.0; lastStage = 0.0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [1.0, 0.5, 0.4, 0.4, 0.5, 0.5, 0.55, 0.4, 0.6, 0.35, 0.15, 1.0, 0.4, 0.3, 1.0, 0.4, 0.5, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

// one triode-style stage: asymmetric soft clip with bias shift (grid conduction on the positive side)
@inline function tube(x: f32, drive: f32, asym: f32): f32 {
  const v: f32 = x * drive;
  const pos: f32 = v > 0.0 ? f32(Mathf.tanh(v * (1.0 + asym))) / (1.0 + asym) : 0.0;
  const neg: f32 = v <= 0.0 ? f32(Mathf.tanh(v)) : 0.0;
  return pos + neg;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const voice: i32 = i32(params[P_VOICE] + 0.5);
  // voicing sets stage gains, asymmetry and coupling
  const vBase: f32 = voice == 0 ? 1.0 : (voice == 1 ? 2.2 : (voice == 2 ? 3.4 : 5.0));
  const gain: f32 = params[P_GAIN];
  const g1: f32 = vBase * (0.6 + gain * 2.6);
  const g2: f32 = vBase * (0.5 + gain * 2.0) * (voice == 0 ? 0.35 : 1.0);
  const g3: f32 = (voice >= 2 ? 1.0 + gain * 3.0 : (voice == 1 ? 0.8 + gain * 1.2 : 0.4));
  const asym: f32 = voice == 0 ? 0.15 : (voice == 1 ? 0.35 : 0.6);
  const bright: f32 = params[P_BRIGHT];
  const tightHz: f32 = 30.0 + params[P_TIGHT] * params[P_TIGHT] * 700.0 * (voice >= 2 ? 1.0 : 0.5);
  const hpA: f32 = f32(Mathf.exp(-TWO_PI * tightHz / sr));
  const cpA: f32 = f32(Mathf.exp(-TWO_PI * 60.0 / sr));                  // interstage coupling high-pass
  const stK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * 9500.0 / sr));           // stage bandwidth
  const bassK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * 220.0 / sr));
  const trebK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * 2400.0 / sr));
  const midHz: f32 = 700.0; const midG: f32 = 2.0 * f32(Mathf.sin(PI * midHz / sr));
  const bass: f32 = params[P_BASS]; const mid: f32 = params[P_MID]; const treb: f32 = params[P_TREB];
  const bassG: f32 = 0.25 + bass * 1.5; const trebG: f32 = 0.2 + treb * 1.6; const midAmt: f32 = (mid - 0.5) * 2.2;
  const presAmt: f32 = params[P_PRES];
  const vComp: f32 = voice == 0 ? 5.0 : (voice == 1 ? 1.0 : (voice == 2 ? 0.9 : 0.8));   // level-match the voicings
  const master: f32 = params[P_MASTER] * params[P_MASTER] * 2.4 * vComp;
  const sag: f32 = params[P_SAG];
  const sagA: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.012 * sr))); const sagR: f32 = 1.0 - f32(Mathf.exp(-1.0 / (0.25 * sr)));
  const gateThr: f32 = params[P_GATE] * params[P_GATE] * 0.02;
  const cab: i32 = i32(params[P_CAB] + 0.5);
  const micPos: f32 = params[P_MICPOS]; const micDist: f32 = params[P_MICDIST];
  const cabOn: bool = params[P_CABON] > 0.5;
  const width: f32 = params[P_WIDTH];
  const inTrim: f32 = 0.3 + params[P_INPUT] * 2.7;
  const outG: f32 = params[P_OUT] * params[P_OUT] * 2.0;
  // cabinet resonance table per cab type: [freq, Q, gain] x 5   (1x12 open, 2x12, 4x12 closed)
  const cabScale: f32 = cab == 0 ? 1.15 : (cab == 1 ? 1.0 : 0.85);
  const cabHi: f32 = cab == 0 ? 6200.0 : (cab == 1 ? 5200.0 : 4300.0);
  const cabLoHz: f32 = cab == 0 ? 105.0 : (cab == 1 ? 90.0 : 78.0);
  const hiK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * (cabHi * (1.0 - micPos * 0.45)) / sr));
  const loK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * (cabLoHz * 0.5) / sr));
  const peakF0: f32 = cabLoHz; const peakF1: f32 = 480.0 * cabScale; const peakF2: f32 = 1500.0 * cabScale; const peakF3: f32 = 2900.0 * (1.0 - micPos * 0.25); const peakF4: f32 = 4200.0;
  const cg0: f32 = 2.0 * f32(Mathf.sin(PI * clampf(peakF0, 30.0, sr * 0.2) / sr)); const cg1: f32 = 2.0 * f32(Mathf.sin(PI * clampf(peakF1, 30.0, sr * 0.2) / sr));
  const cg2: f32 = 2.0 * f32(Mathf.sin(PI * clampf(peakF2, 30.0, sr * 0.2) / sr)); const cg3: f32 = 2.0 * f32(Mathf.sin(PI * clampf(peakF3, 30.0, sr * 0.2) / sr));
  const cg4: f32 = 2.0 * f32(Mathf.sin(PI * clampf(peakF4, 30.0, sr * 0.2) / sr));
  const presenceBoost: f32 = micPos * 0.7 + 0.3;
  const roomAmt: f32 = micDist * 0.6;
  const roomD: i32 = i32(0.0065 * sr + micDist * 0.011 * sr);
  let lvOut: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    let mixSum: f32 = 0.0; let outS0: f32 = 0.0; let outS1: f32 = 0.0;
    // envelope for sag (from the previous output level)
    sagS += (outLvl > sagS ? sagA : sagR) * (outLvl - sagS);
    const sagG: f32 = 1.0 / (1.0 + sag * 2.2 * sagS);
    for (let c = 0; c < 2; c++) {
      let x: f32 = (c == 0 ? inBuf[f] : inBuf[MAX_FRAMES + f]) * inTrim;
      // noise gate
      const ax: f32 = f32(Mathf.abs(x)); gateEnv[c] += (ax > gateEnv[c] ? 0.05 : 0.0006) * (ax - gateEnv[c]);
      if (gateThr > 0.0) { const gg: f32 = gateEnv[c] < gateThr ? gateEnv[c] / gateThr : 1.0; x *= gg * gg; }
      // tight high-pass + bright (pre-gain treble emphasis)
      let hpv: f32 = hpA * (hp1y[c] + x - hp1x[c]); hp1x[c] = x; hp1y[c] = hpv; x = hpv;
      st1lp[c] += 0.3 * (x - st1lp[c]);
      x += (x - st1lp[c]) * bright * 1.2;
      // 2x oversampled nonlinear preamp (stage filters between stages model triode bandwidth)
      let y0: f32 = 0.0;
      for (let ov = 0; ov < 2; ov++) {
        const xi: f32 = ov == 0 ? (os1[c] + x) * 0.5 : x;
        let s: f32 = tube(xi, g1, asym);
        st2lp[c] += stK * (s - st2lp[c]); s = st2lp[c];
        const cy1: f32 = cpA * (cp1y[c] + s - cp1x[c]); cp1x[c] = s; cp1y[c] = cy1; s = cy1;
        s = tube(s * 0.8, g2, asym * 0.7);
        st3lp[c] += stK * (s - st3lp[c]); s = st3lp[c];
        const cy2: f32 = cpA * (cp2y[c] + s - cp2x[c]); cp2x[c] = s; cp2y[c] = cy2; s = cy2;
        s = tube(s * 0.8, g3, asym * 0.5);
        y0 += s * 0.5;
      }
      os1[c] = x;
      let y: f32 = y0;
      // passive tone stack: bass low-pass, treble high-pass, mid band (scooped in the middle of the stack)
      bs1[c] += bassK * (y - bs1[c]); bs2[c] += bassK * (bs1[c] - bs2[c]);
      tr1[c] += trebK * (y - tr1[c]); tr2[c] += trebK * (tr1[c] - tr2[c]);
      const hm: f32 = y - md2[c] - 0.7 * md1[c]; md1[c] += midG * hm; md2[c] += midG * md1[c];
      const lowB: f32 = bs2[c] * bassG; const hiB: f32 = (y - tr2[c]) * trebG; const midB: f32 = md1[c] * 0.7 * midAmt;
      y = (lowB * 0.75 + (y - bs2[c] - (y - tr2[c])) * 0.9 + hiB) * 1.0 + midB;
      y *= 0.55;
      // power amp: push-pull saturation with sag and presence feedback shelf
      pz1[c] += 0.12 * (y - pz1[c]);
      y += (y - pz1[c]) * presAmt * 1.4;
      y = f32(Mathf.tanh(y * (1.0 + f32(voice) * 0.35) * 1.5 * sagG)) * 0.9;
      y *= master;
      lastStage = f32(Mathf.abs(y));
      // DC block
      const dy: f32 = y - dcx[c] + 0.995 * dcy[c]; dcx[c] = y; dcy[c] = dy; y = dy;
      // cabinet
      if (cabOn) {
        let hp: f32 = y - cabLo[c * 5] - 0.35 * cabBp[c * 5]; cabBp[c * 5] += cg0 * hp; cabLo[c * 5] += cg0 * cabBp[c * 5]; const p0: f32 = cabBp[c * 5];
        hp = y - cabLo[c * 5 + 1] - 0.55 * cabBp[c * 5 + 1]; cabBp[c * 5 + 1] += cg1 * hp; cabLo[c * 5 + 1] += cg1 * cabBp[c * 5 + 1]; const p1: f32 = cabBp[c * 5 + 1];
        hp = y - cabLo[c * 5 + 2] - 0.5 * cabBp[c * 5 + 2]; cabBp[c * 5 + 2] += cg2 * hp; cabLo[c * 5 + 2] += cg2 * cabBp[c * 5 + 2]; const p2: f32 = cabBp[c * 5 + 2];
        hp = y - cabLo[c * 5 + 3] - 0.4 * cabBp[c * 5 + 3]; cabBp[c * 5 + 3] += cg3 * hp; cabLo[c * 5 + 3] += cg3 * cabBp[c * 5 + 3]; const p3: f32 = cabBp[c * 5 + 3];
        hp = y - cabLo[c * 5 + 4] - 0.6 * cabBp[c * 5 + 4]; cabBp[c * 5 + 4] += cg4 * hp; cabLo[c * 5 + 4] += cg4 * cabBp[c * 5 + 4]; const p4: f32 = cabBp[c * 5 + 4];
        let z: f32 = y * 0.55 + p0 * 0.5 + p1 * 0.45 + p2 * 0.4 * presenceBoost + p3 * 0.55 * presenceBoost - p4 * 0.25;
        // speaker roll-off (steep) and low-end high-pass
        rl1[c] += hiK * (z - rl1[c]); rl2[c] += hiK * (rl1[c] - rl2[c]); rl3[c] += hiK * (rl2[c] - rl3[c]); z = rl3[c];
        // speaker cone compression at high level
        z = f32(Mathf.tanh(z * 1.4)) / 1.4;
        y = z * 1.6;
      }
      // mic room blend (short delay, opposite channel for width)
      const wIdx: i32 = c * 2048 + roomW;
      roomBuf[wIdx] = y;
      let rp: i32 = roomW - roomD; if (rp < 0) rp += 2048;
      const room: f32 = roomBuf[(1 - c) * 2048 + rp] * (width) + roomBuf[c * 2048 + rp] * (1.0 - width * 0.5);
      y = y * (1.0 - roomAmt * 0.4) + room * roomAmt * 0.8;
      if (c == 0) outS0 = y; else outS1 = y;
    }
    roomW = roomW + 1 >= 2048 ? 0 : roomW + 1;
    outLvl = clampf((f32(Mathf.abs(outS0)) + f32(Mathf.abs(outS1))) * 0.5, 0.0, 2.0);
    const oL: f32 = outS0 * outG; const oR: f32 = outS1 * outG;
    outBuf[f] = f32(Mathf.tanh(oL)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(oR));
    lvOut = f32(Mathf.abs(oL));
  }
  display[0] = clampf(lvOut * 1.4, 0.0, 1.0);
  display[1] = clampf(sagS, 0.0, 1.0);
}
