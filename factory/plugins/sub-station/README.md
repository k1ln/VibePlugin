# Sub Station — modern virtual-analog acid bass

**Modeled after:** *Novation Bass Station* (modern VA acid-bass mono) — rebuilt as an original, no trademark in shipped files.
**Type:** Instrument (monophonic synth) · **Params:** 7 · **Samples:** none (pure algorithm)

## What it is
An edgy, modern virtual-analog **bass mono synth** — distinct from the vintage monos by its
slightly digital bite and a built-in **overdrive**. Two oscillators (a saw and a hard-synced
pulse) plus a sub one octave down feed a screaming resonant low-pass with a snappy decay
envelope, then a post overdrive stage for aggressive acid/electro bass and squelchy leads.
In-your-face and modern — not vintage-smooth.

## Signal flow
```
OSC1 saw ┐
OSC2 pulse (hard-synced to OSC1, ratio = 1..3.5×) ┤─► 4-pole resonant LPF ─► overdrive ─► ×Level
SUB square (-1 oct) ┘        cutoff = base + EnvAmt · decayEnv
```
**Osc sync** resets OSC2's phase every time OSC1 wraps; raising **Sync** lifts OSC2's pitch (and
level) to tear out the screaming, formant-sweeping sync edge. **Overdrive** blends soft
saturation with a harder edge for the modern grit. **Resonance** near 1 makes the filter scream.

## Parameters
| # | Name | Range | Default | Effect |
|---|------|-------|---------|--------|
| 0 | Cutoff     | 0–1 | 0.30 | base filter cutoff (70 Hz … ~10 kHz, exp) |
| 1 | Resonance  | 0–1 | 0.72 | filter feedback — squelch into self-oscillation |
| 2 | Env Amount | 0–1 | 0.78 | how far the decay envelope opens the filter |
| 3 | Sync       | 0–1 | 0.45 | osc-sync edge: OSC2 pitch ratio above OSC1 (1…3.5×) |
| 4 | Overdrive  | 0–1 | 0.40 | post grit / drive |
| 5 | Decay      | 0–1 | 0.35 | filter + amp decay (25 ms … ~1.1 s) |
| 6 | Level      | 0–1 | 0.80 | output level |

## GUI
Bespoke matte-black panel with neon green (#3dff9a) / red (#ff3d6a) accents: an animated
osc-sync scope that tears the saw × synced-pulse waveform (brightened by Overdrive, swept by
Cutoff/Resonance), hand-built SVG knobs (drag vertically, wheel to nudge, double-click to reset),
a glowing red overdrive stage, and a two-octave playable keyboard. Self-contained, no external
assets.

## Test result
```
output: rms=0.06925  peak=0.39249  dc=0.00002  nan=0
checks: present=true  finite=true  noClip=true  paramsReactive=true
all 7 params ✓ affect output      VERDICT: PASS ✅
```
Preview render: [preview.wav](preview.wav) (3 s synth riff).
