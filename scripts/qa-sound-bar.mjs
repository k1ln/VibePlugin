#!/usr/bin/env node
// qa-sound-bar.mjs
// =====================================================================
//  Does every plugin GUI get a working sound bar? Headless Chrome opens each .vstai's GUI
//  at the default plugin size (900x600) inside a stand-in host (a vstai object plus the
//  sound browser's page-side controller, ui/webclap/presets.js, and the real drawer,
//  ui/preset-browser.js) and checks, per GUI:
//    * (uncaught page errors are listed as notes: some old GUIs have their own bugs),
//    * the floating bar exists, is on screen, and shows the name button / Save,
//    * Save opens the drawer on the save form, saving stores the knobs, the bar's name follows,
//      and next / prev load a sound back through the GUI's own onParam callbacks.
//  With --wclap it ALSO opens the real exported WebCLAP page (shim.js and all) inside a fake
//  CLAP host that plays the plugin's part of the clap.webview protocol.
//
//      node scripts/qa-sound-bar.mjs [--dir docs/gallery/data] [--only a,b] [--shots out/]
//                                    [--shot-every 25] [--wclap docs/gallery/webclap [--skip-gui]]
//
//  Exits 1 on any failure. Needs Google Chrome; uses CDP over Node's WebSocket (Node >= 22).
// =====================================================================
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DIR = path.resolve(ROOT, arg("--dir", "docs/gallery/data"));
const ONLY = arg("--only", "") ? arg("--only").split(",") : null;
const SHOTS = arg("--shots", ""), EVERY = +arg("--shot-every", 0);
const WCLAP = arg("--wclap", "");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8900 + Math.floor(Math.random() * 90), CDP = 9400 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 900, H = 600;

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const PRESETS_JS = read("ui/webclap/presets.js");
const BROWSER_JS = read("ui/preset-browser.js");

// ---- the stand-in host --------------------------------------------------------------------
const STUB = `<script>
(function(){ var vals={}, cbs=[];
  window.__vstaiRestored={};
  window.vstai={ setParam:function(i,v){vals[i|0]=+v;}, getParam:function(i){return (i|0) in vals?vals[i|0]:0;},
    onParam:function(cb){cbs.push(cb);}, onReady:function(cb){cb();}, hostMenu:function(){}, onDisplay:function(){},
    noteOn:function(){}, noteOff:function(){}, loadSample:function(){return Promise.reject(new Error('n/a'));},
    _setFromHost:function(i,v){vals[i|0]=+v; cbs.forEach(function(cb){try{cb(i|0,+v);}catch(e){}});} };
})();</script>`;
function cfgOf(doc) {
  const params = (doc.params || []).filter((p) => p.index >= 0 && p.index < 63).map((p) => ({ index: p.index, def: p.default }));
  return { id: "qa." + doc.name, product: doc.name, instrument: !!doc.isInstrument, params, presets: doc.presets || [] };
}
function hostPage(doc) {
  const inject = `<meta charset="utf-8">${STUB}<script>window.__vstaiPresetCfg=${JSON.stringify(cfgOf(doc)).replace(/<\//g, "<\\/")};</script>` +
                 `<script>${PRESETS_JS}</script><script>${BROWSER_JS}</script>`;
  const h = doc.html, at = h.toLowerCase().indexOf("<head>");
  return at >= 0 ? h.slice(0, at + 6) + inject + h.slice(at + 6) : inject + h;
}

// ---- the fake CLAP host for --wclap -------------------------------------------------------
const CLAP_HOST = `<!doctype html><meta charset=utf-8><body style="margin:0"><iframe id=f src="/wclap/PAGE" style="width:${W}px;height:${H}px;border:0"></iframe><script>
// The plugin's side of ui/webclap/shim.js: answer hello with every value, remember edits.
var params = PARAMS, edits = [];
var f = document.getElementById('f');
window.edits = edits;
window.addEventListener('message', function (e) {
  var d = e.data; if (!(d instanceof ArrayBuffer)) return;
  var v = new DataView(d), t = v.getUint8(0);
  if (t === 0x48) {
    var b = new Uint8Array(3 + params.length * 12), w = new DataView(b.buffer); b[0] = 0x50; w.setUint16(1, params.length, true);
    params.forEach(function (p, k) { w.setUint32(3 + k * 12, p.index, true); w.setFloat64(7 + k * 12, p.def, true); });
    f.contentWindow.postMessage(b.buffer, '*');
  } else if (t === 0x50) edits.push([v.getUint32(1, true), v.getFloat64(5, true)]);
});
</script>`;

