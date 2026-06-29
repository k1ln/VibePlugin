# Jove Eight

A lush **eight-voice analog-style polyphonic synthesizer** in the flagship-poly
lineage — an original VibePlugin instrument inspired by the big stacked
string/pad voice of early-80s flagship polys.

## Voice architecture

Each of the **8 independent voices** (allocated per noteId, with oldest-voice
stealing) runs:

- **Two oscillators** — a band-limited (polyBLEP) saw plus a **variable-width
  pulse** with a slow internal **PWM** LFO for shimmer.
- A **sub-oscillator** one octave down (square) for weight.
- A subtle per-voice **unison/detune** spread so stacked chords beat and widen
  like a real analog poly.
- A **resonant 24 dB/oct (4-pole) low-pass** driven by its **own ADSR**
  (Cutoff + Env Amount + Resonance), feeding an **amplitude ADSR**.
- A final `tanh` glue stage for analog character; gain-staged for headroom
  (peak well under 1.0 on full chords).

The host converts MIDI notes to Hz and calls `noteOn(id, freq, vel)` /
`noteOff(id)`. Pure algorithm — no samples, no host imports, no allocation in
`process()`.

## Parameters

| # | Name      | Default | Effect |
|---|-----------|---------|--------|
| 0 | Cutoff    | 0.50    | Base low-pass cutoff (exp ~50 Hz → 16 kHz) — brightness |
| 1 | Resonance | 0.30    | Filter feedback / emphasis at the cutoff |
| 2 | Env Amount| 0.55    | How far the filter envelope sweeps cutoff (up to ~6.5 oct) |
| 3 | PW        | 0.35    | Pulse width + PWM depth — hollow/thin to full square |
| 4 | Detune    | 0.32    | Unison detune spread across voices — width/thickness |
| 5 | Attack    | 0.08    | Shared amp + filter attack time |
| 6 | Release   | 0.40    | Shared amp + filter release time |
| 7 | Level     | 0.70    | Output level |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external
assets): a wide indigo-to-violet flagship panel with an animated aurora/starfield
sweep, **8 lit voltage voice-bars**, and glowing pastel slider banks. Every
param is wired through `window.vstai.setParam(index, value)`, initialised to its
default on `onReady`, draggable, with double-click reset and a live value
readout.

Accent colours: `#6a8cff` / `#b06aff`.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/jove-eight/assembly.ts /tmp/jove-eight.wasm
node factory/tools/wasm-runner.mjs /tmp/jove-eight.wasm \
  --params jove-eight-params.json --wav factory/plugins/jove-eight/preview.wav --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/jove-eight/spec.json
```

Verified **VERDICT: PASS** — all 8 parameters report `✓ affects`.
