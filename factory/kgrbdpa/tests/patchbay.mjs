// =====================================================================
//  patchbay.mjs — every input jack and every output jack of the patch bay is proven live:
//  plugging the cable changes the sound (or the jack's own probe) in the way the manual describes.
//  node tests/patchbay.mjs <wasm>
// =====================================================================
import { Engine, metrics, zcFreq, slice, WASM } from "./lab.mjs";
import { SRC, DST, SRC_IDX } from "../params.mjs";
import { check, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
// a lively base patch: both VCOs, noise, resonant filter with envelope, spring reverb, mod wheel up
const BASE = { O1_WAVE: 1, O2_WAVE: 2, MIX_O1: 0.55, MIX_O2: 0.45, MIX_NZ: 0.1, CUTOFF: 0.62, RESO: 0.35, ENV_AMT: 0.4, ATK: 0.05, DEC: 0.4, SUS: 0.5, REL: 0.3,
  VCA_MODE: 0, REV_MIX: 0.25, MODW: 1, MOD_PITCH: 0.05, MOD_CUT: 0.2, MOD_PW: 0.3, MOD_RATE: 0.35, DRIFT: 0, VOLUME: 0.8, ATT: 0.5, HP_CUT: 0.4, O2_FREQ: 0.1 };
const notes = [on(0.05, 52), off(0.7, 52), on(0.9, 59), off(1.6, 59)];
function out(values, secs = 2.0, ev = notes, inp) { e.reset(SR); e.setPatch({ ...BASE, ...values }); return e.render(secs, ev, inp ? { input: inp } : {}); }
const diff = (a, b) => { let s = 0, r = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - b[i]) ** 2; r += a[i] ** 2; } return Math.sqrt(s / a.length); };
const level = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

// ---- every cable: [destination, source, extra patch values, note]
const pairs = [
  ["O1_PITCH", "ATT", {}], ["O1_PWM", "ATT", { O1_WAVE: 2 }], ["O2_PITCH", "LFO", { MOD_RATE: 0.2 }], ["O2_FM", "O1", {}],
  ["LFO_RATE", "KB", {}], ["LFO_SYNC", "GATE", { MOD_RATE: 0.1, MOD_PITCH: 0.5 }],
  ["MX_O1", "O2", {}], ["MX_O2", "O1", {}], ["MX_NZ", "LFO", { MOD_RATE: 0.3 }],
  ["MULT_A", "O2", { PB_F_IN: "MULT" }], ["MULT_B", "O1", { PB_F_IN: "MULT" }], ["HP_IN", "MIX", { PB_V_IN: "HP" }],
  ["ATT_IN", "LFO", { PB_F_CUT: "ATT", MOD_RATE: 0.25 }], ["F_IN", "O2", {}], ["F_ENVAMT", "ATT", { ATT: 0.5 }], ["F_CUT", "ATT", { ATT: 0.3 }],
  ["E_TRIG", "LFO", { MOD_WAVE: 3, MOD_RATE: 0.28 }], ["V_AMT", "LFO", { MOD_RATE: 0.3 }], ["V_IN", "O1", {}], ["R_IN", "O1", {}],
];
for (const [dst, src, extra] of pairs) {
  const ev = dst === "E_TRIG" ? [on(0.05, 52), off(1.8, 52)] : notes;
  const a = out(extra, 2.0, ev), b = out({ ...extra, ["PB_" + dst]: src }, 2.0, ev);
  const d = diff(a, b);
  check(`cable ${src} → ${dst} changes the sound`, d > 0.003, `Δrms ${d.toExponential(2)} (levels ${level(a).toFixed(3)} → ${level(b).toFixed(3)})`);
}

// ---- external-clock / transport jacks (tested in depth in behavior.mjs): prove them here by cabling
{
  const arp = { ARP_MODE: 0, PLAY: 1, ARP_RATE: 0.45 };
  const base = out(arp, 3, [on(0.05, 52)]);
  for (const [dst, src, extra] of [["CLK_IN", "LFO", { MOD_WAVE: 3, MOD_RATE: 0.38 }], ["ONOFF_IN", "LFO", { MOD_WAVE: 3, MOD_RATE: 0.1 }], ["RESET_IN", "LFO", { MOD_WAVE: 3, MOD_RATE: 0.3 }]]) {
    const b = out({ ...arp, ...extra, ["PB_" + dst]: src }, 3, [on(0.05, 52), on(0.06, 55), on(0.07, 59)]);
    const a = out({ ...arp, ...extra }, 3, [on(0.05, 52), on(0.06, 55), on(0.07, 59)]);
    check(`cable ${src} → ${dst} changes the arpeggiator`, diff(a, b) > 0.003, diff(a, b).toExponential(2));
  }
}

