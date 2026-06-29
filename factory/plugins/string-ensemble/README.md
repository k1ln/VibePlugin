# String Ensemble

A paraphonic 70s-style **string machine** instrument for the VibePlugin factory —
an original take on the classic divide-down "string ensemble" synthesizer, with a
bespoke animated GUI.

## Sound

Every held note drives **two band-limited sawtooth oscillators** — the note and
its octave — which are summed into a single voice bus. A **shared slow
Attack/Release envelope** swells the whole section in and out, so holding a chord
blooms into a lush, shimmering bowed-string pad. The bus is tilted by a one-pole
**Tone** low-pass, then fed through a triple-tap **BBD-style ensemble chorus**:
three short delay lines each modulated by its own slow LFO at staggered phases,
summed back with the dry signal to produce the signature lush stereo movement.

The voice sum runs through a gentle soft-limiter so dense chords stay bounded
(peak well under full scale); the chorus reads are NaN/range-guarded.

## Parameters

| # | Name     | Range | Default | Effect |
|---|----------|-------|---------|--------|
| 0 | Attack   | 0–1   | 0.35    | Swell time of the shared envelope (~5 ms … 2.5 s). |
| 1 | Release  | 0–1   | 0.45    | Fade time after the last key lifts (~30 ms … 4 s). |
| 2 | Ensemble | 0–1   | 0.70    | Chorus depth / mix — the lush BBD shimmer. |
| 3 | Tone     | 0–1   | 0.55    | Brightness (low-pass corner 700 Hz … 9 kHz). |
| 4 | Level    | 0–1   | 0.60    | Output level. |

## DSP / ABI

`assembly.ts` implements the VibePlugin WASM ABI: `init`, `process`,
`getInputPtr`/`getOutputPtr`/`getParamsPtr`/`getNumParams`, plus the synth
exports `noteOn(id, freqHz, vel)` / `noteOff(id)`. It is paraphonic with a
16-slot voice pool sharing one amplitude envelope; voices keep ringing through
the release tail and are retired only once the section is silent. All DSP is
`f32`, allocation-free in `process()`, planar stride 8192, no imports.

## GUI

`gui.html` is one self-contained document (inline CSS/JS/SVG, no external
assets): a warm wood cabinet with an animated bowed-strings silhouette that
shimmers and a bow that glides while notes are held, a breathing ensemble glow,
five hand-drawn SVG knobs (drag, wheel, double-click to reset) and a playable
cream keyboard (mouse, touch, or the `A–K` computer-keyboard row). Theme accents
`#e8d6a0` / `#c0a86a`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/string-ensemble/assembly.ts /tmp/string-ensemble.wasm
node factory/tools/wasm-runner.mjs /tmp/string-ensemble.wasm \
  --params /tmp/string-ensemble-params.json --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/string-ensemble/spec.json
```

The offline runner reports **VERDICT: PASS** with all five parameters
`✓ affects`.
