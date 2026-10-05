# Doob

A monophonic analog synthesizer modelled **feature-for-feature on the Moog Minimoog Model D**, built from the original
*Minimoog Operation Manual* (Moog Music, 1971), R. J. Folkman's *Technical Service Manual* with the factory schematics
(block diagram, contour generator, keyboard / glide circuit, filter, oscillator and noise boards, mod-mix amplifier,
waveform-switching network) and the documented behaviour of the 2016 / 2022 reissues (LFO, filter-contour mod source,
key priority, multi-trigger, scales, bend range). The panel is re-created in the original layout — CONTROLLERS · OSCILLATOR
BANK · MIXER · MODIFIERS · OUTPUT, black faceplate, white lettering, left-hand wheels, 44-key F…C keyboard — with a **Doob**
wordmark; no Moog logo is used.

```sh
node factory/doob/build.mjs [--pack]         # → factory/plugins/doob/{assembly.ts,gui.html,spec.json[,doob.vstai]}
factory/doob/tools/make.sh /tmp/doob.wasm    # build + compile
factory/doob/tests/all.sh /tmp/doob.wasm     # everything below
# tests take the wasm via DOOB_WASM=... or as the first .wasm argument:
node factory/doob/tests/voice.mjs     # 93 checks: oscillators, waveforms, mixer, noise, ladder, keyboard control, contours, modulation, output
node factory/doob/tests/behavior.mjs  # 25 checks: key priority, S/H, single / multi trigger, glide, scales, key error, drift, bleed
node factory/doob/tests/midi.mjs      # 18 checks: CC1(+33), pitch bend, RPN 0, CC120/122/123, panic marker, host-vs-CC precedence
node factory/doob/tests/reactive.mjs  # every one of the 57 controls proven audibly wired
node factory/doob/tests/packing.mjs   # every raw value of every control round-trips through the host float chain
node factory/doob/tests/rates.mjs     # pitch / cutoff / contour time / glide at 7 sample rates (22-192 kHz)
node factory/doob/tests/quality.mjs   # every factory sound audible, non-clipping, no DC (35 sounds)
node factory/doob/tests/fuzz.mjs      # 120 extreme random patches at 22-192 kHz: finite, within ±1
node factory/doob/tests/tune-levels.mjs   # loudness-normalise the factory sounds → presets.levels.json
node factory/doob/tests/gui-roundtrip.mjs # GUI packing == pack.mjs (headless Chrome); host-restore decode
node factory/doob/tests/gui-interact.mjs  # every knob / rotary / rocker / wheel / key, every sound loaded, no page errors
node factory/tools/persist-check.mjs factory/plugins/doob
node factory/doob/tools/shot.mjs out.png --preset "Moog Bass"   # screenshot of any sound
```

## What is modelled

