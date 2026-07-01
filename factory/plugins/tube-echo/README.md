# Tube Echo

A single-head **tape echo with tube-preamp warmth** — an original design in the
Echoplex EP-3 lineage (no trademarks shipped).

## What makes it distinct
Unlike the other tape/BBD echoes in the factory, Tube Echo is defined by its
**warm tube-preamp colour** and **saturating repeats**:

- **One record/play tape head** — a single delay tap with a feedback loop
  (no multi-head taps).
- **Tube preamp warmth** — an asymmetric soft-saturation stage that colours the
  signal even at **100% dry**, the signature EP-3 character.
- **Repeat darkening** — each pass loses high frequency (Tone closes the
  feedback-path low-pass) so echoes fade warm and dark.
- **Tape saturation** in the feedback loop keeps build-up **bounded** while
  Feedback can climb toward sustained self-oscillation.
- **Wow & flutter** — a slow ~0.6 Hz wow plus ~6.5 Hz flutter add vintage pitch
  wander, depth-scaled to the delay time.

## Controls
| Param | Range | Function |
|-------|-------|----------|
| Time     | 40–900 ms | record/play head spacing (single tap) |
| Feedback | 0–108%    | repeat regeneration; high settings approach bounded self-oscillation |
| Drive    | 0–100%    | tube preamp warmth / saturation (audible on dry path too) |
| Tone     | dark↔bright | HF darkening of each repeat |
| Mix      | 0–100%    | dry/wet blend |

## DSP notes
- Pure algorithm, all `f32`, no allocation in `process()`; planar stride 8192.
- Fractional (linear-interpolated) delay read for smooth modulation.
- DC blocker on the feedback path so self-oscillation cannot drift to a rail.
- Gain-staged: render peak stays below ~1.0.

## GUI
A bespoke vintage tape-delay unit: tan + cream chassis with corner screws, a
**spinning tape reel** (speed tracks Time), a **glowing tube** (brightness tracks
Drive), a warm orange **VU glow + needle**, and a **sliding playback head** on a
scrolling tape line. Five custom rotary knobs — drag (or scroll) to adjust,
double-click to reset. Single self-contained HTML doc, no external assets.

## Files
- `assembly.ts` — DSP source
- `spec.json` — plugin manifest (accent `#ff9a3d` / `#ffd86a`)
- `gui.html` — animated editor
- `preview.wav` — rendered test output
- `tube-echo.vstai` — packed bundle
