# Pearl Reverb

A bright **early-digital reverb** for the VibePlugin factory. An original
algorithm in the spirit of the first generation of late-1970s digital studio
reverbs: dense, sparkly, and a little grainy — without cloning any plate or
hall.

## What it does

The engine is a feedback-delay network:

1. **Pre-delay** line gaps the dry hit from the onset of the tail.
2. A bank of **four parallel comb delays** (mutually prime-ish lengths, with a
   small left/right detune for width) builds the diffuse density. Each comb's
   feedback path runs through a one-pole damping low-pass so the tail loses
   highs over time.
3. A cascade of **three Schroeder allpass diffusers** smears the comb output
   into a smooth, metallic-free reverberation.
4. An **early-digital character** stage: a coarse quantiser grid plus a tiny
   deterministic "grit" residue and a **sparkle high-shelf**, for the bright,
   slightly sandy converter sound of the era.
5. A **DC blocker** and an output **tone tilt** finish the wet path before the
   dry/wet mix.

## Programs

The **Program** selector reshapes the tail (integer param, rendered as buttons):

- **Reverb** — balanced feedback, smooth musical decay.
- **Space** — longer feedback and heavier diffusion; the big, wide tail.
- **Gate** — dense early energy whose envelope is chopped shut by a hold/release
  gate triggered from the input transient (the classic nonlinear gated sound).

## Parameters

| Index | Name      | Range      | Default | Notes                                  |
|-------|-----------|------------|---------|----------------------------------------|
| 0     | Mix       | 0 – 1      | 0.30    | `Mix = 0` is a bit-exact dry passthrough |
| 1     | Decay     | 0 – 1      | 0.60    | tail length / feedback                  |
| 2     | Tone      | 0 – 1      | 0.65    | dark → bright (damping + sparkle)       |
| 3     | Pre-Delay | 0 – 0.15 s | 0.012   | gap before the tail                     |
| 4     | Program   | 0 – 2      | 0       | step 1 — Reverb / Space / Gate          |

## GUI

A self-contained, single-file HTML interface with a bespoke pearly look:
iridescent shell gradients, a drifting conic sheen, a glinting pearl orb logo,
SVG pearl knobs with gradient value arcs (drag to turn, double-click to reset,
shift for fine, wheel to nudge), a segmented digital readout, and glassy
program buttons that light up in the accent. No external assets.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/pearl-reverb/assembly.ts /tmp/pearl-reverb.wasm
node factory/tools/wasm-runner.mjs /tmp/pearl-reverb.wasm \
  --params /tmp/pearl-reverb-params.json --wav factory/plugins/pearl-reverb/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/pearl-reverb/spec.json
```

The runner reports **VERDICT: PASS** with all five parameters `✓ affects`, a
peak well under full scale, and no NaNs.
