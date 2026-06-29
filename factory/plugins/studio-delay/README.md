# Studio Delay — pristine rackmount digital delay

**Modeled after:** a classic pristine digital delay (TC Electronic 2290 style) — recreated as an
original algorithm, never the trademark.
**Type:** Effect · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A crystal-clear stereo **digital** delay — no tape wow, no bucket-brigade grit. Audio is written
into a circular delay line and read back at a fractional distance with **linear interpolation**, so
the echoes are clean and the delay time can be swept smoothly without zipper noise. Feedback
regenerates the repeats; a damping filter shapes their tone over time; a subtle modulation adds
gentle movement; and a stereo width control offsets the left and right taps for a wide image.

## Signal flow
```
in ─┬─────────────────────────────────────────────► dry ──┐
    │                                                       ├─► mix ─► out
    └─► [+ feedback] ─► damp (LP + HP) ─► delay line ─┬─► wet ┘
              ▲                                        │
              └──────── × Feedback ◄── interp read ◄───┘
                         (mod + stereo offset on read head)
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Time | 0–1 | 0.30 | base delay 20 ms … 1500 ms (quadratic feel) |
| 1 | Feedback | 0–1 | 0.40 | regeneration 0 … 0.95 (bounded — never runs away) |
| 2 | Modulation | 0–1 | 0.20 | subtle ~0.35 Hz detune of the read head (up to ~2.5 ms) |
| 3 | Damping | 0–1 | 0.55 | repeat tone: <0.5 dark, ~0.5 flat, >0.5 bright (LP 1.2–18 kHz) |
| 4 | Width | 0–1 | 0.35 | stereo offset between L/R taps (up to ~20 ms spread) |
| 5 | Mix | 0–1 | 0.35 | dry/wet balance |

## DSP notes
- Delay line is 192000 samples per channel (2.0 s @ 96 k); max usable delay 1.5 s.
- Feedback caps at 0.95 and the write-back path is soft-limited to ±1.5, so high feedback
  decays cleanly instead of self-oscillating to infinity.
- A static ~110 Hz high-pass in the feedback path keeps low-end build-up out of the repeats.
- All math is f32 (`Mathf.*`, explicit `f32()` casts); `process()` allocates nothing.

## GUI
A blue-LED rackmount unit (DDL-Series faceplate): a crisp segmented millisecond readout, an
animated tap-indicator lane whose travelling pulse speed tracks Time and whose trail decays by
Feedback, and six hand-built SVG knobs (vertical drag, wheel fine-tune with Shift, double-click to
reset). Accent `#5ad1ff` / `#80c8ff`. Fully self-contained — no external assets.

## Verification
`wasm-runner` renders 3 s @ 48 k → **VERDICT: PASS** (peak ≈ 0.54, no clipping, no NaN), every
parameter reported `✓ affects`.
