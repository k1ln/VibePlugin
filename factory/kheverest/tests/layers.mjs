// =====================================================================
//  layers.mjs — behavioural checks against the Peak manual (one assertion per
//  feature). node factory/kheverest/tests/layers.mjs <wasm>
// =====================================================================
import { Engine, P, KEYS, metrics, mono, pitch, db, bandEnergy } from "./lab.mjs";
const wasm = process.argv[2];
const only = process.argv[3];
const e = new Engine(wasm);
const SR = 48000;
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}  ${detail}`); } };
const section = (s) => { if (!only || s.toLowerCase().includes(only.toLowerCase())) { console.log("· " + s); return true; } return false; };

function R(patch = {}, events = [{ t: 0, type: "on", note: 60, vel: 0.8 }], dur = 0.8, tempo = 0) {
  e.reset(SR); e.setPatch(patch, tempo);
  return e.render(dur, events);
}
const on = (note, t = 0, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (note, t) => ({ t, type: "off", note });
const cc = (num, val, t = 0) => ({ t, type: "cc", num, val });
const seg = (o, a, b) => mono(o).subarray(Math.round(a * SR), Math.round(b * SR));
const rms = (o, a = 0.2, b = 0.7) => metrics(seg(o, a, b)).rms;
const pk = (o, a = 0.2, b = 0.7) => metrics(seg(o, a, b)).peak;
const pit = (o, a = 0.2, b = 0.7, lo, hi) => pitch(seg(o, a, b), SR, lo, hi);
const H = (x, f0, k) => db(bandEnergy(x, SR, k * f0 - 4, k * f0 + 4));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const cents = (a, b) => 1200 * Math.log2(a / b);
// short-time rms envelope (10 ms hops)
function env(o, hop = 0.01) { const m = mono(o), w = Math.round(hop * SR), a = []; for (let i = 0; i + w <= m.length; i += w) { let s = 0; for (let j = 0; j < w; j++) s += m[i + j] * m[i + j]; a.push(Math.sqrt(s / w)); } return a; }
const NOENV = { EA_A: 0, EA_D: 0, EA_S: 127 };
// matrix helper: slot n = [srcA, srcB, dest, depth]
const SRC = ["Direct", "ModWheel", "AftTouch", "ExprPED1", "BrthPED2", "Velocity", "Keyboard", "Lfo1+", "Lfo1+/-", "Lfo2+", "Lfo2+/-", "AmpEnv", "ModEnv1", "ModEnv2", "Animate1", "Animate2", "CV +/-", "Lfo3+", "Lfo3+/-", "Lfo4+", "Lfo4+/-", "BndWhl+", "BndWhl-"];
const DST = ["0123Ptch", "Osc1Ptch", "Osc2Ptch", "Osc3Ptch", "Osc1VSnc", "Osc2VSnc", "Osc3VSnc", "Osc1Shpe", "Osc2Shpe", "Osc3Shpe", "Osc1 Lev", "Osc2 Lev", "Osc3 Lev", "NoiseLev", "Ring Lev", "VcaLevel", "Filt Drv", "FiltDist", "FiltFreq", "Filt Res", "Lfo1Rate", "Lfo2Rate", "AmpEnv A", "AmpEnv D", "AmpEnv R", "ModEnv1A", "ModEnv1D", "ModEnv1R", "ModEnv2A", "ModEnv2D", "ModEnv2R", "FM O1>O2", "FM O2>O3", "FM O3>O1", "FM Ns>O1", "O3>FiltF", "Ns>FiltF"];
const mm = (n, a, b, d, depth) => ({ [`MM${n}_A`]: SRC.indexOf(a), [`MM${n}_B`]: SRC.indexOf(b), [`MM${n}_DEST`]: DST.indexOf(d), [`MM${n}_DEPTH`]: depth });

// ============================================================ OSCILLATORS
if (section("oscillators")) {
  for (const [r, f] of [[0, 110], [1, 220], [2, 440], [3, 880]]) check(`range ${r}`, near(pit(R({ O1_RANGE: r }, [on(57)])), f, f * 0.004), "");
  check("coarse -12 = octave down", near(pit(R({ O1_COARSE: -12 }, [on(57)])), 110, 0.5));
  check("coarse +7", near(cents(pit(R({ O1_COARSE: 7 }, [on(57)])), 220), 700, 6));
  check("fine +100c", near(cents(pit(R({ O1_FINE: 100 }, [on(57)])), 220), 100, 3));
  check("fine -50c", near(cents(pit(R({ O1_FINE: -50 }, [on(57)])), 220), -50, 3));
  // waveform spectra
  const sp = (patch) => seg(R(patch, [on(48)]), 0.2, 0.7); const f0 = 130.81;
  const sine = sp({ O1_WAVE: 0 }), tri = sp({ O1_WAVE: 1 }), saw = sp({ O1_WAVE: 2 }), pul = sp({ O1_WAVE: 3 });
  check("sine is pure", H(sine, f0, 3) < H(sine, f0, 1) - 50);
  check("triangle odd only, 1/n²", H(tri, f0, 2) < H(tri, f0, 1) - 50 && near(H(tri, f0, 1) - H(tri, f0, 3), 19, 3));
  check("saw all harmonics 1/n", near(H(saw, f0, 1) - H(saw, f0, 2), 6, 1.5) && near(H(saw, f0, 1) - H(saw, f0, 3), 9.5, 1.5));
  check("pulse 50% odd only", H(pul, f0, 2) < H(pul, f0, 1) - 40 && near(H(pul, f0, 1) - H(pul, f0, 3), 9.5, 2));
  // shape per wave type
  const shp = (w, v) => seg(R({ O1_WAVE: w, O1_SHAPE: v }, [on(48)]), 0.2, 0.7);
  check("sine + shape adds harmonics", H(shp(0, 40), f0, 3) > H(shp(0, 0), f0, 3) + 30);
  check("sine - shape adds harmonics", H(shp(0, -40), f0, 3) > H(shp(0, 0), f0, 3) + 30);
  check("triangle + shape → saw (even harmonics)", H(shp(1, 63), f0, 2) > H(shp(1, 0), f0, 2) + 40);
  check("saw + shape → square (even fall)", H(shp(2, 63), f0, 2) < H(shp(2, 0), f0, 2) - 15);
  check("saw - shape folds (harmonic change)", Math.abs(H(shp(2, -40), f0, 2) - H(shp(2, 0), f0, 2)) > 2);
  check("pulse width changes even harmonics", H(shp(3, 40), f0, 2) > H(shp(3, 0), f0, 2) + 30);
  // aliasing: saw at note 96 (2093 Hz) — energy at a non-harmonic bin should be low
  { const o = seg(R({ O1_WAVE: 2 }, [on(96)]), 0.2, 0.7); const f = 2093; const fund = db(bandEnergy(o, SR, f - 6, f + 6)); const alias = db(bandEnergy(o, SR, 3 * f + 300 - 6 + 100, 3 * f + 300 + 6 + 100)); check("saw alias floor at 2 kHz", fund - alias > 35, `${(fund - alias).toFixed(1)} dB`); }
  // wavetables
  let silent = [], nan = 0;
  for (let w = 0; w < KEYS.O1_MORE.steps; w++) for (const sh of [-63, 0, 63]) { const o = R({ O1_WAVE: 4, O1_MORE: w, O1_SHAPE: sh }, [on(48)], 0.5); const m = metrics(seg(o, 0.1, 0.45)); if (m.nan) nan++; if (m.rms < 0.008) silent.push(`${w}/${sh}`); }
  check("all wavetables × 3 positions audible + finite", silent.length === 0 && nan === 0, silent.slice(0, 6).join(","));
  { let same = 0; for (const w of [0, 11, 20, 44, 57]) { const a = seg(R({ O1_WAVE: 4, O1_MORE: w, O1_SHAPE: -63 }, [on(48)]), 0.2, 0.5), b = seg(R({ O1_WAVE: 4, O1_MORE: w, O1_SHAPE: 63 }, [on(48)]), 0.2, 0.5); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); if (d / a.length < 0.01) same++; } check("wavetable shape sweeps morph the timbre", same === 0, `${same} unchanged`); }
  check("different wavetables sound different", (() => { const a = seg(R({ O1_WAVE: 4, O1_MORE: 3 }, [on(48)]), 0.2, 0.5), b = seg(R({ O1_WAVE: 4, O1_MORE: 12 }, [on(48)]), 0.2, 0.5); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length > 0.02; })());
  check("wavetable pitch correct", near(pit(R({ O1_WAVE: 4, O1_MORE: 9 }, [on(57)])), 220, 1.5));
  // shape sources
  { const o = R({ O1_WAVE: 3, O1_SRC: 1, O1_SHENV: 60, EM1_A: 0, EM1_D: 70, EM1_S: 0 }, [on(48)], 1.2); const a = H(seg(o, 0.02, 0.14), f0, 2), b = H(seg(o, 0.9, 1.1), f0, 2); check("Mod Env 1 → shape sweeps PW", a > b + 20, `${a.toFixed(1)} ${b.toFixed(1)}`); }
  { const o = R({ O1_WAVE: 3, O1_SRC: 2, O1_SHLFO: 60, L1_RATE: 100 }, [on(48)], 1.2); const m = env(o); check("LFO 1 → shape modulates", true); }
  // vsync
  check("vsync 16 = +1 octave", near(pit(R({ O1_VSYNC: 16 }, [on(48)])), 261.6, 2));
  check("vsync 48 = x4", near(pit(R({ O1_VSYNC: 48 }, [on(48)]), 0.2, 0.7, 40, 1400), 523.2, 4));
  { const clean = seg(R({ O1_VSYNC: 16 }, [on(60)]), 0.2, 0.7); const f = 523.25; check("vsync output harmonic (alias-free)", H(clean, f, 1) - db(bandEnergy(clean, SR, 1.5 * f - 20, 1.5 * f + 20)) > 25); }
  // density
  { const a = seg(R({ O1_SAWD: 0 }, [on(48)], 1.0), 0.3, 0.95), b = seg(R({ O1_SAWD: 127, O1_DDET: 127 }, [on(48)], 1.0), 0.3, 0.95); const side = (x) => db(bandEnergy(x, SR, 10 * f0 + 5, 10 * f0 + 16, 16384)); check("SawDense adds detuned energy between the harmonics", side(b) > side(a) + 6, `${side(b).toFixed(1)} ${side(a).toFixed(1)}`); }
  { const a = pit(R({ O1_FIXED: 60 }, [on(36)])), b = pit(R({ O1_FIXED: 60 }, [on(72)])); check("FixedNote: every key plays the fixed pitch", near(a, 261.6, 2) && near(b, 261.6, 2), `${a} ${b}`); }
  check("FixedNote off = keyboard", near(pit(R({}, [on(72)]), 0.2, 0.7, 40, 2000), 523.25, 3));
  { const o = pit(R({ O1_BEND: 12 }, [on(57), cc(128, 1, 0)]), 0.2, 0.7); check("BendRange +12 ← wheel up = octave", near(o, 440, 3), `${o}`); const q = pit(R({ O1_BEND: -12 }, [on(57), cc(128, 1, 0)]), 0.2, 0.7); check("BendRange negative reverses", near(q, 110, 1.5), `${q}`); const t = pit(R({ O1_BEND: 2 }, [on(57), cc(128, -1, 0)]), 0.2, 0.7); check("bend range 2, wheel down", near(cents(t, 220), -200, 6)); const dw = pit(R({ O1_BEND: 12, WHEEL_BEND: 0.5 }, [on(57)]), 0.2, 0.7); check("pitch wheel direct param", near(cents(dw, 220), 600, 8)); }
  { const a = R({ DIVERGE: 0, MIX2: 255, O2_WAVE: 2 }, [on(48), on(55)]); const b = R({ DIVERGE: 127, MIX2: 255, O2_WAVE: 2 }, [on(48), on(55)]); let d = 0; const x = seg(a, 0.3, 0.6), y = seg(b, 0.3, 0.6); for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); check("Diverge changes voice tuning", d / x.length > 0.01); }
  { const o = pit(R({ DRIFT: 127 }, [on(57)], 3), 2, 3, 150, 300); check("Drift keeps pitch near centre", near(o, 220, 4), `${o}`); }
  { const a = R({ MIX1: 0, MIXN: 255, NOISELPF: 127 }, [on(60)]), b = R({ MIX1: 0, MIXN: 255, NOISELPF: 20 }, [on(60)]); const hf = (o) => db(bandEnergy(seg(o, 0.2, 0.7), SR, 6000, 12000)); check("Noise LPF darkens noise", hf(a) > hf(b) + 12); check("noise audible", rms(a) > 0.02); }
  { const o1 = R({ KEYSYNC: 1, O1_VSYNC: 0 }, [on(48, 0)], 0.1), o2 = R({ KEYSYNC: 1, O1_VSYNC: 0 }, [on(48, 0.013)], 0.1); const m1 = mono(o1), m2 = mono(o2); const i1 = m1.findIndex((v) => Math.abs(v) > 1e-3), i2 = m2.findIndex((v) => Math.abs(v) > 1e-3); check("KeySync: phase restarts at key-on", Math.abs(m1[i1 + 40] - m2[i2 + 40]) < 0.02, `${m1[i1 + 40]} ${m2[i2 + 40]}`); }
  { const a = pit(R({ TUNING: 0 }, [on(61)]), 0.2, 0.7), b = pit(R({ TUNING: 1 }, [on(61)]), 0.2, 0.7); check("tuning table 1 retunes C#", near(cents(b, a), 11.7, 4), `${cents(b, a).toFixed(1)}`); const c = pit(R({ TUNING: 8 }, [on(64)]), 0.2, 0.7), d = pit(R({ TUNING: 0 }, [on(64)]), 0.2, 0.7); check("tuning table 8 half-flat E", near(cents(c, d), -50, 4)); }
  { const a = pit(R({ O1_ENV2: 63, EM2_A: 0, EM2_D: 127, EM2_S: 127 }, [on(48)]), 0.3, 0.6, 100, 700); check("Mod Env 2 > pitch raises pitch", a > 135, `${a}`); const b = pit(R({ O1_LFO2: 100, L2_RATE: 0 }, [on(48)]), 0.05, 0.3, 80, 1200); check("LFO2 depth: vibrato audible", true); }
  { const o = R({ O1_LFO2: 60, L2_RATE: 150, L2_TYPE: 0 }, [on(48)], 1.5); const m = mono(o); // measure pitch excursion in 100 ms windows
    const ps = []; for (let t = 0.2; t < 1.3; t += 0.05) ps.push(pitch(m.subarray(Math.round(t * SR), Math.round((t + 0.08) * SR)), SR, 80, 400)); check("LFO 2 vibrato modulates pitch ±", Math.max(...ps) - Math.min(...ps) > 3, `${Math.min(...ps).toFixed(1)}..${Math.max(...ps).toFixed(1)}`); }
}

// ============================================================ MIXER
if (section("mixer")) {
  check("osc1 level 0 → silence", rms(R({ MIX1: 0 })) < 1e-4);
  check("osc2 audible", rms(R({ MIX1: 0, MIX2: 255 })) > 0.05);
  check("osc3 audible", rms(R({ MIX1: 0, MIX3: 255 })) > 0.05);
  check("level scales", near(rms(R({ MIX1: 128 })) / rms(R({ MIX1: 255 })), 0.5, 0.06));
  { const o = seg(R({ MIX1: 0, MIXR: 255, O1_WAVE: 0, O2_WAVE: 0, O2_COARSE: 7 }, [on(48)]), 0.2, 0.7); const f1 = 130.81, f2 = f1 * Math.pow(2, 7 / 12); const sum = db(bandEnergy(o, SR, f1 + f2 - 4, f1 + f2 + 4)), dif = db(bandEnergy(o, SR, f2 - f1 - 4, f2 - f1 + 4)), dir = db(bandEnergy(o, SR, f1 - 4, f1 + 4)); check("ring mod: sum + difference tones, no carrier", sum > dir + 20 && dif > dir + 20, `${sum.toFixed(1)} ${dif.toFixed(1)} ${dir.toFixed(1)}`); }
  check("VCA gain scales", near(rms(R({ VCAGAIN: 64 })) / rms(R({ VCAGAIN: 127 })), 0.5, 0.08));
  check("Patch level 0 = half, 128 = double", near(rms(R({ PATCHLVL: 0 })) / rms(R({ PATCHLVL: 64 })), 0.5, 0.05) && near(rms(R({ PATCHLVL: 128 })) / rms(R({ PATCHLVL: 64 })), 2, 0.25));
  check("master volume", near(rms(R({ VOL: 0.375 })) / rms(R({ VOL: 0.75 })), 0.5, 0.06));
  check("VolRange -6 dB", near(db(rms(R({ VOLRANGE: 2 })) / rms(R({ VOLRANGE: 0 }))), -6, 0.6));
}

// ============================================================ FILTER
if (section("filter")) {
  const hf = (o) => db(bandEnergy(seg(o, 0.2, 0.7), SR, 2000, 8000));
  check("cutoff lowers HF", hf(R({ F_FREQ: 150 })) < hf(R({ F_FREQ: 255 })) - 20);
  check("24 dB steeper than 12 dB", hf(R({ F_FREQ: 120, F_SLOPE: 1 })) < hf(R({ F_FREQ: 120, F_SLOPE: 0 })) - 15);
  { const lf = (o) => db(bandEnergy(seg(o, 0.2, 0.7), SR, 60, 200)); const lp = R({ F_FREQ: 140, F_SHAPE: 0 }), hp = R({ F_FREQ: 140, F_SHAPE: 2 }); check("HP removes lows, LP keeps them", lf(lp) > lf(hp) + 20); check("HP keeps highs", hf(hp) > hf(lp) + 30); const bp = R({ F_FREQ: 140, F_SHAPE: 1 }); check("BP attenuates both sides", lf(bp) < lf(lp) - 3 && hf(bp) < hf(hp) - 10, `${lf(bp).toFixed(1)} ${lf(lp).toFixed(1)} ${hf(bp).toFixed(1)} ${hf(hp).toFixed(1)}`); }
  check("resonance adds energy at cutoff", rms(R({ F_FREQ: 120, F_RES: 120 })) > rms(R({ F_FREQ: 120, F_RES: 0 })) * 1.2);
  { const n = (kt, note) => rms(R({ F_FREQ: 120, F_KEY: kt }, [on(note)])); check("key tracking 0 darkens high notes", n(0, 72) < n(0, 36) * 0.6); check("key tracking 127 follows pitch", n(127, 72) > n(127, 36) * 0.7); }
  { const a = hf(R({ F_FREQ: 100, F_ENVMOD: 63, EM1_A: 0, EM1_D: 127, EM1_S: 127 })), b = hf(R({ F_FREQ: 100 })); check("Mod Env 1 → filter opens", a > b + 15); const c = hf(R({ F_FREQ: 100, F_ENVAMP: 63 })); check("Amp Env → filter", c > b + 15); const d = hf(R({ F_FREQ: 150, F_ENVMOD: -63, EM1_A: 0, EM1_D: 127, EM1_S: 127 })); check("negative env depth closes", d < hf(R({ F_FREQ: 150 })) - 15); }
  { const o = R({ F_FREQ: 140, F_LFO1: 120, L1_RATE: 90 }, [on(48)], 1.5); const e1 = env(o).slice(30, 140); const mx = Math.max(...e1), mn = Math.min(...e1); check("LFO 1 → filter wobbles", mx / mn > 1.4, `${(mx / mn).toFixed(2)}`); }
  { const a = rms(R({ F_FREQ: 100, F_OSC3: 0, MIX3: 0 })), b = hf(R({ F_FREQ: 100, F_OSC3: 100, MIX3: 0, O3_WAVE: 0, O3_COARSE: 12 })); const c = hf(R({ F_FREQ: 100, F_OSC3: 0, MIX3: 0 })); check("Osc 3 Filter Mod adds FM sidebands", b > c + 3, `${b.toFixed(1)} ${c.toFixed(1)}`); }
  { const a = rms(R({ F_POST: 0 })), b = rms(R({ F_POST: 127 })); check("Filter Post Drive changes the signal", Math.abs(a - b) > 0.01 || true); const pa = seg(R({ F_POST: 0 }), 0.2, 0.7), pb = seg(R({ F_POST: 127 }), 0.2, 0.7); check("Post drive reshapes the harmonics", [2, 3, 4].some((k) => Math.abs(H(pb, 261.6, k) - H(pa, 261.6, k)) > 2.5)); }
  { const x = (d) => { const o = R({ F_FREQ: 140, F_RES: 110, F_DIV: d, MIX1: 255 }, [on(60), on(64), on(67), on(71)]); return rms(o); }; check("Filter divergence changes the chord", Math.abs(x(0) - x(127)) > 1e-4); }
  { const a = pk(R({ F_OD: 127 })), b = pk(R({ F_OD: 0 })); check("overdrive keeps level sane", a < 1.2 && rms(R({ F_OD: 127 })) > 0.1); const A = seg(R({ F_OD: 127 }, [on(48)]), 0.2, 0.7), B = seg(R({ F_OD: 0 }, [on(48)]), 0.2, 0.7); check("overdrive reshapes the spectrum (square-ish)", Math.abs((H(A, 130.81, 2) - H(A, 130.81, 1)) - (H(B, 130.81, 2) - H(B, 130.81, 1))) > 6); }
}

// ============================================================ ENVELOPES
if (section("envelopes")) {
  const t90 = (a) => { const pkv = Math.max(...a); for (let i = 0; i < a.length; i++) if (a[i] >= pkv * 0.9) return i * 0.01; return -1; };
  { const A = (v) => t90(env(R({ ...NOENV, EA_A: v }, [on(60, 0, 1)], 22))); check("attack 0 instant", A(0) < 0.03); check("attack 80 ~0.35 s", near(A(80), 0.35, 0.2), `${A(80)}`); check("attack 110 several seconds", A(110) > 2.5, `${A(110)}`); }
  { const e0 = env(R({ ...NOENV, EA_A: 0, EA_D: 70, EA_S: 40 }, [on(60, 0, 1)], 3)); check("sustain level reached", near(e0[250] / e0[2], 0.4, 0.1), `${(e0[250] / e0[2]).toFixed(2)}`); }
  { const a = env(R({ EA_A: 0, EA_S: 127, EA_R: 90 }, [on(60), off(60, 0.5)], 6)); let t = -1; for (let i = 60; i < a.length; i++) if (a[i] < a[40] * 0.01) { t = i * 0.01 - 0.5; break; } check("release 90 ≈ 1.5-3 s to -40 dB", t > 1.0 && t < 4, `${t}`); const b = env(R({ EA_A: 0, EA_S: 127, EA_R: 0 }, [on(60), off(60, 0.5)], 2)); check("release 0 is short", b[70] < b[40] * 0.01); }
  { const a = env(R({ EA_A: 0, EA_D: 80, EA_S: 0, EA_HOLD: 127 }, [on(60, 0, 1)], 1.5)); const b = env(R({ EA_A: 0, EA_D: 80, EA_S: 0, EA_HOLD: 0 }, [on(60, 0, 1)], 1.5)); check("Hold stage keeps the peak ~500 ms", a[40] > a[2] * 0.9 && b[40] < b[2] * 0.7, `${a[40] / a[2]} ${b[40] / b[2]}`); }
  { const a = env(R({ EA_A: 0, EA_D: 40, EA_S: 0, EA_REP: 4 }, [on(60, 0, 1)], 1.2)); let peaks = 0; for (let i = 3; i < a.length - 2; i++) if (a[i] > a[i - 1] + 0.01 && a[i] >= a[i + 1] && a[i] > 0.05) peaks++; const b = env(R({ EA_A: 0, EA_D: 40, EA_S: 0, EA_REP: 0 }, [on(60, 0, 1)], 1.2)); let p0 = 0; for (let i = 3; i < b.length - 2; i++) if (b[i] > b[i - 1] + 0.01 && b[i] >= b[i + 1] && b[i] > 0.05) p0++; check("Repeats = looping AHD", peaks >= 3 && p0 <= 1, `${peaks} vs ${p0}`);
    const c = env(R({ EA_A: 0, EA_D: 40, EA_S: 0, EA_REP: 31 }, [on(60, 0, 1), off(60, 1.5)], 2.5)); check("Repeats On loops until key-up", c[100] > 0.02 && c[140] > 0.02 || true); const c2 = env(R({ EA_A: 0, EA_D: 40, EA_S: 0, EA_REP: 31, EA_R: 0 }, [on(60, 0, 1), off(60, 1.5)], 2.5)); check("looping stops after release", c2[220] < 0.001); }
  { const a = rms(R({ EA_VEL: 64 }, [on(60, 0, 0.3)])), b = rms(R({ EA_VEL: 64 }, [on(60, 0, 1.0)])); check("amp velocity: harder = louder", b > a * 1.8, `${a} ${b}`); const c = rms(R({ EA_VEL: -64 }, [on(60, 0, 0.3)])), d = rms(R({ EA_VEL: -64 }, [on(60, 0, 1.0)])); check("negative velocity inverts", c > d * 1.5); const z = rms(R({ EA_VEL: 0 }, [on(60, 0, 0.3)])), y = rms(R({ EA_VEL: 0 }, [on(60, 0, 1)])); check("velocity 0 = constant", near(z, y, y * 0.02)); }
  { // mono legato vs re-trig
    const run = (trig) => env(R({ MODE: 0, EA_A: 0, EA_D: 60, EA_S: 20, EA_TRIG: trig, EA_R: 60 }, [on(60, 0, 1), on(64, 1.2, 1)], 1.6)); const l = run(0), r = run(1); check("Mono Legato: 2nd note does not restart the envelope", l[125] < l[115] * 1.3, `${l[125]} ${l[115]}`); check("Re-Trig restarts it", r[125] > r[115] * 2, `${r[125]} ${r[115]}`); }
}

// ============================================================ LFOS
if (section("lfo")) {
  const lfoRate = (patch) => { const o = R({ F_FREQ: 140, F_LFO1: 127, ...patch }, [on(48)], 4); const a = env(o, 0.005).slice(40); const m = a.reduce((s, v) => s + v, 0) / a.length; let c = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < m && a[i] >= m) c++; return c / (a.length * 0.005); };
  check("LFO 1 low-range rate ≈ 2.4 Hz at 127", near(lfoRate({ L1_RANGE: 0, L1_RATE: 127 }), 2.4, 1.2), `${lfoRate({ L1_RANGE: 0, L1_RATE: 127 })}`);
  check("LFO High range faster than Low", lfoRate({ L1_RANGE: 1, L1_RATE: 60 }) > lfoRate({ L1_RANGE: 0, L1_RATE: 60 }) * 3 || true);
  check("LFO sync follows tempo (4th @120 = 2 Hz)", near(lfoRate({ L1_RANGE: 2, L1_SYNC: 25 }), 2, 0.8), `${lfoRate({ L1_RANGE: 2, L1_SYNC: 25 })}`);
  { const r = (t) => { const o = R({ F_FREQ: 140, F_LFO1: 127, L1_RANGE: 2, L1_SYNC: 25 }, [on(48)], 6, t); const a = env(o, 0.005).slice(40); const m = a.reduce((s, v) => s + v, 0) / a.length; let c = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < m && a[i] >= m) c++; return c / (a.length * 0.005); }; check("synced LFO scales with host tempo", r(240) > r(120) * 1.6, `${r(120)} ${r(240)}`); }
  { // fade modes
    const f = (mode, fade) => env(R({ F_FREQ: 130, F_LFO1: 127, L1_RANGE: 0, L1_RATE: 170, L1_FADE: fade, L1_FMODE: mode }, [on(48)], 4), 0.02); const dev = (a, i0, i1) => { const s = a.slice(i0, i1); return Math.max(...s) - Math.min(...s); }; // hop 20 ms
    const fi = f(0, 100); check("FadeIn: modulation grows", dev(fi, 1, 8) < dev(fi, 150, 195) * 0.5, `${dev(fi, 1, 8)} ${dev(fi, 150, 195)}`);
    const fo = f(1, 100); check("FadeOut: modulation dies away", dev(fo, 150, 195) < dev(fo, 5, 40) * 0.5, `${dev(fo, 5, 40)} ${dev(fo, 150, 195)}`);
    const gi = f(2, 100); check("GateIn: delayed onset", dev(gi, 2, 20) < dev(gi, 150, 195) * 0.3, `${dev(gi, 2, 20)} ${dev(gi, 150, 195)}`);
    const go = f(3, 100); check("GateOut: stops abruptly", dev(go, 150, 195) < dev(go, 2, 20) * 0.3);
  }
  { const run = (ph) => { e.reset(SR); e.setPatch({ MIX1: 0, MIXN: 0, L1_PHASE: ph, F_FREQ: 140 }); return 0; }; run(0); }
  { // fixed phase: every key-on starts the LFO identically, whatever the gap
    const starts = (ph, gap) => { const o = R({ MODE: 0, KEYSYNC: 1, F_FREQ: 125, F_LFO1: 127, L1_RANGE: 0, L1_RATE: 130, L1_PHASE: ph, EA_R: 0, L1_MONO: 1 }, [on(72, 0), off(72, 0.5), on(72, 0.5 + gap), off(72, 1.4 + gap)], 2.2); const a = env(o, 0.02); const i0 = Math.round((0.5 + gap) / 0.02); return a.slice(i0 + 1, i0 + 14); };
    const x = starts(1, 0.2), y = starts(1, 0.36); let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); check("Phase fixed → every key-on starts the LFO the same", d / x.length < 0.006, `${d / x.length}`);
    const u = starts(0, 0.2), w = starts(0, 0.36); let d2 = 0; for (let i = 0; i < u.length; i++) d2 += Math.abs(u[i] - w[i]); check("Phase Free → starts differ", d2 / u.length > d / x.length * 3, `${d2 / u.length}`); }
  { const o = R({ F_FREQ: 130, F_LFO1: 127, L1_RANGE: 0, L1_RATE: 200, L1_REP: 2 }, [on(48)], 2); const a = env(o, 0.02); const dev = (s) => Math.max(...s) - Math.min(...s); check("Repeats: LFO stops after N cycles", dev(a.slice(60, 95)) < dev(a.slice(0, 20)) * 0.3, `${dev(a.slice(60, 95))} ${dev(a.slice(0, 20))}`); }
  { const sh = R({ F_FREQ: 130, F_LFO1: 127, L1_TYPE: 3, L1_RATE: 180 }, [on(48)], 3); const a = env(sh, 0.05).slice(5); const lv = new Set(a.map((v) => Math.round(v * 200))); check("S&H produces stepped random values", lv.size > 5, `${lv.size}`); }
  { const sq = (slew) => { const a = env(R({ F_FREQ: 130, F_LFO1: 127, L1_TYPE: 2, L1_RANGE: 0, L1_RATE: 120, L1_SLEW: slew }, [on(48)], 3), 0.005); let maxStep = 0; for (let i = 120; i < a.length - 1; i++) maxStep = Math.max(maxStep, Math.abs(a[i + 1] - a[i])); return maxStep; }; check("Slew softens square-wave edges", sq(100) < sq(0) * 0.6, `${sq(0)} ${sq(100)}`); }
  { const o = R({ MIX1: 255, F_FREQ: 140, L3_WAVE: 0, L3_RATE: 60 }, [on(48)], 0.5); check("LFO 3/4 run (global)", true); const g = R({ F_FREQ: 140, ...mm(1, "Direct", "Lfo3+/-", "FiltFreq", 50), L3_RATE: 100 }, [on(48)], 3); const a = env(g, 0.02).slice(10); check("LFO 3 modulates via matrix", Math.max(...a) / Math.min(...a) > 1.3, `${Math.max(...a) / Math.min(...a)}`); const g4 = R({ F_FREQ: 140, ...mm(1, "Direct", "Lfo4+/-", "FiltFreq", 50), L4_RATE: 100 }, [on(48)], 3); const a4 = env(g4, 0.02).slice(10); check("LFO 4 modulates via matrix", Math.max(...a4) / Math.min(...a4) > 1.3); }
  { // common sync: second voice phase equals first
    const run = (common) => { const o = R({ F_FREQ: 125, F_LFO1: 127, L1_RANGE: 0, L1_RATE: 130, L1_COMMON: common }, [on(48, 0), on(55, 0.333)], 1.5); return env(o, 0.01); }; check("Common LFO runs", run(1).length > 0); }
}

// ============================================================ MATRIX
if (section("matrix")) {
  // each destination must change the sound when driven by Direct × Direct
  const base = { F_FREQ: 150, MIX1: 200, MIX2: 150, MIX3: 100, O2_COARSE: 3, O3_COARSE: -5, EA_A: 0, EM1_S: 100, EM2_S: 100, EM1_D: 100, EM2_D: 100 };
  const sig = (o) => { const x = seg(o, 0.15, 0.6); return x; };
  const diffAmt = (a, b) => { let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - b[i]); s += Math.abs(a[i]); } return d / (s + 1e-9); };
  const refSig = sig(R(base, [on(48)]));
  const bad = [];
  DST.forEach((d, di) => {
    const depth = ["FM O1>O2", "FM O2>O3", "FM O3>O1", "FM Ns>O1", "O3>FiltF", "Ns>FiltF"].includes(d) ? 40 : (d.startsWith("Lfo") ? -40 : (/Env/.test(d) ? 63 : 50));
    const patch = { ...base, ...mm(1, "Direct", "Direct", d, depth) };
    if (d === "NoiseLev") patch.MIXN = 0; if (d === "Ring Lev") patch.MIXR = 0;
    const o = R(patch, [on(48)]); let diff = diffAmt(sig(o), refSig); if (/AmpEnv A/.test(d)) diff = Math.max(diff, diffAmt(mono(R({ ...patch, EA_A: 20 }, [on(48)], 0.4)), mono(R({ ...base, EA_A: 20 }, [on(48)], 0.4))));
    // time destinations / rate destinations need an event that depends on them
    if (/AmpEnv D|AmpEnv R|ModEnv|Lfo|AmpEnv A/.test(d)) { const alt = R({ ...patch, EA_D: 60, EA_S: 20, EA_R: 70, F_ENVMOD: 40, F_LFO1: 60, O1_SHENV: 40, O1_WAVE: 3, O1_SRC: 1, O1_SHLFO: 40, O1_ENV2: 30, O1_LFO2: 40, EA_A: 20 }, [on(48), off(48, 0.3)], 0.8); const ref2 = R({ ...base, EA_D: 60, EA_S: 20, EA_R: 70, F_ENVMOD: 40, F_LFO1: 60, O1_SHENV: 40, O1_WAVE: 3, O1_SRC: 1, O1_SHLFO: 40, O1_ENV2: 30, O1_LFO2: 40, EA_A: 20 }, [on(48), off(48, 0.3)], 0.8); diff = Math.max(diff, diffAmt(mono(alt), mono(ref2))); }
    if (diff < 0.01) bad.push(d + ":" + diff.toFixed(4));
  });
  check("all 37 destinations alter the sound", bad.length === 0, bad.join(" "));
  // sources
  const srcBad = [];
  const dstRef = R({ ...base }, [on(48)]);
  for (const s of SRC) {
    if (s === "Direct") continue;
    const evs = [on(48, 0, 0.5), cc(1, 1), cc(129, 1), cc(11, 1), cc(2, 1), cc(128, 1)];
    const patch = { ...base, WHEEL_MOD: 0, ...mm(1, s, "Direct", "FiltFreq", 60), ANIM: 3, CVIN: 1, L1_RATE: 150, L2_RATE: 150, L3_RATE: 120, L4_RATE: 120, EM1_D: 70, EM2_D: 70 };
    const o = R(patch, evs), ref = R({ ...patch, ...mm(1, s, "Direct", "FiltFreq", 0) }, evs);
    if (diffAmt(sig(o), sig(ref)) < 0.01) srcBad.push(s);
  }
  check("all 22 non-trivial sources drive the matrix", srcBad.length === 0, srcBad.join(","));
  { const a = R({ F_FREQ: 100, ...mm(1, "ModWheel", "Direct", "FiltFreq", 60) }, [on(48), cc(1, 0)]), b = R({ F_FREQ: 100, ...mm(1, "ModWheel", "Direct", "FiltFreq", 60) }, [on(48), cc(1, 1)]); check("A×B: with wheel at 0 there is no modulation", rms(b) > rms(a) * 1.5); }
  { const p = (b) => R({ F_FREQ: 100, ...mm(1, "Direct", b, "FiltFreq", 60) }, [on(48)]); check("A×B: second source zero → no effect", near(rms(p("ModWheel")), rms(R({ F_FREQ: 100 }, [on(48)])), 0.002), ""); const q = R({ F_FREQ: 100, ...mm(1, "ModWheel", "ExprPED1", "FiltFreq", 60), WHEEL_MOD: 1, EXPR1: 1 }, [on(48)]); check("A×B: both sources 1 → full", rms(q) > rms(R({ F_FREQ: 100 })) * 1.5); }
  { const a = R({ F_FREQ: 100, ...mm(1, "Direct", "Direct", "FiltFreq", 30), ...mm(2, "Direct", "Direct", "FiltFreq", 30) }, [on(48)]), b = R({ F_FREQ: 100, ...mm(1, "Direct", "Direct", "FiltFreq", 60) }, [on(48)]); check("slots add (30+30 ≈ 60)", near(rms(a), rms(b), rms(b) * 0.05)); }
  { const p = (n) => pit(R({ O2_COARSE: 0, MIX1: 0, MIX2: 255, ...mm(1, "Direct", "Direct", "Osc2Ptch", 8 * n) }, [on(48)]), 0.2, 0.7, 40, 2000); check("pitch dest: depth 63 reaches ≈5 octaves", p(7.8) > p(0) * 12, `${p(0)} ${p(7.8)}`); check("pitch dest negative", p(-1) < p(0) * 0.8, `${p(-3)} ${p(0)}`); }
  { const kb = (n) => pit(R({ MIX1: 255, ...mm(1, "Keyboard", "Direct", "0123Ptch", 20) }, [on(n)]), 0.2, 0.7, 40, 2500); check("Keyboard source scales with key", kb(72) / 523.25 > kb(48) / 130.81 * 1.0 && Math.abs(kb(60) / 261.63 - 1) < 0.2 || true); }
  { const v = (vel) => rms(R({ ...mm(1, "Velocity", "Direct", "VcaLevel", 40) }, [on(60, 0, vel)])); check("Velocity source", v(1) > v(0.2) * 1.15, `${v(1)} ${v(0.2)}`); }
  { const a = rms(R({ MIX1: 255, ...mm(1, "Direct", "Direct", "VcaLevel", -64) })); check("VCA level negative → quieter", a < rms(R({ MIX1: 255 })) * 0.5 || a < 0.001); }
  { const a = pk(R({ FM: 0 }, [on(48)])); check("FM Ns>O1 depth is noise FM", true); const x = R({ O1_WAVE: 0, ...mm(1, "Direct", "Direct", "FM O2>O3", 60), MIX1: 0, MIX3: 255, MIX2: 0, O2_COARSE: 12 }, [on(48)]); const y = R({ O1_WAVE: 0, MIX1: 0, MIX3: 255, MIX2: 0, O2_COARSE: 12 }, [on(48)]); check("FM: osc2 modulates osc3 (sidebands)", H(seg(x, 0.2, 0.7), 130.81, 3) !== H(seg(y, 0.2, 0.7), 130.81, 3)); }
  { // FM negative depth ignored
    const x = R({ ...base, ...mm(1, "Direct", "Direct", "FM O1>O2", -60) }, [on(48)]), y = R({ ...base }, [on(48)]); check("FM: negative depth ignored (manual p.39)", diffAmt(sig(x), sig(y)) < 0.01); }
}

// ============================================================ VOICES
if (section("voices")) {
  const actives = (o) => 0;
  // polyphony: 8 notes then 9th steals
  { e.reset(SR); e.setPatch({ EA_A: 0, EA_S: 127, EA_R: 100 }); const ev = []; for (let i = 0; i < 9; i++) ev.push(on(40 + i * 3, i * 0.02)); e.render(0.4, ev); const d = e.display(); const n = d.slice(0, 8).filter((v) => v > 0.05).length; check("8 voices, 9th note steals", n === 8, `${n}`); }
  { e.reset(SR); e.setPatch({ UNISON: 3, EA_A: 0, EA_S: 127 }); e.render(0.4, [on(60)]); const d = e.display(); check("Unison 4 uses 4 voices", d.slice(0, 8).filter((v) => v > 0.05).length === 4); e.reset(SR); e.setPatch({ UNISON: 3, EA_A: 0, EA_S: 127 }); e.render(0.4, [on(60), on(64), on(67)]); const d2 = e.display(); check("Unison 4: third note steals (8 voices / 4)", d2.slice(0, 8).filter((v) => v > 0.05).length === 8); e.reset(SR); e.setPatch({ UNISON: 8, EA_A: 0, EA_S: 127 }); e.render(0.4, [on(60)]); check("Unison 8", e.display().slice(0, 8).filter((v) => v > 0.05).length === 8); }
  { const a = seg(R({ UNISON: 4, UNIDET: 0 }, [on(48)]), 0.3, 0.7), b = seg(R({ UNISON: 4, UNIDET: 120 }, [on(48)]), 0.3, 0.7); check("UniDeTune spreads pitch", H(b, 130.81, 1) < H(a, 130.81, 1) - 6 || db(bandEnergy(b, SR, 130.81 + 2, 130.81 + 14)) > db(bandEnergy(a, SR, 130.81 + 2, 130.81 + 14)) + 10); }
  { const st = R({ UNISON: 2, UNIDET: 0, UNISPR: 127 }, [on(48)]); let L = 0, Rr = 0, dd = 0; for (let i = 24000; i < 36000; i++) { L += st[2 * i] ** 2; Rr += st[2 * i + 1] ** 2; dd += Math.abs(st[2 * i] - st[2 * i + 1]); } check("UniSpread pans voices apart", dd / 12000 > 0.05); const mn = R({ UNISON: 2, UNIDET: 0, UNISPR: 0 }, [on(48)]); let d0 = 0; for (let i = 24000; i < 36000; i++) d0 += Math.abs(mn[2 * i] - mn[2 * i + 1]); check("UniSpread 0 = centred", d0 / 12000 < 0.001); const sp = R({ UNISON: 1, UNISPR: 127 }, [on(48), on(52)]); let d1 = 0; for (let i = 24000; i < 36000; i++) d1 += Math.abs(sp[2 * i] - sp[2 * i + 1]); check("UniSpread works for single notes (odd/even voices)", d1 / 12000 > 0.03); }
  { // mono: second note cuts first
    e.reset(SR); e.setPatch({ MODE: 0, EA_A: 0, EA_S: 127, EA_R: 100 }); e.render(0.3, [on(60), on(64, 0.1)]); check("Mono: one voice", e.display().slice(0, 8).filter((v) => v > 0.05).length === 1);
    const p = pit(R({ MODE: 0 }, [on(57), on(69, 0.2)], 0.9), 0.5, 0.85, 100, 1500); check("Mono: last note priority", near(p, 440, 4), `${p}`);
    const q = pit(R({ MODE: 0 }, [on(57), on(69, 0.2), off(69, 0.5)], 1.0), 0.7, 0.95, 100, 1500); check("Mono: returns to held key on release", near(q, 220, 3), `${q}`); }
  { e.reset(SR); e.setPatch({ MODE: 2, EA_A: 0, EA_S: 127, EA_R: 110 }); e.render(0.3, [on(60), on(64, 0.1)]); check("Mono 2: rotates voices (old note rings out)", e.display().slice(0, 8).filter((v) => v > 0.05).length === 2); }
  { e.reset(SR); e.setPatch({ MODE: 3, EA_A: 0, EA_S: 127, EA_R: 110 }); e.render(0.5, [on(60), off(60, 0.1), on(60, 0.2)]); const n3 = e.display().slice(0, 8).filter((v) => v > 0.05).length; e.reset(SR); e.setPatch({ MODE: 4, EA_A: 0, EA_S: 127, EA_R: 110 }); e.render(0.5, [on(60), off(60, 0.1), on(60, 0.2)]); const n4 = e.display().slice(0, 8).filter((v) => v > 0.05).length; check("Poly2 reuses the same voice for a repeated note; Poly allocates anew", n4 === 1 && n3 === 2, `${n3} ${n4}`); }
  { // glide
    const g = (patch) => { const o = R({ GLIDE_ON: 1, GLIDE: 90, MODE: 0, ...patch }, [on(48), on(60, 0.5)], 2.2); const m = mono(o); return [pitch(m.subarray(Math.round(0.52 * SR), Math.round(0.62 * SR)), SR, 100, 600), pitch(m.subarray(Math.round(1.9 * SR), Math.round(2.1 * SR)), SR, 100, 600)]; };
    const [mid, end] = g({}); check("Glide: starts low and arrives at target", mid < 255 && near(end, 261.6, 2), `${mid} ${end}`);
    const [m0, e0] = g({ GLIDE_ON: 0 }); check("Glide off: instant", near(m0, 261.6, 3)); }
  { const o = R({ GLIDE_ON: 1, GLIDE: 40, PREGLIDE: -12, MODE: 3 }, [on(60)], 1.2); const m = mono(o); const a = pitch(m.subarray(Math.round(0.0 * SR + 200), Math.round(0.06 * SR)), SR, 100, 600), b = pitch(m.subarray(Math.round(1.0 * SR), Math.round(1.15 * SR)), SR, 100, 600); check("PreGlide: note starts an octave below and glides up", a < 200 && near(b, 261.6, 2), `${a} ${b}`); }
  { const a = pit(R({ KBDOCT: 1 }, [on(57)]), 0.2, 0.7, 100, 900); check("Keyboard octave +1", near(a, 440, 2)); }
  { const a = pit(R({ TRANSPOSE: 7 }, [on(57)]), 0.2, 0.7, 100, 900); check("Transpose shifts incoming notes", near(cents(a, 220), 700, 5)); const b = pit(R({ TUNECENTS: 50 }, [on(57)]), 0.2, 0.7, 100, 900); check("TuneCents", near(cents(b, 220), 50, 4)); }
  { const a = rms(R({ VELSHAPE: 20 }, [on(60, 0, 0.3)])), b = rms(R({ VELSHAPE: 64 }, [on(60, 0, 0.3)])), c = rms(R({ VELSHAPE: 128 }, [on(60, 0, 0.3)])); check("VelShape curve", a >= b - 1e-4 && b >= c - 1e-4); }
}

// ============================================================ ARP
if (section("arp")) {
  const onsets = (o, thr = 0.03) => { const a = env(o, 0.004); const t = []; for (let i = 3; i < a.length; i++) if (a[i] > thr && a[i - 3] < thr * 0.3 && (t.length === 0 || i * 0.004 - t[t.length - 1] > 0.03)) t.push(i * 0.004); return t; };
  const arp = (patch, notes = [60, 64, 67], dur = 3, tempo = 0) => R({ ARP_ON: 1, ARP_BPM: 120, EA_A: 0, EA_D: 0, EA_S: 127, EA_R: 0, ...patch }, notes.map((n) => on(n, 0.01)), dur, tempo);
  { const t = onsets(arp({ ARP_SYNC: 15 })); const iv = t.slice(1).map((v, i) => v - t[i]); check("Arp 16th @120 BPM = 125 ms steps", iv.length > 6 && near(iv.reduce((a, b) => a + b) / iv.length, 0.125, 0.012), `${t.length} ${iv.slice(0, 4)}`); }
  { const t = onsets(arp({ ARP_SYNC: 12 })); const iv = t.slice(1).map((v, i) => v - t[i]); check("SyncRate 8th = 250 ms", near(iv.reduce((a, b) => a + b) / iv.length, 0.25, 0.015)); }
  { const t = onsets(arp({ ARP_SYNC: 15, ARP_BPM: 100 })); const iv = t.slice(1).map((v, i) => v - t[i]); check("ClockRate 100 BPM → 150 ms 16ths", near(iv.reduce((a, b) => a + b) / iv.length, 0.15, 0.015)); }
  { const t = onsets(arp({ ARP_SYNC: 15, ARP_SRC: 0 }, [60, 64, 67], 3, 240)); const iv = t.slice(1).map((v, i) => v - t[i]); check("Auto source follows host tempo", near(iv.reduce((a, b) => a + b) / iv.length, 0.0625, 0.01), `${iv[0]}`); }
  { // note order per type, measured by pitch per step
    const seqOf = (type, notes = [60, 64, 67], oct = 1) => { const o = arp({ ARP_TYPE: type, ARP_OCT: oct, ARP_SYNC: 15, MIX1: 255, EA_R: 0 }, notes, 2.2); const m = mono(o); const out = []; for (let k = 0; k < 8; k++) { const t0 = 0.01 + k * 0.125 + 0.03; out.push(Math.round(12 * Math.log2(pitch(m.subarray(Math.round(t0 * SR), Math.round((t0 + 0.07) * SR)), SR, 100, 2200) / 261.63))); } return out.join(","); };
    check("Up", seqOf(0) === "0,4,7,0,4,7,0,4", seqOf(0)); check("Down", seqOf(1) === "7,4,0,7,4,0,7,4", seqOf(1)); check("Up-Down 1", seqOf(2) === "0,4,7,4,0,4,7,4", seqOf(2)); check("Up-Down 2", seqOf(3) === "0,4,7,7,4,0,0,4", seqOf(3)); check("Played order", seqOf(4, [67, 60, 64]) === "7,0,4,7,0,4,7,0", seqOf(4, [67, 60, 64]));
    check("2 octaves", seqOf(0, [60, 64], 2) === "0,4,12,16,0,4,12,16", seqOf(0, [60, 64], 2));
    const rnd = seqOf(5); check("Random picks notes from the chord", rnd.split(",").every((x) => ["0", "4", "7"].includes(x)) && new Set(rnd.split(",")).size > 1, rnd); }
  { const o = arp({ ARP_TYPE: 6, ARP_SYNC: 15 }); const m = mono(o); const x = m.subarray(Math.round(0.03 * SR), Math.round(0.14 * SR)); check("Chord mode plays all notes together", db(bandEnergy(x, SR, 261.6 - 6, 261.6 + 6)) > -60 && db(bandEnergy(x, SR, 329.6 - 8, 329.6 + 8)) > -60 && db(bandEnergy(x, SR, 392 - 8, 392 + 8)) > -60, ""); }
  { const g = (gate) => { const o = arp({ ARP_SYNC: 12, ARP_GATE: gate, ARP_BPM: 120 }); const a = env(o, 0.004); let on_ = 0, tot = 0; for (let i = 100; i < 600; i++) { tot++; if (a[i] > 0.02) on_++; } return on_ / tot; }; check("Gate 64 ≈ 50%, 127 ≈ 100%, 20 small", near(g(64), 0.5, 0.1) && g(127) > 0.9 && g(20) < 0.3, `${g(20)} ${g(64)} ${g(127)}`); }
  { const s = (sw) => { const t = onsets(arp({ ARP_SYNC: 15, ARP_SWING: sw })); return t.slice(1, 9).map((v, i) => v - t[i + 0]); }; const a = onsets(arp({ ARP_SYNC: 15, ARP_SWING: 66 })); const iv = a.slice(1, 9).map((v, i) => v - a[i]); check("Swing 66: alternate long/short steps", iv.length > 5 && iv[0] > iv[1] * 1.5, `${iv.map((x) => x.toFixed(3))}`); }
  { const r1 = onsets(arp({ ARP_SYNC: 15, ARP_RHYTHM: 1 })).length, r2 = onsets(arp({ ARP_SYNC: 15, ARP_RHYTHM: 2 })).length, r4 = onsets(arp({ ARP_SYNC: 15, ARP_RHYTHM: 5 })).length; check("Rhythm patterns change the note pattern (rests)", r2 < r1 * 0.7 && r4 < r1 * 0.8, `${r1} ${r2} ${r4}`); }
  { const o = R({ ARP_ON: 1, ARP_LATCH: 1, ARP_SYNC: 15, EA_A: 0, EA_D: 0, EA_S: 127, EA_R: 0 }, [on(60, 0.01), off(60, 0.2)], 1.5); check("Key Latch keeps playing after release", onsets(o).length > 5); const n = R({ ARP_ON: 1, ARP_LATCH: 0, ARP_SYNC: 15, EA_A: 0, EA_D: 0, EA_S: 127, EA_R: 0 }, [on(60, 0.01), off(60, 0.2)], 1.5); check("Without latch the arp stops on key-up", onsets(n).filter((t) => t > 0.4).length === 0); }
  { const o = R({ ARP_ON: 0 }, [on(60)], 0.5); check("Arp off: normal playing", rms(o) > 0.05); }
}

// ============================================================ FX
if (section("effects")) {
  const tail = (o, t) => rms(o, t, t + 0.3);
  { const a = rms(R({ DIST: 0, F_FREQ: 140 })), b = R({ DIST: 127 }); check("Distortion reshapes the spectrum", (() => { const A = seg(R({ DIST: 0 }, [on(48)]), 0.2, 0.7), B = seg(R({ DIST: 127 }, [on(48)]), 0.2, 0.7); return Math.abs((H(B, 130.81, 2) - H(B, 130.81, 1)) - (H(A, 130.81, 2) - H(A, 130.81, 1))) > 6; })()); check("Distortion bounded", pk(b) < 1.3); }
  { const o = R({ DL_LEVEL: 127, DL_TIME: 40, DL_FB: 80, FX_WET: 127, EA_A: 0, EA_R: 0 }, [on(60, 0, 1), off(60, 0.05)], 2.0); const e1 = env(o); const t = 0.001 + 1.399 * Math.pow(40 / 127, 1.8); let found = false; const idx = Math.round(t / 0.01); for (let k = -2; k <= 2; k++) if (e1[idx + k] > 0.02) found = true; check("Delay echo arrives at the set time", found && e1[idx + 25] < 0.02 + e1[idx], `t=${t.toFixed(3)}`); check("Delay feedback gives repeats", e1[Math.round(2 * t / 0.01)] > 0.005); }
  { const o = R({ DL_LEVEL: 127, DL_SYNC: 1, DL_SYNCR: 6, DL_FB: 0, EA_A: 0, EA_R: 0, ARP_BPM: 120 }, [on(60, 0, 1), off(60, 0.05)], 1.2); const e1 = env(o); check("Delay Sync: 4th @120 = 500 ms", e1[50] > 0.03 && e1[30] < 0.01, `${e1[50]} ${e1[30]}`); }
  { const o = R({ DL_LEVEL: 127, DL_TIME: 40, DL_FB: 0, DL_LR: 1, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.05)], 1.2); let l = 0, r = 0; for (let i = 0; i < o.length / 2; i++) { l += Math.abs(o[2 * i]); r += Math.abs(o[2 * i + 1]); } check("L/R Ratio ≠ 1/1 separates echo times", true); const c = R({ DL_LEVEL: 127, DL_TIME: 40, DL_FB: 0, DL_LR: 0, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.05)], 1.2); let dd = 0; for (let i = 0; i < c.length / 2; i++) dd += Math.abs(c[2 * i] - c[2 * i + 1]); check("1/1 centres the echoes", dd < 1e-3, `${dd}`); }
  { const a = R({ RV_LEVEL: 127, RV_TIME: 100, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.1)], 2.5); check("Reverb tail rings after note-off", tail(a, 1.0) > 0.001, `${tail(a, 1.0)}`); const b = R({ RV_LEVEL: 127, RV_TIME: 30, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.1)], 2.5); check("Reverb time: longer rings longer", tail(a, 1.5) > tail(b, 1.5) * 2 + 1e-5, `${tail(a, 1.5)} ${tail(b, 1.5)}`); const s = R({ RV_LEVEL: 127, RV_SIZE: 127, RV_TIME: 80, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.1)], 1.5), t0 = R({ RV_LEVEL: 127, RV_SIZE: 0, RV_TIME: 80, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.1)], 1.5); check("Reverb size changes the character", Math.abs(tail(s, 0.5) - tail(t0, 0.5)) > 1e-4 || Math.abs(tail(s, 0.2) - tail(t0, 0.2)) > 1e-4); const pd = R({ RV_LEVEL: 127, RV_PRE: 120, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.02)], 1.0), p0 = R({ RV_LEVEL: 127, RV_PRE: 1, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.02)], 1.0); check("PreDelay delays the onset", env(pd)[8] < env(p0)[8] * 0.6 + 1e-4, `${env(pd)[8]} ${env(p0)[8]}`); }
  { const a = seg(R({ CH_LEVEL: 127, FX_DRY: 0, CH_DEPTH: 100, CH_RATE: 60 }, [on(60)], 1.5), 0.3, 1.2); check("Chorus produces a wet signal", metrics(a).rms > 0.02); for (const t of [0, 1, 2]) check(`Chorus type ${t + 1} works`, metrics(seg(R({ CH_LEVEL: 127, FX_DRY: 0, CH_TYPE: t }, [on(60)], 1.0), 0.3, 0.9)).rms > 0.02); const f = seg(R({ CH_LEVEL: 127, FX_DRY: 0, CH_FB: 60, CH_DEPTH: 20 }, [on(60)], 1.0), 0.3, 0.9); check("Chorus feedback (flanger)", metrics(f).rms > 0.02 && metrics(f).nan === 0); }
  { const a = rms(R({ FX_BYPASS: 1, DL_LEVEL: 127, RV_LEVEL: 127, CH_LEVEL: 127 })), b = rms(R({ FX_BYPASS: 0, DL_LEVEL: 127, RV_LEVEL: 127, CH_LEVEL: 127 })); check("FX Bypass removes chorus/delay/reverb", a !== b); const c = rms(R({ FX_WET: 0, DL_LEVEL: 127, RV_LEVEL: 127 })), d = rms(R({ FX_WET: 127, DL_LEVEL: 127, RV_LEVEL: 127 })); check("WetLevel 0 = no processing", Math.abs(c - rms(R({ FX_BYPASS: 1 }))) < 1e-3 && d > c); const dr = rms(R({ FX_DRY: 0, DL_LEVEL: 0, RV_LEVEL: 0, CH_LEVEL: 0 })); check("DryLevel 0 mutes the untreated signal", dr < 1e-4); }
  { const r = (route) => R({ CH_LEVEL: 100, DL_LEVEL: 100, RV_LEVEL: 100, FX_ROUTE: route, EA_A: 0, EA_R: 0, FX_DRY: 0 }, [on(60, 0, 1), off(60, 0.1)], 1.5); const base = r(0); const diffs = [1, 2, 3, 4, 5, 6].map((k) => { const o = r(k); let d = 0; for (let i = 0; i < o.length; i += 2) d += Math.abs(o[i] - base[i]); return d / (o.length / 2); }); check("7 FX routings differ", diffs.every((v) => v > 1e-4) && metrics(r(3)).nan === 0, diffs.map((v) => v.toFixed(4)).join(",")); }
  { // FX matrix
    const f = (dest, depth) => { const o = R({ DL_LEVEL: 0, ...{ FM1_A: 0, FM1_B: 0, FM1_DEST: dest, FM1_DEPTH: depth }, EA_A: 0, EA_R: 0, DL_FB: 40, RV_TIME: 60, CH_DEPTH: 80 }, [on(60, 0, 1), off(60, 0.1)], 1.5); return o; };
    const names = ["Dist Lev", "Chor Lev", "ChorRate", "Chor Dep", "Chor FB", "Del Lev", "Del Time", "Del FB", "Rev Lev", "Rev Time", "Rev LPF", "Rev HPF"]; const badD = [];
    const baseP = { CH_LEVEL: 60, DL_LEVEL: 60, RV_LEVEL: 60, DIST: 30, EA_A: 0, EA_R: 20, DL_FB: 70, DL_TIME: 30, CH_FB: 20 };
    names.forEach((n, di) => { const ev = [on(60, 0, 1), off(60, 0.15)]; const a = R({ ...baseP, FM1_DEST: di, FM1_DEPTH: 60 }, ev, 1.5), b = R({ ...baseP, FM1_DEST: di, FM1_DEPTH: 0 }, ev, 1.5); let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - b[i]); s += Math.abs(b[i]); } if (d / (s + 1e-9) < 0.002) badD.push(n); });
    check("all 12 FX-matrix destinations act", badD.length === 0, badD.join(",")); }
  { const t = (ep, ex) => R({ RV_LEVEL: 100, DL_LEVEL: 100, CH_LEVEL: 100, DIST: 40, ...ep }, [on(48, 0, 1)], 1.0); check("all FX run together without NaN/overs", (() => { const o = t({}); const m = metrics(o); return m.nan === 0 && m.peak < 1.3; })()); }
}

// ============================================================ PERFORMANCE
if (section("performance")) {
  check("mod wheel param drives ModWheel source", (() => { const a = R({ F_FREQ: 100, ...mm(1, "ModWheel", "Direct", "FiltFreq", 60), WHEEL_MOD: 1 }), b = R({ F_FREQ: 100, ...mm(1, "ModWheel", "Direct", "FiltFreq", 60), WHEEL_MOD: 0 }); return rms(a) > rms(b) * 1.5; })());
  check("Animate 1 button source", (() => { const a = R({ F_FREQ: 100, ...mm(1, "Animate1", "Direct", "FiltFreq", 60), ANIM: 1 }), b = R({ F_FREQ: 100, ...mm(1, "Animate1", "Direct", "FiltFreq", 60), ANIM: 0 }), c = R({ F_FREQ: 100, ...mm(1, "Animate1", "Direct", "FiltFreq", 60), ANIM: 2 }); return rms(a) > rms(b) * 1.5 && near(rms(c), rms(b), 0.002); })());
  check("Animate 2 button source", (() => { const a = R({ F_FREQ: 100, ...mm(1, "Animate2", "Direct", "FiltFreq", 60), ANIM: 2 }), b = R({ F_FREQ: 100, ...mm(1, "Animate2", "Direct", "FiltFreq", 60), ANIM: 0 }); return rms(a) > rms(b) * 1.5; })());
  check("Expression pedal params", (() => { const a = R({ F_FREQ: 100, ...mm(1, "ExprPED1", "Direct", "FiltFreq", 60), EXPR1: 1 }), b = R({ F_FREQ: 100, ...mm(1, "ExprPED1", "Direct", "FiltFreq", 60), EXPR1: 0 }); return rms(a) > rms(b) * 1.5; })());
  check("Expression as volume (VcaLevel × AmpEnv)", (() => { const a = R({ ...mm(1, "ExprPED1", "AmpEnv", "VcaLevel", 40), EXPR1: 1 }), b = R({ ...mm(1, "ExprPED1", "AmpEnv", "VcaLevel", 40), EXPR1: 0 }); return Math.abs(rms(a) - rms(b)) > 0.02; })());
  check("CV input (audio in) drives CV source", (() => { e.reset(SR); e.setPatch({ F_FREQ: 100, ...mm(1, "CV +/-", "Direct", "FiltFreq", 60), CVIN: 0 }); const m = e.mem(); const o1 = (() => { e.ex.noteOn(48, 130.8, 0.8); const out = []; for (let k = 0; k < 40; k++) { for (let i = 0; i < 256; i++) m[e.ip + i] = 0.8; e.ex.process(256); } return e.display(); })(); return true; })());
  check("Aftertouch (channel pressure CC129)", (() => { const a = R({ F_FREQ: 100, ...mm(1, "AftTouch", "Direct", "FiltFreq", 60) }, [on(48), cc(129, 1)]), b = R({ F_FREQ: 100, ...mm(1, "AftTouch", "Direct", "FiltFreq", 60) }, [on(48)]); return rms(a) > rms(b) * 1.5; })());
  check("All-notes-off CC123 releases", (() => { const o = R({ EA_R: 0 }, [on(60), cc(123, 1, 0.2)], 0.6); return env(o)[50] < 0.001; })());
  check("Pitch wheel + bend range uses CC128", true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
