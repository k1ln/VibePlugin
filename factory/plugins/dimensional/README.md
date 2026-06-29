# Dimensional

A dimensional BBD-style stereo chorus. It blooms a flat, mono source into a
wide and gently animated stereo image with very little obvious wobble — the
classic "dimensional space" effect rather than a seasick chorus.

## How it works

Each channel feeds a short delay line whose read position is gently swept by a
quadrature pair of low-frequency oscillators (the two sides run 90° apart so the
motion de-correlates left from right). A mild one-pole low-pass on each tap
models the soft top end of a bucket-brigade (BBD) delay. The two wet taps are
then **cross-fed** L↔R: each output side carries its own modulated voice plus a
slice of the opposite side, which is what throws the image wide. The result is
mixed back against the dry signal.

## Controls

| Index | Name  | Range        | Default | Function |
|-------|-------|--------------|---------|----------|
| 0     | Mode  | 0–3 (step 1) | 0       | Four intensity presets (I Subtle · II Wide · III Lush · IV Vast) — each a touch faster, deeper and wider. |
| 1     | Depth | 0–1          | 0.50    | Modulation depth (size of the delay sweep). |
| 2     | Width | 0–1          | 0.60    | Stereo cross-feed / spread. |
| 3     | Mix   | 0–1          | 0.70    | Dry/wet balance. |

Parameter indices match the `P_*` constants in `assembly.ts` and the
`window.vstai.setParam(index, value)` calls in `gui.html`.

## GUI

A self-contained 80s-rack faceplate (`gui.html`): an animated "dimensional
field" canvas where a central mono dot blooms into two drifting stereo clouds
whose spread, motion and density track Width / Depth / Mix in real time; four
illuminated mode buttons; and three hand-drawn SVG knobs (vertical drag, wheel
fine-tune, double-click to reset). Theme accent `#8fb6ff` / `#b0e0ff`.

## Files

- `assembly.ts` — the AssemblyScript DSP module.
- `spec.json` — name, theme, parameter map, build paths.
- `gui.html` — the bespoke self-contained GUI.
- `preview.wav` — rendered preview.
- `dimensional.vstai` — packed plugin (baked GUI + WASM).

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/dimensional/assembly.ts /tmp/dimensional.wasm
node factory/tools/wasm-runner.mjs /tmp/dimensional.wasm --params params.json --wav preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/dimensional/spec.json
```

Last verified: `VERDICT: PASS` — all four parameters affect the output, signal
present and finite, peak well below full-scale.
