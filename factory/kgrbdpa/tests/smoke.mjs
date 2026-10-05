import { Engine, metrics, pitch, zcFreq, slice, tone, db, WASM } from "./lab.mjs";
const e = new Engine(WASM);
e.setPatch({});
const buf = e.render(1.5, [{ t: 0, type: "on", note: 60 }, { t: 1.0, type: "off", note: 60 }]);
console.log("default patch note 60:", metrics(slice(buf, 48000, 0.2, 0.9)), "pitch", pitch(slice(buf, 48000, 0.3, 0.6), 48000).toFixed(2));
// osc 1 alone, raw (VCA drone, filter wide open) → exact pitch
for (const [oct, name, mult] of [[0, "32'", 0.25], [1, "16'", 0.5], [2, "8'", 1], [3, "4'", 2]]) {
  e.setPatch({ O1_OCT: oct, MIX_O1: 0.6, MIX_O2: 0, CUTOFF: 1, RESO: 0, ENV_AMT: 0, VCA_MODE: 2, KBD_TRK: 1, DRIFT: 0 });
  const b = e.render(0.6, [{ t: 0, type: "on", note: 60 }]);
  const x = slice(b, 48000, 0.2, 0.55);
  console.log(`osc1 ${name}: ${zcFreq(x, 48000).toFixed(3)} Hz  expected ${(261.6256 * mult).toFixed(3)}`);
}
