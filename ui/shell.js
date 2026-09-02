// VST3-AI editor shell — talks to C++ via JUCE 8 native integration.
import { getNativeFunction } from "./js/juce/index.js";

const backend = window.__JUCE__.backend;
const $  = (id) => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

// Native function wrappers (each returns a Promise resolving with the C++ result).
const N = {};
for (const name of ["getState","setModel","setGenerationSource","setApplyDesignStyle","setEffort","setThinking","generate",
                    "buildManualPrompt","buildManualUpdatePrompt","applyManualReply","applyManualParts","manualFixPrompt","newDoc","compile","fixWithAI",
                    "save","load","galleryIndex","galleryLoad","publish","exportPlugin","getStandardUi","saveStandardUi","resetStandardUi",
                    "getSettings","saveSettings","getDesigns","setDesign","removeDesign","exportDesign","importDesign",
                    "getDiagnostics","clearDiagnostics","getPreviewHtml",
                    "openAccount","getAccount","openKeys","getHistory","restoreRevision","ready"])
  N[name] = getNativeFunction(name);

let state = {};
let editors = { dsp: null, html: null, std: null };   // Monaco (or textarea-fallback) handles
let monaco = null;
let activeTab = "preview";

/* ---------- design theme (whole-shell re-skin) ----------------------- */
// The selected design ships a small palette in its VSTAI-DESIGN header. We map
// those keys onto the shell's CSS tokens so the entire editor chrome — header,
// prompt, toolbar, tabs AND every modal/dialog (Generate, Copy-to-chatbot, …) —
// matches the generated GUI. Absent/partial themes fall back to the built-in
// dark defaults baked into shell.css.
const THEME_VARS = {
  bg:"--bg", surface:"--surface", surface2:"--surface-2", surface3:"--surface-3",
  line:"--line", line2:"--line-2", line3:"--line-3",
  ink:"--ink", ink2:"--ink-2", muted:"--muted",
  accent:"--accent", accentPress:"--accent-press", accentInk:"--accent-ink",
  accent2:"--violet", ok:"--ok", danger:"--danger",
  radius:"--r", radiusLg:"--r-lg",
};
let appliedThemeKey = null;   // skip redundant re-applies (cheap idempotence)
function applyTheme(theme){
  const key = theme ? JSON.stringify(theme) : "";
  if (key === appliedThemeKey) return;
  appliedThemeKey = key;
  const root = document.documentElement;
  // Clear any tokens from a previous design, then apply the new ones (or none,
  // which reveals shell.css's default :root values).
  for (const cssVar of Object.values(THEME_VARS)) root.style.removeProperty(cssVar);
  document.body.classList.toggle("mono", !!(theme && theme.mono));
  if (!theme || typeof theme !== "object") return;
  for (const [k, cssVar] of Object.entries(THEME_VARS))
    if (theme[k] != null && theme[k] !== "") root.style.setProperty(cssVar, String(theme[k]));
}

/* ---------- status / busy / reasoning -------------------------------- */
function setStatus(text){ $("statusText").textContent = text; }
function setBusy(busy){
  $("spinner").hidden = !busy;
  for (const id of ["generateBtn","chatbotBtn","styleChk","newBtn","saveBtn","loadBtn","galleryBtn","publishBtn","exportBtn","compileBtn","fixBtn","revertBtn"])
    $(id).disabled = busy;
}

backend.addEventListener("stage",   (s) => setStatus(typeof s === "string" ? s : (s?.stage || "")));
backend.addEventListener("buildState", (b) => { setBusy(!!(b && b.building)); if (b && b.stage) setStatus(b.stage); });
backend.addEventListener("thinking", (txt) => {
  const v = $("thinkingView");
  v.textContent = typeof txt === "string" ? txt : "";
  $("thinkToggle").hidden = !v.textContent;
  v.scrollTop = v.scrollHeight;
});
backend.addEventListener("documentChanged", (s) => { state = s; applyTheme(s.designTheme); reseed(s); rebuildModelSelect(s); reloadPreview(); if (activeTab === "history") renderHistory(); });
// Host/automation param changes → forward into the sandboxed preview iframe so the
// generated GUI's controls visually follow along.
backend.addEventListener("paramUpdate", (p) => {
  const f = $("preview");
  if (f && f.contentWindow && p && p.values) f.contentWindow.postMessage({ type:"vstai:params", values:p.values }, "*");
});
backend.addEventListener("modelsChanged", (s) => { state = s; rebuildModelSelect(s); });

on("thinkToggle","click", () => {
  const v = $("thinkingView");
  v.hidden = !v.hidden;
  $("thinkToggle").textContent = (v.hidden ? "▸" : "▾") + " See reasoning";
});

/* ---------- preview iframe ------------------------------------------- */
// The generated GUI normally loads as a real subframe navigation to /preview, which
// the C++ resource provider answers. Some WebViews refuse to serve a custom URL
// scheme inside a subframe (WKWebView before macOS 12 is the known case) and show
// "juce.backend couldn't be reached" instead — the shell, the audio and the code
// tabs all still work, only this panel is dead. So we watch for the injected bridge
// shim's liveness beacon after every load; if it never arrives, we re-render the
// same document inline via srcdoc, pulling it over the native-integration channel
// (getPreviewHtml) which cannot be blocked by the same bug. Once we've had to fall
// back we stay inline for the session — retrying the broken path every reload would
// just cost a visible stall each time.
let previewInline = false;    // sticky: the direct subframe path is known broken
let previewAlive  = false;    // the current document has beaconed at least once
let previewWatch  = null;

