#!/usr/bin/env node
// pack-moog.mjs — compile scripts/seeds/moog.ts and pack it (with moog.html) into
// the committed showpiece .vstai used on the landing page.
//
//   node scripts/seeds/pack-moog.mjs
//
// Requires the bundled compiler (compiler/asc-driver.mjs + its node_modules),
// which you already have locally. The output .vstai is committed, so CI never
// needs to recompile it.

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT  = path.join(ROOT, "docs", "gallery", "data", "vibe-synth.vstai");

const tmpWasm = path.join(os.tmpdir(), "moog-seed.wasm");
const r = spawnSync(process.execPath,
  [path.join(ROOT, "compiler", "asc-driver.mjs"), path.join(HERE, "moog.ts"), tmpWasm],
  { stdio: "inherit" });
if (r.status !== 0) { console.error("asc compile failed"); process.exit(1); }

const wasmBase64 = (await fs.readFile(tmpWasm)).toString("base64");
const html = await fs.readFile(path.join(HERE, "moog.html"), "utf8");
// Ship the AssemblyScript source too, so anyone who downloads this .vstai can open
// it in the editor and iterate on the DSP (not just play the compiled WASM).
const assembly = await fs.readFile(path.join(HERE, "moog.ts"), "utf8");

const params = [
  ["Tune", 0, -12, 12, 0], ["Glide", 1, 0, 1, 0.05],
  ["Osc1 Wave", 2, 0, 3, 1], ["Osc1 Oct", 3, -2, 2, 0],
  ["Osc2 Wave", 4, 0, 3, 1], ["Osc2 Oct", 5, -2, 2, 0], ["Osc2 Detune", 6, -50, 50, 7],
  ["Osc3 Wave", 7, 0, 3, 2], ["Osc3 Oct", 8, -2, 2, -1], ["Osc3 Detune", 9, -50, 50, -5],
  ["Mix Osc1", 10, 0, 1, 0.9], ["Mix Osc2", 11, 0, 1, 0.7], ["Mix Osc3", 12, 0, 1, 0.5], ["Noise", 13, 0, 1, 0.06],
  ["Cutoff", 14, 0, 1, 0.42], ["Resonance", 15, 0, 1, 0.2], ["Filter Env", 16, 0, 1, 0.6],
  ["Filt Atk", 17, 0, 1, 0.04], ["Filt Dec", 18, 0, 1, 0.5], ["Filt Sus", 19, 0, 1, 0.25], ["Filt Rel", 20, 0, 1, 0.4],
  ["Amp Atk", 21, 0, 1, 0.02], ["Amp Dec", 22, 0, 1, 0.4], ["Amp Sus", 23, 0, 1, 0.8], ["Amp Rel", 24, 0, 1, 0.35],
  ["Drive", 25, 0, 1, 0.3], ["Volume", 26, 0, 1, 0.8],
  ["Chorus Mix", 27, 0, 1, 0.35], ["Chorus Rate", 28, 0, 1, 0.3], ["Chorus Depth", 29, 0, 1, 0.5],
  ["Delay Mix", 30, 0, 1, 0.22], ["Delay Time", 31, 0, 1, 0.4], ["Delay Feedback", 32, 0, 1, 0.4],
  ["Reverb Mix", 33, 0, 1, 0.3], ["Reverb Size", 34, 0, 1, 0.6], ["Reverb Damp", 35, 0, 1, 0.4],
  // arpeggiator (lives in the WASM — follows DAW MIDI, runs with the GUI closed)
  ["Arp", 36, 0, 1, 1], ["Arp Rate", 37, 0, 1, 0.5], ["Arp Octaves", 38, 1, 4, 2],
  ["Arp Gate", 39, 0.1, 1, 0.5], ["Arp Mode", 40, 0, 3, 0],
].map(([name, index, min, max, def]) => ({ name, index, min, max, default: def, value: def }));

const doc = {
  format: 1,
  name: "VibeSynth",
  isInstrument: true,
  explanation: "A monophonic analog-style synthesizer: three anti-aliased oscillators with per-osc octave and detune, a noise source, a four-pole resonant ladder filter with drive, independent filter and amplifier ADSR envelopes, and portamento glide. A stereo effects rack adds chorus, ping-pong delay and reverb, with live oscilloscope + spectrum displays. Play it with the keyboard, your computer keys (a–k), or MIDI.",
  params,
  assembly,
  wasmBase64,
  html,
  publishedAt: 1750000002000,
};

await fs.writeFile(OUT, JSON.stringify(doc));
console.log("Wrote " + path.relative(ROOT, OUT) + "  (" + (wasmBase64.length / 1024 | 0) + " KB wasm b64)");
