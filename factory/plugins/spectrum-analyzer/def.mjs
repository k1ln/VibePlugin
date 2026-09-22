export default {
  name: "Spectrum Analyzer", isInstrument: false, subtitle: "16-band real-time analyzer", category: "Metering",
  explanation: "A 16-band real-time spectrum display. Audio passes through completely unaltered — safe to drop on a master bus without changing the sound — except for Input Trim, a real pre-analysis gain stage. A bank of 16 log-spaced (60 Hz - 16 kHz) resonant bandpass filters, one per band, each drives an attack/release envelope follower; the 16 band levels are converted to a dB scale (-60..0 dB) and streamed live to the display. Tilt adds up to +4.5 dB/octave of pink-noise-style boost to the high bands so broadband material reads flat instead of naturally sloping down, exactly like the tilt control on real hardware analyzers. Channel selects Left, Right or the L+R sum; Freeze holds the current picture for A/B comparison. 16 bands is a deliberate, not arbitrary, choice: the plugin format's DSP-to-GUI telemetry channel is a fixed 16 floats, the same budget many real hardware spectrum displays (10-31 band) work within for the same practical reason.",
  theme: { accent: "#5ee6a0", accent2: "#c8ffe4", bg1: "#08160f", bg2: "#040a07", panel: "#0c1f16", ink: "#e9fff3", dim: "#6b9c84" },
  params: [
    ["Input Trim", 0, 1, 0.5],
    ["Ballistics", 0, 1, 0.4],
    ["Tilt", 0, 1, 0.5],
    ["Channel", 0, 2, 2, 1, ["LEFT", "RIGHT", "SUM"]],
    ["Freeze", 0, 1, 0, 1, ["OFF", "ON"]],
  ],
  groups: [
    { title: "SOURCE", items: [{ k: "seg", i: 3, label: "CHANNEL", opts: ["LEFT", "RIGHT", "SUM"] }, { k: "knob", i: [0] }] },
    { title: "DISPLAY", items: [{ k: "knob", i: [1, 2] }, { k: "tog", i: 4, label: "FREEZE" }] },
  ],
  viz: "bars", vizLabel: "SPECTRUM",
};
