# Digi Wave

A hybrid **digital/analog polyphonic synthesizer** in the lineage of the early-80s
"digital wave generator + analog filter" hybrid polys. Up to **eight voices**, each
playing a selectable single-cycle **digital waveform** through a warm resonant
**analog-style** low-pass, finished with a built-in stereo delay/chorus shimmer.

Original plugin — not affiliated with or endorsed by any trademark holder.

## Signal flow (per voice)

1. **Digital wave oscillator** — reads a single-cycle table (1024 samples,
   linear-interpolated) from a bank of **eight harmonically-distinct DWGS-style
   waves** built once at init:

   | # | Wave   | Character |
   |---|--------|-----------|
   | 0 | Organ  | strong low drawbar harmonics |
   | 1 | Reed   | odd-weighted with a 5th-harmonic formant bump |
   | 2 | Square | hollow odd-harmonic 1/h |
   | 3 | Piano  | gentle rolloff, mid emphasis |
   | 4 | Saw    | full 1/h spectrum, bright |
   | 5 | Pulse  | ~25% duty, hollow |
   | 6 | Bell   | sparse metallic high partials |
   | 7 | Buzz   | sync-style rising/falling band, aggressive digital edge |

2. **Analog resonant 4-pole low-pass** — exponential cutoff (60 Hz .. ~16 kHz)
   with `tanh` on the resonance feedback for analog warmth; a per-voice AR
   filter envelope sweeps the cutoff up to ~6 octaves.

3. **Amplitude AR envelope** — Attack / Release contour per voice; chords ring
   with independent tails.

4. **Stereo delay / chorus** — short modulated fractional delay lines (~13 ms,
   ±4 ms LFO sweep, 90° L/R for width, gentle feedback) for the signature
   hybrid-poly shimmer.

The summing bus is scaled and soft-saturated, and the stereo output is hard-clamped
to ±1.0 for safety.

## Parameters

| # | Name      | Range | Default | Notes |
|---|-----------|-------|---------|-------|
| 0 | Wave      | 0..7 step 1 | 0 | digital waveform select (stepped) |
| 1 | Cutoff    | 0..1  | 0.55 | analog low-pass base cutoff |
| 2 | Resonance | 0..1  | 0.30 | filter feedback, warm just shy of self-osc |
| 3 | Env Amount| 0..1  | 0.55 | filter-envelope cutoff sweep |
| 4 | Attack    | 0..1  | 0.04 | amp + filter attack time |
| 5 | Release   | 0..1  | 0.35 | amp + filter release time |
| 6 | Delay     | 0..1  | 0.30 | onboard delay/chorus mix |
| 7 | Level     | 0..1  | 0.60 | output level |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external
assets): a charcoal 80s panel with a green LCD that draws the selected digital
waveform, membrane wave-select pads, glowing teal analog-filter dials with a
conic-gradient value ring, animated scan-line and poly-LED chase. Dials drag
vertically (Shift = fine, wheel supported), double-click resets to default, and
every control is wired to `window.vstai.setParam`.

Accent: `#43e0c4` / `#7a86ff`.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the in-process `asc`).
- `spec.json` — plugin manifest (`name: "Digi Wave"`, `isInstrument: true`).
- `gui.html` — bespoke animated editor UI.
- `digi-wave.vstai` — packed bundle.
- `preview.wav` — rendered audition.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/digi-wave/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --synth --seconds 3
# VERDICT: PASS — all 8 params ✓ affects
```
