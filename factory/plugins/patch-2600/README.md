# Patch 2600

A monophonic **semi-modular** synthesizer in the spirit of the classic patchable
bench instruments — an original take, not a clone of any trademarked product.

## Sound

- **3 oscillators** — saw, pulse (40% duty) and triangle, spread by a shared
  **Detune** (osc2 up, osc3 down in cents).
- **Ring modulator** — a switchable cross-multiplier that mixes a sine-carrier
  product back in for metallic clangor.
- **Resonant low-pass** — two cascaded one-poles with feedback that can be pushed
  toward self-oscillation; fed by a pre-filter **drive** that scales with
  resonance and detune.
- **Two envelopes** — a dedicated **filter ADSR** (scaled by *Filter Env Amount*)
  sweeps the cutoff, and a separate **amp ADSR** shapes the level. Shared
  Attack/Release; fixed musical decay/sustain.
- **Glide** — portamento that slews pitch between notes. Last-note priority.

A soft saturator bounds every resonant stage and a DC blocker + headroom guard
keep the output peak well under full scale.

## Parameters

| # | Name          | Range | Default | Notes                                  |
|---|---------------|-------|---------|----------------------------------------|
| 0 | Detune        | 0–1   | 0.30    | oscillator spread in cents             |
| 1 | RingMod       | 0/1   | 0       | discrete toggle (step 1)               |
| 2 | Cutoff        | 0–1   | 0.50    | low-pass base cutoff (exp 50 Hz–13 kHz)|
| 3 | Resonance     | 0–1   | 0.45    | feedback toward self-oscillation       |
| 4 | FilterEnvAmt  | 0–1   | 0.55    | filter-env → cutoff sweep amount       |
| 5 | Attack        | 0–1   | 0.05    | attack time (both envelopes)           |
| 6 | Release       | 0–1   | 0.35    | release time (both envelopes)          |
| 7 | Glide         | 0–1   | 0.20    | portamento time (up to ~0.4 s)         |
| 8 | Level         | 0–1   | 0.80    | output level                           |

## GUI

A bespoke blue-grey **modular console**: nine modules of vertical faders (plus a
ring-mod lever toggle) wired together by **animated patch cords** that arc and
sway across the bay, with glowing patch jacks, a power lamp, brushed-metal
chassis and a playable keyboard (mouse, touch, or the **A–K** computer keys).
Faders are drag/wheel adjustable and double-click to reset. Self-contained HTML
with inline CSS/JS/SVG — no external assets.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM, VibePlugin ABI).
- `gui.html` — self-contained GUI.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `patch-2600.vstai` — packed plugin.
- `preview.wav` — rendered audio preview.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/patch-2600/assembly.ts /tmp/patch-2600.wasm
node factory/tools/wasm-runner.mjs /tmp/patch-2600.wasm \
  --params /tmp/patch-2600-params.json --wav factory/plugins/patch-2600/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/patch-2600/spec.json
```

Verdict: **PASS** — every parameter affects the output.

Accent: `#7c90b0` / `#c0d0e0`.
