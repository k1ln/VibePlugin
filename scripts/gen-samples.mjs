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

// =====================================================================
//  Extra library — 100 more royalty-free loops, all synthesised here.
//  Same construction (oscillators / noise / envelopes) → CC0 by design.
// =====================================================================

// extra percussion voices ----------------------------------------------
function tom(tr, t, f = 130, g = 0.5) {
  const dur = 0.25, n = Math.round(dur * SR), s = Math.round(t * SR);
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR, ff = f * (1 + Math.exp(-x * 12));
    tr.buf[s + i] += Math.sin(TAU * ff * x) * Math.exp(-x * 9) * g;
  }
}
function ride(tr, t, g = 0.22) {
  const dur = 0.3, n = Math.round(dur * SR), s = Math.round(t * SR); let seed = (s ^ 0xab) | 1;
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR; seed = (seed * 1103515245 + 12345) | 0;
    const nz = (seed >>> 0) / 4294967296 * 2 - 1;
    const tone = Math.sin(TAU * 5200 * x) * 0.3 + Math.sin(TAU * 7400 * x) * 0.2;
    tr.buf[s + i] += (nz * 0.5 + tone) * Math.exp(-x * 7) * g;
  }
}
function cow(tr, t, g = 0.33) {
  const dur = 0.12, n = Math.round(dur * SR), s = Math.round(t * SR);
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR;
    tr.buf[s + i] += (Math.sign(Math.sin(TAU * 560 * x)) + Math.sign(Math.sin(TAU * 845 * x))) * 0.4 * Math.exp(-x * 16) * g;
  }
}
function rim(tr, t, g = 0.4) {
  const dur = 0.05, n = Math.round(dur * SR), s = Math.round(t * SR);
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR;
    tr.buf[s + i] += Math.sin(TAU * 1700 * x) * Math.exp(-x * 120) * g;
  }
}
function sub808(tr, t, m = 31, g = 0.85) {
  const dur = 0.7, n = Math.round(dur * SR), s = Math.round(t * SR), f = mtof(m);
  for (let i = 0; i < n && s + i < tr.len; i++) {
    const x = i / SR, ff = f * (1 + 1.5 * Math.exp(-x * 35));
    tr.buf[s + i] += Math.sin(TAU * ff * x) * Math.exp(-x * 2.8) * g;
  }
}

// melodic builders -----------------------------------------------------
const SCALE = {
  minor:   [0, 2, 3, 5, 7, 8, 10],
  major:   [0, 2, 4, 5, 7, 9, 11],
  dorian:  [0, 2, 3, 5, 7, 9, 10],
  minPent: [0, 3, 5, 7, 10],
  majPent: [0, 2, 4, 7, 9],
};
const deg = (root, scale, d) => {
  const sc = SCALE[scale], n = sc.length, o = Math.floor(d / n), i = ((d % n) + n) % n;
  return root + 12 * o + sc[i];
};
// note sequence (null = rest) → maker
function seq(notes, { wave = "saw", gain = 0.5, dur = 0.45, step = B / 2, opt = {} } = {}) {
  return () => {
    const t = new Track(BARS);
    notes.forEach((m, i) => { if (m != null) t.note(i * step, dur, mtof(m), gain, wave, opt); });
    return t;
  };
}
// chord progression (each = midi array) spread evenly across the bar → maker
function prog(chords, { wave = "saw", gain = 0.45, opt = {} } = {}) {
  const hold = BARS / chords.length;
  return () => {
    const t = new Track(BARS);
    chords.forEach((c, i) => t.chord(i * hold, hold, c, gain, wave, opt));
    return t;
  };
}
// arpeggiate a scale-degree pattern across the bar → maker
function arp(root, scale, degrees, { wave = "square", gain = 0.45, div = B / 4, dur = null, opt = { lp: 0.4, decay: 4 } } = {}) {
  const steps = Math.round(BARS / div);
  return () => {
    const t = new Track(BARS);
    for (let i = 0; i < steps; i++)
      t.note(i * div, dur ?? div, mtof(deg(root, scale, degrees[i % degrees.length])), gain, wave, opt);
    return t;
  };
}

const wob = Array.from({ length: 32 }, (_, i) => (i % 8 === 3 ? 41 : 29));

