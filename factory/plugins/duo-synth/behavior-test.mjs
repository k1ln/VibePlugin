// =====================================================================
//  behavior-test.mjs — measurable behavioural assertions for Duo Synth
//  (ARP Odyssey model). Run: node factory/plugins/duo-synth/behavior-test.mjs
//  Renders the compiled wasm under specific param setups and checks the
//  Odyssey signature behaviours with hard numeric thresholds.
// =====================================================================
import { readFileSync } from "node:fs";

const WASM = "/tmp/duo-synth.wasm";
const STRIDE = 8192;
const SR = 48000;
const BLOCK = 256;

const bytes = readFileSync(WASM);
const mod = new WebAssembly.Module(bytes);
function newInst() {
  return new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error("abort"); }, seed: () => 0 } });
}

const SPEC = JSON.parse(readFileSync("factory/plugins/duo-synth/spec.json", "utf8")).params;
const DEF = {};
for (const p of SPEC) DEF[p.index] = p.default;

// render: overrides = {index:value}; notes = [{id,on,off,hz}]
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
      if (!e._on && t >= e.on) { e._id = e.id ?? (100 + (idOn++)); ex.noteOn(e._id, e.hz, 0.9); e._on = 1; }
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
function bands(buf, fc) {
  const g = 1 - Math.exp(-2 * Math.PI * fc / SR); let lp = 0, sl = 0, sh = 0, n = buf.length;
  for (let i = 0; i < n; i++) { lp += g * (buf[i] - lp); sl += lp * lp; const hi = buf[i] - lp; sh += hi * hi; }
  return { low: Math.sqrt(sl / n), high: Math.sqrt(sh / n) };
}
function beatStd(buf, a, b) {
  a = Math.floor(a); b = Math.floor(b);
  const w = 2048; const es = []; for (let i = a; i + w < b; i += w) es.push(rms(buf, i, i + w));
  const mean = es.reduce((x, y) => x + y, 0) / es.length;
  const v = es.reduce((x, y) => x + (y - mean) * (y - mean), 0) / es.length;
  return Math.sqrt(v) / (mean + 1e-9);
}
// std of windowed zero-crossing rate (pitch-wobble detector)
function zcrStd(buf, a, b, w = 1024) {
  a = Math.floor(a); b = Math.floor(b); const zs = [];
  for (let i = a; i + w < b; i += w) zs.push(zcr(buf, i, i + w));
  const mean = zs.reduce((x, y) => x + y, 0) / zs.length;
  const v = zs.reduce((x, y) => x + (y - mean) * (y - mean), 0) / zs.length;
  return Math.sqrt(v);
}

let pass = 0, fail = 0;
function ok(name, cond, info) { (cond ? (pass++, console.log("  PASS  " + name + (info ? "  — " + info : ""))) : (fail++, console.log("  FAIL  " + name + (info ? "  — " + info : "")))); }

const HZ = 110;                                   // A2
const HOLD = [{ id: 1, on: 0.0, off: 2.2, hz: HZ }];
// open filter, no filter modulation, saw+saw, no vibrato — a clean bed
const BED = { 11: 0.95, 12: 0.0, 30: 0, 31: 0, 32: 0, 23: 0, 26: 0, 27: 0, 13: 0, 6: 0, 35: 0, 36: 0 };

console.log("Duo Synth — behavioural tests\n");

// 1. VCO-2 detune beats against VCO-1 -----------------------------------
{
  const tuned = render({ ...BED, 3: 0.0, 4: 0.7, 5: 0.7 }, HOLD, 2.5);
  const detuned = render({ ...BED, 3: 0.06, 4: 0.7, 5: 0.7 }, HOLD, 2.5);
  const bd = beatStd(detuned, 9600, 108000), bt = beatStd(tuned, 9600, 108000);
  ok("VCO-2 detune produces beating (amplitude modulation)", bd > bt * 1.4 && bd > 0.03,
    `detunedBeat=${bd.toFixed(3)} tunedBeat=${bt.toFixed(3)}`);
}

