# Tape Choir

A tape-replay keyboard for the VibePlugin factory. Each key plays a sustained,
sampled string-ensemble voice that is pitch-tracked to the note, looped with a
crossfade for endless sustain, and shaped by an ADSR, tape wow/flutter, a tone
low-pass and gentle tape saturation. 8-voice polyphony.

The voice is **embedded directly in the plugin** as base64 Int16-LE PCM and
decoded into an f32 buffer at `init()` — the `.vstai` is fully self-contained
and needs no external sample files.

## Parameters

| # | Name    | Description |
|---|---------|-------------|
| 0 | Attack  | Fade-in time of each note (5 ms .. ~2.5 s). |
| 1 | Release | Fade-out time after key release (30 ms .. ~3 s). |
| 2 | Tone    | Brightness — low-pass cutoff of each voice. |
| 3 | Flutter | Tape wow/flutter depth (subtle per-voice pitch wobble). |
| 4 | Drive   | Tape-style saturation amount. |
| 5 | Tune    | Global tuning, -12 .. +12 semitones. |
| 6 | Level   | Output level. |

## Embedded sample — source & license

- **File:** ARP-Solina Sustain clean.ogg
- **Source page:** https://commons.wikimedia.org/wiki/File:ARP-Solina_Sustain_clean.ogg
- **Direct file:** https://upload.wikimedia.org/wikipedia/commons/d/db/ARP-Solina_Sustain_clean.ogg
- **Author:** MFbay (Wikimedia Commons)
- **License:** **Public Domain** — the copyright holder released the work into
  the public domain worldwide ("I release this work into the public domain.
  This applies worldwide.").

### What was used / how it was processed

The original is a 46 s demo of an ARP Solina String Ensemble playing a held
F4 (~350 Hz) across its Viola/Violin/Horn registers. A clean, steady ~1.1 s
sustain window (14.55 s .. 15.65 s) was extracted, gently leveled, downmixed
to mono and resampled to 22050 Hz, then encoded to base64 PCM and baked into
`assembly.ts`. At runtime it is looped (with an ~80 ms crossfade) and
pitch-shifted (`rate = freq / 350 Hz`) so one note covers the whole keyboard.

No trademarked names are used in any shipped file; "Tape Choir" is an original
name and the design is a generic tape-replay keyboard.
