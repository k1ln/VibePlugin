# Germanium Fuzz

A vintage two-transistor germanium fuzz effect. An original model of the
classic 1960s germanium fuzz circuit, built for genuinely musical, characterful
saturation rather than a generic distortion.

## Sound

An AC-coupled, very high-gain input stage feeds an asymmetric clipper — a soft
`tanh` knee into a hard ceiling — that mimics a cascaded germanium transistor
pair. The asymmetry generates strong even-order harmonics for the "vocal",
slightly-cocked-wah voice these circuits are loved for. A second AC-coupled clip
stage adds the extra grind at high Fuzz settings.

The signature trick is the **Bias** control. It sets the operating point of the
"circuit": turned up it runs open, fat, and near-symmetric; turned down it
**starves** the stage with a large DC offset the signal cannot overcome on every
cycle. Combined with a program-dependent bias sag (an envelope follower that
momentarily opens the stage on transients), low Bias gives the gated, spitty,
note-collapsing fuzz that decays into broken-up sputter — a hallmark of dying
germanium transistors.

## Controls

| Index | Name   | Range | Default | Description |
|-------|--------|-------|---------|-------------|
| 0 | Fuzz   | 0–1 | 0.75 | Gain into the clipping stages. From mild grind to wall-of-fuzz. Very high range, like the real thing. |
| 1 | Bias   | 0–1 | 0.65 | Operating point / starve. High = open and fat; low = gated, spitty, sputtery fuzz. |
| 2 | Tone   | 0–1 | 0.50 | Passive post low-pass tilt, dark (≈700 Hz) to bright (≈6.5 kHz). |
| 3 | Volume | 0–1 | 0.50 | Output level (with light level compensation so Fuzz isn't just "louder"). |

## Signal flow

```
in -> input AC-coupling HP (~80 Hz)
   -> envelope follower -> dynamic bias (sag / gating)
   -> stage 1: asymmetric tanh clip (high gain, biased)
   -> inter-stage AC-coupling HP (~160 Hz)
   -> stage 2: asymmetric tanh clip (cascaded grind)
   -> Tone low-pass
   -> output DC blocker (~25 Hz)
   -> Volume -> out
```

## Implementation notes

- Pure algorithm, no samples. Fully self-contained WASM (no imports).
- All math in `f32` (`Mathf.*`), allocation-free `process()`, planar stride 8192.
- Output is bounded: hard ceiling inside each clip stage plus a final safety
  clamp keep the peak well under unity. Tester reports peak ≈ 0.40 and DC ≈ 0.
- Sensitive to input level by design — drive it harder for more spit and gate.

## Test

```
VERDICT: PASS — 4 params, all "✓ affects", peak 0.39981, dc 0.00002, nan 0
```
