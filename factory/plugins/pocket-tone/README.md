# Pocket Tone — lo-fi mini-digital pocket synth

**List entry:** Instruments — *lo-fi mini digital synth* (Casio VL-1 lineage, modelled as an original)
**Type:** Instrument · **Voices:** 6 · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A deliberately small, charming toy synth in the spirit of the early-80s pocket calculator-synths.
Six voices share one of **five selectable single-cycle timbres**, each built from a short additive or
pulse formula so every preset has its own thin, unmistakably cheap-digital character. A simple **AR**
amplitude contour, a touch of **pitch vibrato**, and a **BITS** lo-fi crunch (combined bit-depth and
sample-rate reduction) complete the gadget. Not lush — pocket-sized and playful by design.

## Voices (stepped 0–4)
| # | Name | Recipe |
|---|------|--------|
| 0 | Piano   | sine + 2nd/3rd/5th harmonics — bright and narrow |
| 1 | Fantasy | odd harmonics with a slight inharmonic shimmer — hollow bell |
| 2 | Violin  | saw + a sine sweetener — buzzy thin string |
| 3 | Flute   | near-pure sine + a whisper of 2nd — soft and breathy |
| 4 | Guitar  | 25%-duty pulse + a little body — plucky cheap-digital |

## Signal flow
```
noteOn(Hz) ─► single-cycle voice osc ─► AR env ─► sum 6 voices
            (+ ~6 Hz pitch vibrato)              │
                                                 ▼
                          BITS: bit-depth quantize + sample-rate hold ─► Level ─► out
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Voice   | 0–4 (step 1) | 0 | timbre select (piano/fantasy/violin/flute/guitar) |
| 1 | Attack  | 0–1 | 0.04 | AR attack, 1 ms … 0.6 s |
| 2 | Release | 0–1 | 0.30 | AR release, 20 ms … 1.8 s |
| 3 | Vibrato | 0–1 | 0.25 | ~6 Hz pitch wobble depth (0 … ±1.2%) |
| 4 | Bits    | 0–1 | 0.35 | lo-fi crunch — 16-bit/clean … ~4-bit + heavy SR reduction |
| 5 | Level   | 0–1 | 0.60 | output level |

## GUI
A bespoke **pocket calculator-synth**: a tiny grey 80s gadget with a moulded speaker grille, a mini
olive **LCD** showing the current voice, live readout, held notes and an animated **blocky waveform**
(the BITS knob visibly steps the trace), rubbery **voice pads** that light up in pink, five custom SVG
knobs (vertical drag, double-click reset, wheel/arrow fine-tune) and a playable mini keyboard
(mouse/touch + A–K computer keys). Pink `#ff5a9e` + cyan `#43d6ff` accents. Self-contained HTML —
no external assets.

## Test result
```
checks: present=true  finite=true  noClip=true  paramsReactive=true
all 6 params ✓ affect output      VERDICT: PASS ✅
output: rms=0.086  peak=0.155  (bounded, generous headroom)
```
Preview render: [preview.wav](preview.wav) (clean arpeggio through the pocket synth).
