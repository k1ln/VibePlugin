# Shimmer Hall — bright, modulated digital hall reverb

**List entry:** Effects #2 — *Lexicon 480L* (digital hall)
**Type:** Effect · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A lush, bright hall whose 8-line FDN tail is **modulated** by per-line LFOs reading the delay
lines at interpolated fractional positions. That gentle pitch-wobble dissolves the metallic
ringing a static FDN can have, giving the chorused, three-dimensional tail associated with
high-end 1980s studio halls. A single **Tone** knob trades a dark, damped decay for open air.
Distinct from [Vast Hall](../vast-hall/README.md): modulated tail + brightness control instead
of fixed damping/width.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Mix        | 0–1      | 0.30  | dry/wet blend |
| 1 | Size       | 0.3–1.0  | 0.80  | room size (delay lengths) |
| 2 | Decay      | 0–1      | 0.65  | RT60 ≈ 0.3 s … 14 s |
| 3 | Tone       | 0–1      | 0.70  | dark → bright (inverse HF damping) |
| 4 | Modulation | 0–1      | 0.40  | tail LFO chorus depth |
| 5 | Pre-Delay  | 0–0.12 s | 0.015 | gap before onset |

## Test result
```
output: rms=0.232  peak=1.015  dc=0.000  nan=0
checks: present=true  finite=true  noClip=true  paramsReactive=true
all 6 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav).
