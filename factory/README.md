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
| 70 | Multiband compressor (multiband compressor) | **Multiband** | ✅ PASS |
| 75 | API 550A (discrete proportional-Q console EQ) | **Discrete EQ** | ✅ PASS |
| 56 | Transformer/iron saturation (transformer/iron saturation) | **Iron Drive** | ✅ PASS |
| 12 | Ursa Major Space Station (multitap space reverb) | **Star Field** | ✅ PASS |
| 67 | Diode-bridge compressor (Neve 33609) (diode-bridge compressor) | **Diode Comp** | ✅ PASS |
| 11 | Eventide SP2016 (early-digital stereo room reverb) | **Stereo Room** | ✅ PASS |
| 8 | Schroeder/Moorer reverb (algorithmic FDN) (Schroeder-Moorer algorithmic reverb) | **Lattice Verb** | ✅ PASS |
| 63 | API 2500 VCA bus compressor (VCA bus compressor) | **Bus Glue** | ✅ PASS |
| 92 | Talk box (formant) (talk-box formant filter) | **Vowel Box** | ✅ PASS |
| 66 | Vari-mu tube compressor (vari-mu tube compressor) | **Mu Leveler** | ✅ PASS |
| 77 | Maag EQ4 (air band) (air-band shelving EQ) | **Air Lift** | ✅ PASS |
| 88 | Eventide H3000 (micro-pitch detune doubler) | **Micro Shift** | ✅ PASS |
| 41 | Demeter Tremulator (optical multi-shape stereo tremolo) | **Opto Trem** | ✅ PASS |
| 6 | Fender outboard spring tank (Accutronics) (drippy outboard spring reverb) | **Drip Tank** | ✅ PASS |
| 28 | Electro-Harmonix Small Stone (4-stage OTA phaser with feedback) | **Gush Phaser** | ✅ PASS |
| 16 | Maestro Echoplex EP-3 (tape echo with preamp warmth) | **Tube Echo** | ✅ PASS |
| 52 | Marshall Guv'nor (amp-in-a-box distortion with tone stack) | **Brit Distortion** | ✅ PASS |
| 48 | Tone Bender MkII (gated germanium fuzz) | **Bender Fuzz** | ✅ PASS |
| 65 | Empirical Labs Distressor (aggressive FET comp with distortion) | **Crush Comp** | ✅ PASS |
| 21 | Lexicon PCM42 (modulated digital delay with infinite hold) | **Hold Echo** | ✅ PASS |
| 34 | A/DA Flanger (extreme metallic flanger) | **Steel Flanger** | ✅ PASS |
| 49 | Boss SD-1 (asymmetric soft-clip overdrive) | **Sweet Drive** | ✅ PASS |
| 14 | Convolution reverb (real measured room IR, CC BY 4.0) | **Room Print** | ✅ PASS |
| 83 | Mu-Tron III (envelope-follower filter) | **Funk Filter** | ✅ PASS |
| 76 | SSL 4000 channel EQ (4-band console channel EQ) | **Strip EQ** | ✅ PASS |
| 51 | MXR Distortion+ (germanium hard-clip distortion) | **Amber Crunch** | ✅ PASS |
| 30 | Boss CE-1 Chorus Ensemble (BBD stereo chorus ensemble + vibrato) | **Wide Ensemble** | ✅ PASS |
| 5 | AKG BX20 (long bright studio spring reverb) | **Tower Spring** | ✅ PASS |
| 62 | SSL bus compressor (SSL-style glue bus compressor) | **Master Glue** | ✅ PASS |
| 38 | Boss DC-2 Dimension C (button-mode dimensional chorus) | **Quad Dimension** | ✅ PASS |
| 35 | MXR Flanger (warm analog flanger) | **Warm Flanger** | ✅ PASS |
| 19 | Boss DM-2 (warm short BBD analog delay) | **Cozy Delay** | ✅ PASS |
| 99 | Leslie + tube preamp combo (organ chain) (rotary speaker through overdriven tube preamp) | **Valve Rotary** | ✅ PASS |
| 13 | Quantec QRS (natural digital ambience room reverb) | **Atrium** | ✅ PASS |
| 54 | Diode/tube clipping stage (generic VA) (transparent soft-clip saturator) | **Clip Stage** | ✅ PASS |
| 32 | TC Electronic SCF (pristine stereo chorus/flanger combo) | **Glass Chorus** | ✅ PASS |
| 22 | Roland SDE-3000 (clean rack digital delay with doubler modulation) | **Rack Echo** | ✅ PASS |
| 24 | Tape delay physical model (wow/flutter) | **Flutter Echo** | ✅ PASS |
| 25 | Korg SDD-3000 (bright preamp digital delay) | **Edge Echo** | ✅ PASS |
| 3 | EMT 140 (bright dense studio plate reverb) | **Vocal Plate** | ✅ PASS |
| 98 | Dolby A/SR + HX (companding NR character) | **Compander** | ✅ PASS |
| 68 | Optical compressor (generic opto leveler) | **Soft Opto** | ✅ PASS |
| 23 | BBD bucket-brigade model (generic BBD delay/chorus) | **Analog Bucket** | ✅ PASS |
| 89 | Antares Auto-Tune (real-time pitch correction) | **Pitch Snap** | ✅ PASS |

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
| 70 | Korg Wavestation (vector / wave-sequencing synth) | **Vector Wave** | ✅ PASS |
| 28 | Roland VP-330 Vocoder Plus (string + voice ensemble) | **Vox Strings** | ✅ PASS |
| 90 | Hammond B3 (+ Leslie) (tonewheel drawbar organ) | **Tonewheel Organ** | ✅ PASS |
| 93 | Fender Rhodes (electric tine piano) | **Tine Piano** | ✅ PASS |
| 95 | Hohner Clavinet D6 (clavinet (plucked string)) | **Clav** | ✅ PASS |
| 91 | Farfisa Compact (combo organ (divide-down)) | **Combo Organ** | ✅ PASS |
| 94 | Wurlitzer 200A (electric reed piano) | **Reed Piano** | ✅ PASS |
| 61 | Kawai K5 (additive) (additive synth) | **Additive** | ✅ PASS |
| 17 | Roland Jupiter-8 (8-voice analog poly synth) | **Jove Eight** | ✅ PASS |
| 31 | Sequential Pro-One (aggressive mono synth) | **Solo One** | ✅ PASS |
| 32 | Oberheim OB-X (fat discrete-oscillator analog poly) | **Oberon** | ✅ PASS |
| 15 | Roland Juno-60 (DCO poly synth with chorus) | **Juno Glow** | ✅ PASS |
| 47 | Buchla 100/200 (West Coast) (west-coast wavefolding synth) | **West Cell** | ✅ PASS |
| 45 | EMS VCS3 / Synthi A (patch-matrix mono synth with ring mod) | **Pin Matrix** | ✅ PASS |
| 52 | Yamaha DX21 / DX100 (4-operator FM synth) | **FM Four** | ✅ PASS |
| 65 | Korg MonoPoly (4-VCO unison mono/poly synth) | **Unison Four** | ✅ PASS |
| 54 | Yamaha CS-60 (lush ring-mod analog poly) | **Cosmo Poly** | ✅ PASS |
| 23 | Roland Alpha Juno (DCO poly with PWM "hoover" pad) | **Storm Juno** | ✅ PASS |
| 97 | Access Virus (hypersaw virtual-analog poly) | **Hyper VA** | ✅ PASS |
| 35 | Oberheim SEM (multimode state-variable-filter mono/duo synth) | **Sem Voice** | ✅ PASS |
| 60 | Casio VL-1 (lo-fi mini digital synth) | **Pocket Tone** | ✅ PASS |
| 36 | Oberheim Matrix-12 (heavily-modulated dual-filter poly) | **Matrix Poly** | ✅ PASS |
| 50 | Elka Synthex (bright punchy analog poly) | **Vivid Poly** | ✅ PASS |
| 55 | Yamaha CS-15 / CS-10 (dual HP+LP series-filter mono) | **Twin Filter** | ✅ PASS |
| 19 | Roland SH-101 (punchy sub-oscillator mono synth) | **Mono Spark** | ✅ PASS |
| 67 | Korg Poly-800 (single-filter paraphonic DCO poly) | **Thrift Poly** | ✅ PASS |
| 71 | Korg PS-3200 (fully-polyphonic organ/string ensemble) | **Choral Bank** | ✅ PASS |
| 43 | ARP Axxe (American poly voice with sample & hold) | **Arc Poly** | ✅ PASS |
| 7 | Moog Taurus (deep sub-bass pedal synth) | **Sub Pedal** | ✅ PASS |
| 100 | Novation Bass Station (modern VA acid-bass mono) | **Sub Station** | ✅ PASS |
| 18 | Roland Jupiter-6 (multimode-filter analog poly) | **Comet Six** | ✅ PASS |
| 62 | Korg DW-8000 (DWGS digital-wave + analog-filter hybrid poly) | **Digi Wave** | ✅ PASS |
| 10 | Moog Voyager (modern Moog mono with dual-mode filter) | **Voyage Mono** | ✅ PASS |
| 25 | Roland JX-8P (warm velocity-sensitive DCO poly) | **Velour Poly** | ✅ PASS |
| 2 | Moog Modular (55/35) (3-oscillator semi-modular mono monster) | **Patch Tower** | ✅ PASS |
| 20 | Roland SH-2 (dual-VCO mono with ring mod) | **Twin Volt** | ✅ PASS |
| 3 | Moog Prodigy (lean 2-oscillator sync mono) | **Bolt Mono** | ✅ PASS |
| 64 | Korg MS-10 (aggressive patchable single-VCO mono) | **Lab Mono** | ✅ PASS |
| 49 | Crumar Performer (string + brass ensemble machine) | **Stage Strings** | ✅ PASS |
| 27 | Roland MC-202 (acid sequencer bass mono) | **Seq Bass** | ✅ PASS |
| 5 | Micromoog (compact expressive single-osc Moog mono) | **Mini Volt** | ✅ PASS |
| 82 | Oberheim DMX (sample-playback drum machine, original CC0 one-shots) | **Kit Machine** | ✅ PASS |
| 69 | Korg M1 (PCM workstation — original CC0 multisamples) | **Crystal Station** | ✅ PASS |
| 76 | Ensoniq Mirage (lo-fi 8-bit sampler — original CC0 sample) | **Dust Keys** | ✅ PASS |
| 22 | Roland D-50 (LA synthesis — PCM attack + synth body, CC0 attacks) | **Linear Dream** | ✅ PASS |
| 16 | Roland Juno-106 (DCO polysynth + high-pass + chorus) | **Nova Six** | ✅ PASS |
| 33 | Oberheim OB-Xa (fat multimode-filter analog poly) | **Brass Eight** | ✅ PASS |
| 83 | Simmons SDS-V (real-time analog electronic drums) | **Hex Drums** | ✅ PASS |
| 92 | Vox Continental (bright combo organ, drawbars) | **Vee Organ** | ✅ PASS |
| 96 | Roland RS-09 / Logan String Melody (divide-down string+organ) | **Divide Ensemble** | ✅ PASS |
| 14 | Roland TR-606 (tight analog drum machine) | **Bark Beat** | ✅ PASS |
| 56 | Yamaha TX81Z (FM with selectable operator waveforms) | **Lately FM** | ✅ PASS |
| 98 | Clavia Nord Lead (morphable-waveform virtual-analog lead) | **Aurora VA** | ✅ PASS |
| 68 | Korg Mini-Pops (Latin preset rhythm box) | **Pocket Rhythm** | ✅ PASS |
| 24 | Roland JX-3P (DCO poly with cross-modulation) | **Tri Poly** | ✅ PASS |
| 30 | Sequential Prophet-600 (CEM poly with Poly-Mod) | **Oracle Six** | ✅ PASS |
| 66 | Korg Polysix (single-VCO poly with built-in phaser) | **Hex Glow** | ✅ PASS |
| 86 | Boss DR-110 (budget analog drum box) | **Micro Beat** | ✅ PASS |
| 4 | Moog Source (two-osc Moog mono) | **Source Mono** | ✅ PASS |
| 99 | Waldorf Blofeld (wavetable scanner) | **Wave Storm** | ✅ PASS |
| 37 | Oberheim Four/Eight Voice (fat unison SEM-stack poly) | **Voice Eight** | ✅ PASS |
| 9 | Multimoog (expressive single-VCO mono with osc-mod) | **Multi Mono** | ✅ PASS |
| 26 | Roland CR-78 (warm preset-pattern rhythm box) | **Velvet Rhythm** | ✅ PASS |
| 34 | Oberheim OB-8 (bright four-pole PWM poly) | **Onyx Eight** | ✅ PASS |
| 87 | Roland TR-707/727 (crisp digital house drum box) | **Crisp Beat** | ✅ PASS |
| 40 | Rhodes Chroma (ring-mod hybrid poly) | **Prism Eight** | ✅ PASS |
| 85 | E-mu Drumulator (8-bit lo-fi crunch drum box) | **Byte Beat** | ✅ PASS |
| 38 | Sequential Prophet VS (vector-scan poly) | **Vector Eight** | ✅ PASS |
| 58 | Native FM / Chowning (two-operator FM) | **FM Core** | ✅ PASS |
| 88 | Yamaha RX5 (bright digital FM drum machine) | **Pulse Kit** | ✅ PASS |
| 84 | Casio RZ-1 (cheap thin 12-bit drum box) | **Thin Kit** | ✅ PASS |
| 80 | Waldorf Microwave (gritty digital wavetable poly) | **Grit Wave** | ✅ PASS |
| 40 | Boss BF-2 (deep resonant stereo flanger) | **Blue Flanger** | ✅ PASS |
| 73 | Fairlight CMI (8-bit sampler, CC0 baked sample) | **Fair Cell** | ✅ PASS |
| 91 | PSOLA / phase-vocoder pitch shift (formant-aware) | **Vox Shifter** | ✅ PASS |
| 74 | E-mu Emulator II (warm 8-bit string/choir sampler) | **Silk Cell** | ✅ PASS |
| 75 | Akai S900/S1000 (crisp 12-bit rack sampler) | **Rack Cell** | ✅ PASS |
| 72 | Korg Lambda/Sigma (string ensemble poly) | **Halo Ensemble** | ✅ PASS |
| 78 | Akai MPC60/3000 (swung punchy drum sampler) | **Swing Kit** | ✅ PASS |
| 39 | Chroma Polaris (warm hard-sync 6-voice poly) | **Polar Six** | ✅ PASS |
| 57 | Yamaha SY77/SY99 (FM + resonant filter, RCM) | **Realm FM** | ✅ PASS |
| 46 | EMS Synthi 100 (ring-mod patch-matrix modular) | **Patch Grid** | ✅ PASS |
| 8 | Moog Rogue (two-osc Moog ladder mono) | **Rover Mono** | ✅ PASS |
| 48 | Serge modular (West-Coast wavefolder) | **Fold West** | ✅ PASS |
| 21 | Roland System-100 (semi-modular S&H mono) | **Scout Mono** | ✅ PASS |

