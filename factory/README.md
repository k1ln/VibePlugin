# Plugin Factory

Working through [../docs/modeling-targets.md](../docs/modeling-targets.md) — building one
original VibePlugin (`.vstai`) per entry, with a **new descriptive name** (never the
trademarked original), each compiled to wasm and **verified to pass audio** before it counts
as done.

## Pipeline (per plugin)
1. Author DSP in `plugins/<slug>/assembly.ts` (VibePlugin WASM ABI).
2. Compile → wasm via `compiler/asc-driver.mjs`.
3. **Test** with `tools/wasm-runner.mjs` — confirms sound passes, output is finite,
   non-clipping, and every parameter actually changes the audio. Renders a **clean musical**
   `preview.wav` (plucked riff for effects, melody for synths — no analysis noise).
4. Pack with `tools/pack-vstai.mjs`, which:
   - compiles + base64s the wasm,
   - generates a **stunning themeable GUI** (rotary knobs, glow, per-plugin accent),
   - writes the name-based `plugins/<slug>/<slug>.vstai`,
   - **deploys a copy to `docs/gallery/data/`** (then `scripts/build-gallery.mjs` rebuilds the catalogue),
   - emits a standalone **`test.html`** bench.
5. Document in `plugins/<slug>/README.md`; cross the entry off the list.

Each plugin folder ends up with: `assembly.ts`, `spec.json`, `<name>.vstai`, `preview.wav`,
`test.html`, `README.md`.

## Distinct names + GUI
Every plugin gets a **distinct, descriptive, non-generic name** (the packer refuses empty /
placeholder names). The name is the `.vstai` filename, the gallery title, and — on export —
hashes to a unique VST3 class id, so plugins never collapse into one "generic plugin".
The GUI is custom and themed per plugin (accent colour in `spec.theme`).

## Test bench (`test.html`)
Open `plugins/<slug>/test.html` straight from `file://`. It loads the compiled wasm, runs
**real audio** through it via Web Audio, and embeds the live GUI:
- **Effects:** play a built-in musical riff, your **microphone**, or a **dropped audio file**.
- **Synths:** an on-screen + computer-key (A–K) **keyboard**.
Turn the knobs and hear the parameters change in real time.

## Tools
- `tools/wasm-runner.mjs` — offline test device for a compiled `.wasm`. Feeds a broadband
  test bed (effects) or MIDI notes (synths), sweeps every param, prints PASS/FAIL, writes a
  clean musical WAV.
- `tools/pack-vstai.mjs` — compiles `assembly.ts` + `spec.json` → `.vstai` + GUI + gallery copy
  + `test.html`.

## Samples / impulse responses
The `format:1` `.vstai` has no sample field, so any required audio (drum hits, single-cycle
waves, impulse responses for convolution/plate/spring, Mellotron tape notes) is sourced from
**free/CC0/public-domain** libraries and **embedded directly into the AssemblyScript module**
as static data, keeping each `.vstai` self-contained. Algorithmic units (most reverbs, delays,
modulation, drive, dynamics, EQ, analog-modelled synths & drums) need no samples.

## Build queue (best-first, then fill the rest)
Densely-documented, real-time-friendly targets first; the autonomous loop builds the next
unchecked row each pass. After this list, fall back to category order for the remaining entries.

