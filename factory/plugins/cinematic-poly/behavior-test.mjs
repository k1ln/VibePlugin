// =====================================================================
//  behavior-test.mjs — Cinematic Poly (Yamaha CS-80 model) behavior suite
//
//  Usage: node factory/plugins/cinematic-poly/behavior-test.mjs <plugin.wasm>
//
//  Measurable assertions for CS-80-specific behaviours:
//    1. Dual channels: I and II are independent — muting to I only vs II
//       only (via MIX) gives audibly different tone when the channels are
//       set up differently.
//    2. HPF sweep: raising the high-pass cutoff removes low-end energy.
//    3. LPF sweep: lowering the low-pass cutoff removes high-end energy.
//    4. Independent filter EGs: the IL-AL-A-D-R VCF envelope opens the
//       filter on attack (brighter early) independently per channel.
//    5. Ring modulator: adds inharmonic sum/difference sidebands.
//    6. Polyphonic aftertouch -> brilliance: pressure opens the filter.
//    7. Tremolo/Chorus: produces stereo width (L != R).
//    8. Ribbon: bends the pitch of a held note up and down.
//    9. Detune II: detuning channel II beats against channel I.
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/cinematic-poly.wasm";
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

// render stereo: returns {L,R}
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
// band energy via one-pole (hp=true -> high band, else low band) around fc
function bandRms(buf, t0, t1, fc, hp) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  const k = 1 / (1 + 2 * Math.PI * fc / SR);
  let x = 0, y = 0, s = 0;
  for (let i = a; i < b; i++) {
    const hpv = k * (y + buf[i] - x); x = buf[i]; y = hpv;
    const v = hp ? hpv : buf[i] - hpv;
    s += v * v;
  }
  return Math.sqrt(s / Math.max(1, b - a));
}
function zcr(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / Math.max(1e-6, (b - a) / SR);
}
// spectral flatness proxy: variance of short-window rms (beating/roughness)
function wobble(buf, t0, t1) {
  const w = []; for (let t = t0; t < t1; t += 0.03) w.push(rms(buf, t, t + 0.03));
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
// both waveforms on both channels, filters parked open, envelopes fast/sustained
const CLEAN = {
  [P["Osc Switch"]]: 1 + 2 + 4 + 8, // I sq+saw, II sq+saw, no trem/porta/sustain
  [P["I LPF"]]: 0.7, [P["II LPF"]]: 0.7, [P["I HPF"]]: 0.05, [P["II HPF"]]: 0.05,
  [P["I VCF IL"]]: 0, [P["I VCF AL"]]: 0, [P["II VCF IL"]]: 0, [P["II VCF AL"]]: 0,
  [P["I VCA A"]]: 0.05, [P["I VCA S"]]: 0.9, [P["II VCA A"]]: 0.05, [P["II VCA S"]]: 0.9,
  [P["Sub VCO"]]: 0, [P["Sub VCF"]]: 0, [P["Pitchbend"]]: 0, [P["Init Brill"]]: 0,
  [P["Detune II"]]: 0, [P["Ring Mod"]]: 0,
};

// 1. DUAL CHANNELS: I-only vs II-only differ when channels set up differently
{
  const base = { ...CLEAN,
    [P["I LPF"]]: 0.85, [P["Osc Switch"]]: 2 + 4, // ch I saw only, ch II square only
    [P["II LPF"]]: 0.35, [P["II PW"]]: 0.2 };
  const chI = render({ ...base, [P["Mix I-II"]]: -1 }, NOTE, 1.2); // I only
  const chII = render({ ...base, [P["Mix I-II"]]: 1 }, NOTE, 1.2); // II only
  const hiI = bandRms(chI.L, 0.3, 1.0, 2500, true);
  const hiII = bandRms(chII.L, 0.3, 1.0, 2500, true);
  check("Channel I (open saw) is brighter than Channel II (dark pulse)",
        hiI > hiII * 1.4, `hiI ${hiI.toFixed(4)} vs hiII ${hiII.toFixed(4)}`);
}

// 2. HPF sweep removes low end
{
  const lo = render({ ...CLEAN, [P["I HPF"]]: 0.02, [P["II HPF"]]: 0.02 }, NOTE, 1.2);
  const hi = render({ ...CLEAN, [P["I HPF"]]: 0.6, [P["II HPF"]]: 0.6 }, NOTE, 1.2);
  const lowLo = bandRms(lo.L, 0.3, 1.0, 300, false);
  const lowHi = bandRms(hi.L, 0.3, 1.0, 300, false);
  check("HPF raised cuts low-frequency energy", lowHi < lowLo * 0.7,
        `low@open ${lowLo.toFixed(4)} -> low@hpf ${lowHi.toFixed(4)}`);
}

// 3. LPF sweep removes high end
{
  const open = render({ ...CLEAN, [P["I LPF"]]: 0.9, [P["II LPF"]]: 0.9 }, NOTE, 1.2);
  const shut = render({ ...CLEAN, [P["I LPF"]]: 0.3, [P["II LPF"]]: 0.3 }, NOTE, 1.2);
  const hiOpen = bandRms(open.L, 0.3, 1.0, 3000, true);
  const hiShut = bandRms(shut.L, 0.3, 1.0, 3000, true);
  check("LPF lowered cuts high-frequency energy", hiShut < hiOpen * 0.5,
        `hi@open ${hiOpen.toFixed(4)} -> hi@closed ${hiShut.toFixed(4)}`);
}

// 4. VCF IL-AL-A-D-R envelope opens the filter on attack (brighter early)
{
  const base = { ...CLEAN, [P["I LPF"]]: 0.35, [P["II LPF"]]: 0.35,
    [P["I VCF A"]]: 0.02, [P["I VCF D"]]: 0.5, [P["II VCF A"]]: 0.02, [P["II VCF D"]]: 0.5 };
  const flat = render({ ...base, [P["I VCF AL"]]: 0, [P["II VCF AL"]]: 0 }, NOTE, 1.5);
  const swept = render({ ...base, [P["I VCF AL"]]: 0.9, [P["II VCF AL"]]: 0.9 }, NOTE, 1.5);
  const early = bandRms(swept.L, 0.025, 0.10, 2500, true);
  const late = bandRms(swept.L, 0.9, 1.3, 2500, true);
  const flatHi = bandRms(flat.L, 0.025, 0.10, 2500, true);
  check("VCF envelope (AL) opens the filter brighter on attack than steady",
        early > late * 1.3 && early > flatHi * 1.3,
        `AL early ${early.toFixed(4)} vs late ${late.toFixed(4)} vs no-AL ${flatHi.toFixed(4)}`);
}

// 5. RING MODULATOR makes the tone inharmonic (sum/difference sidebands at a
//    non-harmonic ring frequency break the note's periodicity — p.13)
{
  const lag = Math.round(SR / 220); // one fundamental period of the 220 Hz note
  const base = { ...CLEAN, [P["Osc Switch"]]: 2, [P["Mix I-II"]]: -1, // ch I saw only
    [P["I LPF"]]: 0.7, [P["Ring Speed"]]: 0.72 /* ~110 Hz, inharmonic vs 220 */, [P["Ring Depth"]]: 0.9 };
  const acf = (buf, t0, t1) => {
    const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length) - lag;
    let num = 0, den = 0;
    for (let i = a; i < b; i++) { num += buf[i] * buf[i + lag]; den += buf[i] * buf[i]; }
    return num / Math.max(1e-9, den);
  };
  const dry = acf(render({ ...base, [P["Ring Mod"]]: 0 }, NOTE, 1.2).L, 0.3, 1.0);
  const wet = acf(render({ ...base, [P["Ring Mod"]]: 0.95 }, NOTE, 1.2).L, 0.3, 1.0);
  check("RING MOD makes the tone inharmonic (breaks note periodicity)",
        dry > 0.6 && wet < dry * 0.7, `periodicity dry ${dry.toFixed(3)} -> wet ${wet.toFixed(3)}`);
}

