# Halo Ensemble

A lush preset **ensemble polysynth** in the **Korg Lambda / Sigma** lineage — a fully-polyphonic string/organ machine of the kind that defined the warm, wide string-pad sound of the late 70s and early 80s. Each of 8 voices runs two detuned oscillators morphed by **Tone** from bowed strings (saw) toward hollow organ (pulse), through a low-pass, and the whole poly mix passes into the signature **Ensemble** — a three-tap BBD-style modulated chorus that produces the wide, shimmering string-machine wash.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tone | 0–1 | Morphs each voice from strings (saw) → hollow organ (pulse) |
| Cutoff | 0–1 | Shared low-pass base frequency |
| Attack | 0–1 | Amp attack time (up to ~0.5 s for slow swells) |
| Ensemble | 0–1 | Depth of the three-tap modulated chorus (the wash) |
| Shimmer | 0–1 | Per-voice oscillator detune (fatness / width) |
| Level | 0–1 | Output level |

## Design notes
- 8-voice paraphonic-style ensemble; organ-style envelope (attack → full sustain while held → release).
- The **Ensemble** is a single delay line read by three independently-modulated taps (0.6 / 0.87 / 1.13 Hz LFOs) split L/R for a wide true-stereo chorus — the classic string-machine "ensemble" effect.
- Output soft-clipped with `tanh`, so a single note is present and full chords stay clean.
- No allocation in `process()`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Halo Ensemble** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/halo-ensemble/spec.json` → **VERDICT: PASS** (all 6 params reactive).
