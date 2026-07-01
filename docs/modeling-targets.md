# Modeling Targets — 100 Effects + 100 Synths

Curated for AI rewriting. Selection bias: each entry has **public documentation** — service
manuals/schematics, academic DSP papers, or existing open-source emulations — so the circuit or
algorithm can actually be reverse-engineered rather than guessed.

Legend for the "Docs" column:
- **S** = schematics / service manual in circulation
- **P** = academic paper(s) on its DSP (virtual analog, WDF, etc.)
- **O** = existing open-source emulation to study/validate against
- **M** = measured impulse responses / sample sets publicly available

---

## EFFECTS (100)

### Reverb (1–14)
| # | Unit | Type | Docs |
|---|------|------|------|
| 1 | ✅ ~~Lexicon 224~~ → **Vast Hall** | Digital hall | P, O |
| 2 | ✅ ~~Lexicon 480L~~ → **Shimmer Hall** | Digital hall | P |
| 3 | ✅ ~~EMT 140~~ → **Vocal Plate** | Plate | M, P |
| 4 | ✅ ~~EMT 250~~ → **Pearl Reverb** | Early digital | P |
| 5 | ✅ ~~AKG BX20~~ → **Tower Spring** | Spring | M, S |
| 6 | ✅ ~~Fender outboard spring tank (Accutronics)~~ → **Drip Tank** | Spring | S, P |
| 7 | ✅ ~~Spring reverb (generic 2/3-spring tank)~~ → **Spring Verb** | Spring | P, O |
| 8 | ✅ ~~Schroeder/Moorer reverb~~ → **Lattice Verb** | Algorithmic FDN | P, O |
| 9 | ✅ ~~Freeverb~~ → **Open Room** | Algorithmic | O |
| 10 | ✅ ~~Dattorro plate (1997 paper)~~ → **Steel Plate** | Algorithmic plate | P, O |
| 11 | ✅ ~~Eventide SP2016~~ → **Stereo Room** | Digital room | O |
| 12 | ✅ ~~Ursa Major Space Station~~ → **Star Field** | Multitap | S |
| 13 | ✅ ~~Quantec QRS~~ → **Atrium** | Digital room | P |
| 14 | ✅ ~~Convolution reverb (partitioned)~~ → **Room Print** | Convolution | P, O |

### Delay / Echo (15–26)
| # | Unit | Type | Docs |
|---|------|------|------|
| 15 | ✅ ~~Roland RE-201 Space Echo~~ → **Space Tape Echo** | Tape | S, O |
| 16 | ✅ ~~Maestro Echoplex EP-3~~ → **Tube Echo** | Tape | S |
| 17 | ✅ ~~Binson Echorec~~ → **Magnetic Echo** | Magnetic drum | S |
| 18 | ✅ ~~Electro-Harmonix Memory Man~~ → **Bucket Echo** | BBD analog | S, O |
| 19 | ✅ ~~Boss DM-2~~ → **Cozy Delay** | BBD analog | S, O |
| 20 | ✅ ~~TC Electronic 2290~~ → **Studio Delay** | Digital | — |
| 21 | ✅ ~~Lexicon PCM42~~ → **Hold Echo** | Digital | S |
| 22 | ✅ ~~Roland SDE-3000~~ → **Rack Echo** | Digital | S |
| 23 | ✅ ~~BBD bucket-brigade model (generic)~~ → **Analog Bucket** | BBD | P, O |
| 24 | ✅ ~~Tape delay physical model (wow/flutter)~~ → **Flutter Echo** | Tape | P, O |
| 25 | ✅ ~~Korg SDD-3000~~ → **Edge Echo** | Digital | S |
| 26 | ✅ ~~Multi-tap / ping-pong delay~~ → **Ping Delay** | Digital | O |

