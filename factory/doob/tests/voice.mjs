// =====================================================================
//  voice.mjs — the Minimoog signal path, measured at internal nodes: oscillators (ranges, waveforms, pulse widths,
//  tuning ranges, LO, OSC 3 control), mixer, noise colours, ladder filter (cutoff scale, slope, regeneration,
//  keyboard control, contour depth, modulation), contours (attack / decay / sustain / release, DECAY switch),
//  modulation mix and wheel, A-440, external preamp, outputs. node tests/voice.mjs <wasm>
// =====================================================================
import { Engine, NODE, metrics, zcFreq, slice, tone, db, fftMag, WASM } from "./lab.mjs";
import { check, near, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const BASE = { DRIFT: 0, BLEED: 0, SW_O1: 1, VOL1: 0.6, CUTOFF: 1, EMPH: 0, CONTOUR: 0, KB1: 0, KB2: 0, LSUS: 1, LATK: 0, FATK: 0, FSUS: 1, OUTVOL: 1, O1_RANGE: 3, O1_WAVE: 2, MODW: 0, MODMIX: 0, OSC_MOD: 0, FIL_MOD: 0, GLIDE_ON: 0 };
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
function cap(vals, secs, probe, events = [on(0, 57)], opt = {}) { e.reset(SR); e.setPatch({ ...BASE, ...vals }); return e.render(secs, events, { probe, block: opt.block || 1, input: opt.input }).probe; }
const mid = (x, a, b) => x.subarray(Math.round(a * SR), Math.round(b * SR));
const ptp = (x) => { let lo = 1e9, hi = -1e9; for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
const mean = (x) => { let s = 0; for (const v of x) s += v; return s / x.length; };
const F2 = 87.30706;
const taper = (x) => (Math.exp(4.39 * x) - 1) / (Math.exp(4.39) - 1);

// ------------------------------------------------------------------ oscillators --------------------------------------
{
  for (const [r, oct] of [[1, -2], [2, -1], [3, 0], [4, 1], [5, 2]]) {
    const f = zcFreq(mid(cap({ O1_RANGE: r }, 0.6, NODE.O1, [on(0, 41)]), 0.2, 0.6), SR);
    check(`range ${["", "32'", "16'", "8'", "4'", "2'"][r]}: bottom F = ${(F2 * 2 ** oct).toFixed(3)} Hz`, near(f / (F2 * 2 ** oct), 1, 0.0005), f.toFixed(3));
  }
  for (const n of [41, 53, 69, 84]) {
    const f = zcFreq(mid(cap({}, 0.6, NODE.O1, [on(0, n)]), 0.2, 0.6), SR), want = 440 * 2 ** ((n - 69) / 12);
    check(`keyboard tracks 1 V/oct: MIDI ${n} at 8' = ${want.toFixed(2)} Hz (A4 = 440)`, near(f / want, 1, 0.0005), f.toFixed(3));
  }
  // TUNE, FREQUENCY knobs
  const semis = (vals, node = NODE.O1, key = 57) => 12 * Math.log2(zcFreq(mid(cap(vals, 0.6, node, [on(0, key)]), 0.2, 0.6), SR) / 220);
  check("TUNE ±1 = ±4 semitones on oscillator 1", near(semis({ TUNE: 1 }), 4, 0.02) && near(semis({ TUNE: -1 }), -4, 0.02), `${semis({ TUNE: 1 }).toFixed(3)} ${semis({ TUNE: -1 }).toFixed(3)}`);
  check("TUNE moves all three oscillators", near(semis({ TUNE: 1, SW_O2: 1, O2_RANGE: 3, O2_WAVE: 2 }, NODE.O2), 4, 0.02) && near(semis({ TUNE: 1, O3_RANGE: 3, O3_WAVE: 2 }, NODE.O3), 4, 0.02));
  check("OSC 2 FREQUENCY ±7 semitones", near(semis({ O2_FREQ: 1, O2_WAVE: 2 }, NODE.O2), 7, 0.03) && near(semis({ O2_FREQ: -1, O2_WAVE: 2 }, NODE.O2), -7, 0.03) && near(semis({ O2_FREQ: 0, O2_WAVE: 2 }, NODE.O2), 0, 0.02));
  check("OSC 3 FREQUENCY ±7 semitones while it follows the keyboard", near(semis({ O3_FREQ: 1, O3_WAVE: 2 }, NODE.O3), 7, 0.03) && near(semis({ O3_FREQ: -0.5, O3_WAVE: 2 }, NODE.O3), -3.5, 0.03));
  check("OSC 1 has no frequency control but tracks the keys", near(semis({}, NODE.O1, 69), 12, 0.01));
  // OSC 3 control
  const f3 = (vals, key) => zcFreq(mid(cap({ O3_WAVE: 2, ...vals }, 0.6, NODE.O3, [on(0, key)]), 0.2, 0.6), SR);
  check("OSCILLATOR 3 CONTROL off: pitch no longer follows the keyboard", near(f3({ O3_CTRL: 0 }, 41) / f3({ O3_CTRL: 0 }, 77), 1, 0.001), `${f3({ O3_CTRL: 0 }, 41).toFixed(2)} vs ${f3({ O3_CTRL: 0 }, 77).toFixed(2)}`);
  check("… and sits at the bottom-F pitch of its range (8' → 87.3 Hz)", near(f3({ O3_CTRL: 0 }, 60), F2, 0.15), f3({ O3_CTRL: 0 }, 60).toFixed(2));
  check("… FREQUENCY then sweeps 6 octaves (±3)", near(f3({ O3_CTRL: 0, O3_FREQ: 1 }, 60) / F2, 8, 0.05) && near(f3({ O3_CTRL: 0, O3_FREQ: -1 }, 60) / F2, 1 / 8, 0.004), `${(f3({ O3_CTRL: 0, O3_FREQ: 1 }, 60) / F2).toFixed(2)}×`);
  // LO range
  const lo = (vals, secs = 8) => { const x = cap({ O1_RANGE: 0, ...vals }, secs, NODE.O1, [on(0, 41)]); const c = []; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c.push(i); return c.length < 3 ? 0 : (c.length - 1) * SR / (c[c.length - 1] - c[0]); };
  check("LO range: sub-audio, ≈ 2.7 Hz at the bottom F (a few clicks per second)", near(lo({ O1_WAVE: 0 }), 2.73, 0.1), lo({ O1_WAVE: 0 }).toFixed(3));
  check("LO range still tracks the keyboard (an octave up the keys doubles it)", near(lo({ O1_WAVE: 0 }, 4) * 2, (() => { const x = cap({ O1_RANGE: 0, O1_WAVE: 0 }, 4, NODE.O1, [on(0, 53)]); const c = []; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c.push(i); return (c.length - 1) * SR / (c[c.length - 1] - c[0]); })(), 0.2));
  { const l3 = (fr) => { const x = cap({ O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 0, O3_FREQ: fr, SW_O1: 0 }, 5, NODE.O3, [on(0, 57)]); const c = []; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c.push(i); return c.length < 3 ? 0 : (c.length - 1) * SR / (c[c.length - 1] - c[0]); };
    const fa = l3(1), fb = l3(0.5);
    check("OSC 3 detached in LO: ≈ 21.8 Hz at FREQUENCY +10 and 7.7 Hz at +5 (six-octave sweep, 2.7 Hz at bottom-F pitch)", near(fa / 21.8, 1, 0.05) && near(fb / 7.7, 1, 0.06), `${fa.toFixed(2)} ${fb.toFixed(2)}`); }
  // pitch wheel
  const bend = (w, rng) => 12 * Math.log2(zcFreq(mid(cap({ PITCHW: w, BEND: rng }, 0.6, NODE.O1, [on(0, 57)]), 0.2, 0.6), SR) / 220);
  check("PITCH wheel: ±BEND semitones (default 7 — 'half an octave' on the original)", near(bend(1, 7), 7, 0.03) && near(bend(-1, 7), -7, 0.03) && near(bend(0.5, 12), 6, 0.03));
  { e.reset(SR); e.setPatch({ ...BASE, PITCHW: 1 }); e.render(0.3, [on(0, 57)]); const c1 = e.ex.dbgNode(NODE.CUTHZ); e.setPatch({ ...BASE, PITCHW: 0 }); e.render(0.3, []); const c0 = e.ex.dbgNode(NODE.CUTHZ);
    check("the pitch wheel bends the oscillators only, not the filter", near(c1 / c0, 1, 0.001)); }
}

// ------------------------------------------------------------------ waveforms ------------------------------------------------
{
  const harm = (x, f0, n) => Array.from({ length: n }, (_, i) => tone(x, SR, f0 * (i + 1)));
  const wave = (w, node = NODE.O1, extra = {}) => mid(cap({ O1_WAVE: w, O3_WAVE: w, O2_WAVE: w, SW_O2: 1, ...extra }, 0.7, node, [on(0, 57)]), 0.15, 0.7);
  let x = wave(0), h = harm(x, 220, 8);
  check("triangle: odd harmonics at 1/n², swing ±1", near(h[2] / h[0], 1 / 9, 0.01) && near(h[4] / h[0], 1 / 25, 0.006) && h[1] / h[0] < 0.005 && near(ptp(x)[1], 1, 0.02));
  x = wave(2); h = harm(x, 220, 8);
  check("sawtooth: all harmonics at 1/n", [2, 3, 5, 8].every((n) => near(h[n - 1] / h[0], 1 / n, 0.03)), h.slice(0, 4).map((v) => (v / h[0]).toFixed(3)).join(" "));
  x = wave(3); h = harm(x, 220, 8);
  check("square: odd harmonics only, 1/n", h[1] / h[0] < 0.01 && h[3] / h[0] < 0.01 && near(h[2] / h[0], 1 / 3, 0.02));
  x = wave(4); h = harm(x, 220, 8);
  check("wide rectangular (1/3 duty): every 3rd harmonic is a null", h[2] / h[0] < 0.015 && h[5] / h[0] < 0.015 && h[1] / h[0] > 0.4 && near(h[1] / h[0], 0.5, 0.04), h.map((v) => (v / h[0]).toFixed(3)).join(" "));
  x = wave(5); h = harm(x, 220, 8);
  check("narrow rectangular (1/6 duty): the 6th harmonic is a null, rich upper harmonics", h[5] / h[0] < 0.02 && h[1] / h[0] > 0.8 && h[4] / h[0] > 0.15, h.map((v) => (v / h[0]).toFixed(3)).join(" "));
  const duty = (w) => { const y = wave(w, NODE.O1, {}); const [lo, hi] = ptp(y); const th = (lo + hi) / 2; let c = 0; for (const v of y) if (v > th) c++; return c / y.length; };
  check("pulse duty cycles: square 50 %, wide 33 %, narrow 17 %", near(duty(3), 0.5, 0.01) && near(duty(4), 1 / 3, 0.01) && near(duty(5), 1 / 6, 0.01), `${duty(3).toFixed(3)} ${duty(4).toFixed(3)} ${duty(5).toFixed(3)}`);
  // shark tooth: 0.824 triangle + 0.176 saw (the 10 K / 47 K network of the waveform switch)
  x = wave(1);
  const ref = (p) => 0.824 * (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) + 0.176 * (2 * p - 1);
  let best = 1e9; for (let d = 0; d < 1; d += 0.01) { let se = 0, n = 0; for (let i = 3000; i < 20000; i += 7) { const p = (((i / SR) * 220 + d) % 1 + 1) % 1; se += (x[i - 7200 > 0 ? i - 7200 : i] * 0 + 0); n++; } }
  const [slo, shi] = ptp(x);
  check("shark tooth (sawtooth-triangular): asymmetric triangle with the saw's drop — trough -1, crest ≈ +0.9", near(slo, -1, 0.04) && shi > 0.8 && shi < 1.0 && h[1] >= 0, `${slo.toFixed(2)} .. ${shi.toFixed(2)}`);
  { const hs = harm(x, 220, 6); check("shark tooth has even harmonics (the saw part) that the triangle lacks", hs[1] / hs[0] > 0.05, (hs[1] / hs[0]).toFixed(3)); }
  // oscillator 3 reverse saw
  const r3 = mid(cap({ O3_WAVE: 1, SW_O3: 1 }, 0.7, NODE.O3, [on(0, 57)]), 0.2, 0.7);
  let rise = 0, fall = 0; for (let i = 1; i < r3.length; i++) { if (r3[i] > r3[i - 1]) rise++; else fall++; }
  check("oscillator 3's reverse sawtooth falls slowly and jumps up (osc 1/2's saw rises slowly)", fall > rise * 20 && (() => { const s = mid(cap({ O1_WAVE: 2 }, 0.7, NODE.O1, [on(0, 57)]), 0.2, 0.7); let r = 0, f = 0; for (let i = 1; i < s.length; i++) { if (s[i] > s[i - 1]) r++; else f++; } return r > f * 20; })());
  // alias floor
  const al = (note) => { const y = mid(cap({ O1_WAVE: 2, O1_RANGE: 4 }, 0.8, NODE.O1, [on(0, note)]), 0.2, 0.8); const f0 = zcFreq(y, SR), N = 16384, m = fftMag(y, N), bh = SR / N; let hs = 0, ns = 0; for (let k = 4; k < m.length; k++) { const r = (k * bh) / f0; if (Math.abs(r - Math.round(r)) * f0 < 14 * bh) hs += m[k] ** 2; else ns += m[k] ** 2; } return db(Math.sqrt(ns / hs)); };
  check("band-limited oscillators: saw at 1.7 kHz aliases < -50 dB", al(69) < -50, al(69).toFixed(1));
}

// ------------------------------------------------------------------ mixer / noise / external -------------------------------------
{
  const mixPk = (vals) => ptp(mid(cap(vals, 0.5, NODE.MIX, [on(0, 57)]), 0.1, 0.5))[1];
  check("MIXER level knob is linear: oscillator 1 at 0.3 → 0.3 of full", near(mixPk({ VOL1: 0.3, O1_WAVE: 0 }) / mixPk({ VOL1: 0.6, O1_WAVE: 0 }), 0.5, 0.03));
  check("mixer switch off silences a channel without touching its knob", mixPk({ SW_O1: 0, VOL1: 1 }) < 1e-6);
  { const mr = (vals) => rms(mid(cap(vals, 1.5, NODE.MIX, [on(0, 57)]), 0.3, 1.5));
    const one = mr({ O1_WAVE: 3 }), three = mr({ O1_WAVE: 3, SW_O2: 1, VOL2: 0.6, O2_WAVE: 3, O2_FREQ: 0.31, SW_O3: 1, VOL3: 0.6, O3_WAVE: 3, O3_FREQ: -0.27 });
    check("three (detuned) oscillators sum in the mixer: rms ×√3", near(three / one, Math.sqrt(3), 0.12), (three / one).toFixed(3)); }
  // noise colours through the (open) filter and VCA
  const nzSpec = (col) => { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_NZ: 1, VOLNZ: 0.8, NZ_COLOR: col, STRIG: 1, OUTVOL: 0.6 }); const b = e.render(3, [], {}); return fftMag(slice(b, SR, 0.5, 3), 65536); };
  const band = (m, a, b2) => { const bh = SR / 65536; let s = 0, c = 0; for (let k = Math.floor(a / bh); k < b2 / bh; k++) { s += m[k] ** 2; c++; } return s / c; };
  const w = nzSpec(0), p = nzSpec(1);
  check("WHITE noise: flat spectrum (±2 dB 200 Hz - 10 kHz)", Math.abs(db(Math.sqrt(band(w, 150, 300) / band(w, 6000, 9000)))) < 2.5, db(Math.sqrt(band(w, 150, 300) / band(w, 6000, 9000))).toFixed(1));
  check("PINK noise: -3 dB per octave (≈ -10 dB per decade-ish: 200 Hz → 2 kHz = +10 dB)", near(db(Math.sqrt(band(p, 150, 300) / band(p, 1500, 3000))), 10, 2.5), db(Math.sqrt(band(p, 150, 300) / band(p, 1500, 3000))).toFixed(1));
  // external input and overload lamp
  const tone1k = (a) => (i) => { const v = a * Math.sin(2 * Math.PI * 330 * i / SR); return [v, v]; };
  const ext = (a, vol = 0.5) => { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_EXT: 1, VOLEXT: vol }); const b = e.render(0.4, [], { probe: NODE.MIX, block: 1, input: tone1k(a) }); const lamp = []; return ptp(b.probe.subarray(8000))[1]; };
  check("EXTERNAL INPUT: a small signal passes proportionally through the preamp", near(ext(0.04) / ext(0.02), 2, 0.05), `${ext(0.04).toFixed(3)} vs ${ext(0.02).toFixed(3)}`);
  { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_EXT: 1, VOLEXT: 0.5 }); let lamp = 0; for (const a of [0.05, 0.9]) { e.render(0.3, [], { input: tone1k(a) }); lamp = e.ex.dbgNode(NODE.LAMP); if (a < 0.1) check("OVERLOAD lamp stays dark on a quiet signal", lamp === 0); else check("OVERLOAD lamp lights on a loud signal", lamp > 0); } }
  { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_EXT: 1, VOLEXT: 0.5 }); const b = e.render(0.4, [], { probe: NODE.MIX, block: 1, input: tone1k(0.9) }); check("the preamp clips softly (the mixer stays bounded for a huge signal)", ptp(b.probe)[1] < 1.4); }
}

