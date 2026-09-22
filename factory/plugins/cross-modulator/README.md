# Cross Modulator

A meta-modulator effect for VibePlugin: crosses the input signal against an
internal complex carrier oscillator through one of four algorithms. Inspired
by the meta-modulator idea behind modern Eurorack cross-modulation modules —
an original implementation, no code or samples borrowed.

## Why one input, not two

This plugin format gives an effect exactly one audio input (`getInputPtr()`)
— there's no second/sidechain input to cross-modulate against. That's not a
workaround: a real hardware meta-modulator of this kind behaves exactly this
way when nothing is patched into its second input — it falls back to an
internal oscillator. **Track Input** blends the carrier's frequency from the
manual **Carrier Freq** knob toward a rough zero-crossing pitch-follow of the
input, so the carrier can lock to what you're playing instead of running
free — the closest a single-input effect can get to "the other signal" being
musically related to the first.

## Algorithms

Deliberately skips plain ring-modulation and vocoding — `ring-mod` and
`robot-voice` already cover those elsewhere in the factory.

| Algorithm | What it does |
|---|---|
| Difference / XOR-Fold | folds `(input − carrier) × amount` — comparator-like sum/difference artifacts |
| Wavefold Cross | the input's amplitude drives *how hard* the carrier gets folded, not the carrier's pitch |
| Chebyshev Cross | blends the carrier through increasing Chebyshev polynomial orders (T1→T4) as the input gets louder — input-dependent harmonic brightness |
| Hard-Sync Cross | resets the carrier's phase on the input's rising zero-crossings — classic oscillator hard-sync, driven by whatever you feed it |

Carrier waveform is selectable (sine/saw/triangle/pulse). Feedback recirculates
the previous output sample back into the cross-mod stage for extra texture;
Tone is a one-pole tilt between the signal's low and high content; Width does
a proper mid-side scale (not a Haas trick) since this is a true stereo
processor with independent per-channel state.

## Verification

- All four algorithms stress-tested with a 220 Hz sine input at high Amount/
  Feedback/Drive (including Feedback=1.0, Amount=1.0 simultaneously): stable,
  no NaNs, peak stays comfortably below the output `tanh`'s ceiling in every
  case.
- `wasm-runner.mjs`: PASS on both the default and test-params render, all 11
  params reactive, no clipping, no NaNs.
- `persist-check.mjs`: PASS (GUI follows restored state for all 11 params).

## Build / test

```sh
node factory/tools/scaffold.mjs cross-modulator --pack
node factory/tools/persist-check.mjs factory/plugins/cross-modulator
```
