# Bias Tremolo

An amp-style amplitude tremolo. A low-frequency oscillator (LFO) pulses the
signal level for that vintage combo-amp throb, the way a bias-vary tremolo
circuit modulates the output stage. The result is a clear, rhythmic swell on
steady input.

## Controls

| Param  | Range | Default | What it does |
|--------|-------|---------|--------------|
| Rate   | 0..1  | 0.42    | LFO speed, ~0.1 Hz (slow swell) to ~12 Hz (fast chop), perceptually spaced. |
| Depth  | 0..1  | 0.7     | Modulation amount. The gain swings between `1-Depth` and `1`, so **Depth = 0 leaves the signal untouched**. |
| Shape  | 0..1  | 0.3     | Morphs the LFO from a smooth sine sweep into a hard, choppy bias chop (soft-saturated near-square). |
| Stereo | 0..1  | 0       | Spreads the L/R LFO phase, up to a half-cycle offset, for a wide rotary-style image. |
| Output | 0..1  | 0.7     | Output level trim, up to ~1.2× gain. |

## DSP notes

- Per-channel LFO phase accumulator, wrapped each sample. The right channel
  rides ahead of the left by the Stereo offset.
- The LFO morphs sine → square via `tanh` of a heavily-driven sine, giving a
  rounded square with no harsh edges.
- The modulation gain is run through a ~2 ms one-pole smoother so the choppy /
  square setting stays click-free.
- All math is `f32` (`Mathf.*`), no allocation in `process()`, planar buffers
  with stride `MAX_FRAMES = 8192`. Gain-staged so the peak stays well below
  full scale.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/bias-tremolo/assembly.ts /tmp/bias-tremolo.wasm
node factory/tools/wasm-runner.mjs /tmp/bias-tremolo.wasm \
  --params /tmp/bias-tremolo-params.json --wav factory/plugins/bias-tremolo/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/bias-tremolo/spec.json
```

Tester result: `VERDICT: PASS` — peak ≈ 0.42, all five params reactive.
