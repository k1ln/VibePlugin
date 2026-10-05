// tune-levels.mjs — loudness-normalise the patch sheets: VOLUME per patch so the loudest 100 ms of a mid-keyboard
// note sits near -17 dBFS (the sheets all say "VOLUME at 12 o'clock", but their sound sources differ by 20+ dB).
// Writes presets.levels.json. node tests/tune-levels.mjs <wasm>
import { Engine, metrics, db, WASM } from "./lab.mjs";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
const SR = 48000, TARGET = -17;
const lvPath = new URL("../presets.levels.json", import.meta.url).pathname;
if (existsSync(lvPath)) unlinkSync(lvPath);
const { PRESETS } = await import("../presets.mjs?fresh=" + Date.now());
const e = new Engine(WASM, SR);
const out = {};
for (const pr of PRESETS) {
  if (pr.name === "Init") continue;
  const measure = (vol) => {
    let acc = 0, n = 0;
    for (const notes of [[48], [60], [48, 55, 64]]) {
      e.reset(SR); e.setPatch({ ...pr.set, VOLUME: vol }, 120);
      const ev = []; notes.forEach((nn, i) => { ev.push({ t: 0.05 + i * 0.01, type: "on", note: nn, vel: 0.8 }); ev.push({ t: 2.2, type: "off", note: nn }); });
      const b = e.render(3.0, ev);
      let best = 0; for (let w0 = 0.05; w0 < 2.2; w0 += 0.05) best = Math.max(best, metrics(b.subarray(Math.round(w0 * SR), Math.round((w0 + 0.1) * SR))).rms);
      acc += best; n++;
    }
    return db(acc / n);
  };
  let vol = pr.set.VOLUME ?? 0.7;
  for (let it = 0; it < 4; it++) { const m = measure(vol); const g = Math.pow(10, (TARGET - m) / 20); vol = Math.max(0.12, Math.min(1, vol * Math.sqrt(g))); if (Math.abs(TARGET - m) < 0.4) break; }
  out[pr.name] = { VOLUME: +vol.toFixed(3) };
  console.log(pr.name.padEnd(20), "VOLUME", vol.toFixed(3), "→", measure(vol).toFixed(1), "dBFS");
}
writeFileSync(lvPath, JSON.stringify(out, null, 1) + "\n");
