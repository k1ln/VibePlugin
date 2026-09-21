import { tmpdir } from "node:os";
const tmpWav = (n) => tmpdir() + "/" + n + ".wav";
import { Lab, mono, peak, rms, pitchAt, centroid, wav } from "./lab.mjs";
import("../../strings/defs.mjs").then((m) => {
const K = {}; m.COLOSSUS.forEach((d, i) => K[d.key] = i);
const lab = new Lab(process.argv[2]);
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
function setup(o = {}) { lab.reset(); for (const [k, v] of Object.entries(o)) lab.set(K[k], v); }
let ok = true; const check = (c, s) => { console.log((c ? "ok   " : "FAIL ") + s); if (!c) ok = false; };
const dry = { HALL: 0, PUMP: 0, EVOLVE: 0, TAPE: 0 };
// 1) sustain: mid layer in tune, chord bounded
setup({ ...dry, LOW: 0, HIGH: 0, SUB: 0, SPREAD: 0, ROSIN: 0, BODY: 0 });
let x = mono(lab.render(1.5, [{ at: 0, note: 57, vel: .6 }]));
const f = pitchAt(x, 48000, 600, 300, 180, 260); check(Math.abs(1200 * Math.log2(f / hz(57))) < 5, `mid section in tune: ${f.toFixed(2)} Hz (want ${hz(57).toFixed(2)})`);
setup({});
x = mono(lab.render(3, [36, 48, 55, 60, 64, 67].map((n) => ({ at: 0, note: n, vel: .9 }))));
check(x.every(Number.isFinite) && peak(x) < 1 && rms(x, 48000, 144000) > 0.05, `6-note chord, all sections: peak ${peak(x).toFixed(2)}, rms ${rms(x, 48000, 144000).toFixed(3)}`);
// exact step-change times from the engine's own display[0], rendered in 16-sample blocks
function stepTimes(pat, extra = {}) {
  setup({ ...dry, OSTINATO: 1, PATTERN: pat, LENGTH: 0.25, ...extra });
  lab.ex.noteOn(60, 261.6, 0.7);
  const t = []; let last = -2, pos = 0;
  for (; pos < 2.1 * 48000; pos += 16) { lab.ex.transport(1, (pos / 48000) * 2, 120); lab.ex.process(16); const s = lab.display()[0]; if (s !== last) { if (s >= 0) t.push([pos, s]); last = s; } }
  return t;
}
// ostinato onsets from the level envelope's rising edges
function onsets(sig) { const w = 96, env = []; for (let i = 0; i + w <= sig.length; i += w) env.push(rms(sig, i, i + w)); const o = []; let armed = true; const mx = Math.max(...env);
  for (let i = 1; i < env.length; i++) { if (armed && env[i] > mx * 0.35 && env[i] > env[i - 1]) { o.push(i * w); armed = false; } if (env[i] < mx * 0.12) armed = true; } return o; }
const ost = (pat, extra = {}) => { setup({ ...dry, OSTINATO: 1, PATTERN: pat, LENGTH: 0.25, ...extra }); return mono(lab.render(2.1, [{ at: 0, note: 60, vel: .7 }], { transport: true, bpm: 120 })); };
let o = onsets(ost(0)); const gaps = o.slice(1, 6).map((v, i) => v - o[i]);
check(gaps.length >= 4 && gaps.every((g) => Math.abs(g - 12000) <= 200), `8ths at 120 bpm: gaps ${gaps.join(", ")} (want 12000)`);
o = onsets(ost(2)); const g2 = o.slice(1, 7).map((v, i) => Math.round((v - o[i]) / 6000));
check(g2.slice(0, 6).join(",") === "2,1,1,2,1,1", `gallop: step gaps ${g2.join(",")} (want 2,1,1,2,1,1)`);
let st = stepTimes(4); const g4 = st.slice(1, 6).map((v, i) => v[0] - st[i][0]);
check(g4.every((g) => Math.abs(g - 8000) <= 16), `triplets: step every ${g4.join(", ")} samples (want 8000)`);
st = stepTimes(1, { SWING: 0.8 }); const g5 = st.slice(1, 7).map((v, i) => v[0] - st[i][0]);
check(g5.every((g, i) => Math.abs(g - (st[i][1] % 2 === 0 ? 8400 : 3600)) <= 16), `swing 0.8: gaps ${g5.join(", ")} (want 8400 / 3600 alternating)`);
// accent: accented (downbeat) hit louder than an unaccented one
x = ost(1, { ACCENT: 1 }); o = onsets(x);
const hitLvl = (i) => rms(x, o[i], o[i] + 1500);
check(hitLvl(4) > hitLvl(5) * 1.2, `accented hits louder (${hitLvl(4).toFixed(3)} vs ${hitLvl(5).toFixed(3)})`);
// CC1 dynamics
const dynT = (v) => { setup({ ...dry }); lab.ex.controlChange(1, v); return mono(lab.render(1.2, [{ at: 0, note: 60, vel: .6 }])); };
const pp = dynT(0.1), ff = dynT(1);
check(centroid(ff, 48000, 700) > centroid(pp, 48000, 700) * 1.3, `CC1 opens the sound (centroid ${centroid(pp, 48000, 700).toFixed(0)} → ${centroid(ff, 48000, 700).toFixed(0)} Hz)`);
// pump: ducks each beat (at 120 bpm the level dips every 500 ms)
setup({ ...dry, PUMP: 1 }); x = mono(lab.render(2.5, [{ at: 0, note: 60, vel: .6 }], { transport: true, bpm: 120 }));
const d1 = rms(x, 48000 + 200, 48000 + 1200), d2 = rms(x, 48000 + 20000, 48000 + 21000);
check(d1 < d2 * 0.5, `pump ducks on the beat (${d1.toFixed(3)} just after vs ${d2.toFixed(3)} mid-beat)`);
// CPU
setup({}); const t0 = performance.now(); lab.render(10, Array.from({ length: 10 }, (_, i) => ({ at: 0, note: 40 + i * 3, vel: .8 })));
const ms = performance.now() - t0; check(ms < 2500, `10 notes × 3 sections × 5 voices, 10 s: ${ms.toFixed(0)} ms (${(ms / 100).toFixed(1)}% of a core)`);
setup({ OSTINATO: 1, PATTERN: 2 });
wav(tmpWav("col-demo"), lab.render(8, [45, 52, 57, 60, 64].map((n) => ({ at: 0, note: n, vel: .8 })), { transport: true, bpm: 100 }));
console.log(ok ? "COLOSSUS OK" : "COLOSSUS FAILURES"); process.exitCode = ok ? 0 : 1;
});
