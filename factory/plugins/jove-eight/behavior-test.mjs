// =====================================================================
//  behavior-test.mjs — Jove Eight (Roland Jupiter-8 model) behavior suite
//
//  Usage: node factory/plugins/jove-eight/behavior-test.mjs <plugin.wasm>
//
//  Measurable assertions for the Jupiter-specific behaviours:
//    1. VCF SLOPE: -12 dB/oct passes more highs than -24 dB/oct (brighter)
//    2. CROSS MOD: VCO-2 FM'ing VCO-1 adds inharmonic high-frequency energy
//    3. SYNC: hard-syncing VCO-2 to VCO-1 enriches the harmonic content
//    4. ARPEGGIATOR: UP starts low & rises, DOWN starts high & falls, RANDOM
//       still moves; all produce note motion over time
//    5. UNISON: the 8-voice detuned stack beats (amplitude wobble) vs POLY-1
//    6. ENV-1 POLARITY: normal opens the VCF on attack, inverse closes it
//    7. LFO DELAY: modulation fades in (weaker early, stronger late)
//    8. PORTAMENTO: pitch slews from the previous note over the glide time
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/jove-eight.wasm";
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

function render(overrides, events, seconds) {
  const ex = makeInstance();
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  const m0 = f32(ex);
  for (let i = 0; i < 64; i++) m0[parPtr + i] = 0;
  for (const p of spec) m0[parPtr + p.index] = p.default;
  for (const k in overrides) m0[parPtr + +k] = overrides[k];
  const total = Math.round(SR * seconds);
  const L = new Float32Array(total);
  const evs = [...events].sort((a, b) => a.t - b.t);
  let ei = 0;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    while (ei < evs.length && evs[ei].t * SR <= pos) {
      const e = evs[ei++];
      if (e.on) ex.noteOn(e.id, e.hz, e.vel ?? 0.9); else ex.noteOff(e.id);
    }
    ex.process(n);
    const m = f32(ex);
    for (let i = 0; i < n; i++) L[pos + i] = m[outPtr + i];
  }
  return L;
}
function rms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let s = 0; for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
function zcr(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / Math.max(1e-6, (b - a) / SR);
}
// high-frequency energy: one-pole high-pass (~3 kHz) then rms — a brightness proxy
function highRms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let hpX = 0, hpY = 0, s = 0; const k = 1 / (1 + 2 * Math.PI * 3000 / SR);
  for (let i = a; i < b; i++) { const y = k * (hpY + buf[i] - hpX); hpX = buf[i]; hpY = y; s += y * y; }
  return Math.sqrt(s / Math.max(1, b - a));
}
// normalized autocorrelation at a given lag — how strongly the wave repeats
// with that period (1 = perfectly periodic, ~0 = unrelated)
function autocorr(buf, t0, t1, lag) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length) - lag;
  let num = 0, den = 0;
  for (let i = a; i < b; i++) { num += buf[i] * buf[i + lag]; den += buf[i] * buf[i]; }
  return num / Math.max(1e-9, den);
}
function rmsWobble(buf, t0, t1) {
  const w = []; for (let t = t0; t < t1; t += 0.04) w.push(rms(buf, t, t + 0.04));
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  let v = 0; for (const x of w) v += (x - mean) ** 2;
  return Math.sqrt(v / w.length) / Math.max(1e-6, mean);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}
const NOTE = [{ t: 0.02, on: 1, id: 1, hz: 220 }];
// a clean single-VCO saw patch, filter parked so highs are audible
const CLEAN = {
  [P["VCO1 Wave"]]: 1, [P["Source Mix"]]: 0, [P["VCO1 Cross"]]: 0,
  [P["VCF Cutoff"]]: 0.6, [P["VCF Env"]]: 0, [P["VCF LFO"]]: 0, [P["VCF Kybd"]]: 0,
  [P["Env2 Attack"]]: 0.01, [P["Env2 Sustain"]]: 1, [P["Env1 Sustain"]]: 1,
  [P["Perf Switch"]]: 0, [P["VCA LFO"]]: 0, [P["Mod LFO"]]: 0, [P["Mod Env"]]: 0,
  [P["VCO Switch"]]: 16,
};

