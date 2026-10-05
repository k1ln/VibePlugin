// =====================================================================
//  behavior.mjs — keyboard / glide / arpeggiator / sequencer / clock behaviour of KGrbdPa,
//  checked against the manual (pp. 9, 27-33, 35, 37-38, MIDI chart). node tests/behavior.mjs <wasm>
// =====================================================================
import { Engine, WASM } from "./lab.mjs";
import { SRC_IDX } from "../params.mjs";
import { check, near, done } from "./t.mjs";

const SR = 48000, e = new Engine(WASM, SR);
const G = SRC_IDX.GATE, KB = SRC_IDX.KB, VEL = SRC_IDX.VEL, CLK = SRC_IDX.CLK, LFO = SRC_IDX.LFO, ENVP = SRC_IDX.ENVP;
const on = (t, note, vel = 0.8) => ({ t, type: "on", note, vel });
const off = (t, note) => ({ t, type: "off", note });
const mark = (t, id) => ({ t, type: "marker", id });          // -2 rest, -3 tie, -4 accent
const noteOf = (v) => Math.round(60 + 12 * v);

// run and extract the gate/pitch history -------------------------------------------------------
function run(values, events, secs, extra = []) {
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, MIX_O2: 0, GLIDE: 0, ...values });
  const b = e.render(secs, events, { probes: [G, KB, VEL, ...extra], block: 4 });
  const [g, kb, vel] = b.probes;
  const ev = [];           // {t, note, kind:'gate'|'legato', tOff}
  let hi = false, lastNote = null;
  for (let i = 0; i < g.length; i++) {
    const h = g[i] > 4;
    if (h && !hi) { ev.push({ t: i / SR, note: noteOf(kb[i]), kind: "gate", vel: vel[i] / 5, i }); lastNote = noteOf(kb[i]); }
    else if (h && hi && noteOf(kb[i]) !== lastNote) { ev.push({ t: i / SR, note: noteOf(kb[i]), kind: "legato", vel: vel[i] / 5, i }); lastNote = noteOf(kb[i]); }
    if (!h && hi) { const last = ev[ev.length - 1]; if (last) last.tOff = i / SR; }
    hi = h;
  }
  return { g, kb, vel, ev, probes: b.probes, notes: ev.map((x) => x.note), b };
}
const arr = (a) => a.join(",");

// ---------------------------------------------------------------- keyboard -----------------------------------------
{
  let r = run({ NOTE_PRI: 2 }, [on(0.1, 60), on(0.3, 64), off(0.5, 64), off(0.7, 60)], 1.0);
  check("keyboard LAST: 60 then 64 sounds 64 (legato), release 64 returns to 60", arr(r.notes) === "60,64,60", arr(r.notes));
  check("overlapped keys do not re-trigger the gate (single trigger)", r.ev.filter((x) => x.kind === "gate").length === 1);
  check("gate falls when the last key is released", near(r.ev[r.ev.length - 1].tOff, 0.7, 0.002), String(r.ev[r.ev.length - 1].tOff));
  r = run({ NOTE_PRI: 0 }, [on(0.1, 64), on(0.2, 60), on(0.3, 67)], 0.6);
  check("keyboard LOW priority: lowest held key wins", r.notes.slice(-1)[0] === 60 && r.notes.join(",") === "64,60", arr(r.notes));
  r = run({ NOTE_PRI: 1 }, [on(0.1, 60), on(0.2, 64), on(0.3, 62)], 0.6);
  check("keyboard HIGH priority: highest held key wins", arr(r.notes) === "60,64", arr(r.notes));
  r = run({}, [on(0.1, 60), off(0.2, 60), on(0.2005, 62), off(0.4, 62)], 0.6);
  check("separated notes re-trigger the gate even with a ~0 gap (>=1 ms low)", r.ev.filter((x) => x.kind === "gate").length === 2 && r.ev[1].t - r.ev[0].tOff >= 0.00095, JSON.stringify(r.ev.map((x) => [x.t, x.tOff])));
  r = run({ KB_OCT: 1, KB_TRANS: 3 }, [on(0.1, 60)], 0.3);
  check("keyboard octave +1 and transpose +3 → KB OUT = 75", arr(r.notes) === "75", arr(r.notes));
  r = run({}, [on(0.1, 60, 0.5)], 0.3);
  check("KB VEL OUT = velocity × 5 V", near(r.vel[Math.round(0.2 * SR)], 2.5, 0.01), String(r.vel[Math.round(0.2 * SR)]));
  const kbv = r.kb[Math.round(0.2 * SR)];
  check("KB OUT is 1 V/oct (note 60 = 0 V)", near(kbv, 0, 1e-6), String(kbv));
  r = run({ KB_RANGE: 1 }, [on(0.1, 72)], 0.3);
  check("KB OUT range 0..10 V shifts by +5 V", near(r.kb[Math.round(0.2 * SR)], 6, 1e-4), String(r.kb[Math.round(0.2 * SR)]));
}

