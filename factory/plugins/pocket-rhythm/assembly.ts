// =====================================================================
//  POCKET RHYTHM — a vintage LATIN preset rhythm box (Korg Mini-Pops
//  lineage). Distinct from the factory's kick/snare drum machines: an
//  analog PERCUSSION set — bongo, conga, claves, maracas, cowbell and a
//  cymbal — all synthesised in real time. A MIDI note picks a voice
//  (note % 6) into an 8-slot pool. Controls: Pitch (membrane tuning),
//  Decay, Shaker (maracas/cymbal length), Cowbell (level/tone), Tone, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 6;     // 0 bongo,1 conga,2 claves,3 maracas,4 cowbell,5 cymbal
const POOL: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const baseHz: StaticArray<f32> = new StaticArray<f32>(NV);

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);
const pPh: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPh2: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct: StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel: StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

let sampleRate: f32 = 48000.0;
let rngState: i32 = 24680;
let hp: f32 = 0.0;
let toneZ: f32 = 0.0;

const P_PITCH: i32 = 0;
const P_DECAY: i32 = 1;
const P_SHAKER: i32 = 2;
const P_COW: i32 = 3;
const P_TONE: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  pNext = 0; hp = 0.0; toneZ = 0.0;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pPh2[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  baseHz[0] = 280.0; baseHz[1] = 160.0; baseHz[2] = 2400.0; baseHz[3] = 0.0; baseHz[4] = 540.0; baseHz[5] = 0.0;
  params[P_PITCH] = 0.5; params[P_DECAY] = 0.5; params[P_SHAKER] = 0.5; params[P_COW] = 0.5; params[P_TONE] = 0.6; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  let t: i32 = id % NV; if (t < 0) t += NV;
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pPh2[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = clampf(v, 0.05, 1.0);
}
export function noteOff(id: i32): void { /* one-shots */ }

export function process(n: i32): void {
  const pitchN: f32 = clampf(params[P_PITCH], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const shakerN: f32 = clampf(params[P_SHAKER], 0.0, 1.0);
  const cowN: f32 = clampf(params[P_COW], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const pitchMul: f32 = f32(Mathf.exp((pitchN - 0.5) * 1.0));
  const memDec: f32 = f32(Mathf.exp(-1.0 / ((0.05 + decayN * 0.4) * sampleRate)));   // bongo/conga
  const claveDec: f32 = f32(Mathf.exp(-1.0 / (0.04 * sampleRate)));
  const shakeDec: f32 = f32(Mathf.exp(-1.0 / ((0.03 + shakerN * 0.12) * sampleRate)));
  const cymDec: f32 = f32(Mathf.exp(-1.0 / ((0.15 + shakerN * 0.5) * sampleRate)));
  const cowDec: f32 = f32(Mathf.exp(-1.0 / (0.18 * sampleRate)));
  const pDec: f32 = f32(Mathf.exp(-1.0 / (0.02 * sampleRate)));
  const lpco: f32 = 0.06 + 0.93 * toneN;
  const out: f32 = level * 0.55;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      let v: f32 = 0.0;
      pPEnv[s] *= pDec;
      if (t == 0 || t == 1) {           // bongo / conga membranes
        const fr: f32 = baseHz[t] * pitchMul * (1.0 + 0.5 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        v = f32(Mathf.sin(ph * 6.2831853)) + (pPEnv[s] > 0.7 ? rnd() * 0.25 : 0.0);
        pAEnv[s] *= memDec;
      } else if (t == 2) {              // claves: short bright tone
        const fr: f32 = baseHz[2] * pitchMul;
        let ph: f32 = pPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        v = f32(Mathf.sin(ph * 6.2831853)) * 0.9;
        pAEnv[s] *= claveDec;
      } else if (t == 3) {              // maracas: high-passed noise burst
        const raw: f32 = rnd(); hp += (raw - hp) * 0.7; v = (raw - hp) * (0.7 + shakerN * 0.3);
        pAEnv[s] *= shakeDec;
      } else if (t == 4) {              // cowbell: two detuned squares
        const f1: f32 = 540.0 * pitchMul, f2: f32 = 800.0 * pitchMul;
        let p1: f32 = pPh[s] + f1 / sampleRate; if (p1 >= 1.0) p1 -= 1.0; pPh[s] = p1;
        let p2: f32 = pPh2[s] + f2 / sampleRate; if (p2 >= 1.0) p2 -= 1.0; pPh2[s] = p2;
        const sq: f32 = ((p1 < 0.5 ? 1.0 : -1.0) + (p2 < 0.5 ? 1.0 : -1.0)) * 0.5;
        v = sq * (0.5 + cowN * 0.6);
        pAEnv[s] *= cowDec;
      } else {                          // cymbal: bright noise
        const raw: f32 = rnd(); hp += (raw - hp) * 0.85; v = (raw - hp) * 0.6;
        pAEnv[s] *= cymDec;
      }
      mix += v * pAEnv[s] * pVel[s];
      if (pAEnv[s] < 0.0004) pAct[s] = 0;
    }
    toneZ += (mix - toneZ) * lpco;
    let o: f32 = toneZ * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
