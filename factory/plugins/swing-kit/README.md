# Swing Kit

A punchy sampled-style drum kit with **swing** in the **Akai MPC60 / 3000** lineage. The MPC's two claims to fame are its punchy, slightly saturated drum sound and its legendary timing **swing** — and both are the point of this box. Swing Kit is a six-voice drum machine with a **built-in 16-step sequencer**: click (or drag across) the on-screen grid to program your own groove. The signature **Swing** control drags every off-beat 16th late for that head-nodding MPC feel, while **Punch** boosts the transients and drives the mix for the fat sampler character.

## The kit
Kick, snare, closed hat, open hat, clap and a tuned perc hit. The factory pattern is a boom-bap groove (kick on 1 and the syncopated "and", snare backbeats + a ghost, steady hats) — but every step is now editable, so any pattern you draw is what plays.

## The step grid
Six rows (KICK, SNARE, HAT, OPEN, CLAP, PERC) × 16 steps. Click a cell to toggle it, or press and drag to paint a run of steps on/off. Edits are heard immediately, and the whole grid is saved with the plugin state. A free-running playhead shows the swung timing.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | Kick pitch |
| Decay | 0–1 | Global decay length |
| Snap | 0–1 | Snare tone ↔ noise balance |
| Swing | 0–1 | Timing swing (≈50 %→75 %) — drags off-beat 16ths late |
| Punch | 0–1 | Transient boost + drive/saturation |
| Level | 0–1 | Output level |

## Design notes
- Each voice's 16-step pattern is a live parameter (idx 6–11), packed as a 16-bit mask — one float per row keeps the full 6×16 grid inside the 64-param pool and makes it persist/recall for free. The DSP reads the masks every step, so grid edits take effect instantly.
- Internal 16-step sequencer: on-beat steps get a longer gap and off-beat (odd) steps a shorter one, so off-beats land late by up to ~62 % — the classic MPC swing.
- The whole mix is driven through a `tanh` for the punchy, glued, slightly-saturated sampler sound (Punch scales the drive).
- 12-slot one-shot voice pool; no allocation in `process()`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time. The name **Swing Kit** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/swing-kit/spec.json` → **VERDICT: PASS** (all 6 params reactive).
