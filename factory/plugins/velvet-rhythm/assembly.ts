// =====================================================================
//  VELVET RHYTHM — a warm boutique PRESET-RHYTHM box (Roland CR-78
//  "CompuRhythm" lineage). Unlike a pad-per-drum kit, this is a preset
//  pattern player: holding a note STARTS an internal 16-step groove that
//  layers a warm rounded bass drum, a soft tonal snare, a sizzly metallic
//  hi-hat, the signature inharmonic twin-square "metallic beat", a woody
//  conga and a papery maraca — all synthesised in real time. Releasing the
//  note stops the groove and lets the tails ring.
//  Controls: Tone, Decay, Snap, Metal, Accent, Level.
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

// pool of one-shot drum voices
const pType: StaticArray<i32> = new StaticArray<i32>(POOL);   // 0 kick,1 snare,2 hat,3 metal,4 conga,5 maraca
const pPh:   StaticArray<f32> = new StaticArray<f32>(POOL);
const pPh2:  StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct:  StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel:  StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

// preset groove pattern (1 = hit on that 16th step)
const kickPat:  StaticArray<i32> = StaticArray.fromArray<i32>([1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0]);
const snarePat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1]);
const hatPat:   StaticArray<i32> = StaticArray.fromArray<i32>([1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1]);
const metalPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,1,0]);
const congaPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,0,1,0, 0,0,0,0, 0,1,0,0, 0,0,0,0]);
const maracPat: StaticArray<i32> = StaticArray.fromArray<i32>([0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1]);

let seqOn: i32 = 0;
let seqStep: i32 = 0;
let seqCount: f32 = 0.0;
let gateVel: f32 = 0.8;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 778291;
let hpz: f32 = 0.0; let hpz2: f32 = 0.0;

const P_TONE: i32 = 0; const P_DECAY: i32 = 1; const P_SNAP: i32 = 2; const P_METAL: i32 = 3; const P_ACCENT: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function trig(t: i32, vel: f32): void {
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pPh2[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = vel;
}

function fireStep(step: i32): void {
  const v: f32 = gateVel;
  if (kickPat[step]  != 0) trig(0, v);
  if (snarePat[step] != 0) trig(1, v * 0.9);
  if (hatPat[step]   != 0) trig(2, v * 0.7);
  if (metalPat[step] != 0) trig(3, v * 0.85);
  if (congaPat[step] != 0) trig(4, v * 0.8);
  if (maracPat[step] != 0) trig(5, v * 0.55);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0; hpz = 0.0; hpz2 = 0.0;
  seqOn = 0; seqStep = 0; seqCount = 0.0; gateVel = 0.8;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pPh2[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_TONE] = 0.5; params[P_DECAY] = 0.5; params[P_SNAP] = 0.5; params[P_METAL] = 0.55; params[P_ACCENT] = 0.5; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  gateVel = clampf(v, 0.1, 1.0);
  seqOn = 1; seqStep = 0; seqCount = 0.0;
  fireStep(0);                       // downbeat immediately
}
export function noteOff(id: i32): void { seqOn = 0; }   // stop scheduling; tails ring out

export function process(n: i32): void {
  const toneN: f32  = clampf(params[P_TONE], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const snapN: f32  = clampf(params[P_SNAP], 0.0, 1.0);
  const metalN: f32 = clampf(params[P_METAL], 0.0, 1.0);
  const accentN: f32= clampf(params[P_ACCENT], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const sr: f32 = sampleRate;
  const stepLen: f32 = sr * 0.125;                        // 120 BPM sixteenths
  const dscale: f32 = 0.6 + decayN * 1.2;
  const kDec: f32 = f32(Mathf.exp(-1.0 / (0.22 * dscale * sr)));
  const kPDec: f32 = f32(Mathf.exp(-1.0 / (0.024 * sr)));
  const sDec: f32 = f32(Mathf.exp(-1.0 / (0.13 * dscale * sr)));
  const hDec: f32 = f32(Mathf.exp(-1.0 / ((0.02 + metalN * 0.05) * sr)));
  const mDec: f32 = f32(Mathf.exp(-1.0 / ((0.12 + metalN * 0.16) * dscale * sr)));
  const cDec: f32 = f32(Mathf.exp(-1.0 / (0.18 * dscale * sr)));
  const cPDec: f32 = f32(Mathf.exp(-1.0 / (0.05 * sr)));
  const arDec: f32 = f32(Mathf.exp(-1.0 / (0.022 * sr)));

  const kBase: f32 = (52.0 + toneN * 60.0) / sr;
  const cBase: f32 = (150.0 + toneN * 150.0) / sr;
  const m1: f32 = (520.0 + metalN * 180.0) / sr;
  const m2: f32 = (783.0 + metalN * 240.0) / sr;
  const accent: f32 = 0.72 + accentN * 0.55;
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    // advance the preset sequencer
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
        const fr: f32 = kBase * (1.0 + 1.6 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        smp = f32(Mathf.sin(ph * 6.2831853)) * pAEnv[s];
        pAEnv[s] *= kDec;
      } else if (t == 1) {
        pPEnv[s] *= cPDec;
        const fr: f32 = (190.0 / sr) * (1.0 + 0.4 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const tri: f32 = (ph < 0.5 ? (ph * 4.0 - 1.0) : (3.0 - ph * 4.0));
        const ns: f32 = rnd();
        smp = (tri * (1.0 - snapN) * 0.7 + ns * (0.35 + snapN * 0.5)) * pAEnv[s];
        pAEnv[s] *= sDec;
      } else if (t == 2) {
        const ns: f32 = rnd();
        const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * (0.4 + metalN * 0.5) * pAEnv[s];
        pAEnv[s] *= hDec;
      } else if (t == 3) {
        let a: f32 = pPh[s] + m1; if (a >= 1.0) a -= 1.0; pPh[s] = a;
        let b: f32 = pPh2[s] + m2; if (b >= 1.0) b -= 1.0; pPh2[s] = b;
        const sq1: f32 = a < 0.5 ? 1.0 : -1.0;
        const sq2: f32 = b < 0.5 ? 1.0 : -1.0;
        const raw: f32 = (sq1 * 0.55 + sq2 * 0.45);
        const hp: f32 = raw - hpz2; hpz2 = raw;
        smp = (raw * (0.4 + metalN * 0.2) + hp * (0.3 + metalN * 0.4)) * 0.5 * pAEnv[s];
        pAEnv[s] *= mDec;
      } else if (t == 4) {
        pPEnv[s] *= cPDec;
        const fr: f32 = cBase * (1.0 + 0.5 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const s1: f32 = f32(Mathf.sin(ph * 6.2831853));
        const s2: f32 = f32(Mathf.sin(ph * 12.566371)) * 0.18;
        smp = (s1 + s2) * pAEnv[s];
        pAEnv[s] *= cDec;
      } else {
        const ns: f32 = rnd();
        const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * (0.5 + metalN * 0.4) * pAEnv[s] * pAEnv[s];
        pAEnv[s] *= arDec;
      }
      if (pAEnv[s] < 0.0006) { pAct[s] = 0; }
      mix += smp * pVel[s] * accent;
    }
    let o: f32 = mix * out;
    if (o > 1.3) o = 1.3; else if (o < -1.3) o = -1.3;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
