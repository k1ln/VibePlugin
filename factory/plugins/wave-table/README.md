# Wave Table

A polyphonic **wavetable synthesizer** in the spirit of early-1980s German
digital wavetable hardware. The engine generates a bank of eight single-cycle
waveforms entirely in code at init — spanning a pure sine, through ever richer
harmonic spectra, into bright hollow formant shapes — and a **Wave Position**
control scans smoothly through that bank with linear interpolation *between*
adjacent tables, morphing the timbre in real time (the classic scanning
character).

Up to eight voices are allocated per `noteId`, so chords ring with independent
contours. Each voice is:

```
wavetable oscillator (2 detuned reads, scanned + interpolated)
   -> resonant 4-pole low-pass  (cutoff + filter AR envelope * amount)
   -> amplitude AR envelope
```

Voices are summed, headroom-scaled and softly saturated for glue. The host
converts MIDI note numbers to Hz and calls `noteOn(id, freq, vel)` / `noteOff(id)`.

## Parameters

| # | Name | Range | Default | What it does |
|---|------|-------|---------|--------------|
| 0 | Wave Position | 0..1 | 0.00 | Scans through the 8-wave bank with inter-table interpolation |
| 1 | Cutoff | 0..1 | 0.60 | Base low-pass cutoff, ~60 Hz .. 16 kHz exponential |
| 2 | Resonance | 0..1 | 0.30 | Ladder feedback / resonant peak |
| 3 | FilterEnvAmt | 0..1 | 0.50 | How far the filter envelope opens the cutoff (up to 6 oct) |
| 4 | Attack | 0..1 | 0.02 | Amp + filter envelope attack time |
| 5 | Release | 0..1 | 0.35 | Amp + filter envelope release time |
| 6 | Detune | 0..1 | 0.20 | Subtle two-oscillator unison spread |
| 7 | Level | 0..1 | 0.70 | Output level |

## Files

- `assembly.ts` — AssemblyScript DSP (VibePlugin WASM ABI). All `f32`, no
  allocation in `process()`; tables built with `Mathf.*` at init.
- `spec.json` — factory spec (name, params, theme, GUI reference).
- `gui.html` — self-contained bespoke GUI: an animated 3D stack of the eight
  single-cycle waveforms with a scan slider that lights and sweeps through the
  bank; blue 80s German digital-hardware aesthetic, wireframe wave display.
- `preview.wav` — offline render from the test harness.
- `wave-table.vstai` — packed bundle.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/wave-table/assembly.ts /tmp/wave-table.wasm
node factory/tools/wasm-runner.mjs /tmp/wave-table.wasm \
  --params /tmp/wave-table-params.json --wav factory/plugins/wave-table/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/wave-table/spec.json
```

Harness verdict: **PASS** — audio present, finite, non-clipping, and every one
of the eight parameters demonstrably affects the output.
