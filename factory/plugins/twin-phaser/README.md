# Twin Phaser

A dual sweeping-notch phaser. Two **independent 4-stage allpass engines**,
each driven by its own triangle LFO at its own rate, give two sets of notches
that drift across the spectrum at the same time. Run them **summed** (parallel)
for wide, beating notch patterns, or chained in **series** for deep, stacked
8-notch sweeps. Per-engine feedback sharpens the moving notches into vocal,
resonant peaks.

Original effect inspired by classic dual-phaser hardware. No samples — pure
allpass DSP.

## DSP

- **Two allpass chains** (4 stages each), per channel, with a small stereo LFO
  offset for a wide image.
- **Coefficient sweep:** each LFO sweeps an allpass break frequency between
  ~200 Hz and ~1.6 kHz; the one-pole allpass coefficient `g = (1 - tan)/(1 + tan)`
  is rebuilt per sample so notches glide smoothly.
- **Routing:** SUM averages the two phased signals; SERIES feeds engine A's
  output into engine B for deeper sweeps.
- Feedback is bounded to 0.92; the wet signal is safety-clipped; output peak
  stays below ~1.0.

## Parameters

| Index | Name     | Range        | Default | Notes |
|-------|----------|--------------|---------|-------|
| 0     | Rate A   | 0..1         | 0.30    | Engine A LFO, 0.02–8 Hz (quadratic) |
| 1     | Rate B   | 0..1         | 0.55    | Engine B LFO, 0.02–8 Hz (quadratic) |
| 2     | Depth    | 0..1         | 0.70    | Sweep span of both engines |
| 3     | Feedback | 0..1         | 0.45    | Notch resonance (→ 0.92 internal) |
| 4     | Mode     | 0/1 (step 1) | 0       | 0 = Sum (parallel), 1 = Series |
| 5     | Mix      | 0..1         | 1.00    | Dry/wet |

## GUI

Self-contained HTML/CSS/JS. A symmetrical retro panel with **twin animated
notch scopes** — one per engine — that sweep at the live LFO rates, deepen with
Depth, and sharpen with Feedback. Custom canvas knobs (vertical drag, wheel
fine-tune, double-click to reset) and a Sum/Series routing toggle that flashes
the link between the two displays. Theme accent `#7ad0c0` / `#9ad0ff`.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/twin-phaser/assembly.ts /tmp/twin-phaser.wasm
node factory/tools/wasm-runner.mjs /tmp/twin-phaser.wasm \
  --params /tmp/twin-phaser-params.json --wav factory/plugins/twin-phaser/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/twin-phaser/spec.json
```

Verified: `VERDICT: PASS` — all six parameters affect the output.
