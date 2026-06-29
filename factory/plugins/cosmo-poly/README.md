# Cosmo Poly

A lush eight-voice analog poly synthesizer with a cinematic, ring-modulated
character — an original instrument in the classic Japanese CS-style polysynth
lineage. Built for the "Blade Runner" string-pad sound: warm sawtooth bodies,
a glassy top end, and a clangy metallic shimmer layered on top.

## Sound

Each of the 8 independently-allocated voices runs:

- a band-limited **saw** oscillator (slightly flat) and a band-limited **pulse**
  oscillator (slightly sharp, 45% duty) for a thick, beating analog body,
- a sine **sub-oscillator** one octave down for weight,
- a built-in **ring modulator** that multiplies the voice against a detuned
  carrier (~1.5x) to add inharmonic, bell-like clang,
- a smooth resonant **4-pole low-pass** filter driven by its own attack/decay
  envelope (Cutoff + Env Amount sweep it open per note),
- a **Brilliance** high tilt that feeds high-passed energy back in for sheen,
- an amplitude **attack/release** envelope.

Voices are spread across a wide stereo field by note, and the summed mix is
softly saturated for analog glue. Chords ring with independent contours.

## Parameters

| # | Name       | Range | Default | Effect |
|---|------------|-------|---------|--------|
| 0 | Cutoff     | 0..1  | 0.50    | Base low-pass cutoff (80 Hz .. ~14 kHz, exponential) |
| 1 | Resonance  | 0..1  | 0.30    | Filter resonance / emphasis |
| 2 | Env Amount | 0..1  | 0.55    | How far the filter envelope sweeps cutoff (up to ~5 oct) |
| 3 | Ring       | 0..1  | 0.25    | Ring-modulation amount (clangy metallic shimmer) |
| 4 | Brilliance | 0..1  | 0.50    | High-frequency tilt / air |
| 5 | Attack     | 0..1  | 0.25    | Amp + filter attack time (2 ms .. ~2.5 s) |
| 6 | Release    | 0..1  | 0.45    | Amp + filter release time (20 ms .. ~4 s) |
| 7 | Level      | 0..1  | 0.70    | Output level |

## Files

- `assembly.ts` — the AssemblyScript DSP module (VibePlugin WASM ABI).
- `spec.json` — plugin metadata, theme and parameter map.
- `gui.html` — the bespoke self-contained animated GUI (nebula backdrop,
  ring-mod halo, luminous ribbon, SVG knobs, playable keyboard).
- `cosmo-poly.vstai` — the packed, self-contained plugin document.
- `preview.wav` — rendered audio preview.

## GUI

A widescreen sci-fi panel: a slow-drifting blue-to-violet nebula with twinkling
stars, a spinning ring-modulator halo, a sliding luminous ribbon strip, eight
hand-built SVG knobs (drag vertically, double-click to reset, wheel to nudge,
shift to fine-tune) and a two-octave polyphonic keyboard. Accent
`#5ad0ff` / `#b08cff`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/cosmo-poly/assembly.ts /tmp/cosmo-poly.wasm
node factory/tools/wasm-runner.mjs /tmp/cosmo-poly.wasm \
  --params /tmp/cosmo-poly-params.json --wav factory/plugins/cosmo-poly/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/cosmo-poly/spec.json
```

Last test run: **VERDICT: PASS** — audio present, finite, non-clipping; all 8
parameters affect the output.
