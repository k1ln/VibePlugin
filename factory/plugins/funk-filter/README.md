# Funk Filter — envelope-follower auto-wah

**Lineage:** vintage envelope-follower filter pedal (modelled as an original; no trademark in shipped files)
**Type:** Effect · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A resonant filter whose cutoff is swept by the **input's own envelope** — the classic funky,
vocal auto-wah "wow". A peak-detecting envelope follower (snappy 5 ms attack, 120 ms musical
release) tracks how hard you play and pushes the cutoff of a zero-delay-feedback (TPT)
state-variable filter. Play louder and the peak swoops further across the spectrum; let it
decay and it settles back. **Direction** flips the sweep, **Mode** chooses the filter voice.

## Signal flow
```
in ─► |rectify| + DC-block ─► peak env follow ─► soft-sat map ─► (Direction)
                                                                     │
                                                            cutoff Hz │
                                                                     ▼
in ─────────────────────────────► TPT state-variable filter (LP or BP, Q=Resonance) ─► wet/dry
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Sensitivity | 0–1 | 0.60 | how hard the envelope pushes the sweep (drive ×1.5 … ×15.5) |
| 1 | Resonance | 0–1 | 0.60 | filter Q / peak height (Q ≈ 0.6 … 12) |
| 2 | Range | 0–1 | 0.70 | span the cutoff can travel (≈ 220 … 4.4 kHz) |
| 3 | Direction | 0/1 | 0 (Up) | Up: louder opens the filter · Down: louder closes it (stepped) |
| 4 | Mode | 0/1 | 1 (BP) | Low-pass or vocal band-pass output (stepped) |
| 5 | Mix | 0–1 | 1.00 | dry/wet blend |

## GUI
A 70s purple + gold stomp-box face: a big **Sensitivity** knob, three small drag knobs
(Resonance / Range / Mix), and two three-state-style toggle banks (Direction, Mode). A live
spectrum window shows the resonant peak swooping up or down the band in time with a synthetic
playing envelope, honouring the current Direction / Range / Resonance / Mode. Drag knobs,
double-click to reset, wheel to fine-tune. Every control is wired through `window.vstai.setParam`.

## Test result
```
output:   rms=0.40234  peak=0.91080  dc=0.00002  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
all 6 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (plucked riff → envelope-swept auto-wah).
