# Cataclysm — master drum synthesizer

One deep drum voice engine (not a kit): six sound sources, cross-modulation, a ratchet
engine, a modulation matrix and a long FX chain, with **257 controls** and ranges meant to
be pushed. Play it from any MIDI note; one instance = one drum sound (use several for a
kit — VibePlugin has no multi-out).

```sh
node factory/cataclysm/build.mjs [--pack]     # → factory/plugins/cataclysm/{assembly.ts,gui.html,spec.json}
node compiler/asc-driver.mjs factory/plugins/cataclysm/assembly.ts /tmp/cat.wasm
# tests (all take the compiled wasm):
node factory/cataclysm/tests/packing.mjs   /tmp/cat.wasm   # every raw value of every control + random full patches via the host float chain
node factory/cataclysm/tests/layers.mjs    /tmp/cat.wasm   # ~100 behavioural checks (pitch, decay, sidebands, ratchets, mod matrix, FX …)
node factory/cataclysm/tests/fuzz.mjs      /tmp/cat.wasm 600 [seed]   # extreme random patches: no NaN, never above the ceiling
node factory/cataclysm/tests/os-test.mjs   /tmp/cat.wasm   # oversampling: aliasing, latency, mix alignment
node factory/cataclysm/tests/tune-levels.mjs /tmp/cat.wasm [wavDir]  # render + loudness-normalise every preset
node factory/cataclysm/tests/gui-roundtrip.mjs                         # the GUI's JS packing == pack.mjs (encode + restore decode)
node factory/tools/gui-check.mjs factory/plugins/cataclysm             # render errors
node factory/tools/persist-check.mjs factory/plugins/cataclysm         # restored sound is drawn, never overwritten
```

## Architecture

```
note → ratchet scheduler → voice pool (4, choke / gate / one-shot)
  voice:  CLICK ─┐
          NOISE ─┼─ cross-mod ─ TONE (pitch env ×2, tension, sync, fold, feedback, sub)
          METAL ─┤              FM   (2 op, feedback, ring/AM)
          FM    ─┘ sends ──────▶ MODAL (12 modes, material morph, strike pos, tension)
  mix → transient shaper → dist A → dist B (opt. 2×/4× OS) → crusher → filter → comb
      → ring mod → EQ → compressor → echo → reverb (gated) → width/Haas → clip/limit
```

* **Control rate** 16 samples; every envelope/coefficient is evaluated per tick and
  interpolated linearly per sample, so pitch sweeps of 10 octaves in 3 ms stay smooth.
* **Envelopes** fall 60 dB over `Decay`, bent by `Curve`: `dB(t) = −60·(t/T)^q`, `q = 2^(2·curve)`
  (so the curve control moves between "snaps then lingers" and "holds then drops"). Each layer
  also has a second, slower **Tail** decay (the "boom").
* **Modal** resonators are rotation (coupled-form) oscillators, so glides never change
  amplitude. Ratios: Bessel zeros of a circular membrane (1, 1.594, 2.136, 2.296 …), free-free
  bar (1, 2.756, 5.404 …), bell series, approximate free plate, harmonic string, fixed "junk".
  Mode weights = strike-position pattern × brightness tilt; ring time = `Decay · ratio^−tilt`.
  Membrane **tension modulation** raises pitch with amplitude (Avanzini/Rocchesso).
* **Metal**: six polyBLEP pulse oscillators at 808 / classic (2, 3, 4.16, 5.43, 6.79, 8.21) /
  harmonic / fifths / cluster / chaos ratio sets (continuously morphable in the log domain),
  optional pairwise ring products and folding, then HP → BP.
* **Safety**: the final stage hard-clamps to `Ceiling` (≤ 0 dBFS) and NaN is zeroed; if a runaway
  value is ever seen the FX tails are cleared. Fuzzing 600 extreme patches at 22–192 kHz never
  exceeds the ceiling.

## The 64-slot problem — packing

The host exposes 63 float slots per plugin. Every control is a small integer with its own
number of *steps*; several share a slot using **mixed-radix** packing (`slot = Σ raw_i·Π steps_j`,
product ≤ 2²⁴, exact in float32; the host maps a slot to 0..1 as `value / 2²⁴`, a power of two,
so the round trip is exact). 253 controls live in 57 packed slots; the 4 macros are *direct*
slots (real DAW automation). `params.mjs` is the single source of truth; `pack.mjs` assigns
slots; `build.mjs` generates the DSP tables; the GUI embeds the same layout.

Consequences: only the **macros** (slots 0–3) are meaningful to the DAW. Automate everything else
through the matrix (Macro → any of 63 targets). If the host ever raises `kMaxParams`, only the
packer needs to change.

## Presets (262)

`presets.mjs` (first bank, 52) + `presets-extra.mjs` (second bank, 210). The second bank is written as
descriptor → parameter builders (`K` kick, `S` snare, `C` clap, `H` hat/cymbal, `T` membrane, `P` pitched
percussion) so each preset is a deliberate variation of a worked recipe. Levels are normalised by
`tests/tune-levels.mjs` (peak ≈ −3 dBFS, loudest 400 ms ≤ −13 dBFS RMS) into `presets.levels.json`;
rerun it after any DSP change. `tests/quality.mjs <wasm> --all` is the gate: level, DC, NaN, tail,
per-category spectral fingerprint (kick sub-dominance, hat HF share, clap midband …), stereo balance,
velocity response (level or timbre), notes 28/48/60, 8-hit retrigger stability, and a minimum
spectral/decay distance to the nearest other preset. Heavily distorted presets automatically get
velocity → clipper drive so soft hits stay clean.

Long fade-ins: `*_ATT` goes to 1.5 s (swells, reverse hits) — keep `Decay` longer than the attack.
