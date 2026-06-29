# Sem Voice

A warm, vocal **SEM-lineage duophonic synth voice** (an original plugin inspired by
the classic multimode American-mono sound — not the trademark).

## The voice
Two detuned oscillators — an **osc1 saw** and an **osc2 variable-width pulse** —
feed a **12 dB/oct state-variable filter** whose response **morphs continuously
from low-pass, through a notch, to high-pass** via the `Mode` control. The filter
has resonance and its own decay envelope. The smooth **LP → notch → HP** sweep is
the signature: the notch and high-pass settings are audibly hollow/thin versus the
round low-pass, and a touch of band-pass "honk" appears near the notch for the
classic throaty growl.

Signal path per voice:

```
osc1 saw + osc2 pulse (detuned)
   → 12 dB state-variable filter  (lp/bp/hp blended by Mode)
   → amp envelope → level
cutoff = base cutoff + EnvAmount · filterEnv (own decay)
```

Duophonic (2 voices), last-note / round-robin steal. Host passes Hz to
`noteOn(id, freq, vel)` / `noteOff(id)`.

## Parameters
| # | Name | Range | Default | What it does |
|---|------|-------|---------|--------------|
| 0 | Mode       | 0–1 | 0.00 | morph LP (0) → notch (0.5) → HP (1) |
| 1 | Cutoff     | 0–1 | 0.45 | base filter cutoff (~90 Hz – 10 kHz, log) |
| 2 | Resonance  | 0–1 | 0.45 | SVF resonance / peak sharpness |
| 3 | Env Amount | 0–1 | 0.60 | how far the filter envelope sweeps cutoff |
| 4 | Detune     | 0–1 | 0.35 | osc2 detune + pulse width (thickness) |
| 5 | Decay      | 0–1 | 0.50 | filter + amp decay time and sustain |
| 6 | Level      | 0–1 | 0.80 | output level |

## DSP notes
- All-`f32` AssemblyScript (`Mathf.*`, explicit `f32()` casts), no imports.
- No allocation in `process()`; all state is module-scope `StaticArray`.
- Planar stereo, stride 8192. Output gain-staged with a soft saturator and DC
  blocker; preview peak ≈ 0.48 (well below 1.0).

## GUI
`gui.html` is one self-contained document (inline CSS/JS/SVG, no external assets):
a cream + chrome American-mono panel with one big **Mode morph dial** that drives a
**live filter-response curve** morphing LP → notch → HP, amber (`#e8c27a`) + sky-blue
(`#7ad0ff`) with a slow keyframe sheen and breathing cutoff sweep. Every parameter is
a draggable custom dial wired through `window.vstai.setParam(index, value)`, initialised
to its default, double-click to reset, with a live value readout.

## Build / verify
```
node compiler/asc-driver.mjs factory/plugins/sem-voice/assembly.ts /tmp/sem-voice.wasm
node factory/tools/wasm-runner.mjs /tmp/sem-voice.wasm \
  --params /tmp/sem-voice-params.json --wav factory/plugins/sem-voice/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/sem-voice/spec.json
```
Last verify: **VERDICT: PASS** — all 7 parameters `✓ affects`, finite, no clip.
