# Rack Echo — clean 80s studio rack digital delay with a doubler

**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)
**Lineage:** classic studio rack digital delay with doubler modulation — modelled, not copied.

## What it is
A pristine, hi-fi digital delay in the 1U studio-rack tradition: crisp repeats with **no tape
grit, no companding, no hold/freeze**. Distinct from the tape echoes and PCM-style hold delays
in the factory. A subtle stereo LFO modulates the read position so a single repeat can be
fattened into a wide chorused **double / slapback** — the signature doubler mode. The feedback
path runs through a one-pole low-pass (**Tone**) so successive repeats gently roll off their
high end, like the rack converters of the era. **Mix at 0 is dry.**

## Signal flow
```
in ─► delay line ──read @ (Time + LFO·Mod + doublerOffset)──► wet tap (linear interp)
         ▲                                                       │
         └────────── feedback ◄── LP(Tone) ◄────────────────────┘
out = dry·(1-Mix) + wet·Mix          (feedback loop clamped; output clamped ±1)
```

The read position is the smoothed base delay (zipper-free) plus an LFO term whose depth is set
by **Modulation**, plus a small fixed doubler offset so even at low feedback a single repeat
widens into a thick slapback double. Per-channel LFO phase offset gives stereo width.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Time       | 0–1 | 0.35 | delay time, 20 ms … 1000 ms (perceptual curve) |
| 1 | Feedback   | 0–1 | 0.35 | repeat regeneration, 0 … 0.92 |
| 2 | Modulation | 0–1 | 0.30 | doubler / chorus depth on the repeats (delay → double) |
| 3 | Tone       | 0–1 | 0.65 | repeat HF: feedback low-pass 1.2 kHz … 16 kHz |
| 4 | Mix        | 0–1 | 0.40 | dry/wet blend (0 = dry) |

## GUI
A slim black **1U rack face** with brushed-metal grain and mounting ears: a cyan time readout
(live ms, FB/MIX meta, a violet **DELAY ⇄ DOUBLE** mode tag that lights when Modulation is up)
beside a mirrored repeat-impulse **scope** — cyan L / violet R spikes whose spacing follows
Time, whose decay follows Feedback, and which split apart and jitter as Modulation rises.
Five hand-built knobs (drag, wheel, double-click to reset, arrow keys). Accent `#6ad0ff` /
`#b0a0ff`. Self-contained: inline CSS/JS/SVG, no external assets.

## Test result
```
output:  rms=0.20779  peak=0.54954  dc=0.00038  nan=0
checks:  present=true  finite=true  noClip=true  paramsReactive=true
all 5 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav).
