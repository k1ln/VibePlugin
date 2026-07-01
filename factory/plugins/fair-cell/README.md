# Fair Cell

An **8-bit sampler** in the **Fairlight CMI** lineage — the machine that put sampling on the map, famous for its gritty digital voices and orchestra hits. Fair Cell plays a baked, self-authored sample pitched across the keyboard with an amp envelope and a resonant low-pass. The signature **Crunch** re-crushes the playback (bit-reduction + sample-rate grain) for even more of that early-digital-sampler character.

## The sample
The embedded sample is **original and CC0** — synthesised at build time, not taken from any recording or library. It is a ~0.5 s morphing formant-vocal "aah → ooh" tone (two gliding formants over 44 harmonics), quantised to 8-bit for the Fairlight grain, stored as base64 Int16 PCM (24 kHz mono) and decoded into a float buffer at `init()`.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | ±1 octave playback pitch offset |
| Cutoff | 0–1 | Resonant low-pass base frequency |
| Decay | 0–1 | Amplitude decay time |
| Crunch | 0–1 | Extra bit-reduction (128→12 levels) + sample-rate grain |
| Attack | 0–1 | Amp attack time |
| Level | 0–1 | Output level |

## Design notes
- Each note resamples the shared buffer at `note/220 Hz × Tune`, linearly interpolated; one-shot playback with an AD amp envelope.
- 6-voice polyphony; resonant TPT state-variable low-pass; the Crunch grain is a shared bit-quantiser + sample-and-hold on the summed voices.
- No allocation in `process()`; the base64 sample decodes once at `init()`.

## Originality / sources
Original DSP **and** original sample — both written/synthesised from scratch for VibePlugin, released CC0. No third-party audio. The name **Fair Cell** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/fair-cell/spec.json` → **VERDICT: PASS** (all 6 params reactive).
