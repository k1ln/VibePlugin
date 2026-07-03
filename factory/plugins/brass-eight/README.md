# Brass Eight

An eight-voice, sixteen-oscillator polyphonic analog synth modelled **control-for-control
on the Oberheim OB-Xa**, built from a cover-to-cover read of the official
*OB-Xa Polyphonic Synthesizer Owner's Manual, Third Edition, April 1982*
(Oberheim Electronics; 35 PDF pages / 27 numbered content pages). Every front-panel
program control the manual documents is implemented; the panel is bit-packed into
27 host parameters and the GUI decodes every individual switch.

- DSP: `assembly.ts` → wasm (16.8 KB), `VERDICT: PASS`, **all 27 host params proven
  audibly reactive** by `wasm-runner` sweeps (rms 0.10–0.12, peak 0.32–0.46, no clip).
- Behavior suite (`behavior-test.mjs`): **13/13 assertions PASS** — 2-pole vs 4-pole
  brightness (signature), OSC-2 sync, OSC-2 detune beats, cutoff sweep, resonance
  emphasis, filter-env opening, loudness ADSR, LFO→filter wobble, F-ENV→OSC-2 pitch,
  unison beating, portamento glide up/settle/off.
- GUI: bespoke OB-Xa blue/black panel (`gui.html`) — headless-Chrome QA:
  **0 console errors**, all 27 params pushed, 35 controls click-verified.

## Manual coverage → implementation

| Manual section (page) | Implementation |
|---|---|
| **What's Inside** (p.5, voice diagram) | 8 voices, each 2 VCOs + a 2-pole AND a 4-pole LPF (selectable) + 2 ADSRs + VCA; pink noise source |
| **Manual / Control — HOLD** (p.7) | HOLD latch (sustains held notes indefinitely; re-latches on new press) |
| **Control — PORTAMENTO** (p.8) | polyphonic glide, rate knob; LINEAR/QUANTIZED select; OFFSET (per-voice rate spread / "clustering") |
| **Control — UNISON** (p.8) | all 8 voices sound one key, **low-note priority**, detuned ~±24 c stack |
| **Control — OSC 2 DETUNE** (p.8) | bipolar ±50 cents, flat (CCW) or sharp (CW) of OSC 1 |
| **Modulation / LFO** (p.9) | RATE ~0.1–20 Hz; SINE / SQUARE / S&H waveform select |
| **Modulation — FREQUENCY** (p.9) | LFO freq DEPTH routable to OSC 1 / OSC 2 / FILTER |
| **Modulation — PULSE WIDTH** (p.10) | LFO PW DEPTH routable to OSC 1 / OSC 2 |
| **Oscillators — OSC 1** (p.10) | octave FREQUENCY (16'/8'/4'/2'), independent SAW + PULSE switches (summed, polyBLEP) |
| **Oscillators — PULSE WIDTH** (p.10) | shared duty for both oscillators, 50% square (CCW) → thin/nasal (CW) |
| **Oscillators — SYNC** (p.10) | OSC 2 hard-slaved to OSC 1 (locks to a harmonic; OSC-2 freq becomes timbral) |
| **Oscillators — F-ENV** (p.10/12) | Filter Envelope modulates OSC 2 pitch; amount = filter MODULATION, up to +1 octave |
| **Oscillators — OSC 2** (p.10) | coarse FREQUENCY (5-oct, half-step quantized), SAW + PULSE switches |
| **Filter** (p.11) | FREQUENCY, RESONANCE (raises level 2-pole / lowers 4-pole), MODULATION (filter-env amount) |
| **Filter — source select** (p.11) | OSC 1 / OSC 2 (HALF ≈ −5 dB or FULL) / NOISE routed into the filter |
| **Filter — 4-POLE** (p.11) | **signature** 2-pole (12 dB/oct, brighter) vs 4-pole (24 dB/oct, fuller) ladder select |
| **Filter — TRACK** (p.11) | keyboard control voltage adds to filter frequency |
| **Envelopes — Filter ADSR** (p.12) | four-stage ADSR: A 1 ms–5 s, D/R 1 ms–10 s |
| **Envelopes — Loudness ADSR** (p.12) | second ADSR drives the VCA loudness contour |
| **Modulation Panel — MOD lever** (p.16) | fades LFO vibrato in on top of the programmed freq DEPTH |
| **Modulation Panel — PITCH BEND** (p.17) | bipolar bend lever; OSC-2-ONLY switch, NARROW (±whole step) vs wide (±octave) |
| **Modulation Panel — TRANSPOSE** (p.17) | master DOWN / NORMAL / UP one octave |
| **Setting Up — MASTER TUNE / VOLUME** (p.2) | ±50 cent master tune, program volume |

