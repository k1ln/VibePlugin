# Steel Plate

An original algorithmic **plate reverb** modelled on the classic figure-8 tank
topology. The signal first passes through a chain of input-diffusion all-pass
filters, then drives two cross-coupled, HF-damped delay loops. Several internal
points of the loops are tapped and summed to produce a dense, bright, smooth
stereo tail that builds faster than a hall. Pure algorithm — no samples, no
lookup tables.

## How it works

- **Pre-delay line** — gaps the wet onset from the dry signal (0–120 ms).
- **Input bandwidth one-pole** — tames the very top before diffusion.
- **4 input-diffusion all-passes** — smear the input into a dense wavefront.
- **Figure-8 tank** — two halves, each `modulated all-pass → delay → damping
  low-pass → all-pass → delay`, with the output of each half fed (scaled by
  decay) into the other for the characteristic plate density and long tail.
- **Modulated all-pass taps** — a slow ~0.9 Hz LFO chorus the first all-pass in
  each half, decorrelating the loops and adding plate shimmer.
- **Multi-tap stereo output** — seven fixed taps per channel are read from the
  opposite half's lines, summed and brought up by a makeup gain so the wet sits
  within ~9 dB of the dry at Mix = 1, then dry/wet mixed. Mix = 0 is exactly dry.

> **Stereo note.** Both tank halves are driven by the *same* mono input (the L+R
> average); there is no separate left/right input. The stereo image is generated
> entirely inside the tank — from the quadrature LFO phase on the two modulated
> all-passes and the cross-feedback between the halves — and read out through the
> channel-specific tap sets.

## Parameters

| Index | Name       | Range | Default | Description                                        |
|-------|------------|-------|---------|----------------------------------------------------|
| 0     | Mix        | 0–1   | 0.35    | Dry/wet blend. 0 = fully dry.                      |
| 1     | Decay      | 0–1   | 0.6     | Tank feedback gain → tail length (0.30–0.95).      |
| 2     | Damping    | 0–1   | 0.4     | HF damping per loop pass. 0 = bright tail, 1 = dark (tail spectral centroid drops as the knob rises). |
| 3     | Pre-Delay  | 0–1   | 0.0     | Wet onset delay, 0–120 ms.                         |
| 4     | Modulation | 0–1   | 0.3     | LFO depth on the tank all-passes (shimmer/chorus). |

## Test result

`node factory/tools/wasm-runner.mjs … --seconds 3`

```
output:   rms=0.19006  peak=0.53431  dc=0.00042  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
  [0] Mix          ✓ affects
  [1] Decay        ✓ affects
  [2] Damping      ✓ affects
  [3] Pre-Delay    ✓ affects
  [4] Modulation   ✓ affects
VERDICT: PASS ✅
```

Peak stays well under the 1.5 limit even at maximum decay; output is finite with
no NaNs, and Mix = 0 is bit-faithful dry. The wet signal now sits ~9 dB below the
dry at Mix = 1 (audible at the 0.35 default), and the Damping knob darkens the
tail correctly — the measured tail spectral centroid falls (~3.2 kHz → ~2.2 kHz)
as Damping goes 0 → 1.
