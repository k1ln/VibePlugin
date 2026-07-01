# Strip EQ

A four-band British console channel-strip equaliser — built as an
original VibePlugin effect. Where the Pultec / Neve / API EQs each model one flavour of
outboard, Strip EQ is a full mixing-desk channel: shelves top and bottom, two fully swept
parametric mid bells, and a sweepable high-pass to clean the low end before the EQ.
Clean, surgical and punchy.

## Signal path

Series cascade of five RBJ biquads (transposed direct form II), all `f32`:

1. **High-pass** — sweepable 16–400 Hz, 12 dB/oct (Q 0.707). Below ~2% it bypasses.
2. **Low shelf** — fixed 110 Hz, ±16 dB.
3. **Lo-Mid bell** — swept 80 Hz–2 kHz, ±16 dB, Q ≈ 1.
4. **Hi-Mid bell** — swept 600 Hz–15 kHz, ±16 dB, Q ≈ 1.
5. **High shelf** — fixed 9 kHz, ±16 dB.

Followed by an **Output** trim (−∞ … 0 dB at centre … +12 dB) and a clean safety clamp.
No allocation in `process()`; all state and coefficient scratch live in module-scope
`StaticArray`s. Planar f32 buffers, stride 8192.

## Parameters

| # | Name        | Range                | Default |
|---|-------------|----------------------|---------|
| 0 | Low         | ±16 dB shelf @110 Hz | 0.5     |
| 1 | Lo-Mid      | ±16 dB bell gain     | 0.5     |
| 2 | Lo-Mid Freq | 80 Hz – 2 kHz (log)  | 0.3     |
| 3 | Hi-Mid      | ±16 dB bell gain     | 0.5     |
| 4 | Hi-Mid Freq | 600 Hz – 15 kHz (log)| 0.5     |
| 5 | High        | ±16 dB shelf @9 kHz  | 0.5     |
| 6 | HP          | 16–400 Hz (off <2%)  | 0       |
| 7 | Output      | −∞ / 0 dB / +12 dB   | 0.5     |

## GUI

`gui.html` is one self-contained document (inline CSS/JS/SVG, no external assets): a tall
black British-console-style channel module with colour-coded knob caps (red shelves, blue lo-mid,
green hi-mid) in vertical bands, screw detailing, and a live EQ response curve with a
sweeping scanline animation. The curve and band node markers update in real time as you
drag knobs. Every knob is draggable (shift = fine, wheel = nudge), double-click resets to
default, and shows its live engineering value. Accent `#5ad0ff` / `#ff5a5a`.

## Verification

`node factory/tools/wasm-runner.mjs … --params strip-eq-params.json --seconds 3` →
**VERDICT: PASS**, all 8 parameters `✓ affects`, `noClip=true`, `finite=true`. At default
settings the output is a clean unity passthrough (peak ≈ 0.5 on the 0.4 test signal).
