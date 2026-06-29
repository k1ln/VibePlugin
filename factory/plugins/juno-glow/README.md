# Juno Glow

A warm **6-voice DCO polyphonic synthesizer** in the lineage of the early-80s
Japanese DCO poly workhorses — the kind built around one rock-stable
digitally-controlled oscillator per voice and finished with a lush BBD-style
ensemble chorus. (An original design; not affiliated with or endorsed by any
trademark holder.)

## Voice architecture

Each of the 6 voices is:

1. **One digitally-controlled oscillator (DCO)** — a band-limited sawtooth
   blended with a variable-width pulse. A slow per-voice LFO sweeps the pulse
   width (PWM) for the signature breathing motion; voices are phase-staggered
   so a held chord shimmers instead of pulsing in lockstep.
2. **Square SUB** an octave below for weight.
3. A sip of **noise** for breath.
4. A **resonant 4-pole low-pass** (tanh-saturated ladder) driven by its own
   attack/decay filter envelope — `Cutoff` sets the base, `Env Amount` how far
   the envelope opens it, `Resonance` the emphasis just shy of self-oscillation.
5. A snappy **amp contour** (fast attack, sustain while held, `Release` tail).

The summed bus then runs through a **stereo ENSEMBLE CHORUS**: two modulated
BBD-style delay lines whose LFOs are 90° apart, giving the shimmering width that
defines the instrument. `Chorus` morphs from dry mono to wide wet ensemble.

## Parameters

| # | Name       | Range | Default | What it does                                   |
|---|------------|-------|---------|------------------------------------------------|
| 0 | Cutoff     | 0–1   | 0.55    | Base low-pass cutoff (≈60 Hz → 16 kHz)          |
| 1 | Resonance  | 0–1   | 0.30    | Filter emphasis / feedback                      |
| 2 | Env Amount | 0–1   | 0.55    | How far the filter envelope opens the cutoff    |
| 3 | PWM        | 0–1   | 0.40    | Pulse-width modulation depth                    |
| 4 | Sub        | 0–1   | 0.45    | Sub-oscillator (square, −1 octave) level        |
| 5 | Chorus     | 0–1   | 0.60    | Ensemble chorus depth / stereo width            |
| 6 | Release    | 0–1   | 0.35    | Amp + filter release time                       |
| 7 | Level      | 0–1   | 0.70    | Master output level                             |

## GUI

A warm orange-on-charcoal Juno-style **slider panel**: eight tactile faders with
glowing amber fills, a glowing **CHORUS** toggle with a pulsing LED, an animated
doubled-waveform scope whose two traces split apart as Chorus opens, and a
playable on-screen keyboard (mouse or computer keys **A–K**). Drag faders
vertically, wheel to fine-tune, double-click to reset.

## Files

- `assembly.ts` — the AssemblyScript DSP (compiled to WASM by `asc`).
- `gui.html` — the self-contained GUI (inline CSS/JS/SVG, no external assets).
- `spec.json` — plugin manifest (params, theme, paths).
- `juno-glow.vstai` — the packed bundle.
- `preview.wav` — a rendered audio preview.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/juno-glow/assembly.ts /tmp/juno-glow.wasm
node factory/tools/wasm-runner.mjs /tmp/juno-glow.wasm \
  --params /tmp/juno-glow-params.json --synth --seconds 3
```

→ `VERDICT: PASS` — audio present, finite, peak ≈ 0.18 (well bounded), and every
one of the 8 parameters measurably affects the output.
