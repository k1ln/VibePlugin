// midi.mjs — Doob's MIDI map: mod wheel (CC1 + CC33 14-bit), pitch bend (CC128), RPN 0 bend range, all notes / sound off, local control,
// host automation vs CC precedence, panic marker. node tests/midi.mjs <wasm>
import { Engine, P, NODE, WASM } from "./lab.mjs";
import { check, near, done } from "./t.mjs";
const e = new Engine(WASM);
const pidx = Object.fromEntries(P.map((p, i) => [p.key, i]));
const val = (k) => e.ex.paramValue(pidx[k]);
const cc = (n, v) => { e.ex.controlChange(n, v); e.ex.process(1); };
e.setPatch({}); e.ex.process(1);
cc(1, 1); check("CC1 mod wheel full", near(val("MODW"), 1, 1e-6));
cc(1, 0.5); check("CC1 half", near(val("MODW"), 0.5, 0.01));
cc(1, 64 / 127); cc(33, 0); const a = val("MODW"); cc(33, 1); const b = val("MODW");
check("CC1 + CC33 form a 14-bit value", b > a && near(a, 8192 / 16383, 0.001), `${a} ${b}`);
cc(101, 0); cc(100, 0); cc(6, 7 / 127); check("RPN 0 (CC101/100/6) sets the bend range (7)", val("BEND") === 7, String(val("BEND")));
cc(6, 12 / 127); check("RPN 0 → 12 semitones", val("BEND") === 12);
cc(6, 2 / 127); check("RPN 0 → 2 semitones", val("BEND") === 2);
// host automation vs CC
e.setPatch({ MODW: 0.9 }); e.ex.process(1); check("host automation wins after a CC (the value changed on the host side)", near(val("MODW"), 0.9, 0.01));
cc(1, 0.1); check("CC wins over the previously set host value", near(val("MODW"), 0.1, 0.01));
// bend
e.reset(); e.setPatch({ BEND: 12, VOL1: 0.6, O1_WAVE: 2, DRIFT: 0, BLEED: 0, LSUS: 1, LATK: 0 });
e.ex.noteOn(60, 261.6256, 0.8); e.ex.process(2000);
const f0 = e.ex.dbgNode(NODE.F1);
e.ex.controlChange(128, 1); e.ex.process(4000); const f1 = e.ex.dbgNode(NODE.F1);
check("pitch bend CC128 +1 at range 12 → one octave up", near(f1 / f0, 2, 0.01), (f1 / f0).toFixed(4));
e.ex.controlChange(128, -0.5); e.ex.process(4000); const f2 = e.ex.dbgNode(NODE.F1);
check("pitch bend -0.5 → half the range down (tritone)", near(f2 / f0, 2 ** (-0.5), 0.01), (f2 / f0).toFixed(4));
e.ex.controlChange(128, 0);
// gate / lamp state
e.ex.process(100); check("a held key opens the gate", e.ex.dbgNode(NODE.GATE) === 1);
e.ex.controlChange(123, 0); e.ex.process(10); check("CC123 all notes off releases the gate", e.ex.dbgNode(NODE.GATE) === 0);
e.ex.noteOn(64, 329.6276, 0.8); e.ex.process(300); check("note on again", e.ex.dbgNode(NODE.GATE) === 1);
e.ex.controlChange(120, 0); e.ex.process(10); check("CC120 all sound off releases the gate", e.ex.dbgNode(NODE.GATE) === 0);
e.ex.controlChange(122, 0); e.ex.process(1); check("CC122 local control off", val("LOCAL") === 0);
e.ex.noteOn(60, 261.6, 0.8); e.ex.process(100); check("with LOCAL off the keyboard drives nothing (no gate)", e.ex.dbgNode(NODE.GATE) === 0);
e.ex.controlChange(122, 1); e.ex.process(1); check("CC122 local control on", val("LOCAL") === 1);
e.ex.noteOff(60); e.ex.process(10);
e.ex.noteOn(60, 261.6, 0.8); e.ex.process(100); e.ex.noteOn(-5, 0, 0); e.ex.process(10);
check("note id -5 (panic) clears the note stack", e.ex.dbgNode(NODE.GATE) === 0 && e.ex.dbgNode(NODE.HELD) === 0);
done("midi");
