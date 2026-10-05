# KGrbdPa

A monophonic semi-modular analog synthesizer modelled **feature-for-feature on the Moog Grandmother**, built from a
cover-to-cover read of the *Grandmother User's Manual* (88-page "Grandmother" edition): the signal-flow page, every
module, the patch-point index with its voltage tables, the Global Settings, the MIDI chart and the **14 printed patch
sheets** (cables and knob positions transcribed). The front panel is re-created from the manual's line drawing (layout,
section frames, inverted jack labels, three-decade cutoff scale) with a KGrbdPa wordmark — no Moog logo is used.

```sh
node factory/kgrbdpa/build.mjs [--pack]        # → factory/plugins/kgrbdpa/{assembly.ts,gui.html,spec.json[,kgrbdpa.vstai]}
factory/kgrbdpa/tools/make.sh /tmp/kg.wasm     # build + compile
# tests (all take the compiled wasm via KG_WASM=... or as the first .wasm argument):
node factory/kgrbdpa/tests/voice.mjs      /tmp/kg.wasm   # 138 checks: oscillators, sync, FM, PWM, mixer, ladder, HP, ATT, mult, ADSR, VCA, LFO, reverb, normalling
node factory/kgrbdpa/tests/behavior.mjs   /tmp/kg.wasm   # 64 checks: keyboard priorities, glide, arpeggiator, sequencer REC/play/edit, clock, CLOCK IN/OUT, ON/OFF, RESET
node factory/kgrbdpa/tests/patchbay.mjs   /tmp/kg.wasm   # 85 checks: every one of the 41 jacks proven live, feedback patches stable
node factory/kgrbdpa/tests/midi.mjs       /tmp/kg.wasm   # 86 checks: the manual's MIDI chart (CC, 14-bit pairs, RPN, bend, local, all-notes-off)
node factory/kgrbdpa/tests/reactive.mjs   /tmp/kg.wasm   # every control proven audibly wired (55 + the 23 patch-bay selectors)
node factory/kgrbdpa/tests/packing.mjs    /tmp/kg.wasm   # every raw value of every control round-trips through the host float chain
node factory/kgrbdpa/tests/fuzz.mjs       /tmp/kg.wasm   # 120 extreme random patches (random cables/loops/CCs), 22-192 kHz: finite, within ±1
node factory/kgrbdpa/tests/rates.mjs      /tmp/kg.wasm   # pitch / cutoff / envelope / arp tempo / spring decay at 7 sample rates
node factory/kgrbdpa/tests/quality.mjs    /tmp/kg.wasm   # every patch sheet audible, non-clipping, no DC
node factory/kgrbdpa/tests/tune-levels.mjs /tmp/kg.wasm  # loudness-normalise the patch sheets → presets.levels.json
node factory/kgrbdpa/tests/gui-roundtrip.mjs             # GUI packing == pack.mjs; host-restore decode (headless Chrome)
node factory/kgrbdpa/tests/gui-interact.mjs              # every control + REAL cable drags, tap tempo, record markers, keyboard
node factory/tools/persist-check.mjs factory/plugins/kgrbdpa
node factory/kgrbdpa/tools/shot.mjs out.png --preset "Cavern Strings"   # screenshot of any patch sheet
```

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **Signal flow** (p.8) | Every jack carries **volts**: audio ±5 V (10 Vpp), pitch 1 V/oct, gate 0/+8 V, envelope 0…+8 V, KB VEL 0…+5 V. Each input jack reads "which output is cabled to me" or its normalled connection. Fixed evaluation order; a cable that points "backwards" sees the previous sample, so any feedback patch is stable and deterministic (fuzzed). |
| **Keyboard / LHC** (p.9-10) | Mono keyboard with LOW / HIGH / LAST priority (global setting), **single-trigger legato** (overlapped keys keep the gate, a ≥ 1 ms gap re-triggers), KB OUT 1 V/oct (−5…+5 V or 0…10 V), KB VEL OUT = velocity × 5 V, keyboard octave ±2 and transpose, **pitch wheel** (bend range up/down 0-24 st; MIDI CC107/108/RPN 0), **mod wheel**, **GLIDE** with the three MIDI-chart types (LCR / LCT / exponential), legato glide (HOLD + GLIDE on the hardware) and gated glide |
| **Oscillators** (p.10-13) | VCO 1: 32'/16'/8'/4'; VCO 2: 16'/8'/4'/2' with FREQUENCY ±7 st; triangle / saw / square / 25 % narrow pulse. Band-limited with 32-tap Kaiser-windowed-sinc steps/ramps (alias floor ≈ −70 dB, ≈ 9 % Gibbs ringing at edges). **Hard sync** (VCO 2 reset by VCO 1, sub-sample accurate and band-limited; FREQUENCY range widens to ±36 st while synced), **linear FM** (120 Hz/V), PITCH IN 1 V/oct, **PWM IN** (shared PWM bus per the signal-flow page), FINE TUNE, analog drift |
| **Mixer** (p.14-15) | 3 channels + INSTRUMENT IN, DC-coupled; each stage soft-clips above ~1 o'clock (knee 3.5 V); noise = white, wide-band. OSC 1 IN / OSC 2 IN / NOISE IN **replace** the normalled sources while cabled |
| **Filter** (p.16-18) | 4-pole −24 dB/oct Moog ladder (zero-delay-feedback, exact cutoff and self-oscillation pitch, saturating input and feedback), 20 Hz-20 kHz on the printed 3-decade scale (down to 10 Hz with CV), resonance self-oscillates as a clean sine that tracks the cutoff, KBD TRACK 1:2 / OFF / 1:1, bipolar ENVELOPE AMT, ENV AMT IN, CUTOFF IN (1 V/oct); mixer + ladder run **2× oversampled** |
| **Envelope** (p.18-20) | Analog-style exponential ADSR; attack aims at 1.2× so it reaches the top in the set time, always from the current level; TRIGGER IN (> 1.2 V), + ENV OUT and − ENV OUT |
| **Output** (p.20-22) | VCA modes **ENV / KB RLS / DRONE** (KB RLS = instant attack + the RELEASE time; DRONE + VCA AMT IN = a plain VCA, 0…+8 V), VCA AMT IN summed with the envelope (tremolo), VCA IN, REVERB IN, **spring reverb** (two dispersive springs: a chain of negative-coefficient all-passes in a feedback loop → the chirpy "boing"), REVERB OUT always 100 % wet, EURORACK OUT before VOLUME, AC-coupled outputs |
| **Modulation** (p.23-24) | 0.07 Hz-1.3 kHz LFO: sine / sawtooth / ramp / square (saw, ramp and square are band-limited — it is usable as an audio oscillator), fine rate (SHIFT + RATE), RATE IN 1 V/oct (KB OUT → RATE IN tracks the keyboard), SYNC IN, WAVE OUT, **S/H OUT** (noise sampled once per cycle). PITCH AMT / CUTOFF AMT / PULSE WIDTH AMT are the maxima (±1 oct / ±5 oct / ±45 % duty) scaled by the MOD wheel |
| **Utilities** (p.25-26) | 4-point MULT (two inputs are summed — the manual's "merge two audio signals"), 6 dB/oct HIGH PASS (zero-delay one pole), **bipolar attenuator** (input normalled to +8 V, centre = zero, left inverts) |
| **ARP / SEQ** (p.27-35) | Arpeggiator ORDR / FWD-BKWD (ping-pong, ends not repeated) / RNDM, 1-3 octaves, HOLD latch (new pattern after all fingers lift, notes added while held), PLAY. **Sequencer: 3 × 256 steps**, REC (first note erases; REST / TIE / ACCENT; notes held together record legato), live overwrite while playing, key-transposed playback (root = first step), tie = same note held / different note legato, accent = fast envelope on KB VEL OUT. Clock: internal 20-280 BPM (a step is an eighth note), **tap tempo**, **host tempo with the 24 note divisions** of the MIDI chart (bar-locked), CLOCK IN (Clock mode with PPQN or Step-Advance), ON/OFF IN (> 2.5 V), RESET IN, CLOCK OUT (PPQN) |
| **Rear panel / Global** (p.34-38) | INSTRUMENT IN → mixer, EURORACK OUT, REVERB OUT, FINE TUNE, KB OUT range, **Local ON/OFF**, note priority, bend range, clock-in mode + PPQN, clock-out PPQN — all in the Global Settings dialog (host-saved) |
| **Patch bay** (p.39-42) | All **41 patch points**: 21 inputs (each a selector "which output is cabled in"), 16 outputs + the INSTRUMENT IN / CLOCK OUT extras, 4 mult jacks. Drag cables output → input or input → output, drag a plug to move it, drop on nothing or right-click to unplug |
| **MIDI chart** (p.43-44) | CC1 3 5 8 12 65 69 73 74 75 77 85 89 90 91 92 93 94 103 107 108 119, RPN 0/1/2, 14-bit CC pairs, pitch bend, CC120/122/123; a CC overrides a control until the host changes it again |
| **Presets** (p.45-51) | The 14 patch sheets: Funky Robot, Showdown Guitar, Dynasty Plucks, Haunted Cave, Ultra Sub Bass, Cavern Strings, J-Bass, Auto Zap Bass, Stepped Drone, Cyclical Patterns, Bag Pipes, Piano Bass, Lift Off, 3 Saws — cables exactly as drawn — plus three plug-in extras (Acid Sequence, Arp Pad, Sync Sweep Lead) |

## The 64-slot packing

The host exposes 63 float slots. The Grandmother's **27 knobs and wheels are direct slots** (full-resolution floats, real DAW
automation): Pitch wheel, Mod wheel, Glide, Arp/Seq rate, Mod rate (+ fine), the three AMT knobs, OSC 2 frequency, the three
mixer levels, High pass, Attenuator, Cutoff, Resonance, Envelope amount, A / D / S / R, Volume, Reverb mix, Fine tune, Instrument
level, Drift. The 51 switches and settings — including the whole patch bay (**23 destination selectors × 19 sources**, five per slot) —
are small integers packed by mixed radix (`pack.mjs`, product ≤ 2²⁴). **34 slots** are used.

