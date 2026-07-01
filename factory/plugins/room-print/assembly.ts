// Room Print — convolution reverb. A REAL measured small-room impulse response
// (Adventure Kid "AK-SROOMS", CC BY 4.0 — see README) is baked in as base64
// Int16-LE PCM @ 22050 Hz, decoded at init() and resampled to the host rate,
// then convolved with the input in the time domain. Pure algorithm, no host
// imports, no allocation inside process() (all StaticArrays at module scope).
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_TAPS: i32 = 6144;          // convolution length cap (at host rate)
const HIST_LEN: i32 = 16384;         // power-of-two ring >= MAX_TAPS + predelay
const HIST_MASK: i32 = HIST_LEN - 1;
const IR_RAW_RATE: f32 = 22050.0;    // rate the embedded IR was stored at
const IR_RAW_CAP: i32 = 8192;        // decoded raw-IR cap

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const irRaw: StaticArray<f32> = new StaticArray<f32>(IR_RAW_CAP);
const ir:    StaticArray<f32> = new StaticArray<f32>(MAX_TAPS);
const histL: StaticArray<f32> = new StaticArray<f32>(HIST_LEN);
const histR: StaticArray<f32> = new StaticArray<f32>(HIST_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;
let irRawLen: i32 = 0;
let irLen: i32 = 0;          // resampled + capped length
let writePos: i32 = 0;
let lpL: f32 = 0.0;
let lpR: f32 = 0.0;

// --- embedded impulse response (base64 of Int16-LE mono PCM @ 22050 Hz) ---
const IR_B64: string = "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IQAgACAAIAAgAB4AHQAcABsAGgAZABcAFAASABAAEAAQABAAEAAPAA0ACgAHAAUAAwADAAMAAwABAP///f/7//r/+P/4//j/+P/4//f/9v/1//P/8f/w/+7/7f/s/+v/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/r/+v/6//r/+v/7P/s/+3/7f/t/+7/7v/v/+7/8f/s//X/5v8sAMr/xf8UACMAngB/ACIAhv9R/8f/j/+e/2D/Lv+E/woAawCBAG4AUQA9ADEAKwAoACQAHgAZABMAEQAMAAkABwAEAAMAAAD+//3//P/6//v/+//3//X/9//3//X/9P/2//j/9v/2//f/+P/4//r/+//9//z/+//8//7///8AAAEAAQABAAEAAgADAAQABAAFAAYABgAHAAgACAAIAAkACQAJAAgACAAIAAkACgALAAwACgALAAwADAALAAoACQAIAAgACAAIAAcABAAEAAQABQAFAAYABgAGAAYABQAFAAUABQAFAAUABAAEAAMAAwACAAIAAgABAAEAAQAAAAAAAAAAAAAA/////////////////v/9//3//f/8//z/+//7//v/+v/6//r/+f/5//n/+P/4//j/+P/4//j/+P/4//j/+f/5//n/+f/6//r/+v/6//v/+//7//v/+//7//z//P/8//z//P/9//z//v/8////+v8DAN7/FQAXAOz/5P+l/63/7P8wAEoARQA0ACIAGAARAAwACQAFAAMA///9//v/9//2//f/9v/1//T/8//z//T/9P/1//b/9//3//b/9//4//r//P/+//7//v///wAAAgAEAAYABwAHAAYABgAHAAgACQAJAAoACgALAAsADAAMAAwADAAMAAwADAAMAAwADAAMAAsACwALAAsACgAKAAkACQAIAAgABwAHAAYABgAGAAYABgAGAAUABAACAAAAAAD//////v/+//3//P/7//r/+v/6//n/+v/3//z/8/8aAOX/4v8JABYAVABIAAwAyf+v/7D/w//V/+H/5//p/+7/8f/3//n//v///wAAAwAFAAYABgAHAAcABwAHAAgACAAIAAgACAAHAAYABQADAAIAAAAAAAAAAAD///7//f/8//v/+v/6//r/+v/6//r/+f/4//j/+P/3//f/9//3//f/9//3//f/9//4//j/+f/5//r/+v/7//z//P/9//3//f/9//7//v/+////AAABAAIAAgADAAUABwAHAAcACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAHAAgACAAHAAgABwAIAAcACAAHAAgABgAJAAUADQAQAPX/CwANAB8ALgAbAP//6f/l/+v/8f/3//v///8AAAAAAgADAAUABAAGAAIAEgD7//r/CwASACsAJgALAO3/4//k/+z/8P/1//j/+f/7//z/+//6//v//P/9////AAAAAAAAAAAAAP////////7//v/+//7//f/8//v/+v/5//j/+P/3//b/9v/1//X/9f/1//b/9v/2//b/9//3//f/9//3//f/9//3//f/9//3//f/9//3//j/+f/5//n/+f/5//n/+f/5//r/+v/6//r/+v/6//r/+//7//z//f/9//7///8AAAEAAgACAAMAAwAEAAQABAAFAAUABgAGAAYABwAHAAcACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAHAAcABwAHAAcABwAGAAYABgAFAAUABQAEAAQAAwADAAMAAgACAAEAAQAAAAAA//////7//v/9//3//P/8//v/+//7//r/+v/5//n/+f/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+f/4//n/9//6//T/8/8IAPn/9v/p/97/6/8AABEAFAARAAsABwABAAEA/v////j/9f8IAPj/9P/l/9r/6f///wwADgALAAUAAgD///3//v/9//z/+//5//j/+P/4//j/+P/4//j/+P/5//n/+v/7//v//P/9//3//f/+//7//v/+//////8AAAEAAQACAAMAAwAEAAQABQAFAAUABQAGAAYABgAGAAYABgAGAAYABgAFAAUABQAFAAQABAAEAAMAAwACAAEAAQAAAAAAAAD//////v/+//3//f/8//z/+//7//r/+f/5//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//n/+f/5//n/+f/5//n/+f/6//r/+v/7//v/+//8//z//P/9//3//f/+//7//v/+//////////////8AAAAAAAAAAAAAAAAAAAEAAQABAAEAAQABAAEAAQABAAEAAgAAAAIAAAAFAAYA9v8CAAQAEAAWAAwA/P/w/+//8v/3//n//P/+//3//f/+/wAAAQACAAIAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAgACAAIAAQABAAAAAAD///7//v/9//3//P/8//v/+//6//r/+f/5//n/+v/4//r/9//9////8P/9////CgASAAgA9v/o/+f/6f/u//H/8//2//f/+P/4//j/+v/7//z//f/9//7//v//////AAAAAAAAAQABAAEAAQAAAAAAAAAAAAAAAAD///////////7//v/+//7//v/+//3//f/9//3//f/9//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/9//3//f/9//3//f/9//3//f/9//7//v/+//7//v//////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////////////////////////////////7//v/+//7//v/+//7//v/+//7//v/9//3//f/9//3//f/9//3//f/9//3//f/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//v/+//7//v/+//3////6/wIAAgD7//v/8//0//v/BQAJAAkABQACAAIAAgABAAEA//8AAPr/AgABAPr/+f/x//L/+f8DAAgACAAFAAEAAAAAAP///v/+//3//P/8//z//P/7//v/+//8//z//P/8//z//f/9//3//f/+//7//v//////AAAAAAAAAQABAAEAAQACAAIAAgACAAIAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAIAAgACAAIAAgABAAEAAQABAAEAAQAAAAAAAAAAAAAA//////////////7//v/+//3//f/9//3//f/9//z//P/8//z//P/8//z//P/8//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//z//P/8//z//P/8//z//P/8//3//f/9//3//f/9//7//v/+//7//v/+//7/////////////////AAAAAAAAAAAAAAAAAAABAAEAAQABAAEAAQABAAEAAQABAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD+////AAADAAMAAwACAPz//f/9//3//f/9//7//v///////////wAAAAACAAEA//8AAAIABQAEAAUAAAD9//7//v/+//7/////////AAAAAAAAAAABAAEAAQABAAEAAQABAAEAAQABAAEAAAAAAAAAAAAAAAAAAAAAAP////////////////////////7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////////////////////////////////////////v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v////z//f/+/wAAAwACAP///P/7//z//P/8//z//f/9//3//v/+//7//v/////////////////////////////////////////////////////////////////////////+//7//v/+//7//v/9//7/AAD+//3/+//7//v///8CAAIAAgABAAAA/////////v/+//7//v/+//3//f/9//3//f/9//3//f/9//3//f/9//3//f/+//7//v/+//7//v/+//7//v/+//7///////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////////////////////////////////////////////////////7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//7//v/+//7//v/+//7//v/+//7//v/+//7//f///////v/9//v//P/+/wAAAQABAAEAAAAAAP/////////////////////+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7///////////////////////////////////////////////////////////////////8AAP7//v///wAAAgACAAAA/f/8//z//f/9//7//v/+//7//v/+//////////////////////////////////////////7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAD///////8AAAEAAAAAAP///v/+//7///////////////////////////8AAP///////wAAAAABAAAA//////7//v////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQACAAEAAgACAAIAAQABAAEAAQACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAQACAAIAAgACAAEAAQABAAIAAgADAAMAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAMAAgACAAEAAQABAAEAAQACAAIAAQACAAIAAgADAAIAAgABAAEAAQABAAEAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+//7///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7///////7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQABAAEAAAABAAEAAQABAAEAAQABAAAAAAAAAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

@inline function b64sym(c: i32): i32 {
  if (c >= 65 && c <= 90)  return c - 65;        // A-Z -> 0..25
  if (c >= 97 && c <= 122) return c - 71;        // a-z -> 26..51
  if (c >= 48 && c <= 57)  return c + 4;         // 0-9 -> 52..61
  if (c == 43) return 62;                        // +
  if (c == 47) return 63;                        // /
  return -1;                                     // '=' / padding
}

function decodeIR(): void {
  const s = IR_B64;
  const n = s.length;
  let buf: i32 = 0, bits: i32 = 0, lo: i32 = -1, si: i32 = 0;
  for (let i = 0; i < n; i++) {
    const v = b64sym(s.charCodeAt(i));
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buf >> bits) & 0xFF;
      if (lo < 0) { lo = byte; }
      else {
        let val = (byte << 8) | lo;              // Int16 LE
        if (val >= 32768) val -= 65536;
        if (si < IR_RAW_CAP) { irRaw[si] = f32(val) / 32768.0; si++; }
        lo = -1;
      }
    }
  }
  irRawLen = si;
}