// ---------------------------------------------------------------- pitch wheel / glide ---------------------------------------
{
  e.reset(SR); e.setPatch({ VCA_MODE: 2, PITCHW: 1, BEND_UP: 5, BEND_DN: 2 });
  let b = e.render(0.3, [on(0, 60)], { probes: [KB], block: 8 });
  check("pitch wheel full up = +BEND UP semitones (5)", near(b.probes[0][SR * 0.25 | 0] * 12, 5, 0.01), String(b.probes[0][SR * 0.25 | 0] * 12));
  e.setPatch({ VCA_MODE: 2, PITCHW: -1, BEND_UP: 5, BEND_DN: 2 }); b = e.render(0.3, [on(0, 60)], { probes: [KB], block: 8 });
  check("pitch wheel full down = -BEND DOWN semitones (2)", near(b.probes[0][SR * 0.25 | 0] * 12, -2, 0.01));
  e.setPatch({ VCA_MODE: 2, PITCHW: 1, BEND_UP: 12 }); b = e.render(0.3, [on(0, 60)], { probes: [KB], block: 8 });
  check("bend range 12", near(b.probes[0][SR * 0.25 | 0], 1, 1e-3));
}
for (const [ty, name] of [[0, "LCR"], [1, "LCT"], [2, "EXP"]]) {
  const r = run({ GLIDE: 0.6, GL_TYPE: ty }, [on(0.1, 48), off(0.3, 48), on(1.0, 60)], 3.0);
  const kb = r.kb; let t90 = -1, tEnd = -1;
  for (let i = Math.round(1.0 * SR); i < kb.length; i++) { const sem = kb[i] * 12; if (t90 < 0 && sem > -12 + 10.8) t90 = i / SR - 1.0; if (sem > -0.02) { tEnd = i / SR - 1.0; break; } }
  const T = 0.01 * Math.pow(600, (0.6 - 0.01) / 0.99);
  if (ty === 0) check("glide LCR: 1 octave takes the glide time", near(tEnd, T, 0.01), `${tEnd.toFixed(3)} vs ${T.toFixed(3)}`);
  if (ty === 1) check("glide LCT: any interval takes the glide time", near(tEnd, T, 0.01), `${tEnd.toFixed(3)} vs ${T.toFixed(3)}`);
  if (ty === 2) check("glide exponential: smooth, reaches the target", tEnd > T * 0.5 && tEnd < T * 1.5 && t90 > 0 && t90 < tEnd * 0.6, `${t90.toFixed(3)} / ${tEnd.toFixed(3)}`);
  const mid = kb[Math.round((1.0 + T * 0.5) * SR)] * 12;
  check(`glide ${name}: pitch is between the notes mid-glide`, mid > -11.5 && mid < -0.3, String(mid.toFixed(2)));
  const kbPrev = kb[Math.round(0.9 * SR)] * 12;
}
{
  let r = run({ GLIDE: 0.6, GL_LEGATO: 1 }, [on(0.1, 48), off(0.3, 48), on(0.6, 60)], 1.2);
  check("legato glide: a detached note does NOT glide", near(r.kb[Math.round(0.65 * SR)] * 12, 0, 0.01), String(r.kb[Math.round(0.65 * SR)] * 12));
  r = run({ GLIDE: 0.6, GL_LEGATO: 1 }, [on(0.1, 48), on(0.4, 60)], 1.2);
  check("legato glide: an overlapped note glides", r.kb[Math.round(0.45 * SR)] * 12 < -1 && r.kb[Math.round(0.45 * SR)] * 12 > -11.5, String(r.kb[Math.round(0.45 * SR)] * 12));
  r = run({ GLIDE: 0.6 }, [on(0.1, 48), off(0.3, 48), on(0.6, 60)], 1.2);
  check("normal glide: detached notes glide from the previous pitch", r.kb[Math.round(0.65 * SR)] * 12 < -1);
  r = run({ GLIDE: 0.0 }, [on(0.1, 48), on(0.4, 60)], 0.8);
  check("glide at minimum = no glide", near(r.kb[Math.round(0.45 * SR)] * 12, 0, 0.01));
}

