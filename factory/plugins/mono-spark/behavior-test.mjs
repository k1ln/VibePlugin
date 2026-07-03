// =====================================================================
//  behavior-test.mjs — Mono Spark (Roland SH-101 model) behavior suite
//
//  Usage: node factory/plugins/mono-spark/behavior-test.mjs [plugin.wasm]
//
//  Measurable assertions (rms windows, high-band energy, zero-crossing
//  rate) for the SH-101-specific behaviours:
//    1. SOURCE MIXER: saw / pulse / sub each give a different tone
//    2. SUB OSC type switch: 2-oct-down is an octave below 1-oct-down
//    3. PWM: MANUAL vs LFO pulse-width give a different (moving) tone
//    4. VCF CUTOFF: open filter is brighter than closed
//    5. VCF RESONANCE emphasises the cutoff band (peakier)
//    6. VCF ENV depth opens the filter on the attack
//    7. ENV DECAY sets the note length (long decay rings longer)
//    8. VCA ENV vs GATE: GATE sustains, ENV (sustain 0) decays away
//    9. PORTAMENTO glides pitch between legato notes
//   10. ARPEGGIO up vs down start on opposite ends of the chord
//   11. SEQUENCER plays back the recorded stepped pitches
//   12. REST steps produce silence
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/mono-spark.wasm";
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
  const L = new Float32Array(total);
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
    for (let i = 0; i < n; i++) L[pos + i] = m[outPtr + i];
  }
  return L;
}
function rms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let s = 0; for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
function highRms(buf, t0, t1) { // ~1.2 kHz high-pass then rms → "brightness"
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
const OFF = { [P["Transport"]]: 0 };            // transport off → live notes sound
function heldNote(over, hz, seconds, vel) {
  return render({ ...OFF, ...over }, [{ t: 0.01, on: 1, hz, vel: vel ?? 0.9 }], seconds);
}

// 1. SOURCE MIXER — saw / pulse / sub differ (p.26)
{
  const base = { [P["VCF Freq"]]: 0.95, [P["VCF Res"]]: 0.05, [P["VCF Env"]]: 0,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0, [P["Mix Saw"]]: 0,
                 [P["Mix Pulse"]]: 0, [P["Mix Sub"]]: 0, [P["Mix Noise"]]: 0 };
  const saw = heldNote({ ...base, [P["Mix Saw"]]: 1 }, 220, 0.5);
  const pul = heldNote({ ...base, [P["Mix Pulse"]]: 1, [P["PW"]]: 0.6 }, 220, 0.5);
  const sub = heldNote({ ...base, [P["Mix Sub"]]: 1 }, 220, 0.5);
  const d1 = rms(saw.map((v, i) => v - pul[i]), 0.1, 0.45);
  const d2 = rms(saw.map((v, i) => v - sub[i]), 0.1, 0.45);
  check("MIXER saw vs pulse give a different tone", d1 > 0.02, `rmsDiff ${d1.toFixed(4)}`);
  check("MIXER saw vs sub give a different tone", d2 > 0.02, `rmsDiff ${d2.toFixed(4)}`);
}

// 2. SUB OSC type: 2-oct-down is an octave below 1-oct-down (p.26)
{
  const base = { [P["VCF Freq"]]: 0.95, [P["VCF Res"]]: 0.05, [P["VCF Env"]]: 0,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0, [P["Mix Saw"]]: 0,
                 [P["Mix Pulse"]]: 0, [P["Mix Sub"]]: 1, [P["Mix Noise"]]: 0, [P["VCF Kybd"]]: 0 };
  const one = zcr(heldNote({ ...base, [P["Sub Type"]]: 0 }, 220, 0.5), 0.1, 0.45); // 1 oct down = 110 Hz
  const two = zcr(heldNote({ ...base, [P["Sub Type"]]: 1 }, 220, 0.5), 0.1, 0.45); // 2 oct down = 55 Hz
  check("SUB type 2-oct-down is ~an octave below 1-oct-down", two < one * 0.65, `zcr ${one.toFixed(0)} → ${two.toFixed(0)}`);
}

// 3. PWM MANUAL vs LFO give a different (moving) tone (p.25)
{
  const base = { [P["VCF Freq"]]: 0.95, [P["VCF Res"]]: 0.05, [P["VCF Env"]]: 0,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0, [P["Mix Saw"]]: 0,
                 [P["Mix Pulse"]]: 1, [P["Mix Sub"]]: 0, [P["PW"]]: 0.6, [P["LFO Rate"]]: 0.5 };
  const man = heldNote({ ...base, [P["PWM Mode"]]: 0 }, 220, 0.6);
  const lfo = heldNote({ ...base, [P["PWM Mode"]]: 1 }, 220, 0.6);
  const d = rms(man.map((v, i) => v - lfo[i]), 0.1, 0.55);
  check("PWM manual vs LFO differ", d > 0.02, `rmsDiff ${d.toFixed(4)}`);
}

// 4. VCF CUTOFF: open brighter than closed (p.26)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Env"]]: 0, [P["VCF Res"]]: 0.05,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0 };
  const closed = highRms(heldNote({ ...base, [P["VCF Freq"]]: 0.15 }, 110, 0.6), 0.05, 0.55);
  const open = highRms(heldNote({ ...base, [P["VCF Freq"]]: 0.9 }, 110, 0.6), 0.05, 0.55);
  check("CUTOFF open is brighter than closed", open > closed * 2, `high rms ${closed.toFixed(4)} → ${open.toFixed(4)}`);
}