const EXTRA = [
  // ---- drums -------------------------------------------------------
  { key: "drums-house-classic", kind: "drums", name: "Drums — House", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) { kick(t, i * B); hat(t, i * B + B / 2, 0.2, true); }
    for (let i = 1; i < 8; i += 2) clap(t, i * B, 0.45);
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.1); return t; } },
  { key: "drums-house-deep", kind: "drums", name: "Drums — Deep House", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) kick(t, i * B, 0.8);
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2) + B / 4, 0.13);
    clap(t, 1 * B, 0.3); clap(t, 5 * B, 0.3); return t; } },
  { key: "drums-techno-driving", kind: "drums", name: "Drums — Techno", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) kick(t, i * B, 0.95);
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2) + B / 4, 0.17, i % 4 === 3);
    for (let i = 1; i < 8; i += 2) rim(t, i * B, 0.3); return t; } },
  { key: "drums-techno-minimal", kind: "drums", name: "Drums — Minimal Techno", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) kick(t, i * B, 0.9);
    for (let i = 0; i < 8; i++) if (i % 4 === 2) cow(t, i * B, 0.22);
    hat(t, 1.5, 0.2, true); hat(t, 5.5, 0.2, true); return t; } },
  { key: "drums-trap-808", kind: "drums", name: "Drums — Trap 808", make() { const t = new Track(BARS);
    [[0, 31], [3, 31], [4, 29], [7, 34]].forEach(([b, m]) => sub808(t, b * B, m, 0.8));
    snare(t, 2 * B, 0.6); snare(t, 6 * B, 0.6);
    for (let i = 0; i < 32; i++) hat(t, i * (B / 4), 0.15);
    for (let i = 0; i < 4; i++) hat(t, 3 * B + i * (B / 8), 0.15); return t; } },
  { key: "drums-trap-bounce", kind: "drums", name: "Drums — Trap Bounce", make() { const t = new Track(BARS);
    [0, 1.5, 3, 4, 5.5, 7].forEach((b) => kick(t, b * B));
    snare(t, 2 * B, 0.55); snare(t, 6 * B, 0.55);
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.14); return t; } },
  { key: "drums-dnb-rolling", kind: "drums", name: "Drums — DnB Roll", make() { const t = new Track(BARS);
    [0, 2.5, 4, 6.5].forEach((b) => kick(t, b * B));
    [1, 3, 5, 7].forEach((b) => snare(t, b * B, 0.55));
    for (let i = 0; i < 32; i++) hat(t, i * (B / 4), 0.13, i % 4 === 2); return t; } },
  { key: "drums-dnb-amen", kind: "drums", name: "Drums — Amen Break", make() { const t = new Track(BARS);
    [0, 0.5, 2.5, 4, 4.5].forEach((b) => kick(t, b * B));
    [1, 1.75, 3, 5, 6.5, 7].forEach((b) => snare(t, b * B, 0.5));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.11, i % 4 === 3); return t; } },
  { key: "drums-boom-bap", kind: "drums", name: "Drums — Boom Bap", make() { const t = new Track(BARS);
    [0, 1.5, 4, 4.5, 6.5].forEach((b, i) => kick(t, b * B, i % 2 ? 0.75 : 0.95));
    [1, 3, 5, 7].forEach((b) => snare(t, b * B, 0.6));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2) + (i % 2 ? 0.03 : 0), 0.15); return t; } },
  { key: "drums-garage-2step", kind: "drums", name: "Drums — UK Garage", make() { const t = new Track(BARS);
    [0, 2.5, 4, 6.5].forEach((b) => kick(t, b * B));
    [1, 3, 5, 7].forEach((b) => snare(t, b * B, 0.5));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2) + B / 4, 0.13, i % 3 === 0); return t; } },
  { key: "drums-dubstep-half", kind: "drums", name: "Drums — Dubstep", make() { const t = new Track(BARS);
    kick(t, 0, 1); kick(t, 4 * B, 1);
    snare(t, 2 * B, 0.6); snare(t, 6 * B, 0.6);
    for (let i = 0; i < 16; i++) if (i % 2) hat(t, i * (B / 2), 0.12, i % 8 === 7);
    sub808(t, 0, 29, 0.7); sub808(t, 4 * B, 29, 0.7); return t; } },
  { key: "drums-electro", kind: "drums", name: "Drums — Electro", make() { const t = new Track(BARS);
    [0, 1.5, 3, 4, 5.5, 7].forEach((b) => kick(t, b * B));
    [2, 6].forEach((b) => clap(t, b * B, 0.45));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.15, i % 4 === 2); return t; } },
  { key: "drums-funk-break", kind: "drums", name: "Drums — Funk Break", make() { const t = new Track(BARS);
    [0, 0.75, 2, 4, 4.75, 6].forEach((b, i) => kick(t, b * B, i % 3 ? 0.65 : 0.9));
    [1, 3, 3.5, 5, 7].forEach((b) => snare(t, b * B, 0.55));
    for (let i = 0; i < 32; i++) hat(t, i * (B / 4), 0.11, i % 4 === 2); return t; } },
  { key: "drums-latin-clave", kind: "drums", name: "Drums — Latin", make() { const t = new Track(BARS);
    [0, 1.5, 3, 4, 6].forEach((b) => rim(t, b * B, 0.5));
    [0, 2, 4, 6].forEach((b) => cow(t, b * B + B / 2, 0.2));
    [0.5, 1, 2.5, 3, 4.5, 5, 6.5, 7].forEach((b, i) => tom(t, b * B, i % 2 ? 200 : 150, 0.32)); return t; } },
  { key: "drums-trip-hop", kind: "drums", name: "Drums — Trip Hop", make() { const t = new Track(BARS);
    [0, 3, 4, 6.5].forEach((b, i) => kick(t, b * B, i % 2 ? 0.6 : 0.9));
    snare(t, 2 * B, 0.55); snare(t, 6 * B, 0.55);
    for (let i = 0; i < 8; i++) hat(t, i * B + B / 2, 0.14); return t; } },
  { key: "drums-footwork", kind: "drums", name: "Drums — Footwork", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) { kick(t, i * B); kick(t, i * B + B / 3, 0.6); }
    [1, 3, 5, 7].forEach((b) => clap(t, b * B, 0.35));
    for (let i = 0; i < 16; i++) hat(t, i * (B / 2), 0.12); return t; } },
  { key: "drums-afro-house", kind: "drums", name: "Drums — Afro House", make() { const t = new Track(BARS);
    for (let i = 0; i < 8; i++) kick(t, i * B, 0.85);
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].forEach((b) => tom(t, b * B, 160, 0.28));
    for (let i = 0; i < 32; i++) hat(t, i * (B / 4) + B / 8, 0.09); return t; } },
  { key: "drums-tribal-toms", kind: "drums", name: "Drums — Tribal Toms", make() { const t = new Track(BARS);
    [0, 0.5, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6.5, 7].forEach((b, i) => tom(t, b * B, [110, 150, 90, 150, 130][i % 5], 0.45));
    for (let i = 0; i < 8; i++) kick(t, i * B, 0.5); return t; } },
  { key: "drums-perc-loop", kind: "drums", name: "Drums — Percussion", make() { const t = new Track(BARS);
    for (let i = 0; i < 16; i++) ride(t, i * (B / 2), 0.17);
    [1, 3, 5, 7].forEach((b) => rim(t, b * B, 0.4));
    [0, 4].forEach((b) => cow(t, b * B, 0.3)); return t; } },
  { key: "drums-halftime", kind: "drums", name: "Drums — Half-Time", make() { const t = new Track(BARS);
    kick(t, 0, 1); kick(t, 3.5 * B, 0.6); kick(t, 4 * B, 1);
    snare(t, 2 * B, 0.65); snare(t, 6 * B, 0.65);
    for (let i = 0; i < 32; i++) hat(t, i * (B / 4), 0.11, i % 8 === 7); return t; } },

  // ---- bass --------------------------------------------------------
  { key: "bass-acid-a", kind: "bass", name: "Bass — Acid A", make: seq([33, 45, 33, 36, 33, 40, 45, 48, 33, 45, 33, 40, 36, 33, 48, 40], { wave: "saw", gain: 0.5, dur: 0.22, opt: { lp: 0.12, decay: 2 } }) },
  { key: "bass-acid-e", kind: "bass", name: "Bass — Acid E", make: seq([28, 40, 28, 31, 28, 35, 40, 43, 28, 40, 28, 35, 31, 28, 43, 35], { wave: "saw", gain: 0.5, dur: 0.22, opt: { lp: 0.12, decay: 2 } }) },
  { key: "bass-deep-house", kind: "bass", name: "Bass — Deep House", make: seq([36, null, 36, 38, null, 36, 43, null, 41, null, 41, 43, null, 41, 36, null], { wave: "saw", gain: 0.5, dur: 0.4, opt: { lp: 0.2, release: 0.08 } }) },
  { key: "bass-sub-trap", kind: "bass", name: "Bass — Trap Sub", make: seq([31, null, null, null, 29, null, 34, null], { wave: "sine", gain: 0.9, dur: 0.7, step: B, opt: { release: 0.1 } }) },
  { key: "bass-reese-2", kind: "bass", name: "Bass — Reese II", make: seq([33, 33, 40, 38], { wave: "saw", gain: 0.55, dur: B * 1.8, step: B * 2, opt: { detune: 0.014, lp: 0.22 } }) },
  { key: "bass-pluck-c", kind: "bass", name: "Bass — Pluck C", make: seq([36, 43, 36, 48, 36, 43, 40, 36, 35, 43, 35, 47, 35, 43, 38, 35], { wave: "tri", gain: 0.55, dur: 0.18, opt: { decay: 5, release: 0.05 } }) },
  { key: "bass-fingered", kind: "bass", name: "Bass — Fingered", make: seq([40, 40, 47, 45, 40, 40, 43, 38, 40, 52, 47, 45, 43, 40, 38, 40], { wave: "saw", gain: 0.5, dur: 0.22, opt: { lp: 0.25, decay: 1.5 } }) },
  { key: "bass-funk-octave", kind: "bass", name: "Bass — Funk Octave", make: seq([40, 52, 40, 52, 45, 57, 45, 57, 43, 55, 43, 55, 38, 50, 38, 50], { wave: "saw", gain: 0.45, dur: 0.16, opt: { lp: 0.3, decay: 3 } }) },
  { key: "bass-saw-dm", kind: "bass", name: "Bass — Saw Dm", make: seq([26, 33, 26, 29, 26, 33, 31, 26, 24, 31, 24, 29, 26, 33, 29, 26], { wave: "saw", gain: 0.5, dur: 0.22, opt: { lp: 0.2, decay: 1.5 } }) },
  { key: "bass-saw-gm", kind: "bass", name: "Bass — Saw Gm", make: seq([31, 38, 31, 34, 31, 38, 36, 31, 29, 36, 29, 34, 31, 38, 34, 31], { wave: "saw", gain: 0.5, dur: 0.22, opt: { lp: 0.2, decay: 1.5 } }) },
  { key: "bass-square", kind: "bass", name: "Bass — Square", make: seq([33, 33, 40, 45, 33, 33, 38, 36, 33, 33, 40, 45, 43, 40, 38, 36], { wave: "square", gain: 0.42, dur: 0.2, opt: { lp: 0.3, decay: 2 } }) },
  { key: "bass-wobble", kind: "bass", name: "Bass — Wobble", make: seq(wob, { wave: "saw", gain: 0.5, dur: 0.11, step: B / 4, opt: { detune: 0.02, lp: 0.15, decay: 1 } }) },
  { key: "bass-808-glide", kind: "bass", name: "Bass — 808 Glide", make() { const t = new Track(BARS); [[0, 31], [2, 34], [4, 29], [6, 36]].forEach(([b, m]) => sub808(t, b * B, m, 0.85)); return t; } },
  { key: "bass-minimal", kind: "bass", name: "Bass — Minimal", make: seq([36, null, null, null, 36, null, 43, null, 41, null, null, null, 36, null, 38, null], { wave: "sine", gain: 0.8, dur: 0.4 }) },
  { key: "bass-dub", kind: "bass", name: "Bass — Dub", make: seq([28, null, 28, null, 33, null, null, null], { wave: "sine", gain: 0.85, dur: 0.5, step: B, opt: { lp: 0.4, release: 0.15 } }) },
  { key: "bass-synthwave", kind: "bass", name: "Bass — Synthwave", make: seq([33, 33, 40, 33, 45, 33, 40, 33, 31, 31, 38, 31, 43, 31, 38, 31], { wave: "saw", gain: 0.5, dur: 0.4, opt: { detune: 0.01, lp: 0.3 } }) },

  // ---- arps --------------------------------------------------------
  { key: "arp-minor-up", kind: "melodic", name: "Arp — Minor Up", make: arp(60, "minor", [0, 2, 4, 7]) },
  { key: "arp-minor-down", kind: "melodic", name: "Arp — Minor Down", make: arp(60, "minor", [7, 4, 2, 0]) },
  { key: "arp-major-up", kind: "melodic", name: "Arp — Major Up", make: arp(60, "major", [0, 2, 4, 7]) },
  { key: "arp-updown", kind: "melodic", name: "Arp — Up/Down", make: arp(60, "minor", [0, 2, 4, 7, 4, 2]) },
  { key: "arp-octave", kind: "melodic", name: "Arp — Octaves", make: arp(48, "minor", [0, 7, 0, 7, 3, 7]) },
  { key: "arp-trance", kind: "melodic", name: "Arp — Trance", make: arp(57, "minor", [0, 2, 4, 7, 9, 7, 4, 2], { wave: "saw", gain: 0.4, opt: { lp: 0.5, release: 0.05 } }) },
  { key: "arp-pentatonic", kind: "melodic", name: "Arp — Pentatonic", make: arp(62, "minPent", [0, 1, 2, 3, 4]) },
  { key: "arp-dorian", kind: "melodic", name: "Arp — Dorian", make: arp(60, "dorian", [0, 2, 4, 6, 4, 2]) },
  { key: "arp-fast-square", kind: "melodic", name: "Arp — Fast Square", make: arp(64, "minor", [0, 2, 4], { div: B / 8, gain: 0.32, opt: { lp: 0.45, decay: 6 } }) },
  { key: "arp-wide", kind: "melodic", name: "Arp — Wide", make: arp(48, "minor", [0, 4, 7, 11, 7, 4], { div: B / 3 }) },
  { key: "arp-triplet", kind: "melodic", name: "Arp — Triplet", make: arp(60, "major", [0, 2, 4], { div: B / 3, wave: "tri" }) },
  { key: "arp-house", kind: "melodic", name: "Arp — House", make: arp(57, "minPent", [0, 2, 4, 2], { wave: "square", opt: { lp: 0.4, decay: 5 } }) },
  { key: "arp-detuned", kind: "melodic", name: "Arp — Detuned", make: arp(60, "minor", [0, 3, 5, 7], { wave: "saw", opt: { detune: 0.01, lp: 0.4, decay: 3 } }) },
  { key: "arp-bell", kind: "melodic", name: "Arp — Bell", make: arp(72, "majPent", [0, 1, 2, 3, 4, 3, 2, 1], { wave: "fm", gain: 0.4, opt: { fmRatio: 2, fmDepth: 3, decay: 3 } }) },
  { key: "arp-pluck", kind: "melodic", name: "Arp — Pluck", make: arp(64, "minor", [0, 2, 4, 6], { wave: "tri", opt: { decay: 5, release: 0.05 } }) },
  { key: "arp-rise", kind: "melodic", name: "Arp — Rising Run", make: arp(48, "minor", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], { wave: "saw", opt: { lp: 0.5, decay: 3 } }) },

  // ---- chords / pads ----------------------------------------------
  { key: "pad-warm-am", kind: "melodic", name: "Pad — Warm Am", make: prog([[57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64]], { wave: "saw", opt: { attack: 0.4, release: 0.6, lp: 0.12, detune: 0.008 } }) },
  { key: "pad-warm-cm", kind: "melodic", name: "Pad — Warm Cm", make: prog([[48, 51, 55], [53, 56, 60], [50, 53, 57], [55, 58, 62]], { wave: "saw", opt: { attack: 0.4, release: 0.6, lp: 0.12, detune: 0.008 } }) },
  { key: "pad-lush-fmaj", kind: "melodic", name: "Pad — Lush Fmaj", make: prog([[53, 57, 60, 64], [55, 59, 62, 65], [50, 53, 57, 60], [52, 55, 59, 62]], { wave: "saw", opt: { attack: 0.5, release: 0.7, lp: 0.14, detune: 0.01 } }) },
  { key: "pad-strings", kind: "melodic", name: "Pad — Strings", make: prog([[48, 55, 64], [50, 57, 65], [52, 59, 67], [53, 60, 69]], { wave: "saw", gain: 0.4, opt: { attack: 0.5, release: 0.6, lp: 0.18 } }) },
  { key: "pad-airy", kind: "melodic", name: "Pad — Airy", make: prog([[60, 67, 72], [57, 64, 69], [59, 66, 71], [55, 62, 67]], { wave: "sine", gain: 0.42, opt: { attack: 0.6, release: 0.7 } }) },
  { key: "chords-house-stab", kind: "melodic", name: "Chords — House Stabs", make() { const t = new Track(BARS); const ch = [[57, 60, 64], [53, 57, 60]];
    for (let i = 0; i < 8; i++) t.chord(i * B, 0.15, ch[Math.floor(i / 4) % 2], 0.5, "saw", { lp: 0.3, release: 0.05, detune: 0.006 }); return t; } },
  { key: "chords-piano-ish", kind: "melodic", name: "Chords — Piano", make: prog([[48, 55, 60, 64], [45, 52, 57, 60], [50, 57, 62, 65], [43, 55, 59, 62]], { wave: "tri", gain: 0.4, opt: { attack: 0.01, decay: 1.2, release: 0.3 } }) },
  { key: "chords-rhodes-ish", kind: "melodic", name: "Chords — Rhodes", make: prog([[48, 55, 60, 64], [46, 53, 57, 62], [50, 57, 60, 65], [43, 53, 58, 62]], { wave: "fm", gain: 0.4, opt: { fmRatio: 1, fmDepth: 2, attack: 0.01, decay: 1.5, release: 0.3 } }) },
  { key: "chords-organ", kind: "melodic", name: "Chords — Organ", make: prog([[48, 55, 60], [50, 57, 62], [52, 59, 64], [53, 60, 65]], { wave: "square", gain: 0.35, opt: { attack: 0.02, release: 0.1, lp: 0.5 } }) },
  { key: "chords-9th", kind: "melodic", name: "Chords — 9ths", make: prog([[48, 55, 62, 64, 67], [45, 52, 59, 60, 64], [50, 57, 64, 65, 69]], { wave: "saw", gain: 0.4, opt: { attack: 0.3, release: 0.5, lp: 0.16, detune: 0.008 } }) },
  { key: "chords-sad", kind: "melodic", name: "Chords — Melancholy", make: prog([[45, 52, 57, 60], [43, 50, 55, 58], [41, 48, 53, 57], [40, 47, 52, 55]], { wave: "saw", gain: 0.42, opt: { attack: 0.35, release: 0.6, lp: 0.13 } }) },
  { key: "chords-uplifting", kind: "melodic", name: "Chords — Uplifting", make: prog([[52, 59, 64, 67], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]], { wave: "saw", gain: 0.42, opt: { attack: 0.3, release: 0.5, lp: 0.18, detune: 0.008 } }) },
  { key: "chords-cinematic", kind: "melodic", name: "Chords — Cinematic", make: prog([[36, 48, 55, 64], [41, 53, 60, 69]], { wave: "saw", gain: 0.4, opt: { attack: 0.7, release: 0.9, lp: 0.1, detune: 0.01 } }) },
  { key: "chords-synthwave", kind: "melodic", name: "Chords — Synthwave", make: prog([[45, 57, 60, 64], [48, 60, 64, 67], [40, 52, 55, 59], [43, 55, 59, 62]], { wave: "saw", gain: 0.4, opt: { attack: 0.2, release: 0.4, lp: 0.2, detune: 0.012 } }) },

  // ---- plucks / keys ----------------------------------------------
  { key: "pluck-koto", kind: "melodic", name: "Pluck — Koto", make: seq([62, 67, 69, 65, 62, 69, 72, 67, 62, 67, 69, 72, 69, 67, 65, 62], { wave: "tri", gain: 0.5, dur: 0.18, opt: { decay: 5, release: 0.05 } }) },
  { key: "pluck-marimba", kind: "melodic", name: "Pluck — Marimba", make: seq([60, 64, 67, 72, 67, 64, 60, 55, 57, 60, 64, 67, 64, 60, 57, 55], { wave: "sine", gain: 0.5, dur: 0.16, opt: { decay: 6, release: 0.03 } }) },
  { key: "pluck-music-box", kind: "melodic", name: "Pluck — Music Box", make: seq([84, 79, 84, 76, 84, 79, 72, 76, 84, 79, 84, 88, 84, 79, 76, 72], { wave: "sine", gain: 0.4, dur: 0.2, opt: { decay: 4, release: 0.05 } }) },
  { key: "keys-ep", kind: "melodic", name: "Keys — Electric Piano", make: seq([60, 64, 67, 71, 67, 64, 60, 67, 59, 62, 65, 69, 65, 62, 59, 55], { wave: "fm", gain: 0.4, dur: 0.3, opt: { fmRatio: 1, fmDepth: 2, decay: 2, release: 0.2 } }) },
  { key: "pluck-arp-melody", kind: "melodic", name: "Pluck — Arp Melody", make: seq([64, 67, 71, 72, 71, 67, 64, 62, 60, 64, 67, 71, 67, 64, 60, 59], { wave: "square", gain: 0.42, dur: 0.16, opt: { lp: 0.4, decay: 4 } }) },
  { key: "pluck-square-mel", kind: "melodic", name: "Pluck — Square Lead", make: seq([67, 67, 72, 71, 67, 64, 67, 62, 69, 69, 74, 72, 69, 67, 64, 67], { wave: "square", gain: 0.4, dur: 0.18, opt: { lp: 0.45, decay: 3 } }) },
  { key: "pluck-tri-mel", kind: "melodic", name: "Pluck — Triangle", make: seq([72, 71, 67, 69, 72, 74, 67, 76, 72, 71, 67, 64, 67, 69, 71, 72], { wave: "tri", gain: 0.45, dur: 0.18, opt: { decay: 3, release: 0.08 } }) },
  { key: "pluck-wide", kind: "melodic", name: "Pluck — Wide", make: seq([48, 72, 55, 76, 52, 79, 55, 72, 50, 74, 57, 77, 53, 76, 55, 72], { wave: "tri", gain: 0.42, dur: 0.16, opt: { decay: 5 } }) },
  { key: "keys-bell-melody", kind: "melodic", name: "Keys — Bell Melody", make: seq([84, 88, 91, 88, 84, 79, 81, 84], { wave: "fm", gain: 0.4, dur: 0.4, step: B, opt: { fmRatio: 2, fmDepth: 4, decay: 2 } }) },
  { key: "pluck-stab", kind: "melodic", name: "Pluck — Stab", make: seq([60, null, 60, null, 67, null, 64, null, 62, null, 62, null, 69, null, 65, null], { wave: "saw", gain: 0.45, dur: 0.1, opt: { lp: 0.35, decay: 6 } }) },
  { key: "pluck-funk", kind: "melodic", name: "Pluck — Funk", make: seq([64, null, 64, 67, null, 64, 62, null, 60, null, 60, 64, null, 67, 64, null], { wave: "square", gain: 0.4, dur: 0.12, opt: { lp: 0.4, decay: 5 } }) },
  { key: "pluck-folk", kind: "melodic", name: "Pluck — Folk", make: seq([67, 72, 69, 67, 64, 67, 72, 74, 67, 72, 69, 67, 64, 62, 64, 67], { wave: "tri", gain: 0.45, dur: 0.18, opt: { decay: 3, release: 0.05 } }) },

  // ---- leads -------------------------------------------------------
  { key: "lead-saw-2", kind: "melodic", name: "Lead — Saw II", make: seq([64, 67, 71, 69, 67, 64, 62, 60], { wave: "saw", gain: 0.4, dur: B * 0.9, step: B, opt: { lp: 0.5, release: 0.08 } }) },
  { key: "lead-square", kind: "melodic", name: "Lead — Square", make: seq([67, 71, 72, 74, 72, 71, 67, 64], { wave: "square", gain: 0.38, dur: B * 0.9, step: B, opt: { lp: 0.5, release: 0.08 } }) },
  { key: "lead-supersaw", kind: "melodic", name: "Lead — Supersaw", make: seq([69, 72, 76, 74, 72, 69, 67, 64], { wave: "saw", gain: 0.38, dur: B * 0.9, step: B, opt: { detune: 0.015, lp: 0.5, release: 0.1 } }) },
  { key: "lead-acid", kind: "melodic", name: "Lead — Acid", make: seq([64, 76, 64, 67, 64, 71, 76, 79, 64, 76, 64, 71, 67, 64, 79, 71], { wave: "saw", gain: 0.4, dur: 0.2, opt: { lp: 0.15, decay: 2 } }) },
  { key: "lead-trance", kind: "melodic", name: "Lead — Trance", make: seq([69, 76, 74, 72, 71, 72, 74, 76], { wave: "saw", gain: 0.4, dur: B * 0.95, step: B, opt: { lp: 0.55, release: 0.1, detune: 0.008 } }) },
  { key: "lead-synthwave", kind: "melodic", name: "Lead — Synthwave", make: seq([64, 64, 67, 71, 72, 71, 67, 64], { wave: "saw", gain: 0.4, dur: B * 0.9, step: B, opt: { detune: 0.01, lp: 0.45, release: 0.12 } }) },
  { key: "lead-chip", kind: "melodic", name: "Lead — Chiptune", make: seq([72, 76, 79, 76, 72, 67, 72, 79, 74, 77, 81, 77, 74, 69, 74, 81], { wave: "square", gain: 0.35, dur: 0.16, opt: { lp: 0.6, decay: 2 } }) },
  { key: "lead-pluck-lead", kind: "melodic", name: "Lead — Pluck Lead", make: seq([72, 71, 67, 69, 72, 74, 67, 76], { wave: "tri", gain: 0.42, dur: B * 0.8, step: B, opt: { decay: 2, release: 0.1 } }) },
  { key: "lead-wide", kind: "melodic", name: "Lead — Wide Octave", make: seq([60, 72, 64, 76, 67, 79, 64, 76], { wave: "saw", gain: 0.38, dur: B * 0.85, step: B, opt: { detune: 0.012, lp: 0.5 } }) },
  { key: "lead-minor-melody", kind: "melodic", name: "Lead — Minor Melody", make: seq([69, 72, 71, 69, 67, 69, 72, 76, 74, 72, 71, 69, 67, 65, 67, 69], { wave: "saw", gain: 0.4, dur: 0.2, opt: { lp: 0.5, release: 0.06 } }) },

  // ---- bells / FM --------------------------------------------------
  { key: "bell-fm-2", kind: "melodic", name: "Bell — FM II", make: seq([72, 76, 79, 76, 72, 67, 69, 72], { wave: "fm", gain: 0.42, dur: B * 0.9, step: B, opt: { fmRatio: 2, fmDepth: 4, decay: 2.5 } }) },
  { key: "bell-glass", kind: "melodic", name: "Bell — Glass", make: seq([84, 88, 91, 88, 84, 79, 84, 88], { wave: "fm", gain: 0.38, dur: B * 0.9, step: B, opt: { fmRatio: 3.5, fmDepth: 6, decay: 3 } }) },
  { key: "bell-mallet", kind: "melodic", name: "Bell — Mallet", make: seq([72, 76, 79, 84, 79, 76, 72, 67, 69, 72, 76, 79, 76, 72, 67, 72], { wave: "fm", gain: 0.4, dur: 0.18, opt: { fmRatio: 1, fmDepth: 1.5, decay: 5 } }) },
  { key: "bell-tubular", kind: "melodic", name: "Bell — Tubular", make: seq([60, 67, 64, 72, 60, 67, 72, 76], { wave: "fm", gain: 0.4, dur: B * 0.95, step: B, opt: { fmRatio: 1.4, fmDepth: 3, decay: 2 } }) },
  { key: "bell-chime", kind: "melodic", name: "Bell — Chime", make: arp(72, "majPent", [0, 2, 4, 3], { wave: "fm", gain: 0.4, div: B / 2, opt: { fmRatio: 2, fmDepth: 3.5, decay: 3 } }) },
  { key: "bell-celesta", kind: "melodic", name: "Bell — Celesta", make: seq([88, 84, 79, 84, 88, 91, 84, 79], { wave: "fm", gain: 0.36, dur: B * 0.9, step: B, opt: { fmRatio: 2, fmDepth: 2, decay: 4 } }) },

  // ---- vocal-ish ---------------------------------------------------
  { key: "vocal-ooh", kind: "melodic", name: "Vocal — Ooh", make() { const t = new Track(BARS);
    [[57], [60], [55], [57]].forEach((g, i) => { const base = mtof(g[0]);
      [1, 2, 3].forEach((h, k) => t.note(i * B * 2, B * 1.9, base * h, 0.36 / (k + 1), "sine", { attack: 0.1, release: 0.25 })); }); return t; } },
  { key: "vocal-choir", kind: "melodic", name: "Vocal — Choir", make() { const t = new Track(BARS);
    [[48, 55, 64], [50, 57, 65]].forEach((ch, i) => ch.forEach((m) => { const base = mtof(m);
      [1, 2, 3, 4.6].forEach((h, k) => t.note(i * (BARS / 2), BARS / 2 - 0.1, base * h, 0.22 / (k + 1), "sine", { attack: 0.15, release: 0.3 })); })); return t; } },
  { key: "vocal-aah-minor", kind: "melodic", name: "Vocal — Aah Minor", make() { const t = new Track(BARS);
    [[45], [48], [43], [45]].forEach((g, i) => { const base = mtof(g[0]);
      [1, 2, 3, 4.6, 7].forEach((h, k) => t.note(i * B * 2, B * 1.9, base * h, 0.3 / (k + 1), "sine", { attack: 0.08, release: 0.2 })); }); return t; } },

  // ---- FX ----------------------------------------------------------
  { key: "fx-riser", kind: "fx", name: "FX — Riser", make() { const t = new Track(BARS);
    for (let i = 0; i < t.len; i++) { const x = i / t.len, f = 200 * Math.pow(8, x);
      let seed = (i * 2654435761) | 0; const nz = ((seed >>> 0) / 4294967296 * 2 - 1);
      const lp = 0.05 + 0.9 * x; t._z = (t._z || 0) + lp * (nz - (t._z || 0));
      t.buf[i] = (t._z * 0.5 + Math.sin(TAU * f * (i / SR)) * 0.4) * x; } return t; } },
  { key: "fx-downlifter", kind: "fx", name: "FX — Downlifter", make() { const t = new Track(BARS);
    for (let i = 0; i < t.len; i++) { const x = i / t.len, f = 1600 * Math.pow(0.125, x);
      let seed = (i * 40503) | 0; const nz = ((seed >>> 0) / 4294967296 * 2 - 1);
      t.buf[i] = (Math.sin(TAU * f * (i / SR)) * 0.5 + nz * 0.15) * (1 - x); } return t; } },
  { key: "fx-impact", kind: "fx", name: "FX — Impact", make() { const t = new Track(BARS);
    for (let i = 0; i < t.len; i++) { const x = i / SR, f = 80 * Math.exp(-x * 4) + 30;
      let seed = (i * 40503) | 0; const nz = ((seed >>> 0) / 4294967296 * 2 - 1);
      t.buf[i] = Math.sin(TAU * f * x) * Math.exp(-x * 2) * 0.9 + nz * Math.exp(-x * 12) * 0.4; } return t; } },
];

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
for (const e of EXTRA) {
  const buf = encodeWav(e.make().finish());
  const file = e.key + ".wav";
  await fs.writeFile(path.join(OUT, file), buf);
  index.push({ file, name: e.name, kind: e.kind });
}
await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 0) + "\n");
console.log(`Generated ${index.length} royalty-free samples in ${OUT}`);