function armPreviewWatchdog(){
  previewAlive = false;
  clearTimeout(previewWatch);
  previewWatch = setTimeout(() => {
    if (previewAlive || previewInline) return;
    previewInline = true;
    loadPreviewInline();
  }, 4000);
}

function reloadPreview(){
  if (previewInline) { loadPreviewInline(); return; }
  const f = $("preview");
  f.removeAttribute("srcdoc");
  f.src = "preview?_=" + Date.now();
  armPreviewWatchdog();
}

async function loadPreviewInline(){
  const f = $("preview");
  clearTimeout(previewWatch);
  try {
    const html = await N.getPreviewHtml();
    if (!html) throw new Error("empty document");
    f.removeAttribute("src");
    f.srcdoc = html;
  } catch (e) {
    f.removeAttribute("src");
    f.srcdoc = '<!doctype html><meta charset="utf-8">'
      + '<body style="margin:0;padding:24px;font:13px/1.6 system-ui,sans-serif;color:#c9d3e3;background:#0c0f16">'
      + "<b>The live GUI couldn't be displayed.</b><br>Your system's embedded browser refused to load it "
      + "(this happens on macOS 11 and earlier). The plugin still works: the sound is running, and you can "
      + "view and edit the interface in the <b>GUI HTML</b> tab."
      + "</body>";
  }
}

// Messages from the preview frame: its liveness beacon, and — when the frame can't
// reach C++ directly — bridge calls relayed for it. We're in the top frame, where
// the resource provider is always reachable, so we make the fetch on its behalf.
// Only /__vstai/ paths are relayed: the GUI in that frame is model-generated code
// and must not be able to use the shell as a general-purpose fetch proxy.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || !e.source) return;
  if (d.type === "vstai:hello"){
    previewAlive = true;
    clearTimeout(previewWatch);
    try { e.source.postMessage({ type: "vstai:hello:ack" }, "*"); } catch (_) {}
    return;
  }
  if (d.type !== "vstai:bridge") return;
  const reply = (msg) => { try { e.source.postMessage({ ...msg, type: "vstai:bridge:result", id: d.id }, "*"); } catch (_) {} };
  if (typeof d.path !== "string" || !d.path.startsWith("/__vstai/")) { reply({ ok: false, error: "blocked" }); return; }
  fetch(d.path + (d.path.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" })
    .then((r) => r.text())
    .then((text) => reply({ ok: true, text }))
    .catch((err) => reply({ ok: false, error: String(err && err.message || err) }));
});

// The iframe starts loading from its src="" during HTML parse, before this module
// runs, so arm the watchdog for that very first load here.
armPreviewWatchdog();

/* ---------- tabs ----------------------------------------------------- */
function selectTab(tab){
  activeTab = tab;
  for (const el of document.querySelectorAll(".tab")) el.classList.toggle("active", el.dataset.tab === tab);
  for (const el of document.querySelectorAll(".pane")) el.classList.toggle("active", el.dataset.pane === tab);
  const isCode = (tab === "dsp" || tab === "html");
  const isStd  = (tab === "standard");
  $("codeActions").hidden = !(isCode || isStd);
  for (const id of ["compileBtn","fixBtn","revertBtn"]) $(id).hidden = !isCode;
  $("stdSaveBtn").hidden = !isStd;
  $("stdResetBtn").hidden = !isStd;
  // Monaco needs a relayout when its container becomes visible.
  const ed = tab === "dsp" ? editors.dsp : tab === "html" ? editors.html : tab === "standard" ? editors.std : null;
  if (ed && ed.layout) requestAnimationFrame(() => ed.layout());
  if (tab === "history") renderHistory();
  if (tab === "settings") renderSettings();
}

/* ---------- history -------------------------------------------------- */
async function renderHistory(){
  const rows = await N.getHistory();
  const host = $("historyList");
  host.innerHTML = "";
  if (!rows || !rows.length){ host.innerHTML = '<div class="empty">No history yet. Each generated, AI-fixed or hand-compiled version is saved here.</div>'; return; }
  for (const r of rows){
    const div = document.createElement("div");
    div.className = "hrow" + (r.active ? " active" : "");
    const when = r.timestamp ? new Date(r.timestamp).toLocaleString() : "";
    div.innerHTML = '<div class="meta"><div class="p"></div><div class="sub"></div></div>';
    div.querySelector(".p").textContent = r.prompt;
    div.querySelector(".sub").textContent = [r.model, when].filter(Boolean).join("  ·  ") + (r.active ? "  ·  current" : "");
    const btn = document.createElement("button");
    btn.className = "btn"; btn.textContent = r.active ? "Current" : "Restore"; btn.disabled = !!r.active;
    btn.addEventListener("click", async () => { state = await N.restoreRevision(r.id); reseed(state); reloadPreview(); renderHistory(); setStatus("Restored an earlier version from History."); });
    div.appendChild(btn);
    host.appendChild(div);
  }
}
for (const el of document.querySelectorAll(".tab")) el.addEventListener("click", () => selectTab(el.dataset.tab));

