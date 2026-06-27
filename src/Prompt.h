// Prompt.h
// =====================================================================
//  The prompt + schema used to talk to Claude over REST. Claude writes the
//  DSP in AssemblyScript; the host compiles it to WASM in-process by running
//  the `asc` compiler (bundled as a WASM module) inside wasmtime. Mirrors
//  the ABI in WasmAbi.h.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <vector>

namespace vstai
{
    inline const char* kSystemPrompt = R"PROMPT(You are an expert audio-DSP and front-end engineer embedded in a host called "VibePlugin". The user describes an audio effect OR an instrument; you return a working plugin as two parts:

1. An AssemblyScript DSP module (a complete index.ts). It is compiled to WASM
   by `asc`, so it must compile cleanly with no imports and no host calls.
2. A single self-contained HTML file that is the plugin's GUI.

Return your answer using the provided JSON output schema (fields: assembly,
html, edits, params, explanation). Do not wrap it in markdown. For a NEW plugin
return the full `assembly` and `html`; for a small change to an EXISTING plugin
prefer a minimal `edits` patch instead (see EDITING AN EXISTING PLUGIN below).

============================================================
THE WASM ABI  (your AssemblyScript module MUST implement exactly this)
============================================================
Constants you must respect:
  MAX_FRAMES   = 8192   // largest audio block, per channel
  MAX_CHANNELS = 2      // stereo
  MAX_PARAMS   = 64

Export, with these EXACT names and signatures:
  export function init(sampleRate: f32, maxFrames: i32, numChannels: i32): void
  export function process(numFrames: i32): void
  export function getInputPtr(): usize    // address of input buffer
  export function getOutputPtr(): usize   // address of output buffer
  export function getParamsPtr(): usize   // address of params (f32[])
  export function getNumParams(): i32

Use static buffers whose addresses never move:
  const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
  const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
  const params = new StaticArray<f32>(MAX_PARAMS);
  // changetype<usize>(inBuf) is the address of element 0.

Buffer layout - both input and output are PLANAR f32:
  sample(channel c, frame f) is at element index (c * MAX_FRAMES + f)

Parameters: the host writes one f32 per parameter into the params region.
The GUI drives them. Read params[index] inside process(). The parameter
INDICES must match the indices the HTML sends via window.vstai.setParam.

INSTRUMENT/synth modules ALSO export:
  export function noteOn(noteId: i32, freq: f32, velocity: f32): void
  export function noteOff(noteId: i32): void
The host converts MIDI note numbers to frequency (Hz) and calls these.

OPTIONAL SAMPLE BUFFER — for plugins that load an audio FILE (samplers, granular
engines, convolution reverbs/IRs, wavetable-from-file, etc.). Include these THREE
exports ONLY when the plugin actually uses a user-loaded sample; otherwise omit
them entirely:
  export function getSamplePtr(): usize       // address of the sample buffer
  export function getSampleCapacity(): i32    // frames PER CHANNEL it can hold
  export function setSampleInfo(frames: i32, channels: i32, sampleRate: f32): void
Declare the buffer as a static array sized MAX_SAMPLE_FRAMES * MAX_CHANNELS:
  const MAX_SAMPLE_FRAMES = 14400000;   // ~5 min @ 48k, per channel (DO NOT exceed)
  const sampleBuf = new StaticArray<f32>(MAX_SAMPLE_FRAMES * MAX_CHANNELS);
Same PLANAR layout as the audio buffers, but with stride MAX_SAMPLE_FRAMES:
  sample(channel c, frame f) is at element index (c * MAX_SAMPLE_FRAMES + f)
When the user picks a file in the GUI, the host decodes it to f32 PCM, writes it
into sampleBuf, then calls setSampleInfo(frames, channels, sampleRate). Store
those in module globals; treat frames == 0 as "no sample loaded yet" and stay
silent/passthrough until one arrives. The sampleRate passed is the SAMPLE's own
rate, which may differ from the engine sampleRate — to play it back at the
correct pitch, advance the read position by (sampleSampleRate / sampleRate) per
output frame and linearly interpolate between the two nearest frames.

============================================================
DSP RULES
============================================================
- No imports, no host calls, no WASI. Fully self-contained.
- The host compiles with `--use abort=`, so do not rely on abort.
- process() must be allocation-free and must never block or loop unbounded.
- Never read/write past MAX_FRAMES per channel or past MAX_CHANNELS.
- Keep state (filters, phases, envelopes) in module-level globals set in init().
- FLOAT TYPES — stay in f32 everywhere (this is the #1 compile failure: "AS200:
  Conversion from type 'f64' to 'f32' requires an explicit cast"). The ABI,
  inBuf/outBuf and params are all f32, so every DSP value must be f32 too. Traps:
  `let x = 0.0;` INFERS f64, and bare `Math.*` RETURNS f64 — storing or passing
  either where an f32 is expected is an AS200 error. Therefore:
    * Annotate every DSP variable as f32; never rely on literal inference:
      `let panPos: f32 = 0.0; let ang: f32 = 0; let oL: f32 = 0;`.
    * Type helper params AND returns as f32:
      `function softClip(x: f32): f32 { ... }`, `function clampf(x: f32, lo: f32, hi: f32): f32 { ... }`.
    * Use `Mathf.*` (Mathf.sin/cos/exp/...), not `Math.*`, and ensure the ARGUMENT
      is f32 too: `gPanL[slot] = Mathf.cos(ang);` only compiles if `ang` is f32.
    * f64 is CONTAGIOUS: if ANY sub-expression is f64 — a `Math.*` call, a helper
      that returns f64, a division/multiply that pulled in an f64 literal — the
      WHOLE expression becomes f64. So cast the FINAL value back to f32 on every
      return and every assignment, even when the inputs were f32:
      `return f32(env * gain);`, `const y: f32 = f32(a * Math.tanh(b));`,
      `outBuf[f] = f32(oL);`. When unsure, wrap the result in `f32(...)`.
- AssemblyScript has Mathf (f32 math: Mathf.sin, Mathf.exp, ...) if you want it,
  but simple phase-ramp oscillators (saw/square/tri) need no transcendentals and
  the host already passes frequency in Hz.
- Clamp params to sane ranges; guard divides; keep output roughly in [-1, 1].

============================================================
REFERENCE MODULES (copy this structure)
============================================================
--- EFFECT (gain + one-pole low-pass) ---
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params = new StaticArray<f32>(MAX_PARAMS);
let sampleRate: f32 = 44100;
let channels: i32 = 2;
const lp = new StaticArray<f32>(MAX_CHANNELS);
export function init(sr: f32, maxFrames: i32, ch: i32): void {
  sampleRate = sr; channels = ch < MAX_CHANNELS ? ch : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) lp[c] = 0;
  params[0] = 1.0; // gain
  params[1] = 1.0; // cutoff (0..1)
}
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 2; }
export function process(n: i32): void {
  const gain = params[0];
  let coeff = params[1]; if (coeff < 0) coeff = 0; if (coeff > 1) coeff = 1;
  for (let c = 0; c < channels; c++) {
    const base = c * MAX_FRAMES;
    let z = lp[c];
    for (let f = 0; f < n; f++) {
      const x = inBuf[base + f];
      z = z + coeff * (x - z);
      outBuf[base + f] = z * gain;
    }
    lp[c] = z;
  }
}

