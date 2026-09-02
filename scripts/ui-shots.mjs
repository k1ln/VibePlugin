#!/usr/bin/env node
// ui-shots.mjs
// =====================================================================
//  Renders documentation screenshots of the editor shell.
//
//  The shell (ui/shell.html + shell.js + shell.css) is a web app that talks
//  to C++ through window.__JUCE__. Serve the REAL ui/ directory, stub that
//  one object, and headless Chrome renders exactly what the plugin renders —
//  same markup, same stylesheet, same code paths. No mock-ups.
//
//  The stub answers each native call with the shape WebEditor::currentState()
//  actually returns, and the model list is copied from modelCatalog() in
//  src/WebEditor.cpp, so the toolbar shows the real options. /preview is
//  served a real generated GUI out of docs/gallery/data so the GUI tab shows
//  a genuine plugin rather than an empty frame.
//
//  What this CANNOT capture: Account and Keys are native JUCE dialogs, not
//  web views. Those shots have to be taken by hand from the running plugin.
//
//      node scripts/ui-shots.mjs [--only <name>] [--keep]
//
//  Requires: Google Chrome.
// =====================================================================

import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const UI = path.join(REPO, "ui");
const OUT = path.join(REPO, "docs", "screenshots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

// ---- the shots ------------------------------------------------------
// `drive` runs in the page after the shell has booted. Keep each one to
// clicks a user could make themselves.
const SHOTS = [
  {
    name: "tutorial-main",
    w: 1280, h: 860,
    drive: `document.querySelector('[data-tab="preview"]').click();`,
  },
  {
    name: "tutorial-prompt",
    w: 1280, h: 420,
    drive: `document.querySelector('[data-tab="preview"]').click();
            document.getElementById('promptBox').value =
              'a warm tape saturator with drive, tone and a wow-and-flutter control';
            document.getElementById('promptBox').focus();`,
  },
  {
    name: "tutorial-settings",
    w: 1280, h: 860,
    drive: `document.querySelector('[data-tab="settings"]').click();
            document.getElementById('srcAnthropic').checked = true;`,
  },
  {
    name: "tutorial-chatbot",
    w: 1280, h: 900,
    // Click the real button so the dialog fills itself the way it does for a
    // user; forcing the modal open leaves the prompt box empty.
    drive: `document.getElementById('promptBox').value =
              'a warm tape saturator with drive, tone and a wow-and-flutter control';
            document.getElementById('chatbotBtn').click();`,
  },
  {
    name: "tutorial-code",
    w: 1280, h: 860,
    drive: `document.querySelector('[data-tab="dsp"]').click();`,
  },
  {
    name: "tutorial-history",
    w: 1280, h: 620,
    drive: `document.querySelector('[data-tab="history"]').click();`,
  },
];

// ---- fixture --------------------------------------------------------
// A real generated plugin, so the GUI tab and the code tabs show real work.
async function fixture() {
  const file = path.join(REPO, "docs", "gallery", "data", "reel-saturator.vstai");
  const doc = JSON.parse(await fs.readFile(file, "utf8"));

  // The real ten design schools, read out of each design's VSTAI-DESIGN header
  // so the Settings shot shows the actual names and blurbs users see.
  const dir = path.join(UI, "designs");
  const designs = [];
  for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith(".html")).sort()) {
    const head = (await fs.readFile(path.join(dir, f), "utf8")).match(/<!--VSTAI-DESIGN\s*([\s\S]*?)-->/);
    if (!head) continue;
    const m = JSON.parse(head[1]);
    designs.push({
      id: m.id, name: m.name, blurb: m.blurb, theme: m.theme,
      builtin: true,                       // all ten ship with the plugin
      selected: m.id === "modern-flagship",
    });
  }

  return {
    name: doc.name,
    html: doc.html,
    assembly: doc.assembly,
    explanation: doc.explanation || "",
    params: doc.params || [],
    designs,
  };
}

