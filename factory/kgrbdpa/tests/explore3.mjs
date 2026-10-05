import { Engine, metrics, slice, db, WASM } from "./lab.mjs";
import { spectrogram, plotWave } from "./png.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const out = process.env.OUT || "/tmp";
e.setPatch({ MIX_O1: 0, MIX_O2: 0, REV_MIX: 1, VOLUME: 0.7, VCA_MODE: 2, INST_LVL: 1 });
const b = e.render(2.5, [], { input: (i) => [i === 100 ? 1 : 0, 0] });
spectrogram(out + "/spring-ir.png", b, SR, { N: 1024, hop: 128, fmax: 6000, log: true, w: 1000, h: 360, dbRange: 70 });
plotWave(out + "/spring-wave.png", b.subarray(0, Math.round(0.6 * SR)), { lo: -0.3, hi: 0.3 });
console.log("IR peak", metrics(b).peak);