/* ---------- model / effort controls --------------------------------- */
function rebuildModelSelect(s){
  const sel = $("modelSel");
  sel.innerHTML = "";
  let group = null, groupName = "";
  const src = s.generationSource || "anthropic";
  for (const m of (s.models || []).filter((m) => m.provider === src)){
    if (m.group !== groupName){ groupName = m.group; group = document.createElement("optgroup"); group.label = groupName; sel.appendChild(group); }
    const o = document.createElement("option");
    o.value = m.provider + " " + m.id;
    o.textContent = m.label;
    if (m.provider === s.provider && m.id === s.model) o.selected = true;
    group.appendChild(o);
  }
  updateEffortVisibility(s);
}
function updateEffortVisibility(s){
  const isClaude = (s.model || "").toLowerCase().startsWith("claude");
  const isGlm    = (s.model || "").toLowerCase().startsWith("glm");
  $("effortSel").hidden = isGlm;
  $("effortLbl").hidden = isGlm;
  $("effortSel").disabled = !isClaude;
  $("thinkWrap").hidden = !isGlm;
  $("thinkChk").checked = !!s.thinking;
  if (s.effort) $("effortSel").value = s.effort;
}
on("modelSel","change", async () => {
  const [provider, id] = $("modelSel").value.split(" ");
  state = await N.setModel(provider, id);
  updateEffortVisibility(state);
});
on("effortSel","change", () => N.setEffort($("effortSel").value));
on("thinkChk","change", () => N.setThinking($("thinkChk").checked));

/* ---------- editors (Monaco, with textarea fallback) ---------------- */
async function loadMonaco(){
  try{
    const vsBase = new URL("vendor/monaco/vs", location.href).href;
    window.MonacoEnvironment = {
      getWorkerUrl: function(){
        const js = "self.MonacoEnvironment={baseUrl:'" + new URL("vendor/monaco/", location.href).href + "'};" +
                   "importScripts('" + vsBase + "/base/worker/workerMain.js');";
        return URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
      }
    };
    window.require.config({ paths: { vs: "vendor/monaco/vs" } });
    await new Promise((res, rej) => window.require(["vs/editor/editor.main"], res, rej));
    monaco = window.monaco;
    monaco.editor.defineTheme("vstai", {
      base: "vs-dark", inherit: true, rules: [],
      colors: { "editor.background": "#0b0c0f", "editorGutter.background": "#0b0c0f",
                "editorLineNumber.foreground": "#3a4252", "editor.lineHighlightBackground": "#14161c" }
    });
    // Monaco's language services (TS/HTML diagnostics, completions) run in web
    // workers, which can't be fetched under the juce:// resource scheme — the
    // worker's importScripts fails with "Not Found". Disable every worker-backed
    // feature for the languages we use so the worker never spawns. Syntax
    // highlighting is main-thread (Monarch) and keeps working.
    try {
      const ts = monaco.languages.typescript;
      if (ts) {
        const noDiag = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
        const noTs = {
          completionItems: false, hovers: false, documentSymbols: false, definitions: false,
          references: false, documentHighlights: false, rename: false, diagnostics: false,
          documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false,
          codeActions: false, inlayHints: false
        };
        ts.typescriptDefaults.setDiagnosticsOptions(noDiag);
        ts.javascriptDefaults.setDiagnosticsOptions(noDiag);
        ts.typescriptDefaults.setModeConfiguration(noTs);
        ts.javascriptDefaults.setModeConfiguration(noTs);
      }
      const html = monaco.languages.html;
      if (html) {
        html.htmlDefaults.setModeConfiguration({
          completionItems: false, hovers: false, documentSymbols: false, links: false,
          documentHighlights: false, rename: false, colors: false, foldingRanges: false,
          diagnostics: false, selectionRanges: false, documentFormattingEdits: false,
          documentRangeFormattingEdits: false
        });
      }
    } catch (e) { console.warn("monaco: disabling language workers failed:", e); }

    const mk = (host, lang) => monaco.editor.create($(host), {
      value: "", language: lang, theme: "vstai", automaticLayout: true,
      minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false,
      fontFamily: "ui-monospace, Menlo, monospace"
    });
    editors.dsp  = mk("dspEditor", "typescript");
    editors.html = mk("htmlEditor", "html");
    editors.std  = mk("stdEditor", "html");
    const save = () => doCompile();
    editors.dsp.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    editors.html.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    return true;
  } catch (e){
    console.warn("Monaco failed, falling back to plain editors:", e);
    monaco = null;
    for (const [host, key] of [["dspEditor","dsp"],["htmlEditor","html"],["stdEditor","std"]]){
      const ta = document.createElement("textarea");
      ta.spellcheck = false; $(host).appendChild(ta); editors[key] = { _ta: ta,
        getValue: () => ta.value, setValue: (v) => { ta.value = v || ""; }, layout: () => {} };
    }
    return false;
  }
}
const edGet = (k) => editors[k] ? editors[k].getValue() : "";
const edSet = (k, v) => { if (editors[k]) editors[k].setValue(v || ""); };

