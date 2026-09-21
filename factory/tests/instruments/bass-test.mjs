import { Lab, mono, rms, peak } from "./lab.mjs";
// zero-crossing frequency over a window: robust for these near-sinusoids
const pitchAt = (x, sr, t0, len) => { const a = Math.round(t0 * sr / 1000), b = a + Math.round(len * sr / 1000); let c = 0, f = -1, l = -1;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { c++; if (f < 0) f = i; l = i; } return c > 1 ? (c - 1) * sr / (l - f) : 0; };
const lab = new Lab(process.argv[2]);
const K = { LEV:0,TONE:1,DEC:2,RELEASE:3,GLIDE:4,GLIDE_MODE:5,SIGH:6,CLICK:7,DRIVE:8,OCTAVE:9,BEND:10,AC:11,VEL:12 };
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
let ok = true; const check = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) ok = false; };
function setup(o = {}) { lab.reset(); lab.set(K.DRIVE, 0); lab.set(K.SIGH, 0); for (const [k, v] of Object.entries(o)) lab.set(K[k], v); }

// 1) plays the note's pitch across the range (no sigh, no glide)
for (const n of [28, 36, 43, 48]) {
  setup({ GLIDE: 0 });
  const x = mono(lab.render(0.6, [{ at: 0, note: n, vel: 0.6 }]));
  const p = pitchAt(x, 48000, 150, 120, 20, 400);
  check(Math.abs(p / hz(n) - 1) < 0.02, `note ${n}: ${p.toFixed(1)} Hz (want ${hz(n).toFixed(1)})`);
}
// 2) level roughly constant across the keyboard
{ const lv = [24, 36, 48].map(n => { setup({ GLIDE: 0 }); const x = mono(lab.render(0.5, [{ at: 0, note: n, vel: 0.6 }])); return rms(x, 4800, 14400); });
  check(Math.max(...lv) / Math.min(...lv) < 2.2, `level across C1/C2/C3 within 7 dB (rms ${lv.map(v => v.toFixed(3)).join(" / ")})`); }
// 3) legato glide: hold C2, add G2 at 0.3 s → pitch slides to G2 without a new strike
{ setup({ GLIDE: 0.4, GLIDE_MODE: 1, DEC: 0.9 });
  const x = mono(lab.render(1.2, [{ at: 0, note: 36, vel: .6 }, { at: 0.3, note: 43, vel: .6 }]));
  const mid = pitchAt(x, 48000, 330, 60, 30, 300), end = pitchAt(x, 48000, 800, 150, 30, 300);
  const before = rms(x, 14000, 14400), after = rms(x, 14600, 15000);
  check(mid > hz(36) * 1.03 && mid < hz(43) * 0.99 && Math.abs(end / hz(43) - 1) < 0.02, `legato glide C2→G2: ${mid.toFixed(1)} Hz mid-slide, ${end.toFixed(1)} Hz after (want ${hz(43).toFixed(1)})`);
  check(after < before * 1.5, `legato does not re-strike (rms around the new note ${before.toFixed(3)} → ${after.toFixed(3)})`); }
// 4) legato mode, separated notes: jumps, no glide
{ setup({ GLIDE: 0.4, GLIDE_MODE: 1 });
  const x = mono(lab.render(1.2, [{ at: 0, note: 36, vel: .6 }, { at: 0.2, off: true, note: 36 }, { at: 0.5, note: 43, vel: .6 }]));
  const p = pitchAt(x, 48000, 540, 60, 30, 300);
  check(Math.abs(p / hz(43) - 1) < 0.03, `legato mode, detached notes jump straight to G2 (${p.toFixed(1)} Hz)`); }
// 5) release: note-off shortens the tail
{ const tail = (rel) => { setup({ GLIDE: 0, DEC: 0.9, RELEASE: rel }); const x = mono(lab.render(1.0, [{ at: 0, note: 36, vel: .6 }, { at: 0.2, off: true, note: 36 }])); return rms(x, 24000, 28800); };
  const shortT = tail(0.1), ring = tail(1.0);
  check(shortT < ring * 0.05, `short release silences the tail (${shortT.toExponential(1)} vs let-ring ${ring.toFixed(3)})`); }
// 6) octave and pitch bend
{ setup({ GLIDE: 0, OCTAVE: -1 }); const x = mono(lab.render(0.6, [{ at: 0, note: 48, vel: .6 }]));
  const p = pitchAt(x, 48000, 150, 120, 20, 400); check(Math.abs(p / hz(36) - 1) < 0.02, `octave −1: C3 plays ${p.toFixed(1)} Hz`); }
{ setup({ GLIDE: 0, BEND: 12 }); lab.ex.controlChange(128, 1.0);
  const x = mono(lab.render(0.6, [{ at: 0, note: 36, vel: .6 }]));
  const p = pitchAt(x, 48000, 150, 120, 20, 400); check(Math.abs(p / hz(48) - 1) < 0.02, `bend +1 with range 12: C2 plays ${p.toFixed(1)} Hz (want ${hz(48).toFixed(1)})`); }
// 7) drive raises harmonics, not loudness
{ const r = (d) => { setup({ GLIDE: 0, DRIVE: d }); return mono(lab.render(0.5, [{ at: 0, note: 36, vel: .6 }])); };
  const a = r(0), b = r(1); check(peak(b) < 1.0 && rms(b) < rms(a) * 2.0, `drive stays in bounds (peak ${peak(b).toFixed(2)}, rms ×${(rms(b) / rms(a)).toFixed(2)})`); }
console.log(ok ? "BASS OK" : "BASS FAILURES"); process.exitCode = ok ? 0 : 1;