// ------------------------------------------------------------------ the ladder filter ---------------------------------------------------
{
  const setup = (extra) => ({ SW_O1: 0, STRIG: 1, ...extra });
  const selfF = (vals, key = 57, secs = 1.2) => { e.reset(SR); e.setPatch({ ...BASE, ...setup({ EMPH: 1 }), ...vals }); const b = e.render(secs, [on(0, key)], { probe: NODE.FIL, block: 1 }); const x = mid(b.probe, secs * 0.6, secs); return { f: zcFreq(x, SR), r: rms(x), pk: ptp(x)[1] }; };
  const cut = (k) => (k + 5) / 10;
  for (const k of [-3, -1, 0, 2, 3.5]) {
    const want = 440 * 2 ** (k + 1), s = selfF({ CUTOFF: cut(k), KB1: 0 });
    check(`CUTOFF ${k >= 0 ? "+" : ""}${k}: the filter oscillates at ${want.toFixed(1)} Hz (440 Hz at -1, one octave per knob unit)`, near(s.f / want, 1, 0.006), `${s.f.toFixed(2)} Hz  amp ${s.pk.toFixed(2)}`);
  }
  { const s = selfF({ CUTOFF: cut(-1) }); check("EMPHASIS 10: a strong, pure sine (the 'sixth sound source')", s.r > 0.3, `rms ${s.r.toFixed(2)}`); }
  // regeneration threshold between 7 and 8
  const regen = (em) => selfF({ EMPH: em / 10, CUTOFF: cut(-1) }, 57, 1.5).r;
  check("regeneration starts between EMPHASIS 7 and 8 (service manual calibration)", regen(6.5) < 0.01 && regen(7.0) < 0.02 && regen(8.0) > 0.1 && regen(9) > regen(8), `${regen(6.5).toFixed(3)} ${regen(7).toFixed(3)} ${regen(8).toFixed(3)} ${regen(9).toFixed(3)}`);
  // keyboard control 1 / 2 / both
  const sf = (vals, key) => selfF({ CUTOFF: cut(-1), ...vals }, key, 1.0).f;
  const r12 = (vals) => sf(vals, 69) / sf(vals, 57);
  check("KEYBOARD CONTROL off: the cutoff ignores the keys", near(r12({ KB1: 0, KB2: 0 }), 1, 0.003));
  check("KEYBOARD CONTROL 1: one third (an octave up the keys → cutoff ×2^(1/3))", near(r12({ KB1: 1, KB2: 0 }), 2 ** (1 / 3), 0.01), r12({ KB1: 1, KB2: 0 }).toFixed(4));
  check("KEYBOARD CONTROL 2: two thirds (×2^(2/3))", near(r12({ KB1: 0, KB2: 1 }), 2 ** (2 / 3), 0.012), r12({ KB1: 0, KB2: 1 }).toFixed(4));
  check("both on: full tracking — the filter plays as a sine oscillator (×2 per octave)", near(r12({ KB1: 1, KB2: 1 }), 2, 0.015), r12({ KB1: 1, KB2: 1 }).toFixed(4));
  // contour amount
  { e.reset(SR); e.setPatch({ ...BASE, ...setup({ CONTOUR: 1, FSUS: 1, CUTOFF: cut(-3) }) }); e.render(0.5, [on(0, 57)]); const hi = e.ex.dbgNode(NODE.CUTHZ);
    e.setPatch({ ...BASE, ...setup({ CONTOUR: 0, FSUS: 1, CUTOFF: cut(-3) }) }); e.render(0.2, []); const lo = e.ex.dbgNode(NODE.CUTHZ);
    check("AMOUNT OF CONTOUR 10 at full contour sweeps the cutoff ≈ 8.5 octaves", near(Math.log2(hi / lo), 8.5, 0.3), Math.log2(hi / lo).toFixed(2)); }
  // magnitude response with sine sweeps through the external input
  const lp = (c, f) => { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_EXT: 1, VOLEXT: 0.02, STRIG: 1, CUTOFF: c, EMPH: 0 }); const b = e.render(0.8, [], { probes: [NODE.MIX, NODE.FIL], block: 1, input: (i) => { const v = 1.0 * Math.sin(2 * Math.PI * f * i / SR); return [v, v]; } }); const w = (a) => ptp(a.subarray(Math.round(0.4 * SR)))[1]; return w(b.probes[1]) / w(b.probes[0]); };
  for (const k of [-2, 0.5]) {
    const fc = 440 * 2 ** (k + 1), tw = (f) => Math.tan(Math.PI * f / (2 * SR)) / Math.tan(Math.PI * fc / (2 * SR)), want = (f) => 1 / (1 + tw(f) ** 2) ** 2;
    const fs = [fc / 4, fc / 2, fc, fc * 2, fc * 4].filter((f) => f < SR * 0.35 && db(want(f)) > -40);
    const g = fs.map((f) => lp(cut(k), f));
    check(`ladder at cutoff ${fc.toFixed(0)} Hz: exact 4-pole 24 dB/oct response (-12 dB at fc)`, g.every((v, i) => near(db(v / want(fs[i])), 0, 0.5)) && near(db(g[fs.indexOf(fc)]), -12, 0.5), g.map((v, i) => db(v / want(fs[i])).toFixed(2)).join(" "));
  }
  { const passband = (em) => lp(cut(-1), 60) ; e.reset(SR);
    const gl = (em) => { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, SW_EXT: 1, VOLEXT: 0.02, STRIG: 1, CUTOFF: cut(0), EMPH: em }); const b = e.render(0.8, [], { probes: [NODE.MIX, NODE.FIL], block: 1, input: (i) => { const v = 0.3 * Math.sin(2 * Math.PI * 60 * i / SR); return [v, v]; } }); const w = (a) => ptp(a.subarray(Math.round(0.4 * SR)))[1]; return w(b.probes[1]) / w(b.probes[0]); };
    check("EMPHASIS thins the bottom end (the Moog ladder's passband loss)", gl(0.7) < gl(0) * 0.6, `${gl(0).toFixed(2)} → ${gl(0.7).toFixed(2)}`); }
  // filter modulation through the mod bus
  { const cutAt = (vals) => { e.reset(SR); e.setPatch({ ...BASE, ...setup({ CUTOFF: cut(-1) }), ...vals }); e.render(0.2, [on(0, 57)]); return e.ex.dbgNode(NODE.CUTHZ); };
    const nomod = cutAt({});
    const o3 = { O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 3, FIL_MOD: 1, MODW: 1, MODMIX: 0 };
    const hiC = Math.max(...Array.from({ length: 20 }, (_, i) => { e.reset(SR); e.setPatch({ ...BASE, ...setup({ CUTOFF: cut(-1) }), ...o3 }); e.render(0.2 + i * 0.05, [on(0, 57)]); return e.ex.dbgNode(NODE.CUTHZ); }));
    check("FILTER MODULATION: the modulation (full wheel, OSC 3 square) moves the cutoff ±1 octave", near(Math.log2(hiC / nomod), 1, 0.15), Math.log2(hiC / nomod).toFixed(2));
    check("FILTER MODULATION off: the wheel does nothing to the cutoff", near(cutAt({ ...o3, FIL_MOD: 0 }) / nomod, 1, 0.001)); }
}

