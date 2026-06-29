# Tilt EQ

A mastering-grade spectral balance shelf. One **Tilt** control rotates the whole
spectrum around an adjustable **Pivot** frequency — lifting the highs while
pulling down the lows (or the reverse) like tipping a see-saw — with a
complementary gentle **Bass** and **Treble** shelf pair and an **Output** trim.

## DSP

Per channel the signal is split into a low band and a high band by a one-pole
low-pass set at the Pivot frequency (`lo = LP(x)`, `hi = x - lo`). **Tilt**
applies complementary band gains (`lo *= 1 - tilt*k`, `hi *= 1 + tilt*k`), so a
single knob rebalances low vs high energy around the pivot. Two further
band-splits provide a broad low shelf (**Bass**, corner ~220 Hz) and high shelf
(**Treble**, corner ~3.5 kHz) for independent, phase-coherent tone trims. An
**Output** gain and a smooth cubic safety clip keep peaks bounded below ~1.0.

All math is `f32` (`Mathf.*`), there is no allocation in `process()`, and every
parameter is clamped. Planar buffers use the standard stride `MAX_FRAMES = 8192`.

## Parameters

| Index | Name   | Range (norm) | Maps to                                |
|-------|--------|--------------|----------------------------------------|
| 0     | Tilt   | 0..1         | -1..+1 spectral tilt (down=bass, up=treble) |
| 1     | Pivot  | 0..1         | 200..2000 Hz pivot frequency (log)     |
| 2     | Bass   | 0..1         | -12..+12 dB low shelf                   |
| 3     | Treble | 0..1         | -12..+12 dB high shelf                  |
| 4     | Output | 0..1         | 0..2x output trim                       |

Defaults are 0.5 across the board (flat, unity-ish).

## GUI

A bespoke single-file HTML panel built around a physical **see-saw / balance
beam** that pivots between a bass weight and a treble weight as Tilt is dragged.
A bipolar scrub strip drives Tilt; SVG knobs with value arcs drive Pivot, Bass,
Treble and Output. Every control is draggable, double-click resets to default,
the wheel fine-tunes, and live values are shown per control. Minimal precise
mastering aesthetic using the `#9ad0e0 / #c0e0f0` accent. No external assets.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/tilt-eq/assembly.ts /tmp/tilt-eq.wasm
node factory/tools/wasm-runner.mjs /tmp/tilt-eq.wasm \
  --params factory/plugins/tilt-eq/params.json \
  --wav factory/plugins/tilt-eq/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/tilt-eq/spec.json
```

The test reports `VERDICT: PASS` with every parameter `✓ affects`.