1. ✅ Lexicon 224 → **Vast Hall** (kicked off the reverb work)
2. ✅ Lexicon 480L → **Shimmer Hall**
3. ✅ TS808 Tube Screamer (Eff#43) → **Emerald Overdrive**
4. ✅ UA 1176 (Eff#60) → **FET Squeeze**
5. ✅ Teletronix LA-2A (Eff#59) → **Opto Glow**
6. ✅ Pultec EQP-1A (Eff#73) → **Velvet EQ**
7. ✅ Big Muff Pi (Eff#46) → **Mammoth Fuzz**
8. ✅ ProCo RAT (Eff#45) → **Grit Distortion**
9. ✅ Boss DS-1 (Eff#44) → **Crunch Distortion**
10. ✅ Moog ladder filter (Eff#78) → **Ladder Filter**
11. ✅ Roland Juno chorus (Eff#31) → **Lush Chorus**
12. ✅ EHX Memory Man / BBD (Eff#18) → **Bucket Echo**
13. ✅ Leslie 122 (Eff#37) → **Rotary Cabinet**
14. ✅ Spring tank (Eff#7) → **Spring Verb**
15. ✅ Dattorro plate / EMT140 (Eff#10/#3) → **Steel Plate**
16. ✅ Minimoog Model D (Syn#1) → **Fat Mono**
17. ✅ TB-303 (Syn#11) → **Acid Bass**
18. ✅ Prophet-5 (Syn#29) → **Analog Poly**
19. ✅ Yamaha DX7 (Syn#51) → **FM Tines**
20. ✅ Korg MS-20 (Syn#63) → **Patch Mono**
21. ✅ TR-808 (Syn#12) → **Voltage Drums**
22. TR-909 (Syn#13) → drum machine (hats = samples)

## Progress

### Effects
| # | Original | → New name | Status |
|---|----------|-----------|--------|
| 1 | Lexicon 224 (digital hall) | **Vast Hall** | ✅ PASS |
| 2 | Lexicon 480L (digital hall) | **Shimmer Hall** | ✅ PASS |
| 43 | Ibanez TS808 Tube Screamer (overdrive) | **Emerald Overdrive** | ✅ PASS |
| 60 | Universal Audio 1176 (FET comp) | **FET Squeeze** | ✅ PASS |
| 59 | Teletronix LA-2A (opto comp) | **Opto Glow** | ✅ PASS |
| 73 | Pultec EQP-1A (passive program EQ) | **Velvet EQ** | ✅ PASS |
| 46 | Big Muff Pi (fuzz) | **Mammoth Fuzz** | ✅ PASS |
| 45 | ProCo RAT (distortion) | **Grit Distortion** | ✅ PASS |
| 44 | Boss DS-1 (distortion) | **Crunch Distortion** | ✅ PASS |
| 78 | Moog ladder filter (resonant LPF) | **Ladder Filter** | ✅ PASS |
| 31 | Roland Juno chorus (BBD chorus) | **Lush Chorus** | ✅ PASS |
| 18 | Electro-Harmonix Memory Man (BBD analog delay) | **Bucket Echo** | ✅ PASS |
| 37 | Leslie 122 rotary speaker (rotary) | **Rotary Cabinet** | ✅ PASS |
| 7 | Spring reverb (generic 2/3-spring tank) (spring reverb) | **Spring Verb** | ✅ PASS |
| 10 | Dattorro plate (1997 paper) (plate reverb) | **Steel Plate** | ✅ PASS |
| 9 | Freeverb (Algorithmic) | **Open Room** | ✅ PASS |
| 27 | MXR Phase 90 (Phaser) | **Sweep Phaser** | ✅ PASS |
| 33 | Electric Mistress (flanger) | **Jet Flanger** | ✅ PASS |
| 47 | Fuzz Face (fuzz) | **Germanium Fuzz** | ✅ PASS |
| 58 | Bitcrusher / sample-rate reducer (lo-fi bitcrusher + decimator) (Digital) | **Bit Crusher** | ✅ PASS |
| 55 | Tape saturation model (Saturation) | **Reel Saturator** | ✅ PASS |
| 15 | Roland RE-201 (tape echo) | **Space Tape Echo** | ✅ PASS |
| 26 | Multi-tap / ping-pong delay | **Ping Delay** | ✅ PASS |
| 36 | Uni-Vibe (vibe/phaser) | **Vibe Phaser** | ✅ PASS |
| 42 | Optical/bias tremolo | **Bias Tremolo** | ✅ PASS |
| 50 | Klon Centaur (overdrive) | **Mythic Drive** | ✅ PASS |
| 61 | dbx 160 (VCA comp) | **Punch Comp** | ✅ PASS |
| 74 | Neve 1073 (console EQ) | **Console EQ** | ✅ PASS |
| 94 | Roland ring modulator | **Ring Mod** | ✅ PASS |
| 4 | EMT 250 (early-digital reverb) | **Pearl Reverb** | ✅ PASS |
| 17 | Binson Echorec (multi-head magnetic-drum echo) | **Magnetic Echo** | ✅ PASS |
| 29 | Mu-Tron Bi-Phase (dual phaser) | **Twin Phaser** | ✅ PASS |
| 39 | Roland Dimension D (SDD-320) (dimensional BBD chorus) | **Dimensional** | ✅ PASS |
| 53 | Octavia (octave-up fuzz) | **Octave Up** | ✅ PASS |
| 69 | Brickwall limiter (look-ahead) (look-ahead brickwall limiter) | **Brickwall** | ✅ PASS |
| 82 | Cry Baby wah (inductor wah / auto-wah) | **Vocal Wah** | ✅ PASS |
| 86 | Tilt EQ / baxandall shelf (tilt / baxandall EQ) | **Tilt EQ** | ✅ PASS |
| 71 | Noise gate / expander (noise gate / expander) | **Noise Gate** | ✅ PASS |
| 57 | Wavefolder (West Coast) (west-coast wavefolder) | **Wave Folder** | ✅ PASS |
| 81 | State-variable filter (Chamberlin) (multimode state-variable filter) | **State Filter** | ✅ PASS |
| 72 | De-esser (de-esser) | **De-Esser** | ✅ PASS |
| 96 | Aphex Aural Exciter (harmonic exciter) | **Air Exciter** | ✅ PASS |
| 100 | Granular delay/cloud processor (granular cloud processor) | **Granular Cloud** | ✅ PASS |
| 84 | Vocal formant filter (vowel/formant filter) | **Vowel Filter** | ✅ PASS |
| 85 | Linkwitz-Riley crossover (multiband crossover) | **Crossover** | ✅ PASS |
| 87 | Eventide H910 Harmonizer (pitch shifter / harmonizer) | **Pitch Shifter** | ✅ PASS |
| 64 | Fairchild 670 (vari-mu tube compressor) | **Vari-Mu** | ✅ PASS |
| 80 | MS-20 Sallen-Key filter (aggressive resonant HP+LP filter) | **Scream Filter** | ✅ PASS |
| 95 | Frequency shifter (Bode/single-sideband) (Bode single-sideband frequency shifter) | **Freq Shifter** | ✅ PASS |
| 79 | Roland TB-303 filter (acid envelope filter) | **Squelch Filter** | ✅ PASS |
| 90 | DigiTech Whammy (extreme pitch-shift pedal) | **Whammy** | ✅ PASS |
| 93 | Vocoder (channel, EMS-style) (channel vocoder) | **Robot Voice** | ✅ PASS |
| 97 | BBE Sonic Maximizer (psychoacoustic phase + clarity enhancer) | **Sonic Max** | ✅ PASS |
| 20 | TC Electronic 2290 (pristine digital delay) | **Studio Delay** | ✅ PASS |
| 62 | SSL bus compressor (VCA bus compressor) | **Bus Glue** | ✅ PASS |
| 70 | Multiband compressor (multiband compressor) | **Multiband** | ✅ PASS |
| 75 | API 550A (discrete proportional-Q console EQ) | **Discrete EQ** | ✅ PASS |

### Synths
| # | Original | → New name | Status |
|---|----------|-----------|--------|
| 1 | Minimoog Model D (mono synth) | **Fat Mono** | ✅ PASS |
| 11 | Roland TB-303 (acid bass synth) | **Acid Bass** | ✅ PASS |
| 29 | Sequential Prophet-5 (poly synth) | **Analog Poly** | ✅ PASS |
| 51 | Yamaha DX7 (FM synth) | **FM Tines** | ✅ PASS |
| 63 | model the BEHAVIOUR of "Korg MS-20" (semi-modular monophonic synth) as an ORIGINAL plugin named "Patch Mono" (Semi-modular) | **Patch Mono** | ✅ PASS |
| 12 | true (Drum machine) | **Voltage Drums** | ✅ PASS |
| 89 | Tape Choir (sampled) | **Tape Choir** | ✅ PASS |
| 77 | E-mu SP-1200 (sampled) | **Grit Sampler** | ✅ PASS |
| 81 | Classic Beats (sampled) | **Classic Beats** | ✅ PASS |
| 13 | Roland TR-909 (sampled) | **Pulse Drums** | ✅ PASS |
| 44 | ARP Solina String Ensemble (string-machine synth) | **String Ensemble** | ✅ PASS |
| 6 | Memorymoog (polyphonic ladder synth) | **Poly Moog** | ✅ PASS |
| 53 | Yamaha CS-80 (lush cinematic polysynth) | **Cinematic Poly** | ✅ PASS |
| 42 | ARP Odyssey (duophonic synth) | **Duo Synth** | ✅ PASS |
| 59 | Casio CZ-101 (phase distortion) (phase-distortion digital synth) | **Phase Synth** | ✅ PASS |
| 79 | PPG Wave 2.2 / 2.3 (wavetable synth) | **Wave Table** | ✅ PASS |
| 41 | ARP 2600 (semi-modular synth) | **Patch 2600** | ✅ PASS |

**Done: 74 / 200.** Each shipped with: tested wasm · stunning themed GUI · gallery `.vstai` · `test.html` bench.
