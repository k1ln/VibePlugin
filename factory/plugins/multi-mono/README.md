# Multi Mono

An expressive single-VCO monosynth in the **Multimoog** lineage — the performance mono built for lip/aftertouch-style vibrato and growl. One oscillator (sawtooth + a variable-width pulse) plus a square sub run through a Moog-style resonant low-pass with its own envelope. The signature **Osc Mod** drives an LFO into *both* pitch (vibrato) and pulse-width simultaneously, so a held note breathes and snarls instead of sitting still.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (50 Hz → ~10 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Osc Mod | 0–1 | LFO depth into pitch vibrato **and** pulse-width (the expression) |
| Sub | 0–1 | Level of the square sub-oscillator (one octave down) |
| Level | 0–1 | Output level |

## Design notes
- Last-note-priority monophony with a short glide between notes.
- Resonant SVF low-pass (TPT topology) with a dedicated decaying filter envelope.
- A single ~5.5 Hz LFO modulates pitch (±3 %) and pulse-width together, scaled by Osc Mod.
- Output gain-staged so peaks stay below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Multi Mono** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/multi-mono/spec.json` → **VERDICT: PASS** (all 6 params reactive).
