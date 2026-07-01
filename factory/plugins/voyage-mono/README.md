# Voyage Mono

A modern, hi-fi **monophonic** synthesizer in the modern transistor-ladder mono
lead/bass tradition — a fat three-oscillator core feeding a dual-mode ladder
filter that morphs continuously from low-pass to high-pass.

## Voice

- **Three fat oscillators** — each a continuously variable saw-to-pulse blend,
  spread by the Detune control for thick, beating unison. Band-limited with
  PolyBLEP so the tone stays smooth and analog rather than digitally buzzy.
- **Dual-mode ladder filter** — a 4-pole transistor-ladder low-pass with tanh
  saturation in the feedback loop. The **Filter Mode** knob crossfades the
  ladder low-pass tap against a spaced high-pass derivative, morphing the
  character from warm LP, through a band-pass-like middle, to an airy HP.
- **Snappy envelope** — a per-note filter + amplitude envelope with a fast
  attack and tight decay/release; **Env Amount** is bipolar (centre = none,
  up opens, down closes the cutoff over the note).
- **Glide** — last-note-priority portamento.
- **Level** — clean soft-limited output stage with a gentle hi-fi polish.

## Parameters

| Index | Name        | Range | Default | Description |
|-------|-------------|-------|---------|-------------|
| 0 | Cutoff      | 0–1 | 0.55 | Base ladder cutoff (exponential, ~30 Hz–16 kHz) |
| 1 | Resonance   | 0–1 | 0.45 | Ladder feedback / emphasis |
| 2 | Filter Mode | 0–1 | 0.20 | LP (0) ↔ HP (1) blend; midpoint = dual band |
| 3 | Env Amount  | 0–1 | 0.70 | Bipolar cutoff envelope depth (0.5 = none) |
| 4 | Detune      | 0–1 | 0.30 | Oscillator spread / fatness |
| 5 | Glide       | 0–1 | 0.15 | Portamento time |
| 6 | Level       | 0–1 | 0.70 | Output level |

## GUI

A self-contained sleek black + blue panel: a backlit mark, a live animated
filter-response display whose glowing curve recolors from blue (LP) to pink (HP)
as Filter Mode is swept, three stacking detuned saw traces, and backlit metal
knobs (drag to adjust, Shift for fine, double-click to reset, scroll wheel
steps). Every control is wired to `window.vstai.setParam(index, value)`.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/voyage-mono/assembly.ts /tmp/voyage-mono.wasm
node factory/tools/wasm-runner.mjs /tmp/voyage-mono.wasm \
  --params /tmp/voyage-mono-params.json --wav factory/plugins/voyage-mono/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/voyage-mono/spec.json
```

Verdict: **PASS** — audio present, finite, non-clipping; all 7 parameters
confirmed reactive (✓ affects).
