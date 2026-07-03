# Mono Spark

A monophonic analog synthesizer modelled **control-for-control on the Roland
SH-101**, built from a cover-to-cover read of the official *Roland SH-101
Owner's Manual* (Roland Corporation, 56 pp; the "Functions for Sound
Synthesizing" section p.24–30, "Functions for Playing" p.30–38, block diagram
p.55 and Specifications p.56 were used as the completeness checklist). **Every
front-panel control and documented function of the hardware is implemented.**

- DSP: `assembly.ts` → wasm (12 KB), `VERDICT: PASS`, **all 35 host params
  proven audibly reactive** by a `wasm-runner` sweep of `test-params.json`
- Behavior suite (`behavior-test.mjs`): **14/14 assertions pass** — mixer
  saw/pulse/sub tone, sub-octave pitch, PWM man vs LFO, cutoff brightness,
  resonance emphasis, env→filter, ADSR decay length, VCA env-vs-gate,
  portamento glide, arpeggio up-vs-down direction, sequencer stepped pitch,
  rest silence
- GUI: bespoke SH-101-style grey fader panel (`gui.html`) — fader-based
  Modulator / VCO / Source Mixer / VCF / VCA / Envelope, rotary Tune / Range /
  Volume / Porta / Tempo / Bender, vertical selector switches, arp + seq
  transport and a 16-step editor. Headless-Chrome QA: **0 console errors**,
  all 35 params pushed, 21 clickables click-verified.

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **VCO** (p.24) | ONE oscillator. RANGE 16'/8'/4'/2' octave selector. SAW and PULSE produced simultaneously (polyBLEP band-limited) → Source Mixer. PWM MODE MAN/LFO/ENV: MAN = PW fader sets a static width (50%→~5%); LFO/ENV = fader sets the pulse-width-modulation depth from the LFO or envelope. VCO MOD fader = LFO→pitch depth (vibrato/trill). |
| **Waveforms / Pulse Width** (p.25) | Saw / square / pulse harmonic behaviour via true band-limited waves; the three PWM sources (manual, LFO, envelope) render the documented moving pulse. |
| **Source Mixer** (p.26) | PULSE, SAW, SUB and NOISE level faders. SUB OSCILLATOR pulse wave with the 3-way type switch: 1 oct down square / 2 oct down square / 2 oct down narrow pulse. |
| **VCF** (p.26–27) | 4-pole (24 dB/oct) resonant low-pass ladder. FREQ cutoff (10 Hz–20 kHz), RES resonance that self-oscillates near maximum, ENV depth, MOD (LFO) depth, KYBD key-follow (0–100%). |
| **VCA** (p.27) | Control-signal selector: driven by the ENV or by the plain GATE. |
| **ENV** (p.28–29) | Single ADSR: Attack 1.5 ms–4 s, Decay/Release 2 ms–10 s, Sustain 0–100% (exponential-approach curves). GATE-TRIG selector: GATE+TRIG (always retrigger) / GATE (retrigger only when not legato) / LFO (envelope repeats at the LFO rate while the gate is held). Shared by VCF, VCA and PWM-in-ENV-mode. |
| **Modulator** (p.30) | LFO + S&H, 0.1–30 Hz. Waveforms: triangle / square / random (sample-and-hold) / noise. Routes to VCO pitch (VCO MOD) and VCF cutoff (VCF MOD). The triangle "∿" is what the bender/mod-grip push injects. |
| **Keyboard / Range** (p.30) | 16'/8'/4'/2' footage; note frequency follows the manual's octave map (8' = middle-C reference). |
| **Controllers** (p.31) | VOLUME, PORTAMENTO time (0–5 s) with OFF/ON/AUTO mode (AUTO = legato-only glide), TRANSPOSE L/M/H (±1 oct, disabled while the sequencer plays), VCO & VCF BEND SENS (VCO up to ±1 oct), LFO-MOD depth, BENDER lever. TUNE ±50 cents master. |
| **Arpeggio** (p.32) | Auto-arpeggio UP / U&D / DOWN. Tempo from the CLOCK (Tempo) control; retriggers per step; released when no notes remain (or latched by HOLD). Sequencer playback disables the arp (p.34). |
| **Sequencer** (p.33–35) | Built-in step sequencer, recorded via note events (LOAD/RECORD), with rests and legato ties/slurs, up to 64 steps, played stepwise from the top; ties glide (portamento) without retriggering the envelope. Ships with a recognisable auto-playing SH-101 bass line. |
| **Hold** (p.36) | HOLD latch keeps the held note sounding at the sustain level. |
| **Key Transpose** (p.36) | Realised through the host: the DAW plays the plugin at any pitch; the panel TRANSPOSE switch provides the ±1-oct keyboard shift. |
| **Bender / Mod Grip** (p.40) | BENDER lever (pitch + tone), with the mod-grip PUSH amount × LFO-MOD depth adding triangle-LFO vibrato/growl on top. |