// 1. VCF SLOPE (p.19): -12 dB/oct is brighter than -24 dB/oct
{
  const base = { ...CLEAN, [P["VCF Cutoff"]]: 0.45, [P["VCF Reso"]]: 0.1 };
  const s24 = highRms(render({ ...base, [P["Filt Switch"]]: 0 }, NOTE, 1.5), 0.3, 1.2); // bit0=0 → -24
  const s12 = highRms(render({ ...base, [P["Filt Switch"]]: 1 }, NOTE, 1.5), 0.3, 1.2); // bit0=1 → -12
  check("SLOPE -12 dB/oct passes more highs than -24 dB/oct",
        s12 > s24 * 1.3, `-24 hi ${s24.toFixed(4)} vs -12 hi ${s12.toFixed(4)}`);
}

// 2. CROSS MOD (p.15): VCO-2 FM'ing VCO-1 breaks its periodicity (inharmonic)
{
  const lag = Math.round(SR / 220); // one VCO-1 fundamental period (220 Hz note)
  const base = { ...CLEAN, [P["VCO1 Wave"]]: 0 /*triangle*/, [P["Source Mix"]]: 0,
                 [P["VCO2 Range"]]: 2, [P["VCF Cutoff"]]: 0.95 };
  const off = autocorr(render({ ...base, [P["VCO1 Cross"]]: 0 }, NOTE, 1.2), 0.3, 1.0, lag);
  const on = autocorr(render({ ...base, [P["VCO1 Cross"]]: 0.7 }, NOTE, 1.2), 0.3, 1.0, lag);
  check("CROSS MOD makes VCO-1 inharmonic (kills fundamental periodicity)",
        off > 0.8 && on < off * 0.6, `periodicity off ${off.toFixed(3)} → on ${on.toFixed(3)}`);
}

// 3. SYNC (p.16): the slave is forced to repeat at VCO-1's master period
{
  const lag = Math.round(SR / 220); // master (VCO-1 at 8', 220 Hz) period
  const base = { ...CLEAN, [P["Source Mix"]]: 1 /*hear VCO-2*/, [P["VCO2 Wave"]]: 1,
                 [P["VCO1 Range"]]: 1, [P["VCO2 Range"]]: 3 /*two octaves up*/,
                 [P["VCO2 Fine"]]: 1.0, [P["VCF Cutoff"]]: 0.95 };
  const free = autocorr(render({ ...base, [P["VCO Switch"]]: 16 }, NOTE, 1.2), 0.3, 1.0, lag);
  const sync = autocorr(render({ ...base, [P["VCO Switch"]]: 20 }, NOTE, 1.2), 0.3, 1.0, lag);
  check("SYNC forces the slave to repeat at the master period",
        sync > 0.9 && sync > free + 0.1, `master-period corr free ${free.toFixed(3)} → sync ${sync.toFixed(3)}`);
}

// 4. ARPEGGIATOR (p.12-13): up rises, down falls, random moves
{
  const base = { ...CLEAN, [P["Transport"]]: 1, [P["Arp Rate"]]: 0.55, [P["Arp Range"]]: 0,
                 [P["Assign"]]: 0, [P["VCF Cutoff"]]: 0.8 };
  const chord = [{ t: 0.02, on: 1, id: 1, hz: 130.81 }, { t: 0.02, on: 1, id: 2, hz: 196.0 },
                 { t: 0.02, on: 1, id: 3, hz: 261.63 }]; // C3 G3 C4
  const up = render({ ...base, [P["Arp Mode"]]: 0 }, chord, 2.0);
  const dn = render({ ...base, [P["Arp Mode"]]: 1 }, chord, 2.0);
  const rnd = render({ ...base, [P["Arp Mode"]]: 3 }, chord, 2.0);
  // first arp step pitch (early) — UP should be lowest note, DOWN the highest
  const upEarly = zcr(up, 0.05, 0.16) / 2, dnEarly = zcr(dn, 0.05, 0.16) / 2;
  check("ARP UP starts lower than ARP DOWN", upEarly < dnEarly * 0.8,
        `up ${upEarly.toFixed(0)} Hz vs down ${dnEarly.toFixed(0)} Hz`);
  // note motion: pitch varies across steps
  function pitchSpread(b) {
    const w = []; for (let t = 0.1; t < 1.9; t += 0.12) w.push(zcr(b, t, t + 0.08) / 2);
    const mean = w.reduce((a, c) => a + c, 0) / w.length;
    let v = 0; for (const x of w) v += (x - mean) ** 2; return Math.sqrt(v / w.length);
  }
  check("ARP produces stepping note motion (UP)", pitchSpread(up) > 20, `spread ${pitchSpread(up).toFixed(0)} Hz`);
  check("ARP RANDOM still moves between notes", pitchSpread(rnd) > 20, `spread ${pitchSpread(rnd).toFixed(0)} Hz`);
}

