# Mini Volt

A compact, expressive single-oscillator **mono synth** in the small-Moog lineage —
a lean one-VCO voice with a wide-range main oscillator, a square sub an octave
down, and a characterful 4-pole resonant ladder low-pass with its own snappy
envelope. An Osc Mod section adds a small LFO that vibratos the pitch and breathes
the pulse width for vocal "growl," and Glide slides pitch between notes. Small,
vocal, and characterful.

Modeled (in spirit) on the compact expressive single-oscillator Moog mono. This is
an original implementation — no trademarked names, samples, or assets.

## Voice / signal path

```
osc (saw + PWM pulse) + sub-square  ->  Moog-style 4-pole ladder LPF (env-swept)
   -> amp envelope -> soft saturate -> level
```

- **One VCO**: a saw blended with a PWM pulse; the Osc Mod LFO breathes the pulse
  width and applies a gentle vibrato for expression.
- **Sub oscillator**: a square one octave below for weight.
- **Ladder filter**: 4-pole resonant low-pass with its own attack/decay/sustain
  filter envelope; resonance approaches self-oscillation but stays bounded by a
  tanh-style saturator.
- **Mono, last-note priority** with portamento (Glide).

## Parameters

| # | Name       | Default | Description                                                   |
|---|------------|---------|---------------------------------------------------------------|
| 0 | Cutoff     | 0.45    | Base ladder cutoff (~70 Hz .. ~10 kHz, exponential).          |
| 1 | Resonance  | 0.32    | Ladder resonance; high values sing toward self-oscillation.   |
| 2 | Env Amount | 0.6     | Filter-envelope depth and decay length.                       |
| 3 | Osc Mod    | 0.25    | Vibrato + PWM growl depth (also driven by the Mod Ribbon).    |
| 4 | Sub        | 0.5     | Sub-oscillator (square, –1 octave) level.                     |
| 5 | Glide      | 0.2     | Portamento time between notes (0 = instant .. ~140 ms).       |
| 6 | Level      | 0.8     | Output level (soft-saturated, gain-staged below clipping).    |

## GUI

A compact black + orange Moog-style panel: one big Cutoff knob, a row of small
knobs, a blue **Mod Ribbon** wired to Osc Mod, an animated single-waveform scope
with a gentle vibrato wobble, and a playable on-screen keyboard. Knobs drag
vertically, double-click to reset, and wheel to fine-tune. Theme accents
`#ff9a3d` / `#5a8cff`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/mini-volt/assembly.ts /tmp/mini-volt.wasm
node factory/tools/wasm-runner.mjs /tmp/mini-volt.wasm \
  --params /tmp/mini-volt-params.json --wav factory/plugins/mini-volt/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/mini-volt/spec.json
```

The offline runner reports **VERDICT: PASS** with all 7 parameters `✓ affects`
and the output safely bounded (peak ≈ 0.32, no clipping).