### Modulation (27–42)
| # | Unit | Type | Docs |
|---|------|------|------|
| 27 | ✅ ~~MXR Phase 90~~ → **Sweep Phaser** | Phaser | S, O |
| 28 | ✅ ~~Electro-Harmonix Small Stone~~ → **Gush Phaser** | Phaser | S, O |
| 29 | ✅ ~~Mu-Tron Bi-Phase~~ → **Twin Phaser** | Phaser | S |
| 30 | ✅ ~~Boss CE-1 Chorus Ensemble~~ → **Wide Ensemble** | BBD chorus | S, O |
| 31 | ✅ ~~Roland Juno chorus (BBD)~~ → **Lush Chorus** | Chorus | S, O |
| 32 | ✅ ~~TC Electronic SCF~~ → **Glass Chorus** | Chorus/flanger | S |
| 33 | ✅ ~~Electric Mistress~~ → **Jet Flanger** | Flanger | S, O |
| 34 | ✅ ~~A/DA Flanger~~ → **Steel Flanger** | Flanger | S |
| 35 | ✅ ~~MXR Flanger~~ → **Warm Flanger** | Flanger | S |
| 36 | ✅ ~~Uni-Vibe~~ → **Vibe Phaser** | Phase/vibe | S, O |
| 37 | ✅ ~~Leslie 122 rotary speaker~~ → **Rotary Cabinet** | Rotary | P, O |
| 38 | ✅ ~~Boss DC-2 Dimension C~~ → **Quad Dimension** | Dimensional chorus | S |
| 39 | ✅ ~~Roland Dimension D (SDD-320)~~ → **Dimensional** | Chorus | S, O |
| 40 | ✅ ~~Boss BF-2~~ → **Blue Flanger** | Flanger | S |
| 41 | ✅ ~~Demeter Tremulator~~ → **Opto Trem** | Tremolo | S |
| 42 | ✅ ~~Optical/bias tremolo (Fender amp)~~ → **Bias Tremolo** | Tremolo | S, O |

### Distortion / Drive / Fuzz (43–58)
| # | Unit | Type | Docs |
|---|------|------|------|
| 43 | ✅ ~~Ibanez TS808 Tube Screamer~~ → **Emerald Overdrive** | Overdrive | S, P, O |
| 44 | ✅ ~~Boss DS-1~~ → **Crunch Distortion** | Distortion | S, P, O |
| 45 | ✅ ~~ProCo RAT~~ → **Grit Distortion** | Distortion | S, O |
| 46 | ✅ ~~Big Muff Pi~~ → **Mammoth Fuzz** | Fuzz | S, O |
| 47 | ✅ ~~Fuzz Face~~ → **Germanium Fuzz** | Fuzz | S, P, O |
| 48 | ✅ ~~Tone Bender MkII~~ → **Bender Fuzz** | Fuzz | S, O |
| 49 | ✅ ~~Boss SD-1~~ → **Sweet Drive** | Overdrive | S, O |
| 50 | ✅ ~~Klon Centaur~~ → **Mythic Drive** | Overdrive | S, O |
| 51 | ✅ ~~MXR Distortion+~~ → **Amber Crunch** | Distortion | S, O |
| 52 | ✅ ~~Marshall Guv'nor~~ → **Brit Distortion** | Distortion | S |
| 53 | ✅ ~~Octavia~~ → **Octave Up** | Octave fuzz | S |
| 54 | ✅ ~~Diode/tube clipping stage (generic VA)~~ → **Clip Stage** | Drive | P, O |
| 55 | ✅ ~~Tape saturation model~~ → **Reel Saturator** | Saturation | P, O |
| 56 | ✅ ~~Transformer/iron saturation~~ → **Iron Drive** | Saturation | P |
| 57 | ✅ ~~Wavefolder (West Coast)~~ → **Wave Folder** | Distortion | P, O |
| 58 | ✅ ~~Bitcrusher / sample-rate reducer~~ → **Bit Crusher** | Digital | O |

