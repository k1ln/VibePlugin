# Polar Six

A warm 6-voice analog polysynth in the **Sequential / Chroma Polaris** lineage. Its signature is oscillator **hard sync**: a second sawtooth is locked to the first oscillator's period but runs at a higher ratio set by **Sync**, so sweeping Sync gives the classic tearing, formant-rich sync-lead harmonics. A third gently-detuned saw layer (**Detune**) adds analog warmth, and a smooth resonant two-pole low-pass with its own envelope shapes the tone.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (55 Hz → ~10 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Sync | 0–1 | Hard-sync ratio of osc 2 (1×→~3.2×) — the sync-lead brightness |
| Detune | 0–1 | Level & detune of the warmth saw layer |
| Level | 0–1 | Output level |

## Design notes
- 6-voice polyphony, round-robin allocation, per-voice amp + filter envelopes.
- **Hard sync**: osc 2's phase is reset (phase-aligned) every time the master oscillator wraps, so its waveform tears at the master period — the more `Sync`, the higher osc 2's ratio and the brighter/reedier the tone.
- A third slightly-detuned saw adds the analog beat/warmth; resonant TPT two-pole low-pass per voice.
- Output soft-clipped with `tanh` so single notes are present and chords stay clean.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Polar Six** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/polar-six/spec.json` → **VERDICT: PASS** (all 6 params reactive).
