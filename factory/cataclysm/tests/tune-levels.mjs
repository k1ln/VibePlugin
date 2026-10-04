#!/usr/bin/env node
// tune-levels.mjs <wasm> — render every preset, normalise OUT_LEVEL so the
// hit peaks near −3 dBFS (presets that live on the limiter keep a modest
// RMS-based trim instead), write ../presets.levels.json and print a report.
import { writeFileSync } from "node:fs";
import { Engine, metrics, mono, decayTime, centroid, writeWav, spectrogram } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
const wasm = process.argv[2];
const outDir = process.argv[3] || null;
const levels = {};
const TARGET = Math.pow(10, -3 / 20);
const rows = [];
for (const pr of PRESETS) {
  const note = ["Hat", "Cymbal", "Clap", "Snare", "Perc", "FX"].includes(pr.cat) ? 42 : 36;
  const render = (lvl) => {
    const e = new Engine(wasm, 48000); e.setPatch({ ...pr.set, OUT_LEVEL: lvl });
    const sec = pr.set.RV_DEC > 2 || pr.set.T_DEC > 2000 || pr.set.M_DEC > 2000 || pr.set.X_DEC > 1500 ? 6 : 3;
    return { buf: e.render(sec, [{ t: 0, type: "on", note, vel: 0.95 }]), sec };
  };
  let lvl = 0, r = render(lvl), m = metrics(r.buf);
  // iterate a few times: peak is a nonlinear function of level when limiting
  for (let i = 0; i < 4; i++) {
    const db = 20 * Math.log10(TARGET / Math.max(m.peak, 1e-6));
    const next = Math.max(-40, Math.min(12, Math.round(lvl + db)));
    if (next === lvl) break;
    lvl = next; r = render(lvl); m = metrics(r.buf);
  }
  levels[pr.name] = lvl;
  const mo = mono(r.buf);
  rows.push([pr.name.padEnd(22), pr.cat.padEnd(10), `lvl ${String(lvl).padStart(3)} dB`, `peak ${m.peak.toFixed(2)}`, `rms ${m.rms.toFixed(3)}`, `dc ${m.dc.toFixed(3)}`, `dec ${decayTime(mo, 48000, 40).toFixed(2)}s`, `cen ${centroid(mo, 48000, 0, 0.1).toFixed(0)}Hz`, m.nan ? "NAN!" : "", m.rms < 0.004 ? "QUIET" : ""].join("  "));
  if (outDir) { writeWav(`${outDir}/${pr.name.replace(/[^A-Za-z0-9]+/g, "_")}.wav`, r.buf, 48000); }
}
writeFileSync(new URL("../presets.levels.json", import.meta.url), JSON.stringify(levels, null, 1));
console.log(rows.join("\n"));