## Things the manual does not state (chosen, and documented here)

| Item | Value | Why |
|---|---|---|
| Cutoff scale | 20 Hz × 1000ⁿ (three decades) | the printed dial: 20 Hz / 200 Hz / 2 kHz / 20 kHz sit at 7 / 10 / 2 / 5 o'clock (the text says "10 Hz-20 kHz"; CV and the envelope reach down to 10 Hz) |
| Envelope times | A 0.8 ms-8 s, D / R 2 ms-12 s (exponential taper) | not given in the manual |
| Envelope → cutoff | 7 octaves at full ENVELOPE AMT | |
| LFO → pitch / cutoff / PW | ±1 oct / ±5 oct / ±45 % at full amount × wheel | the manual only gives "maximum" |
| Lin FM sensitivity | 120 Hz per volt (not key-tracked, as "linear FM" implies) | |
| PWM IN | modulates both oscillators | the signal-flow page routes the PWM bus to both |
| VCA AMT IN in ENV / KB RLS | summed with the envelope (p.41 index) | p.22 says "multiplied"; p.41 says "summed" |
| HIGH PASS range | 10 Hz-10 kHz | |
| Mixer / filter overdrive | soft knee at 3.5 V per channel, input stage ceiling 1.15 | "gentle distortion above 1 o'clock" |
| Sequencer transposition root | the first step's note | the manual only says "play a new note to transpose" |
| FWD/BKWD | ping-pong without repeating the end notes | "plays in the inverse order" |
| Gated glide | slewing only while the gate is high | MIDI CC103 is not described |
| Gate length | 50 % of a step | |

## Honest limits

* **Never auditioned by ear or loaded in a DAW** — verified offline (spectra, pitch, timing, levels, 575+ automated DSP checks plus the GUI suites), in
  headless Chrome and by the engine tests above. Envelope/LFO ranges and modulation depths are plausible values, not measurements
  of the hardware (see the table above); the 14 patch sheets' knob positions are read off the line drawing to about a clock-hour,
  and a few ambiguous ones are marked `~` in `presets.mjs`. The panel's colours are the author's guess (the manual is a line drawing).
* **Sequencer memory is not saved with the DAW project** (the plug-in state is the 63 parameter slots only). The three sequences
  start with demo patterns (`seqs.mjs`) and keep whatever you record for the session.
* No MIDI-channel selection / MIDI clock start-stop options (host-level); the CLOCK OUT jack is a CV-style pulse for patching,
  not a MIDI clock output. No firmware-update or calibration features.
* The band-limited oscillators ring ≈ 9 % of an edge's height (Gibbs) and have a ≈ 0.3 ms latency; the oscillator → mixer →
  ladder path adds ≈ 0.5 ms more (half-band oversampling).
