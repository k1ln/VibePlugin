# Vowel Box — talk-box / formant filter

**List entry:** Talk box (formant) — *talk-box formant filter* (effect)
**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)

## What it is
A talk-box-style **formant filter** that makes your input *talk*. Three resonant band-pass
filters track the F1/F2/F3 formant peaks of the vowels **A E I O U**. As the **Vowel**
control sweeps, the three formant centre frequencies (and their relative gains) morph smoothly
between adjacent vowel shapes, so the spectral peaks slide between vowels just like a mouth
reshaping. A pre-gain **Drive** adds harmonics for the formants to bite into, **Resonance**
sharpens the peaks, and **Mix** blends against dry. Best on rich, harmonic sources (synths,
guitars, drums, pads).

## Signal flow
```
in ─► ×Drive ─► soft-clip (harmonics) ─┬─► BP formant 1 (F1) ─┐
                                       ├─► BP formant 2 (F2) ─┼─► sum·gains ─► soft-clip ─► ×Level ─► wet/dry
                                       └─► BP formant 3 (F3) ─┘
```
Each formant is a TPT/Zavalishin state-variable band-pass (stable, cheap, no per-sample alloc).
The vowel tables hold classic male-voice F1/F2/F3 centre frequencies; the Vowel control linearly
interpolates between the five vowel columns.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Vowel     | 0–1 | 0.00 | morph A → E → I → O → U (moves the 3 formant peaks) |
| 1 | Resonance | 0–1 | 0.60 | formant sharpness / Q (≈2 … 28) |
| 2 | Drive     | 0–1 | 0.45 | pre-gain + saturation (×1 … ×12) feeding the filters |
| 3 | Mix       | 0–1 | 1.00 | dry/wet blend (0 ≈ dry) |
| 4 | Level     | 0–1 | 0.70 | output level (×0 … ×1.4) |

## GUI
A bespoke "Formant Talker" panel in hot magenta→gold: an animated **mouth / vocal tract** whose
lips open, spread and round as you move Vowel, over a live **spectrum curve** with three glowing
formant-peak bumps that slide between A E I O U. Custom SVG knobs (vertical drag, double-click to
reset, wheel fine-tune), live value readouts, and a `requestAnimationFrame` scene that pauses when
the tab is hidden.

## Test result
```
checks: present=true  finite=true  noClip=true (peak 0.98)  paramsReactive=true
all 5 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (clean plucked riff → vowel formants).
