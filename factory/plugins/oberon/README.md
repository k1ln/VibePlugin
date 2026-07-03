# Oberon — modelled on the Oberheim OB-X (1979)

An eight-voice polyphonic analog synthesizer rebuilt to full manual fidelity on
the **original 1979 Oberheim OB-X** — deliberately the *first* OB-X, **not** the
later OB-Xa.

## Source manual

- **Title:** *Owner's Manual — OB-X Polyphonic Synthesizer*, Oberheim Electronics, Inc.
- **Edition:** Second Edition, Second Printing, **June 1980**
- **Pages:** 12 (cover + 10 numbered pages). Read cover-to-cover.
- The primary scan (synthfool / archive.org, identical 1.5 MB file) is **truncated
  at page 10**, mid-Modulation section — the FILTER / OSCILLATOR-waveform / ENVELOPE
  panel pages are missing from the scan. Those sections were reconstructed from the
  documented OB-X front-panel architecture cross-checked against *Sound On Sound*'s
  "Oberheim OBX, OBXa & OB8" retrospective and the owner's-manual FEATURES list
  (p.1). Manuals were downloaded to a `mktemp -d` dir only, never committed.

## How Oberon differs from an OB-Xa (Brass Eight)

| | OB-X (Oberon) | OB-Xa (Brass Eight) |
|---|---|---|
| Filter slope | **2-pole 12 dB/oct only** (SEM/Curtis flavour) | selectable 2-pole / 4-pole |
| Filter resonance | smoother, SEM Q — never a screaming ladder | ladder-derived |
| Filter env -> osc pitch (F-ENV) | **not present** | present |
| OSC frequency | **continuous** knob (p.4) | octave switch |
| Modulation | one LFO, freq + PW columns | same core, richer routing |

The DSP uses a genuine **2-pole TPT state-variable low-pass** (Cytomic ZDF SVF,
low-pass tap) with damping `k = 1/Q` — the SEM character: it emphasises the cutoff
region and stays musical even at extreme resonance rather than self-oscillating to
a whistle.

## Manual section -> implementation coverage

| Manual section | Feature | Status |
|---|---|---|
| FEATURES p.1 | 8 voices, 2 VCOs/voice, 2 full ADSRs/voice | done - 8-voice poly, per-voice 2 osc + 2 ADSR |
| FEATURES p.1 | Noise Generator | done - noise into filter mixer |
| FEATURES p.1 | Pitch & Modulation levers | done - Pitch Bend lever (spring, prog. Bend Range) + Mod lever (fades LFO vibrato in) |
| FEATURES p.1 | Polyphonic Portamento | done - per-voice glide |
| CONTROL p.9 | PORTAMENTO (poly glide) | done |
| CONTROL p.9 | UNISON (low-note-priority stack) | done - 8-voice detuned stack, low-note priority |
| CONTROL p.9 | OSC 2 DETUNE (flat/sharp) | done - bipolar +/-50 c |
| MANUAL p.8 | MASTER TUNE | done - bipolar +/-50 c |
| MANUAL p.7 | HOLD (latch) | done - latch + relatch |
| MANUAL p.7 | VOLUME | done |
| MODULATION p.10 | LFO RATE (~0.1-20 Hz) | done |
| MODULATION p.10 | LFO SINE / SQUARE / S&H | done - 3-way wave selector |
| MODULATION p.10 | FREQUENCY DEPTH -> OSC 1 / OSC 2 / FILTER | done - depth + 3 destination switches |
| MODULATION | PULSE WIDTH DEPTH -> OSC 1 / OSC 2 | done - depth + 2 destination switches |
| OSCILLATORS | OSC 1 & 2 continuous FREQUENCY (p.4) | done - continuous, 0..1 -> 0..30 st |
| OSCILLATORS | SAW + PULSE per osc (additive) | done - polyBLEP saw + pulse switches |
| OSCILLATORS | shared PULSE WIDTH | done - 50%..95% |
| OSCILLATORS | SYNC (OSC 2 -> OSC 1) | done - hard sync |
| FILTER | mixer: OSC 1 / OSC 2 half.full / NOISE | done - button + half/full selector + noise |
| FILTER | FREQUENCY / RESONANCE / MODULATION (env amt) | done |
| FILTER | keyboard TRACK (100% / off) | done - on/off |
| ENVELOPES p.1 | Filter ADSR + Loudness ADSR | done - two full ADSRs |
| p.3 pan pots | per-voice stereo pan | done - Pan Spread knob seats voices across the field |
| AUTO p.7 | auto-tune | out of scope - host concern |
| PROGRAMMER p.5-6 | 32-program cassette/EDIT/WRITE memory | out of scope - host/DAW preset concern |
| CHORD p.7 | HOLD+RESET chord-memory transpose | out of scope |

