// =====================================================================
//  behavior-test.mjs — Acid Bass (Roland TB-303 model) behavior suite
//
//  Usage: node factory/plugins/acid-bass/behavior-test.mjs [plugin.wasm]
//
//  Measurable assertions (rms windows, high-band energy, zero-crossing
//  rate) for the TB-303-specific behaviours:
//    1. WAVEFORM saw vs square produce a different tone
//    2. CUTOFF FREQ sweep: open filter is brighter than closed
//    3. RESONANCE emphasises the cutoff band (louder / peakier)
//    4. ENV MOD opens the filter on the note attack
//    5. DECAY sets the note length (long decay rings longer)
//    6. ACCENT: accented note is louder AND brighter than a plain note
//    7. SLIDE glides pitch between overlapping (tied) notes
//    8. SEQUENCER plays back the recorded stepped pitches
//    9. REST steps produce silence
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/acid-bass.wasm";
const SR = 48000, STRIDE = 8192, BLOCK = 256;
const bytes = readFileSync(wasmPath);
const mod = new WebAssembly.Module(bytes);
const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8")).params;
const P = {}; for (const p of spec) P[p.name] = p.index;

function makeInstance() {
  const inst = new WebAssembly.Instance(mod, { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
  inst.exports.init(SR, STRIDE, 2);
  return inst.exports;
}
function f32(ex) { return new Float32Array(ex.memory.buffer); }
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// events: {t, p:idx,v} set param | {t, on:id, hz, vel} | {t, off:id}
function render(overrides, events, seconds) {
  const ex = makeInstance();
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  let m = f32(ex);
  for (let i = 0; i < 64; i++) m[parPtr + i] = 0;
  for (const p of spec) m[parPtr + p.index] = p.default;
  for (const k in overrides) m[parPtr + +k] = overrides[k];
  const total = Math.round(SR * seconds);
  const L = new Float32Array(total), R = new Float32Array(total);
  const evs = [...events].sort((a, b) => a.t - b.t);
  let ei = 0;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    while (ei < evs.length && evs[ei].t * SR <= pos) {
      const e = evs[ei++];
      m = f32(ex);
      if (e.p !== undefined) m[parPtr + e.p] = e.v;
      else if (e.on !== undefined) ex.noteOn(e.on, e.hz, e.vel ?? 0.9);
      else if (e.off !== undefined) ex.noteOff(e.off);
    }
    ex.process(n);
    m = f32(ex);
    for (let i = 0; i < n; i++) { L[pos + i] = m[outPtr + i]; R[pos + i] = m[outPtr + STRIDE + i]; }
  }
  return { L, R };
}
function rms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let s = 0; for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
function highRms(buf, t0, t1) { // one-pole high-pass ~1 kHz then rms → "brightness"
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let px = 0, py = 0, s = 0; const k = 1 / (1 + 2 * Math.PI * 1200 / SR);
  for (let i = a; i < b; i++) { const y = k * (py + buf[i] - px); px = buf[i]; py = y; s += y * y; }
  return Math.sqrt(s / Math.max(1, b - a));
}
function zcr(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / Math.max(1e-6, (b - a) / SR);
}
function peak(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let p = 0; for (let i = a; i < b; i++) { const x = Math.abs(buf[i]); if (x > p) p = x; }
  return p;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}
// A single held live note (transport OFF so live notes sound)
const OFF = { [P["Transport"]]: 0 };
function heldNote(over, hz, seconds, vel) {
  return render({ ...OFF, ...over }, [{ t: 0.01, on: 1, hz, vel: vel ?? 0.6 }], seconds);
}

// 1. WAVEFORM saw vs square differ (p.34)
{
  const base = { [P["Env Mod"]]: 0, [P["Cutoff"]]: 0.85, [P["Resonance"]]: 0.1, [P["Decay"]]: 0.9 };
  const saw = heldNote({ ...base, [P["Waveform"]]: 0 }, 110, 1).L;
  const sqr = heldNote({ ...base, [P["Waveform"]]: 1 }, 110, 1).L;
  let d = 0; for (let i = 0; i < saw.length; i++) { const x = saw[i] - sqr[i]; d += x * x; }
  d = Math.sqrt(d / saw.length);
  check("WAVEFORM saw vs square give a different tone", d > 0.02, `rmsDiff ${d.toFixed(4)}`);
}

// 2. CUTOFF FREQ: open filter brighter than closed (p.34)
{
  const base = { [P["Env Mod"]]: 0, [P["Resonance"]]: 0.1, [P["Decay"]]: 0.95, [P["Waveform"]]: 0 };
  const closed = highRms(heldNote({ ...base, [P["Cutoff"]]: 0.15 }, 110, 1).L, 0.05, 0.9);
  const open = highRms(heldNote({ ...base, [P["Cutoff"]]: 0.9 }, 110, 1).L, 0.05, 0.9);
  check("CUTOFF open is brighter than closed", open > closed * 2, `high rms ${closed.toFixed(4)} → ${open.toFixed(4)}`);
}

// 3. RESONANCE emphasises the cutoff band (p.34)
{
  const base = { [P["Env Mod"]]: 0, [P["Cutoff"]]: 0.45, [P["Decay"]]: 0.95, [P["Waveform"]]: 0 };
  const lo = peak(heldNote({ ...base, [P["Resonance"]]: 0.05 }, 110, 1).L, 0.1, 0.9);
  const hi = peak(heldNote({ ...base, [P["Resonance"]]: 0.92 }, 110, 1).L, 0.1, 0.9);
  check("RESONANCE emphasises the cutoff band (peakier)", hi > lo * 1.3, `peak ${lo.toFixed(4)} → ${hi.toFixed(4)}`);
}

// 4. ENV MOD opens the filter on the attack (p.34)
{
  const base = { [P["Cutoff"]]: 0.2, [P["Resonance"]]: 0.3, [P["Decay"]]: 0.6, [P["Waveform"]]: 0 };
  const none = highRms(heldNote({ ...base, [P["Env Mod"]]: 0 }, 110, 1).L, 0.005, 0.06);
  const full = highRms(heldNote({ ...base, [P["Env Mod"]]: 0.95 }, 110, 1).L, 0.005, 0.06);
  check("ENV MOD brightens the note attack", full > none * 1.8, `attack high rms ${none.toFixed(4)} → ${full.toFixed(4)}`);
}

// 5. DECAY sets the note length (p.34)
{
  const base = { [P["Env Mod"]]: 0.3, [P["Cutoff"]]: 0.5, [P["Resonance"]]: 0.3, [P["Waveform"]]: 0 };
  const short = rms(heldNote({ ...base, [P["Decay"]]: 0.1 }, 110, 1.2).L, 0.5, 1.1);
  const long = rms(heldNote({ ...base, [P["Decay"]]: 0.85 }, 110, 1.2).L, 0.5, 1.1);
  check("DECAY: long decay rings longer than short", long > short * 3, `late rms ${short.toFixed(5)} → ${long.toFixed(5)}`);
}

// 6. ACCENT: accented note louder AND brighter (p.34)
{
  const base = { [P["Cutoff"]]: 0.3, [P["Resonance"]]: 0.5, [P["Env Mod"]]: 0.5,
                 [P["Decay"]]: 0.5, [P["Accent"]]: 0.9, [P["Waveform"]]: 0 };
  const plain = heldNote({ ...base }, 110, 1, 0.5).L;       // vel < 0.85 → no accent
  const acc = heldNote({ ...base }, 110, 1, 1.0).L;          // vel >= 0.85 → accent
  const lp = rms(plain, 0.0, 0.2), la = rms(acc, 0.0, 0.2);
  const bp = highRms(plain, 0.0, 0.2), ba = highRms(acc, 0.0, 0.2);
  check("ACCENT boosts the level", la > lp * 1.15, `rms ${lp.toFixed(4)} → ${la.toFixed(4)}`);
  check("ACCENT adds an extra filter sweep (brighter)", ba > bp * 1.3, `high rms ${bp.toFixed(4)} → ${ba.toFixed(4)}`);
}

// 7. SLIDE glides pitch between overlapping (tied) notes (p.39)
{
  const base = { [P["Env Mod"]]: 0, [P["Cutoff"]]: 0.9, [P["Resonance"]]: 0.1,
                 [P["Decay"]]: 0.95, [P["Waveform"]]: 1, [P["Slide"]]: 0.7 };
  // note1 held (110), note2 pressed while note1 still down → legato slide to 440
  const evs = [{ t: 0.02, on: 1, hz: 110, vel: 0.5 }, { t: 0.5, on: 2, hz: 440, vel: 0.5 }];
  const slid = render({ ...OFF, ...base }, evs, 1.4).L;
  const justAfter = zcr(slid, 0.53, 0.6), settled = zcr(slid, 1.1, 1.35);
  check("SLIDE glides upward toward the new pitch", justAfter < settled * 0.7, `zcr ${justAfter.toFixed(0)} → ${settled.toFixed(0)} Hz`);
  check("SLIDE settles on the new pitch (~880 zc/s @440Hz)", Math.abs(settled - 880) < 160, `settled ${settled.toFixed(0)} zc/s`);
}

// Helper: write a step pattern via the panel's pattern-write channel, then play it.
// steps: [{hz|null, acc, slide}].  This mirrors the real WebView bridge exactly: the
// GUI can only pass a MIDI note number (which the host turns into `hz`) plus a float
// velocity, so pitch travels via the note number and step index + accent/slide/rest
// flags are packed into a sentinel velocity (64 + idx*8 + flags). Steps not supplied
// are written as rests, so all 16 slots are well-defined (as the panel always does).
function playPattern(over, steps, seconds) {
  const evs = [{ t: 0.0, p: P["Transport"], v: 0 }]; // stop while writing
  for (let i = 0; i < 16; i++) {
    const s = steps[i];
    if (!s || s.hz == null) {
      evs.push({ t: 0.02, on: 60, hz: midiHz(60), vel: 64 + i * 8 + 4 }); // rest (bit2)
    } else {
      const midi = Math.round(69 + 12 * Math.log2(s.hz / 440)); // bridge: note# → hz
      const flags = (s.acc ? 1 : 0) | (s.slide ? 2 : 0);
      evs.push({ t: 0.02, on: midi, hz: midiHz(midi), vel: 64 + i * 8 + flags });
    }
  }
  evs.push({ t: 0.1, p: P["Transport"], v: 1 }); // PLAY from the top
  return render({ ...over }, evs, seconds);
}

// 8. SEQUENCER plays back the recorded stepped pitches (spec p.89)
{
  const over = { [P["Tempo"]]: 120, [P["Env Mod"]]: 0.1, [P["Cutoff"]]: 0.9,
                 [P["Resonance"]]: 0.1, [P["Decay"]]: 0.9, [P["Waveform"]]: 1 };
  const two = playPattern(over, [{ hz: 110 }, { hz: 220 }], 3).L;
  // PLAY starts at t=0.1; 16th @120bpm = 125ms; step0 110Hz then step1 220Hz
  const s0 = zcr(two, 0.11, 0.21), s1 = zcr(two, 0.235, 0.34);
  check("SEQUENCER plays back the recorded stepped pitches", s1 > s0 * 1.6, `step0 ${s0.toFixed(0)} vs step1 ${s1.toFixed(0)} zc/s`);
}

// 9. REST steps produce silence (p.5 / p.39)
{
  const over = { [P["Tempo"]]: 100, [P["Env Mod"]]: 0.3, [P["Cutoff"]]: 0.6,
                 [P["Resonance"]]: 0.3, [P["Decay"]]: 0.25, [P["Waveform"]]: 0 };
  // PLAY starts at t=0.1; 16th @100bpm = 150ms; step0 note (0.1-0.25), step1 rest (0.25-0.40)
  const out = playPattern(over, [{ hz: 110 }, { hz: null }], 3).L;
  const noteE = rms(out, 0.11, 0.18), restE = rms(out, 0.33, 0.39);
  check("REST step is (near) silent vs the note step", restE < noteE * 0.25, `note rms ${noteE.toFixed(4)} vs rest rms ${restE.toFixed(4)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
