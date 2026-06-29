# Pitch Shifter — delay-line harmonizer

**Type:** Effect · **Params:** 4 · **Samples:** none (pure algorithm)

## What it is
A real-time pitch shifter / harmonizer in the classic rack-harmonizer tradition. Audio is written into
a circular delay line that is read back by **two** read pointers drifting at a rate set by the pitch
ratio (`1 − ratio` samples per sample, so a ratio > 1 shrinks the read delay and raises the pitch).
As each pointer sweeps across its window it is faded in and out
with a raised-cosine crossfade, so the discontinuity at the wrap is masked and the shifted voice stays
click-free. The shifted voice is regenerated through a bounded feedback path (cascading
arpeggios at high settings) and blended with the dry signal. A 12 Hz one-pole smooths the ratio so
moving **Shift**/**Fine** never zips.

## Signal flow
```
in ─► [circular line] ─┬─ tap A (phase A) ─╮
                       └─ tap B (phase B) ─┴─ raised-cosine crossfade ─► shifted voice
   feedback:  line ◄── shifted voice × Feedback (≤ 0.85)
   out:  dry × (1−Mix) + shifted × Mix
   ratio = 2^((Shift + Fine/100) / 12),  pointers drift at (1 − ratio)/sample
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Shift    | −12 … +12 st (step 1) | +7 | transpose interval in semitones |
| 1 | Fine     | −100 … +100 cents | 0 | fine detune in cents |
| 2 | Feedback | 0 … 1 | 0 | regenerates the shifted voice (≤ 0.85) |
| 3 | Mix      | 0 … 1 | 0.5 | dry/wet blend |

## GUI
A bespoke rack-unit harmonizer: a green LCD reads out the interval (semitones / cents / pitch ratio),
an animated interval ladder shows the dry and shifted "voice" bars — the wet bar slides up or down to
the chosen interval, joined to the dry bar by a glowing pitch ribbon — over a slowly scanning shimmer.
Four hand-built SVG knobs (270° value arc in the `#7ad0ff → #b0a0ff` accent) drag vertically, wheel to
nudge, hold Shift for fine, double-click to reset. Self-contained HTML/CSS/JS, no external assets.

## Test result
```
output:  rms=0.28850  peak=0.49988  dc=0.00030  nan=0
checks:  present=true  finite=true  noClip=true  paramsReactive=true
all 4 params ✓ affect output      VERDICT: PASS ✅
```
Pitch direction verified with a 440 Hz sine, fully wet, no feedback (dominant peak vs expected):
−12 st → 217 Hz (~220), −7 → 292 (~294), −3 → 369 (~370), +3 → 524 (~523), +7 → 662 (~659),
+12 → 885 (~880); +100 c → 466, −100 c → 415. Shift up raises the pitch, shift down lowers it.

Preview render: [preview.wav](preview.wav) (clean plucked riff → fifth-up harmony).
