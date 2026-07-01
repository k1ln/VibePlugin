// =====================================================================
//  BARK BEAT — a tight analog drum machine (Roland TR-606 lineage).
//  Real-time analog drum synthesis (no samples), distinct from the 808/909
//  and Simmons units: punchy "barking" kick, snappy snare, tight analog
//  toms and bright sizzly hats. A MIDI note picks a voice (note % 6) into
//  an 8-slot pool. Controls: Pitch, Punch (kick attack/snap), Snare
//  (tone/noise), Hat (hat brightness+length), Decay, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NV: i32 = 6;     // 0 kick,1 snare,2 tom-lo,3 tom-hi,4 c-hat,5 o-hat
const POOL: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const baseHz: StaticArray<f32> = new StaticArray<f32>(NV);

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);
const pPhase: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct: StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel: StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

let sampleRate: f32 = 48000.0;
let rngState: i32 = 13579;
let hatHp: f32 = 0.0;

const P_PITCH: i32 = 0;
const P_PUNCH: i32 = 1;
const P_SNARE: i32 = 2;
const P_HAT: i32 = 3;
const P_DECAY: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  pNext = 0; hatHp = 0.0;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPhase[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  baseHz[0] = 60.0; baseHz[1] = 200.0; baseHz[2] = 120.0; baseHz[3] = 190.0; baseHz[4] = 0.0; baseHz[5] = 0.0;
  params[P_PITCH] = 0.5; params[P_PUNCH] = 0.6; params[P_SNARE] = 0.5; params[P_HAT] = 0.55; params[P_DECAY] = 0.45; params[P_LEVEL] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  let t: i32 = id % NV; if (t < 0) t += NV;
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPhase[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = clampf(v, 0.05, 1.0);
}
export function noteOff(id: i32): void { /* one-shots */ }

export function process(n: i32): void {
  const pitchN: f32 = clampf(params[P_PITCH], 0.0, 1.0);
  const punchN: f32 = clampf(params[P_PUNCH], 0.0, 1.0);
  const snareN: f32 = clampf(params[P_SNARE], 0.0, 1.0);
  const hatN: f32 = clampf(params[P_HAT], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const pitchMul: f32 = f32(Mathf.exp((pitchN - 0.5) * 1.2));
  // decay times per family
  const tonalDec: f32 = f32(Mathf.exp(-1.0 / ((0.06 + decayN * 0.5) * sampleRate)));
  const snareDec: f32 = f32(Mathf.exp(-1.0 / ((0.05 + decayN * 0.22) * sampleRate)));
  const chDec: f32 = f32(Mathf.exp(-1.0 / ((0.012 + hatN * 0.02) * sampleRate)));
  const ohDec: f32 = f32(Mathf.exp(-1.0 / ((0.08 + hatN * 0.25) * sampleRate)));
  const pDec: f32 = f32(Mathf.exp(-1.0 / (0.018 * sampleRate)));   // pitch env (kick/tom)
  const punchAmt: f32 = 1.0 + punchN * 3.0;
  const out: f32 = level * 0.55;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      let v: f32 = 0.0;
      pPEnv[s] *= pDec;
      if (t == 0) {             // kick: sine with punchy pitch drop + click
        const fr: f32 = baseHz[0] * pitchMul * (1.0 + punchAmt * pPEnv[s]);
        let ph: f32 = pPhase[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPhase[s] = ph;
        v = f32(Mathf.sin(ph * 6.2831853)) + (pPEnv[s] > 0.6 ? rnd() * 0.4 : 0.0);
        pAEnv[s] *= tonalDec;
      } else if (t == 1) {      // snare: noise + tone
        const fr: f32 = baseHz[1] * pitchMul;
        let ph: f32 = pPhase[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPhase[s] = ph;
        v = rnd() * (0.6 + snareN * 0.4) + f32(Mathf.sin(ph * 6.2831853)) * (0.5 - snareN * 0.3);
        pAEnv[s] *= snareDec;
      } else if (t == 2 || t == 3) { // toms: sine with mild pitch drop
        const fr: f32 = baseHz[t] * pitchMul * (1.0 + 0.8 * pPEnv[s]);
        let ph: f32 = pPhase[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; pPhase[s] = ph;
        v = f32(Mathf.sin(ph * 6.2831853));
        pAEnv[s] *= tonalDec;
      } else {                  // hats: high-passed noise (bright)
        const raw: f32 = rnd();
        hatHp += (raw - hatHp) * 0.6; const hp: f32 = raw - hatHp;
        v = hp * (0.6 + hatN * 0.5);
        pAEnv[s] *= (t == 4 ? chDec : ohDec);
      }
      mix += v * pAEnv[s] * pVel[s];
      if (pAEnv[s] < 0.0004) pAct[s] = 0;
    }
    let o: f32 = mix * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
