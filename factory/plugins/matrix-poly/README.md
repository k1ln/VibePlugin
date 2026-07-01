# Matrix Poly

A deeply-modulated dual-filter analog polyphonic synthesizer for the VibePlugin factory.

## What it is

Matrix Poly is an original 6-voice subtractive synth in the lineage of the great 80s
flagship matrix-modulation polysynths. Its character is not raw oscillator grit but
**lush, ever-moving modulation**: a single global LFO is "matrix-routed" at once to
three destinations, so held chords slowly breathe and evolve instead of sitting still.

**Per-voice signal path**

1. **Two oscillators** — a band-limited (polyBLEP) sawtooth and a band-limited pulse
   whose width is continuously swept by the LFO (PWM), for a thick, shifting tone.
2. **Resonant 4-pole low-pass** — a smooth multimode-style filter with a `tanh`
   feedback path for stable resonance up to near self-oscillation.
3. **Filter AR envelope (+ amount)** — each voice's cutoff is opened by its own
   envelope, up to ~5 octaves above the base Cutoff, scaled by Env Amount.
4. **Amplitude AR envelope** — attack/release shaping the voice level.

**The modulation matrix.** One LFO (Mod Rate) drives, scaled by Mod Depth:

- **→ Cutoff** — up to ±3 octaves of slow filter sweep (the breathing timbre)
- **→ Pitch** — a gentle vibrato (up to ~0.35 semitone)
- **→ PWM** — the pulse oscillator's duty cycle around 50%

Each voice gets a phase-spread copy of the LFO so a chord shimmers across its voices
rather than pumping as one block. Voices are allocated per `noteId` (free voice first,
otherwise the oldest is stolen). The summed mix passes through a one-pole **DC blocker**
(removing the small DC offset the unipolar PWM pulse would otherwise leave) and a gentle
`tanh` saturator for analog glue, keeping the peak well below full scale and DC at ~0.

## Parameters

| Index | Name      | Range | Default | Description |
|-------|-----------|-------|---------|-------------|
| 0     | Cutoff    | 0–1   | 0.45    | Base low-pass cutoff (exp. ~70 Hz – 14 kHz) |
| 1     | Resonance | 0–1   | 0.35    | Filter resonance / emphasis |
| 2     | EnvAmount | 0–1   | 0.55    | How far the filter envelope opens the cutoff |
| 3     | ModDepth  | 0–1   | 0.50    | LFO amount → cutoff + pitch + PWM |
| 4     | ModRate   | 0–1   | 0.35    | LFO rate (exp. ~0.05 – 9 Hz) |
| 5     | Attack    | 0–1   | 0.25    | Envelope attack time (~0–2.5 s) |
| 6     | Release   | 0–1   | 0.45    | Envelope release time (~0–3 s) |
| 7     | Level     | 0–1   | 0.70    | Output level |

## GUI

A bespoke dark-violet 80s-flagship panel (accents `#8a7bff` / `#43e0c4`):

- A live **modulation-matrix grid** whose routing nodes light and pulse as the LFO
  sweeps (`requestAnimationFrame`, paused when the tab is hidden).
- A **breathing pad waveform** plus a scrolling **teal LFO modulation trace** with a
  moving playhead.
- Eight hand-drawn SVG knobs (vertical drag, double-click reset, wheel fine-tune) with
  live engineering-unit readouts, six voice-activity LEDs, and a playable on-screen
  keyboard (mouse, touch, and computer-keyboard `a w s e d f t g y h u j k`).
- Real **CSS `@keyframes`** animations: active voice LEDs breathe via `ledPulse`, and
  the header logo glows via `logoGlow` — layered on top of the `rAF` canvas animation.

Self-contained: inline CSS/JS/SVG, no external assets or network requests. Every
control is wired to `window.vstai.setParam(index, value)` with real values and
initialised to its default on load.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.073, peak 0.179, dc -0.0001 (DC blocker), nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 8 parameters report `✓ affects` (rel Δ 0.59–1.43)

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `gui.html` — the self-contained animated GUI
- `spec.json` — plugin metadata, theme and parameter map
- `matrix-poly.vstai` — packed bundle
- `preview.wav` — rendered preview
