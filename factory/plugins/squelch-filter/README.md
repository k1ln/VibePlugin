# Squelch Filter

An **acid envelope filter** effect — an original take on the classic acid-bass
filter voice. A resonant 4-pole (24 dB/oct) transistor-ladder low-pass whose
cutoff is driven by an **envelope follower** on the input plus a manual base
**Cutoff**. High **Resonance** gives the signature squelch and can approach
self-oscillation, while a saturated feedback path keeps it stable. On
transients the filter snaps wide open and quacks shut.

## DSP

`assembly.ts` — AssemblyScript compiled to WASM (VibePlugin ABI). All-`f32`,
no allocation in `process()`, planar stride 8192, params clamped.

- **Envelope follower**: rectified input with a fast attack (~3 ms) and a
  sweepable release set by **Decay** (~30 ms .. ~900 ms). Soft-saturated so a
  hot input doesn't slam it fully open.
- **Ladder filter**: four cascaded one-pole TPT low-pass stages with a global
  resonance feedback loop; `tanh`-saturated feedback bounds self-oscillation.
- **Cutoff modulation**: per-sample cutoff = base `2^(env * span)`, where the
  span is set by **Env Amount** (up to ~5.5 octaves above base).
- Output is `tanh`-limited and scaled, peak stays well under 1.0; dry/wet
  **Mix** blends back the unfiltered signal.

### Parameters

| # | Name       | Range | Default | Meaning |
|---|------------|-------|---------|---------|
| 0 | Cutoff     | 0..1  | 0.35    | Manual base cutoff (~60 Hz .. ~8 kHz, exp) |
| 1 | Resonance  | 0..1  | 0.70    | Feedback / squelch (near self-osc at top) |
| 2 | Env Amount | 0..1  | 0.65    | How far the envelope sweeps the cutoff up |
| 3 | Decay      | 0..1  | 0.40    | Envelope release time |
| 4 | Mix        | 0..1  | 1.00    | Dry/wet |

## GUI

`gui.html` — one self-contained document (inline CSS/JS/SVG, no external
assets). A silver 303-style hardware box with a glowing animated cutoff
**response curve** on a CRT-style screen: a resonant peak that snaps open with
a simulated input envelope and a tracked peak marker showing the live cutoff in
Hz. Five hand-built SVG knobs with value arcs — drag vertically to turn, wheel
to fine-tune, double-click to reset. Accent `#c6ff3d` / `#54d18f`.

## Test

```
node compiler/asc-driver.mjs factory/plugins/squelch-filter/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --seconds 3
```

Verdict: **PASS** — audio present, finite, no clipping, all 5 params affect.