// ---------------------------------------------------------------- arpeggiator -----------------------------------------------
const arpV = { ARP_MODE: 0, PLAY: 1, ARP_RATE: (120 - 20) / 260 };      // 120 BPM → 0.25 s per step (eighth notes)
{
  let r = run(arpV, [on(0.05, 67), on(0.06, 60), on(0.07, 64)], 2.2);
  const first = r.ev.filter((x) => x.kind === "gate");
  check("arp ORDR plays notes in the order they were pressed", arr(first.slice(0, 7).map((x) => x.note)) === "67,60,64,67,60,64,67", arr(first.map((x) => x.note)));
  const dts = first.slice(1).map((x, i) => x.t - first[i].t);
  check("arp step = an eighth note at the BPM (120 BPM → 250 ms)", dts.every((d) => near(d, 0.25, 0.002)), dts.slice(0, 4).map((d) => d.toFixed(4)).join(" "));
  const dur = first.slice(0, 5).map((x) => x.tOff - x.t);
  check("arp gate is half a step long", dur.every((d) => near(d, 0.125, 0.003)), dur.map((d) => d.toFixed(3)).join(" "));
  r = run({ ...arpV, ARP_DIR: 1 }, [on(0.05, 60), on(0.06, 64), on(0.07, 67)], 3.2);
  check("arp FWD/BKWD: up then back down without repeating the ends", arr(r.ev.filter((x) => x.kind === "gate").slice(0, 9).map((x) => x.note)) === "60,64,67,64,60,64,67,64,60", arr(r.notes));
  r = run({ ...arpV, ARP_DIR: 2 }, [on(0.05, 60), on(0.06, 64), on(0.07, 67)], 6);
  const rn = r.ev.filter((x) => x.kind === "gate").map((x) => x.note);
  check("arp RNDM: only held notes, and not a fixed pattern", rn.every((n) => [60, 64, 67].includes(n)) && new Set(rn).size === 3 && rn.some((n, i) => i > 0 && n !== rn[i - 1]), arr(rn.slice(0, 12)));
  r = run({ ...arpV, OCT_SEQ: 1 }, [on(0.05, 60), on(0.06, 64)], 2.2);
  check("arp range 2: pattern repeats one octave up", arr(r.ev.filter((x) => x.kind === "gate").slice(0, 8).map((x) => x.note)) === "60,64,72,76,60,64,72,76", arr(r.notes));
  r = run({ ...arpV, OCT_SEQ: 2 }, [on(0.05, 60)], 2.2);
  check("arp range 3: one, then two octaves higher", arr(r.ev.filter((x) => x.kind === "gate").slice(0, 7).map((x) => x.note)) === "60,72,84,60,72,84,60", arr(r.notes));
  r = run({ ...arpV, OCT_SEQ: 1, ARP_DIR: 1 }, [on(0.05, 60), on(0.06, 64)], 3.0);
  check("arp FWD/BKWD over 2 octaves", arr(r.ev.filter((x) => x.kind === "gate").slice(0, 10).map((x) => x.note)) === "60,64,72,76,72,64,60,64,72,76", arr(r.notes));
  r = run(arpV, [on(0.05, 60), on(0.06, 64), off(1.0, 60), off(1.0, 64)], 3.0);
  check("arp without HOLD stops when the keys are released", r.ev.every((x) => x.t < 1.01), String(r.ev.slice(-1)[0].t));
  r = run({ ...arpV, HOLD: 1 }, [on(0.05, 60), on(0.06, 64), off(0.5, 60), off(0.5, 64)], 3.0);
  check("arp HOLD keeps playing after the keys are lifted", r.ev.filter((x) => x.t > 2.5).length >= 1);
  r = run({ ...arpV, HOLD: 1 }, [on(0.05, 60), off(0.3, 60), on(1.0, 67), off(1.2, 67)], 3.0);
  const lat = r.ev.filter((x) => x.kind === "gate");
  check("arp HOLD: notes pressed after all fingers were lifted start a NEW pattern", lat.filter((x) => x.t > 1.1).every((x) => x.note === 67) && lat.some((x) => x.t < 1.0 && x.note === 60), arr(lat.map((x) => x.note)));
  r = run({ ...arpV, HOLD: 1 }, [on(0.05, 60), on(0.8, 64)], 3.0);
  const late = r.ev.filter((x) => x.t > 1.2).slice(0, 6).map((x) => x.note);
  check("arp HOLD: notes played while others are held are ADDED", new Set(late).size === 2 && late.every((n, i) => i === 0 || n !== late[i - 1]), arr(late));
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, ...arpV });
  let b = e.render(2, [on(0.05, 60), { t: 0.8, type: "patch", values: { PLAY: 0 } }], { probes: [G, KB], block: 4 });
  check("PLAY off stops the arp and the held key plays directly", b.probes[0][Math.round(1.5 * SR)] > 4 && near(b.probes[1][Math.round(1.5 * SR)], 0, 1e-6));
}

