# Tonewheel Organ

A polyphonic **additive drawbar organ** instrument for the VibePlugin factory —
an original take on the classic geared-tonewheel console organ (and its rotary
cabinet). No samples, no trademarks: every note is synthesised from first
principles.

## What it is

Each held key is built as a **sum of sine partials** tuned to the traditional
drawbar footages:

| Footage | Ratio | Role            |
|---------|-------|-----------------|
| 16'     | 0.5×  | Sub             |
| 8'      | 1×    | Fundamental     |
| 5⅓'     | 1.5×  | Third (quint)   |
| 4'      | 2×    | Upper           |
| 2⅔'     | 3×    | Upper           |
| 2'      | 4×    | Upper           |
| 1'      | 8×    | Upper           |

You blend the timbre with the drawbars; chords ring as a **full organ** because
the synth is genuinely polyphonic (12 voices, oldest-voice stealing). The
amplitude has an **instant attack and a flat sustain while the key is held** —
no decay — exactly like a real drawbar organ, with a quick release on key-up.

On top of the steady tone:

- **Key-click** — a short noisy transient at note onset (the famous contact bounce).
- **Percussion** — a single-trigger decaying tap on the **2nd or 3rd harmonic**
  (selectable), classic single-trigger behaviour that does not retrigger inside
  a held chord.
- **Drive** — a tube-amp soft-clip output stage for grit and bloom.
- **Rotary speaker** — a built-in Leslie-style cabinet: amplitude tremolo plus a
  gentle doppler pitch shimmer, with independent left/right motion for width.
  Speed sweeps from a slow chorale (~0.8 Hz) to a fast tremolo (~7 Hz).

## Parameters

| # | Name        | Range        | Default | Description                                  |
|---|-------------|--------------|---------|----------------------------------------------|
| 0 | Sub 16      | 0–1          | 0.60    | 16' drawbar level                            |
| 1 | Fund 8      | 0–1          | 0.85    | 8' (fundamental) drawbar level               |
| 2 | Third       | 0–1          | 0.35    | 5⅓' (quint) drawbar level                    |
| 3 | Upper       | 0–1          | 0.45    | Brightness — blends 4', 2⅔', 2', 1' together |
| 4 | Percussion  | 0–1          | 0.50    | Percussion tap amount                        |
| 5 | Perc Mode   | {0,1} step 1 | 0       | Percussion harmonic: 0 = 2nd, 1 = 3rd        |
| 6 | Drive       | 0–1          | 0.25    | Tube overdrive of the output stage           |
| 7 | Rotary      | 0–1          | 0.30    | Rotary speaker speed (slow → fast)           |

## GUI

A bespoke warm-wood-and-chrome console: a row of coloured **drawbars** that
slide vertically (drag down to pull out / get louder), SVG **knobs** for
Percussion / Drive / Rotary, a lit **rocker switch** for the percussion
harmonic, a **spinning rotor** in the header whose speed tracks the Rotary
control, and a playable two-octave keyboard (mouse, touch, or the `a s d f …`
computer-keyboard row). Double-click any control to reset to default.

## Files

- `assembly.ts` — the AssemblyScript DSP (additive voices, percussion, click,
  drive, rotary). Allocation-free `process()`, all-`f32`, planar stride 8192.
- `gui.html` — single self-contained HTML document (inline CSS/JS/SVG).
- `spec.json` — plugin manifest (name, params, theme, paths).
- `preview.wav` — rendered audio preview.
- `tonewheel-organ.vstai` — packed bundle.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/tonewheel-organ/assembly.ts /tmp/tonewheel-organ.wasm
node factory/tools/wasm-runner.mjs /tmp/tonewheel-organ.wasm \
  --params /tmp/tonewheel-organ-params.json \
  --wav factory/plugins/tonewheel-organ/preview.wav --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/tonewheel-organ/spec.json
```

The offline runner reports **VERDICT: PASS** with every parameter marked
`✓ affects`.