### Dynamics (59–72)
| # | Unit | Type | Docs |
|---|------|------|------|
| 59 | ✅ ~~Teletronix LA-2A~~ → **Opto Glow** | Opto comp | S, P, O |
| 60 | ✅ ~~Universal Audio 1176~~ → **FET Squeeze** | FET comp | S, P, O |
| 61 | ✅ ~~dbx 160~~ → **Punch Comp** | VCA comp | S, P |
| 62 | ✅ ~~SSL bus compressor~~ → **Master Glue** | VCA comp | S, O |
| 63 | ✅ ~~API 2500~~ → **Bus Glue** | VCA comp | S |
| 64 | ✅ ~~Fairchild 670~~ → **Vari-Mu** | Vari-mu | S, P |
| 65 | ✅ ~~Empirical Labs Distressor~~ → **Crush Comp** | Comp | S |
| 66 | ✅ ~~Vari-mu tube compressor~~ → **Mu Leveler** (generic) | Vari-mu | P, O |
| 67 | ✅ ~~Diode-bridge compressor (Neve 33609)~~ → **Diode Comp** | Comp | S |
| 68 | ✅ ~~Optical compressor model (generic)~~ → **Soft Opto** | Opto | P, O |
| 69 | ✅ ~~Brickwall limiter (look-ahead)~~ → **Brickwall** | Limiter | P, O |
| 70 | ✅ ~~Multiband compressor~~ → **Multiband** | Dynamics | P, O |
| 71 | ✅ ~~Noise gate / expander~~ → **Noise Gate** | Dynamics | P, O |
| 72 | ✅ ~~De-esser~~ → **De-Esser** | Dynamics | P |

### EQ / Filter (73–86)
| # | Unit | Type | Docs |
|---|------|------|------|
| 73 | ✅ ~~Pultec EQP-1A~~ → **Velvet EQ** | Passive program EQ | S, P, O |
| 74 | ✅ ~~Neve 1073~~ → **Console EQ** | Console EQ/pre | S, O |
| 75 | ✅ ~~API 550A~~ → **Discrete EQ** | Console EQ | S, O |
| 76 | ✅ ~~SSL 4000 channel EQ~~ → **Strip EQ** | Console EQ | S, O |
| 77 | ✅ ~~Maag EQ4 (air band)~~ → **Air Lift** | EQ | S |
| 78 | ✅ ~~Moog ladder filter~~ → **Ladder Filter** | Resonant LPF | P, O |
| 79 | ✅ ~~Roland TB-303 filter~~ → **Squelch Filter** | Resonant filter | P, O |
| 80 | ✅ ~~MS-20 Sallen-Key filter~~ → **Scream Filter** | Filter | P, O |
| 81 | ✅ ~~State-variable filter (Chamberlin)~~ → **State Filter** | Filter | P, O |
| 82 | ✅ ~~Cry Baby wah~~ → **Vocal Wah** | Inductor wah | S, P, O |
| 83 | ✅ ~~Mu-Tron III~~ → **Funk Filter** | Envelope filter | S, O |
| 84 | ✅ ~~Vocal formant filter~~ → **Vowel Filter** | Filter | P, O |
| 85 | ✅ ~~Linkwitz-Riley crossover~~ → **Crossover** | Filter | P, O |
| 86 | ✅ ~~Tilt EQ / baxandall shelf~~ → **Tilt EQ** | EQ | P, O |

### Pitch / Spectral / Misc (87–100)
| # | Unit | Type | Docs |
|---|------|------|------|
| 87 | ✅ ~~Eventide H910 Harmonizer~~ → **Pitch Shifter** | Pitch shift | S, P |
| 88 | ✅ ~~Eventide H3000~~ → **Micro Shift** | Multi-FX/pitch | P |
| 89 | ✅ ~~Antares Auto-Tune~~ → **Pitch Snap** | Pitch correction | P |
| 90 | ✅ ~~DigiTech Whammy~~ → **Whammy** | Pitch shift | P |
| 91 | ✅ ~~PSOLA / phase-vocoder pitch shift~~ → **Vox Shifter** | Pitch | P, O |
| 92 | ✅ ~~Talk box~~ → **Vowel Box** | Formant | S |
| 93 | ✅ ~~Vocoder (channel, EMS-style)~~ → **Robot Voice** | Spectral | P, O |
| 94 | ✅ ~~Roland Bee Baa / ring modulator~~ → **Ring Mod** | Ring mod | P, O |
| 95 | ✅ ~~Frequency shifter (Bode/single-sideband)~~ → **Freq Shifter** | Spectral | P, O |
| 96 | ✅ ~~Aphex Aural Exciter~~ → **Air Exciter** | Harmonic exciter | S, P |
| 97 | ✅ ~~BBE Sonic Maximizer~~ → **Sonic Max** | Phase/exciter | S |
| 98 | ✅ ~~Dolby A/SR + Dolby HX (noise/character)~~ → **Compander** | Companding | P |
| 99 | ✅ ~~Leslie + tube preamp combo (organ chain)~~ → **Valve Rotary** | Combo | P, O |
| 100 | ✅ ~~Granular delay/cloud processor~~ → **Granular Cloud** | Granular | P, O |

