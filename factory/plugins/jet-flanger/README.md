# Jet Flanger

An original flanger that models the behaviour of a classic analog flanger pedal — a swept short delay summed with the dry signal to form a moving comb filter, with bipolar regeneration for the hollow, metallic "jet" sweep.

## How it works

- A per-channel fractional delay line (~0.2..10 ms) is read with **linear interpolation** behind the write pointer, so the modulated delay glides smoothly with no zipper noise.
- A **triangle LFO** modulates the read delay around a manual base time, producing the characteristic sweeping comb notches. The two channels run with a slight phase offset for a wider stereo image.
- The delayed signal is fed back into the line through a **bipolar Regen** control (−0.9..+0.9). Positive feedback deepens and sharpens the resonant notches; negative feedback gives the hollow through-zero-style metallic sweep.
- Dry and wet are summed at 0.7 each before the dry/wet **Mix**, gain-staged so the comb peaks stay below clipping (measured peak ≈ 0.64 on full-scale noise).

## Parameters

| Index | Name   | Range | Default | Description |
|-------|--------|-------|---------|-------------|
| 0 | Rate   | 0..1 | 0.25 | LFO sweep speed, ~0.05..8 Hz (exponential). |
| 1 | Depth  | 0..1 | 0.7  | Sweep depth — how far the delay is modulated (up to ~4 ms). |
| 2 | Regen  | 0..1 | 0.65 | Feedback amount, bipolar −0.9..+0.9 (0.5 = no feedback). |
| 3 | Manual | 0..1 | 0.2  | Base delay time, ~0.2..6 ms — sets where the comb sits. |
| 4 | Mix    | 0..1 | 0.5  | Dry/wet blend. |

## DSP notes

- All math is `f32` (`Mathf.*`), no allocation in `process()`, state kept in module-scope `StaticArray`s.
- Delay line is 2048 samples per channel (~21 ms @ 96 kHz), giving headroom above the max modulated delay.
- Feedback is clamped to ±0.9 so the regeneration always stays bounded.

Pure algorithm — no samples, no external assets.
