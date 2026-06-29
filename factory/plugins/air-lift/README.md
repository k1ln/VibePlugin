# Air Lift

An air-band shelving EQ — the silky high-shelf specialist. Air Lift is a clean,
mastering-grade tilt EQ built around a very-high **AIR** band: a gentle, wide
high shelf that opens and brightens the very top of a mix without ever turning
harsh. Beneath it sit a musical **LOW** shelf and a broad **MID** bell, plus an
**OUTPUT** trim. Boost-only air with a soft slope means the top *lifts* instead
of spiking.

This is an original DSP design, not a copy of any product or sample set.

## Sound

- **Air** — a boost-only high shelf, 0 .. +14 dB, with a deliberately gentle
  (wide) slope so it adds sparkle and openness rather than a brittle edge.
- **Air Freq** — a discrete corner selector that climbs up into the highs:
  **2.5k / 5k / 10k / 20k / 40k**. The upper seats sit above the audio range, so
  the shelf's wide skirt reaches *down* into the air band — opening the top with
  no resonant spike.
- **Low** — a musical low shelf around 120 Hz, ±12 dB (centre = flat).
- **Mid** — a broad bell around 900 Hz, ±12 dB (centre = flat).
- **Output** — output trim; centre is unity, full up is about +6 dB.

All three bands are stable RBJ biquads in Direct-Form I, run entirely in `f32`.
The output is headroom-trimmed and hard-bounded so it never clips past ±1.0.

## Parameters

| # | Name     | Range          | Default | Notes                          |
|---|----------|----------------|---------|--------------------------------|
| 0 | Air      | 0 .. 1         | 0.45    | high-shelf gain, 0..+14 dB     |
| 1 | Air Freq | 0 .. 4 (step 1)| 2       | corner 2.5k/5k/10k/20k/40k     |
| 2 | Low      | 0 .. 1         | 0.5     | low shelf, ±12 dB (0.5 = flat) |
| 3 | Mid      | 0 .. 1         | 0.5     | broad bell, ±12 dB (0.5 = flat)|
| 4 | Output   | 0 .. 1         | 0.5     | trim, 0.5 = unity, up to +6 dB |

## Files

- `assembly.ts` — the DSP (AssemblyScript → WASM, VibePlugin ABI).
- `spec.json` — plugin manifest (name, params, theme, GUI).
- `gui.html` — self-contained animated GUI: a pale-blue + white mastering
  faceplate with a live response graph, a luminous air curve, drifting shimmer
  band and twinkling sparkles. Knobs drag vertically, scroll, and reset on
  double-click; Air Freq is a stepped dot-ring selector.
- `preview.wav` — rendered test output.
- `air-lift.vstai` — packed bundle.

## GUI controls

- Drag a knob up/down to change its value; scroll to nudge; double-click to reset.
- Air Freq is a stepped selector: drag or scroll to step through the corners.
- The response curve and value readouts update live as you adjust.

## Theme

Accent `#8fdcff` / `#cdebff` — a sparkly pale-blue + white hi-fi aesthetic.
