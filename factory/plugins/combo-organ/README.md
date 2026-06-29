# Combo Organ

A polyphonic 1960s transistor **combo organ** instrument — an original model of the classic
"divide-down" combo organ sound (bright, hollow, slightly reedy), with its own bespoke
animated GUI.

## Sound / DSP

A divide-down organ generates one master pitch per key and divides it into octaves that are
re-summed through bright rocker tabs. This module reproduces that architecture per voice:

- **4 octave taps** from one keyed pitch — 16′ (octave down), 8′ (played pitch), 4′ and a
  2′ reed buzz (octaves up). Each tap is a **band-limited pulse** (polyBLEP) with a
  progressively narrower duty cycle so the upper octaves get thinner and reedier.
- **Rocker tabs** mix the footages: `Bass` (16′), `Mid` (8′) and `Bright` (4′ + the 2′ reed).
- **Instant keying** — a fast attack/release gate (~4 ms / ~12 ms), no slow envelope, the way
  combo organs speak the moment a key is pressed.
- **Scanner-style vibrato** — a global LFO (4.5–7.5 Hz) modulates the whole keyboard's pitch,
  with `Vibrato Depth` and `Vibrato Rate`.
- **Tone tilt** — a one-pole low-pass running ~900 Hz (dark/woody) to ~11 kHz (bright/cutting),
  blended so even the darkest setting keeps presence.
- A gentle `tanh` stage glues the summed voices and keeps the peak bounded (< 1.0).

12-voice polyphony with oldest-voice stealing, so chords ring. The host converts MIDI notes to
Hz and calls `noteOn(id, freq, vel)` / `noteOff(id)`.

## Parameters

| # | Name          | Default | Range | Role |
|---|---------------|---------|-------|------|
| 0 | Bass          | 0.70    | 0–1   | 16′ flute tab level |
| 1 | Mid           | 0.85    | 0–1   | 8′ flute tab level |
| 2 | Bright        | 0.60    | 0–1   | 4′ + reed bright tab level |
| 3 | Vibrato Depth | 0.35    | 0–1   | pitch vibrato amount |
| 4 | Vibrato Rate  | 0.45    | 0–1   | vibrato speed (4.5–7.5 Hz) |
| 5 | Tone          | 0.60    | 0–1   | dark → bright tilt |
| 6 | Level         | 0.50    | 0–1   | output level |

## GUI

A self-contained HTML/CSS/SVG panel styled as a cheerful 60s combo organ: cream rocker
**tabs** over a lit red/pink colour band that grows with the tab level, a brushed top bar with
logo, round chrome dials for Vibrato/Tone/Level, and a **Vibrato rocker** that physically
**wobbles** (a real `@keyframes` animation whose speed follows the Rate control). Chrome legs
hint under the cabinet. Every control is drag-to-adjust with double-click reset, shows its live
value, initialises to its default, and drives `window.vstai.setParam(index, value)`.

## Files

- `assembly.ts` — AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`).
- `spec.json` — name, params, theme (`#ff5c6e` / `#ffd0d6`), GUI path.
- `gui.html` — bespoke animated GUI.
- `combo-organ.vstai` — packed self-contained plugin document.
- `preview.wav` — rendered audition.

## Build

```sh
node compiler/asc-driver.mjs factory/plugins/combo-organ/assembly.ts /tmp/combo-organ.wasm
node factory/tools/wasm-runner.mjs /tmp/combo-organ.wasm \
  --params /tmp/combo-organ-params.json \
  --wav factory/plugins/combo-organ/preview.wav --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/combo-organ/spec.json
```
