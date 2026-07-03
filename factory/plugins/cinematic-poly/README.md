# Cinematic Poly

An eight-voice polyphonic analog synthesizer modelled on the **Yamaha CS-80**,
built from a cover-to-cover read of the official *Yamaha CS-80 Polyphonic
Synthesizer Instruction Manual* (58 pp; Sections I-VI, pp.1-52 substantive, the
remaining pages being blank programming diagrams). The manual's control index
[1]-[46] (inside front cover) was used as the completeness checklist.

The CS-80's defining architecture is faithfully reproduced: **every voice is two
independent synthesizer channels (I and II)** — 8 voices × 2 channels = 16 main
VCO/VCF/VCA sound sources, exactly as the hardware — blended by the MIX I-II
balance.

- DSP: `assembly.ts` → wasm (20 KB), `VERDICT: PASS`, **all 64 host params proven
  audibly reactive** by `wasm-runner` (test-params sweep).
- Behavior suite (`behavior-test.mjs`): 9/9 PASS — dual-channel independence,
  HPF & LPF sweeps, the IL-AL-A-D-R filter envelope opening the filter on attack,
  ring-mod inharmonicity, polyphonic aftertouch → brilliance, tremolo/chorus
  stereo width, ribbon pitch bend, and channel-II detune beating.
- GUI: bespoke CS-80 wood-panel layout (`gui.html`) — two channel strips (I / II)
  with VCO / VCF / VCF-EG / VCA sections plus a global performance row; headless-
  Chrome QA: **0 console errors**, all 64 params pushed, 28 clickables verified.

## Manual coverage → implementation

