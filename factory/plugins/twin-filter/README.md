# Twin Filter

A dual series-filter monophonic **instrument** — an original voice in the
classic Japanese dual-filter mono lineage (modeled on the **Yamaha CS-15 /
CS-10** topology, shipped as the original "Twin Filter"). Two detuned sawtooth
oscillators are summed and driven through a **resonant high-pass filter in
series with a resonant low-pass filter**. Because the high-pass comes first you
can carve hollow, nasal, band-pass tones that single-filter monos cannot reach:
**HP Cutoff** thins and hollows the body, **LP Cutoff** darkens the top, and
where the two corners pinch together you get a reedy, vocal band. A punchy
filter envelope (**Env Amount** + **Decay**) sweeps both cutoffs upward for the
signature "wow" attack.

Plays via `noteOn(id, freqHz, velocity)` / `noteOff(id)`; the host passes
frequency in Hz, so pitch tracks the played note exactly. Up to 2 voices with
last-note-priority voice stealing; velocity scales loudness.

## Signal path (per voice)

```
osc1 + osc2 (detuned saws)
   -> resonant HIGH-PASS (2-pole SVF, HP tap)   ← thins / hollows
   -> resonant LOW-PASS  (2-pole SVF, LP tap)   ← darkens
   -> amp env -> soft saturate -> DC block -> level
        ^ both cutoffs = base * 2^(filterEnv * EnvAmount)
```

The two filters share one **Resonance** control. As Resonance rises, the SVF
damping drops toward self-oscillation while a soft saturator keeps the output
bounded (preview peak ≈ 0.51, well under full scale).

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0 | LP Cutoff  | 0–1 | 0.62 | Low-pass corner (~120 Hz → ~12 kHz). Lower = darker. |
| 1 | HP Cutoff  | 0–1 | 0.32 | High-pass corner (~20 Hz → ~1.8 kHz). Higher = thinner / hollower. |
| 2 | Resonance  | 0–1 | 0.55 | Shared resonance for both filters; high values approach self-oscillation. |
| 3 | Env Amount | 0–1 | 0.60 | How far the filter envelope sweeps both cutoffs (up to ~3 octaves). |
| 4 | Decay      | 0–1 | 0.42 | Filter & amp envelope decay (~40 ms → ~1.4 s). |
| 5 | Detune     | 0–1 | 0.30 | Spread between the two oscillators (osc2 up to +3.5%). |
| 6 | Level      | 0–1 | 0.80 | Output level. |

## GUI

A slim charcoal panel with a live **twin-filter response scope**: an orange
high-pass curve climbing from the left and a teal low-pass curve falling from
the right, pinching into a highlighted **band** between their two resonant
knees. Seven custom dials (teal + orange) drive every parameter via
`window.vstai.setParam`, with vertical drag, mouse-wheel, and double-click
reset. Real `@keyframes` sheen + scan animations and animated voice LEDs.
Self-contained single HTML document — no external assets.

## Test result

`node factory/tools/wasm-runner.mjs twin-filter.wasm --params … --synth --seconds 3`
→ **VERDICT: PASS**

- output: rms=0.135, peak=0.511, dc≈0.0005, nan=0
- checks: present ✓, finite ✓, noClip ✓, paramsReactive ✓
- all 7 params reported `✓ affects`

Preview render: `preview.wav`.
