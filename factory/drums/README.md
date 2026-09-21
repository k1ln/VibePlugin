# Drum machines and string instruments

Twenty-eight instruments built from shared, tested sources. `build.mjs` pastes the
sources for each plugin into one `assembly.ts` + `gui.html` + `spec.json` under
`factory/plugins/<slug>/` (a `.vstai` carries one source file), so a single-voice
plugin is the *same* model as that voice inside the full machine.

```sh
node factory/drums/build.mjs                  # all 28 → factory/plugins/*
node factory/drums/build.mjs bridgewell-kick  # one
node factory/drums/build.mjs --pack           # + pack .vstai (→ docs/gallery/data)
node factory/tests/instruments/run.mjs        # behavioural suites
node scripts/build-gallery.mjs                # refresh the gallery index
```

Parameter definitions (`*/defs.mjs`) are the single source of truth: build.mjs
generates the DSP's `P_*` constants and `setDefaults()`, the GUI's parameter table
and the spec from them. `registry.mjs` lists every plugin.

## Families

| Family | Modelled on | Plugins |
|---|---|---|
| **Bridgewell** | Roland TR-808 | Bridgewell 80 (full machine, 60 params) · Kick · Snare · Toms (toms/congas) · Rim & Claves · Clap & Maracas · Cowbell · Cymbal · Hats · **Bass** (the pitched "808") |
| **Warehouse** | Roland TR-909 | Warehouse 909 (61 params) · Kick · Snare · Toms · Rim · Clap · Hats · Crash · Ride |
| **Silverbox** | Roland TR-606 | Silverbox 606 (33 params) · Kick · Snare · Toms · Cymbal · Hats |
| strings | — | **Tessitura** (physically modelled section) · **Aleatora** (aleatoric textures) · **Colossus** (hybrid trailer strings + ostinato) |

Single-voice plugins exist because VibePlugin has no multi-out: one voice per
plugin is how you give a kick its own mixer channel. Voices that interact stay
together (open + closed hat, so the choke works; toms with their conga switches).

## Sources

- **808:** Operation Manual (read in full); *TR-808 Service Notes*, Jun 1981 —
  circuit descriptions and the "typical and variable" adjustment chart (amplitude,
  frequency, decay per voice); Werner, Abel & Smith, *A Physically-Informed,
  Circuit-Bendable, Digital Model of the Roland TR-808 Bass Drum Circuit*, DAFx-14.
- **909:** Owner's Manual (read in full); *TR-909 Service Notes* (voice circuits,
  PCM cymbal architecture); Sound On Sound *Synth Secrets* (bass/snare synthesis).
  The hat/crash/ride ROM data is **our own**, synthesised at load and played through
  the 909's 6-bit, ~30 kHz, zero-order-hold path (closed hat = first third of the
  open hat's sample, as in the address table).
- **606:** Owner's Manual (read in full); *TR-606 Service Notes*; Baratatronix
  (metal oscillator frequencies, band-passes); Robin Whittle's 606 mod notes. No
  per-voice chart exists for the 606's BD/SD/toms — those are set by ear.
- **Strings:** the bowed string is the McIntyre–Schumacher–Woodhouse waveguide as in
  Cook & Scavone's STK `Bowed`, with loop-delay compensation so it is in tune within
  2 cents from 41 Hz to 1.7 kHz.

## What was measured (808 vs the service-note chart)

Voice levels match the chart's relative voltages; BD decay 39/277/812 ms against
50/300/800 at short/mid/long; toms and congas within 1–3 % of the chart
frequencies; claves 2.50 kHz; cymbal 356/811/1174 ms against 350/800/1200; open
hat 89/467/558 against 90/450/600; accent 3.1× against the chart's 2.9×. The BD
pitch sighs from about +14 % to 56 Hz over ~450 ms, more on accents (DAFx-14).

## Gotchas learned here

- **AssemblyScript types a binary expression by its LEFT operand.** `0.4 * x` is
  f64 even when `x` is f32 → AS200. Put the f32 first or annotate (`const y: f32 =`).
- **`init()` must reset every voice's playing state** (active flags, envelopes) — a
  voice still ringing at the end of one render otherwise leaks into the next init
  (and false-positives every parameter sweep).
- **Apply parameters in `noteOn` too** — a note can arrive before the block's
  `process()`; the first hit otherwise uses the class defaults.
- **Seed the noise in `init()`** or sweeps compare different noise and every param
  looks "reactive".
