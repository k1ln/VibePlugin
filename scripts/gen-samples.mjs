#!/usr/bin/env node
// gen-samples.mjs
// =====================================================================
//  Generates the royalty-free test samples for the gallery's effect player.
//
//  Every sample is synthesised from scratch here (oscillators, noise, simple
//  envelopes) — there is NO sampled or recorded audio, so the output is free of
//  any copyright/licence by construction (CC0 / public-domain-equivalent). They
//  exist only so you can hear an EFFECT working on something musical.
//
//      node scripts/gen-samples.mjs
//
//  Writes docs/gallery/samples/*.wav and samples/index.json (used by player.js).
// =====================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT  = path.join(HERE, "..", "docs", "gallery", "samples");
const SR   = 44100;

// ---- tiny WAV (16-bit PCM mono) encoder ----------------------------
function encodeWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, 44 + i * 2);
  }
  return buf;
}

// ---- helpers -------------------------------------------------------
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU  = Math.PI * 2;

class Track {
  constructor(seconds) { this.len = Math.round(seconds * SR); this.buf = new Float32Array(this.len); }
  // add a synthesised note. wave: sine|saw|square|tri|noise|fm
  note(startSec, durSec, freq, gain, wave = "saw", opt = {}) {
    const start = Math.round(startSec * SR), dur = Math.round(durSec * SR);
    const a = Math.round((opt.attack ?? 0.005) * SR);
    const r = Math.round((opt.release ?? 0.06) * SR);
    const detune = opt.detune ?? 0;
    const fm = opt.fmRatio ?? 0, fmDepth = opt.fmDepth ?? 0;
    let z = 0;                                  // one-pole lp state for noise/tone
    const lp = opt.lp ?? 1;                     // 0..1 lp coeff (1 = open)
    let seed = ((freq * 1000) | 0) ^ 0x9e3779b9;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return (seed >>> 0) / 4294967296 * 2 - 1; };
    for (let i = 0; i < dur && start + i < this.len; i++) {
      const t = i / SR;
      let env;
      if (i < a) env = i / a;
      else if (i > dur - r) env = Math.max(0, (dur - i) / r);
      else env = 1;
      if (opt.decay) env *= Math.exp(-t * opt.decay);
      const ph = t * freq;
      let s;
      if (wave === "sine") s = Math.sin(TAU * ph);
      else if (wave === "saw") s = 2 * (ph - Math.floor(ph + 0.5));
      else if (wave === "square") s = Math.sign(Math.sin(TAU * ph));
      else if (wave === "tri") s = 2 * Math.abs(2 * (ph - Math.floor(ph + 0.5))) - 1;
      else if (wave === "noise") s = rnd();
      else if (wave === "fm") s = Math.sin(TAU * ph + fmDepth * Math.sin(TAU * ph * fm));
      else s = 0;
      if (detune) s = 0.5 * s + 0.5 * (2 * ((t * freq * (1 + detune)) % 1) - 1);
      z += lp * (s - z);
      this.buf[start + i] += z * env * gain;
    }
    return this;
  }
  chord(startSec, durSec, midis, gain, wave, opt) {
    for (const m of midis) this.note(startSec, durSec, mtof(m), gain / Math.sqrt(midis.length), wave, opt);
    return this;
  }
  // soft-clip master + short fades so the loop has no click at the seam
  finish() {
    const f = Math.round(0.004 * SR);
    for (let i = 0; i < this.len; i++) {
      let s = Math.tanh(this.buf[i] * 1.1);
      if (i < f) s *= i / f;
      if (i > this.len - f) s *= (this.len - i) / f;
      this.buf[i] = s;
    }
    return this.buf;
  }
}