// 2. Hard SYNC locks VCO-2 to VCO-1 (kills the detune beating) ----------
{
  const noSync = render({ ...BED, 3: 0.08, 4: 0.7, 5: 0.7, 35: 0 }, HOLD, 2.5);      // sync off
  const sync = render({ ...BED, 3: 0.08, 4: 0.7, 5: 0.7, 35: 32 }, HOLD, 2.5);       // b5 sync on
  const bns = beatStd(noSync, 9600, 108000), bs = beatStd(sync, 9600, 108000);
  ok("SYNC locks OSC2 to OSC1 (removes detune beating)", bs < bns * 0.6,
    `syncBeat=${bs.toFixed(3)} noSyncBeat=${bns.toFixed(3)}`);
}

// 3. Ring modulator produces inharmonic sidebands (extra highs) ----------
{
  // isolate the third mixer channel; b3 = ring, VCO2 at a non-harmonic ratio
  const saw = render({ ...BED, 4: 0, 5: 0.9, 6: 0, 2: 0.05 }, HOLD, 2.0);            // plain VCO2 saw
  const ring = render({ ...BED, 4: 0, 5: 0, 6: 0.9, 35: 8, 2: 0.05, 3: 0.11 }, HOLD, 2.0); // ring only
  const bs = bands(saw, 2000), br = bands(ring, 2000);
  ok("Ring mod is audible (VCO1 x VCO2)", rms(ring, 4800, 90000) > 0.02, `ringRms=${rms(ring, 4800, 90000).toFixed(4)}`);
  ok("Ring mod adds inharmonic high-frequency sidebands", (br.high / (br.low + 1e-9)) > (bs.high / (bs.low + 1e-9)) * 1.3,
    `ringHi/Lo=${(br.high / br.low).toFixed(2)} sawHi/Lo=${(bs.high / bs.low).toFixed(2)}`);
}

// 4. VCF cutoff sweep changes brightness --------------------------------
{
  const closed = render({ ...BED, 11: 0.25, 4: 0.8, 5: 0 }, HOLD, 2.0);
  const open = render({ ...BED, 11: 0.95, 4: 0.8, 5: 0 }, HOLD, 2.0);
  const bc = bands(closed, 2500), bo = bands(open, 2500);
  ok("VCF cutoff sweep opens up the highs", bc.high < bo.high * 0.6, `hiClosed=${bc.high.toFixed(4)} hiOpen=${bo.high.toFixed(4)}`);
}

// 5. VCF self-oscillates at max resonance (no VCO input) ----------------
{
  const so = render({ ...BED, 4: 0, 5: 0, 6: 0, 12: 1.0, 11: 0.5, 14: 1.0 }, HOLD, 1.5); // gain open, res max
  ok("VCF self-oscillates with no oscillators (rings at max reso)", rms(so, 4800, 60000) > 0.02, `rms=${rms(so, 4800, 60000).toFixed(4)}`);
}

// 6. HPF removes low-frequency energy -----------------------------------
{
  const openHpf = render({ ...BED, 13: 0.0, 4: 0.9, 5: 0 }, HOLD, 2.0);
  const hi = render({ ...BED, 13: 0.85, 4: 0.9, 5: 0 }, HOLD, 2.0);
  const bo = bands(openHpf, 250), bh = bands(hi, 250);
  ok("HPF removes low-frequency energy", bh.low < bo.low * 0.6, `lowOpen=${bo.low.toFixed(4)} lowHPF=${bh.low.toFixed(4)}`);
}

// 7. ADSR vs AR shaping (AR has no decay → sustains at max) --------------
{
  // ADSR mode with sustain 0 + fast decay → energy dies; AR mode → holds full
  const adsr = render({ ...BED, 38: 0, 17: 0.0, 16: 0.2, 4: 0.9, 5: 0 }, HOLD, 2.0);   // VCA=ADSR
  const arm = render({ ...BED, 38: 1, 19: 0.05, 4: 0.9, 5: 0 }, HOLD, 2.0);            // VCA=AR
  const lateAdsr = rms(adsr, 1.2 * SR, 1.8 * SR), lateAr = rms(arm, 1.2 * SR, 1.8 * SR);
  ok("AR sustains where ADSR (sus=0) decays away", lateAr > lateAdsr * 3 && lateAr > 0.02,
    `lateAR=${lateAr.toFixed(4)} lateADSR=${lateAdsr.toFixed(4)}`);
}

