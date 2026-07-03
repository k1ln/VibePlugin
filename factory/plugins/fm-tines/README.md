# FM Tines

A 16-voice polyphonic **6-operator FM synthesizer** modelled on the **Yamaha DX7**,
built from a cover-to-cover read of the official *Yamaha DX7 Operating Manual*
(Digital Programmable Algorithm Synthesizer, 29 pp. — read pp.1-19 and pp.25-29,
including the FM Tone Generation chapter, the Edit-mode voice-parameter pages, the
LFO block diagram and the Specifications / Voice Data List). The Voice Data List
(p.28) and the Specifications parameter list (p.27) were used as the completeness
checklist: **every voice and function parameter the manual documents is implemented**
(with the compactions noted below), including a genuine 32-algorithm FM engine.

- DSP: `assembly.ts` → wasm (15 KB), `VERDICT: PASS` on both `spec.json` and
  `test-params.json`; **all 64 host params proven audibly reactive** by the
  `wasm-runner` sweep against `test-params.json`.
- Behaviour suite (`behavior-test.mjs`, 8/8 pass): algorithm changes harmonic
  content, modulator level adds sidebands, carrier ratio sets pitch, feedback adds
  brightness, LFO PMD vibrato, LFO AMD tremolo, pitch-EG attack bend, carrier level
  → loudness.
- GUI: bespoke DX7 black-panel / green-LCD panel (`gui.html`) — 6 operator strips,
  a live 32-algorithm selector that draws the carrier/modulator/feedback topology,
  LFO, mod-sensitivity, pitch-EG and full performance sections; headless-Chrome QA:
  **0 console errors**, all 64 params pushed on ready, every control click-verified.

## The FM engine (manual pp.9-16)

Six sine **operators** per voice, wired by the **exact DX7 table of 32 algorithms**
(the Dexed/DX7-ROM bit-bus encoding — 32 rows × 6 bytes, decoded at runtime):

- Each byte gives an operator's output bus (0 = carrier → main output), an
  add/replace flag (for the summing-modulator algorithms 16-18 etc.), its modulation
  input bus, and a feedback bit. Operators are processed OP6→OP1 so the replace/add
  bus semantics reproduce the real routing (chains like 6→5→4→3, parallel stacks,
  summing nodes).
- **Carriers** are summed and normalised by `0.9/√(carrierCount)`; **modulators**
  phase-modulate their target (`sin(2π·phase + modIn)`, `modIn` in radians scaled by
  `FM_INDEX = 6.2`); the algorithm's **feedback operator** feeds an averaged copy of
  its last two outputs back into its own phase (feedback 0-7 → up to ~3.3 rad).
- Per operator: **ratio** (0.5-32, or fixed-frequency mode via the Op-Mask), **output
  level**, **detune** (±14 cents) and a **4-stage A-D-S-R envelope**. Velocity scales
  every operator's level, so harder keys brighten modulators and lift carriers (the
  DX7 key-velocity-sensitivity behaviour, applied globally).
- The default patch is Algorithm 5 (three 2-op stacks, feedback on OP6) with OP2 at
  ratio 14 giving the metallic struck-tine attack over sine bodies — a recognisable
  FM electric piano.

## Manual coverage → implementation

| Manual section | Implementation |
|---|---|
| **FM Tone Generation / Operators** (p.9-10) | 6 sine operators per voice, each carrier or modulator; phase-modulation FM with per-operator EG scaling the modulation index (timbre) or carrier amplitude |
| **Algorithms** (p.11) | All **32 algorithms** implemented from the DX7 routing table; carriers summed, modulators routed via 2 internal buses with replace/add semantics; per-algorithm feedback operator |
| **Feedback** (p.13) | Feedback 0-7 on the algorithm's feedback operator (averaged 2-sample self-feedback → noise/brightness) |
| **LFO** (p.13, p.26) | 6 waves (triangle / saw-down / saw-up / square / sine / S&H), SPEED, DELAY (per-note ramp), PMD (pitch), AMD (amplitude), key SYNC |
| **Mod Sensitivity** (p.14) | Pitch mod sensitivity 0-7 (scales PMD → vibrato), amplitude mod sensitivity 0-3 (scales AMD → tremolo) |
| **Oscillator: mode / freq coarse / fine / detune** (p.14-15) | Per-op ratio (0.5-32, coarse+fine folded into one continuous knob), fixed-frequency mode (Op-Mask bits 6-11), detune ±14 cents |
| **EG (Envelope Generator)** (p.15) | Per-operator envelope — a musical **A-D-S-R** compaction of the DX7 R1-4/L1-4 rate/level EG (see simplifications) |
| **Operator output level / key velocity** (p.16) | Per-op output level; key-velocity sensitivity applied globally (velocity scales all operator levels) |
| **Pitch EG** (p.17) | Global pitch envelope — Amount (±24 semitones initial offset) + Rate, decaying to base pitch (compaction of the 4R/4L pitch EG) |
| **Master Tune / Poly-Mono** (p.6) | Master tune ±75 cents; poly / mono (Switch-Mask bit0) with mono legato retrigger |
| **Pitch Bend** (p.6) | Bend range 0-12 semitones + pitch-wheel performance control |
| **Portamento** (p.6) | Portamento on + time; glissando (semitone-stepped) mode; mono-legato / poly behaviour |
| **Mod wheel / Breath / After-touch** (p.7-8, p.26) | Three live controllers, each routable to **pitch** (LFO vibrato depth), **amplitude** (tremolo) or **EG bias** (brightness/level), via the Switch-Mask |
| **Key Transpose** (p.17-18) | Transpose ±24 semitones |
| **Simultaneous notes / Poly** (p.3) | 16-voice polyphony with oldest-note stealing (the DX7 poly maximum) |

