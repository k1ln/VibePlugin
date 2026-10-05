import { Engine, metrics, mono, pitch, db, bandEnergy } from "./lab.mjs";
const e = new Engine(process.argv[2]);
const sr = 48000;
const run = (patch, notes = [60], dur = 0.6, extra = []) => { e.reset(); e.setPatch(patch); const ev = notes.map((n) => ({ t: 0, type: "on", note: n, vel: 0.8 })); return e.render(dur, [...ev, ...extra]); };
const seg = (o, a = 0.2, b = 0.55) => mono(o).subarray(Math.round(a * sr), Math.round(b * sr));
console.log("--- ranges (note 57 = 220Hz at 8')");
for (const [r, name] of [[0, "16'"], [1, "8'"], [2, "4'"], [3, "2'"]]) console.log(name, pitch(seg(run({ O1_RANGE: r }, [57])), sr).toFixed(1));
console.log("coarse +12:", pitch(seg(run({ O1_COARSE: 12 }, [57])), sr).toFixed(1), " fine +100c:", pitch(seg(run({ O1_FINE: 100 }, [57])), sr).toFixed(1), "(want 233.1)");
console.log("--- waveforms level / harmonic ratio (note 48)");
for (const w of [0, 1, 2, 3]) { const o = run({ O1_WAVE: w }, [48]); const s = seg(o); const f0 = 130.81; console.log(["sine", "tri", "saw", "pulse"][w], "rms", metrics(s).rms.toFixed(3), "H1", db(bandEnergy(s, sr, f0 - 5, f0 + 5)).toFixed(1), "H2", db(bandEnergy(s, sr, 2 * f0 - 5, 2 * f0 + 5)).toFixed(1), "H3", db(bandEnergy(s, sr, 3 * f0 - 5, 3 * f0 + 5)).toFixed(1)); }
console.log("--- vsync 16 → +1 octave?");
console.log("vsync0", pitch(seg(run({ O1_VSYNC: 0 }, [48])), sr).toFixed(1), "vsync16", pitch(seg(run({ O1_VSYNC: 16 }, [48])), sr).toFixed(1), "vsync32", pitch(seg(run({ O1_VSYNC: 32 }, [48])), sr).toFixed(1));
console.log("--- filter cutoff (saw note 48; energy above/below)");
for (const f of [255, 200, 150, 100, 50]) { const s = seg(run({ F_FREQ: f }, [48])); console.log("F_FREQ", f, "rms", metrics(s).rms.toFixed(3), "hf(2-8k)", db(bandEnergy(s, sr, 2000, 8000)).toFixed(1)); }
for (const sl of [0, 1]) { const s = seg(run({ F_FREQ: 120, F_SLOPE: sl }, [48])); console.log("slope", sl ? 24 : 12, "hf(2-8k)", db(bandEnergy(s, sr, 2000, 8000)).toFixed(1), "rms", metrics(s).rms.toFixed(3)); }
for (const sh of [0, 1, 2]) { const s = seg(run({ F_FREQ: 120, F_SHAPE: sh }, [48])); console.log("shape", ["LP", "BP", "HP"][sh], "rms", metrics(s).rms.toFixed(3), "lf(<200)", db(bandEnergy(s, sr, 100, 200)).toFixed(1), "hf", db(bandEnergy(s, sr, 3000, 8000)).toFixed(1)); }
console.log("--- resonance: peak");
for (const r of [0, 64, 110, 127]) { const s = seg(run({ F_FREQ: 120, F_RES: r }, [48])); console.log("res", r, "rms", metrics(s).rms.toFixed(3), "peak", metrics(s).peak.toFixed(2)); }
console.log("--- self osc (no input?)"); { const s = seg(run({ F_FREQ: 140, F_RES: 127, MIX1: 0 }, [48]), 0.1, 0.55); console.log("rms", metrics(s).rms.toFixed(4)); }
console.log("--- keytrack"); for (const kt of [0, 127]) { const lo = run({ F_FREQ: 120, F_KEY: kt }, [36]); const hi = run({ F_FREQ: 120, F_KEY: kt }, [72]); console.log("kt", kt, "note36 rms", metrics(seg(lo)).rms.toFixed(3), "note72 rms", metrics(seg(hi)).rms.toFixed(3)); }
console.log("--- overdrive level"); for (const od of [0, 32, 64, 127]) console.log("od", od, metrics(seg(run({ F_OD: od }, [48]))).rms.toFixed(3), "peak", metrics(seg(run({ F_OD: od }, [48]))).peak.toFixed(2));
console.log("--- env: attack/decay/release timing"); {
  const env = (patch, dur = 6, off = 3) => { e.reset(); e.setPatch(patch); const o = mono(e.render(dur, [{ t: 0, type: "on", note: 60, vel: 1 }, { t: off, type: "off", note: 60 }])); const w = 480, a = []; for (let i = 0; i + w < o.length; i += w) { let s = 0; for (let j = 0; j < w; j++) s += o[i + j] * o[i + j]; a.push(Math.sqrt(s / w)); } return a; };
  const tIdx = (a, thr, from = 0) => { for (let i = from; i < a.length; i++) if (a[i] >= thr) return i * 0.01; return -1; };
  for (const A of [0, 40, 80, 100, 127]) { const a = env({ EA_A: A, EA_D: 0, EA_S: 127 }, 22); const pk = Math.max(...a); console.log("attack", A, "→ t(90%) =", tIdx(a, pk * 0.9).toFixed(2), "s"); }
  for (const R of [0, 40, 80, 100]) { const a = env({ EA_A: 0, EA_R: R }, 30, 1); const pk = a[50]; let t = -1; for (let i = 100; i < a.length; i++) if (a[i] < pk * 0.01) { t = i * 0.01 - 1; break; } console.log("release", R, "→ -40dB after", t.toFixed(2), "s"); }
  for (const D of [30, 60, 90, 120]) { const a = env({ EA_A: 0, EA_D: D, EA_S: 0 }, 30, 29); const pk = Math.max(...a); let t = -1; for (let i = 5; i < a.length; i++) if (a[i] < pk * 0.05) { t = i * 0.01; break; } console.log("decay", D, "→ -26dB at", t.toFixed(2), "s"); }
}
