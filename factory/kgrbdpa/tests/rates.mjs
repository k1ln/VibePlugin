// rates.mjs — behaviour is sample-rate independent: pitch, filter tuning, envelope, arp tempo, spring tail. node tests/rates.mjs <wasm>
import { Engine, zcFreq, metrics, WASM } from "./lab.mjs";
import { SRC_IDX as I } from "../params.mjs";
import { check, near, done } from "./t.mjs";
const B = { MIX_O1: 0.6, MIX_O2: 0, CUTOFF: 1, RESO: 0, ENV_AMT: 0, VCA_MODE: 2, KBD_TRK: 1, DRIFT: 0, VOLUME: 1 };
for (const sr of [22050, 32000, 44100, 48000, 88200, 96000, 192000]) {
  const e = new Engine(WASM, sr);
  const cap = (key, vals, secs, ev) => { e.reset(sr); e.setPatch({ ...B, ...vals }); const b = e.render(secs, ev, { probe: I[key], block: 1 }); return b.probe; };
  const tail = (x, a) => x.subarray(Math.round(a * sr));
  const f = zcFreq(tail(cap("O1", { O1_WAVE: 1 }, 0.6, [{ t: 0, type: "on", note: 69 }]), 0.2), sr);
  check(`${sr} Hz: VCO tracks (A4 = ${f.toFixed(3)} Hz)`, near(f, 440, 0.2));
  const fc = 20 * 1000 ** 0.45;
  const g = zcFreq(tail(cap("FIL", { RESO: 1, CUTOFF: 0.45, MIX_O1: 0 }, 1.2, [{ t: 0, type: "on", note: 60 }]), 0.6), sr);
  if (fc < sr * 0.3) check(`${sr} Hz: filter self-oscillates at its cutoff (${fc.toFixed(1)} Hz → ${g.toFixed(1)})`, near(g / fc, 1, 0.005));
  const env = cap("ENVP", { ATK: 0.5, SUS: 0.6 }, 0.6, [{ t: 0.05, type: "on", note: 60 }]);
  let t8 = -1; for (let i = 0; i < env.length; i++) if (env[i] >= 7.99) { t8 = i / sr - 0.05; break; }
  check(`${sr} Hz: attack time 80 ms (${(t8 * 1000).toFixed(1)} ms)`, near(t8, 0.08, 0.004));
  const gate = cap("GATE", { ARP_MODE: 0, PLAY: 1, ARP_RATE: 0.5 }, 3, [{ t: 0.05, type: "on", note: 60 }]);
  const ups = []; for (let i = 1; i < gate.length; i++) if (gate[i] > 4 && gate[i - 1] <= 4) ups.push(i / sr);
  const step = (ups[ups.length - 1] - ups[1]) / (ups.length - 2);
  check(`${sr} Hz: arp step (150 BPM → ${(30 / 150 * 1000).toFixed(1)} ms; ${(step * 1000).toFixed(2)} ms)`, near(step, 30 / 150, 0.001));
  e.reset(sr); e.setPatch({ ...B, REV_MIX: 1, MIX_O1: 0, INST_LVL: 1 });
  const ir = e.render(5, [], { input: (i) => [i < 100 ? 0.8 : 0, 0] });
  const w = (a, b2) => Math.sqrt(ir.subarray(Math.round(a * sr), Math.round(b2 * sr)).reduce((s, v) => s + v * v, 0) / Math.round((b2 - a) * sr));
  const dbPerSec = 20 * Math.log10(w(1, 1.2) / w(2, 2.2));
  check(`${sr} Hz: spring decay ${dbPerSec.toFixed(1)} dB/s (2.3 s T60 → ~26)`, dbPerSec > 18 && dbPerSec < 36 && metrics(ir).nan === 0);
}
done("rates");