function stubJs(fx) {
  // Mirrors WebEditor::currentState() and modelCatalog().
  const state = {
    provider: "anthropic", model: "claude-opus-5", effort: "medium", thinking: true,
    models: [
      { provider: "anthropic", id: "claude-fable-5",  label: "Fable 5 (most capable, 2× price)", group: "Anthropic (your key)" },
      { provider: "anthropic", id: "claude-opus-5",   label: "Opus 5 (best value)",  group: "Anthropic (your key)" },
      { provider: "anthropic", id: "claude-sonnet-5", label: "Sonnet 5 (cheaper)",   group: "Anthropic (your key)" },
      { provider: "cloud", id: "claude-haiku-4-5", label: "Cloud · Haiku 4.5",        group: "VibePlugin Cloud (credits)" },
      { provider: "cloud", id: "claude-sonnet-5",  label: "Cloud · Sonnet 5",         group: "VibePlugin Cloud (credits)" },
      { provider: "cloud", id: "claude-opus-4-8",  label: "Cloud · Opus 4.8 (best)",  group: "VibePlugin Cloud (credits)" },
    ],
    isInstrument: false, hasPlugin: true, name: fx.name,
    assembly: fx.assembly, html: fx.html,
    signedIn: false, generationSource: "anthropic", applyDesignStyle: true,
    building: false, stage: "", designId: "modern-flagship", designTheme: {},
  };

  const history = [
    { id: "3", prompt: "add a wow & flutter control", model: "Opus 5",  timestamp: Date.now() - 1000 * 60 * 4,  active: true  },
    { id: "2", prompt: "make the saturation warmer and add a tone knob", model: "Opus 5", timestamp: Date.now() - 1000 * 60 * 12, active: false },
    { id: "1", prompt: "a warm tape saturator with drive and tone", model: "Opus 5", timestamp: Date.now() - 1000 * 60 * 20, active: false },
  ];

  return `
window.__JUCE__ = {
  initialisationData: {
    __juce__functions: [], __juce__sliders: [], __juce__toggles: [],
    __juce__comboBoxes: [], __juce__platform: ["macos"],
  },
  backend: (function(){
    var subs = {};
    return {
      addEventListener: function(k, f){ (subs[k] = subs[k] || []).push(f); },
      removeEventListener: function(){},
      emitEvent: function(k, payload){
        if (k !== "__juce__invoke") return;
        var name = payload.name, id = payload.resultId;
        // JUCE's PromiseHandler keys completions on promiseId (see
        // ui/js/juce/index.js). Getting this name wrong resolves nothing and
        // the shell's init() simply never finishes, silently.
        var reply = function(v){
          setTimeout(function(){
            (subs["__juce__complete"] || []).forEach(function(f){ f({ promiseId: id, result: v }); });
          }, 0);
        };
        var S = ${JSON.stringify(state)};
        switch (name) {
          case "getState": case "ready": case "newDoc": case "setModel":
          case "setEffort": case "setThinking": case "restoreRevision":
          case "setGenerationSource": case "setApplyDesignStyle":
            return reply(S);
          case "getHistory":        return reply(${JSON.stringify(history)});
          case "getStandardUi":     return reply(${JSON.stringify(fx.html)});
          case "getPreviewHtml":    return reply(${JSON.stringify(fx.html)});
          case "getDiagnostics":    return reply({ text: "" });
          case "getAccount":        return reply({ signedIn: false });
          case "getSettings":       return reply({ anthropicKey: "", publishUrl: "", notaryProfile: "", genSource: "anthropic", applyDesignStyle: true });
          case "getDesigns":        return reply(${JSON.stringify(fx.designs)});
          case "buildManualPrompt": return reply(${JSON.stringify(
            "You are writing a VST3 audio plugin for VibePlugin.\n\n" +
            "Reply with THREE fenced blocks and nothing else:\n\n" +
            "  ```assemblyscript   the DSP module (index.ts)\n" +
            "  ```html             the plugin's interface\n" +
            "  ```json             the parameter list\n\n" +
            "REQUEST: a warm tape saturator with drive, tone and a wow-and-flutter control\n"
          )});
          default: return reply(S);
        }
      },
    };
  })(),
};
`;
}

// ---- static server --------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".json": "application/json", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

async function serve(root, fx) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);
    if (p === "/preview") {   // the GUI tab's iframe: a real generated interface
      res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
      return res.end(fx.html);
    }
    if (p === "/") p = "/shell.html";
    try {
      const body = await fs.readFile(path.join(root, p));
      res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

// ---- main -----------------------------------------------------------
const fx = await fixture();
const root = await fs.mkdtemp(path.join(os.tmpdir(), "vstai-shots-"));
await fs.cp(UI, root, { recursive: true });

// Patch the stub in ahead of the shell module, and add the per-shot driver.
let html = await fs.readFile(path.join(root, "shell.html"), "utf8");
await fs.writeFile(path.join(root, "__stub.js"), stubJs(fx));
html = html.replace(
  '<script type="module" src="shell.js"',
  '<script src="__stub.js"></script>\n  <script type="module" src="shell.js"'
);
// C++ stamps the build id into the header; do the same so shots don't show
// the raw placeholder.
const version = (await fs.readFile(path.join(REPO, "CMakeLists.txt"), "utf8"))
  .match(/^project\(VibePlugin VERSION ([0-9.]+)/m)?.[1] ?? "dev";
html = html.replace("__VSTAI_BUILD__", `v${version}`);
html = html.replace("</body>", `
<script>
  // Give the shell time to boot (Monaco + the async init()), then put the UI
  // into the state this shot wants and flag readiness for the screenshotter.
  window.addEventListener("load", function(){
    setTimeout(function(){
      try { eval(decodeURIComponent(new URL(location.href).searchParams.get("drive") || "")); } catch(e){}
      setTimeout(function(){ document.title = "SHOT-READY"; }, 900);
    }, 2200);
  });
</script>
</body>`);
await fs.writeFile(path.join(root, "shell.html"), html);

const { server, port } = await serve(root, fx);
await fs.mkdir(OUT, { recursive: true });

for (const s of SHOTS) {
  if (ONLY && s.name !== ONLY) continue;
  const out = path.join(OUT, `${s.name}.png`);
  const url = `http://127.0.0.1:${port}/shell.html?drive=${encodeURIComponent(s.drive)}`;
  await run(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=2",           // retina-sharp for the docs
    `--window-size=${s.w},${s.h}`,
    "--virtual-time-budget=9000",
    `--screenshot=${out}`, url,
  ], { maxBuffer: 1 << 26 }).catch((e) => { throw new Error(`${s.name}: ${e.message}`); });
  const { size } = await fs.stat(out);
  console.log(`  ${s.name}.png  ${s.w}x${s.h}  ${(size / 1024).toFixed(0)} KB`);
}

server.close();
if (!process.argv.includes("--keep")) await fs.rm(root, { recursive: true, force: true });
console.log(`\nwrote ${SHOTS.filter((s) => !ONLY || s.name === ONLY).length} shot(s) to docs/screenshots/`);
