# Flutter Echo — wow & flutter tape delay

**Modeling target:** Tape delay physical model (wow/flutter) — an original take, no trademark
**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)
**Accent:** `#ffb86a` / `#9a7bff`

## What it is
A physically-modelled tape delay that foregrounds the **wow and flutter** of an unstable tape
transport. A fractional-read delay line has its read head modulated by a slow **wow** LFO
(~0.45 Hz) plus a faster **flutter** LFO (~6.7 Hz) and a little drift, so every repeat is
audibly pitch-warbled and smeared. Each pass through the loop adds **tape saturation** and
**high-frequency loss**, so echoes darken and degrade as they stack. The **Warble** control
scales the modulation from subtle vintage warmth to seasick wobble.

## Signal flow
```
in ─► [+ saturated feedback] ─► tape sat ─► tape (delay line, warbled read head)
                                                   │
       wet ◄── loop HF-loss LP ◄── fractional read (wow + flutter + drift)
       │
   dry/wet Mix ─► out
```
The read position = glided base delay (motor inertia) + wow·depth + flutter·depth, with a
small per-channel phase offset for stereo width. Feedback is bounded at 0.95 and the recorded
signal is soft-saturated, so the loop degrades musically instead of clipping.

## Parameters
| # | Name     | Range | Default | Effect |
|---|----------|-------|---------|--------|
| 0 | Time     | 0–1 | 0.45 | delay time 40 ms … 900 ms (motor glides between settings) |
| 1 | Feedback | 0–1 | 0.50 | repeat regeneration 0 … 0.95 (stacking, degrading echoes) |
| 2 | Warble   | 0–1 | 0.40 | wow + flutter depth — warmth → seasick pitch warble |
| 3 | Tone     | 0–1 | 0.55 | tape HF loss per repeat (dark) … (bright) |
| 4 | Mix      | 0–1 | 0.50 | dry/wet blend |

## GUI
A warm vintage tape deck: two spinning reels (speed tracks Time), warbling repeat waveforms
that pitch-wobble and smear via `@keyframes`, a sepia + violet worn-tape aesthetic with grain,
bulb flicker and a live VU strip. Custom SVG/CSS knobs — drag to turn, double-click to reset,
wheel to fine-tune, arrow keys for keyboard. Every control is wired through `window.vstai.setParam`.

## Test result
```
checks: present=true  finite=true  noClip=true  paramsReactive=true
output: peak≈0.52
all 5 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (plucked riff → warbling tape echoes).