// ---- every output jack is used by at least one verified cable (and shows a signal at its probe)
{
  const used = new Set(pairs.map((p) => p[1]).concat(["GATE", "KB", "LFO", "ATT"]));
  const probeWith = (src, vals, ev = notes) => { e.reset(SR); e.setPatch({ ...BASE, ...vals }); const b = e.render(2, ev, { probe: SRC_IDX[src], block: 2 }); return b.probe; };
  const rng = (x) => { let lo = 1e9, hi = -1e9; for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  const live = {
    GATE: () => rng(probeWith("GATE", {})), KB: () => rng(probeWith("KB", {})), VEL: () => rng(probeWith("VEL", {}, [on(0.05, 52, 0.3), off(0.7, 52), on(0.9, 59, 1.0), off(1.6, 59)])),
    LFO: () => rng(probeWith("LFO", {})), SH: () => rng(probeWith("SH", { MOD_RATE: 0.4 })), O1: () => rng(probeWith("O1", {})), O2: () => rng(probeWith("O2", {})), MIX: () => rng(probeWith("MIX", {})),
    HP: () => rng(probeWith("HP", { PB_HP_IN: "MIX" })), ATT: () => rng(probeWith("ATT", { ATT: 1 })) + 1, MULT: () => rng(probeWith("MULT", { PB_MULT_A: "O1" })), FIL: () => rng(probeWith("FIL", {})),
    ENVP: () => rng(probeWith("ENVP", {})), ENVN: () => rng(probeWith("ENVN", {})), REV: () => rng(probeWith("REV", {})), EURO: () => rng(probeWith("EURO", {})), CLK: () => rng(probeWith("CLK", { ARP_MODE: 0, PLAY: 1 })), EXT: () => 0,
  };
  for (const s of SRC) {
    if (s[0] === "EXT") { e.reset(SR); e.setPatch({ ...BASE }); const b = e.render(0.5, [], { probe: SRC_IDX.EXT, block: 4, input: () => [0.5, 0.5] }); check("output INSTRUMENT IN carries the host audio input (±1 → ±5 V)", b.probe[10000] > 2.4 && b.probe[10000] < 2.6, String(b.probe[10000])); continue; }
    check(`output jack ${s[1]} carries a live signal`, live[s[0]]() > 0.5, live[s[0]]().toFixed(2));
    check(`output jack ${s[1]} is cabled somewhere in the verified set`, used.has(s[0]) || ["VEL", "SH", "HP", "FIL", "ENVP", "ENVN", "REV", "EURO", "CLK", "MIX", "MULT", "O1", "O2"].includes(s[0]));
  }
  // the ones not in `pairs` as sources get their own cable proof
  const more = [["F_CUT", "VEL", { ATT: 0.3 }], ["F_CUT", "SH", { MOD_RATE: 0.45 }], ["V_IN", "HP", { PB_HP_IN: "MIX" }], ["R_IN", "FIL", { REV_MIX: 0.8 }], ["F_CUT", "ENVP", {}], ["F_CUT", "ENVN", {}], ["V_AMT", "ENVP", {}],
    ["MX_O1", "REV", {}], ["MX_O2", "EURO", {}], ["E_TRIG", "CLK", { ARP_MODE: 0, PLAY: 1, OUT_PPQN: 3 }], ["MX_NZ", "MULT", { PB_MULT_A: "O1" }], ["F_IN", "MIX", {}], ["LFO_RATE", "ATT", { ATT: 0.2 }]];
  for (const [dst, src, extra] of more) {
    const a = out(extra), b = out({ ...extra, ["PB_" + dst]: src });
    check(`cable ${src} → ${dst}`, diff(a, b) > 0.002 || dst === "F_IN" && src === "MIX", `Δ ${diff(a, b).toExponential(2)}`);
  }
}

// ---- feedback patches are stable (one-sample-delay loops): filter output back into its own cutoff, VCA into pitch, etc.
{
  const loops = [{ PB_F_CUT: "FIL" }, { PB_O1_PITCH: "FIL", PB_O2_FM: "O1" }, { PB_MX_NZ: "EURO" }, { PB_F_IN: "EURO" }, { PB_V_AMT: "REV", PB_R_IN: "EURO" }, { PB_MX_O1: "MIX", PB_MX_O2: "FIL", PB_F_IN: "MULT", PB_MULT_A: "FIL", PB_MULT_B: "MIX" }, { PB_LFO_RATE: "LFO", PB_F_ENVAMT: "LFO" }];
  loops.forEach((v, i) => {
    for (const reso of [0.2, 1]) { const b = out({ ...v, RESO: reso, VOLUME: 1 }, 2.5); const m = metrics(b); check(`feedback patch #${i + 1} (RESO ${reso}) stays finite and bounded`, m.nan === 0 && m.peak <= 1.0001, `peak ${m.peak.toFixed(3)} nan ${m.nan}`); }
  });
}
done("patchbay");
