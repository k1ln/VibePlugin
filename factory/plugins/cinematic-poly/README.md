# Cinematic Poly

A lush, grand, brass-leaning polyphonic synthesizer for the VibePlugin factory.

## What it is

Cinematic Poly is an original 8-voice subtractive synth inspired by the great
wood-cheeked cinematic polysynths of the late 1970s. Each voice is fully
independent — chords ring out with their own envelopes and filter motion — and is
built from **two stacked layers** for a thick, choral body and the unmistakable
grand, swelling brass character.

**Per-voice signal path**

1. **Two layers, each with two detuned oscillators** — every layer pairs a
   band-limited (polyBLEP) sawtooth with a band-limited pulse. The two oscillators
   within a layer are spread apart, and the lower/upper layers are detuned against
   each other, all scaled by Detune for rich, beating motion.
2. **Per-layer resonant 4-pole low-pass** — a 24 dB/oct ladder-style filter with a
   `tanh` feedback path for stable resonance. The upper layer opens a little brighter
   for the reedy brass sheen.
3. **Filter ADSR (+ amount)** — a per-voice filter envelope sweeps the cutoff up to
   ~6 octaves above the base Cutoff, scaled by Filter Env Amount.
4. **Amplitude ADSR** — long, expressive attack/release by default and a near-full
   sustain, shaping each voice for slow cinematic swells.

The summed mix is headroom-scaled, soft-saturated for analog glue, lifted by a
**brightness tilt**, then widened by a **gentle global ensemble chorus** (three
slow modulated taps) for the wide, choral sheen. Voices are allocated per `noteId`
(free voice first, otherwise the oldest voice is stolen). A final `tanh` master
stage keeps the peak below full scale even on dense chords.

## Parameters

| Index | Name         | Range | Default | Description |
|-------|--------------|-------|---------|-------------|
| 0     | Detune       | 0–1   | 0.35    | Layer + oscillator detune spread (beating richness) |
| 1     | Cutoff       | 0–1   | 0.50    | Base low-pass cutoff (exp. ~80 Hz – 14 kHz) |
| 2     | Resonance    | 0–1   | 0.30    | Filter resonance / emphasis |
| 3     | FilterEnvAmt | 0–1   | 0.55    | How far the filter envelope opens the cutoff (octaves) |
| 4     | Attack       | 0–1   | 0.18    | Amp + filter attack time (~2 ms – 2.2 s) |
| 5     | Release      | 0–1   | 0.40    | Amp + filter release time (~20 ms – 3.5 s) |
| 6     | Brightness   | 0–1   | 0.55    | Global high-frequency tilt / sheen + ensemble width |
| 7     | Level        | 0–1   | 0.70    | Master output level |

## GUI

A bespoke cinematic-console GUI: wooden end cheeks, a brushed-metal panel
with a sweeping sheen, eight hand-drawn SVG knobs (drag to turn, wheel to nudge,
double-click to reset), a touch-sensitive **ribbon controller** strip that mirrors
Brightness, eight voice-activity lamps, an animated dual-layer amber glow scope, and
a weighted-key on-screen keyboard playable by mouse, touch, or the computer keyboard.
Single self-contained HTML document — no external assets. Wired to the host via
`window.vstai.onReady / setParam / noteOn / noteOff`.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.065, peak 0.222, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 8 parameters report `✓ affects`

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `gui.html` — the self-contained bespoke GUI
- `spec.json` — plugin metadata, theme and parameter map
- `cinematic-poly.vstai` — packed bundle
- `preview.wav` — rendered preview
