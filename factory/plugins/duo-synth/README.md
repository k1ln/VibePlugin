# Duo Synth — modelled on the ARP Odyssey

A duophonic (2-voice paraphonic) analog lead/bass synthesizer rebuilt to full
manual fidelity from the **ARP Odyssey Owner's Manual, Second Edition, First
Printing March 1976** (© 1976 ARP Instruments, Inc.). All 58 pages were read
cover to cover — Getting Started (p.4–5), *How Your Odyssey Works* + block
diagram (p.7–9), Sound Sources (waveforms, PWM, phase-sync, noise, FM, p.10–18),
Modifiers (ring mod, VCA, HPF, VCF, p.19–27), Controllers (keyboard/pedals,
ADSR & AR, S&H, LFO, pitch bend, p.28–37), the **Panel Control Description
Chart** (p.39–40) and the **Specifications** (p.55).

The plugin name and slug are unchanged (`Duo Synth` / `duo-synth`). The original
trademark is referenced only as "modelled on…".

## Signature "tiny bits" implemented

- **Duophonic keyboard** — Specifications p.55: *"VCO 1 is low note priority;
  VCO 2 is high note priority."* The keyboard produces two control voltages
  (p.29): the lowest held key drives VCO 1, the highest drives VCO 2, so two
  keys sound as two distinct pitches and a single key locks both oscillators.
  Verified: with two keys held, VCO 2 jumps to the high note (zcr 219→440) while
  VCO 1 stays on the low note (219).
- **Hard SYNC** (p.15) — VCO 2 phase resets on VCO 1 wrap; verified to remove
  detune beating when engaged.
- **Ring modulator** = VCO 1 × VCO 2 (p.20) as the third audio-mixer channel;
  verified to add inharmonic high-frequency sidebands.
- **Sample & Hold** with its own 2-input mixer, LFO- **or** keyboard-clock, an
  output **LAG** slider, and selectable noise/VCO2 second input (p.33–35).
- **The slider + two-position rocker modulation matrix** — the Odyssey's
  signature: each mod amount slider is fed by a source switch (Sine-LFO / S&H /
  ADSR / AR / Kbd). Seven routings modelled.
- **LFO with simultaneous sine + square outputs** (p.36); square edges clock the
  S&H and (via the REPEAT switch) retrigger the envelopes.
- **REPEAT switch** — Kbd gate / Auto-repeat / Kbd-repeat: the LFO retriggers
  the envelopes (Panel Chart p.40).
- **Both envelopes** — ADSR **and** the simpler AR (AR = ADSR with sustain
  pinned at maximum, p.30), each usable as a mod source and to drive the VCA.
- **Self-oscillating 4-pole VCF** (Q to 30, resonance ½→self-oscillate, p.55)
  preceded by a **non-resonant HPF** (p.22).
- **VCA** driven by ADSR / AR / straight GATE (drone) with an initial-**GAIN**
  slider (p.21).