/* ---------- seed UI from state -------------------------------------- */
function reseed(s){
  $("kindSub").textContent = s.isInstrument ? "instrument generator" : "audio-effect generator";
  const nm = (s.name && s.name !== "Untitled") ? s.name : "";
  const pn = $("pluginName");
  pn.textContent = nm;
  pn.hidden = !nm;
  edSet("dsp", s.assembly);
  edSet("html", s.html);
  $("styleChk").checked = !!s.applyDesignStyle;
}

/* ---------- actions -------------------------------------------------- */
async function doGenerate(){
  const prompt = $("promptBox").value.trim();
  if (!prompt){ setStatus("Type a prompt first."); return; }
  setBusy(true); setStatus("Generating with AI…");
  const r = await N.generate(prompt);
  setBusy(false);
  if (r && r.ok){ $("promptBox").value = ""; setStatus(r.message ? "Done — notes in the Notes tab." : "Done."); if (r.message) $("notesView").textContent = r.message; }
  else setStatus("Error: " + (r ? r.message : "unknown"));
  refreshAccount();   // a cloud build just spent credits — update the header chip
}
async function doCompile(){
  setBusy(true); setStatus("Compiling edited code…");
  const r = await N.compile(edGet("dsp"), edGet("html"));
  setBusy(false);
  $("notesView").textContent = r ? r.message : "";
  setStatus(r && r.ok ? "Compiled OK." : "Compile failed.");
  if (r && !r.ok) selectTab("notes");
}
async function doFix(){
  setBusy(true); setStatus("Fixing with AI…");
  const r = await N.fixWithAI(edGet("dsp"), edGet("html"), "");
  setBusy(false);
  $("notesView").textContent = r ? r.message : "";
  setStatus(r && r.ok ? "AI fix applied." : "Error: " + (r ? r.message : "unknown"));
}

on("generateBtn","click", doGenerate);
on("styleChk","change", async () => {
  state = await N.setApplyDesignStyle($("styleChk").checked);
  setStatus($("styleChk").checked
    ? "Design: generations use the Settings design school."
    : "Design: no template sent — the AI designs the GUI freely.");
});
on("newBtn","click", async () => { state = await N.newDoc(); reseed(state); reloadPreview(); setStatus("New blank plugin. Describe one above."); });
on("saveBtn","click", async () => { const r = await N.save(); setStatus(r ? r.message : ""); });
on("loadBtn","click", async () => { const r = await N.load(); if (r && r.ok){ state = await N.getState(); reseed(state); reloadPreview(); } setStatus(r ? r.message : ""); });
on("publishBtn","click", async () => { setBusy(true); setStatus("Publishing to the web catalogue…"); const r = await N.publish(); setBusy(false); setStatus(r ? r.message : "Publish failed."); });
on("exportBtn","click", async () => { setBusy(true); setStatus("Exporting a standalone, locked plugin…"); const r = await N.exportPlugin(); setBusy(false); setStatus(r ? r.message : "Export failed."); });

/* ---------- gallery browser ------------------------------------------ */
// Browse the online GitHub gallery and load an example plugin on the fly. The
// index + .vstai downloads happen natively (C++, no CORS); we only render here.
let galleryItems = null;      // cached index rows matching this plugin's type
let gallerySelected = null;   // the item whose detail "side" is open

// Thumbnails of each plugin's rendered GUI, published next to the gallery data
// by scripts/gallery-shots.mjs (an <img> can load these cross-origin directly).
const GALLERY_SHOTS_BASE = "https://k1ln.github.io/VibePlugin/gallery/shots/";

