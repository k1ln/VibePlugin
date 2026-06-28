# Spring Verb

An original model of a vintage 2/3-spring reverb tank — the boingy, chirpy,
twangy reverb of guitar amps and dub consoles. Pure algorithm, no samples.

## How it works

The signature spring "boing" is dispersion: high frequencies travel faster than
lows down a coiled spring, so a transient smears into a descending chirp. Spring
Verb models this with a long cascade of **10 dispersive all-pass delay stages**,
wrapped in a **damped feedback loop** (the springs' repeated end reflections)
plus **two short comb taps** for body and inter-spring coupling. The recirculating
tail is high-frequency damped, soft-saturated (spring "overload") for character,
and DC-blocked. The feedback structure is designed so the **linear loop is stable
on its own**: the round-trip gain is the spring feedback (capped at 0.92), the
comb taps are folded in as a normalized convex blend rather than added on top, and
each comb sub-loop recirculates below unity — so an impulse always decays to
silence and the saturator only adds grit on hot transients.

## Parameters

| # | Name    | Range | Default | Description |
|---|---------|-------|---------|-------------|
| 0 | Decay   | 0–1   | 0.55    | Tail length — feedback gain of the spring loop (0.45→0.92) and comb reflections. The −40 dB tail grows monotonically from ~0.3 s at 0 to ~0.95 s at 1. |
| 1 | Tension | 0–1   | 0.5     | Dispersion / brightness. Tighter spring = brighter, faster chirp, shorter springs, less tail damping. |
| 2 | Drip    | 0–1   | 0.5     | Chirp / excitation amount. Drives the dispersive chain and adds transient pre-emphasis for a sharper "drip". |
| 3 | Mix     | 0–1   | 0.35    | Dry/wet. Mix = 0 is bit-exact dry. |

## Test result

`node factory/tools/wasm-runner.mjs … --seconds 3` → **VERDICT: PASS**

- output: rms=0.203, peak=0.507, dc≈0.0002, nan=0 (no clipping, well under the 1.5 limit)
- checks: present, finite, noClip, paramsReactive all true
- every parameter affects the output: Decay ✓, Tension ✓, Drip ✓, Mix ✓
- impulse-then-silence test: a single impulse decays to silence at every setting
  (final-window rms is <0.02% of the early window, peak bounded ≤0.53) — no
  self-oscillation, verified with the saturator never engaging
- Mix = 0 verified bit-exact to the dry input
