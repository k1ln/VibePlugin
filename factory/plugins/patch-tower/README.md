# Patch Tower

A colossal three-oscillator **semi-modular monophonic** synthesizer in the great
modular-tower lineage — an original VibePlugin instrument, bigger and more
"modular" than a Minimoog-style fat mono.

## Sound

- **Three full-range oscillators** — a band-limited saw, a band-limited pulse
  (the sync slave) and a smooth triangle — blended thick and detuned into a
  wide, towering stack.
- **Hard oscillator SYNC** — a pitched-up master (osc2) hard-resets the slave
  (osc1) for the classic metallic, vowel-like sweep.
- **White-noise channel** that thickens and animates the tone.
- A fat **4-pole transistor-ladder low-pass** with tanh saturation in the
  feedback loop and its **own sweeping filter envelope**.
- Last-note-priority mono voice with **portamento glide** and a grand, slightly
  overdriven master stage.

## Parameters

| # | Name | Description |
|---|------|-------------|
| 0 | Cutoff    | Base ladder cutoff (~28 Hz … ~20 kHz, exponential) |
| 1 | Resonance | Ladder feedback / emphasis (stays below self-oscillation blow-up) |
| 2 | Env Amount| How far the filter envelope sweeps the cutoff |
| 3 | Detune    | 3-oscillator spread / fatness (up to ~22 cents) |
| 4 | Sync      | Hard oscillator-sync depth (osc2 → osc1) |
| 5 | Noise     | White-noise blend |
| 6 | Glide     | Portamento time (~1 ms … ~0.6 s) |
| 7 | Level     | Master output level |

## GUI

A bespoke **modular tower**: a tall wood-cabinet rack of glowing patch modules
with criss-crossing cables and a three-lane oscilloscope where the saw, pulse
and triangle waveforms stack and react live to Detune, Sync, Noise and Cutoff —
all in an amber + violet vintage-modular aesthetic. Knobs are vertical-drag /
wheel adjustable and double-click to reset. Fully self-contained (inline
CSS/JS/SVG, no external assets).

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/patch-tower/assembly.ts /tmp/patch-tower.wasm
node factory/tools/wasm-runner.mjs /tmp/patch-tower.wasm \
  --params /tmp/patch-tower-params.json --synth --seconds 3   # VERDICT: PASS
node factory/tools/pack-vstai.mjs factory/plugins/patch-tower/spec.json
```

All eight parameters pass the reactivity sweep (`✓ affects`); output peak ≈ 0.25
(well-bounded, mono).
