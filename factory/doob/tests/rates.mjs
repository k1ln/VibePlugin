// rates.mjs — behaviour is sample-rate independent: pitch, cutoff tuning, contour times, glide. node tests/rates.mjs <wasm>
import { Engine, NODE, zcFreq, metrics, WASM } from "./lab.mjs";
import { check, near, done } from "./t.mjs";
const B = { VOL1: 0.6, O1_WAVE: 0, CUTOFF: 1, EMPH: 0, CONTOUR: 0, KB1: 0, KB2: 0, DRIFT: 0, BLEED: 0, OUTVOL: 1, LSUS: 1, LATK: 0 };
const taper = (x) => (Math.exp(4.39 * x) - 1) / (Math.exp(4.39) - 1);
for (const sr of [22050, 32000, 44100, 48000, 88200, 96000, 192000]) {
  const e = new Engine(WASM, sr);
  const cap = (vals, secs, node, ev) => { e.reset(sr); e.setPatch({ ...B, ...vals }); return e.render(secs, ev, { probe: node, block: 1 }).probe; };
  const tail = (x, a) => x.subarray(Math.round(a * sr));
  const f = zcFreq(tail(cap({}, 0.6, NODE.O1, [{ t: 0, type: "on", note: 69 }]), 0.2), sr);
  check(`${sr} Hz: oscillator tracks (A4 = ${f.toFixed(3)} Hz)`, near(f, 440, 0.2));
  const fc = 440 * 2 ** 2;
  const g = zcFreq(tail(cap({ SW_O1: 0, STRIG: 1, EMPH: 1, CUTOFF: 0.6 }, 1.2, NODE.FIL, [{ t: 0, type: "on", note: 60 }]), 0.6), sr);
  if (fc < sr * 0.3) check(`${sr} Hz: filter self-oscillates at its cutoff (${fc} Hz → ${g.toFixed(1)})`, near(g / fc, 1, 0.006));
  const x = cap({ LATK: 0.5, LSUS: 1 }, 1.5, NODE.CL, [{ t: 0.05, type: "on", note: 60 }]);
  let t1 = -1; for (let i = 0; i < x.length; i++) if (x[i] >= 0.9995) { t1 = i / sr - 0.05; break; }
  const want = 0.001 + 13.999 * taper(0.5);
  check(`${sr} Hz: attack time ${want.toFixed(3)} s (${t1.toFixed(3)})`, near(t1 / want, 1, 0.03));
  const gl = cap({ GLIDE_ON: 1, GLIDE: 0.4 }, 4, NODE.KCUR, [{ t: 0.0, type: "on", note: 41 }, { t: 0.9, type: "off", note: 41 }, { t: 1.0, type: "on", note: 65 }, { t: 3, type: "off", note: 65 }]);
  const tau = 0.00033 + 2.2 * taper(0.4);
  const i63 = (() => { for (let i = Math.round(1.05 * sr); i < gl.length; i++) if (gl[i] >= 24 * 0.632) return i / sr - 1.0; return -1; })();
  check(`${sr} Hz: glide time constant ${tau.toFixed(3)} s (${i63.toFixed(3)})`, near(i63 / tau, 1, 0.05) || near(i63, tau, 0.03));
  const hi = metrics(e.render(1, [{ t: 0, type: "on", note: 80 }]));
  check(`${sr} Hz: finite, no NaN at the top key`, hi.nan === 0);
}
done("rates");
