#!/usr/bin/env node
// render-demos.mjs <wasm> <outDir> — every preset as a WAV, one reel per category,
// and a few beats sequenced from the presets (one engine per voice, mixed).
import { mkdirSync } from "node:fs";
import { Engine, writeWav, metrics } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
const [wasm, out] = process.argv.slice(2); const SR = 48000;
const safe = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "");
const byName = Object.fromEntries(PRESETS.map((p) => [p.name, p]));
function hit(p, sec, note = 36, vel = 0.95) { const e = new Engine(wasm, SR); e.setPatch(p.set, 120); return e.render(sec, [{ t: 0, type: "on", note, vel }]); }
function trimLen(buf, maxSec) { // cut after the tail falls below -60 dB of peak, with a 30 ms fade
  const pk = metrics(buf).peak || 1; let last = 0;
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > pk * 0.001) last = i;
  let n = Math.min(Math.ceil(last / 2) + 1, Math.round(maxSec * SR));
  const o = buf.slice(0, n * 2), f = Math.min(n, 1440);
  for (let i = 0; i < f; i++) { const g = i / f; o[(n - 1 - i) * 2] *= g; o[(n - 1 - i) * 2 + 1] *= g; }
  return o;
}
// 1) single presets + 2) category reels
const cats = {};
PRESETS.forEach((p, i) => (cats[p.cat] = cats[p.cat] || []).push([i, p]));
for (const [cat, list] of Object.entries(cats)) {
  mkdirSync(`${out}/presets/${cat}`, { recursive: true });
  const parts = [];
  for (const [i, p] of list) {
    const long = p.set.RV_DEC > 2 || p.set.T_DEC > 2000 || p.set.M_DEC > 2000 || p.set.X_DEC > 1500 || p.set.N_DEC > 1500;
    const b = trimLen(hit(p, long ? 7 : 3.5), long ? 7 : 3.5);
    writeWav(`${out}/presets/${cat}/${String(i).padStart(3, "0")}_${safe(p.name)}.wav`, b, SR);
    parts.push(trimLen(b, 1.6), new Float32Array(Math.round(0.25 * SR) * 2));
  }
  const tot = parts.reduce((s, a) => s + a.length, 0), reel = new Float32Array(tot); let o = 0;
  for (const a of parts) { reel.set(a, o); o += a.length; }
  mkdirSync(`${out}/reels`, { recursive: true });
  writeWav(`${out}/reels/${cat}_reel.wav`, reel, SR);
  console.log(`${cat}: ${list.length} presets`);
}
// 3) beats: tracks = [preset, steps string (16ths, x = hit, X = accent), note]
function beat(name, bpm, bars, tracks) {
  const step = 60 / bpm / 4, sec = bars * 16 * step + 2.5, mix = new Float32Array(Math.round(sec * SR) * 2);
  for (const [pn, pat, note = 36, gain = 1] of tracks) {
    const p = byName[pn]; if (!p) throw new Error("no preset " + pn);
    const ev = [];
    for (let b = 0; b < bars; b++) for (let s = 0; s < 16; s++) { const c = pat[s % pat.length]; if (c === "x" || c === "X") ev.push({ t: (b * 16 + s) * step, type: "on", note, vel: c === "X" ? 1 : 0.75 }); }
    const e = new Engine(wasm, SR); e.setPatch(p.set, bpm);
    const b = e.render(sec, ev);
    for (let i = 0; i < mix.length; i++) mix[i] += b[i] * gain;
  }
  const pk = metrics(mix).peak; for (let i = 0; i < mix.length; i++) mix[i] = Math.tanh(mix[i] / pk * 1.1) * 0.89;
  mkdirSync(`${out}/beats`, { recursive: true }); writeWav(`${out}/beats/${name}.wav`, mix, SR); console.log("beat", name);
}
beat("Techno_130", 130, 4, [["Techno Rumble", "X...X...X...X..."], ["Clap Techno Dist", "....x.......x..."], ["CH 909 Sharp", "..x...x...x...x.", 36, 0.6], ["OH 909 Sizzle", "..........x.....", 36, 0.5], ["Ride Ping", "x.x.x.x.x.x.x.x.", 36, 0.35]]);
beat("House_124", 124, 4, [["House Deep", "X...X...X...X..."], ["Clap House", "....x.......x..."], ["CH 808 Tight", "xxxxxxxxxxxxxxxx", 36, 0.45], ["OH 808 Short", "..x...x...x...x.", 36, 0.5], ["Shaker", "x.xxx.xxx.xxx.xx", 36, 0.35], ["Conga Open", "...x.....x..x...", 36, 0.5]]);
beat("Trap_140", 140, 4, [["Trap 808 Glide", "X.........X....."], ["Trap Snare Crack", "........X......."], ["Trap Hat Roll Up", "x...x...x...x..."  , 36, 0.5], ["CH 808 Tight", "..x...x.x.x...xx", 36, 0.5], ["Clap Trap Layered", "........x.......", 36, 0.6]]);
beat("Gabber_180", 180, 4, [["Gabber 90s", "X...X...X...X..."], ["Hardcore Snare", "....x.......x..."], ["CH Industrial", "..x...x...x...x.", 36, 0.5], ["China Chaos", "x...............", 36, 0.5]]);
beat("Hardstyle_150", 150, 4, [["Euphoric Hardstyle", "X...X...X...X..."], ["Clap Big Room", "....x.......x..."], ["OH 808 Short", "..x...x...x...x.", 36, 0.5]]);
beat("DnB_174", 174, 4, [["DnB Sub Punch", "X.........X....."], ["DnB Snare Layered", "....X.......X..."], ["CH Hi-NRG", "x.x.x.x.x.x.x.x.", 36, 0.5], ["Ride Wash", "x...............", 36, 0.3]]);
beat("BoomBap_90", 90, 4, [["Lo-Fi Dust Kick", "X......x..X....."], ["Boom Bap Snare", "....X.......X..."], ["CH Lo-Fi Dirty", "x.x.x.x.x.x.x.x.", 36, 0.5], ["Tambourine", "....x.......x...", 36, 0.3]]);
beat("Industrial_120", 120, 4, [["Industrial Kick Crush", "X..x..X...X..x.."], ["Industrial Snare Smash", "....X.......X..."], ["Metal Pipe", "......x.......x.", 36, 0.5], ["CH Crushed", "xx.xxx.xxx.xxx.x", 36, 0.4], ["Forge Hammer", "x...............", 36, 0.4]]);
beat("Acoustic_100", 100, 4, [["Rock Kick Modal", "X.....X.X......."], ["Rock Snare Tight", "....X.......X..."], ["Ride Ping", "x.x.x.x.x.x.x.x.", 36, 0.5], ["Floor Tom", "..............x.", 36, 0.6], ["Rack Tom Mid", ".............x..", 36, 0.6], ["Crash Bright", "x...............", 36, 0.4]]);