function galleryShow(show){ $("galleryModal").hidden = !show; }
function galleryShowList(){
  $("galleryDetail").hidden = true;
  $("galleryListView").hidden = false;
  $("galleryTitle").textContent = "Gallery";
}
function galleryShortDesc(txt){
  if (!txt) return "";
  const s = String(txt).replace(/\s+/g, " ").trim();
  return s.length > 280 ? s.slice(0, 277) + "…" : s;   // list rows fit ~4 lines
}
async function openGallery(){
  galleryShow(true);
  galleryShowList();
  $("gallerySearch").value = "";
  if (galleryItems){ renderGallery(""); return; }
  $("galleryGrid").innerHTML = "";
  $("galleryStatus").textContent = "Loading the gallery…";
  let r; try { r = await N.galleryIndex(); } catch(e){ r = null; }
  if (!r || !r.ok || !Array.isArray(r.items)){
    $("galleryStatus").textContent = (r && r.message) || "Could not reach the gallery. Check your connection.";
    return;
  }
  // Only show entries that match this instance's type (synth vs effect) — you
  // can't run an effect .vstai in the instrument build and vice-versa.
  const wantInstrument = !!state.isInstrument;
  galleryItems = r.items.filter((it) => !!it.isInstrument === wantInstrument);
  renderGallery("");
}
function renderGallery(query){
  const grid = $("galleryGrid");
  grid.innerHTML = "";
  const q = (query || "").trim().toLowerCase();
  const list = (galleryItems || []).filter((it) =>
    !q || (it.name && it.name.toLowerCase().includes(q))
       || (it.explanation && it.explanation.toLowerCase().includes(q)));
  if (!list.length){
    $("galleryStatus").textContent =
      (galleryItems && galleryItems.length) ? "No matches." : "The gallery has no plugins of this type yet.";
    return;
  }
  $("galleryStatus").textContent = list.length + (list.length === 1 ? " plugin" : " plugins");
  for (const it of list){
    const card = document.createElement("button");
    card.className = "gallery-card"; card.type = "button";
    // Rendered-GUI thumbnail (lazy so a long list stays snappy). Entries
    // without a published shot just lose the image, keeping the text row.
    const shot = document.createElement("img");
    shot.className = "gc-shot"; shot.loading = "lazy"; shot.alt = "";
    shot.src = GALLERY_SHOTS_BASE + encodeURIComponent(it.id) + ".jpg";
    shot.addEventListener("error", () => shot.remove());
    const body = document.createElement("div"); body.className = "gc-body";
    const name = document.createElement("div"); name.className = "gc-name"; name.textContent = it.name || it.slug || "Untitled";
    const desc = document.createElement("div"); desc.className = "gc-desc"; desc.textContent = galleryShortDesc(it.explanation);
    const kind = document.createElement("span"); kind.className = "gc-kind"; kind.textContent = it.isInstrument ? "Instrument" : "Effect";
    body.append(name, desc, kind);
    card.append(shot, body);
    card.addEventListener("click", () => galleryOpenDetail(it));
    grid.appendChild(card);
  }
}
function galleryOpenDetail(it){
  gallerySelected = it;
  $("galleryListView").hidden = true;
  $("galleryDetail").hidden = false;
  $("galleryTitle").textContent = it.name || "Plugin";
  $("galleryDetailName").textContent = it.name || it.slug || "Untitled";
  const shot = $("galleryDetailShot");
  shot.hidden = true;
  shot.onload  = () => { shot.hidden = false; };
  shot.onerror = () => { shot.hidden = true; };
  shot.src = GALLERY_SHOTS_BASE + encodeURIComponent(it.id) + ".jpg";
  $("galleryDetailDesc").textContent = it.explanation || "";
  $("galleryDetailStatus").textContent = "";
  const btn = $("galleryLoadBtn"); btn.disabled = false; btn.textContent = "Load Plugin";
}
async function galleryLoadSelected(){
  if (!gallerySelected) return;
  const slug = gallerySelected.slug || gallerySelected.id;
  if (!slug){ $("galleryDetailStatus").textContent = "This entry has no downloadable file."; return; }
  const btn = $("galleryLoadBtn");
  btn.disabled = true; btn.textContent = "Loading…";
  $("galleryDetailStatus").textContent = "Downloading " + (gallerySelected.name || slug) + "…";
  let r; try { r = await N.galleryLoad(slug); } catch(e){ r = null; }
  if (r && r.ok){
    state = await N.getState(); reseed(state); reloadPreview();
    galleryShow(false);
    setStatus(r.message || ("Loaded " + (gallerySelected.name || slug)));
  } else {
    btn.disabled = false; btn.textContent = "Load Plugin";
    $("galleryDetailStatus").textContent = (r && r.message) || "Load failed.";
  }
}
on("galleryBtn","click", openGallery);
on("galleryCloseBtn","click", () => galleryShow(false));
on("galleryBackBtn","click", galleryShowList);
on("galleryLoadBtn","click", galleryLoadSelected);
$("gallerySearch").addEventListener("input", (e) => renderGallery(e.target.value));
$("galleryModal").addEventListener("click", (e) => { if (e.target === $("galleryModal")) galleryShow(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("galleryModal").hidden) galleryShow(false); });
on("compileBtn","click", doCompile);
on("fixBtn","click", doFix);
on("revertBtn","click", () => { edSet("dsp", state.assembly); edSet("html", state.html); setStatus("Reverted to the last compiled source."); });
on("keysBtn","click", () => selectTab("settings"));
on("accountBtn","click", () => N.openAccount());

/* ---------- cloud credits chip (header) ---------------------------- */
// How many cloud credits the signed-in account has left. Pulled from the
// server; shown only while signed in. Refreshed on boot, after each generate,
// and whenever the Account dialog reports a change (sign-in/out, top-up).
async function refreshAccount(){
  const chip = $("creditsChip");
  let a; try { a = await N.getAccount(); } catch { a = null; }
  if (!a || !a.signedIn){ chip.hidden = true; return; }
  if (a.ok && typeof a.credits === "number"){
    chip.textContent = a.credits.toLocaleString() + (a.credits === 1 ? " credit" : " credits");
    chip.classList.toggle("low", a.credits <= 0);
  } else {
    chip.textContent = "credits —";
    chip.classList.remove("low");
  }
  chip.hidden = false;
}
backend.addEventListener("accountChanged", refreshAccount);

