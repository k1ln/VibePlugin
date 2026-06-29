# Drip Tank

A **drippy outboard spring-reverb tank** — the long, boingy *surf-amp* spring
sound, not a tight studio plate. Three parallel spring lines run in parallel;
each is a **chain of dispersive allpass filters** (high frequencies arrive
before low ones, the physical cause of the chirpy "drip" and flutter) feeding a
short, lightly damped delay loop. A built-in transient detector fires an
**excitation burst** into the tank, so hard hits audibly *boing*. Feedback is
bounded well below unity and the loop is soft-saturated, so the tank rings and
drips but never runs away or clips.

## How it works

- **Three parallel spring lines** — each line is an 8-stage dispersive allpass
  chain into a power-of-two delay loop. The loop lengths (~21 / 27.5 / 34 ms)
  are deliberately close-but-distinct so the boings repeat at related rates,
  giving the characteristic clustered "tank" smear. The lines are weighted
  unevenly (`1.0 / 0.82 / 0.66`) for a wider, more uneven spring character.
- **Dispersion = the drip** — the allpass coefficients alternate sign and step
  in magnitude, and each spring is slightly detuned, so different frequencies
  are delayed by different amounts. That frequency-dependent delay is exactly
  what produces the chirpy "boinggg" sweep of a real spring tank.
- **Excite / Boing** — a fast/slow envelope pair detects attacks; a positive
  transient fires a short (~40 ms) decaying burst that is injected into the tank
  in addition to the steady send. **Boing** scales the burst gain, so percussive
  input drips hard while sustained input is gentler.
- **Tone** tilts the tank from dark to bright by moving both the loop-damping
  low-pass (~2.2–7.2 kHz) and the wet output low-pass (~1.8–8 kHz) together.
- **Dwell** sets the send/level into the tank; **Decay** maps to a clamped loop
  feedback of `0.45–0.97`. A pre high-pass (~140 Hz) keeps low end out of the
  springs, and the wet sum is trimmed (`×0.42`) so peaks stay below ~1.0.
- **Bounded** — feedback is strictly `< 1`, the loop value is hard-limited at
  `±1.5` and cubically softened; `Mix = 0` is dry passthrough.

## Parameters

| Index | Name  | Range | Default | Description                                                  |
|-------|-------|-------|---------|--------------------------------------------------------------|
| 0     | Mix   | 0–1   | 0.35    | Dry/wet blend (`0` = dry)                                    |
| 1     | Dwell | 0–1   | 0.55    | Send / level into the spring tank                            |
| 2     | Boing | 0–1   | 0.50    | Transient excitation / drip intensity                        |
| 3     | Tone  | 0–1   | 0.45    | Dark → bright (loop damping + wet low-pass)                  |
| 4     | Decay | 0–1   | 0.50    | Tail length (clamped loop feedback `0.45–0.97`)              |

## GUI

A top-down view of the spring tank set in a worn surf-amp tweed cabinet with an
orange faceplate, leather handle and a **DRIP** lamp. Three metal springs wobble
and shimmer continuously and flash brighter when the tank is struck; the lamp
lights on a boing. All five knobs are draggable (vertical, Shift = fine),
scroll- and arrow-key adjustable, and double-click to reset. The animation reads
`getWetPeak()` / `getBoing()` telemetry from the DSP when the host exposes it,
and falls back to a gentle idle breathe otherwise.
