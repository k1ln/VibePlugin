// =====================================================================
//  gui-check.mjs — headless-Chrome QA for a plugin's bespoke gui.html.
//
//  Serves the plugin folder over a throwaway local HTTP server, loads the
//  GUI inside a wrapper that (a) provides a fake window.vstai host,
//  (b) records every console/window error, (c) counts the parameters the
//  GUI pushes on ready, (d) clicks every clickable control, and
//  (e) optionally saves a full-page screenshot.
//
//  Usage: node gui-check.mjs <plugin-dir-or-gui.html> [--shot out.png]
//  Exit 0 = 0 errors and >0 params pushed; prints a JSON report.
// =====================================================================

import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";

// async exec keeps the event loop alive so the local server can respond
const run = promisify(execFile);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let target = process.argv[2];
if (!target) { console.error("usage: node gui-check.mjs <plugin-dir|gui.html> [--shot out.png]"); process.exit(2); }
target = resolve(target);
if (statSync(target).isDirectory()) target = join(target, "gui.html");
if (!existsSync(target)) { console.error("no gui.html at " + target); process.exit(2); }
const shotIdx = process.argv.indexOf("--shot");
const shot = shotIdx > 0 ? resolve(process.argv[shotIdx + 1]) : null;

const gui = readFileSync(target, "utf8");

const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>qa</title></head>
<body style="margin:0">
<script>
  window.__errors = [];
  window.__params = {};
  window.__notes = [];
  window.vstai = {
    onReady: function(f){ setTimeout(f, 0); },
    setParam: function(i, v){ window.__params[i] = v; },
    noteOn: function(id, vel){ window.__notes.push(id); },
    noteOff: function(){}
  };
  window.addEventListener("error", function(e){ window.__errors.push(String(e.message)); });
  window.addEventListener("unhandledrejection", function(e){ window.__errors.push("rejection: " + e.reason); });
</script>
<iframe id="f" style="width:1280px;height:1000px;border:0"></iframe>
<script>
  fetch("gui.html").then(function(r){ return r.text(); }).then(function(html){
    var f = document.getElementById("f");
    var shim = '<scr'+'ipt>window.vstai = parent.vstai;'
      + 'window.addEventListener("error",function(e){parent.__errors.push(String(e.message)+" @ "+e.lineno);});'
      + 'var _ce=console.error;console.error=function(){parent.__errors.push("console.error: "+[].join.call(arguments," "));_ce.apply(console,arguments);};'
      + '</scr'+'ipt>';
    if (html.indexOf("</head>") >= 0) html = html.replace("</head>", shim + "</head>");
    else html = shim + html;
    f.srcdoc = html;
    f.addEventListener("load", function(){
      setTimeout(function(){
        try {
          var doc = f.contentDocument;
          var pushedOnReady = Object.keys(window.__params).length;
          // click everything that looks interactive (covers bespoke + generated GUIs)
          var clickables = doc.querySelectorAll("button, .bt, .seg, .sel .opt, .opt, [data-v]");
          var n = 0;
          clickables.forEach(function(c){ try { c.click(); n++; } catch (e) { parent.__errors.push("click: " + e.message); } });
          document.title = JSON.stringify({
            errors: window.__errors,
            paramsPushedOnReady: pushedOnReady,
            paramsTotal: Object.keys(window.__params).length,
            clickablesClicked: n,
            bodyPx: doc.body ? doc.body.scrollHeight : 0
          });
        } catch (err) {
          document.title = JSON.stringify({ errors: window.__errors.concat(["qa: " + err.message]) });
        }
      }, 700);
    });
  });
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === "/qa.html") { res.setHeader("content-type", "text/html"); res.end(wrapper); }
  else if (req.url === "/gui.html") { res.setHeader("content-type", "text/html"); res.end(gui); }
  else { res.statusCode = 404; res.end("nope"); }
});

await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

let report = { errors: ["chrome did not produce a title"] };
try {
  const { stdout: dom } = await run(CHROME, [
    "--headless=new", "--disable-gpu", "--window-size=1300,1050",
    "--virtual-time-budget=6000", "--dump-dom", `http://127.0.0.1:${port}/qa.html`,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  const m = dom.match(/<title>(.*?)<\/title>/s);
  if (m) report = JSON.parse(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
} catch (e) {
  report = { errors: ["chrome failed: " + e.message] };
}

if (shot) {
  try {
    await run(CHROME, [
      "--headless=new", "--disable-gpu", "--window-size=1300,1050",
      `--screenshot=${shot}`, `http://127.0.0.1:${port}/gui.html`,
    ], { timeout: 60000 });
    report.screenshot = shot;
  } catch (e) { report.screenshotError = String(e.message); }
}

server.close();
console.log(JSON.stringify(report, null, 2));
const ok = report.errors && report.errors.length === 0 && (report.paramsPushedOnReady ?? 0) > 0;
console.log(ok ? "GUI CHECK: PASS ✅" : "GUI CHECK: FAIL ❌");
process.exit(ok ? 0 : 1);
