# Pulse Drums

A hybrid analog + sample drum-machine instrument for VibePlugin.

The **body voices are fully synthesized** analog-style — a pitch-swept decaying
sine + click for the kick, tuned sines plus band-passed noise for the snare, a
pitched decaying sine for the tom. The **metallic voices are real one-shot
recordings**: short CC0 / public-domain percussion samples baked into the
module as base64 Int16-LE PCM (22050 Hz mono) and decoded into f32 buffers at
`init()`. Every incoming note triggers a voice (note number modulo voice
count); faint under-layers keep all controls musically active.

## Voices

| Voice       | Engine     | Source |
|-------------|------------|--------|
| Kick        | synthesized | decaying sine + downward pitch sweep + click |
| Snare       | synthesized | two tuned sines + band-passed noise |
| Tom         | synthesized | pitched decaying sine |
| Closed Hat  | **sample**  | embedded CC0 one-shot |
| Open Hat    | **sample**  | embedded CC0 one-shot |
| Crash       | **sample**  | embedded CC0 one-shot |

## Controls

- **Tune** — global pitch of the synth voices and the sample playback rate (±12 semitones).
- **Kick Decay** — kick body decay length.
- **Snare Snap** — snare noise amount / snappiness.
- **Hat Decay** — decay of the closed/open hat samples.
- **Cymbal Decay** — decay of the crash sample.
- **Tone** — overall brightness (sample high-pass + synth tone).
- **Accent** — master level / hit intensity.
- **Click** — kick click + pitch-sweep transient depth.

## Embedded audio — sources & licenses

All embedded samples are **CC0 1.0 (Creative Commons Zero / public domain
dedication)** and may be used, modified and redistributed for any purpose,
including commercially, without attribution. Sources verified on the Freesound
sound pages at build time.

| Voice       | Source URL | Author | License |
|-------------|------------|--------|---------|
| Closed Hat  | https://freesound.org/people/IanStarGem/sounds/269720/ | IanStarGem | CC0 1.0 |
| Open Hat    | https://freesound.org/people/jannevse/sounds/669732/   | Janne Leimola (jannevse) | CC0 1.0 |
| Crash       | https://freesound.org/people/jannevse/sounds/614383/   | Janne Leimola (jannevse) | CC0 1.0 |

The audio was downloaded from the public Freesound preview CDN, decoded to mono
Int16-LE PCM at 22050 Hz (closed hat ~0.18 s, open hat ~0.49 s, crash ~0.85 s),
trimmed, and base64-encoded directly into `assembly.ts`. The plugin is fully
self-contained — no external files are needed at runtime.

## Build

```sh
# 1. fetch + encode the CC0 samples (already baked into assembly.ts)
node factory/tools/wav-to-b64.mjs chat.mp3  22050 0.5 > chat.b64
node factory/tools/wav-to-b64.mjs ohat.mp3  22050 0.7 > ohat.b64
node factory/tools/wav-to-b64.mjs crash.mp3 22050 1.2 > crash.b64
# (pulse-drums-gen.mjs reads those .b64 files and writes assembly.ts)

# 2. compile + test
node compiler/asc-driver.mjs factory/plugins/pulse-drums/assembly.ts pulse-drums.wasm
node factory/tools/wasm-runner.mjs pulse-drums.wasm --params params.json --synth --seconds 3

# 3. pack
node factory/tools/pack-vstai.mjs factory/plugins/pulse-drums/spec.json
```
