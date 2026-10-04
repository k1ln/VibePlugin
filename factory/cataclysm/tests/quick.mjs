#!/usr/bin/env node
// quick.mjs — render one patch and report. Usage:
//   node quick.mjs <wasm> [--patch '{"T_PITCH":60}'] [--preset "Name"] [--note 36] [--sec 1.5] [--wav out.wav] [--png out.png]
import { Engine, metrics, mono, decayTime, pitchAt, centroid, envDb, writeWav, spectrogram, spectrum } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
const a = process.argv.slice(2);
const g = (f, d) => { const i = a.indexOf(f); return i < 0 ? d : a[i + 1]; };
const wasm = a[0];
let patch = g("--patch", null) ? JSON.parse(g("--patch")) : {};
if (g("--preset", null)) { const pr = PRESETS.find((p) => p.name === g("--preset")); if (!pr) throw new Error("no preset"); patch = { ...pr.set, ...patch }; }
const note = +g("--note", 36), sec = +g("--sec", 1.5), sr = +g("--sr", 48000);
const e = new Engine(wasm, sr);
e.setPatch(patch);
const buf = e.render(sec, [{ t: 0.0, type: "on", note, vel: 0.9 }]);
const m = metrics(buf), mo = mono(buf);
console.log(`peak ${m.peak.toFixed(3)}  rms ${m.rms.toFixed(4)}  dc ${m.dc.toFixed(4)}  nan ${m.nan}`);
console.log(`decay(-40dB) ${decayTime(mo, sr, 40).toFixed(3)} s   centroid@0-50ms ${centroid(mo, sr, 0, 0.05).toFixed(0)} Hz   @100-300ms ${centroid(mo, sr, 0.1, 0.3).toFixed(0)} Hz`);
for (const [t0, t1] of [[0.002, 0.02], [0.02, 0.06], [0.1, 0.25], [0.3, 0.6]]) console.log(`  pitch ${t0}-${t1}s: ${pitchAt(mo, sr, t0, t1).toFixed(1)} Hz`);
console.log("env dB/10ms:", envDb(mo, sr, 10).slice(0, 24).map((x) => x.toFixed(0)).join(" "));
if (g("--wav", null)) { writeWav(g("--wav"), buf, sr); if (g("--png", null)) console.log("png", spectrogram(g("--wav"), g("--png"))); }

if (g("--peaks", null)) {
  const [t0, t1] = g("--peaks").split(",").map(Number);
  const { mag, binHz } = spectrum(mo, sr, t0, t1, 16384);
  const pk = []; const mx = Math.max(...mag);
  for (let i = 2; i < mag.length - 2; i++) if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > mx * 0.05) pk.push([i * binHz, 20 * Math.log10(mag[i] / mx)]);
  pk.sort((x, y) => y[1] - x[1]);
  console.log("peaks:", pk.slice(0, 14).sort((x, y) => x[0] - y[0]).map(([f, d]) => `${f.toFixed(0)}Hz(${d.toFixed(0)}dB)`).join("  "));
}