// ------------------------------------------------------------------ contours -----------------------------------------------------------
{
  const tr = (vals, hold, total, node) => cap({ SW_O1: 0, ...vals }, total, node, [on(0.05, 57), off(0.05 + hold, 57)], { block: 8 });
  const tAt = (x, level, from = 0, rising = true) => { for (let i = Math.round(from * SR); i < x.length; i++) if (rising ? x[i] >= level : x[i] <= level) return i / SR; return -1; };
  const T = (x, max) => 0.001 + (max - 0.001) * taper(x);
  for (const [name, key, node, max] of [["filter", "F", NODE.CF, 9], ["loudness", "L", NODE.CL, 14]]) {
    for (const x of [0, 0.4, 0.7]) {
      const x01 = tr({ [key + "ATK"]: x, [key + "SUS"]: 1, [key + "DEC"]: 0.2 }, 30, 25, node);
      const t = tAt(x01, 0.9995, 0.05) - 0.05, want = T(x, max);
      check(`${name} ATTACK ${(x * 10).toFixed(0)}: rest → peak in ${want.toFixed(3)} s (max ${max} s, audio-taper pot, 10 µF)`, near(t / want, 1, 0.1) || near(t, want, 0.002), `${t.toFixed(3)} s`);
    }
  }
  // exponential attack shape: at half the attack time the level is ln-curved (~0.63..0.7 of peak for kA=2)
  { const x = tr({ LATK: 0.6, LSUS: 1 }, 30, 8, NODE.CL); const T6 = T(0.6, 14), mid1 = x[Math.round((0.05 + T6 / 2) * SR)];
    check("attack is an RC charge (concave): at half the time the contour is already ≈ 0.6 of its peak", mid1 > 0.55 && mid1 < 0.72, mid1.toFixed(3)); }
  // decay: 1 → sustain; SUSTAIN level
  { const x = tr({ LATK: 0, LDEC: 0.5, LSUS: 0.4 }, 12, 14, NODE.CL);
    check("SUSTAIN 4: the contour levels off at 0.4 of the peak", near(x[Math.round(10 * SR)], 0.4, 0.01), x[Math.round(10 * SR)].toFixed(3));
    const Td = T(0.5, 30), tdec = tAt(x, 0.401, 0.06, false) - 0.05;
    const wantFall = Td / 0.33647 * Math.log((1 + 2.5) / (0.4 + 2.5));
    check("DECAY: an exponential fall toward -2.5 (peak units), clamped at the sustain level", near(tdec / wantFall, 1, 0.12), `${tdec.toFixed(3)} s vs ${wantFall.toFixed(3)} s`);
  }
  { const x = tr({ LATK: 0, LDEC: 0.5, LSUS: 0 }, 14, 16, NODE.CL); const t0 = tAt(x, 0.003, 0.06, false) - 0.05, Td = T(0.5, 30);
    check("DECAY time = peak → 0 (30 s at full knob, audio taper)", near(t0 / Td, 1, 0.1), `${t0.toFixed(3)} s vs ${Td.toFixed(3)} s`); }
  // release: DECAY switch off = ~15 ms; on = the decay time
  { const rel = (dec) => { const x = tr({ LATK: 0, LDEC: 0.5, LSUS: 1, DECAY_ON: dec }, 1, 8, NODE.CL); const t1 = tAt(x, 0.003, 1.05, false) - 1.05; return t1; };
    check("final DECAY switch off: the loudness contour releases in ~5 ms (1.5 K through 10 µF), no click", rel(0) < 0.012 && rel(0) > 0.002, rel(0).toFixed(4));
    check("final DECAY switch on: the release takes the DECAY time", near(rel(1) / T(0.5, 30), 1, 0.12), `${rel(1).toFixed(3)} s vs ${T(0.5, 30).toFixed(3)} s`); }
  { const x = tr({ FATK: 0, FDEC: 0.5, FSUS: 1, DECAY_ON: 1 }, 1, 8, NODE.CF); const t1 = tAt(x, 0.003, 1.05, false) - 1.05;
    check("the DECAY switch governs the filter contour's release too", near(t1 / T(0.5, 30), 1, 0.12), `${t1.toFixed(3)} s`); }
  // retrigger from the current level + peak creep
  { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, LATK: 0.55, LDEC: 0.5, LSUS: 1, DECAY_ON: 1, TRIG_MODE: 1, KEY_PRI: 0 });
    const b = e.render(2.5, [on(0.05, 57), off(0.9, 57), on(1.0, 59), off(2.0, 59)], { probe: NODE.CL, block: 4 });
    const l0 = b.probe[Math.round(1.0 * SR)], l1 = b.probe[Math.round(1.1 * SR)];
    check("re-triggering attacks from the CURRENT level (analog behaviour), not from zero", l0 > 0.15 && l1 > l0, `${l0.toFixed(3)} → ${l1.toFixed(3)}`);
    const pk = ptp(b.probe)[1];
    check("played rapidly the peak creeps above 1 (the documented 'brighter and louder when played fast')", pk > 1.0 && pk < 1.2, pk.toFixed(3)); }
  // S-trig plug: contour held with no key
  { const x = cap({ SW_O1: 0, STRIG: 1, LATK: 0.3, LSUS: 0.6 }, 4, NODE.CL, [], { block: 8 }); check("S-TRIG shorting plug: the contours run up to the sustain level with no key at all", near(x[Math.round(3.8 * SR)], 0.6, 0.02)); }
  { const x = cap({ SW_O1: 0, STRIG: 0, LATK: 0.3, LSUS: 0.6 }, 1, NODE.CL, [], { block: 8 }); check("… and are silent without it", ptp(x)[1] < 1e-4); }
  // loudness contour is the VCA: linear gain
  { const lvl = (s) => { e.reset(SR); e.setPatch({ ...BASE, VOL1: 0.5, O1_WAVE: 0, LSUS: s, LATK: 0, LDEC: 0, OUTVOL: 0.5 }); const b = e.render(1.2, [on(0, 57)]); return ptp(b.subarray(Math.round(0.8 * SR)))[1]; };
    check("the loudness contour drives VCA 1 linearly (sustain 0.5 → half amplitude)", near(lvl(0.5) / lvl(1), 0.5, 0.03), (lvl(0.5) / lvl(1)).toFixed(3)); }
}

