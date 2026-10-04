// Shared constant tables — emitted into the DSP (build.mjs) AND the GUI, so the
// visualisers show exactly what the engine plays.

// Modal ratio tables (12 modes each). Membrane = zeros of the Bessel functions of
// a circular membrane (J0m, J1m …) divided by the first; Bar = free-free
// Euler–Bernoulli beam; Plate = free circular plate (approximate); Bell = the
// classic minor-third partial series (hum, prime, tierce, quint, nominal …)
// re-based to the hum; Junk = fixed pseudo-random inharmonic set.
export const MAT_NAMES = ["String", "Membrane", "Plate", "Bar", "Bell", "Junk"];
export const MAT_R = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [1.000, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.500, 3.600, 3.652, 4.060, 4.154],
  [1.000, 1.730, 2.330, 3.650, 3.910, 5.290, 5.860, 7.070, 8.030, 9.010, 10.30, 11.20],
  [1.000, 2.756, 5.404, 8.933, 13.344, 18.638, 24.812, 31.87, 39.80, 48.62, 58.33, 68.93],
  [1.0, 2.0, 2.366, 3.012, 4.0, 5.028, 5.324, 6.022, 8.332, 10.866, 13.592, 16.43],
  [1.0, 1.37, 1.91, 2.63, 3.17, 4.01, 4.83, 5.29, 6.61, 7.54, 9.12, 10.70],
];

// Metal oscillator ratio sets (6 each): 808 hats, classic 2/3/4.16/5.43/6.79/8.21,
// harmonic, stacked fifths, dense cluster, chaos.
export const MET_NAMES = ["808", "Classic", "Harmonic", "Fifths", "Cluster", "Chaos"];
export const MET_R = [
  [1.0, 1.4828, 1.8003, 2.5461, 2.6303, 3.8968],
  [1.0, 1.5, 2.08, 2.715, 3.395, 4.105],
  [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
  [1.0, 1.5, 2.25, 3.375, 5.0625, 7.59375],
  [1.0, 1.045, 1.12, 1.19, 1.27, 1.39],
  [1.0, 1.37, 2.43, 3.17, 4.83, 6.61],
];
