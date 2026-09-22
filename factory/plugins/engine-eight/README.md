# Engine Eight

A macro-oscillator voice for VibePlugin: one instrument, eight selectable digital
synthesis engines, all played through the same three macro knobs (Harmonics /
Timbre / Morph) so switching engines never means re-learning the panel. Inspired
by the "one oscillator, many algorithms" idea behind modern macro-oscillator
Eurorack modules — an original implementation, no code or samples borrowed.

## The eight engines

| # | Engine | Harmonics | Timbre | Morph |
|---|--------|-----------|--------|-------|
| 0 | Analog | saw → narrow-pulse waveshape | unison detune spread | sub-osc + detuned-unison mix |
| 1 | Fold | fold amount (drive into the folder) | fold asymmetry/offset | blend in a second fold stage |
| 2 | Chord | selects one of 8 chords (unison…add9) | saw ↔ pulse waveshape (shared by all 4 voices) | ensemble/chorus detune |
| 3 | Speech | vowel position (A-E-I-O-U) | pulse (voiced) ↔ noise (unvoiced) exciter blend | formants fixed ↔ tracking the played pitch |
| 4 | Granular | grain density / spawn rate | grain waveform: sine → saw → noise | pitch scatter across grains |
| 5 | Modal | string brightness (damping) | string ↔ bell (dispersion allpass blend) | decay time, ~0.2–5 s |
| 6 | Noise | resonator count / harmonic spread | resonance (Q) | white noise ↔ sparse "dust" impulses |
| 7 | Percussion | selects kick / snare / hihat / clap | tone/snap character (per drum) | decay length |

Shared underneath every engine: Octave (±24 semitones) + Glide, a standard ADSR,
a resonant ladder low-pass (Cutoff/Resonance/Filter Env), an LFO routable to
Pitch/Cutoff/Timbre, and an output stage (Level/Pan/Width — Width cross-feeds a
short delayed copy into the other channel for stereo spread).

## Known, deliberate simplifications

- **Modal (engine 5)** uses a single circular buffer sized to the note's pitch
  *at the moment `noteOn` fires*, not a continuously-retuned fractional delay
  line — so glide/pitch-LFO won't re-tune an already-ringing string mid-note.
  A textbook Karplus-Strong implementation retunes continuously; this trades
  that off for something simple enough to get right the first time (see the
  bug below).
- **Chord (2), Granular (4), Noise (6) and Percussion (7)** aren't single-pitch
  by design (a chord, a grain cloud, a resonator bank, and a drum voice) — a
  monophonic pitch-tracker won't read a clean fundamental from them, which is
  expected, not a defect.

## A bug this caught (worth recording)

The first pass of the Modal engine had two real bugs, both only visible when
actually measuring pitch/decay per-engine (the automated `wasm-runner.mjs`
gate only exercises engine 0 and, via `test-params.json`, engine 6 — engine 5
was silently never rendered):
1. The decay coefficient was written as a flat ~0.98 multiply applied every
   audio sample, when it needed to be a `sampleRate`-scaled exponential decay
   over a decay *time* — the string was fully silent within ~a couple hundred
   samples regardless of parameters.
2. The read/write pointer arithmetic wrapped modulo the full 4096-sample
   buffer capacity instead of modulo the note's actual loop length, so the
   read pointer landed in a region of the buffer that was never written —
   also total silence.

`node factory/tools/pitch-check.mjs <wasm> --set "0=5"` on the first build
printed `peak 0.000 rms 0.0000` — a dead giveaway once you know a `hz` of
exactly `sampleRate / 31` from the tool is what a fully-silent buffer looks
like (autocorrelation of all-zero divides `0/0`, falls back to the smallest
lag checked). Fixed in the current `assembly.ts`; re-verified at 55/110/220/440 Hz
with periodicity 1.00 and ratio within ~0.7% (normal integer-loop-length
Karplus-Strong tuning error).

## Build / test

```sh
node factory/tools/scaffold.mjs engine-eight --pack
node factory/tools/pitch-check.mjs /tmp/engine-eight.wasm --freq 220 --set "0=5"
node factory/tools/persist-check.mjs factory/plugins/engine-eight
```

Verdict: **PASS** on both the default and test-params render (20/20 params, no
clipping, no NaNs); persist-check PASS (GUI follows restored state for all 20
params); pitch-check confirms clean pitch-tracking on engines 0/1/3/5 and
expected non-single-pitch behavior on 2/4/6/7.
