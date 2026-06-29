# Wave Folder

A west-coast style **wavefolder** audio effect for the VibePlugin factory. Instead of clipping peaks flat, it drives the signal hard so the waveform **folds back on itself** through reflective triangle and sine folds, generating dense, metallic, ever-evolving harmonics. The folding inherently bounds the amplitude, so pushing *Fold* adds complexity rather than just level.

## DSP

The signal chain per sample (`assembly.ts`):

1. **Pre-gain** — `Fold` drives the input from 1x up to ~9x, pushing it past the fold threshold so more reflections (more harmonics) appear.
2. **Bias** — `Symmetry` shifts the fold axis off-centre, introducing even harmonics and an asymmetric, vocal character.
3. **Triangle fold** — a reflective triangle shaper folds the over-driven signal back into `[-1, 1]` (the classic west-coast fold).
4. **Sine fold** — a second sine-based fold whose depth scales with `Fold` adds the smooth, glassy upper harmonics.
5. **DC blocker** — removes the offset that biased folding introduces.
6. **Tone** — a one-pole low-pass tilted from dark to bright, blended against the full-band folded signal.
7. **Output** + **Mix** — output level and dry/wet blend.

All math stays in `f32` (`Mathf.*`), no allocation in `process()`, static module-scope buffers, planar stride 8192, params clamped, peak kept below ~1.0.

### Parameters

| Index | Name     | Range | Default | Description |
|-------|----------|-------|---------|-------------|
| 0 | Fold     | 0–1 | 0.45 | Fold amount / number of folds — drives harmonic complexity. |
| 1 | Symmetry | 0–1 | 0.50 | Bias of the fold axis (0.5 = symmetric); adds even harmonics. |
| 2 | Tone     | 0–1 | 0.55 | Dark → bright tilt of the folded output. |
| 3 | Output   | 0–1 | 0.70 | Output level (0 … ~1.2). |
| 4 | Mix      | 0–1 | 1.00 | Dry/wet blend. |

## GUI

`gui.html` is a single self-contained document: a Buchla-style modular panel with mounting screws, banana jacks (In / Fold CV / Sym CV / Out), and a live animated oscilloscope that renders the actual fold transfer applied to a scrolling sine — the waveform visibly folds back on itself as you turn *Fold* and *Symmetry*. Five hand-drawn SVG knobs (drag to turn, wheel to fine-tune with Shift, double-click to reset) drive the params through `window.vstai.setParam`. Theme accent `#c08cff` / `#ff8cf0`.

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/wave-folder/assembly.ts /tmp/wave-folder.wasm
node factory/tools/wasm-runner.mjs /tmp/wave-folder.wasm --params params.json --wav preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/wave-folder/spec.json
```

Test verdict: **PASS** — output present/finite, no runaway clipping (peak ≈ 0.94), every parameter affects the sound.