function buildIR(): void {
  // resample raw IR (IR_RAW_RATE) -> host sampleRate, linear interp, cap MAX_TAPS
  const ratio: f32 = IR_RAW_RATE / sampleRate;   // raw samples advanced per host sample
  let n: i32 = i32(f32(irRawLen) / ratio);
  if (n > MAX_TAPS) n = MAX_TAPS;
  if (n < 1) n = 1;
  for (let k = 0; k < n; k++) {
    const sp: f32 = f32(k) * ratio;
    const i0: i32 = i32(sp);
    const fr: f32 = sp - f32(i0);
    const a: f32 = i0 < irRawLen ? irRaw[i0] : 0.0;
    const b: f32 = (i0 + 1) < irRawLen ? irRaw[i0 + 1] : 0.0;
    ir[k] = a + (b - a) * fr;
  }
  irLen = n;
  // energy-normalise so the wet path sits near unity, then a musical trim
  let e: f32 = 0.0;
  for (let k = 0; k < irLen; k++) e += ir[k] * ir[k];
  let g: f32 = e > 0.000001 ? (f32(1.0) / Mathf.sqrt(e)) : 1.0;
  g *= 0.85;
  for (let k = 0; k < irLen; k++) ir[k] *= g;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0; lpL = 0.0; lpR = 0.0;
  for (let i = 0; i < HIST_LEN; i++) { histL[i] = 0.0; histR[i] = 0.0; }
  params[0] = 0.30;   // Mix
  params[1] = 0.65;   // Size (decay length)
  params[2] = 0.12;   // Pre-Delay
  params[3] = 0.60;   // Tone
  params[4] = 0.90;   // Width
  decodeIR();
  buildIR();
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const mix: f32  = params[0];
  const size: f32 = params[1];
  const pdel: f32 = params[2];
  const tone: f32 = params[3];
  const width: f32 = params[4];

  let taps: i32 = i32(f32(irLen) * (0.12 + 0.88 * size));
  if (taps < 1) taps = 1;
  if (taps > irLen) taps = irLen;
  let pd: i32 = i32(pdel * 0.10 * sampleRate);          // up to ~100 ms pre-delay
  if (pd < 0) pd = 0;
  const pdMax: i32 = HIST_LEN - MAX_TAPS - 1;
  if (pd > pdMax) pd = pdMax;
  const lpco: f32 = 0.04 + 0.95 * tone;                 // bright tone -> high cutoff
  const stereo: i32 = channels > 1 ? 1 : 0;
  const wet: f32 = mix;
  const dry: f32 = 1.0 - mix;

  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[f];
    const xr: f32 = stereo ? inBuf[MAX_FRAMES + f] : xl;
    histL[writePos] = xl;
    histR[writePos] = xr;
    const base: i32 = (writePos - pd) & HIST_MASK;
    let yl: f32 = 0.0;
    let yr: f32 = 0.0;
    for (let k = 0; k < taps; k++) {
      const c: f32 = ir[k];
      const idx: i32 = (base - k) & HIST_MASK;
      yl += histL[idx] * c;
      yr += histR[idx] * c;
    }
    lpL += (yl - lpL) * lpco;
    lpR += (yr - lpR) * lpco;
    let wl: f32 = lpL;
    let wr: f32 = lpR;
    const mid: f32 = (wl + wr) * 0.5;
    wl = mid + (wl - mid) * width;
    wr = mid + (wr - mid) * width;
    let ol: f32 = xl * dry + wl * wet;
    let orr: f32 = xr * dry + wr * wet;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[f] = ol;
    if (stereo) outBuf[MAX_FRAMES + f] = orr;
    writePos = (writePos + 1) & HIST_MASK;
  }
}
