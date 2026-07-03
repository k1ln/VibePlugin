// =====================================================================
//  behavior-test.mjs — Oberon (Oberheim OB-X model) behavior suite
//
//  Usage: node factory/plugins/oberon/behavior-test.mjs <plugin.wasm>
//
//  Measurable assertions for the OB-X-specific behaviours:
//    1. SYNC: OSC 2 slaved to OSC 1 repeats at the master period
//    2. OSC 2 DETUNE: detuning OSC 2 beats against OSC 1
//    3. CUTOFF: opening the 2-pole filter passes more highs
//    4. RESONANCE (SEM 2-pole): emphasis adds energy near cutoff
//    5. SEM SMOOTHNESS: high resonance stays stable (no scream/blowup)
//    6. FILTER MOD: the filter envelope opens the filter on attack
//    7. LOUDNESS ADSR: a slow attack ramps loudness in
//    8. LFO -> FILTER: LFO modulation wobbles the cutoff
//    9. UNISON: the detuned 8-voice stack beats vs a poly single voice
//   10. PORTAMENTO: pitch slews from the previous note over the glide time
//   11. PAN SPREAD: raising Spread widens the stereo image
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/oberon.wasm";
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

// stereo=true -> returns {L,R}; else mono L
function render(overrides, events, seconds, stereo = false) {
  const ex = makeInstance();
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  const m0 = f32(ex);
  for (let i = 0; i < 64; i++) m0[parPtr + i] = 0;
  for (const p of spec) m0[parPtr + p.index] = p.default;
  for (const k in overrides) m0[parPtr + +k] = overrides[k];
  const total = Math.round(SR * seconds);
  const L = new Float32Array(total), R = new Float32Array(total);
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
    for (let i = 0; i < n; i++) { L[pos + i] = m[outPtr + i]; R[pos + i] = m[outPtr + STRIDE + i]; }
  }
  return stereo ? { L, R } : L;
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
function highRms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let hpX = 0, hpY = 0, s = 0; const k = 1 / (1 + 2 * Math.PI * 3000 / SR);
  for (let i = a; i < b; i++) { const y = k * (hpY + buf[i] - hpX); hpX = buf[i]; hpY = y; s += y * y; }
  return Math.sqrt(s / Math.max(1, b - a));
}
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
// stereo width = rms of the L-R difference relative to mono sum
function width({ L, R }, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), L.length);
  let sd = 0, sm = 0;
  for (let i = a; i < b; i++) { const d = L[i] - R[i], m = (L[i] + R[i]) * 0.5; sd += d * d; sm += m * m; }
  return Math.sqrt(sd / Math.max(1e-9, sm));
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}
const NOTE = [{ t: 0.02, on: 1, id: 1, hz: 220 }];
// clean single-saw OSC1 patch: filter parked, no env/LFO mod, poly, mono pan
const CLEAN = {
  [P["Osc Switch"]]: 1,                 // OSC1 saw only
  [P["Filt Switch"]]: 1,                // OSC1 -> filter, no track
  [P["Cutoff"]]: 0.6, [P["Resonance"]]: 0.1, [P["Filter Mod"]]: 0,
  [P["Loud Attack"]]: 0.01, [P["Loud Sustain"]]: 1, [P["Filt Sustain"]]: 1,
  [P["Mod Switch"]]: 0, [P["Mode Switch"]]: 0, [P["Pitch Bend"]]: 0,
  [P["Mod Lever"]]: 0, [P["Portamento"]]: 0, [P["Master Tune"]]: 0,
  [P["OSC2 Detune"]]: 0, [P["Pan Spread"]]: 0,
};

