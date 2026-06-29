# West Cell

A polyphonic **west-coast complex-oscillator** instrument — modelled on the Buchla
100/200 lineage, but an entirely original implementation. It deliberately avoids the
subtractive saw-into-ladder cliché: harmonics are *generated* on the way up rather
than carved away.

## Signal path

1. **Complex oscillator** — a modulator sine cross-modulates (through-zero FM /
   timbre modulation) a primary sine. The modulator runs at a slightly inharmonic
   ratio (1.41) for the characteristic metallic west-coast bite. **Timbre** sets the
   modulation depth, sweeping from a pure tone to a dense, clangorous spectrum.
2. **Wavefolder** — the complex-osc output is driven into a two-stage sine folder.
   As **Fold** rises the wave creases back on itself, multiplying the harmonic
   content. A makeup gain keeps it from simply getting louder.
3. **Low-pass gate (LPG)** — a combined VCF + VCA "plucked" by a single fast control
   envelope (vactrol-style). As the envelope falls it simultaneously closes a
   one-pole low-pass *and* ducks the amplitude, producing the bongo / marimba /
   clang transients of the lineage. **Gate Decay** sets the pluck length;
   **Tone** sets how bright the gate opens. Velocity opens it brighter and folds
   a touch harder, so dynamics change the timbre, not just the volume.

16 voices, pitch-tracked, plays chords, gain-staged with a soft-knee limiter so the
peak stays below 1.0.

## Parameters

| Index | Name       | Default | Range | Notes |
|-------|------------|---------|-------|-------|
| 0 | Timbre     | 0.40 | 0–1 | cross-mod (FM) amount — adds/moves harmonics |
| 1 | Fold       | 0.45 | 0–1 | wavefolding drive — multiplies harmonics |
| 2 | Gate Decay | 0.50 | 0–1 | LPG pluck length, 40 ms → ~2.2 s |
| 3 | Tone       | 0.55 | 0–1 | LPG brightness / open-ness |
| 4 | Level      | 0.70 | 0–1 | output level |

## GUI

A single self-contained HTML document (inline CSS/JS/SVG, no external assets): a
Californian-modular voice in cream and sunburst yellow/magenta. A banana-jack patch
bay with swaying cables, a live wavefolding curve that creases and multiplies as
**Fold** rises, and a low-pass-gate "ping" ripple whose cadence tracks **Gate Decay**.
Every knob is drag-to-adjust (vertical), wheel for fine-tune, double-click to reset,
and shows its live value.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the VibePlugin ABI)
- `spec.json` — plugin manifest
- `gui.html` — bespoke animated editor
- `preview.wav` — rendered test tone
- `west-cell.vstai` — packed plugin

## Test

```
node compiler/asc-driver.mjs factory/plugins/west-cell/assembly.ts /tmp/west-cell.wasm
node factory/tools/wasm-runner.mjs /tmp/west-cell.wasm \
  --params /tmp/west-cell-params.json --wav factory/plugins/west-cell/preview.wav \
  --synth --seconds 3
```

Latest run: **VERDICT: PASS** — audio present, finite, no clip; all 5 params "✓ affects".
