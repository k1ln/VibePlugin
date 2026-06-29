# Reed Piano

A polyphonic **electric reed-piano** instrument, modelled on the warm 1960s
struck-steel-reed school pianos — *not* a tine Rhodes. Each of up to **12 voices**
is a hollow reed-tone oscillator (a strong fundamental with a present 3rd, a
scooped 2nd and a touch of 4th) run through an **asymmetric soft clipper**. The
clipper's drive tracks both the played velocity and a fast per-voice "bark"
envelope, so hard hits **growl and bark on the attack** (even-harmonic, slightly
hard-edged) and then **mellow into a hollow sustain** as the bark envelope
decays. A snappy amp envelope (fast reed attack, adjustable body decay/release),
a one-pole tone tilt, a per-voice DC blocker and a **built-in sine tremolo**
finish the instrument. Pure algorithm — no samples, no host imports, no
allocation in `process()`.

Pitch tracks the played frequency (Hz passed by the host); chords ring out;
output is gain-staged and soft-limited well under full scale.

## Parameters

| Index | Name          | Range | Default | Description |
|-------|---------------|-------|---------|-------------|
| 0 | Bark          | 0–1 | 0.55 | Attack drive — depth of the asymmetric clipping bark on the attack (peak drive ~1.2→9) plus a snappier attack. Hard hits bark, then mellow. |
| 1 | Decay         | 0–1 | 0.55 | Body decay time while a key is held (0.6 s → 6 s); also lengthens the release. |
| 2 | Tone          | 0–1 | 0.50 | One-pole tone tilt low-pass (700 Hz → 7 kHz): mellow and hollow → open and present. |
| 3 | Tremolo Depth | 0–1 | 0.35 | Depth of the global sine amplitude tremolo (0 → ~0.9). |
| 4 | Tremolo Rate  | 0–1 | 0.40 | Tremolo LFO rate (3 Hz → 9 Hz). |
| 5 | Level         | 0–1 | 0.70 | Output level (soft-limited). |

## GUI

A bespoke, self-contained HTML faceplate: a warm walnut cabinet around a mellow
green hammertone faceplate, an animated **reed bank** whose struck reeds swing
wider then decay (and shimmer at idle), a **swaying tremolo lamp** that speeds up
with Tremolo Rate and brightens with Depth, bakelite value-arc knobs (drag /
wheel / double-click reset) and a playable two-octave keyboard (mouse glide +
computer keys A–K). Accent `#8ad0a0` / `#d0e8b0`. No external assets.

## Test result

`node factory/tools/wasm-runner.mjs reed-piano.wasm --params … --synth --seconds 3` → **VERDICT: PASS**

- output: rms=0.26325, peak=0.57993, dc=0.00005, nan=0
- checks: present, finite, noClip, paramsReactive — all true
- every parameter reports `✓ affects`
