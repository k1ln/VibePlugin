# Additive

A polyphonic **additive (Fourier) synthesizer** instrument for the VibePlugin
factory. Each of eight independent voices sums up to 32 sine harmonics whose
amplitudes follow a sculptable spectral shape, so the timbre is built directly
in the frequency domain rather than filtered out of a rich waveform.

Original design inspired by the classic digital additive workstation sound —
no trademarks, no samples, no host imports, pure algorithm.

## Sound engine

- **8-voice polyphony** with per-`noteId` allocation and oldest-voice stealing,
  so chords ring with independent contours. The host passes frequency in Hz.
- **32-partial additive oscillator** per voice. A sine wavetable is built once at
  `init` with `Mathf.sin`; harmonics read it at integer multiples of the
  fundamental phase (Nyquist-guarded so nothing aliases).
- **Spectral shape** computed once per block and shared by all voices:
  - **Odd / Even** set the levels of odd vs. even harmonics — square/hollow
    (odd only) through full saw-like (both) timbres.
  - **Brightness** is a spectral tilt: low values roll the highs off (warm),
    high values flatten the rolloff (bright, buzzy).
  - The profile is normalized so total amplitude stays bounded.
- **Spectral Decay** fades higher harmonics faster than the fundamental over the
  life of each note, giving a natural plucked/mallet evolution. The fundamental
  stays steady; the top harmonic fades fastest.
- **Amplitude AR** (Attack / Release) gates each voice.
- **Level** plus a `tanh` soft-saturator on the summed bus keep big chords
  bounded below full scale (verified `peak ≈ 0.62`, `noClip`).

## Parameters

| # | Name           | Default | Range | Effect |
|---|----------------|---------|-------|--------|
| 0 | Odd            | 0.85    | 0–1   | Level of odd harmonics |
| 1 | Even           | 0.45    | 0–1   | Level of even harmonics |
| 2 | Brightness     | 0.55    | 0–1   | Spectral tilt (rolloff → flat) |
| 3 | Spectral Decay | 0.40    | 0–1   | How fast highs fade over time |
| 4 | Attack         | 0.04    | 0–1   | Amplitude attack (seconds) |
| 5 | Release        | 0.45    | 0–1   | Amplitude release (seconds) |
| 6 | Level          | 0.60    | 0–1   | Output level |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external
assets). It presents a bank of 16 harmonic level bars that redraw live from the
spectral controls, an animated summed-waveform scope, and seven custom rotary
dials (vertical drag, mouse-wheel, double-click to reset). Cyan-on-black digital
lab aesthetic with the `#54d1ff` / `#b0e0ff` accents. Every dial drives
`window.vstai.setParam(index, value)` and initialises to its default.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM in-process via `asc`).
- `spec.json` — manifest (name, params, theme, GUI reference).
- `gui.html` — bespoke animated editor UI.
- `preview.wav` — rendered 3 s synth preview.
- `additive.vstai` — packed plugin.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/additive-synth/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json \
     --wav factory/plugins/additive-synth/preview.wav --synth --seconds 3
```

→ `VERDICT: PASS` — present, finite, noClip, all 7 params `✓ affects`.