---

## SYNTHS (1–100)

### Moog & ladder-filter lineage (1–10)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 1 | ✅ ~~Minimoog Model D~~ → **Fat Mono** | Mono, ladder | S, P, O |
| 2 | ✅ ~~Moog Modular (55/35)~~ → **Patch Tower** | Modular | S, O |
| 3 | ✅ ~~Moog Prodigy~~ → **Bolt Mono** | Mono | S, O |
| 4 | ✅ ~~Moog Source~~ → **Source Mono** | Mono | S |
| 5 | ✅ ~~Micromoog~~ → **Mini Volt** | Mono | S |
| 6 | ✅ ~~Memorymoog~~ → **Poly Moog** | Polysynth | S |
| 7 | ✅ ~~Moog Taurus~~ → **Sub Pedal** | Bass pedals | S |
| 8 | ✅ ~~Moog Rogue~~ → **Rover Mono** | Mono | S |
| 9 | ✅ ~~Multimoog~~ → **Multi Mono** | Mono | S |
| 10 | ✅ ~~Moog Voyager~~ → **Voyage Mono** | Mono | S |

### Roland (11–28)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 11 | ✅ ~~Roland TB-303~~ → **Acid Bass** | Bass mono | S, P, O |
| 12 | ✅ ~~Roland TR-808~~ → **Voltage Drums** | Drum machine | S, O |
| 13 | ✅ ~~Roland TR-909~~ → **Pulse Drums** | Drum machine | S, O |
| 14 | ✅ ~~Roland TR-606~~ → **Bark Beat** | Drum machine | S, O |
| 15 | ✅ ~~Roland Juno-60~~ → **Juno Glow** | Poly | S, O |
| 16 | ✅ ~~Roland Juno-106~~ → **Nova Six** | Poly | S, O |
| 17 | ✅ ~~Roland Jupiter-8~~ → **Jove Eight** | Poly | S, O |
| 18 | ✅ ~~Roland Jupiter-6~~ → **Comet Six** | Poly | S |
| 19 | ✅ ~~Roland SH-101~~ → **Mono Spark** | Mono | S, O |
| 20 | ✅ ~~Roland SH-2~~ → **Twin Volt** | Mono | S |
| 21 | ✅ ~~Roland System-100~~ → **Scout Mono** | Semi-modular | S |
| 22 | ✅ ~~Roland D-50~~ → **Linear Dream** | LA synthesis | S, O |
| 23 | ✅ ~~Roland Alpha Juno~~ → **Storm Juno** | Poly | S, O |
| 24 | ✅ ~~Roland JX-3P~~ → **Tri Poly** | Poly | S |
| 25 | ✅ ~~Roland JX-8P~~ → **Velour Poly** | Poly | S |
| 26 | ✅ ~~Roland CR-78~~ → **Velvet Rhythm** | Drum machine | S, O |
| 27 | ✅ ~~Roland MC-202~~ → **Seq Bass** | Mono/sequencer | S |
| 28 | ✅ ~~Roland VP-330 Vocoder Plus~~ → **Vox Strings** | String/vocoder | S |

### Sequential / Oberheim / US poly (29–40)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 29 | ✅ ~~Sequential Prophet-5~~ → **Analog Poly** | Poly | S, O |
| 30 | ✅ ~~Sequential Prophet-600~~ → **Oracle Six** | Poly | S, O |
| 31 | ✅ ~~Sequential Pro-One~~ → **Solo One** | Mono | S, O |
| 32 | ✅ ~~Oberheim OB-X~~ → **Oberon** | Poly | S |
| 33 | ✅ ~~Oberheim OB-Xa~~ → **Brass Eight** | Poly | S, O |
| 34 | ✅ ~~Oberheim OB-8~~ → **Onyx Eight** | Poly | S |
| 35 | ✅ ~~Oberheim SEM~~ → **Sem Voice** | Mono/duo | S, O |
| 36 | ✅ ~~Oberheim Matrix-12~~ → **Matrix Poly** | Poly | S |
| 37 | ✅ ~~Oberheim Four/Eight Voice~~ → **Voice Eight** | Poly | S |
| 38 | ✅ ~~Sequential Prophet VS~~ → **Vector Eight** | Vector | S |
| 39 | ✅ ~~Chroma Polaris~~ → **Polar Six** | Poly | S |
| 40 | ✅ ~~Rhodes Chroma~~ → **Prism Eight** | Poly | S |

