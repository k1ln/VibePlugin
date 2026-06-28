# Space Tape Echo

A **multi-head tape echo**. A single circulating tape loop is read by three
virtual playback heads at fixed taps (short / medium / long), and a **Mode**
control selects which combination of heads is active — so each setting yields a
different rhythmic echo pattern. The repeats run through tape-style HF loss and
a gentle record/playback saturation, a slow wow plus faster flutter LFO adds the
unstable vintage pitch wander, and a short diffuse ambient tail sits underneath.
Feedback is clamped and the loop is `tanh`-limited so dense self-oscillation
rings but never diverges or clips.

## How it works

- **Multi-head tape loop** — one interpolated, wrap-safe tape line per channel.
  Three playback heads read at `1×`, `~1.95×` and `3×` the base "Time" spacing;
  head 2 is deliberately off an integer multiple for a looser, tape-like feel.
- **Mode selector** — 12 discrete head combinations (single heads, pairs, the
  full triple, and several weighted blends). The active heads are
  level-normalised (`1/√Σg`) so denser modes stay roughly level-matched.
- **Tape HF loss + saturation** — a one-pole low-pass in the feedback path
  darkens each repeat; the record stage runs through `tanh`, giving warm
  compression and keeping near-maximum feedback bounded.
- **Wow & flutter** — a slow ~0.6 Hz wow and a faster ~6.7 Hz flutter modulate
  the whole tape transport speed, so all heads drift together (musical pitch
  wander rather than per-tap chorusing). Channels are offset slightly for width.
- **Ambient tail** — the echo sum feeds a short cross-coupled diffuser with a
  damping low-pass, adding an ambient bloom under the discrete repeats.
- **Bounded feedback** — requested feedback is hard-clamped to `0.95` and the
  loop is `tanh`-saturated; the wet path is trimmed so peaks stay below ~1.0.

## Parameters

| Index | Name     | Range | Default | Description                                              |
|-------|----------|-------|---------|----------------------------------------------------------|
| 0     | Time     | 0–1   | 0.30    | Base head spacing / tape speed, ~40–700 ms (squared)     |
| 1     | Feedback | 0–1   | 0.45    | Number of repeats; mapped to a clamped 0–0.95 loop gain  |
| 2     | Mode     | 0–1   | 0.40    | Selects which of 12 head combinations is active          |
| 3     | Wow      | 0–1   | 0.30    | Wow/flutter modulation depth (pitch wander)              |
| 4     | Tone     | 0–1   | 0.55    | Repeat brightness (tape HF-loss low-pass cutoff)         |
| 5     | Mix      | 0–1   | 0.45    | Dry/wet blend                                            |

## Test result

`wasm-runner.mjs` (3 s @ 48 kHz): **VERDICT: PASS** — output present, finite, no
clipping (peak ≈ 0.50), all six parameters reactive:

```
output:   rms=0.18033  peak=0.49638  dc=0.00049  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
  [0] Time       ✓ affects   (rel Δ 0.62574)
  [1] Feedback   ✓ affects   (rel Δ 0.44205)
  [2] Mode       ✓ affects   (rel Δ 0.54930)
  [3] Wow        ✓ affects   (rel Δ 0.71292)
  [4] Tone       ✓ affects   (rel Δ 0.29480)
  [5] Mix        ✓ affects   (rel Δ 1.19581)
```

A 6 s stress render with Feedback = 1.0 and dense modes stays bounded
(peak ≈ 0.84, finite, no NaN), confirming the loop never diverges.