/* ---------- settings tab (keys + design school) --------------------- */
let selectedDesign = "minimal";
async function renderSettings(){
  const s = await N.getSettings();
  if (s){
    $("setAnthropic").value = s.anthropicKey || "";
    $("setPublish").value   = s.publishUrl || "";
    $("setNotary").value    = s.notaryProfile || "";
    selectedDesign = s.designId || selectedDesign;
    const src = s.generationSource || "anthropic";
    $("srcCloud").checked     = src === "cloud";
    $("srcAnthropic").checked = src === "anthropic";
  }
  await renderDesigns();
  await renderDiagnostics();
}
for (const id of ["srcCloud","srcAnthropic"])
  on(id, "change", async (e) => {
    state = await N.setGenerationSource(e.target.value);
    rebuildModelSelect(state);
    if (e.target.value === "cloud" && !state.signedIn) N.openAccount();
    if (e.target.value === "anthropic" && !$("setAnthropic").value.trim()) $("setAnthropic").focus();
    refreshAccount();
  });

/* ---------- diagnostics (log + technical state) ---------------------- */
// The plugin runs inside a DAW, which swallows stdout and hides log files, so
// the log has to be visible from inside the UI or it may as well not exist.
let diagTimer = null;

function fact(k, v, cls){
  const d = document.createElement("div");
  const kk = document.createElement("span"); kk.className = "k"; kk.textContent = k;
  const vv = document.createElement("span"); vv.className = "v" + (cls ? " " + cls : "");
  vv.textContent = String(v); vv.title = String(v);
  d.append(kk, vv); return d;
}

async function renderDiagnostics(){
  const d = await N.getDiagnostics();
  if (!d) return;

  const f = $("diagFacts");
  f.textContent = "";
  f.append(
    fact("Build",     d.build),
    fact("Model",     (d.provider ? d.provider + " · " : "") + (d.model || "?")),
    fact("Effort",    (d.effort || "?") + (d.thinking ? " · thinking on" : "")),
    fact("Kind",      d.kind || "?"),
    fact("DSP source", (d.asmChars || 0) + " chars"),
    fact("GUI source", (d.htmlChars || 0) + " chars"),
    fact("Compiled",  (d.wasmBytes || 0) + " bytes wasm", d.wasmBytes ? "ok" : "bad"),
    fact("UI assets", d.uiFound ? "found" : "MISSING", d.uiFound ? "ok" : "bad"),
    fact("Compiler",  d.compilerFound ? "found" : "MISSING", d.compilerFound ? "ok" : "bad"),
    fact("Dev log",   d.devMode ? d.logFile : "off (in-memory only)"),
    fact("System",    (d.os || "?") + " · JUCE " + (d.juce || "?")),
  );

  // Only auto-scroll when already pinned to the bottom, so reading history
  // isn't yanked away by the auto-refresh.
  const el = $("diagLog");
  const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.textContent = d.log || "(nothing logged yet)";
  if (pinned) el.scrollTop = el.scrollHeight;
}

function diagAuto(onOff){
  if (diagTimer) { clearInterval(diagTimer); diagTimer = null; }
  if (onOff) diagTimer = setInterval(() => {
    if (activeTab === "settings") renderDiagnostics();
  }, 1500);
}

on("diagRefreshBtn","click", renderDiagnostics);
on("diagAutoChk","change", (e) => diagAuto(e.target.checked));
on("diagClearBtn","click", async () => {
  await N.clearDiagnostics();
  await renderDiagnostics();
  $("diagStatus").textContent = "cleared";
  setTimeout(() => $("diagStatus").textContent = "", 1500);
});
on("diagCopyBtn","click", async () => {
  const facts = [...$("diagFacts").children].map(c => c.textContent).join("\n");
  const text  = facts + "\n\n" + $("diagLog").textContent;
  try { await navigator.clipboard.writeText(text); $("diagStatus").textContent = "copied"; }
  catch { // clipboard API is often blocked inside a plugin WebView — select instead
    const r = document.createRange(); r.selectNodeContents($("diagLog"));
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    $("diagStatus").textContent = "selected — press Cmd/Ctrl+C";
  }
  setTimeout(() => $("diagStatus").textContent = "", 2500);
});
diagAuto(true);
async function renderDesigns(){
  const rows = await N.getDesigns();
  const grid = $("designGrid");
  grid.innerHTML = "";
  for (const d of (rows || [])){
    if (d.selected) selectedDesign = d.id;
    const card = document.createElement("button");
    card.className = "design-card" + (d.selected ? " on" : "");
    card.type = "button";
    const name = document.createElement("div"); name.className = "dc-name"; name.textContent = d.name;
    const blurb = document.createElement("div"); blurb.className = "dc-blurb"; blurb.textContent = d.blurb || "";
    card.append(name, blurb);
    if (!d.builtin){
      const tag = document.createElement("span"); tag.className = "dc-tag"; tag.textContent = "custom";
      card.append(tag);
      const del = document.createElement("span"); del.className = "dc-del"; del.textContent = "✕"; del.title = "Remove this imported design";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await N.removeDesign(d.id);
        await renderDesigns(); reloadPreview();
        $("designStatus").textContent = "Removed.";
      });
      card.append(del);
    }
    card.addEventListener("click", async () => {
      const r = await N.setDesign(d.id);
      selectedDesign = d.id;
      applyTheme(d.theme);   // re-skin the shell immediately (live, no reload)
      await renderDesigns(); reloadPreview();
      $("designStatus").textContent = r ? r.message : "";
    });
    grid.append(card);
  }
}
on("setSaveBtn","click", async () => {
  const r = await N.saveSettings(JSON.stringify({
    anthropicKey:  $("setAnthropic").value.trim(),
    publishUrl:    $("setPublish").value.trim(),
    notaryProfile: $("setNotary").value.trim(),
  }));
  $("setStatus").textContent = r ? r.message : "Saved.";
});
on("importDesignBtn","click", async () => {
  const r = await N.importDesign();
  $("designStatus").textContent = r ? r.message : "";
  if (r && r.ok){ await renderDesigns(); reloadPreview(); }
});
on("exportDesignBtn","click", async () => {
  const r = await N.exportDesign(selectedDesign);
  $("designStatus").textContent = r ? r.message : "";
});