### ARP / EMS / early modular (41–50)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 41 | ✅ ~~ARP 2600~~ → **Patch 2600** | Semi-modular | S, O |
| 42 | ✅ ~~ARP Odyssey~~ → **Duo Synth** | Duo | S, O |
| 43 | ✅ ~~ARP Axxe~~ → **Arc Poly** | Mono | S |
| 44 | ✅ ~~ARP Solina String Ensemble~~ → **String Ensemble** | String machine | S, O |
| 45 | ✅ ~~EMS VCS3 / Synthi A~~ → **Pin Matrix** | Modular | S, O |
| 46 | ✅ ~~EMS Synthi 100~~ → **Patch Grid** | Modular | S |
| 47 | ✅ ~~Buchla 100/200 (West Coast)~~ → **West Cell** | Modular | P, O |
| 48 | ✅ ~~Serge modular~~ → **Fold West** | Modular | O |
| 49 | ✅ ~~Crumar Performer~~ → **Stage Strings** | String/poly | S |
| 50 | ✅ ~~Elka Synthex~~ → **Vivid Poly** | Poly | S |

### Yamaha / FM / digital (51–62)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 51 | ✅ ~~Yamaha DX7~~ → **FM Tines** | FM | S, P, O |
| 52 | ✅ ~~Yamaha DX21/27/100~~ → **FM Four** | FM | S, O |
| 53 | ✅ ~~Yamaha CS-80~~ → **Cinematic Poly** | Poly | S, O |
| 54 | ✅ ~~Yamaha CS-60 / CS-50~~ → **Cosmo Poly** | Poly | S |
| 55 | ✅ ~~Yamaha CS-15 / CS-10~~ → **Twin Filter** | Mono | S |
| 56 | ✅ ~~Yamaha TX81Z~~ → **Lately FM** | FM | S, O |
| 57 | ✅ ~~Yamaha SY77 / SY99~~ → **Realm FM** | FM+sample | S |
| 58 | ✅ ~~Native FM (Chowning algorithm, generic)~~ → **FM Core** | FM | P, O |
| 59 | ✅ ~~Casio CZ-101 (phase distortion)~~ → **Phase Synth** | PD synthesis | S, P, O |
| 60 | ✅ ~~Casio VL-1~~ → **Pocket Tone** | Mini digital | S, O |
| 61 | ✅ ~~Kawai K5 (additive)~~ → **Additive** | Additive | S |
| 62 | ✅ ~~Korg DW-8000~~ → **Digi Wave** | Hybrid digital | S |

### Korg (63–72)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 63 | ✅ ~~Korg MS-20~~ → **Patch Mono** | Semi-modular | S, P, O |
| 64 | ✅ ~~Korg MS-10~~ → **Lab Mono** | Mono | S |
| 65 | ✅ ~~Korg MonoPoly~~ → **Unison Four** | Poly | S, O |
| 66 | ✅ ~~Korg Polysix~~ → **Hex Glow** | Poly | S, O |
| 67 | ✅ ~~Korg Poly-800~~ → **Thrift Poly** | Poly | S |
| 68 | ✅ ~~Korg Mini-Pops / Rhythm~~ → **Pocket Rhythm** | Drum machine | S, O |
| 69 | ✅ ~~Korg M1~~ → **Crystal Station** | PCM workstation | S, O |
| 70 | ✅ ~~Korg Wavestation~~ → **Vector Wave** | Vector/wave seq | S, O |
| 71 | ✅ ~~Korg PS-3200~~ → **Choral Bank** | Poly | S |
| 72 | ✅ ~~Korg Lambda / Sigma~~ → **Halo Ensemble** | Ensemble | S |

