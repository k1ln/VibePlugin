# Atrium

A natural, bright digital **ambience room reverb**, built as an
original VibePlugin factory effect. Atrium is tuned for the prized "invisible" room
sound: a dense early-reflection cloud that dissolves into a smooth, airy, neutral
diffuse tail with no metallic ring.

## DSP

`assembly.ts` implements a classic high-quality ambience topology:

1. **Input diffusion** — four cascaded allpass filters per channel scatter the attack
   into a dense early-reflection cloud. The allpass coefficient is driven by
   **Diffusion** to thicken the density.
2. **8-line feedback delay network (FDN)** — eight mutually-prime-ish delay lines mixed
   by a lossless 8-point Hadamard rotation. This gives a colourless, even modal decay
   without flutter or ring. The diffused input is injected per side so the two channels
   decorrelate.
3. **Per-line damping** — a one-pole low-pass inside each feedback path; **Air** opens
   the high end (less damping = brighter, airier tail).
4. **HF air shelf** — a gentle high-shelf lift on the wet field keeps the top open and
   the room sounding natural rather than boxy.
5. **DC block + mid/side width** — **Width** spreads the diffuse field from mono (0) to
   full stereo (1), then a dry/wet **Mix** sums against the input (Mix=0 ≈ dry).

All math is `f32` (`Mathf.*`), no allocation in `process()`, planar stride 8192,
output gain-staged so the peak stays well under 1.0.

## Parameters

| # | Name      | Range | Default | Function |
|---|-----------|-------|---------|----------|
| 0 | Mix       | 0–1   | 0.35    | Dry/wet blend (0 ≈ dry) |
| 1 | Size      | 0–1   | 0.50    | Small ambience → large room (scales all delays) |
| 2 | Decay     | 0–1   | 0.55    | Tail length (FDN feedback) |
| 3 | Diffusion | 0–1   | 0.70    | Density / thickness of the scatter cloud |
| 4 | Air       | 0–1   | 0.60    | HF openness (damping + air shelf) |
| 5 | Width     | 0–1   | 0.80    | Stereo spread of the diffuse field |

## GUI

`gui.html` is a single self-contained document: a serene pale aqua-to-mint panel with a
luminous room outline that breathes with **Size** and a softly diffusing particle cloud
(canvas, requestAnimationFrame) whose density, reach, brightness and width track the
live parameters. Hand-built SVG knobs: vertical drag to turn, shift-drag for fine,
wheel to nudge, double-click to reset; each shows its name and live value. Every control
is wired to `window.vstai.setParam` at the matching index and initialised to its default.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/atrium/assembly.ts atrium.wasm
node factory/tools/wasm-runner.mjs atrium.wasm --params atrium-params.json --wav preview.wav --seconds 3
# → VERDICT: PASS ✅  (all 6 params ✓ affects, peak 0.44, finite, no clip)
node factory/tools/pack-vstai.mjs factory/plugins/atrium/spec.json   # → packed Atrium
```
