// =====================================================================
//  behavior-test.mjs — Aurora VA (Clavia Nord Lead 2 model) behaviour suite
//
//  Usage: node factory/plugins/aurora-va/behavior-test.mjs [plugin.wasm]
//
//  Measurable assertions for the Nord-Lead-2-specific behaviours:
//    1. OSC2 SEMITONE detune beats against OSC1
//    2. OSC SYNC slaves OSC2 to OSC1's master period
//    3. FM adds sidebands (raises high-frequency energy)
//    4. FILTER TYPE: LP24 vs HP24 vs BP have distinct spectral balance
//    5. FILTER SLOPE: LP12 passes more highs than LP24
//    6. CUTOFF opens brightness
//    7. RESONANCE emphasises the cutoff region
//    8. FILTER ENV opens the filter on attack
//    9. AMP ADSR: slow attack ramps loudness in
//   10. LFO1 -> FILTER wobbles the cutoff
//   11. UNISON detune beats vs a single voice
//   12. PORTAMENTO slews pitch from the previous note
//   13. ARPEGGIATOR retriggers held note (up mode)
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/aurora-va.wasm";
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
  const parPtr = ex.getParamsPtr() >>> 2, outPtr = ex.getOutputPtr() >>> 2;
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
function highRms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let hpX = 0, hpY = 0, s = 0; const k = 1 / (1 + 2 * Math.PI * 3000 / SR);
  for (let i = a; i < b; i++) { const y = k * (hpY + buf[i] - hpX); hpX = buf[i]; hpY = y; s += y * y; }
  return Math.sqrt(s / Math.max(1, b - a));
}
function lowRms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let lp = 0, s = 0; const k = 2 * Math.PI * 300 / SR;
  for (let i = a; i < b; i++) { lp += k * (buf[i] - lp); s += lp * lp; }
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

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}
const NOTE = [{ t: 0.02, on: 1, id: 1, hz: 220 }];
// clean saw patch: filter parked open, no env/LFO/mod, poly, no perf extras
const CLEAN = {
  [P["OSC1 Wave"]]: 2, [P["OSC2 Wave"]]: 1, [P["OSC2 Semi"]]: 0, [P["OSC2 Fine"]]: 0,
  [P["FM Amount"]]: 0, [P["Osc Mix"]]: 0.0, [P["Osc Switch"]]: 4,
  [P["Cutoff"]]: 0.7, [P["Resonance"]]: 0.1, [P["Filter Env"]]: 0,
  [P["Filter Type"]]: 1, [P["Filt Switch"]]: 0,
  [P["Amp Attack"]]: 0.01, [P["Amp Sustain"]]: 1.0, [P["Filt Sustain"]]: 1.0,
  [P["LFO1 Amount"]]: 0, [P["LFO2 Amount"]]: 0, [P["ModEnv Amt"]]: 0,
  [P["Mod Wheel"]]: 0, [P["Play Mode"]]: 0, [P["Perf Switch"]]: 0,
  [P["Portamento"]]: 0, [P["Bender"]]: 0, [P["Master Tune"]]: 0, [P["LFO2 Switch"]]: 0,
};

// 1. OSC2 SEMITONE detune beats (mix both oscillators)
{
  const base = { ...CLEAN, [P["Osc Mix"]]: 0.5 };
  const flat = rmsWobble(render({ ...base, [P["OSC2 Fine"]]: 0.0 }, NOTE, 2.0), 0.4, 1.8);
  const det = rmsWobble(render({ ...base, [P["OSC2 Fine"]]: 0.25 }, NOTE, 2.0), 0.4, 1.8);
  check("OSC2 FINE detune beats against OSC1", det > flat * 1.8, `intune ${flat.toFixed(3)} vs detuned ${det.toFixed(3)}`);
}

// 2. OSC SYNC slaves OSC2 to OSC1 master period
{
  const lag = Math.round(SR / 220);
  const base = { ...CLEAN, [P["Osc Mix"]]: 1.0, [P["OSC2 Wave"]]: 1, [P["OSC2 Semi"]]: 0.2, [P["Cutoff"]]: 0.95 };
  const free = autocorr(render({ ...base, [P["Osc Switch"]]: 4 }, NOTE, 1.2), 0.3, 1.0, lag);
  const sync = autocorr(render({ ...base, [P["Osc Switch"]]: 6 /*+sync bit1*/ }, NOTE, 1.2), 0.3, 1.0, lag);
  check("OSC SYNC forces OSC2 to the OSC1 master period", sync > 0.8 && sync > free + 0.1,
        `master-period corr free ${free.toFixed(3)} -> sync ${sync.toFixed(3)}`);
}

