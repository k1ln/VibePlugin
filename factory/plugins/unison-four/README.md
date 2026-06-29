# Unison Four

A four-VCO unison mono/poly synthesizer instrument for the VibePlugin factory.

## What it is

Unison Four is an original synth in the **Korg Mono/Poly lineage** (the trademark
appears nowhere in the shipped files). Every held note drives a voice that stacks
**four detuned oscillators**, so a single note becomes one huge, beating unison
lead or bass — and with several notes held the stacks spread across a chord.

**Per-voice signal path**

1. **Four unison oscillators** — each a band-limited (polyBLEP) saw/pulse blend.
   The four are fanned symmetrically outward by the **Detune** control (up to about
   ±0.5 semitone across the stack), which is what fattens and widens the sound.
2. **Hard sync** — oscillator 1 is the master; when it wraps it drags oscillators
   2–4 back toward zero phase by the **Sync** amount, for the classic
   resonant-formant grit that reshapes the timbre.
3. **Resonant 4-pole low-pass** — a 24 dB/oct ladder filter with a `tanh` feedback
   path (stable up to near self-oscillation), with its own **decay** envelope and an
   **Env Amount** that opens the **Cutoff** by up to ~6.5 octaves.
4. **Amplitude envelope** — a snappy attack into a **Decay**-shaped contour
   (longer Decay rings louder and longer), released on key-up.

Voices are allocated per `noteId` (free voice first, otherwise the oldest is stolen).
The summed stack is pushed hot into a `tanh` saturator for the thick analog-monster
character, while staying bounded well under full scale.

## Parameters

| Index | Name      | Range | Default | Description |
|-------|-----------|-------|---------|-------------|
| 0     | Detune    | 0–1   | 0.45    | Unison spread / width of the 4-VCO stack |
| 1     | Cutoff    | 0–1   | 0.50    | Base low-pass cutoff (exp. ~50 Hz – 17 kHz) |
| 2     | Resonance | 0–1   | 0.40    | Filter resonance / emphasis |
| 3     | EnvAmount | 0–1   | 0.60    | How far the filter envelope opens the cutoff |
| 4     | Sync      | 0–1   | 0.00    | Hard-sync amount (osc 2–4 reset to osc 1) |
| 5     | Decay     | 0–1   | 0.45    | Amp + filter decay time (~20 ms – 2.4 s) |
| 6     | Level     | 0–1   | 0.70    | Output level into the saturator |

## GUI

A bespoke "analog monster" panel in hot orange-to-yellow (`#ff6a3d` / `#ffe14a`):
four glowing oscillator bars that fan out and detune as Unison rises, a live
stacked-saw oscilloscope (animated on `requestAnimationFrame`, reshaped by Sync /
Cutoff / Resonance), a punchy Mono/Poly mode toggle, hand-drawn SVG knobs
(vertical drag, double-click reset, wheel fine-tune) and a playable on-screen
keyboard (mouse, touch and computer keys). Self-contained — no external assets.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.030, peak 0.202, dc ~0, nan 0 (single held note; headroom to spare)
- checks: present, finite, noClip, paramsReactive — all true
- all 7 parameters report `✓ affects`

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `spec.json` — plugin metadata, theme and parameter map
- `gui.html` — the self-contained animated GUI
- `unison-four.vstai` — packed bundle
- `preview.wav` — rendered preview
