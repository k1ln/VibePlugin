# Granular Cloud

A granular delay / cloud processor for VibePlugin.

Incoming audio is continuously captured into a 2-second stereo ring buffer.
A fixed pool of 48 overlapping grains (no allocation in `process()`) is sprayed
back out of that buffer: each grain reads from a delayed, spray-randomised
position through a Hann window, at a chosen playback rate, with a random
equal-power pan for a wide stereo cloud. The wet output is recirculated into
the ring (Feedback) and `tanh`-saturated so the cloud stays bounded, then
blended with the dry signal (Mix).

## Parameters

| # | Name     | Range | Default | Effect |
|---|----------|-------|---------|--------|
| 0 | Size     | 0–1   | 0.45    | Grain length, 20–400 ms |
| 1 | Density  | 0–1   | 0.50    | Grain spawn rate, ~4–124 grains/sec |
| 2 | Pitch    | 0–1   | 0.50    | Grain playback rate, −12…+12 semitones |
| 3 | Spray    | 0–1   | 0.40    | Random scatter of read position (up to ~0.5 s) |
| 4 | Feedback | 0–1   | 0.35    | Wet cloud recirculated into the ring buffer |
| 5 | Mix      | 0–1   | 0.60    | Dry/wet blend |

## DSP notes

- All math is `f32` (`Mathf.*`), all buffers are module-scope `StaticArray`s —
  nothing is allocated inside `process()`.
- Output is clamped to ±1.2 and the wet path is `tanh`-limited; measured peak in
  the offline test is ~0.39.
- Pure algorithm on the live input — it uses an internal ring buffer, not a
  user-loaded sample file, so the optional sample exports are omitted.

## Files

- `assembly.ts` — the AssemblyScript DSP module.
- `gui.html` — bespoke self-contained GUI: a generative, animated grain-particle
  cloud driven live by the parameters, with hand-built SVG knobs.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `granular-cloud.vstai` — packed bundle (baked GUI + WASM).
- `preview.wav` — rendered test output.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/granular-cloud/assembly.ts /tmp/granular-cloud.wasm
node factory/tools/wasm-runner.mjs /tmp/granular-cloud.wasm \
  --params /tmp/granular-cloud-params.json \
  --wav factory/plugins/granular-cloud/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/granular-cloud/spec.json
```

Verdict: **PASS** — audio present, finite, no clipping, all six parameters affect the output.
