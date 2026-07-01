# Brit Distortion — amp-in-a-box British distortion + 3-band tone stack

**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)
**Modelled after:** *Marshall Guv'nor* (amp-in-a-box distortion with a passive tone stack) — modelled, never copied; no trademark ships in any file.

## What it is
A cranked British-amp distortion in a box. The input is tightened with a high-pass, slammed
through a hot gain stage, then run into a **soft-knee / hard-rail clipper** that behaves like
the diode + op-amp pair of an amp-in-a-box gain stage (crunch climbing into roar). The clipped
signal then feeds an **interactive passive 3-band tone stack** — a Bass low shelf, a Mid peaking
bell around 650 Hz, and a Treble high shelf. The bands **load each other** the way a real passive
FMV network does (lots of Bass slightly veils the top; a Mid scoop opens the extremes), so you can
dial classic scooped crunch or mid-forward roar.

## Signal flow
```
in ─► HP ~70 Hz ─► ×Gain ─► soft-knee→tanh rail clip ─► makeup
   ─► [ Bass low-shelf  +  Mid bell ~650 Hz  +  Treble high-shelf ]  (interactive)
   ─► stack makeup ─► ×Level ─► out
```

## Parameters
| # | Name   | Range | Default | Effect |
|---|--------|-------|---------|--------|
| 0 | Gain   | 0–1 | 0.55 | input drive ×1 … ×60 — crunch → roar |
| 1 | Bass   | 0–1 | 0.50 | low shelf ~180 Hz (×0.35 … ×2.2) |
| 2 | Mid    | 0–1 | 0.50 | peaking bell ~650 Hz, deep scoop … mid-forward (×0.18 … ×2.6) |
| 3 | Treble | 0–1 | 0.55 | high shelf >2.5 kHz (×0.30 … ×2.4) |
| 4 | Level  | 0–1 | 0.60 | master output (0 … 1.2) |

The Bass/Mid/Treble controls interact: turning Bass up loads (darkens) the highs, and a mid
scoop fattens the lows — the hallmark of a passive British tone stack.

## GUI
A bespoke **amp-in-a-box faceplate**: black-tolex cabinet with corner protectors, a brushed-gold
front panel and a script logo, a glowing power jewel, three chicken-head EQ knobs with conic value
rings sitting over a woven tweed grille, and a live amber clipping scope that shows the gain stage
hitting its rails while the tone stack reshapes the waveform. Knobs are drag (vertical),
shift-drag (fine), wheel, arrow-key and double-click-to-reset. Accent `#ffcf3d` / ember `#d94a2a`.

## Test result
```
output:   rms=0.07174  peak=0.26280  dc=0.00009  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
all 5 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav).
