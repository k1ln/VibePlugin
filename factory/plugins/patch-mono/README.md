# Patch Mono

A semi-modular monophonic synthesizer modelled **behaviour-for-behaviour on the
Korg MS-20**, built from a cover-to-cover read of the official *Korg MS-20 Owners
Manual* (13 pp: introduction/connection p.1-4, block & signal-flow charts
p.4-6, **Features and functions** p.7-9, patch panel & caution p.10-11,
**Specifications** p.11, panel diagram p.13). Every front-panel control and every
documented patch-panel behaviour is implemented. The name/slug stay **Patch Mono**
/ `patch-mono` (never the trademark).

- DSP: `assembly.ts` → wasm (14.6 KB), `wasm-runner` **VERDICT: PASS**, **all 52
  host params proven audibly reactive** (test-params sweep); spec-defaults render
  rms 0.086, peak 0.463 (target rms ≥ 0.03, peak 0.15–0.5).
- Behaviour suite (`behavior-test.mjs`): **13/13 PASS** — see below.
- GUI: bespoke MS-20-livery panel (`gui.html`), headless-Chrome QA
  **0 console errors**, 52/52 params pushed on ready, 16 clickables verified.

## Manual coverage → implementation

| Manual section (page) | Implementation |
|---|---|
| **VCO-1** (p.7) | SCALE 32'/16'/8'/4' octave selector; WAVE FORM Triangle / Sawtooth (polyBLEP) / Rectangle / White-noise; PW knob narrows the rectangle from square (50%) toward silence |
| **VCO-2** (p.7) | SCALE 16'/8'/4'/2'; WAVE FORM Sawtooth / Square / narrow Pulse / **Ring modulator** (VCO1 × VCO2); PITCH ±1 octave detune (beats against VCO-1) |
| **VCO MIXER** (p.7) | Independent VCO-1 / VCO-2 level knobs |
| **MASTER TUNE / PORTAMENTO** (p.7-8) | Master tune ±1 semitone (both VCOs, per manual); portamento glide time |
| **VC HIGH-PASS FILTER** (p.8) | Resonant 2-pole (Korg-35 / Sallen-Key) HPF; CUTOFF (0 = open, no low cut) + PEAK; **self-oscillates** at max PEAK |
| **VC LOW-PASS FILTER** (p.8) | Resonant 2-pole LPF **in series after the HPF**; CUTOFF + PEAK; **self-oscillates** at max PEAK |
| **FREQUENCY MODULATION** (p.8) | MG/T.EXT and EG1/EXT amount knobs → VCO pitch |
| **CUTOFF FREQUENCY MODULATION** (p.8) | MG/T.EXT and EG2/EXT amounts, **independently for the HPF and the LPF** (4 knobs) |
| **VCA** (p.9) | Controlled by EG2 (+ external initial gain via the patch bay's VCA destination) |
| **MODULATION GENERATOR (MG)** (p.9) | LFO 0.1–30 Hz; WAVE FORM morph falling-ramp → triangle → rising-ramp (triangle output) plus a rectangle output; triangle is normalled to the FM/cutoff-mod knobs, rectangle clocks the S&H |
| **ENVELOPE GENERATOR 1 (EG1)** (p.9) | DELAY / ATTACK / RELEASE — holds at peak while gated (special-purpose modulation env), routed to pitch and available as a patch source |
| **ENVELOPE GENERATOR 2 (EG2)** (p.9) | HOLD / ATTACK / DECAY / SUSTAIN / RELEASE; HOLD extends the trigger after key-up; drives the VCA and the filter mod |
| **SAMPLE & HOLD** (p.10) | White noise sampled on the MG rectangle rising edge; a patch-bay source |
| **EXTERNAL SIGNAL PROCESSOR (ESP)** (p.10-11) | Band-pass pre-amp (LOW CUT / HIGH CUT) + LEVEL mixes into the signal path; envelope follower (THRESHOLD) → ESP-Env source; frequency-to-voltage pitch converter (CV ADJUST) → ESP-Pitch source. Input is **normalled to the internal signal** so it is always live (see deviations) |
| **PATCH PANEL** (p.10) | Compact **4-cord routing matrix**: each cord = Source → Destination + Amount, read every sample by the engine (see packing) |
| **Manual controllers / CONTROL WHEEL** (p.10) | Programmable wheel with dedicated →Pitch and →LPF sensitivity; also a patch source |
| **Keyboard** (p.11) | Monophonic, last-note priority; keyboard CV tracking available as a patch source (KBD CV) |

Hardware-only / host items — patch-cord jack impedances/voltages, external audio
input hardware, footswitch, MS-10/SQ-10 CV interconnection, power — are host
concerns and out of scope.

## The 52-param map & patch-bay representation

52 continuous/discrete host params (≤ 64 ABI cap). Nothing was dropped. Rather
than one host param per physical jack (the MS-20 has ~40 jacks), the sonically
important re-patchings are modelled as a **4-cord matrix**; the always-normalled
routings (MG→pitch, EG1→pitch, MG/EG2→HPF, MG/EG2→LPF, EG2→VCA) keep their own
dedicated amount knobs exactly as the panel does.

| Params | Section |
|---|---|
| 0-3 | VCO-1: Wave (0 tri/1 saw/2 rect/3 noise), PW, Scale (0 32'…3 4'), Level |
| 4-7 | VCO-2: Wave (0 saw/1 sq/2 pulse/3 ring), Pitch (±1 oct), Scale (0 16'…3 2'), Level |
| 8-9 | Master Tune (±1 semi), Portamento |
| 10-11 | Freq-mod to pitch: MG amount, EG1 amount |
| 12-15 | HPF: Cutoff, Peak, MG-mod, EG2-mod |
| 16-19 | LPF: Cutoff, Peak, MG-mod, EG2-mod |
| 20 | VCA EG2 amount |
| 21-22 | MG: Frequency, Wave-morph |
| 23-25 | EG1: Delay, Attack, Release |
| 26-30 | EG2: Hold, Attack, Decay, Sustain, Release |
| 31 | Volume |
| 32-34 | Control Wheel + →Pitch + →LPF sensitivity |
| 35-39 | ESP: Level, Low Cut, High Cut, Threshold, CV Adjust |
| 40-51 | Patch bay ×4 cords, each: **Source (0-10)**, **Dest (0-7)**, **Amount** |

Patch **sources** (0-10): OFF, MG-tri, MG-rect, EG1, EG2, S&H, Noise, Wheel,
Kbd-CV, ESP-Env, ESP-Pitch. Patch **destinations** (0-7): OFF, Pitch (both VCOs),
VCO-2 Pitch, PW, HPF cutoff, LPF cutoff, VCA gain, MG rate. The GUI renders the
cords as a green jack-field deck with ◀▶ source/dest steppers and an amount knob.

## Test evidence

`wasm-runner` (test-params sweep, 3 s): **VERDICT PASS**, **52/52 `✓ affects`**,
rms 0.139 peak 0.513. Spec-defaults render: rms 0.086 peak 0.463 (in target).

`behavior-test.mjs` — 13/13 PASS:
1. VCO-1 waveforms differ (saw has richer highs than triangle)
2. VCO-1 noise is broadband (high zero-cross rate)
3. VCO-2 detune beats against VCO-1 (amplitude modulation)
4. HPF removes low-frequency energy
5. LPF removes high-frequency energy
6. LPF self-oscillates with no VCO input at max PEAK
7. HPF self-oscillates with no VCO input at max PEAK
8. EG2 attack shapes the VCA onset
9. EG2 release lengthens the tail
10. EG1 delay postpones the pitch envelope
11. MG modulates the LPF cutoff (adds LFO wobble)
12. Patch cord MG→LPF changes the sound vs unpatched
13. Portamento glides pitch between notes

`gui-check`: `{ errors:[], paramsPushedOnReady:52, paramsTotal:52,
clickablesClicked:16 }` → **GUI CHECK: PASS**. Screenshot verified: clean MS-20
livery, no overlaps.

GUI conformance: `gui.html` includes the mandatory `window.vstai.onParam(...)`
host readback inside `ready()`, and the bipolar-safe integer-snapping guard
`if (p.min >= 0 && p.max-p.min >= 2 && (p.max-p.min)%1===0) v = Math.round(v)`
(so VCO-2 Pitch and Master Tune stay smooth while selectors snap).

## Deviations / simplifications (honest notes)

- **ESP input is internally normalled to the synth's own signal** rather than a
  live external audio input, so the band-pass pre-amp, envelope follower and
  frequency-to-voltage converter are always exercised (an instrument plugin has
  no guaranteed external audio feed). The controls behave faithfully; only the
  input source differs.
- **LPF cutoff polarity**: the scanned manual text for the LPF reads "0 = open"
  (contradicting its own description and every other MS-20 reference); this build
  uses the conventional 0 = closed / 10 = open so the CUTOFF knob is musically
  correct. HPF is 0 = open (no low cut) per the manual.
- **EG1 → pitch is positive-going** (raises pitch as the envelope rises) for
  musical usefulness; the hardware's EG1 normal output is negative (−5→0 V).
- The **patch panel is a 4-cord matrix** (not one param per physical jack); the
  MVCA "delayed-vibrato" nuance is approximated via the EG1/Wheel modulation
  paths. Filters are the MS-20's 2-pole (−12 dB/oct) resonant Korg-35 topology.
- Master Tune is ±1 semitone per the *Features* text (the spec column's wider
  figure is ambiguous in the scan).
