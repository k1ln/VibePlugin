# Edge Echo — preamp digital delay

Models target: **Effects #25 — Korg SDD-3000** (programmable rackmount digital delay).

An original bright digital delay with a coloured input **preamp** — the punchy, present "edge"
tone. The preamp adds drive + a presence tilt before clean, slightly bright digital repeats with
a one-pole-damped feedback path and linear-interpolated read for smooth time changes. No samples,
no host imports, no allocation in `process()`.

### Controls
- **Drive** — input preamp drive + presence (clean → punchy/edgy).
- **Time** — delay time, ~20 ms to ~1.2 s (shown in the readout).
- **Feedback** — number of repeats (bounded < 1, stable).
- **Tone** — brightness of the repeats (dark ↔ bright).
- **Mix** — dry/wet.

### Test
`wasm-runner` → VERDICT PASS (present, finite, non-clipping, all 5 params reactive). GUI
render-checked headless (0 console errors). Open `test.html` to play a riff / mic / file through it.