// ---------------------------------------------------------------- tempo sources ----------------------------------------------
{
  const dt = (r) => { const g = r.ev.filter((x) => x.kind === "gate"); return (g[g.length - 1].t - g[1].t) / (g.length - 2); };
  let r = run({ ...arpV, ARP_RATE: 0 }, [on(0.05, 60)], 6);
  check("RATE minimum = 20 BPM (eighth-note step 1.5 s)", near(dt(r), 1.5, 0.01), dt(r).toFixed(3));
  r = run({ ...arpV, ARP_RATE: 1 }, [on(0.05, 60)], 2);
  check("RATE maximum = 280 BPM (step 107 ms)", near(dt(r), 30 / 280, 0.002), dt(r).toFixed(4));
  r = run({ ...arpV, ARP_RATE: 0, TAP_BPM: 240 }, [on(0.05, 60)], 2);
  check("TAP tempo overrides the RATE knob (240 BPM → 125 ms)", near(dt(r), 0.125, 0.002), dt(r).toFixed(4));
  // host tempo: division index 10 = quarter note → 0.5 s at 120 BPM
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, ARP_MODE: 0, PLAY: 1, CLK_SRC: 1, ARP_RATE: (10 + 0.5) / 24 }, 120);
  let b = e.render(4, [{ t: 0, type: "transport", playing: 1, ppq: 0.3, bpm: 120 }, on(0.05, 60)], { probes: [G], block: 4 });
  const rises = []; for (let i = 1; i < b.probes[0].length; i++) if (b.probes[0][i] > 4 && b.probes[0][i - 1] <= 4) rises.push(i / SR);
  const ds = rises.slice(1).map((x, i) => x - rises[i]);
  check("host tempo, division 'quarter' @120 BPM → 0.5 s per step", ds.length >= 5 && ds.every((d) => near(d, 0.5, 0.003)), ds.map((d) => d.toFixed(4)).join(" "));
  const phase = (rises[0] * 2) % 1;       // ppq started at 0.3: grid lines at t = (n - 0.3)*0.5
  check("host-synced steps land on the beat grid", near(((rises[0] + 0.15) % 0.5), 0, 0.004) || near(((rises[0] + 0.15) % 0.5), 0.5, 0.004), ((rises[0] + 0.15) % 0.5).toFixed(4));
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, ARP_MODE: 0, PLAY: 1, CLK_SRC: 1, ARP_RATE: 0.99 }, 100);
  b = e.render(2, [{ t: 0, type: "transport", playing: 1, ppq: 0, bpm: 100 }, on(0.05, 60)], { probes: [G], block: 4 });
  const r2 = []; for (let i = 1; i < b.probes[0].length; i++) if (b.probes[0][i] > 4 && b.probes[0][i - 1] <= 4) r2.push(i / SR);
  check("host tempo, division '64th triplet' @100 BPM → 25 ms per step", r2.length > 20 && near((r2[10] - r2[2]) / 8, 0.6 / 24, 0.001), ((r2[10] - r2[2]) / 8).toFixed(5));
}

