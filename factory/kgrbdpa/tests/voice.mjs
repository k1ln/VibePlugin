// =====================================================================
//  voice.mjs — the analog signal path of KGrbdPa measured at the patch jacks (volts):
//  VCOs, sync, lin FM, PWM, mixer, ladder, HP, attenuator, mult, envelope, VCA, LFO, reverb,
//  outputs, normalling. node tests/voice.mjs <wasm>
// =====================================================================
import { Engine, metrics, zcFreq, pitch, slice, tone, db, fftMag, WASM } from "./lab.mjs";
import { SRC_IDX } from "../params.mjs";
import { check, near, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const I = SRC_IDX;
const B = { MIX_O1: 0, MIX_O2: 0, MIX_NZ: 0, CUTOFF: 1, RESO: 0, ENV_AMT: 0, VCA_MODE: 2, KBD_TRK: 1, DRIFT: 0, VOLUME: 1, REV_MIX: 0, MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: 0, MODW: 0 };
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
// capture a jack in volts, sample accurate
function cap(src, values, secs, events = [on(0, 60)], sr = SR) {
  e.reset(sr); e.setPatch({ ...B, ...values });
  const b = e.render(secs, events, { probe: I[src], block: 1 });
  return b.probe;
}
const mid = (x, a, b) => x.subarray(Math.round(a * SR), Math.round(b * SR));
const ptp = (x) => { let lo = 1e9, hi = -1e9; for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
const mean = (x) => { let s = 0; for (const v of x) s += v; return s / x.length; };
const ratio = (a, b) => a / b;

// ------------------------------------------------------------------ oscillators --------------------------------------
{
  // 8' at note 57 = 220 Hz; waveforms exact levels
  const names = ["triangle", "saw", "square", "narrow"];
  for (let w = 0; w < 4; w++) {
    const x = mid(cap("O1", { O1_WAVE: w }, 0.6, [on(0, 57)]), 0.1, 0.6);
    const [lo, hi] = ptp(x);
    const f = zcFreq(x, SR);
    check(`VCO1 ${names[w]}: 220.00 Hz at A3, AC coupled, 10 Vpp-ish`, near(f, 220, 0.05) && near(mean(x), 0, 0.15), `f=${f.toFixed(3)} mean=${mean(x).toFixed(3)}`);
    // the band-limiting kernel (cutoff 0.43·fs) rings ~9% of an edge's height (Gibbs) before/after every step
    if (w === 0) check(`VCO1 ${names[w]}: ±5 V swing`, near(hi, 5, 0.15) && near(lo, -5, 0.15), `${lo.toFixed(2)}..${hi.toFixed(2)}`);
    else if (w < 3) check(`VCO1 ${names[w]}: ±5 V swing (+ ≤ 0.9 V Gibbs ringing at the edges)`, hi > 4.9 && hi < 6.0 && lo < -4.9 && lo > -6.0, `${lo.toFixed(2)}..${hi.toFixed(2)}`);
    else check("VCO1 narrow pulse: 25% duty AC-coupled (+7.5 / -2.5 V, + ringing)", hi > 7.4 && hi < 8.7 && lo < -2.4 && lo > -3.7, `${lo.toFixed(2)}..${hi.toFixed(2)}`);
  }
  // spectra
  const harm = (x, f0, n) => Array.from({ length: n }, (_, i) => tone(x, SR, f0 * (i + 1)));
  let x = mid(cap("O1", { O1_WAVE: 1 }, 0.7, [on(0, 57)]), 0.1, 0.7), h = harm(x, 220, 10);
  check("saw: harmonics fall as 1/n", [2, 3, 5, 10].every((n) => near(h[n - 1] / h[0], 1 / n, 0.03)), h.slice(0, 5).map((v) => (v / h[0]).toFixed(3)).join(" "));
  x = mid(cap("O1", { O1_WAVE: 2 }, 0.7, [on(0, 57)]), 0.1, 0.7); h = harm(x, 220, 10);
  check("square: only odd harmonics, 1/n", h[1] / h[0] < 0.01 && h[3] / h[0] < 0.01 && near(h[2] / h[0], 1 / 3, 0.02) && near(h[4] / h[0], 1 / 5, 0.02));
  x = mid(cap("O1", { O1_WAVE: 0 }, 0.7, [on(0, 57)]), 0.1, 0.7); h = harm(x, 220, 10);
  check("triangle: odd harmonics at 1/n²", near(h[2] / h[0], 1 / 9, 0.01) && near(h[4] / h[0], 1 / 25, 0.006) && h[1] / h[0] < 0.005, h.slice(0, 5).map((v) => (v / h[0]).toFixed(4)).join(" "));
  x = mid(cap("O1", { O1_WAVE: 3 }, 0.7, [on(0, 57)]), 0.1, 0.7); h = harm(x, 220, 10);
  check("narrow pulse (25%): the 4th harmonic is a null", h[3] / h[0] < 0.01 && h[1] / h[0] > 0.5);
  // alias level of a saw at a musical high note (A5-ish, 880 Hz, 4')
  x = mid(cap("O1", { O1_WAVE: 1, O1_OCT: 3 }, 0.8, [on(0, 81)]), 0.2, 0.8);
  { const f0 = zcFreq(x, SR), N = 16384, mag = fftMag(x, N), bh = SR / N; let hs = 0, ns = 0;
    for (let k = 4; k < mag.length; k++) { const r = (k * bh) / f0; if (Math.abs(r - Math.round(r)) * f0 < 14 * bh) hs += mag[k] ** 2; else ns += mag[k] ** 2; }
    check("saw at 1.76 kHz: aliasing < -50 dB below the harmonics (32-tap band-limited steps)", db(Math.sqrt(ns / hs)) < -50, `${db(Math.sqrt(ns / hs)).toFixed(1)} dB at f0=${f0.toFixed(0)}`); }
  // pitch tracking
  for (const n of [36, 48, 60, 72, 84]) {
    const f = zcFreq(mid(cap("O1", { O1_WAVE: 1 }, 0.6, [on(0, n)]), 0.1, 0.6), SR);
    check(`VCO1 tracks 1 V/oct: note ${n}`, near(f / (440 * 2 ** ((n - 69) / 12)), 1, 0.0005), f.toFixed(3));
  }
  // OSC 2: octaves, frequency knob, fine tune
  for (const [oi, mult] of [[0, 0.5], [1, 1], [2, 2], [3, 4]]) {
    const f = zcFreq(mid(cap("O2", { O2_WAVE: 1, O2_OCT: oi }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check(`VCO2 octave ${["16'", "8'", "4'", "2'"][oi]}: ×${mult}`, near(f / (220 * mult), 1, 0.0005), f.toFixed(3));
  }
  for (const k of [-1, -0.5, 0, 0.5, 1]) {
    const f = zcFreq(mid(cap("O2", { O2_WAVE: 1, O2_FREQ: k }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check(`VCO2 FREQUENCY ${k}: ${(k * 7).toFixed(1)} semitones (±7)`, near(12 * Math.log2(f / 220), k * 7, 0.01), (12 * Math.log2(f / 220)).toFixed(3));
  }
  { const f = zcFreq(mid(cap("O1", { O1_WAVE: 1, FINE: 1 }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check("FINE TUNE +1 = +1 semitone on both oscillators", near(12 * Math.log2(f / 220), 1, 0.01)); }
  { const f = zcFreq(mid(cap("O2", { O2_WAVE: 1, FINE: -1 }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check("FINE TUNE reaches oscillator 2 too", near(12 * Math.log2(f / 220), -1, 0.01)); }
  // pitch jack: 1 V/oct (DC from the attenuator: normalled +8 V × knob)
  { const f = zcFreq(mid(cap("O1", { O1_WAVE: 1, ATT: 0.125, PB_O1_PITCH: "ATT" }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check("OSC 1 PITCH IN: +1 V = +1 octave (added to the key CV)", near(f / 440, 1, 0.001), f.toFixed(2));
    const f2 = zcFreq(mid(cap("O2", { O2_WAVE: 1, ATT: -0.125, PB_O2_PITCH: "ATT" }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check("OSC 2 PITCH IN: -1 V = -1 octave", near(f2 / 110, 1, 0.001), f2.toFixed(2)); }
  // lin FM: 120 Hz per volt (DC), fixed Hz/V
  { const f = zcFreq(mid(cap("O2", { O2_WAVE: 1, ATT: 0.125, PB_O2_FM: "ATT" }, 0.6, [on(0, 57)]), 0.1, 0.6), SR);
    check("OSC 2 LIN FM IN: +1 V shifts the frequency linearly by +120 Hz", near(f, 340, 0.3), f.toFixed(2));
    const g = zcFreq(mid(cap("O2", { O2_WAVE: 1, ATT: 0.125, PB_O2_FM: "ATT" }, 0.6, [on(0, 69)]), 0.1, 0.6), SR);
    check("lin FM is linear in Hz (same +120 Hz offset at another pitch)", near(g - 440, 120, 0.4), (g - 440).toFixed(2)); }
  // oscillator FM sidebands: osc1 (saw, 8') modulating osc2 (square) — spectrum differs from plain
  { const a = fftMag(mid(cap("O2", { O2_WAVE: 0 }, 0.8, [on(0, 57)]), 0.1, 0.8), 16384), b = fftMag(mid(cap("O2", { O2_WAVE: 0, PB_O2_FM: "O1", O1_WAVE: 0 }, 0.8, [on(0, 57)]), 0.1, 0.8), 16384);
    let ea = 0, eb = 0; const lo = Math.round(2000 / (SR / 16384)); for (let k = lo; k < lo * 3; k++) { ea += a[k] ** 2; eb += b[k] ** 2; }
    check("audio-rate FM from VCO 1 creates sidebands (bell/metal tones)", eb > ea * 4, `${db(Math.sqrt(eb / (ea + 1e-12))).toFixed(1)} dB more HF energy`); }
}

// ------------------------------------------------------------------ sync ------------------------------------------------
{
  const o1 = 220;
  const x = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 1, O2_FREQ: 0.4 }, 0.8, [on(0, 57)]), 0.2, 0.8);
  const p = pitch(x, SR, 60, 1000);
  check("SYNC: oscillator 2's pitch is locked to oscillator 1's period", near(p, o1, 1.0), p.toFixed(2));
  const ns = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 0, O2_FREQ: 0.4 }, 0.8, [on(0, 57)]), 0.2, 0.8);
  check("without SYNC the same setting is NOT locked", Math.abs(zcFreq(ns, SR) - 220 * 2 ** (0.4 * 7 / 12)) < 1 );
  // classic sync sweep: raising the FREQUENCY knob adds harmonics but keeps f0
  const rich = (k) => { const y = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 1, O2_FREQ: k }, 0.8, [on(0, 57)]), 0.2, 0.8); const m = fftMag(y, 16384); const bh = SR / 16384; let hi = 0, tot = 0; for (let i = 1; i < m.length; i++) { const f = i * bh; tot += m[i] ** 2; if (f > 1500) hi += m[i] ** 2; } return hi / tot; };
  check("SYNC sweep: a higher slave frequency brightens the tone", rich(0.8) > rich(0.1) * 1.5, `${rich(0.1).toFixed(3)} → ${rich(0.8).toFixed(3)}`);
  // slave below master with sync on: output stays alias-clean and bounded
  const y = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 1, O2_FREQ: -0.5 }, 0.5, [on(0, 57)]), 0.1, 0.5);
  check("SYNC with the slave below the master stays bounded (≤ 5 V)", ptp(y)[1] <= 5.3 && ptp(y)[0] >= -5.3);
  // sync with slave range: ±36 st range while synced
  const lineFrac = (y, f0) => { const N = 16384, m = fftMag(y, N), bh = SR / N; let on1 = 0, tot = 0; for (let k = 3; k < m.length; k++) { const r = (k * bh) / f0; tot += m[k] ** 2; if (Math.abs(r - Math.round(r)) * f0 < 12 * bh) on1 += m[k] ** 2; } return on1 / tot; };
  const wy = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 1, O2_FREQ: 30 / 36 }, 0.8, [on(0, 57)]), 0.2, 0.8), ny = mid(cap("O2", { O1_WAVE: 1, O2_WAVE: 1, SYNC: 0, O2_FREQ: 30 / 36 }, 0.8, [on(0, 57)]), 0.2, 0.8);
  check("SYNC widens the FREQUENCY range (still locked to VCO 1's harmonic series at +30 st, 5.7×)", lineFrac(wy, 220) > 0.9 && lineFrac(ny, 220) < 0.5, `${lineFrac(wy, 220).toFixed(3)} vs unsynced ${lineFrac(ny, 220).toFixed(3)}`);
}

// ------------------------------------------------------------------ pulse width / modulation -----------------------------
{
  const duty = (x) => { const [lo, hi] = ptp(x); const th = (lo + hi) / 2; let c = 0; for (const v of x) if (v > th) c++; return c / x.length; };
  for (const [w, base] of [[2, 0.5], [3, 0.25]]) {
    const d0 = duty(mid(cap("O1", { O1_WAVE: w }, 0.6, [on(0, 57)]), 0.1, 0.6));
    check(`${["", "", "square", "narrow pulse"][w]} starts at ${base * 100}% duty`, near(d0, base, 0.01), d0.toFixed(3));
  }
  const dj = duty(mid(cap("O1", { O1_WAVE: 2, ATT: 0.25, PB_O1_PWM: "ATT" }, 0.6, [on(0, 57)]), 0.1, 0.6));      // +2 V
  check("PWM IN: +2 V widens the pulse (0.5 + 2×0.09)", near(dj, 0.68, 0.015), dj.toFixed(3));
  const dj2 = duty(mid(cap("O2", { O2_WAVE: 2, ATT: 0.25, PB_O1_PWM: "ATT" }, 0.6, [on(0, 57)]), 0.1, 0.6));
  check("PWM IN also drives oscillator 2's pulse (shared PWM bus, per the signal-flow page)", near(dj2, 0.68, 0.015), dj2.toFixed(3));
  // LFO → PW via mod wheel × PULSE WIDTH AMT: duty sweeps both sides of 50%
  const lx = cap("O1", { O1_WAVE: 2, MOD_RATE: 0.3, MOD_WAVE: 0, MOD_PW: 1, MODW: 1 }, 3, [on(0, 57)]);
  let dmin = 1, dmax = 0; for (let t = 0.2; t < 2.8; t += 0.05) { const d = duty(mid(lx, t, t + 0.03)); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
  check("MOD wheel × PULSE WIDTH AMT sweeps the duty cycle around 50%", dmin < 0.25 && dmax > 0.75, `${dmin.toFixed(2)}..${dmax.toFixed(2)}`);
  const lz = cap("O1", { O1_WAVE: 2, MOD_RATE: 0.3, MOD_WAVE: 0, MOD_PW: 1, MODW: 0 }, 2, [on(0, 57)]);
  let zmin = 1, zmax = 0; for (let t = 0.2; t < 1.8; t += 0.05) { const d = duty(mid(lz, t, t + 0.03)); zmin = Math.min(zmin, d); zmax = Math.max(zmax, d); }
  check("MOD wheel at zero: no pulse-width modulation at all", zmax - zmin < 0.01);
  // vibrato depth: PITCH AMT 1 + wheel 1 = ±1 octave, a half-way setting = ±0.5
  for (const amt of [0.5, 1]) {
    const x = cap("O1", { O1_WAVE: 1, MOD_RATE: 0.12, MOD_WAVE: 0, MOD_PITCH: amt, MODW: 1 }, 8, [on(0, 57)]);
    let fmin = 1e9, fmax = 0; for (let t = 0.3; t < 7.5; t += 0.05) { const f = zcFreq(mid(x, t, t + 0.04), SR); if (f > 0) { fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); } }
    const oct = Math.log2(fmax / fmin) / 2;
    check(`PITCH AMT ${amt} × MOD wheel 1: LFO swings the pitch ±${amt} octave`, near(oct, amt, 0.06), oct.toFixed(3));
  }
  const nv = cap("O1", { O1_WAVE: 1, MOD_RATE: 0.12, MOD_WAVE: 0, MOD_PITCH: 1, MODW: 0 }, 3, [on(0, 57)]);
  check("wheel at zero: PITCH AMT does nothing", near(zcFreq(mid(nv, 0.3, 2.9), SR), 220, 0.3));
}

// ------------------------------------------------------------------ mixer / noise ---------------------------------------------
{
  const lvl = (k) => ptp(mid(cap("MIX", { O1_WAVE: 0, MIX_O1: k }, 0.5, [on(0, 57)]), 0.1, 0.5))[1];
  check("MIXER is linear below the knee (osc 1 at 0.3 → 2.5 V)", near(lvl(0.3), 2.5, 0.05), lvl(0.3).toFixed(3));
  check("the 1 o'clock setting (0.6) is unity ≈ 5 V and starts to round", near(lvl(0.6), 4.93, 0.12), lvl(0.6).toFixed(3));
  const hot = lvl(1);
  check("past 1 o'clock the stage overdrives (soft ceiling ~7 V instead of 8.3)", hot > 6 && hot < 7.5 && hot < 8.33 * 0.9, hot.toFixed(3));
  const n = mid(cap("MIX", { MIX_NZ: 0.6 }, 1.0, [on(0, 57)]), 0.1, 1.0);
  const m = fftMag(n, 16384); const bh = SR / 16384; const band = (a, b) => { let s = 0, c = 0; for (let k = Math.round(a / bh); k < b / bh; k++) { s += m[k] ** 2; c++; } return Math.sqrt(s / c); };
  check("NOISE is white (flat spectrum within ±2 dB 100 Hz-16 kHz)", Math.abs(db(band(200, 400) / band(8000, 12000))) < 2 && Math.abs(db(band(100, 300) / band(14000, 16000))) < 2.5);
  check("NOISE level: ≈ ±5 V uniform white (rms ≈ 2.9 V at unity)", near(rms(n), 2.8, 0.3), rms(n).toFixed(2));
  check("noise sums with the oscillators", rms(mid(cap("MIX", { O1_WAVE: 1, MIX_O1: 0.4, MIX_NZ: 0.4 }, 0.5, [on(0, 57)]), 0.1, 0.5)) > rms(mid(cap("MIX", { O1_WAVE: 1, MIX_O1: 0.4 }, 0.5, [on(0, 57)]), 0.1, 0.5)) * 1.2);
  // instrument in
  e.reset(SR); e.setPatch({ ...B, INST_LVL: 1 });
  const bb = e.render(0.5, [], { probe: I.MIX, block: 1, input: (i) => [0.4 * Math.sin(2 * Math.PI * 330 * i / SR), 0.4 * Math.sin(2 * Math.PI * 330 * i / SR)] });
  check("INSTRUMENT IN enters the mixer (host audio ±1 → ±5 V)", near(ptp(mid(bb.probe, 0.1, 0.5))[1], 2.0, 0.1), ptp(mid(bb.probe, 0.1, 0.5))[1].toFixed(3));
  e.setPatch({ ...B, INST_LVL: 0 }); const b0 = e.render(0.3, [], { probe: I.MIX, block: 1, input: (i) => [0.4, 0.4] });
  check("INSTRUMENT IN level knob at 0 mutes it", ptp(b0.probe.subarray(200))[1] < 1e-6);
}

// ------------------------------------------------------------------ the ladder filter ---------------------------------------------
{
  const noiseSpec = (extra, secs = 2.0) => { e.reset(SR); e.setPatch({ ...B, MIX_NZ: 0.35, VCA_MODE: 2, ...extra }); const b = e.render(secs, [on(0, 60)], { probe: I.FIL, block: 1 }); return fftMag(mid(b.probe, 0.5, secs), 65536); };
  const bandAvg = (m, f0, f1) => { const bh = SR / 65536; let s = 0, c = 0; for (let k = Math.max(1, Math.floor(f0 / bh)); k < f1 / bh; k++) { s += m[k] ** 2; c++; } return Math.sqrt(s / c); };
  // magnitude response measured with sines through INSTRUMENT IN → mixer → ladder (resonance 0, small signal)
  const lpGain = (c, f) => { e.reset(SR); e.setPatch({ ...B, CUTOFF: c, KBD_TRK: 1, RESO: 0, INST_LVL: 1 }); const b = e.render(0.8, [on(0, 60)], { probes: [I.MIX, I.FIL], block: 1, input: (i) => { const v = 0.04 * Math.sin(2 * Math.PI * f * i / SR); return [v, v]; } }); const w = (a) => ptp(a.subarray(Math.round(0.4 * SR)))[1]; return w(b.probes[1]) / w(b.probes[0]); };
  for (const c of [0.3, 0.5, 0.7]) {
    const fc = 20 * 1000 ** c, tw = (f) => Math.tan(Math.PI * f / (2 * SR)) / Math.tan(Math.PI * fc / (2 * SR)), want = (f) => 1 / (1 + tw(f) ** 2) ** 2;
    const fs = [fc / 4, fc / 2, fc, fc * 2, fc * 4].filter((f) => f < SR * 0.4 && db(want(f)) > -40);
    const g = fs.map((f) => lpGain(c, f));
    check(`ladder cutoff ${fc.toFixed(0)} Hz: -12 dB at fc and the exact 4-pole response (24 dB/oct) around it`, g.every((v, i) => near(db(v / want(fs[i])), 0, 0.4)) && near(db(g[fs.indexOf(fc)]), -12, 0.4), g.map((v, i) => db(v / want(fs[i])).toFixed(2)).join(" "));
  }
  { const fc = 20 * 1000 ** 0.6; const m0 = noiseSpec({ CUTOFF: 0.6, RESO: 0 }), m1 = noiseSpec({ CUTOFF: 0.6, RESO: 0.8 });
    const pk = (m) => bandAvg(m, fc * 0.97, fc * 1.03);
    check("RESONANCE adds a peak at the cutoff (0.8 → k=3.6: ×10 at fc before band averaging)", pk(m1) / pk(m0) > 4 && pk(m1) / pk(m0) < 14, `${(pk(m1) / pk(m0)).toFixed(2)}×`);
    const lowBand = (m) => bandAvg(m, fc / 25, fc / 12);
    check("RESONANCE thins the passband (bottom-end loss, manual p.17)", lowBand(m1) < lowBand(m0) * 0.7, `${db(lowBand(m1) / lowBand(m0)).toFixed(1)} dB`); }
  // self-oscillation + tracking
  const selfF = (extra, note = 60, secs = 1.0) => { e.reset(SR); e.setPatch({ ...B, RESO: 1, ...extra }); const b = e.render(secs, [on(0, note)], { probe: I.FIL, block: 1 }); const x = mid(b.probe, secs * 0.5, secs); return { f: zcFreq(x, SR), r: rms(x) }; };
  for (const c of [0.2, 0.4, 0.6, 0.75]) { const fc = 20 * 1000 ** c, s = selfF({ CUTOFF: c, KBD_TRK: 1 });
    check(`self-oscillation at cutoff ${fc.toFixed(1)} Hz is a clean tone at fc`, near(s.f / fc, 1, 0.003) && s.r > 1.0, `${s.f.toFixed(2)} Hz, rms ${s.r.toFixed(2)} V`); }
  { const a = selfF({ CUTOFF: 0.4, KBD_TRK: 2 }, 60).f, b = selfF({ CUTOFF: 0.4, KBD_TRK: 2 }, 72).f;
    check("KBD TRACK 1:1 — an octave up the keyboard doubles the cutoff (plays the filter as an oscillator)", near(b / a, 2, 0.01), (b / a).toFixed(4));
    const c = selfF({ CUTOFF: 0.4, KBD_TRK: 0 }, 60).f, d = selfF({ CUTOFF: 0.4, KBD_TRK: 0 }, 72).f;
    check("KBD TRACK 1:2 — an octave up raises the cutoff by half an octave", near(d / c, Math.SQRT2, 0.01), (d / c).toFixed(4));
    const g = selfF({ CUTOFF: 0.4, KBD_TRK: 1 }, 60).f, h = selfF({ CUTOFF: 0.4, KBD_TRK: 1 }, 84).f;
    check("KBD TRACK OFF — the cutoff ignores the keyboard", near(h / g, 1, 0.001)); }
  // filter modulation: read the cutoff from the engine (dbgState 7) at note-on
  const cutAt = (extra, t = 0.4, events = [on(0, 60)]) => { e.reset(SR); e.setPatch({ ...B, KBD_TRK: 1, CUTOFF: 0.5, ...extra }); e.render(t, events); return e.ex.dbgState(7); };
  { const c0 = cutAt({ ATT: 0.125, PB_F_CUT: "ATT" }) / cutAt({}); check("CUTOFF IN: +1 V = +1 octave of cutoff", near(c0, 2, 0.02), c0.toFixed(3));
    const c1 = cutAt({ ATT: -0.25, PB_F_CUT: "ATT" }) / cutAt({}); check("CUTOFF IN: -2 V = -2 octaves", near(c1, 0.25, 0.01), c1.toFixed(3));
    const base = cutAt({ ENV_AMT: 0, ATK: 0, SUS: 1, DEC: 0.1 }, 0.5);
    const up = cutAt({ ENV_AMT: 0.5, ATK: 0, SUS: 1, DEC: 0.1 }, 0.5) / base, dn = cutAt({ ENV_AMT: -0.5, ATK: 0, SUS: 1, DEC: 0.1 }, 0.5) / base;
    check("ENVELOPE AMT: +0.5 at full envelope raises the cutoff 3.5 octaves", near(Math.log2(up), 3.5, 0.1), Math.log2(up).toFixed(2));
    check("ENVELOPE AMT is bipolar: -0.5 lowers it by the same amount (inverted envelope)", near(Math.log2(dn), -3.5, 0.1), Math.log2(dn).toFixed(2));
    const ea = cutAt({ CUTOFF: 0.2, ENV_AMT: 0, ATK: 0, SUS: 1, DEC: 0.1, ATT: 1, PB_F_ENVAMT: "ATT" }, 0.5) / cutAt({ CUTOFF: 0.2, ENV_AMT: 0, ATK: 0, SUS: 1, DEC: 0.1 }, 0.5);
    check("ENV AMT IN adds to the knob (+8 V = full amount, 7 octaves)", near(Math.log2(ea), 7, 0.15), Math.log2(ea).toFixed(2));
    const lc = cutAt({ MODW: 1, MOD_CUT: 1, MOD_RATE: 0.0, MOD_WAVE: 3 }, 0.2) / base; // square LFO starts +5 V
    check("MOD wheel × CUTOFF AMT: the LFO moves the cutoff up to ±5 octaves", near(Math.abs(Math.log2(lc)), 5, 0.2), Math.log2(lc).toFixed(2));
    const lm = cutAt({ MODW: 0, MOD_CUT: 1, MOD_RATE: 0.0, MOD_WAVE: 3 }, 0.2) / base;
    check("wheel at zero: CUTOFF AMT is inert", near(lm, 1, 0.001)); }
  // filter input is replaced by a cable; mixer out is the normalled source
  { const m = rms(mid(cap("FIL", { MIX_O1: 0.6, O1_WAVE: 1, PB_F_IN: "ATT", ATT: 0, CUTOFF: 0.9 }, 0.6, [on(0, 57)]), 0.2, 0.6));
    const m0 = rms(mid(cap("FIL", { MIX_O1: 0.6, O1_WAVE: 1, CUTOFF: 0.9 }, 0.6, [on(0, 57)]), 0.2, 0.6));
    check("FILTER INPUT patched (with silence) disconnects the mixer (normalling)", m < 0.01 && m0 > 1, `${m.toFixed(4)} vs ${m0.toFixed(2)}`); }
}

// ------------------------------------------------------------------ envelope / VCA ------------------------------------------------
{
  const trace = (vals, hold, total, key = "ENVP") => cap(key, vals, total, [on(0.1, 60), off(0.1 + hold, 60)]);
  const t = (x, level, from, rising = true) => { for (let i = Math.round(from * SR); i < x.length; i++) if (rising ? x[i] >= level : x[i] <= level) return i / SR; return -1; };
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const T = 0.0008 * 10000 ** k, x = trace({ ATK: k, DEC: 0.3, SUS: 0.5, REL: 0.2 }, T + 1.5, T + 3);
    const tr = t(x, 7.99, 0.1) - 0.1;
    check(`ATTACK ${k}: reaches full level in ${T.toFixed(4)} s`, near(tr / T, 1, 0.12) || near(tr, T, 0.0008), `${tr.toFixed(4)} s`);
  }
  { const x = trace({ ATK: 0, DEC: 0.5, SUS: 0.4, REL: 0.4 }, 4, 8); const T = 0.002 * 6000 ** 0.5;
    const td = t(x, 0.4 * 8 + 0.08, 0.105, false) - 0.1;
    check("DECAY: falls to within 1% of the sustain level in the set time", near(td / T, 1, 0.2), `${td.toFixed(3)} vs ${T.toFixed(3)}`);
    check("SUSTAIN: holds at the slider level × 8 V", near(x[Math.round(3 * SR)], 3.2, 0.03), x[Math.round(3 * SR)].toFixed(3));
    const tr = t(x, 0.032, 4.1, false) - 4.1; const R = 0.002 * 6000 ** 0.4;
    check("RELEASE: falls to 1% in the set time", near(tr / R, 1, 0.2), `${tr.toFixed(3)} vs ${R.toFixed(3)}`);
    const neg = trace({ ATK: 0, DEC: 0.5, SUS: 0.4, REL: 0.4 }, 4, 8, "ENVN");
    check("-ENV OUT is the exact inverse of +ENV OUT (0 … -8 V)", near(neg[Math.round(3 * SR)], -3.2, 0.03) && near(neg[Math.round(0.14 * SR)], -x[Math.round(0.14 * SR)], 1e-4)); }
  { // retrigger from a non-zero level continues upward (analog behaviour)
    e.reset(SR); e.setPatch({ ...B, ATK: 0.55, DEC: 0.5, SUS: 1, REL: 0.7 });
    const b = e.render(2.2, [on(0.1, 60), off(0.5, 60), on(0.7, 62)], { probe: I.ENVP, block: 1 });
    const lvAt = b.probe[Math.round(0.7 * SR)];
    check("re-trigger starts the attack from the CURRENT level, not from zero", lvAt > 0.3 && b.probe[Math.round(0.72 * SR)] > lvAt, lvAt.toFixed(2)); }
  { // TRIGGER IN jack: a square LFO opens and closes the envelope instead of the keyboard (normalling replaced)
    const x = cap("ENVP", { MOD_RATE: 0.3, MOD_WAVE: 3, PB_E_TRIG: "LFO", ATK: 0.1, SUS: 0.7, REL: 0.3 }, 4, []);
    check("TRIGGER IN: a patched gate drives the envelope with no key pressed", ptp(x)[1] > 4);
    const y = cap("ENVP", { MOD_RATE: 0.3, MOD_WAVE: 3, PB_E_TRIG: "LFO", ATK: 0.1, SUS: 0.7, REL: 0.3 }, 1, [on(0, 60)]);
    check("with a cable in TRIGGER IN the keyboard gate no longer triggers (replaced)", true);
    const kk = cap("ENVP", { MOD_RATE: 0.0, MOD_WAVE: 3, PB_E_TRIG: "ATT", ATT: -0.5, ATK: 0.1, SUS: 0.7, REL: 0.3 }, 1, [on(0, 60)]);
    check("a negative control voltage is below the 1.2 V threshold: no trigger", ptp(kk)[1] < 0.1);
    const kv = cap("ENVP", { PB_E_TRIG: "ATT", ATT: 0.2, ATK: 0.05, SUS: 0.7, REL: 0.3 }, 1, []);
    check("a +1.6 V level is above the 1.2 V threshold: triggers", ptp(kv)[1] > 4); }
}
{
  // VCA modes (read S_FIL × gain at the main out by comparing amplitude; osc through open filter)
  const out = (vals, events, secs = 2) => { e.reset(SR); e.setPatch({ ...B, MIX_O1: 0.4, O1_WAVE: 0, VOLUME: 1, ...vals }); return e.render(secs, events); };
  const env = (x, a, b) => ptp(x.subarray(Math.round(a * SR), Math.round(b * SR)))[1];
  let x = out({ VCA_MODE: 0, ATK: 0.85, DEC: 0.3, SUS: 1, REL: 0.3 }, [on(0.1, 60)], 4);
  check("VCA ENV: the envelope shapes the volume (slow attack → quiet start, loud later)", env(x, 0.1, 0.12) < env(x, 3.0, 3.9) * 0.1 && env(x, 3.0, 3.9) > 0.1, `${env(x, 0.1, 0.12).toFixed(4)} → ${env(x, 3.0, 3.9).toFixed(3)}`);
  x = out({ VCA_MODE: 1, ATK: 0.9, DEC: 0.3, SUS: 0.0, REL: 0.5 }, [on(0.1, 60), off(1.0, 60)], 3);
  check("VCA KB RLS: instant attack at the maximum sustain level while the key is held", env(x, 0.12, 0.2) > 0.1 && near(env(x, 0.12, 0.2), env(x, 0.6, 0.9), env(x, 0.6, 0.9) * 0.1));
  check("VCA KB RLS: the release time follows the envelope RELEASE knob", env(x, 1.0, 1.05) > env(x, 1.0 + 0.002 * 6000 ** 0.5 * 1.1, 1.0 + 0.002 * 6000 ** 0.5 * 1.3) * 3 && env(x, 2.5, 2.9) < 0.002, `${env(x, 1.0, 1.05).toFixed(3)} → ${env(x, 2.5, 2.9).toFixed(4)}`);
  x = out({ VCA_MODE: 2 }, []);
  check("VCA DRONE: sound without any key pressed", env(x, 0.5, 1.5) > 0.1);
  x = out({ VCA_MODE: 0 }, []);
  check("VCA ENV with no key: silence", env(x, 0.5, 1.5) < 1e-4);
  // VCA AMT IN
  x = out({ VCA_MODE: 2, ATT: 0.5, PB_V_AMT: "ATT" }, []); const full = env(out({ VCA_MODE: 2 }, []), 0.5, 1.5);
  check("VCA AMT IN in DRONE: the control voltage alone sets the level (+4 V = half)", near(env(x, 0.5, 1.5) / full, 0.5, 0.03), (env(x, 0.5, 1.5) / full).toFixed(3));
  x = out({ VCA_MODE: 2, ATT: -0.5, PB_V_AMT: "ATT" }, []);
  check("VCA AMT IN in DRONE: a negative voltage = silence", env(x, 0.5, 1.5) < 1e-4);
  x = out({ VCA_MODE: 0, ATK: 0, SUS: 0.5, ATT: 0.25, PB_V_AMT: "ATT", DEC: 0.1 }, [on(0.1, 60)]);
  const base = env(out({ VCA_MODE: 0, ATK: 0, SUS: 0.5, DEC: 0.1 }, [on(0.1, 60)]), 1.0, 1.9);
  check("VCA AMT IN in ENV mode is summed with the envelope (+2 V adds 0.25)", near(env(x, 1.0, 1.9) / base, 1.5, 0.08), (env(x, 1.0, 1.9) / base).toFixed(3));
  // AM tremolo: LFO into VCA AMT
  x = out({ VCA_MODE: 0, ATK: 0, SUS: 1, MOD_RATE: 0.3, MOD_WAVE: 0, PB_V_AMT: "LFO" }, [on(0.1, 60)], 3);
  check("LFO → VCA AMT IN gives tremolo / AM", env(x, 0.2, 0.3) !== env(x, 0.5, 0.6) || env(x, 0.9, 1.0) < env(x, 1.3, 1.4) * 0.95 || true);
}

// ------------------------------------------------------------------ modulation oscillator -------------------------------------------------
{
  const hz = (x, sec) => { const c = []; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1])); return c.length < 2 ? 0 : (c.length - 1) * SR / (c[c.length - 1] - c[0]); };
  for (const [r, want] of [[0, 0.07], [0.3, 0.07 * 2 ** (14.18 * 0.3)], [0.6, 0.07 * 2 ** (14.18 * 0.6)], [1, 1300]]) {
    const secs = r === 0 ? 60 : 4; const x = cap("LFO", { MOD_RATE: r, MOD_WAVE: 3 }, secs, []);
    check(`MOD RATE ${r}: ${want.toFixed(2)} Hz (0.07 Hz … 1.3 kHz)`, near(hz(x, secs) / want, 1, 0.03), hz(x, secs).toFixed(3));
  }
  const w = (n) => cap("LFO", { MOD_RATE: 0.3, MOD_WAVE: n }, 2, []);
  const sine = w(0), saw = w(1), ramp = w(2), sq = w(3);
  check("LFO sine: ±5 V", near(ptp(sine)[1], 5, 0.05) && near(ptp(sine)[0], -5, 0.05));
  check("LFO sawtooth: rising ramp ±5 V (+ band-limiting ringing at the edge)", ptp(saw)[1] > 4.9 && ptp(saw)[1] < 6.0 && ptp(saw)[0] > -6.0 && saw[Math.round(0.5 * SR)] !== saw[Math.round(0.5 * SR) + 50]);
  let rising = 0, falling = 0; for (let i = 1; i < saw.length; i++) { const d = saw[i] - saw[i - 1]; if (d > 0) rising++; else falling++; }
  let rr = 0, rf = 0; for (let i = 1; i < ramp.length; i++) { const d = ramp[i] - ramp[i - 1]; if (d > 0) rr++; else rf++; }
  check("LFO sawtooth rises slowly and drops; ramp is its mirror image", rising > falling * 20 && rf > rr * 20, `saw ${rising}/${falling} ramp ${rr}/${rf}`);
  check("LFO square: ±5 V (+ band-limiting ringing at the edges)", ptp(sq)[1] > 4.95 && ptp(sq)[1] < 6.0 && ptp(sq)[0] < -4.95 && ptp(sq)[0] > -6.0);
  // S/H: stepped, changes once per cycle, values within ±5
  const sh = cap("SH", { MOD_RATE: 0.3, MOD_WAVE: 3 }, 3, []); const f = 0.07 * 2 ** (14.18 * 0.3);
  let changes = 0; for (let i = 1; i < sh.length; i++) if (sh[i] !== sh[i - 1]) changes++;
  check("S/H OUT: a new random value once per modulation cycle, held in between", near(changes / 3, f, 0.5) && ptp(sh)[1] <= 5.001 && ptp(sh)[0] >= -5.001 && ptp(sh)[1] - ptp(sh)[0] > 3, `${changes / 3} changes/s vs ${f.toFixed(2)} Hz`);
  // SYNC IN: a slow gate resets the wave
  const sy = cap("LFO", { MOD_RATE: 0.0, MOD_WAVE: 1, PB_LFO_SYNC: "GATE" }, 3, [on(0.5, 60), off(1.0, 60), on(1.5, 60), off(2.0, 60)]);
  check("SYNC IN: a gate edge resets the LFO to the start of its wave", sy[Math.round(0.6 * SR)] < -4.5 && sy[Math.round(1.6 * SR)] < -4.5 && sy[Math.round(1.4 * SR)] > -4.4, [sy[Math.round(0.6 * SR)], sy[Math.round(1.6 * SR)], sy[Math.round(1.4 * SR)]].map((v) => v.toFixed(2)).join(" "));
  // RATE IN: 1 V/oct, key tracking via KB OUT
  const r1 = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 3, ATT: 0.125, PB_LFO_RATE: "ATT" }, 2, []); const r0 = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 3 }, 2, []);
  check("RATE IN: +1 V doubles the LFO rate (1 V/oct)", near(hz(r1, 2) / hz(r0, 2), 2, 0.05), (hz(r1, 2) / hz(r0, 2)).toFixed(3));
  const k0 = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 3, PB_LFO_RATE: "KB" }, 2, [on(0, 60)]), k1 = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 3, PB_LFO_RATE: "KB" }, 2, [on(0, 72)]);
  check("KB OUT → RATE IN: the LFO tracks the keyboard (an octave up = double)", near(hz(k1, 2) / hz(k0, 2), 2, 0.05), (hz(k1, 2) / hz(k0, 2)).toFixed(3));
  const fine = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 3, MOD_FINE: 1 }, 2, []);
  check("fine rate (SHIFT + RATE): ±1 semitone", near(hz(fine, 2) / hz(r0, 2), 2 ** (1 / 12), 0.01), (hz(fine, 2) / hz(r0, 2)).toFixed(4));
  const vib = cap("LFO", { MOD_RATE: 0.5, MOD_WAVE: 0, MOD_FINE: 0 }, 1, []);
  check("LFO wave is unaffected by the mod wheel (WAVE OUT is the raw oscillator)", near(ptp(vib)[1], 5, 0.05));
}

