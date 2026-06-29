# Micro Shift

A micro-pitch detune doubler / fattener — an original plugin in the lineage of
classic studio "MicroPitch" rack processors. It turns a mono (or narrow) source
into a wide, thick, shimmering stereo double.

## What it does

Two pitch-shifted voices are detuned a few cents **up** and **down** (always
below a semitone), each given its own short delay tap, panned hard left/right
and blended back with the dry signal:

- **Small detune** = lush, glued thickening.
- **Larger detune** = chorusy, animated shimmer with audible beating.
- **Mix = 0** is essentially dry.

This is distinct from a plain pitch shifter or whammy: the pitch offsets are
sub-semitone and the two voices are spread across the stereo field, so the
effect is *width and density* rather than transposition.

## DSP

`assembly.ts` implements the VibePlugin WASM ABI (planar f32, stride 8192, no
allocation in `process()`). Pitch shifting uses a **fractional delay-line**
read at a drifting rate: each voice has a ring buffer whose read pointer moves
at `(ratio - 1)` relative to the write head, with two overlapping read taps half
a grain-window apart, crossfaded by a triangular window so the pointer wrap is
inaudible (no zipper noise, no FFT). All control changes are per-sample slewed.

Gain is staged so the doubled output stays well under full scale (preview peak
~0.46).

## Parameters

| # | Name     | Range            | Default | Notes |
|---|----------|------------------|---------|-------|
| 0 | Detune   | 0..30 cents      | 0.4     | total cent spread (each voice ±half) |
| 1 | Delay    | 1..40 ms         | 0.3     | per-voice tap time |
| 2 | Width    | 0..100%          | 0.8     | stereo spread (0 = mono, 1 = hard L/R) |
| 3 | Feedback | 0..100%          | 0.15    | subtle regeneration into the delay lines |
| 4 | Mix      | 0..100%          | 0.5     | dry/wet blend |

## GUI

`gui.html` is a single self-contained document: a teal-to-indigo studio rack
with a live "stereo width field" showing the two mirrored detuned voices
drifting a few cents apart over a doubled waveform, with cent-scale readouts and
hand-built knobs (drag to turn, double-click to reset, wheel to fine-tune). It
wires every parameter through `window.vstai.setParam`.

## Build / verify

```
node compiler/asc-driver.mjs factory/plugins/micro-shift/assembly.ts /tmp/micro-shift.wasm
node factory/tools/wasm-runner.mjs /tmp/micro-shift.wasm \
  --params /tmp/micro-shift-params.json --wav factory/plugins/micro-shift/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/micro-shift/spec.json
```

Verdict: **PASS** — audio present, finite, no clipping, all five parameters
affect the output.
