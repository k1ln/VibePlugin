# KHeverest

An eight-voice, three-oscillator hybrid polysynth modelled **feature-for-feature on the Novation Peak**,
built from a cover-to-cover read of the *Peak User Guide v1.2* (44 pp.). The manual's menu pages, parameter
table, modulation-matrix source/destination tables and the MIDI parameter appendix were the completeness
checklist. The front panel is re-created from the manual's photograph (layout, section frames, LED/button
styling, OLED menu system) with a KHeverest wordmark — no Novation branding or logo is used.

```sh
node factory/kheverest/build.mjs [--pack]      # → factory/plugins/kheverest/{assembly.ts,gui.html,spec.json[,kheverest.vstai]}
node compiler/asc-driver.mjs factory/plugins/kheverest/assembly.ts /tmp/kh.wasm
# tests (all take the compiled wasm):
node factory/kheverest/tests/packing.mjs    /tmp/kh.wasm   # every raw value of all 272 controls + random patches through the host float chain
node factory/kheverest/tests/layers.mjs     /tmp/kh.wasm   # 187 behavioural checks against the manual
node factory/kheverest/tests/reactive.mjs   /tmp/kh.wasm   # every control proven audibly wired (266 + 6 UI-only selectors)
node factory/kheverest/tests/fuzz.mjs       /tmp/kh.wasm 150   # extreme random patches, 22-192 kHz: no NaN, bounded
node factory/kheverest/tests/tune-levels.mjs /tmp/kh.wasm  # loudness-normalise the factory bank (VCA Gain + PATCHLVL)
node factory/kheverest/tests/quality.mjs    /tmp/kh.wasm   # per-preset gate (audible over the keyboard, headroom, DC, release)
node factory/kheverest/tests/gui-roundtrip.mjs             # GUI packing == pack.mjs; host-restore decode
node factory/kheverest/tests/gui-interact.mjs              # every knob/fader/button/OLED page driven in headless Chrome
node factory/tools/persist-check.mjs factory/plugins/kheverest
```

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **Oscillators** (p.17-19) | 3 per voice. Range 16'-2', Coarse ±12 st, Fine ±100 ct, Wave = sine / triangle / saw / pulse / **more**; Shape Amount with the three additive sources (Manual, Mod Env 1, LFO 1): pulse width, sine distortion (+ FM-style / − saturation), triangle→saw skew, saw→square / fold, wavetable position. Vsync (virtual-oscillator hard sync, multiples of 16 = harmonics, BLEP-corrected resets), SawDense + DenseDet, FixedNote, per-osc BendRange (negative reverses), Mod Env 2 and LFO 2 pitch depth with the manual's taper, Diverge, Drift, Noise LPF, KeySync, Tuning Table 0-16 |
| **Wavetables** | 60 named tables from the manual (original recipes, 8 morph frames each) **plus 99 BVKER Custom Wavetables** (imported with `tools/import-wavetables.mjs`) — 159 selectable; band-limited mip-mapped tables built lazily |
| **Mixer** (p.22) | Osc 1-3, Ring 1×2, Noise, VCA Gain, Patch Level (0 = ½, 127 = ×2) |
| **Filter** (p.24) | LP / BP / HP, 12 or 24 dB (ZDF state-variable cascade), resonance, Overdrive (pre-filter), Filter Post Drive, key tracking, Env Depth for **both** Amp Env and Mod Env 1, LFO 1 depth, Osc 3 filter FM, Filter Divergence |
| **Envelopes** (p.22-23) | Amp + 2 Mod envelopes: AHDSR with Hold (0-500 ms), Velocity (±), Legato / Re-Trig, Repeats (looping AHD; Off, 1-30, On) |
| **LFOs** (p.20-21) | LFO 1/2 per voice: triangle / saw / square / S&H, Low (0-200 Hz) / High (0-1.6 kHz) / Sync (35 divisions), Fade Time + FadeIn / FadeOut / GateIn / GateOut, FadeSync, Phase, MonoTrig, Slew, Repeats, Common; LFO 3/4 global with rate sync. Free-running LFOs keep running while a voice is idle |
| **Mod matrix** (p.26-27, 39) | 16 slots × (source A × source B × depth → destination): all **23 sources** and **37 destinations** incl. the six FM/filter-FM routes |
| **Voices** (p.27-29) | Mono / MonoLG / Mono2 / Poly / Poly2, Unison 1/2/3/4/8 with UniDeTune + UniSpread, Glide (time) + PreGlide (±12) |
| **Arpeggiator** (p.29-30, 37) | Up / Down / Up-Down 1 / Up-Down 2 / Played / Random / Chord, 1-6 octaves, Gate, Swing 20-80, 19 sync rates, Key Latch, KeySync, ClockRate 40-240 or host tempo, **33 rhythm patterns** (rests, ties, accents, short notes) |
| **Effects** (p.31-33, 40) | Analogue-style distortion on the voice sum; chorus (3 types, depth, feedback, LP/HP); stereo delay (time or 16 tempo divisions ≤ 1.4 s, feedback, damping, L/R ratio, slew, width); 8-line FDN reverb (time, size, pre-delay, damping, modulation, EQ); 7 routings; wet/dry; **FX modulation matrix** (4 slots, 16 sources, 12 destinations) |
| **Performance** | Animate 1/2 + Hold, mod wheel, pitch wheel, aftertouch, expression pedals 1/2 (CC 11 / 2), CV input (audio input), MIDI CC 1/2/11/114/115/120/123 |
| **Settings** | VelShape, TuneCents, Transpose, VolRange, Initialise (IniPatch / Live) |
| **Panel** | Photographic-layout faceplate, 4×20 OLED with all nine menus and the hardware's pages (OSC 8, ENV 6, LFO 8, ARP/CLOCK 3, MOD 16, VOICE 3, FX 9+4 FX-matrix, SETTINGS), Patch / Bank / Category browser with Initialise / Compare / Audition / Save, Active-Voice LEDs, Source buttons that edit the shared knob exactly like the hardware. Plug-in extras: on-screen keyboard + wheels + pedals drawer (KEYS), full matrix table (MATRIX), computer-keyboard play (A-L, Z/X octave) |

