// =====================================================================
//  behavior-test.mjs — measurable behavioural assertions for Patch Mono
//  (Korg MS-20 model). Run: node factory/plugins/patch-mono/behavior-test.mjs
//  Renders the compiled wasm under specific param setups and checks the
//  MS-20 signature behaviours with hard numeric thresholds.
// =====================================================================
import { readFileSync } from "node:fs";

const WASM = "/tmp/patch-mono.wasm";
const STRIDE = 8192;
const SR = 48000;
const BLOCK = 256;

const bytes = readFileSync(WASM);
const mod = new WebAssembly.Module(bytes);
function newInst() {
  return new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error("abort"); }, seed: () => 0 } });
}

// spec defaults, so unspecified params are musical
const SPEC = JSON.parse(readFileSync("factory/plugins/patch-mono/spec.json", "utf8")).params;
const DEF = {};
for (const p of SPEC) DEF[p.index] = p.default;

// render: overrides = {index:value}; notes = [{on:sec,off:sec,hz}]
function render(overrides, notes, secs) {
  const ex = newInst().exports;
  ex.init(SR, STRIDE, 2);
  const f32 = () => new Float32Array(ex.memory.buffer);
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  const inPtr = ex.getInputPtr() >>> 2;
  { const m = f32(); for (let i = 0; i < 64; i++) m[parPtr + i] = 0;
    for (const k in DEF) m[parPtr + (+k)] = DEF[k];
    for (const k in overrides) m[parPtr + (+k)] = overrides[k]; }
  const total = Math.round(SR * secs);
  const out = new Float32Array(total);
  const ev = notes.map(nn => ({ ...nn })).sort((a, b) => a.on - b.on);
  let idOn = 0;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    const t = pos / SR;
    for (const e of ev) {
      if (!e._on && t >= e.on) { ex.noteOn(e.id ?? (100 + (idOn++)), e.hz, 0.9); e._on = 1; e._id = e.id ?? (100 + idOn - 1); }
      if (e._on && !e._off && e.off != null && t >= e.off) { ex.noteOff(e._id); e._off = 1; }
    }
    { const m = f32(); for (let i = 0; i < n; i++) { m[inPtr + i] = 0; m[inPtr + STRIDE + i] = 0; } }
    ex.process(n);
    const m = f32();
    for (let i = 0; i < n; i++) out[pos + i] = m[outPtr + i];
  }
  return out;
}

function rms(buf, a = 0, b = buf.length) { a = Math.floor(a); b = Math.floor(b); let s = 0, n = 0; for (let i = a; i < b; i++) { s += buf[i] * buf[i]; n++; } return Math.sqrt(s / Math.max(1, n)); }
function zcr(buf, a = 0, b = buf.length) { a = Math.floor(a); b = Math.floor(b); let z = 0; for (let i = a + 1; i < b; i++) if ((buf[i - 1] <= 0) !== (buf[i] <= 0)) z++; return z / ((b - a) / SR); }
// crude split of energy: one-pole LP at fc; low=lp rms, high=(x-lp) rms
function bands(buf, fc) {
  const g = 1 - Math.exp(-2 * Math.PI * fc / SR); let lp = 0, sl = 0, sh = 0, n = buf.length;
  for (let i = 0; i < n; i++) { lp += g * (buf[i] - lp); sl += lp * lp; const hi = buf[i] - lp; sh += hi * hi; }
  return { low: Math.sqrt(sl / n), high: Math.sqrt(sh / n) };
}
// block-rms envelope std (beating detector) over a window
function beatStd(buf, a, b) {
  a = Math.floor(a); b = Math.floor(b);
  const w = 2048; const es = []; for (let i = a; i + w < b; i += w) es.push(rms(buf, i, i + w));
  const mean = es.reduce((x, y) => x + y, 0) / es.length;
  const v = es.reduce((x, y) => x + (y - mean) * (y - mean), 0) / es.length;
  return Math.sqrt(v) / (mean + 1e-9);
}

let pass = 0, fail = 0;
function ok(name, cond, info) { (cond ? (pass++, console.log("  PASS  " + name + (info ? "  — " + info : ""))) : (fail++, console.log("  FAIL  " + name + (info ? "  — " + info : "")))); }

const HZ = 110; // A2, a bass note
const HOLD = [{ on: 0.0, off: 2.2, hz: HZ }];

console.log("Patch Mono — behavioural tests\n");

