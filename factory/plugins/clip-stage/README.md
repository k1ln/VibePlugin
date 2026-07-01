# Clip Stage

A clean, **transparent soft-clip saturator and drive stage** for the VibePlugin
factory. It is built for warmth, glue and gentle level control — deliberately
*musical*, not a fuzz or a grinder. Use it to round transients, add subtle
analog harmonics, and keep peaks under control.

Models a generic VA diode/tube clipping stage.

## DSP

Signal path (per channel, all `f32`, allocation-free):

1. **Drive** — input gain `1..12x`, paired with a `1/√drive` makeup
   compensation so raising Drive changes *character*, not just volume.
2. **Curve** (stepped selector):
   - **DIODE** — symmetric `tanh` soft-clip: a gentle knee, odd harmonics,
     transparent.
   - **TUBE** — a small positive bias is added before saturation so one side
     compresses harder, producing 2nd-order (even) harmonics for tube warmth.
3. **DC blocker** (~10 Hz high-pass) removes the offset the tube bias creates.
4. **Tone** — one-pole low-pass morphing `1.2 kHz` (dark) → `18 kHz` (open).
5. **Trim** — output level `0..1.5`.
6. **Mix** — dry/wet for parallel saturation.

Output stays bounded (`tanh`-limited, peak < ~1.0).

## Parameters

| # | Name  | Range | Default | Notes |
|---|-------|-------|---------|-------|
| 0 | Drive | 0..1  | 0.40    | clean → gently saturated |
| 1 | Curve | 0/1   | 0       | stepped: 0 = diode, 1 = tube |
| 2 | Tone  | 0..1  | 0.60    | dark ↔ open tilt |
| 3 | Trim  | 0..1  | 0.65    | output level (→ ±1.5) |
| 4 | Mix   | 0..1  | 1.00    | dry/wet (parallel) |

## GUI

A self-contained gold + cream studio module: a live **transfer-curve graph**
that mirrors the DSP and bends as Drive rises and Curve switches, a sliding
**diode/tube toggle**, custom SVG knobs (drag to set, double-click to reset,
Shift for fine), an animated output **meter**, and a pulsing pilot lamp.
Accent `#ffd86a` / `#ff9a5a`.

## Files

- `assembly.ts` — AssemblyScript DSP
- `spec.json` — plugin manifest
- `gui.html` — bespoke animated GUI (inline CSS/JS/SVG)
- `clip-stage.vstai` — packed bundle
- `preview.wav` — render from the test harness

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/clip-stage/assembly.ts /tmp/clip-stage.wasm
node factory/tools/wasm-runner.mjs /tmp/clip-stage.wasm --params /tmp/clip-stage-params.json --wav factory/plugins/clip-stage/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/clip-stage/spec.json
```

Harness verdict: **PASS** — every parameter `✓ affects`.
