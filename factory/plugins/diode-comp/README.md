# Diode Comp

A diode-bridge style bus compressor — smooth, slightly coloured dynamics control
with a touch of even-harmonic warmth, in a vintage British grey-and-red console
module. An original VibePlugin creation inspired by the classic diode-bridge
compressor topology (no trademarks shipped).

## Sound

A stereo-linked peak/RMS detector feeds a dB-domain gain computer with a wide,
over-easy soft knee for a gentle, programme-dependent grab. The compressed signal
then passes through an asymmetric diode-bridge transfer (a bounded soft-clip with
a small even-order bias) whose drive tracks the gain reduction, so the harder the
unit squeezes, the warmer it sounds. Loud material is compressed and coloured more
than quiet passages, gluing a mix without sounding clinical. A DC blocker keeps the
asymmetric stage from leaking offset, and the output is clamped and bounded.

## Parameters

| # | Name      | Range            | Default | Notes                                    |
|---|-----------|------------------|---------|------------------------------------------|
| 0 | Threshold | -42 .. 0 dBFS    | 0.32    | Lower = more of the signal is compressed |
| 1 | Ratio     | 1.5:1 .. 12:1    | 0.40    | Compression slope                        |
| 2 | Attack    | 0.3 .. 120 ms    | 0.30    | Curved; how fast it clamps down          |
| 3 | Release   | 50 ms .. 1.5 s   | 0.35    | Curved; how fast it recovers             |
| 4 | Makeup    | 0 .. +24 dB      | 0.28    | Output makeup gain                       |

All parameters are 0..1 at the ABI and mapped to the engineering units above
inside `process()`.

## GUI

A self-contained HTML document: a brushed-grey British-console-style module with red
accents, corner screws, a glowing power lamp, a swinging gain-reduction VU needle
(eased on a requestAnimationFrame loop, with attack/release-tinted ballistics) and
five stepped, knurled knobs. Each knob is drag-to-turn (vertical), wheel to
fine-tune, double-click to reset, arrow-key adjustable, and shows its live value in
real engineering units. Every control is wired to the engine via
`window.vstai.setParam(index, value)`.

## Files

- `assembly.ts` — the DSP (AssemblyScript → WASM)
- `gui.html` — the GUI (single self-contained HTML doc)
- `spec.json` — plugin manifest (name, theme, params, paths)
- `diode-comp.vstai` — packed bundle
- `preview.wav` — rendered test-bed preview

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/diode-comp/assembly.ts /tmp/diode-comp.wasm
node factory/tools/wasm-runner.mjs /tmp/diode-comp.wasm \
  --params /tmp/diode-comp-params.json --wav factory/plugins/diode-comp/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/diode-comp/spec.json
```

Test-bed verdict: **PASS** — audio present, finite, peak < 1.0, all 5 params reactive.
