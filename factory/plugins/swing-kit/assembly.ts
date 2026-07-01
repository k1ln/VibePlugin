// =====================================================================
//  SWING KIT — a punchy sampled-style drum kit with SWING (Akai MPC60 /
//  3000 lineage). The MPC's two claims to fame are its punchy, slightly
//  saturated drum sound and its legendary timing SWING. This box is a
//  preset 16-step boom-bap groove of six punchy synthesised voices, and
//  the signature SWING control drags every off-beat 16th late for that
//  head-nodding MPC feel, while PUNCH boosts the transients and adds a
//  touch of drive. Holding a note runs the groove; release stops it.
//  Controls: Tune, Decay, Snap, Swing, Punch, Level.
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

const pType: StaticArray<i32> = new StaticArray<i32>(POOL);   // 0 kick,1 snare,2 chat,3 ohat,4 clap,5 perc
const pPh:   StaticArray<f32> = new StaticArray<f32>(POOL);
const pAEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pPEnv: StaticArray<f32> = new StaticArray<f32>(POOL);
const pAct:  StaticArray<i32> = new StaticArray<i32>(POOL);
const pVel:  StaticArray<f32> = new StaticArray<f32>(POOL);
let pNext: i32 = 0;

// Each voice's 16-step pattern is a live parameter, packed as a 16-bit mask
// (bit s set = step s active). One param per row keeps the whole 6x16 grid in
// 6 floats — well inside the 64-param pool — and it persists / recalls for
// free. The GUI's step sequencer writes these; process() reads them every step
// so edits are heard immediately. Defaults below = the original boom-bap groove.
//   kick  1,0,0,0 0,0,1,0 0,0,1,0 0,0,0,0 -> steps 0,6,10        = 1089
//   snare 0,0,0,0 1,0,0,0 0,0,0,0 1,0,0,1 -> steps 4,12,15       = 36880
//   chat  1,0,1,0 1,0,1,0 1,0,1,0 1,0,1,0 -> even steps          = 21845
//   ohat  0,0,0,0 0,0,1,0 0,0,0,0 0,0,1,0 -> steps 6,14          = 16448
//   clap  0,0,0,0 1,0,0,0 0,0,0,0 1,0,0,0 -> steps 4,12          = 4112
//   perc  0,0,0,1 0,0,0,0 0,0,0,1 0,0,0,0 -> steps 3,11          = 2056
const DEF_KICK:  f32 = 1089.0;
const DEF_SNARE: f32 = 36880.0;
const DEF_CHAT:  f32 = 21845.0;
const DEF_OHAT:  f32 = 16448.0;
const DEF_CLAP:  f32 = 4112.0;
const DEF_PERC:  f32 = 2056.0;

let seqOn: i32 = 0;
let seqStep: i32 = 0;
let seqCount: f32 = 0.0;
let curStepLen: f32 = 6000.0;
let gateVel: f32 = 0.8;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 246813;
let hpz: f32 = 0.0;

const P_TUNE: i32 = 0; const P_DECAY: i32 = 1; const P_SNAP: i32 = 2; const P_SWING: i32 = 3; const P_PUNCH: i32 = 4; const P_LEVEL: i32 = 5;
// step-sequencer rows: one 16-bit pattern mask per voice
const P_KICK_ROW: i32 = 6; const P_SNARE_ROW: i32 = 7; const P_CHAT_ROW: i32 = 8; const P_OHAT_ROW: i32 = 9; const P_CLAP_ROW: i32 = 10; const P_PERC_ROW: i32 = 11;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }
// decode a step from a voice's pattern mask; round() survives the host's
// normalized param round-trip (raw pass-through is already exact).
@inline function stepOn(mask: f32, step: i32): bool { return ((i32(Mathf.round(mask)) >> step) & 1) != 0; }

function trig(t: i32, vel: f32): void {
  const slot: i32 = pNext; pNext = (pNext + 1) % POOL;
  pType[slot] = t; pPh[slot] = 0.0; pAEnv[slot] = 1.0; pPEnv[slot] = 1.0; pAct[slot] = 1; pVel[slot] = vel;
}
function fireStep(step: i32): void {
  const v: f32 = gateVel;
  if (stepOn(params[P_KICK_ROW],  step)) trig(0, v);
  if (stepOn(params[P_SNARE_ROW], step)) trig(1, v * 0.92);
  if (stepOn(params[P_CHAT_ROW],  step)) trig(2, v * 0.55);
  if (stepOn(params[P_OHAT_ROW],  step)) trig(3, v * 0.5);
  if (stepOn(params[P_CLAP_ROW],  step)) trig(4, v * 0.8);
  if (stepOn(params[P_PERC_ROW],  step)) trig(5, v * 0.7);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; pNext = 0; hpz = 0.0;
  seqOn = 0; seqStep = 0; seqCount = 0.0; curStepLen = sampleRate * 0.125; gateVel = 0.8;
  for (let i = 0; i < POOL; i++) { pAct[i] = 0; pPh[i] = 0.0; pAEnv[i] = 0.0; pPEnv[i] = 0.0; pType[i] = 0; pVel[i] = 0.0; }
  params[P_TUNE] = 0.5; params[P_DECAY] = 0.5; params[P_SNAP] = 0.55; params[P_SWING] = 0.5; params[P_PUNCH] = 0.5; params[P_LEVEL] = 0.85;
  params[P_KICK_ROW] = DEF_KICK; params[P_SNARE_ROW] = DEF_SNARE; params[P_CHAT_ROW] = DEF_CHAT;
  params[P_OHAT_ROW] = DEF_OHAT; params[P_CLAP_ROW] = DEF_CLAP; params[P_PERC_ROW] = DEF_PERC;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 12; }