## Param packing (29 host params, ABI cap 64)

Continuous / discrete knobs occupy indices 0-24. Four switch groups are bit-packed:

| Index | Param | Bits |
|---|---|---|
| 25 | Osc Switch | b0 OSC1 saw, b1 OSC1 pulse, b2 OSC2 saw, b3 OSC2 pulse, b4 SYNC |
| 26 | Mod Switch | b0-1 LFO wave (sine/square/s&h), b2 freq->OSC1, b3 freq->OSC2, b4 freq->FILTER, b5 pw->OSC1, b6 pw->OSC2 |
| 27 | Filt Switch | b0 OSC1 in, b1-2 OSC2 route (off/half/full), b3 NOISE in, b4 keyboard TRACK |
| 28 | Mode Switch | b0 UNISON, b1 HOLD |

The GUI decodes and shows every individual switch.

## Test evidence

- **wasm-runner (test-params.json, 3 s):** `VERDICT: PASS` — **all 29 params `affects`**.
- **wasm-runner (spec.json defaults, 3 s):** `VERDICT: PASS`, rms **0.106**, peak **0.437**
  (target rms >= 0.03, peak 0.15-0.5, peak <= 1).
- **behavior-test.mjs:** **13/13 PASS** — SYNC locks OSC2 to the OSC1 period,
  OSC2 detune beats, cutoff opens brightness, SEM resonance emphasis, SEM stays
  stable at extreme Q, filter-env opens the filter, loudness attack ramps in,
  LFO->filter wobble, unison detune thickens, portamento glides & settles, and
  Pan Spread widens the stereo image.
- **gui-check.mjs:** `PASS` — 0 errors, 29/29 params pushed on ready.

## Signature "tiny bits"

- **SEM 2-pole TPT SVF** with `k = 1/Q` damping — smooth, cutoff-emphasising,
  self-oscillation-resistant (the OB-X character, distinct from a ladder).
- **Hard sync** (OSC 2 phase reset on OSC 1 wrap) and **additive saw+pulse** per osc.
- **Continuous OSC frequency** knobs (per manual p.4, not octave switches).
- **Low-note-priority unison** detuned 8-voice stack with legato handling.
- **Per-voice pan pots** -> stereo Pan Spread (manual p.3), equal-power panning.
- **Mod lever** fades LFO vibrato in over ~0.25 s; **spring-loaded** pitch lever with
  a programmable Bend Range.

## Deviations / simplifications (honest notes)

- The primary manual scan is truncated at p.10; FILTER/OSC/ENV panel details were
  reconstructed from the well-documented OB-X architecture (see *Source manual*).
- **Cross-modulation**: some retrospectives mention an X-MOD switch on the OB-X, but
  it is not documented in the pages available and is not universally attested, so it
  is omitted in favour of the confirmed SYNC. Noted rather than fabricated.
- AUTO auto-tune, the 32-program cassette/EDIT/WRITE programmer memory and the
  HOLD+RESET CHORD-memory transpose are host/DAW/hardware concerns and out of scope.
- Pan is a single programmable **Spread** control rather than eight independent
  hardware pan trimmers, but it reproduces the OB-X's stereo voice image.
