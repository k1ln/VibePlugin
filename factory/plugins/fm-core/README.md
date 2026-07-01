# FM Core

A clean **two-operator FM** synth built on the textbook **Chowning algorithm** — one modulator phase-modulates one carrier. It is the pure, generic FM voice behind bells, electric pianos, basses and clangs. **Ratio** sets the modulator:carrier frequency relationship (quantised to musical half-integers), **Index** sets the FM depth, and the signature **Index Env** makes that depth decay over each note so the tone starts bright and bell-like then settles — the classic FM movement you hear on a single held key. Operator **Feedback** adds extra harmonics and edge. 8-voice poly.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Ratio | 0.5:1 – 7:1 | Modulator : carrier frequency ratio (quantised to half-integers) |
| Index | 0–1 | FM modulation depth (brightness / harmonic count) |
| Index Env | 0–1 | How much the FM depth decays over the note (bright → settled) |
| Feedback | 0–1 | Modulator self-feedback (sine → sawtooth-like harmonics) |
| Decay | 0–1 | Amplitude decay time (0.08 s → ~2.5 s) |
| Level | 0–1 | Output level |

## Design notes
- Per voice: one modulator sine (with self-feedback) phase-modulates one carrier sine — the minimal Chowning FM pair.
- The **Index Env** is an exponential decay applied to the modulation index; `effIndex = index · (1 − IdxEnv + IdxEnv · env)`, so at full Index Env the brightness sweeps from `index` down to near zero.
- Ratio is quantised to half-integer steps to keep tones musical (harmonic at integers, metallic between).
- 8-voice polyphony, round-robin allocation; attack → decay amp envelope. Output gain-staged below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **FM Core** is original; it is *not* affiliated with or endorsed by any hardware maker.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/fm-core/spec.json` → **VERDICT: PASS** (all 6 params reactive).
