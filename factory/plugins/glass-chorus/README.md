# Glass Chorus

A pristine hi-fi **stereo chorus / flanger combo** — clean,
glassy, studio-grade stereo modulation that morphs between a lush multi-voice
**chorus** and a sweeping **flanger** via a single Mode control, with a wide,
crystal-clear stereo image.

## How it works

Two fractional delay lines (one per channel) are read with linear interpolation
and modulated by quadrature LFOs, so the left and right voices sweep in
counter-phase for a wide, glassy stereo picture.

- **Mode** morphs the delay range and voicing from the long, gently detuned
  **chorus** region (~14 ms centre, wide gentle sweep) into the short
  **flanger** comb region (~1.4 ms centre, tight sweep).
- **Feedback** feeds the delayed signal back into the line to add the resonant
  flange *whoosh*; it engages more as Mode morphs toward flanger and stays
  bounded (≤ 0.85) so it never runs away.
- **Width** spreads the wet voices in stereo by offsetting the right-channel LFO
  phase and panning the wet voices in opposite directions.
- **Depth / Rate** shape the LFO sweep span and speed (0.05–6 Hz, exponential).
- A gentle 9 kHz wet de-fizz low-pass keeps the comb highs glassy and clean —
  there is no saturation or grit anywhere in the path.
- **Mix = 0** is ~dry; the signal stays well-bounded (preview peak ≈ 0.6).

## Parameters

| # | Name     | Range | Default | Notes |
|---|----------|-------|---------|-------|
| 0 | Rate     | 0–1   | 0.30    | LFO speed, 0.05–6 Hz (exponential) |
| 1 | Depth    | 0–1   | 0.55    | Sweep depth |
| 2 | Mode     | 0–1   | 0.25    | Chorus ⟷ Flanger morph |
| 3 | Feedback | 0–1   | 0.40    | Flange resonance |
| 4 | Width    | 0–1   | 0.70    | Stereo spread |
| 5 | Mix      | 0–1   | 0.50    | Dry/wet |

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the VibePlugin ABI)
- `spec.json` — plugin manifest (name, params, theme, GUI)
- `gui.html` — self-contained animated GUI: a glassy cyan + lilac studio rack
  with two crystalline shimmering stereo waveforms sweeping in wide stereo and a
  chorus/flange morph slider
- `glass-chorus.vstai` — packed bundle
- `preview.wav` — rendered preview

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/glass-chorus/assembly.ts /tmp/glass-chorus.wasm
node factory/tools/wasm-runner.mjs /tmp/glass-chorus.wasm \
  --params /tmp/glass-chorus-params.json --wav factory/plugins/glass-chorus/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/glass-chorus/spec.json
```

Theme accents: `#7ae0ff` / `#c0b0ff`.