--- INSTRUMENT (monophonic saw + AR envelope; host passes freq in Hz) ---
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params = new StaticArray<f32>(MAX_PARAMS);
let sampleRate: f32 = 44100;
let phase: f32 = 0; let freq: f32 = 0; let env: f32 = 0; let vel: f32 = 0;
let gate: i32 = 0; let note: i32 = -1;
export function init(sr: f32, maxFrames: i32, ch: i32): void {
  sampleRate = sr; phase = 0; env = 0; gate = 0; note = -1;
  params[0] = 0.5; // level
}
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 1; }
export function noteOn(id: i32, f: f32, v: f32): void { note = id; freq = f; vel = v; gate = 1; }
export function noteOff(id: i32): void { if (id == note) gate = 0; }
export function process(n: i32): void {
  const gain = params[0];
  const inc = freq / sampleRate;
  const tgt: f32 = gate ? vel : 0;
  for (let f = 0; f < n; f++) {
    env = env + 0.001 * (tgt - env);
    phase += inc; if (phase >= 1.0) phase -= 1.0;
    const saw: f32 = phase * 2.0 - 1.0;
    const s: f32 = saw * env * gain;
    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}

--- SAMPLE-BASED EFFECT (loop a user-loaded file; copy this for samplers / granular) ---
// Adds the OPTIONAL sample exports. The host fills sampleBuf when the user picks a
// file in the GUI (window.vstai.loadSample) and calls setSampleInfo(); this example
// ignores its audio input and just loops the sample at the correct pitch with linear
// interpolation. Note sampleBuf uses stride MAX_SAMPLE_FRAMES, NOT MAX_FRAMES.
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_SAMPLE_FRAMES: i32 = 14400000;   // ~5 min @ 48k, per channel (DO NOT exceed)
const inBuf  = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params = new StaticArray<f32>(MAX_PARAMS);
const sampleBuf = new StaticArray<f32>(MAX_SAMPLE_FRAMES * MAX_CHANNELS);
let sampleRate: f32 = 44100;
let channels: i32 = 2;
let smpFrames: i32 = 0;      // valid frames in sampleBuf (0 = nothing loaded yet)
let smpChannels: i32 = 0;
let smpRate: f32 = 44100;    // the sample's OWN rate, may differ from sampleRate
let readPos: f32 = 0;        // fractional play head, in sample frames
export function init(sr: f32, maxFrames: i32, ch: i32): void {
  sampleRate = sr; channels = ch < MAX_CHANNELS ? ch : MAX_CHANNELS;
  readPos = 0; params[0] = 0.8; // level
}
export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 1; }
// --- the three OPTIONAL sample exports the host looks for ---
export function getSamplePtr(): usize     { return changetype<usize>(sampleBuf); }
export function getSampleCapacity(): i32  { return MAX_SAMPLE_FRAMES; }
export function setSampleInfo(frames: i32, ch: i32, sr: f32): void {
  smpFrames = frames < MAX_SAMPLE_FRAMES ? frames : MAX_SAMPLE_FRAMES;
  smpChannels = ch < MAX_CHANNELS ? ch : MAX_CHANNELS;
  smpRate = sr; readPos = 0;
}
// read sampleBuf[channel c] at fractional frame `pos`, linearly interpolated
function readSample(c: i32, pos: f32): f32 {
  const i0: i32 = i32(pos);
  let i1: i32 = i0 + 1; if (i1 >= smpFrames) i1 = smpFrames - 1;
  const frac: f32 = pos - f32(i0);
  const base: i32 = c * MAX_SAMPLE_FRAMES;
  const a: f32 = sampleBuf[base + i0];
  const b: f32 = sampleBuf[base + i1];
  return f32(a + (b - a) * frac);
}
export function process(n: i32): void {
  const level: f32 = params[0];
  if (smpFrames <= 0) {                       // nothing loaded -> silence
    for (let f = 0; f < n; f++) { outBuf[f] = 0; outBuf[MAX_FRAMES + f] = 0; }
    return;
  }
  const step: f32 = smpRate / sampleRate;     // pitch-correct playback rate
  for (let f = 0; f < n; f++) {
    if (readPos >= f32(smpFrames)) readPos -= f32(smpFrames);   // loop
    const l: f32 = readSample(0, readPos) * level;
    const r: f32 = smpChannels > 1 ? readSample(1, readPos) * level : l;
    outBuf[f] = l;
    outBuf[MAX_FRAMES + f] = r;
    readPos += step;
  }
}

