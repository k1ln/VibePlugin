# Acid Bass

A monophonic squelch-bass **instrument** (a 303-style acid voice, original DSP).
One oscillator morphs continuously from saw to square and feeds a 4-pole
resonant low-pass filter driven by a fast-decaying filter envelope — the
classic acid "squelch". **Accent** boosts the filter envelope and output level
on hard hits, **Glide** slides pitch between overlapping notes (last-note
priority), and high **Resonance** pushes the filter toward self-oscillation
while a soft saturator keeps it bounded.

Plays via `noteOn(id, freqHz, velocity)` / `noteOff(id)`; the host passes
frequency in Hz, so pitch tracks the played note exactly. Velocity drives the
per-note accent strength.

## Signal path

```
osc (saw<->square morph) -> drive -> 4-pole resonant ladder LPF -> amp env -> DC block -> saturate -> level
                                       ^ cutoff = base + EnvMod * filterEnv (+ accent click)
```

## Parameters

| Index | Name      | Range | Default | Description |
|-------|-----------|-------|---------|-------------|
| 0 | Waveform  | 0–1 | 0.15 | Oscillator shape, saw (0) → square (1) |
| 1 | Cutoff    | 0–1 | 0.35 | Base filter cutoff (~80 Hz → ~9 kHz, exponential) |
| 2 | Resonance | 0–1 | 0.78 | Filter resonance; high values approach self-oscillation |
| 3 | Env Mod   | 0–1 | 0.70 | How far the filter envelope opens the cutoff |
| 4 | Decay     | 0–1 | 0.40 | Filter & amp envelope decay (~30 ms → ~1.2 s) |
| 5 | Accent    | 0–1 | 0.50 | Accent depth — extra filter-env brightness + level on velocity |
| 6 | Glide     | 0–1 | 0.25 | Portamento time between notes (0 = instant, ~120 ms max) |
| 7 | Level     | 0–1 | 0.80 | Output level |

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms=0.083, peak=0.455, dc≈0.0, nan=0
- checks: present ✓, finite ✓, noClip ✓ (peak well under 1.5), paramsReactive ✓
- all 8 params reported `✓ affects`

Preview render: `preview.wav`.
