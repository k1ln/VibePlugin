# Mono Spark

A punchy, sub-heavy **monophonic synthesizer** in the classic ribbon-strip lineage
(an original take on the SH-101 voicing — no trademarks). Built for weighty
techno/acid basslines and zippy leads.

## Voice

- **One main VCO** — a saw blended with a variable-width pulse (PWM).
- **Strong square SUB oscillator** layered one *and* two octaves down for serious
  low-end weight (the defining trait of this synth).
- **A touch of white noise** for grit.
- All summed into a **snappy 4-pole resonant low-pass** driven by its **own decay
  envelope** (the punch), then an amplitude envelope and output level.
- **Last-note-priority mono** with a 4-note hold stack so fast chord stabs
  retrigger cleanly while only the most recent gated note sounds.

## Parameters

| Index | Name       | Range | Default | Function                                   |
|-------|------------|-------|---------|--------------------------------------------|
| 0     | Cutoff     | 0–1   | 0.40    | Base VCF cutoff (~70 Hz … ~10 kHz, exp).   |
| 1     | Resonance  | 0–1   | 0.55    | Ladder feedback; approaches self-osc.      |
| 2     | Env Amount | 0–1   | 0.70    | Filter-envelope sweep depth on cutoff.     |
| 3     | Sub        | 0–1   | 0.65    | Sub-oscillator level (low-end weight).     |
| 4     | PWM        | 0–1   | 0.35    | Pulse width of the main VCO (0.5 = square). |
| 5     | Decay      | 0–1   | 0.35    | Filter + amp envelope decay time.          |
| 6     | Level      | 0–1   | 0.80    | Output level (soft-clipped, peak < ~1.0).  |

## GUI

A self-contained slim grey + red ribbon-strip panel: a big SVG filter knob with a
live Hz readout, an animated dual scope (accent saw over a blue thumping sub
square), six smaller value knobs, an animated bright-red step-pulse LED row, and a
two-octave playable keyboard (mouse + computer keys `A`–`L`, `W`–`U`). Knobs are
drag-to-turn (Shift = fine), wheel-adjustable, double-click to reset. Every control
is wired to `window.vstai.setParam(index, value)`; notes go through
`window.vstai.noteOn/noteOff`.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM, no imports).
- `gui.html` — single self-contained HTML GUI (inline CSS/JS/SVG).
- `spec.json` — plugin manifest (name, params, theme, paths).
- `mono-spark.vstai` — packed bundle.
- `preview.wav` — rendered demo arpeggio.

## Verification

`node factory/tools/wasm-runner.mjs … --synth --seconds 3` → **VERDICT: PASS**,
all 7 parameters report `✓ affects`, output present/finite, peak ≈ 0.54.
