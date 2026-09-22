export default {
  name: "Wobble Deck", isInstrument: false, subtitle: "Tape and cassette degrader", category: "Creative",
  explanation: "A tape and cassette degrader. The signal runs through a modulated delay line that wanders: slow wow, faster flutter (both depend on tape speed) and random drift, with a stereo link control. Random dropouts dip the level like oxide loss. A tape-style asymmetric saturator and a fast squash compressor follow, then the head: head bump (low resonance), age- and speed-dependent high-frequency loss, azimuth error (a small delay and treble loss between channels), tape hiss and mains hum. The dry path is delay-matched so Mix never combs. Three tape speeds change the bandwidth, hiss and wobble character.",
  theme: { accent: "#ffcf5c", accent2: "#fff3cf", bg1: "#3a3212", bg2: "#100d05", panel: "#231e0d", ink: "#f8f1d9", dim: "#b3a675" },
  params: [
    ["Wow", 0, 1, 0.4], ["Wow Rate", 0, 1, 0.35], ["Flutter", 0, 1, 0.3], ["Drift", 0, 1, 0.3], ["Stereo Link", 0, 1, 0.6],
    ["Dropout Rate", 0, 1, 0.25], ["Dropout Depth", 0, 1, 0.5], ["Saturation", 0, 1, 0.4], ["Squash", 0, 1, 0.3], ["Age", 0, 1, 0.4],
    ["Head Bump", 0, 1, 0.4], ["Hiss", 0, 1, 0.15], ["Hum", 0, 1, 0], ["Azimuth", 0, 1, 0.2], ["Tape Speed", 0, 2, 1, 1, ["3.75 ips", "7.5 ips", "15 ips"]],
    ["Mix", 0, 1, 1], ["Input Drive", 0, 1, 0.4], ["Output", 0, 1, 0.7],
  ],
  groups: [
    { title: "TRANSPORT", items: [{ k: "seg", i: 14, label: "SPEED", opts: ["3.75 ips", "7.5 ips", "15 ips"] }, { k: "knob", i: [0, 1, 2, 3, 4] }] },
    { title: "DEFECTS", items: [{ k: "knob", i: [5, 6, 9, 13, 11, 12] }] },
    { title: "TAPE", items: [{ k: "knob", i: [16, 7, 8, 10] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [15, 17] }] },
  ],
  viz: "wave", vizLabel: "OUTPUT", vizParam: 0,
  testParams: {},
};
