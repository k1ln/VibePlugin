# Poly Moog

A fat, warm polyphonic analog synthesizer instrument for the VibePlugin factory.

## What it is

Poly Moog is an original 8-voice subtractive synth modelled on the behaviour of a
classic six-voice ladder polysynth. Each voice is fully independent, so chords ring
out with their own envelopes and filter motion rather than retriggering a single
shared engine.

**Per-voice signal path**

1. **Three detuned oscillators** — two band-limited (polyBLEP) sawtooths and one
   band-limited 50%-duty pulse, spread apart by the Detune control for a thick,
   beating analog tone.
2. **4-pole MOOG-style ladder low-pass** — a 24 dB/oct ladder filter with a `tanh`
   feedback path for warm, stable resonance up toward self-oscillation.
3. **Filter envelope (+ amount)** — the filter cutoff is swept by its own
   attack/release envelope, up to ~6.5 octaves above the base Cutoff, scaled by
   Filter Env Amount.
4. **Amplitude envelope** — attack/release shaping the voice level (with a fixed
   musical decay/sustain inside for a classic fat-pad contour).

Voices are allocated per `noteId` (free voice first, otherwise the oldest voice is
stolen). The summed output is headroom-scaled and passed through a gentle `tanh`
saturator for analog glue, then the Level control — the peak stays well below full
scale even on dense chords.

## Parameters

| Index | Name           | Range | Default | Description |
|-------|----------------|-------|---------|-------------|
| 0     | Detune         | 0–1   | 0.35    | Spread between the three oscillators (richer beating) |
| 1     | Cutoff         | 0–1   | 0.50    | Base ladder cutoff (≈50 Hz … 16 kHz, exponential) |
| 2     | Resonance      | 0–1   | 0.35    | Ladder feedback / emphasis (toward self-oscillation) |
| 3     | FilterEnvAmt   | 0–1   | 0.60    | How far the filter envelope sweeps the cutoff (up to ~6.5 oct) |
| 4     | Attack         | 0–1   | 0.06    | Amp + filter attack time (≈2 ms … 1.2 s) |
| 5     | Release        | 0–1   | 0.35    | Amp + filter release time (≈20 ms … 2.5 s) |
| 6     | Level          | 0–1   | 0.70    | Output level |

## GUI

A bespoke single-file HTML panel: wood end-cheeks around a black control surface,
seven chunky SVG knobs (drag vertically, double-click to reset, wheel / shift-wheel
to fine-tune, arrow keys when focused), an animated row of eight voice LEDs that
light per held note (matching the engine's free-first / oldest-steal allocation), a
fat green CRT-style oscilloscope whose trace responds to Detune / Cutoff / Resonance
/ Level and the active-voice count, and a playable two-octave keyboard (mouse, touch,
or computer keys A–K). Accent palette `#ffae5a → #ff7a5a`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/poly-moog/assembly.ts /tmp/poly-moog.wasm
node factory/tools/wasm-runner.mjs /tmp/poly-moog.wasm \
  --params /tmp/poly-moog-params.json --wav factory/plugins/poly-moog/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/poly-moog/spec.json
```

The offline runner reports **VERDICT: PASS** with all seven parameters marked
`✓ affects`.