## The 64-slot packing

The host exposes 63 float slots; the Peak has ~400 values. `params.mjs` is the single source of truth: each of
the 272 logical controls is a small integer with its own step count, several share a slot by mixed-radix
packing (product ≤ 2²⁴, exact in float32; the host maps a slot to 0..1 as value/2²⁴). **62 slots** are used.
`pack.mjs` assigns slots; the DSP, GUI and tests all use the same layout. Direct (real DAW-automatable) slots:
**Master Volume, Mod Wheel, Pitch Wheel, Expression 1, Expression 2** — automate everything else through the
matrix sources (ModWheel / ExprPED1 / ExprPED2 / Animate …).

To fit, the Peak's 0-127 knobs that don't need fine steps use 64 steps (GUI still prints 0-127), coarse pitch is in
half-semitones, and some depth knobs have 65-129 steps. Centre-zero controls always have an exact zero.

## Wavetables and licensing

The Peak's 60 wavetable **names** come from the manual; their contents here are original recipes (formants,
drawbars, FM, sync sweeps, combs…). The additional 99 tables are **BVKER – Custom Wavetables** (Analog PWM,
Growl, FM, Distorted, Hyper), imported from the user's copy of the pack, which the project owner confirmed is
free to use. Each is stored as 8 frames × 64 harmonics (sine + cosine, int8). The 128 MB source zip is
git-ignored; to add more packs (e.g. True Cuckoo's) run
`node factory/kheverest/tools/import-wavetables.mjs <zip|folder> [--frame 256]` and rebuild.
Credit: BVKER (bvker.com).

## Honest limits

* **Never auditioned by ear or loaded in a DAW** — verified offline (spectra, pitch, timing, levels), in headless
  Chrome and by the engine tests above. Curves (envelope times, filter, LFO ranges, drive) follow the manual's
  stated ranges and descriptions; they were not A/B-measured against hardware.
* Tuning tables 1-16 are factory alternative tunings; the hardware's per-key Retune Note / Retune Frac editor
  and Scala import are not implemented. Not implemented either: MIDI-channel/pickup/protect/calibration,
  SysEx patch backup/import, pedal polarity/mode, patch category/genre metadata.
* Clock Source defaults to **Auto** (follow host tempo, else ClockRate) — the Init patch's "Internal" is a
  hardware-without-external-clock default.
* Poly aftertouch is not distinguished from channel pressure.