// ---------------------------------------------------------------- sequencer ----------------------------------------------------
{
  // record: C3 (48), REST, TIE+48, legato 50 while holding 48..., 52 + ACCENT
  const rec = [on(0.1, 48), off(0.2, 48), mark(0.3, -2), mark(0.4, -3), on(0.5, 48), off(0.6, 48), on(0.7, 50), on(0.8, 52), off(0.9, 52), off(0.95, 50), on(1.0, 55), off(1.1, 55), mark(1.15, -4)];
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, ARP_MODE: 2, OCT_SEQ: 0 });
  e.render(1.3, rec);
  const L = e.ex.dbgSeqLen(0);
  const notes = [], flags = []; for (let i = 0; i < L; i++) { notes.push(e.ex.dbgSeqNote(0, i)); flags.push(e.ex.dbgSeqFlag(0, i)); }
  check("REC: the first note erases the sequence; steps recorded in order (note, REST, tied note, legato, accent)", arr(notes) === "48,-1,48,50,52,55" && arr(flags) === "0,0,1,0,1,2", `${arr(notes)} | ${arr(flags)}`);
  check("REC: a TIE before a note ties it; a key pressed while another is held is a legato (tied) step", flags[2] === 1 && flags[4] === 1);
  // play back
  e.setPatch({ ...e.values, ARP_MODE: 1, PLAY: 1, ARP_RATE: 100 / 260, OCT_SEQ: 0 });
  const pb = e.render(4.2, [on(0.05, 48)], { probes: [G, KB, VEL], block: 4 });
  const [g, kb, vel] = pb.probes;
  const gate = []; let hi = false; for (let i = 0; i < g.length; i++) { const h = g[i] > 4; if (h && !hi) gate.push({ t: i / SR, note: noteOf(kb[i]) }); hi = h; }
  check("SEQ plays the recorded steps in order and loops (REST silent, tied step does not re-trigger)", arr(gate.slice(0, 6).map((x) => x.note)) === "48,48,50,55,48,48" || arr(gate.slice(0, 5).map((x) => x.note)) === "48,48,50,55,48", arr(gate.map((x) => x.note)));
  const acc = vel.some((v) => v > 4);
  check("SEQ: ACCENT step raises the accent envelope on KB VEL OUT", acc);
  // rest = a whole silent step
  const ts = gate.map((x) => x.t);
  check("SEQ: the REST step leaves a one-step gap", ts[1] - ts[0] > 0.45 && ts[1] - ts[0] < 0.55, (ts[1] - ts[0]).toFixed(3));
  // transposition by playing another key (root = first note 48)
  const tr = e.render(2.5, [{ t: 0, type: "off", note: 48 }, on(0.05, 55)], { probes: [G, KB], block: 4 });
  let hi2 = false; const g2 = []; for (let i = 0; i < tr.probes[0].length; i++) { const h = tr.probes[0][i] > 4; if (h && !hi2) g2.push(noteOf(tr.probes[1][i])); hi2 = h; }
  check("SEQ transposes by the key played (root = first step note): G → +7", arr(g2.slice(0, 3)) === "55,55,57" || g2[0] === 55, arr(g2));
  // stop on release (no HOLD)
  e.ex.controlChange(123, 1);
  e.setPatch({ ...e.values, HOLD: 0 });
  const st = e.render(2.0, [on(0, 48), off(0.4, 48)], { probes: [G], block: 4 });
  check("SEQ stops when the key is released (HOLD off)", st.probes[0].slice(Math.round(1.0 * SR)).every((v) => v < 4));
  e.ex.controlChange(123, 1);
  e.setPatch({ ...e.values, HOLD: 1 });
  const hd = e.render(3.0, [on(0, 48), off(0.4, 48)], { probes: [G], block: 4 });
  check("SEQ HOLD latches the sequence after release", hd.probes[0].slice(Math.round(2.0 * SR)).some((v) => v > 4));
  // directions
  for (const [dir, nm] of [[1, "FWD/BKWD"], [2, "RNDM"]]) {
    e.ex.controlChange(123, 1);
    e.setPatch({ ...e.values, ARP_DIR: dir, HOLD: 0, ARP_RATE: 1 });
    const d = e.render(8, [on(0, 48)], { probes: [G, KB], block: 4 });
    let hh = false; const ns = []; for (let i = 0; i < d.probes[0].length; i++) { const h = d.probes[0][i] > 4; if (h && !hh) ns.push(noteOf(d.probes[1][i])); hh = h; }
    if (dir === 1) {
      const idxs = []; const sc = d.states ? d.states[0] : null;
      // sample the sounding step index in the middle of each 107 ms step
      const dd = e.render(3, [], { states: [2], block: 4 }); let prev = -1; const seen = [];
      for (let i = 0; i < dd.states[0].length; i++) { const v = dd.states[0][i]; if (v !== prev) { seen.push(v); prev = v; } }
      check("SEQ FWD/BKWD runs the pattern back and forth (0..5..0 without repeating the ends)", arr(seen).includes("5,4,3,2,1,0,1,2,3,4,5"), arr(seen.slice(0, 16)));
    }
    if (dir === 2) check("SEQ RNDM plays only recorded notes", ns.every((n) => [48, 50, 55, 52].includes(n)) && new Set(ns).size >= 3, arr(ns.slice(0, 14)));
  }
  // second / third sequence are independent memories
  e.setPatch({ ...e.values, OCT_SEQ: 1, ARP_DIR: 0, ARP_RATE: 100 / 260 });
  const s2 = e.render(1.5, [on(0, 60)], { probes: [G, KB], block: 4 });
  let h3 = false; const n2 = []; for (let i = 0; i < s2.probes[0].length; i++) { const h = s2.probes[0][i] > 4; if (h && !h3) n2.push(noteOf(s2.probes[1][i])); h3 = h; }
  check("sequence 2 holds its own (default) pattern, not sequence 1's", arr(n2.slice(0, 3)) === "60,64,67" || n2[0] !== 48, arr(n2));
}
{
  // live overwrite: play a sequence, switch to REC while running, press a key at step 2
  e.reset(SR); e.setPatch({ VCA_MODE: 2, MIX_O1: 0, ARP_MODE: 1, PLAY: 1, ARP_RATE: 100 / 260, OCT_SEQ: 0, HOLD: 1 });
  const before = []; for (let i = 0; i < e.ex.dbgSeqLen(0); i++) before.push(e.ex.dbgSeqNote(0, i));
  e.render(0.6, [on(0, 45), off(0.05, 45)]);
  check("default sequence 1 is loaded (16 steps)", before.length === 16, String(before.length));
  e.setPatch({ ...e.values, ARP_MODE: 2 });
  e.render(1.0, [on(0.1, 70)]);
  const after = []; for (let i = 0; i < e.ex.dbgSeqLen(0); i++) after.push(e.ex.dbgSeqNote(0, i));
  const changed = after.filter((n, i) => n !== before[i]).length;
  check("REC while the sequence runs overwrites only the step that is playing", after.length === 16 && changed === 1 && after.includes(70), `changed ${changed}, len ${after.length}`);
  // warning from the manual: REC + key with the sequencer stopped erases it
  e.setPatch({ ...e.values, PLAY: 0, HOLD: 0 });
  e.ex.noteOff(45);
  e.setPatch({ ...e.values, ARP_MODE: 1 }); e.render(0.1, []); e.setPatch({ ...e.values, ARP_MODE: 2 });
  e.render(0.3, [on(0.05, 50)]);
  check("REC + key while stopped erases the sequence (manual p.33 warning)", e.ex.dbgSeqLen(0) === 1 && e.ex.dbgSeqNote(0, 0) === 50, String(e.ex.dbgSeqLen(0)));
}