/* ---------- collapse the AI editor down to the GUI ------------------- */
let collapsed = false;
function setCollapsed(c){
  collapsed = c;
  document.body.classList.toggle("collapsed", c);
  $("collapseBtn").textContent = c ? "Show editor ▾" : "Hide editor ▴";
  $("collapseBtn").title = c ? "Show the full editor" : "Hide the editor — show just the plugin GUI";
  if (c) selectTab("preview");   // collapsed view shows the generated GUI
  // let Monaco / preview re-measure after the layout change
  for (const k in editors) if (editors[k] && editors[k].layout) editors[k].layout();
}
on("collapseBtn","click", () => setCollapsed(!collapsed));

// Cmd+Enter (macOS) / Ctrl+Enter (Windows, Linux) generates. A bare Enter inserts
// a newline like any other textarea, so a multi-line prompt can't fire a build by
// accident half-way through being typed.
$("promptBox").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)){ e.preventDefault(); doGenerate(); }
});

/* ---------- standard UI tab ----------------------------------------- */
on("stdSaveBtn","click", async () => { const r = await N.saveStandardUi(edGet("std")); setStatus(r ? r.message : ""); });
on("stdResetBtn","click", async () => { const html = await N.resetStandardUi(); edSet("std", html); setStatus("Standard UI reset to the built-in default."); });

/* ---------- chatbot modal ------------------------------------------- */
// Robust clipboard: Clipboard API → execCommand fallback → show text to copy.
async function copyText(text, target){
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta);
    if (ok) return true;
  } catch {}
  if (target){ target.value = text; target.focus(); target.select(); }   // last resort: let them ⌘C
  return false;
}
// "Same chat" = a short follow-up prompt that leans on the chatbot's own context
// instead of re-pasting the system rules + current code. Only meaningful once a
// plugin exists.
function sameChatActive(){ return !$("sameChatWrap").hidden && $("sameChatChk").checked; }
async function copyPrompt(){
  const desc = $("promptBox").value.trim();
  let text;
  try { text = sameChatActive() ? await N.buildManualUpdatePrompt(desc)
                                 : await N.buildManualPrompt(desc); }
  catch (e){ $("chatStatus").textContent = "Couldn't build the prompt: " + e; return; }
  const copied = await copyText(text, $("promptCopyArea"));
  $("promptCopyArea").value = text;
  const sc = sameChatActive();
  $("chatStatus").textContent = copied
    ? (sc ? "Short update prompt copied — paste it into the SAME chat."
          : (desc ? "Prompt copied — paste it into a chatbot." : "Prompt copied. Tip: describe what you want above for a better result."))
    : "Select the prompt below and copy it (⌘/Ctrl+C).";
}
on("chatbotBtn","click", () => {
  $("chatModal").hidden = false;
  $("chatStatus").textContent = "";
  for (const id of ["asmPaste","htmlPaste","jsonPaste","replyPaste"]) $(id).value = "";
  setPasteMode("one");     // one full-reply paste is the default
  // Offer the "same chat" shortcut only when there's already a plugin to edit.
  $("sameChatWrap").hidden = !state.hasPlugin;
  $("sameChatChk").checked = false;
  clearError();
  copyPrompt();
});
on("copyPromptBtn","click", copyPrompt);
on("sameChatChk","change", copyPrompt);
on("chatCloseBtn","click", () => { $("chatModal").hidden = true; });

// Paste mode: "one" = single full reply (default), "parts" = three separate boxes.
let pasteMode = "one";
function setPasteMode(mode){
  pasteMode = (mode === "parts") ? "parts" : "one";
  $("pasteOne").hidden   = pasteMode !== "one";
  $("pasteParts").hidden = pasteMode !== "parts";
  $("modeOneBtn").classList.toggle("active",   pasteMode === "one");
  $("modePartsBtn").classList.toggle("active", pasteMode === "parts");
}
on("modeOneBtn","click",   () => setPasteMode("one"));
on("modePartsBtn","click", () => setPasteMode("parts"));

