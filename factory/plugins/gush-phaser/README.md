# Gush Phaser

A 4-stage OTA phaser in the Small Stone lineage, rebuilt as an original
VibePlugin effect with a gushy, watery, deep sweep and a resonant **Color**
feedback control.

## DSP

Four cascaded first-order allpass filters are swept by a triangle LFO. The
allpass break frequency glides log-style between ~120 Hz and ~2.5 kHz, moving
the cancellation notches up and down the spectrum:

- **Rate** — LFO speed, exponentially mapped ~0.03 .. 9 Hz.
- **Depth** — how far up the spectrum the notches sweep (span/depth).
- **Color** — feedback amount around the allpass chain. At 0 the sweep is gentle
  and lush; toward 1 the bounded feedback (capped < 0.95) sharpens the notches
  into an intense, vocal, "gushing" resonant whoosh. No runaway.
- **Mix** — dry/wet blend (classic phaser = dry + phase-shifted).

The two stereo channels run the LFO 90° apart for width. Output is clamped to
[-1, 1]; the offline test bench renders peak ≈ 0.59 (well under 1.0).

Process is allocation-free; all state lives in module-scope `StaticArray`s and
all math is f32 (`Mathf.*`).

## Files

- `assembly.ts` — AssemblyScript DSP (compiled to WASM in-process by the host).
- `spec.json` — plugin manifest (name, params, theme, gui).
- `gui.html` — self-contained animated GUI: glossy phthalo-blue pedal with a big
  Rate knob, Depth/Mix knobs, a glowing magenta Color feedback switch, and a live
  magenta-to-cyan notch-wave spectrum swooshing across the display.
- `preview.wav` — rendered audio preview.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/gush-phaser/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --wav preview.wav --seconds 3
# VERDICT: PASS — all 4 params ✓ affect
node factory/tools/pack-vstai.mjs factory/plugins/gush-phaser/spec.json
```

Accent colors: `#5ad0ff` (cyan) / `#ff5ad0` (magenta).
