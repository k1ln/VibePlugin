# Crisp Beat

A crisp, dry, punchy digital drum machine in the **Roland TR-707 / 727** lineage — the clean, tight "house" counterpart to the factory's warm boutique **Velvet Rhythm**. A clicky punchy kick, a snappy bright snare, crisp closed and open hats, a layered hand-clap and a short cowbell, all synthesised in real time. Like the original it is a **preset pattern box**: hold a note to start an internal 16-step four-on-the-floor groove; release it to stop and let the tails ring.

## The groove
| Voice | Character |
|-------|-----------|
| Kick | tight clicky sine with a fast pitch-drop and an attack click |
| Snare | bright tone + noise (Snap morphs tone→noise) |
| Closed hat | very short high-passed noise tick |
| Open hat | longer high-passed noise sizzle |
| Clap | three quick noise bursts + a short tail |
| Cowbell | two square tones (short, dry) |

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | Kick pitch (54–110 Hz) |
| Decay | 0–1 | Global decay length |
| Snap | 0–1 | Snare tone ↔ noise balance |
| Hat | 0–1 | Hi-hat brightness and length |
| Accent | 0–1 | Pattern accent depth |
| Level | 0–1 | Output level |

## Design notes
- Internal 16-step sequencer at 120 BPM sixteenths; classic four-on-the-floor pattern with offbeat open hats and a backbeat clap.
- 12-slot one-shot voice pool; pattern tables are module-scope `StaticArray`s; no allocation in `process()`.
- Tighter envelopes and an attack click give the dry, crisp digital character (vs. Velvet Rhythm's warm rounded voices).
- Output gain-staged so the full groove peaks below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time. The name **Crisp Beat** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/crisp-beat/spec.json` → **VERDICT: PASS** (all 6 params reactive).