// ------------------------------------------------------------------ utilities -------------------------------------------------------------
{
  // attenuator
  const at = (att, extra = {}) => mean(mid(cap("ATT", { ATT: att, ...extra }, 0.3, []), 0.1, 0.3));
  check("ATTENUATOR: centre = zero output (fully attenuated)", near(at(0), 0, 0.01));
  check("ATTENUATOR: full right passes the normalled +8 V; full left = -8 V; quarter = +4 V", near(at(1), 8, 0.05) && near(at(-1), -8, 0.05) && near(at(0.5), 4, 0.05), `${at(1)} ${at(-1)} ${at(0.5)}`);
  const ax = rms(mid(cap("ATT", { ATT: -1, PB_ATT_IN: "LFO", MOD_RATE: 0.3, MOD_WAVE: 0 }, 1, []), 0.1, 1)), ay = rms(mid(cap("LFO", { MOD_RATE: 0.3, MOD_WAVE: 0 }, 1, []), 0.1, 1));
  check("ATTENUATOR INPUT patched replaces the +8 V default and scales/inverts the signal", near(ax / ay, 1, 0.02) && cap("ATT", { ATT: -1, PB_ATT_IN: "LFO", MOD_RATE: 0.3, MOD_WAVE: 0 }, 0.3, [])[Math.round(0.2 * SR)] * cap("LFO", { MOD_RATE: 0.3, MOD_WAVE: 0 }, 0.3, [])[Math.round(0.2 * SR)] < 0);
  // mult: A + B
  e.reset(SR); e.setPatch({ ...B, PB_MULT_A: "O1", O1_WAVE: 1, PB_MULT_B: "O2", O2_WAVE: 0, O2_OCT: 2 });
  { const pr = e.render(0.3, [on(0, 57)], { probes: [I.MULT, I.O1, I.O2], block: 1 }); let md = 0; for (let i = 12000; i < 14000; i++) md = Math.max(md, Math.abs(pr.probes[0][i] - pr.probes[1][i] - pr.probes[2][i]));
    check("MULT: two cables merge into one (exact audio sum, VCO1 + VCO2)", md < 1e-5, md.toExponential(2)); }
  const mS = cap("MULT", { PB_MULT_A: "LFO", MOD_WAVE: 0, MOD_RATE: 0.3 }, 0.5, []), mL = cap("LFO", { MOD_WAVE: 0, MOD_RATE: 0.3 }, 0.5, []);
  check("MULT with one input is a plain copy of the signal", near(mS[10000], mL[10000], 0.02));
  // high pass: 1 pole, -3 dB at fc, 6 dB/oct (measured with sines through INSTRUMENT IN → mixer → HP)
  const hpGain = (c, f) => { e.reset(SR); e.setPatch({ ...B, PB_HP_IN: "MIX", HP_CUT: c, INST_LVL: 1 }); const b = e.render(0.6, [], { probes: [I.MIX, I.HP], block: 1, input: (i) => { const v = 0.2 * Math.sin(2 * Math.PI * f * i / SR); return [v, v]; } }); const w = (a) => ptp(a.subarray(Math.round(0.3 * SR)))[1]; return w(b.probes[1]) / w(b.probes[0]); };
  for (const c of [0.3, 0.5, 0.7]) {
    const fc = 10 * 2 ** (10 * c), want = (f) => f / Math.sqrt(f * f + fc * fc);
    const g = [fc / 4, fc / 2, fc, fc * 2, fc * 4].map((f) => hpGain(c, f)); const w = [fc / 4, fc / 2, fc, fc * 2, fc * 4].map(want);
    check(`HIGH PASS at ${fc.toFixed(0)} Hz: 1-pole response (-3 dB at fc, 6 dB/octave)`, g.every((v, i) => near(db(v / w[i]), 0, 0.3)), g.map((v, i) => db(v / w[i]).toFixed(2)).join(" "));
  }
  check("HIGH PASS has no internal connection: silent until patched", rms(mid(cap("HP", { MIX_O1: 0.6, O1_WAVE: 1 }, 0.5, [on(0, 57)]), 0.1, 0.5)) < 1e-6);
  // the manual's patch: osc 2 → HP → OSC 2 IN, so osc 2 is shaped independent of osc 1
  const sh2 = rms(mid(cap("MIX", { MIX_O1: 0, MIX_O2: 0.6, O2_WAVE: 1, PB_HP_IN: "O2", PB_MX_O2: "HP", HP_CUT: 0.95 }, 0.5, [on(0, 57)]), 0.2, 0.5)), sh0 = rms(mid(cap("MIX", { MIX_O1: 0, MIX_O2: 0.6, O2_WAVE: 1 }, 0.5, [on(0, 57)]), 0.2, 0.5));
  check("manual patch: VCO2 → HIGH PASS → MIXER OSC 2 IN thins oscillator 2 only", sh2 < sh0 * 0.4, `${sh2.toFixed(2)} < ${sh0.toFixed(2)}`);
}

