Hi,

I've built something that might be worth a short piece: VibePlugin,
a VST3 that generates other VST3 plugins while your DAW is running.

You describe an effect or a synth in plain language, and it writes the
DSP code and the interface, compiles it, and loads it live in the host.
A few seconds later you're turning knobs on a plugin that didn't exist
when you started. You can keep talking to it to refine the sound, edit
the generated code by hand, and roll back to any earlier version.
Finished plugins export as standalone VST3s that run offline, with no
AI involved at playback.

Under the hood it's JUCE 8; the generated DSP is AssemblyScript compiled
to WebAssembly and sandboxed with wasmtime, and the GUI runs in an
embedded WebView. Nothing is installed on the user's machine to compile
it, and there are Linux builds.

Free and open source under AGPL, for Windows, macOS and Linux. It works
without any API key if you paste prompts into the Claude web chat, or
you can use your own key for one-click generation.

Demo: https://k1ln.github.io/VibePlugin/
Downloads: https://k1ln.github.io/VibePlugin/releases.html
Gallery: https://k1ln.github.io/VibePlugin/gallery/index.html
Source: https://github.com/k1ln/VibePlugin

Happy to send screenshots, a demo video, or answer anything. 

Best regards,
Kilian