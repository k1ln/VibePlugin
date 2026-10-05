// quality.mjs — every factory sound is audible, clean and not clipping over the keyboard.
// node tests/quality.mjs <wasm> [--report]
import { Engine, metrics, db, WASM } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
import { check, done } from "./t.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const report = process.argv.includes("--report");
const lines = [];
for (const pr of PRESETS) {
  const rows = [];
  for (const [label, notes] of [["low (F1)", [41]], ["mid (C3)", [48]], ["high (C5)", [72]], ["chord", [48, 55, 64]]]) {
    e.reset(SR); e.setPatch(pr.set, 120);
    const ev = []; notes.forEach((n, i) => { ev.push({ t: 0.05 + i * 0.01, type: "on", note: n, vel: 0.8 }); ev.push({ t: 2.2, type: "off", note: n }); });
    const b = e.render(4.0, ev);
    const m = metrics(b.subarray(Math.round(0.3 * SR), Math.round(2.2 * SR)));
    let best = 0; for (let w0 = 0.05; w0 < 2.2; w0 += 0.05) best = Math.max(best, metrics(b.subarray(Math.round(w0 * SR), Math.round((w0 + 0.1) * SR))).rms);
    rows.push({ label, ...m, short: best, nan: metrics(b).nan, pk: metrics(b).peak, tail: metrics(b.subarray(Math.round(3.6 * SR))).rms });
  }
  const worstPk = Math.max(...rows.map((r) => r.pk));
  const loud = Math.max(...rows.filter((r) => r.label.startsWith("mid") || r.label === "chord").map((r) => db(r.short)));
  lines.push(`${pr.name.padEnd(24)} short-rms ${rows.map((r) => db(r.short).toFixed(0).padStart(4)).join(" ")} dBFS  peak ${worstPk.toFixed(3)}  dc ${Math.max(...rows.map((r) => Math.abs(r.dc))).toFixed(4)}`);
  check(`${pr.name}: finite`, rows.every((r) => r.nan === 0));
  check(`${pr.name}: never exceeds full scale`, worstPk <= 1.0001, worstPk.toFixed(3));
  check(`${pr.name}: audible on the keyboard (loudest 100 ms ${loud.toFixed(1)} dBFS)`, loud > -40);
  check(`${pr.name}: not absurdly loud (< -2 dBFS rms)`, loud < -2, loud.toFixed(1));
  check(`${pr.name}: no large DC offset`, Math.max(...rows.map((r) => Math.abs(r.dc))) < 0.05);
  check(`${pr.name}: tail decays (ends quieter than it played, unless it drones)`, pr.set.STRIG || rows.every((r) => r.tail <= r.rms * 1.5 + 1e-4));
}
if (report) console.log(lines.join("\n"));
done("quality");
