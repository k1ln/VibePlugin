# Seq Bass

A squelchy monophonic **acid sequencer-bass** synth instrument — the sequencer-synth
sibling to a bare 303-style acid voice, with a slightly fuller body. One VCO mixes a
saw + square core with a square **sub-oscillator** an octave down, feeding the famous
squelchy 4-pole resonant low-pass driven by a snappy decay envelope. **Accent**
emphasises the filter sweep and level for punchy acid hits; **Glide** slides the pitch
between notes for sliding lines; high **Resonance** squelches toward self-oscillation
while staying bounded. Rubbery, squelchy, hypnotic.

Monophonic, last-note priority. Pure algorithm — no samples.

## Parameters

| # | Name       | Range | Default | Description |
|---|------------|-------|---------|-------------|
| 0 | Cutoff     | 0–1   | 0.38    | Base low-pass cutoff (~70 Hz … ~9 kHz, exponential). |
| 1 | Resonance  | 0–1   | 0.80    | Ladder resonance — the squelch; high values approach self-oscillation. |
| 2 | Env Amount | 0–1   | 0.72    | How far the filter envelope sweeps the cutoff open. |
| 3 | Accent     | 0–1   | 0.55    | Emphasis on the filter sweep + level for punchy acid hits. |
| 4 | Glide      | 0–1   | 0.30    | Portamento time — slides pitch between notes (0 = instant … ~140 ms). |
| 5 | Decay      | 0–1   | 0.42    | Envelope decay (filter + amp); short = snappy squelch, long = sweep. |
| 6 | Level      | 0–1   | 0.80    | Output level (soft-saturated, gain-staged below full scale). |

## DSP

- **VCO:** phase-ramp saw + derived square + half-rate square sub-oscillator, summed
  and gain-staged before the filter for a fuller-than-303 voice.
- **Filter:** 4-pole (Moog-style) resonant low-pass cascade with a soft-saturated
  resonance feedback path that keeps self-oscillation bounded.
- **Envelopes:** one snappy decay envelope drives the filter cutoff (with an extra
  accent "click" of brightness at the attack); a slightly longer amp envelope rings
  the note out. Decay scales both.
- **Glide:** one-pole portamento on the pitch; the first note seeds a slide from an
  octave below so opening notes still slide.
- All f32, allocation-free `process()`, planar stride 8192, params clamped, peak < ~1.0.

## GUI

A bespoke, self-contained HTML/CSS/SVG panel: a slim brushed-silver + acid-green
machine with a glowing animated step row, hand-built SVG knobs (drag to turn,
double-click to reset, wheel to fine-tune), a rubbery sliding saw↔square waveform
scope that morphs with Cutoff/Resonance/Accent/Glide, and a playable two-octave
keyboard. Accent controls glow in `#ff3d8c`; everything else in `#b6ff3d`.

## Files

- `assembly.ts` — AssemblyScript DSP (the VibePlugin WASM ABI + `noteOn`/`noteOff`).
- `gui.html` — the self-contained GUI.
- `spec.json` — name, theme, params, paths.
- `seq-bass.vstai` — packed plugin document.
- `preview.wav` — rendered audio preview.

## Verification

`node factory/tools/wasm-runner.mjs … --synth --seconds 3` → **VERDICT: PASS**, all
seven parameters `✓ affects`, output present/finite, peak ≈ 0.46 (no clipping).
