// character presets: values for the knob params below (index -> value)
const P = (pos, hard, bright, decay, stiff, body, size, twang, buzz, det, damp, mute, symp, stun) =>
  ({ 1: pos, 2: hard, 3: bright, 4: decay, 5: stiff, 6: body, 7: size, 8: twang, 9: buzz, 10: det, 11: damp, 12: mute, 13: symp, 14: stun });
export default {
  name: "Pluckwork", isInstrument: true, subtitle: "Plucked strings", category: "Analog Synths",
  explanation: "A plucked-string instrument built on a digital waveguide. Each voice is a double course of strings: a delay-line loop with fractional tuning, loop low-pass (Brightness), two allpass stages of dispersion (Stiffness), an optional nonlinear bridge (Buzz, the sitar jawari), a pitch-falling Twang and a damper felt on release. Strings are struck by a comb-filtered noise burst (Pick Position, Hardness, velocity). The strings drive a four-resonator soundbox (Body Mix and Size) and eight tuned sympathetic strings, then a small stereo room. Character presets set it up as nylon or steel guitar, harp, harpsichord, koto, banjo or sitar, and every knob stays free to tweak.",
  theme: { accent: "#ffb56b", accent2: "#ffe6c7", bg1: "#3b2412", bg2: "#120b06", panel: "#22160d", ink: "#f6e9db", dim: "#b39373" },
  params: [
    ["Character", 0, 6, 0, 1, ["Nylon", "Steel", "Harp", "Harpsichord", "Koto", "Banjo", "Sitar"]],
    ["Pick Position", 0, 1, 0.17], ["Pick Hardness", 0, 1, 0.35], ["Brightness", 0, 1, 0.55], ["Decay", 0, 1, 0.5],
    ["Stiffness", 0, 1, 0.05], ["Body Mix", 0, 1, 0.55], ["Body Size", 0, 1, 0.5], ["Twang", 0, 1, 0], ["Buzz", 0, 1, 0],
    ["Course Detune", 0, 1, 0], ["Damper", 0, 1, 0.4], ["Palm Mute", 0, 1, 0], ["Sympathetic", 0, 1, 0.25],
    ["Sympathetic Tuning", 0, 4, 1, 1, ["Off", "Guitar", "Harp", "Sitar", "Pentatonic"]],
    ["Velocity Sens", 0, 1, 0.6], ["Width", 0, 1, 0.55], ["Space", 0, 1, 0.25], ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.75],
  ],
  groups: [
    { title: "INSTRUMENT", items: [{ k: "seg", i: 0, label: "CHARACTER", opts: ["NYLON", "STEEL", "HARP", "HARPSI", "KOTO", "BANJO", "SITAR"], presets: [
      P(0.17, 0.35, 0.55, 0.5, 0.05, 0.55, 0.5, 0.0, 0.0, 0.0, 0.4, 0.0, 0.25, 1),
      P(0.12, 0.7, 0.8, 0.6, 0.1, 0.45, 0.5, 0.0, 0.0, 0.15, 0.4, 0.0, 0.25, 1),
      P(0.25, 0.3, 0.65, 0.75, 0.02, 0.35, 0.65, 0.0, 0.0, 0.0, 0.55, 0.0, 0.3, 2),
      P(0.1, 0.95, 0.9, 0.35, 0.08, 0.3, 0.4, 0.05, 0.0, 0.3, 0.9, 0.0, 0.1, 0),
      P(0.2, 0.6, 0.7, 0.4, 0.03, 0.45, 0.5, 0.4, 0.0, 0.0, 0.5, 0.0, 0.2, 4),
      P(0.15, 0.8, 0.85, 0.25, 0.05, 0.75, 0.75, 0.15, 0.15, 0.0, 0.5, 0.0, 0.1, 0),
      P(0.08, 0.85, 0.88, 0.75, 0.0, 0.5, 0.6, 0.2, 0.75, 0.0, 0.3, 0.0, 0.6, 3)] }] },
    { title: "PLUCK", items: [{ k: "knob", i: [1, 2, 15, 12] }] },
    { title: "STRING", items: [{ k: "knob", i: [3, 4, 5, 8, 9, 10, 11] }] },
    { title: "SOUNDBOX & SYMPATHY", items: [{ k: "seg", i: 14, label: "SYMPATHETIC", opts: ["OFF", "GUITAR", "HARP", "SITAR", "PENTA"] }, { k: "knob", i: [6, 7, 13] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [16, 17, 18, 19] }] },
  ],
  viz: "wave", vizLabel: "STRING", vizParam: 3, kb: { base: 36, n: 49 },
  testParams: { 8: 0.5, 9: 0.4, 10: 0.4, 12: 0.5, 13: 0.5 },
};
