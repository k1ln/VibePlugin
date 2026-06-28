# Mythic Drive

A transparent, low-end-preserving overdrive.

## Concept

Mythic Drive is a *transparent* overdrive: instead of replacing your tone with
distortion, it sums a clean boosted core with a treble-voiced, soft-clipped gain
path. The dirt path is high-passed (~90 Hz) before it ever hits the clipper, so
the low end stays full and clear while the clean core carries the real bass. A
pre-clip treble split plus an active Treble/Tone control keep the drive bright
and *present* without smearing the midrange. The result adds gentle, glassy
harmonics on top of your signal — see-through at low settings, thick and
characterful when pushed.

It is a pure algorithm (no samples, no impulse responses).

## Signal flow

```
in ──┬───────────────────────────────────────────────► clean core ──┐
     │                                                                │ (+)
     └─► HP ~90Hz ─► treble split + active boost ─► soft-clip ─► DC   │
            (keep bass clean)        (presence)      (tanh)    block  │
                                                       │              │
                                                  post tone LP ───────┘
                                                                      │
                                              clean/driven Mix ──► Output ► out
```

- **Pre-clip high-pass** keeps sub-bass out of the clipper so the low end never
  gets muddy or compressed.
- **Treble split + active boost** emphasises content above ~700 Hz before
  clipping for the bright, articulate voicing.
- **tanh soft-clipper** with a small asymmetric term gives mostly odd harmonics
  plus a touch of even-order warmth; a DC blocker removes the resulting offset.
- **Parallel clean sum** preserves transient detail and full-range low end.
- **Gain compensation** (`1/sqrt(drive)`) keeps the level musical as Gain rises.

Output is bounded well under full scale (tester peak ≈ 0.57).

## Parameters

| # | Name   | Range | Default | Description                                            |
|---|--------|-------|---------|--------------------------------------------------------|
| 0 | Gain   | 0–1   | 0.50    | Drive into the soft-clip path (transparent → thick).   |
| 1 | Treble | 0–1   | 0.50    | Active treble / tone, dark → bright and open.          |
| 2 | Output | 0–1   | 0.70    | Master output level (0 → 1.2×).                         |
| 3 | Mix    | 0–1   | 0.60    | Clean → driven blend (parallel clean core + harmonics).|

## Build / test

```sh
# compile AssemblyScript → wasm
node compiler/asc-driver.mjs factory/plugins/mythic-drive/assembly.ts /tmp/mythic-drive.wasm

# render + analyse (VERDICT: PASS, every param affects)
node factory/tools/wasm-runner.mjs /tmp/mythic-drive.wasm \
  --params factory/plugins/mythic-drive/spec.json \
  --wav factory/plugins/mythic-drive/preview.wav --seconds 3

# pack the .vstai bundle
node factory/tools/pack-vstai.mjs factory/plugins/mythic-drive/spec.json
```
