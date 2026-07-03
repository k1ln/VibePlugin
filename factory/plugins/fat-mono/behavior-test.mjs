// =====================================================================
//  behavior-test.mjs — Fat Mono (Minimoog Model D model) behavior suite
//
//  Usage: node factory/plugins/fat-mono/behavior-test.mjs <plugin.wasm>
//
//  Asserts, with measurable checks (rms windows, zero-crossing rates):
//    1. legato single-trigger vs multi-trigger contour retriggering
//    2. DECAY switch: decay-time release (on) vs abrupt release (off)
//    3. KEYBOARD CONTROL 1&2 filter tracking (self-oscillating ladder)
//    4. external-input feedback overdrive (no-cable normalled loop)
//    5. GLIDE: pitch slews between notes at the knob's rate
//    6. OSC. 3 KB CONTROL off: osc 3 drones at a fixed pitch
//    7. low-note priority with return to the held note (classic Model D)
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2];
if (!wasmPath) { console.error("usage: node behavior-test.mjs <plugin.wasm>"); process.exit(2); }
const SR = 48000, STRIDE = 8192, BLOCK = 256;
const bytes = readFileSync(wasmPath);
const mod = new WebAssembly.Module(bytes);

const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8")).params;

function makeInstance() {
  const inst = new WebAssembly.Instance(mod, { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
  const ex = inst.exports;
  ex.init(SR, STRIDE, 2);
  return ex;
}
function f32(ex) { return new Float32Array(ex.memory.buffer); }

// render `seconds` with param overrides {index:value} and events [{t,on,id,hz,vel}]
function render(overrides, events, seconds) {
  const ex = makeInstance();
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  const m0 = f32(ex);
  for (let i = 0; i < 64; i++) m0[parPtr + i] = 0;
  for (const p of spec) m0[parPtr + p.index] = p.default;
  for (const k in overrides) m0[parPtr + +k] = overrides[k];
  const total = Math.round(SR * seconds);
  const out = new Float32Array(total);
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
    for (let i = 0; i < n; i++) out[pos + i] = m[outPtr + i];
  }
  return out;
}
function rms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let s = 0; for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
function peak(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let p = 0; for (let i = a; i < b; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
  return p;
}
function zcr(buf, t0, t1) { // zero crossings per second
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / ((b - a) / SR);
}

let passCount = 0, failCount = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (ok) passCount++; else failCount++;
}

const P = {}; for (const p of spec) P[p.name] = p.index;

// ---------------------------------------------------------------------
// 1. legato single-trigger vs multi-trigger (Global Settings p.47)
//    Fast loudness decay to a low sustain; the 2nd (legato) key must NOT
//    re-fire the contour, multi-trigger must.
{
  const ov = { [P["L Attack"]]: 0, [P["L Decay"]]: 0.55, [P["L Sustain"]]: 0.08,
               [P["Contour Amt"]]: 0, [P["Cutoff"]]: 2, [P["Glide Time"]]: 0 };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 220 }, { t: 1.2, on: 1, id: 2, hz: 330 }];
  const legato = render({ ...ov, [P["Key Mode"]]: 0 }, evs, 2);   // multi-trigger off
  const multi = render({ ...ov, [P["Key Mode"]]: 3 }, evs, 2);    // multi-trigger on
  const rl = rms(legato, 1.21, 1.45), rm = rms(multi, 1.21, 1.45);
  check("legato single-trigger keeps contour (no re-attack)", rm > rl * 2.0,
        `multi rms ${rm.toFixed(4)} vs legato rms ${rl.toFixed(4)}`);
}

