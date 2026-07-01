# Scout Mono

A semi-modular monosynth with **sample & hold** in the **Roland System-100** lineage. Two oscillators (saw + square) run through a resonant low-pass with its own envelope, and the signature patch is a noise **sample & hold**: it steps a new random value at **S&H Rate** and holds it, modulating the filter cutoff (and a touch of pitch) by **S&H Depth** — the burbling, sci-fi "random step" movement that keeps a held note alive without touching a thing. Mono, last-note priority.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Cutoff | 0–1 | Low-pass base frequency (60 Hz → ~7 kHz) |
| Resonance | 0–1 | Filter emphasis at the cutoff |
| S&H Rate | 0.5–22 Hz | How fast the sample & hold clocks a new random step |
| S&H Depth | 0–1 | How far each step swings the cutoff (and a little pitch) |
| Env Amount | 0–1 | Filter envelope depth on each note |
| Level | 0–1 | Output level |

## Design notes
- A noise generator is sampled every `sampleRate / rate` samples and held; a fast one-pole smooth avoids hard clicks between steps.
- The held value drives the filter cutoff exponentially (`× e^(depth·1.8·s&h)`) and adds ±6 % pitch — the classic System-100 "computer talk" burble that makes a single held note evolve.
- Two-osc mono (saw + square sub), resonant TPT low-pass with a decaying filter envelope; output soft-clipped with `tanh`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Scout Mono** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/scout-mono/spec.json` → **VERDICT: PASS** (all 6 params reactive).
