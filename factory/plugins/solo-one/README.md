# Solo One

An aggressive monophonic lead/bass synthesizer in the Pro-One lineage — built for
biting solos and snarling basslines, not smooth pads.

## Voice

- **Two oscillators**: a master saw (OSC 1) plus a detuned pulse (OSC 2).
- **Hard sync + cross-mod grit**: OSC 2 is hard-synced to OSC 1 and lightly
  cross-modulated by it, giving the harmonically rich, biting character of the
  Pro-One.
- **Snappy resonant 4-pole low-pass** ladder filter, driven by a **fast, punchy
  filter envelope** (the snap that defines the voice).
- **Mono, last-note priority**; pitch tracks the keyboard. Notes hard-retrigger
  the envelopes for an aggressive attack.

## Parameters

| # | Name        | Range | Default | What it does                                                        |
|---|-------------|-------|---------|---------------------------------------------------------------------|
| 0 | Cutoff      | 0..1  | 0.35    | Base filter cutoff (~60 Hz .. ~11 kHz, exponential).                |
| 1 | Resonance   | 0..1  | 0.70    | Ladder resonance up to near self-oscillation, bounded by soft clip. |
| 2 | Env Amount  | 0..1  | 0.80    | How far the filter envelope sweeps cutoff (up to ~10 kHz).          |
| 3 | Decay       | 0..1  | 0.30    | Filter + amp decay; from ~8 ms snap to long sweeps.                 |
| 4 | Detune      | 0..1  | 0.25    | OSC 2 detune for fatness and beating.                               |
| 5 | Drive       | 0..1  | 0.40    | Pre-filter drive and cross-mod grit.                                |
| 6 | Level       | 0..1  | 0.80    | Output level (saturated, peak < ~1.0).                              |

## GUI

A compact hot-red and orange mono-lead panel: a big glowing filter knob, a
spiking filter-envelope visualiser, and a single fat animated oscilloscope lead
trace, plus a playable two-octave keyboard (mouse, touch, or computer keys
`a s d f...`). Knobs drag vertically, double-click to reset, scroll to fine-tune.

## Files

- `assembly.ts` — the AssemblyScript DSP (compiles to WASM via `asc`).
- `gui.html` — self-contained HTML GUI.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `solo-one.vstai` — packed artifact.
- `preview.wav` — rendered audio preview.

## Note

"Solo One" is an original plugin. It is inspired by the classic aggressive mono
synth voice but is not affiliated with, nor does it use the trademark of, any
existing product.
