# Additive — modelled on the Kawai K5 (digital additive synthesizer)

A polyphonic **additive (Fourier) synthesizer** whose voice architecture is
modelled on the **Kawai K5 / K5m** (1987), the classic digital additive machine
that lets you vary up to **126 harmonic levels** per voice across two sources.

Plugin name **"Additive"**, slug **`additive`** (unchanged — replaces the old
7-parameter gallery placeholder).

## Documentation read

The manufacturer's Owner's Manual could not be retrieved as a real PDF (the
official `kawaius.com` copy now 404s and the mirror links returned HTML shells).
The voice architecture below was reconstructed **cover to cover** from the two
most detailed period sources plus the manual synopses on ManualsLib / Internet
Archive:

| Source | What it documents |
| --- | --- |
| *Making More Of The Kawai K5* — Sound On Sound, Aug 1990 | DFG pitch env, DHG harmonics + 4 six-stage amplitude envelopes, DHG modulation, grouping (odd/even/octave/fifth, live/die), DDF, DDA, DFT 11-band formant, KS, LFO |
| *Kawai K5 and K5m* — Music Technology, Aug 1987 | Twin/Full modes, 63/126 harmonics, six-stage DFG/DDF envelopes, seven-segment DDA, formant graphic EQ, keyboard scaling |
| ManualsLib "Kawai K5 Owner's Manual" + archive.org listing | Confirms 126 harmonics via bar-graph display, DHG/DDF/DDA block names |

This is the one honest deviation from the "download the PDF" rule — noted openly.
The modelled architecture is faithful to what those sources describe.

## Signal architecture implemented

Genuine additive engine — **two sources (S1/S2), 64 sine partials each**, summed
per sample by a complex-recurrence sine bank (echoing the K5's dual DHG that
spreads 126 harmonics over two halves). The 126 raw harmonic sliders are
replaced by **musical macros** that seed and reshape the harmonic bank:

| K5 section | Implemented as |
| --- | --- |
| **DHG** harmonic levels (0-99 ×126) | PROFILE seed (saw 1/n, square odd-1/n, pulse, triangle, organ octaves, resonant) reshaped by **TILT** (spectral slope), **ODD/EVEN** balance, **DENSITY** (active partial count) |
| **DHG** grouping (odd/even/octave, level angles) | ODD/EVEN macro + TILT slope + PROFILE cover the documented grouping/level-angle operations |
| **DHG** four six-stage amplitude envelopes (spectral morph) | Three **BAND envelopes** (low ≤h8 / mid ≤h24 / high) each with attack+decay; high band decaying faster darkens the tone over the note — the signature K5 morph |
| **DFT** 11-band formant graphic EQ | **FORMANT** emphasis per source: peak harmonic (FREQ), WIDTH, AMOUNT |
| **DDF** dynamic digital filter (cutoff/slope/6-stage env/KS/vel) | Spectral low-pass over the harmonic bank: **CUTOFF, RESO, ENV amount, Env Atk/Dec**, plus global **DDF KeyTrack** |
| **DDA** seven-segment amplitude envelope | **DDA ADSR** per source (Attack/Decay/Sustain/Release) |
| **DFG** pitch generator + six-stage pitch env | **Pitch Env** (bipolar amount + rate), master tune, S2 coarse/detune |
| **LFO** (shape/speed/delay/depth) | **LFO** rate/shape(tri,saw,ramp,square,random)/depth, routable to pitch, spectrum, amp, formant, with key-sync flag |
| Twin / Full mode | **Mode Full/Twin** flag: Full stacks S2 an octave up (upper-harmonic layer, ≈126-partial voice); Twin runs S2 at unison+detune for two-timbre beating |
| Performance | Pitch-bend wheel + range, mod-wheel vibrato, aftertouch (brightens + opens DDF), portamento, volume |

## Parameter packing (62 of 64 host slots)

