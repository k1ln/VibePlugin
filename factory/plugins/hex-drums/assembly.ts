// =====================================================================
//  HEX DRUMS — analog electronic drums (Simmons SDS-V lineage).
//  Distinct from sampled drum machines: every hit is SYNTHESISED in real
//  time — the iconic 80s pitch-swept "pew" toms (a sine whose pitch sweeps
//  down) plus a noisy click, with kick, snare and hat. A MIDI note selects
//  a voice (note % 6) and triggers it into an 8-slot pool. Controls: Pitch,
//  Sweep (the pitch-drop), Decay, Noise (click/snap), Tone, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 6;     // drum voice types
const POOL: i32 = 8;   // simultaneous hits

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// base pitch per voice type: 0 kick,1 snare,2 tom-hi,3 tom-mid,4 tom-lo,5 hat
const baseHz: StaticArray<f32> = new StaticArray<f32>(NV);
const isNoise: StaticArray<f32> = new StaticArray<f32>(NV); // 1 = noise-led (snare/hat)

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);
const pPhase: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);  // pitch env (1->0)
const pNEnv: StaticArray<f32> = new StaticArray<f32>(POOL);  // noise/click env
const pAct: StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel: StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

let sampleRate: f32 = 48000.0;
let rngState: i32 = 22222;
let toneZ: f32 = 0.0;

const P_PITCH: i32 = 0;
const P_SWEEP: i32 = 1;
const P_DECAY: i32 = 2;
const P_NOISE: i32 = 3;
const P_TONE: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  pNext = 0; toneZ = 0.0;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPhase[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pNEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  baseHz[0] = 55.0;  isNoise[0] = 0.0;  // kick
  baseHz[1] = 185.0; isNoise[1] = 1.0;  // snare
  baseHz[2] = 320.0; isNoise[2] = 0.0;  // tom hi
  baseHz[3] = 200.0; isNoise[3] = 0.0;  // tom mid
  baseHz[4] = 130.0; isNoise[4] = 0.0;  // tom lo
  baseHz[5] = 0.0;   isNoise[5] = 1.0;  // hat
  params[P_PITCH] = 0.5; params[P_SWEEP] = 0.6; params[P_DECAY] = 0.5; params[P_NOISE] = 0.4; params[P_TONE] = 0.6; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  let t: i32 = id % NV; if (t < 0) t += NV;
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPhase[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pNEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = clampf(v, 0.05, 1.0);
}
export function noteOff(id: i32): void { /* one-shot drums */ }

export function process(n: i32): void {
  const pitchN: f32 = clampf(params[P_PITCH], 0.0, 1.0);
  const sweepN: f32 = clampf(params[P_SWEEP], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const noiseN: f32 = clampf(params[P_NOISE], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const decaySec: f32 = 0.05 + decayN * decayN * 0.9;
  const aCoef: f32 = f32(Mathf.exp(-1.0 / (decaySec * sampleRate)));
  const pCoef: f32 = f32(Mathf.exp(-1.0 / (0.03 * sampleRate)));   // ~30 ms pitch sweep
  const nCoef: f32 = f32(Mathf.exp(-1.0 / (0.012 * sampleRate)));  // ~12 ms click/noise
  const pitchMul: f32 = f32(Mathf.exp((pitchN - 0.5) * 1.6));      // global tuning +/- ~ octave
  const sweepDepth: f32 = sweepN * 4.0;                            // pitch starts up to 5x base
  const lpco: f32 = 0.04 + 0.95 * toneN;
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      const bf: f32 = baseHz[t] * pitchMul;
      // pitch env sweep (the Simmons "pew")
      pPEnv[s] *= pCoef;
      const fr: f32 = bf * (1.0 + sweepDepth * pPEnv[s]);
      let ph: f32 = pPhase[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPhase[s] = ph;
      const sine: f32 = f32(Mathf.sin(ph * 6.2831853));
      // noise / click
      pNEnv[s] *= nCoef;
      const noise: f32 = rnd();
      let v: f32;
      if (isNoise[t] > 0.5) {
        // snare/hat: noise-led + a little tone
        v = noise * (0.7 + 0.3 * noiseN) + sine * 0.25;
      } else {
        // kick/toms: tonal sine + click transient
        v = sine + noise * pNEnv[s] * noiseN * 0.9;
      }
      pAEnv[s] *= aCoef;
      mix += v * pAEnv[s] * pVel[s];
      if (pAEnv[s] < 0.0004) pAct[s] = 0;
    }
    toneZ += (mix - toneZ) * lpco;
    let o: f32 = toneZ * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
