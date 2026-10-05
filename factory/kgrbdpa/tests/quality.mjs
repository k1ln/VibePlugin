// quality.mjs — every factory patch sheet is audible, clean and not clipping over the whole keyboard.
// node tests/quality.mjs <wasm> [--report]
import { Engine, metrics, db, WASM } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
import { check, done } from "./t.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const report = process.argv.includes("--report");
const lines = [];
for (const pr of PRESETS) {
  const rows = [];
  for (const [label, notes] of [["low (C2)", [36]], ["mid (C4)", [60]], ["high (C6)", [84]], ["chord", [48, 55, 64]]]) {
    e.reset(SR); e.setPatch(pr.set, 120);
    const ev = []; notes.forEach((n, i) => { ev.push({ t: 0.05 + i * 0.01, type: "on", note: n, vel: 0.8 }); ev.push({ t: 2.2, type: "off", note: n }); });
    ev.push({ t: 0, type: "cc", num: 1, val: 0.0 });
    const b = e.render(4.0, ev);
    const m = metrics(b.subarray(Math.round(0.3 * SR), Math.round(2.2 * SR)));
    const tail = metrics(b.subarray(Math.round(3.6 * SR)));
    let best = 0; for (let w0 = 0.05; w0 < 2.2; w0 += 0.05) best = Math.max(best, metrics(b.subarray(Math.round(w0 * SR), Math.round((w0 + 0.1) * SR))).rms);
    rows.push({ label, ...m, short: best, tail: tail.rms, nan: metrics(b).nan, pk: metrics(b).peak });
  }
  const worstPk = Math.max(...rows.map((r) => r.pk));
  const mids = rows.filter((r) => r.label.startsWith("mid") || r.label === "chord");
  const rmsDb = Math.max(...mids.map((r) => db(r.short)));   // loudest 100 ms (plucks decay away)
  lines.push(`${pr.name.padEnd(20)} short-rms ${rows.map((r) => db(r.short).toFixed(0).padStart(4)).join(" ")} dBFS  peak ${worstPk.toFixed(3)}  dc ${Math.max(...rows.map((r) => Math.abs(r.dc))).toFixed(4)}`);
  check(`${pr.name}: finite`, rows.every((r) => r.nan === 0));
  check(`${pr.name}: never exceeds full scale`, worstPk <= 1.0001, worstPk.toFixed(3));
  const audible = pr.set.PLAY && pr.set.ARP_MODE !== 1 ? true : rmsDb > -48;
  check(`${pr.name}: audible on the keyboard (loudest 100 ms ${rmsDb.toFixed(1)} dBFS)`, audible && rmsDb > -40);
  check(`${pr.name}: not absurdly loud (< -2 dBFS rms)`, rmsDb < -2, rmsDb.toFixed(1));
  check(`${pr.name}: no large DC offset`, Math.max(...rows.map((r) => Math.abs(r.dc))) < 0.05);
  check(`${pr.name}: tail decays (4 s render ends quieter than it played, or drones / runs on HOLD)`, pr.set.HOLD || pr.set.VCA_MODE === 2 || rows.every((r) => r.tail <= r.rms * 1.5 + 1e-4));
}
if (report) console.log(lines.join("\n"));
done("quality");
