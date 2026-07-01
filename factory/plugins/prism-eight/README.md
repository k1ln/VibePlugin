# Prism Eight

A flexible, slightly metallic 8-voice analog/hybrid polysynth in the **Rhodes Chroma** lineage. Its signature is **ring modulation** between the two oscillators: turn **Ring** up and the detuned saws cross into clangorous, bell-like, inharmonic territory — the kind of patchable, unconventional voice the Chroma was prized for. Each voice runs two detuned saws through a resonant two-pole low-pass with its own envelope.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (55 Hz → ~11 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Ring | 0–1 | Ring-modulation depth — harmonic saws → clangorous bell tones |
| Detune | 0–1 | Detune between the two oscillators (fatness) |
| Level | 0–1 | Output level |

## Design notes
- 8-voice polyphony, round-robin allocation, per-voice amp + filter envelopes.
- The two oscillators are multiplied to form a ring-mod product; **Ring** crossfades from the dry saw mix into that product while widening osc 2's ratio, so the result becomes increasingly inharmonic.
- Resonant TPT state-variable two-pole low-pass per voice.
- Output gain-staged so an 8-voice chord stays below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Prism Eight** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/prism-eight/spec.json` → **VERDICT: PASS** (all 6 params reactive).
