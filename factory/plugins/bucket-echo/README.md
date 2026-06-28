# Bucket Echo

A warm, analog **bucket-brigade-style delay**. An interpolated, modulated delay
line feeds a bounded feedback path whose repeats grow progressively darker
through an in-loop one-pole low-pass — mimicking the bandwidth loss of a
bucket-brigade device. A slow wow/flutter LFO adds the vintage pitch wander, and
the feedback signal is soft-saturated (tanh) so near-maximum settings can ring
into self-oscillation without ever diverging or clipping.

## How it works

- **Fractional, interpolated delay read** — linear interpolation over a ~1 s
  delay line allows smooth, click-free time changes and clean modulation.
- **Darkening feedback loop** — a one-pole low-pass inside the feedback path
  removes high end on every repeat, so echoes decay into a warm, muffled tail.
- **Wow & flutter** — two detuned LFOs (slow ~0.7 Hz wow + faster ~6.3 Hz
  flutter) modulate the read distance for organic pitch drift; the two channels
  are modulated in mild opposition for stereo width.
- **Bounded feedback** — feedback gain is hard-clamped to 0.95 and the loop is
  passed through `tanh`, keeping self-oscillation stable (peak < 1.0, no NaN).

## Parameters

| Index | Name       | Range | Default | Description                                        |
|-------|------------|-------|---------|----------------------------------------------------|
| 0     | Time       | 0–1   | 0.22    | Delay time, ~20–800 ms (squared curve)             |
| 1     | Feedback   | 0–1   | 0.45    | Number of repeats; mapped to a clamped 0–0.95 gain |
| 2     | Tone       | 0–1   | 0.50    | Repeat darkness (in-loop low-pass cutoff)          |
| 3     | Modulation | 0–1   | 0.35    | Wow/flutter depth                                  |
| 4     | Mix        | 0–1   | 0.50    | Dry/wet blend                                      |

## Test result

`wasm-runner.mjs` (3 s @ 48 kHz): **VERDICT: PASS** — output present, finite, no
clipping (peak ≈ 0.52), all five parameters reactive:

```
output:   rms=0.19946  peak=0.51919  dc=0.00038  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
  [0] Time         ✓ affects
  [1] Feedback     ✓ affects
  [2] Tone         ✓ affects
  [3] Modulation   ✓ affects
  [4] Mix          ✓ affects
```

A 6 s stress run with Feedback/Tone/Modulation/Mix all at maximum stays bounded
(peak ≈ 0.83, no NaN), confirming self-oscillation does not blow up.
