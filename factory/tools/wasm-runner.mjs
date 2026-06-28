// =====================================================================
//  wasm-runner.mjs — offline test device for VibePlugin WASM DSP modules
//
//  Loads a compiled .wasm implementing the VibePlugin ABI, feeds it audio
//  (or MIDI notes for synths), captures the output, and reports whether
//  sound actually passes through and whether every parameter affects it.
//  Optionally writes the rendered output to a .wav for listening.
//
//  Usage:
//    node wasm-runner.mjs <plugin.wasm> [--params params.json] [--wav out.wav]
//                         [--synth] [--sr 48000] [--block 256] [--seconds 2]
//
//  params.json: [{ "name","index","min","max","default" }, ...]
//  If omitted, all 64 params default to 0 and only param 0..(getNumParams-1)
//  are swept across a generic 0..1 range.
//
//  Exit code 0 = PASS (audio present, finite, params reactive), 1 = FAIL.
// =====================================================================

import { readFileSync, writeFileSync } from "node:fs";

const STRIDE = 8192; // ABI kMaxFrames — planar channel stride inside the module

// ---- tiny arg parser -------------------------------------------------
const argv = process.argv.slice(2);
const wasmPath = argv[0];
function flag(name, def) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
if (!wasmPath || wasmPath.startsWith("--")) {
  console.error("usage: node wasm-runner.mjs <plugin.wasm> [--params p.json] [--wav out.wav] [--synth] [--sr N] [--block N] [--seconds N]");
  process.exit(2);
}
const paramsPath = flag("--params", null);
const wavPath = flag("--wav", null);
const forceSynth = flag("--synth", false) === true;
const sr = +flag("--sr", 48000);
const block = +flag("--block", 256);
const seconds = +flag("--seconds", 2);
const totalFrames = Math.round(sr * seconds);

// ---- load module -----------------------------------------------------
const bytes = readFileSync(wasmPath);
let instance;
try {
  const mod = new WebAssembly.Module(bytes);
  // VibePlugin modules are self-contained (runtime minimal, abort=) and import
  // nothing. Provide a fallback abort/seed just in case a build references one.
  const imports = {
    env: {
      abort: () => { throw new Error("wasm abort() called"); },
      seed: () => 0,
    },
  };
  instance = new WebAssembly.Instance(mod, imports);
} catch (e) {
  console.error("INSTANTIATE FAILED: " + e.message);
  process.exit(1);
}
const ex = instance.exports;

function need(name) {
  if (typeof ex[name] !== "function") {
    console.error("MISSING EXPORT: " + name);
    process.exit(1);
  }
}
["init", "process", "getInputPtr", "getOutputPtr", "getParamsPtr", "getNumParams"].forEach(need);
const isSynth = forceSynth || typeof ex.noteOn === "function";

// memory views are re-fetched after any call that might grow memory
function f32() { return new Float32Array(ex.memory.buffer); }

ex.init(sr, STRIDE, 2);
const inPtr = ex.getInputPtr() >>> 2;
const outPtr = ex.getOutputPtr() >>> 2;
const parPtr = ex.getParamsPtr() >>> 2;
const numParams = ex.getNumParams() | 0;

// ---- params ----------------------------------------------------------
let paramSpec = [];
if (paramsPath) {
  paramSpec = JSON.parse(readFileSync(paramsPath, "utf8"));
  if (paramSpec.params) paramSpec = paramSpec.params; // accept a whole .vstai-ish blob
}
function setParams(spec, overrideIdx = -1, overrideVal = 0) {
  const m = f32();
  for (let i = 0; i < 64; i++) m[parPtr + i] = 0;
  for (const p of spec) {
    const v = p.default ?? p.value ?? 0;
    m[parPtr + p.index] = v;
  }
  if (overrideIdx >= 0) m[parPtr + overrideIdx] = overrideVal;
}

// ---- input signal generator (effects) --------------------------------
// A deterministic, broadband test bed: swept sine + impulse train + noise,
// so we can see how the effect colours different content.
let rngState = 0x2545f491;
function rng() { // xorshift, deterministic
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return ((rngState >>> 0) / 0xffffffff) * 2 - 1;
}
function fillInput(startFrame, n) {
  const m = f32();
  for (let i = 0; i < n; i++) {
    const t = (startFrame + i) / sr;
    const sweep = Math.sin(2 * Math.PI * (100 + 1500 * (t % 1)) * t);
    const imp = ((startFrame + i) % Math.round(sr / 2) === 0) ? 0.4 : 0;
    // kept well below full-scale so a clean passthrough leaves headroom and
    // the noClip check flags only genuine internal buildup, not normal summing.
    const s = 0.4 * sweep + 0.1 * rng() + imp;
    m[inPtr + i] = s;        // L
    m[inPtr + STRIDE + i] = s; // R
  }
}
function clearInput(n) {
  const m = f32();
  for (let i = 0; i < n; i++) { m[inPtr + i] = 0; m[inPtr + STRIDE + i] = 0; }
}

