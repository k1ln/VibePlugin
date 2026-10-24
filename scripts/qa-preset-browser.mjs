#!/usr/bin/env node
// qa-preset-browser.mjs
// =====================================================================
//  End-to-end check of the in-plugin sound browser: headless Chrome drives the real
//  UI (ui/preset-browser.js + the real bridge shim) against the real host-side
//  controller (src/PresetController.h, via tests/preset_bridge_cli.cpp).
//
//      node scripts/qa-preset-browser.mjs [--shots <dir>] [--bin <vstai_preset_bridge>]
//
//  Exits 1 on any failed assertion or uncaught page error. Needs Google Chrome and a
//  built vstai_preset_bridge (cmake --build <dir> --target vstai_preset_bridge).
//  Uses the Chrome DevTools protocol over Node's built-in WebSocket (Node >= 22).
// =====================================================================
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SHOTS = arg("--shots", "");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8800 + Math.floor(Math.random() * 100), CDP = 9300 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- processes -------------------------------------------------------------------------
const demoArgs = [path.join(HERE, "preset-browser-demo.mjs"), "--port", String(PORT), "--fresh"];
if (arg("--bin", "")) demoArgs.push("--bin", arg("--bin"));
const demo = spawn(process.execPath, demoArgs, { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { demo.stdout.on("data", (d) => String(d).includes("http://") && res()); demo.on("exit", () => rej(new Error("demo server exited"))); setTimeout(() => rej(new Error("demo server did not start")), 8000); });
const profile = mkdtempSync(path.join(os.tmpdir(), "vstai-qa-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--window-size=1100,820", "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} try { demo.kill(); } catch {} };
process.on("exit", cleanup);

// ---- minimal CDP client -----------------------------------------------------------------
let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) { await sleep(200); try { targets = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === "page"); } catch {} }
if (!targets.length) { console.error("could not reach Chrome"); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nid = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  else if (d.method === "Runtime.exceptionThrown") pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") pageErrors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++nid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
const ev = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => { if (!SHOTS) return; const r = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64")); };
const typeText = async (text) => { for (const ch of text) { await cdp("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); } };
const press = async (key, code, vk) => { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }); };

// ---- in-page helpers ----------------------------------------------------------------------
const SB = `document.getElementById('vstai-sound-browser').shadowRoot`;
const helpers = `
  window.$sr = () => ${SB};
  window.$rows = () => [...$sr().querySelectorAll('ul li')].filter(l => !l.classList.contains('empty')).map(l => l.querySelector('.nm b').textContent);
  window.$chips = (sel) => [...$sr().querySelectorAll(sel + ' .chip')].map(c => c.firstChild.textContent);
  window.$click = (el) => el.click();
  window.$chip = (sel, label) => [...$sr().querySelectorAll(sel + ' .chip')].find(c => c.firstChild.textContent === label);
  window.$btn = (label) => [...$sr().querySelectorAll('button')].find(b => b.textContent.trim() === label || b.textContent.startsWith(label));
  window.$row = (name) => [...$sr().querySelectorAll('ul li')].find(l => l.querySelector('.nm b') && l.querySelector('.nm b').textContent === name);
  window.$wait = (ms) => new Promise(r => setTimeout(r, ms));
  window.$knobs = async () => (await (await fetch('/demo/knobs')).json());
  true`;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok   :", msg); else { failures++; console.error("  FAIL :", msg); } };
const eq = async (expr, want, msg) => { const got = await ev(expr); const pass = JSON.stringify(got) === JSON.stringify(want); if (!pass) console.error("         got", JSON.stringify(got), "want", JSON.stringify(want)); ok(pass, msg); };
const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

// ---- the run ----------------------------------------------------------------------------------
await cdp("Page.navigate", { url: `http://localhost:${PORT}/` });
await sleep(1200);
await ev(helpers);
console.log("page loaded; shim exposes the host transport:", await ev("typeof vstai._call"));
await eq("typeof vstai.presets + '/' + typeof vstai.openBrowser", "object/function", "window.vstai.presets and openBrowser exist");
await eq("document.getElementById('vstai-sound-browser') === null", true, "nothing is injected into the page until the browser is opened");

console.log("opening the drawer");
await ev("vstai.openBrowser(); $wait(500)");
await shot("1-open");
const all = await ev("$rows()");
ok(all.length === 12, `lists all 12 factory sounds (${all.length})`);
ok(JSON.stringify(all) === JSON.stringify([...all].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)), "sorted by name");
const types = await ev("$chips('.chips')");
ok(types.includes("Bass") && types.includes("Pad") && types.includes("Bells"), "type chips include inferred types (Pad, Bells) and given ones (Bass): " + types.slice(0, 8).join(", "));
await eq("$sr().querySelector('.title small').textContent", "Demo Synth", "shows the product name");

console.log("Save is one click away, and the sounds are a file on disk");
await ev("vstai.closeBrowser(); $wait(400)");
await eq("document.getElementById('vstai-sound-browser').style.display", "none", "drawer closed");
await ev("vstai.saveSound(); $wait(500)");
await eq("$sr().querySelector('.form').style.display", "grid", "vstai.saveSound() from a closed drawer opens it straight on the save form");
await eq("$sr().querySelector('.form b').textContent", "Save current sound", "...titled Save current sound");
await ev("$click($btn('Cancel')); true");
await ev("window.postMessage({type:'vstai:browser',action:'save'},'*'); $wait(300)");
await eq("$sr().querySelector('.form').style.display", "grid", "the host can ask for the save form with postMessage (native Save button)");
await ev("$click($btn('Cancel')); true");
await eq("$btn('Show folder') !== undefined && $btn('Show folder').style.display !== 'none'", true, "Show folder is offered when the host can reveal it");
await ev("$click($btn('Show folder')); $wait(300)");
await eq("fetch('/demo/revealed').then(r => r.text())", "1", "pressing it asks the host to reveal the sounds folder");
ok(/Demo Synth/.test(await ev("$btn('Show folder').title")), "its tooltip says where the sounds live: " + await ev("$btn('Show folder').title"));

console.log("search, type and tag filters");
await ev("var q=$sr().querySelector('.search input'); q.value='bright'; q.dispatchEvent(new Event('input')); true");
await eq("$rows()", ["FM Bell", "Glass Keys", "Vapor Pluck"], "search \"bright\" matches by tag");
await ev("var q=$sr().querySelector('.search input'); q.value='warm pad'; q.dispatchEvent(new Event('input')); true");
await eq("$rows()", ["Warm Pad"], "multi-word search (\"warm pad\") ANDs the words");
await ev("var q=$sr().querySelector('.search input'); q.value=''; q.dispatchEvent(new Event('input')); $click($chip('.chips','Bass')); $wait(100)");
await eq("$rows()", ["Acid Bass", "Sub Boom", "Wobble"], "type chip Bass (\"Sub Boom\" is inferred as Bass from its name)");
const tagChips = await ev("[...$sr().querySelectorAll('.chips')][1] ? [...[...$sr().querySelectorAll('.chips')][1].querySelectorAll('.chip')].map(c=>c.firstChild.textContent) : []");
ok(tagChips.includes("analog") && tagChips.includes("acid"), "tag chips reflect the current type: " + tagChips.join(", "));
await ev("$click([...[...$sr().querySelectorAll('.chips')][1].querySelectorAll('.chip')].find(c=>c.firstChild.textContent==='analog')); $wait(100)");
await eq("$rows()", ["Wobble"], "Bass + tag analog");
await shot("2-filtered");
console.log("loading a sound moves the knobs");
// reset: untoggle the tag, then back to All types
await ev("[...[...$sr().querySelectorAll('.chips')][1].querySelectorAll('.chip.on')].forEach(c=>c.click()); $wait(80)");
await ev("$click($chip('.chips','All')); $wait(80)");
await eq("$rows().length", 12, "filters cleared");
const before = await ev("$knobs()");
await ev("$click($row('Glass Keys')); $wait(300)");
const glass = await ev("$knobs()");
ok(!close(before, glass) && close(glass, [0.2035, 0.407, 0.6105, 0.814, 0.0175, 0.221, 0.4245, 0.628]), "clicking Glass Keys set the eight knobs to its values");
await eq("$row('Glass Keys').className.includes('cur')", true, "the loaded sound is highlighted");
await eq("document.getElementById('name').textContent", "Glass Keys", "the page learned the current sound (onChange)");

console.log("favorites");
await ev("$click($row('Glass Keys').querySelector('.star')); $wait(200)");
await ev("$click($sr().querySelectorAll('.scopes button')[1]); $wait(100)");
await eq("$rows()", ["Glass Keys"], "star it, then the Favorites scope shows exactly it");
await ev("$click($sr().querySelectorAll('.scopes button')[0]); $wait(50)");

console.log("save your own sound");
await ev("fetch('/demo/randomize'); $wait(200)");
const mine = await ev("$knobs()");
await ev("$click($btn('\\uFF0B Save current sound')); $wait(100)");
await shot("3-save-form");
await ev("var f=$sr().querySelector('.form'); f.querySelector('input').value='My Lead 1'; f.querySelector('select').value='Lead'; f.querySelectorAll('input')[1].value='warm, test, Warm'; $click($btn('Save')); $wait(300)");
await eq("$rows().includes('My Lead 1')", true, "saved sound appears");
await ev("$click($sr().querySelectorAll('.scopes button')[3]); $wait(100)");
await eq("$rows()", ["My Lead 1"], "\"My sounds\" scope shows only user sounds");
await ev("$click($sr().querySelectorAll('.scopes button')[0]); $click($row('Init')); $wait(300)");
await ev("$click($row('My Lead 1')); $wait(300)");
ok(close(await ev("$knobs()"), mine), "loading My Lead 1 restores the knob positions at save time");
await ev("$click($btn('\\uFF0B Save current sound')); $wait(100)");
await eq("$sr().querySelector('.form input').value", "My Lead 1", "saving again prefills the current user sound's name (update, not duplicate)");
await ev("$click($btn('Cancel')); true");
await ev("$click($btn('\\uFF0B Save current sound')); $wait(60); var f=$sr().querySelector('.form'); f.querySelector('input').value='   '; $click($btn('Save')); $wait(200)");
await eq("$sr().querySelector('.msg').textContent", "Give the sound a name.", "a blank name is refused with a message");
await ev("$click($btn('Cancel')); true");

console.log("tags and custom types");
await ev("$click($row('My Lead 1').querySelector('.edit')); $wait(100)");
await eq("$sr().querySelectorAll('.form input')[1].value", "warm, test", "edit shows cleaned tags (the duplicate 'Warm' was dropped)");
await ev("$click($btn('Cancel')); true");
await ev("$click($btn('+ New type')); $wait(60); var i=$sr().querySelector('.chips input'); i.value='Wobbly'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); $wait(300)");
ok((await ev("$chips('.chips')")).includes("Wobbly"), "a user-defined type appears as a chip");
await ev("$click($row('My Lead 1').querySelector('.edit')); $wait(80); var f=$sr().querySelector('.form'); f.querySelector('select').value='Wobbly'; $click($btn('Save changes')); $wait(300)");
await ev("$click($chip('.chips','Wobbly')); $wait(100)");
await eq("$rows()", ["My Lead 1"], "filing a sound under the new type, then filtering by it");
await shot("4-custom-type");
await ev("var c=$chip('.chips','Wobbly'); var x=c.querySelector('.x'); x.click(); $wait(50); x.click(); $wait(300)");
ok(!(await ev("$chips('.chips')")).includes("Wobbly"), "deleting a user type removes the chip (two-step confirm)");
await ev("$click($chip('.chips','All')); $wait(50)");
await eq("[...$sr().querySelectorAll('ul li')].find(l=>l.textContent.includes('My Lead 1')).querySelector('.ty').textContent", "Other", "its sounds fall back to Other");
await ev("$click($btn('\\uFF0B Save current sound')); $wait(80); var f=$sr().querySelector('.form'); f.querySelector('input').value='Second'; $click($btn('Save')); $wait(300)");
await eq("$rows().includes('Second')", true, "a second user sound can be saved");
await ev("$click($row('My Lead 1').querySelector('.edit')); $wait(80); var f=$sr().querySelector('.form'); f.querySelector('input').value='second'; $click($btn('Save changes')); $wait(300)");
ok(/already/.test(await ev("$sr().querySelector('.msg').textContent")), "renaming onto another USER sound's name is refused (case-insensitive)");
await ev("$click($btn('Cancel')); true");
await ev("$click($row('My Lead 1').querySelector('.edit')); $wait(80); var f=$sr().querySelector('.form'); f.querySelector('input').value='Init'; $click($btn('Save changes')); $wait(300)");
await eq("$rows().filter(n => n === 'Init').length", 2, "a user sound MAY share a name with a factory sound (both listed)");
await ev("$click([...$sr().querySelectorAll('ul li')].filter(l=>l.querySelector('.nm b').textContent==='Init').pop().querySelector('.edit')); $wait(80); var f=$sr().querySelector('.form'); f.querySelector('input').value='My Lead 1'; $click($btn('Save changes')); $wait(300)");

console.log("keyboard behaviour");
await ev("window.__keydowns=0; $sr().querySelector('.search input').focus(); true");
await typeText("pad");
await eq("window.__keydowns", 0, "typing in the search box never reaches the page's own key handlers (typing piano)");
await eq("$rows()", ["Warm Pad"], "typed search filters live");
await press("ArrowDown", "ArrowDown", 40);
await press("Enter", "Enter", 13);
await sleep(300);
await eq("document.getElementById('name').textContent", "Warm Pad", "ArrowDown + Enter loads the highlighted sound");
await ev("var q=$sr().querySelector('.search input'); q.value=''; q.dispatchEvent(new Event('input')); true");
const was = await ev("document.getElementById('name').textContent");
await ev("vstai.nextPreset(); $wait(300)");
ok((await ev("document.getElementById('name').textContent")) !== was, "nextPreset() steps to another sound");
await ev("vstai.prevPreset(); $wait(300)");
await eq("document.getElementById('name').textContent", was, "prevPreset() steps back");
await press("Escape", "Escape", 27);
await sleep(400);
await eq("document.getElementById('vstai-sound-browser').style.display", "none", "Escape closes the drawer");
await ev("window.postMessage({type:'vstai:browser',action:'toggle'},'*'); $wait(400)");
await eq("document.getElementById('vstai-sound-browser').style.display", "block", "the host can open it with postMessage (native bar / shell button)");
await shot("5-final");
// the default plugin window is 900x600: the list must stay usable there, form open or not
await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
await sleep(200);
const listH = await ev("$sr().querySelector('ul').getBoundingClientRect().height");
ok(listH >= 230, `at 900x600 the list keeps room for several sounds (${Math.round(listH)}px)`);
await shot("6-small-window");
await ev("$click($btn('\\uFF0B Save current sound')); $wait(120)");
const formOk = await ev("(function(){ var f=$sr().querySelector('.form').getBoundingClientRect(); var p=$sr().querySelector('.panel').getBoundingClientRect(); return f.bottom <= p.bottom + 1 && f.top >= p.top; })()");
ok(formOk, "at 900x600 the save form fits inside the drawer");
const listWithForm = await ev("$sr().querySelector('ul').getBoundingClientRect().height");
ok(listWithForm >= 60, `and the list is still visible beside it (${Math.round(listWithForm)}px)`);
await shot("7-small-window-form");
await ev("$click($btn('Cancel')); true");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });

console.log("delete a user sound");
await ev("$click($row('My Lead 1').querySelector('.edit')); $wait(80); $click($btn('Delete')); $wait(60); $click($btn('Really delete?')); $wait(300)");
await eq("$rows().includes('My Lead 1')", false, "two-step delete removes it");

console.log("persistence: a fresh page load still has favorites");
await cdp("Page.navigate", { url: `http://localhost:${PORT}/` });
await sleep(1200);
await ev(helpers);
await ev("vstai.openBrowser(); $wait(500)");
await ev("$click($sr().querySelectorAll('.scopes button')[1]); $wait(100)");
await eq("$rows()", ["Glass Keys"], "the favorite survived a reload (stored on disk)");

console.log("inside every real design kit (spliced exactly like the plugin does it)");
{
  const designs = await (await fetch(`http://localhost:${PORT}/designs.json`)).json();
  let shown = 0, lacking = [];
  for (const d of designs) {
    await cdp("Page.navigate", { url: `http://localhost:${PORT}/gui/${d}` });
    await sleep(900);
    await ev(helpers);
    const before = pageErrors.length;
    await ev("window.postMessage({type:'vstai:browser',action:'open'},'*'); $wait(450)");
    const r = await ev("(function(){ var h=document.getElementById('vstai-sound-browser'); if(!h) return {ok:false}; var p=$sr().querySelector('.panel').getBoundingClientRect(); return {ok: h.style.display==='block' && p.width>300 && $rows().length>=12 && $rows().length===vstai.presets.get().entries.length, w:p.width, rows:$rows().length}; })()");
    if (r.ok) shown++; else lacking.push(d + " " + JSON.stringify(r));
    if (pageErrors.length > before) lacking.push(d + " threw: " + pageErrors.slice(before).join(" | "));
    // the kit's own header sound bar is wired to the host: load a sound and it must show that name
    await ev("$click($row('Warm Pad')); $wait(400)");
    const bar = await ev("(function(){ var e=document.querySelector('[data-vstai-sound]'); return e ? (e.value!==undefined && e.tagName==='INPUT' ? e.value : e.textContent) : null; })()");
    if (bar !== "Warm Pad") lacking.push(d + " header sound bar shows " + JSON.stringify(bar));
    // every kit has a visible Save button that opens the save form
    await ev("window.postMessage({type:'vstai:browser',action:'close'},'*'); $wait(350)");
    const sv = await ev("(function(){ var b=document.getElementById('saveBtn'); if(!b) return null; var r=b.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height), inView:r.right<=innerWidth+1&&r.left>=0&&r.top>=0&&r.height>0, text:b.textContent}; })()");
    if (!sv || !sv.inView || sv.w < 24) lacking.push(d + " Save button " + JSON.stringify(sv));
    else {
      await ev("document.getElementById('saveBtn').click(); $wait(450)");
      const form = await ev("(function(){ var h=document.getElementById('vstai-sound-browser'); return !!h && h.style.display==='block' && $sr().querySelector('.form').style.display==='grid'; })()");
      if (!form) lacking.push(d + " Save button did not open the save form");
      if (SHOTS && ["pro-tool", "bauhaus", "minimal"].includes(d)) await shot("kit-save-" + d);
    }
    if (SHOTS && ["pro-tool", "bauhaus", "neon-cyberpunk", "hardware-faceplate", "glassmorphism", "terminal-phosphor"].includes(d)) await shot("design-" + d);
    await ev("window.postMessage({type:'vstai:browser',action:'close'},'*'); true");
  }
  ok(!lacking.length && shown === designs.length, `the drawer opens with all sounds in ${shown}/${designs.length} design kits` + (lacking.length ? ": " + lacking.join("; ") : ""));
}

ok(pageErrors.length === 0, "no uncaught page errors" + (pageErrors.length ? ": " + pageErrors.slice(0, 3).join(" | ") : ""));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
cleanup();
process.exit(failures ? 1 : 0);
