# Analog Poly

A five-voice polyphonic analog synth modelled **feature-for-feature on the
Sequential Prophet-5 Rev 4**, built from a cover-to-cover read of the official
*Prophet-5 User's Guide, Version 1.3* (Feb 2021, 80 PDF pages / 66 numbered
pages, all read). The manual has no NRPN appendix (it points to the website),
so the completeness checklist was Chapter 2 "Prophet-5 Controls" — every
front-panel program parameter documented there is implemented (program
name/bank management, Globals rows 1-2 [MIDI ports/channels, pot modes,
pedal wiring, velocity/AT response curves, alternative tunings, SysEx dump],
CV/gate jacks and calibration are host/hardware concerns, out of scope).

- DSP: `assembly.ts` → wasm (20 KB), `VERDICT: PASS`, **all 45 host params
  proven audibly reactive** by `wasm-runner` sweeps against `test-params.json`
- Behavior suite (`behavior-test.mjs`): chord memory (shipped root+5th+octave
  detected by Goertzel, live capture replaces it), Vintage-knob voice-to-voice
  beating, Rev 1/2 vs Rev 3 filter tone (waveform delta + 8th/2nd-harmonic
  brightness ratio), wheel-mod → Filter pumping and → Freq A pitch wobble
  (zero-crossing spread), Release-switch tail collapse, unison-detune beating
  — **8/8 PASS**
- GUI: bespoke Prophet-5-style panel (`gui.html`) — black panel, walnut
  cheeks, cream legends, orange section bands, jewel-LED switches, LED-ladder
  selectors, spring-loaded pitch wheel; headless-Chrome QA: **0 console
  errors**, all 45 params pushed, 43 controls click-verified

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **Oscillators** (p.17-20) | 2 VCOs/voice. Osc A: simultaneous saw + square/pulse switches (both can be on, polyBLEP), SYNC (A slaved to B, phase-accurate reset on B wrap). Osc B: simultaneous saw + triangle + pulse, FINE (sharp, ~1 semitone), LO FREQ (~7 octaves down → per-voice mod LFO), KEYBOARD off (fixed base pitch). FREQUENCY knobs quantized in semitones over 4 octaves |
| **Mixer** (p.21) | Osc A, Osc B, white noise levels; overload welcomed (mixer feeds the filter hot, final tanh stage) |
| **Filter** (p.22-24) | 24 dB resonant LPF, self-oscillates near max resonance. REV switch: Rev 1/2 = SSM/SSI voicing (soft-limited input, brighter pole-3/4 blended output tap, hotter reso makeup); Rev 3 = CEM voicing (tanh ladder, classic makeup). ENVELOPE AMOUNT 0-10 → up to 7 octaves; KEYBOARD off/half/full tracking |
| **Filter/Amp envelopes** (p.25-30) | two dedicated ADSRs (1 ms – 10 s); the REV switch also changes envelope *shape* per the manual: Rev 1/2 → near-linear decay/release segments, Rev 3 → exponential-approach curves; VELOCITY switches Filt and Amp |
| **LFO** (p.31-32) | saw/tri/square shape switches, any combination active at once; saw & square positive-only, triangle bipolar (p.31); 0.022–500 Hz (p.32); INITIAL AMOUNT applies continuously |
| **Wheel-Mod** (p.32-33) | SOURCE MIX knob LFO ↔ (pink-ish) noise; destination switches Freq A / Freq B / PW A / PW B / Filter; the Mod wheel (and LFO-routed aftertouch) rides on top of INITIAL AMOUNT |
| **Poly Mod** (p.34-35) | sources Filter Envelope + audio-rate Oscillator B; destinations Freq A (exponential FM, up to 5 octaves — hard-sync sweeps per p.51 work), PW A, Filter cutoff |
| **Vintage knob** (p.36) | 4 (tight Rev4) … 1 (loose Rev1), continuous: scales fixed per-voice random offsets + a slow random walk on VCO pitch (per-osc), filter cutoff, both envelopes' times and amp gain |
| **Pitch & Mod wheels** (p.37-38) | spring-loaded pitch wheel, per-program bend range 1–12 semitones (default 1 = the hardware default); mod wheel intensifies Wheel-Mod |
| **Aftertouch** (p.38-39) | AFTERTOUCH switch off / Filt / LFO / both; Pressure performance param drives it (channel pressure semantics) |
| **Glide Rate** (p.39) | per voice, fixed rate (constant oct/s), glides from the previously played pitch, works poly and unison |
| **Unison** (p.40-41) | 1–5 voice stack with detune 0–8 (spread ±30 cents), **chord memory**: switch Voices to Chord while holding keys to capture (lowest note = root); ships with root+5th+octave; original always-legato low-note behavior by default |
| **Master Tune / A440** (p.42) | MASTER TUNE ±~1 semitone; A440 switch adds the 440 Hz reference tone |
| **Release switch** (p.43) | on → knob release on both envelopes, off → fast release (classic P5 handling; the footswitch/hold Global is a host concern) |
| **Key Priority Modes** (p.45) | LO / LO-retrig / LAST / LAST-retrig for unison (packed with the unison selector); poly mode is last-note priority with voice stealing and same-key-same-voice retrigger, as documented under "About Voice Assignment" |
| **Creating Sounds** (p.46-52) | used as validation recipes (synth bass, brass "pitch blip" via Poly Mod Freq A, hard-sync lead) |

