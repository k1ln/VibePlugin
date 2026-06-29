# Sonic Max

A psychoacoustic clarity and phase enhancer — an original "sonic maximizer" effect.

## What it does

The signal is split into three bands (low / mid / high) with cascaded one-pole
crossovers. The low band is run through a short fractional delay line so it sits
a touch behind the highs, undoing some of the natural group-delay smear of
speakers and rooms and restoring transient punch. **Process** lifts high-band
presence (an "air" shelf that emphasises fast edges) for definition and sparkle;
**Lo Contour** blooms the low end with a gentle resonant lift around ~90 Hz for
weight and body. The bands recombine through a soft clipper, an **Output** trim
and a dry/wet **Mix**, keeping the effect subtle and safely bounded.

A built-in make-up term scales down the recombined sum as Process and Lo Contour
rise, so the enhancement adds clarity rather than just level.

## Controls

| Param        | Range | Default | Effect |
|--------------|-------|---------|--------|
| Process      | 0..1  | 0.50    | High-frequency clarity / presence and low-band time alignment |
| Lo Contour   | 0..1  | 0.50    | Low-end bloom and weight |
| Output       | 0..1  | 0.55    | Output trim (0..1.4×) |
| Mix          | 0..1  | 1.00    | Dry / wet blend |

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the VibePlugin ABI)
- `gui.html`    — self-contained animated GUI (blue-LED rack, contour scope,
  rising sparkles off the highs, low-end bloom)
- `spec.json`   — plugin manifest (name, params, theme, paths)
- `preview.wav` — rendered preview
- `x.vstai`     — packed plugin

## Theme

Accent `#5ad1ff` / `#b0e0ff`.

## Test

```
node compiler/asc-driver.mjs factory/plugins/sonic-max/assembly.ts /tmp/sonic-max.wasm
node factory/tools/wasm-runner.mjs /tmp/sonic-max.wasm \
  --params /tmp/sonic-max-params.json \
  --wav factory/plugins/sonic-max/preview.wav --seconds 3
```

Latest run: `VERDICT: PASS` — present, finite, no clip, all 4 params reactive.
