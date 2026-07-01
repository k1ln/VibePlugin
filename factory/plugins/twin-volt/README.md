# Twin Volt

A fat dual-VCO **monophonic** synth **instrument** (original DSP), in the classic
late-70s mono lineage. Two detuned analog-style oscillators — a **saw** (VCO 1) and
a **pulse** (VCO 2) — plus a **square sub-oscillator** an octave down are summed
and *also* **ring-modulated** against each other. The **Ring** control blends that
clangy, inharmonic, metallic product into the tone for everything from subtle bite
to full bell-like clang.

The mix drives a punchy **4-pole resonant low-pass** with **its own decay envelope**
(Env Amount) for plucky filter sweeps, then an amp envelope. Pitch **glides**
(portamento) between overlapping notes. It is **monophonic** — the newest note steals
the voice — which keeps fat basses tight and leads expressive.

Great for fat basses and clangy metallic leads. Pitch tracks each played note exactly
(the host passes frequency in Hz). Plays via `noteOn(id, freqHz, velocity)` /
`noteOff(id)`.

## Signal path

```
VCO1 saw  ┐
VCO2 pulse├─ dry blend ──┐
square sub┘              ├─ mix ─► 4-pole resonant LPF ─► amp env ─► DC block ─► Level
   VCO1 × VCO2 ─ ring ───┘            ^ cutoff = base · 40^(EnvAmount·filterEnv)
```

- **Detune** offsets VCO 2 upward by up to ~0.6 semitone, thickening the blend.
- **Ring** crossfades the saw×pulse ring-mod product into the mix; as it rises the
  dry oscillators recede slightly so the metallic colour reads clearly.
- The filter feedback path is softly clipped for analog character and stability,
  and the output passes through a DC blocker and a hard ±1 safety clip.

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0 | Cutoff     | 0–1 | 0.45 | Base filter cutoff (~60 Hz → ~11 kHz, exponential) |
| 1 | Resonance  | 0–1 | 0.40 | Filter feedback / Q (near self-oscillation at the top) |
| 2 | Env Amount | 0–1 | 0.60 | Depth of the filter decay envelope on cutoff |
| 3 | Ring       | 0–1 | 0.30 | Ring-modulation blend (metallic / inharmonic colour) |
| 4 | Detune     | 0–1 | 0.30 | VCO 2 detune amount (fattening) |
| 5 | Decay      | 0–1 | 0.45 | Filter + amp decay/release time (~40 ms → ~2.2 s) |
| 6 | Level      | 0–1 | 0.80 | Output level |

## GUI

A slim brushed-silver + cyan chassis. Two motorised-feel **oscillator faders** flank a
glowing **ring-mod halo** where the saw and pulse waves cross into an animated metallic
shimmer that brightens with the Ring amount. Five custom SVG **knobs** (value-arc +
pointer, drag / double-click reset / wheel) cover the filter and voice, and a playable
on-screen **keyboard** (bass register) drives the engine. All controls are wired to
`window.vstai.setParam(index, value)` with real values and initialise to their defaults.

Built for the VibePlugin factory. Modelled in spirit on a dual-VCO mono with ring mod;
this is an original implementation, not a clone.
