// UiLibs.h
// =====================================================================
//  Optional third-party UI libraries a generated plugin's GUI can use for its
//  knobs / sliders / switches instead of hand-drawn SVG: webaudio-controls,
//  jQuery Knob and NexusUI. All three are permissively licensed (Apache-2.0 /
//  MIT - see THIRD_PARTY_NOTICES.md) and ship unmodified in ui/libs/.
//
//  A GUI is a single self-contained HTML file, so a library is never linked:
//  the model writes a marker tag
//
//      <script data-vstai-lib="webaudio-controls"></script>
//
//  and expand() replaces it with the library source, inline, when the HTML is
//  accepted into the document. The model therefore never has to emit (or pay
//  tokens for) 70-330 KB of library code, and the saved .vstai, the gallery
//  player, exported plugins and WebCLAP exports are all fully self-contained.
//
//  Settings-free (pure parsing + file IO) so Prompt.h / AppSettings.h can both
//  use it without a circular include.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <vector>
#include "WebAssets.h"

namespace vstai::uilibs
{
    // Separates the design-language text from the UI-library notes inside the one
    // "designPrinciples" string the build entry points already carry. Prompt.h splits
    // on it; AppSettings.h joins with it. (Keeps every prompt-builder signature stable.)
    inline const char* promptMarker() { return "\n<<<VSTAI-UI-LIBRARY>>>\n"; }

    struct Lib
    {
        juce::String id, name, license, blurb;
        std::vector<juce::String> files;   // under ui/libs/, in load order
        juce::String notice;               // comment written before the inlined code
        juce::String usage;                // API notes injected into the build prompt
        juce::String example;              // under ui/libs/examples/
    };

    inline const std::vector<Lib>& all()
    {
        static const std::vector<Lib> libs = []
        {
            std::vector<Lib> v;

            v.push_back ({
                "webaudio-controls", "webaudio-controls", "Apache-2.0",
                "Custom-element knobs, sliders, switches and a keyboard (<webaudio-knob> ...). Drop-in HTML, no setup code.",
                { "webaudio-controls.js" },
                "webaudio-controls - (c) Eiji Kitamura / Ryoya Kawai / Keisuke Ai / g200kg - Apache License 2.0 - "
                "https://github.com/g200kg/webaudio-controls - bundled unmodified, see THIRD_PARTY_NOTICES.md",
R"UIL(Custom elements, plain HTML attributes:
  <webaudio-knob id="cutoff" data-param="1" min="20" max="20000" value="1200" step="0" log="1"
      diameter="64" colors="#ff7a1a;#23262e;#ffffff" midilearn="0"></webaudio-knob>
     colors = "indicator;body;ring" (3 CSS colours, semicolon separated). step="0" = continuous.
     log="1" = logarithmic response (use it for Hz / seconds). Always add midilearn="0".
  <webaudio-slider direction="vert" width="34" height="120" min="0" max="1" value="1" step="0"
      colors="#ff7a1a;#23262e;#ffd0a8" knobwidth="30" knobheight="14"></webaudio-slider>   (direction vert | horz)
  <webaudio-switch type="toggle" diameter="30" colors="#3ea6ff;#111;#bfe0ff"></webaudio-switch>
     type = toggle | kick (momentary) | radio (give each button of a group the same group="name"; value 1 = selected).
  <webaudio-keyboard min="48" keys="37" width="900" height="84"
      colors="#222;#f4f4f6;#cfd2d8;#2a2d35;#08080a;#ffb27a;#ff7a1a;#ff9a4a;#b84d00"></webaudio-keyboard>
     (colors = 9 entries; the last four are the pressed-key colours - keep all nine.)
     its 'change' event carries e.note = [state, midiNote]: state 1 -> noteOn(note,100), 0 -> noteOff(note).
Read and write the element's .value property. Events 'input' (while dragging) and 'change' (on release) bubble:
  el.addEventListener('input', () => window.vstai.setParam(INDEX, +el.value));
  window.vstai.onParam((i, v) => { if (i === INDEX) { applying = true; el.value = +v; applying = false; } });
Wrap the setParam handler in `if (applying) return;` so a value pushed in by the host is never echoed back.
Size widgets with their own attributes (diameter / width / height), label them with your own HTML beside them,
and read the live value into your own readout from the 'input' event.)UIL",
                "webaudio-controls.html"
            });

            v.push_back ({
                "jquery-knob", "jQuery Knob", "MIT",
                "Canvas dials with a typed-value field. Pulls in jQuery 3 (both inlined). Great for classic round knobs.",
                { "jquery.min.js", "jquery.knob.min.js" },
                "jQuery Knob - (c) 2013 Anthony Terrien - MIT License - https://github.com/aterrien/jQuery-Knob; "
                "jQuery 3.7.1 - (c) OpenJS Foundation and other contributors - MIT License - https://jquery.com - "
                "bundled unmodified, see THIRD_PARTY_NOTICES.md",
R"UIL(jQuery 3 ($ / jQuery) is inlined first, then the knob plugin. Markup is an <input>:
  <input class="dial" data-param="2" value="0.2" data-min="0" data-max="1" data-step="0.001"
      data-width="76" data-height="76" data-thickness="0.26" data-angleOffset="-125" data-angleArc="250"
      data-fgColor="#6fd8bd" data-bgColor="#26332d" data-inputColor="#cfe9df" data-lineCap="round">
Initialise once the DOM exists:
  $(".dial").each(function () {
    const index = +this.dataset.param, $el = $(this);
    $el.knob({ change: v => { if (!applying) window.vstai.setParam(index, +v); } });
  Do NOT use format()/parse() for units or mappings: the knob re-reads its own text, so "1.2k" would come back as 1.2.
  Use data-displayInput="false" to hide the built-in number and show units in your own element.
    window.vstai.onParam((i, v) => { if (i === index) { applying = true; $el.val(+v).trigger("change"); applying = false; } });
  });
There is NO log scale: for Hz / seconds run the dial 0..1 and map it yourself (hz = 20 * Math.pow(1000, n)).
There is no built-in switch, slider or keyboard - build those from plain HTML/CSS. data-displayInput="false" hides the number.
Wrap the setParam handler in `if (applying) return;` so a value pushed in by the host is never echoed back.)UIL",
                "jquery-knob.html"
            });

