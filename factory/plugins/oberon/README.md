# Oberon

A fat discrete-oscillator analog **polyphonic synthesizer** instrument — original work inspired by the late-70s American dual-oscillator poly lineage (SEM-flavour filtering). Deliberately fatter and rawer in character than a clean ladder-filter poly.

## Character

- **6 independent voices**, allocated per `noteId` so chords ring with their own contours (oldest-voice stealing when full).
- **Two oscillators per voice** — a band-limited saw plus a hollow ~45%-duty pulse — with a third wide-detuned saw layer for extra thickness.
- **Raw resonant 2-pole (12 dB/oct) low-pass** with a touch of pre-filter `tanh` grit, driven by its own envelope (Cutoff + Env Amount + Resonance).
- **Amplitude envelope** (Attack / sustain-while-held / Release) per voice.
- **Wide unison Spread** detunes the layers *and* pans each voice across the stereo field for huge, brassy poly stabs.
- Band-limited via polyBLEP; output soft-saturated for analog glue. Peak stays well under full scale.

## Parameters

| Index | Name | Default | Effect |
|------:|------|--------:|--------|
| 0 | Cutoff    | 0.50 | base filter cutoff (~70 Hz … 15 kHz, exponential) |
| 1 | Resonance | 0.40 | filter resonance / raw edge |
| 2 | Env Amount| 0.55 | how far the filter envelope sweeps cutoff (up to ~5.5 oct) |
| 3 | Spread    | 0.40 | unison detune + stereo width (fatness) |
| 4 | Attack    | 0.04 | amp + filter attack time |
| 5 | Release   | 0.35 | amp + filter release time |
| 6 | Level     | 0.60 | output level |

## Files

- `assembly.ts` — the AssemblyScript DSP module (WASM ABI, `noteOn(id,freq,vel)` / `noteOff(id)`; host passes Hz).
- `spec.json` — plugin manifest (name, params, theme `#caa6ff`/`#ff8fb0`, GUI file).
- `gui.html` — self-contained bespoke GUI: a creamy beige panel between two wooden end-cheeks, glowing violet-to-pink ivory knobs, a breathing stacked-saw scope, and a 6-voice LED bank.
- `preview.wav` — rendered preview.
- `oberon.vstai` — packed bundle.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/oberon/assembly.ts <out>.wasm
node factory/tools/wasm-runner.mjs <out>.wasm --params <params>.json --wav preview.wav --synth --seconds 3
```

Result: **VERDICT: PASS** — audio present, finite, no clipping, and every one of the 7 parameters reports `✓ affects`.
