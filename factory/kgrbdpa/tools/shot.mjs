#!/usr/bin/env node
// shot.mjs — render the panel (optionally with a patch sheet loaded / extra script) to a PNG with headless Chrome.
//   node tools/shot.mjs out.png [--preset <index|name>] [--js "<script>"] [--size 1560x900]
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../../..", import.meta.url).pathname;
const args = process.argv.slice(2), out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const preset = opt("--preset", null), js = opt("--js", ""), size = opt("--size", "1560x900");
let html = readFileSync(join(root, "factory/plugins/kgrbdpa/gui.html"), "utf8");
const stub = `<script>window.vstai={onReady:function(f){setTimeout(f,0)},setParam:function(){},onParam:function(){},onDisplay:function(cb){window.__disp=cb},noteOn:function(){},noteOff:function(){}};</script>`;
const run = `<script>window.addEventListener("load",function(){setTimeout(function(){try{ ${preset !== null ? `var q=${JSON.stringify(preset)};var i=isNaN(+q)?__kg.DATA.presets.findIndex(function(p){return p.name===q}):+q;__kg.loadIndex(i);` : ""} ${js} }catch(e){document.title="ERR "+e}},60)});</script>`;
html = html.replace("<body>", "<body>" + stub).replace("</body>", run + "</body>");
const dir = mkdtempSync(join(tmpdir(), "kg-shot-")), f = join(dir, "s.html"); writeFileSync(f, html);
execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--window-size=" + size.replace("x", ","), "--virtual-time-budget=3000", "--screenshot=" + out, "file://" + f], { stdio: "ignore" });
console.log("wrote", out);
