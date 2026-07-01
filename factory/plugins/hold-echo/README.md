# Hold Echo

A studio **digital delay** with **modulation** and **infinite hold** (PCM42 lineage),
built as an original VibePlugin effect — distinct from the pristine, clean TC-2290-style
delay in the factory.

A clean delay line feeds linear-interpolated repeats whose read tap is gently swept by a
quadrature LFO, giving chorus / pitch-wobble echoes (the two channels run in quadrature for
stereo width). The feedback path is shaped by a tilt **Tone** filter — turn it down to darken
each repeat, up to brighten — and a **Hold** control lifts feedback toward unity while fading
the dry input out of the loop, so the captured buffer loops and freezes. A soft limiter in the
feedback path keeps the held loop and high-feedback settings bounded (no runaway clip).

## Parameters

| # | Name       | Range | Default | Function |
|---|------------|-------|---------|----------|
| 0 | Time       | 0–1   | 0.35    | Delay time, 30–900 ms (smoothed glide) |
| 1 | Feedback   | 0–1   | 0.45    | Repeat regeneration, 0–0.95 |
| 2 | Modulation | 0–1   | 0.30    | LFO depth wobbling the delay time (chorus / pitch warble) |
| 3 | Tone       | 0–1   | 0.50    | Tilt filter on the repeats — dark to bright |
| 4 | Hold       | 0–1   | 0.00    | Above ~0.55 freezes the loop (feedback → ~1.0, input muted) |
| 5 | Mix        | 0–1   | 0.50    | Dry / wet balance |

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the bundled `asc`).
- `gui.html` — bespoke self-contained GUI: dark-teal rack unit, glowing ms time
  readout, a looping waveform scope that ripples with modulation and **freezes**
  when Hold engages, custom SVG knobs (drag, wheel, double-click reset).
- `spec.json` — packaging manifest (name, theme `#3de0c4` / `#7a86ff`, params).
- `hold-echo.vstai` — packed plugin document.
- `preview.wav` — 3 s render from the offline test bench.

## Build / verify

```
node compiler/asc-driver.mjs factory/plugins/hold-echo/assembly.ts /tmp/hold-echo.wasm
node factory/tools/wasm-runner.mjs /tmp/hold-echo.wasm \
  --params /tmp/hold-echo-params.json --wav factory/plugins/hold-echo/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/hold-echo/spec.json
```

Test bench result: **VERDICT: PASS** — audio present, finite, no clip
(peak ≈ 0.49), every parameter affects the output.