// 5. UNISON (p.12): the detuned 8-voice stack beats vs POLY-1 single voice
{
  const base = { ...CLEAN, [P["VCF Cutoff"]]: 0.7, [P["Env2 Attack"]]: 0.01 };
  const poly = rmsWobble(render({ ...base, [P["Assign"]]: 0 }, NOTE, 2.0), 0.5, 1.8);
  const uni = rmsWobble(render({ ...base, [P["Assign"]]: 3 }, NOTE, 2.0), 0.5, 1.8);
  check("UNISON detune beats more than POLY-1 single voice",
        uni > poly * 1.5, `poly wobble ${poly.toFixed(3)} vs unison ${uni.toFixed(3)}`);
}

// 6. ENV-1 POLARITY (p.21): normal opens VCF on attack, inverse closes it
{
  const base = { ...CLEAN, [P["VCF Cutoff"]]: 0.3, [P["VCF Env"]]: 0.9,
                 [P["Filt Switch"]]: 0 /*envSel ENV1*/, [P["Env1 Attack"]]: 0.01,
                 [P["Env1 Decay"]]: 0.7, [P["Env1 Sustain"]]: 0.0, [P["VCF Cutoff"]]: 0.32 };
  const norm = zcr(render({ ...base, [P["Filt Switch"]]: 0 }, NOTE, 1.5), 0.04, 0.14);   // pol bit3=0
  const inv = zcr(render({ ...base, [P["Filt Switch"]]: 8 }, NOTE, 1.5), 0.04, 0.14);    // pol bit3=1
  check("ENV-1 normal polarity is brighter on attack than inverse",
        norm > inv * 1.3, `normal zcr ${norm.toFixed(0)} vs inverse zcr ${inv.toFixed(0)}`);
}

// 7. LFO DELAY (p.18): modulation fades in — weaker early, stronger late
{
  const base = { ...CLEAN, [P["VCF Cutoff"]]: 0.8, [P["Mod LFO"]]: 0.7, [P["LFO Rate"]]: 0.5,
                 [P["VCO Switch"]]: 17 /*freqDest=Both*/, [P["Env2 Sustain"]]: 1 };
  const buf = render({ ...base, [P["LFO Delay"]]: 0.8 }, NOTE, 3.0); // ~3.2 s fade
  function pw(b, t0, t1) {
    const w = []; for (let t = t0; t < t1; t += 0.05) w.push(zcr(b, t, t + 0.05));
    const mean = w.reduce((a, c) => a + c, 0) / w.length;
    let v = 0; for (const x of w) v += (x - mean) ** 2; return Math.sqrt(v / w.length);
  }
  const early = pw(buf, 0.1, 0.6), late = pw(buf, 2.4, 2.95);
  check("LFO DELAY ramps modulation in (weaker early, stronger late)",
        late > early * 1.8, `early wobble ${early.toFixed(1)} vs late ${late.toFixed(1)}`);
}

// 8. PORTAMENTO (p.14): pitch slews from the previous note over the glide time
{
  const base = { ...CLEAN, [P["Assign"]]: 1 /*Poly2 glides*/, [P["Perf Switch"]]: 32 /*porta on*/,
                 [P["Porta Time"]]: 0.6, [P["VCF Cutoff"]]: 1, [P["VCF Kybd"]]: 0 };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }, { t: 0.6, on: 0, id: 1 },
               { t: 0.62, on: 1, id: 2, hz: 440 }];
  const glide = render(base, evs, 2.5);
  const early = zcr(glide, 0.66, 0.78) / 2, late = zcr(glide, 1.9, 2.4) / 2;
  check("PORTAMENTO slews upward after the new note", early < late * 0.7,
        `early ${early.toFixed(0)} Hz → settled ${late.toFixed(0)} Hz`);
  check("PORTAMENTO settles on the new pitch (~440 Hz)", Math.abs(late - 440) < 45, `settled ${late.toFixed(0)} Hz`);
  const jump = render({ ...base, [P["Perf Switch"]]: 0 }, evs, 2.5);
  const j = zcr(jump, 0.66, 0.78) / 2;
  check("PORTAMENTO off → pitch jumps immediately", Math.abs(j - 440) < 55, `immediate ${j.toFixed(0)} Hz`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