Per source block (base = src×22, S1=0-21, S2=22-43): Profile · Tilt · Odd/Even ·
Density · Formant Freq/Wid/Amt · Band Lo/Mid/Hi Atk+Dec (6) · DDF Cut/Res/Env/Atk/Dec (5)
· DDA A/D/S/R (4).

Global 44-61: **Mode Flags** (bit-packed: bit0 Full/Twin, bit1 LFO KeySync, bit2
DDF KeyTrack on, bit3 Legato) · S1/S2 Balance · S2 Coarse · S2 Detune · Master
Tune · Portamento · Pitch Env Amt/Rate · LFO Rate/Shape/Depth · **LFO Dest**
(bit-packed: bit0 pitch, bit1 spectrum, bit2 amp, bit3 formant) · DDF KeyTrack ·
Bend Range · Pitch Wheel · Mod Wheel · Aftertouch · Volume.

Two switch groups (Mode Flags, LFO Dest) are bit-packed; the panel decodes every
individual switch. 126 harmonics → macro controls is the deliberate ABI-driven
mapping (a full 126-slider bank cannot fit ≤64 host params).

## Test evidence

- **Compile**: `asc-driver` clean, wasm 18 KB.
- **wasm-runner** (`spec.json`): `VERDICT: PASS`, rms 0.042, peak 0.47, dc≈0, no NaN/clip.
- **wasm-runner** (`test-params.json`, performance state engaged): `VERDICT: PASS`,
  **all 62 params `✓ affects`**, rms 0.033, peak 0.48.
- **behavior-test.mjs** (spectral-centroid / Goertzel assertions) — **9/9 PASS**:
  1. Tilt raises brightness (centroid 2.3→21.9)
  2. Odd/Even changes harmonic content (2nd-harmonic ratio 0→2384)
  3. Formant peak moves energy (centroid 5.5→12.9)
  4. Profile changes timbre (saw 3rd/1st 0.33 vs organ 0.02)
  5. Band envelopes evolve spectrum (early 16.2 → late 13.6)
  6. DDF cutoff sweep brightens (centroid 4.4→9.3)
  7. DDA envelope shapes amplitude (onset rms 0.19 vs 0.02)
  8. S1/S2 detune beats (amp wobble 0.10→0.22)
  9. LFO → pitch vibrato (pitch wobble 0→0.06)
- **gui-check**: `PASS`, 0 errors, 62/62 params pushed on ready.
- GUI includes the mandatory `window.vstai.onParam(...)` host readback in `ready()`
  and the `p.min>=0 && (p.max-p.min)%1===0` integer-snapping guard in `setN`
  (bipolar knobs — Tilt, Odd/Even, DDF Env, Master Tune, Pitch Env, Detune —
  stay smooth; selectors snap).

## Deviations / simplifications (honest)

- **Manual as magazine reviews, not the official PDF** (see above) — the only
  hard-rule deviation; architecture is nonetheless modelled faithfully.
- **126 harmonics → macro controls**: individual per-harmonic levels and the four
  independent DHG envelope *assignments* are compressed into PROFILE + TILT +
  ODD/EVEN + DENSITY + FORMANT (spectrum shape) and three BAND envelopes (spectral
  morph). This is the required ABI mapping, not a full DHG editor.
- **64 partials per source** (not 126). At high notes partials above Nyquist are
  culled. Harmonic amplitudes are recomputed at **control rate** (every 32
  samples) and summed per-sample, keeping 128 partials × 6 voices real-time.
- **DDF/pitch envelopes** are Attack/Decay (+ amount) rather than the K5's full
  six-stage rate/level loops; the DDA is ADSR rather than seven free segments.
- LFO delay/trend, per-partial pitch envelopes, keyboard-scaling *curves* and the
  full 11-band DFT (modelled as a single movable formant) are out of scope.
- Old `factory/plugins/additive-synth/` (the 7-param placeholder) is now
  superseded; this build writes the same gallery slug `additive.vstai`.