// 2. DECAY switch: on → release at decay-time rate, off → abrupt (p.23/30/31)
{
  const ov = { [P["L Decay"]]: 0.75, [P["L Sustain"]]: 0.9, [P["Contour Amt"]]: 0 };
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 220 }, { t: 1.0, on: 0, id: 1 }];
  const decOn = render({ ...ov, [P["Perf Sw"]]: 9 | 2 }, evs, 2.5);  // glide+main+decay
  const decOff = render({ ...ov, [P["Perf Sw"]]: 9 }, evs, 2.5);
  const tailOn = rms(decOn, 1.4, 2.2), tailOff = rms(decOff, 1.4, 2.2);
  check("DECAY switch on → long release tail", tailOn > 0.02, `tail rms ${tailOn.toFixed(4)}`);
  check("DECAY switch off → abrupt release", tailOff < tailOn * 0.05, `tail rms ${tailOff.toFixed(5)}`);
}

// 3. KEYBOARD CONTROL 1&2: self-oscillating ladder tracks the keyboard
//    (emphasis max → sine at the cutoff; full tracking = 1 oct/oct, p.30)
{
  const ov = { [P["Emphasis"]]: 1, [P["Contour Amt"]]: 0, [P["Cutoff"]]: -1,
               [P["Mix Switch"]]: 48, [P["Mix Noise"]]: 0.15,  // only noise on (white), tickles the ladder
               [P["L Attack"]]: 0, [P["L Sustain"]]: 1, [P["Glide Time"]]: 0 };
  function selfOscHz(filtSw, hz) {
    const buf = render({ ...ov, [P["Filt Switch"]]: filtSw },
                       [{ t: 0.02, on: 1, id: 1, hz }], 1.5);
    return zcr(buf, 0.8, 1.4) / 2;
  }
  const full220 = selfOscHz(6, 220), full880 = selfOscHz(6, 880);
  const off220 = selfOscHz(0, 220), off880 = selfOscHz(0, 880);
  const fullRatio = full880 / full220, offRatio = off880 / off220;
  check("KB CONTROL 1+2 → cutoff tracks keyboard (~2 oct over 2 oct)",
        fullRatio > 2.8 && fullRatio < 5.5, `ratio ${fullRatio.toFixed(2)}`);
  check("KB CONTROL off → cutoff does not track", offRatio > 0.8 && offRatio < 1.25,
        `ratio ${offRatio.toFixed(2)}`);
  // 1/3 tracking sits in between (KEYBOARD CONTROL 1 only)
  const third220 = selfOscHz(2, 220), third880 = selfOscHz(2, 880);
  const thirdRatio = third880 / third220;
  check("KB CONTROL 1 only → 1/3 tracking (between off and full)",
        thirdRatio > 1.15 && thirdRatio < fullRatio * 0.75, `ratio ${thirdRatio.toFixed(2)}`);
}

// 4. external-input overdrive: no cable → main out normalled back into the
//    mixer; EXTERNAL INPUT VOLUME overloads it (manual p.27/36)
{
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }];
  const clean = render({ [P["Mix Ext"]]: 0, [P["Mix Switch"]]: 63, [P["Volume"]]: 0.85 }, evs, 1.5);
  const driven = render({ [P["Mix Ext"]]: 1, [P["Mix Switch"]]: 63, [P["Volume"]]: 0.85 }, evs, 1.5);
  const rC = rms(clean, 0.5, 1.4), rD = rms(driven, 0.5, 1.4);
  const crestC = peak(clean, 0.5, 1.4) / rC, crestD = peak(driven, 0.5, 1.4) / rD;
  check("external-input feedback drives the mixer hotter", rD > rC * 1.1,
        `rms ${rC.toFixed(3)} → ${rD.toFixed(3)}`);
  check("overdrive flattens the wave (lower crest factor)", crestD < crestC * 0.92,
        `crest ${crestC.toFixed(2)} → ${crestD.toFixed(2)}`);
}