// 5. VCF RESONANCE emphasises the cutoff band (p.27)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Env"]]: 0, [P["VCF Freq"]]: 0.4,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0 };
  const lo = peak(heldNote({ ...base, [P["VCF Res"]]: 0.05 }, 110, 0.6), 0.1, 0.55);
  const hi = peak(heldNote({ ...base, [P["VCF Res"]]: 0.9 }, 110, 0.6), 0.1, 0.55);
  check("RESONANCE emphasises the cutoff band (peakier)", hi > lo * 1.3, `peak ${lo.toFixed(4)} → ${hi.toFixed(4)}`);
}

// 6. VCF ENV depth opens the filter on the attack (p.26)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.2, [P["VCF Res"]]: 0.2,
                 [P["Env Attack"]]: 0.0, [P["Env Decay"]]: 0.5, [P["Env Sustain"]]: 0.2 };
  const none = highRms(heldNote({ ...base, [P["VCF Env"]]: 0 }, 110, 0.6), 0.005, 0.06);
  const full = highRms(heldNote({ ...base, [P["VCF Env"]]: 0.95 }, 110, 0.6), 0.005, 0.06);
  check("VCF ENV brightens the note attack", full > none * 1.8, `attack high rms ${none.toFixed(4)} → ${full.toFixed(4)}`);
}

// 7. ENV DECAY sets note length (p.28)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.6, [P["VCF Env"]]: 0.3,
                 [P["VCF Res"]]: 0.2, [P["Env Attack"]]: 0.0, [P["Env Sustain"]]: 0.0 };
  const short = rms(heldNote({ ...base, [P["Env Decay"]]: 0.15 }, 110, 1.4), 0.5, 1.3);
  const long = rms(heldNote({ ...base, [P["Env Decay"]]: 0.75 }, 110, 1.4), 0.5, 1.3);
  check("ENV DECAY: long decay rings longer", long > short * 3, `late rms ${short.toFixed(5)} → ${long.toFixed(5)}`);
}

// 8. VCA ENV vs GATE: GATE sustains, ENV (sustain 0) decays away (p.27)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.7, [P["VCF Env"]]: 0,
                 [P["VCF Res"]]: 0.1, [P["Env Attack"]]: 0.0, [P["Env Decay"]]: 0.35, [P["Env Sustain"]]: 0.0 };
  const envM = rms(heldNote({ ...base, [P["VCA Source"]]: 0 }, 110, 0.8), 0.4, 0.6);
  const gateM = rms(heldNote({ ...base, [P["VCA Source"]]: 1 }, 110, 0.8), 0.4, 0.6);
  check("VCA GATE sustains where ENV (S=0) has decayed", gateM > envM * 3, `late rms env ${envM.toFixed(4)} vs gate ${gateM.toFixed(4)}`);
}

