# Vocal Plate — studio plate reverb

Models target: **Effects #3 — EMT 140** (studio plate reverb).

The classic bright, dense vocal/snare plate — brighter and longer than the factory's algorithmic
Dattorro plate (Steel Plate). An input diffusion chain (four series allpasses) feeds a
lightly-modulated figure-of-eight tank (two allpasses + two long delays with HF damping) for a
lush, shimmering metallic-to-smooth tail. No host imports, no allocation in `process()`.

### Controls
- **Mix** — dry/wet (Mix = 0 is dry).
- **Decay** — tail length (tank feedback).
- **Tone** — HF damping (dark ↔ bright).
- **Pre-Delay** — gap before the plate (0–120 ms).
- **Size** — plate size (tank delay lengths).

### Test
`wasm-runner` → VERDICT PASS (present, finite, non-clipping peak ~0.73, all 5 params reactive).
GUI render-checked headless (0 console errors).
