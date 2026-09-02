# VibePlugin

**Describe an audio plugin in a sentence. Get a working one back.**

VibePlugin is two VST3 plugins for your DAW — an effect (**VibePlugin FX**) and a
synth (**VibePlugin Synth**) — that have no fixed sound of their own. You type a
prompt like *“a warm tape saturator with drive and tone”*, and Claude writes the
audio code **and** the interface on the spot. A few seconds later you have a real
plugin with real knobs, playing in your project. Don’t like it? Tell it what to
change and it rewrites itself.

Every plugin you make saves to a small `.vstai` file you can reopen, share, or
turn into a standalone plugin to hand to someone else. Once a plugin is made, it
runs entirely offline.

![A generated VibePlugin GUI](docs/screenshots/gui.png)

- **Website & downloads:** <https://k1ln.github.io/VibePlugin/>
- **All releases:** <https://github.com/k1ln/VibePlugin/releases>
- **Try creations in your browser first:** the [gallery](https://k1ln.github.io/VibePlugin/gallery/) plays shared plugins live
- **This tutorial, with screenshots:** <https://k1ln.github.io/VibePlugin/tutorial.html>

---

## Contents

**Tutorial** — [1. Install](#1-install-it-and-make-your-daw-see-it) ·
[2. FX or Synth](#2-fx-or-synth--which-one-on-what-track) ·
[3. Connect it to an AI](#3-connect-it-to-an-ai) ·
[4. Your first plugin](#4-make-your-first-plugin) ·
[5. The window](#5-the-plugin-window-part-by-part) ·
[6. Writing prompts](#6-writing-prompts-that-actually-work) ·
[7. Refining](#7-refining-and-the-history-timeline) ·
[8. Living in your DAW](#8-living-in-your-daw) ·
[9. Saving & sharing](#9-saving-recall-and-what-your-project-stores) ·
[10. Design styles](#10-design-styles) ·
[11. Editing by hand](#11-editing-the-code-by-hand) ·
[12. Publishing & export](#12-publishing-the-gallery-and-standalone-export) ·
[13. Troubleshooting](#13-troubleshooting)

**For developers** — [Architecture](#architecture) ·
[The bundled compiler](#how-assemblyscript-gets-compiled-no-toolchain-on-your-machine) ·
[Generation paths](#generation-paths-internals) ·
[The `.vstai` file](#the-vstai-file) ·
[Build & run](#build--run) ·
[Layout](#repository-layout) ·
[Limits](#notes--limits) ·
[License](#license)

---
---

# Tutorial

> **Read this first:** VibePlugin doesn’t contain an AI — it writes plugins by
> asking one, so nothing will generate until you’ve picked how it should reach a
> model. There are three ways and one of them is free: **Claude in your browser**
> (copy a prompt out, paste the reply back — no key, no card), **your own
> Anthropic API key**, or **VibePlugin Cloud credits**.
> [Step 3](#3-connect-it-to-an-ai) sets each one up.

---

## 1. Install it, and make your DAW see it

VibePlugin is a **VST3 plugin**. It loads in any DAW that supports VST3 (FL
Studio, Ableton Live, Reaper, Bitwig, Studio One, Cubase, and others).

### Download

Grab the build for your system from the
[Downloads page](https://k1ln.github.io/VibePlugin/releases.html) or straight
from [GitHub Releases](https://github.com/k1ln/VibePlugin/releases/latest):

| System | File | Notes |
|---|---|---|
| **macOS** | `VibePlugin-<version>-macos.zip` | Apple Silicon & Intel |
| **Windows** | `VibePlugin-<version>-windows.zip` | Windows 10 / 11, 64-bit |
| **Linux** | `VibePlugin-<version>-linux.zip` | x86-64 |

### Unzip and copy the `.vst3` bundles into your VST3 folder

| System | Folder |
|---|---|
| macOS | `~/Library/Audio/Plug-Ins/VST3` |
| Windows | `C:\Program Files\Common Files\VST3` |
| Linux | `~/.vst3` |

On macOS a `.vst3` is a **folder that looks like a file** — copy the whole thing,
don’t open it and copy the contents.

### Rescan plugins in your DAW

They show up as **VibePlugin FX** (effect) and **VibePlugin Synth** (instrument).
A DAW only looks for new plugins when you tell it to:

| DAW | Rescan |
|---|---|
| FL Studio | *Options ▸ Manage plugins ▸ Find plugins* |
| Ableton Live | *Preferences ▸ Plug-Ins ▸ Use VST3* — toggle, or *Rescan* |
| Reaper | *Preferences ▸ Plug-ins ▸ VST ▸ Re-scan* |
| Bitwig | *Settings ▸ Locations ▸ Plug-ins ▸ Scan* |
| Studio One | *Preferences ▸ Locations ▸ VST Plug-ins*, then rescan |
| Cubase | *Studio ▸ VST Plug-in Manager ▸ Update* |

> **Logic Pro can’t load it.** Logic is AU-only and VibePlugin is VST3. There is
> no AU build.

### If it still doesn’t appear

- **macOS quarantine.** Downloads are tagged by the system. Current releases are
  signed and notarized, but if the Mac refuses: right-click the `.vst3` ▸
  **Open**, or run
  `xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/"VibePlugin FX.vst3"`
- **Windows:** use `C:\Program Files\Common Files\VST3`. Anywhere else, add that
  folder to your DAW’s VST3 search paths.
- **32-bit hosts won’t work.** VibePlugin is 64-bit only.
- **Blocklists.** If a DAW ever failed to scan it, it may have permanently
  blocklisted it. Clear the blocklist and rescan — this is the single most common
  reason a correct install stays invisible.

> **No toolchain required.** You do not need Node, Python, a compiler, or
> anything else — and there is no license key or activation. Everything needed to
> turn AI-written code into a running plugin ships inside VibePlugin itself.

---

## 2. FX or Synth — which one, on what track

The download contains **two separate plugins**. They share the same editor and
the same AI, but your DAW treats them completely differently, and picking the
wrong one is the most common reason a first attempt makes no sound.

| | **VibePlugin FX** | **VibePlugin Synth** |
|---|---|---|
| Type | Audio effect | Instrument |
| Goes on | An audio / mixer track that already has sound running through it | An instrument track you play with MIDI |
| Audio in | Stereo in, stereo out | None — it generates sound |
| Responds to MIDI notes | No | Yes |
| Ask it for | Saturators, delays, reverbs, compressors, filters, distortion, choruses, bitcrushers, transient shapers… | Synths, drum machines, samplers, pad generators, arpeggiators, noise boxes… |

Both are **stereo**. A mono track feeds the same signal to both channels, which
is fine — but there is no mono-only or multi-out version, and **no sidechain
input**. If you want a ducking effect, ask for an envelope follower on the main
input rather than a sidechain.

### Getting notes into VibePlugin Synth

It’s an ordinary instrument: put it on an instrument track, point a MIDI clip or
your keyboard at that track, and play. The host converts note numbers to
frequency for the generated code, so anything it makes is playable across the
whole keyboard.

- **FL Studio** — loads into a Channel Rack slot; draw notes in its piano roll.
- **Ableton Live** — drop it on a MIDI track; arm the track to play live.
- **Reaper** — add it as the first FX on a track, arm for MIDI input and enable
  input monitoring.

Generated interfaces often include an on-screen keyboard too, handy for
auditioning without arming anything.

> **No sound from the Synth?** Check the track is actually receiving MIDI before
> blaming the plugin. And on a fresh, ungenerated instance there is no instrument
> yet at all — the window shows a style demo, not a playable synth, until you
> generate something.

---

## 3. Connect it to an AI

This is the one piece of setup VibePlugin can’t do for you. The plugin is the
workshop — the AI is what actually writes the DSP and the interface — so until
you’ve told it how to reach a model, **Generate** has nothing to ask.

VibePlugin itself is free and open source. What can cost money is the AI, and
even that is optional. You pick between three routes with the **Generation
source** setting and the **Model** dropdown.

| | What you need | Cost |
|---|---|---|
| **Route 1 — your own Anthropic API key** | A key from [console.anthropic.com](https://console.anthropic.com) | You pay Anthropic directly. Nothing goes through us. |
| **Route 2 — Claude in your browser** | A free [claude.ai](https://claude.ai) account, Opus recommended | **Free.** Copy the prompt out, paste the reply back. |
| **Route 3 — VibePlugin Cloud credits** | An account — click **Account**, sign in | **Pay-as-you-go credits, bought from us.** No key to manage. |

**Not sure? Start with route 2.** It costs nothing, needs no key and no signup,
every feature works through it, and you can try the plugin properly before
deciding whether the one-click routes are worth it. Use **route 1** if you
already have an Anthropic API key. **Route 3** exists only for people who want
neither a key nor the copy-paste step.

### What’s in the Model dropdown

The dropdown shows the models for whichever generation source is selected.

| Anthropic (your key) | |
|---|---|
| Fable 5 | most capable · 2× price |
| Opus 5 | best value · the default |
| Sonnet 5 | cheaper and faster |

| VibePlugin Cloud (credits) | |
|---|---|
| Cloud · Haiku 4.5 | cheapest, good for small edits |
| Cloud · Sonnet 5 | the balanced choice |
| Cloud · Opus 4.8 | best results on complex plugins |

There’s also a **Thinking** control: Low / Medium / High / Max. More thinking
gives better results on complicated plugins and costs more; **Medium** is a
sensible default. Big, elaborate interfaces are worth generating with the
strongest model.

### Route 1 · Your own Anthropic API key

1. **Get a key** at [console.anthropic.com](https://console.anthropic.com). It
   looks like `sk-ant-…`. You’ll need some credit on that Anthropic account.
2. **Open Settings** and paste it in, with **Generation source** set to *My own
   Anthropic API key*.
3. **Pick a model and generate.** That’s the whole loop from now on. Requests go
   straight from the plugin to Anthropic; nothing passes through us.

### Route 2 · Claude in your browser, free

This route needs **no API key and no card**. VibePlugin writes the prompt for
you; you paste it into [claude.ai](https://claude.ai) and paste the reply back.
Every feature of the plugin works this way.

> **Use Claude, and prefer Opus.** The plugin’s button says “chatbot”, but in
> practice this route only works reliably with Claude — **Opus** is what
> VibePlugin is built and tested against, and what the prompt is written for. The
> reply has to be three complete code blocks of working AssemblyScript DSP, and
> other assistants routinely truncate them, reformat them, or return code that
> won’t compile. If a paste keeps failing to build, the model is the first thing
> to change.

1. **Type your description, then press *Copy to chatbot*.** A dialog opens with a
   complete, self-contained prompt already copied to your clipboard.
2. **Paste it into Claude.** Open a *new* conversation at
   [claude.ai](https://claude.ai), pick **Opus**, and paste. The prompt asks for
   three fenced code blocks — the audio code, the interface, the parameter list.
   Let it finish; these replies are long.
3. **Copy the whole reply back** into the big box in the dialog. You don’t need
   to pick the code blocks out — VibePlugin finds them. If the answer got cut
   off, ask it to continue and use **Three parts** mode to paste each block.
4. **Press *Apply & build*.** VibePlugin extracts the code, compiles it, and
   loads the plugin exactly as if it had called an API. If it doesn’t compile,
   the dialog gives you a **Copy fix request** button — paste that into the
   *same* conversation and try again.

> **Keep the same chat open.** To refine a plugin later, use the same
> conversation — Claude still has the context of what it built, so “make the tone
> darker” works the way you’d expect.

### Route 3 · VibePlugin Cloud credits

The convenience option: one-click generation, no API key to manage. Requests run
on our key and are billed against a prepaid balance.

1. **Click *Account* and sign in.** Your remaining credits show in the header.
2. **Buy credits.** With an empty balance, **Buy credits** opens a checkout page.
3. **Choose a *Cloud ·* model and generate** as normal.

**What a generation actually costs.** It is *not* a subscription and *not* a flat
fee per prompt. You buy a balance up front, and each generation costs an amount
based on how much work the AI did — how long the code and interface came out, how
much the model had to think, and which model you picked. That’s a wide spread: a
simple effect sits near the bottom of the range, an elaborate synth with a large
interface can go well past the top.

| What | Roughly |
|---|---|
| 1 credit | $0.01 |
| **A complete plugin** | about **$0.40 – $1.50** (40–150 credits), and more for an elaborate one |
| A small edit (“make the tone darker”) | considerably less |
| Haiku 4.5, the cheapest | the bottom of that range |
| Opus 4.8, the strongest | the top of it, and past it on complex plugins |

Packs are bought through our payments provider (Polar) — that’s the “pay website”
you saw. After every generation the plugin tells you what it charged and what
your balance is. If you run out, generation pauses until you top up — **plugins
you already made keep working**, and so does everything else in the app.

> **You never have to pay us anything.** Routes 1 and 2 have every feature route 3
> has. Cloud credits exist purely so you can skip both the API key and the
> copy-paste step.

---

## 4. Make your first plugin

With a route from [step 3](#3-connect-it-to-an-ai) set up, you’re ready.

1. **Add VibePlugin FX** to an audio track that’s playing something — a drum loop
   or guitar part is ideal, because you’ll hear the effect immediately.
2. **Describe the plugin you want** in the box at the top, in plain language. Be
   specific about the *controls* — that’s what becomes the knobs:
   `a warm tape saturator with drive, tone and a wow-and-flutter control`
3. **Press Generate** (or `Cmd`/`Ctrl`+`Enter` — a plain `Enter` adds a new line,
   so you can write a long description without setting a build off half-way
   through). It asks the AI for the audio code and an interface, compiles the
   result, and loads it live. Usually a few seconds to about a minute.
4. **Play your track and turn the knobs.** The interface is live and wired to the
   audio, and your DAW can automate the knobs.
5. **Save it.** **Save** writes a small `.vstai` file anywhere on disk. Your DAW
   project also stores the plugin, so reopening the session brings it back.

> **Nothing to lose.** If a generation comes out wrong, the plugin you had before
> keeps playing until the new one compiles successfully — and every version is
> kept in **History**, so you can always go back.

---

## 5. The plugin window, part by part

You can ignore most of this and still make plugins; it’s here for when you want
to know what a particular button does.

### The header

| | |
|---|---|
| **VibePlugin v0.4.9** | The version badge is the exact build the DAW loaded. Worth checking after an update — DAWs sometimes keep an old copy cached. |
| **Settings** | API keys, generation source, design school, diagnostics. |
| **Account** | Only for the paid cloud route. With your own key or the Claude copy-paste route you never need it. |
| **Hide editor ▴** | Collapses the generator away so the window shows just your plugin’s interface, like a normal plugin. This is how you’ll want it once a plugin is finished. |

### The prompt row

| | |
|---|---|
| **Generate** | Builds (or edits) the plugin using the selected model. `Cmd`/`Ctrl`+`Enter` does the same. |
| **Copy to chatbot** | The free route. Builds a complete prompt, copies it, and opens the paste-back dialog. Despite the label, paste it into **Claude** — see [route 2](#route-2--claude-in-your-browser-free). |
| **Use Settings design** | When ticked, the design school from Settings is described to the AI so new interfaces match that house style. Untick it for a one-off with a strong visual idea. |

### The toolbar

| | |
|---|---|
| **New** | Clears the current creation. Save first if you want to keep it. |
| **Save / Load** | Writes or reads a `.vstai` — the whole plugin in one small portable file. |
| **Gallery** | Browses the online gallery from inside the plugin and loads any example straight into this instance. The fastest way to hear what it can do, and to study prompts that worked. |
| **Publish** | Uploads your creation to the public web gallery. |
| **Export plugin…** | Bakes the current creation into its own standalone, locked `.vst3`. |
| **Model** | Which AI writes the code. |
| **Thinking** | How long the model reasons before answering. |

### The status line

Tells you what’s happening — *Generating…*, *Compiling…*, *Ready.* — and after a
cloud generation, what it charged. When a model has been thinking, a **▸ See
reasoning** link appears; that’s often the quickest way to understand why you got
something you didn’t expect.

### The tabs

**GUI** (your plugin’s live interface) · **DSP (AssemblyScript)** and **GUI
HTML** (full code editors) · **Notes** (the model’s explanation and the latest
compiler errors) · **History** (every version) · **Standard UI** (the house
component kit) · **Settings**.

---

## 6. Writing prompts that actually work

This is the part that decides whether you get something great or something
disappointing. The model writes real audio code from scratch — the more precisely
you describe it, the less you’ll have to fix afterwards.

**Name the controls you want.** The single highest-value habit. Controls you name
become knobs; controls you don’t name get guessed at, or baked in as fixed values
you can’t change afterwards.

| Vague | Specific |
|---|---|
| `make it sound warm` | `a tape saturator with Drive (0–100%), a Tone tilt-EQ knob, Wow & Flutter depth, and a Mix knob for parallel blending` |
| You have no idea which parameters you’ll be able to adjust — and “warm” means five different things. | Four named knobs, each doing a thing you can hear. |

**Say what the ranges and units are.** `a delay time knob from 20 ms to 2 seconds,
with a tempo-sync switch` gets a usable range; “a delay knob” might get you
0–100 ms and nothing useful. Those ranges become the ranges your DAW automates
over.

**Describe the sound, not just the category.** Reference points work well — the
model knows what famous gear is supposed to sound like. `a bucket-brigade style
analogue delay: dark repeats that get murkier each pass, gentle wow on the delay
line, self-oscillates when feedback goes past 90%` gives it far more to work with
than “an analogue delay”.

**Ask for the interface you want.** The look is generated too: `lay it out as
three big knobs in a row with a VU meter above them`, `vintage cream-and-brown
faceplate with chunky metal knobs`.

**Build in layers.** Don’t specify a 30-knob synth in one prompt. Refinements are
faster, cheaper and much more likely to land:

1. **Core** — `a two-oscillator subtractive synth with a resonant lowpass filter, ADSR envelope, and detune between the oscillators`
2. **Character** — `add an LFO that can modulate pitch or filter cutoff, with rate and depth knobs and a destination switch`
3. **Polish** — `add a simple stereo chorus after the filter with a bypass switch, and make the whole panel darker with amber accents`

### Things worth knowing before you ask

- **Tempo sync works.** Your DAW’s BPM is fed to the audio code every block, so
  `delay time synced to the host tempo, in note values` is reasonable to ask for.
- **Samplers can load your own audio.** Ask for a sampler, granular engine or
  convolution reverb and the interface can include a file picker or drop zone.
  Roughly five minutes of stereo audio fits.
- **Up to 63 knobs.** The hard limit on automatable parameters.
- **Stereo in, stereo out.** No sidechain, no multi-out, no surround.
- **It can’t call the internet or read your disk.** Generated code runs in a
  sandbox — which is also why a finished plugin is safe to hand to someone else.

> If a result is wrong, **say what’s wrong — don’t start over.** “The filter
> resonance crackles at high settings” gets a targeted fix. Pressing **New** and
> rewriting throws away a working starting point.

---

## 7. Refining, and the History timeline

The prompt bar doesn’t go away. Send another line — *“add wow and flutter”*,
*“make the tone control darker”*, *“give it a VU meter”* — and it edits the plugin
you already have instead of starting over.

**History** keeps every successful version on an append-only timeline: generate,
AI-fix and hand-compile alike. Pick any entry and **Restore** to load it — engine,
GUI and editors all roll back. Generating again after stepping back branches from
there. The last ~25 snapshots ride along in the `.vstai` file and the DAW session.

---

## 8. Living in your DAW

Once a plugin exists it’s an ordinary VST3 and your DAW treats it like one.

### Automation

Every knob is exposed as a real, automatable plugin parameter. Move a knob in the
interface and the DAW sees it move, so automation recording, parameter learn and
“last touched” mapping all work normally. One quirk is worth understanding:

| | |
|---|---|
| The parameter list always has **64 slots** | VibePlugin can’t know in advance how many knobs your plugin will have, so it publishes a fixed pool at load time. |
| Unused slots are called **Param 1…Param 64** | Placeholders. Ignore them — they do nothing. |
| Used slots take the **real knob names** | After a generation the first slots are renamed to *Drive*, *Tone*, *Mix*… in interface order. |
| The last slot is **reserved** | Slot 64 carries your DAW’s tempo into the plugin. Not automatable — which is why the real ceiling is **63 knobs**. |

To automate *Drive*, look for a parameter actually called *Drive*. The quickest
route in most DAWs is to touch the knob and use *add automation for last touched
parameter*.

- **Renaming needs a refresh in some DAWs.** Names change the moment you
  generate, and a few hosts cache the old list until you reopen the plugin window
  or the project. The automation itself still points at the right control.
- **Regenerating changes the mapping.** Automation follows the *slot*, not the
  name. Refinements that only add controls are safe; a full rebuild is not. If a
  project depends on written automation, save the `.vstai` and stop regenerating
  that instance.

### MIDI control

Because the knobs are normal parameters, your DAW’s own MIDI-learn does the job.
VibePlugin needs no MIDI mapping layer of its own.

### Rendering, bouncing and freezing

A generated plugin renders offline exactly like it plays live, with no internet.
Two things to know:

- **Very large buffer sizes.** The engine handles blocks up to 8192 samples. If a
  host hands it something bigger — which some do during offline bounce — the
  plugin passes audio straight through instead of processing it. **If a bounce
  sounds dry when live playback didn’t, drop your buffer size and render again.**
- **Latency.** The plugin doesn’t report latency compensation, so align
  inherently-delaying effects (lookahead limiting) by hand.

### CPU

The audio code runs in a sandboxed WebAssembly engine — fast, but expect somewhat
more CPU than a hand-optimised native plugin doing the same job. If a specific
plugin is heavy, say so in the prompt (`this uses too much CPU, simplify the
oversampling`).

---

## 9. Saving, recall, and what your project stores

Two independent places your creation lives:

| Where | What happens |
|---|---|
| **Inside your DAW project** | Automatic. The entire plugin — audio code, interface, parameter values — is stored in the project file, the way a normal plugin stores its preset. Reopen the session and it comes back. You don’t need to save a file separately just to keep working. |
| **A `.vstai` file** | Manual, via **Save**. A small portable file you can back up, reuse in another project, or send to someone else running VibePlugin. This is your only copy that survives independently of the project — there is no hidden library and no cloud backup. |

> **Save the ones you love to `.vstai`.** A creation that exists only inside one
> DAW project is one corrupted project file away from gone.

**When you reopen a project** the sound comes back exactly as you left it. One
cosmetic caveat: some generated interfaces redraw their knobs at their design-time
positions until you touch one, even though the sound is already correct. Nudging a
control resyncs the display — the audio is never wrong, only the drawing can lag.

**Sharing a `.vstai`:** anyone with VibePlugin can **Load** it — no key, no
account, no internet, and nothing regenerates. To give a plugin to someone who
*doesn’t* run VibePlugin, use **Export plugin…** and hand them a real `.vst3`.

---

## 10. Design styles

Every interface is built from a house component kit that comes in **ten visual
styles** — minimal, vintage analog, brutalist, neon, glassmorphism and more. Pick
one in **Settings**; it becomes the live look and is also described to the AI so
new plugins match it. You can export a style and import your own.

![The ten built-in design styles](docs/screenshots/design-schools.png)

---

## 11. Editing the code by hand

You don’t have to touch code, but you can. The window has tabs for the **DSP**
source (AssemblyScript) and the **interface** source (HTML) in full Monaco
editors, shipped offline inside the bundle.

Change either and press **Save & Compile** (`Cmd`/`Ctrl`+`S`) — it rebuilds and
reloads live. If it doesn’t compile, your current sound keeps playing while the
errors show up in **Notes**. **Fix with AI** hands the errors back to the model to
repair; **Revert** restores the last compiled source.

---

## 12. Publishing, the gallery, and standalone export

- **Publish to the gallery** — uploads your creation to the
  [web gallery](https://k1ln.github.io/VibePlugin/gallery/), where it plays live
  in the browser and others can download it.
- **Export as a standalone plugin** — **Export plugin…** turns the loaded
  creation into its own locked `.vst3` with its own name. It opens straight to
  the finished interface with no prompt bar and no editor, so you can give a
  finished instrument to someone who doesn’t care how it was made. On macOS, add
  a notarization profile in **Settings** and it’ll run on any Mac with no
  warnings.

---

## 13. Troubleshooting

**The plugin doesn’t show up in my DAW.**
Confirm the `.vst3` is in the correct folder and rescan. On macOS clear the
quarantine flag. Some DAWs cache plugin scans — force a full rescan, and clear the
blocklist. See [step 1](#1-install-it-and-make-your-daw-see-it).

**Trying to generate opened a payment website.**
You had **VibePlugin Cloud** selected as the generation source, which is the
pay-as-you-go route. Switch to [route 2](#route-2--claude-in-your-browser-free)
(free) or enter your own API key as in route 1.

**Generation fails, or the pasted reply won’t build.**
Open **Notes** for the compiler errors and press **Fix with AI**. On route 2, use
**Copy fix request** and paste it into the *same* conversation. If replies
repeatedly fail to build, check *which model wrote them* — this route is built for
**Claude Opus**, and other assistants often return code that won’t compile.

**My automation is pointing at the wrong knob.**
Automation follows the parameter slot, not the name, and regenerating can shuffle
which knob sits in which slot. See [Automation](#automation). Restore the earlier
version from **History** to get the old layout back.

**A bounce came out dry when live playback was fine.**
Your host used a buffer larger than 8192 samples for the offline render. Lower the
buffer size and render again.

**The interface didn’t appear — “juce.backend couldn’t be reached”.**
A limitation of the embedded browser on older operating systems (notably macOS
before 12). Current releases detect this and render the interface a different way
automatically. If you still see it on an up-to-date VibePlugin, please
[open an issue](https://github.com/k1ln/VibePlugin/issues) with your OS and DAW —
in the meantime the sound runs and you can view the interface in the **GUI HTML**
tab.

**Does it need internet?**
Only to *generate or edit* a plugin. A saved `.vstai` runs fully offline, and so
does every exported standalone plugin.

**Where do my creations go?**
Wherever you **Save** the `.vstai`. The plugin keeps no hidden library; the file
and your DAW session are the only copies.

**Something else is broken.**
Copy the **Diagnostics** log, note your OS, DAW and the version badge in the
plugin header, and [open an issue](https://github.com/k1ln/VibePlugin/issues).

---
---

# For developers

Building VibePlugin itself, and how it works inside. The full build-from-source
reference is **[docs/DEVELOPING.md](docs/DEVELOPING.md)**.

---

## Architecture

```
        ┌──────────────────────────── VibePlugin (C++ / JUCE) ───────────────────────────┐
prompt ▶│  Editor (WebView GUI + prompt bar)                                            │
        │     │ window.vstai.setParam / noteOn / noteOff                                │
        │     ▼                                                                         │
        │  AudioProcessor ──▶ WasmEngine (wasmtime) ◀── plugin.wasm (the DSP)            │
        │     │                                                                         │
        │     ├─ LlmClient ─── HTTPS ──▶ Claude (your key) or VibePlugin Cloud credits   │
        │     │       │ { assembly, html, params }  (structured / JSON output)           │
        │     │       ▼                                                                 │
        │     └─ AssemblyScriptCompiler ──▶ execs bundled vstai-asc ──▶ plugin.wasm      │
        │             (direct exec, no shell; compile errors fed back to the model ≤3×) │
        └───────────────────────────────────────────────────────────────────────────────┘
```

You type a prompt; Claude generates an **AssemblyScript** DSP module and an
**HTML** GUI; the AssemblyScript is compiled to **WebAssembly** by a compiler that
**ships inside the plugin**; the WASM runs under **wasmtime**; the HTML is shown in
an embedded WebView. Each plugin saves to a portable **`.vstai`** file.

One core builds two products, selected by `VSTAI_IS_SYNTH` at build time:

| | `VibePlugin FX` | `VibePlugin Synth` |
|---|---|---|
| Type | audio effect | instrument (`IS_SYNTH`) |
| Buses | stereo in + out | stereo out, MIDI in |
| DSP ABI | reads input, writes output | `noteOn(id, freq, vel)` / `noteOff(id)` + writes output |
| Notes | — | host converts MIDI note→Hz; GUI keyboard via `window.vstai.noteOn/noteOff` |

---

## How AssemblyScript gets compiled (no toolchain on your machine)

`asc` (the AssemblyScript compiler) is JavaScript, and its optimizer backend
**Binaryen is a WASM module that needs a real `WebAssembly` engine**. A JS engine
compiled to WASM (QuickJS/Javy) has none, so `asc` can’t run inside wasmtime
(verified: it aborts with *“no native wasm support detected”*). So the compiler
ships as a **self-contained JS runtime (V8) with `asc` baked in** — one file
`vstai-asc` (via `deno`/`bun --compile`), or `vstai-node` + `asc-bundle.mjs`. The
plugin **execs it directly** (JUCE `ChildProcess`, no shell) — AssemblyScript in,
compiled WASM out — and feeds any compile error back to Claude (≤3×). Build it
once with [`compiler/build.sh`](compiler/build.sh).

The generated DSP runs under **wasmtime**. The only network use is generating a
*new* plugin; a saved `.vstai` runs with no network.

---

## Generation paths (internals)

| Path | Models | Auth | How |
|---|---|---|---|
| **Manual** (free) | a free claude.ai account | **none** | copy the prompt → paste into Claude (Opus recommended) → paste the reply back |
| **Anthropic — your key** | Fable 5 / Opus 5 / Sonnet 5 | `sk-ant-…` in Settings | direct HTTPS from the plugin |
| **VibePlugin Cloud — credits** | Cloud · Haiku 4.5 / Sonnet 5 / Opus 4.8 | sign in via **Account** | proxied through the hosted server — no API key needed |

The credits backend is **not** in this tree — it’s a separate private repo
(`VibePlugin-server`). Nothing here depends on it: the plugin is fully usable with
your own key or the free Claude path.

---

## The `.vstai` file

Plain JSON, saveable anywhere and reloadable; the same JSON is the DAW session
state, so reopening a project restores the exact plugin:

```jsonc
{
  "format": 1, "name": "Tape Saturator", "isInstrument": false,
  "promptHistory": ["a warm tape saturator…", "add wow & flutter"],
  "assembly": "…AssemblyScript source…",
  "html": "…GUI document…",
  "wasmBase64": "AGFzbQ…",          // the compiled WASM, base64
  "params": [{ "name": "Drive", "index": 0, "min": 0, "max": 1, "default": 0.3, "value": 0.5 }],
  "explanation": "…",
  "locked": false                   // true in an exported/whitelabel plugin
}
```

“Talking again” sends `assembly` + `html` back to Claude with the new prompt, so
it edits in place.

**Export plugin… (whitelabel)** turns the loaded creation into a standalone,
locked `.vst3`. It **copies the running bundle** (no rebuild), bakes the creation
in, gives the copy its **own VST3 id + product name** (in-place binary patch, so
it coexists with VibePlugin and other exports), **strips** the bundled compiler
and editor shell (≈170 MB → ≈30 MB), and re-signs. With a notarytool profile in
**Settings** it also notarizes and staples. See
[`src/PluginExport.h`](src/PluginExport.h).

---

## Build & run

Two scripts build everything and **publish to your local VST3 folder, signed** so
a DAW will load them. They auto-build the bundled compiler and auto-download the
wasmtime c-api on first run.

```bash
./scripts/build.sh       # Release  -> ~/Library/Audio/Plug-Ins/VST3, code-signed
./scripts/dev.sh         # Debug + file logging (development mode), same place
./scripts/dev.sh --tail  # follow the dev log
```

Then rescan in your DAW. There’s also a Standalone `.app` under
`build*/…/Standalone/` for quick testing without a DAW.

**Development mode** (`scripts/dev.sh`) builds with `-DVSTAI_DEV_MODE=ON`, turning
on a file logger that traces the whole generate → compile → load pipeline (the
prompt, the HTTP status, the exact compiler command, compile diagnostics, wasm
size). In a DAW you can’t see stdout, so it writes to
`~/Library/Logs/VibePlugin/VibePlugin FX.log`. Dev and release use separate build
dirs (`build-dev` / `build`); installing one replaces the other in the VST3
folder, so rescan after switching.

**Testing the knobs without a DAW:**

```bash
./scripts/test.sh                 # regression tests: protocol + reference effect/synth
./scripts/test.sh MyPlugin.vstai  # sweep every param of a saved plugin
```

The `.vstai` run sweeps each parameter min→max and reports `OK affects audio` /
`DEAD does nothing` / `?? no audio`, exiting non-zero if any knob is dead — so it
doubles as a CI gate. The GUI↔host wire format lives in one header,
[`src/BridgeProtocol.h`](src/BridgeProtocol.h).

**Signing (macOS).** On Apple Silicon a plugin must be code-signed to load; the
scripts sign for you. An **Apple Development** cert is enough for local use —
verify with `security find-identity -v -p codesigning`. Override the identity with
`VSTAI_SIGN_ID="Developer ID Application: …" ./scripts/build.sh`. Dev builds sign
with **no hardened runtime**: wasmtime and the bundled V8 compiler both JIT, which
hardened runtime blocks without extra entitlements.

Manual CMake builds, Windows/Linux notes and the full signing/notarization
walkthrough are in [docs/DEVELOPING.md](docs/DEVELOPING.md).

---

## Repository layout

```
src/                         C++ (shared by both plugins)
  WasmAbi.h                  the host<->WASM contract (source of truth)
  BridgeProtocol.h / BridgeShim.h   GUI<->host wire format + the injected window.vstai shim
  Prompt.h                   system prompt + output schema  ← "the prompt"
  Config.example.h           copy to Config.h to bake in the API key
  Settings.h / AppSettings.h resolved config + runtime keys/URLs/notary
  Designs.h                  the 10 built-in design schools
  LlmClient.* / CloudClient.* raw HTTPS to Claude (your key) or the hosted Cloud proxy
  AccountPanel.h             "Account…" dialog: cloud sign-in + credits balance
  ManualPanel.h              the copy-prompt / paste-reply dialog
  AssemblyScriptCompiler.*   execs the bundled compiler -> WASM
  WasmEngine.*               wasmtime wrapper; audio + synth notes
  VstaiDocument.*            the .vstai JSON model (+ DAW state, lock flag)
  PluginProcessor.*          audio/MIDI + state + generate/compile loop + export
  WebEditor.* + WebAssets.h  the default editor: an HTML/Monaco WebView shell
  LockedEditor.*             product-only editor for an exported plugin
  PluginExport.h             "Export plugin…": copy + bake + re-identify + sign
  PluginEditor.* / SourceEditor.h / HistoryPanel.h   legacy native editor (fallback)
ui/                          the WebView editor SPA (shell.html/js/css + Monaco) and designs/
compiler/                    builds the bundled AssemblyScript compiler
wasm-template/assembly/      reference AssemblyScript: index.ts (effect), synth.ts
docs/gallery/                static web gallery — play creations live, download .vstai
web/                         the default starter GUI
```

---

## Notes & limits

- **ABI:** planar f32, ≤ 8192 frames/block, ≤ 2 channels, ≤ 64 params (see
  [`src/WasmAbi.h`](src/WasmAbi.h)). Generated modules are sandboxed — no imports,
  no host calls.
- If no module is loaded (or while one swaps in), audio passes through.
- Generated GUIs are offline/self-contained (no CDN/network) — they only talk to
  the host through `window.vstai`.
- REST calls are non-streaming with a 10-minute timeout. Very large GUIs are best
  generated with the strongest model.
- **Treat generated code as untrusted:** DSP runs in the WASM sandbox, the GUI in
  an embedded WebView. Don’t paste secrets into prompts.

---

## License

VibePlugin is free software under the **GNU Affero General Public License v3.0**
([LICENSE](LICENSE)). You may use, study, modify, and redistribute it; if you
distribute a modified version — or run one as a network service — you must make
your complete source available under the same license.

The hosted backend for the optional paid tier (cloud credits — API-key proxying
and payments) is **not** covered by this license and lives in a separate private
repository.

**Commercial / dual licensing.** If you want to build on VibePlugin in a
closed-source or commercial product without the AGPL’s obligations, a separate
commercial license is available — contact <k@1ln.de>.
