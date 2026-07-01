# Steel Flanger

An extreme, metallic jet-engine flanger (effect). Where a gentle flanger
whispers, this one screams: a swept short delay with strong regeneration
drives the comb filter into clangy, almost-pitched stainless resonance.

## DSP

A triangle LFO sweeps a fractional (linear-interpolated) delay around a
**Manual** base position over a very wide range (0.1–14 ms base, up to +9 ms
of sweep), forming a moving comb filter summed with the dry signal. A bipolar
**Feedback** control (−97 %…+97 %) feeds the delayed signal back through the
line: positive gives a bright stainless ring, negative a hollow through-zero
hiss. A one-pole damp plus a soft cubic saturator inside the feedback path keep
the regeneration bounded but aggressive, and the wet/dry sum is clamped so comb
peaks stay below full scale. Pure algorithm, no samples.

## Parameters

| # | Name | Range | Default | Notes |
|---|------|-------|---------|-------|
| 0 | Rate | 0–1 | 0.22 | LFO speed, exp 0.02–10 Hz |
| 1 | Depth | 0–1 | 0.85 | sweep width (up to +9 ms) |
| 2 | Manual | 0–1 | 0.25 | parks the comb (0.1–14 ms base delay) |
| 3 | Feedback | 0–1 | 0.78 | bipolar regen −97 %…+97 %, metallic resonance |
| 4 | Mix | 0–1 | 0.55 | dry/wet |

## GUI

`gui.html` — a self-contained brushed-stainless-steel pedal faceplate with
chrome corner bolts, machined chrome knobs with glowing cyan arc indicators,
an animated jet-engine comb display (silver-to-cyan glinting bars that sweep
and sharpen with Rate / Depth / Manual / Feedback), a sweeping metal sheen and
a pulsing status LED. Knobs are vertical-drag with double-click reset; every
param is wired through `window.vstai.setParam`.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/steel-flanger/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --wav preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/steel-flanger/spec.json
```

Verdict: **PASS** — audio present, finite, no clipping (peak ≈ 0.66), all five
parameters reactive.

Theme accent `#b8c4d0` / `#5ad0ff`.
