# Jove Eight

An eight-voice, sixteen-oscillator polyphonic analog synthesizer modelled
control-for-control on the **Roland Jupiter-8**. Deep-detail rebuild to the
Seer Six standard (see [`../../REBUILD.md`](../../REBUILD.md)).

- **Name:** Jove Eight · **slug:** `jove-eight`
- **Modelled on:** Roland Jupiter-8 (JP-8)
- **Manual read:** *Roland Jupiter-8 Owner's Manual* — read cover to cover. The
  front-panel diagram and the parameter/specification pages served as the
  completeness checklist.
- **Params:** 47 of 64 host slots (switch groups bit-packed)
- **Polyphony:** 8 voices, 2 VCOs each

## Manual-section → implementation coverage

| Manual section | Implemented |
|---|---|
| VCO-1 (tri/saw/pulse/square, range 16'-2') | ✅ `VCO1 Wave`, `VCO1 Range`, waveform in `VCO Switch` |
| VCO-1 **Cross Mod** (FM'd by VCO-2) | ✅ `VCO1 Cross` — inharmonic sidebands, kills fundamental periodicity |
| VCO-2 (sine/saw/pulse/noise, range, FINE) | ✅ `VCO2 Wave`, `VCO2 Range`, `VCO2 Fine` (±50 cents) |
| VCO-2 **LOW freq** sub-audio mode | ✅ packed in `VCO Switch` |
| VCO **SYNC** (VCO-2 hard-synced to VCO-1) | ✅ packed in `VCO Switch` — slave repeats at master period |
| VCO Modulator: LFO/ENV → VCO-1/BOTH/VCO-2 | ✅ `Mod LFO`, `Mod Env`, freq-dest in `VCO Switch` |
| PWM: MANUAL / LFO / ENV-1 + width | ✅ `Mod PWM` + PWM-source in `VCO Switch` |
| Source Mix (VCO-1 ↔ VCO-2 balance) | ✅ `Source Mix` |
| HPF (non-resonant -6 dB/oct high-pass) | ✅ `HPF Cutoff` |
| VCF cutoff / resonance (self-osc) | ✅ `VCF Cutoff`, `VCF Reso` |
| VCF **-12 / -24 dB/oct SLOPE switch** | ✅ packed in `Filt Switch` — measurable brightness difference |
| VCF Env amount + ENV-1/ENV-2 selector | ✅ `VCF Env` + env-select in `Filt Switch` |
| VCF LFO mod / Key Follow | ✅ `VCF LFO`, `VCF Kybd` |
| VCA level + ENV-2 drive | ✅ `VCA Level` |
| VCA **LFO tremolo** (4-position depth) | ✅ `VCA LFO` |
| ENV-1 ADSR + KEY FOLLOW + **NORMAL/INVERSE polarity** | ✅ `Env1 A/D/S/R`, polarity + kbd in `Filt Switch`/`VCO Switch` decode |
| ENV-2 ADSR + KEY FOLLOW | ✅ `Env2 A/D/S/R` |
| LFO: sine/saw/square/random, rate, **DELAY** | ✅ `LFO Wave`, `LFO Rate`, `LFO Delay` (per-note fade-in) |
| Assigner: POLY-1 / POLY-2 / SOLO / UNISON | ✅ `Assign` |
| Arpeggiator: UP/DOWN/U&D/RANDOM, 1-4 oct, HOLD | ✅ `Arp Mode`, `Arp Range`, `Arp Rate`, hold in `Transport` |
| Portamento (off/on/upper) | ✅ `Porta Time` + mode in `Perf Switch` |
| Bender: VCO / VCF depth + sensitivity | ✅ `Bender`, `Bend VCO`, `Bend VCF` |
| LFO-Mod pad: RISE + VCO/VCF depth | ✅ `LfoMod Rise`, `LfoMod VCO`, `LfoMod VCF`, `LfoMod Push` |
| Master Tune / Volume | ✅ `Master Tune`, `Volume` |

## Bit-packed switch groups

| Host param | Packs |
|---|---|
| `VCO Switch` (0-63) | VCO-2 LOW-freq · SYNC · freq mod-dest (VCO1/BOTH/VCO2) · PWM source (MAN/LFO/ENV1) |
| `Filt Switch` (0-31) | VCF slope (-12/-24) · VCF env selector (ENV-1/ENV-2) · ENV-1 polarity (NORM/INV) · ENV key-follow bits |
| `Perf Switch` (0-127) | Portamento mode (off/on/upr) · bender destinations · misc performance toggles |
| `Transport` (0-3) | Arp on / Arp hold |

The GUI decodes every packed field back into its individual switch.

## Test evidence

- **wasm-runner + `test-params.json`:** `VERDICT: PASS`, **47/47 params ✓ affects**
  (performance state engaged so every routing proves out).
- **wasm-runner + `spec.json`:** `VERDICT: PASS`, rms 0.103, peak 0.392
  (inside the rms ≥ 0.03, peak 0.15–0.5 target). Preview rendered to `preview.wav`.
- **behavior-test.mjs:** **12/12 pass** —
  - SLOPE -12 dB/oct passes more highs than -24 dB/oct
  - CROSS MOD makes VCO-1 inharmonic (periodicity 1.00 → 0.53)
  - SYNC forces slave to master period (corr 0.44 → 0.99)
  - ARP UP starts lower than ARP DOWN; ARP UP/RANDOM produce stepping note motion
  - UNISON detune beats far more than POLY-1 single voice
  - ENV-1 NORMAL polarity brighter on attack than INVERSE
  - LFO DELAY ramps modulation in (early 18 → late 121)
  - PORTAMENTO slews up and settles; off → immediate jump
- **gui-check:** `{"errors":[], "paramsPushedOnReady":47, "paramsTotal":47, "clickablesClicked":60}` → **PASS**.
  Screenshot inspected: clean Jupiter-8-style panel — rainbow accent stripe,
  colour-coded section headers, slider-based controls, bender lever, no overlaps.

## Deviations / simplifications (honest)

- **Whole-mode single patch only.** The Jupiter-8's DUAL / SPLIT two-patch
  keyboard modes and the patch-memory / tape-interface system are host concerns
  and out of scope.
- Cross-mod is an audio-rate FM approximation of the VCO-1-by-VCO-2 modulation,
  not a component model.
- ENV-1 "assignable" routing is implemented for the documented destinations
  (VCO freq, PWM, VCF); it is not a free any-to-any matrix.
- VCF self-oscillation tracks musically but is not lab-calibrated.