// 9. PORTAMENTO glides pitch between legato notes (p.31)
{
  const base = { [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.95, [P["VCF Env"]]: 0,
                 [P["VCF Res"]]: 0.05, [P["VCF Kybd"]]: 0, [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0,
                 [P["Porta Mode"]]: 1, [P["Porta Time"]]: 0.2 };
  // hold note1 (110), then press note2 (440) while note1 down → legato glide up
  const evs = [{ t: 0.02, on: 1, hz: 110 }, { t: 0.4, on: 2, hz: 440 }];
  const buf = render({ ...OFF, ...base }, evs, 3.0);
  const justAfter = zcr(buf, 0.43, 0.5), settled = zcr(buf, 2.6, 2.9);
  check("PORTAMENTO glides upward toward the new pitch", justAfter < settled * 0.7, `zcr ${justAfter.toFixed(0)} → ${settled.toFixed(0)}`);
  check("PORTAMENTO settles on the new pitch (~880 zc/s @440Hz saw)", Math.abs(settled - 880) < 220, `settled ${settled.toFixed(0)} zc/s`);
}

// helper: clear the default pattern, hold a chord, then engage the arp
function clearArp(over, arpMode, chordHz, seconds) {
  const evs = [{ t: 0.0, p: P["Transport"], v: 4 }, { t: 0.002, on: -4, hz: 0 }, // RECORD + clear
               { t: 0.004, p: P["Transport"], v: 0 }, { t: 0.005, p: P["Arp Mode"], v: arpMode }];
  let id = 1;
  for (const hz of chordHz) evs.push({ t: 0.02, on: id++, hz });
  evs.push({ t: 0.05, p: P["Transport"], v: 1 }); // ARP on → first step fires here
  return render(over, evs, seconds);
}

// 10. ARPEGGIO up vs down start on opposite ends of the chord (p.32)
{
  const over = { ...OFF, [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.95, [P["VCF Env"]]: 0,
                 [P["VCF Res"]]: 0.05, [P["VCF Kybd"]]: 0, [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0,
                 [P["Tempo"]]: 120, [P["Porta Mode"]]: 0 };
  const up = clearArp({ ...over }, 0, [220, 880], 1.0);
  const dn = clearArp({ ...over }, 2, [220, 880], 1.0);
  const upFirst = zcr(up, 0.06, 0.14), dnFirst = zcr(dn, 0.06, 0.14);
  check("ARP up starts low, down starts high", dnFirst > upFirst * 1.6, `first-step zcr up ${upFirst.toFixed(0)} vs down ${dnFirst.toFixed(0)}`);
}

// helper: record steps then play. steps: [{hz|null, tie}]
function playPattern(over, steps, seconds) {
  const evs = [{ t: 0.0, p: P["Transport"], v: 4 }, { t: 0.002, on: -4, hz: 0 }];
  let t = 0.01;
  for (const s of steps) {
    if (s.hz == null) evs.push({ t, on: -2, hz: 0 });
    else evs.push({ t, on: s.tie ? 1 : 0, hz: s.hz });
    t += 0.004;
  }
  evs.push({ t: t + 0.005, p: P["Transport"], v: 2 }); // PLAY
  return render(over, evs, seconds);
}

// 11. SEQUENCER plays back the recorded stepped pitches (p.33)
{
  const over = { ...OFF, [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.95, [P["VCF Env"]]: 0,
                 [P["VCF Res"]]: 0.05, [P["VCF Kybd"]]: 0, [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.0,
                 [P["Tempo"]]: 120, [P["Env Decay"]]: 0.5 };
  const buf = playPattern(over, [{ hz: 110 }, { hz: 440 }], 2.0);
  // PLAY from ~t=0.03; 16th @120bpm = 125 ms; step0 110Hz then step1 440Hz
  const s0 = zcr(buf, 0.05, 0.14), s1 = zcr(buf, 0.17, 0.26);
  check("SEQUENCER plays back the stepped pitches", s1 > s0 * 1.6, `step0 ${s0.toFixed(0)} vs step1 ${s1.toFixed(0)} zc/s`);
}

// 12. REST steps produce silence (p.34)
{
  const over = { ...OFF, [P["Mix Saw"]]: 1, [P["Mix Sub"]]: 0, [P["VCF Freq"]]: 0.8, [P["VCF Env"]]: 0.1,
                 [P["VCF Res"]]: 0.1, [P["Tempo"]]: 100, [P["Env Attack"]]: 0.0, [P["Env Decay"]]: 0.35,
                 [P["Env Sustain"]]: 0.5, [P["Env Release"]]: 0.08 };
  const buf = playPattern(over, [{ hz: 110 }, { hz: null }], 2.0);
  // PLAY ~t=0.03; 16th @100bpm = 150 ms; step0 note (0.03-0.18), step1 rest (0.18-0.33), wraps ~0.33
  const noteE = rms(buf, 0.05, 0.15), restE = rms(buf, 0.24, 0.31);
  check("REST step is (near) silent vs the note step", restE < noteE * 0.25, `note rms ${noteE.toFixed(4)} vs rest rms ${restE.toFixed(4)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
