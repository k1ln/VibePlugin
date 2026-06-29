# Air Exciter

A psychoacoustic high-frequency harmonic exciter for adding air, sheen and
presence. Rather than simply boosting existing treble, Air Exciter *manufactures*
new high-order harmonics from the upper band of the signal and blends a measured
amount back over the untouched dry path — the classic "aural exciter" trick for
making sources cut through and feel more open.

## How it works

Per channel, the signal flow is:

1. **Band split** — a one-pole high-pass at the **Tune** corner isolates the
   upper band.
2. **Harmonic generation** — that band is driven into an asymmetric soft-saturator,
   which synthesises both even- and odd-order harmonics that were not present in
   the dry signal. **Amount** sets both the drive and the blend level, so the knob
   changes timbre (denser/richer) as well as level.
3. **Re-split + DC block** — a second high-pass keeps the freshly-made harmonics
   while discarding regenerated fundamentals; a slow DC blocker stops the
   asymmetric shaper from drifting.
4. **Air tilt** — a bright high-shelf emphasises the very top of the harmonic
   stream. **Air** controls how much of the sparkle vs. body is passed.
5. **Blend** — the synthesised air is summed on top of the dry signal, then
   **Mix** crossfades the whole effect against the original. A final clamp keeps
   peaks bounded well under full-scale.

The effect is allocation-free, runs entirely in `f32`, and is gain-staged so the
output peak stays comfortably below 1.0.

## Parameters

| Index | Name   | Range | Default | Description |
|-------|--------|-------|---------|-------------|
| 0 | Tune   | 0–1 | 0.45 | High-frequency corner, ~1.2 kHz … 9 kHz (perceptual squared mapping). |
| 1 | Amount | 0–1 | 0.50 | Density and level of the synthesised harmonics. |
| 2 | Air    | 0–1 | 0.50 | Top-end tilt / brightness of the excited stream. |
| 3 | Mix    | 0–1 | 1.00 | Dry/wet of the whole effect. |

## Files

- `assembly.ts` — the DSP module (AssemblyScript → WASM).
- `spec.json` — plugin manifest (name, params, theme, paths).
- `gui.html` — self-contained bespoke GUI: rising air-particle field, a live
  shimmer visualiser reacting to Amount/Air, and hand-built SVG knobs (drag
  vertically, wheel to nudge, Shift for fine, double-click to reset).
- `preview.wav` — rendered test output.
- `air-exciter.vstai` — packed bundle (baked GUI + WASM).

## GUI

Bright, airy premium UI on accent `#bfe3ff` / `#e6f0ff`: a glowing dark panel
with sparkles drifting upward off a high-frequency shimmer meter, soft inner
glow and depth lighting. All CSS/JS/SVG is inline — no external assets.
