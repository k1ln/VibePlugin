# Stereo Room

An **early-digital stereo room reverb** — an original VibePlugin effect modelled on the
character of an early-1980s digital room box. Tighter and more defined than a hall:
discrete, panned early reflections feed a controlled diffuse tail with a slightly grainy
vintage-digital grain.

## DSP

Signal flow (`assembly.ts`):

1. **Pre-Delay** — a stereo delay line (0–120 ms) before the room, so the wet field
   arrives after the dry transient.
2. **Multitap early reflections** — 8 panned, asymmetric L/R taps off the room walls form
   the tight, defined early-reflection cluster. Tap geometry scales with **Size**.
3. **Diffuser** — two series Schroeder allpasses per channel (scaled by Size) smear the
   reflections into a dense field; the allpass coefficient tracks **Diffusion**.
4. **Feedback delay network** — 4 mutually-prime delay lines with a Householder-style mix
   matrix and per-line damping low-pass build the short-to-medium diffuse tail.
   **Decay** sets the feedback amount (short box → medium room, never a long hall).
5. **Vintage grain** — the feedback path is quantised to ~13 bits for the subtle
   early-digital character.
6. **Mix** — equal-blend dry/wet; `Mix = 0` is bit-exact dry. Output is clamped and
   sits well under full scale.

No imports, no allocation in `process()`, all `f32`, planar stride 8192.

## Parameters

| Index | Name      | Range | Default | Notes |
|-------|-----------|-------|---------|-------|
| 0 | Mix       | 0–1 | 0.35 | Dry/wet (0 = dry) |
| 1 | Size      | 0–1 | 0.50 | Booth → Hall (scales all delays) |
| 2 | Decay     | 0–1 | 0.50 | Tail length (≈0.25–2.8 s) |
| 3 | Diffusion | 0–1 | 0.70 | ER density + allpass smear |
| 4 | Pre-Delay | 0–1 | 0.10 | 0–120 ms |

## GUI

`gui.html` is a single self-contained document: a vintage rack unit with a fluorescent
green CRT-style display showing a **top-down room view**. Early-reflection rays radiate
from the source and bounce off the room walls; the wall rectangle resizes with Size, ray
speed/spread/brightness track Size/Diffusion/Mix/Decay, and an RT readout reflects Decay.
Five hand-drawn SVG knobs (drag to turn, double-click to reset, wheel to fine-tune,
Shift for fine drag) wire to `window.vstai.setParam`.

Accent palette: `#7ad0c0` / `#a0e0d0`.

## Verification

`node factory/tools/wasm-runner.mjs stereo-room.wasm --params … --seconds 3` →
**VERDICT: PASS**, every parameter `✓ affects`, peak ≈ 0.42, no NaN.
