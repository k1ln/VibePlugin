# Sweep Phaser

A 4-stage analog-style phaser. Four cascaded first-order all-pass sections have
their break frequency swept by a sine LFO; mixing the phase-shifted output back
with the dry signal creates two moving notches that glide up and down the
spectrum. A feedback/resonance path re-injects the chain output for sharper,
more vocal notches.

## Controls

| Param    | Range | Default | Description |
|----------|-------|---------|-------------|
| Rate     | 0–1   | 0.35    | LFO sweep speed, ~0.05–8 Hz (exponential feel). |
| Depth    | 0–1   | 0.7     | How wide the notches sweep across the spectrum. |
| Feedback | 0–1   | 0.5     | Resonance: re-injects the wet output for sharper notches (bounded < 1 for stability). |
| Mix      | 0–1   | 0.5     | Dry/wet blend. At 0.5 the two signals sum for classic notch depth. |

## DSP notes

- Cascade of four first-order all-pass sections (`y = a*x + z; z = x - a*y`),
  coefficient `a` derived per-sample from a bilinear `tan()` warp of the swept
  corner frequency.
- The corner is modulated in the log-frequency domain between ~200 Hz and an
  upper bound that Depth widens, so the sweep is musically even.
- A shared LFO phase keeps both stereo channels sweeping together, like a true
  mono-LFO analog unit.
- Feedback is clamped below 1 and the output is safety-clamped to ±1.5; with a
  steady tone the notches sweep audibly while the signal stays bounded (tested
  peak ~0.50).

Original algorithm — not a copy of, or affiliated with, any commercial product.
