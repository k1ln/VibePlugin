# Modal Strike

A general-purpose modal resonator instrument for VibePlugin: excite it and it
rings like a struck bar, a bowed rod, a blown tube, or a plucked string — one
shared physical-modeling algorithm, not a dedicated instrument model. Inspired
by the "hit/bow/blow anything" idea behind modern modal-synthesis Eurorack
modules — an original implementation, no code or samples borrowed.

Distinct from `pluckwork` (a single dedicated waveguide plucked-string model
tuned for guitar/harp/koto/sitar): Modal Strike is the general resonator —
metal, glass, wood, membrane, string — via six parallel damped bandpass
resonators, not a delay-line waveguide.

## Parameters

| Exciter | Character | Envelope shape |
|---|---|---|
| Strike | fast, bright noise burst (mallet) | one-shot, decays in ~tens of ms |
| Bow | continuous, low-passed noise, sustained while the note is held | continuous |
| Blow | continuous, high-passed breath noise, sustained | continuous |
| Pluck | slower, softer noise burst | one-shot, decays over ~hundreds of ms |

- **Structure** morphs the six resonator partials from a plain harmonic stack
  (1,2,3,4,5,6×) to a stretched, inharmonic bell/bar series (1, 2.4, 3.8, 5.3,
  6.9, 8.6×).
- **Position** emulates striking/plucking at a point along the body: partial
  `k` is weighted by `|sin(π·(k+1)·position)|` — the same node-suppression a
  real struck/plucked string or bar shows at different contact points.
- **Brightness** tilts how much *extra* damping the upper partials get beyond
  the base ring length; **Damping** sets that base ring length via each
  resonator's own Q (there's no separate decay multiplier bolted on top — the
  resonator's own feedback loss *is* the decay, unlike an earlier, buggy
  version of Engine Eight's Modal engine that made exactly this mistake).

Shared underneath: Octave/Glide, a standard ADSR (Strike/Pluck rely on the
resonator's own natural ring — leave Release generous to hear it out, rather
than the envelope choking it early), an LFO routable to Structure/Brightness/
Position, and the same Level/Pan/Width output stage as Engine Eight.

## Verification notes

- `pitch-check.mjs` confirms accurate pitch-tracking (ratio ~1.00, periodicity
  1.00) for Strike and Pluck once Damping is raised enough for the ring to
  still be audible at the tool's fixed ~250 ms measurement point — at the
  *default* (medium) Damping, a Strike/Pluck hit has often already decayed
  below the tool's rounding precision by 250 ms, which reads as `peak 0.000`
  even though it isn't literally zero (confirmed by raising Damping to 1.0
  and re-measuring: `ratio 1.000`, small but clearly nonzero peak). The full
  `wasm-runner.mjs` render (which samples the sound across its whole natural
  envelope, not one fixed snapshot) shows healthy peak/rms with no clipping.
- Bow and Blow (continuous, noise-driven excitation into 6 simultaneously
  ringing resonances) show lower autocorrelation *periodicity* confidence
  (~0.2–0.5) than the one-shot engines — expected for a continuously-excited,
  noisy resonant system, not a bug: isolating Structure=0 (pure harmonic) and
  Position near 0 (favoring the fundamental) brings the measured ratio back
  to ~1.00, confirming the fundamental is genuinely present and dominant;
  the lower confidence score reflects real spectral richness, not mistracking.

## Build / test

```sh
node factory/tools/scaffold.mjs modal-strike --pack
node factory/tools/pitch-check.mjs /tmp/modal-strike.wasm --freq 220 --set "0=0,3=1.0"
node factory/tools/persist-check.mjs factory/plugins/modal-strike
```

Verdict: **PASS** on both the default and test-params render (20/20 params,
no clipping, no NaNs, all params reactive); persist-check PASS.
