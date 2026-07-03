// =====================================================================
//  behavior-test.mjs — Nova Six (Roland Juno-106 model) behavior suite
//
//  Usage: node factory/plugins/nova-six/behavior-test.mjs <plugin.wasm>
//
//  Measurable assertions (rms windows, L/R correlation, zero-crossing
//  rate) for the Juno-specific behaviours:
//    1. Chorus I / II / I+II widen the stereo image vs OFF
//    2. Sub-oscillator level adds low-frequency energy
//    3. PWM LFO mode adds movement the static MANUAL mode lacks
//    4. HPF positions: 0 boosts lows, 3 cuts them (low-band energy order)
//    5. VCF ENV polarity +/- open vs close the filter (brightness flips)
//    6. LFO DELAY ramps the vibrato in (early steady, late modulated)
//    7. VCA ENV vs GATE: slow attack ramps (ENV) vs snaps (GATE)
//    8. Portamento: pitch slews from the previous note over time
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/nova-six.wasm";
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

// render → {L,R}; overrides {index:value}, events [{t,on,id,hz,vel}]
function render(overrides, events, seconds) {
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
  return { L, R };
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
  return c / ((b - a) / SR);
}
// stereo de-correlation: rms of (L-R) relative to rms of (L+R); 0 = mono
function width(o, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), o.L.length);
  let d = 0, s = 0;
  for (let i = a; i < b; i++) { const df = o.L[i] - o.R[i], sm = o.L[i] + o.R[i]; d += df * df; s += sm * sm; }
  return Math.sqrt(d / Math.max(1e-9, s));
}
// energy in a low band via a crude one-pole low-pass, then rms
function lowRms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let lp = 0, s = 0; const k = 2 * Math.PI * 120 / SR;
  for (let i = a; i < b; i++) { lp += (buf[i] - lp) * k; s += lp * lp; }
  return Math.sqrt(s / Math.max(1, b - a));
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}
const NOTE = [{ t: 0.02, on: 1, id: 1, hz: 220 }];

// 1. Chorus widens the stereo field (p.29): OFF is mono, I/II/I+II are wide
{
  const base = { [P["Porta Sw"]]: 0, [P["Env Sustain"]]: 0.8, [P["Env Attack"]]: 0.01 };
  const off = width(render({ ...base, [P["Chorus"]]: 0 }, NOTE, 2), 0.8, 1.8);
  const i1 = width(render({ ...base, [P["Chorus"]]: 1 }, NOTE, 2), 0.8, 1.8);
  const i2 = width(render({ ...base, [P["Chorus"]]: 2 }, NOTE, 2), 0.8, 1.8);
  const oBoth = render({ ...base, [P["Chorus"]]: 3 }, NOTE, 2);
  const both = width(oBoth, 0.8, 1.8);
  const oI = render({ ...base, [P["Chorus"]]: 1 }, NOTE, 2);
  // I+II sums two BBD modulators → more time-varying width (beating) than I alone
  function widthWobble(o) {
    const w = []; for (let t = 0.6; t < 1.9; t += 0.05) w.push(width(o, t, t + 0.05));
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    let v = 0; for (const x of w) v += (x - mean) ** 2; return Math.sqrt(v / w.length);
  }
  check("chorus OFF is (near) mono", off < 0.02, `width ${off.toFixed(4)}`);
  check("chorus I widens the image", i1 > 0.1, `width ${i1.toFixed(3)}`);
  check("chorus II widens the image", i2 > 0.1, `width ${i2.toFixed(3)}`);
  check("chorus I+II beats more than I (two modulators)",
        widthWobble(oBoth) > widthWobble(oI) * 1.15 && both > 0.1,
        `I wobble ${widthWobble(oI).toFixed(3)} vs I+II ${widthWobble(oBoth).toFixed(3)}`);
}

