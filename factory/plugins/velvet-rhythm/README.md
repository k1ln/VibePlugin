# Velvet Rhythm

A warm boutique **preset-rhythm box** in the **Roland CR-78 "CompuRhythm"** lineage. Unlike the factory's pad-per-drum kits, this is a *preset pattern player* — exactly how the CR-78 worked: hold a note and it starts an internal 16-step groove; release it and the groove stops while the tails ring. The voice is smooth, rounded and slightly metallic, all synthesised in real time.

## The groove
Six synthesised percussion voices, sequenced as a built-in pattern:

| Voice | Character |
|-------|-----------|
| Bass drum | warm rounded sine with a soft pitch-drop |
| Snare | soft tonal body + noise (Snap morphs body→noise) |
| Hi-hat | sizzly high-passed noise |
| **Metallic beat** | the signature inharmonic twin-square "cowbell" ring |
| Conga | woody sine with body + pitch-drop |
| Maraca | papery high-passed noise burst |

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tone | 0–1 | Bass-drum & conga pitch (52–112 Hz kick) |
| Decay | 0–1 | Global decay length of the drum tails |
| Snap | 0–1 | Snare body ↔ noise balance |
| Metal | 0–1 | Metallic-beat / hi-hat brightness and ring |
| Accent | 0–1 | Pattern accent depth |
| Level | 0–1 | Output level |

## Design notes
- Internal 16-step sequencer at 120 BPM sixteenths; a held note runs the loop, releasing it stops scheduling.
- 12-slot one-shot voice pool; the pattern layers up to six voices per step.
- Pattern tables are module-scope `StaticArray`s; no allocation in `process()`.
- Output gain-staged so the full groove peaks below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time. The name **Velvet Rhythm** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/velvet-rhythm/spec.json` → **VERDICT: PASS** (all 6 params reactive).
