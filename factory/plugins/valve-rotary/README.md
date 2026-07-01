# Valve Rotary

An overdriven **tube preamp into a rotating-speaker** chain — the gritty
gospel/rock organ sound. A warm valve stage with grid bias adds
second-harmonic warmth that grows into a growl as **Drive** rises, then feeds
a twin-rotor rotating speaker: the signal is split into a bass-rotor band and
a treble horn band, each spun through its own virtual driver producing
amplitude tremolo plus a short Doppler pitch vibrato. The horn turns faster
than the drum in opposite phase, and **Speed** morphs slow chorale to fast
tremolo with inertia, so the rotors audibly ramp rather than jump.

Distinct from the clean **Rotary Cabinet**: here a saturating valve stage sits
*in front* of the rotors, so the swirl rides on top of the grit.

## Parameters

| # | Name  | Range | Default | Description |
|---|-------|-------|---------|-------------|
| 0 | Speed | 0–1   | 0.85    | Slow (chorale) ↔ fast (tremolo); rotor rates ramp with inertia. |
| 1 | Drive | 0–1   | 0.45    | Tube preamp grit — clean warmth into growling overdrive. |
| 2 | Depth | 0–1   | 0.70    | Doppler vibrato + amplitude-tremolo amount of the swirl. |
| 3 | Tone  | 0–1   | 0.55    | Post-tube tilt, dark ↔ bright. |
| 4 | Mix   | 0–1   | 1.00    | Dry/wet blend. |

## Signal chain

```
in → pre-HP (70 Hz) → valve (asym soft-clip + bias) → DC block → tone tilt
   → crossover (760 Hz) ──┬─ horn band → mod delay (Doppler) + AM → pan
                          └─ bass band → mod delay (Doppler) + AM → pan
   → two virtual mics → dry/wet → out
```

## DSP notes

- All math is `f32` (`Mathf.*`); no allocation in `process()` — buffers and
  state live in module-scope `StaticArray`s. Planar stride 8192.
- The valve uses a rational tanh approximation with a +0.18 grid-bias offset
  for asymmetric clipping; a DC blocker removes the resulting offset.
- Rotor rate glide uses a one-pole toward the Speed target (~0.9 s horn,
  ~1.5 s drum) so the spin-up/down is realistic.
- Output is gain-staged and clamped to ±0.98 (peak < 1.0).

## Files

- `assembly.ts` — AssemblyScript DSP.
- `spec.json` — plugin manifest (name, params, theme, gui).
- `gui.html` — self-contained animated GUI: a walnut rotary-cabinet with
  spinning blurred horn rotors, a glowing overdriven tube behind the grille,
  and five amber rotary knobs (drag, wheel, arrow keys, double-click to reset).
- `preview.wav` — rendered preview.
- `valve-rotary.vstai` — packed bundle.

Build verified with `factory/tools/wasm-runner.mjs`: **VERDICT: PASS**, all 5
params affect.