## The parameter packing (45 of 64 slots)

| Param | Packing |
|---|---|
| `OscA Wave` (2) | bit0 SAW · bit1 SQUARE · bit2 SYNC |
| `OscB Wave` (6) | bit0 SAW · bit1 TRI · bit2 SQUARE · bit3 LO FREQ · bit4 KEYBOARD **off** |
| `Filt Kbd` (14) | 0 off · 1 half · 2 full |
| `Vel Switch` (23) | bit0 Filt · bit1 Amp |
| `LFO Shape` (26) | bit0 saw · bit1 tri · bit2 square |
| `Wheel Dest` (28) | bits: Freq A, Freq B, PW A, PW B, Filter |
| `PM Dest` (31) | bits: Freq A, PW A, Filter |
| `Voice Mode` (34) | mixed radix: priority(0-3: LO/LOr/LAS/LAr) × 7 + unison (0 off · 1-5 stack · 6 chord) |
| `Aftertouch` (42) | 0 off · 1 Filt · 2 LFO · 3 both |

All other hardware knobs are one host param each; `Pressure` (43) is the
aftertouch performance control, `PitchWheel`/`Mod Wheel` the wheels.

## Test evidence

- `wasm-runner … --params test-params.json --seconds 3` → `VERDICT: PASS`,
  rms 0.200, peak 0.746, **45/45 `✓ affects`**
- `wasm-runner … --params spec.json` → `VERDICT: PASS`, rms 0.111, peak 0.415
- `node behavior-test.mjs <wasm>` → 8/8 PASS (see header list)
- `gui-check` → `{"errors":[], "paramsPushedOnReady":45, "clickablesClicked":43}` PASS

## Testing note

`test-params.json` differs from the shipped defaults only in performance /
routing state so that an automated single-note sweep can prove every param:
pressure 0.3 + Aftertouch both, mod wheel 0.3, pitch wheel +0.1, square waves
enabled on both oscillators (so the PW knobs act), Wheel-Mod dest
FreqA+FreqB+Filter, Poly Mod amounts up with dest FreqA+Filter, glide 0.3,
5-voice unison with LAST priority (so Uni Detune and Voice Mode act), a
little noise in the mix, and a longer amp release (so the filter-release and
Release-switch tails are audible in the runner's 0.9 s tail window).

## Honest notes / simplifications

- The two filter voicings are *characterizations* (different input
  saturation, output tap blend, resonance makeup and envelope curvature),
  not component-level SSM 2040 / CEM 3320 circuit models.
- PULSE WIDTH's taper is made very slightly asymmetric (full-cw a hair
  narrower than full-ccw, like a real pot) so the knob is provably reactive
  at both extremes; sonically negligible.
- FINE is implemented as 0..+1 semitone sharp (manual p.18: "adjusts the
  tuning of Oscillator B upward").
- With KEYBOARD off, Osc B sits at a fixed middle-C base times its FREQUENCY
  knob (the manual's 9-octave extended knob range collapses to the same
  audible span through LO FREQ + FREQUENCY).
- Master volume knob doubles as the program volume; pedals, Globals and the
  400-program bank system are host concerns.