- **PW 50%→5%** and **PWM** (spec: ADSR ±45%, LFO ±15%); **VCO 1 LF mode** that
  also disconnects the keyboard (p.12, 29); white/**pink** noise (p.17);
  **±2-octave TRANSPOSE**, **±1-octave PITCH BEND with a centre dead-zone**
  (p.36), **PPC vibrato depth**, **PORTAMENTO** (built-in last-note memory),
  master **TUNE** and **VOLUME**.

## Manual section → implementation coverage

| Manual section | Implemented |
|---|---|
| Sound Sources: saw / square / pulse / dynamic pulse (p.10–13) | VCO1 & VCO2 saw or square + variable PW (polyBLEP) |
| Pulse-width modulation (p.14, spec ADSR ±45% / LFO ±15%) | PWM1 / PWM2 amount sliders, source Sine or ADSR |
| Phase synchronization (p.15) | VCO2 hard SYNC to VCO1 |
| Noise white/pink (p.17) | Mode-mask noise-colour switch, Kellet pink filter |
| Frequency modulation (p.17–18) | VCO1+2 FM & VCO2 FM sliders (Sine / S&H / ADSR) |
| Ring modulation (p.20) | VCO1×VCO2, third audio-mixer channel |
| VCA + initial gain (p.21) | VCA gain slider + ADSR/AR/GATE mode |
| High-pass filter (p.22) | Non-resonant 2-pole HPF |
| VCF low-pass, resonance to self-osc (p.22–27, spec p.55) | 4-pole ladder, makeup gain, noise-seeded self-osc |
| VCF modulation: LFO / S&H / Kbd / ADSR / AR / pedal (p.24–26) | VCF FM #1 (Sine/S&H), FM #2 (ADSR/AR), Kbd (Kbd/S&H) |
| Keyboard: two CVs, duophonic priority (p.29, p.55) | Low→VCO1, High→VCO2 held-note assignment |
| Portamento + built-in last-note memory (p.29) | Per-oscillator glide from the last note |
| ADSR & AR envelopes (p.30) | Both, retrigger on keystroke / LFO repeat |
| REPEAT switch: Kbd / Auto / Kbd-repeat (p.40) | LFO retriggers the envelopes |
| Sample & Hold: 2-in mixer, LFO/kbd clock, lag (p.33–35) | Full S&H with In1/In2/Lag + clock & in2 switches |
| LFO: sine + square outputs (p.36) | Both outputs; rate 0.1–30 Hz |
| Pitch bend ±1 oct, dead-zone (p.36) | Bipolar bend knob with centre dead-zone |
| Transpose ±2 oct (spec p.55) | 3-position transpose selector |

## Parameter map & packing (40 host params ≤ 64)

Continuous sliders: 0 VCO1 Coarse (±2 oct), 1 VCO1 Fine (±50 c), 2 VCO2 Coarse,
3 VCO2 Fine, 4 Mix VCO1, 5 Mix VCO2, 6 Mix Noise/Ring, 7 LFO Freq, 8 S&H In1,
9 S&H In2, 10 S&H Lag, 11 VCF Cutoff, 12 VCF Reso, 13 HPF Cutoff, 14 VCA Gain,
15–18 ADSR A/D/S/R, 19–20 AR A/R, 21 Portamento, 22 Pitch Bend (bipolar),
23 PPC Vibrato, 24 Master Tune (bipolar), 25 Volume, 26 FM VCO1+2, 27 FM VCO2,
28 PWM VCO1, 29 PWM VCO2, 30 VCF FM1, 31 VCF FM2, 32 VCF Kbd, 33 VCO1 PW,
34 VCO2 PW. Selectors: 37 Transpose (0/1/2), 38 VCA Mode (ADSR/AR/GATE),
39 Repeat (Kbd/Auto/Kbd-rep).

**Bit-packed switch masks** (the GUI decodes every bit into its own rocker):

| Param 35 — **Mode Mask** | bit |
|---|---|
| Noise colour (white / pink) | 0 |
| VCO1 waveform (saw / square) | 1 |
| VCO2 waveform (saw / square) | 2 |
| Audio-mixer ch3 (noise / ring) | 3 |
| VCO1 LF mode (kbd disconnected) | 4 |
| VCO2 sync (off / on) | 5 |
| S&H clock (kbd / LFO) | 6 |
| S&H input 2 (VCO2 / noise) | 7 |

| Param 36 — **Src Mask** (mod-slider two-position source switches) | bit | 0 → | 1 → |
|---|---|---|---|
| FM VCO1+2 | 0 | Sine LFO | S&H |
| FM VCO2 | 1 | Sine LFO | ADSR |
| PWM VCO1 | 2 | Sine LFO | ADSR |
| PWM VCO2 | 3 | Sine LFO | ADSR |
| VCF FM #1 | 4 | Sine LFO | S&H |
| VCF FM #2 | 5 | ADSR | AR |
| VCF Kbd | 6 | Kbd CV | S&H |

## Test evidence

- **wasm-runner** (`test-params.json`, 3 s): `VERDICT: PASS`, **all 40 params
  `✓ affects`**, rms 0.20, peak 0.78, no NaN/clip.
- **wasm-runner** (`spec.json` defaults, 3 s): `VERDICT: PASS`, rms **0.095**
  (≥0.03), peak **0.44** (0.15–0.5), peak ≤ 1.
- **behavior-test.mjs**: **13 / 13 passed** — VCO2 detune beats; SYNC removes
  beating; ring mod audible + inharmonic; VCF cutoff sweep; VCF self-oscillation;
  HPF cuts lows; AR sustains vs ADSR (sus=0) decays; S&H stepped filter mod; LFO
  vibrato pitch wobble; duophonic (VCO2 follows high key, VCO1 stays on low key);
  portamento glide.
- **gui-check**: `GUI CHECK: PASS`, 0 errors, 40/40 params pushed on ready.
  GUI includes the mandatory `window.vstai.onParam` host readback and the
  `p.min >= 0` integer-snapping guard (bipolar faders stay smooth).

## Deviations / simplifications

- The original front-panel silkscreen assigns specific two-position source
  switches to each mod slider; the exact source pair per slider varies by revision
  (Mk I/II/III). The routings here follow the Odyssey convention and cover every
  documented source (Sine, Square via clock, S&H, ADSR, AR, Kbd) and destination
  (VCO pitch, VCO2 pitch, PW, VCF cutoff, VCF key-track). The LFO **square**
  output is used as the S&H clock and the envelope repeat clock rather than as an
  explicit mod-slider source, to keep within a clean 40-param map.
- The rear-panel **pedal / external-audio / interface (CV-GATE-TRIG) jacks** and
  the **Little Brother** slave chaining (p.37–38) are hardware I/O with no plugin
  equivalent and are out of scope. Pedal→VCF control is subsumed by the VCF
  keyboard/S&H slider.
- The Odyssey is inherently 2-voice paraphonic (two keyboard CVs, one filter/VCA);
  it is modelled as such — there is no separate mono/duo switch because the
  hardware has none.
