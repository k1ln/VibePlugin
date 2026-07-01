# Rover Mono

A budget two-oscillator Moog monosynth in the **Moog Rogue** lineage — the small, affordable Moog that still had the real ladder-filter growl. Two sawtooth oscillators: **osc 1** tracks the note while **Osc2 Interval** tunes the second up to ±an octave for fat detune, unison, fifths or octave stacks, and **Osc Mix** balances the pair. They run through a warm, resonant **four-pole Moog-style ladder** low-pass with its own envelope for the classic squelchy Moog bass and lead. Mono, last-note priority.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Ladder low-pass base frequency (45 Hz → ~10 kHz) |
| Resonance | 0–1 | Filter emphasis (into the squelchy self-oscillation region) |
| Env Amount | 0–1 | How far the filter envelope opens the cutoff on each note |
| Osc2 Interval | −12…+12 st | Tuning of osc 2 relative to osc 1 (unison, detune, 5th, octave…) |
| Osc Mix | 0–1 | Balance between osc 1 and osc 2 |
| Level | 0–1 | Output level |

## Design notes
- Two saw oscillators; osc 2's frequency is `note × 2^(interval/12)`, so the Interval knob sweeps continuously from an octave down to an octave up.
- **Four-pole ladder** built from two cascaded TPT state-variable LP stages with a decaying filter envelope — the Moog "wow" on each note.
- Mono with a short glide; output soft-clipped with `tanh` for the fat, slightly-driven Moog character.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Rover Mono** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/rover-mono/spec.json` → **VERDICT: PASS** (all 6 params reactive).
