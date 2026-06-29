# Vari-Mu

A program-dependent **variable-mu tube compressor** — an original model in the
spirit of classic 1950s broadcast valve limiters.

## What it does

Vari-mu compression has no fixed ratio. The amount of gain reduction grows with
how far the signal pushes above the threshold, so the compression "tube" bends
progressively more on loud material than on quiet material. The result is a
soft, rising-ratio knee that sounds smooth and natural — gentle on quiet
passages, firm on peaks, and always bounded (it never collapses to silence).

### Signal path
1. **Input drive** pushes the signal into the gain-reduction stage (0.25×–4×).
2. A **stereo-linked detector** tracks the loudest channel.
3. A **slow, level-dependent attack** charges a fast envelope stage, which in
   turn feeds a much slower release tail — a **dual time-constant release** that
   gives the characteristic lazy, musical recovery.
4. The **rising-ratio gain computer** maps overshoot above threshold through an
   accelerating, tanh-bounded curve: local ratio increases with level.
5. A touch of **even-order tube harmonics** plus a soft tanh saturator add valve
   warmth on the peaks; a DC blocker removes the bias offset.
6. **Output** trims make-up gain (0.5×–2×) and the signal is hard-bounded.

## Controls

| Param | Index | Range | Default | Effect |
|-------|-------|-------|---------|--------|
| Input          | 0 | 0–1 | 0.50 | Drive into the tube; harder push = more compression |
| Threshold      | 1 | 0–1 | 0.50 | Onset level; higher = less compression |
| Time Constant  | 2 | 0–1 | 0.40 | Attack + dual release scaling (fast → slow) |
| Output         | 3 | 0–1 | 0.50 | Make-up / output trim |

## Files
- `assembly.ts` — AssemblyScript DSP (planar f32, no allocation in `process()`).
- `spec.json` — plugin metadata, theme, param list.
- `gui.html` — bespoke vintage tube-compressor GUI (glowing vacuum tubes, a
  swaying backlit gain-reduction VU meter, brass-trimmed broadcast faceplate).
- `vari-mu.vstai` — packed self-contained plugin document.
- `preview.wav` — offline render used to verify the DSP.

## Verification
Compiled with `compiler/asc-driver.mjs` and tested with
`factory/tools/wasm-runner.mjs` → **VERDICT: PASS** (audio present, finite,
non-clipping; all four parameters affect the output).

Theme accents: `#ffcf6b` / `#ff9e6b`.
