export default {
  name: "Tinebar Electric", isInstrument: true, subtitle: "Electric piano model", category: "Analog Synths",
  explanation: "A modal electric-piano model. A struck tine is a cantilever beam with inharmonic partials (1 : 6.27 : 17.55 : 34.4) coupled to a tuned tonebar whose slight detune produces the slow chorus-like beating of the real instrument. A hammer burst (Hardness, velocity) excites the modes, a low thump resonator adds the felt hit, and a nonlinear pickup (Bark) turns the sine into growl on hard strikes: an asymmetric electromagnetic pickup for the tine model, a stronger electrostatic second-harmonic pickup for the reed model. Damper felt on release, preamp drive, tone, suitcase tremolo or auto-pan, key-dependent stereo width and a small room finish it. Twelve voices.",
  theme: { accent: "#ff9d5c", accent2: "#ffe0c4", bg1: "#3c1f14", bg2: "#130a06", panel: "#23140d", ink: "#f7e8dc", dim: "#b39078" },
  params: [
    ["Model", 0, 1, 0, 1, ["Tine", "Reed"]], ["Tine Decay", 0, 1, 0.55], ["Tonebar", 0, 1, 0.5], ["Beating", 0, 1, 0.3], ["Bell", 0, 1, 0.45],
    ["Hardness", 0, 1, 0.5], ["Thump", 0, 1, 0.35], ["Bark", 0, 1, 0.4], ["Tone", 0, 1, 0.55], ["Velocity Sens", 0, 1, 0.6],
    ["Release", 0, 1, 0.35], ["Tremolo Depth", 0, 1, 0.35], ["Tremolo Rate", 0, 1, 0.3], ["Tremolo Mode", 0, 1, 0, 1, ["Tremolo", "Auto-pan"]],
    ["Drive", 0, 1, 0.25], ["Key Stereo", 0, 1, 0.5], ["Space", 0, 1, 0.2], ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.75],
  ],
  groups: [
    { title: "MODEL", items: [{ k: "seg", i: 0, label: "PICKUP", opts: ["TINE", "REED"] }, { k: "knob", i: [1, 2, 3, 4] }] },
    { title: "STRIKE & PICKUP", items: [{ k: "knob", i: [5, 6, 7, 9, 10] }] },
    { title: "AMP & TREMOLO", items: [{ k: "seg", i: 13, label: "MODE", opts: ["TREMOLO", "AUTO-PAN"] }, { k: "knob", i: [11, 12, 14, 8] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [15, 16, 17, 18] }] },
  ],
  viz: "wave", vizLabel: "PICKUP SIGNAL", vizParam: 7, kb: { base: 36, n: 49 },
  testParams: { 13: 1 },
};
