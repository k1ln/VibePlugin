// =====================================================================
//  Doob factory sounds — the classic Minimoog Model D repertoire, set with the original's controls.
//
//  Each patch: { name, cat, note, set } — `set` lists the differences from the Init sheet (the defaults in params.mjs).
//  Helpers write values the way the panel reads: K(k) = CUTOFF knob in panel units (-5 … +5), D(x) = a 0-10 dial,
//  T(sec, max) = the knob position that gives `sec` seconds on a contour pot (audio taper, max 9 / 14 / 30 s).
// =====================================================================
const K = (k) => (k + 5) / 10;
const D = (x) => x / 10;
const taper = (x) => (Math.exp(4.39 * x) - 1) / (Math.exp(4.39) - 1);
const T = (s, max = 30) => { const f = Math.min(1, Math.max(0, (s - 0.001) / (max - 0.001))); return Math.log(1 + f * (Math.exp(4.39) - 1)) / 4.39; };
const FA = (s) => T(s, 9), FD = (s) => T(s, 30), LA = (s) => T(s, 14), LD = (s) => T(s, 30);
const R = { LO: 0, "32'": 1, "16'": 2, "8'": 3, "4'": 4, "2'": 5 };
const W = { tri: 0, shark: 1, saw: 2, sqr: 3, wide: 4, nar: 5, rev: 1 };
const FQ = (st) => st / 7;                    // oscillator FREQUENCY knob (±7 semitones) from semitones
const VIB = { O3_CTRL: 0, O3_RANGE: R.LO, O3_WAVE: W.tri, O3_FREQ: 0.34, OSC_MOD: 1, MODW: 0.22, MODMIX: 0 };   // ~5.5 Hz triangle vibrato under the wheel

export const INIT = { name: "Init", cat: "Init", note: "The panel as it powers up: oscillator 1 on a sawtooth at 8', filter half open, loudness contour at full sustain.", set: {} };

