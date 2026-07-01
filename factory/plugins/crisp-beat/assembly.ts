// =====================================================================
//  CRISP BEAT — a crisp, dry, punchy digital drum machine (Roland TR-707
//  / 727 lineage). Sister to the warm boutique Velvet Rhythm, but the
//  opposite character: clean, tight, "house" — a punchy clicky kick, a
//  snappy bright snare, crisp closed/open hats, a layered clap and a
//  short cowbell, all synthesised in real time. Like the original, it is
//  a preset PATTERN box: holding a note starts an internal 16-step
//  four-on-the-floor groove; release stops it and the tails ring.
//  Controls: Tune, Decay, Snap, Hat, Accent, Level.
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

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);   // 0 kick,1 snare,2 chat,3 ohat,4 clap,5 cowbell
const pPh:   StaticArray<f32> = new StaticArray<f32>(POOL);
const pPh2:  StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pSub:  StaticArray<f32> = new StaticArray<f32>(POOL);   // clap multi-burst timer
const pAct:  StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel:  StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

const kickPat: StaticArray<i32> = StaticArray.fromArray<i32>([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]);
const snarPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]);
const chatPat: StaticArray<i32> = StaticArray.fromArray<i32>([1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]);
const ohatPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]);
const clapPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0]);
const cowPat:  StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]);

let seqOn: i32 = 0;
let seqStep: i32 = 0;
let seqCount: f32 = 0.0;
let gateVel: f32 = 0.8;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 1337201;
let hpz: f32 = 0.0;

const P_TUNE: i32 = 0; const P_DECAY: i32 = 1; const P_SNAP: i32 = 2; const P_HAT: i32 = 3; const P_ACCENT: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function trig(t: i32, vel: f32): void {
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pPh2[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pSub[slot] = 0.0; pAct[slot] = 1; pVel[slot] = vel;
}

function fireStep(step: i32): void {
  const v: f32 = gateVel;
  if (kickPat[step] != 0) trig(0, v);
  if (snarPat[step] != 0) trig(1, v * 0.92);
  if (chatPat[step] != 0) trig(2, v * 0.6);
  if (ohatPat[step] != 0) trig(3, v * 0.55);
  if (clapPat[step] != 0) trig(4, v * 0.8);
  if (cowPat[step]  != 0) trig(5, v * 0.7);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0; hpz = 0.0;
  seqOn = 0; seqStep = 0; seqCount = 0.0; gateVel = 0.8;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pPh2[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pSub[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_TUNE] = 0.5; params[P_DECAY] = 0.45; params[P_SNAP] = 0.55; params[P_HAT] = 0.55; params[P_ACCENT] = 0.5; params[P_LEVEL] = 0.85;
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
  const hatN: f32   = clampf(params[P_HAT], 0.0, 1.0);
  const accentN: f32= clampf(params[P_ACCENT], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const sr: f32 = sampleRate;
  const stepLen: f32 = sr * 0.125;                       // 120 BPM sixteenths
  const dscale: f32 = 0.6 + decayN * 1.0;
  const kDec: f32 = f32(Mathf.exp(-1.0 / (0.13 * dscale * sr)));   // tight punchy kick
  const kPDec: f32 = f32(Mathf.exp(-1.0 / (0.014 * sr)));
  const sDec: f32 = f32(Mathf.exp(-1.0 / (0.10 * dscale * sr)));
  const chDec: f32 = f32(Mathf.exp(-1.0 / ((0.012 + hatN * 0.02) * sr)));
  const ohDec: f32 = f32(Mathf.exp(-1.0 / ((0.07 + hatN * 0.18) * sr)));
  const cpDec: f32 = f32(Mathf.exp(-1.0 / (0.10 * sr)));
  const cowDec: f32 = f32(Mathf.exp(-1.0 / (0.09 * dscale * sr)));

  const kBase: f32 = (54.0 + tuneN * 56.0) / sr;
  const cow1: f32 = 560.0 / sr; const cow2: f32 = 845.0 / sr;
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
      if (t == 0) {
        pPEnv[s] *= kPDec;
        const fr: f32 = kBase * (1.0 + 2.0 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const click: f32 = pPEnv[s] > 0.5 ? rnd() * 0.5 : 0.0;     // crisp attack click
        smp = (f32(Mathf.sin(ph * 6.2831853)) + click) * pAEnv[s];
        pAEnv[s] *= kDec;
      } else if (t == 1) {
        pPEnv[s] *= kPDec;
        const fr: f32 = (210.0 / sr) * (1.0 + 0.5 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const tone: f32 = f32(Mathf.sin(ph * 6.2831853));
        const ns: f32 = rnd();
        smp = (tone * (0.5 - snapN * 0.3) + ns * (0.5 + snapN * 0.45)) * pAEnv[s];
        pAEnv[s] *= sDec;
      } else if (t == 2) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * (0.5 + hatN * 0.4) * pAEnv[s];
        pAEnv[s] *= chDec;
      } else if (t == 3) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * (0.45 + hatN * 0.4) * pAEnv[s];
        pAEnv[s] *= ohDec;
      } else if (t == 4) {
        // layered clap: 3 quick bursts then a tail
        pSub[s] += 1.0;
        const burst: f32 = (pSub[s] < 90.0) ? (1.0 - (f32(i32(pSub[s]) % 30) / 30.0)) : 1.0;
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * burst * 0.9 * pAEnv[s];
        pAEnv[s] *= cpDec;
      } else {
        let a: f32 = pPh[s] + cow1; if (a >= 1.0) a -= 1.0; pPh[s] = a;
        let b: f32 = pPh2[s] + cow2; if (b >= 1.0) b -= 1.0; pPh2[s] = b;
        const sq1: f32 = a < 0.5 ? 1.0 : -1.0; const sq2: f32 = b < 0.5 ? 1.0 : -1.0;
        smp = (sq1 * 0.5 + sq2 * 0.5) * 0.5 * pAEnv[s];
        pAEnv[s] *= cowDec;
      }
      if (pAEnv[s] < 0.0006) { pAct[s] = 0; }
      mix += smp * pVel[s] * accent;
    }
    let o: f32 = mix * out;
    if (o > 1.3) o = 1.3; else if (o < -1.3) o = -1.3;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
