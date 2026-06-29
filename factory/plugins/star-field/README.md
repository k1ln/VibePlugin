# Star Field

A multitap **space reverb**. Star Field is not a smooth hall — it is a
constellation of discrete reflections. A mono send is fanned out into a network
of scattered early-reflection taps that "ping" outward across the stereo field;
those taps then feed a diffuse, gently modulated tail (an 8-line feedback delay
network with allpass diffusion and slow per-line LFOs) that blossoms into deep
ambient space and decays away.

An impulse produces clearly scattered multitap reflections followed by a
decaying ambient tail. With **Mix = 0** the output is the dry signal; the wet
bus is bounded well below full scale (test peak ≈ 0.65).

## Controls

| # | Param        | Range | Default | What it does |
|---|--------------|-------|---------|--------------|
| 0 | Size         | 0–1   | 0.55    | Scales all tap times and tail delay lengths — small room → vast space. |
| 1 | Taps/Spread  | 0–1   | 0.70    | Stereo width of the early taps **and** how many taps open up (density). Low = a tight near cluster; high = a wide fan across deep space. |
| 2 | Decay        | 0–1   | 0.55    | Tail RT60 (≈0.25 s → ~11 s). |
| 3 | Modulation   | 0–1   | 0.35    | Shimmer/drift depth of the tail read taps — the spacey modulated movement. |
| 4 | Mix          | 0–1   | 0.35    | Dry/wet. 0 = dry. |

## Files

- `assembly.ts` — AssemblyScript DSP (multitap ER network + modulated FDN tail), compiled to WASM by `asc`.
- `gui.html` — self-contained space-station GUI: a starfield radar where multitap echoes ping outward across a perspective grid horizon, with a retro sci-fi green vector readout. Custom SVG knobs (drag, wheel fine-tune, double-click reset), animated on `requestAnimationFrame`, paused when hidden.
- `spec.json` — manifest (name, params, theme accents `#7a8cff` / `#54d1ff`).
- `star-field.vstai` — packed bundle.
- `preview.wav` — rendered test preview.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/star-field/assembly.ts star-field.wasm
node factory/tools/wasm-runner.mjs star-field.wasm --params star-field-params.json --wav preview.wav --seconds 3
```

→ `VERDICT: PASS` — output present, finite, no clipping; all 5 params `✓ affects`.
