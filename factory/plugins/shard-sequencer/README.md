# Shard Sequencer

16-step granular slice / ratchet / glitch sequencer — 63 params (15 global + 16 × Slice, Pitch, Flags).

Audio is captured into a rolling (or **Hold**-frozen) buffer cut into 16 slices across a 1/2/4/8-beat
window. Steps fire *shards* (Hermite-read, raised-cosine-faded grains, 12-voice pool):

- per step: **Slice** (0 = rest, 1 oldest … 16 newest), **Pitch** ±24 st, **Reverse**, **Ratchet** ×1–4, **Gate** 25–100 %
  (Flags is bit-packed: bit0 reverse, bits1-2 ratchet−1, bits3-4 gate index)
- global: Tempo, Steps, Division (1/4 1/8 1/16 1/32 1/8T), Swing, Capture, Hold, Chance, Jitter, Fade,
  Tone, Crush, Spread, Duck (dry gate while shards play), Mix, Level
- **Clock:** locked to the DAW playhead via the ABI `transport(playing, ppq, bpm)` hook (swing applied
  statelessly from ppq); falls back to a free-running clock at host tempo (param 63) / the Tempo param
  when the transport is stopped or the host reports none.

Tests: VERDICT PASS, all 63 params reactive. Timing harness (dry-subtracted): step 1 alone fires at
0/2/4 s at 120 bpm 1/16; step 5 at 0.5/2.5/4.5 s; Steps=4 loops every 0.5 s; DAW transport at 60 bpm
from ppq 0.5 fires at 3.5 s; ratchet ×4/×2 at 25 % gate show 4/2 evenly spaced bursts inside one step.
