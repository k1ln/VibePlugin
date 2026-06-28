# Ring Mod

A classic **ring modulator** effect for the VibePlugin factory.

Ring modulation multiplies the input signal by an internal carrier
oscillator. Because multiplication of two sinusoids produces only their
**sum and difference** frequencies (with the carrier itself suppressed),
the result is a dense, *inharmonic* spectrum — the metallic, clangorous,
bell-like, robotic-voice character that ring mods are famous for.

A pure sine at `f_in` against a carrier at `f_c` yields exactly two tones,
at `f_in + f_c` and `|f_in − f_c|`, with the original input largely gone.

## Controls

| Param      | Index | Range  | Default | Description                                                        |
|------------|-------|--------|---------|--------------------------------------------------------------------|
| Frequency  | 0     | 0..1   | 0.50    | Carrier frequency, exponential **20 Hz – 3 kHz**.                  |
| Waveform   | 1     | 0..1   | 0.00    | Blends the carrier from **sine** (0) to a softened **square** (1). |
| LFO Rate   | 2     | 0..1   | 0.30    | LFO speed, exponential **0.05 – 12 Hz**.                          |
| LFO Depth  | 3     | 0..1   | 0.25    | LFO modulation of the carrier, **0 – 2 octaves**.                 |
| Mix        | 4     | 0..1   | 1.00    | Dry/wet blend (0 = clean input, 1 = fully modulated).             |

A square carrier injects extra odd harmonics into the carrier, so the
modulation spreads many more sidebands across the spectrum — harsher and
more "digital" than the smooth, two-sideband sine setting. The LFO sweeps
the carrier frequency for warbling, siren-like, or vibrato-style motion.

## DSP notes

- Pure AssemblyScript → WASM, all `f32`, no allocation in `process()`,
  fixed module-scope `StaticArray`s (planar stride `MAX_FRAMES = 8192`).
- One shared carrier/LFO pair drives both channels for a coherent stereo
  image; phases are persisted across blocks.
- Carrier frequency is Nyquist-guarded; the wet/dry sum is bounded well
  below full scale (test peak ≈ 0.50).

## Build / test

```sh
# compile
node compiler/asc-driver.mjs factory/plugins/ring-mod/assembly.ts /tmp/ring-mod.wasm
# test bench (must print VERDICT: PASS, every param "✓ affects")
node factory/tools/wasm-runner.mjs /tmp/ring-mod.wasm \
  --params factory/plugins/ring-mod/spec.json --wav factory/plugins/ring-mod/preview.wav --seconds 3
# pack
node factory/tools/pack-vstai.mjs factory/plugins/ring-mod/spec.json
```

Tester result: `VERDICT: PASS` — all 5 params affect the output, output
finite, no clipping (`peak ≈ 0.50`).