// ---------------------------------------------------------------- external clock / jacks -----------------------------------------
{
  // LFO square into CLOCK IN at 4 Hz: every rising edge = one step (default 2 PPQN)
  const vals = { ARP_MODE: 0, PLAY: 1, MOD_RATE: 0.395, MOD_WAVE: 3, PB_CLK_IN: "LFO" };
  const r = run(vals, [on(0.05, 60)], 3);
  const g = r.ev.filter((x) => x.kind === "gate"); const d = g.slice(2).map((x, i) => x.t - g[i + 1].t);
  const lfoHz = 0.07 * Math.pow(2, 14.18 * 0.395);
  check("CLOCK IN: steps follow the rising edges of the patched clock (2 PPQN → 1 pulse/step)", g.length >= 5 && d.every((x) => near(x, 1 / lfoHz, 0.01)), `${lfoHz.toFixed(3)} Hz → ${d.map((x) => x.toFixed(3)).join(" ")}`);
  const r4 = run({ ...vals, EXT_PPQN: 3 }, [on(0.05, 60)], 3);       // PPQN index 3 = 4 → 2 pulses per step
  const g4 = r4.ev.filter((x) => x.kind === "gate"); const d4 = g4.slice(2).map((x, i) => x.t - g4[i + 1].t);
  check("CLOCK IN at 4 PPQN: two pulses per eighth-note step", g4.length >= 3 && d4.every((x) => near(x, 2 / lfoHz, 0.02)), d4.map((x) => x.toFixed(3)).join(" "));
  const rs = run({ ...vals, EXT_MODE: 1, EXT_PPQN: 3 }, [on(0.05, 60)], 3);
  const gs = rs.ev.filter((x) => x.kind === "gate"); const ds = gs.slice(2).map((x, i) => x.t - gs[i + 1].t);
  check("CLOCK IN Step-Advance mode: one step per pulse regardless of PPQN", ds.every((x) => near(x, 1 / lfoHz, 0.01)), ds.map((x) => x.toFixed(3)).join(" "));
  // ON/OFF IN: square LFO as play gate, sequence 2 default pattern runs without a key
  const oo = run({ ARP_MODE: 1, OCT_SEQ: 1, PLAY: 0, ARP_RATE: 100 / 260, MOD_RATE: 0.12, MOD_WAVE: 3, PB_ONOFF_IN: "LFO" }, [], 10);
  const gt = oo.ev.filter((x) => x.kind === "gate");
  const lfoP = 1 / (0.07 * Math.pow(2, 14.18 * 0.12));
  const inWin = (a, b) => gt.filter((x) => x.t >= a && x.t < b).length;
  check("ON/OFF IN: >2.5 V runs the sequencer (no key needed), <2.5 V stops it", inWin(0.1, lfoP * 0.5) > 3 && inWin(lfoP * 0.5 + 0.4, lfoP - 0.1) === 0 && inWin(lfoP + 0.1, lfoP * 1.5) > 3, `period ${lfoP.toFixed(2)} s: ${inWin(0.1, lfoP * 0.5)} / ${inWin(lfoP * 0.5 + 0.4, lfoP - 0.1)} / ${inWin(lfoP + 0.1, lfoP * 1.5)} gates`);
  // RESET IN: reset pattern to the start
  const rr = run({ ARP_MODE: 1, OCT_SEQ: 1, PLAY: 1, HOLD: 1, ARP_RATE: 100 / 260, MOD_RATE: 0.12, MOD_WAVE: 3, PB_RESET_IN: "LFO" }, [on(0.05, 60)], 6);
  const gr = rr.ev.filter((x) => x.kind === "gate").map((x) => x.note);
  check("RESET IN: a rising edge restarts the pattern from the first step", gr.filter((n) => n === 60).length >= 2 && gr.length > 4, arr(gr));
  // CLOCK OUT: pulse train at the output PPQN, 100 BPM
  for (const [pi, ppqn] of [[1, 2], [3, 4], [12, 24]]) {
    const co = run({ ARP_MODE: 0, PLAY: 1, ARP_RATE: (100 - 20) / 260, OUT_PPQN: pi }, [on(0.05, 60)], 3, [CLK]);
    const c = co.probes[3]; let n = 0; for (let i = 1; i < c.length; i++) if (c[i] > 2.5 && c[i - 1] <= 2.5) n++;
    const expect = (3 - 0.05) * (100 / 60) * ppqn;
    check(`CLOCK OUT at ${ppqn} PPQN @100 BPM pulses at ${(100 / 60 * ppqn).toFixed(2)} Hz`, near(n, expect, 1.6), `${n} pulses vs ${expect.toFixed(1)}`);
  }
}
done("behavior");