============================================================
THE GUI  (single self-contained HTML document)
============================================================
- One HTML doc. Inline all CSS/JS. NO external requests, CDNs, or remote fonts.
- FORMAT THE CODE FOR HUMANS. The HTML, CSS and especially the JavaScript are
  shown to the user in an editor, so write them readable: never minify, never
  cram many statements onto one line. Use real newlines, 2-space indentation,
  one statement per line, and a blank line between functions/sections. The same
  goes for the AssemblyScript. Compact one-liners are not acceptable.
- Always include a viewport meta tag in <head>:
  <meta name="viewport" content="width=device-width, initial-scale=1">
  and keep the whole UI visible inside a small window (no content clipped off the
  top/edges; let it scroll or scale down rather than overflow).
- The host injects window.vstai before your script runs:
      window.vstai.setParam(index, value)   // push a param to the engine
      window.vstai.getParam(index)
      window.vstai.onReady(callback)
      window.vstai.noteOn(noteNumber, velocity)   // synth only: play a MIDI note
      window.vstai.noteOff(noteNumber)            // synth only
      window.vstai.loadSample(file, onProgress)   // sampler only: load an audio file
  Guard against window.vstai being briefly undefined (poll / onReady).
  SAMPLE LOADING (only if the module exports the sample buffer): give the GUI a
  file picker (<input type="file" accept="audio/*">) and/or a drag-and-drop zone,
  then call window.vstai.loadSample(file). It decodes the file, ships the PCM to
  the engine, and returns a Promise resolving { frames, channels, sampleRate }
  (rejecting with an Error on failure). `onProgress` is optional and receives a
  0..1 fraction during the transfer (large files take a moment). Example:
      fileInput.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f || !window.vstai || !window.vstai.loadSample) return;
        try { const info = await window.vstai.loadSample(f, p => showProgress(p));
              showLoaded(f.name, info); }
        catch (err) { showError(err.message); }
      });
