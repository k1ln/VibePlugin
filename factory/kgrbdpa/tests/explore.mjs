import { Engine, metrics, pitch, zcFreq, slice, tone, db, fftMag, WASM } from "./lab.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const base = { MIX_O1: 0.6, MIX_O2: 0, CUTOFF: 1, RESO: 0, ENV_AMT: 0, VCA_MODE: 2, KBD_TRK: 1, DRIFT: 0, VOLUME: 1 };
function wave(extra, note = 57, secs = 0.5) { e.reset(SR); e.setPatch({ ...base, ...extra }); const b = e.render(secs, [{ t: 0, type: "on", note }]); return slice(b, SR, 0.15, secs); }
// harmonics of a 220 Hz wave
for (const [w, name] of [[0, "tri"], [1, "saw"], [2, "square"], [3, "narrow"]]) {
  const x = wave({ O1_WAVE: w });
  const f0 = 220, hs = []; for (let h = 1; h <= 8; h++) hs.push(tone(x, SR, f0 * h));
  const rel = hs.map((v) => (v / hs[0]).toFixed(3)).join(" ");
  console.log(name.padEnd(7), "f0", zcFreq(x, SR).toFixed(2), "| h1..8 rel:", rel, "| h1 abs", hs[0].toFixed(3));
}
// aliasing: saw at ~4.2 kHz - energy at non-harmonic bins
{
  const x = wave({ O1_WAVE: 1, O1_OCT: 3 }, 96, 0.6); // 4' at note 96 → very high
  const f0 = zcFreq(x, SR); const mag = fftMag(x, 16384); const N = 16384;
  let harm = 0, non = 0; const binHz = SR / N;
  for (let k = 5; k < mag.length; k++) { const f = k * binHz; const r = f / f0; const near = Math.abs(r - Math.round(r)) * f0 < 3 * binHz; if (near) harm += mag[k] ** 2; else non += mag[k] ** 2; }
  console.log("saw f0", f0.toFixed(1), "alias/harmonic energy:", db(Math.sqrt(non / harm)).toFixed(1), "dB");
}
// sync: osc2 slaved to osc1; osc2 at +7 st with sync should keep osc1 period
{
  e.reset(SR); e.setPatch({ ...base, MIX_O1: 0, MIX_O2: 0.6, SYNC: 1, O2_FREQ: 0.4, O2_WAVE: 1 });
  const b = e.render(0.5, [{ t: 0, type: "on", note: 57 }]); const x = slice(b, SR, 0.15, 0.5);
  console.log("sync saw: fundamental period freq", zcFreq(x, SR).toFixed(2), "(osc1 8' @ note57 = 220)", " rms", metrics(x).rms.toFixed(3));
}
// filter slope with noise
{
  e.reset(SR); e.setPatch({ ...base, MIX_O1: 0, MIX_NZ: 0.35, CUTOFF: 0.5, RESO: 0, ENV_AMT: 0, KBD_TRK: 1 });
  const b = e.render(2.0, [{ t: 0, type: "on", note: 60 }]); const x = slice(b, SR, 0.5, 2.0);
  const mag = fftMag(x, 65536); const binHz = SR / 65536;
  const avg = (f0, f1) => { let s = 0, c = 0; for (let k = Math.floor(f0 / binHz); k < f1 / binHz; k++) { s += mag[k] ** 2; c++; } return Math.sqrt(s / c); };
  const fc = 10 * 2 ** (11 * 0.5);
  const ref = avg(fc / 20, fc / 10);
  console.log("cutoff", fc.toFixed(0), "Hz: level at fc rel to passband", db(avg(fc * 0.95, fc * 1.05) / ref).toFixed(2), "dB (-3 expected for 4 poles ~ -6)",
    "| 1 oct up", db(avg(fc * 1.9, fc * 2.1) / ref).toFixed(1), "| 2 oct", db(avg(fc * 3.8, fc * 4.2) / ref).toFixed(1), "(slope ~24 dB/oct)");
}
// self oscillation
for (const cut of [0.3, 0.5, 0.7]) {
  e.reset(SR); e.setPatch({ ...base, MIX_O1: 0, CUTOFF: cut, RESO: 1, KBD_TRK: 1 });
  const b = e.render(1.0, [{ t: 0, type: "on", note: 60 }]); const x = slice(b, SR, 0.5, 1.0);
  const fc = 10 * 2 ** (11 * cut);
  console.log("self-osc cutoff", fc.toFixed(1), "→ measured", zcFreq(x, SR).toFixed(1), "Hz  rms", metrics(x).rms.toFixed(3));
}
