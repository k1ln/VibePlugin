# Fat Mono

A monophonic analog synthesizer modelled **control-for-control on the Moog
Minimoog Model D**, rebuilt at full manual fidelity from a cover-to-cover read
of the official *Minimoog Model D User's Manual, Version 2* (©2022 Moog Music,
84 pp — every page read, including the tuning procedure, Global Settings
power-on command tables, signal-flow diagram and specifications appendix).
The specifications appendix (p.80–81) and the signal-flow diagram (p.52–53)
were used as the completeness checklist: **every front-panel control of the
hardware is implemented** (see coverage table).

- DSP: `assembly.ts` → wasm (13 KB), `VERDICT: PASS`, **all 38 host params
  proven audibly reactive** by `wasm-runner` sweeps (`test-params.json`)
- Behavior suite (`behavior-test.mjs`): **16/16 PASS** — legato single-trigger
  vs multi-trigger, DECAY-switch release on/off, keyboard-control tracking
  amounts (off / 1/3 / full, verified by the self-oscillating ladder's pitch),
  external-input feedback overdrive (level + crest factor), glide slew +
  settle + off, osc-3 KB-off drone, low/high-note priority with return-on-release
- GUI: bespoke Model-D-style panel (`gui.html`) — black panel, cream legends,
  walnut cheeks, orange (mod) / blue (audio) / white (performance) / black
  (source-select) rockers, wheels at the left of the lower panel;
  headless-Chrome QA: **0 console errors**, all 38 params pushed,
  39 controls click-verified

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **Oscillator Bank** (p.16–19) | 3 oscillators; six waveforms each — triangle, triangle-sawtooth hybrid (osc 1&2), **reverse sawtooth on osc 3 only** (p.18), sawtooth, square, wide pulse (~1/3), narrow pulse (~1/10) — polyBLEP band-limited; six ranges LO / 32' / 16' / 8' / 4' / 2' (LO = −6 oct, sub-audio mod source per p.17); osc 2 & 3 FREQUENCY ±7 semitones |
| **OSC. 3 CONTROL** (p.19) | switch off releases osc 3 from keyboard, glide and the mod bus → fixed C2-based pitch × range × frequency knob (drone / free-running mod source) |
| **OSCILLATOR MODULATION** (p.19) | mod bus → pitch of the keyboard-controlled oscillators, riding the mod wheel |
| **Controllers** (p.20–21) | TUNE ±2 semi; OSC. 3/FILTER EG switch, NOISE/LFO switch, MODULATION MIX crossfade; **white noise selected → pink mod noise, pink selected → red mod noise** (p.21) |
| **Left-Hand Panel** (p.22–24) | GLIDE knob (1 ms–10 s **per octave**, fixed-rate, specs p.80) + GLIDE switch; DECAY switch (decay time reused as release; off = abrupt ~4 ms release); LFO RATE 0.05–200 Hz with the push/pull **triangle/square** shape; MOD wheel (0 = down); spring-loaded PITCH wheel, **±7 semitones = a fifth** (p.24) |
| **Keyboard** (p.25, p.47) | low-note priority default, high/last selectable; **multi-trigger vs legato single-trigger** (Global Settings p.47: contours re-fire only after all keys released when multi-trigger is off); release falls back to the remaining priority note |
| **Mixer & Noise** (p.26–27) | Osc 1/2/3, NOISE (white/pink) and EXTERNAL INPUT volumes, each with an on/off rocker; mixer tanh saturation; **no-cable feedback**: main output normalled back into the external input — EXTERNAL INPUT VOLUME × MAIN OUTPUT VOLUME drives the overload (p.27/33/36), OVERLOAD lamp in the GUI |
| **Modifiers — Filter** (p.28–30) | 24 dB/oct transistor-ladder LPF, cutoff −4..+4 ≈ 10 Hz–20 kHz; EMPHASIS self-oscillates near max (sine playable via keyboard tracking, p.29); AMOUNT OF CONTOUR 0–4 octaves (specs p.80); FILTER MODULATION switch; KEYBOARD CONTROL 1 = 1/3, 2 = 2/3, both = full 1 oct/oct tracking (p.30) |
| **Modifiers — Contours** (p.30–31) | Filter + Loudness contours: attack 1 ms–10 s, decay 4 ms–35 s (specs p.80), sustain 0–100%; attack linear, decay/release exponential-approach; DECAY-switch release rule for both contours |
| **Output** (p.32–33) | MAIN OUTPUT VOLUME + MAIN OUTPUT on/off switch; **A-440 reference tuner** mixed into the output when on |
| **Top Patch Panel** (p.34–37, 40) | the reissue's documented performance patches are modelled as routing amounts: VELOCITY → LOUDNESS and AFTER PRESSURE → FILTER (manual p.40 examples), plus an After Pressure performance control; external audio arriving at the host input feeds the EXT. INPUT path |
| **Performance Tips** (p.38–42) | FM effects (osc 3 → osc mod at audio rate), creative switching (per-source mixer rockers), processing external audio all work as described |
| **Specifications** (p.80–81) | ranges used throughout: contour times, LFO 0.05–200 Hz, glide 1 ms–10 s/oct, pitch-bend ±7 semi, filter 24 dB/oct |

Hardware/host-only items intentionally out of scope: MIDI channel/transpose
power-on commands, tuning tables, CV trimpots and jack voltages, phones volume
(duplicate of main volume in a plugin), A-440 trimpot calibration, oscillator
tuning trimpot procedure (p.43–45).

## The param map (38 of 64)

One host param per knob; switch groups bit-packed (GUI shows every rocker):

| Param | Packing |
|---|---|
| `Mod Src Sw` (3) | bit0 OSC.3(0)/FILTER EG(1) · bit1 NOISE(0)/LFO(1) |
| `Osc1/2/3 Range` (4/6/9) | 0 LO · 1 32' · 2 16' · 3 8' · 4 4' · 5 2' |
| `Osc1/2/3 Wave` (5/8/11) | 0 tri · 1 tri-saw (rev-saw on osc 3) · 2 saw · 3 square · 4 wide pulse · 5 narrow pulse |
| `Osc Switch` (12) | bit0 OSCILLATOR MODULATION · bit1 OSC.3 KB CONTROL **off** (panel switch shown inverted) |
| `Mix Switch` (18) | bit0–2 Osc1/2/3 on · bit3 External on · bit4 Noise on · bit5 WHITE(1)/PINK(0) |
| `Filt Switch` (22) | bit0 FILTER MODULATION · bit1 KEYBOARD CONTROL 1 · bit2 KEYBOARD CONTROL 2 |
| `Perf Sw` (30) | bit0 GLIDE · bit1 DECAY · bit2 LFO SQUARE · bit3 MAIN OUTPUT |
| `Key Mode` (31) | priority(0 low/1 high/2 last) + 3×multi-trigger + 6×A-440 (mixed radix; A-440 packed here keeps the group sweep-testable) |

## Test evidence

- `wasm-runner` + `test-params.json` (3 s): `VERDICT: PASS`, rms 0.387,
  peak 0.776, **38/38 `✓ affects`**. The test spec differs from the shipped
  defaults only in performance state (mod wheel 0.5, pitch wheel +0.1,
  pressure 0.4, oscillator+filter modulation on, LFO selected, external input
  + noise engaged, decay switch on) so that wheel/pressure/mod parameters have
  something to act on during an automated single-note sweep.
- `wasm-runner` + `spec.json` (3 s): `VERDICT: PASS`, rms 0.335, peak 0.783
  (mod-bus params are intentionally dormant with the wheels at rest).
- `behavior-test.mjs`: 16/16 PASS (see list above; pitch assertions via
  zero-crossing rate, dynamics via rms windows and crest factor).
- `gui-check.mjs`: `{"errors":[],"paramsPushedOnReady":38,"clickablesClicked":39}` → PASS.

## Honest notes / simplifications

- The mixer overload is a tanh model of the normalled feedback loop, not a
  circuit simulation; it follows the manual's rule that drive scales with
  External Input Volume × Main Output Volume.
- The "different pitches do not sound" full-lockup extreme of the feedback
  loop (manual p.27 critical note) is softened — full drive screams but stays
  bounded.
- LO range is fixed at −6 octaves (hardware LO reaches 0.1 Hz depending on
  the frequency knob; with the ±7-semi knob our osc 3 LO bottoms out ≈ 0.7 Hz).
- Velocity/pressure patch routes are fixed to the two destinations the manual
  demonstrates (velocity→loudness, pressure→filter); the hardware patch bay
  would also allow pitch as a destination.
- Keyboard-tuning-error emulation, MIDI-only global settings and phones
  volume are out of scope (host concerns).
