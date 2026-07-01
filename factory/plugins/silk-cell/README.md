# Silk Cell

A warm **8-bit sampler** in the **E-mu Emulator II** lineage — the machine behind a thousand lush 80s string and choir pads. Silk Cell plays a baked, self-authored sample pitched across the keyboard with an amp envelope and a resonant low-pass, and a gentle **Vibrato** LFO keeps a held note breathing.

## The sample
The embedded sample is **original and CC0** — synthesised at build time, not taken from any recording or library. It is a ~0.6 s warm detuned-saw **string/choir ensemble** tone (three detuned saw layers through a one-pole warmth filter with a subtle chorus), quantised to 8-bit for the Emulator II grain, stored as base64 Int16 PCM (24 kHz mono) and decoded into a float buffer at `init()`.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | ±1 octave playback pitch offset |
| Cutoff | 0–1 | Resonant low-pass base frequency |
| Attack | 0–1 | Amp attack time (up to ~0.4 s for slow swells) |
| Decay | 0–1 | Amp decay/sustain time |
| Vibrato | 0–1 | Depth of a ~5.5 Hz pitch vibrato (movement) |
| Level | 0–1 | Output level |

## Design notes
- Each note resamples the shared buffer at `note/220 Hz × Tune × vibrato`, linearly interpolated; AD amp envelope with a slow-attack option for pads.
- 6-voice polyphony; resonant TPT state-variable low-pass; a shared vibrato LFO modulates playback pitch so sustained chords stay alive.
- No allocation in `process()`; the base64 sample decodes once at `init()`.

## Originality / sources
Original DSP **and** original sample — both written/synthesised from scratch for VibePlugin, released CC0. No third-party audio. The name **Silk Cell** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/silk-cell/spec.json` → **VERDICT: PASS** (all 6 params reactive).
