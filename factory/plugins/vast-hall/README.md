# Vast Hall — large digital hall reverb

**List entry:** Effects #1 — *Lexicon 224* (digital hall)
**Type:** Effect · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A smooth, dense, long-tailed concert-hall reverb. Faithful to the *architecture* of
late-1970s digital hall units without copying any product: a short input-diffusion chain
feeds an 8-line **feedback delay network (FDN)** whose feedback is mixed by a lossless
**Householder matrix** (`y = x − (2/N)·Σx`), with a one-pole low-pass in each line for
natural high-frequency decay.

## Signal flow
```
in ─► pre-delay ─► 4× allpass diffusers ─► [8-line FDN + Householder mix + HF damping] ─► stereo taps ─► wet/dry
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Mix       | 0–1        | 0.30 | dry/wet blend |
| 1 | Size      | 0.3–1.0    | 0.75 | scales all delay lengths (room size) |
| 2 | Decay     | 0–1        | 0.60 | RT60 ≈ 0.3 s … 12 s |
| 3 | Damping   | 0–1        | 0.45 | high-frequency absorption in the tail |
| 4 | Pre-Delay | 0–0.12 s   | 0.02 | gap before the reverb onset |
| 5 | Width     | 0–1        | 1.00 | stereo spread of the wet signal |

## Test result (factory/tools/wasm-runner.mjs)
```
output: rms=0.261  peak=1.276  dc=0.001  nan=0
checks: present=true  finite=true  noClip=true  paramsReactive=true
all 6 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (3 s, broadband test bed → hall).

## Files
- `assembly.ts` — AssemblyScript DSP source
- `spec.json` — packer manifest (name, params, paths)
- `vast-hall.vstai` — self-contained plugin (wasm + GUI + params + source); also deployed to `docs/gallery/data/`
- `preview.wav` — rendered audio for listening