// ---- tiny http server ---------------------------------------------------------------------
const docs = new Map();
// DIR holds <id>.vstai files, or (factory/plugins) one folder per plugin with <id>/<id>.vstai in it.
const found = readdirSync(DIR, { recursive: true }).map(String).filter((f) => f.endsWith(".vstai"));
const files = found.map((f) => path.basename(f, ".vstai")).filter((id) => !ONLY || ONLY.includes(id)).sort();
for (const f of found) { const id = path.basename(f, ".vstai"); if (files.includes(id)) docs.set(id, JSON.parse(readFileSync(path.join(DIR, f), "utf8"))); }
const wclapPages = new Map();      // id -> index.html text, filled in below
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let m;
  if ((m = u.match(/^\/gui\/(.+)$/)) && docs.has(m[1])) { res.writeHead(200, { "content-type": "text/html;charset=utf-8" }); return res.end(hostPage(docs.get(m[1]))); }
  if ((m = u.match(/^\/wclap\/(.+)$/)) && wclapPages.has(m[1])) { res.writeHead(200, { "content-type": "text/html;charset=utf-8" }); return res.end(wclapPages.get(m[1])); }
  if ((m = u.match(/^\/clap\/(.+)$/)) && docs.has(m[1])) {
    const params = docs.get(m[1]).params.filter((p) => p.index < 63).map((p) => ({ index: p.index, def: p.default }));
    res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
    return res.end(CLAP_HOST.replace("PAGE", m[1]).replace("PARAMS", JSON.stringify(params)));
  }
  res.writeHead(404); res.end("no");
}).listen(PORT);

