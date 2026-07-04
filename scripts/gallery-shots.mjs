#!/usr/bin/env node
// gallery-shots.mjs
// =====================================================================
//  Renders a thumbnail screenshot for every plugin listed in the gallery
//  catalogue, for the in-plugin gallery list and the web gallery.
//
//  For each entry in docs/gallery/data/index.json:
//    * extract the GUI html from data/<id>.vstai
//    * render it in headless Chrome with a fake window.vstai host
//      (same shim idea as factory/tools/gui-check.mjs)
//    * downscale to a 640px-wide JPEG at docs/gallery/shots/<id>.jpg
//
//  Incremental: an up-to-date shot (newer than its .vstai) is skipped.
//  Run after adding/rebuilding gallery plugins, before build-gallery.mjs:
//
//      node scripts/gallery-shots.mjs [--force] [--only <id>]
//
//  Requires: Google Chrome (headless) and macOS `sips` for the downscale.
// =====================================================================

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

const HERE  = path.dirname(fileURLToPath(import.meta.url));
const DATA  = path.join(HERE, "..", "docs", "gallery", "data");
const SHOTS = path.join(HERE, "..", "docs", "gallery", "shots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const FORCE = process.argv.includes("--force");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

// The GUIs are written for the plugin WebView; give them the same fake host
// gui-check.mjs uses so param pushes and note events don't throw.
const SHIM = `<script>
  window.vstai = {
    onReady: function(f){ setTimeout(f, 0); },
    setParam: function(){}, getParam: function(){ return 0; },
    onParam: function(){}, noteOn: function(){}, noteOff: function(){},
    loadSample: function(){ return new Promise(function(){}); }
  };
<\/script>`;

async function main() {
  const index = JSON.parse(await fs.readFile(path.join(DATA, "index.json"), "utf8"));
  await fs.mkdir(SHOTS, { recursive: true });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vstai-shots-"));

  let made = 0, skipped = 0, failed = 0;
  for (const it of index) {
    if (ONLY && it.id !== ONLY) continue;
    const vstaiPath = path.join(DATA, it.id + ".vstai");
    const jpgPath   = path.join(SHOTS, it.id + ".jpg");

    // Incremental: skip when the shot is newer than the .vstai.
    if (!FORCE) {
      try {
        const [sv, sj] = [await fs.stat(vstaiPath), await fs.stat(jpgPath)];
        if (sj.mtimeMs >= sv.mtimeMs) { skipped++; continue; }
      } catch { /* missing shot -> render */ }
    }

    let doc;
    try { doc = JSON.parse(await fs.readFile(vstaiPath, "utf8")); }
    catch (e) { console.warn(`! ${it.id}: unreadable .vstai (${e.message})`); failed++; continue; }
    if (!doc.html) { console.warn(`! ${it.id}: no html in .vstai`); failed++; continue; }

    // Inject the shim as the first thing in <head> so it exists before GUI JS.
    let html = String(doc.html);
    html = html.includes("<head>") ? html.replace("<head>", "<head>" + SHIM)
                                   : SHIM + html;

    const dir = path.join(tmpRoot, it.id);
    await fs.mkdir(dir, { recursive: true });
    const guiPath = path.join(dir, "gui.html");
    const pngPath = path.join(dir, "shot.png");
    await fs.writeFile(guiPath, html);

    try {
      await run(CHROME, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--window-size=1280,860",
        "--virtual-time-budget=4000",          // let animations/canvas settle
        `--screenshot=${pngPath}`,
        "file://" + guiPath,
      ], { timeout: 30000 });
      await run("sips", [
        "--resampleWidth", "640",
        "-s", "format", "jpeg", "-s", "formatOptions", "72",
        pngPath, "--out", jpgPath,
      ]);
      made++;
      process.stdout.write(`  ${it.id}.jpg\n`);
    } catch (e) {
      console.warn(`! ${it.id}: render failed (${e.message})`);
      failed++;
    }
  }

  await fs.rm(tmpRoot, { recursive: true, force: true });
  console.log(`shots: ${made} rendered, ${skipped} up to date, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main();
