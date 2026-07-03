# Acid Bass

A monophonic squelch-bass synth modelled control-for-control on the **Roland TB-303
Bass Line**, built from a cover-to-cover read of the official *TB-303 Owner's Manual*
(Roland, "Computer Controlled Bass Line", 96 pp — Introduction p.4, Basic Course
p.7-32, TONE CONTROL SECTION p.33-34, sequencer/writing p.9-49, Sound Range Diagram
p.88, Specifications p.89). The TB-303 is "really a small synthesizer control panel"
(manual p.34) fronting a step sequencer; every front-panel control and documented
function is implemented.

- DSP: `assembly.ts` → wasm (8.0 KB). `wasm-runner` sweeps: **`VERDICT: PASS`, all 11
  host params `✓ affects`** (test-params) and PASS with the shipped `spec.json`
  (rms 0.088, peak 0.422 — within the 0.03 / 0.15-0.5 targets, peak ≤ 1).
- Behavior suite (`behavior-test.mjs`): **11/11 PASS** — waveform, cutoff, resonance,
  env-mod, decay, accent (level + brightness), slide glide, sequencer playback, rests.
- GUI: bespoke silver/black TB-303 panel (`gui.html`) — the classic knob row (Tuning,
  Cutoff, Resonance, Env Mod, Decay, Accent, Volume), a Waveform switch, Tempo & Slide
  knobs, Run/Stop, and a 16-step sequencer editor. Headless-Chrome QA: **0 console
  errors**, all 11 params pushed on ready.

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **WAVEFORM** (p.34, spec p.89 `⩘↔⊓`) | ONE oscillator with a 2-position switch: sawtooth or square, both polyBLEP band-limited |
| **TUNING** (p.33; spec ±500 cents) | master tune knob, −1..1 → ±500 cents; clockwise raises pitch |
| **CUT OFF FREQ** (p.34) | signature 18 dB/oct (3-pole) diode-ladder-style resonant low-pass; closing shaves upper harmonics and lowers volume |
| **RESONANCE** (p.34) | ladder feedback + passband makeup; emphasises the cutoff band and pushes toward self-oscillation near max |
| **ENV MOD** (p.34) | depth of the decay envelope sweeping the filter cutoff ("the tone movement of a note") |
| **DECAY** (p.34) | time of the single decay-only envelope; per the manual both the tone **and** the volume fade together (one EG → VCF + VCA) |
| **ACCENT** (p.34) | accent circuit: accented steps boost level, add a fast extra resonant filter sweep (the accent "wow") and accumulate across consecutive accents (short-decay feedback envelope) |
| **VOLUME** (p.8) | output level (VOLUME/POWER knob) |
| **TEMPO** (spec ♩=40-300) | sequencer clock, 40-300 BPM, 16th-note steps |
| **SLIDE / portamento** (p.5, p.39) | fixed-time legato glide from the previous pitch; slid steps do not retrigger the envelope |
| **Pitch / step writing** (p.9-20) | per-step pitch over the 3-octave range (Sound Range Diagram p.88), edited on the panel grid |
| **Length of note, rests, ties** (p.14, p.35-37) | per-step gate; rest steps are silent; slide ties a step to the next with a glide |
| **SEQUENCER: pitch + accent + slide** (p.5 "one complete Bass PATTERN", spec p.89) | up to 16 steps, each storing pitch, ACCENT, SLIDE and rest; recorded live via note events while the WRITE/RECORD bit is set, played back while the RUN/PLAY bit is set |
| **RUN/STOP, PATTERN WRITE/PLAY (MODE)** (p.8, p.16) | Transport parameter: bit0 PLAY (RUN), bit1 WRITE (RECORD); Run/Stop button + live pattern rewrite from the grid |

Global/hardware-only items (battery/backup memory, CV/GATE & SYNC jacks, the 64-pattern
/ 7-track filing system with pattern groups I-IV, DIN-sync clock, and the tune-by-ear TAP
procedure) are host/storage concerns and intentionally out of scope — the *sound and
musical behaviour* of a pattern are fully implemented.

## The 11-param packing

The host pool is fixed at 64 parameters; the 303's tone panel maps to one param per
control, with the transport switches bit-packed into one parameter the GUI decodes.

| Param | Index | Packing / range |
|---|---|---|
| `Waveform` | 0 | 0 sawtooth · 1 square (step 1) |
| `Tuning` | 1 | −1..1 → ±500 cents (bipolar continuous) |
| `Cutoff` | 2 | 0..1 |
| `Resonance` | 3 | 0..1 |
| `Env Mod` | 4 | 0..1 |
| `Decay` | 5 | 0..1 (~30 ms .. ~3.3 s) |
| `Accent` | 6 | 0..1 |
| `Volume` | 7 | 0..1 |
| `Tempo` | 8 | 40..300 BPM |
| `Slide` | 9 | 0..1 → ~6..246 ms glide |
| `Transport` | 10 | bit0 PLAY (RUN) · bit1 WRITE (RECORD) |

**Per-step pattern data** (pitch, accent, slide, rest for up to 16 steps) is *not* a host
parameter — like the hardware's non-volatile pattern memory it lives in the engine and is
written live through note events: `noteOn(-4)` clears the pattern, `noteOn(-2)` writes a
rest, and `noteOn(id, hz)` writes a note whose `id` bit0 = accent and bit1 = slide. The
GUI grid rewrites the whole pattern on any edit; the default pattern is a recognisable
A-minor acid line that auto-plays for the gallery preview.

## Test evidence

- `node factory/tools/wasm-runner.mjs /tmp/acid-bass.wasm --params factory/plugins/acid-bass/test-params.json --seconds 3`
  → `VERDICT: PASS`, all 11 params `✓ affects`.
- `node factory/tools/wasm-runner.mjs /tmp/acid-bass.wasm --params factory/plugins/acid-bass/spec.json --seconds 4`
  → `VERDICT: PASS`, rms 0.088, peak 0.422.
- `node factory/plugins/acid-bass/behavior-test.mjs /tmp/acid-bass.wasm` → **11 passed, 0 failed**.
- `node factory/tools/gui-check.mjs factory/plugins/acid-bass` → `GUI CHECK: PASS`, 0 errors, 11/11 params pushed.

## Deviations / notes

- **Test params prove the sequencer, not live notes.** With `Transport` PLAY set the
  engine ignores live `noteOn`s (the hardware plays only its pattern), so `wasm-runner`'s
  single held test note is ignored and every tone param proves itself against the
  auto-playing default pattern, which deliberately contains accented, slid and rest steps.
- **Single decay envelope.** The real 303 has a fixed VCA decay and a separate DECAY-only
  filter EG; the manual, however, states DECAY changes both the tone *and* the volume
  fade, so one decay-only EG drives both here (matching the documented behaviour).
- **Slide** is a smooth exponential-approach glide whose time follows the `Slide` knob
  (the hardware's slide is a single fixed time); the default lands near the classic ~60 ms.
- Filter self-oscillation is bounded (tanh saturation) so extreme Resonance + Accent stays
  finite and within headroom.
