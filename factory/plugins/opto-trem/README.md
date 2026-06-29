# Opto Trem

An optical multi-shape stereo tremolo. A low-frequency oscillator drives a
smoothed photocell-style gain cell — modelling the gentle lag of a
light-dependent resistor (LDR) — so the level pulses musically even on hard
shapes. Set the LFO contour, speed and depth, then morph from a mono tremolo
to an auto-pan that sweeps the image side to side. Clean amplitude modulation,
no distortion.

## Controls

| Param  | Range | Default | What it does |
|--------|-------|---------|--------------|
| Rate   | 0..1  | 0.4     | LFO speed, ~0.1 Hz (slow swell) to ~12 Hz (fast pulse), perceptually spaced. |
| Depth  | 0..1  | 0.7     | Modulation amount. The gain swings between `1-Depth` and `1`, so **Depth = 0 leaves the signal untouched**. |
| Shape  | 0..3  | 0 (step 1) | LFO contour selector: 0 sine, 1 triangle, 2 square, 3 ramp (sawtooth). |
| Stereo | 0..1  | 0       | Morphs from a mono tremolo (both cells in phase) to an auto-pan where the L/R cells run in anti-phase (half-cycle offset) and sweep the image. |
| Mix    | 0..1  | 1       | Dry/wet blend of the modulated signal against the input. |

## DSP notes

- A single LFO phase accumulator wrapped each sample. In auto-pan the right
  channel reads the phase shifted by `0.5 * Stereo` (up to a half cycle), so
  the cells dim in opposition and the image moves L↔R.
- Each channel has its own **photocell lag**: a one-pole smoother whose corner
  rises with Rate (~25..220 Hz), modelling the LDR's response so a square LFO
  pulses without clicks and slow settings stay buttery.
- Brightness (0..1) maps to gain `(1-Depth) + Depth*cell`; a mild make-up gain
  (`1 + 0.35*Depth`) keeps deep tremolo from feeling quieter.
- All math is `f32` (`Mathf.*`, explicit `f32()` casts), no allocation in
  `process()`, planar buffers with stride `MAX_FRAMES = 8192`. Gain-staged so
  the peak stays below full scale (preview peak ≈ 0.62).

## GUI notes

- Hand-authored, fully self-contained vintage-pedal interface (no external
  fetches; the only `xmlns` string is for `createElementNS` SVG knobs). Every
  parameter is wired to `window.vstai.setParam`: Rate/Depth/Mix and Stereo via
  custom SVG knobs, Shape via a four-way segmented selector, plus `onReady`.
- Motion is twofold: a `requestAnimationFrame` loop drives the audio-reactive
  photocell lamp opacity and the L/R see-saw meters, **and** real CSS
  `@keyframes` provide always-on optical life — `opto-breathe` slowly pulses a
  halo behind the lamp and `opto-shimmer` glows the active shape button.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/opto-trem/assembly.ts /tmp/opto-trem.wasm
node factory/tools/wasm-runner.mjs /tmp/opto-trem.wasm \
  --params /tmp/opto-trem-params.json --wav factory/plugins/opto-trem/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/opto-trem/spec.json
```

The runner reports `VERDICT: PASS` with every parameter `✓ affects`.
