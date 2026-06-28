# Patch Mono

An original **semi-modular monophonic synth** voice — a bold, screaming mono in
the spirit of the classic patchable analog monosynths, built from scratch as a
pure algorithm (no samples, no trademarked names).

## Voice

Last-note priority. The host converts MIDI notes to Hz and calls
`noteOn(id, freq, vel)` / `noteOff(id)`; pitch tracks the played frequency.

```
osc1 (saw) + osc2 (pulse/triangle, detuned) + ring blend
  -> pre-filter drive
  -> resonant state-variable HIGH-PASS
  -> resonant Sallen-Key-style LOW-PASS  (self-oscillates / screams)
  -> ADSR amp (× velocity)
  -> DC block -> level guard
```

The two-stage filter is the character of this instrument: a high-pass feeds a
Sallen-Key-style low-pass, both sharing the **Resonance** control. Pushed hard
the low-pass approaches self-oscillation and screams, while a bounded tanh-style
saturator keeps the output finite even at maximum resonance.

## Parameters

| # | Name      | Range | Default | What it does |
|---|-----------|-------|---------|--------------|
| 0 | OscMix    | 0–1   | 0.40    | Crossfades osc1 (saw) → osc2 (pulse/tri); ring-mod flavour peaks mid-mix |
| 1 | Detune    | 0–1   | 0.25    | Detunes osc2 up to ~35 cents for analog beating |
| 2 | LP Cutoff | 0–1   | 0.55    | Low-pass cutoff, ~60 Hz → ~12 kHz (exponential) |
| 3 | HP Cutoff | 0–1   | 0.05    | High-pass cutoff, ~20 Hz → ~2.4 kHz (exponential) |
| 4 | Resonance | 0–1   | 0.60    | Shared filter resonance; toward 1 it screams / self-oscillates (stays bounded) |
| 5 | EnvAmount | 0–1   | 0.55    | How much the ADSR opens the low-pass cutoff |
| 6 | Attack    | 0–1   | 0.04    | Amp attack, ~1 ms → ~1.5 s |
| 7 | Release   | 0–1   | 0.35    | Amp release tail, ~5 ms → ~2.2 s |

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/patch-mono/assembly.ts /tmp/patch-mono.wasm
node factory/tools/wasm-runner.mjs /tmp/patch-mono.wasm \
  --params factory/plugins/patch-mono/spec.json --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/patch-mono/spec.json
```

The offline tester verifies audio is present, finite, bounded (peak < 1.5) and
that every parameter measurably affects the output.