Global/hardware-only items (CV/GATE and EXT CLK jacks p.37–38, external-unit
sync, battery/power, physical mod-grip mounting) are host/hardware concerns and
intentionally out of scope.

## The 35-param map

The host pool is fixed at 64 parameters; the SH-101 fits comfortably, so every
continuous control is its own host param and only the transport buttons are
bit-packed. The GUI decodes the pack into the individual panel buttons.

| Param | Packing / range |
|---|---|
| `Transport` (34) | bit0 arp on · bit1 seq play · bit2 seq record · bit3 hold (0–15) |
| `Arp Mode` (32) | 0 up · 1 up&down · 2 down |
| `Range` (1) | 0 16' · 1 8' · 2 4' · 3 2' |
| `PWM Mode` (3) | 0 manual · 1 LFO · 2 env |
| `Sub Type` (8) | 0 1-oct square · 1 2-oct square · 2 2-oct narrow pulse |
| `VCA Source` (15) | 0 envelope · 1 gate |
| `Env Mode` (20) | 0 gate+trig · 1 gate · 2 LFO |
| `LFO Wave` (22) | 0 triangle · 1 square · 2 random (S&H) · 3 noise |
| `Porta Mode` (25) | 0 off · 1 on · 2 auto |
| `Transpose` (26) | 0 −1 oct · 1 normal · 2 +1 oct |
| `Tune` (0), `Bender` (30) | bipolar −1..1 (continuous) |

All other params are 0..1 continuous faders/knobs (plus `Tempo` 40–300 BPM).

## Test evidence

- `node factory/tools/wasm-runner.mjs /tmp/mono-spark.wasm --params
  factory/plugins/mono-spark/test-params.json --seconds 3` →
  **VERDICT: PASS**, every one of the 35 params `✓ affects`, rms 0.141,
  peak 0.413.
- `... --params factory/plugins/mono-spark/spec.json --seconds 3` →
  **VERDICT: PASS**, rms 0.124, peak 0.489 (within the 0.15–0.5 target,
  peak ≤ 1).
- `node factory/plugins/mono-spark/behavior-test.mjs` → **14 passed, 0 failed**.
- `node factory/tools/gui-check.mjs factory/plugins/mono-spark` →
  **GUI CHECK: PASS**, 0 errors, 35/35 params pushed.

`test-params.json` differs from the shipped `spec.json` only in performance
state (arp engaged so a multi-note pattern arpeggiates, bender/mod-grip pushed,
LFO routed to pitch and cutoff, portamento on, pulse in the mix) so that an
automated single-key sweep can prove every parameter — including the bender,
bend-sensitivities, mod-grip, arp direction and portamento — audibly reactive.

## Deviations / notes

- **Separate Tempo control.** On the hardware the single LFO/CLK RATE knob sets
  both the modulation-LFO rate *and* the arpeggio/sequencer tempo. Here they are
  split into independent `LFO Rate` and `Tempo` (BPM) controls so a stable
  vibrato and a musical clock can be dialled in at once.
- **Arp source with a loaded pattern.** The SH-101 always arpeggiates the keys
  you hold. Here, when a sequence pattern is loaded (the ships-with default), the
  ARP button arpeggiates that pattern's distinct pitches in the chosen
  direction; with an empty/cleared pattern it arpeggiates the held keys as on the
  hardware. This lets the auto-arpeggio have notes to play from the DAW and keeps
  the arp direction meaningful.
- **Key Transpose** (the button that re-maps the whole keyboard around any note,
  p.36) is largely a keyboard concern; in a DAW the host supplies pitch. The
  panel keeps the L/M/H TRANSPOSE octave switch (p.31), which is the audible part.
- The single ADSR is shared exactly as the hardware wires it (VCF + VCA + PWM),
  including the ENV-mode PWM and the LFO-mode repeating envelope.