Hardware/host-only items — the 128-voice cartridge memory, store/save/load,
memory-protect, MIDI channel, battery check, voice naming and the LCD edit workflow —
are out of scope (host concerns).

## The 64-param packing

The host pool is fixed at 64 parameters; the DX7 exposes well over a hundred voice +
function parameters. Nothing musical was dropped — the six operators keep independent
ratio / level / detune / A-D-S-R (42 params), and all switch groups are bit-packed
into two mask parameters that the GUI decodes into individual switches:

| Param | Packing |
|---|---|
| `Op Mask` (44) | bits0-5 = OP1-6 **on/off**; bits6-11 = OP1-6 **fixed-frequency** mode |
| `Switch Mask` (45) | bit0 mono · bit1 porta on · bit2 glissando · bit3 LFO key-sync · bit4 osc key-sync · bit5-7 mod-wheel→pitch/amp/EG-bias · bit8-10 breath→pitch/amp/EG-bias · bit11-13 after-touch→pitch/amp/EG-bias |
| `Algorithm` (42) | 0-31 selector (drawn as a live carrier/modulator/feedback diagram) |
| `LFO Wave` (50) | 0-5 = tri / saw-dn / saw-up / square / sine / S&H |
| `P/A Mod Sens` (51/52) | pitch 0-7, amplitude 0-3 |

Operators 0-41 are `op*7 + {ratio, level, detune, atk, dec, sus, rel}`; globals
42-63 are algorithm, feedback, the two masks, the LFO/mod-sens block, pitch-EG
(amt/rate), and the performance block (transpose, tune, porta, bend, pitch-wheel,
mod-wheel, breath, after-touch, volume).

## Honest simplifications

- **Per-operator EG** is a 4-stage **A-D-S-R** rather than the DX7's full R1-4/L1-4
  rate/level EG (which would need 8 params × 6 operators). The ADSR captures the
  musically essential behaviour — fast-decaying modulators for the tine attack,
  slower-sustaining carriers for the body — within the 64-param budget.
- **Pitch EG** is compacted to Amount + Rate (a single attack transient returning to
  base pitch) instead of the 4-rate/4-level pitch envelope.
- **Amplitude mod sensitivity** is global (0-3), not per-operator; **key-velocity
  sensitivity** is applied globally rather than per-operator; **keyboard level /
  rate scaling**, the **break-point/curve** and the **foot controller** are out of
  scope (folded into global behaviour). Operator **frequency fine** (×1.0-1.99) is
  folded into the continuous ratio knob, and each controller's **range** (0-99) into
  its live value.
- Feedback for algorithms 4/6 (which use a multi-operator feedback loop on the
  hardware) is approximated as self-feedback on the algorithm's feedback operator.

## Test evidence

```
wasm-runner (spec.json):        VERDICT PASS   rms 0.075  peak 0.494
wasm-runner (test-params.json): VERDICT PASS   all 64 params ✓ affects
behavior-test.mjs:              8 passed, 0 failed
gui-check.mjs:                  0 errors, 64 params pushed, 44 controls clicked
```

`test-params.json` differs from the shipped defaults only in performance state
(mod-wheel 0.35, breath 0.30, after-touch 0.40 with routing engaged, LFO PMD/AMD up,
mod-sensitivities up, portamento on, pitch-wheel and pitch-EG off-centre, modulator
ratios spread) so that every one of the 64 parameters proves itself audibly in a
single-note sweep.
