# Lattice Verb

A classic algorithmic reverb built from the textbook **Schroeder/Moorer**
topology — not an FDN hall, but the original parallel-comb + series-allpass
lattice.

## Signal flow

```
in -> pre-delay -> [ 4 parallel feedback comb filters ] -> sum -> AP1 -> AP2 -> wet
                     (prime delay lengths, each with a            (series allpass
                      one-pole HF damper in the feedback)          diffusers, g=0.5)
```

- **4 parallel feedback comb filters** with prime delay lengths
  (1557 / 1617 / 1491 / 1422 samples @ 44.1k reference), summed in parallel.
  Each comb carries a one-pole low-pass in its feedback path for per-comb
  high-frequency damping (Moorer's lossy combs).
- **2 series allpass diffusers** (225 / 556 samples, coefficient 0.5) smear the
  summed comb echoes into a smooth, dense tail.
- A **pre-delay** line offsets the wet path before the comb bank.
- The right channel uses a small sample spread so the stereo image is wide.
- Feedback is hard-clamped below 1.0, so the tail always decays.

## Parameters

| # | Name      | Range | Default | Effect |
|---|-----------|-------|---------|--------|
| 0 | Mix       | 0..1  | 0.35    | Dry/wet blend (0 = dry) |
| 1 | Size      | 0..1  | 0.5     | Scales the comb delay lengths (room size) |
| 2 | Decay     | 0..1  | 0.6     | Comb feedback gain / RT60 |
| 3 | Damping   | 0..1  | 0.4     | High-frequency loss per pass |
| 4 | Pre-Delay | 0..1  | 0.0     | 0..200 ms pre-delay before the reverb |

## GUI

A bespoke teal-to-cyan **comb + allpass lattice**: four parallel comb rails with
tapped delay nodes and looping feedback arcs feed a summing bus into two glowing
series allpass diffuser rings. Energy pulses travel down each comb line — slower
on longer (larger Size) combs, dimming with Decay and Damping. Five hand-built
knobs (vertical drag, wheel fine-tune, double-click reset) drive the parameters
and a live RT readout.

## Files

- `assembly.ts` — the AssemblyScript DSP (compiles to WASM, ABI per `src/WasmAbi.h`)
- `gui.html` — self-contained animated GUI
- `spec.json` — plugin manifest
- `lattice-verb.vstai` — packed artifact
- `preview.wav` — rendered demo
