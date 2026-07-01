# Sweet Drive

A warm **asymmetric soft-clip overdrive** — boutique-pedal break-up in the SD-1
lineage. Where a symmetric Tube-Screamer-style drive clips both halves of the
waveform equally, Sweet Drive intentionally clips **one half harder than the
other**. That asymmetry generates **even harmonics** for a sweeter, slightly
fatter break-up, sitting over a gentle mid-hump.

## Signal chain

1. **Pre-clip high-pass (~110 Hz)** — cleans sub-bass before clipping for a
   tighter, more focused break-up.
2. **Mild mid-hump (~720 Hz)** — a gentle resonant emphasis blended back in,
   adding the singing midrange weight.
3. **Touch envelope** — a fast follower scales the effective drive a little, so
   harder input pushes harder (amp-like dynamics).
4. **Asymmetric soft clipper** — a `tanh` waveshaper with a drive-dependent DC
   bias so the positive and negative lobes saturate by different amounts; a
   DC blocker (~12 Hz) removes the static offset while keeping the dynamic
   asymmetry (and its even harmonics).
5. **Post tone low-pass (700–6500 Hz)** — shapes brightness.
6. **Level + dry/wet Mix** — output gain and parallel blend.

Gain-compensated so Drive sweeps clean → singing overdrive rather than just
getting louder. Bounded; render peak ~0.44 at defaults.

## Parameters

| # | Name  | Range | Default | Notes |
|---|-------|-------|---------|-------|
| 0 | Drive | 0–1   | 0.5     | Clean → singing overdrive; also grows the asymmetry/warmth |
| 1 | Tone  | 0–1   | 0.5     | Post low-pass brightness, 700–6500 Hz |
| 2 | Level | 0–1   | 0.6     | Output gain, 0–1.2× |
| 3 | Mix   | 0–1   | 1.0     | Dry/wet blend |

## GUI

A self-contained HTML document (inline CSS/JS/SVG, no external assets): a glossy
lemon-yellow boutique pedal face with corner screws, a glowing honey LED, a
single big **chrome drive knob** with tick ring, and three mini chrome knobs for
Tone / Level / Mix. A live animated scope draws the **asymmetric clipping
waveform** (one half rounder than the other) reacting to every control.

Controls: drag vertically (Shift = fine), scroll wheel, arrow keys, double-click
to reset. Every parameter is wired through `window.vstai.setParam(index, value)`
and initialised to its default via `window.vstai.onReady`.

Accent: `#ffd23d` (lemon) / `#ff8a2a` (honey).

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/sweet-drive/assembly.ts /tmp/sweet-drive.wasm
node factory/tools/wasm-runner.mjs /tmp/sweet-drive.wasm \
  --params /tmp/sweet-drive-params.json --wav factory/plugins/sweet-drive/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/sweet-drive/spec.json
```

> *Sweet Drive* is an original DSP design inspired by the asymmetric-clipping
> overdrive class. It is not affiliated with, nor a clone of, any trademarked
> product.
