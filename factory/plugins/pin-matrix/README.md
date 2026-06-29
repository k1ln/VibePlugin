# Pin Matrix

An eccentric British-modular **mono / paraphonic synth instrument** (original DSP,
inspired by the patch-matrix monosynths of early-1970s British studios — not a clean
American ladder synth). Three free-running oscillators feed a **ring modulator** for
clangy, inharmonic metallic tones, then a **diode-ladder resonant low-pass** that can
self-oscillate, all shaped by a snappy **trapezoid-style envelope**.

Plays via `noteOn(id, freqHz, velocity)` / `noteOff(id)`; the host passes frequency in
Hz, so pitch tracks the played note exactly. Up to two held notes sound at once
(last-two-note paraphony, oldest-voice stealing).

## Signal path

```
osc1 saw  ─┐
osc2 tri  ─┼─ ring mod (osc1 × osc2) ─┐
osc3 pulse─┘   mix (saw↔pulse + tri)  ├─ asym grit ─ diode-ladder LPF ─ trapezoid env ─ tanh ─ level
                                       ┘   ^ cutoff = base · 2^(EnvAmount·env), reso → self-osc
```

- **osc2** is detuned to a non-integer ratio (≈1.498×) so the ring product is strongly
  inharmonic — that bell-like, clangy metal is the EMS-lineage signature.
- The ladder feedback runs through a soft `tanh` diode nonlinearity and the input stage
  adds an asymmetric squared term, so the filter bites and rings rather than staying clean.

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0 | Osc Mix     | 0–1 | 0.50 | Crossfade saw (0) ↔ pulse (1) over a constant triangle bed |
| 1 | Ring Mod    | 0–1 | 0.45 | Ring-modulator amount — blends in the inharmonic osc1×osc2 product |
| 2 | Cutoff      | 0–1 | 0.50 | Diode-ladder base cutoff (~50 Hz → ~14 kHz, exponential) |
| 3 | Resonance   | 0–1 | 0.55 | Filter resonance; high values push toward self-oscillation |
| 4 | Env Amount  | 0–1 | 0.70 | How far the trapezoid envelope opens the cutoff (up to ~7 oct) |
| 5 | Decay       | 0–1 | 0.45 | Envelope decay toward its plateau (~40 ms → ~2.2 s) |
| 6 | Level       | 0–1 | 0.70 | Output level |

## GUI

A bespoke, fully self-contained HTML panel (inline CSS/JS/SVG, no external assets): the
iconic colour-coded **pin patch matrix** with glowing routing pins that pulse with the
audio, a teal enclosure with corner screws, a red **control stick** joystick (X → Cutoff,
Y → Ring Mod), hand-drawn SVG knobs (drag to turn, double-click to reset, wheel to
fine-tune) and a playable two-octave keyboard (mouse, touch, or QWERTY). Accent
`#6ad0ff` / `#ff7a7a`.

## Test result

`node factory/tools/wasm-runner.mjs … --synth --seconds 3` → **VERDICT: PASS**

- output: rms=0.045, peak=0.521, dc≈0.0, nan=0
- checks: present ✓, finite ✓, noClip ✓ (peak well under 1.5), paramsReactive ✓
- all 7 params reported `✓ affects`

Preview render: `preview.wav`.
