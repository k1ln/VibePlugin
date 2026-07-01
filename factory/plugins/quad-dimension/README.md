# Quad Dimension

A clean, hi-fi **dimensional stereo chorus** with **four fixed mode buttons** in
place of rate/depth knobs — an original take on the classic button-mode
dimension pedal lineage. Each mode preselects a dimensional "size": from a
subtle stereo lift up to the widest, most three-dimensional spread.

Unlike a conventional chorus, Quad Dimension is engineered to **widen and
thicken without an audible pitch wobble**. It builds an anti-phase *side* signal
from a pair of short, gently de-tuned delay taps per channel; the modulation is
kept very slow and shallow on purpose, so the image shimmers rather than warbles
and the mono sum stays stable.

## Controls

| Param | Index | Range | Default | Description |
|-------|-------|-------|---------|-------------|
| Mode  | 0 | 1..4 (stepped) | 1 | Four dimensional width presets — 1 = subtle, 4 = widest. Higher modes add more tap spread and anti-phase side. |
| Width | 1 | 0..1 | 0.70 | Stereo spread — scales the side signal for a narrower or wider field. |
| Tone  | 2 | 0..1 | 0.50 | Dark-to-bright tilt on the wet, adding hi-fi top-end sparkle. |
| Mix   | 3 | 0..1 | 0.60 | Dry/wet blend. `Mix = 0` is exactly the dry signal. |

> The DSP stores Mode internally as `0..3`; the GUI labels the four buttons
> `1..4`. The host param value is the integer `0..3` with `step: 1`.

## How it works

- The mono **mid** (`0.5 * (L + R)`) is preserved through the wet path so the
  centre image and mono compatibility stay intact.
- Two short delay taps sit on opposite sides of a per-mode base delay (the
  *spread*) and drift in opposite directions under two very slow quadrature
  LFOs. Their **difference** is the decorrelated, anti-phase **side** signal.
- The wet image is `mid ± Width · side`, so even a fully mono source is thrown
  wide while the sum stays stable.
- **Tone** splits the wet into low/high bands (one-pole) and re-weights the
  highs for clean sparkle.
- Output is trimmed so the widest mode at full Width stays comfortably below
  full scale (test peak ≈ 0.51).

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the bundled `asc`).
- `gui.html` — self-contained animated GUI: a deep-blue chrome-cornered
  dimension pedal with four illuminated square mode buttons, three custom SVG
  knobs, and a live anti-phase stereo-field visualiser.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `quad-dimension.vstai` — packed artifact (WASM + GUI + metadata).
- `preview.wav` — offline render used to validate the DSP.

## Validation

`factory/tools/wasm-runner.mjs` reports **VERDICT: PASS** — audio present,
finite, non-clipping, and every parameter (Mode, Width, Tone, Mix) is reactive.