// ---- chrome ---------------------------------------------------------------------------------
const profile = mkdtempSync(path.join(os.tmpdir(), "vstai-qa-bar-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch {} server.close(); });
let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) { await sleep(200); try { targets = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === "page"); } catch {} }
if (!targets.length) { console.error("could not reach Chrome"); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nid = 0; const pending = new Map(); let pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  else if (d.method === "Runtime.exceptionThrown") pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++nid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const ev = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64")); };

// ---- one GUI --------------------------------------------------------------------------------
// `scope` is the JS expression for the window that holds the GUI (the page itself, or the iframe).
const CHECK = (scope) => `(async () => {
  const w = ${scope}, d = w.document, out = {};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const own = !!d.querySelector('[data-vstai-sound]');
  const host = d.getElementById('vstai-sound-bar');
  out.own = own; out.bar = !!host;
  if (!host) return out;
  const sr = host.shadowRoot, r = host.getBoundingClientRect();
  out.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  out.onscreen = r.width > 20 && r.height > 10 && r.left >= 0 && r.top >= 0 && r.right <= w.innerWidth + 1 && r.bottom <= w.innerHeight + 1;
  const btn = (c) => sr.querySelector('.' + c);
  out.buttons = ['grip','arrow','name','save','fold'].every(c => !!btn(c));
  // knobs: move every param to a value that is not its default, then save
  const params = w.__vstaiPresetCfg.params;
  params.forEach((p, k) => w.vstai._setFromHost(p.index, p.def + (k % 5) * 0.001 + 0.01));
  btn('save').click(); await wait(500);
  const dr = d.getElementById('vstai-sound-browser');
  out.drawerOpen = !!dr && dr.style.display === 'block';
  const form = dr && dr.shadowRoot.querySelector('.form');
  out.formShown = !!form && form.style.display === 'grid';
  if (!out.formShown) return out;
  const nm = form.querySelector('input'); nm.value = 'QA sound';
  [...form.querySelectorAll('button')].find(b => b.textContent === 'Save').click(); await wait(400);
  out.listed = [...dr.shadowRoot.querySelectorAll('ul li .nm b')].map(b => b.textContent);
  out.nameAfterSave = btn('name').textContent;
  w.vstai.closeBrowser(); await wait(250);
  // change the knobs, then load the sound back: the GUI's own onParam callbacks must be driven
  const first = params.length ? params[0].index : -1;
  const qa = w.vstai.presets.get().entries.filter(e => e.name === 'QA sound')[0];
  const hits = []; w.vstai.onParam((i, v) => { if (i === first) hits.push(v); });
  const wanted = w.vstai.getParam(first);
  w.vstai._setFromHost(first, wanted + 0.2);
  hits.length = 0;
  await w.vstai.presets.load(qa.id); await wait(100);
  out.restored = Math.abs(w.vstai.getParam(first) - wanted) < 1e-9;
  out.followed = hits.length > 0;
  // the arrows step through the list
  const total = w.vstai.presets.get().entries.length, before = w.vstai.presets.get().current;
  btn('arrow').click(); await wait(350);                       // first .arrow = previous
  const after = w.vstai.presets.get().current;
  out.stepped = total > 1 ? after !== before : after === before;
  return out;
})()`;

let failed = 0, n = 0;
const notes = [];
const fail = (id, why) => { failed++; console.error(`FAIL ${id}: ${why}`); };
for (const id of (process.argv.includes("--skip-gui") ? [] : files)) {
  n++;
  pageErrors = [];
  await cdp("Page.navigate", { url: `http://localhost:${PORT}/gui/${encodeURIComponent(id)}` });
  await sleep(1900);
  let r;
  try { r = await ev(CHECK("window")); } catch (e) { fail(id, "check threw: " + String(e.message).split("\n")[0]); continue; }
  if (SHOTS && EVERY && (n - 1) % EVERY === 0) await shot(id);
  const errs = pageErrors.filter((e) => !/vstai-qa|ResizeObserver/.test(e));
  // A GUI's own bug (e.g. vocal-plate's negative ellipse radius, present before the bar) is a note, not our failure.
  if (errs.length) { notes.push(`${id}: ${errs[0].split("\n")[0]}`); console.log(`note ${id}: uncaught in the GUI: ${errs[0].split("\n")[0].slice(0, 120)}`); }
  if (r.own) { console.log(`ok   ${id} (GUI brings its own sound control)`); continue; }
  if (!r.bar) fail(id, "no sound bar");
  else if (!r.onscreen) fail(id, "bar off screen " + JSON.stringify(r.rect));
  else if (!r.buttons) fail(id, "bar is missing a button");
  else if (!r.drawerOpen || !r.formShown) fail(id, "Save did not open the save form");
  else if (!(r.listed || []).includes("QA sound")) fail(id, "saved sound not listed: " + JSON.stringify(r.listed));
  else if (r.nameAfterSave !== "QA sound") fail(id, "bar name did not follow: " + r.nameAfterSave);
  else if (!r.restored) fail(id, "prev did not restore the saved knob values");
  else if (!r.followed) fail(id, "GUI onParam was not driven by the load");
  else if (!r.stepped) fail(id, "the prev arrow did not step through the sounds");
  else console.log(`ok   ${id}`);
}

// ---- the real exported WebCLAP pages ---------------------------------------------------------
if (WCLAP) {
  n = 0;
  const dir = path.resolve(ROOT, WCLAP);
  for (const id of files) {
    const tgz = path.join(dir, id + ".wclap.tar.gz");
    if (!existsSync(tgz)) continue;
    const root = (await import("node:child_process")).execFileSync("tar", ["tzf", tgz]).toString().split("\n")[0].split("/")[0];
    wclapPages.set(id, execFileSync("tar", ["xzOf", tgz, root + "/ui/index.html"], { maxBuffer: 1 << 28 }).toString());
    n++; pageErrors = [];
    await cdp("Page.navigate", { url: `http://localhost:${PORT}/clap/${encodeURIComponent(id)}` });
    await sleep(2000);
    let r;
    try { r = await ev(`(async () => { const f = document.getElementById('f'); const w = f.contentWindow; w.__vstaiPresetCfg = w.__vstaiPresetCfg;
      const out = await (${CHECK("document.getElementById('f').contentWindow")}); out.edits = window.edits.length; return out; })()`); }
    catch (e) { fail(id + " [wclap]", "check threw: " + String(e.message).split("\n")[0]); continue; }
    if (SHOTS) {
      await shot("wclap-" + id);
      if (id === files[0] || ONLY) {            // and the drawer, open inside the real exported page
        await ev("document.getElementById('f').contentWindow.vstai.openBrowser(); new Promise(r => setTimeout(r, 450))");
        await shot("wclap-drawer-" + id);
      }
    }
    if (!r.bar && !r.own) fail(id + " [wclap]", "no sound bar");
    else if (r.bar && !(r.onscreen && r.buttons && r.formShown && (r.listed || []).includes("QA sound") && r.restored && r.followed && r.stepped)) fail(id + " [wclap]", JSON.stringify(r));
    else if (r.bar && !r.edits) fail(id + " [wclap]", "loading a sound sent no parameter edits to the plugin");
    else console.log(`ok   ${id} [wclap]`);
  }
}

if (notes.length) console.log(`\n${notes.length} GUI(s) threw errors of their own (not from the bar) - see the notes above`);
console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} GUIs have a working sound bar`);
process.exit(failed ? 1 : 0);
