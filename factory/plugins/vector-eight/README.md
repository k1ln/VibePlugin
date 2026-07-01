# Vector Eight

A **vector-synthesis** polysynth in the **Sequential Prophet VS** lineage. Four oscillators — sine **A**, saw **B**, square **C** and a hollow-digital tone **D** — sit at the corners of a vector square and are blended by an X/Y position. The signature **Scan** orbits that position with an LFO, so the timbre is in constant motion even on a single sustained chord. 8-voice poly through a resonant two-pole low-pass.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (60 Hz → ~11 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Vector X | 0–1 | Horizontal centre of the vector blend (A/D ↔ B/C) |
| Vector Y | 0–1 | Vertical centre of the vector blend (A/B ↔ C/D) |
| Scan | 0–1 | Orbit speed **and** radius of the auto-moving vector position |
| Level | 0–1 | Output level |

## Design notes
- Four waveshapers per voice share one phase accumulator; bilinear corner weights blend them by the vector position.
- **Scan** drives a two-axis LFO (X = sin, Y = cos at 0.73× for a drifting Lissajous orbit), clamped to the square — this is what keeps a held note evolving.
- 8-voice polyphony, round-robin allocation, resonant TPT state-variable low-pass per voice.
- Output gain-staged so an 8-voice chord stays below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Vector Eight** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/vector-eight/spec.json` → **VERDICT: PASS** (all 6 params reactive).
