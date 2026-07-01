# Arc Poly

A vintage American-style **polyphonic** synth **instrument** (original DSP). A bank
of up to **8 independent voices**, each with its own VCO (bright saw + PWM pulse),
its own smooth 4-pole resonant low-pass filter with **its own decay envelope**, and
its own amp envelope — so holding a chord sounds **every note at its own pitch**
(true polyphony: 2 held notes give 2 distinct pitches).

The signature is a shared **Sample & Hold** modulator: a stepped-random source that
samples a fresh random level at the **S&H Rate** and wobbles every voice's filter
cutoff by **S&H Depth** in lock-step — the classic ARP-style burbling / random-step
filter movement across the whole chord. Pitch tracks each played note exactly (host
passes frequency in Hz). Velocity nudges per-voice loudness.

Plays via `noteOn(id, freqHz, velocity)` / `noteOff(id)`; each `noteOn` allocates a
free voice (oldest-voice steal when all 8 are busy).

## Signal path (per voice)

```
VCO (saw + PWM pulse) -> 4-pole resonant ladder LPF -> amp env -> sum
                          ^ cutoff = base + EnvAmount*filterEnv + S&HDepth*sampleHold(random steps @ S&HRate)
summed voices -> DC block -> saturate -> Level
```

## Parameters

| Index | Name        | Range | Default | Description |
|-------|-------------|-------|---------|-------------|
| 0 | Cutoff      | 0–1 | 0.42 | Base filter cutoff (~70 Hz → ~9 kHz, exponential) |
| 1 | Resonance   | 0–1 | 0.55 | Filter resonance; high values approach self-oscillation |
| 2 | Env Amount  | 0–1 | 0.60 | How far each voice's filter decay envelope opens the cutoff |
| 3 | S&H Depth   | 0–1 | 0.45 | Stepped-random modulation depth into the cutoff |
| 4 | S&H Rate    | 0–1 | 0.40 | Sample & hold clock rate (~0.4 Hz → ~24 Hz) |
| 5 | Decay       | 0–1 | 0.45 | Filter & amp envelope decay (~40 ms → ~1.6 s) |
| 6 | Level       | 0–1 | 0.80 | Output level |

## GUI

Self-contained HTML (inline CSS/JS/SVG, no external assets): a slate-grey + orange
hardware panel with mounting screws, a glowing **Sample & Hold** staircase scope
that re-samples at the live rate and scales by depth, warm orange vertical faders
(green for the S&H pair) with lit caps, and a playable on-screen keyboard
(mouse/touch drag + computer-keyboard A–K row, which holds multiple keys for
chords). Faders drag vertically, wheel to fine-tune, double-click to reset; every
control is wired to its real parameter value via `window.vstai.setParam`.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms=0.0114, peak=0.093, dc≈0.0, nan=0
- checks: present ✓, finite ✓, noClip ✓ (peak well under 1.0), paramsReactive ✓
- all 7 params reported `✓ affects`

**Polyphony probe** (hold 220 Hz + 330 Hz simultaneously, single-bin DFT over the
steady region): each fundamental in the chord matches its solo level —
220 alone = 0.00064 → in chord 0.00066; 330 alone = 0.00047 → in chord 0.00045
(energy ratio 1.47, vs ~50× last-note bias before). Both pitches sound at once.

Preview render: `preview.wav`.
