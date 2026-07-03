# Seer Six

A six-voice polyphonic analog synth modelled **feature-for-feature on the Sequential
Prophet-6**, built from a cover-to-cover read of the official *Prophet-6 Operation
Manual v2.1* (Feb 2021, 88 pp). The NRPN program-parameter table in Appendix C was
used as the completeness checklist: **every program parameter of the hardware is
implemented** (name/sequence-step storage excepted — the sequence is recorded live).

- DSP: `assembly.ts` → wasm (38 KB), `VERDICT: PASS`, **all 64 host params proven
  audibly reactive** by `wasm-runner` sweeps
- Behavior suite (scratchpad `behavior-test.mjs`): sequencer record → rest → tie →
  play, rest-step silence, Rec+Play key transpose (pitch verified via zero-crossing
  rate), Hold-latched arpeggio, chord memory, worst-case extremes finite & bounded
- GUI: bespoke Prophet-style panel (`gui.html`) — 45 knobs, 34 LED buttons,
  11 LED-ladder selectors, spring-loaded pitch wheel; headless-Chrome QA:
  **0 console errors**, all 64 params pushed, every control click-verified

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **Oscillators** (p.17) | 2 VCOs/voice; FREQUENCY in quantized semitones over 5 octaves; continuously-variable SHAPE tri→saw→pulse (polyBLEP); PULSE WIDTH square at centre → narrow at both extremes; osc 2 FINE ±50 cents; SYNC (osc 1 slaved to osc 2); osc 2 LOW FREQ (−7 oct) and KEYBOARD off switches |
| **Slop** (p.20) | per-voice per-osc slow random-walk detune, subtle → wildly out of tune (~75 cents) |
| **Mixer** (p.21) | Osc 1, Osc 2, Sub Octave (triangle −1 oct off osc 1), white Noise |
| **Filters** (p.22) | 4-pole resonant LPF (ladder, self-oscillates near max reso) → 2-pole resonant HPF (SVF); per-filter bipolar ENV AMOUNT, VELOCITY switch, KEYBOARD off/half(quarter-tone)/full tracking |
| **Filter/Amp envelopes** (p.24–27) | two independent ADSRs; VCA ENV AMOUNT (0 = gated-VCA organ trick works: LFO→Amp is additive); amp VELOCITY switch |
| **Effects** (p.28–33) | A: bbd (dark, saturating), ddl, chorus, phaser 1/2 (6-stage hi/lo-res), phaser 3 (8-stage), ring mod (Par 2 ≥ ½ = low-note pitch tracking), flanger 1/2; B adds hall/room/plate (time + early-reflection taps) and spring (decay + tone); per-effect TYPE/MIX/P1/P2, CLOCK SYNC with the manual's ≤1 s halving rule, ON/OFF true bypass |
| **LFO** (p.34) | tri & random bipolar, saw/rev-saw/square positive-only (manual p.34), hidden **noise** shape (Random + FREQUENCY full cw), INITIAL AMOUNT, clock SYNC, destinations Freq 1 / Freq 2 / PW 1+2 / Amp / LPF / HPF |
| **Poly Mod** (p.36) | sources Filter Env + Osc 2 (audio-rate, bipolar amounts); destinations Freq 1 (exp FM), Shape 1, PW 1, LPF, HPF |
| **Arpeggiator** (p.38) | Up / Down / Up+Down / Random / Assign, 1–3 octaves, BPM 30–250, ten clock values incl. dotted, swing and triplet; HOLD auto-latch & relatch; sequencer playback disables the arp (p.41) |
| **Sequencer** (p.41) | 64 steps × up to 6 notes, rests + ties, records velocity; Record restarts the sequence; play-along; Rec+Play = key transpose around middle C; GUI Rest/Tie buttons send marker events (noteOn id −2/−3) |
| **Distortion** (p.48) | stereo analog-style drive, character follows program harmonics |
| **Hold / Glide** (p.49) | Hold latch; glide modes Fixed Rate / Fixed Rate A (legato) / Fixed Time / Fixed Time A, polyphonic, glides from the last played pitch |
| **Unison** (p.50) | 1–6-voice stack, **chord memory** (switch to Chd while holding a chord to capture it; ships with root+5th+octave), detune via Slop; key assign LO / LO-retrig / HI / HI-retrig / LAST / LAST-retrig with proper single/multi-trigger envelopes |
| **Pitch & Mod wheels** (p.57) | spring-loaded pitch wheel, range 0–12 semitones; mod wheel adds LFO amount on top of INITIAL AMOUNT |
| **Misc params** (p.58) | Pan Spread (per-voice alternating spread), Program Volume |
| **Aftertouch** (p.59) | Pressure control × bipolar AMOUNT → Freq 1 / Freq 2 / LFO AMT (negative totals invert the waveform, p.61) / Amp / LPF / HPF |

Global/hardware-only items (MIDI ports, pot modes, calibration, poly chain,
alternative tunings, program banks) are host concerns and intentionally out of scope.

## The 64-param packing

The host pool is fixed at 64 parameters; the Prophet-6 has ~89. Nothing was dropped —
switch groups are bit-packed and the GUI decodes them into the individual panel
switches:

| Param | Packing |
|---|---|
| `Osc Switch` (3) | bit0 SYNC · bit1 OSC2 LOW FREQ · bit2 OSC2 KEYBOARD **off** |
| `Glide Mode` (14) | bit0 on · bits1-2 mode (FR/FRA/FT/FTA) |
| `Key Track` (21) | LPF(0–2) + 3 × HPF(0–2) |
| `Vel Route` (22) | bit0 LPF vel · bit1 HPF vel · bit2 VCA vel |
| `LFO Dest` (36) | bits: Freq1, Freq2, PW1+2, Amp, LPF, HPF |
| `PM Dest` (39) | bits: Freq1, Shape1, PW1, LPF, HPF |
| `AT Dest` (41) | bits: Freq1, Freq2, LFO Amt, Amp, LPF, HPF |
| `FX Mode` (43) | bit0 FX on · bit1 sync A · bit2 sync B |
| `Unison` (53) | 0 off · 1–6 stack size · 7 chord memory |
| `Transport` (56) | bit0 arp on · bit1 hold · bit2 seq record · bit3 seq play |
| `Arp Patt` (57) | mode(0–4) + 5 × octave-range(0–2) |

## Testing note

`wasm-runner` sweeps run against a **test spec** (scratchpad `test-params.json`) that
differs from the shipped defaults only in performance state: Pressure 0.25, pitch
wheel +0.1, arp on, glide on. Reason: with the wheels centred and no pressure —
the shipped, faithful defaults — parameters like *Bend Range* and *AT Amount* have
nothing to act on during an automated single-note sweep. Both specs PASS; the test
spec additionally proves all 64 params reactive.
