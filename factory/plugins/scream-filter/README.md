# Scream Filter

An aggressive **Sallen-Key resonant filter** effect — a high-pass and a low-pass
in series, each a 2-pole cell with a saturated resonance feedback path that can
ring all the way up to self-oscillation and scream. The signal is driven into
that feedback through a `tanh` nonlinearity for the characteristic biting,
distorted tone. The same saturator caps the self-oscillation amplitude, so the
output stays stable (no NaN, peak < ~1.0) even at maximum Resonance + Drive.

Inspired by the classic MS-20-style dual VCF; the DSP and tone here are an
original implementation.

## DSP

`assembly.ts` compiles to WASM (AssemblyScript). All math is `f32`; `process()`
is allocation-free with per-channel filter state kept in module-scope
`StaticArray`s. Planar stride is 8192.

- Two cascaded one-pole TPT integrators per cell form each 2-pole filter.
- A resonance feedback term (`k = Reso * 4`) is summed back in and saturated.
- **Drive** (1..16x) pre-gains the signal into the saturator before each cell.
- An output trim scales down with Drive/Resonance to keep the peak bounded.
- Cutoffs use an exponential Hz map: LP 80 Hz–18 kHz, HP 20 Hz–6 kHz.

### Parameters

| # | Name      | Range | Default | Function |
|---|-----------|-------|---------|----------|
| 0 | LP Cutoff | 0..1  | 0.85    | Low-pass corner (exp 80 Hz–18 kHz) |
| 1 | HP Cutoff | 0..1  | 0.12    | High-pass corner (exp 20 Hz–6 kHz) |
| 2 | Resonance | 0..1  | 0.55    | Feedback Q; near 1 it self-oscillates |
| 3 | Drive     | 0..1  | 0.35    | Gain into the resonance saturator |
| 4 | Mix       | 0..1  | 1.0     | Dry/wet blend |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external
assets). It renders an MS-20-style grey/green VCF module with a tiny patch jack,
hex bolts and a live frequency-response window: a screaming resonant peak that
glows hotter and sharper as Resonance rises, a self-oscillation LED, animated
scan sweep, and five custom knobs (drag, wheel, arrow keys, double-click to
reset). Every knob writes its real value via `window.vstai.setParam`.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/scream-filter/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --wav preview.wav --seconds 3
# VERDICT: PASS — every param ✓ affects, peak ~0.48, nan=0
node factory/tools/pack-vstai.mjs factory/plugins/scream-filter/spec.json
```