// Parse ```fenced blocks out of a full reply into {asm, html, json}.
function splitFenced(text){
  const out = { asm:"", html:"", json:"" }, blocks = [];
  const re = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) blocks.push({ lang:(m[1]||"").toLowerCase(), body:m[2].trim() });
  const claimed = new Set();
  const pick = (langs) => {
    for (const l of langs){
      const i = blocks.findIndex((x, ix) => x.lang === l && !claimed.has(ix));
      if (i >= 0){ claimed.add(i); return blocks[i].body; }
    }
    return "";
  };
  out.asm  = pick(["assemblyscript","typescript","ts","javascript","js","as"]);
  out.html = pick(["html","htm","xml"]);
  out.json = pick(["json","json5"]);
  // Positional fallback for untagged blocks — never reuse one already claimed by
  // a tagged role (else a json-only-tagged reply mis-fills the HTML box).
  const nextFree = () => {
    const i = blocks.findIndex((_, ix) => !claimed.has(ix));
    if (i < 0) return "";
    claimed.add(i); return blocks[i].body;
  };
  if (!out.asm)  out.asm  = nextFree();
  if (!out.html) out.html = nextFree();
  if (!out.json) out.json = nextFree();
  return out;
}
on("splitPasteBtn","click", () => {
  // Operate on whatever's in the AssemblyScript box (paste the whole reply there).
  const src = $("asmPaste").value;
  if (!/```/.test(src)){ $("chatStatus").textContent = "Paste the full reply into the AssemblyScript box first, then click again."; return; }
  const p = splitFenced(src);
  if (p.asm)  $("asmPaste").value  = p.asm;
  if (p.html) $("htmlPaste").value = p.html;
  if (p.json) $("jsonPaste").value = p.json;
  $("chatStatus").textContent = "Split into the boxes — review, then Apply & build.";
});
let lastBuiltAsm = "";   // remember the source we tried, for the fix request
function showError(msg){
  $("errorBox").value = msg || "Unknown error.";
  $("errorWrap").hidden = false; $("errorActions").hidden = false;
  $("errorBox").scrollIntoView({ block:"nearest" });
}
function clearError(){ $("errorWrap").hidden = true; $("errorActions").hidden = true; $("errorBox").value = ""; }

// Shared result handling for both paste modes: on success close the modal (the
// plugin is built), otherwise surface the error inline so it can be fixed.
function manualBuildResult(r){
  if (r && r.ok){
    $("chatModal").hidden = true;
    $("chatStatus").textContent = "";
    setStatus("Built ✓");
  } else {
    $("chatStatus").textContent = "It didn't build — see the error below.";
    showError(r ? r.message : "unknown");
  }
}

on("applyReplyBtn","click", async () => {
  const prompt = $("promptBox").value.trim();
  clearError();

  if (pasteMode === "one"){
    const reply = $("replyPaste").value.trim();
    if (!reply){ $("chatStatus").textContent = "Paste the chatbot's reply first."; return; }
    lastBuiltAsm = splitFenced(reply).asm || reply;   // keep the source for the fix request
    $("chatStatus").textContent = "Compiling pasted reply…";
    const r = await N.applyManualReply(reply, prompt);
    manualBuildResult(r);
    return;
  }

  // Three-parts mode.
  let asm = $("asmPaste").value.trim();
  let html = $("htmlPaste").value.trim();
  let json = $("jsonPaste").value.trim();
  // Be forgiving: if someone dropped the whole fenced reply into the asm box, split it.
  if (/```/.test(asm)){ const p = splitFenced(asm); asm = p.asm || asm; html = html || p.html; json = json || p.json; }
  if (!asm){ $("chatStatus").textContent = "Paste the AssemblyScript block first."; return; }
  lastBuiltAsm = asm;
  $("chatStatus").textContent = "Compiling pasted code…";
  const r = await N.applyManualParts(asm, html, json, prompt);
  manualBuildResult(r);
});
on("copyErrorBtn","click", async () => {
  const ok = await copyText($("errorBox").value, $("errorBox"));
  $("chatStatus").textContent = ok ? "Error copied." : "Select the error text and copy it (⌘/Ctrl+C).";
});
on("copyFixBtn","click", async () => {
  const fix = await N.manualFixPrompt(lastBuiltAsm, $("errorBox").value);
  const ok = await copyText(fix, $("errorBox"));
  $("chatStatus").textContent = ok ? "Fix request copied — paste it back into the SAME chat, then paste the new reply above."
                                   : "Couldn't copy — the fix request is in the box; select and copy it.";
});

/* ---------- boot ----------------------------------------------------- */
(async function init(){
  await loadMonaco();
  state = await N.getState();
  applyTheme(state.designTheme);
  rebuildModelSelect(state);
  reseed(state);
  edSet("std", await N.getStandardUi());
  selectTab("preview");
  // Signal the backend our bridge is live; it returns the freshest state
  // (e.g. Ollama models discovered during startup) and starts emitting events.
  try { state = await N.ready(); applyTheme(state.designTheme); rebuildModelSelect(state); reseed(state); } catch (e) {}
  setStatus("Ready.");
  refreshAccount();   // show the signed-in account's cloud credits in the header
})();