            v.push_back ({
                "nexusui", "NexusUI", "MIT",
                "Canvas widgets: Dial, Slider, Toggle, RadioButton, Select, Piano, Envelope, Multislider, Sequencer ...",
                { "nexusui.min.js" },
                "NexusUI 2.1.5 - (c) Benjamin Taylor and contributors - MIT License - https://github.com/nexus-js/ui - "
                "bundled unmodified, see THIRD_PARTY_NOTICES.md",
R"UIL(Global `Nexus`. Widgets are SVG, built into an empty element and sized in px:
  <div id="cutoff" data-param="1"></div>
  const dial = new Nexus.Dial("#cutoff", { size: [66, 66], min: 0, max: 1, step: 0, value: 0.5 });
  dial.on("change", n => { if (!applying) window.vstai.setParam(INDEX, toHost(n)); });
  window.vstai.onParam((i, v) => { if (i === INDEX) { applying = true; dial.value = fromHost(+v); applying = false; } });
Widgets: Nexus.Dial, Nexus.Slider (size [34,110] = vertical, [110,34] = horizontal), Nexus.Toggle ({state}), Nexus.Button,
  Nexus.RadioButton ({numberOfButtons, active}; .on('change', index) and .select(index)), Nexus.Select ({options:[..]}),
  Nexus.Number, Nexus.Envelope, Nexus.Multislider ({numberOfSliders}), Nexus.Sequencer ({rows,columns}), Nexus.Piano
  ({size:[w,h], mode:"button", lowNote:48, highNote:84}; on('change', e => e.note / e.state): state true -> noteOn(e.note,100),
  false -> noteOff(e.note)). Nexus.Oscilloscope / Spectrogram / Meter need an audio node, so draw your own canvas for those.
Dials and sliders are LINEAR 0..1 here: map log ranges yourself (hz = 20 * Math.pow(1000, n)). Setting .value fires 'change',
so the `applying` guard above is REQUIRED. Theme once, before creating widgets:
  Object.assign(Nexus.colors, { accent: "#4dc3f5", fill: "#242831", light: "#e8e9ee", dark: "#0c0d10", mediumLight: "#80838e", mediumDark: "#30343e" });
Put readouts and labels in your own HTML next to each widget.)UIL",
                "nexusui.html"
            });

            return v;
        }();
        return libs;
    }

    inline const Lib* find (const juce::String& id)
    {
        for (auto& l : all())
            if (l.id == id) return &l;
        return nullptr;
    }

    // The library as one or more inline <script> blocks, preceded by its licence notice.
    // Empty when a file is missing (an unsigned dev run with no Resources/ui/libs).
    inline juce::String inlineScripts (const Lib& lib)
    {
        juce::String out;
        bool first = true;
        for (auto& f : lib.files)
        {
            auto src = vstai::webassets::readText ("libs/" + f);
            if (src.isEmpty()) return {};
            src = src.replace ("</script", "<\\/script");   // can never close the host tag early
            if (! first) out << "\n";
            out << "<script>\n";
            if (first) out << "/* " << lib.notice << " */\n";
            out << src << "\n</script>";          // no trailing newline: collapse() must be expand()'s exact inverse
            first = false;
        }
        return out;
    }

    // Replace every <script data-vstai-lib="ID"></script> marker with the inlined library.
    // Idempotent, a no-op when there is no marker, and an unknown / unreadable library
    // leaves its marker untouched (the GUI still loads, just without that library).
    inline juce::String expand (const juce::String& html)
    {
        static const juce::String attr ("data-vstai-lib=");
        if (! html.contains (attr)) return html;

        juce::String out;
        int cursor = 0, scan = 0;
        for (;;)
        {
            const int at = html.indexOf (scan, attr);
            if (at < 0) break;
            scan = at + attr.length();

            const auto quote = html[scan];                       // " or '
            if (quote != '"' && quote != '\'') continue;
            const int idEnd = html.indexOfChar (scan + 1, quote);
            if (idEnd < 0) break;
            const auto id = html.substring (scan + 1, idEnd).trim();

            const int tagStart = html.substring (0, at).lastIndexOfIgnoreCase ("<script");
            const int closeAt  = html.indexOfIgnoreCase (idEnd, "</script>");
            if (tagStart < 0 || closeAt < 0 || tagStart < cursor) continue;

            const auto* lib = find (id);
            const auto code = lib != nullptr ? inlineScripts (*lib) : juce::String();
            if (code.isEmpty()) continue;

            out << html.substring (cursor, tagStart) << code;
            cursor = closeAt + (int) juce::String ("</script>").length();
            scan = cursor;
        }
        if (cursor == 0) return html;
        return out + html.substring (cursor);
    }

    // The inverse of expand(): turn inlined libraries back into their one-line marker, so a
    // later "change this plugin" prompt does not ship 100-330 KB of third-party code to the
    // model (and cannot tempt it into editing that code). Exact-match, so only text that
    // expand() itself produced is collapsed.
    inline juce::String collapse (const juce::String& html)
    {
        juce::String out = html;
        for (auto& lib : all())
        {
            if (! out.contains (lib.notice)) continue;                    // cheap pre-check, no file read
            const auto code = inlineScripts (lib);
            if (code.isNotEmpty() && out.contains (code))
                out = out.replace (code, "<script data-vstai-lib=\"" + lib.id + "\"></script>");
        }
        return out;
    }

    // The block added to the build prompt when `id` is selected. Empty for "" / unknown.
    inline juce::String promptNotes (const juce::String& id)
    {
        const auto* lib = find (id);
        if (lib == nullptr) return {};

        juce::StringArray s;
        s.add ("=== UI LIBRARY: " + lib->name + " (" + lib->license + ", selected in Settings) ===");
        s.add ("Build this plugin's knobs, sliders and switches with " + lib->name + " instead of hand-drawn");
        s.add ("SVG/canvas controls. The design language above (or the user's own style) still decides colours,");
        s.add ("type, spacing and layout - theme the library through its own colour options and your CSS.");
        s.add ("If a component kit appears above, it is a VISUAL reference: where it draws its own knobs, sliders or");
        s.add ("switches, use the library's widgets instead and keep that look.");
        s.add ("Do NOT paste, link or <script src=...> the library yourself: put exactly this tag in <head> and");
        s.add ("the app inlines the library for you (you may use it freely in your own script):");
        s.add ("    <script data-vstai-lib=\"" + lib->id + "\"></script>");
        s.add ("");
        s.add (lib->usage);
        s.add ("");
        s.add ("The GUI <-> HOST CONTRACT still applies in full: every widget calls window.vstai.setParam(index, value)");
        s.add ("on user input, repaints from window.vstai.onParam, and carries data-param=\"<index>\" on its root element.");
        s.add ("Anything the library does not offer (meters, curves, envelope graphs, keyboards) you draw yourself.");
        s.add ("=== END UI LIBRARY ===");
        return s.joinIntoString ("\n");
    }
}
