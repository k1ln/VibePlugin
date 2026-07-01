# Patch Grid

A patch-matrix modular voice in the **EMS Synthi 100** lineage. The Synthi's pin matrix let anything modulate anything, and its most iconic sound is **ring modulation** between a played oscillator and a free-running one — clangorous, inharmonic, bell-and-drone timbres. Here osc 1 tracks the note, **Osc2 Freq** sets a free-running second oscillator at an *absolute* pitch (so the ring product goes inharmonic as you detune it away from the note), **Ring** sets the ring-mod amount, **Noise** adds the Synthi's coloured noise, and everything runs through a resonant low-pass with a decay envelope. Mono, last-note priority.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Osc2 Freq | 0–1 | Free-running oscillator 2 pitch (~40 Hz–1.2 kHz, absolute) |
| Ring | 0–1 | Ring-modulation amount (osc 1 × osc 2) |
| Noise | 0–1 | Coloured-noise mix |
| Cutoff | 0–1 | Resonant low-pass base frequency |
| Decay | 0–1 | Amp decay time |
| Level | 0–1 | Output level |

## Design notes
- osc 1 is a sawtooth (rich harmonics for ring mod) tracking the note; osc 2 is a free-running sine at an absolute frequency, so the ring product `osc1 × osc2` sweeps through inharmonic sum/difference tones.
- One-pole low-passed ("coloured") noise blends in for the Synthi's breathy/analog character.
- Resonant TPT low-pass + AD amp envelope; output soft-clipped with `tanh`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Patch Grid** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/patch-grid/spec.json` → **VERDICT: PASS** (all 6 params reactive).
