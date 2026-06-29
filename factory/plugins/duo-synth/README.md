# Duo Synth — duophonic analog lead

**List entry:** Instruments — *ARP Odyssey* (duophonic synth)
**Type:** Instrument (synth) · **Params:** 8 · **Samples:** none (pure algorithm)

## What it is
A two-voice analog lead modelled in the spirit of the classic duophonic synths — without
copying the product. Two sawtooth oscillators independently track the **two most recent held
notes**: the lowest held note drives **OSC 1**, the newest held note drives **OSC 2**, so two
keys sound as two distinct pitches while a single key locks both oscillators together. An
optional **hard-sync** resets OSC 2 to OSC 1 for a buzzy, formant-rich tone. The pair sums into
one shared **resonant 4-pole low-pass** swept by a single ADSR, for a sharp, punchy character.

## Signal flow
```
held-note stack ─► OSC1 (low note) ┐
                                    ├─► mix ─► resonant 4-pole LPF ─► VCA(env·vel) ─► ×Level
held-note stack ─► OSC2 (new note) ┘            ▲ cutoff = base + EnvAmt·env
                   └ hard-sync ──────────────────┘
```

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Detune    | 0–1 | 0.18 | OSC 2 spread, 0 … +12 semitones |
| 1 | Sync      | 0/1 | 0    | hard-sync OSC 2 to OSC 1 (discrete) |
| 2 | Cutoff    | 0–1 | 0.42 | filter base cutoff, 30 Hz … ~11 kHz |
| 3 | Resonance | 0–1 | 0.45 | filter resonance / ring |
| 4 | Env Amt   | 0–1 | 0.60 | how far the envelope opens the filter |
| 5 | Attack    | 0–1 | 0.05 | envelope attack, ~1 ms … ~1.2 s |
| 6 | Release   | 0–1 | 0.30 | envelope release, ~5 ms … ~2 s |
| 7 | Level     | 0–1 | 0.80 | output level |

## GUI
Bespoke self-contained `gui.html` — a slim black-and-gold sci-fi panel with **vertical faders**
(not knobs), twin oscillator lanes with per-voice VU meters and pitch-tracking bars, a live
dual-saw oscilloscope, and a sprung **Sync** toggle. All controls wire to the exact param
indices above via `window.vstai.setParam`; double-click resets, shift drags fine.

## Test result
```
checks: present=true  finite=true  noClip=true  paramsReactive=true
output: rms=0.133  peak=0.492  dc=0.0003  nan=0
all 8 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (duophonic two-note phrase, filter-swept).