// drum voices ---------------------------------------------------------
function kick(tr, t, g = 0.9) {
  const dur = 0.28, n = Math.round(dur * SR), s = Math.round(t * SR);
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR, f = 120 * Math.exp(-x * 30) + 45;
    tr.buf[s + i] += Math.sin(TAU * f * x) * Math.exp(-x * 9) * g;
  }
}
function snare(tr, t, g = 0.6) {
  const dur = 0.2, n = Math.round(dur * SR), s = Math.round(t * SR); let seed = (s ^ 0x1234) | 1;
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR; seed = (seed * 1103515245 + 12345) | 0;
    const noise = (seed >>> 0) / 4294967296 * 2 - 1;
    const tone = Math.sin(TAU * 190 * x) * 0.5;
    tr.buf[s + i] += (noise * 0.8 + tone) * Math.exp(-x * 22) * g;
  }
}
function hat(tr, t, g = 0.3, open = false) {
  const dur = open ? 0.18 : 0.05, n = Math.round(dur * SR), s = Math.round(t * SR); let seed = (s ^ 0x55) | 1;
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR; seed = (seed * 1103515245 + 12345) | 0;
    const noise = (seed >>> 0) / 4294967296 * 2 - 1;
    tr.buf[s + i] += noise * Math.exp(-x * (open ? 18 : 70)) * g;
  }
}
function clap(tr, t, g = 0.5) {
  for (const off of [0, 0.01, 0.02, 0.035]) snare(tr, t + off, g * 0.5);
}

// ---- the 20 samples (2 bars @ 120 BPM = 4 s; 1 beat = 0.5 s) --------
const B = 0.5, BARS = 4;            // seconds per beat, total seconds
const makers = {
  "drums-four-on-floor": () => { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) { kick(t, i * B); hat(t, i * B + B / 2, 0.25); }
    for (let i = 1; i < 8; i += 2) snare(t, i * B, 0.5); return t; },
  "drums-breakbeat": () => { const t = new Track(BARS);
    const k = [0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5], s = [1, 3, 5, 7];
    k.forEach((b) => kick(t, b * B)); s.forEach((b) => snare(t, b * B));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.2, i % 4 === 2); return t; },
  "drums-kick": () => { const t = new Track(BARS); for (let i = 0; i < 8; i++) kick(t, i * B); return t; },
  "drums-snare": () => { const t = new Track(BARS); for (let i = 0; i < 8; i++) snare(t, i * B, 0.6); return t; },
  "drums-hats": () => { const t = new Track(BARS); for (let i = 0; i < 32; i++) hat(t, i * (B / 4), 0.28, i % 8 === 6); return t; },
  "drums-clap": () => { const t = new Track(BARS); for (let i = 1; i < 8; i += 2) clap(t, i * B); return t; },
  "bass-sub": () => { const t = new Track(BARS); const seq = [36, 36, 43, 41];
    seq.forEach((m, i) => t.note(i * B * 2, B * 1.8, mtof(m), 0.9, "sine", { release: 0.1 })); return t; },
  "bass-saw": () => { const t = new Track(BARS); const seq = [40, 40, 47, 45, 40, 40, 43, 38];
    seq.forEach((m, i) => t.note(i * B, B * 0.9, mtof(m), 0.5, "saw", { lp: 0.18, decay: 1.5 })); return t; },
  "bass-reese": () => { const t = new Track(BARS); const seq = [33, 33, 40, 31];
    seq.forEach((m, i) => t.note(i * B * 2, B * 1.9, mtof(m), 0.55, "saw", { detune: 0.012, lp: 0.25 })); return t; },
  "chords-pad": () => { const t = new Track(BARS);
    t.chord(0, BARS / 2, [48, 55, 60, 64], 0.5, "saw", { attack: 0.4, release: 0.6, lp: 0.12, detune: 0.008 });
    t.chord(BARS / 2, BARS / 2, [45, 52, 57, 60], 0.5, "saw", { attack: 0.4, release: 0.6, lp: 0.12, detune: 0.008 }); return t; },
  "chords-stab": () => { const t = new Track(BARS); const ch = [[48, 52, 55], [50, 53, 57], [45, 48, 52], [47, 50, 55]];
    for (let i = 0; i < 8; i++) t.chord(i * B, 0.18, ch[i % 4], 0.5, "square", { lp: 0.3, release: 0.05 }); return t; },
  "arp-up": () => { const t = new Track(BARS); const notes = [60, 64, 67, 72];
    for (let i = 0; i < 32; i++) t.note(i * (B / 4), B / 4, mtof(notes[i % 4]), 0.45, "square", { lp: 0.4, decay: 4 }); return t; },
  "pluck-melody": () => { const t = new Track(BARS); const mel = [72, 71, 67, 69, 72, 74, 67, 76];
    mel.forEach((m, i) => t.note(i * B, B * 0.8, mtof(m), 0.5, "tri", { decay: 3, release: 0.1 })); return t; },
  "bell-fm": () => { const t = new Track(BARS); const mel = [76, 79, 83, 79, 76, 72, 74, 76];
    mel.forEach((m, i) => t.note(i * B, B * 0.9, mtof(m), 0.45, "fm", { fmRatio: 2.0, fmDepth: 4, decay: 2.5 })); return t; },
  "lead-saw": () => { const t = new Track(BARS); const mel = [64, 67, 71, 69, 67, 64, 62, 60];
    mel.forEach((m, i) => t.note(i * B, B * 0.95, mtof(m), 0.4, "saw", { lp: 0.5, release: 0.08 })); return t; },
  "noise-white": () => { const t = new Track(BARS); t.note(0, BARS, 1, 0.4, "noise", { attack: 0.01, release: 0.05, lp: 1 }); return t; },
  "noise-sweep": () => { const t = new Track(BARS);
    for (let i = 0; i < t.len; i++) { const x = i / t.len; const lp = 0.02 + 0.9 * (0.5 - 0.5 * Math.cos(TAU * x));
      let seed = (i * 2654435761) | 0; const nz = ((seed >>> 0) / 4294967296 * 2 - 1);
      t.buf[i] = (t._z = (t._z || 0) + lp * (nz - (t._z || 0))) * 0.6; } return t; },
  "vocal-aah": () => { const t = new Track(BARS);   // formant-ish stacked sines = "aah"
    const f0s = [[55], [57], [53], [55]];
    f0s.forEach((g, i) => { const base = mtof(g[0]);
      [1, 2, 3, 4.6, 7].forEach((h, k) => t.note(i * B * 2, B * 1.9, base * h, 0.32 / (k + 1), "sine", { attack: 0.08, release: 0.2 })); }); return t; },
  "guitar-pluck": () => { const t = new Track(BARS);   // karplus-strong-ish via fast-decaying detuned saw
    const ch = [[52, 55, 59, 64], [50, 53, 57, 62]];
    ch.forEach((c, i) => c.forEach((m, k) => t.note(i * (BARS / 2) + k * 0.03, BARS / 2 - 0.1, mtof(m), 0.4, "saw", { decay: 2, lp: 0.3, release: 0.2 }))); return t; },
  "tone-440": () => { const t = new Track(BARS); t.note(0, BARS, 440, 0.5, "sine", { attack: 0.02, release: 0.05 }); return t; },
};

