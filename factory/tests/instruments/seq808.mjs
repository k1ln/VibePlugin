import { Lab } from "./lab.mjs";
const lab = new Lab(process.argv[2]);
const SR = 48000;
// onset detector on the BD-only output: first sample of each hit
function onsets(x, thr = 0.02, hold = 2000) { const o = []; let last = -1e9; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr && i - last > hold) { o.push(i); last = i; } else if (Math.abs(x[i]) > thr) last = i; return o; }
function solo(rowIdx, bits, extra = {}) {
  lab.reset();
  for (let i = 31; i < 55; i++) lab.set(i, 0);
  lab.set(55, 0);
  for (const [k, v] of Object.entries(extra)) lab.set(+k, v);
  if (rowIdx != null) lab.set(rowIdx, bits);
}
let ok = true; const check = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) ok = false; };

// 1) follow-DAW, 120 bpm, 16ths, BD on steps 1,5,9,13 → every 0.5 s exactly
solo(31, 0x1111, { 29: 1, 26: 3, 27: 16, 28: 0 });
let b = lab.render(2.2, [], { transport: true, bpm: 120 });
let on = onsets(b.L);
console.log("  onsets (samples):", on.join(", "));
check(on.length >= 4 && on.slice(0, 4).every((v, i) => Math.abs(v - on[0] - i * 24000) <= 1) && on[0] < 8, "DAW-locked BD every 24000 samples exactly at 120 bpm, first within 8 samples of 0");

// 2) pre-scale 1 (3 steps per beat): BD on every step → 6 hits/second at 120 bpm
solo(36, 0xffff, { 29: 1, 26: 1, 27: 16, 13: 1 });   // rim shot row: 10 ms, no overlap
b = lab.render(1.01, [], { transport: true, bpm: 120 });
on = onsets(b.L, 0.02, 1500);
check(on.length === 7 && Math.abs(on[1] - on[0] - 8000) <= 2, `pre-scale 1 → 3 steps/beat (got ${on.length} hits, spacing ${on[1] - on[0]})`);

// 3) last step = 3: BD on step 1 only → pattern repeats every 3 sixteenths
solo(31, 0x0001, { 29: 1, 26: 3, 27: 3 });
b = lab.render(1.0, [], { transport: true, bpm: 120 });
on = onsets(b.L, 0.02, 1500);
check(on.length >= 3 && Math.abs(on[1] - on[0] - 18000) <= 2, `last step 3 → repeat every 3 steps (spacing ${on[1] - on[0]}, want 18000)`);

// 4) variation AB: row A has BD on step 1, row B none → BD only every other bar
solo(31, 0x0001, { 29: 1, 26: 3, 27: 16, 28: 1 });
lab.set(43, 0);
b = lab.render(4.2, [], { transport: true, bpm: 120 });
on = onsets(b.L, 0.02, 1500);
check(on.length === 2 && Math.abs(on[1] - on[0] - 192000) <= 2, `AB alternation: BD in bars 1 and 3 only (onsets ${on.join(",")})`);

// 5) internal clock: source 2, run on, tempo click 18 → bpm = 40*7.5^(18/39)
solo(31, 0x1111, { 29: 2, 26: 3, 27: 16, 24: 18, 25: 0, 59: 1 });
b = lab.render(2.0);
on = onsets(b.L);
const bpm = 40 * Math.pow(7.5, 18 / 39), want = SR * 60 / bpm;
check(on.length >= 3 && Math.abs(on[1] - on[0] - want) <= 2, `internal clock at ${bpm.toFixed(1)} bpm (spacing ${on[1] - on[0]}, want ${want.toFixed(0)})`);

// 6) source MIDI-only: no transport-driven hits
solo(31, 0x1111, { 29: 0 });
b = lab.render(1.0, [], { transport: true, bpm: 120 });
check(onsets(b.L).length === 0, "MIDI-only mode ignores the DAW transport");

// 7) display reports the running step
solo(31, 0x1111, { 29: 1 });
lab.render(0.2, [], { transport: true, bpm: 120 });
const d = lab.display();
check(d[2] === 1 && d[0] === 1, `display: running=1, step=${d[0]} (want 1 at 0.2 s)`);

// 8) accent: accented step louder
solo(31, 0x0003, { 29: 1, 0: 1 }); lab.set(42, 0x0002);  // accent on step 2
b = lab.render(0.3, [], { transport: true, bpm: 120 });
const pk = (a, n) => { let m = 0; for (let i = a; i < a + n; i++) m = Math.max(m, Math.abs(b.L[i])); return m; };
const p1 = pk(0, 5000), p2 = pk(6000, 5000);
check(p2 > p1 * 2.2, `accented step ${(p2 / p1).toFixed(2)}× louder`);
console.log(ok ? "SEQUENCER OK" : "SEQUENCER FAILURES"); process.exitCode = ok ? 0 : 1;
