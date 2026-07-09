#!/usr/bin/env node
// =====================================================================
//  persist-check.mjs — does a GUI DRAW the restored sound, or its defaults?
//
//  Reopening a saved project hands the GUI back the values the user saved,
//  which are not the plugin's built-in defaults. The engine already plays the
//  saved sound; the risk is that the knobs and buttons keep drawing themselves
//  from their defaults, so the panel lies about what you are hearing.
//
//  This renders gui.html through the REAL bridge shim (parsed straight out of
//  src/BridgeShim.h, so we always test shipped code) under two restore states:
//
//     A: window.__vstaiRestored = the plugin's own defaults
//     B: window.__vstaiRestored = a clearly different value for every param
//
//  and compares what came out. If A and B look the same, the controls ignored
//  the restored state -> the panel is wrong -> FAIL.
//
//  Two independent signals, because GUIs draw controls two different ways:
//     domFollow — class/text/style attributes differ (catches BUTTONS, LEDs,
//                 labels, anything whose state lives in the DOM)
//     pixFollow — pixels differ (catches knobs drawn into a <canvas>)
//  Either one being true means the GUI follows the restored state.
//
//  Most panels animate (scopes, meters, LFO glow), so a raw screenshot is not
//  reproducible run to run. A test-only determinism stub — frozen clock, bounded
//  requestAnimationFrame, no setInterval, seeded Math.random — is injected before
//  the shim to pin the render, and each state is rendered twice; a signal that is
//  not byte-stable across those two runs is reported as null rather than trusted.
//
//  It also records every /__vstai/param/* the GUI pushes while booting. Those
//  pushes must equal the restored values, otherwise the GUI is overwriting the
//  saved sound with its defaults (the separate, louder bug).
//
//  Usage:  node persist-check.mjs <plugin-dir|gui.html> [...]
//          node persist-check.mjs factory/plugins/*/
//  Prints one JSON line per plugin, then a summary.
//  Exit 0 = every plugin follows the restored state and pushes it back intact.
//
//  Requires: Google Chrome (headless).  See also gui-check.mjs (render errors).
// =====================================================================

import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CONCURRENCY = 4;

// ---- the real shim, straight out of the C++ header --------------------
const hdr = readFileSync(join(REPO, "src/BridgeShim.h"), "utf8");
function rawLiteral(tag) {
  const open = `R"${tag}(`;
  const a = hdr.indexOf(open);
  if (a < 0) throw new Error(`BridgeShim.h: no R"${tag}(...)" literal`);
  return hdr.slice(a + open.length, hdr.indexOf(`)${tag}"`, a));
}
const SHIM = rawLiteral("JS");
const META = rawLiteral("HTML");

// Test-only. Runs before the shim, so the shim's own setTimeout(...,0) replay
// still fires; we only stub what would make two identical renders differ.
const DETERMINISM = `<script>
(function(){
  Date.now = function(){ return 1700000000000; };
  try { performance.now = function(){ return 0; }; } catch(e){}
  var seed = 12345;
  Math.random = function(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // Route rAF through setTimeout: under --virtual-time-budget timers fire on a
  // deterministic clock, while real rAF is driven by the compositor and delivers
  // a different number of frames each run. Cap it so animation loops settle.
  var frames = 0;
  window.requestAnimationFrame = function(cb){
    if (frames++ >= 6) return 0;                  // let the first paints land, then freeze
    return setTimeout(function(){ cb(frames * 16.6); }, 16);
  };
  window.setInterval = function(){ return 0; };   // stop meters/scopes/sequencer runners
  // CSS @keyframes and transitions run off the wall clock, so a screenshot catches
  // them mid-flight at a different phase every run. Append last so we win the cascade.
  document.addEventListener('DOMContentLoaded', function(){
    var s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;'
                  + 'animation-duration:0s!important;transition-duration:0s!important;}';
    document.head.appendChild(s);
  });
})();
</script>`;

// mirror of vstai::shim::withBridge, with the determinism stub spliced in first
function compose(html, valuesJson) {
  const inject = META + DETERMINISM + `<script>window.__vstaiRestored=${valuesJson};</script>` + SHIM;
  const lower = html.toLowerCase();
  const head = lower.indexOf("<head>");
  if (head >= 0) return html.slice(0, head + 6) + inject + html.slice(head + 6);
  const body = lower.indexOf("<body>");
  if (body >= 0) return html.slice(0, body + 6) + inject + html.slice(body + 6);
  return inject + html;
}

// A value inside [min,max] that is clearly not the default.
function perturb(p) {
  const min = +p.min, max = +p.max, def = +p.default;
  const discrete = p.step === 1 || (Number.isInteger(min) && Number.isInteger(max) && max - min <= 8);
  if (discrete) {
    for (let v = min; v <= max; v++) if (v !== def) return v;
    return def;
  }
  const lo = min + 0.15 * (max - min), hi = min + 0.85 * (max - min);
  return Math.abs(def - lo) > Math.abs(def - hi) ? lo : hi;
}

