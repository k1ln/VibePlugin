# Bolt Mono

A lean, punchy **two-oscillator hard-sync mono synth** in the compact American
two-VCO lead/bass tradition — tight, snappy and immediate rather than a fat
triple-oscillator beast. A small, aggressive lead/bass machine.

## Voice

- **OSC-1** — sawtooth **master**.
- **OSC-2** — pulse **slave**, detuned and **hard-synced** to OSC-1: its phase is
  forced to reset on every master cycle, producing the signature zappy, metallic
  sync edge.
- Both oscillators feed a punchy **Moog-style 4-pole resonant ladder low-pass**
  driven by a fast **decay envelope** (Env Amount), with quick glide and a snappy
  amp envelope.
- **Monophonic**, last-note priority; pitch tracks each played note (host passes Hz).

## Parameters

| # | Name       | Range | Default | Function |
|---|------------|-------|---------|----------|
| 0 | Cutoff     | 0..1  | 0.45    | Ladder filter base cutoff (~70 Hz – 10 kHz, exponential) |
| 1 | Resonance  | 0..1  | 0.55    | Ladder feedback / emphasis (approaches self-oscillation) |
| 2 | Env Amount | 0..1  | 0.60    | How far the decay envelope sweeps the cutoff |
| 3 | Sync       | 0..1  | 0.40    | OSC-2 pitch ratio + sync blend — the zappy hard-sync edge |
| 4 | Detune     | 0..1  | 0.25    | OSC-2 fine detune (±~30 cents) — fattens slightly |
| 5 | Decay      | 0..1  | 0.40    | Filter + amp envelope decay time (~25 ms – ~1.4 s) |
| 6 | Level      | 0..1  | 0.80    | Output level (soft-clipped, peak < ~1.0) |

## Files

- `assembly.ts` — AssemblyScript DSP (VibePlugin WASM ABI; `noteOn`/`noteOff`).
- `gui.html` — self-contained bespoke GUI: black + yellow/red lean-Moog panel,
  animated sync scope, custom faders/knobs, two-octave keyboard.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `bolt-mono.vstai` — packed bundle.
- `preview.wav` — rendered preview.

## Theme

Accent `#ffd23d` (bolt yellow) / `#ff4d4d` (hazard red).

## Verification

`node factory/tools/wasm-runner.mjs … --synth --seconds 3` → **VERDICT: PASS**,
every parameter `✓ affects`.

*Original design. "Moog Prodigy" named only as a lineage reference; no trademark
appears in shipped files.*
