# Freq Shifter

A Bode-style **single-sideband (SSB) frequency shifter**. Unlike a pitch
shifter (which multiplies every frequency by a ratio and keeps a signal
harmonic), a frequency shifter *adds* a fixed number of Hertz to every
component. A harmonic series `f, 2f, 3f...` becomes the inharmonic
`f+s, 2f+s, 3f+s...`, turning pitched material clangorous and metallic.

## How it works (DSP)

1. **Hilbert transform / quadrature split.** The input is fed to **two**
   separate cascades of first-order allpass sections
   `H(z) = (c - z^-1)/(1 - c z^-1)` — a 12-pole wideband phase-difference
   network (the classic Hutchins / Costello / Csound `hilbert` pole set, mapped
   to the z-plane by the bilinear transform). The two cascades' phase responses
   stay ~90 degrees apart across the audio band while both keep unity (allpass)
   magnitude, producing an analytic in-phase / quadrature pair `(I, Q)`.
2. **Quadrature carrier.** A `cos` / `sin` oscillator runs at the shift
   frequency (always the positive shift magnitude; the carrier phase wraps in
   `[0,1)`).
3. **Single-sideband mix.** `shifted = I*cos + qSign*Q*sin`, where `qSign = -1`
   keeps the **upper** sideband and `qSign = +1` keeps the **lower** one. The
   Sideband toggle and the sign of Shift compose
   (`effUp = (side==up) XOR (Shift<0)`). Selecting the Q sign cancels the mirror
   image — a true cancellation, not a notch — which is what makes this a clean
   shifter rather than a two-sided ring modulator. Measured mirror-sideband
   rejection is **~53-63 dB from 200 Hz to 4 kHz** (and ≥38 dB to ~8 kHz,
   rolling off toward Nyquist as every finite-order IIR Hilbert does).
4. **Feedback.** A bounded feedback path runs the shifted output back into the
   shifter, stacking shifts into a shimmering inharmonic cascade.

Pure algorithm, no samples. `process()` is allocation-free; output peaks well
under full scale.

**Verified behaviour:** harmonics 200/400/600 Hz → 300/500/700 with Shift +100
up, → 100/300/500 with Shift 100 down; Shift 0 leaves 1 kHz unchanged; Mix 0 is
exact dry passthrough. wasm-runner: PASS (all 4 params reactive).

## Parameters

| Index | Name     | Range          | Default | Notes |
|-------|----------|----------------|---------|-------|
| 0     | Shift    | -500..500 Hz   | +100    | Hertz added to every frequency |
| 1     | Sideband | down / up      | up      | Surviving sideband (step 1) |
| 2     | Feedback | 0..1           | 0       | Bounded shift-cascade feedback |
| 3     | Mix      | 0..1           | 1       | Dry/wet blend |

## GUI

A brushed-metal lab panel with corner bolts, accented in `#ff7ad1` / `#9a8cff`.
The display shows animated sidebands sliding up/down a spectrum line and a
sci-fi single-sideband Lissajous; controls are hand-drawn canvas knobs (drag,
double-click to reset, wheel to fine-tune) plus a lit sideband toggle. Real CSS
`@keyframes` drive a pulsing scope glow, a scanning sweep line across the
spectrum, and a pulsing "Inharmonic" badge (honoured `prefers-reduced-motion`),
on top of the live requestAnimationFrame meters.

## Files

- `assembly.ts` — AssemblyScript DSP (compiled to WASM)
- `gui.html` — self-contained GUI
- `spec.json` — plugin manifest
- `freq-shifter.vstai` — packed bundle
- `preview.wav` — rendered preview