const NICE = {
  "drums-four-on-floor": "Drums — Four on the Floor", "drums-breakbeat": "Drums — Breakbeat",
  "drums-kick": "Drums — Kick", "drums-snare": "Drums — Snare", "drums-hats": "Drums — Hi-hats",
  "drums-clap": "Drums — Claps", "bass-sub": "Bass — Sub", "bass-saw": "Bass — Saw",
  "bass-reese": "Bass — Reese", "chords-pad": "Chords — Pad", "chords-stab": "Chords — Stabs",
  "arp-up": "Arp — Up", "pluck-melody": "Pluck — Melody", "bell-fm": "Bell — FM",
  "lead-saw": "Lead — Saw", "noise-white": "Noise — White", "noise-sweep": "Noise — Sweep",
  "vocal-aah": "Vocal — Aah", "guitar-pluck": "Guitar — Pluck", "tone-440": "Tone — 440 Hz",
};

await fs.mkdir(OUT, { recursive: true });
const index = [];
for (const [key, make] of Object.entries(makers)) {
  const buf = encodeWav(make().finish());
  const file = key + ".wav";
  await fs.writeFile(path.join(OUT, file), buf);
  const kind = key.startsWith("drums") ? "drums" : key.startsWith("bass") ? "bass"
    : key.startsWith("noise") || key.startsWith("tone") ? "test" : "melodic";
  index.push({ file, name: NICE[key] || key, kind });
}
await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 0) + "\n");
console.log(`Generated ${index.length} royalty-free samples in ${OUT}`);
