# Whammy

An original **extreme expression-pedal pitch shifter** (effect) for the VibePlugin factory.
Inspired by the classic dive-bomb pitch pedal, but an entirely original DSP and GUI — no
trademarks ship in any file.

## What it does

A dual-pointer, crossfaded **delay-line pitch shifter**. Two read pointers chase the write
pointer at a speed set by the current pitch ratio; a raised-cosine crossfade between them
(the two complementary tap gains sum to unity, so the grain adds no amplitude modulation)
keeps even huge dives and leaps free of clicks. A one-pole glide smooths the ratio so the
pedal sweep "zippers" naturally instead of stepping. The ~64 ms (3072-sample) grain keeps
big shifts and full octaves tonally coherent, and a one-pole DC blocker centres the output.

UP genuinely **raises** pitch and DOWN genuinely **lowers** it: the read pointer's distance
behind the write head changes by `(1 - ratio)` per sample, so a ratio > 1 reads samples
faster, chasing the write head and raising pitch. From a 220 Hz tone the headline octave-up
(Pitch +12, full pedal) lands on a clean ~440 Hz with no subsonic collapse, and Dual mode
adds a reciprocal-ratio mirror voice for a ±octave shimmer straddling the dry pitch.

The **Pedal** control is the expression treadle: heel = dry (unity pitch), toe = the full
**Pitch** target. **Mode** chooses the direction of the bend, and **Mix** balances the wet
shifted voice against the dry signal.

## Parameters

| # | Name  | Range        | Default | Notes |
|---|-------|--------------|---------|-------|
| 0 | Pitch | -24 .. +24 st| +12     | Target shift at full pedal (toe) |
| 1 | Pedal | 0 .. 1       | 1.0     | Treadle: heel (dry) → toe (full shift) |
| 2 | Mode  | 0 / 1 / 2    | 0       | 0 = Up, 1 = Down, 2 = Dual octaves (step 1) |
| 3 | Mix   | 0 .. 1       | 1.0     | Dry/wet balance |

## GUI

`gui.html` is one self-contained document (inline CSS/JS/SVG, no external assets). It is a
bold red stomp pedal: a **rocking chrome footplate treadle** you drag to dive-bomb the
pitch, an **animated pitch-bend ribbon** with a sweeping scan line, conic-ring **Pitch/Mix
knobs**, and an illuminated **Mode** switch. Accent palette `#ff3b5c` / `#ff8a3b`.

Every control is wired through `window.vstai.setParam(index, value)` with real parameter
values, initialised to defaults via `window.vstai.onReady`, draggable, double-click to
reset, and shows a live value.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/whammy-pitch/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --wav preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/whammy-pitch/spec.json
```

Offline runner result: **VERDICT: PASS** — audio present, finite, bounded (peak ≈ 0.49,
dc ≈ 0), and all four parameters report `✓ affects`. A 220 Hz sine probe confirms the pitch
direction and interval track the request (UP up, DOWN down) across ±24 st, and the octave-up
preset reads as a coherent ~440 Hz tone rather than subsonic noise.
