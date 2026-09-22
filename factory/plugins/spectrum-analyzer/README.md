# Spectrum Analyzer

A 16-band real-time spectrum display for VibePlugin. Audio passes through
completely unaltered — safe to drop on a master bus without changing the
sound — except for Input Trim, a real pre-analysis gain stage.

## Why 16 bands

This plugin format's only DSP→GUI telemetry channel is `getDisplayPtr()`: a
fixed `StaticArray<f32>(16)`, read by the GUI via `onDisplay()` at ~30 Hz
(`src/WasmAbi.h:71-75`, confirmed live in `src/BridgeShim.h:227-229`). 16
bands is the real ceiling this format provides, not an arbitrary choice —
which is also why several real hardware spectrum displays land in the same
10-31 band range.

Rendering reuses the scaffold's built-in `viz: "bars"` display
(`factory/tools/scaffold.mjs:131`) — a 16-bar canvas already wired to read
straight from the `onDisplay` payload, so no bespoke GUI code was needed.

## DSP: two design iterations, both driven by actually measuring the output

1. **First pass** used a single-stage, `sin()`-based Chamberlin SVF bandpass
   per band (the same math as `vowel-filter`'s formant bank). A sine sweep
   (100 Hz – 12 kHz) showed the correct band lighting up, but *every* band
   below it was also near-saturated — a 100 Hz tone read almost as loud at
   12 kHz, 7 octaves away.
2. Suspected the naive `sin()`-based SVF's known inaccuracy as centre
   frequency approaches Nyquist (my top band is 16 kHz at 48 kHz) and
   switched to a topology-preserving (`tan()`-prewarped) SVF — the
   Simper/Cytomic formulation (`g=tan(pi·fc/sr)`, `a1=1/(1+g·(g+k))`,
   `a2=g·a1`, `a3=g·a2`, bandpass output = `v1`). **Re-measuring showed
   almost no change** — so that wasn't the actual cause.
3. The real cause: a single 2nd-order resonant bandpass only rolls off
   ~6 dB/octave *per side* far from centre — nowhere near steep enough for
   16 adjacent log-spaced bands to look separated. **Fix**: cascade two
   identical stages per band (4-pole, ~12 dB/octave per side). Re-measured:
   far bands now correctly read the display floor (was ~-43 dB at 7.5
   octaves out for a single stage; now clamps at the -60 dB floor within
   2-3 bands of the peak).
4. Cascading two resonant stages also multiplies the resonant gain
   (~`Q²` for two identical `Q=5` stages), which was pinning 3 adjacent
   bands at the display ceiling simultaneously and hiding which one was the
   true peak — fixed by dividing the gain back out (`mag / (Q·Q)`) before
   the dB conversion.

Verified with a 440 Hz / 1 kHz / 4 kHz sine sweep after each change — see the
before/after dB tables below (Tilt=0, flat, for a clean readout):

| Input | Before (single-stage) | After (cascaded, gain-corrected) |
|---|---|---|
| 440 Hz | 3 adjacent bands tied at 0 dB, no clear peak | clean single peak at band 5 (440 Hz), 0 dB, next bands -19/-19 dB |
| 1 kHz | 3 adjacent bands tied at 0 dB | clean single peak at band 7 (950 Hz), 0 dB, next bands -17/-21 dB |
| 4 kHz | 4 adjacent bands tied at 0 dB | clean single peak at band 11 (4400 Hz), -0.6 dB, next bands -15/-24 dB |

Band magnitudes are dB-normalised (-60..0 dB → 0..1) before display so the
bars read as log amplitude, matching how a real analyzer looks, rather than
linear magnitude (which would make quiet bands invisible). Tilt adds up to
+4.5 dB/octave of high-band boost so broadband/pink-ish material reads flat,
same idea as the tilt control on real hardware analyzers.

## Build / test

```sh
node factory/tools/scaffold.mjs spectrum-analyzer --pack
node factory/tools/persist-check.mjs factory/plugins/spectrum-analyzer
```

Verdict: **PASS** on both renders (5/5 params, no clipping, no NaNs);
persist-check PASS. Band-separation verified by direct sine-sweep
measurement (see table above), not just "it printed numbers."
