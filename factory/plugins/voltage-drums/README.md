# Voltage Drums

A fully-synthesized analog drum-machine instrument — no samples, every sound is
generated from oscillators and filtered noise in real time. Inspired by the
classic 8-bit-era analog rhythm boxes, it answers each incoming note with a
punchy one-shot voice.

## Voices

Seven analog voices are triggered by note number (`note mod 7`), so any pattern
of notes drives a full kit:

| Voice       | Synthesis |
|-------------|-----------|
| Kick        | Decaying sine with a fast downward pitch sweep + a short click transient |
| Snare       | Two tuned sines plus band-passed noise (the "snares") |
| Closed Hat  | A cluster of six inharmonic square oscillators through a high band-pass + noise, short decay |
| Open Hat    | Same metallic cluster with a long decay |
| Clap        | Several fast band-passed noise bursts followed by a smooth tail |
| Tom         | Pitched, lightly-swept decaying sine |
| Cowbell     | Two detuned square oscillators through a thinning high-pass |

Each `noteOn` also adds a faint kick/closed-hat/snare under-layer so the groove
stays full and every control remains audibly active whatever note is played.

## Controls

| Param       | Range | Effect |
|-------------|-------|--------|
| Tune        | 0..1  | Global pitch of all voices, -12..+12 semitones |
| Kick Decay  | 0..1  | Length of the kick body |
| Snare Snap  | 0..1  | Snare noise amount and how short/snappy the snares are |
| Hat Decay   | 0..1  | Decay length of the closed and open hats |
| Tone        | 0..1  | Global brightness — hat/snare band-pass and cymbal sizzle |
| Accent      | 0..1  | Overall hit intensity / output level |
| Kick Tone   | 0..1  | Kick click amount and pitch-sweep depth |

## Notes

- Pure algorithm: no samples, no host imports, no allocation in `process()`.
- Deterministic LCG noise source; all state in module-scope `StaticArray`s.
- Output is soft-saturated and clamped; preview render peaks well under 1.0.

Verified with `factory/tools/wasm-runner.mjs --synth`: VERDICT PASS, all seven
parameters affect the output.
