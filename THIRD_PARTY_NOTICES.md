# Third-party notices

VibePlugin itself is AGPL-3.0 (see `LICENSE`). The UI libraries below are bundled
unmodified in `ui/libs/` and may be inlined into a generated plugin's GUI when the user
selects one under **Settings → UI library**. Each is permissively licensed and allows
commercial use; the full license texts are in `ui/libs/licenses/`, and a short notice
comment is written in front of each library wherever it is inlined.

| Library | Version | License | Copyright / source |
|---|---|---|---|
| webaudio-controls | master (2024) | Apache-2.0 | © Eiji Kitamura / Ryoya Kawai / Keisuke Ai / g200kg — https://github.com/g200kg/webaudio-controls |
| jQuery Knob | dist/jquery.knob.min.js (master) | MIT | © 2013 Anthony Terrien — https://github.com/aterrien/jQuery-Knob |
| jQuery | 3.7.1 (required by jQuery Knob) | MIT | © OpenJS Foundation and other contributors — https://jquery.com |
| NexusUI | 2.1.5 | MIT (per package.json) | © Benjamin Taylor and contributors — https://github.com/nexus-js/ui |

Notes
- NexusUI 2.1.6 on npm ships a bundle with unresolved git merge-conflict markers, so 2.1.5 is bundled.
- NexusUI's upstream repository has no LICENSE file; its `package.json` declares MIT.
- Considered but not applicable (C++, cannot run in the HTML/WebView GUI): Dear ImGui / imgui-knobs (MIT),
  DPF (ISC), VSTGUI (BSD-3), iPlug2 (WDL-style permissive).
