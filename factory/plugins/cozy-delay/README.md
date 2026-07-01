# Cozy Delay

A warm, dark, short bucket-brigade-style analog delay — a cosy, intimate echo
in the BBD lineage. Where a Memory-Man-style echo sprawls long and lush, Cozy
Delay stays in the short slapback-to-short-echo range and leans deliberately
dark: every repeat melts a little further into the shadows.

## Character

- **Short range.** Time spans ~20-300 ms — slapback through tight, cosy echoes,
  never long ambient washes.
- **Progressive darkening.** A *cascaded* (two-pole) low-pass sits inside the
  feedback loop, so each pass sheds more high end than the last. A string of
  repeats fades from a present, articulate slap into a soft amber haze.
- **Gentle per-pass saturation.** A `tanh` stage rounds transients and keeps the
  feedback path bounded and warm even when repeats pile up.
- **Faint wow drift.** A slow, shallow LFO gives the unstable bucket-brigade
  wander without ever sounding seasick.

## Controls

| Param    | Range            | Notes |
|----------|------------------|-------|
| Time     | ~20-300 ms       | short / slapback range, perceptual curve |
| Feedback | 0 - 0.9 (clamped)| number of warm, darkening repeats; always decays |
| Tone     | ~600-4200 Hz     | repeat darkness — how bright the in-loop low-pass lets repeats stay |
| Mix      | dry/wet          | blend |

## DSP

Pure algorithm, no samples. Planar f32 ABI (stride 8192), all `f32` math via
`Mathf.*`, no allocation in `process()` (delay lines and state are module-scope
`StaticArray`s). Feedback is clamped and double-low-passed plus saturated, so it
is bounded; render peak stays well under 1.0.

## Files

- `assembly.ts` — AssemblyScript DSP
- `spec.json` — factory spec (name "Cozy Delay", effect)
- `gui.html` — bespoke animated GUI: a warm-orange stompbox with an amber glow
  and darkening echo wave-packets fading into shadow
- `preview.wav` — rendered preview
- `cozy-delay.vstai` — packed bundle

Theme: accent `#ff9a5a`, accent2 `#ffd86a`.
