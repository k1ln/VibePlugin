# Iron Drive

Transformer / iron-core saturation effect for the VibePlugin factory.

An original model of the warm nonlinearity of an audio output transformer.
The iron core saturates earliest in the low frequencies, so a tunable
low-end push is summed back into the drive stage; a hysteresis-flavoured
soft saturator adds asymmetric **even + odd** harmonic warmth (richest in
the low-mids); a gentle high-frequency rounding tames the extreme top; and
a post Tone tilt, dry/wet Mix and Output trim finish the chain. A DC blocker
removes the offset the asymmetry introduces. Pure algorithm — no samples.

## Signal flow

```
in → HF rounding (pre) → LF extract → iron push (LF back into drive)
   → hysteresis lag → drive gain → iron saturation (odd + even)
   → DC blocker → Tone low-pass → Output trim → Mix (dry/wet) → out
```

## Parameters

| # | Name   | Range | Default | Description                                          |
|---|--------|-------|---------|------------------------------------------------------|
| 0 | Drive  | 0–1   | 0.45    | Input gain into the iron core (1–18×), gain-comped.  |
| 1 | Low    | 0–1   | 0.50    | Low-frequency iron push fed back into the drive.     |
| 2 | Tone   | 0–1   | 0.50    | Post HF rounding / brightness tilt (1.2–8 kHz LP).   |
| 3 | Mix    | 0–1   | 1.00    | Dry/wet blend.                                       |
| 4 | Output | 0–1   | 0.55    | Output trim (0–1.4×).                                |

## Files

- `assembly.ts` — AssemblyScript DSP module (VibePlugin WASM ABI).
- `spec.json` — plugin manifest (name, params, theme, GUI file).
- `gui.html` — self-contained bespoke GUI: a glowing iron transformer coil
  with animated magnetic flux lines and a warm low-end bloom on a vintage
  iron/copper faceplate. Five custom SVG knobs (drag vertical, shift = fine,
  wheel, double-click to reset).
- `preview.wav` — rendered test preview.
- `iron-drive.vstai` — packed bundle.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/iron-drive/assembly.ts /tmp/iron-drive.wasm
node factory/tools/wasm-runner.mjs /tmp/iron-drive.wasm \
  --params /tmp/iron-drive-params.json --wav factory/plugins/iron-drive/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/iron-drive/spec.json
```

The harness reports **VERDICT: PASS** with all five parameters `✓ affects`
(peak ≈ 0.50, well bounded).

## Theme

Accent `#cf7a3a` (iron/copper), secondary `#e0a860` (warm glow).
