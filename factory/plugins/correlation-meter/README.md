# Correlation Meter

A phase/correlation meter with a live goniometer for VibePlugin. Audio passes
through unaltered except Mono Check, which sums L+R to both output channels
so you can *hear* mono compatibility while the meter keeps *analyzing* the
true, pre-sum stereo signal — the diagnostic stays meaningful while you're
auditioning, instead of collapsing to a trivial 1.0 the moment you engage it.

Hand-authored `gui.html` (like `loudness-meter`) — a goniometer needs an XY
scatter plot, which `scaffold.mjs`'s built-in `viz` types (`"bars"`/`"wave"`/
`"none"`) don't support.

## DSP

- **Correlation**: a running coefficient from exponential moving averages of
  `L*R`, `L²`, `R²`: `corr = E[LR] / sqrt(E[L²]·E[R²])`. +1 fully correlated
  (mono-safe), 0 uncorrelated, -1 fully out of phase (cancels to silence in
  mono).
- **Goniometer**: packs ~7 evenly-spaced (X,Y) sample pairs per block into
  the `getDisplayPtr()` channel. Goniometer mode uses the standard
  45°-rotated Mid/Side basis (`X=(L-R)/√2`, `Y=(L+R)/√2`) so mono content
  collapses to a vertical line; Lissajous mode plots raw L/R (mono draws a
  diagonal instead). The GUI accumulates points with a phosphor-persistence
  trail (partial-clear each frame rather than storing/aging points).

## Correctness check

Fed known test signals through a standalone compiled build:

| Signal | Correlation | Goniometer shape | Expectation |
|---|---|---|---|
| Mono (L=R) | 1.000 | X always 0.00, Y varies → vertical line | ✓ |
| Anti-phase (L=-R) | -1.000 | Y always 0.00, X varies → horizontal line | ✓ |
| Uncorrelated noise | -0.013 | scattered | ✓ (~0, as expected for independent noise) |
| Same signal, R at 20% of L's level (hard pan, no phase change) | 1.000 | diagonal, compressed toward Y-axis | ✓ — correlation is amplitude-invariant; panning alone never reduces it, only phase/decorrelation does |

All four landed exactly where the math predicts.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/correlation-meter/assembly.ts /tmp/correlation-meter.wasm
node factory/tools/wasm-runner.mjs /tmp/correlation-meter.wasm --params factory/plugins/correlation-meter/spec.json --seconds 3
node factory/tools/gui-check.mjs factory/plugins/correlation-meter --shot /tmp/correlation-meter.png
node factory/tools/pack-vstai.mjs factory/plugins/correlation-meter/spec.json
node factory/tools/persist-check.mjs factory/plugins/correlation-meter
```

Verdict: **PASS** (4/4 params, no clipping, no NaNs); gui-check PASS (0
console errors); persist-check PASS.
