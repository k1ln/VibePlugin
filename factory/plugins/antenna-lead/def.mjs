export default {
  name: "Antenna Lead", isInstrument: true, subtitle: "Theremin-style lead", category: "Analog Synths",
  explanation: "A theremin-style monophonic lead. A near-sine oscillator (Timbre adds the 2nd and 3rd harmonics of a real instrument) glides continuously between notes; a volume-hand envelope opens and closes the sound with velocity as hand height; slow random Drift makes pitch and level wander like an unsupported hand; vibrato fades in after a delay (mod wheel and aftertouch deepen it). Parallel formant resonators (Formant, Body) give the vocal oo-ah character, Beat Noise adds heterodyne hiss, Sub and Octave extend the range, and a small stereo room finishes it. Legato mode glides between overlapping notes.",
  theme: { accent: "#8fd3ff", accent2: "#eaf7ff", bg1: "#1a3350", bg2: "#070d16", panel: "#101d2c", ink: "#e6f1fa", dim: "#7d98b0" },
  params: [
    ["Glide", 0, 1, 0.35], ["Timbre", 0, 1, 0.35], ["Formant", 0, 1, 0.5], ["Body", 0, 1, 0.4], ["Vibrato", 0, 1, 0.35],
    ["Vibrato Rate", 0, 1, 0.5], ["Vibrato Delay", 0, 1, 0.4], ["Drift", 0, 1, 0.25], ["Hand Attack", 0, 1, 0.35], ["Hand Release", 0, 1, 0.45],
    ["Beat Noise", 0, 1, 0.1], ["Sub", 0, 1, 0], ["Octave", -2, 1, 0, 1, "int"], ["Legato", 0, 1, 1, 1], ["Space", 0, 1, 0.3],
    ["Space Size", 0, 1, 0.5], ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.7], ["Velocity Sens", 0, 1, 0.5],
  ],
  groups: [
    { title: "TONE", items: [{ k: "knob", i: [1, 2, 3, 10, 11, 12] }] },
    { title: "THE HAND", items: [{ k: "tog", i: 13, label: "MODE", text: "LEGATO" }, { k: "knob", i: [0, 8, 9, 7, 18] }] },
    { title: "VIBRATO", items: [{ k: "knob", i: [4, 5, 6] }] },
    { title: "SPACE & OUT", items: [{ k: "knob", i: [14, 15, 16, 17] }] },
  ],
  viz: "wave", vizLabel: "OSCILLATOR", vizParam: 1, kb: { base: 48, n: 37 },
  testParams: {},
};
