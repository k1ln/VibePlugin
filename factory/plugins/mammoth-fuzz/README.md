# Mammoth Fuzz

A thick, sustaining fuzz effect. Two cascaded soft-clipping gain stages with
inter-stage high-pass filtering produce long sustain and a dense wall of
harmonics; a mid-scooped **Tone** control then tilts the voice between a
dark/bassy and a bright/cutting setting. A clean **Volume** stage and dry/wet
**Mix** finish the chain.

## How it works

1. **Input high-pass** (~80 Hz) tightens the low end before clipping.
2. **Stage 1** drives the signal hard (up to ~120x at full Sustain) into an
   asymmetric soft-clipper for rich, slightly-vocal harmonics.
3. **Inter-stage high-pass** (~180 Hz) removes the low-frequency buildup that
   would otherwise muddy the second stage.
4. **Stage 2** clips again for the squashed, singing sustain.
5. A second inter-stage high-pass + DC block clean up the result.
6. **Tone** mixes a low-pass branch (~700 Hz) against a high-pass branch
   (~1.5 kHz) while subtracting a portion of the mid band, for the
   characteristic scooped-mid voicing.

All processing is original AssemblyScript compiled to WASM — no samples.

## Parameters

| Index | Name    | Range | Default | Description                                            |
|-------|---------|-------|---------|--------------------------------------------------------|
| 0     | Sustain | 0–1   | 0.70    | Input gain into both clipping stages — fuzz & sustain. |
| 1     | Tone    | 0–1   | 0.50    | Mid-scooped tilt: dark/bassy (0) to bright/cutting (1).|
| 2     | Volume  | 0–1   | 0.60    | Output level.                                          |
| 3     | Mix     | 0–1   | 1.00    | Dry/wet blend.                                         |

## Test result

```
output:   rms=0.21647  peak=0.50628  dc=-0.00001  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
  [0] Sustain          ✓ affects  (rel Δ 0.81894)
  [1] Tone             ✓ affects  (rel Δ 1.14783)
  [2] Volume           ✓ affects  (rel Δ 1.00000)
  [3] Mix              ✓ affects  (rel Δ 0.74321)
VERDICT: PASS ✅
```
