const P = (eng, bore, emb, breath, noise, atk, rel, tone, glide, body) => ({ 0: eng, 1: bore, 2: emb, 3: breath, 4: noise, 5: atk, 6: rel, 9: tone, 11: glide, 13: body });
export default {
  name: "Windbore", isInstrument: true, subtitle: "Wind instrument models", category: "Digital & Experimental",
  explanation: "Physical-model wind instruments built from digital waveguides. Three excitation engines share one monophonic breath-controlled voice: a single-reed valve driving a bore that morphs from cylinder (clarinet, odd harmonics) to cone (saxophone, all harmonics); an air jet blowing across an open bore (flute); and a lip resonator squeezing against bore pressure (brass). Breath pressure has attack and release, noise, vibrato and is driven by velocity, aftertouch and CC2/CC11. A tone-hole low-pass, bell/body resonance, glide, legato and a small room complete it. Character presets set clarinet, saxophone, oboe, flute, trumpet or trombone; every control stays free.",
  theme: { accent: "#e7c26a", accent2: "#fff0c9", bg1: "#3a2f14", bg2: "#110d05", panel: "#241c0d", ink: "#f8eed8", dim: "#b5a179" },
  params: [
    ["Engine", 0, 2, 0, 1, ["Reed", "Flute", "Brass"]], ["Bore Shape", 0, 1, 0], ["Embouchure", 0, 1, 0.5], ["Breath", 0, 1, 0.6],
    ["Breath Noise", 0, 1, 0.15], ["Attack", 0, 1, 0.25], ["Release", 0, 1, 0.3], ["Vibrato", 0, 1, 0.3], ["Vibrato Rate", 0, 1, 0.45],
    ["Tone", 0, 1, 0.55], ["Velocity Sens", 0, 1, 0.5], ["Glide", 0, 1, 0.15], ["Legato", 0, 1, 1, 1], ["Body", 0, 1, 0.45],
    ["Space", 0, 1, 0.25], ["Space Size", 0, 1, 0.5], ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.7],
  ],
  groups: [
    { title: "INSTRUMENT", items: [
      { k: "seg", i: 0, label: "ENGINE", opts: ["REED", "FLUTE", "BRASS"] },
      { k: "seg", i: -1, label: "CHARACTER", opts: ["CLARINET", "SAX", "OBOE", "FLUTE", "TRUMPET", "TROMBONE"], presets: [
        P(0, 0.0, 0.5, 0.6, 0.15, 0.25, 0.3, 0.55, 0.15, 0.45), P(0, 1.0, 0.45, 0.65, 0.3, 0.3, 0.3, 0.65, 0.2, 0.5),
        P(0, 0.6, 0.75, 0.6, 0.25, 0.3, 0.3, 0.8, 0.1, 0.55), P(1, 0, 0.65, 0.55, 0.15, 0.3, 0.3, 0.6, 0.1, 0.3),
        P(2, 0, 0.7, 0.75, 0.05, 0.18, 0.25, 0.8, 0.1, 0.5), P(2, 0, 0.35, 0.7, 0.05, 0.4, 0.35, 0.5, 0.35, 0.4)] }] },
    { title: "EXCITER", items: [{ k: "knob", i: [1, 2, 3, 4, 10] }] },
    { title: "BREATH SHAPE", items: [{ k: "knob", i: [5, 6, 7, 8, 11] }, { k: "tog", i: 12, label: "MODE", text: "LEGATO" }] },
    { title: "BORE & OUTPUT", items: [{ k: "knob", i: [9, 13, 14, 15, 16, 17] }] },
  ],
  viz: "wave", vizLabel: "AIR COLUMN", vizParam: 9, kb: { base: 48, n: 37 },
  testParams: { 12: 1 },
};