// ---- clean MUSICAL source (for listenable previews, no noise) --------
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
const RIFF = [45, 52, 57, 60, 64, 57, 52, 48]; // A2 E3 A3 C4 E4 … a simple arpeggio
const noteLenF = Math.round(sr * 0.4);
function fillMusical(startFrame, n) {
  const m = f32();
  for (let i = 0; i < n; i++) {
    const gf = startFrame + i;
    const idx = Math.floor(gf / noteLenF);
    const localT = (gf - idx * noteLenF) / sr;
    const hz = midiHz(RIFF[idx % RIFF.length]);
    const ph = 2 * Math.PI * hz * (gf / sr);
    const env = Math.exp(-localT * 5);                       // plucked decay
    const s = env * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph)) * 0.18;
    m[inPtr + i] = s; m[inPtr + STRIDE + i] = s;
  }
}

// ---- render ----------------------------------------------------------
function render(spec, overrideIdx = -1, overrideVal = 0, music = false) {
  ex.init(sr, STRIDE, 2);
  setParams(spec, overrideIdx, overrideVal);
  const out = new Float32Array(totalFrames * 2);
  let noteScheduled = false;
  let lastIdx = -1, heldId = -1;
  for (let pos = 0; pos < totalFrames; pos += block) {
    const n = Math.min(block, totalFrames - pos);
    if (isSynth) {
      if (music) {
        // play the arpeggio as a melody so the preview is musical
        const idx = Math.floor(pos / noteLenF);
        if (idx !== lastIdx) {
          if (heldId >= 0) ex.noteOff(heldId);
          heldId = 1 + (idx % 1000);
          ex.noteOn(heldId, midiHz(RIFF[idx % RIFF.length]), 0.9);
          lastIdx = idx;
        }
      } else {
        // hold a note for the first 70% then release, to exercise env + tail
        if (!noteScheduled) { ex.noteOn(60, 220, 0.9); noteScheduled = true; }
        if (pos <= totalFrames * 0.7 && pos + block > totalFrames * 0.7) ex.noteOff(60);
      }
      clearInput(n);
    } else {
      if (music) fillMusical(pos, n); else fillInput(pos, n);
    }
    ex.process(n);
    const m = f32();
    for (let i = 0; i < n; i++) {
      out[(pos + i) * 2] = m[outPtr + i];
      out[(pos + i) * 2 + 1] = m[outPtr + STRIDE + i];
    }
  }
  return out;
}

// ---- metrics ---------------------------------------------------------
function metrics(buf) {
  let sumSq = 0, peak = 0, dc = 0, nan = 0, n = buf.length;
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    sumSq += v * v; dc += v;
    const a = Math.abs(v); if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sumSq / n), peak, dc: dc / n, nan };
}
function rmsDiff(a, b) {
  let s = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / n);
}

// ---- WAV writer (16-bit PCM stereo) ---------------------------------
function writeWav(path, interleaved, rate) {
  const n = interleaved.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, interleaved[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

// ---- run -------------------------------------------------------------
const base = render(paramSpec);
const bm = metrics(base);

// sweep params: compare output at min vs max to confirm each knob is wired
const sweepList = paramSpec.length ? paramSpec : Array.from({ length: numParams }, (_, i) => ({ name: "p" + i, index: i, min: 0, max: 1, default: 0 }));
const sweepReport = [];
for (const p of sweepList) {
  const lo = render(paramSpec, p.index, p.min ?? 0);
  const hi = render(paramSpec, p.index, p.max ?? 1);
  const d = rmsDiff(lo, hi);
  const ref = Math.max(metrics(lo).rms, metrics(hi).rms, 1e-9);
  sweepReport.push({ name: p.name, index: p.index, rel: d / ref, affects: d / ref > 0.005 });
}

// preview WAV uses a clean musical render (no analysis noise → no "static")
if (wavPath) writeWav(wavPath, render(paramSpec, -1, 0, true), sr);

// ---- verdict ---------------------------------------------------------
const present = bm.rms > 1e-5;
const finite = bm.nan === 0;
const noClip = bm.peak <= 1.5; // allow headroom; >1.5 is a red flag
const anyParamWorks = sweepReport.length === 0 || sweepReport.some((s) => s.affects);
const pass = present && finite && noClip && anyParamWorks;

const fmt = (x) => (typeof x === "number" ? x.toFixed(5) : x);
console.log("─".repeat(60));
console.log(`module:   ${wasmPath.split("/").pop()}   (${isSynth ? "SYNTH" : "EFFECT"}, ${numParams} params)`);
console.log(`render:   ${seconds}s @ ${sr}Hz, block ${block}`);
console.log(`output:   rms=${fmt(bm.rms)}  peak=${fmt(bm.peak)}  dc=${fmt(bm.dc)}  nan=${bm.nan}`);
console.log(`checks:   present=${present}  finite=${finite}  noClip=${noClip}  paramsReactive=${anyParamWorks}`);
console.log("params:");
for (const s of sweepReport) {
  console.log(`  [${s.index}] ${String(s.name).padEnd(16)} ${s.affects ? "✓ affects" : "·  inert "}  (rel Δ ${fmt(s.rel)})`);
}
if (wavPath) console.log(`wav:      ${wavPath}`);
console.log("─".repeat(60));
console.log(pass ? "VERDICT: PASS ✅" : "VERDICT: FAIL ❌");
process.exit(pass ? 0 : 1);
