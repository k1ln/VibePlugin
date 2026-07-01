# Blue Flanger

A deep, resonant, wide-stereo flanger in the **Boss BF-2** lineage. Where the factory's other flangers are jet-metallic (Jet Flanger), chrome-bright (Steel Flanger) or gentle (Warm Flanger), Blue Flanger is lush and watery: a long swept fractional delay (~0.3–12 ms) with a strong **resonant** positive feedback that can ring into metallic territory, and a stereo **Width** control that offsets the LFO between the left and right channels for that wide, underwater spread.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Rate | 0.05–6 Hz | LFO sweep speed |
| Depth | 0–1 | Sweep depth (how far the comb notches travel) |
| Feedback | 0–0.92 | Resonance of the flange (higher = ringing, metallic) |
| Manual | 0–1 | Base delay time (centre of the sweep, 0.3–7.3 ms) |
| Width | 0–1 | Stereo LFO phase offset between L and R |
| Mix | 0–1 | Dry/wet balance |

## Design notes
- Per-channel fractional delay line (2048 samples) read with linear interpolation and fed back for the resonant comb.
- A triangle LFO sweeps the delay around the Manual base; the right channel's LFO is phase-shifted by **Width** for the stereo image.
- Wet path softly clamped to stay clean even at high feedback.
- Pure algorithm — no samples.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. The name **Blue Flanger** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --params factory/plugins/blue-flanger/spec.json` → **VERDICT: PASS** (all 6 params reactive on a broadband bed).
