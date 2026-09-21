// Parameter definitions for the string instruments (see drums/tr808/defs.mjs).
const r = (key, name, def) => ({ key, name, min: 0, max: 1, def });
const int = (key, name, min, max, def) => ({ key, name, min, max, def, step: 1 });

export const TESSITURA = [
  int("SECTION", "Section", 0, 5, 0),            // auto, violins, violas, celli, basses, full + doubling
  int("PLAYERS", "Players", 1, 6, 4),
  int("ART", "Articulation", 0, 7, 0),
  r("DYN", "Dynamics", 0.6), r("EXPR", "Expression", 0.85),
  r("VIB", "Vibrato", 0.55), r("VIB_RATE", "Vibrato Rate", 0.5), r("VIB_DELAY", "Vibrato Delay", 0.35),
  r("ATTACK", "Attack", 0.4), r("RELEASE", "Release", 0.35),
  r("FORCE", "Bow Pressure", 0.5), r("POSITION", "Bow Position", 0.5), r("BRIGHT", "Brightness", 0.5),
  r("TIGHT", "Ensemble Tightness", 0.6), r("TREM_RATE", "Tremolo Speed", 0.5), r("HUMAN", "Humanize", 0.5),
  int("LEGATO", "Legato", 0, 1, 0), r("PORTA", "Portamento", 0.4), r("VEL_DYN", "Velocity to Dynamics", 0.4),
  r("BODY", "Body Resonance", 0.8), r("DOUBLE", "Octave Doubling", 0.5), r("WIDTH", "Stage Width", 0.75),
  r("MIC_CLOSE", "Close Mics", 0.6), r("MIC_TREE", "Tree Mics", 0.8), r("MIC_AMB", "Ambient Mics", 0.45),
  r("HALL_SIZE", "Hall Size", 0.6), r("HALL_TONE", "Hall Tone", 0.5), r("PREDELAY", "Pre-delay", 0.3),
  { key: "TUNE", name: "Fine Tune", min: -50, max: 50, def: 0 }, int("BEND", "Bend Range", 0, 12, 2),
  r("MASTER", "Master", 0.7),
];

export const ALEATORA = [
  int("ART", "Articulation", 0, 7, 0), int("PLAYERS", "Density", 1, 6, 5), int("SECTION", "Register", 0, 4, 0),
  { key: "CLUSTER", name: "Cluster Width", min: 0, max: 300, def: 60 }, int("QUARTER", "Quarter-tone Grid", 0, 1, 1),
  { key: "SWARM", name: "Swarm Range", min: 0, max: 12, def: 0.6 }, r("SWARM_SPEED", "Swarm Speed", 0.3), r("SWARM_GLIDE", "Swarm Glide", 0.5),
  { key: "RISE", name: "Rise", min: -24, max: 24, def: 0 }, { key: "RISE_TIME", name: "Rise Time", min: 0.5, max: 30, def: 8 },
  r("SCRATCH", "Scratch", 0.15), r("SHIMMER", "Shimmer", 0.3),
  r("PULSE", "Pulse Depth", 0), int("PULSE_DIV", "Pulse Rate", 0, 5, 2),
  r("CHAOS", "Chaos", 0.35),
  r("DYN", "Dynamics", 0.55), r("EXPR", "Expression", 0.85), r("VIB", "Vibrato", 0.3),
  r("ATTACK", "Attack", 0.6), r("RELEASE", "Release", 0.55),
  r("FORCE", "Bow Pressure", 0.5), r("POSITION", "Bow Position", 0.5), r("BRIGHT", "Brightness", 0.5),
  r("TREM_RATE", "Tremolo Speed", 0.6), r("HUMAN", "Humanize", 0.8),
  int("FREEZE", "Freeze", 0, 1, 0), r("HALL_SIZE", "Hall Size", 0.8), r("HALL_TONE", "Hall Tone", 0.45),
  r("DRY", "Dry", 0.55), r("WET", "Wet", 0.7), r("WIDTH", "Width", 0.9), r("MASTER", "Master", 0.7),
];

export const COLOSSUS = [
  r("LOW", "Low Section", 0.8), r("MID", "Mid Section", 0.85), r("HIGH", "High Section", 0.45), r("SUB", "Sub", 0.25),
  r("SPREAD", "Ensemble Spread", 0.55), int("SIZE", "Ensemble Size", 2, 5, 5),
  r("TONE", "Tone", 0.55), r("RES", "Resonance", 0.15), r("BODY", "Body", 0.6), r("ROSIN", "Rosin", 0.35), r("VEL_BITE", "Bite", 0.6),
  r("DYN", "Dynamics", 0.65), r("EXPR", "Expression", 0.85), r("ATTACK", "Attack", 0.3), r("RELEASE", "Release", 0.35),
  int("OSTINATO", "Ostinato", 0, 1, 0), int("PATTERN", "Pattern", 0, 7, 2), r("LENGTH", "Note Length", 0.45),
  r("ACCENT", "Accent", 0.6), r("SWING", "Swing", 0), int("RATE", "Rate", 0, 2, 1),
  r("EVOLVE", "Evolve", 0.35), r("EVOLVE_RATE", "Evolve Rate", 0.3), r("TENSION", "Tension", 0), r("PUMP", "Pump", 0),
  r("WIDTH", "Width", 0.8), r("HALL_SIZE", "Hall Size", 0.7), r("HALL", "Hall Mix", 0.4), r("TAPE", "Tape", 0.25),
  int("BEND_RANGE", "Bend Range", 0, 12, 2), r("MASTER", "Master", 0.7),
];
