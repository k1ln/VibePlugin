# Reel Saturator

A tape-style saturation and warmth processor. An original VibePlugin effect that
models the *behaviour* of analog tape: harmonic saturation, head-bump low end,
high-frequency rolloff and subtle tape motion.

## Signal flow

1. **Drive** — input gain (1x..12x) into the saturator.
2. **Tape saturation** — a slightly bias-asymmetric `tanh` soft-saturation, run at
   **2x oversampling** (linear-interpolated up, averaged back down) to keep
   aliasing in check. The asymmetry adds even harmonics for a tape-like warmth on
   top of the odd harmonics from the symmetric clip. A makeup-gain term keeps the
   perceived level steady as Drive increases rather than just getting louder.
3. **DC blocker** — removes the small DC term the asymmetric curve introduces.
4. **Warmth** — a one-pole high-frequency rolloff. Sweeps the corner from ~18 kHz
   (open) down to ~2.2 kHz (dark).
5. **Bump** — a resonant low-frequency band (≈90 Hz biquad bandpass fed from a
   low-band extractor) added back in to emulate the tape head bump.
6. **Compression** — gentle program-dependent gain reduction (soft knee above
   ~0.5) for the smooth, glued character of tape.
7. **Wow** — a ~0.7 Hz LFO modulates a short fractional delay (~±1.8 ms) for very
   subtle pitch/time movement.
8. **Output** — final soft-limiter (keeps peaks bounded even fully cranked) and an
   output trim, blended with the dry signal by **Mix**.

## Parameters

| # | Name   | Range | Default | Description |
|---|--------|-------|---------|-------------|
| 0 | Drive  | 0..1  | 0.45    | Saturation amount / input gain. |
| 1 | Warmth | 0..1  | 0.40    | High-frequency rolloff (more = darker). |
| 2 | Bump   | 0..1  | 0.35    | Resonant low head-bump. |
| 3 | Mix    | 0..1  | 1.0     | Dry/wet blend. |
| 4 | Output | 0..1  | 0.70    | Output trim. |

## Implementation notes

- Pure algorithm, no samples. All math is `f32` (`Mathf.*`).
- No allocation in `process()`; all buffers and state are module-scope
  `StaticArray`s. Planar f32 layout, stride `MAX_FRAMES = 8192`, stereo.
- Params are clamped; divides are guarded; output is bounded by a final
  soft-limiter so peaks stay under ~1.1 even with every control maxed.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/reel-saturator/assembly.ts /tmp/reel-saturator.wasm
node factory/tools/wasm-runner.mjs /tmp/reel-saturator.wasm \
  --params factory/plugins/reel-saturator/spec.json \
  --wav factory/plugins/reel-saturator/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/reel-saturator/spec.json
```

Tester verdict: **PASS** — audio present, finite, non-clipping; all five
parameters affect the output.