// 2. Sub-oscillator adds low-frequency energy (p.16)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Wave"]]: 2, [P["HPF Freq"]]: 1,
                 [P["VCF Freq"]]: 0.7, [P["Env Sustain"]]: 0.9, [P["Env Attack"]]: 0.01 };
  const no = lowRms(render({ ...base, [P["DCO Sub"]]: 0 }, NOTE, 1.5).L, 0.5, 1.4);
  const yes = lowRms(render({ ...base, [P["DCO Sub"]]: 1 }, NOTE, 1.5).L, 0.5, 1.4);
  check("sub-oscillator raises low-frequency energy", yes > no * 1.25, `low rms ${no.toFixed(4)} → ${yes.toFixed(4)}`);
}

// 3. PWM LFO mode adds movement the static MANUAL mode lacks
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0, [P["DCO Wave"]]: 1, // pulse only
                 [P["LFO Rate"]]: 0.5, [P["VCF Freq"]]: 0.9, [P["VCF Env"]]: 0,
                 [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.01, [P["Porta Sw"]]: 0 };
  // MANUAL mode (wave bit2=0): amplitude near-constant; LFO mode (bit2=1): amplitude wobbles
  const man = render({ ...base, [P["DCO Wave"]]: 1, [P["DCO PWM"]]: 0.6 }, NOTE, 2).L;
  const lfo = render({ ...base, [P["DCO Wave"]]: 5, [P["DCO PWM"]]: 0.6 }, NOTE, 2).L;
  // measure short-window rms variance across time
  function wobble(buf) {
    const w = []; for (let t = 0.6; t < 1.8; t += 0.05) w.push(rms(buf, t, t + 0.05));
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    let v = 0; for (const x of w) v += (x - mean) ** 2; return Math.sqrt(v / w.length) / mean;
  }
  check("PWM-by-LFO modulates the tone over time more than MANUAL",
        wobble(lfo) > wobble(man) * 1.3, `man ${wobble(man).toFixed(3)} vs lfo ${wobble(lfo).toFixed(3)}`);
}

// 4. HPF positions: 0 boosts lows, 3 cuts them (p.18)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0.4, [P["DCO Wave"]]: 2,
                 [P["VCF Freq"]]: 0.8, [P["Env Sustain"]]: 0.9, [P["Env Attack"]]: 0.01 };
  const p0 = lowRms(render({ ...base, [P["HPF Freq"]]: 0 }, NOTE, 1.5).L, 0.5, 1.4);
  const p1 = lowRms(render({ ...base, [P["HPF Freq"]]: 1 }, NOTE, 1.5).L, 0.5, 1.4);
  const p3 = lowRms(render({ ...base, [P["HPF Freq"]]: 3 }, NOTE, 1.5).L, 0.5, 1.4);
  check("HPF 0 boosts lows above flat (1)", p0 > p1 * 1.1, `low rms 0:${p0.toFixed(4)} 1:${p1.toFixed(4)}`);
  check("HPF 3 cuts lows below flat (1)", p3 < p1 * 0.9, `low rms 3:${p3.toFixed(4)} 1:${p1.toFixed(4)}`);
}

// 5. VCF ENV polarity +/- opens vs closes the filter (p.19)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0, [P["DCO Wave"]]: 2,
                 [P["VCF Freq"]]: 0.28, [P["VCF Env"]]: 0.9, [P["VCF Kybd"]]: 0,
                 [P["Env Attack"]]: 0.01, [P["Env Decay"]]: 0.75, [P["Env Sustain"]]: 0.0,
                 [P["Porta Sw"]]: 0 };
  // positive: bright at the attack (env high), dark later; negative: reversed
  const posBuf = render({ ...base, [P["VCF Pol"]]: 0 }, NOTE, 2).L;
  const negBuf = render({ ...base, [P["VCF Pol"]]: 1 }, NOTE, 2).L;
  const posEarly = zcr(posBuf, 0.05, 0.15), negEarly = zcr(negBuf, 0.05, 0.15);
  check("ENV polarity + opens the filter on attack (brighter than -)",
        posEarly > negEarly * 1.3, `+ zcr ${posEarly.toFixed(0)} vs - zcr ${negEarly.toFixed(0)}`);
}

