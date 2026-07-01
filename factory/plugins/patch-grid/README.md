# Patch Grid

A patch-matrix modular voice pushed toward the **EMS Synthi 100**. The Synthi's genius was a pin matrix where *anything patches anything* — oscillators into each other, into the filter, into the ring modulator, into the outputs. Patch Grid recreates that as a **real 7×7 pin matrix**: every source (rows) can be patched into every destination (columns) with an independent amount the audio engine reads **every sample**. Nothing patched to `F·IN`/`OUT` means silence, exactly like a real pin board. Mono, last-note priority.

```
SOURCES ↓  \  DESTINATIONS →
            1FM  2FM  3FM  4FM  CUT  F·IN  OUT
   OSC 1     ·    ·    ·    ·    ·    ●     ●     saw, keyboard-tracked
   OSC 2     ·    ·    ·    ·    ·    ·     ·     sine (Osc2 tune)
   OSC 3     ·    ·    ·    ·    ·    ·     ·     triangle (Osc3 tune)
   OSC 4     ·    ·    ·    ·    ·    ·     ·     pulse (Osc4 tune)
   NOISE     ·    ·    ·    ·    ·    ●     ·     coloured noise
   RING      ·    ·    ·    ·    ·    ·     ●     OSC1 × OSC2
   ENV       ·    ·    ·    ·    ●    ·     ·     trapezoid envelope
```
(● = the default patch: a bright clangorous plucked drone.)

- **FM columns** (`1FM`…`4FM`) frequency-modulate each oscillator (±2 octaves per bus).
- **CUT** is a cutoff CV bus; **F·IN** is the filter's audio input; **OUT** goes straight to the output.
- Control columns (FM, CUT) sum their patched sources as a CV; audio columns (F·IN, OUT) sum them as signal.

## Controls (10 knobs)
| Knob | What it does |
|------|--------------|
| Osc2 / Osc3 / Osc4 | Free-running tune for oscillators 2–4 (~1.5 Hz LFO … ~2.4 kHz audio) |
| Noise | Noise colour (dark → bright) |
| Cutoff | Filter base frequency |
| Reso | Filter resonance (up to near self-oscillation) |
| Attack / Decay | Trapezoid envelope attack + release times |
| Reverb | Spring-style reverb mix |
| Level | Output level |

Plus **49 matrix routes** (`10 + src*7 + dst`) — all host-automatable.

## Design notes
- Four oscillators (saw / sine / triangle / pulse); OSC1 keyboard-tracked, OSC2–4 free-running and able to drop to LFO rates, so they double as modulators.
- Ring modulator (`OSC1 × OSC2`) is a first-class matrix **source** — patch `RING → OUT` for the classic clang.
- Modulation buses use the previous sample's source values, so cross-patched FM stays stable.
- TPT state-variable low-pass with high-Q / near self-oscillation; spring-ish reverb (2 combs + allpass); output DC-blocked and soft-clipped with `tanh`.

## Originality / sources
Original DSP written from scratch in AssemblyScript for VibePlugin. No samples — fully synthesized. The name **Patch Grid** is original; it is *not* affiliated with or endorsed by the makers of any hardware it is inspired by.

## Test
`node factory/tools/wasm-runner.mjs <compiled.wasm> --synth --params factory/plugins/patch-grid/spec.json` → **VERDICT: PASS** (present, finite, no-clip; all 10 knobs + the routed matrix cells reactive).
