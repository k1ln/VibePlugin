import { tmpdir } from "node:os";
const tmpWav = (n) => tmpdir() + "/" + n + ".wav";
import { Lab, mono, peak, rms, pitchAt, centroid, wav } from "./lab.mjs";
import("../../strings/defs.mjs").then(async (m) => {
const K = {}; m.TESSITURA.forEach((d, i) => K[d.key] = i);
const lab = new Lab(process.argv[2]);
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
function setup(o = {}) { lab.reset(); for (const [k, v] of Object.entries(o)) lab.set(K[k], v); }
let ok = true; const check = (c, s) => { console.log((c ? "ok   " : "FAIL ") + s); if (!c) ok = false; };
const finite = (x) => x.every(Number.isFinite);

// 1) one player, no vibrato: in tune
for (const [n, sec] of [[40, 1], [55, 3], [69, 0], [84, 0]]) {
  setup({ PLAYERS: 1, VIB: 0, HUMAN: 0, TIGHT: 1, SECTION: sec, MIC_AMB: 0 });
  const x = mono(lab.render(1.5, [{ at: 0, note: n, vel: .6 }]));
  const f = pitchAt(x, 48000, 900, 300, hz(n) * .7, hz(n) * 1.4);
  check(Math.abs(1200 * Math.log2(f / hz(n))) < 8, `note ${n} (single player): ${f.toFixed(2)} Hz, ${(1200 * Math.log2(f / hz(n))).toFixed(1)} cents`);
}
// 2) chord, section: sounds, finite, sane level
setup({});
let x = mono(lab.render(3, [36, 48, 55, 64, 72].map((n) => ({ at: 0, note: n, vel: .6 })).concat([36, 48, 55, 64, 72].map((n) => ({ at: 2, off: true, note: n })))));
check(finite(x) && peak(x) > 0.05 && peak(x) < 1.0, `5-note chord: peak ${peak(x).toFixed(3)}, rms(0.5–2 s) ${rms(x, 24000, 96000).toFixed(3)}, finite ${finite(x)}`);
check(rms(x, 136000, 144000) < rms(x, 24000, 96000) * 0.25, `release dies away (tail rms ${rms(x, 136000, 144000).toFixed(4)})`);
// 3) articulations
const art = (a, extra = {}) => { setup({ ART: a, MIC_AMB: 0, ...extra }); return mono(lab.render(2, [{ at: 0, note: 60, vel: .7 }, { at: 1.2, off: true, note: 60 }])); };
const sus = art(0), trem = art(1), pizz = art(2), spic = art(3), marc = art(4), harm = art(5), pont = art(6), cl = art(7);
const tail = (x) => rms(x, 60000, 72000) / (rms(x, 2400, 12000) + 1e-9);
check(tail(pizz) < 0.5, `pizzicato decays while the key is held (late/early ${tail(pizz).toFixed(2)})`);
check(rms(spic, 14400, 24000) < rms(spic, 1000, 5000) * 0.2, `spiccato is a short stroke (${rms(spic, 1000, 5000).toFixed(3)} → ${rms(spic, 14400, 24000).toFixed(4)})`);
check(rms(marc, 1440, 4800) > rms(marc, 24000, 36000) * 1.3, `marcato bites then settles (${rms(marc, 1440, 4800).toFixed(3)} vs ${rms(marc, 24000, 36000).toFixed(3)})`);
{ // tremolo: amplitude modulation near the tremolo rate
  const env = []; for (let i = 24000; i < 48000; i += 240) env.push(rms(trem, i, i + 240));
  const mean = env.reduce((a, b) => a + b) / env.length; let cross = 0; for (let i = 1; i < env.length; i++) if ((env[i - 1] - mean) * (env[i] - mean) < 0) cross++;
  check(cross > 6, `tremolo: bow reversals modulate the level (${cross} crossings in 0.5 s)`); }
{ const fh = pitchAt(harm, 48000, 700, 300, 300, 800); check(Math.abs(1200 * Math.log2(fh / hz(72))) < 30, `harmonics sound an octave up (${fh.toFixed(1)} Hz)`); }
check(centroid(pont, 48000, 600) > centroid(sus, 48000, 600) * 1.15, `sul ponticello is brighter (centroid ${centroid(sus, 48000, 600).toFixed(0)} → ${centroid(pont, 48000, 600).toFixed(0)} Hz)`);
check(rms(cl, 24000, 36000) < rms(cl, 200, 4000) * 0.3, `col legno is a short tick`);
// 4) CC1 dynamics
const dynTest = (v) => { setup({ MIC_AMB: 0 }); lab.ex.controlChange(1, v); return mono(lab.render(1.5, [{ at: 0, note: 60, vel: .6 }])); };
const pp = dynTest(0.1), ff = dynTest(0.95);
check(rms(ff, 24000, 60000) > rms(pp, 24000, 60000) * 1.8 && centroid(ff, 48000, 800) > centroid(pp, 48000, 800), `CC1 pp→ff: louder ×${(rms(ff, 24000, 60000) / rms(pp, 24000, 60000)).toFixed(2)}, brighter ${centroid(pp, 48000, 800).toFixed(0)}→${centroid(ff, 48000, 800).toFixed(0)} Hz`);
// 5) legato: overlap C4→G4 slides, one voice
setup({ LEGATO: 1, PLAYERS: 1, VIB: 0, MIC_AMB: 0, PORTA: 0.8 });
x = mono(lab.render(2.2, [{ at: 0, note: 60, vel: .6 }, { at: 1.0, note: 67, vel: .3 }, { at: 1.1, off: true, note: 60 }]));
const f1 = pitchAt(x, 48000, 700, 200, 200, 330), f2 = pitchAt(x, 48000, 1900, 200, 330, 460);
const dip = rms(x, 48000, 49500) / rms(x, 45000, 47000);
check(Math.abs(f1 / hz(60) - 1) < 0.01 && Math.abs(f2 / hz(67) - 1) < 0.01 && dip > 0.6, `legato C4→G4: ${f1.toFixed(1)} → ${f2.toFixed(1)} Hz, level through the join ×${dip.toFixed(2)} (no re-attack)`);
// 6) worst-case CPU
setup({ PLAYERS: 6 }); const t0 = performance.now();
lab.render(10, Array.from({ length: 12 }, (_, i) => ({ at: 0, note: 36 + i * 3, vel: .7 })));
const ms = performance.now() - t0; check(ms < 2500, `12 notes × 6 players, 10 s: ${ms.toFixed(0)} ms (${(ms / 100).toFixed(1)}% of a core)`);
setup({});
wav(tmpWav("tess-demo"), lab.render(8, [[48, 0], [55, 0], [64, 0], [72, 0]].map(([n, t]) => ({ at: t, note: n, vel: .55 })).concat([48, 55, 64, 72].map((n) => ({ at: 5.5, off: true, note: n })))));
console.log(ok ? "TESSITURA OK" : "TESSITURA FAILURES"); process.exitCode = ok ? 0 : 1;
});
