# Fat Mono

A fat **monophonic analog-style synthesizer** instrument for the VibePlugin
factory. It models the behaviour of a classic 3-oscillator transistor-ladder
mono synth — thick, warm, in tune, with a singing resonant filter that sweeps
on every note.

## Signal flow

1. **Three detuned oscillators** — two band-limited sawtooths plus a band-limited
   pulse (~30% duty, an octave down for weight). PolyBLEP correction keeps them
   smooth/analog rather than buzzy. The two saws spread apart by the Detune
   amount for the signature fatness.
2. **4-pole resonant transistor-ladder low-pass** — four cascaded one-pole
   stages with a `tanh` saturation inside the resonance feedback loop, giving
   the warm, compressing, self-oscillation-leaning character.
3. **Dedicated filter ADSR** with a bipolar-style **amount**, sweeping the
   cutoff on every note attack.
4. **Amplitude ADSR** (separate envelope state).
5. **Last-note-priority monophonic voice** with **portamento / glide**.
6. Output DC blocker + gentle final `tanh` limiter, gain-staged so the peak
   stays well under full scale.

The fundamental tracks the played frequency in Hz exactly (the host passes Hz to
`noteOn`), so it always plays in tune.

## Parameters

| Index | Name         | Range | Default | Description                                              |
|-------|--------------|-------|---------|----------------------------------------------------------|
| 0     | Detune       | 0–1   | 0.35    | Oscillator spread / fatness (up to ~18 cents)            |
| 1     | Cutoff       | 0–1   | 0.45    | Base filter cutoff (~30 Hz – 16 kHz, exponential)        |
| 2     | Resonance    | 0–1   | 0.55    | Ladder resonance (feedback amount)                       |
| 3     | FilterEnvAmt | 0–1   | 0.7     | How far the filter envelope sweeps the cutoff            |
| 4     | Attack       | 0–1   | 0.08    | Attack time for both envelopes (~2 ms – 1.5 s)           |
| 5     | Release      | 0–1   | 0.3     | Release/decay time for both envelopes (~8 ms – 3 s)      |
| 6     | Glide        | 0–1   | 0.25    | Portamento time between notes (~1 ms – 0.6 s)            |
| 7     | Level        | 0–1   | 0.7     | Output level                                             |

## Test result

`node factory/tools/wasm-runner.mjs fat-mono.wasm --params … --synth --seconds 3`

```
output:   rms=0.04936  peak=0.19719  dc=-0.00001  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
params:   all 8 ✓ affects
VERDICT: PASS ✅
```

Allocation-free `process()`, all state in module-scope StaticArrays, every DSP
value `f32` (`Mathf.*`), no host imports.
