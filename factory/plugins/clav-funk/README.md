# Clav

A polyphonic plucked-string funk-clavier instrument for the VibePlugin factory.

## What it is

Clav is an original 8-voice physical-modelling instrument inspired by the percussive,
springy bite of a 1970s tine-and-string electro-mechanical clavier. Each voice is an
independent **Karplus-Strong string**, so chords ring out with their own natural decays
rather than retriggering a shared engine.

**Per-voice signal path**

1. **Excitation burst** — on note-on a short, velocity-scaled noise burst (its length set
   by Attack) is injected into the string, giving the sharp percussive pluck.
2. **Tuned delay line** — the burst circulates in a fractional (linearly interpolated)
   delay line whose length equals the note's period, so the pitch tracks the played key.
3. **Damping low-pass in the feedback loop** — the loop carries a one-pole low-pass; more
   Damping bleeds off the highs faster for a duller, faster string decay, while the loop
   feedback gain (Decay) sets the overall ring time. Brightness controls how much
   high-frequency content survives in the feedback path.
4. **Magnetic-pickup comb** — a second tap a fraction of a period back is subtracted from
   the line (the Pickup control moves the tap), emulating the hollow comb-filter colour of
   the instrument's magnetic pickup.
5. **Percussive amp envelope** — a very fast attack ramp opens the voice; the string's own
   loop damping provides the natural decay. Lifting the key damps the string with a quick
   fade (the felt-mute behaviour).

Voices are allocated per `noteId` (a free voice first, otherwise the oldest is stolen, with
its delay line cleared). The summed output is level-scaled and passed through a gentle
`tanh` saturator so even dense chords stay below full scale.

## Parameters

| Index | Name       | Range | Default | Description |
|-------|------------|-------|---------|-------------|
| 0     | Attack     | 0–1   | 0.15    | Pluck excitation length (short = sharp snap, longer = softer) |
| 1     | Decay      | 0–1   | 0.55    | String ring time (loop feedback gain) |
| 2     | Brightness | 0–1   | 0.65    | High-frequency content kept in the string / tone tilt |
| 3     | Pickup     | 0–1   | 0.45    | Magnetic-pickup comb tap position (tone colour) |
| 4     | Damping    | 0–1   | 0.30    | Loop low-pass damping (string dullness / faster HF loss) |
| 5     | Level      | 0–1   | 0.70    | Output level |

## GUI

A self-contained 70s funk cabinet: a row of taut, warm-orange strings that vibrate and glow
when plucked (real `requestAnimationFrame` standing-wave animation, brightness/decay-reactive),
an animated "wah-mouth" grille, and a row of hand-built vertical **rocker tabs** — one per
parameter — that you drag (up = increase), double-click to reset, or wheel to fine-tune. A
playable two-octave keyboard (mouse, touch, or the A–K computer keys) drives `noteOn`/`noteOff`.

## Test result

`wasm-runner.mjs --synth --seconds 3` → **VERDICT: PASS**

- output: rms 0.014, peak 0.465, dc ~0, nan 0
- checks: present, finite, noClip, paramsReactive — all true
- all 6 parameters report `✓ affects`
- bounded well under full scale even on dense chords (output saturator guarantees < 1.0)

## Files

- `assembly.ts` — the AssemblyScript DSP (WASM ABI + `noteOn`/`noteOff`)
- `gui.html` — the self-contained animated GUI
- `spec.json` — plugin metadata, theme and parameter map
- `clav.vstai` — packed bundle
- `preview.wav` — rendered preview