// ------------------------------------------------------------------ modulation -----------------------------------------------------------
{
  const busOf = (vals, secs = 3) => { const b = cap({ SW_O1: 0, O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 0, MODW: 1, MODMIX: 0, ...vals }, secs, NODE.BUS, [on(0, 57)], { block: 4 }); return ptp(b.subarray(Math.round(0.5 * SR))); };
  const [lo, hi] = busOf({});
  check("MOD wheel full, MODULATION MIX = OSC 3: ±1 (octave-weighted) triangle at the LFO rate", near(hi, 1, 0.05) && near(lo, -1, 0.05), `${lo.toFixed(2)} .. ${hi.toFixed(2)}`);
  check("MOD wheel at 0 sends nothing", ptp(busOf({ MODW: 0 }))[1] < 1e-6);
  check("MOD wheel is an audio-taper pot (half travel ≈ 10 %)", near(busOf({ MODW: 0.5 })[1] / hi, taper(0.5), 0.02), (busOf({ MODW: 0.5 })[1] / hi).toFixed(3));
  const coef = (m) => { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 0, MODW: 1, MODMIX: m, O3_FREQ: 0.3 }); const b = e.render(6, [on(0, 57)], { probes: [NODE.O3, NODE.BUS], block: 1 }); const x = b.probes[0].subarray(SR), y = b.probes[1].subarray(SR); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += x[i] * y[i]; sxx += x[i] * x[i]; } return sxy / sxx; };
  const c0 = coef(0), c5 = coef(0.5), c1 = coef(1);
  check("MODULATION MIX pans between OSC 3 (left) and noise (right): 25 K pot into 24 K sources → 0.67 at centre, 0 at right", near(c5 / c0, 0.667, 0.05) && Math.abs(c1 / c0) < 0.02, `${c0.toFixed(3)} ${c5.toFixed(3)} ${c1.toFixed(3)}`);
  { const nb = busOf({ MODMIX: 1 }); check("fully right: random (noise) modulation, not the oscillator's triangle", nb[1] > 0.1 && nb[1] < 2.5 && Math.abs(c1) < 0.02, `${nb[0].toFixed(2)} .. ${nb[1].toFixed(2)}`); }
  // OSC MOD → vibrato of ±1 octave at full wheel
  { const fr = (vals) => { const x = cap({ O3_CTRL: 0, O3_RANGE: 0, O3_WAVE: 0, O3_FREQ: 0.4, OSC_MOD: 1, MODW: 1, SW_O1: 1, O1_RANGE: 3, ...vals }, 6, NODE.F1, [on(0, 57)], { block: 8 }); return ptp(x.subarray(Math.round(0.5 * SR))); };
    const [a, b2] = fr({}); check("OSCILLATOR MODULATION: full wheel moves the oscillators ±1 octave", near(Math.log2(b2 / a) / 2, 1, 0.1), `${Math.log2(b2 / a).toFixed(2)} octaves p-p`);
    const [c, d] = fr({ OSC_MOD: 0 }); check("OSCILLATOR MODULATION off: the wheel does nothing to the pitch", near(d / c, 1, 0.001)); }
  // reissue: LFO and alternative sources
  { const lf = (r, w) => { const x = cap({ SW_O1: 0, MOD_B: 1, MODMIX: 1, MODW: 1, LFO_RATE: r, LFO_WAVE: w }, 8, NODE.LFO, [], { block: 2 }); let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / 8; };
    check("reissue LFO rate 0.1 Hz … 30 Hz (exponential)", near(lf(1, 0), 30, 1.5) && near(lf(0.5, 0), 0.1 * Math.sqrt(300), 0.4), `${lf(1, 0).toFixed(2)} ${lf(0.5, 0).toFixed(2)}`);
    const sq = cap({ SW_O1: 0, LFO_RATE: 0.5, LFO_WAVE: 1 }, 2, NODE.LFO, [], { block: 4 }); check("LFO square / triangle selectable", ptp(sq)[1] > 0.99);
    const [a, b2] = ptp(cap({ SW_O1: 0, MOD_B: 1, MODMIX: 1, MODW: 1, LFO_RATE: 0.4 }, 3, NODE.BUS, [], { block: 4 }).subarray(Math.round(0.4 * SR)));
    check("MODULATION MIX fully right with the LFO selected: the LFO is the modulation (±1)", near(b2, 1, 0.08) && near(a, -1, 0.08), `${a.toFixed(2)} ${b2.toFixed(2)}`);
    const cs = cap({ SW_O1: 0, MOD_A: 1, MODMIX: 0, MODW: 1, FATK: 0.5, FSUS: 1, STRIG: 1 }, 6, NODE.BUS, [], { block: 8 }); check("reissue: the filter contour can be the modulation source", ptp(cs)[1] > 0.9, ptp(cs)[1].toFixed(2)); }
}

