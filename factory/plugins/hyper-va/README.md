# Hyper VA

A modern **hypersaw virtual-analog** polyphonic synthesizer instrument — the big,
bright digital VA trance lead/pad, an original take on the classic hypersaw lineage.

## Sound

Eight independent voices, each:

- **Supersaw oscillator** — seven detuned, band-limited (polyBLEP) saws stacked
  around the played pitch. The centre saw carries the pitch core; the six others
  fan out in tuning *and* in stereo position.
- **Square sub** an octave down for low-end weight.
- A **bright resonant 4-pole low-pass** run independently on the left and right
  sums (so the spread stays wide through the filter), driven by its **own
  AR envelope** plus the base Cutoff.
- An **amplitude AR envelope**.

`Detune` thickens the stack into shimmering beats; `Spread` fans the saws across
a huge stereo field; `Cutoff` opens from a dark thump to a glassy digital top
(80 Hz … ~18 kHz); `Env Amount` adds the classic filter sweep on each note.

Bright digital character — no vintage drift or warmth modelling. Pitch tracks the
host (frequency is passed in Hz), chords ring with independent contours, and the
output is `tanh`-soft-clipped and level-scaled so it stays bounded.

## Parameters

| # | Name       | Range | Default | Effect |
|---|------------|-------|---------|--------|
| 0 | Detune     | 0–1   | 0.45    | Supersaw detune spread (saw-stack thickness) |
| 1 | Cutoff     | 0–1   | 0.60    | Base filter cutoff (exp 80 Hz–18 kHz) |
| 2 | Resonance  | 0–1   | 0.30    | Low-pass resonance / emphasis |
| 3 | Env Amount | 0–1   | 0.55    | Filter-envelope sweep depth (octaves) |
| 4 | Spread     | 0–1   | 0.70    | Stereo width of the saw stack |
| 5 | Attack     | 0–1   | 0.05    | Amp + filter attack time |
| 6 | Release    | 0–1   | 0.40    | Amp + filter release time |
| 7 | Level      | 0–1   | 0.70    | Output level |

## GUI

A self-contained futuristic trance-machine panel: a sleek black-glass body with
neon magenta→blue accents, an animated fanned **saw-stack** canvas whose waves
spread (Detune) and shift across the field (Spread) and brighten (Cutoff),
LED level meters that pulse as you play, hand-built SVG knobs (drag, wheel,
double-click to reset) and a two-octave playable keyboard (mouse, touch, or
computer keys A–K). No external assets.

## Files

- `assembly.ts` — AssemblyScript DSP (VibePlugin WASM ABI).
- `gui.html` — self-contained GUI.
- `spec.json` — name, params, theme, packaging.
- `hyper-va.vstai` — packed plugin.
- `preview.wav` — offline render from the test harness.

## Build

```
node compiler/asc-driver.mjs factory/plugins/hyper-va/assembly.ts /tmp/hyper-va.wasm
node factory/tools/wasm-runner.mjs /tmp/hyper-va.wasm --params params.json \
     --wav factory/plugins/hyper-va/preview.wav --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/hyper-va/spec.json
```
