# Nova Six

A six-voice programmable polyphonic analog synthesizer modelled **control-for-control
on the Roland Juno-106**, built from a cover-to-cover read of the official
*Roland Juno-106 Owner's Manual* (Roland Corporation, 32 pp — the panel diagram on
p.3 and the Specifications table on p.32 were used as the completeness checklist).
Every front-panel control the manual documents is implemented.

- DSP: `assembly.ts` → wasm (17 KB), `VERDICT: PASS`, **all 32 host params proven
  audibly reactive** by `wasm-runner` sweeps (test spec with performance state engaged)
- Behavior suite (`behavior-test.mjs`): **14/14 pass** — chorus I/II/I+II stereo width
  and beating, sub-osc low-end, PWM LFO-vs-manual movement, HPF position order,
  VCF env-polarity flip, LFO-delay ramp, VCA env-vs-gate attack, portamento glide
- GUI: bespoke Juno-style slider panel (`gui.html`) with the colour-striped sections;
  headless-Chrome QA: **0 console errors**, 32 params pushed on ready, 24 controls
  click-verified

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **DCO** (p.16-17) | One DCO/voice emitting **sawtooth and variable-width pulse simultaneously** (independent on/off switches, polyBLEP band-limited); square **SUB** one octave down; white **NOISE**; **16'/8'/4' RANGE** selector |
| **PWM** (p.16-17) | **PWM MODE** switch: MANUAL (PW knob sets width, 50 %→5 %) or LFO (the LFO modulates width, knob sets depth); harmonic behaviour per the waveform table |
| **HPF** (p.18) | 4-position non-resonant high-pass: 0 = low **boost** (organ bass), 1 = flat/bypass, 2 & 3 = progressively higher cut of the lows |
| **VCF** (p.18-19) | Resonant 4-pole ladder low-pass, **self-oscillates at max RES**; FREQ cutoff, **ENV amount + its +/- POLARITY switch** (reverse ADSR), **LFO amount**, **0-100 % KEY FOLLOW** |
| **VCA** (p.20) | **CONTROL-SIGNAL switch ENV / GATE** (ADSR-shaped vs organ on/off) and a **LEVEL** knob |
| **ENV** (p.20-21) | One **ADSR** (A 1.5 ms-3 s, D/R 1.5 ms-12 s, S 0-100 %) shared by the VCF and, in ENV mode, the VCA — the shared-envelope Juno architecture |
| **LFO** (p.21) | Triangle, 0.1-30 Hz, with a **DELAY** that fades it in after a fresh note; routes to DCO pitch (vibrato), pulse width (in LFO PWM mode) and the VCF |
| **Chorus** (p.29) | Stereo bucket-brigade chorus, all three positions — **I**, **II** (faster/deeper) and **both I+II** (two modulators beating) — as out-of-phase modulated delay lines |
| **Controllers** (p.23) | **PORTAMENTO** time + on/off switch; the **bend lever** with independent **DCO** (up to ±1 octave) and **VCF** bend-sensitivity knobs; **forward-push LFO vibrato** with its own depth knob |
| **Assign mode** (p.22) | **POLY 1** (multi-trigger), **POLY 2** (legato / portamento) and **SOLO** (6-voice unison stack) |
| **Key Transpose** (p.24) | ±1 octave transpose selector |
| **Keyboard / polyphony** (p.22) | Real **6-voice** polyphony with oldest-note voice stealing |

Global/hardware-only items — the 128-patch memory (banks A/B, Manual/Write, Bank-Group
selector, Program display), the tape SAVE/VERIFY/LOAD interface, MIDI (channel, bus,
function switch I/II/III, SysEx), the patch-shift/hold pedal jacks and A-440 tuning — are
host/DAW concerns and intentionally out of scope for the sound engine.

## The 32-param map

Well under the 64-param ABI cap; one switch group is bit-packed and the GUI decodes it
into the individual panel switches.

| Param | Packing / range |
|---|---|
| `DCO Range` (6) | 0 = 16' · 1 = 8' · 2 = 4' |
| `DCO Wave` (7) | **bit0 Pulse on · bit1 Saw on · bit2 PWM mode LFO(1)/MAN(0)** |
| `HPF Freq` (8) | 0 boost · 1 flat · 2 · 3 (4-position) |
| `VCF Pol` (14) | 0 = + · 1 = − (reverse envelope) |
| `VCA Mode` (15) | 0 = ENV · 1 = GATE |
| `Chorus` (21) | **bit0 I · bit1 II** → 0 off / 1 I / 2 II / 3 I+II |
| `Assign` (22) | 0 Poly 1 · 1 Poly 2 · 2 Solo |
| `Porta Sw` (24) | 0 off · 1 on |
| `Transpose` (25) | 0 −1 oct · 1 normal · 2 +1 oct |

The remaining 22 params are one-per-slider continuous controls (LFO Rate/Delay, DCO
LFO/PWM/Sub/Noise, VCF Freq/Reso/Env/LFO/Kybd, VCA Level, ADSR, Porta Time, DCO/VCF/LFO
bend sens, Bender lever, Mod-push, Volume).

## Test evidence

- `wasm-runner … --params test-params.json --seconds 3` → **VERDICT: PASS**, every one of
  the 32 params `✓ affects` (rms 0.072, peak 0.269).
- `wasm-runner … --params spec.json` (shipped defaults) → **PASS**, rms 0.112, peak 0.346
  (within the rms ≥ 0.03 / peak 0.15-0.5 target); `preview.wav` rendered from these.
- `behavior-test.mjs` → **14 passed, 0 failed**.
- `gui-check.mjs` → **GUI CHECK: PASS**, 0 errors, 32 params pushed, 24 controls clicked.

## Testing note

The `wasm-runner` all-params sweep uses `test-params.json`, which differs from the shipped
defaults only in **performance state**: the bend lever off-centre (0.15), forward mod-push
0.4, portamento on, noise/sub raised and a mid HPF/wave setting. Reason: with the lever
centred and portamento off — the shipped, faithful defaults — parameters like *DCO Bend*,
*VCF Bend*, *LFO Bend* and *Porta Time* have nothing to act on during an automated
single-note sweep. Both specs PASS; the test spec additionally proves all 32 params reactive.

## Honest notes / simplifications

- **Poly 1 vs Poly 2**: modelled as multi-trigger (Poly 1) vs legato / portamento-glide
  (Poly 2). The hardware's finer distinction — Poly 2 letting the *last* released note ring
  its natural release while Poly 1 truncates a stolen voice — is approximated rather than
  bit-exact.
- **Chorus**: a faithful two-LFO stereo BBD model (rates ≈ 0.51 / 0.86 Hz, I+II beats), not
  a component-level emulation of the MN3009 bucket brigades or their companding noise.
- **Chorus I+II**: the original Owner's Manual text states I and II cannot be engaged at
  once, but the actual hardware *does* produce a distinct, richer sound when both buttons
  are pressed (a widely-used Juno trick). It is modelled here per the request, exposed as
  pressing both the I and II panel buttons.
- The 4-pole VCF uses a tanh-saturated ladder with passband makeup gain so patches aren't
  whisper-quiet; it self-oscillates near maximum resonance as the manual describes but its
  self-oscillation pitch is not laboratory-accurate (the manual itself warns the real VCF's
  self-oscillation pitch is unstable, p.18).
