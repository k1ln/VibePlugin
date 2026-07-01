// =====================================================================
//  BYTE BEAT — a gritty 8-bit lo-fi drum machine (E-mu Drumulator
//  lineage). The early-80s sampling drum box sound: crunchy, dusty,
//  hip-hop. Six synthesised voices (kick, snare, hat, clap, cowbell,
//  tom) run through a global BIT-CRUSH + sample-rate-reducer that gives
//  the signature 8-bit grit. Like the original it is a preset PATTERN
//  box: holding a note starts an internal 16-step boom-bap groove;
//  release stops it and the tails ring.
//  Controls: Tune, Decay, Crunch, Hat, Accent, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const POOL: i32 = 12;
const STEPS: i32 = 16;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);   // 0 kick,1 snare,2 hat,3 clap,4 cowbell,5 tom
const pPh:   StaticArray<f32> = new StaticArray<f32>(POOL);
const pPh2:  StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct:  StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel:  StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

const kickPat: StaticArray<i32> = StaticArray.fromArray<i32>([1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0]);
const snarPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1]);
const hatPat:  StaticArray<i32> = StaticArray.fromArray<i32>([1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]);
const clapPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0]);
const cowPat:  StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0]);
const tomPat:  StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,1]);

let seqOn: i32 = 0;
let seqStep: i32 = 0;
let seqCount: f32 = 0.0;
let gateVel: f32 = 0.8;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 99173;
let hpz: f32 = 0.0;
let holdVal: f32 = 0.0; let holdCnt: i32 = 0;     // sample-rate reducer state

const P_TUNE: i32 = 0; const P_DECAY: i32 = 1; const P_CRUNCH: i32 = 2; const P_HAT: i32 = 3; const P_ACCENT: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function trig(t: i32, vel: f32): void {
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pPh2[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = vel;
}
function fireStep(step: i32): void {
  const v: f32 = gateVel;
  if (kickPat[step] != 0) trig(0, v);
  if (snarPat[step] != 0) trig(1, v * 0.9);
  if (hatPat[step]  != 0) trig(2, v * 0.6);
  if (clapPat[step] != 0) trig(3, v * 0.8);
  if (cowPat[step]  != 0) trig(4, v * 0.7);
  if (tomPat[step]  != 0) trig(5, v * 0.85);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0; hpz = 0.0; holdVal = 0.0; holdCnt = 0;
  seqOn = 0; seqStep = 0; seqCount = 0.0; gateVel = 0.8;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pPh2[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_TUNE] = 0.5; params[P_DECAY] = 0.45; params[P_CRUNCH] = 0.55; params[P_HAT] = 0.5; params[P_ACCENT] = 0.5; params[P_LEVEL] = 0.85;
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
  const crunchN: f32= clampf(params[P_CRUNCH], 0.0, 1.0);
  const hatN: f32   = clampf(params[P_HAT], 0.0, 1.0);
  const accentN: f32= clampf(params[P_ACCENT], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const sr: f32 = sampleRate;
  const stepLen: f32 = sr * 0.13;                         // ~115 BPM swing-ish
  const dscale: f32 = 0.6 + decayN * 1.1;
  const kDec: f32 = f32(Mathf.exp(-1.0 / (0.16 * dscale * sr)));
  const kPDec: f32 = f32(Mathf.exp(-1.0 / (0.02 * sr)));
  const sDec: f32 = f32(Mathf.exp(-1.0 / (0.11 * dscale * sr)));
  const hDec: f32 = f32(Mathf.exp(-1.0 / ((0.014 + hatN * 0.04) * sr)));
  const cpDec: f32 = f32(Mathf.exp(-1.0 / (0.09 * sr)));
  const cowDec: f32 = f32(Mathf.exp(-1.0 / (0.10 * dscale * sr)));
  const tDec: f32 = f32(Mathf.exp(-1.0 / (0.16 * dscale * sr)));
  const tPDec: f32 = f32(Mathf.exp(-1.0 / (0.07 * sr)));

  const kBase: f32 = (52.0 + tuneN * 50.0) / sr;
  const tBase: f32 = (110.0 + tuneN * 120.0) / sr;
  const cow1: f32 = 540.0 / sr; const cow2: f32 = 800.0 / sr;
  const accent: f32 = 0.7 + accentN * 0.6;
  // crush: fewer levels + longer sample-hold as Crunch rises
  const levels: f32 = 256.0 - crunchN * 240.0;            // 256 -> 16
  const holdLen: i32 = 1 + i32(crunchN * 7.0);            // 1 -> 8x downsample
  const out: f32 = level * 0.46;

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
      if (t == 0) {
        pPEnv[s] *= kPDec;
        const fr: f32 = kBase * (1.0 + 1.8 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        smp = f32(Mathf.sin(ph * 6.2831853)) * pAEnv[s];
        pAEnv[s] *= kDec;
      } else if (t == 1) {
        pPEnv[s] *= kPDec;
        const fr: f32 = (200.0 / sr) * (1.0 + 0.45 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const tone: f32 = f32(Mathf.sin(ph * 6.2831853));
        smp = (tone * 0.4 + rnd() * 0.65) * pAEnv[s];
        pAEnv[s] *= sDec;
      } else if (t == 2) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * (0.5 + hatN * 0.4) * pAEnv[s];
        pAEnv[s] *= hDec;
      } else if (t == 3) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * 0.85 * pAEnv[s];
        pAEnv[s] *= cpDec;
      } else if (t == 4) {
        let a: f32 = pPh[s] + cow1; if (a >= 1.0) a -= 1.0; pPh[s] = a;
        let b: f32 = pPh2[s] + cow2; if (b >= 1.0) b -= 1.0; pPh2[s] = b;
        const sq1: f32 = a < 0.5 ? 1.0 : -1.0; const sq2: f32 = b < 0.5 ? 1.0 : -1.0;
        smp = (sq1 * 0.5 + sq2 * 0.5) * 0.5 * pAEnv[s];
        pAEnv[s] *= cowDec;
      } else {
        pPEnv[s] *= tPDec;
        const fr: f32 = tBase * (1.0 + 0.6 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        smp = f32(Mathf.sin(ph * 6.2831853)) * pAEnv[s];
        pAEnv[s] *= tDec;
      }
      if (pAEnv[s] < 0.0006) { pAct[s] = 0; }
      mix += smp * pVel[s] * accent;
    }
    // ---- global 8-bit crush + sample-rate reducer ----
    let q: f32 = f32(Mathf.floor(mix * levels + 0.5)) / levels;
    holdCnt += 1;
    if (holdCnt >= holdLen) { holdCnt = 0; holdVal = q; }
    let o: f32 = holdVal * out;
    if (o > 1.3) o = 1.3; else if (o < -1.3) o = -1.3;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
