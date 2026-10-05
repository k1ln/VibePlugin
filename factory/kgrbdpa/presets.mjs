// =====================================================================
//  KGrbdPa patch sheets.
//
//  The 14 "PRESETS" sheets printed in the Grandmother manual (pp. 45-51) transcribed: every CABLE is
//  exactly as drawn (output jack → input jack), every switch and the envelope slider as drawn, and
//  every knob read off the drawing to about a clock-hour (K(h) = position of the white dot; 7 o'clock =
//  minimum, 12 o'clock = centre, 5 o'clock = maximum). A handful of readings that the line art leaves
//  ambiguous were chosen so the patch does what its caption says; they are marked "~".
//  Plus a few extras written for this plug-in (sequencer / arpeggiator / sync demos).
//
//  Each patch: { name, cat, note, set } — `set` lists only the differences from the Init sheet.
//  Cables are written as PB_<input jack>: "<output jack key>" (see SRC / DST in params.mjs).
// =====================================================================

const K = (h) => { const a0 = (h % 12) * 30; const a = a0 > 180 ? a0 - 360 : a0; return Math.max(0, Math.min(1, 0.5 + a / 300)); };
const B = (h) => (K(h) - 0.5) * 2;                     // bipolar knob value for a clock position
// switch positions
const O1 = { "32'": 0, "16'": 1, "8'": 2, "4'": 3 };
const O2 = { "16'": 0, "8'": 1, "4'": 2, "2'": 3 };
const WV = { tri: 0, saw: 1, sqr: 2, nar: 3 };
const LW = { sine: 0, saw: 1, ramp: 2, sqr: 3 };
const TRK = { "1:2": 0, off: 1, "1:1": 2 };
const VCA = { env: 0, kbrls: 1, drone: 2 };

export const INIT = { name: "Init", cat: "Init", note: "Blank sheet: both oscillators on a saw, filter half open.", set: {} };

