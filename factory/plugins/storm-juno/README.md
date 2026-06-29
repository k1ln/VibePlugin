# Storm Juno

A six-voice DCO polyphonic synthesizer instrument for the VibePlugin factory,
built around the hollow PWM "hoover / storm" lead.

## What it is

Storm Juno is an original synth in the early-digital DCO-poly lineage, voiced for the
big detuned-pulse "hoover" rave pad rather than a clean polysynth tone. Each of its
six independent voices is fully self-contained, so chords ring out with their own
filter motion and envelopes.

**Per-voice signal path**

1. **DCO pulse stack** — three band-limited (polyBLEP) pulse oscillators tuned to small
   fixed detune offsets (~±7 cents) and phase-offset at note-on, so the stack always
   sounds wide and hollow. Each pulse gets its own pulse-width from the PWM LFO at a
   120° phase spread, which is what makes the texture breathe.
2. **Saw + sub** — a band-limited sawtooth on the centre frequency adds body, and a
   square one octave down adds weight.
3. **Resonant 4-pole low-pass** — a 24 dB/oct ladder-style filter with a `tanh`
   feedback path for stable resonance, swept by its own punchy filter envelope (up to
   ~6 octaves above the base Cutoff via Env Amount).
4. **Amplitude envelope** — fast attack, decay to a sustain plateau, knob-controlled
   release on note-off.
5. **Stereo chorus** — two modulated delay lines (out of phase L/R) widen the result.

A global PWM LFO (PWM Rate 0.05–7 Hz, depth up to ±0.42 around 50% duty) drives the
hollow detuned-pulse motion — the signature hoover sweep. Voices are allocated per
`noteId` (free voice first, otherwise the oldest is stolen). The summed output is
headroom-scaled, soft-saturated, and hard-clamped to keep the peak below full scale.

## Parameters

| Index | Name        | Range | Default | Description |
|-------|-------------|-------|---------|-------------|
| 0     | Cutoff      | 0–1   | 0.45    | Base low-pass cutoff (exp. ~80 Hz – 14 kHz) |
| 1     | Resonance   | 0–1   | 0.55    | Filter resonance / emphasis |
| 2     | Env Amount  | 0–1   | 0.70    | How far the filter envelope opens the cutoff |
| 3     | PWM Depth   | 0–1   | 0.70    | Depth of the pulse-width modulation (hoover hollowness) |
| 4     | PWM Rate    | 0–1   | 0.35    | Speed of the PWM / hoover sweep (0.05–7 Hz) |
| 5     | Chorus      | 0–1   | 0.60    | Stereo chorus width / mix |
| 6     | Release     | 0–1   | 0.35    | Amp + filter release time (0.03–2.5 s) |
| 7     | Level       | 0–1   | 0.70    | Output level |

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.025, peak 0.124, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 8 parameters report `✓ affects`
- output is bounded well below full scale (peak ~0.12 on the test riff; the output is
  soft-saturated and hard-clamped to ±1.0).

## GUI

A bespoke self-contained HTML panel: a stormy indigo-to-cyan shell with drifting
storm clouds, charging lightning arcs whose rate tracks PWM Depth/Rate, a live
detuned-pulse waveform that morphs with PWM and Cutoff, pulsing rave LEDs, custom SVG
knobs (drag to turn, double-click to reset, wheel to fine-tune) and a playable
two-octave keyboard. Accent `#9a7bff` → `#3de0ff`.

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `gui.html` — the self-contained animated GUI
- `spec.json` — plugin metadata, theme and parameter map
- `storm-juno.vstai` — packed bundle
- `preview.wav` — rendered preview
