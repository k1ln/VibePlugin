# Phase Synth

A polyphonic phase-distortion digital synthesizer instrument for the VibePlugin factory.

## What it is

Phase Synth is an original 8-voice synth modelled on the behaviour of a classic 80s
phase-distortion digital synth. Rather than analog oscillators feeding a filter, it
makes its timbre the way phase-distortion synths do: each voice reads a **sine table
through a warped phase ramp**. A non-linear phase map bends where the read accelerates
and stalls, so a pure sine morphs toward saw, square and resonant shapes — and the
amount of warp is driven by a per-voice envelope, giving the signature "bright on the
attack, settling toward a sine" character.

**Per-voice signal path**

1. **Twin phase-distortion oscillators** — two `Mathf.sin` reads through a two-piece
   phase warp, slightly detuned for slow chorusy beating.
2. **Phase warp (Shape)** — the Shape control sets where the phase "knee" sits; pushing
   it toward the bright end crowds energy into a fast sweep (higher harmonics) and blends
   in a windowed resonant/formant layer for the classic resonant CZ-style waveshapes.
3. **DCW (distortion control wave) envelope** — a per-voice contour that starts at full
   depth on note-on and decays toward zero, so the warp (and brightness) falls away over
   the note. DCW Amount scales its depth; DCW Decay sets how fast it falls.
4. **Amplitude AR envelope** — attack/hold/release shaping the voice level.

Voices are allocated per `noteId` (free voice first, otherwise the oldest voice is
stolen). The summed output is headroom-scaled and passed through a gentle `tanh`
saturator for digital glue, keeping the peak below full scale even on dense chords.

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0     | Shape      | 0–1   | 0.55    | Phase-warp knee: sine ↔ bright (saw/square/resonant) |
| 1     | DCW Amount | 0–1   | 0.70    | Depth of the per-voice distortion envelope |
| 2     | DCW Decay  | 0–1   | 0.40    | How fast the brightness falls off (≈20 ms – 2.5 s) |
| 3     | Attack     | 0–1   | 0.02    | Amplitude attack time (0–1.2 s) |
| 4     | Release    | 0–1   | 0.35    | Amplitude release time (0–2.5 s) |
| 5     | Detune     | 0–1   | 0.18    | Spread between the two oscillators (beating) |
| 6     | Level      | 0–1   | 0.60    | Output level |

## GUI

A bespoke, self-contained HTML editor: an 80s phase-distortion digital synth panel with
a green LCD that morphs the live waveform between sine and bright/resonant shapes (with
scanlines, glass glare and a breathing DCW envelope), a dark-plastic membrane button row
that snaps Shape to characteristic waveshapes, custom SVG knobs, and a digital readout.
Every knob drives the real parameter via `window.vstai.setParam`, initialises to its
default, is draggable (Shift = fine, wheel = nudge) and double-click resets.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.094, peak 0.227, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 7 parameters report `✓ affects`

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `spec.json` — plugin metadata, theme and parameter map
- `gui.html` — bespoke animated editor
- `phase-synth.vstai` — packed bundle
- `preview.wav` — rendered preview
