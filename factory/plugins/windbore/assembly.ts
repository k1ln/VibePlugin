// =====================================================================
//  WINDBORE — physical-model wind instruments (digital waveguides).
//  Three excitation engines share one monophonic breath-controlled voice:
//   REED   a single-reed valve (linear pressure->flow table with clipping)
//          driving a bore whose shape morphs from cylinder (clarinet: odd
//          harmonics, half-period inverting loop) to cone (saxophone: all
//          harmonics, full-period loop) by mixing two loop taps.
//   FLUTE  an air jet (cubic jet table + jet delay) blowing across an open
//          bore, with end reflection and a DC blocker.
//   BRASS  a lip resonator (biquad) squeezing against bore pressure.
//  Breath pressure has an attack/release envelope, noise, vibrato,
//  velocity/aftertouch/CC2/CC11 control; a bell/body stage, glide,
//  legato and a small room finish it.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 18;
const BN: i32 = 8192;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_ENG: i32 = 0;   const P_BORE: i32 = 1;  const P_EMB: i32 = 2;   const P_BREATH: i32 = 3; const P_NOISE: i32 = 4;
const P_ATK: i32 = 5;   const P_REL: i32 = 6;   const P_VIB: i32 = 7;   const P_VIBR: i32 = 8;   const P_TONE: i32 = 9;
const P_VELS: i32 = 10; const P_GLIDE: i32 = 11; const P_LEG: i32 = 12; const P_BODY: i32 = 13;  const P_SPACE: i32 = 14;
const P_SIZE: i32 = 15; const P_BEND: i32 = 16; const P_LEVEL: i32 = 17;

let sampleRate: f32 = 48000.0;
const bore: StaticArray<f32> = new StaticArray<f32>(BN);
const jet:  StaticArray<f32> = new StaticArray<f32>(BN);
let bw: i32 = 0; let jw: i32 = 0;

const hId:   StaticArray<i32> = new StaticArray<i32>(16);
const hFreq: StaticArray<f32> = new StaticArray<f32>(16);
const hVel:  StaticArray<f32> = new StaticArray<f32>(16);
let hCount: i32 = 0;

let gate: i32 = 0; let tgtLog: f32 = 8.78; let curLog: f32 = 8.78; let velN: f32 = 0.8;
let env: f32 = 0.0; let noteAge: f32 = 0.0; let vibPh: f32 = 0.0;
// allpass interpolators
let apY1: f32 = 0.0; let apX1: f32 = 0.0; let apY2: f32 = 0.0; let apX2: f32 = 0.0; let apYj: f32 = 0.0; let apXj: f32 = 0.0;
let lpS: f32 = 0.0; let dcX: f32 = 0.0; let dcY: f32 = 0.0; let dcX2: f32 = 0.0; let dcY2: f32 = 0.0;
let lipY1: f32 = 0.0; let lipY2: f32 = 0.0; let lastB: f32 = 0.0; let lastJ: f32 = 0.0;
let seed: u32 = 8080; let loopDc: f32 = 0.0;
let bendN: f32 = 0.0; let modWheel: f32 = 0.0; let pressure: f32 = 0.0; let breathCC: f32 = 1.0;
let boLo1: f32 = 0.0; let boBp1: f32 = 0.0; let boLo2: f32 = 0.0; let boBp2: f32 = 0.0; let toneLp: f32 = 0.0;

