# Robot Voice — channel vocoder

**Type:** Effect · **Params:** 5 · **Samples:** none (pure algorithm)
**Models:** a classic channel vocoder of the analog filter-bank / EMS-style school — built
from scratch, not a clone of any product.

## What it is
A **channel vocoder**. Your input is the *modulator*: it is split into a bank of band-pass
bands, and each band is tracked by an envelope follower that measures how much energy lives
there at every instant. An **internal carrier** — a buzzy sawtooth blended toward white noise —
is filtered into the *same* bands, and each carrier band is multiplied by the matching
modulator envelope. Summed back together, the flat, droning carrier is forced to wear the
moving spectral envelope of your input: speak or feed it dynamic, voiced material and the
carrier *talks*. That is the unmistakable robotic timbre.

## Signal flow
```
                        ┌─ band-pass[b] ─ envelope follower[b] ─┐  (per band)
input (modulator) ──────┤                                       ├─► × ──┐
                        └───────────────────────────────────────┘       │
                                                                         Σ ─► clip ─► wet
internal carrier  ──────► band-pass[b] (formant-shifted) ────────────────┘
 (saw ⇄ noise)

out = dry·(1−Mix) + wet·Mix
```

The bands are state-variable band-pass sections on a logarithmic grid (≈180 Hz … 6.5 kHz).
The carrier bank can be **formant-shifted** independently of the analysis bank, which slides
the imposed vowel up or down for chipmunk / monster colours. Output is normalised by
`√bands` and soft-clipped so the peak stays bounded near 1.0.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Bands | 0–2, step 1 | 1 (12) | analysis/synthesis band count: 8 / 12 / 16 |
| 1 | Carrier | 0–1 | 0.15 | carrier source: sawtooth (0) ⇄ white noise (1) |
| 2 | Formant | 0–1 | 0.50 | shifts the carrier band mapping ±1 octave (0.5 = neutral) |
| 3 | Resonance | 0–1 | 0.60 | band-pass Q — wide & smooth (0) ⇄ narrow & resonant (1) |
| 4 | Mix | 0–1 | 1.00 | dry input ⇄ fully vocoded output |

More bands → sharper spectral tracking and a more intelligible, articulate robot. Noise in
the carrier adds breathy sibilance; saw gives the hard buzzy machine tone.

## GUI
A retro sci-fi green-on-black console. A bank of vertical LED band meters dances like a
robot mouth — a roaming formant hump and a syllable gate animate it on a
`requestAnimationFrame` loop — over a live cyan speech waveform, behind CRT scanlines. The
Bands selector is a segmented switch; Carrier, Formant, Resonance and Mix are hand-drawn SVG
knobs (drag vertically, wheel to fine-tune, double-click to reset). Every control is wired to
`window.vstai.setParam` and initialised to its default. Accent `#54ff9a` / `#54d1ff`.

## Files
- `assembly.ts` — the DSP (AssemblyScript → WASM)
- `gui.html` — the self-contained animated GUI
- `spec.json` — name, params, theme, paths
- `robot-voice.vstai` — packed plugin
- `preview.wav` — 3 s offline render
