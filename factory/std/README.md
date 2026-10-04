# Std effects

36 bread-and-butter effect plugins, generated from small definitions so they share one tested DSP prelude,
one GUI template and the normal pack/gallery pipeline.

| Group | Plugins |
|---|---|
| Filters | StdLadder12, StdLadder24 (zero-delay-feedback Moog ladder, tapped at pole 2 / 4), StdLowPass, StdHighPass (Butterworth 12/24 dB), StdBandPass, StdMultiFilter (SVF: LP/HP/BP/notch), StdWah |
| Reverb | StdReverb (Freeverb-style), StdRoom, StdHall, StdPlate (8-line Householder FDN) |
| Delay | StdDelay (tempo sync), StdPingPong, StdTapeEcho |
| Distortion | StdDistortion, StdOverdrive, StdFuzz, StdSaturator (all 2x oversampled), StdBitcrusher |
| Modulation | StdChorus, StdFlanger, StdPhaser, StdTremolo, StdVibrato, StdRingMod, StdPitchShift |
| Dynamics | StdCompressor, StdLimiter (look-ahead), StdGate, StdDeEsser, StdTransient |
| EQ / utility | StdEQ (4-band + HP), StdTone, StdGraphicEQ (10-band), StdWidener (mid/side), StdUtility |

## Layout

- `prelude.ts` — ABI buffers, helpers (`expMap`, `dbLin`, `softLim`, power-of-two delay line `dlr`, RBJ biquad `bqSet`/`bq`).
- `fx-*.mjs` — one definition per plugin: `params`, `groups`, `vizCode` (live curve in the GUI) and the DSP as
  fragments `globals` / `init` / `block` / `pre` / `sample` / `post` / `after`. `$Name` is the parameter "Name"
  (`params[P_NAME]` in DSP, `V[i]` in the GUI). See the header of `build.mjs` for the fragment contract.
- `build.mjs` — writes `factory/plugins/<slug>/{assembly.ts,def.mjs}`, runs `factory/tools/scaffold.mjs`
  (spec.json, test-params.json, gui.html), compiles, runs `wasm-runner` and `gui-check`.
- `react.mjs` — the strict QA gate (see below). `probe.mjs` — measure gain at tones, impulse tails, noise gain.

## Commands

```
node factory/std/build.mjs all            # regenerate + compile + runner + gui-check every effect
node factory/std/build.mjs std-hall       # one effect
node factory/std/build.mjs all --pack     # also pack .vstai into docs/gallery/data and rebuild index.json
node factory/std/react.mjs all --quiet    # strict QA: every param reactive, fuzz at 44.1/48/96/192 kHz, silence, block size
node factory/std/probe.mjs std-ladder-24 --set "1=0,2=0" --freqs 300,1400,5600
node factory/std/probe.mjs std-hall --set 9=1 --impulse --seconds 3     # reverb tail energy per 100 ms
node factory/std/probe.mjs std-hall --set 9=1 --noise                   # wet loudness vs input
```

Edit the definition, never the generated `assembly.ts`.

## Notes

- `wasm-runner`'s "params affect output" check is unreliable (its noise isn't reseeded between renders, so inert
  parameters still look reactive). `react.mjs` uses a deterministic input and requires >0.1% relative RMS change
  min-vs-max. Effects whose parameters only matter in some mode or on dynamic material declare `reactPatches`
  (extra mode settings) and `reactInput: "bursts"` in their definition.
- Delay-based effects use power-of-two buffers, so `Time` ranges are clamped to the buffer at very high sample rates.
- Gallery categories are keyed by the pack slug of the plugin *name* (`stdladder12`), not the folder slug.
