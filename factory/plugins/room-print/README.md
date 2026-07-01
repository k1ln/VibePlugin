# Room Print — convolution reverb

Models target: **Effects #14 — Convolution reverb (partitioned)**.

An original convolution reverb. The input is convolved in the time domain with a
**real, measured room impulse response**, so the reverb is the acoustic fingerprint of a
physical space rather than an algorithm. The IR is baked into the AssemblyScript module as
base64 Int16-LE PCM (mono, 22050 Hz), decoded and resampled to the host sample rate at
`init()`, energy-normalised, then convolved (up to 6144 taps at the host rate) against a
ring-buffered input history. No host imports, no allocation in `process()`.

### Controls
- **Mix** — dry/wet balance (Mix = 0 is the clean input).
- **Size** — how much of the impulse-response tail is used (decay length).
- **Pre-Delay** — gap before the reverb (up to ~100 ms).
- **Tone** — high-frequency damping of the wet tail (dark ↔ bright).
- **Width** — stereo spread of the reverb (mono ↔ full).

### Embedded audio — source & license
- **Impulse response:** Adventure Kid *AK-SROOMS* (small-rooms reverb IR collection),
  file `AK-SROOMS_030.wav` (a ~0.27 s small-room measurement).
- **Source:** https://www.adventurekid.se/akrt/free-reverb-impulse-responses/
  (download: https://www.adventurekid.se/wp-content/uploads/AK-SROOMS.zip)
- **License:** Creative Commons Attribution 4.0 International (**CC BY 4.0**).
  Attribution: impulse response by *Adventure Kid (Jonatan Liljedahl)*, used under CC BY 4.0.
- The IR was converted to mono / 22050 Hz / 16-bit, loudness-normalised, and embedded as
  base64 PCM. No copyrighted product samples are used.

### Test
`node factory/tools/wasm-runner.mjs <wasm> --params p.json --wav preview.wav --seconds 3` →
VERDICT: PASS (present, finite, non-clipping, all 5 params reactive). Open `test.html` to play
a riff / mic / dropped file through it with the live GUI.
