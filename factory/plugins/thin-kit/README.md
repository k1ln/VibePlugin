# Thin Kit

A cheap, thin, dry **12-bit sampling drum box** in the **Casio RZ-1** lineage. Where the factory's other boxes are warm (Velvet Rhythm), crunchy (Byte Beat) or glassy (Pulse Kit), Thin Kit is small and papery — the sound of an inexpensive 80s drum machine. A short thin kick, a papery snare, tight hats, a clicky rimshot, a small cowbell and a dry clap. A mild **12-bit crush** plus a global **Bright** high-pass give the cheap-PCM character. Like the original it is a **preset pattern box**: hold a note to start an internal 16-step pop groove; release to stop and let the tails ring.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Tune | 0–1 | Kick pitch (thin, 66–126 Hz) |
| Decay | 0–1 | Global decay length (short) |
| Snap | 0–1 | Snare body ↔ noise balance |
| Bright | 0–1 | Global high-pass — dials in the thin, papery character |
| Accent | 0–1 | Pattern accent depth |
| Level | 0–1 | Output level |

## Design notes
- Internal 16-step sequencer at 120 BPM; a simple 80s pop pattern (kick on 1 & 3, snare backbeats + a ghost, steady hats, rimshot and cowbell colour).
- Deliberately short envelopes and a global high-pass give the "cheap PCM" thinness; a light quantiser (~11-bit) adds a touch of digital grain without the heavy crush of Byte Beat.
- Pattern tables are module-scope `StaticArray`s; 12-slot one-shot voice pool; no allocation in `process()`.
- Output gain-staged so the full groove peaks below clipping.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — every drum is synthesised in real time. The name **Thin Kit** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/thin-kit/spec.json` → **VERDICT: PASS** (all 6 params reactive).