export const BANK = [
  { name: "Funky Robot", cat: "Manual patch sheets", note: "Mod wheel up adds a robot voice. KB OUT → RATE IN makes the LFO play at audio rate, tracking the keyboard; the (closed) filter's CUTOFF AMT then turns it into a vocal buzz.",
    set: { PB_LFO_RATE: "KB", MOD_RATE: K(3), MOD_PITCH: 0.03, MOD_CUT: K(4.5), MOD_PW: 0, MOD_WAVE: LW.saw,
      O1_OCT: O1["16'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(12.3), MIX_O2: K(10), MIX_NZ: 0, HP_CUT: 0.05, ATT: 0,
      CUTOFF: 0.12, KBD_TRK: TRK["1:2"], ENV_AMT: B(4), RESO: K(12), ATK: K(11.5), DEC: K(9), SUS: 0.43, REL: K(12),
      VCA_MODE: VCA.drone, VOLUME: K(12.5), REV_MIX: K(8) } },

  { name: "Showdown Guitar", cat: "Manual patch sheets", note: "Mod wheel adds more motion; the attenuator controls the tremolo amount. MOD WAVE OUT → ATTENUATOR → VCA AMT IN is the tremolo.",
    set: { PB_ATT_IN: "LFO", PB_V_AMT: "ATT", OCT_SEQ: 1, MOD_RATE: K(12), MOD_PITCH: 0.1, MOD_CUT: 0.2, MOD_PW: 0.3, MOD_WAVE: LW.sine,
      O1_OCT: O1["8'"], O1_WAVE: WV.sqr, O2_OCT: O2["8'"], O2_WAVE: WV.nar, O2_FREQ: 0,
      MIX_O1: K(12.4), MIX_O2: K(11), MIX_NZ: 0.05, HP_CUT: 0.05, ATT: B(1.5),
      CUTOFF: K(12.3), KBD_TRK: TRK["1:2"], ENV_AMT: B(2), RESO: 0.08, ATK: K(11.5), DEC: K(12), SUS: 0.27, REL: K(3.2),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: K(10) } },

  { name: "Dynasty Plucks", cat: "Manual patch sheets", note: "KB RLS keeps the VCA open while the key is down; the pluck comes from the filter envelope (decay, no sustain).",
    set: { OCT_SEQ: 1, MOD_RATE: K(12), MOD_PITCH: 0.05, MOD_CUT: 0.1, MOD_PW: K(4.8), MOD_WAVE: LW.sine,
      O1_OCT: O1["4'"], O1_WAVE: WV.saw, O2_OCT: O2["4'"], O2_WAVE: WV.sqr, O2_FREQ: 0,
      MIX_O1: K(12), MIX_O2: 0.1, MIX_NZ: 0.3, HP_CUT: 0.07, ATT: 0,
      CUTOFF: 0.27, KBD_TRK: TRK["1:2"], ENV_AMT: 0.75, RESO: K(9), ATK: K(7.4), DEC: K(10.4), SUS: 0.05, REL: 0.3,   // ~ cutoff / env depth a touch higher than read: the sheet says "plucks"
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: K(1) } },

  { name: "Haunted Cave", cat: "Manual patch sheets", note: "KB OUT → RATE IN: the LFO follows the keyboard. Resonance high, keyboard tracking 1:1 — the filter rings along with the notes.",
    set: { PB_LFO_RATE: "KB", ARP_DIR: 2, OCT_SEQ: 1, MOD_RATE: K(12), MOD_PITCH: 0.05, MOD_CUT: K(4), MOD_PW: 0, MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.sqr, O2_OCT: O2["8'"], O2_WAVE: WV.nar, O2_FREQ: 0,
      MIX_O1: 0.3, MIX_O2: 0.3, MIX_NZ: 0.1, HP_CUT: 0.07, ATT: 0,
      CUTOFF: K(9.5), KBD_TRK: TRK["1:1"], ENV_AMT: B(12.2), RESO: 0.83, ATK: K(7.4), DEC: K(7.3), SUS: 0.05, REL: 0.5,
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: K(10) } },

  { name: "Ultra Sub Bass", cat: "Manual patch sheets", note: "Mod wheel adds gentle motion (cutoff). 32' triangle with a 16' under it.",
    set: { MOD_RATE: K(9), MOD_PITCH: 0.03, MOD_CUT: K(12), MOD_PW: 0, MOD_WAVE: LW.sine,
      O1_OCT: O1["32'"], O1_WAVE: WV.tri, O2_OCT: O2["16'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(4.3), MIX_O2: 0.07, MIX_NZ: 0, HP_CUT: 0.07, ATT: 0,
      CUTOFF: K(12), KBD_TRK: TRK["1:2"], ENV_AMT: B(12), RESO: 0.03, ATK: K(7.4), DEC: K(7.5), SUS: 0.2, REL: K(1.2),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: 0.05 } },

  { name: "Cavern Strings", cat: "Manual patch sheets", note: "VCO 2 → HIGH PASS → MIXER OSC 2 IN shapes oscillator 2 independently of oscillator 1 (the manual's utilities tip). The other cables are the normalled connections drawn explicitly. Big reverb; PW AMT + mod wheel = string ensemble PWM.",
    set: { PB_HP_IN: "O2", PB_MX_O2: "HP", PB_MX_O1: "O1", PB_F_IN: "MIX", PB_V_IN: "FIL", MOD_RATE: K(9.5), MOD_PITCH: 0.15, MOD_CUT: 0.15, MOD_PW: K(12), MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.sqr, O2_OCT: O2["4'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(2.5), MIX_O2: K(9), MIX_NZ: 0.03, HP_CUT: 0.45, ATT: 0,
      CUTOFF: 0.45, KBD_TRK: TRK["1:2"], ENV_AMT: B(2), RESO: 0.03, ATK: K(1), DEC: K(12), SUS: 0.4, REL: K(11),
      VCA_MODE: VCA.env, VOLUME: K(12), REV_MIX: 0.95 } },

  { name: "J-Bass", cat: "Manual patch sheets", note: "MIXER OUTPUT → HIGH PASS → FILTER INPUT: the high pass trims the low-end weight ahead of the ladder (manual p.15 / p.17 tips).",
    set: { PB_HP_IN: "MIX", PB_F_IN: "HP", MOD_RATE: K(12), MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: 0, MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.sqr, O2_OCT: O2["8'"], O2_WAVE: WV.nar, O2_FREQ: 0,
      MIX_O1: K(4.3), MIX_O2: 0.07, MIX_NZ: 0.15, HP_CUT: K(10), ATT: 0,    // ~ HP / CUTOFF raised a little: as drawn they leave almost nothing of a 16' bass
      CUTOFF: K(1), KBD_TRK: TRK.off, ENV_AMT: 0.25, RESO: 0.05, ATK: K(7.4), DEC: K(10.5), SUS: 0.05, REL: K(10.5),
      VCA_MODE: VCA.env, VOLUME: K(12), REV_MIX: K(9) } },

  { name: "Auto Zap Bass", cat: "Manual patch sheets", note: "VCO 2 → ATTENUATOR → ENV AMT IN: the second oscillator modulates the filter-envelope depth, so every note zaps. Turn the attenuator to taste.",
    set: { PB_ATT_IN: "O2", PB_F_ENVAMT: "ATT", MOD_RATE: K(12), MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: 0, MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.sqr, O2_OCT: O2["16'"], O2_WAVE: WV.tri, O2_FREQ: 0.75,
      MIX_O1: K(4.3), MIX_O2: 0, MIX_NZ: 0.03, HP_CUT: K(11.5), ATT: 0.6,
      CUTOFF: K(11.4), KBD_TRK: TRK["1:1"], ENV_AMT: B(2), RESO: K(12), ATK: K(7.2), DEC: K(10.5), SUS: 0.05, REL: K(10),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: K(8.5) } },

  { name: "Stepped Drone", cat: "Manual patch sheets", note: "Mod wheel up! MOD S/H OUT → ATTENUATOR → MULT → OSC 2 PITCH IN and FILTER CUTOFF IN, with SYNC on and the VCA on DRONE: a random stepped pitch / filter pattern.",
    set: { PB_ATT_IN: "SH", PB_MULT_A: "ATT", PB_O2_PITCH: "MULT", PB_F_CUT: "MULT", SYNC: 1, MOD_RATE: K(12.5), MOD_PITCH: 0.05, MOD_CUT: K(1), MOD_PW: K(12), MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.saw, O2_OCT: O2["4'"], O2_WAVE: WV.saw, O2_FREQ: B(10),
      MIX_O1: K(11), MIX_O2: K(10.5), MIX_NZ: 0.1, HP_CUT: K(12), ATT: 0.7,
      CUTOFF: K(2), KBD_TRK: TRK.off, ENV_AMT: B(12.3), RESO: 0.05, ATK: K(7.4), DEC: K(1), SUS: 0.04, REL: K(12),
      VCA_MODE: VCA.drone, VOLUME: K(12), REV_MIX: K(11.5) } },

  { name: "Cyclical Patterns", cat: "Manual patch sheets", note: "MIXER OUTPUT → HIGH PASS → MIXER NOISE IN: a feedback loop around the mixer; the NOISE and HIGH PASS knobs sweep it (arrows on the sheet). Arpeggiator armed — hold a chord.",
    set: { PB_HP_IN: "MIX", PB_MX_NZ: "HP", PLAY: 1, MOD_RATE: K(12), MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: 0, MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(12), MIX_O2: 0.07, MIX_NZ: K(3.5), HP_CUT: K(12), ATT: 0,
      CUTOFF: K(11), KBD_TRK: TRK["1:2"], ENV_AMT: B(2), RESO: 0.03, ATK: K(7.4), DEC: K(7.4), SUS: 0.53, REL: K(8),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: 0.05 } },

  { name: "Bag Pipes", cat: "Manual patch sheets", note: "MIXER OUTPUT → MULT → FILTER INPUT and HIGH PASS → ATTENUATOR → MIXER NOISE IN: the mix is fed back through the high pass. Raise the attenuator for a droning, reedy resonance.",
    set: { PB_MULT_A: "MIX", PB_F_IN: "MULT", PB_HP_IN: "MULT", PB_ATT_IN: "HP", PB_MX_NZ: "ATT", MOD_RATE: K(12), MOD_PITCH: 0.1, MOD_CUT: K(12), MOD_PW: K(12), MOD_WAVE: LW.sqr,
      O1_OCT: O1["8'"], O1_WAVE: WV.nar, O2_OCT: O2["4'"], O2_WAVE: WV.sqr, O2_FREQ: 0,
      MIX_O1: 0.55, MIX_O2: K(4.3), MIX_NZ: K(4.3), HP_CUT: K(12), ATT: 0.5,
      CUTOFF: K(1.4), KBD_TRK: TRK["1:1"], ENV_AMT: B(12), RESO: K(12.5), ATK: K(7.4), DEC: K(10.4), SUS: 0.07, REL: K(11.5),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: K(9) } },

  { name: "Piano Bass", cat: "Manual patch sheets", note: "MIXER OUTPUT → HIGH PASS → MIXER NOISE IN: feedback through the high pass thickens the attack. Sweep HIGH PASS (arrow) while playing.",
    set: { PB_HP_IN: "MIX", PB_MX_NZ: "HP", MOD_RATE: K(11), MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: K(12), MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(12), MIX_O2: K(11), MIX_NZ: K(4.4), HP_CUT: K(12.7), ATT: 0,
      CUTOFF: K(9.5), KBD_TRK: TRK.off, ENV_AMT: B(2), RESO: 0.05, ATK: K(7.4), DEC: K(10.4), SUS: 0.45, REL: K(10.4),
      VCA_MODE: VCA.kbrls, VOLUME: K(12), REV_MIX: 0.05 } },

  { name: "Lift Off", cat: "Manual patch sheets", note: "- ENV OUT → ATTENUATOR → OSC 2 PITCH IN with SYNC on: the slave oscillator sweeps with the envelope — a rising / falling sync lead.",
    set: { PB_ATT_IN: "ENVN", PB_O2_PITCH: "ATT", SYNC: 1, MOD_RATE: K(11), MOD_PITCH: 0.05, MOD_CUT: 0.1, MOD_PW: K(12.5), MOD_WAVE: LW.sine,
      O1_OCT: O1["16'"], O1_WAVE: WV.sqr, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(11.5), MIX_O2: K(1), MIX_NZ: K(12.5), HP_CUT: K(11.5), ATT: 0.3,
      CUTOFF: K(9), KBD_TRK: TRK["1:1"], ENV_AMT: B(4.8), RESO: 0.05, ATK: K(1.5), DEC: K(3), SUS: 0.1, REL: K(5),
      VCA_MODE: VCA.env, VOLUME: K(12), REV_MIX: K(12) } },

  { name: "3 Saws", cat: "Manual patch sheets", note: "KB OUT → RATE IN and MOD WAVE OUT → MIXER NOISE IN: the modulation oscillator becomes a third, keyboard-tracking sawtooth. Tune it with RATE.",
    set: { PB_LFO_RATE: "KB", PB_MX_NZ: "LFO", MOD_RATE: K(3), MOD_PITCH: 0, MOD_CUT: 0, MOD_PW: 0, MOD_WAVE: LW.saw,
      O1_OCT: O1["16'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0,
      MIX_O1: K(11.5), MIX_O2: K(11.5), MIX_NZ: K(12), HP_CUT: K(12), ATT: 0,
      CUTOFF: K(4.4), KBD_TRK: TRK.off, ENV_AMT: B(12), RESO: 0.05, ATK: K(7.4), DEC: K(7.4), SUS: 1, REL: K(7.4),
      VCA_MODE: VCA.env, VOLUME: K(12), REV_MIX: 0.05 } },
];

// ---- extras written for the plug-in (not from the manual) ----------------------------------
export const EXTRAS = [
  { name: "Acid Sequence", cat: "Plug-in extras", note: "Sequence 1 (the stored acid line): press PLAY, hold a key — the key transposes the pattern (root = first step, A2). Legato glide gives the slide; accented steps (KB VEL OUT = accent envelope → ATTENUATOR → CUTOFF IN) open the filter.",
    set: { ARP_MODE: 1, OCT_SEQ: 0, PLAY: 1, HOLD: 1, ARP_RATE: (124 - 20) / 260, GLIDE: 0.45, GL_TYPE: 0, GL_LEGATO: 1,
      O1_OCT: O1["8'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0.04, MIX_O1: 0.6, MIX_O2: 0.5,
      CUTOFF: 0.4, RESO: 0.62, ENV_AMT: 0.55, DEC: 0.34, SUS: 0.0, ATK: 0.02, REL: 0.28, KBD_TRK: TRK["1:2"], VCA_MODE: VCA.kbrls,
      PB_ATT_IN: "VEL", PB_F_CUT: "ATT", ATT: 0.3, REV_MIX: 0.12, VOLUME: 0.7 } },
  { name: "Arp Pad", cat: "Plug-in extras", note: "Arpeggiator FWD/BKWD over 2 octaves, tempo-synced to the host (RATE picks the note division), long spring reverb.",
    set: { ARP_MODE: 0, ARP_DIR: 1, OCT_SEQ: 1, PLAY: 1, CLK_SRC: 1, ARP_RATE: 13.5 / 24,
      O1_OCT: O1["8'"], O1_WAVE: WV.sqr, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0.06, MIX_O1: 0.5, MIX_O2: 0.5,
      CUTOFF: 0.55, RESO: 0.25, ENV_AMT: 0.3, ATK: 0.1, DEC: 0.45, SUS: 0.35, REL: 0.55, VCA_MODE: VCA.env, MOD_RATE: 0.3, MOD_PW: 0.7, MODW: 0,
      REV_MIX: 0.55, VOLUME: 0.7 } },
  { name: "Sync Sweep Lead", cat: "Plug-in extras", note: "Hard sync with LFO sweeping the slave's pitch (mod wheel × PITCH AMT) — the classic ripping sync lead.",
    set: { SYNC: 1, O1_OCT: O1["8'"], O1_WAVE: WV.saw, O2_OCT: O2["8'"], O2_WAVE: WV.saw, O2_FREQ: 0.35, MIX_O1: 0.2, MIX_O2: 0.7,
      CUTOFF: 0.72, RESO: 0.2, ENV_AMT: 0.2, ATK: 0.04, DEC: 0.5, SUS: 0.7, REL: 0.35, GLIDE: 0.2, GL_LEGATO: 1, MOD_RATE: 0.28, MOD_WAVE: LW.sine,
      MOD_PITCH: 0.6, VCA_MODE: VCA.env, REV_MIX: 0.2, VOLUME: 0.7 } },
];

// loudness trim per patch (tests/tune-levels.mjs → presets.levels.json): the sheets all say "VOLUME at 12 o'clock"
// but their sound sources differ by 20+ dB
import { readFileSync, existsSync } from "node:fs";
const lvPath = new URL("./presets.levels.json", import.meta.url);
const levels = existsSync(lvPath) ? JSON.parse(readFileSync(lvPath, "utf8")) : {};
export const PRESETS = [INIT, ...BANK, ...EXTRAS].map((p) => (levels[p.name] ? { ...p, set: { ...p.set, ...levels[p.name] } } : p));
const names = new Set();
for (const p of PRESETS) { if (names.has(p.name)) throw new Error("duplicate preset " + p.name); names.add(p.name); }