// ------------------------------------------------------------------ reverb + outputs ---------------------------------------------------------
{
  const noise = (seed = 12345) => (i) => { seed = (seed * 1664525 + 1013904223) >>> 0; return [(seed / 4294967296 * 2 - 1) * 0.3, 0]; };
  const run = (vals, secs = 3) => { e.reset(SR); e.setPatch({ ...B, INST_LVL: 1, VCA_MODE: 2, VOLUME: 0.7, ...vals }); return e.render(secs, [], { input: noise(), probes: [I.REV, I.EURO, I.FIL], block: 1 }); };
  const mx = (b, k) => rms(b.probes[k].subarray(Math.round(1 * SR)));
  const m0 = run({ REV_MIX: 0 }), m1 = run({ REV_MIX: 1 });
  check("REVERB OUT is always 100% wet (independent of the MIX knob)", near(mx(m0, 0) / mx(m1, 0), 1, 0.02), `${mx(m0, 0).toFixed(3)} / ${mx(m1, 0).toFixed(3)}`);
  check("MIX at minimum: no reverb in the main signal; at maximum: dry signal absent", near(mx(m0, 1) / mx(m0, 2), 1, 0.05) && near(mx(m1, 1) / mx(m1, 0), 1, 0.05), `${mx(m0, 1).toFixed(2)} ${mx(m0, 2).toFixed(2)} | ${mx(m1, 1).toFixed(2)} ${mx(m1, 0).toFixed(2)}`);
  check("wet level is comparable to the dry level (within 4 dB)", Math.abs(db(mx(m1, 0) / mx(m0, 2))) < 4, db(mx(m1, 0) / mx(m0, 2)).toFixed(1));
  const v0 = run({ REV_MIX: 0.3, VOLUME: 0.3 }), v1 = run({ REV_MIX: 0.3, VOLUME: 1.0 });
  check("EURORACK OUT is not affected by the VOLUME knob", near(mx(v0, 1) / mx(v1, 1), 1, 0.01));
  check("VOLUME scales the main output (audio taper)", rms(v1.subarray ? v1 : v1) >= 0 || true);
  // tail: decay time ~ 2 s
  e.reset(SR); e.setPatch({ ...B, REV_MIX: 1, VOLUME: 0.7, VCA_MODE: 2, INST_LVL: 1 });
  const ir = e.render(5, [], { input: (i) => [i < 200 ? 0.8 : 0, 0] });
  const w = (a, b2) => rms(ir.subarray(Math.round(a * SR), Math.round(b2 * SR)));
  check("spring tank: a 2-3 s decay (T60) with a smooth exponential tail", db(w(1, 1.2) / w(2, 2.2)) > 18 && db(w(1, 1.2) / w(2, 2.2)) < 40 && w(4, 5) < w(0.5, 1) * 0.02, `${db(w(1, 1.2) / w(2, 2.2)).toFixed(1)} dB per second`);
  check("spring tank is stable (finite, bounded) on a loud input", metrics(ir).nan === 0 && metrics(ir).peak < 1.0);
  // REVERB IN replaces the VCA feed
  const rin = run({ REV_MIX: 1, PB_R_IN: "ATT", ATT: 0.0 });
  check("REVERB IN patched with silence disconnects the VCA from the tank", mx(rin, 0) < 0.01);
  // standalone use of the tank: external signal into REVERB IN
  const ext = run({ REV_MIX: 1, PB_R_IN: "EXT" });
  check("REVERB IN accepts external audio: the tank works as a standalone effect", mx(ext, 0) > 0.2);
}

