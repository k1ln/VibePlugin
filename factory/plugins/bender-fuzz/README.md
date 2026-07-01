# Bender Fuzz

A thick, **gated germanium fuzz** in the vintage three-transistor lineage
(Tone Bender MkII–style, reimagined as an original effect). Where a Fuzz
Face is round and a Big Muff is scooped, Bender Fuzz is **harder, mid-forward
and aggressive**, with the ragged staccato cut-off and "spit" the circuit is
famous for on note decay.

## Signal chain (DSP)

`assembly.ts` (AssemblyScript → WASM, allocation-free `process()`):

1. **Input high-pass** (~80 Hz) tightens the low end and emphasises mids.
2. **Three-stage germanium cascade** — each stage is an asymmetric, leaky
   `tanh` clip (hard top, softer/leaky bottom) so even harmonics dominate.
   Stage gains and collector bias grow with **Fuzz**, building a wall of grit.
3. **Post-clip DC block** (~18 Hz) removes the offset the asymmetry creates.
4. **Envelope-driven gate** — a fast-attack / slow-release follower tracks the
   input. As the note decays below a **Gate**-dependent threshold the output is
   choked; higher Gate raises the threshold and sharpens the slew, producing the
   staccato cut-off / spit.
5. **Tilt Tone** blends a low-passed body (1.2 kHz dark → 8 kHz bright) with a
   bright residue for fizz.
6. **Level** sets output, with a final safety clamp keeping peaks bounded.

## Parameters

| # | Name  | Range | Default | Effect |
|---|-------|-------|---------|--------|
| 0 | Fuzz  | 0–1   | 0.70    | Cascade gain / density — thickens to a wall |
| 1 | Gate  | 0–1   | 0.40    | Decay gating / spit — ragged staccato cut-off |
| 2 | Tone  | 0–1   | 0.55    | Dark ↔ bright tilt |
| 3 | Level | 0–1   | 0.50    | Output level |

## GUI

`gui.html` — one self-contained document (inline CSS/JS/SVG, no external
assets). A hammered-metal grey-gold pedal box with corner bolts, chunky
**chicken-head knobs** (drag vertically, wheel, double-click to reset,
shift for fine), an LED, a footswitch, and an animated waveform window whose
ragged torn-edge clipping wave visibly **gates/cuts on decay**. Accents
`#c8a85a` / `#ff6a3d`. Wires every param via `window.vstai.setParam`.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/bender-fuzz/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --seconds 3
# VERDICT: PASS — all four params "✓ affects", peak ~0.23, no NaN/clip
node factory/tools/pack-vstai.mjs factory/plugins/bender-fuzz/spec.json
```