// 3. FM adds sidebands (sine carrier + tri modulator -> more highs)
{
  const base = { ...CLEAN, [P["OSC1 Wave"]]: 0, [P["OSC2 Wave"]]: 0, [P["Osc Mix"]]: 0.0,
                 [P["OSC2 Semi"]]: 0.02, [P["Cutoff"]]: 1.0 };
  const dry = highRms(render({ ...base, [P["FM Amount"]]: 0.0 }, NOTE, 1.2), 0.3, 1.0);
  const wet = highRms(render({ ...base, [P["FM Amount"]]: 0.7 }, NOTE, 1.2), 0.3, 1.0);
  check("FM adds sidebands (raises high-frequency energy)", wet > dry * 1.6, `dry ${dry.toFixed(4)} vs fm ${wet.toFixed(4)}`);
}

// 4. FILTER TYPE: LP24 dark-heavy, HP24 bright, BP mid
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.45, [P["Resonance"]]: 0.1 };
  const lpLow = lowRms(render({ ...base, [P["Filter Type"]]: 1 }, NOTE, 1.2), 0.3, 1.0);
  const hpLow = lowRms(render({ ...base, [P["Filter Type"]]: 2 }, NOTE, 1.2), 0.3, 1.0);
  const hpHigh = highRms(render({ ...base, [P["Filter Type"]]: 2 }, NOTE, 1.2), 0.3, 1.0);
  const lpHigh = highRms(render({ ...base, [P["Filter Type"]]: 1 }, NOTE, 1.2), 0.3, 1.0);
  check("LP24 keeps lows, HP24 cuts lows", lpLow > hpLow * 1.5, `LP low ${lpLow.toFixed(4)} vs HP low ${hpLow.toFixed(4)}`);
  check("HP24 keeps highs vs LP24", hpHigh > lpHigh * 1.3, `HP hi ${hpHigh.toFixed(4)} vs LP hi ${lpHigh.toFixed(4)}`);
  const bpHigh = highRms(render({ ...base, [P["Filter Type"]]: 3 }, NOTE, 1.2), 0.3, 1.0);
  check("BP differs from LP24", Math.abs(bpHigh - lpHigh) > lpHigh * 0.3 + 1e-5, `BP hi ${bpHigh.toFixed(4)} vs LP hi ${lpHigh.toFixed(4)}`);
}

// 5. FILTER SLOPE: LP12 passes more highs than LP24
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.42, [P["Resonance"]]: 0.1 };
  const p12 = highRms(render({ ...base, [P["Filter Type"]]: 0 }, NOTE, 1.5), 0.3, 1.2);
  const p24 = highRms(render({ ...base, [P["Filter Type"]]: 1 }, NOTE, 1.5), 0.3, 1.2);
  check("LP12 passes more highs than LP24 (12 vs 24 dB/oct)", p12 > p24 * 1.3, `LP12 ${p12.toFixed(4)} vs LP24 ${p24.toFixed(4)}`);
}

// 6. CUTOFF opens brightness
{
  const dark = highRms(render({ ...CLEAN, [P["Cutoff"]]: 0.2 }, NOTE, 1.2), 0.3, 1.0);
  const bright = highRms(render({ ...CLEAN, [P["Cutoff"]]: 0.85 }, NOTE, 1.2), 0.3, 1.0);
  check("CUTOFF opens brightness", bright > dark * 2.0, `dark ${dark.toFixed(4)} vs bright ${bright.toFixed(4)}`);
}

// 7. RESONANCE emphasises the cutoff region
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.35 };
  const lo = highRms(render({ ...base, [P["Resonance"]]: 0.05 }, NOTE, 1.2), 0.3, 1.0);
  const hi = highRms(render({ ...base, [P["Resonance"]]: 0.9 }, NOTE, 1.2), 0.3, 1.0);
  check("RESONANCE emphasises the cutoff region", hi > lo * 1.3, `reso-lo ${lo.toFixed(4)} vs reso-hi ${hi.toFixed(4)}`);
}