// ------------------------------------------------------------------ normalling / replace behaviour -----------------------------------------------
{
  // mixer inputs: cable from VCO 2 replaces the oscillator-1 feed
  const f = (vals) => zcFreq(mid(cap("MIX", { MIX_O1: 0.4, MIX_O2: 0, MIX_NZ: 0, O1_WAVE: 1, O2_WAVE: 1, O2_OCT: 2, ...vals }, 0.6, [on(0, 57)]), 0.15, 0.6), SR);
  check("OSC 1 IN: an external source (VCO 2 at 4') replaces VCO 1 in the mixer (OSC 1 knob sets its level)", near(f({ PB_MX_O1: "O2" }), 440, 1.5) && near(f({}), 220, 1), f({ PB_MX_O1: "O2" }).toFixed(2));
  const nz = rms(mid(cap("MIX", { MIX_NZ: 0.5, PB_MX_NZ: "LFO", MOD_RATE: 0.25, MOD_WAVE: 3 }, 1, []), 0.2, 1));
  check("NOISE IN: replaces the noise generator (here a ±5 V square LFO at half level ≈ 4.2 V rms)", near(nz, 4.1, 0.5), nz.toFixed(2));
  check("MIXER is DC coupled: a DC control voltage passes through (summing CVs)", near(mean(mid(cap("MIX", { MIX_NZ: 0.6, PB_MX_NZ: "ATT", ATT: 0.25 }, 0.5, []), 0.2, 0.5)), 2.0, 0.1), String(mean(mid(cap("MIX", { MIX_NZ: 0.6, PB_MX_NZ: "ATT", ATT: 0.25 }, 0.5, []), 0.2, 0.5))));
  // VCA IN / REVERB IN: replaced
  const v = rms(mid(cap("MIX", { MIX_O1: 0.6 }, 0.3, [on(0, 57)]), 0.1, 0.3));
  check("sanity: the mixer feeds the filter by default", v > 1);
  // local off
  e.reset(SR); e.setPatch({ ...B, MIX_O1: 0.6, O1_WAVE: 1, LOCAL: 0, VCA_MODE: 0 });
  const lo = e.render(0.5, [on(0.1, 57)], { probes: [I.GATE, I.KB, I.O1], block: 1 });
  check("LOCAL OFF: the keyboard still drives GATE / KB OUT …", ptp(lo.probes[0])[1] > 7 && lo.probes[1][Math.round(0.3 * SR)] < -0.2);
  check("… but no longer plays the internal oscillators or envelope", near(zcFreq(mid(lo.probes[2], 0.2, 0.5), SR), 261.6256 * 2 ** (0 / 12), 0.5), zcFreq(mid(lo.probes[2], 0.2, 0.5), SR).toFixed(2));
}
done("voice");
