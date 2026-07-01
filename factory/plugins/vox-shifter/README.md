# Vox Shifter

A formant-aware **vocal pitch shifter** in the **PSOLA / phase-vocoder** family. A twin-grain crossfaded delay-line pitch shifter moves the **pitch** (Shift, ±12 semitones) click-free, while an independent **Formant** control sweeps a pair of resonant vowel formants over the shifted voice. That means you can pitch a voice up without the "chipmunk" formant collapse, or slide the formants on their own for gender and vowel morphs.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Shift | −12…+12 st | Pitch-shift interval in semitones |
| Formant | 0–1 | Sweeps the two vowel formants (F1 ~320→840 Hz, F2 ~900→2400 Hz) |
| Mix | 0–1 | Dry/wet balance |
| Output | 0–1 | Output level |

## Design notes
- Pitch shift: a circular delay line read by two pointers that drift at `1 − 2^(Shift/12)`, each crossfaded with a raised-cosine window so the wrap discontinuity is masked (click-free).
- Formant: the shifted voice is passed through **two resonant band-pass "formant" peaks** (TPT state-variable) whose centres move with the Formant knob, imprinting a vowel-like spectral envelope independent of the pitch.
- Per-channel filter state for a true-stereo image; wet path softly clamped.
- Pure algorithm — no samples.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. The name **Vox Shifter** is original; it is *not* affiliated with or endorsed by any product it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --params factory/plugins/vox-shifter/spec.json` → **VERDICT: PASS** (all 4 params reactive on a broadband bed).
