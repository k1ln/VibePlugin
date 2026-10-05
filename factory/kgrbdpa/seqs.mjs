// =====================================================================
//  Default contents of the three sequence memories (the hardware ships empty and keeps whatever
//  you record; a plugin without persistent memory starts with three demo patterns so SEQ mode
//  plays something immediately — record over them any time).
//  Syntax: note name (C4 = MIDI 60) · "-" rest · "~" prefix = tied (legato) · "*" suffix = accent.
// =====================================================================
const NAMES = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
export function parseSeq(str) {
  return str.trim().split(/\s+/).map((tok) => {
    if (tok === "-") return { note: -1, flag: 0 };
    let flag = 0;
    if (tok.startsWith("~")) { flag |= 1; tok = tok.slice(1); }
    if (tok.endsWith("*")) { flag |= 2; tok = tok.slice(0, -1); }
    const m = /^([A-G]#?)(-?\d)$/.exec(tok);
    if (!m) throw new Error("bad step " + tok);
    return { note: 12 * (Number(m[2]) + 1) + NAMES[m[1]], flag };
  });
}
export const DEFAULT_SEQS = [
  // 1: acid line in A
  parseSeq("A2 A2 - A3* A2 ~G3 - A2* ~C3 - A2 E3* - G2 A2 -"),
  // 2: rising / falling arpeggio figure
  parseSeq("C3 E3 G3 B3 C4 B3 G3 E3 D3 F3 A3 C4 D4 C4 A3 F3"),
  // 3: slow tied bass
  parseSeq("C2 - C2 ~D#2 G2* - F2 ~G2"),
];
