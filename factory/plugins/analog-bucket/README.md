# Analog Bucket — BBD delay / chorus

Models target: **Effects #23 — BBD bucket-brigade model (generic)**.

A generic bucket-brigade delay: short, dark, companded repeats that double as a chorus/vibrato — at
short times + high Mod a lush chorus, at longer times a warm analog echo. Controls: Time, Feedback,
Mod (chorus depth), Tone (BBD darkness), Mix. No samples, no host imports, no alloc in process().
wasm-runner PASS (all 5 reactive); GUI render-checked (0 console errors).
