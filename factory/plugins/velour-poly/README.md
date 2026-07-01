# Velour Poly

A warm, velvety velocity-sensitive **DCO polyphonic synthesizer** (8 voices) in the
lineage of the smooth mid-80s Roman DCO polysynths. Built for lush 80s pads and
glassy bell-pad stabs: a slightly hollow, velvet character that sits distinct from
brighter, cleaner polys.

## Voice architecture

Each of the eight independently-allocated voices runs:

- **Two DCOs** — a band-limited (polyBLEP) saw and a band-limited 50% pulse.
- **Cross-modulation** — the saw bends the pulse's instantaneous phase rate, adding
  the slightly hollow, metallic glint that gives the bell-pad stabs their character.
- **Smooth resonant low-pass** — four cascaded one-pole stages with `tanh` feedback,
  driven by its own envelope (Cutoff + Env Amount, swept up to ~5 octaves). Key
  **velocity** also opens the filter for expressive brightness.
- **Velocity-sensitive amp envelope** — A/R controls with a fixed velvety decay to a
  high sustain; velocity (squared) shapes loudness.

A shared **stereo three-tap chorus** (slow LFO, 90°-offset taps) widens the voice sum
into the famous lush velvet pad. Final `tanh` glue + output level keeps the peak well
under full scale (preview peak ≈ 0.15).

## Parameters

| # | Name       | Default | What it does |
|---|------------|---------|--------------|
| 0 | Cutoff     | 0.50    | Base filter cutoff (80 Hz … ~14 kHz, exponential) |
| 1 | Resonance  | 0.30    | Filter resonance (smooth, never harsh) |
| 2 | Env Amount | 0.55    | How far the filter envelope sweeps cutoff (octaves) |
| 3 | Cross-Mod  | 0.25    | DCO cross-modulation depth — reshapes the velvety timbre |
| 4 | Chorus     | 0.45    | Stereo chorus depth / width |
| 5 | Attack     | 0.15    | Amp + filter attack time |
| 6 | Release    | 0.40    | Amp + filter release time |
| 7 | Level      | 0.70    | Output level |

## Files

- `assembly.ts` — the AssemblyScript DSP module (WASM ABI).
- `gui.html` — the bespoke self-contained animated GUI (velvet panel, plush chorus-
  shimmer scope, custom SVG knobs, a spring-back pitch bender, playable keyboard).
- `spec.json` — plugin manifest (name, params, theme, paths).
- `velour-poly.vstai` — packed bundle.
- `preview.wav` — rendered arpeggio preview.

## GUI

Soft charcoal panel with violet (`#c87aff`) + rose (`#ffb0d0`) backlighting, three
plush animated waveforms whose shimmer tracks Chorus/Cutoff/Cross-Mod, custom SVG
knobs (drag vertically, wheel to fine-tune, double-click to reset), a tactile pitch
bender that springs back to center, and a velvet-lit on-screen keyboard (mouse or the
`a s d f g h j k l` computer keys). Every control is wired to `window.vstai.setParam`
and initialised to its default.

## Verification

```
node compiler/asc-driver.mjs factory/plugins/velour-poly/assembly.ts /tmp/velour-poly.wasm
node factory/tools/wasm-runner.mjs /tmp/velour-poly.wasm \
  --params /tmp/velour-poly-params.json --wav factory/plugins/velour-poly/preview.wav \
  --synth --seconds 3
```

→ `VERDICT: PASS` — audio present, finite, no clipping, and all 8 parameters affect
the output.
