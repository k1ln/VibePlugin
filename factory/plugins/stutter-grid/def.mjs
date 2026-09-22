export default {
  name: "Stutter Grid", isInstrument: false, subtitle: "Tempo-synced glitch", category: "Creative",
  explanation: "A tempo-synced stutter and glitch processor. The input is captured continuously; on every grid step (1/4 to 1/32 note, locked to the host transport while it plays, otherwise the internal tempo) a seeded random draw decides what happens to that step: pass through untouched, stutter a slice (with seamless loop crossfade, per-repeat pitch ramp, decay and a falling low-pass), reverse the last step, mute it, tape-stop it, or replay it at double speed. The draw is seeded by the Seed and the step index modulo the Pattern Length, so the same glitch pattern repeats every 1, 2, 4 or 8 bars until the seed changes. Force Stutter holds the stutter on demand. Pass steps have no latency.",
  theme: { accent: "#ff7ad9", accent2: "#ffdcf3", bg1: "#3a1440", bg2: "#12061a", panel: "#231030", ink: "#f8e6f5", dim: "#b088ad" },
  params: [
    ["Grid", 0, 3, 2, 1, ["1/4", "1/8", "1/16", "1/32"]], ["Stutter Chance", 0, 1, 0.4], ["Reverse Chance", 0, 1, 0.15], ["Mute Chance", 0, 1, 0.1],
    ["Tape Stop Chance", 0, 1, 0.1], ["Double-Time Chance", 0, 1, 0.1], ["Slice", 0, 3, 1, 1, ["1", "1/2", "1/4", "1/8"]], ["Pitch Ramp", 0, 1, 0.5],
    ["Decay", 0, 1, 0.7], ["Filter Fall", 0, 1, 0.3], ["Seed", 0, 1, 0.25], ["Pattern Bars", 0, 3, 0, 1, ["1", "2", "4", "8"]], ["Force Stutter", 0, 1, 0, 1],
    ["Tempo", 0, 1, 0.3, 0, {unit:" bpm", scale:[60,200]}], ["Mix", 0, 1, 1], ["Output", 0, 1, 0.7],
  ],
  groups: [
    { title: "CLOCK", items: [{ k: "seg", i: 0, label: "GRID", opts: ["1/4", "1/8", "1/16", "1/32"] }, { k: "seg", i: 11, label: "PATTERN", opts: ["1 BAR", "2 BARS", "4 BARS", "8 BARS"] }, { k: "knob", i: [10, 13] }] },
    { title: "WHAT HAPPENS", items: [{ k: "knob", i: [1, 2, 3, 4, 5] }, { k: "tog", i: 12, label: "LIVE", text: "FORCE STUTTER" }] },
    { title: "STUTTER SHAPE", items: [{ k: "seg", i: 6, label: "SLICE", opts: ["1", "1/2", "1/4", "1/8"] }, { k: "knob", i: [7, 8, 9] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [14, 15] }] },
  ],
  viz: "bars", vizLabel: "GLITCH STATE",
  testParams: { 1: 0.9, 12: 0 },
};
