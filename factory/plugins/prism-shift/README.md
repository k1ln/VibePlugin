# Prism Shift

Pitch-tracking granular harmonizer — 33 params: Main + 4 harmony voices.

- **Engine:** each voice is a two-tap, sawtooth-swept, Hann-crossfaded granular shifter reading one
  mono delay line (Hermite interpolation).
- **Tracking:** McLeod-style normalised autocorrelation on a ~12 kHz decimated window, every 64
  decimated samples, median-of-3, voiced/energy gated (`Tracking` sets the clarity threshold).
- **Diatonic mode:** intervals are scale *degrees* in Key × 8 scales (major, minor, dorian, mixolydian,
  lydian, phrygian, harmonic minor, minor pent), so a 3rd is major or minor as the key demands.
  **Chromatic mode:** plain semitones (no tracking needed).
- **Correct:** pulls the tracked note onto the scale (Main voice and diatonic voices).
- **Lock:** grain length snapped to an even multiple of the detected period so the two taps add in phase.
- Glide (tuned portamento), Humanize (per-voice drift), Feedback (cascading stacks), per-voice
  Level / Interval / Fine / Pan / Delay.

Tests: VERDICT PASS, all 33 params reactive. Pitch accuracy harness on a 220 Hz saw-sum:
diatonic 3rd (A→C), 5th (A→E), octave ±, minor-key 3rd, D→F, chromatic +7 and +12 +50 ct all land
within ±1 cent; Correct=1 pulls a +40 ct-sharp A to 220.0 Hz. Noise/extreme feedback stays finite.
Note: shifted voices carry inherent latency of ~half a grain (Size); Dry is zero-latency.
