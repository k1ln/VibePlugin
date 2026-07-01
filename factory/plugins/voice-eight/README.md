# Voice Eight

A fat unison analog polysynth in the **Oberheim Four/Eight Voice** lineage — the big stacked-SEM choir/brass machine. Each of its 8 voices layers two detuned sawtooths plus a square sub-oscillator through a smooth resonant low-pass with its own contour, and a wide unison **Spread** fans the detune for that huge, slightly-out-of-tune analog wall.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (50 Hz → ~9 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Spread | 0–1 | Unison detune between the two saws (fattness / chorus width) |
| Sub | 0–1 | Level of the square sub-oscillator |
| Level | 0–1 | Output level |

## Design notes
- 8-voice polyphony, round-robin voice allocation, per-voice amp + filter envelopes.
- Per-voice resonant SVF low-pass (TPT topology, stable across the full cutoff range).
- Two sawtooth oscillators per voice detuned by up to ~5 %; the square sub tracks an octave below.
- Output is gain-staged so an 8-voice chord stays below clipping (peak < 1.0).

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Voice Eight** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs factory/plugins/voice-eight/assembly.ts --synth --params factory/plugins/voice-eight/spec.json` → **VERDICT: PASS** (all 6 params reactive).
