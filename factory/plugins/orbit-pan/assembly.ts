// =====================================================================
//  ORBIT PAN — auto-pan / tremolo / harmonic tremolo / ping-pong.
//  One LFO (sine, triangle, soft square, saw, random sample-and-hold, with
//  an edge-smoothing control) modulates the stereo image or the level:
//    AUTO-PAN     equal-power pan of the stereo signal
//    TREMOLO      amplitude modulation, L/R phase offset for stereo
//    HARMONIC     a crossover splits the signal; the low and high bands
//                 are modulated in antiphase (the swirling brownface trem)
//    PING-PONG    left and right gains alternate
//  The rate is free (Hz) or locked to the host tempo (1/1 .. 1/16) and
//  phase-locked to the host beat position while the transport plays.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 11;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_MODE: i32 = 0; const P_RATE: i32 = 1;  const P_SYNC: i32 = 2;  const P_DEPTH: i32 = 3; const P_SHAPE: i32 = 4;
const P_SMOOTH: i32 = 5; const P_PHASE: i32 = 6; const P_XOVER: i32 = 7; const P_WIDTH: i32 = 8; const P_MIX: i32 = 9; const P_OUT: i32 = 10;

let sampleRate: f32 = 48000.0;
let lfoPh: f64 = 0.0; let hostPlaying: bool = false; let hostSeen: bool = false; let hostBpm: f32 = 120.0; let beatPos: f64 = 0.0;
let shS: f32 = 0.0; let shT: f32 = 0.0; let lastCyc: i64 = -1; let smL: f32 = 0.0; let smR: f32 = 0.0;
let loL: f32 = 0.0; let loR: f32 = 0.0; let lo2L: f32 = 0.0; let lo2R: f32 = 0.0;
let seed: u32 = 7;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 8388608.0) - 1.0; }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
export function transport(playing: i32, ppq: f64, bpm: f32): void {
  hostPlaying = playing != 0; hostSeen = true; if (bpm > 20.0) hostBpm = bpm;
  if (hostPlaying) beatPos = ppq;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  lfoPh = 0.0; hostPlaying = false; hostSeen = false; hostBpm = 120.0; beatPos = 0.0; shS = 0.0; shT = 0.0; lastCyc = -1; smL = 0.0; smR = 0.0;
  loL = 0.0; loR = 0.0; lo2L = 0.0; lo2R = 0.0; seed = 7;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [0.0, 0.4, 0.0, 0.7, 0.0, 0.2, 0.5, 0.45, 1.0, 1.0, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

// LFO shape at phase p (0..1), output -1..1
function shape(kind: i32, p: f32): f32 {
  if (kind == 0) return f32(Mathf.sin(p * TWO_PI));
  if (kind == 1) return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
  if (kind == 2) return f32(Mathf.tanh(f32(Mathf.sin(p * TWO_PI)) * 6.0));
  if (kind == 3) return 1.0 - 2.0 * p;
  return shS;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const mode: i32 = i32(params[P_MODE] + 0.5);
  const syncI: i32 = i32(params[P_SYNC] + 0.5);
  const kind: i32 = i32(params[P_SHAPE] + 0.5);
  const depth: f32 = params[P_DEPTH];
  const width: f32 = params[P_WIDTH];
  const phOff: f32 = params[P_PHASE] * 0.5;                          // 0 .. half a cycle between channels
  const smooth: f32 = params[P_SMOOTH]; const smK: f32 = smooth < 0.01 ? 1.0 : 1.0 - f32(Mathf.exp(-1.0 / ((0.0004 + smooth * smooth * 0.08) * sr)));
  const xHz: f32 = 150.0 * f32(Mathf.pow(30.0, params[P_XOVER]));
  const xK: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * clampf(xHz, 50.0, sr * 0.4) / sr));
  const mix: f32 = params[P_MIX]; const outG: f32 = params[P_OUT] * params[P_OUT] * 2.0;
  const bpm: f32 = hostSeen && hostPlaying ? hostBpm : 120.0;
  const useSync: bool = syncI > 0;
  const beats: f32 = syncI == 1 ? 4.0 : (syncI == 2 ? 2.0 : (syncI == 3 ? 1.0 : (syncI == 4 ? 0.5 : (syncI == 5 ? 0.25 : 0.125))));
  const freeInc: f64 = f64(0.05 * f32(Mathf.pow(400.0, params[P_RATE]))) / f64(sr);
  const beatInc: f64 = f64(bpm) / (60.0 * f64(sr));
  let lvOut: f32 = 0.0; let lfoShow: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    // LFO phase: locked to the host beat position when synced and playing, else free-running
    if (useSync) {
      beatPos += beatInc;
      lfoPh = beatPos / f64(beats);
    } else { lfoPh += freeInc; }
    const cyc: i64 = i64(Math.floor(lfoPh));
    const p0: f32 = f32(lfoPh - f64(cyc));
    if (cyc != lastCyc) { lastCyc = cyc; shT = rnd(); }
    shS += (shT - shS) * 0.02;   // random values glide toward a new target each cycle
    let pR: f32 = p0 + phOff; if (pR >= 1.0) pR -= 1.0;
    let a: f32 = shape(kind, p0); let b: f32 = shape(kind, pR);
    smL += smK * (a - smL); smR += smK * (b - smR);
    a = smL; b = smR;
    const xl: f32 = inBuf[f]; const xr: f32 = inBuf[MAX_FRAMES + f];
    let yl: f32 = xl; let yr: f32 = xr;
    if (mode == 0) {
      // equal-power auto-pan of the whole stereo image
      const pan: f32 = clampf(a * depth * width, -1.0, 1.0);
      const ang: f32 = (pan + 1.0) * PI * 0.25;
      yl = xl * f32(Mathf.cos(ang)) * 1.4142; yr = xr * f32(Mathf.sin(ang)) * 1.4142;
    } else if (mode == 1) {
      yl = xl * (1.0 - depth * (0.5 - 0.5 * a)); yr = xr * (1.0 - depth * (0.5 - 0.5 * b));
    } else if (mode == 2) {
      // harmonic tremolo: low band with +LFO, high band with -LFO (two-pole crossover)
      loL += xK * (xl - loL); lo2L += xK * (loL - lo2L); loR += xK * (xr - loR); lo2R += xK * (loR - lo2R);
      const lowL: f32 = lo2L; const lowR: f32 = lo2R; const hiL: f32 = xl - lowL; const hiR: f32 = xr - lowR;
      const gLo: f32 = 1.0 - depth * (0.5 - 0.5 * a); const gHi: f32 = 1.0 - depth * (0.5 + 0.5 * a);
      const gLoR: f32 = 1.0 - depth * (0.5 - 0.5 * b); const gHiR: f32 = 1.0 - depth * (0.5 + 0.5 * b);
      yl = lowL * gLo + hiL * gHi; yr = lowR * gLoR + hiR * gHiR;
    } else {
      // ping-pong: left and right alternate
      const g: f32 = 0.5 + 0.5 * a;
      yl = xl * (1.0 - depth * g * width); yr = xr * (1.0 - depth * (1.0 - g) * width);
    }
    lfoShow = a;
    const oL: f32 = (xl * (1.0 - mix) + yl * mix) * outG; const oR: f32 = (xr * (1.0 - mix) + yr * mix) * outG;
    outBuf[f] = f32(Mathf.tanh(oL)); outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(oR));
    lvOut = f32(Mathf.abs(oL));
  }
  display[0] = clampf(lvOut * 1.5, 0.0, 1.0);
  display[1] = clampf(lfoShow * 0.5 + 0.5, 0.0, 1.0);
}