| Section | Implementation |
|---|---|
| **Oscillators** | Three VCOs, ranges **LO / 32' / 16' / 8' / 4' / 2'** (8' = concert pitch with the bottom F at MIDI 41 = 87.307 Hz; 1 V/oct on the keys). Waveforms: triangle, **shark tooth** (0.824 triangle + 0.176 saw — the 10 K / 47 K waveform-network mix), sawtooth, square, wide rectangle (≈ 33 %), narrow rectangle (≈ 17 %); oscillator 3 has a **reverse sawtooth** instead of the shark tooth. Band-limited by 32-tap Kaiser-windowed-sinc step / ramp tables (alias floor < −50 dB at 1.7 kHz). TUNE ±4 st over all three, OSC 2 / 3 FREQUENCY ±7 st; **OSC 3 CONTROL off** detaches it from the keys (FREQUENCY then sweeps 6 octaves — LFO / drone); **LO** is sub-audio (2.7 Hz at the bottom F). Slow analog **drift** and oscillator-to-oscillator **bleed** are options |
| **Mixer** | Five sources — OSC 1, EXTERNAL INPUT, OSC 2, NOISE, OSC 3 — each a switch + a linear level knob, summed **at the filter input where the sum overloads** (soft-clip stage ahead of the ladder: the fat Minimoog sound). Noise: white / pink (and red as the modulation noise). **External input** = the host audio input through a ×8 microphone preamp with a soft clip and the **OVERLOAD lamp**; the OUTPUT → EXT IN feedback mod is a switch |
| **Filter** | 4-pole −24 dB/oct Moog transistor ladder (zero-delay-feedback, exact cutoff, saturating input and feedback path), mixer + ladder **2× oversampled** (47-tap half-band). CUTOFF −5 … +5 = ten octaves with **440 Hz at −1**; EMPHASIS is an audio-taper pot with **regeneration from 7.5** and a clean self-oscillating sine at 10 that tracks the keyboard when both **KEYBOARD CONTROL** switches are on (1 = ⅓, 2 = ⅔, both = full); passband thinning with emphasis; AMOUNT OF CONTOUR up to ≈ 8.5 octaves |
| **Contours** | Two RC generators (filter, loudness): attack charges a 10 µF cap through the audio-taper pot toward a level above the peak (→ concave rise), decay discharges toward a negative rail and is clamped at SUSTAIN (exponential fall), release is the **DECAY switch** (off: ~5 ms, on: the decay time). Attack 0.001 … 9 s (filter) / 14 s (loudness), decay 0.001 … 30 s. Re-triggers attack from the **current level** and the peak creeps up a little when played fast. The S-TRIG plug holds both contours at SUSTAIN |
| **Keyboard** | 44 keys; **low-note priority**, **sample-and-hold** pitch (the release tail stays at the last key), **single trigger** (overlapped keys do not retrigger). Reissue options: HIGH / LAST priority, MULTI trigger, Pythagorean (C) / super-just / **Partch 43-tone** scales (43 keys = 1 octave), vintage resistor-string key error. **GLIDE** = exponential approach with τ up to ≈ 2.2 s (≈ 10 s to settle) |
| **Modulation** | MODULATION MIX pans between OSC 3 (left) and noise (right) through a 25 K pot into 24 K resistors; the **MOD wheel is an audio-taper level** (half travel ≈ 10 %); OSCILLATOR MODULATION and FILTER MODULATION switches route ±1 octave at full wheel. Reissue: source A = OSC 3 or the filter contour, source B = noise or a dedicated LFO (0.1 – 30 Hz, triangle / square) |
| **Output** | Audio-taper VOLUME, MAIN OUTPUT switch, **A-440** Wien-bridge reference (sine + a little 2nd / 3rd harmonic) after the loudness VCA, soft knee clip, DC blocker |
| **MIDI** | Notes F1 … C6 (41 … 84; others extend the 1 V/oct scale); CC1 (+CC33 LSB) mod wheel; pitch bend; RPN 0 bend range (default 7 semitones — the Model D's "half an octave"); CC64 sustain (host); CC120 / 122 / 123 |
| **Host** | All 25 knobs and wheels are **direct** host parameters (real automation); the other 32 switches / settings are mixed-radix packed into the remaining slots — 27 of 63 slots in all. Sound persists across DAW close / reopen |

## Assumptions (not in the sources, chosen to be plausible)

- **Pulse widths** 33 % / 17 % for the wide / narrow rectangle (the service manual gives the network, not the duty cycles).
- **TUNE range** ±4 semitones; **pitch-bend range** 7 semitones (adjustable 1 – 12; the original's wheel is "about half an octave").
- **Mixer** knobs are linear; the overload ceiling and the ×8 preamp gain are tuned by ear-plausible measurement, not by schematic simulation.
- **Modulation depth** ±1 octave at full MOD wheel for both pitch and filter; the noise mod uses the next colour down (pink / red).
- **Filter passband loss** and the emphasis droop at low cutoffs are tuned to look like a ladder, not extracted from the schematic.
- **Scale tables:** Pythagorean and Partch are exact ratios; the "super-just" 12-note set is a best-effort reconstruction; the key-error random walk is deterministic (±1 cent per step).
- Never auditioned by ear against a real Minimoog and not loaded in a DAW here; all checks are measurement-based.
