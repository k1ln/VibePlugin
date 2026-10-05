import { Engine, mono, metrics } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
const p = PRESETS.find((x) => x.name === process.argv[3]);
const rms = (patch) => { const e = new Engine(process.argv[2]); e.setPatch({ ...p.set, ...patch }); const b = e.render(0.3, [{ t: 0, type: "on", note: 36, vel: 0.95 }]); return metrics(b).rms; };
console.log("all", rms({}).toFixed(4), "tone only", rms({ N_LEV: -60, F_LEV: -60, C_LEV: -60 }).toFixed(4), "noise only", rms({ T_LEV: -60, F_LEV: -60, C_LEV: -60 }).toFixed(4), "fm only", rms({ T_LEV: -60, N_LEV: -60, C_LEV: -60 }).toFixed(4), "click only", rms({ T_LEV: -60, N_LEV: -60, F_LEV: -60 }).toFixed(4));
console.log({ T_LEV: p.set.T_LEV, N_LEV: p.set.N_LEV, N_CUT: p.set.N_CUT, N_MODE: p.set.N_MODE, N_DEC: p.set.N_DEC, M_LEV: p.set.M_LEV });
