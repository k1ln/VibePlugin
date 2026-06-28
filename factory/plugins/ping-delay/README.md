# Ping Delay — stereo ping-pong / multi-tap delay

**Type:** Effect · **Params:** 6 · **Samples:** none (pure algorithm)

## What it is
A stereo ping-pong delay: the wet signal is cross-fed between the left and right delay lines so
every repeat bounces to the opposite side. On top of the main ping-pong echo sit three extra
rhythmic taps at fractional sub-divisions of the delay time (½, 1¼ and 1¾ of the base time),
panned alternately and brought in by the **Taps** control. A one-pole tone low-pass darkens every
repeat, **Width** crossfades each side between a centred sum and the full opposite-channel bounce,
and a `tanh` saturator in the feedback path keeps near-max feedback ringing but bounded.

## Signal flow
```
in ─► mono sum ─┬─► [delayL] ─► echoL ─┐         ┌─ extra taps (½,1¼,1¾) ─┐
                └─► [delayR] ─► echoR ─┤         │                        │
   feedback: L line ← (R echo) ► tone LP ► ×FB ► tanh ► back into the lines
   wet bus: ping-pong cross (Width) + panned taps (Taps) ─► ×Mix ─► out
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Time     | 0–1 | 0.33 | base delay 30 ms … 1 s (squared curve) |
| 1 | Feedback | 0–1 | 0.45 | repeat regeneration (0 … 0.92, clamped) |
| 2 | Taps     | 0–1 | 0.40 | level of the three extra rhythmic taps |
| 3 | Tone     | 0–1 | 0.55 | feedback low-pass ~600 Hz … 9 kHz |
| 4 | Width    | 0–1 | 0.80 | stereo spread of the bounce and taps |
| 5 | Mix      | 0–1 | 0.50 | dry/wet blend |

## Test result
```
output:  rms=0.17461  peak=0.47853  dc=0.00039  nan=0
checks:  present=true  finite=true  noClip=true  paramsReactive=true
all 6 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (clean plucked riff → ping-pong delay).
