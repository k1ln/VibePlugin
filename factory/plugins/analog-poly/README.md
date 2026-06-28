# Analog Poly

A warm polyphonic analog-style synthesizer instrument for the VibePlugin factory.

## What it is

Analog Poly is an original 8-voice subtractive synth modelled on the behaviour of a
classic five-voice analog polysynth. Each voice is fully independent, so chords ring
out with their own envelopes and filter motion rather than retriggering a single
shared engine.

**Per-voice signal path**

1. **Two detuned oscillators** — a band-limited (polyBLEP) sawtooth and a band-limited
   50%-duty pulse, spread apart by the Detune control for a thick, beating analog tone.
2. **Resonant 4-pole low-pass** — a 24 dB/oct ladder-style filter with a `tanh`
   feedback path for stable resonance up to near self-oscillation.
3. **Filter ADSR (+ amount)** — the filter cutoff is swept by its own envelope, up to
   ~6 octaves above the base Cutoff, scaled by Filter Env Amount.
4. **Amplitude ADSR** — standard attack/decay/sustain/release shaping the voice level.

Voices are allocated per `noteId` (free voice first, otherwise the oldest voice is
stolen). The summed output is headroom-scaled and passed through a gentle `tanh`
saturator for analog glue, keeping the peak below full scale even on dense chords.

## Parameters

| Index | Name          | Range | Default | Description |
|-------|---------------|-------|---------|-------------|
| 0     | Detune        | 0–1   | 0.30    | Spread between the two oscillators (richer beating) |
| 1     | Cutoff        | 0–1   | 0.55    | Base low-pass cutoff (exp. ~60 Hz – 16 kHz) |
| 2     | Resonance     | 0–1   | 0.35    | Filter resonance / emphasis |
| 3     | FilterEnvAmt  | 0–1   | 0.60    | How far the filter envelope opens the cutoff |
| 4     | Attack        | 0–1   | 0.02    | Envelope attack time (0–1.5 s) |
| 5     | Decay         | 0–1   | 0.35    | Envelope decay time (0–1.5 s) |
| 6     | Sustain       | 0–1   | 0.70    | Envelope sustain level |
| 7     | Release       | 0–1   | 0.30    | Envelope release time (0–2 s) |

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.082, peak 0.235, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 8 parameters report `✓ affects`
- 6-voice chord (bright, high-resonance worst case) peaks at 0.93, never clipping;
  the output saturator guarantees < 1.0.

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `spec.json` — plugin metadata, theme and parameter map
- `analog-poly.vstai` — packed bundle
- `preview.wav` — rendered preview
