# Grit Wave

A gritty digital **wavetable** polysynth in the **Waldorf Microwave** lineage — the harsher, more aliased sister to the factory's smooth **Wave Storm**. An 8-frame wavetable (built at init, morphing from near-sine up to bright, formant-heavy frames) is scanned by **Position**; the signature **Scan** sweeps that position with an LFO so the timbre morphs continuously on a single held note; and **Drive** adds saturation plus digital grain for the characterful edge. 8-voice poly through a resonant two-pole low-pass.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (60 Hz → ~11 kHz, exponential) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| Position | 0–1 | Base frame in the 8-frame wavetable |
| Scan | 0–1 | LFO sweep speed **and** depth over the wavetable (movement) |
| Drive | 0–1 | Saturation + digital grain (the grit) |
| Level | 0–1 | Output level |

## Design notes
- `buildWavetable()` synthesises 8 frames of 256 samples at init: harmonic count and a moving formant peak both climb with the frame index, so higher frames are bright and vocal/gritty.
- Playback double-interpolates (between the two nearest frames, and linearly within a frame); Scan adds an LFO offset to the frame position so a held note keeps morphing.
- `Drive` applies `tanh` saturation with gain compensation for the aggressive digital edge.
- 8-voice polyphony; resonant TPT state-variable low-pass. Output gain-staged below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — the wavetable is synthesised at init. The name **Grit Wave** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/grit-wave/spec.json` → **VERDICT: PASS** (all 6 params reactive).
