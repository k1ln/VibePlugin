// =====================================================================
//  PULSE KIT — a bright DIGITAL/FM drum machine (Yamaha RX5 lineage).
//  Where Velvet Rhythm is warm and Byte Beat is 8-bit-crunchy, this box
//  is glassy and metallic: FM kick, FM snare, inharmonic FM toms, glassy
//  FM hats and a dense shimmering FM crash — all synthesised in real time
//  with two-operator FM for the bright 80s digital-percussion character.
//  Preset PATTERN box: holding a note starts an internal 16-step groove
//  with a tom fill; release stops it and the tails ring.
//  Controls: Tune, Decay, Snap, Metal, Accent, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const POOL: i32 = 12;
const STEPS: i32 = 16;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);   // 0 kick,1 snare,2 hat,3 tom,4 crash,5 clap
const pCar:  StaticArray<f32> = new StaticArray<f32>(POOL);
const pMod:  StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct:  StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel:  StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

const kickPat: StaticArray<i32> = StaticArray.fromArray<i32>([1,0,0,0, 0,0,1,0, 1,0,0,1, 0,0,0,0]);
const snarPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]);
const hatPat:  StaticArray<i32> = StaticArray.fromArray<i32>([1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]);
const tomPat:  StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,1,1]);
const crashPat:StaticArray<i32> = StaticArray.fromArray<i32>([1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0]);
const clapPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]);

let seqOn: i32 = 0;
let seqStep: i32 = 0;
let seqCount: f32 = 0.0;
let gateVel: f32 = 0.8;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 505017;

