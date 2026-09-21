import { tmpdir } from "node:os";
const tmpWav = (n) => tmpdir() + "/" + n + ".wav";
import { Lab, mono, peak, rms, pitchAt, centroid, wav } from "./lab.mjs";
import("../../strings/defs.mjs").then((m) => {
const K = {}; m.ALEATORA.forEach((d, i) => K[d.key] = i);
const lab = new Lab(process.argv[2]);
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
const calm = { CLUSTER: 0, SWARM: 0, SCRATCH: 0, SHIMMER: 0, CHAOS: 0, PLAYERS: 1, VIB: 0, HUMAN: 0, WET: 0 };
function setup(o = {}) { lab.reset(); for (const [k, v] of Object.entries(o)) lab.set(K[k], v); }
let ok = true; const check = (c, s) => { console.log((c ? "ok   " : "FAIL ") + s); if (!c) ok = false; };
// 1) rise: +12 st over 2 s → an octave up by the end
setup({ ...calm, RISE: 12, RISE_TIME: 2 });
let x = mono(lab.render(3, [{ at: 0, note: 57, vel: .6 }]));
const f0 = pitchAt(x, 48000, 300, 150, hz(57) * .85, hz(57) * 1.25), f1 = pitchAt(x, 48000, 2500, 200, hz(69) * .85, hz(69) * 1.2);
check(Math.abs(1200 * Math.log2(f1 / hz(69))) < 15 && f0 < hz(57) * 1.1, `rise +12 st / 2 s: ${f0.toFixed(1)} Hz → ${f1.toFixed(1)} Hz (want ${hz(69).toFixed(1)})`);
// 2) cluster + quarter-tone grid: player offsets spread and snap to 50 c
setup({ ...calm, CLUSTER: 150, QUARTER: 1, PLAYERS: 6, CHAOS: 0.5 });
lab.render(0.3, [{ at: 0, note: 60, vel: .6 }]);
let d = lab.display(); const span = 150 * (0.5 + 0.5) + 0 + 1;
const offs = d.slice(5, 11).map((v) => v * span);
check(new Set(offs.map((c) => Math.round(c))).size >= 3 && offs.every((c) => Math.abs(c / 50 - Math.round(c / 50)) < 0.05), `cluster ±150 c on a quarter-tone grid: players at ${offs.map((c) => Math.round(c)).join(", ")} cents`);
// 3) swarm: offsets move over time
setup({ ...calm, SWARM: 3, SWARM_SPEED: 0.6, PLAYERS: 6, CHAOS: 0.5 });
lab.render(0.5, [{ at: 0, note: 60, vel: .6 }]); const a = lab.display().slice(5, 11);
lab.render(1.0); const b = lab.display().slice(5, 11);
check(a.some((v, i) => Math.abs(v - b[i]) > 0.1), `swarm moves players (${a.map((v) => v.toFixed(2)).join(" ")} → ${b.map((v) => v.toFixed(2)).join(" ")})`);
// 4) freeze holds the tail after release (level at 11 s vs 2 s)
setup({ ...calm, WET: 1, DRY: 0, FREEZE: 1, HALL_SIZE: 0.5 });
x = mono(lab.render(12, [{ at: 0, note: 60, vel: .7 }, { at: 1.5, off: true, note: 60 }]));
const h2 = rms(x, 2 * 48000, 2.5 * 48000), h11 = rms(x, 11 * 48000, 11.5 * 48000);
check(h11 > h2 * 0.6, `freeze holds the hall: ${h2.toFixed(4)} at 2 s → ${h11.toFixed(4)} at 11 s`);
// 5) pulse locked to the DAW: 1/8 at 120 bpm → 4 Hz level modulation
setup({ ...calm, PULSE: 1, PULSE_DIV: 1, PLAYERS: 3 });
x = mono(lab.render(3, [{ at: 0, note: 60, vel: .7 }], { transport: true, bpm: 120 }));
const env = []; for (let i = 48000; i + 480 <= 144000; i += 240) env.push(rms(x, i, i + 480));
const mean = env.reduce((p, q) => p + q) / env.length, e = env.map((v) => v - mean);
let best = 0, lagBest = 0; for (let lag = 10; lag < 150; lag++) { let s2 = 0; for (let i = 0; i + lag < e.length; i++) s2 += e[i] * e[i + lag]; if (s2 > best) { best = s2; lagBest = lag; } }
check(Math.abs(lagBest * 5 - 250) <= 5, `pulse 1/8 at 120 bpm: envelope period ${lagBest * 5} ms (want 250)`);
// 6) scratch roughens the tone
const cen = (sc) => { setup({ ...calm, SCRATCH: sc, PLAYERS: 4 }); return centroid(mono(lab.render(1.5, [{ at: 0, note: 60, vel: .6 }])), 48000, 900); };
const c0 = cen(0), c1 = cen(1);
check(c1 > c0 * 1.1, `scratch adds grit (centroid ${c0.toFixed(0)} → ${c1.toFixed(0)} Hz)`);
// 7) full chaos: stable, bounded
setup({ CHAOS: 1, SWARM: 12, CLUSTER: 300, SCRATCH: 1, SHIMMER: 1, RISE: -24, RISE_TIME: 3, PLAYERS: 6 });
x = mono(lab.render(4, [48, 55, 60, 67].map((n) => ({ at: 0, note: n, vel: 1 }))));
check(x.every(Number.isFinite) && peak(x) <= 1.0 && rms(x, 48000, 192000) > 0.01, `everything at maximum: finite, peak ${peak(x).toFixed(2)}, rms ${rms(x, 48000, 192000).toFixed(3)}`);
// 8) CPU: 8 notes × 6 players, swarm + rise on
setup({ CHAOS: 0.6, SWARM: 4, RISE: 7, PLAYERS: 6 }); const t0 = performance.now();
lab.render(10, Array.from({ length: 8 }, (_, i) => ({ at: 0, note: 48 + i * 3, vel: .7 })));
const ms = performance.now() - t0; check(ms < 2500, `8 notes × 6 players swarming, 10 s: ${ms.toFixed(0)} ms (${(ms / 100).toFixed(1)}% of a core)`);
setup({});
wav(tmpWav("alea-demo"), lab.render(10, [{ at: 0, note: 48, vel: .6 }, { at: 0, note: 55, vel: .6 }, { at: .5, note: 63, vel: .6 }, { at: 6, off: true, note: 48 }, { at: 6, off: true, note: 55 }, { at: 6, off: true, note: 63 }]));
console.log(ok ? "ALEATORA OK" : "ALEATORA FAILURES"); process.exitCode = ok ? 0 : 1;
});
