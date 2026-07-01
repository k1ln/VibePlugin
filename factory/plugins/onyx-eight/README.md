# Onyx Eight

A bright, punchy 8-voice analog polysynth in the **Oberheim OB-8** lineage — the sister to the factory's warm 2-pole **Voice Eight**, but steeper and more aggressive. Each voice runs a sawtooth plus a pulse whose width is continuously swept by a per-patch **PWM** LFO, through a cascaded **four-pole** resonant low-pass with its own envelope. A unison **Spread** detunes the two oscillators for the classic brassy OB pad.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Four-pole low-pass base frequency (60 Hz → ~12 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis (strong — the two stages cascade) |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| PWM | 0–1 | Depth of the pulse-width sweep (animation / movement) |
| Spread | 0–1 | Unison detune between saw and pulse (fatness / brass width) |
| Level | 0–1 | Output level |

## Design notes
- 8-voice polyphony, round-robin allocation, per-voice amp + filter envelopes.
- **Four-pole** low-pass built from two cascaded TPT state-variable LP stages — steeper and brighter than Voice Eight's single 2-pole.
- A shared ~4.2 Hz PWM LFO sweeps the pulse duty cycle for constant movement even on held chords.
- Output gain-staged so an 8-voice chord stays below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Onyx Eight** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/onyx-eight/spec.json` → **VERDICT: PASS** (all 6 params reactive).
