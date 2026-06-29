# Mu Leveler

A vari-mu tube-style compressor and leveler. Inspired by the gentle, program-dependent
behaviour of a variable-mu valve gain stage (no trademark, original implementation).

## Character

Unlike a VCA or FET compressor with a hard, fixed ratio, a variable-mu valve's effective
gain (its "mu") falls as the signal gets louder. The result is soft, rounded, self-adjusting
gain reduction — leveling rather than clamping:

- **dB-domain detection** with a slow, average-reading (RMS-ish) sidechain.
- A **wide, soft knee** and a gentle ratio that eases up only slightly as you push deeper.
- A **breathing, program-dependent recovery**: the release speeds up under dense program
  material and relaxes as the music opens out.
- A touch of **warm, mostly even-harmonic valve saturation** on the output, growing with Input.
- Output gain-staging keeps the signal bounded (peak < ~1.0 at typical settings).

## Parameters

| # | Name      | Range                | Notes                                             |
|---|-----------|----------------------|---------------------------------------------------|
| 0 | Input     | 1x .. 6x drive       | Pushes the tube harder: more leveling + warmth.   |
| 1 | Threshold | -40 .. 0 dBFS        | Lower = more material gets leveled.               |
| 2 | Recovery  | 0.10 .. 3.0 s        | Base release; modulated by program density.       |
| 3 | Makeup    | 0 .. +12 dB          | Restores level after gain reduction.              |
| 4 | Mix       | 0 .. 100 %           | Dry/wet for parallel "New York" leveling.         |

## Files

- `assembly.ts` — AssemblyScript DSP (planar f32, no allocation in `process()`).
- `spec.json` — plugin manifest (name, params, theme, GUI).
- `gui.html` — self-contained bespoke GUI: an amber valve rack unit with a glowing
  vacuum tube that brightens as it compresses and a slow large-format VU needle.
- `preview.wav` — rendered test render.
- `mu-leveler.vstai` — packed bundle.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/mu-leveler/assembly.ts /tmp/mu-leveler.wasm
node factory/tools/wasm-runner.mjs /tmp/mu-leveler.wasm --params params.json \
  --wav factory/plugins/mu-leveler/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/mu-leveler/spec.json
```

Test runner verdict: **PASS** — audio present, finite, non-clipping; all 5 params affect the output.