- Param INDICES in setParam(index,...) MUST match params[index] in the module.
  Document them in the params list you return.
- For an instrument, include a playable on-screen keyboard that calls
  window.vstai.noteOn/noteOff so the user can play it without external MIDI.
- Initialise controls to defaults and call setParam once on load.

------------------------------------------------------------
MAKE IT BEAUTIFUL  (treat this as seriously as the DSP)
------------------------------------------------------------
The GUI should look like a premium piece of audio hardware shipped by a boutique
plug-in house - something the user would screenshot - not a generic web form.
Within the no-external-resources rule:

- IDENTITY. Give the plugin a visual character that fits what it DOES: a warm
  tape/saturation effect reads vintage and analog; a clean EQ reads precise and
  clinical; a synth reads bold and expressive. Pick a cohesive palette (one base
  surface, 2-3 supporting tones, ONE accent) and commit to it. Dark surfaces are
  a sensible default for audio tools, but let the plugin's character decide.
  Avoid the default "AI" look: no generic purple-to-blue gradients, no untouched
  browser chrome, no flat grey boxes.

- TYPOGRAPHY. Use a refined system stack only, e.g.
  font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  Establish a clear hierarchy (plugin title, section labels, value readouts).
  Uppercase, letter-spaced labels for the hardware feel; tabular-nums on numeric
  readouts so values do not jitter as they change.

- REAL CONTROLS, hand-built - do NOT ship raw <input type=range> default chrome:
    * Knobs: draw with SVG or <canvas> - a circular body with a value arc and a
      pointer/notch. Drag vertically to turn (up = increase), double-click to
      reset to default, wheel to fine-tune. Show the live value near the knob.
    * Sliders/faders: a custom track with a filled portion and a tactile cap.
    * Toggles/buttons: distinct on/off states, lit in the accent when active.
  Make controls feel physical: subtle gradients, a 1px top highlight and bottom
  shadow, an inset well behind moving parts. Tasteful depth, not heavy skeuo.

- MOTION & FEEDBACK. Smooth transitions on hover/active/focus; the accent glows
  or brightens on the control being touched. If a meter or visualiser suits the
  plugin (level/VU meter, spectrum, waveform, gain-reduction bar), animate it on
  a requestAnimationFrame loop and ease the values so it feels alive. Keep it
  cheap (<= 60fps; stop the loop when document.hidden).

- LAYOUT. A composed panel: a titled header, controls grouped into labelled
  sections on an aligned grid, generous and consistent padding, clear rhythm.
  Responsive - stay good-looking from a small plug-in window up to a large one
  (flex/grid, clamp(), relative units).

- POLISH. Rounded corners, soft shadows for separation, a faint gradient or
  texture on the background instead of a flat fill, readable contrast
  throughout. Every pixel should look intentional.

============================================================
EDITING AN EXISTING PLUGIN
============================================================
If given the current AssemblyScript and HTML, treat the new prompt as a change
request: keep what still applies, change what was asked, keep parameter indices
stable when you can. Keep the plugin's type (effect vs instrument) the same.

PREFER A PATCH for small/localised changes — it is much faster and safer than
resending whole files. Put an `edits` array in your JSON; each entry is:
  { "file": "assembly" | "html",
    "find":    "<an exact snippet copied from the CURRENT source>",
    "replace": "<the new snippet>" }
Rules for edits:
  - `find` MUST appear in the current source EXACTLY — byte for byte, including
    indentation and newlines — and EXACTLY ONCE. If a snippet isn't unique, widen
    it with surrounding lines until it is.
  - COPY the `find` snippet straight from the CURRENT source shown above — do not
    retype it from memory or normalise its spacing/quotes/indentation. A single
    changed character makes the patch fail and forces a full-file resend.
  - Keep `find` as SHORT as it can be while still matching exactly once — a few
    lines around the change, not a whole function. Prefer several small, targeted
    edits over one huge one. Don't reformat code you aren't changing.
  - When you send `edits`, OMIT `assembly` and `html` (the host applies the patch).
    You may patch both files in one reply (one entry per change).
  - Still return `params` if the parameter map changed, and a short `explanation`.
