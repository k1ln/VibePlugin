# Vox Strings

A paraphonic string + voice ensemble instrument for the VibePlugin factory.

## What it is

Vox Strings is an original instrument inspired by the classic 1970s string/voice
ensemble keyboards — the kind that layered a divide-down "string section" with a
formant-shaped "human choir." Every held note blooms into a lush, slowly-swelling
pad of detuned strings and breathy choir "aah," widened by a vintage ensemble chorus.

It is **paraphonic**: up to 8 notes track their own pitch and envelope, but they share
one tone/voice character, so a held chord builds into a full choir + strings pad.

**Signal path**

1. **String layer** — each note stacks **three slightly detuned sawtooths**
   (≈ +6.5 / 0 / −7 cents) for the thick, beating divide-down string body.
2. **Voice layer** — a narrow glottal-buzz source per note, summed and pushed through
   **two resonant formant band-passes** (≈ 750 Hz and 1150 Hz) for an "ah" vowel, with
   a touch of breath noise for air.
3. **Blend** — Strings Level and Voice Level mix the two layers, then a gentle `tanh`
   glues the section.
4. **Slow AR envelope** — a string-machine attack/release contour (5 ms – ~2.5 s).
5. **Ensemble chorus** — a three-phase BBD-style modulated delay (mutually detuned
   0.50 / 0.71 / 0.93 Hz LFOs) spreads the section across a wide stereo image.
6. **Master tone** — a one-pole low-pass (≈ 1.2 – 14 kHz) and output Level, with a hard
   safety clamp keeping the peak below full scale.

## Parameters

| Index | Name          | Range | Default | Description |
|-------|---------------|-------|---------|-------------|
| 0     | Strings Level | 0–1   | 0.70    | Level of the detuned-sawtooth string stack |
| 1     | Voice Level   | 0–1   | 0.55    | Level of the formant-filtered choir "aah" |
| 2     | Ensemble      | 0–1   | 0.60    | Ensemble-chorus depth, presence and stereo width |
| 3     | Attack        | 0–1   | 0.35    | Slow attack time (≈ 5 ms – 2 s) |
| 4     | Release       | 0–1   | 0.45    | Slow release time (≈ 20 ms – 2.5 s) |
| 5     | Tone          | 0–1   | 0.60    | Master brightness (low-pass ≈ 1.2 – 14 kHz) |
| 6     | Level         | 0–1   | 0.70    | Output level |

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.036, peak 0.144, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 7 parameters report `✓ affects`

## GUI

A bespoke animated panel: a soft vintage tilt cabinet with a warm ensemble glow that
breathes, a scene of four choir singers whose "aah" mouths open as you play above a
section of vibrating bowed strings (shimmer scales with Ensemble), cream hardware tabs
for quick voicings, hand-drawn SVG knobs (drag vertically, double-click to reset, wheel
to fine-tune), and a playable two-octave keyboard (mouse, touch or computer keys).

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `gui.html` — the self-contained animated GUI
- `spec.json` — plugin metadata, theme and parameter map
- `vox-strings.vstai` — packed bundle
- `preview.wav` — rendered preview
