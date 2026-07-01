# Rack Cell

A crisp 12-bit **rack sampler** in the **Akai S900 / S1000** lineage — the workhorse that put clean digital sampling into every 80s/90s studio rack. Rack Cell plays a baked, self-authored sample pitched across the keyboard with an amp envelope and a resonant low-pass, kept clean at 12-bit for the crisp Akai clarity. **Crunch** can re-crush the playback down to lo-fi grit when you want it dirty.

## The sample
The embedded sample is **original and CC0** — synthesised at build time, not taken from any recording or library. It is a ~0.5 s bright **mallet / marimba** tone: a fundamental plus a prominent tuned overtone (≈4×) and a bright shimmer partial, each decaying at its own rate, with a sharp attack click. Quantised to 12-bit, stored as base64 Int16 PCM (24 kHz mono) and decoded into a float buffer at `init()`.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | ±1 octave playback pitch offset |
| Cutoff | 0–1 | Resonant low-pass base frequency |
| Decay | 0–1 | Amp decay time |
| Crunch | 0–1 | Extra bit/rate reduction — clean 12-bit → lo-fi grit |
| Attack | 0–1 | Amp attack time |
| Level | 0–1 | Output level |

## Design notes
- Each note resamples the shared buffer at `note/220 Hz × Tune`, linearly interpolated; one-shot playback with an AD amp envelope (attack-safe voice handling).
- 6-voice polyphony; resonant TPT state-variable low-pass; the Crunch grain is a shared bit-quantiser + sample-and-hold on the summed voices.
- No allocation in `process()`; the base64 sample decodes once at `init()`.

## Originality / sources
Original DSP **and** original sample — both written/synthesised from scratch for VibePlugin, released CC0. No third-party audio. The name **Rack Cell** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/rack-cell/spec.json` → **VERDICT: PASS** (all 6 params reactive).
