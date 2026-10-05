import { Engine, NODE, metrics, zcFreq, slice, tone, db, fftMag, WASM } from "./lab.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const base = { DRIFT: 0, BLEED: 0, VOL1: 0.6, SW_O1: 1, CUTOFF: 1, EMPH: 0, CONTOUR: 0, KB1: 0, KB2: 0, LSUS: 1, LATK: 0, FATK: 0, OUTVOL: 1 };
function cap(vals, note, secs = 0.6, probe = NODE.O1) { e.reset(SR); e.setPatch({ ...base, ...vals }); return e.render(secs, [{ t: 0, type: "on", note }], { probe, block: 1 }).probe; }
for (const [r, name, oct] of [[1, "32'", -2], [2, "16'", -1], [3, "8'", 0], [4, "4'", 1], [5, "2'", 2]]) {
  const x = slice(cap({ O1_RANGE: r }, 41), SR, 0.2, 0.55);
  console.log(`bottom F at ${name}: ${zcFreq(x, SR).toFixed(3)} Hz (expect ${(87.30706 * 2 ** oct).toFixed(3)})`);
}
{ const x = slice(cap({ O1_RANGE: 3 }, 69), SR, 0.2, 0.55); console.log("A4 key at 8':", zcFreq(x, SR).toFixed(3), "Hz (expect 440)"); }
{ const x = slice(cap({ O1_RANGE: 0 }, 41), SR, 1.0, 3.0); } // LO
{ const x = cap({ O1_RANGE: 0 }, 41, 8); let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; console.log("LO range, bottom F:", (c / 8).toFixed(2), "Hz"); }
const names = ["tri", "shark", "saw", "square", "wide", "narrow"];
for (let w = 0; w < 6; w++) { const x = slice(cap({ O1_WAVE: w }, 57), SR, 0.2, 0.6); let lo = 9, hi = -9; for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); } const f0 = 220; const h = [1, 2, 3, 4, 5].map((k) => tone(x, SR, f0 * k)); console.log(names[w].padEnd(7), `${lo.toFixed(2)}..${hi.toFixed(2)}`, "harmonics rel:", h.map((v) => (v / h[0]).toFixed(3)).join(" ")); }
// filter self-oscillation at cutoff -1 → 440 Hz
{ e.reset(SR); e.setPatch({ ...base, VOL1: 0, EMPH: 1, CUTOFF: 0.4, KB1: 0, KB2: 0, STRIG: 1, LATK: 0, LSUS: 1 }); const b = e.render(1.0, [], { probe: NODE.FIL, block: 1 }); console.log("cutoff -1, EMPH 10 → filter oscillates at", zcFreq(slice(b.probe, SR, 0.5, 1.0), SR).toFixed(2), "Hz (expect 440); amplitude", Math.max(...slice(b.probe, SR, 0.5, 1.0)).toFixed(2)); }