// 1. VCO waveforms differ ------------------------------------------------
{
  const base = { 4: 0, 7: 0, 22: 0.5 }; // VCO2 off, isolate VCO1
  const tri = render({ ...base, 0: 0 }, HOLD, 2.5);
  const saw = render({ ...base, 0: 1 }, HOLD, 2.5);
  const rect = render({ ...base, 0: 2, 1: 0.3 }, HOLD, 2.5);
  const noise = render({ ...base, 0: 3 }, HOLD, 2.5);
  const bt = bands(tri, 1500), bsw = bands(saw, 1500), bn = bands(noise, 1500);
  ok("VCO1 waveforms differ (saw richer highs than tri)", bsw.high / (bsw.low + 1e-9) > bt.high / (bt.low + 1e-9) * 1.15,
    `saw hi/lo=${(bsw.high / bsw.low).toFixed(2)} tri=${(bt.high / bt.low).toFixed(2)}`);
  ok("VCO1 noise is broadband (high zcr)", zcr(noise, 4800, 96000) > zcr(saw, 4800, 96000) * 2,
    `noiseZ=${zcr(noise, 4800, 96000).toFixed(0)} sawZ=${zcr(saw, 4800, 96000).toFixed(0)}`);
}

// 2. VCO-2 detune beats against VCO-1 -----------------------------------
{
  const tuned = render({ 5: 0.0, 3: 0.7, 7: 0.7, 17: 0.2, 19: 0, 16: 0.9 }, HOLD, 2.5);
  const detuned = render({ 5: 0.02, 3: 0.7, 7: 0.7, 17: 0.2, 19: 0, 16: 0.9 }, HOLD, 2.5);
  const bd = beatStd(detuned, 9600, 96000), bt = beatStd(tuned, 9600, 96000);
  ok("VCO-2 detune produces beating (amplitude modulation)", bd > bt * 1.4 && bd > 0.03,
    `detunedBeat=${bd.toFixed(3)} tunedBeat=${bt.toFixed(3)}`);
}

// 3. HPF cuts lows -------------------------------------------------------
{
  const open = render({ 12: 0.0, 13: 0.0, 16: 1.0, 17: 0, 19: 0 }, HOLD, 2.0);
  const hi = render({ 12: 0.8, 13: 0.0, 16: 1.0, 17: 0, 19: 0 }, HOLD, 2.0);
  const bo = bands(open, 300), bh = bands(hi, 300);
  ok("HPF removes low-frequency energy", bh.low < bo.low * 0.6, `lowOpen=${bo.low.toFixed(4)} lowHPF=${bh.low.toFixed(4)}`);
}

// 4. LPF cuts highs ------------------------------------------------------
{
  const open = render({ 16: 1.0, 17: 0, 19: 0, 12: 0, 13: 0 }, HOLD, 2.0);
  const closed = render({ 16: 0.2, 17: 0, 19: 0, 12: 0, 13: 0 }, HOLD, 2.0);
  const bo = bands(open, 2000), bc = bands(closed, 2000);
  ok("LPF removes high-frequency energy", bc.high < bo.high * 0.6, `hiOpen=${bo.high.toFixed(4)} hiClosed=${bc.high.toFixed(4)}`);
}

// 5. Both filters self-oscillate at max PEAK (no VCO input) --------------
{
  // silence the oscillators, open VCA via EG2, crank LPF peak
  const lpf = render({ 3: 0, 7: 0, 17: 1.0, 16: 0.5, 13: 0, 12: 0, 20: 1 }, HOLD, 1.5);
  ok("LPF self-oscillates with no VCO (rings at max PEAK)", rms(lpf, 4800, 60000) > 0.02, `rms=${rms(lpf, 4800, 60000).toFixed(4)}`);
  const hpf = render({ 3: 0, 7: 0, 13: 1.0, 12: 0.6, 17: 0.0, 16: 1.0, 20: 1 }, HOLD, 1.5);
  ok("HPF self-oscillates with no VCO (rings at max PEAK)", rms(hpf, 4800, 60000) > 0.02, `rms=${rms(hpf, 4800, 60000).toFixed(4)}`);
}