// 6. LFO DELAY ramps the vibrato in (p.21)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0, [P["DCO Wave"]]: 2,
                 [P["DCO LFO"]]: 1, [P["LFO Rate"]]: 0.55, [P["VCF Env"]]: 0, [P["VCF LFO"]]: 0,
                 [P["VCF Freq"]]: 0.9, [P["Env Sustain"]]: 1, [P["Env Attack"]]: 0.01, [P["Porta Sw"]]: 0 };
  const buf = render({ ...base, [P["LFO Delay"]]: 0.8 }, NOTE, 3).L; // ~2.4 s delay
  // pitch stability = variance of zcr across short windows; low early, higher late
  function pitchWobble(b, t0, t1) {
    const w = []; for (let t = t0; t < t1; t += 0.06) w.push(zcr(b, t, t + 0.06));
    const mean = w.reduce((a, c) => a + c, 0) / w.length;
    let v = 0; for (const x of w) v += (x - mean) ** 2; return Math.sqrt(v / w.length);
  }
  const early = pitchWobble(buf, 0.1, 0.6), late = pitchWobble(buf, 2.4, 2.95);
  check("LFO delay: vibrato is weaker early, stronger after the delay",
        late > early * 1.8, `early wobble ${early.toFixed(1)} vs late ${late.toFixed(1)}`);
}

// 7. VCA ENV vs GATE (p.20): slow attack ramps (ENV) vs snaps on (GATE)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0, [P["DCO Wave"]]: 2,
                 [P["VCF Env"]]: 0, [P["VCF Freq"]]: 0.9, [P["Env Attack"]]: 0.55, // slow attack
                 [P["Env Sustain"]]: 1, [P["Porta Sw"]]: 0 };
  const env = render({ ...base, [P["VCA Mode"]]: 0 }, NOTE, 1.2).L;
  const gate = render({ ...base, [P["VCA Mode"]]: 1 }, NOTE, 1.2).L;
  const envEarly = rms(env, 0.02, 0.08), gateEarly = rms(gate, 0.02, 0.08);
  check("VCA GATE snaps to full immediately; ENV ramps up",
        gateEarly > envEarly * 2.0, `env ${envEarly.toFixed(4)} vs gate ${gateEarly.toFixed(4)}`);
}

// 8. Portamento slews pitch from the previous note (p.23)
{
  const base = { [P["Chorus"]]: 0, [P["DCO Sub"]]: 0, [P["DCO Wave"]]: 1, // pulse
                 [P["VCF Env"]]: 0, [P["VCF Freq"]]: 1, [P["VCF Kybd"]]: 0,
                 [P["Env Attack"]]: 0.01, [P["Env Sustain"]]: 1, [P["Assign"]]: 1 /*Poly2*/ };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }, { t: 0.6, on: 0, id: 1 },
               { t: 0.62, on: 1, id: 2, hz: 440 }];
  const glide = render({ ...base, [P["Porta Sw"]]: 1, [P["Porta Time"]]: 0.6 }, evs, 2.5).L;
  const early = zcr(glide, 0.66, 0.78) / 2, late = zcr(glide, 1.8, 2.3) / 2;
  check("portamento slews upward after the new note", early < late * 0.7,
        `early ${early.toFixed(0)} Hz → settled ${late.toFixed(0)} Hz`);
  check("portamento settles on the new pitch (~440)", Math.abs(late - 440) < 40, `settled ${late.toFixed(0)} Hz`);
  const jump = render({ ...base, [P["Porta Sw"]]: 0 }, evs, 2.5).L;
  const j = zcr(jump, 0.66, 0.78) / 2;
  check("portamento off → pitch jumps immediately", Math.abs(j - 440) < 45, `immediate ${j.toFixed(0)} Hz`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
