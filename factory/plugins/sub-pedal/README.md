# Sub Pedal

A dedicated **deep sub-bass pedal synthesizer** in the lineage of the classic
wooden foot-pedal bass synths — designed to be HUGE and simple: a single,
earth-shaking, monophonic bass voice for floor-rumbling root notes.

- **Type:** Instrument (monophonic synth, bass register)
- **Accent:** `#ff5a2a` / `#7a3dff`

## DSP

- **Two stacked main oscillators** — a band-limited sawtooth + square, tuned LOW.
- **Thick square SUB** an octave below for chest-thumping weight (the *Sub* knob).
- **Fat 4-pole Moog-style transistor-ladder low-pass** with `tanh` saturation in
  the feedback loop, driven by a deliberately **slow filter envelope** so the
  rumble opens gradually.
- **Glide / portamento** between notes (mono, last-note priority).
- **Punchy amplitude envelope** with a fast attack.
- **Warm overdrive** stage that adds low-end weight and harmonics.
- Incoming pitch is folded down by octaves into the bass range, so the voice
  always tracks low. PolyBLEP anti-aliasing, a DC blocker, and final clamping
  keep the output bounded (preview peak ≈ 0.35, well under 1.0).

All DSP is pure `f32` AssemblyScript (`Mathf.*`), with no imports and no
allocation inside `process()`.

## Parameters

| # | Name      | Default | Description |
|---|-----------|---------|-------------|
| 0 | Cutoff    | 0.40    | Base ladder cutoff — sweeps the low rumble open |
| 1 | Resonance | 0.30    | Ladder resonance / emphasis |
| 2 | Sub       | 0.70    | Sub-octave square level (low-end weight) |
| 3 | Glide     | 0.30    | Portamento time between notes |
| 4 | Decay     | 0.45    | Amp + filter decay/release time |
| 5 | Drive     | 0.35    | Warm overdrive (added weight + harmonics) |
| 6 | Level     | 0.80    | Output level |

## GUI

A bespoke, self-contained HTML/CSS/SVG panel: a wooden organ foot-pedal board
glowing from beneath (throbbing under-glow `@keyframes`), a deep red-to-violet
cabinet, one giant filter knob over a smaller knob row, and an animated,
breathing low-frequency **sub waveform** scope. Every knob is drag-to-edit
(vertical drag + scroll wheel), double-click resets to default, and shows its
live value. Pressing the foot pedals lights them. All params are wired through
`window.vstai.setParam(index, value)` and initialised on `onReady`.

## Files

- `assembly.ts` — DSP module (compiles to WASM via the in-process `asc`).
- `spec.json` — plugin manifest (`name: "Sub Pedal"`, `isInstrument: true`).
- `gui.html` — bespoke animated editor UI.
- `sub-pedal.vstai` — packed bundle.
- `preview.wav` — rendered 3 s preview.
