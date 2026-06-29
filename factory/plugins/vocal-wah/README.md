# Vocal Wah

An original inductor-style **resonant wah / auto-wah** for the VibePlugin factory.

A state-variable band-pass filter has its centre frequency swept across a vocal,
vowel-like range. The peak can be driven two ways:

- **Manual** — a rocking treadle (the **Pedal** position) sets the sweep, heel to toe.
- **Auto Env** — an envelope follower tracks the input dynamics so louder playing
  pushes the peak upward, for a hands-free "talking" wah.

## Sound

The resonant peak rides over roughly **320 Hz → ~2.6 kHz**. **Q** sharpens the
vowel character of the peak, **Range** opens how far the sweep travels, and a
**Mix** control blends the wet resonance against the dry signal. A soft-clip
safety on the resonant output keeps the gain stage bounded below ~1.0 even at
high Q.

## Parameters

| Index | Name  | Range      | Default | Notes |
|-------|-------|------------|---------|-------|
| 0     | Pedal | 0 – 1      | 0.5     | Manual treadle position (heel → toe) |
| 1     | Q     | 0 – 1      | 0.6     | Resonance / sharpness of the peak |
| 2     | Range | 0 – 1      | 0.7     | How far the sweep travels |
| 3     | Mode  | 0 / 1 (step 1) | 0   | 0 = Manual, 1 = Auto envelope |
| 4     | Mix   | 0 – 1      | 1.0     | Dry / wet blend |

## GUI

A bespoke, self-contained HTML panel themed in amber/orange (`#ffd23f` / `#ff9e2c`):
a funky chrome **treadle** you drag to tilt (the sweep), a vowel **"mouth"** that
opens and closes with the peak, hand-built SVG knobs (drag, double-click to reset,
wheel to fine-tune) and a lit Manual / Auto mode switch.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via `compiler/asc-driver.mjs`)
- `gui.html` — self-contained GUI
- `spec.json` — plugin manifest (name, params, theme, paths)
- `vocal-wah.vstai` — packed bundle (gui + wasm baked in)
- `preview.wav` — rendered preview from the offline runner

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/vocal-wah/assembly.ts /tmp/vocal-wah.wasm
node factory/tools/wasm-runner.mjs /tmp/vocal-wah.wasm \
  --params /tmp/vocal-wah-params.json --wav factory/plugins/vocal-wah/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/vocal-wah/spec.json
```