// ------------------------------------------------------------------ output ---------------------------------------------------------------------------
{
  const lvl = (vals) => { e.reset(SR); e.setPatch({ ...BASE, VOL1: 0.4, O1_WAVE: 0, LSUS: 1, ...vals }); const b = e.render(0.6, [on(0, 57)]); return ptp(b.subarray(Math.round(0.3 * SR)))[1]; };
  check("MAIN OUTPUT VOLUME: audio taper (half travel → quarter amplitude)", near(lvl({ OUTVOL: 0.5 }) / lvl({ OUTVOL: 1 }), 0.25, 0.04), (lvl({ OUTVOL: 0.5 }) / lvl({ OUTVOL: 1 })).toFixed(3));
  check("MAIN OUTPUT switch off silences the output", lvl({ MAIN_ON: 0 }) < 1e-6);
  // A-440
  { e.reset(SR); e.setPatch({ ...BASE, SW_O1: 0, A440: 1, OUTVOL: 0.7 }); const b = e.render(1.2, []); const x = slice(b, SR, 0.3, 1.2); check("A-440: a 440 Hz reference tone with a little harmonic content (Wien bridge)", near(zcFreq(x, SR), 440, 0.3) && tone(x, SR, 880) / tone(x, SR, 440) > 0.01 && tone(x, SR, 880) / tone(x, SR, 440) < 0.1 && metrics(x).rms > 0.02, `rms ${metrics(x).rms.toFixed(3)}`);
    // …the A-440 passes the contours' VCA: audible even with no key
    check("A-440 is heard without pressing a key (it enters after VCA 1)", metrics(x).rms > 0.02); }
  // the oscillator can be tuned to the reference with TUNE
  { const f = zcFreq(mid(cap({ TUNE: 0 }, 0.6, NODE.O1, [on(0, 69)]), 0.2, 0.6), SR); check("TUNE at 0 puts oscillator 1 exactly on A-440 (the reference)", near(f, 440, 0.05)); }
  // FEEDBACK mod
  { const m = (fb) => { e.reset(SR); e.setPatch({ ...BASE, VOL1: 0.5, SW_EXT: 1, VOLEXT: 0.8, FEEDBACK: fb, O1_WAVE: 3, OUTVOL: 0.7 }); const b = e.render(1.0, [on(0, 57)]); return metrics(slice(b, SR, 0.5, 1)); };
    check("OUTPUT → EXTERNAL IN feedback: changes the sound and stays bounded", m(1).rms !== m(0).rms && m(1).peak <= 1.0001 && m(1).nan === 0, `${m(0).rms.toFixed(3)} → ${m(1).rms.toFixed(3)}`); }
}
done("voice");
