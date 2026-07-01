# Fold West

A West-Coast complex-oscillator **wavefolder** in the **Serge modular** lineage. Where East-Coast synths *subtract* harmonics with a filter, West-Coast synths *add* them by **folding**: a sine/triangle core (morphed by **Timbre**) is driven into a smooth wavefolder whose depth blooms with an envelope, so a held note grows brighter and more metallic then settles — the classic Buchla/Serge "timbre from folding" movement. A gentle low-pass tames the very top. 6-voice poly.

## Controls
| Knob | Range | What it does |
|------|-------|--------------|
| Fold | 0–1 | Wavefolder depth (more folds → more harmonics / metallic timbre) |
| Timbre | 0–1 | Core waveshape morph, sine → triangle |
| Cutoff | 0–1 | Gentle low-pass to tame the folded highs |
| Env | 0–1 | How much the fold depth blooms from an envelope on each note |
| Decay | 0–1 | Amp decay time |
| Level | 0–1 | Output level |

## Design notes
- Core oscillator is a sine crossfaded to a triangle by Timbre, then run through a two-stage smooth sine **wavefolder** (`sin(x · foldAmt)` folded again lightly) — folding adds odd/even harmonics without a filter.
- **Env** drives a decaying fold-depth envelope, so each note "opens up" harmonically and settles — the signature West-Coast gesture, and what makes every parameter audibly move on a single held note.
- 6-voice polyphony; a gentle TPT low-pass; output soft-clipped with `tanh`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Fold West** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/fold-west/spec.json` → **VERDICT: PASS** (all 6 params reactive).
