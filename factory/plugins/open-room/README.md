# Open Room

A bright, efficient algorithmic room/hall reverb, built as an original
plugin for the VibePlugin factory.

## What it is

A classic Schroeder/Moorer-style reverberator: **eight parallel damped
comb filters** per channel feed **four series all-pass diffusers**. A
small stereo offset between the left and right comb tunings opens up the
image so the tail spreads naturally across the field. The comb feedback
loops carry a one-pole low-pass for frequency-dependent decay, giving a
smooth, gradually darkening tail rather than a metallic ring.

Pure algorithm — no impulse responses, no samples.

## Controls

| Param      | Range | Default | What it does |
|------------|-------|---------|--------------|
| Mix        | 0–1   | 0.35    | Dry/wet blend. **Mix = 0 is bit-exact dry.** |
| Room Size  | 0–1   | 0.7     | Comb feedback (≈0.70–0.98) — longer, larger-sounding tail. |
| Damping    | 0–1   | 0.4     | High-frequency absorption inside the combs; higher = darker tail. |
| Width      | 0–1   | 1.0     | Stereo spread of the wet signal, from mono to fully wide. |
| Pre-Delay  | 0–1   | 0.0     | Delays the wet onset 0–120 ms, pushing the reverb behind the source. |

## DSP notes

- All math is `f32` (`Mathf.*`), no allocation in `process()` — every
  delay line and filter state lives in module-scope `StaticArray`s.
- Delay lengths use the classic 44.1 kHz comb/all-pass tunings, rescaled
  to the running sample rate at `init()`.
- The reverb network is fed through a small input gain and the feedback
  is bounded below 1.0, so the tail stays stable and the output peak
  stays well under full scale (tester peak ≈ 0.53).

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/open-room/assembly.ts /tmp/open-room.wasm
node factory/tools/wasm-runner.mjs /tmp/open-room.wasm \
  --params factory/plugins/open-room/params.json \
  --wav factory/plugins/open-room/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/open-room/spec.json
```

Tester verdict: **PASS** — present, finite, no clipping, all five
parameters reactive.