// 8. Sample & Hold produces stepped modulation of the filter ------------
{
  // S&H (noise-fed, LFO-clocked) → VCF FM1; vs no S&H routing
  const shMask = 64 + 128;                     // b6 clock=LFO, b7 in2=noise
  const noSH = render({ ...BED, 30: 0.0, 11: 0.4, 12: 0.3, 4: 0.9, 5: 0, 7: 0.5, 35: shMask, 36: 0 }, HOLD, 2.5);
  const withSH = render({ ...BED, 30: 0.9, 11: 0.4, 12: 0.3, 4: 0.9, 5: 0, 7: 0.5, 35: shMask, 36: 16 }, HOLD, 2.5); // b4 VCFFM1=S&H
  const bw = beatStd(withSH, 0.3 * SR, 2.2 * SR), bn = beatStd(noSH, 0.3 * SR, 2.2 * SR);
  ok("S&H steps the filter (random stepped amplitude modulation)", bw > bn * 1.5 && bw > 0.05,
    `shBeat=${bw.toFixed(3)} noShBeat=${bn.toFixed(3)}`);
}

// 9. LFO vibrato (PPC) wobbles the pitch --------------------------------
{
  const noVib = render({ ...BED, 23: 0.0, 7: 0.45, 4: 0.9, 5: 0 }, HOLD, 2.5);
  const vib = render({ ...BED, 23: 0.8, 7: 0.45, 4: 0.9, 5: 0 }, HOLD, 2.5);
  const sn = zcrStd(noVib, 0.3 * SR, 2.2 * SR), sv = zcrStd(vib, 0.3 * SR, 2.2 * SR);
  ok("LFO vibrato modulates the pitch (zcr wobble)", sv > sn * 2 && sv > 20,
    `vibZcrStd=${sv.toFixed(1)} noVibZcrStd=${sn.toFixed(1)}`);
}

// 10. Duophonic: two simultaneous keys sound as two distinct pitches -----
{
  const LO = 110, HI = midi(midiOf(LO) + 12); // an octave up
  const lo = [{ id: 1, on: 0, off: 2.2, hz: LO }];
  const both = [{ id: 1, on: 0, off: 2.2, hz: LO }, { id: 2, on: 0.02, off: 2.2, hz: HI }];
  // Isolate VCO2 (fine=0, fast porta so it settles): with only the low key it
  // plays the low note; adding the high key makes VCO2 jump UP (high-note
  // priority) while VCO1 stays on the low key (low-note priority).
  const v2base = { ...BED, 3: 0, 21: 0, 4: 0, 5: 0.9 };  // VCO2 only
  const v1base = { ...BED, 3: 0, 21: 0, 4: 0.9, 5: 0 };  // VCO1 only
  const zV2lo = zcr(render(v2base, lo, 1.5), 0.3 * SR, 1.4 * SR);
  const zV2both = zcr(render(v2base, both, 1.5), 0.3 * SR, 1.4 * SR);
  const zV1lo = zcr(render(v1base, lo, 1.5), 0.3 * SR, 1.4 * SR);
  const zV1both = zcr(render(v1base, both, 1.5), 0.3 * SR, 1.4 * SR);
  ok("Duophonic: VCO2 follows the HIGH key (high-note priority)", zV2both > zV2lo * 1.5,
    `v2both=${zV2both.toFixed(0)} v2low=${zV2lo.toFixed(0)}`);
  ok("Duophonic: VCO1 stays on the LOW key (low-note priority)", Math.abs(zV1both - zV1lo) < zV1lo * 0.2,
    `v1both=${zV1both.toFixed(0)} v1low=${zV1lo.toFixed(0)}`);
}

// 11. Portamento glides pitch between notes ------------------------------
{
  const notes = [{ id: 1, on: 0.0, off: 0.5, hz: 110 }, { id: 2, on: 0.5, off: 1.3, hz: 220 }];
  const off = render({ ...BED, 21: 0.0, 4: 0.9, 5: 0 }, notes, 1.6);
  const on = render({ ...BED, 21: 0.6, 4: 0.9, 5: 0 }, notes, 1.6);
  const zOff = zcr(off, 0.52 * SR, 0.58 * SR);
  const zOn = zcr(on, 0.52 * SR, 0.58 * SR);
  ok("Portamento glides pitch between notes (slower rise with glide)",
    zOn < zOff * 0.85, `glideZ=${zOn.toFixed(0)} instantZ=${zOff.toFixed(0)}`);
}

function midiOf(hz) { return Math.round(69 + 12 * Math.log2(hz / 440)); }
function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
