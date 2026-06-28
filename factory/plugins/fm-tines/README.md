# FM Tines

A bright, polyphonic FM electric-piano / bell synth. Each voice is a
two-operator phase-modulation pair: a sine modulator phase-modulates a sine
carrier, driven by a fast-decaying **modulation-index envelope** that produces
the classic struck-tine "bell" attack which then settles into a pure sine body.
A per-voice amp envelope (attack, then decay while held / faster release after
note-off) and a one-pole brightness tilt finish the tone. Up to 16 voices, so
chords ring out. Pure algorithm — no samples, no host imports.

Pitch tracks the played frequency (Hz passed by the host); `FMAmount` clearly
opens up the harmonic content from a near-pure sine to a rich, inharmonic bell.

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0 | Ratio      | 0–1 | 0.50 | Modulator:carrier frequency ratio (0.5 → 14). Sets the harmonic/inharmonic character of the FM spectrum. |
| 1 | FMAmount   | 0–1 | 0.55 | Peak modulation-index depth. Drives how bright/clangy the attack is. |
| 2 | ModDecay   | 0–1 | 0.45 | Decay time of the modulation-index envelope (30 ms → 2.5 s) — short = snappy tine, long = slow chime. |
| 3 | Attack     | 0–1 | 0.04 | Amplitude attack time (1 ms → 250 ms). |
| 4 | Release    | 0–1 | 0.55 | Decay/release time of the amp envelope (80 ms → ~5 s); held notes ring and fade. |
| 5 | Brightness | 0–1 | 0.60 | One-pole tilt opening from a mellow body up to an airy top. |
| 6 | Level      | 0–1 | 0.70 | Output level (soft-limited). |

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms=0.34054, peak=0.50987, dc=-0.00008, nan=0
- checks: present, finite, noClip, paramsReactive — all true
- every parameter reports `✓ affects`
