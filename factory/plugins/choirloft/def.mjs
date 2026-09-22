export default {
  name: "Choirloft", isInstrument: true, subtitle: "Vocal choir", category: "Strings",
  explanation: "A vocal choir and formant synthesiser. Each note is sung by up to four singers, each a glottal-style source (band-limited saw with spectral tilt set by Effort, plus breath noise) run through five parallel formant resonators. Formant frequencies, bandwidths and levels come from vowel tables for bass, tenor, alto and soprano voices and morph continuously across the vowels A-E-I-O-U, with the mod wheel pushing the morph further and Formant Shift changing apparent size. Singers differ in tuning, vibrato phase and rate and entry time (Ensemble, Human); pitch can scoop up into each note; CC11 and aftertouch shape expression. A stereo choir spread and a small hall finish it. Six notes, four singers each.",
  theme: { accent: "#c9a8ff", accent2: "#f0e6ff", bg1: "#2b1f4a", bg2: "#0d0917", panel: "#1a1230", ink: "#efe9fa", dim: "#9686b8" },
  params: [
    ["Voice Type", 0, 3, 2, 1, ["Bass", "Tenor", "Alto", "Soprano"]], ["Vowel", 0, 1, 0], ["Formant Shift", 0, 1, 0.5], ["Choir Size", 1, 4, 3, 1],
    ["Ensemble", 0, 1, 0.5], ["Vibrato", 0, 1, 0.4], ["Vibrato Rate", 0, 1, 0.45], ["Human", 0, 1, 0.5], ["Attack", 0, 1, 0.45], ["Release", 0, 1, 0.5],
    ["Breath", 0, 1, 0.15], ["Effort", 0, 1, 0.55], ["Scoop", 0, 1, 0.25], ["Width", 0, 1, 0.7], ["Space", 0, 1, 0.45], ["Hall Size", 0, 1, 0.6],
    ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.7], ["Velocity Sens", 0, 1, 0.3],
  ],
  groups: [
    { title: "VOICE", items: [{ k: "seg", i: 0, label: "TYPE", opts: ["BASS", "TENOR", "ALTO", "SOPRANO"] }, { k: "knob", i: [1, 2, 11, 10] }] },
    { title: "CHOIR", items: [{ k: "seg", i: 3, label: "SINGERS", opts: ["1", "2", "3", "4"] }, { k: "knob", i: [4, 7, 13] }] },
    { title: "EXPRESSION", items: [{ k: "knob", i: [5, 6, 12, 8, 9, 18] }] },
    { title: "SPACE & OUT", items: [{ k: "knob", i: [14, 15, 16, 17] }] },
  ],
  viz: "bars", vizLabel: "FORMANT SPECTRUM", kb: { base: 36, n: 49 },
  testParams: {},
};