// 6. Polyphonic AFTER-TOUCH -> brilliance opens the filter
{
  const base = { ...CLEAN, [P["I LPF"]]: 0.3, [P["II LPF"]]: 0.3, [P["Aft Brill"]]: 0.9 };
  const soft = render({ ...base, [P["Pressure"]]: 0 }, NOTE, 1.2);
  const hard = render({ ...base, [P["Pressure"]]: 1 }, NOTE, 1.2);
  const hiSoft = bandRms(soft.L, 0.3, 1.0, 2500, true);
  const hiHard = bandRms(hard.L, 0.3, 1.0, 2500, true);
  check("AFTER-TOUCH pressure opens the filter (brighter)",
        hiHard > hiSoft * 1.5, `hi soft ${hiSoft.toFixed(4)} -> hard ${hiHard.toFixed(4)}`);
}

// 7. TREMOLO/CHORUS creates stereo width (L differs from R)
{
  const mono = render({ ...CLEAN }, NOTE, 1.5); // trem off
  const wide = render({ ...CLEAN, [P["Osc Switch"]]: 1 + 2 + 4 + 8 + 16, [P["Trem Depth"]]: 0.9 }, NOTE, 1.5); // chorus on
  const dm = rms(mono.L.map((x, i) => x - mono.R[i]), 0.4, 1.3);
  const dw = rms(wide.L.map((x, i) => x - wide.R[i]), 0.4, 1.3);
  check("TREMOLO/CHORUS widens the stereo field (L-R difference)",
        dw > dm * 4 + 0.001, `mono L-R ${dm.toFixed(5)} -> chorus L-R ${dw.toFixed(5)}`);
}

// 8. RIBBON bends pitch of a held note
{
  const up = render({ ...CLEAN, [P["Ribbon"]]: 0.5 }, NOTE, 1.0);   // +6 semis
  const dn = render({ ...CLEAN, [P["Ribbon"]]: -0.5 }, NOTE, 1.0);  // -6 semis
  const zUp = zcr(up.L, 0.3, 0.9), zDn = zcr(dn.L, 0.3, 0.9);
  check("RIBBON up raises pitch above ribbon down", zUp > zDn * 1.4,
        `up ${zUp.toFixed(0)} Hz-ish vs down ${zDn.toFixed(0)}`);
}

// 9. DETUNE II beats against channel I
{
  const base = { ...CLEAN, [P["Mix I-II"]]: 0 };
  const tune = render({ ...base, [P["Detune II"]]: 0 }, NOTE, 2.0);
  const det = render({ ...base, [P["Detune II"]]: 0.15 }, NOTE, 2.0);
  const wTune = wobble(tune.L, 0.5, 1.8), wDet = wobble(det.L, 0.5, 1.8);
  check("DETUNE II makes channel II beat against channel I", wDet > wTune * 1.5,
        `beat in-tune ${wTune.toFixed(4)} -> detuned ${wDet.toFixed(4)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
