# Comet Six

A six-voice analog-style polyphonic synthesizer in the lineage of the early-80s
multimode analog flagships. Its signature is a **morphing multimode filter** and
**oscillator cross-modulation** — it covers ground a plain low-pass poly cannot.

## Sound

Each of the **6 voices** runs:

- **Two oscillators** — a band-limited saw (osc 1) and a band-limited pulse
  (osc 2). Osc 2 cross-modulates osc 1's frequency and, as you push **Cross-Mod**
  up, adds a soft hard-sync reset for a metallic, hollow edge.
- A resonant **state-variable filter** whose **Filter Mode** continuously morphs
  **Low-Pass → Band-Pass → High-Pass**. The band-pass response is level-lifted so
  the mode change is an audible *character* shift, not just a volume dip — hollow,
  bright and nasal poly tones from the same patch.
- A dedicated **filter envelope** (Env Amount sweeps the cutoff up to ~6 octaves)
  and an **amplitude AR** envelope, so chords ring with independent contours.

Voices are allocated per `noteId` with oldest-voice stealing; the host passes
frequency in Hz. The output is `tanh`-glued and gain-staged to stay below full
scale even on dense chords (preview peak ≈ 0.25).

## Parameters

| # | Name        | Range   | Default | Notes |
|---|-------------|---------|---------|-------|
| 0 | Cutoff      | 0..1    | 0.5     | Exp 50 Hz .. ~15 kHz base cutoff |
| 1 | Resonance   | 0..1    | 0.35    | SVF damping → resonance peak |
| 2 | Filter Mode | 0,1,2   | 0 (LP)  | Discrete: 0 LP, 1 BP, 2 HP (morph axis) |
| 3 | Env Amount  | 0..1    | 0.55    | Filter-envelope cutoff sweep depth |
| 4 | Cross-Mod   | 0..1    | 0.3     | Osc cross-mod depth + sync grit |
| 5 | Attack      | 0..1    | 0.04    | Amp + filter attack (≈2 ms .. 1.6 s) |
| 6 | Release     | 0..1    | 0.35    | Amp + filter release (≈10 ms .. 2.4 s) |
| 7 | Level       | 0..1    | 0.7     | Output level |

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/comet-six/assembly.ts /tmp/comet-six.wasm
node factory/tools/wasm-runner.mjs /tmp/comet-six.wasm \
  --params /tmp/comet-six-params.json --wav factory/plugins/comet-six/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/comet-six/spec.json
```

The wasm-runner reports `VERDICT: PASS` with every parameter `✓ affects`.

## GUI

`gui.html` is one self-contained document (inline CSS/JS/SVG, no external assets):
a deep-blue + magenta panel with a live **multimode filter scope** that redraws the
LP/BP/HP curve as you morph the mode, a **cross-mod waveform** strip, six animated
**voice bars**, and custom knobs (drag, shift-drag fine, wheel, double-click reset).
Every control wires to `window.vstai.setParam(index, value)`.
