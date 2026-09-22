export default {
  name: "Spectral Smear", isInstrument: false, subtitle: "FFT freeze, blur and remap", category: "Pitch & Granular",
  explanation: "An FFT spectral processor: a stereo short-time Fourier transform (Hann analysis and synthesis, 75% overlap, 1024/2048/4096 points) with per-bin magnitude and phase processing. Freeze holds the spectrum, with each bin keeping its measured frequency so tones sustain coherently. Sustain is a spectral hold with adjustable decay, like an infinite reverb. Blur smears magnitudes across time and across neighbouring bins. Gate drops the quietest bins. Pitch and Shift remap bins by ratio and by an absolute Hz offset. Tilt, Low Cut and High Cut are spectral EQ. Phase can be kept, randomised (whisper) or zeroed (robot), and Width decorrelates the right channel. The dry path is delayed to match the analysis latency, so Mix stays coherent.",
  theme: { accent: "#5cf0e0", accent2: "#d2fff9", bg1: "#12363a", bg2: "#061112", panel: "#0c2226", ink: "#e2faf7", dim: "#7fb0aa" },
  params: [
    ["Freeze", 0, 1, 0, 1], ["Sustain", 0, 1, 0], ["Blur Time", 0, 1, 0.25], ["Blur Freq", 0, 1, 0.15], ["Phase", 0, 2, 0, 1, ["Keep", "Random", "Zero"]],
    ["Pitch", 0, 1, 0.5], ["Shift", 0, 1, 0.5], ["Gate", 0, 1, 0], ["Tilt", 0, 1, 0.5], ["Low Cut", 0, 1, 0], ["High Cut", 0, 1, 1],
    ["Width", 0, 1, 0.5], ["FFT Size", 0, 2, 1, 1, ["1024", "2048", "4096"]], ["Mix", 0, 1, 1], ["Output", 0, 1, 0.7],
  ],
  groups: [
    { title: "HOLD", items: [{ k: "tog", i: 0, label: "SPECTRUM", text: "FREEZE" }, { k: "knob", i: [1, 2, 3] }] },
    { title: "PHASE & SIZE", items: [{ k: "seg", i: 4, label: "PHASE", opts: ["KEEP", "RANDOM", "ZERO"] }, { k: "seg", i: 12, label: "FFT SIZE", opts: ["1024", "2048", "4096"] }, { k: "knob", i: [11] }] },
    { title: "REMAP", items: [{ k: "knob", i: [5, 6, 7, 8, 9, 10] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [13, 14] }] },
  ],
  viz: "bars", vizLabel: "SPECTRUM",
  testParams: { 0: 1, 1: 0.4, 7: 0.3 },
};