export function noteOn(id: i32, f: f32, v: f32): void {
  gateVel = clampf(v, 0.1, 1.0); seqOn = 1; seqStep = 0; seqCount = 0.0; curStepLen = sampleRate * 0.125; fireStep(0);
}
export function noteOff(id: i32): void { seqOn = 0; }

export function process(n: i32): void {
  const tuneN: f32  = clampf(params[P_TUNE], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const snapN: f32  = clampf(params[P_SNAP], 0.0, 1.0);
  const swingN: f32 = clampf(params[P_SWING], 0.0, 1.0);
  const punchN: f32 = clampf(params[P_PUNCH], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  const sr: f32 = sampleRate;
  const stepLen: f32 = sr * 0.125;                        // 120 BPM sixteenths
  const swing: f32 = swingN * 0.62;                       // up to ~62% delay of off-beats
  const dscale: f32 = 0.6 + decayN * 1.1;
  const kDec: f32 = f32(Mathf.exp(-1.0 / (0.15 * dscale * sr)));
  const kPDec: f32 = f32(Mathf.exp(-1.0 / (0.016 * sr)));
  const sDec: f32 = f32(Mathf.exp(-1.0 / (0.12 * dscale * sr)));
  const chDec: f32 = f32(Mathf.exp(-1.0 / (0.02 * sr)));
  const ohDec: f32 = f32(Mathf.exp(-1.0 / (0.12 * sr)));
  const cpDec: f32 = f32(Mathf.exp(-1.0 / (0.11 * sr)));
  const pcDec: f32 = f32(Mathf.exp(-1.0 / (0.09 * dscale * sr)));

  const kBase: f32 = (48.0 + tuneN * 55.0) / sr;
  const accent: f32 = 1.0;
  const punchAmt: f32 = 1.0 + punchN * 2.5;               // transient boost + drive
  const out: f32 = level * 0.44;

  for (let i = 0; i < n; i++) {
    if (seqOn != 0) {
      seqCount += 1.0;
      if (seqCount >= curStepLen) {
        seqCount -= curStepLen; seqStep = (seqStep + 1) % STEPS; fireStep(seqStep);
        // swing: the gap BEFORE an off-beat (odd) step is longer, after it shorter
        curStepLen = (seqStep % 2 == 0) ? stepLen * (1.0 + swing) : stepLen * (1.0 - swing);
      }
    }
    let mix: f32 = 0.0;
    for (let s = 0; s < POOL; s++) {
      if (pAct[s] == 0) continue;
      const t: i32 = pType[s];
      let smp: f32 = 0.0;
      if (t == 0) {
        pPEnv[s] *= kPDec;
        const fr: f32 = kBase * (1.0 + 2.1 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const click: f32 = pPEnv[s] > 0.55 ? rnd() * 0.35 * punchN : 0.0;
        smp = (f32(Mathf.sin(ph * 6.2831853)) + click) * pAEnv[s];
        pAEnv[s] *= kDec;
      } else if (t == 1) {
        pPEnv[s] *= kPDec;
        const fr: f32 = (185.0 / sr) * (1.0 + 0.5 * pPEnv[s]);
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        const tone: f32 = f32(Mathf.sin(ph * 6.2831853));
        smp = (tone * (0.5 - snapN * 0.28) + rnd() * (0.5 + snapN * 0.4)) * pAEnv[s];
        pAEnv[s] *= sDec;
      } else if (t == 2) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * 0.5 * pAEnv[s]; pAEnv[s] *= chDec;
      } else if (t == 3) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * 0.45 * pAEnv[s]; pAEnv[s] *= ohDec;
      } else if (t == 4) {
        const ns: f32 = rnd(); const hp: f32 = ns - hpz; hpz = ns;
        smp = hp * 0.8 * pAEnv[s]; pAEnv[s] *= cpDec;
      } else {
        const fr: f32 = 330.0 / sr;
        let ph: f32 = pPh[s] + fr; if (ph >= 1.0) ph -= 1.0; pPh[s] = ph;
        smp = (f32(Mathf.sin(ph * 6.2831853)) * 0.7 + rnd() * 0.3) * pAEnv[s]; pAEnv[s] *= pcDec;
      }
      if (pAEnv[s] < 0.0006) { pAct[s] = 0; }
      mix += smp * pVel[s] * accent;
    }
    // MPC punch: drive + soft-clip for the fat, punchy character
    let o: f32 = f32(Mathf.tanh(mix * punchAmt * out * 0.9));
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
