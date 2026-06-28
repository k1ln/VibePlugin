# Grit Sampler

A gritty, 12-bit-style drum sampler instrument for the VibePlugin factory.

A short **public-domain** drum-cadence segment is baked directly into the
plugin as base64 Int16 PCM and decoded into an f32 buffer at `init()`. Each
played note pitch-tracks the sample, then the signal is deliberately degraded
to get the classic crunchy vintage character:

1. **Bit-depth quantization** — from ~12 bits down to ~5 bits (the *Grit* knob).
2. **Sample-rate decimation** — a sample-and-hold downsampler for aliasing
   (the *Crush* knob).
3. **Soft-clip drive**, a one-pole **tone** low-pass, and an **amp envelope**.

The plugin is fully self-contained: no external files are loaded at runtime,
the audio ships inside the `.vstai`.

## Parameters

| # | Name  | Range | Description |
|---|-------|-------|-------------|
| 0 | Pitch | 0..1  | Tuning, −12..+12 semitones around the natural pitch. |
| 1 | Grit  | 0..1  | Bit-depth reduction (12 → ~5 bits). |
| 2 | Crush | 0..1  | Sample-rate decimation / downsampling. |
| 3 | Tone  | 0..1  | Low-pass tone, dark → open. |
| 4 | Drive | 0..1  | Input drive into a soft-clip saturator. |
| 5 | Decay | 0..1  | Amp envelope decay time. |
| 6 | Level | 0..1  | Output level. |

## Embedded sample — source & license

- **File:** `Drum - Cadence A.ogg` (a US Navy marching drum cadence).
- **Source URL:** https://commons.wikimedia.org/wiki/File:Drum_-_Cadence_A.ogg
- **Direct file:** https://upload.wikimedia.org/wikipedia/commons/e/e1/Drum_-_Cadence_A.ogg
- **License:** **Public Domain** — a work of the U.S. Federal Government (U.S.
  Navy), not subject to copyright in the United States; also tagged
  *Public Domain Mark 1.0* on Wikimedia Commons.
- **Author:** Unknown author (U.S. Navy).

A ~2.0 s segment (starting around 0:30) was extracted, high-passed, loudness-
normalized, faded, and converted to mono 22050 Hz Int16 PCM before being
embedded as base64. See `factory/tools/wav-to-b64.mjs`.

> "E-mu" and "SP-1200" are trademarks of their respective owners. This is an
> original plugin inspired by the general idea of a gritty 12-bit drum sampler;
> it ships no proprietary audio or trademarks.
