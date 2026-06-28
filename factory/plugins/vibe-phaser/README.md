# Vibe Phaser — photocell vibe / phaser

**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)

## What it is
An original take on the classic optical "vibe" modulation, modelled without copying any
product. A **four-stage first-order all-pass** phase-shift network is swept by a slow,
**asymmetric "photocell" LFO** — a lamp seen through a light-dependent resistor, which
heats up fast and cools down slowly. That uneven, gamma-shaped control voltage drags the
all-pass notches around at different rates, giving the watery, throbbing movement of a
vintage optical vibe on an otherwise steady tone.

Two voices:
- **Chorus** — the phase-shifted path is blended back with the dry input, so the sweeping
  comb notches shimmer (the shimmering "vibe" sound).
- **Vibrato** — 100% wet swept all-pass: pure phase/pitch wobble, no dry signal.

The two stereo channels run their LFOs a quarter-cycle apart for a wide, living image.

## Signal flow
```
in ─► [ AP1 ► AP2 ► AP3 ► AP4 ]  swept by photocell LFO
                   │
   chorus: dry + wet ──► mix ──► out
   vibrato: 100% wet  ───────────► out
```
Each all-pass cell centres on a staggered frequency (220 / 520 / 1150 / 2400 Hz) and is
modulated by the same asymmetric optical sweep, scaled per stage so the notches glide
unevenly. The LFO is `sin → 0..1 → gamma curve`, blended toward the raw sweep at low
Intensity so the knob stays musical end to end.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Rate      | 0–1 | 0.32 | throb speed, exponential ≈0.05 … 12 Hz |
| 1 | Depth     | 0–1 | 0.70 | how far the cells sweep |
| 2 | Mode      | 0/1 | 0    | 0 = Chorus, 1 = Vibrato (100% wet) |
| 3 | Intensity | 0–1 | 0.60 | optical curve shaping + sweep range (harder, more asymmetric throb) |
| 4 | Mix       | 0–1 | 0.50 | dry/wet blend (Chorus only; Vibrato is always 100% wet) |

## Test result
```
output:  rms=0.19463  peak=0.48232  dc=0.00029  nan=0
checks:  present=true  finite=true  noClip=true  paramsReactive=true
all 5 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) — a steady tone throbbing and washing under the
optical sweep.
