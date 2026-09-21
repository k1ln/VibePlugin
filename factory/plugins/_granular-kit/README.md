Shared GUI kit for Nebula Freeze / Prism Shift / Shard Sequencer (knob, segmented, toggle, stepper,
fader widgets; host bridge with onParam restore). Each plugin has `gui.src.html`; regenerate the
self-contained `gui.html` with `node factory/plugins/_granular-kit/build.mjs <slug> …` (inlines kit
CSS/JS and the params from `spec.json`), then run `factory/tools/pack-vstai.mjs`.