### Sampling & PCM (73–80)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 73 | ✅ ~~Fairlight CMI~~ → **Fair Cell** | Sampler | S, P |
| 74 | ✅ ~~E-mu Emulator II~~ → **Silk Cell** | Sampler | S, O |
| 75 | ✅ ~~Akai S900 / S1000~~ → **Rack Cell** | Sampler | S |
| 76 | ✅ ~~Ensoniq Mirage~~ → **Dust Keys** | Sampler | S |
| 77 | ✅ ~~E-mu SP-1200~~ → **Grit Sampler** | Drum sampler | S, O |
| 78 | ✅ ~~Akai MPC60 / 3000~~ → **Swing Kit** | Drum sampler | S, O |
| 79 | ✅ ~~PPG Wave 2.2 / 2.3~~ → **Wave Table** | Wavetable | S, O |
| 80 | ✅ ~~Waldorf Microwave~~ → **Grit Wave** | Wavetable | S, O |

### Drum machines & grooveboxes (81–88)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 81 | ✅ ~~LinnDrum / LM-1~~ → **Classic Beats** | Drum machine | S, O |
| 82 | ✅ ~~Oberheim DMX~~ → **Kit Machine** | Drum machine | S, O |
| 83 | ✅ ~~Simmons SDS-V~~ → **Hex Drums** | E-drums | S |
| 84 | ✅ ~~Casio RZ-1~~ → **Thin Kit** | Drum sampler | S |
| 85 | ✅ ~~E-mu Drumulator~~ → **Byte Beat** | Drum machine | S |
| 86 | ✅ ~~Boss DR-110~~ → **Micro Beat** | Drum machine | S |
| 87 | ✅ ~~Roland TR-707 / 727~~ → **Crisp Beat** | Drum machine | S, O |
| 88 | ✅ ~~Yamaha RX5~~ → **Pulse Kit** | Drum machine | S |

### String machines, organs, electromech (89–96)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 89 | ✅ ~~Mellotron~~ → **Tape Choir** | Tape replay | M, O |
| 90 | ✅ ~~Hammond B3 (+ Leslie)~~ → **Tonewheel Organ** | Tonewheel organ | P, O |
| 91 | ✅ ~~Farfisa Compact~~ → **Combo Organ** | Combo organ | S, O |
| 92 | ✅ ~~Vox Continental~~ → **Vee Organ** | Combo organ | S, O |
| 93 | ✅ ~~Fender Rhodes~~ → **Tine Piano** | Electric piano | M, P, O |
| 94 | ✅ ~~Wurlitzer 200A~~ → **Reed Piano** | Electric piano | M, P, O |
| 95 | ✅ ~~Hohner Clavinet D6~~ → **Clav** | Electromech | M, O |
| 96 | ✅ ~~Roland RS-09 / Logan String Melody~~ → **Divide Ensemble** | String machine | S, O |

### Modern / digital classics (97–100)
| # | Synth | Era / type | Docs |
|---|-------|-----------|------|
| 97 | ✅ ~~Access Virus (A/B/C)~~ → **Hyper VA** | VA | O |
| 98 | ✅ ~~Clavia Nord Lead~~ → **Aurora VA** | VA | O |
| 99 | ✅ ~~Waldorf Blofeld / Q~~ → **Wave Storm** | Wavetable/VA | O |
| 100 | ✅ ~~Novation Bass Station~~ → **Sub Station** | VA/analog | S, O |

---

## Notes for AI rewriting

- **Best first targets** (densest documentation, existing open models to validate against):
  Tube Screamer, Big Muff, 1176, LA-2A, Pultec, Moog ladder, TB-303, Juno chorus, DX7 FM,
  Prophet-5, MS-20, TR-808/909, spring & plate reverb, BBD delay, Leslie.
- **Circuit-modeled (analog) vs algorithmic (digital):** rows marked **P/O** on circuits usually
  have a virtual-analog or wave-digital-filter reference. Digital units (Lexicon, D-50, DX7) are
  better approached from their algorithm/patents than from schematics.
- **Trademark caution:** model the *behavior*, ship under generic/original names. Avoid the
  brand names above in shipped product UI — they're here only to identify the documentation source.