const sha = (s) => createHash("sha1").update(s).digest("hex");

// Only what a user can see: drop the injected scripts and collapse whitespace.
const domSignature = (dom) => sha(dom.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\s+/g, " "));

async function render(html, valuesJson, pngPath) {
  const pushes = {};
  const page = compose(html, valuesJson);
  const srv = createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url.startsWith("/__vstai/param/")) {
      const parts = url.split("/");                 // ["", "__vstai", "param", idx, val]
      pushes[+parts[3]] = +decodeURIComponent(parts[4]);
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
    if (url.startsWith("/__vstai/")) { res.writeHead(200); return res.end("ok"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  let dom = "";
  try {
    const { stdout } = await run(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
      "--force-device-scale-factor=1", "--window-size=1280,900",
      "--virtual-time-budget=2500", "--dump-dom", `--screenshot=${pngPath}`,
      `http://127.0.0.1:${srv.address().port}/`,
    ], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 90000 });
    dom = stdout;
  } finally { srv.close(); }
  const png = existsSync(pngPath) ? readFileSync(pngPath) : Buffer.alloc(0);
  return { dom: domSignature(dom), pix: sha(png), pushes };
}

const tmp = mkdtempSync(join(tmpdir(), "vstai-persist-"));

async function check(target) {
  const dir = statSync(target).isDirectory() ? target : dirname(target);
  const id = basename(dir);
  const guiPath = statSync(target).isDirectory() ? join(dir, "gui.html") : target;
  const specPath = join(dir, "spec.json");
  if (!existsSync(guiPath) || !existsSync(specPath)) return { id, skip: "no gui.html/spec.json" };

  const html = readFileSync(guiPath, "utf8");
  const params = JSON.parse(readFileSync(specPath, "utf8")).params || [];
  if (!params.length) return { id, skip: "no params" };

  const defs = {}, alt = {};
  for (const p of params) { defs[p.index] = +p.default; alt[p.index] = perturb(p); }

  const a1 = await render(html, JSON.stringify(defs), join(tmp, `${id}-a1.png`));
  const a2 = await render(html, JSON.stringify(defs), join(tmp, `${id}-a2.png`));
  const b = await render(html, JSON.stringify(alt), join(tmp, `${id}-b.png`));

  const domFollow = a1.dom === a2.dom ? a1.dom !== b.dom : null;   // null = not reproducible
  const pixFollow = a1.pix === a2.pix ? a1.pix !== b.pix : null;
  const follows = domFollow || pixFollow ? true
    : domFollow === false && pixFollow === false ? false
      : null;

  // The saved sound itself: every boot push must carry the restored value.
  const badPushes = Object.entries(b.pushes)
    .filter(([i, v]) => i in alt && Math.abs(v - alt[i]) > 1e-4)
    .map(([i, v]) => ({ index: +i, pushed: v, expected: alt[i] }));

  return {
    id, follows, domFollow, pixFollow,
    soundOk: badPushes.length === 0,
    pushed: Object.keys(b.pushes).length, params: params.length,
    badPushes: badPushes.slice(0, 3),
  };
}

const targets = process.argv.slice(2).map((a) => resolve(a));
if (!targets.length) {
  console.error("usage: node persist-check.mjs <plugin-dir|gui.html> [...]");
  process.exit(2);
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < targets.length) {
    const t = targets[next++];
    let r;
    try { r = await check(t); }
    catch (e) { r = { id: basename(t), error: String(e.message).slice(0, 160) }; }
    results.push(r);
    console.log(JSON.stringify(r));
  }
}));
rmSync(tmp, { recursive: true, force: true });

const live = results.filter((r) => !r.skip);
const stale = live.filter((r) => r.follows === false);
const unknown = live.filter((r) => r.follows === null);
const soundBad = live.filter((r) => r.soundOk === false);

console.log(`\n${live.length} checked · ${live.length - stale.length - unknown.length} follow the restored state`
  + ` · ${stale.length} draw defaults · ${unknown.length} inconclusive · ${soundBad.length} overwrite the saved sound`);
if (stale.length) console.log("draw defaults: " + stale.map((r) => r.id).join(" "));
if (soundBad.length) console.log("OVERWRITE SAVED SOUND: " + soundBad.map((r) => r.id).join(" "));

const ok = stale.length === 0 && soundBad.length === 0 && !results.some((r) => r.error);
console.log(ok ? "PERSIST CHECK: PASS ✅" : "PERSIST CHECK: FAIL ❌");
process.exit(ok ? 0 : 1);
