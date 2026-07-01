# Pulse Kit

A bright **digital / FM drum machine** in the **Yamaha RX5** lineage. Where Velvet Rhythm is warm and Byte Beat is 8-bit-crunchy, Pulse Kit is glassy and metallic — the bright 80s digital-percussion sound. Every voice is built from **two-operator FM**: an FM kick, an FM snare, inharmonic FM toms, glassy FM hats and a dense shimmering FM crash, all synthesised in real time. Like the original it is a **preset pattern box**: hold a note to start an internal 16-step groove with a tom fill; release to stop and let the tails ring.

## The kit
| Pad | Character |
|-----|-----------|
| Kick | FM sine with a fast pitch-drop + self-FM click |
| Snare | FM tone (ratio 1.5) + noise, Snap morphs tone→noise |
| Hat | glassy high FM (ratio 1.41) — Metal sets brightness |
| Tom | inharmonic FM tom (ratio 1.4) with a pitch-drop |
| Crash | dense FM (ratio 1.73) + noise, long shimmer |
| Clap | bright noise burst |

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | Kick & tom pitch |
| Decay | 0–1 | Global decay length |
| Snap | 0–1 | Snare tone ↔ noise balance |
| Metal | 0–1 | FM brightness of hats, toms and crash |
| Accent | 0–1 | Pattern accent depth |
| Level | 0–1 | Output level |

## Design notes
- Internal 16-step sequencer at 120 BPM; distinct pattern with a three-hit tom fill at the end of the bar.
- Each voice is a two-operator FM pair (carrier + modulator), giving the bright inharmonic partials of a digital drum machine.
- Pattern tables are module-scope `StaticArray`s; 12-slot one-shot voice pool; no allocation in `process()`.
- Output gain-staged so the full groove peaks below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time with FM. The name **Pulse Kit** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/pulse-kit/spec.json` → **VERDICT: PASS** (all 6 params reactive).
