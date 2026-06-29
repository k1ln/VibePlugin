# Tine Piano

A polyphonic electric **tine-piano** instrument for the VibePlugin factory — an
original model of the classic 1970s suitcase-style electric piano (struck metal
tines voiced through an amp + tremolo). No samples; pure synthesis.

## Sound

Each of the 12 voices models a struck metal tine with **two-operator FM**:

- a sine **carrier** at the played pitch, phase-modulated by
- a higher-ratio **modulator** whose modulation index starts high at the strike
  and **decays fast** — this is the bright, bell-like *bark* of the attack that
  melts into a mellow sine **body**.

On top of the FM:

- **Velocity** scales both the bark amount and the brightness, so harder strikes
  bark harder and brighter, softer strikes are rounder.
- A natural multiplicative **amplitude decay** (plus a short release tail on
  key-up) lets notes sing and ring; chords play with independent contours.
- A per-voice one-pole **body low-pass** (driven by Tone) keeps the sustain
  mellow.
- A gentle **opposed-phase stereo tremolo** sways the amplitude L/R for the
  signature suitcase wobble.

The mix is soft-saturated (`tanh`) and gain-staged so a full chord stays bounded
(rendered preview peaks ~0.24).

## Parameters

| # | Name          | Range | Default | Effect |
|---|---------------|-------|---------|--------|
| 0 | Bell          | 0..1  | 0.55    | Attack FM modulation depth — the bell/bark amount and its decay length |
| 1 | Decay         | 0..1  | 0.55    | Body decay time (~0.5 s … ~9 s tail) |
| 2 | Tone          | 0..1  | 0.5     | Brightness — modulator ratio + body low-pass cutoff |
| 3 | Tremolo Depth | 0..1  | 0.35    | Stereo amplitude wobble depth |
| 4 | Tremolo Rate  | 0..1  | 0.3     | Tremolo LFO rate (0.5 … 7 Hz) |
| 5 | Level         | 0..1  | 0.7     | Output level |

Parameter indices match `assembly.ts` and the `setParam(index, value)` calls in
`gui.html`.

## GUI

A bespoke warm-wood **suitcase-piano panel** (amber accent `#e0a060` / `#ffcf8a`):

- an animated **tine harp** of vibrating metal tines struck by little felt
  hammers — tines wobble and glow on each note, hammers recoil;
- a **tremolo lamp** that sways/glows in time with the Tremolo Depth + Rate;
- six hand-built **SVG knobs** (drag to turn, double-click to reset, wheel to
  fine-tune, arrow keys, Shift for fine), each with a live value readout;
- a playable on-screen **keyboard** (click / touch / computer keys A–K) wired to
  `window.vstai.noteOn/noteOff`, which also triggers the harp strike animation.

Self-contained: all CSS/JS/SVG inline, no external assets.

## Build / test

```sh
# compile AssemblyScript -> WASM
node compiler/asc-driver.mjs factory/plugins/tine-piano/assembly.ts /tmp/tine-piano.wasm

# offline render + parameter-reactivity check (must report VERDICT: PASS)
node factory/tools/wasm-runner.mjs /tmp/tine-piano.wasm \
  --params /tmp/tine-piano-params.json \
  --wav factory/plugins/tine-piano/preview.wav --synth --seconds 3

# pack the distributable .vstai
node factory/tools/pack-vstai.mjs factory/plugins/tine-piano/spec.json
```

The runner reports `VERDICT: PASS` with every parameter marked `✓ affects`.

## Files

- `assembly.ts` — the FM tine-piano DSP (AssemblyScript → WASM)
- `spec.json` — plugin manifest (name, params, theme, paths)
- `gui.html` — the self-contained animated GUI
- `preview.wav` — rendered 3 s preview
- `tine-piano.vstai` — packed distributable