export const BANK = [
  // ---------------------------------------------------------------- basses
  { name: "Moog Bass", cat: "Basses", note: "THE Minimoog bass: two oscillators at 16' (saw + square, a hair apart), filter nearly closed, contour opens it for a fat 'womp'. Keyboard control 1 keeps it round up the keys.",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.saw, O2_RANGE: R["16'"], O2_WAVE: W.sqr, O2_FREQ: FQ(0.12), SW_O2: 1, VOL1: D(8), VOL2: D(7), CUTOFF: K(-3), EMPH: D(2.5), CONTOUR: D(5.5), FATK: FA(0.002), FDEC: FD(0.45), FSUS: D(1.2), LATK: LA(0.002), LDEC: LD(0.6), LSUS: D(8), KB1: 1, OUTVOL: D(7) } },
  { name: "Sub Bass 32'", cat: "Basses", note: "Triangle at 32' under a 16' sawtooth: all weight, almost no filter work. Low-note priority keeps it solid on overlaps.",
    set: { O1_RANGE: R["32'"], O1_WAVE: W.tri, O2_RANGE: R["16'"], O2_WAVE: W.saw, SW_O2: 1, VOL1: D(9), VOL2: D(3.5), CUTOFF: K(-1.5), EMPH: D(1), CONTOUR: D(3), FDEC: FD(0.3), FSUS: D(3), LDEC: LD(0.5), LSUS: D(9), KB1: 1 } },
  { name: "Funk Bass", cat: "Basses", note: "Wide-pulse 16' with a snappy filter envelope (decay 0.2 s, sustain 0): the squelchy slap of '70s funk.",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.wide, O2_RANGE: R["16'"], O2_WAVE: W.saw, O2_FREQ: FQ(-0.1), SW_O2: 1, VOL1: D(8), VOL2: D(5), CUTOFF: K(-3.5), EMPH: D(4.5), CONTOUR: D(7), FATK: FA(0.001), FDEC: FD(0.22), FSUS: 0, LATK: LA(0.001), LDEC: LD(0.35), LSUS: D(6), KB1: 1, KB2: 0 } },
  { name: "Taurus Pedal", cat: "Basses", note: "Shark-tooth at 32' + saw 16': the cathedral-pedal bass; long decay with the DECAY switch for a held release.",
    set: { O1_RANGE: R["32'"], O1_WAVE: W.shark, O2_RANGE: R["32'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.08), SW_O2: 1, VOL1: D(8), VOL2: D(6), CUTOFF: K(-2.5), EMPH: D(3), CONTOUR: D(3.5), FDEC: FD(1.2), FSUS: D(4), LDEC: LD(1.4), LSUS: D(8), DECAY_ON: 1 } },
  { name: "Acid Squelch", cat: "Basses", note: "Emphasis well into the resonant range, glide on: a sliding, squelching line. Play legato for the slides (single trigger).",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.saw, VOL1: D(8), CUTOFF: K(-3.2), EMPH: D(6.8), CONTOUR: D(6), FDEC: FD(0.28), FSUS: D(0.5), LDEC: LD(0.4), LSUS: D(8), GLIDE_ON: 1, GLIDE: D(2.2), KB1: 1 } },
  { name: "Wobble (LFO)", cat: "Basses", note: "Reissue LFO into the filter: raise the MOD wheel and the saw bass wobbles. Rate on the Global dialog (or CC1 on a controller).",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.saw, O2_RANGE: R["16'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.1), SW_O2: 1, VOL1: D(7), VOL2: D(6), CUTOFF: K(-2.5), EMPH: D(5), CONTOUR: D(1), FIL_MOD: 1, MOD_B: 1, MODMIX: 1, MODW: 0.5, LFO_RATE: 0.55, LFO_WAVE: 0, KB1: 1 } },
  // ---------------------------------------------------------------- leads
  { name: "Fat Unison Lead", cat: "Leads", note: "Three sawtooth oscillators a few cents apart: the cornerstone Minimoog lead. Mixer pushed into overload for the fatness. Wheel adds slow vibrato.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.1), O3_RANGE: R["8'"], O3_WAVE: W.saw, O3_FREQ: FQ(-0.12), SW_O2: 1, SW_O3: 1, VOL1: D(7.5), VOL2: D(7.5), VOL3: D(7.5), CUTOFF: K(1), EMPH: D(3.5), CONTOUR: D(3), FATK: FA(0.01), FDEC: FD(0.7), FSUS: D(5), LATK: LA(0.005), LDEC: LD(0.5), LSUS: D(10), KB1: 1, KB2: 1, GLIDE_ON: 1, GLIDE: D(1.6), OSC_MOD: 1, O3_CTRL: 1 } },
  { name: "Emerson Lead", cat: "Leads", note: "Three saws, portamento, filter around +2 with emphasis: the soaring '70s prog lead. Pitch wheel half an octave for the swoops.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.07), O3_RANGE: R["8'"], O3_WAVE: W.shark, O3_FREQ: FQ(-0.07), SW_O2: 1, SW_O3: 1, VOL1: D(7), VOL2: D(7), VOL3: D(6), CUTOFF: K(1.8), EMPH: D(4), CONTOUR: D(2), FDEC: FD(0.5), FSUS: D(6), LSUS: D(10), GLIDE_ON: 1, GLIDE: D(2.4), KB1: 1, KB2: 1, BEND: 7 } },
  { name: "Singing Square Lead", cat: "Leads", note: "Square + octave-up saw, emphasis high: a vocal, nasal lead. Vibrato on the wheel (oscillator 3 in LO, detached from the keys).",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.sqr, O2_RANGE: R["4'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.05), SW_O2: 1, VOL1: D(8), VOL2: D(4), CUTOFF: K(0.8), EMPH: D(5.5), CONTOUR: D(3.5), FDEC: FD(0.4), FSUS: D(4), LSUS: D(10), KB1: 1, ...VIB } },
  { name: "Power Fifths", cat: "Leads", note: "Oscillator 2 a perfect fifth above (+7 semitones on its FREQUENCY knob): two-note power lead.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: 1, SW_O2: 1, VOL1: D(7), VOL2: D(6.5), CUTOFF: K(1.2), EMPH: D(2.5), CONTOUR: D(3), FDEC: FD(0.6), FSUS: D(6), LSUS: D(10), KB1: 1, KB2: 1 } },
  { name: "Soft Triangle Lead", cat: "Leads", note: "Triangles an octave apart through a half-open filter: round and flute-like. Slow vibrato.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.tri, O2_RANGE: R["4'"], O2_WAVE: W.tri, SW_O2: 1, VOL1: D(8), VOL2: D(4), CUTOFF: K(0), EMPH: D(1.5), CONTOUR: D(1.5), FSUS: D(8), LATK: LA(0.04), LSUS: D(10), ...VIB, MODW: 0.18 } },
  // ---------------------------------------------------------------- brass / pads / strings
  { name: "Brass Section", cat: "Pads & Strings", note: "Slow-ish filter attack (0.15 s) opens a sawtooth stack — the classic analog brass swell. Octave bend: wheel.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.1), O3_RANGE: R["8'"], O3_WAVE: W.saw, O3_FREQ: FQ(-0.1), SW_O2: 1, SW_O3: 1, VOL1: D(6.5), VOL2: D(6.5), VOL3: D(6.5), CUTOFF: K(-1), EMPH: D(2), CONTOUR: D(4.5), FATK: FA(0.16), FDEC: FD(0.7), FSUS: D(6), LATK: LA(0.07), LDEC: LD(0.8), LSUS: D(9), KB1: 1, KB2: 1 } },
  { name: "String Ensemble", cat: "Pads & Strings", note: "Detuned saws, slow attack and a long DECAY-switch release, slow vibrato: lush analog strings.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.18), O3_RANGE: R["4'"], O3_WAVE: W.saw, O3_FREQ: FQ(-0.15), SW_O2: 1, SW_O3: 1, VOL1: D(5.5), VOL2: D(5.5), VOL3: D(4), CUTOFF: K(0), EMPH: D(1), CONTOUR: D(2), FATK: FA(0.5), FDEC: FD(1.2), FSUS: D(7), LATK: LA(0.45), LDEC: LD(1.0), LSUS: D(10), DECAY_ON: 1, KB1: 1, KB2: 1, DRIFT: 0.45, ...VIB, MODW: 0.16 } },
  { name: "Warm Pad", cat: "Pads & Strings", note: "Square and saw an octave apart, filter slowly swelling, pulse-width flavour from the wide rectangular wave.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.wide, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(-0.12), SW_O2: 1, VOL1: D(6), VOL2: D(5), CUTOFF: K(-1.5), EMPH: D(2.5), CONTOUR: D(3), FATK: FA(1.6), FDEC: FD(2.5), FSUS: D(6), LATK: LA(1.0), LDEC: LD(2), LSUS: D(10), DECAY_ON: 1, KB1: 1, KB2: 0, DRIFT: 0.5 } },
  { name: "Flute", cat: "Pads & Strings", note: "Triangle at 4' with a touch of pink noise for the breath, gentle attack.",
    set: { O1_RANGE: R["4'"], O1_WAVE: W.tri, VOL1: D(8), SW_NZ: 1, VOLNZ: D(0.7), NZ_COLOR: 1, CUTOFF: K(0.2), EMPH: D(1.5), CONTOUR: D(1.8), FATK: FA(0.07), FDEC: FD(0.3), FSUS: D(8), LATK: LA(0.08), LDEC: LD(0.3), LSUS: D(9), KB1: 1, KB2: 1, ...VIB, MODW: 0.14, O3_FREQ: 0.4 } },
  // ---------------------------------------------------------------- keys & plucks
  { name: "Organ (8-4-2)", cat: "Keys & Plucks", note: "Square waves at 8', 4' and 2' mixed like drawbars; wide-open filter, no envelope on the filter.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.sqr, O2_RANGE: R["4'"], O2_WAVE: W.sqr, O3_RANGE: R["2'"], O3_WAVE: W.sqr, SW_O2: 1, SW_O3: 1, VOL1: D(6), VOL2: D(4.5), VOL3: D(3), CUTOFF: K(1), EMPH: 0, CONTOUR: 0, LATK: LA(0.002), LDEC: LD(0.1), LSUS: D(10), KB1: 1, KB2: 1, DECAY_ON: 0 } },
  { name: "Clav Pluck", cat: "Keys & Plucks", note: "Narrow pulse, filter envelope with no sustain and keyboard tracking: a funky clavinet-style pluck.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.nar, O2_RANGE: R["8'"], O2_WAVE: W.nar, O2_FREQ: FQ(0.06), SW_O2: 1, VOL1: D(7), VOL2: D(5), CUTOFF: K(-1.5), EMPH: D(3), CONTOUR: D(5.5), FATK: FA(0.001), FDEC: FD(0.18), FSUS: 0, LDEC: LD(0.28), LSUS: D(2), KB1: 1, KB2: 1 } },
  { name: "Harpsichord", cat: "Keys & Plucks", note: "Narrow pulses an octave apart with a very quick decay and plenty of tracking.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.nar, O2_RANGE: R["4'"], O2_WAVE: W.nar, SW_O2: 1, VOL1: D(6), VOL2: D(5), CUTOFF: K(0.5), EMPH: D(1.5), CONTOUR: D(3), FATK: FA(0.001), FDEC: FD(0.12), FSUS: 0, LDEC: LD(0.2), LSUS: D(1), KB1: 1, KB2: 1 } },
  { name: "Pizzicato", cat: "Keys & Plucks", note: "Triangle + saw, both contours with short decays and zero sustain: a plucked-string stab.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.shark, O2_RANGE: R["8'"], O2_WAVE: W.tri, O2_FREQ: FQ(0.1), SW_O2: 1, VOL1: D(7), VOL2: D(4), CUTOFF: K(-1.8), EMPH: D(2), CONTOUR: D(5), FDEC: FD(0.2), FSUS: 0, LDEC: LD(0.25), LSUS: 0, KB1: 1, KB2: 1 } },
  { name: "Mellow Electric Piano", cat: "Keys & Plucks", note: "Triangles with a bell-like 2' partial and a soft filter envelope.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.tri, O2_RANGE: R["2'"], O2_WAVE: W.sqr, O2_FREQ: FQ(0.03), SW_O2: 1, VOL1: D(8), VOL2: D(1.6), CUTOFF: K(-1), EMPH: D(1), CONTOUR: D(3), FDEC: FD(0.5), FSUS: D(1), LDEC: LD(1.2), LSUS: D(1.5), KB1: 1, KB2: 1 } },
  // ---------------------------------------------------------------- effects & drones
  { name: "Filter Sine", cat: "Effects & Drones", note: "No oscillators: EMPHASIS at 10 makes the filter oscillate, and with both keyboard-control switches on it plays as a pure, tuned sine wave (the Minimoog's 'sixth sound source').",
    set: { SW_O1: 0, EMPH: 1, CUTOFF: K(-1), CONTOUR: 0, KB1: 1, KB2: 1, LSUS: D(10), LATK: LA(0.01), LDEC: LD(0.2), OUTVOL: D(7) } },
  { name: "Resonant Kick", cat: "Effects & Drones", note: "The self-oscillating filter swept down by its contour: an analog kick drum. Play a low key.",
    set: { SW_O1: 0, SW_NZ: 1, VOLNZ: D(0.4), EMPH: D(10), CUTOFF: K(-4), CONTOUR: D(5), FATK: FA(0.001), FDEC: FD(0.12), FSUS: 0, LATK: LA(0.001), LDEC: LD(0.3), LSUS: 0, KB1: 0, KB2: 0, OUTVOL: D(8) } },
  { name: "Laser Zap", cat: "Effects & Drones", note: "High saw through a resonant filter whose contour sweeps down in a quarter-second.",
    set: { O1_RANGE: R["4'"], O1_WAVE: W.saw, VOL1: D(6), CUTOFF: K(-2), EMPH: D(8), CONTOUR: D(9), FATK: FA(0.001), FDEC: FD(0.28), FSUS: 0, LDEC: LD(0.45), LSUS: D(1), KB1: 0 } },
  { name: "Wind", cat: "Effects & Drones", note: "White noise through a resonant band; the wheel brings in random filter modulation. Slow attack and release.",
    set: { SW_O1: 0, SW_NZ: 1, VOLNZ: D(8), NZ_COLOR: 0, CUTOFF: K(0), EMPH: D(5), CONTOUR: D(1.5), FATK: FA(1.5), FDEC: FD(3), FSUS: D(6), LATK: LA(1.5), LDEC: LD(3), LSUS: D(10), DECAY_ON: 1, FIL_MOD: 1, MODMIX: 1, MODW: 0.55, KB1: 1, KB2: 0 } },
  { name: "Snare Noise", cat: "Effects & Drones", note: "Noise burst with a short filter contour plus a low triangle thump.",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.tri, VOL1: D(4), SW_NZ: 1, VOLNZ: D(8), CUTOFF: K(1.5), EMPH: D(2), CONTOUR: D(4), FDEC: FD(0.12), FSUS: 0, LDEC: LD(0.22), LSUS: 0, KB1: 0 } },
  { name: "Random Burble", cat: "Effects & Drones", note: "Noise into the filter cutoff (MOD wheel up): the classic sample-and-hold-style burble. Keys sound a 4-pulse tone.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.wide, VOL1: D(7), CUTOFF: K(-0.5), EMPH: D(6), CONTOUR: 0, FIL_MOD: 1, MODMIX: 1, MODW: 0.6, LSUS: D(10) } },
  { name: "Oscillator 3 Drone", cat: "Effects & Drones", note: "S-TRIG plug in: the contours stay open, and the free-running oscillators drone. Play keys to shift osc 1+2 while oscillator 3 hums on its own.",
    set: { STRIG: 1, O1_RANGE: R["16'"], O1_WAVE: W.saw, O2_RANGE: R["16'"], O2_WAVE: W.tri, O2_FREQ: FQ(0.2), SW_O2: 1, O3_CTRL: 0, O3_RANGE: R["32'"], O3_WAVE: W.shark, O3_FREQ: 0.4, SW_O3: 1, VOL1: D(5), VOL2: D(5), VOL3: D(6), CUTOFF: K(-1), EMPH: D(4), CONTOUR: 0, DRIFT: 0.7, BLEED: 0.4, LSUS: D(9) } },
  { name: "Feedback Growl", cat: "Effects & Drones", note: "OUTPUT → EXTERNAL IN feedback (the famous Minimoog mod): the output re-enters the mixer through the overloading preamp for a snarling, gritty edge.",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.saw, VOL1: D(5), SW_EXT: 1, VOLEXT: D(4), FEEDBACK: 1, CUTOFF: K(-1.5), EMPH: D(3), CONTOUR: D(4), FDEC: FD(0.6), FSUS: D(3), LDEC: LD(0.6), LSUS: D(8), OUTVOL: D(6) } },
  { name: "Overload Fat Lead", cat: "Effects & Drones", note: "Every mixer knob near 10: the mixer overloads into the filter and the sound thickens (what the manual calls 'distortion' — it is the secret of the sound).",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.08), O3_RANGE: R["16'"], O3_WAVE: W.sqr, O3_FREQ: FQ(-0.08), SW_O2: 1, SW_O3: 1, VOL1: D(10), VOL2: D(10), VOL3: D(10), CUTOFF: K(0.5), EMPH: D(3), CONTOUR: D(2.5), FDEC: FD(0.5), FSUS: D(6), LSUS: D(10), OUTVOL: D(5), KB1: 1, KB2: 1 } },
  // ---------------------------------------------------------------- reissue options
  { name: "Pythagorean Lead", cat: "Reissue Options", note: "Reissue SCALE = Pythagorean (C): pure fifths, slightly sharp major thirds — a medieval-bright lead.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.sqr, O2_FREQ: FQ(0.03), SW_O2: 1, VOL1: D(7), VOL2: D(5), CUTOFF: K(1), EMPH: D(2.5), CONTOUR: D(3), FSUS: D(6), LSUS: D(10), KB1: 1, KB2: 1, SCALE: 1 } },
  { name: "Partch 43 Keys", cat: "Reissue Options", note: "Reissue SCALE = Partch 43-tone: the 44 keys become one octave of microtones. Strange, beautiful, quite out of tune with everything else.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.shark, O2_RANGE: R["8'"], O2_WAVE: W.tri, O2_FREQ: FQ(0.02), SW_O2: 1, VOL1: D(7), VOL2: D(5), CUTOFF: K(0.5), EMPH: D(2), CONTOUR: D(2.5), FSUS: D(6), LSUS: D(10), SCALE: 3, KB1: 1, KB2: 0 } },
  { name: "Vintage Wobble Bass", cat: "Reissue Options", note: "DRIFT, BLEED and the vintage key error all up: a tired, imperfect 1971 instrument that is never quite in tune.",
    set: { O1_RANGE: R["16'"], O1_WAVE: W.saw, O2_RANGE: R["16'"], O2_WAVE: W.saw, O2_FREQ: FQ(0.05), SW_O2: 1, VOL1: D(7), VOL2: D(7), CUTOFF: K(-2.5), EMPH: D(3.5), CONTOUR: D(4.5), FDEC: FD(0.5), FSUS: D(2), LDEC: LD(0.7), LSUS: D(8), DRIFT: 0.85, BLEED: 0.7, KEY_ERR: 1 } },
  { name: "Multi-Trigger Stab", cat: "Reissue Options", note: "MULTI trigger: overlapping keys re-fire the contours (the original fires only on a clean press). Play chords-by-hand for repeated stabs.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, O2_RANGE: R["8'"], O2_WAVE: W.wide, O2_FREQ: FQ(0.08), SW_O2: 1, VOL1: D(7), VOL2: D(5), CUTOFF: K(-1.5), EMPH: D(3), CONTOUR: D(5), FDEC: FD(0.25), FSUS: D(1), LDEC: LD(0.4), LSUS: D(2), TRIG_MODE: 1, KEY_PRI: 2, KB1: 1, KB2: 1 } },
  { name: "Filter-Contour Vibrato", cat: "Reissue Options", note: "MOD source A = the filter contour (reissue patch point): the wheel then sends the filter envelope to the pitch — a pitch dive on every note.",
    set: { O1_RANGE: R["8'"], O1_WAVE: W.saw, VOL1: D(7), CUTOFF: K(0), EMPH: D(2), CONTOUR: D(3), FATK: FA(0.001), FDEC: FD(0.35), FSUS: 0, OSC_MOD: 1, MOD_A: 1, MODMIX: 0, MODW: 0.35, KB1: 1, KB2: 1, LSUS: D(10) } },
];

// loudness trim per patch (tests/tune-levels.mjs → presets.levels.json)
import { readFileSync, existsSync } from "node:fs";
const lvPath = new URL("./presets.levels.json", import.meta.url);
const levels = existsSync(lvPath) ? JSON.parse(readFileSync(lvPath, "utf8")) : {};
export const PRESETS = [INIT, ...BANK].map((p) => (levels[p.name] ? { ...p, set: { ...p.set, ...levels[p.name] } } : p));
const names = new Set();
for (const p of PRESETS) { if (names.has(p.name)) throw new Error("duplicate preset " + p.name); names.add(p.name); }