Global / hardware-only items — **auto-tune**, SPLIT / DOUBLE dual-keyboard modes,
BALANCE, chord-memory transposition, cassette & 120-program patch memory, pan pots,
voice-kill DIP switches, foot pedals — are host/hardware concerns and are intentionally
out of scope (single Whole-mode patch). See "Deviations" below.

## The 27-param packing

The panel's continuous knobs are one host param each; the on/off and N-way switch
groups are bit-packed into four mask params and the GUI decodes each bit back into its
individual panel switch:

| Param (index) | Packing |
|---|---|
| `Osc Switch` (3) | b0 OSC1 SAW · b1 OSC1 PULSE · b2 OSC2 SAW · b3 OSC2 PULSE · b4 SYNC · b5 F-ENV |
| `Mod Switch` (4) | b0–1 LFO wave (Sin/Squ/S&H) · b2 freq→OSC1 · b3 freq→OSC2 · b4 freq→FILTER · b5 PW→OSC1 · b6 PW→OSC2 |
| `Filt Switch` (9) | b0 OSC1→filter · b1–2 OSC2 route (Off/Half/Full) · b3 NOISE · b4 4-POLE · b5 TRACK |
| `Mode Switch` (22) | b0 UNISON · b1 bend OSC2-only · b2 bend NARROW · b3–4 TRANSPOSE (Down/Norm/Up) · b5 porta QUANTIZED · b6 porta OFFSET · b7 HOLD |

The remaining 23 params are continuous knobs/sliders (LFO rate & depths, OSC1 octave,
OSC2 freq/detune, pulse width, cutoff/reso/mod, two ADSRs, portamento, bender,
mod lever, master tune, volume).

## Test evidence

- `wasm-runner … --params test-params.json` → **VERDICT: PASS**, every param `✓ affects`
  (test spec engages the LFO routings + depths, both pulse waveforms, unison, bender,
  mod lever, portamento and master tune so each control proves itself in a single-note
  sweep). `wasm-runner … --params spec.json` also PASS with musical levels.
- `behavior-test.mjs` → **13 passed, 0 failed**.
- `gui-check.mjs` → `GUI CHECK: PASS` (0 errors, 27/27 params pushed, 35 clickables).

## Deviations / simplifications (honest notes)

- **SPLIT / DOUBLE** dual-keyboard modes and the **BALANCE** control are omitted — this
  is a single 8-voice Whole-mode patch (they require two independent patch memories,
  a host concern).
- **Auto-tune** and the 120-program **cassette/patch-memory** system are host/hardware
  concerns and not modelled.
- **CHORD-memory transposition** (holding a chord then transposing it by playing low-C
  intervals) is not implemented; the underlying HOLD latch is.
- The three per-group hardware LFOs are collapsed to one global LFO; the separate
  performance-panel LFO is folded into the main LFO, with the **MOD lever** adding
  vibrato depth on top of the programmed FREQUENCY DEPTH.
- PORTAMENTO **QUANTIZED** mode is exposed as a switch; the audible glide is modelled
  as linear (with the OFFSET per-voice spread), matching the manual's clustering note.