const RVN: i32 = 4;
const rvLen: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvBufL: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvBufR: StaticArray<f32> = new StaticArray<f32>(RVN * 2400);
const rvPos: StaticArray<i32> = new StaticArray<i32>(RVN);
const rvLpL: StaticArray<f32> = new StaticArray<f32>(RVN);
const rvLpR: StaticArray<f32> = new StaticArray<f32>(RVN);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }
@inline function log2f(x: f32): f32 { return f32(Mathf.log(x) / Mathf.log(2.0)); }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < BN; i++) { bore[i] = 0.0; jet[i] = 0.0; }
  bw = 0; jw = 0; hCount = 0; gate = 0; tgtLog = 8.78; curLog = 8.78; velN = 0.8; env = 0.0; noteAge = 0.0; vibPh = 0.0;
  apY1 = 0.0; apX1 = 0.0; apY2 = 0.0; apX2 = 0.0; apYj = 0.0; apXj = 0.0; lpS = 0.0; dcX = 0.0; dcY = 0.0; dcX2 = 0.0; dcY2 = 0.0;
  lipY1 = 0.0; lipY2 = 0.0; lastB = 0.0; lastJ = 0.0; loopDc = 0.0; seed = 8080; bendN = 0.0; modWheel = 0.0; pressure = 0.0; breathCC = 1.0;
  boLo1 = 0.0; boBp1 = 0.0; boLo2 = 0.0; boBp2 = 0.0; toneLp = 0.0;
  rvLen[0] = 1117; rvLen[1] = 1277; rvLen[2] = 1489; rvLen[3] = 1699;
  for (let i = 0; i < RVN * 2400; i++) { rvBufL[i] = 0.0; rvBufR[i] = 0.0; }
  for (let i = 0; i < RVN; i++) { rvPos[i] = 0; rvLpL[i] = 0.0; rvLpR[i] = 0.0; }
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  // clarinet
  const d: f32[] = [0.0, 0.0, 0.5, 0.6, 0.15, 0.25, 0.3, 0.3, 0.45, 0.55, 0.5, 0.15, 1.0, 0.45, 0.25, 0.5, 0.1667, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

export function controlChange(num: i32, value: f32): void {
  if (num == 128) bendN = clampf(value, -1.0, 1.0);
  else if (num == 1) modWheel = clampf(value, 0.0, 1.0);
  else if (num == 129) pressure = clampf(value, 0.0, 1.0);
  else if (num == 2 || num == 11) breathCC = 0.15 + 0.85 * clampf(value, 0.0, 1.0);
}

export function noteOn(id: i32, f: f32, vel: f32): void {
  const fr: f32 = f > 20.0 ? f : 20.0;
  const wasHeld: bool = hCount > 0;
  if (hCount < 16) { hId[hCount] = id; hFreq[hCount] = fr; hVel[hCount] = vel; hCount++; }
  tgtLog = log2f(fr); velN = clampf(vel, 0.0, 1.0);
  const legato: bool = params[P_LEG] > 0.5 && wasHeld;
  if (!legato) { noteAge = 0.0; if (env < 0.02 || params[P_GLIDE] < 0.02) curLog = tgtLog; }
  gate = 1;
}

export function noteOff(id: i32): void {
  let k: i32 = -1;
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { k = i; break; }
  if (k < 0) return;
  for (let i = k; i < hCount - 1; i++) { hId[i] = hId[i + 1]; hFreq[i] = hFreq[i + 1]; hVel[i] = hVel[i + 1]; }
  hCount--;
  if (hCount > 0) { tgtLog = log2f(hFreq[hCount - 1]); velN = hVel[hCount - 1]; } else gate = 0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const eng: i32 = i32(params[P_ENG] + 0.5);
  const bshape: f32 = params[P_BORE];
  const emb: f32 = params[P_EMB];
  const breathLv: f32 = params[P_BREATH];
  const noiseG: f32 = params[P_NOISE] * 0.35;
  const atkK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.012 + params[P_ATK] * params[P_ATK] * 0.5) * sr)));
  const relK: f32 = 1.0 - f32(Mathf.exp(-1.0 / ((0.02 + params[P_REL] * params[P_REL] * 0.8) * sr)));
  const vibD: f32 = params[P_VIB] + modWheel * 0.7;
  const vibInc: f32 = (3.5 + params[P_VIBR] * 4.5) / sr;
  const tone: f32 = params[P_TONE];
  const velS: f32 = params[P_VELS];
  const glideT: f32 = 0.002 + params[P_GLIDE] * params[P_GLIDE] * 0.7;
  const gK: f32 = 1.0 - f32(Mathf.exp(-1.0 / (glideT * sr)));
  const body: f32 = params[P_BODY];
  const space: f32 = params[P_SPACE]; const fbk: f32 = 0.72 + params[P_SIZE] * 0.25;
  const bendSemi: f32 = bendN * f32(i32(params[P_BEND] * 12.0 + 0.5));
  const level: f32 = params[P_LEVEL] * params[P_LEVEL] * 1.6;
  const lpK: f32 = 0.18 + tone * 0.8;                            // bore/loop low-pass (tone-hole rolloff)
  const slope: f32 = -(0.15 + emb * 0.45);                       // reed stiffness
  const dt: f32 = 1.0 / sr;
  let lvl: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    curLog += (tgtLog - curLog) * gK;
    noteAge += dt;
    vibPh += vibInc; if (vibPh >= 1.0) vibPh -= 1.0;
    const vibAmt: f32 = clampf((noteAge - 0.15) / 0.5, 0.0, 1.0);
    const semi: f32 = bendSemi + f32(Mathf.sin(vibPh * TWO_PI)) * vibD * 0.35 * vibAmt;
    const fr: f32 = f32(Mathf.pow(2.0, curLog + semi / 12.0));
    // breath pressure
    const tgt: f32 = gate == 1 ? breathLv * (1.0 - velS + velS * velN) * breathCC * (1.0 + pressure * 0.5) : 0.0;
    env += (tgt > env ? atkK : relK) * (tgt - env);
    const noise: f32 = rnd() * noiseG * env;
    let out: f32 = 0.0;
    const T: f32 = sr / fr;                                       // period in samples
    if (eng == 0 || eng == 2) {
      // ---- REED / BRASS: valve loop with cylinder<->cone bore ---------------------------------
      const brass: bool = eng == 2;
      const bsh: f32 = brass ? 1.0 : bshape;
      const lpD: f32 = (1.0 - lpK) / lpK;
      let D1: f32 = T * 0.5 - 1.5 - lpD * 0.5; if (D1 < 2.0) D1 = 2.0; if (D1 > f32(BN / 2 - 4)) D1 = f32(BN / 2 - 4);
      let D2: f32 = T - 1.5 - lpD * 0.5; if (D2 < 4.0) D2 = 4.0; if (D2 > f32(BN - 4)) D2 = f32(BN - 4);
      const i1: i32 = i32(D1 - 0.5); const fr1: f32 = D1 - f32(i1); const a1: f32 = (1.0 - fr1) / (1.0 + fr1);
      let rp1: i32 = bw - i1 - 1; if (rp1 < 0) rp1 += BN;
      const x1: f32 = bore[rp1];
      const y1: f32 = a1 * x1 + apX1 - a1 * apY1; apX1 = x1; apY1 = y1;
      const i2: i32 = i32(D2 - 0.5); const fr2: f32 = D2 - f32(i2); const a2: f32 = (1.0 - fr2) / (1.0 + fr2);
      let rp2: i32 = bw - i2 - 1; if (rp2 < 0) rp2 += BN;
      const x2: f32 = bore[rp2];
      const y2: f32 = a2 * x2 + apX2 - a2 * apY2; apX2 = x2; apY2 = y2;
      let refl: f32 = -(1.0 - bsh) * y1 + bsh * y2;
      loopDc += 0.0015 * (refl - loopDc); refl -= loopDc * bsh;   // positive-reflection loops need a DC block
      lpS += lpK * (refl - lpS);
      const breath: f32 = env + noise;
      let pd: f32 = (0.95 + bsh * 0.05) * lpS - breath;
      let boost: f32 = 1.0 + bsh * 0.32;
      if (brass) {
        // lip: unity-gain band-pass at the played pitch; Embouchure sets its Q
        const lf: f32 = 2.0 * f32(Mathf.sin(PI * clampf(fr, 20.0, sr * 0.2) / sr));
        const lq: f32 = 1.0 / (2.0 + emb * 18.0);
        const lh: f32 = pd - lipY2 - lq * lipY1;
        lipY1 += lf * lh; lipY2 += lf * lipY1;
        pd = lipY1 * lq * 3.0;
        boost = 1.5;
      }
      let rt: f32 = 0.7 + slope * pd; rt = clampf(rt, -1.0, 1.0);
      const inp: f32 = breath + pd * rt * boost;
      bore[bw] = clampf(inp, -3.0, 3.0);
      bw = bw + 1 >= BN ? 0 : bw + 1;
      out = (brass ? y2 : y1 * 0.9 + inp * 0.1) * (brass ? 0.27 : 1.8 * (1.0 - 0.55 * bshape));
    } else {
      // ---- FLUTE: jet + bore. Jet pressure stays inside the oscillating window; breath sets loudness ----
      const lpD: f32 = (1.0 - lpK) / lpK;
      let D: f32 = (T - 2.0 - lpD) * 1.085; if (D < 3.0) D = 3.0; if (D > f32(BN - 4)) D = f32(BN - 4);
      const ib: i32 = i32(D - 0.5); const frb: f32 = D - f32(ib); const ab: f32 = (1.0 - frb) / (1.0 + frb);
      let rpb: i32 = bw - ib - 1; if (rpb < 0) rpb += BN;
      const xb: f32 = bore[rpb];
      const yb: f32 = ab * xb + apX1 - ab * apY1; apX1 = xb; apY1 = yb;
      let temp: f32 = yb; lpS += lpK * (temp - lpS); temp = lpS;
      const dco: f32 = temp - dcX + 0.995 * dcY; dcX = temp; dcY = dco; temp = dco;
      const jetRatio: f32 = 0.16 + emb * 0.34;
      let Dj: f32 = D * jetRatio; if (Dj < 2.0) Dj = 2.0;
      const ij: i32 = i32(Dj - 0.5); const frj: f32 = Dj - f32(ij); const aj: f32 = (1.0 - frj) / (1.0 + frj);
      let rpj: i32 = jw - ij - 1; if (rpj < 0) rpj += BN;
      const xj: f32 = jet[rpj];
      const yj: f32 = aj * xj + apXj - aj * apYj; apXj = xj; apYj = yj;
      const press: f32 = 0.88 + 0.16 * clampf(env * 1.2, 0.0, 1.0);
      const pdiff: f32 = press + noise * 0.4 - 0.5 * temp;
      jet[jw] = pdiff; jw = jw + 1 >= BN ? 0 : jw + 1;
      let jt: f32 = clampf(yj, -1.0, 1.0); jt = jt * (jt * jt - 1.0);
      const pin: f32 = jt + 0.5 * temp;
      bore[bw] = pin; bw = bw + 1 >= BN ? 0 : bw + 1;
      out = pin * 2.4 * clampf(env * 2.5, 0.0, 1.0);
    }
    // ---- bell / body ----------------------------------------------------------------------------
    toneLp += (0.15 + tone * 0.8) * (out - toneLp);
    let y: f32 = toneLp;
    if (body > 0.001) {
      const g1: f32 = 2.0 * f32(Mathf.sin(PI * 700.0 / sr)); const g2: f32 = 2.0 * f32(Mathf.sin(PI * 1900.0 / sr));
      let hp: f32 = y - boLo1 - 0.25 * boBp1; boBp1 += g1 * hp; boLo1 += g1 * boBp1;
      hp = y - boLo2 - 0.25 * boBp2; boBp2 += g2 * hp; boLo2 += g2 * boBp2;
      y = y * (1.0 - body * 0.3) + (boBp1 + 0.6 * boBp2) * body * 0.5;
    }
    const dcy: f32 = y - dcX2 + 0.995 * dcY2; dcX2 = y; dcY2 = dcy; y = dcy;
    lvl = env;
    let l: f32 = y * level; let r: f32 = y * level;
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
    outBuf[f] = f32(Mathf.tanh(l)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(r));
  }
  display[0] = clampf(lvl, 0.0, 1.0);
}