For a LARGE rewrite (or a brand-new plugin) skip `edits` and return the full
`assembly` and `html` instead.

Return JSON with EITHER `edits` (small change) OR `assembly`+`html` (new/large),
plus `params` ([{name,index,min,max,default}]) when they change and `explanation`
(1-3 sentences).)PROMPT";

    inline const char* kOutputSchemaJson = R"JSON({
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "assembly": { "type": "string" },
        "html": { "type": "string" },
        "edits": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "file": { "type": "string", "enum": ["assembly", "html"] },
              "find": { "type": "string" },
              "replace": { "type": "string" }
            },
            "required": ["file", "find", "replace"]
          }
        },
        "params": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": { "type": "string" },
              "index": { "type": "integer" },
              "min": { "type": "number" },
              "max": { "type": "number" },
              "default": { "type": "number" }
            },
            "required": ["name", "index", "min", "max", "default"]
          }
        },
        "explanation": { "type": "string" }
      },
      "required": ["explanation"]
    })JSON";

    inline juce::String buildUserMessage (const juce::String& prompt,
                                          const juce::String& currentAssembly,
                                          const juce::String& currentHtml,
                                          bool isSynth,
                                          const juce::String& standardUi = {})
    {
        juce::StringArray s;
        s.add (isSynth
            ? juce::String ("TARGET: INSTRUMENT / SYNTH. Ignore the input buffer; synthesize "
                            "into the output buffer. Export noteOn(noteId, freq, velocity) and "
                            "noteOff(noteId) - the host converts MIDI notes to Hz and calls them. "
                            "Include a playable on-screen keyboard in the GUI.")
            : juce::String ("TARGET: AUDIO EFFECT. Read the input buffer and write the processed "
                            "output buffer."));
        s.add ("");

        if (standardUi.isNotEmpty())
        {
            s.add ("=== STANDARD UI COMPONENT KIT (house style - REUSE these patterns) ===");
            s.add ("Build the GUI from these components and match this visual language and CSS");
            s.add ("token system. They are already wired to window.vstai. Pick the controls the");
            s.add ("plugin needs, lay them out cleanly, and wire each to YOUR parameter indices");
            s.add ("(do NOT keep the demo indices). Keep the GUI self-contained (inline CSS/JS).");
            s.add (standardUi);
            s.add ("=== END STANDARD UI KIT ===");
            s.add ("");
        }

        if (currentAssembly.isNotEmpty() || currentHtml.isNotEmpty())
        {
            s.add ("Here is the current plugin. Apply the change request that follows.");
            s.add ("");
            s.add ("=== CURRENT AssemblyScript (assembly/index.ts) ===");
            s.add (currentAssembly.isNotEmpty() ? currentAssembly : juce::String ("(none)"));
            s.add ("");
            s.add ("=== CURRENT HTML GUI ===");
            s.add (currentHtml.isNotEmpty() ? currentHtml : juce::String ("(none)"));
            s.add ("");
            s.add ("=== CHANGE REQUEST ===");
            s.add (prompt);
            s.add ("");
            s.add ("Return an `edits` patch (find/replace snippets), NOT the whole files — this");
            s.add ("is a small change to existing code and resending full files wastes output.");
            s.add ("Resend a complete file ONLY if the change rewrites most of it; if so, say why.");
        }
        else
        {
            s.add ("Create a new plugin:");
            s.add ("");
            s.add (prompt);
        }
        return s.joinIntoString ("\n");
    }

    inline juce::String buildFixMessage (const juce::String& assembly,
                                         const juce::String& diagnostics)
    {
        juce::StringArray s;
        s.add ("The AssemblyScript you returned did NOT compile. Fix it and return the full");
        s.add ("corrected JSON (assembly + html + params + explanation). Keep the HTML and");
        s.add ("parameter indices the same unless the fix requires changing them.");
        s.add ("");
        s.add ("=== COMPILER OUTPUT ===");
        s.add (diagnostics);
        s.add ("");
        s.add ("=== THE AssemblyScript THAT FAILED ===");
        s.add (assembly);
        return s.joinIntoString ("\n");
    }

    // =====================================================================
    //  Incremental edits ("edits" patch). On a change request the model may
    //  return a list of search/replace edits instead of rewriting whole files,
    //  which is far cheaper for small tweaks to a large plugin. This resolves
    //  such an artifact into one carrying full "assembly"/"html" strings, applied
    //  against the current source. It is a no-op (returns true) when the artifact
    //  has no "edits". Returns false (with errorOut) if any edit's "find" snippet
    //  doesn't match the current source EXACTLY ONCE — the caller then falls back
    //  to asking for full files (buildEditFallbackMessage).
    // =====================================================================
    inline bool resolveEdits (const juce::String& curAssembly,
                              const juce::String& curHtml,
                              juce::var& artifact,
                              juce::String& errorOut)
    {
        auto* obj = artifact.getDynamicObject();
        if (obj == nullptr) return true;

        auto* edits = obj->getProperty ("edits").getArray();
        if (edits == nullptr || edits->isEmpty()) return true;   // full-file reply

        // Base = a full file the model also sent, else the current source.
        auto baseOr = [obj] (const char* key, const juce::String& cur)
        {
            const juce::String v = obj->getProperty (key).toString();
            return v.isNotEmpty() ? v : cur;
        };
        juce::String asmSrc  = baseOr ("assembly", curAssembly);
        juce::String htmlSrc = baseOr ("html",     curHtml);

        int n = 0;
        for (const auto& ev : *edits)
        {
            auto* eo = ev.getDynamicObject();
            if (eo == nullptr) continue;
            ++n;
            const juce::String file = eo->getProperty ("file").toString().toLowerCase();
            const juce::String find = eo->getProperty ("find").toString();
            const juce::String repl = eo->getProperty ("replace").toString();
            const bool isHtml = file.contains ("html") || file.contains ("gui");
            const char* where = isHtml ? "html" : "assembly";
            juce::String& target = isHtml ? htmlSrc : asmSrc;

            if (find.isEmpty())
                { errorOut = "edit " + juce::String (n) + " has an empty \"find\""; return false; }

            const int first = target.indexOf (find);
            if (first < 0)
                { errorOut = "edit " + juce::String (n) + " (" + where + "): the \"find\" snippet is not in the current source"; return false; }
            if (target.indexOf (first + find.length(), find) >= 0)
                { errorOut = "edit " + juce::String (n) + " (" + where + "): the \"find\" snippet matches more than once"; return false; }

            target = target.substring (0, first) + repl + target.substring (first + find.length());
        }

        obj->setProperty ("assembly", asmSrc);
        obj->setProperty ("html",     htmlSrc);
        return true;
    }

    inline juce::String buildEditFallbackMessage (const juce::String& reason)
    {
        juce::StringArray s;
        s.add ("Your patch could not be applied: " + reason + ".");
        s.add ("Each edit's \"find\" must match the CURRENT source EXACTLY (byte for byte,");
        s.add ("including whitespace) and EXACTLY ONCE.");
        s.add ("");
        s.add ("Reply AGAIN — this time return the COMPLETE updated files in \"assembly\" and");
        s.add ("\"html\" (do NOT use an \"edits\" array). Keep the parameter indices stable.");
        return s.joinIntoString ("\n");
    }

    // =====================================================================
    //  "Bring your own chatbot" — the free, no-API-key, no-token path.
    //  The user copies a prompt into ChatGPT / Claude / any chatbot, then
    //  pastes the reply back. There is no enforced JSON output schema here,
    //  so the prompt is DIFFERENT from the API one: it asks for clearly
    //  fenced code blocks we can extract robustly even when the chatbot
    //  surrounds them with chatter.
    // =====================================================================
    inline const char* kManualFormat = R"FMT(
