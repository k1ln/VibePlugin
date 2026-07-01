# Crush Comp

An aggressive FET-style compressor with built-in distortion — an original effect in the
"all-buttons-in" lineage of slamming dynamics processors, distinct from the factory's clean
FET / opto / VCA compressors by its extreme range and harmonic colour.

## What it does

A fast, stereo-linked **peak** detector drives a soft-knee, dB-domain **gain computer**. Ratio
is a stepped selector that climbs from a gentle **2:1** through 4 / 6 / 10 / 20:1 to a brutal
**NUKE** limiting mode. The release is **program-dependent**: an ultra-fast follower watches for
busy / transient material and lets the envelope recover faster on it. A **DIST** stage layers
asymmetric 2nd/3rd-harmonic FET grit that grows both with the control and with how hard the
compressor is working (more gain reduction → more colour). A DC blocker cleans the asymmetric
saturation and a dry/wet **Mix** blends the processed signal back.

Low Threshold + high Ratio clearly slams and pumps; DIST clearly adds grit. Output is bounded
(soft saturation + clamp, peak well under full scale).

## Parameters

| Index | Name      | Range            | Default | Notes |
|-------|-----------|------------------|---------|-------|
| 0     | Threshold | 0..1 (-40..0 dB) | 0.30    | lower = more compression |
| 1     | Ratio     | 0..5 (step 1)    | 3       | 2:1, 4:1, 6:1, 10:1, 20:1, NUKE |
| 2     | Attack    | 0..1 (0.05..30 ms) | 0.15  | curved |
| 3     | Release   | 0..1 (30..800 ms) | 0.30   | curved; program-dependent |
| 4     | Dist      | 0..1             | 0.35    | harmonic colour amount |
| 5     | Mix       | 0..1             | 1       | dry/wet |

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the in-process `asc` driver)
- `gui.html` — self-contained animated GUI: orange/black rack module with a stepped RATIO
  selector reading up to NUKE, a fast-slamming gain-reduction bar, and a glowing DIST harmonic
  readout
- `spec.json` — plugin manifest (params, theme, paths)
- `preview.wav` — rendered preview
- `crush-comp.vstai` — packed bundle

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/crush-comp/assembly.ts /tmp/crush-comp.wasm
node factory/tools/wasm-runner.mjs /tmp/crush-comp.wasm \
  --params /tmp/crush-comp-params.json --wav factory/plugins/crush-comp/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/crush-comp/spec.json
```

Theme accents: `#ff7a2a` / `#ffd23d`.
