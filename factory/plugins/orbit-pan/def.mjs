export default {
  name: "Orbit Pan", isInstrument: false, subtitle: "Auto-pan and tremolo", category: "Modulation",
  explanation: "An auto-pan and tremolo unit with one LFO (sine, triangle, soft square, saw, or random sample-and-hold, with an edge-smoothing control) driving four modes: equal-power auto-pan of the stereo image; amplitude tremolo with a left/right phase offset; harmonic tremolo, where a crossover splits the signal and modulates the low and high bands in antiphase for the swirling brownface sound; and ping-pong, where left and right alternate. The rate is free (0.05 to 20 Hz) or locked to the host tempo from 1/1 down to 1/32 and phase-locked to the host beat position while the transport plays.",
  theme: { accent: "#7ab8ff", accent2: "#d9ebff", bg1: "#14284a", bg2: "#060b16", panel: "#0e1a30", ink: "#e6effa", dim: "#8098b8" },
  params: [
    ["Mode", 0, 3, 0, 1, ["Auto-Pan", "Tremolo", "Harmonic", "Ping-Pong"]], ["Rate", 0, 1, 0.4, 0, {hz:[0.05,20]}], ["Sync", 0, 5, 0, 1, ["Free", "1/1", "1/2", "1/4", "1/8", "1/16"]],
    ["Depth", 0, 1, 0.7], ["Shape", 0, 4, 0, 1, ["Sine", "Triangle", "Square", "Saw", "Random"]], ["Smooth", 0, 1, 0.2], ["Phase", 0, 1, 0.5],
    ["Crossover", 0, 1, 0.45, 0, {hz:[150,4500]}], ["Width", 0, 1, 1], ["Mix", 0, 1, 1], ["Output", 0, 1, 0.7],
  ],
  groups: [
    { title: "MODE", items: [{ k: "seg", i: 0, label: "MODE", opts: ["AUTO-PAN", "TREMOLO", "HARMONIC", "PING-PONG"] }, { k: "knob", i: [3, 8, 6, 7] }] },
    { title: "LFO", items: [{ k: "seg", i: 4, label: "SHAPE", opts: ["SINE", "TRI", "SQUARE", "SAW", "RANDOM"] }, { k: "seg", i: 2, label: "SYNC", opts: ["FREE", "1/1", "1/2", "1/4", "1/8", "1/16"] }, { k: "knob", i: [1, 5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [9, 10] }] },
  ],
  viz: "wave", vizLabel: "LFO", vizParam: 5,
  testParams: {},
};
