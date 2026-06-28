# Bit Crusher

A lo-fi digital degrader — an original VibePlugin effect modelling the behaviour of
a classic bitcrusher + sample-rate reducer. Two stages of controlled digital damage
run in series, then blend back against the dry signal.

## Signal chain

1. **Sample-and-hold decimator** — latches a new input sample only every *N* frames
   (integer divisor, 1..50), dropping the effective sample rate. Higher
   **Downsample** settings hold each value longer, folding high frequencies back as
   audible aliasing.
2. **Bit-depth quantizer** — rounds the (held) signal to a variable bit depth
   (16 down to 1 bit). The signal is clamped to [-1, 1], snapped to the nearest of
   `2^bits - 1` levels and rescaled. Lower bit depths widen the quantization step,
   adding gritty quantization noise.
3. **Mix / Level** — a dry/wet blend against the clean input, then an output trim.

The result gets progressively grittier and more aliased as **Bits** drops and
**Downsample** rises. Output is bounded (clamped to [-1.2, 1.2]) and gain-staged so
peaks stay well under unity.

## Parameters

| Index | Name       | Range | Default | Description                                           |
|-------|------------|-------|---------|-------------------------------------------------------|
| 0     | Bits       | 0..1  | 0.5     | 0 = clean 16-bit, 1 = crushed 1-bit quantization.     |
| 1     | Downsample | 0..1  | 0.3     | Sample-rate divisor, 1 (off) up to 50 (heavy decimate).|
| 2     | Mix        | 0..1  | 1.0     | Dry/wet blend.                                        |
| 3     | Level      | 0..1  | 0.7     | Output level (0..1.2).                                |

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/bit-crusher/assembly.ts /tmp/bit-crusher.wasm
node factory/tools/wasm-runner.mjs /tmp/bit-crusher.wasm \
  --params factory/plugins/bit-crusher/params.json --wav factory/plugins/bit-crusher/preview.wav
node factory/tools/pack-vstai.mjs factory/plugins/bit-crusher/spec.json
```

Pure algorithm, no samples. All DSP is f32, allocation-free in `process()`.
