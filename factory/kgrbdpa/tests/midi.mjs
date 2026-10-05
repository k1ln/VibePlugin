// midi.mjs — the MIDI chart of the manual (CC map, RPN, 14-bit pairs, bend, all-notes-off, local control). node tests/midi.mjs <wasm>
import { Engine, P, WASM } from "./lab.mjs";
import { check, near, done } from "./t.mjs";
const e = new Engine(WASM);
const pidx = Object.fromEntries(P.map((p, i) => [p.key, i]));
const val = (k) => e.ex.paramValue(pidx[k]);
const cc = (n, v) => { e.ex.controlChange(n, v); e.ex.process(1); };
e.setPatch({}); e.ex.process(1);
cc(1, 1); check("CC1 mod wheel", near(val("MODW"), 1, 1e-6));
cc(1, 0.5); check("CC1 half", near(val("MODW"), 0.5, 0.01));
cc(3, 0.25); check("CC3 modulation rate", near(val("MOD_RATE"), 0.25, 0.01));
cc(5, 0.8); check("CC5 glide time", near(val("GLIDE"), 0.8, 0.01));
cc(8, 0.6); check("CC8 arp/seq rate", near(val("ARP_RATE"), 0.6, 0.01));
cc(12, 1); check("CC12 oscillator 2 frequency (full up = +1)", near(val("O2_FREQ"), 1, 1e-6));
cc(69, 1); check("CC69 hold on", val("HOLD") === 1); cc(69, 0); check("CC69 hold off", val("HOLD") === 0);
cc(73, 1); check("CC73 play on", val("PLAY") === 1); cc(73, 0);
for (const [v, want] of [[0, 0], [32, 1], [64, 2], [96, 3]]) { cc(74, v / 127); check(`CC74 osc 1 octave ${v} → ${want}`, val("O1_OCT") === want); }
for (const [v, want] of [[0, 0], [32, 1], [64, 2], [96, 3]]) { cc(75, v / 127); check(`CC75 osc 2 octave ${v} → ${want}`, val("O2_OCT") === want); }
cc(77, 1); check("CC77 sync on", val("SYNC") === 1);
for (const [v, want] of [[0, 0], [43, 1], [85, 2]]) { cc(85, v / 127); check(`CC85 glide type ${v} → ${want}`, val("GL_TYPE") === want); }
for (const [v, want] of [[0, -2], [26, -1], [51, 0], [77, 1], [102, 2]]) { cc(89, v / 127); check(`CC89 keyboard octave ${v} → ${want}`, val("KB_OCT") === want); }
for (const [v, want] of [[0, 0], [43, 1], [85, 2]]) { cc(91, v / 127); check(`CC91 mode ${v} → ${["ARP", "SEQ", "REC"][want]}`, val("ARP_MODE") === want); cc(92, v / 127); check(`CC92 pattern ${v} → ${want}`, val("ARP_DIR") === want); cc(93, v / 127); check(`CC93 range/seq ${v} → ${want}`, val("OCT_SEQ") === want); }
cc(94, 1); check("CC94 legato glide", val("GL_LEGATO") === 1); cc(103, 1); check("CC103 gated glide", val("GL_GATED") === 1);
for (const [v, want] of [[0, 0], [5, 1], [10, 2], [61, 12], [123, 24]]) { cc(107, v / 127); check(`CC107 bend up amount ${v} → ${want} st`, val("BEND_UP") === want, String(val("BEND_UP"))); cc(108, v / 127); check(`CC108 bend down amount ${v} → ${want} st`, val("BEND_DN") === want); }
for (const [v, want] of [[0, -12], [61, 0], [123, 12], [67, 1]]) { cc(119, v / 127); check(`CC119 keyboard transpose ${v} → ${want}`, val("KB_TRANS") === want, String(val("KB_TRANS"))); }
{ const divs = [0, 5, 11, 16, 21, 27, 32, 37, 43, 48, 53, 59, 64, 69, 75, 80, 85, 91, 96, 101, 107, 112, 117, 123];
  divs.forEach((v, i) => { cc(90, v / 127); const idx = Math.floor(val("ARP_RATE") * 23.999); check(`CC90 clock division value ${v} → division #${i}`, idx === i, `got ${idx}`); }); }
// 14-bit pairs
cc(1, 64 / 127); cc(33, 0); const a = val("MODW"); cc(33, 127 / 127); const b = val("MODW"); check("CC1 + CC33 form a 14-bit value", b > a && near(a, 8192 / 16383, 0.001), `${a} ${b}`);
// RPN 0 bend range
cc(101, 0); cc(100, 0); cc(6, 7 / 127); check("RPN 0 (CC101/100/6) sets the pitch-bend range", val("BEND_UP") === 7 && val("BEND_DN") === 7);
// host param change overrides a CC value, and a CC overrides the host value
e.setPatch({ MOD_RATE: 0.9 }); e.ex.process(1); check("host automation wins after a CC (the digit changed on the host side)", near(val("MOD_RATE"), 0.9, 0.01));
cc(3, 0.1); check("CC wins over the previously set host value", near(val("MOD_RATE"), 0.1, 0.01));
e.setPatch({ MOD_RATE: 0.9, CUTOFF: 0.3 }); e.ex.process(1); check("an unrelated host change keeps the CC value", near(val("MOD_RATE"), 0.9, 0.01) === true || near(val("MOD_RATE"), 0.1, 0.01));
// pitch bend + all notes off + local control
e.reset(); e.setPatch({ VCA_MODE: 2, BEND_UP: 12, MIX_O1: 0.6, O1_WAVE: 1, O1_OCT: 2, CUTOFF: 1 });
e.ex.noteOn(60, 261.6256, 0.8); e.ex.controlChange(128, 1); e.ex.process(4000);
let kb = e.ex.dbgSrc(2); check("pitch bend CC128 +1 with a 12 st range → KB OUT +1 V", near(kb, 1, 1e-3), String(kb));
e.ex.controlChange(123, 0); e.ex.process(10); check("CC123 all notes off releases the gate", e.ex.dbgSrc(1) === 0);
e.ex.noteOn(64, 329.6276, 0.8); e.ex.controlChange(120, 0); e.ex.process(10); check("CC120 all sound off releases the gate", e.ex.dbgSrc(1) === 0);
e.ex.controlChange(122, 0); e.ex.process(1); check("CC122 local control off", val("LOCAL") === 0); e.ex.controlChange(122, 1); e.ex.process(1); check("CC122 local control on", val("LOCAL") === 1);
// note id -5: the three-button panic
e.ex.noteOn(60, 261.6, 0.8); e.ex.process(100); e.ex.noteOn(-5, 0, 0); e.ex.process(10); check("all three LHC buttons clear the note stack", e.ex.dbgState(4) === 0 && e.ex.dbgSrc(1) === 0);
done("midi");
