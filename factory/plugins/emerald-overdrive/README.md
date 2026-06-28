# Emerald Overdrive — smooth mid-focused overdrive

**List entry:** Effects #43 — *Ibanez TS808 Tube Screamer* (overdrive)
**Type:** Effect · **Params:** 4 · **Samples:** none (pure algorithm)

## What it is
The classic green-pedal recipe, modelled without copying the product: a band-limited gain
stage feeds a symmetric **soft-clipper** (op-amp + anti-parallel diode behaviour). The low end
is high-passed *before* clipping, which is what gives this style its signature mid-hump and
keeps the distortion from turning to mud. A post tone low-pass and output level finish it.

## Signal flow
```
in ─► high-pass ~120 Hz ─► ×Drive ─► cubic soft-clip ─► makeup ─► tone LP ─► ×Level ─► wet/dry
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Drive | 0–1 | 0.50 | gain into the clipper (×1 … ×40) |
| 1 | Tone  | 0–1 | 0.50 | post low-pass 800 Hz … 6 kHz |
| 2 | Level | 0–1 | 0.60 | output level |
| 3 | Mix   | 0–1 | 1.00 | dry/wet blend |

## Test result
```
checks: present=true  finite=true  noClip=true  paramsReactive=true
all 4 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (clean plucked riff → overdrive).
