# Byte Beat

A gritty **8-bit lo-fi drum machine** in the **E-mu Drumulator** lineage — the crunchy, dusty early-80s sampling-drum sound that became a hip-hop staple. Six synthesised voices (kick, snare, hat, clap, cowbell, tom) run through a global **bit-crush + sample-rate reducer** that gives the signature 8-bit grit. Like the original it is a **preset pattern box**: hold a note to start an internal 16-step boom-bap groove; release to stop and let the tails ring.

## The groove
A boom-bap pattern: kick on the 1 and the syncopated "and", snare backbeats, steady eighth-note hats, a clap accent and a two-hit tom fill at the end of the bar.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | Kick & tom pitch |
| Decay | 0–1 | Global decay length |
| Crunch | 0–1 | Bit-depth reduction (256→16 levels) + sample-rate downsample (1×→8×) |
| Hat | 0–1 | Hi-hat brightness and length |
| Accent | 0–1 | Pattern accent depth |
| Level | 0–1 | Output level |

## Design notes
- Internal 16-step sequencer at ~115 BPM; pattern tables are module-scope `StaticArray`s.
- The signature lo-fi comes from a **global quantiser** (round to N levels) feeding a **sample-and-hold downsampler** — together they reproduce the chunky digital grit of an 8-bit drum sampler.
- 12-slot one-shot voice pool; no allocation in `process()`.
- Output gain-staged so the full groove peaks below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time, then deliberately bit-crushed. The name **Byte Beat** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/byte-beat/spec.json` → **VERDICT: PASS** (all 6 params reactive).
