export default {
  name: "Stackhead Amp", isInstrument: false, subtitle: "Guitar amp and cabinet", category: "Distortion & Saturation",
  explanation: "A guitar amplifier and cabinet simulator. Signal path: input trim, noise gate, tight high-pass and bright control, a three-stage triode-style preamp (asymmetric clipping with interstage coupling filters and stage bandwidth, oversampled) in four voicings from clean to high-gain, a passive-style tone stack (bass, mid, treble), a power amp with soft push-pull saturation, supply sag and a presence shelf, then a cabinet: speaker resonances modelled as parametric peaks, a steep high roll-off, cone compression, mic position from bright on-axis to dark off-axis, and a room-blend mic distance with stereo decorrelation. Three cabinet sizes (open 1x12, 2x12, closed 4x12); the cabinet can be bypassed to feed a separate impulse-response loader.",
  theme: { accent: "#ff5c4a", accent2: "#ffd6cf", bg1: "#3a1611", bg2: "#120806", panel: "#241210", ink: "#f8e6e2", dim: "#b08882" },
  params: [
    ["Voicing", 0, 3, 1, 1, ["Clean", "Crunch", "Lead", "High Gain"]], ["Gain", 0, 1, 0.5], ["Bright", 0, 1, 0.4], ["Tight", 0, 1, 0.4], ["Bass", 0, 1, 0.5],
    ["Mid", 0, 1, 0.5], ["Treble", 0, 1, 0.55], ["Presence", 0, 1, 0.4], ["Master", 0, 1, 0.6], ["Sag", 0, 1, 0.35],
    ["Gate", 0, 1, 0.15], ["Cabinet", 0, 2, 1, 1, ["Open 1x12", "2x12", "Closed 4x12"]], ["Mic Position", 0, 1, 0.4], ["Mic Distance", 0, 1, 0.3],
    ["Cabinet On", 0, 1, 1, 1], ["Room Width", 0, 1, 0.4], ["Input Trim", 0, 1, 0.5], ["Output", 0, 1, 0.7],
  ],
  groups: [
    { title: "PREAMP", items: [{ k: "seg", i: 0, label: "VOICING", opts: ["CLEAN", "CRUNCH", "LEAD", "HIGH GAIN"] }, { k: "knob", i: [1, 2, 3, 10, 16] }] },
    { title: "TONE STACK", items: [{ k: "knob", i: [4, 5, 6, 7] }] },
    { title: "POWER AMP", items: [{ k: "knob", i: [8, 9] }] },
    { title: "CABINET", items: [{ k: "tog", i: 14, label: "CAB", text: "CABINET ON" }, { k: "seg", i: 11, label: "SIZE", opts: ["1x12", "2x12", "4x12"] }, { k: "knob", i: [12, 13, 15, 17] }] },
  ],
  viz: "wave", vizLabel: "SIGNAL", vizParam: 1,
  testParams: {},
};