**Done: 200 / 200.** 🎉 Every modeling target shipped: tested wasm · stunning bespoke GUI · gallery `.vstai` · `test.html` bench. Each shipped with: tested wasm · stunning themed GUI · gallery `.vstai` · `test.html` bench.

## Deep-detail rebuilds (2026-07-03)

Full-manual-fidelity builds: the original's operation manual is read cover to cover
and the hardware's complete program-parameter list (NRPN appendix) is used as the
completeness checklist. Switch groups are bit-packed so everything fits the 64-param
host pool; a bespoke panel GUI decodes every individual switch.

| Original | Name | Coverage | Status |
|---|---|---|---|
| Moog Minimoog Model D (User's Manual v2, all 84 pp) | **Fat Mono** | 3 osc × 6 waveforms × 6 ranges · osc3 drone/mod source · mixer w/ overload feedback · ladder + Emphasis · KB Control 1/3+2/3 · decay-switch release · glide · note priority + multi-trigger · vel/pressure patch routes (38 params) | ✅ PASS 38/38 reactive, 16/16 behavior, GUI 0 errors |
| Sequential Prophet-5 Rev 4 (User's Guide 1.3, all 80 pp) | **Analog Poly** | 2 VCOs (simultaneous wave switches, stepped FREQUENCY, hard sync, Osc B fine/lo-freq/kbd-off) · Poly Mod (FiltEnv + audio-rate Osc B → FreqA/PW A/Filter) · Rev 1/2-vs-3/4 switch (filter voicing + SSM-linear/CEM-exp envelope shapes) · Vintage knob (per-voice spread + drift) · Wheel-Mod (LFO↔noise mix, 5 dests) · Release switch · Unison 1-5 + chord memory · glide · aftertouch Filt/LFO · A-440 · bend range (45 params) | ✅ PASS 45/45 reactive, 8/8 behavior, GUI 0 errors |
| Roland Juno-106 (Owner's Manual, all 32 pp) | **Nova Six** | DCO (16'/8'/4', simultaneous saw+pulse, PWM MAN/LFO, square sub-osc, noise) · 4-position HPF (incl. position-0 bass boost) · self-oscillating VCF w/ ENV +/- polarity, LFO & keyboard-follow · shared ADSR feeding VCF + VCA · VCA ENV/GATE switch · LFO rate+DELAY fade-in · tri-mode stereo BBD chorus (off/I/II/**I+II**) · portamento · bend lever (DCO ±1oct + VCF sens + LFO vibrato) · Poly1/Poly2/Solo assign · ±1-oct transpose · 6-voice poly (32 params) | ✅ PASS 32/32 reactive, 14/14 behavior, GUI 0 errors |
| Roland Jupiter-8 (Owner's Manual, cover to cover) | **Jove Eight** | 2 VCOs (VCO-1 tri/saw/pulse/sqr + CROSS MOD FM · VCO-2 sine/saw/pulse/noise + FINE + LOW-freq + SYNC) · VCO modulator (LFO/ENV → VCO1/BOTH/VCO2) · PWM MAN/LFO/ENV · non-reso HPF · VCF w/ **-12/-24 dB slope switch** + ENV-1/ENV-2 select + LFO + key-follow · VCA + 4-pos LFO tremolo · two ADSRs (ENV-1 assignable + NORM/INV polarity + key-follow) · LFO (sine/saw/sqr/random + DELAY) · POLY1/POLY2/SOLO/UNISON assigner · 1-4 oct UP/DN/U&D/RANDOM arp + hold · portamento off/on/upr · bender (VCO/VCF + sens) · LFO-mod pad · 8-voice poly (47 params) | ✅ PASS 47/47 reactive, 12/12 behavior, GUI 0 errors |
| Yamaha CS-80 (Instruction Manual, all 58 pp) | **Cinematic Poly** | TWO independent synth channels per voice (I + II, equal-power mix) · per-channel VCO (16'-2' feet, saw+pulse+PWM, noise) · per-channel HPF+LPF each with resonance · the signature **IL-AL-A-D-R** filter envelope (dips below then overshoots cutoff) · per-channel VCA ADSR · DETUNE II · **polyphonic aftertouch → brilliance/level/pitch** · velocity PITCHBEND + initial-touch brilliance · pitch **RIBBON** (spring-to-centre ±oct) · SUB OSC (6 functions → VCO/VCF) · audio-rate RING MOD · stereo TREM/CHORUS · glissando vs portamento · brilliance/resonance · 8-voice poly (64 params) | ✅ PASS 64/64 reactive, 9/9 behavior, GUI 0 errors |
| Yamaha DX7 (Operating Manual, all 29 pp) | **FM Tines** | real **6-operator FM engine** with the exact **32 DX7 algorithms** (carrier/modulator bus + per-algorithm feedback op) · per-op ratio/level/detune + fixed-freq mode + 4-stage EG · feedback 0-7 · LFO (tri/saw±/sqr/sine/S&H, speed/delay/PMD/AMD, key-sync) + pitch & amp mod-sensitivity · pitch EG · velocity brightens modulators · porta (fingered/full-time + gliss) · poly/mono · bend range + mod-wheel/breath/aftertouch → pitch/amp/EG-bias · transpose · 16-voice poly (64 params) | ✅ PASS 64/64 reactive, 8/8 behavior, GUI 0 errors |
| Roland TB-303 (Owner's Manual, all 96 pp) | **Acid Bass** | single VCO saw/square (polyBLEP) · ±500¢ tuning · **18 dB/oct 3-pole diode-ladder resonant LPF** (self-osc-ish) · env-mod filter sweep · single decay-only EG (shapes tone + volume, per manual) · **ACCENT circuit** (level boost + extra fast resonant sweep + accumulation across consecutive accents) · **SLIDE** (fixed-time legato glide, no retrigger) · **16-step sequencer** w/ per-step pitch/accent/slide/rest at 40-300 BPM · monophonic (11 params — faithful to the hardware's ~9 knobs; alwaysShow) | ✅ PASS 11/11 reactive, 11/11 behavior, GUI 0 errors |
| Roland SH-101 (Owner's Manual, all 56 pp) | **Mono Spark** | VCO (32'-2' range, simultaneous saw+pulse+**3-way sub-osc** 1oct/2oct/2oct-narrow + noise, PWM man/lfo/env) · source-mixer faders · 4-pole self-oscillating VCF (cutoff/reso/env/mod/kbd) · VCA **ENV-vs-GATE** source · ADSR w/ LFO-rate repeating mode · LFO tri/sq/random/noise · **auto-arp up/u&d/down** · built-in **16-step sequencer** w/ rests + ties · HOLD latch · portamento off/on/auto · bender + mod-grip · transpose · ±50¢ tune · monophonic (35 params) | ✅ PASS 35/35 reactive, 14/14 behavior, GUI 0 errors |
| Korg MS-20 (Owner's Manual, all 13 pp) | **Patch Mono** | VCO-1 (tri/saw/rect+PW/noise, 32'-4') · VCO-2 (saw/sq/pulse/**ring**, ±1oct pitch) · **dual self-oscillating Korg-35 filters in series** (HPF→LPF, each cutoff/peak + MG/EG2 mod) · MG dual-output morphing LFO · **EG1 Delay/Attack/Release** + **EG2 Hold/ADSR** · freq-mod (MG/EG1 → pitch) · Sample & Hold · **ESP** (band-pass pre-amp + envelope follower + freq→CV) · programmable control wheel · **4-cord patch bay** (any source → any destination + amount) · portamento · monophonic (52 params) | ✅ PASS 52/52 reactive, 13/13 behavior, GUI 0 errors |
| Oberheim OB-Xa (Owner's Manual 3rd ed. 1982, all 35 pp) | **Brass Eight** | 8-voice (2 osc/voice) · independent SAW+PULSE per osc · OSC2 detune + **SYNC** · **F-ENV → OSC2 pitch** · signature **2-pole/4-pole switchable filter** (reso raises level in 2-pole, lowers in 4-pole) · filter source-select (OSC1/OSC2 half-full/pink noise) + track · dual ADSR (filter + loudness) · LFO (sin/sq/S&H → osc/PW/filter) · **UNISON** detuned 8-voice stack · portamento (linear/quantized + offset) · HOLD · pitch-bend lever w/ OSC2-only + narrow · transpose (27 params) | ✅ PASS 27/27 reactive, 13/13 behavior, GUI 0 errors |
| Oberheim OB-X (Owner's Manual 2nd ed. 1980, all avail. pp*) | **Oberon** | 8-voice (2 osc/voice) · continuous-freq oscillators + independent SAW+PULSE · OSC2 detune + **hard SYNC** · genuine **SEM 2-pole TPT state-variable LP** (smooth, cutoff-emphasising — no 4-pole, the OB-X's defining difference from OB-Xa) · filter source-select (OSC1/OSC2 half-full/noise) + track · dual ADSR (filter + loudness) · LFO (sin/sq/S&H → osc/PW/filter) · detuned **UNISON** · per-voice **pan Spread** · portamento · HOLD · pitch/mod levers + bend range (29 params) *scan truncated p.10, remainder reconstructed from features list + retrospective | ✅ PASS 29/29 reactive, 13/13 behavior, GUI 0 errors |
| ARP Odyssey (Owner's Manual 2nd ed. 1976, all 58 pp) | **Duo Synth** | always-**duophonic** (low key → VCO1, high key → VCO2) · 2 VCOs saw/sq + PW/PWM · hard SYNC · **ring mod** (VCO1×VCO2) · audio mixer + white/pink noise · **Sample & Hold** (2-input mixer + LFO/kbd clock + lag) · the signature **slider + two-position source-rocker mod matrix** (Sine/S&H/ADSR/AR/Kbd sources) · self-osc 4-pole VCF + non-reso HPF · **ADSR and AR** envelopes · REPEAT (LFO retriggers env) · VCO1 LF mode · PPC pitch-bend + vibrato · portamento · ±2-oct transpose (40 params) | ✅ PASS 40/40 reactive, 13/13 behavior, GUI 0 errors |
| Kawai K5 (additive; manual via period SOS/Music-Tech sources*) | **Additive** | genuine **additive engine** (2 sources × 64-partial sine bank, control-rate amp recompute) · 6 harmonic PROFILE seeds reshaped by TILT / ODD-EVEN / DENSITY · DFT **FORMANT** emphasis (freq/width/amount) · **three-band DHG morph envelopes** (low/mid/hi attack+decay — the K5's evolving timbre) · **DDF** spectral filter (cutoff/env/keytrack) · per-source **DDA** ADSR · DFG pitch env · Full-mode octave stack vs Twin detune · LFO (pitch/spectrum/amp/formant) · live spectrum display (62 params) *PDF unavailable — architecture reconstructed from SOS 1990 + Music Technology 1987 | ✅ PASS 62/62 reactive, 9/9 behavior, GUI 0 errors |
| Sequential Prophet-6 (Operation Manual 2.1, all 88 pp) | **Seer Six** | 2 morphing VCOs + sync + sub + noise · LPF/HPF w/ shared env · Slop · 4-mode glide · LFO (5+1 shapes, sync, 6 dests) · Poly Mod · full Aftertouch · Unison 1-6 + chord memory + 6 key modes · Pan Spread · Distortion · dual FX (bbd/ddl/cho/3×phaser/ring/2×flanger + hall/room/plate/spring, clock sync) · arp (5 modes × 3 oct × 10 divisions, Hold) · 64-step 6-note sequencer w/ rest+tie+transpose · wheels | ✅ PASS, all 64 params reactive, GUI 0 errors |

Gallery total → **211**.

## Patchable semi-modular (2026-07-01)

An original **fully-patchable** semi-modular synth with a real, working **patch bay** — a jack matrix where clicking a source jack then a destination jack draws a cable and sets a real modulation-routing parameter (the DSP carries a 5×4 mod matrix; normalled cables so it sounds good unpatched). DSP `VERDICT: PASS` · GUI 0 console errors · patching proven to route (`setParam` fires + cable draws) · gallery `.vstai`.

| Inspired by | Name | Voice | Patch dest⁴ |
|---|---|---|---|
| Soma Pulsar-23 | **Quasar** | organismic through-zero cross-mod + feedback | Chaos |