// 5. GLIDE: pitch slews from the previous note at the knob's per-octave rate
{
  const ov = { [P["Mix Switch"]]: 1, [P["Osc1 Wave"]]: 3, [P["Emphasis"]]: 0,
               [P["Cutoff"]]: 4, [P["Contour Amt"]]: 0, [P["L Attack"]]: 0, [P["L Sustain"]]: 1,
               [P["Perf Sw"]]: 9, [P["Glide Time"]]: 0.62,
               [P["Key Mode"]]: 2 }; // last-note priority so the new key takes over
  const evs = [{ t: 0.02, on: 1, id: 1, hz: 110 }, { t: 1.0, on: 1, id: 2, hz: 440, }];
  const buf = render(ov, evs, 3);
  const early = zcr(buf, 1.05, 1.2) / 2, late = zcr(buf, 2.4, 2.9) / 2;
  check("glide slews upward over time after the new note", early < late * 0.75,
        `early ${early.toFixed(0)} Hz vs settled ${late.toFixed(0)} Hz`);
  check("glide settles on the new pitch", Math.abs(late - 440) < 30, `settled ${late.toFixed(0)} Hz`);
  const noGlide = render({ ...ov, [P["Perf Sw"]]: 8 }, evs, 3); // glide switch off
  const jump = zcr(noGlide, 1.05, 1.2) / 2;
  check("glide switch off → pitch jumps immediately", Math.abs(jump - 440) < 30,
        `immediate ${jump.toFixed(0)} Hz`);
}

// 6. OSC. 3 KB CONTROL off → osc 3 drones at a fixed pitch (manual p.19)
{
  const ov = { [P["Mix Switch"]]: 4, [P["Osc3 Wave"]]: 3, [P["Osc3 Range"]]: 3,
               [P["Emphasis"]]: 0, [P["Cutoff"]]: 4, [P["Contour Amt"]]: 0,
               [P["L Attack"]]: 0, [P["L Sustain"]]: 1, [P["Glide Time"]]: 0 };
  function o3Hz(kbOff, hz) {
    const buf = render({ ...ov, [P["Osc Switch"]]: kbOff ? 2 : 0 },
                       [{ t: 0.02, on: 1, id: 1, hz }], 1.2);
    return zcr(buf, 0.5, 1.1) / 2;
  }
  const dLow = o3Hz(1, 220), dHigh = o3Hz(1, 880);
  const kLow = o3Hz(0, 220), kHigh = o3Hz(0, 880);
  check("OSC.3 KB off → same pitch for any key (drone)", Math.abs(dHigh - dLow) < dLow * 0.06,
        `${dLow.toFixed(1)} Hz vs ${dHigh.toFixed(1)} Hz`);
  check("OSC.3 KB on → pitch follows the keyboard", kHigh > kLow * 3.2,
        `${kLow.toFixed(1)} Hz vs ${kHigh.toFixed(1)} Hz`);
}

// 7. low-note priority (classic Model D default) with return on release
{
  const ov = { [P["Mix Switch"]]: 1, [P["Osc1 Wave"]]: 3, [P["Emphasis"]]: 0,
               [P["Cutoff"]]: 4, [P["Contour Amt"]]: 0, [P["L Attack"]]: 0,
               [P["L Sustain"]]: 1, [P["Glide Time"]]: 0, [P["Perf Sw"]]: 8 };
  const evs = [
    { t: 0.02, on: 1, id: 1, hz: 330 },
    { t: 0.6, on: 1, id: 2, hz: 220 },  // lower note takes over
    { t: 1.2, on: 0, id: 2 },           // release → back to the held 330
  ];
  const low = render({ ...ov, [P["Key Mode"]]: 0 }, evs, 1.8);
  const h0 = zcr(low, 0.2, 0.5) / 2, h1 = zcr(low, 0.8, 1.1) / 2, h2 = zcr(low, 1.4, 1.7) / 2;
  check("low-note priority: lower key steals", Math.abs(h1 - 220) < 15, `${h1.toFixed(0)} Hz`);
  check("low-note priority: returns to held note on release", Math.abs(h2 - 330) < 20, `${h2.toFixed(0)} Hz`);
  const high = render({ ...ov, [P["Key Mode"]]: 1 }, evs, 1.8);
  const g1 = zcr(high, 0.8, 1.1) / 2;
  check("high-note priority: lower key ignored", Math.abs(g1 - 330) < 20, `${g1.toFixed(0)} Hz`);
  void h0;
}

console.log("─".repeat(50));
console.log(`${passCount} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
