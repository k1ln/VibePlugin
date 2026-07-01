# Realm FM

An **FM + filter** hybrid synth in the **Yamaha SY77 / SY99 "RCM"** lineage (Realtime Convolution & Modulation). Where a pure FM synth is all operators, Realm FM runs a two-operator FM carrier **through a resonant analog-style low-pass with its own envelope** — the SY77 idea of pairing bright digital FM with subtractive, evolving shaping. **Ratio** and **Index** set the FM timbre; **Cutoff** and **Env Amount** sweep the filter for the vocal, moving RCM character. 8-voice poly.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Ratio | 0.5:1 – 7:1 | Modulator : carrier FM ratio (quantised to half-integers) |
| Index | 0–1 | FM modulation depth (harmonic content) |
| Cutoff | 0–1 | Low-pass base frequency |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Decay | 0–1 | Amp decay time (0.1 → ~2.5 s) |
| Level | 0–1 | Output level |

## Design notes
- Per voice: a two-operator FM pair (modulator → carrier) feeds a resonant TPT state-variable low-pass with a decaying filter envelope, so each note starts open and settles.
- 8-voice polyphony, round-robin allocation; attack → decay amp envelope.
- Output soft-clipped with `tanh` so single notes are present and chords stay clean.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Realm FM** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/realm-fm/spec.json` → **VERDICT: PASS** (all 6 params reactive).
