import { Lab } from "./lab.mjs";
import { readFileSync } from "node:fs";
const lab = new Lab(process.argv[2]);
const K = {}; JSON.parse(readFileSync(process.argv[3], "utf8")).params.forEach(p => K[p.name] = p.index);
const rows = Object.keys(K).filter(n => / Steps$/.test(n));
function solo(set) { lab.reset(); for (const r of rows) lab.set(K[r], 0); lab.set(K["Stereo Width"], 0); lab.set(K["Clock Source"], 1);
  for (const [k, v] of Object.entries(set)) lab.set(K[k], v); }
const onsets = (x, thr = 0.02, gap = 300) => { const o = []; let last = -1e9; for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) > thr) { if (i - last > gap) o.push(i); last = i; } } return o; };
let ok = true; const check = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) ok = false; };
// rim shot is 8 ms long: a clean onset marker
solo({ "RS Steps": 0xffff, "RS Level": 1 });
let on = onsets(lab.render(1.0, [], { transport: true, bpm: 120 }).L);
check(on.length >= 8 && on.slice(1, 8).every((v, i) => Math.abs(v - on[i] - 6000) <= 1), `DAW-locked 16ths at 120 bpm (spacing ${on[1] - on[0]})`);
solo({ "RS Steps": 0xffff, "RS Level": 1, Shuffle: 7 });
on = onsets(lab.render(1.0, [], { transport: true, bpm: 120 }).L);
check(Math.abs((on[1] - on[0]) - 9000) <= 2 && Math.abs((on[2] - on[1]) - 3000) <= 2, `shuffle 7 delays off-beats by half a step (gaps ${on[1] - on[0]}, ${on[2] - on[1]}; want 9000, 3000)`);
solo({ "RS Steps": 0xffff, "RS Level": 1, Shuffle: 4, Scale: 1 });
on = onsets(lab.render(1.0, [], { transport: true, bpm: 120 }).L);
check(Math.abs((on[1] - on[0]) - (8000 + 8000 * 2 / 12)) <= 2, `8th-triplet scale: shuffle 4 acts as 3 (gap ${on[1] - on[0]}, want ${8000 + 8000 * 2 / 12})`);
solo({ "RS Steps": 0x0001, "RS Level": 1, "Last Step": 3 });
on = onsets(lab.render(1.0, [], { transport: true, bpm: 120 }).L);
check(Math.abs(on[1] - on[0] - 18000) <= 2, `last step 3 (spacing ${on[1] - on[0]})`);
// flam on SD, interval 1 → 4 ms (192 samples) between strikes
solo({ "SD Steps": 0x0001, "SD Flam Steps": 0x0001, "Flam Interval": 1, "SD Snappy": 0 });
const b = lab.render(0.2, [], { transport: true, bpm: 120 }).L;
const pk = (a, n) => { let m = 0; for (let i = a; i < a + n; i++) m = Math.max(m, Math.abs(b[i])); return m; };
check(pk(0, 150) > 0.01 && pk(192, 150) > pk(0, 150) * 1.2, `flam: grace note then a stronger strike 4 ms later (${pk(0, 150).toFixed(3)} → ${pk(192, 150).toFixed(3)})`);
// accents: SD with local accent louder than plain; total accent adds on top
const sdPeak = (set) => { solo({ "SD Steps": 0x0001, ...set }); const x = lab.render(0.15, [], { transport: true, bpm: 120 }).L; return Math.max(...x.map(Math.abs)); };
const plain = sdPeak({}), local = sdPeak({ "SD Accent Steps": 1 }), total = sdPeak({ "Total Accent Steps": 1, "Total Accent": 1 }), both = sdPeak({ "SD Accent Steps": 1, "Total Accent Steps": 1, "Total Accent": 1 });
check(local > plain * 1.2 && total > plain * 1.4 && both > total, `accents: plain ${plain.toFixed(3)} < local ${local.toFixed(3)}, total ${total.toFixed(3)} < both ${both.toFixed(3)}`);
// internal clock
solo({ "RS Steps": 0x1111, "RS Level": 1, "Clock Source": 2, Run: 1, Tempo: 150 });
on = onsets(lab.render(1.0).L);
check(Math.abs(on[1] - on[0] - 19200) <= 2, `internal clock at 150 bpm (spacing ${on[1] - on[0]}, want 19200)`);
console.log(ok ? "909 SEQUENCER OK" : "909 SEQUENCER FAILURES"); process.exitCode = ok ? 0 : 1;