// 1. SYNC (p.10): OSC 2 slaved to OSC 1 repeats at the master period
{
  const lag = Math.round(SR / 220); // OSC1 (220 Hz) master period
  const base = { ...CLEAN, [P["Osc Switch"]]: 4 /*OSC2 saw*/, [P["Filt Switch"]]: 4 /*OSC2 full*/,
                 [P["OSC2 Freq"]]: 0.18 /*coarse up*/, [P["OSC2 Detune"]]: 0.5, [P["Cutoff"]]: 0.95 };
  const free = autocorr(render({ ...base, [P["Osc Switch"]]: 4 }, NOTE, 1.2), 0.3, 1.0, lag);
  const sync = autocorr(render({ ...base, [P["Osc Switch"]]: 20 /*+sync bit4*/ }, NOTE, 1.2), 0.3, 1.0, lag);
  check("SYNC forces OSC 2 to repeat at the OSC 1 master period",
        sync > 0.8 && sync > free + 0.1, `master-period corr free ${free.toFixed(3)} -> sync ${sync.toFixed(3)}`);
}

// 2. OSC 2 DETUNE (p.9): detuning OSC 2 beats against OSC 1
{
  const base = { ...CLEAN, [P["Osc Switch"]]: 5 /*OSC1+OSC2 saw*/, [P["Filt Switch"]]: 5 /*OSC1 + OSC2 full*/,
                 [P["Cutoff"]]: 0.75 };
  const flat = rmsWobble(render({ ...base, [P["OSC2 Detune"]]: 0.0 }, NOTE, 2.0), 0.5, 1.8);
  const det = rmsWobble(render({ ...base, [P["OSC2 Detune"]]: 0.35 }, NOTE, 2.0), 0.5, 1.8);
  check("OSC 2 DETUNE beats against OSC 1", det > flat * 1.8,
        `in-tune wobble ${flat.toFixed(3)} vs detuned ${det.toFixed(3)}`);
}

// 3. CUTOFF: opening the 2-pole filter passes more highs
{
  const dark = highRms(render({ ...CLEAN, [P["Cutoff"]]: 0.2 }, NOTE, 1.2), 0.3, 1.0);
  const bright = highRms(render({ ...CLEAN, [P["Cutoff"]]: 0.85 }, NOTE, 1.2), 0.3, 1.0);
  check("CUTOFF opens brightness", bright > dark * 2.0, `dark ${dark.toFixed(4)} vs bright ${bright.toFixed(4)}`);
}

// 4. RESONANCE (SEM 2-pole): emphasis adds energy near the cutoff
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.35 };
  const lo = highRms(render({ ...base, [P["Resonance"]]: 0.05 }, NOTE, 1.2), 0.3, 1.0);
  const hi = highRms(render({ ...base, [P["Resonance"]]: 0.85 }, NOTE, 1.2), 0.3, 1.0);
  check("RESONANCE emphasises the cutoff region", hi > lo * 1.3, `reso-lo ${lo.toFixed(4)} vs reso-hi ${hi.toFixed(4)}`);
}

// 5. SEM SMOOTHNESS: high resonance stays stable + audible (no ladder scream/blowup)
{
  const buf = render({ ...CLEAN, [P["Cutoff"]]: 0.45, [P["Resonance"]]: 0.97 }, NOTE, 1.5);
  let finite = true, peak = 0;
  for (let i = 0; i < buf.length; i++) { if (!Number.isFinite(buf[i])) finite = false; const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  const body = rms(buf, 0.3, 1.0);
  check("SEM 2-pole stays stable & musical at extreme resonance",
        finite && peak <= 1.001 && body > 0.02, `peak ${peak.toFixed(3)} rms ${body.toFixed(4)}`);
}

// 6. FILTER MOD (p.11): the filter envelope opens the filter on attack
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.2, [P["Filt Attack"]]: 0.01, [P["Filt Decay"]]: 0.6,
                 [P["Filt Sustain"]]: 0.0 };
  const off = highRms(render({ ...base, [P["Filter Mod"]]: 0.0 }, NOTE, 1.2), 0.03, 0.13);
  const on = highRms(render({ ...base, [P["Filter Mod"]]: 0.9 }, NOTE, 1.2), 0.03, 0.13);
  check("FILTER MOD opens the filter with the envelope on attack",
        on > off * 1.5, `mod-off ${off.toFixed(4)} vs mod-on ${on.toFixed(4)}`);
}

