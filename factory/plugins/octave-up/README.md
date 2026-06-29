# Octave Up

An **octave-up fuzz**. A silicon-style fuzz stage feeds a full-wave rectifier:
rectifying the fuzz folds the signal's negative half upward, doubling the pitch
so a strong upper octave rings out on top of the fuzz. The doubling tracks the
loudest partial, so it sings clearest on clean single notes and dyads.

## Signal path

```
input -> pre HP (~150 Hz) -> fuzz gain (1..120) -> fuzz clip = FUZZ
FUZZ  -> |x| full-wave rectify -> DC block (~20 Hz) -> re-centre = OCTAVE
out   = blend(FUZZ, OCTAVE by Octave) -> tone LP (600..7000 Hz) -> Volume
```

A pre-fuzz high-pass tightens the lows so the rectifier doubles the upper
partial cleanly instead of smearing bass. The rectified path is DC-blocked and
re-centred (the `|x|` operation otherwise adds a DC step), then equal-power
blended against the dry fuzz. Gain compensation keeps Fuzz from being merely
"louder", and a safety clamp before the output keeps the peak bounded
(~0.34 in the test render).

## Parameters

| Index | Name   | Range | Default | Description |
|-------|--------|-------|---------|-------------|
| 0 | Fuzz   | 0–1 | 0.70 | Input drive into the fuzz clipper (1×..120×, exponential). |
| 1 | Octave | 0–1 | 0.60 | Amount of the rectified upper-octave blended over the fuzz. |
| 2 | Tone   | 0–1 | 0.55 | Post low-pass corner, 600–7000 Hz. |
| 3 | Volume | 0–1 | 0.70 | Output level (0..1.2). |

## GUI

A self-contained psychedelic-1960s pedal: a swirling purple-haze backdrop
(`@keyframes` conic + radial gradients), hand-built SVG knobs with value arcs,
pointer notches and accent glow on hover/drag, and a live octave-doubling
waveform visualiser that draws both the fuzz layer and the glowing rectified
octave layer in real time. All controls drag vertically to turn, wheel to
nudge, shift-drag for fine, and double-click to reset. Every control is wired
to `window.vstai.setParam(index, value)` at its real range and initialised to
its default on load.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/octave-up/assembly.ts /tmp/octave-up.wasm
node factory/tools/wasm-runner.mjs /tmp/octave-up.wasm \
  --params /tmp/octave-up-params.json --wav factory/plugins/octave-up/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/octave-up/spec.json
```

Verdict: **PASS** — audio present, finite, bounded (peak ≈ 0.34), all four
parameters confirmed reactive.
