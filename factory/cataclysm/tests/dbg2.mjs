import { Engine, mono, pitchAt, metrics } from "./lab.mjs";
const TONE = { C_LEV: -60, T_LEV: 0, D1_TYPE: 0, T_PE1_AMT: 0, T_PE2_AMT: 0, T_DEC: 3000, T_PITCH: 100, T_KT: 0, EQ_HPF: 10, OUT_CEIL: -0.1 };
for (const patch of [{ ...TONE, T_PE1_AMT: 24, T_PE1_TIME: 100 }, { ...TONE, T_PE1_AMT: 24, T_PE1_TIME: 100, EQ_HPF: 10 }]) {
  const e = new Engine(process.argv[2]); e.setPatch(patch);
  const buf = e.render(0.6); const m = mono(buf);
  console.log(metrics(buf).peak, pitchAt(m, 48000, 0.4, 0.55, 30, 3000), pitchAt(m, 48000, 0.1, 0.25, 30, 3000), pitchAt(m, 48000, 0.4, 0.55, 30, 2000));
}