// 7. LOUDNESS ADSR: a slow attack ramps loudness in
{
  const base = { ...CLEAN, [P["Loud Attack"]]: 0.8 };
  const buf = render(base, NOTE, 2.0);
  const early = rms(buf, 0.03, 0.13), late = rms(buf, 1.2, 1.6);
  check("LOUDNESS ATTACK ramps the amplitude in", late > early * 3.0,
        `early ${early.toFixed(4)} vs late ${late.toFixed(4)}`);
}

// 8. LFO -> FILTER (p.10): LFO modulation wobbles the cutoff
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.45, [P["Freq Depth"]]: 0.85, [P["LFO Rate"]]: 0.5 };
  const off = rmsWobble(render({ ...base, [P["Mod Switch"]]: 0 }, NOTE, 2.0), 0.4, 1.8);
  const on = rmsWobble(render({ ...base, [P["Mod Switch"]]: 16 /*fFilt bit4, sine*/ }, NOTE, 2.0), 0.4, 1.8);
  check("LFO routed to FILTER wobbles the cutoff", on > off * 1.8, `lfo-off ${off.toFixed(3)} vs lfo-on ${on.toFixed(3)}`);
}

// 9. UNISON (p.9): the detuned 8-voice stack beats vs a poly single voice
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.7 };
  const poly = rmsWobble(render({ ...base, [P["Mode Switch"]]: 0 }, NOTE, 2.0), 0.5, 1.8);
  const uni = rmsWobble(render({ ...base, [P["Mode Switch"]]: 1 /*+unison bit0*/ }, NOTE, 2.0), 0.5, 1.8);
  check("UNISON detune beats more than poly single voice", uni > poly * 1.5,
        `poly wobble ${poly.toFixed(3)} vs unison ${uni.toFixed(3)}`);
}

// 10. PORTAMENTO (p.9): pitch slews from the previous note over the glide time
{
  const base = { ...CLEAN, [P["Portamento"]]: 0.6, [P["Cutoff"]]: 1.0 };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }, { t: 0.6, on: 0, id: 1 },
               { t: 0.62, on: 1, id: 2, hz: 440 }];
  const glide = render(base, evs, 2.5);
  const early = zcr(glide, 0.66, 0.78) / 2, late = zcr(glide, 1.9, 2.4) / 2;
  check("PORTAMENTO slews upward after the new note", early < late * 0.7,
        `early ${early.toFixed(0)} Hz -> settled ${late.toFixed(0)} Hz`);
  check("PORTAMENTO settles on the new pitch (~440 Hz)", Math.abs(late - 440) < 45, `settled ${late.toFixed(0)} Hz`);
  const jump = render({ ...base, [P["Portamento"]]: 0.0 }, evs, 2.5);
  const j = zcr(jump, 0.66, 0.78) / 2;
  check("PORTAMENTO off -> pitch jumps immediately", Math.abs(j - 440) < 55, `immediate ${j.toFixed(0)} Hz`);
}

// 11. PAN SPREAD (p.3 pan pots): raising Spread widens the stereo image
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.8 };
  // three-note chord so multiple voices seat across the field
  const chord = [{ t: 0.02, on: 1, id: 1, hz: 220 }, { t: 0.02, on: 1, id: 2, hz: 277 }, { t: 0.02, on: 1, id: 3, hz: 330 }];
  const narrow = width(render({ ...base, [P["Pan Spread"]]: 0.0 }, chord, 1.5, true), 0.3, 1.2);
  const wide = width(render({ ...base, [P["Pan Spread"]]: 1.0 }, chord, 1.5, true), 0.3, 1.2);
  check("PAN SPREAD widens the stereo image", wide > narrow + 0.2 && wide > 0.2,
        `narrow width ${narrow.toFixed(3)} -> wide width ${wide.toFixed(3)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