| Manual section (control #) | Implementation |
|---|---|
| **Overall architecture** (p.7,31,41) — two channels I & II per voice, 16 VCO/VCF/VCA | Each voice runs two full independent channels; `MIX I-II` [4] equal-power blend |
| **VCO waveforms** [23][24][25][36] (p.15,32) | Simultaneous polyBLEP sawtooth + variable-width square, white noise, and a pure sine that bypasses the filter — per channel, independent on/off |
| **PW / PWM** [22][21][20] (p.15,32) | Per-channel PW duty (50→90%) and PWM depth, driven by a shared PWM-SPEED sub-oscillator |
| **HPF + RES_H, LPF + RES_L** [26][27][28][29] (p.16,33) | Resonant 2-pole state-variable HPF **then** resonant 2-pole LPF in series, each with own cutoff and Q, per channel |
| **VCF envelope IL-AL-A-D-R** [30-34] (p.20,33) | The CS-80's unique 5-stage filter EG: starts at Initial-Level *below* the steady cutoff, rises to Attack-Level *above* it, decays back to steady, releases to IL — moves both HPF & LPF cutoffs; independent per channel |
| **VCF LEVEL / SINE LEVEL** [35][36] (p.20,35) | Per-channel mix of filtered signal vs. pure sine into the VCA |
| **VCA envelope A-D-S-R + LEVEL** [37-41] (p.18,35) | Standard ADSR amplitude envelope per channel; channel loudness set by MIX |
| **FEET I / II** [5] (p.8) | Six detented footages 16'/8'/5⅓'/4'/2⅔'/2' per channel (semitone offsets −12/0/+7/+12/+19/+24) |
| **DETUNE CH II** [6] (p.8) | Bipolar detune of channel II relative to I |
| **PITCH tune** [18] (p.14) | Master tune ±2 semitones |
| **BRILLIANCE / RESONANCE** [7][8] (p.8,38) | Bipolar global offsets added to both filters' cutoff (brilliance) and Q (resonance) |
| **SUB OSCILLATOR** [11] (p.9,37) | Function select sine/saw/inv-saw/square/noise/ext, SPEED, →VCO (vibrato) and →VCF (wah) depths, applied to all voices |
| **RING MODULATOR** [16] (p.13) | Sub-osc ring modulation of both channels: MODULATION (wet amount), SPEED (1–600 Hz, audio-rate clangor), DEPTH (carrier intensity) |
| **TREMOLO / CHORUS** [15] (p.13) | Stereo phasing effect: CHORUS (slow modulated BBD, L/R opposite) or TREMOLO (faster out-of-phase amplitude mod) — rotary width |
| **PORTAMENTO / GLISSANDO** [14] (p.12) | Glide time; PORTAMENTO (continuous) or GLISSANDO (semitone-stepped) |
| **SUSTAIN** [13] (p.11) | Extends the release up to ~10 s; on/off and mode-II switches |
| **TOUCH RESPONSE — velocity** [12][42][43] (p.10,23,36) | Velocity PITCHBEND (note begins below and slides up) and INITIAL-TOUCH brilliance (harder = brighter) |
| **TOUCH RESPONSE — after-touch** [44][45] + sub-osc-after (p.10,36,38) | Polyphonic AFTER-TOUCH (Pressure) → brilliance, → level, and → VCO (vibrato/pitch) — the CS-80's signature pressure control |
| **RIBBON controller** [19] (p.14) | Velvet pitch ribbon, ±1 octave, spring-to-centre performance lever |
| **VOLUME** [2] (p.6) | Master output level |

Global/hardware-only items intentionally out of scope (host or performance
concerns): the 22 tone-selector **preset patches** [3] and the four **MEMORY**
panels [46] (this plugin *is* the two programmable panels I & II, live-edited);
the **foot-switch / foot-pedal assigners** [17] and rear-panel jacks; and the
**KEYBOARD CONTROL** brilliance/level low-high scaling levers [9][10].

## The 64-param packing

The host pool is fixed at 64 parameters. The CS-80 has ~90 programmable controls
per its two panels plus the global sections. Nothing hardware-defining was
dropped — the two channels are fully independent, and all on/off & mode switches
are bit-packed into one mask parameter (`Osc Switch`) that the GUI decodes into
the individual panel switches:

| `Osc Switch` bit | Switch |
|---|---|
| 0 | Channel I square on |
| 1 | Channel I sawtooth on |
| 2 | Channel II square on |
| 3 | Channel II sawtooth on |
| 4 | Tremolo/Chorus on |
| 5 | Tremolo(1) / Chorus(0) mode |
| 6 | Portamento/Glissando on |
| 7 | Glissando(1) / Portamento(0) mode |
| 8 | Sustain on |
| 9 | Sustain mode II |

Params 0–17 are Channel I's panel, 18–35 are Channel II's identical panel, 36–63
are the global performance & modifier sections (see `spec.json`).

### Deliberate simplifications (to fit 64 host params, all documented)

- **Per-channel VCA LEVEL** [41] is folded into the `MIX I-II` balance (both are
  channel-loudness controls; MIX sets I-vs-II level).
- **PWM SPEED** [20] is one shared global rate; PW duty [22] and PWM depth [21]
  remain fully per channel.
- **Ring-mod ATTACK/DECAY** speed-envelope levers are simplified to a static ring
  SPEED (the MODULATION, SPEED and DEPTH controls are kept).
- **Sub-osc → VCA** tremolo and **INITIAL-TOUCH LEVEL** are covered by the
  Tremolo/Chorus section and the velocity-scaled amplitude envelope respectively.
- Per-note polyphonic pressure is exposed as one global `Pressure` performance
  parameter (the WASM note ABI carries no per-note aftertouch channel).

## Testing note

`wasm-runner` sweeps run against a **test spec** (`test-params.json`) that differs
from the shipped defaults only in performance state: both channels' square+saw
enabled, Ring Mod 0.4, Pressure 0.3, Portamento & Sustain on, PWM depths raised.
Reason: with the faithful shipped defaults — pressure 0, ring off, single channel
waveforms — parameters like `Aft Brill`, `Ring Speed` or `I PW` have nothing to
act on in an automated single-note sweep. Both specs PASS; the test spec
additionally proves **all 64 params reactive**.

Manual title: *Yamaha CS-80 Polyphonic Synthesizer — Instruction Manual*
(no printed version/revision number; 58 pages, all read).
