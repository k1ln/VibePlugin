export default {
  name: "Cross Modulator", isInstrument: false, subtitle: "Meta-modulator", category: "Creative",
  explanation: "A meta-modulator effect: crosses the input against an internal complex carrier oscillator through one of four algorithms. Difference/XOR-Fold takes the (input minus carrier) and folds it, producing sum/difference-tone artifacts like a comparator circuit. Wavefold Cross uses the input's amplitude to drive how hard the carrier gets folded — the input controls the carrier's harmonic content rather than being folded itself. Chebyshev Cross blends the carrier through increasing Chebyshev polynomial orders as the input gets louder, adding input-dependent harmonics. Hard-Sync Cross resets the carrier's phase on the input's zero-crossings, classic oscillator hard-sync driven by whatever you feed it. Track Input blends the carrier's frequency from the Carrier Freq knob toward a rough zero-crossing pitch-follow of the input, so the carrier can lock to what you're playing instead of running free. This plugin format gives an effect one audio input, not two — so unlike a hardware meta-modulator with a second CV/audio input, this always crosses against its own internal oscillator, which is exactly how those modules behave with nothing patched into that second input anyway. Deliberately skips plain ring-modulation and vocoding — Ring Mod and Robot Voice already cover those elsewhere.",
  theme: { accent: "#ff6ea8", accent2: "#ffd0e4", bg1: "#1c0b14", bg2: "#0a0409", panel: "#241019", ink: "#ffeef5", dim: "#a9748c" },
  params: [
    ["Algorithm", 0, 3, 0, 1, ["DIFFERENCE", "FOLD X", "CHEBYSHEV", "SYNC"]],
    ["Carrier Freq", 0, 1, 0.4],
    ["Carrier Wave", 0, 3, 0, 1, ["SINE", "SAW", "TRI", "PULSE"]],
    ["Track Input", 0, 1, 0.0],
    ["Drive", 0, 1, 0.4], ["Amount", 0, 1, 0.5], ["Feedback", 0, 1, 0.15], ["Tone", 0, 1, 0.5],
    ["Mix", 0, 1, 0.5], ["Width", 0, 1, 0.3], ["Level", 0, 1, 0.8],
  ],
  groups: [
    { title: "ALGORITHM", items: [{ k: "seg", i: 0, label: "ALGORITHM", opts: ["DIFFERENCE", "FOLD X", "CHEBYSHEV", "SYNC"] }] },
    { title: "CARRIER", items: [{ k: "seg", i: 2, label: "WAVE", opts: ["SINE", "SAW", "TRI", "PULSE"] }, { k: "knob", i: [1, 3] }] },
    { title: "MODULATION", items: [{ k: "knob", i: [4, 5, 6, 7] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [8, 9, 10] }] },
  ],
  viz: "wave", vizLabel: "CARRIER", vizParam: 5,
  testParams: { 0: 2, 5: 0.8, 4: 0.7 },
};
