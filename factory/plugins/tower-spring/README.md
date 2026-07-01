# Tower Spring

An original model of a **tall studio spring-reverb tank** — the long, bright,
hi-fi spring sound of broadcast and mastering rooms (the BX20 lineage), rather
than the short, lo-fi twang of a guitar-amp tank. Pure algorithm, no samples.

## How it works

The signature spring "boing" is **dispersion**: high frequencies travel faster
than lows down a coiled spring, so a transient smears into a chirp. Tower Spring
models this with a long cascade of **12 dispersive all-pass stages** per channel,
then feeds the chirped signal into a **long, lightly-modulated stereo feedback
delay** — the tall tank — whose feedback (capped at 0.985) produces a smooth,
several-second decay. A gentle low-frequency tilt keeps the tail bright and hi-fi,
a frequency-tracking one-pole damps the high end for a natural roll-off, and the
loop is soft-saturated and DC-blocked so an impulse always decays to silence.

Two **decorrelated tank lengths** (different "spring tensions") ring on the left
and right; a mid/side stage spreads them for the Width control. A slow (~0.6 Hz)
fractional modulation of each tank length adds the subtle studio shimmer.

## Parameters

| # | Name  | Range | Default | Description |
|---|-------|-------|---------|-------------|
| 0 | Mix   | 0–1   | 0.35    | Dry/wet. Mix = 0 is essentially the dry input. |
| 1 | Decay | 0–1   | 0.6     | Tank feedback (0.55→0.985). Clearly lengthens the tail from short to several seconds. |
| 2 | Tone  | 0–1   | 0.62    | Dark→bright tilt. Raises the tail-damping cutoff (1.8 k→10.8 kHz) and the low-shelf cut for a clean, hi-fi top. |
| 3 | Boing | 0–1   | 0.5     | Dispersion / chirp amount — all-pass coefficient and stage length, plus transient pre-emphasis. |
| 4 | Width | 0–1   | 0.7     | Stereo spread of the two decorrelated spring loops (mid/side). |

## GUI

A tall vintage studio unit with three shimmering vertical springs that ripple
and chirp on a `requestAnimationFrame` helix animation (energy driven by Decay +
Boing), a teal + sage faceplate, and a large hero **Decay** dial. Every control
is a hand-built SVG knob: vertical drag to turn, wheel to fine-tune, double-click
to reset, with a live value readout. Self-contained — no external assets.

## Test result

`node factory/tools/wasm-runner.mjs … --seconds 3` → **VERDICT: PASS**

- output: rms=0.211, peak=0.528, dc≈0.0002, nan=0 (no clipping, well under 1.0)
- checks: present, finite, noClip, paramsReactive all true
- every parameter affects the output: Mix ✓, Decay ✓, Tone ✓, Boing ✓, Width ✓
