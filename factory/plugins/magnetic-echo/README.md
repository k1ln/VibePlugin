# Magnetic Echo

An original model of a **multi-head magnetic-drum echo** — the warm, rhythmic
delay built around a single rotating magnetic drum read by several fixed
playback heads. One circulating loop is read by **four heads** spaced evenly
around the drum (at `1/4`, `2/4`, `3/4` and the full loop), and a **Head Mode**
selects which combination sounds — so each setting gives a different rhythmic
multi-tap pattern. Recirculating **Swell** feedback stacks the repeats, each
pass is bandwidth-limited and gently saturated for a vintage warmth, and a
subtle mechanical **flutter** wobbles the transport for that unstable analog
character. No samples — pure algorithm.

## Controls

| Param | Index | Range | Default | What it does |
|-------|-------|-------|---------|--------------|
| **Time**  | 0 | 0–1            | 0.40 | Drum speed / loop length, ~90 ms (fast) to ~750 ms (slow). |
| **Swell** | 1 | 0–1            | 0.45 | Recirculating feedback — how many times the repeats build. |
| **Heads** | 2 | 0–3 (step 1)   | 1    | Selects the active playback-head combination (see below). |
| **Tone**  | 3 | 0–1            | 0.55 | Post low-pass on the echoes, dark to bright. |
| **Mix**   | 4 | 0–1            | 0.45 | Dry / wet blend. |

### Head modes

- **I — Single Head (Slap):** only the full-loop head sounds — one clean repeat.
- **II — Even Eighths:** heads 2 + 4 — evenly spaced taps.
- **III — Triplet Gallop:** heads 1 + 3 + 4 — an uneven galloping pattern.
- **IV — Full Swell:** all four heads — dense, washing multi-tap.

## How it works

- **Magnetic drum** — one interpolated, wrap-safe circular delay line per
  channel (the rotating drum surface). A single shared write head records onto
  it; four virtual playback heads read at fractional offsets of the loop length.
- **Head selector** — each mode lights a weighted subset of the four heads,
  giving distinct rhythmic echo figures from the same loop.
- **Warm recirculation** — the feedback path runs through a one-pole HF-loss
  filter (drum + head bandwidth limit), a rumble/DC blocker, and a soft cubic
  saturator, so each repeat darkens and compresses musically.
- **Flutter** — a slow ~0.7 Hz wow plus a faster ~6.3 Hz flutter modulate the
  effective head distance, drifting the pitch slightly; the two channels wobble
  in anti-phase for a touch of width.
- **Bounded** — feedback is scaled to a safe ceiling, the loop is saturated, and
  the output is clamped to `±1`, so dense swells ring but never diverge or clip.

## GUI

A bespoke vintage-Italian hardware face: a spinning brushed-metal magnetic drum
with four lit playback heads around its rim, amber echo-pulse rings rippling out
in time with the repeats, hand-drawn canvas knobs with glowing accent value
arcs, and a Roman-numeral head-mode selector that lights the active heads on the
drum. Drag a knob vertically to turn it, double-click to reset, wheel to
fine-tune. Accent `#e0a85a` / `#ffd089`.

> Original design. Not affiliated with, or endorsed by, any hardware
> manufacturer; no trademarks are used in the shipped plugin.