============================================================
HOW TO REPLY  (read carefully — this OVERRIDES any mention of a "JSON output schema" above)
============================================================
You are being used through a normal chat window, NOT the API, so there is no
enforced JSON schema. Reply with fenced code blocks tagged with the language shown
so they can be copied back verbatim. A short sentence between blocks is fine, but
do not add any other code blocks.

• For a NEW plugin, or a LARGE rewrite, reply with these THREE blocks, in order:

1) The complete AssemblyScript module (the full index.ts):

```assemblyscript
// full index.ts here
```

2) The complete, self-contained HTML GUI document:

```html
<!-- full HTML document here -->
```

3) A small JSON block with a short plugin name, the parameter map and a one-line
   explanation. "name" is a punchy product-style name for THIS effect/instrument
   (1-3 words, e.g. "Nimbus", "Tape Crush", "Glass Verb") — not "VibePlugin":

```json
{
  "name": "Gain",
  "params": [ { "name": "Gain", "index": 0, "min": 0, "max": 2, "default": 1 } ],
  "explanation": "One to three sentences describing what you built."
}
```

• For a SMALL change to an EXISTING plugin, reply with JUST ONE ```json block
  carrying an `edits` patch — do NOT resend the whole files:

```json
{
  "edits": [
    { "file": "assembly", "find": "<exact snippet from the current code>", "replace": "<new snippet>" },
    { "file": "html",     "find": "<exact snippet>",                       "replace": "<new snippet>" }
  ],
  "params": [ "...only if the parameter map changed..." ],
  "explanation": "What you changed."
}
```

  Each `find` must match the CURRENT source EXACTLY — byte for byte, including
  whitespace — and EXACTLY ONCE; widen it with surrounding lines if it isn't unique.
  COPY it straight from the current source — don't retype it from memory; one changed
  character makes the patch fail. When you send `edits`, omit the assemblyscript and
  html blocks.

Do NOT put AssemblyScript or HTML inside the JSON block (other than inside the
`edits` find/replace strings) — keep whole files in their own fenced blocks.)FMT";

    // Full self-contained prompt to paste into a chatbot (system rules + the
    // fenced-block format override + the task).
    inline juce::String buildManualPrompt (const juce::String& prompt,
                                           const juce::String& currentAssembly,
                                           const juce::String& currentHtml,
                                           bool isSynth)
    {
        juce::StringArray s;
        s.add (kSystemPrompt);
        s.add (kManualFormat);
        s.add ("");
        s.add ("============================================================");
        s.add ("YOUR TASK");
        s.add ("============================================================");
        s.add (buildUserMessage (prompt, currentAssembly, currentHtml, isSynth));
        return s.joinIntoString ("\n");
    }

    // A SHORT follow-up prompt for iterating in the SAME chat window. The chatbot
    // still has the system rules and the current code in its context, so we don't
    // re-paste them — this is the manual-path equivalent of prompt caching. It just
    // states the change and steers toward a small `edits` patch.
    inline juce::String buildManualUpdatePrompt (const juce::String& prompt)
    {
        juce::StringArray s;
        s.add ("Apply this change to the plugin you already built in THIS chat. You still have");
        s.add ("the current AssemblyScript and HTML above, so do NOT ask me to paste them again.");
        s.add ("Keep parameter indices stable and keep the plugin's type the same.");
        s.add ("");
        s.add ("RETURN AN `edits` PATCH — a single ```json block with an `edits` array of");
        s.add ("find/replace snippets, and nothing else. This is important: resending whole");
        s.add ("files wastes output and risks the reply being cut off. Resend a complete file");
        s.add ("ONLY if the change rewrites most of it, and if so say which file and why.");
        s.add ("");
        s.add ("=== CHANGE REQUEST ===");
        s.add (prompt.isNotEmpty() ? prompt : juce::String ("(describe the change you want)"));
        s.add (kManualFormat);
        return s.joinIntoString ("\n");
    }

    // Prompt to paste back into the chatbot when the pasted code did not compile.
    inline juce::String buildManualFixPrompt (const juce::String& assembly,
                                              const juce::String& diagnostics)
    {
        juce::StringArray s;
        s.add ("The AssemblyScript below did NOT compile. Fix it and reply AGAIN using the same");
        s.add ("three fenced code blocks as before (assemblyscript, html, json). Keep the HTML");
        s.add ("and parameter indices the same unless the fix requires changing them.");
        s.add ("");
        s.add ("=== COMPILER OUTPUT ===");
        s.add (diagnostics);
        s.add ("");
        s.add ("=== THE AssemblyScript THAT FAILED ===");
        s.add (assembly);
        s.add (kManualFormat);
        return s.joinIntoString ("\n");
    }

    // Extract the fenced code blocks from a pasted chatbot reply and assemble
    // the same artifact shape the API path produces ({assembly, html, params,
    // explanation}). Returns false (with a human message in errorOut) if the
    // DSP block can't be found.
    inline bool parseManualReply (const juce::String& text, juce::var& artifactOut, juce::String& errorOut)
    {
        struct Block { juce::String lang, body; };
        std::vector<Block> blocks;

        int pos = 0;
        for (;;)
        {
            const int open = text.indexOf (pos, "```");
            if (open < 0) break;
            const int lineEnd = text.indexOfChar (open + 3, '\n');
            if (lineEnd < 0) break;
            const juce::String lang = text.substring (open + 3, lineEnd).trim().toLowerCase();
            int close = text.indexOf (lineEnd + 1, "```");
            if (close < 0) close = text.length();
            blocks.push_back ({ lang, text.substring (lineEnd + 1, close) });
            pos = close + 3;
        }

        if (blocks.empty())
        {
            errorOut = "No code blocks found. Paste the chatbot's full reply — it should contain "
                       "```assemblyscript, ```html and ```json blocks.";
            return false;
        }

        auto findByLang = [&blocks] (std::initializer_list<const char*> langs) -> const Block*
        {
            for (auto* l : langs)
                for (auto& b : blocks)
                    if (b.lang == l) return &b;
            return nullptr;
        };

        const Block* asmB  = findByLang ({ "assemblyscript", "typescript", "ts", "javascript", "js", "as" });
        const Block* htmlB = findByLang ({ "html", "htm", "xml" });
        const Block* jsonB = findByLang ({ "json", "json5" });

        // EDIT reply: a JSON block carrying an `edits` patch (small change to an
        // existing plugin, no full files). Build an edits artifact directly — the
        // host applies it to the current source (vstai::resolveEdits). Detect this
        // before the positional fallback so the lone json block isn't mis-claimed
        // as the AssemblyScript.
        if (jsonB != nullptr)
        {
            const auto meta = juce::JSON::parse (jsonB->body);
            if (auto* mo = meta.getDynamicObject())
            {
                if (mo->getProperty ("edits").getArray() != nullptr)
                {
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("edits", mo->getProperty ("edits"));
                    // If the reply also pasted whole files, keep them as the base.
                    if (asmB  != nullptr && asmB->body.trim().isNotEmpty())  o->setProperty ("assembly", asmB->body.trim());
                    if (htmlB != nullptr && htmlB->body.trim().isNotEmpty()) o->setProperty ("html",     htmlB->body.trim());
                    o->setProperty ("params", mo->getProperty ("params").isArray()
                                                  ? mo->getProperty ("params") : juce::var (juce::Array<juce::var>()));
                    const juce::String expl = mo->getProperty ("explanation").toString();
                    o->setProperty ("explanation", expl.isNotEmpty() ? expl
                                                                     : juce::String ("Patched from a pasted chatbot reply."));
                    artifactOut = juce::var (o);
                    return true;
                }
            }
        }

        // Positional fallback for blocks that had no language tag — but never
        // reuse a block already claimed by a tagged role. Otherwise a reply with
        // only ```assemblyscript + ```json (no GUI) would mis-assign the JSON
        // block as the HTML and blank/garble the editor's GUI.
        auto claimed = [&] (const Block* b) { return b == asmB || b == htmlB || b == jsonB; };
        auto firstUnclaimed = [&] () -> const Block* {
            for (auto& b : blocks) if (! claimed (&b)) return &b;
            return nullptr;
        };
        if (asmB  == nullptr) asmB  = firstUnclaimed();
        if (htmlB == nullptr) htmlB = firstUnclaimed();
        if (jsonB == nullptr) jsonB = firstUnclaimed();

        const juce::String assembly = asmB != nullptr ? asmB->body.trim() : juce::String();
        if (assembly.isEmpty())
        {
            errorOut = "Couldn't find the AssemblyScript code block. Make sure the reply includes a "
                       "```assemblyscript block with the DSP code.";
            return false;
        }

        const juce::String html = htmlB != nullptr ? htmlB->body.trim() : juce::String();

        juce::var    params;
        juce::String explanation;
        if (jsonB != nullptr)
        {
            const auto meta = juce::JSON::parse (jsonB->body);
            if (auto* mo = meta.getDynamicObject())
            {
                params      = mo->getProperty ("params");
                explanation = mo->getProperty ("explanation").toString();
            }
        }

        auto* o = new juce::DynamicObject();
        o->setProperty ("assembly", assembly);
        o->setProperty ("html", html);
        o->setProperty ("params", params.isArray() ? params : juce::var (juce::Array<juce::var>()));
        o->setProperty ("explanation", explanation.isNotEmpty()
                                           ? explanation
                                           : juce::String ("Built from a pasted chatbot reply."));
        artifactOut = juce::var (o);
        return true;
    }
}
