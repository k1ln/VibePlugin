# Noise Gate

A clean noise gate / downward expander for the VibePlugin factory.

When the input falls below the **Threshold**, the gate closes and the signal is
attenuated toward the **Range** floor; louder material passes through untouched.
**Attack** and **Release** shape how quickly the gate opens and closes, while a
**Hold** time and a built-in 3 dB hysteresis band keep it from chattering on
decaying notes and sustains.

## Parameters

| # | Name      | Range          | Default | Notes                                   |
|---|-----------|----------------|---------|-----------------------------------------|
| 0 | Threshold | -72 .. 0 dBFS  | 0.55    | Level the signal must exceed to open    |
| 1 | Range     | 0 .. -90 dB    | 0.80    | Attenuation applied while closed        |
| 2 | Attack    | 0.05 .. 50 ms  | 0.15    | How fast the gate opens                 |
| 3 | Release   | 5 .. 1000 ms   | 0.35    | How fast the gate closes                |
| 4 | Hold      | 0 .. 500 ms    | 0.20    | Minimum stay-open time after a trigger  |

All parameters are normalised 0..1 at the ABI; the DSP maps them to the units
shown above.

## DSP

A stereo-linked peak detector with a fast (~0.5 ms) attack and a ~10 ms decay
tracks the input envelope. A hysteresis band (open threshold vs. a threshold
3 dB lower to close) plus a Hold counter de-chatter the gate decision. The
resulting open/closed target is smoothed with attack/release one-pole
coefficients so transitions fade rather than click. Everything is `f32`, with no
allocation in `process()` and static buffers at module scope.

- `assembly.ts` — the AssemblyScript DSP module.
- `gui.html` — the bespoke self-contained GUI: a pair of gate doors that swing
  open and slam shut with the signal, a threshold line, a rising level bar, and
  an open/closed LED, all driven by inline `@keyframes` and a
  `requestAnimationFrame` loop.
- `spec.json` — name, theme, parameter map and build paths.

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/noise-gate/assembly.ts /tmp/noise-gate.wasm
node factory/tools/wasm-runner.mjs /tmp/noise-gate.wasm \
  --params /tmp/noise-gate-params.json --wav factory/plugins/noise-gate/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/noise-gate/spec.json
```

The offline runner reports **VERDICT: PASS** with all five parameters marked
`✓ affects`.