const P_TUNE: i32 = 0; const P_DECAY: i32 = 1; const P_SNAP: i32 = 2; const P_METAL: i32 = 3; const P_ACCENT: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function trig(t: i32, vel: f32): void {
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pCar[slot] = 0.0; pMod[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = vel;
}
function fireStep(step: i32): void {
  const v: f32 = gateVel;
  if (kickPat[step]  != 0) trig(0, v);
  if (snarPat[step]  != 0) trig(1, v * 0.9);
  if (hatPat[step]   != 0) trig(2, v * 0.55);
  if (tomPat[step]   != 0) trig(3, v * 0.85);
  if (crashPat[step] != 0) trig(4, v * 0.6);
  if (clapPat[step]  != 0) trig(5, v * 0.7);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0;
  seqOn = 0; seqStep = 0; seqCount = 0.0; gateVel = 0.8;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pCar[i] = 0.0; pMod[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_TUNE] = 0.5; params[P_DECAY] = 0.5; params[P_SNAP] = 0.5; params[P_METAL] = 0.6; params[P_ACCENT] = 0.5; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  gateVel = clampf(v, 0.1, 1.0); seqOn = 1; seqStep = 0; seqCount = 0.0; fireStep(0);
}
export function noteOff(id: i32): void { seqOn = 0; }

export function process(n: i32): void {
  const tuneN: f32  = clampf(params[P_TUNE], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const snapN: f32  = clampf(params[P_SNAP], 0.0, 1.0);
  const metalN: f32 = clampf(params[P_METAL], 0.0, 1.0);
  const accentN: f32= clampf(params[P_ACCENT], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const sr: f32 = sampleRate;
  const stepLen: f32 = sr * 0.125;
  const dscale: f32 = 0.6 + decayN * 1.1;
  const kDec: f32 = f32(Mathf.exp(-1.0 / (0.14 * dscale * sr)));
  const kPDec: f32 = f32(Mathf.exp(-1.0 / (0.018 * sr)));
  const sDec: f32 = f32(Mathf.exp(-1.0 / (0.11 * dscale * sr)));
  const hDec: f32 = f32(Mathf.exp(-1.0 / ((0.02 + metalN * 0.03) * sr)));
  const tDec: f32 = f32(Mathf.exp(-1.0 / (0.20 * dscale * sr)));
  const tPDec: f32 = f32(Mathf.exp(-1.0 / (0.06 * sr)));
  const crDec: f32 = f32(Mathf.exp(-1.0 / ((0.3 + metalN * 0.6) * sr)));
  const cpDec: f32 = f32(Mathf.exp(-1.0 / (0.09 * sr)));

  const kBase: f32 = (50.0 + tuneN * 55.0) / sr;
  const tBase: f32 = (120.0 + tuneN * 130.0) / sr;
  const accent: f32 = 0.7 + accentN * 0.6;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    if (seqOn != 0) {
      seqCount += 1.0;
      if (seqCount >= stepLen) { seqCount -= stepLen; seqStep = (seqStep + 1) % STEPS; fireStep(seqStep); }
    }
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      let smp: f32 = 0.0;
      if (t == 0) {                       // FM kick
        pPEnv[s] *= kPDec;
        const fr: f32 = kBase * (1.0 + 2.0 * pPEnv[s]);
        let c: f32 = pCar[s] + fr; if (c >= 1.0) c -= 1.0; pCar[s] = c;
        const idx: f32 = pPEnv[s] * 3.0;
        smp = f32(Mathf.sin(c * TAU + idx * f32(Mathf.sin(c * TAU)))) * pAEnv[s];
        pAEnv[s] *= kDec;
      } else if (t == 1) {                // FM snare: tone + noise
        const fr: f32 = 220.0 / sr;
        let c: f32 = pCar[s] + fr; if (c >= 1.0) c -= 1.0; pCar[s] = c;
        let m: f32 = pMod[s] + fr * 1.5; if (m >= 1.0) m -= 1.0; pMod[s] = m;
        const tone: f32 = f32(Mathf.sin(c * TAU + 2.0 * f32(Mathf.sin(m * TAU))));
        smp = (tone * (0.5 - snapN * 0.3) + rnd() * (0.4 + snapN * 0.5)) * pAEnv[s];
        pAEnv[s] *= sDec;
      } else if (t == 2) {                // glassy FM hat
        const fr: f32 = 3200.0 / sr;
        let c: f32 = pCar[s] + fr; if (c >= 1.0) c -= 1.0; pCar[s] = c;
        let m: f32 = pMod[s] + fr * 1.41; if (m >= 1.0) m -= 1.0; pMod[s] = m;
        smp = f32(Mathf.sin(c * TAU + (1.5 + metalN * 3.0) * f32(Mathf.sin(m * TAU)))) * pAEnv[s];
        pAEnv[s] *= hDec;
      } else if (t == 3) {                // inharmonic FM tom
        pPEnv[s] *= tPDec;
        const fr: f32 = tBase * (1.0 + 0.8 * pPEnv[s]);
        let c: f32 = pCar[s] + fr; if (c >= 1.0) c -= 1.0; pCar[s] = c;
        let m: f32 = pMod[s] + fr * 1.4; if (m >= 1.0) m -= 1.0; pMod[s] = m;
        smp = f32(Mathf.sin(c * TAU + (1.0 + metalN * 1.5) * pPEnv[s] * f32(Mathf.sin(m * TAU)))) * pAEnv[s];
        pAEnv[s] *= tDec;
      } else if (t == 4) {                // shimmering FM crash
        const fr: f32 = 2600.0 / sr;
        let c: f32 = pCar[s] + fr; if (c >= 1.0) c -= 1.0; pCar[s] = c;
        let m: f32 = pMod[s] + fr * 1.73; if (m >= 1.0) m -= 1.0; pMod[s] = m;
        const fmv: f32 = f32(Mathf.sin(c * TAU + (2.0 + metalN * 4.0) * f32(Mathf.sin(m * TAU))));
        smp = (fmv * 0.6 + rnd() * 0.35) * (0.4 + metalN * 0.5) * pAEnv[s];
        pAEnv[s] *= crDec;
      } else {                            // clap
        smp = rnd() * 0.85 * pAEnv[s];
        pAEnv[s] *= cpDec;
      }
      if (pAEnv[s] < 0.0006) { pAct[s] = 0; }
      mix += smp * pVel[s] * accent;
    }
    let o: f32 = mix * out;
    if (o > 1.3) o = 1.3; else if (o < -1.3) o = -1.3;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
