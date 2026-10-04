import { Engine, metrics, mono, spectrum } from "./lab.mjs";
const e = new Engine(process.argv[2]);
const patch = JSON.parse(process.argv[3]);
e.setPatch(patch);
const buf = e.render(0.6, [{ t: 0, type: "on", note: 36, vel: 0.9 }]);
const m = mono(buf);
const { mag, binHz } = spectrum(m, 48000, 0.0, 0.2, 16384);
const mx = Math.max(...mag);
const probes = JSON.parse(process.argv[4]);
for (const f of probes) { const i = Math.round(f / binHz); let best = 0; for (let k = i - 3; k <= i + 3; k++) best = Math.max(best, mag[k]); console.log(f + " Hz:", (20 * Math.log10(best / mx)).toFixed(1), "dB"); }
console.log("peak", metrics(buf).peak);
