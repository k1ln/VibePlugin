# Amber Crunch

A compressed **germanium hard-clip distortion** in the two-knob vintage lineage
(Distortion+ family). A single high-gain stage drives a pair of soft
germanium/LED clipping diodes to ground, giving a smooth-yet-fuzzy, round and
slightly **dark** distortion. Distortion sweeps from light grit to a thick
compressed wall; the clipping is round but firmly bounded, like real diodes
pinning the node voltage.

This is an original design — not a clone or emulation of any specific
trademarked pedal.

## Controls

| Param | Index | Range | Default | Effect |
|-------|-------|-------|---------|--------|
| Distortion | 0 | 0–1 | 0.55 | Gain into the clippers: 1.5×–48×, light grit → compressed wall |
| Output | 1 | 0–1 | 0.6 | Post-clip output level (0–1.1×) |
| Tone | 2 | 0–1 | 0.45 | Gentle post tilt low-pass, dark (1.8 kHz) → bright (7 kHz) |
| Mix | 3 | 0–1 | 1.0 | Dry/wet blend |

## DSP

`assembly.ts` (AssemblyScript → WASM, all `f32`, no allocation in `process()`):

- **Input DC/HP block** (~30 Hz) before the asymmetric clipper.
- **Germanium clipper** — `tanh` round soft knee with a slight even-harmonic
  asymmetry (germanium leakage), then a firm forward-voltage clamp (~0.92) with
  a small leak past the knee. Round, compressed, bounded.
- **Compression makeup** keeps high Distortion musical instead of just louder;
  wet stays well under 1.0 (gain-stage peak < ~1.0).
- **Post tone tilt** low-pass for the inherently dark Distortion+ voicing.
- **Output DC block** removes the offset the asymmetry introduces.
- **Mix** blends dry and processed.

Verified with `factory/tools/wasm-runner.mjs`: **VERDICT: PASS**, every param
`✓ affects`, `noClip=true`, `nan=0`.

## GUI

`gui.html` — a self-contained bright mustard-yellow die-cast stompbox: two
chicken-head knobs (Distortion + Output) over a glowing amber clip-wave scope
that animates with the controls (clip ceiling/floor markers light up when
driven hot), plus Tone and Mix mini-sliders and a cosmetic true-bypass
footswitch. Inline CSS/JS/SVG only, real `@keyframes` animation, drag / wheel /
arrow-key control, double-click reset, and every param wired through
`window.vstai.setParam`.

## Build

```
node compiler/asc-driver.mjs factory/plugins/amber-crunch/assembly.ts /tmp/amber-crunch.wasm
node factory/tools/wasm-runner.mjs /tmp/amber-crunch.wasm --params params.json --wav preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/amber-crunch/spec.json
```

Theme accent `#ffb02a` / `#ff5a2a`.
