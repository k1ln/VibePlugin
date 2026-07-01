// =====================================================================
//  MICRO BEAT — a tiny budget analog drum box (Boss DR-110 lineage).
//  Real-time analog synthesis, distinct from the factory's bigger boxes by
//  a thin, clicky, bright budget character: a short clicky kick, a papery
//  snare, sizzly "tssh" hats and a thin clap/cymbal. A MIDI note selects a
//  voice (note % 5) into a 6-slot pool. Controls: Pitch, Decay, Click
//  (attack snap), Hat (brightness/length), Accent, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 5;   // 0 kick,1 snare,2 hat,3 clap,4 cymbal
const POOL: i32 = 6;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);
const pPh: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct: StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel: StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 33221;
let hpz: f32 = 0.0;

const P_PITCH: i32 = 0; const P_DECAY: i32 = 1; const P_CLICK: i32 = 2; const P_HAT: i32 = 3; const P_ACCENT: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0; hpz = 0.0;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_PITCH] = 0.5; params[P_DECAY] = 0.4; params[P_CLICK] = 0.6; params[P_HAT] = 0.6; params[P_ACCENT] = 0.5; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  let t: i32 = id % NV; if (t < 0) t += NV;
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = clampf(v, 0.05, 1.0);
}
export function noteOff(id: i32): void { /* one-shots */ }

export function process(n: i32): void {
  const pitchN: f32 = clampf(params[P_PITCH], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const clickN: f32 = clampf(params[P_CLICK], 0.0, 1.0);
  const hatN: f32 = clampf(params[P_HAT], 0.0, 1.0);
  const accentN: f32 = clampf(params[P_ACCENT], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const pitchMul: f32 = f32(Mathf.exp((pitchN - 0.5) * 1.0));
  const kDec: f32 = f32(Mathf.exp(-1.0 / ((0.04 + decayN * 0.22) * sampleRate)));   // thin kick
  const sDec: f32 = f32(Mathf.exp(-1.0 / ((0.04 + decayN * 0.14) * sampleRate)));
  const hDec: f32 = f32(Mathf.exp(-1.0 / ((0.01 + hatN * 0.05) * sampleRate)));
  const clapDec: f32 = f32(Mathf.exp(-1.0 / (0.07 * sampleRate)));
  const cymDec: f32 = f32(Mathf.exp(-1.0 / ((0.1 + hatN * 0.3) * sampleRate)));
  const pDec: f32 = f32(Mathf.exp(-1.0 / (0.01 * sampleRate)));
  const accent: f32 = 0.7 + accentN * 0.6;
  const out: f32 = level * 0.55;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      let v: f32 = 0.0;
      pPEnv[s] *= pDec;
      if (t == 0) {                 // thin clicky kick
        const fr: f32 = 75.0 * pitchMul * (1.0 + 1.5 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        v = f32(Mathf.sin(ph * 6.2831853)) + (pPEnv[s] > 0.6 ? rnd() * clickN * 0.8 : 0.0);
        pAEnv[s] *= kDec;
      } else if (t == 1) {          // papery snare
        const raw: f32 = rnd(); v = raw * 0.8 + f32(Mathf.sin((pPh[s] += 250.0 * pitchMul / sampleRate) * 6.2831853)) * 0.3;
        if (pPh[s] >= 1.0) pPh[s] -= 1.0;
        pAEnv[s] *= sDec;
      } else if (t == 2) {          // sizzly hat
        const raw: f32 = rnd(); hpz += (raw - hpz) * 0.75; v = (raw - hpz) * (0.6 + hatN * 0.5);
        pAEnv[s] *= hDec;
      } else if (t == 3) {          // clap
        const raw: f32 = rnd(); v = raw * 0.7;
        pAEnv[s] *= clapDec;
      } else {                      // cymbal
        const raw: f32 = rnd(); hpz += (raw - hpz) * 0.9; v = (raw - hpz) * 0.55;
        pAEnv[s] *= cymDec;
      }
      mix += v * pAEnv[s] * pVel[s] * accent;
      if (pAEnv[s] < 0.0004) pAct[s] = 0;
    }
    let o: f32 = mix * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