// 6. EG2 ADSR: long attack ramps up slowly ------------------------------
{
  const fast = render({ 27: 0.0, 19: 0, 16: 0.9, 17: 0 }, HOLD, 2.0);
  const slow = render({ 27: 0.7, 19: 0, 16: 0.9, 17: 0 }, HOLD, 2.0);
  const early = 0.05 * SR, later = 0.6 * SR;
  const fastRatio = rms(fast, 0, early) / (rms(fast, later, later + early) + 1e-9);
  const slowRatio = rms(slow, 0, early) / (rms(slow, later, later + early) + 1e-9);
  ok("EG2 attack shapes the VCA (slow attack = quiet onset)", slowRatio < fastRatio * 0.5,
    `slowOnset=${slowRatio.toFixed(3)} fastOnset=${fastRatio.toFixed(3)}`);
  // release tail
  const shortR = render({ 30: 0.0 }, [{ on: 0, off: 0.8, hz: HZ }], 1.6);
  const longR = render({ 30: 0.8 }, [{ on: 0, off: 0.8, hz: HZ }], 1.6);
  ok("EG2 release lengthens the tail", rms(longR, 1.1 * SR, 1.5 * SR) > rms(shortR, 1.1 * SR, 1.5 * SR) * 3,
    `longTail=${rms(longR, 1.1 * SR, 1.5 * SR).toFixed(4)} shortTail=${rms(shortR, 1.1 * SR, 1.5 * SR).toFixed(4)}`);
}

// 7. EG1 delay/attack/release shapes pitch (routed to pitch) -------------
{
  // EG1 -> pitch strongly; measure pitch (zcr) early vs after the env rises
  const cfg = { 11: 0.9, 10: 0, 23: 0.0, 24: 0.4, 3: 0.9, 7: 0, 16: 1.0, 17: 0, 19: 0 };
  const noDelay = render(cfg, HOLD, 2.5);
  const withDelay = render({ ...cfg, 23: 0.5 }, HOLD, 2.5);
  const zNoDelayEarly = zcr(noDelay, 0.02 * SR, 0.1 * SR);
  const zWithDelayEarly = zcr(withDelay, 0.02 * SR, 0.1 * SR);
  ok("EG1 delay postpones the pitch envelope (lower initial pitch with delay)",
    zNoDelayEarly > zWithDelayEarly * 1.2, `noDelayZ=${zNoDelayEarly.toFixed(0)} delayZ=${zWithDelayEarly.toFixed(0)}`);
}

// 8. MG modulates (LFO wobble on the filter) ----------------------------
{
  const noMod = render({ 18: 0.0, 21: 0.5, 16: 0.5, 17: 0.2, 19: 0, 29: 1.0, 7: 0 }, HOLD, 2.5);
  const modOn = render({ 18: 0.8, 21: 0.5, 16: 0.5, 17: 0.2, 19: 0, 29: 1.0, 7: 0 }, HOLD, 2.5);
  const bm = beatStd(modOn, 0.3 * SR, 2.0 * SR), bn = beatStd(noMod, 0.3 * SR, 2.0 * SR);
  ok("MG modulates the LPF cutoff (adds slow amplitude wobble)", bm > bn * 1.5 && bm > 0.05,
    `modBeat=${bm.toFixed(3)} noModBeat=${bn.toFixed(3)}`);
}

// 9. Patch bay: MG->LPF via a patch cord changes the sound ---------------
{
  const unpatched = render({ 40: 0, 41: 0, 42: 0, 18: 0, 16: 0.5, 17: 0.2, 19: 0 }, HOLD, 2.5);
  const patched = render({ 40: 1, 41: 5, 42: 0.9, 18: 0, 16: 0.5, 17: 0.2, 19: 0 }, HOLD, 2.5); // MG-tri -> LPF
  const bp = beatStd(patched, 0.3 * SR, 2.0 * SR), bu = beatStd(unpatched, 0.3 * SR, 2.0 * SR);
  ok("Patch cord MG->LPF changes the sound vs unpatched", bp > bu * 1.5 && bp > 0.05,
    `patchedBeat=${bp.toFixed(3)} unpatchedBeat=${bu.toFixed(3)}`);
}

// 10. Portamento glide ---------------------------------------------------
{
  // two notes an octave apart; with glide the pitch ramps between them
  const notes = [{ id: 1, on: 0.0, off: 0.5, hz: 110 }, { id: 2, on: 0.5, off: 1.3, hz: 220 }];
  const off = render({ 9: 0.0, 16: 1.0, 17: 0, 19: 0, 3: 0.9, 7: 0 }, notes, 1.6);
  const on = render({ 9: 0.6, 16: 1.0, 17: 0, 19: 0, 3: 0.9, 7: 0 }, notes, 1.6);
  // just after the 2nd note-on, glide should still be below target pitch
  const zOffJust = zcr(off, 0.52 * SR, 0.58 * SR);
  const zOnJust = zcr(on, 0.52 * SR, 0.58 * SR);
  ok("Portamento glides pitch between notes (slower rise with glide)",
    zOnJust < zOffJust * 0.85, `glideZ=${zOnJust.toFixed(0)} instantZ=${zOffJust.toFixed(0)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