// 8. FILTER ENV opens the filter on attack
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.15, [P["Filt Attack"]]: 0.01, [P["Filt Decay"]]: 0.6, [P["Filt Sustain"]]: 0.0 };
  const off = highRms(render({ ...base, [P["Filter Env"]]: 0.0 }, NOTE, 1.2), 0.02, 0.12);
  const on = highRms(render({ ...base, [P["Filter Env"]]: 0.8 }, NOTE, 1.2), 0.02, 0.12);
  check("FILTER ENV opens the filter on attack", on > off * 1.5, `env-off ${off.toFixed(4)} vs env-on ${on.toFixed(4)}`);
}

// 9. AMP ADSR: slow attack ramps loudness in
{
  const base = { ...CLEAN, [P["Amp Attack"]]: 0.8 };
  const buf = render(base, NOTE, 2.0);
  const early = rms(buf, 0.03, 0.13), late = rms(buf, 1.2, 1.6);
  check("AMP ATTACK ramps loudness in", late > early * 3.0, `early ${early.toFixed(4)} vs late ${late.toFixed(4)}`);
}

// 10. LFO1 -> FILTER wobbles the cutoff
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.45, [P["LFO1 Rate"]]: 0.5 };
  const off = rmsWobble(render({ ...base, [P["LFO1 Amount"]]: 0, [P["LFO1 Dest"]]: 3 }, NOTE, 2.0), 0.4, 1.8);
  const on = rmsWobble(render({ ...base, [P["LFO1 Amount"]]: 0.9, [P["LFO1 Dest"]]: 3 }, NOTE, 2.0), 0.4, 1.8);
  check("LFO1 routed to FILTER wobbles the cutoff", on > off * 1.8, `lfo-off ${off.toFixed(3)} vs lfo-on ${on.toFixed(3)}`);
}

// 11. UNISON detune beats vs a single voice
{
  const base = { ...CLEAN, [P["Cutoff"]]: 0.7 };
  const single = rmsWobble(render({ ...base, [P["Perf Switch"]]: 0 }, NOTE, 2.0), 0.5, 1.8);
  const uni = rmsWobble(render({ ...base, [P["Perf Switch"]]: 1 /*unison bit0*/ }, NOTE, 2.0), 0.5, 1.8);
  check("UNISON detune beats more than a single voice", uni > single * 1.5, `single ${single.toFixed(3)} vs unison ${uni.toFixed(3)}`);
}

// 12. PORTAMENTO slews pitch from the previous note
{
  const base = { ...CLEAN, [P["Portamento"]]: 0.55, [P["Cutoff"]]: 1.0 };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }, { t: 0.6, on: 0, id: 1 }, { t: 0.62, on: 1, id: 2, hz: 440 }];
  const glide = render(base, evs, 2.5);
  const early = zcr(glide, 0.66, 0.78) / 2, late = zcr(glide, 1.9, 2.4) / 2;
  check("PORTAMENTO slews upward after the new note", early < late * 0.7, `early ${early.toFixed(0)} Hz -> settled ${late.toFixed(0)} Hz`);
  check("PORTAMENTO settles on the new pitch (~440 Hz)", Math.abs(late - 440) < 50, `settled ${late.toFixed(0)} Hz`);
  const jump = render({ ...base, [P["Portamento"]]: 0.0 }, evs, 2.5);
  const j = zcr(jump, 0.66, 0.78) / 2;
  check("PORTAMENTO off -> pitch jumps immediately", Math.abs(j - 440) < 60, `immediate ${j.toFixed(0)} Hz`);
}

// 13. ARPEGGIATOR retriggers a held chord (up mode)
{
  const base = { ...CLEAN, [P["LFO2 Switch"]]: 1 /*arp on*/, [P["Arp Range"]]: 1, [P["Arp Mode"]]: 0 /*up*/,
                 [P["LFO2 Rate"]]: 0.6, [P["Amp Attack"]]: 0.005, [P["Amp Decay"]]: 0.1, [P["Amp Sustain"]]: 0.0 };
  const chord = [{ t: 0.02, on: 1, id: 1, hz: 220 }, { t: 0.02, on: 1, id: 2, hz: 277 }, { t: 0.02, on: 1, id: 3, hz: 330 }];
  const buf = render(base, chord, 2.0);
  const off = rmsWobble(render({ ...base, [P["LFO2 Switch"]]: 0 }, chord, 2.0), 0.3, 1.8);
  const on = rmsWobble(buf, 0.3, 1.8);
  check("ARPEGGIATOR retriggers the held chord (amplitude pulses)", on > off * 1.8, `sustained ${off.toFixed(3)} vs arp ${on.toFixed(3)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
