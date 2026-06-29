# Brickwall

A look-ahead **brickwall limiter** for VibePlugin. A short look-ahead delay feeds
a fast peak detector that computes the exact gain reduction needed so the output
**never exceeds the Ceiling** — the reduction is reached *before* each transient
emerges from the delay line, then recovers over an adjustable Release. Transparent
on quiet input, an absolute wall on loud.

## Controls

| # | Param | Range | Default | What it does |
|---|-----------|-----------|---------|--------------|
| 0 | Threshold | 0..1 (0..+24 dB drive) | 0.0 | Drives the input harder into the limiter — more gain reduction. |
| 1 | Ceiling | 0..1 (−24..0 dB) | 1.0 | Hard output ceiling. Output peaks never cross this line. |
| 2 | Release | 0..1 (1..600 ms) | 0.25 | How fast the gain recovers after a peak. |
| 3 | Gain | 0..1 (−12..+12 dB) | 0.5 | Post makeup trim (still re-clamped to the ceiling). |

## How it works

- **Look-ahead** — driven input is pushed into a 256-sample (~5.3 ms @ 48 k) ring
  buffer per channel. The peak detector reads the sample being *written* while the
  output reads the *oldest* delayed sample, so the gain is already pulled down by
  the time the peak arrives.
- **Exact reduction** — when the upcoming peak exceeds the ceiling, the target gain
  is `ceiling / peak`, applied with a fast attack (over the look-ahead window) and a
  one-pole Release recovery.
- **Hard safety clamp** — after makeup the sample is clamped to `±ceiling`, so even
  positive makeup can never push the output past the ceiling. True brickwall.

All DSP is `f32`, allocation-free in `process()`, with module-scope `StaticArray`s
and guarded divides — conforming to the VibePlugin WASM ABI.

## GUI

A single self-contained HTML document: a literal brick wall with a glowing red
**ceiling line** the animated waveform slams into, a gain-reduction meter, a live
limiting LED, and four hand-built SVG knobs (drag vertically, double-click to reset,
wheel to fine-tune). No external assets.

## Files

- `assembly.ts` — the DSP module (compiles to WASM via `compiler/asc-driver.mjs`).
- `spec.json` — name, theme, param map, build paths.
- `gui.html` — the bespoke GUI.
- `brickwall.vstai` — the packed bundle (baked GUI + WASM).
- `preview.wav` — rendered preview from the offline test runner.

## Rebuild / test

```sh
node compiler/asc-driver.mjs factory/plugins/brickwall/assembly.ts /tmp/brickwall.wasm
node factory/tools/wasm-runner.mjs /tmp/brickwall.wasm \
  --params /tmp/brickwall-params.json --wav factory/plugins/brickwall/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/brickwall/spec.json
```
