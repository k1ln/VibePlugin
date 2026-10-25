#!/usr/bin/env node
// build-webclap-gallery.mjs
// =====================================================================
//  Renders every gallery plugin to a WebCLAP bundle the gallery page offers as a
//  download (openDAW: Load Plugin -> Import WebCLAP…).
//
//  For each listed plugin in docs/gallery/data/index.json this runs the real
//  exporter (the headless `vstai_webclap_export` console target: adapter + the
//  plugin's AssemblyScript through the bundled compiler, GUI page with the shim,
//  tar.gz), smoke-tests the resulting module.wasm with tests/webclap-smoke.mjs,
//  and writes
//
//      docs/gallery/webclap/<id>.wclap.tar.gz
//      docs/gallery/webclap/index.json      { id: { file, bytes, hash, params } | { skipped } }
//
//  Bundles are only re-rendered when the .vstai, the adapter/shim/sound browser or the compiler
//  driver changed (content hash), so reruns are cheap.
//
//      cmake --build build-test --target vstai_webclap_export     # once
//      node scripts/build-webclap-gallery.mjs [--all] [--force] [--only id,id] [--jobs N]
//
//  --all    also render plugins the quality gate hides from the catalogue
//  --force  ignore the cache and re-render
//  Needs the bundled compiler (compiler/build.sh) next to the exporter; the
//  script stages it for you.
// =====================================================================

import { promises as fs, existsSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smoke } from "../tests/webclap-smoke.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "docs", "gallery", "data");
const OUT = path.join(ROOT, "docs", "gallery", "webclap");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const jobs = Math.max(1, +opt("--jobs", Math.min(4, os.cpus().length)));
const only = opt("--only", "") ? new Set(opt("--only", "").split(",")) : null;

const exporterSrc = process.env.VSTAI_WEBCLAP_EXPORT
  || ["build-test", "build", "build-dev"].map((d) => path.join(ROOT, d, "vstai_webclap_export_artefacts", "Release", "vstai_webclap_export")).find(existsSync);
if (!exporterSrc || !existsSync(exporterSrc)) {
  console.error("No vstai_webclap_export binary. Build it:  cmake --build build-test --target vstai_webclap_export\n(or set VSTAI_WEBCLAP_EXPORT)");
  process.exit(2);
}
for (const f of ["vstai-node", "asc-bundle.mjs"]) {
  if (!existsSync(path.join(ROOT, "compiler", f))) { console.error(`compiler/${f} missing — run compiler/build.sh`); process.exit(2); }
}

// The exporter looks for the compiler next to its own executable, so stage a copy of
// the binary with symlinks to the real compiler files.
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "vstai-webclap-"));
const exporter = path.join(stage, "vstai_webclap_export");
await fs.copyFile(exporterSrc, exporter);
await fs.chmod(exporter, 0o755);
for (const f of ["vstai-node", "asc-bundle.mjs"]) await fs.symlink(path.join(ROOT, "compiler", f), path.join(stage, f));
process.on("exit", () => { try { rmSync(stage, { recursive: true, force: true }); } catch {} });

const read = (...p) => fs.readFile(path.join(ROOT, ...p));
const toolHash = createHash("sha256");
for (const f of [["ui", "webclap", "clap-adapter.ts"], ["ui", "webclap", "shim.js"], ["ui", "webclap", "presets.js"], ["src", "PresetBrowserUi.h"], ["compiler", "asc-driver.mjs"], ["src", "WebClapExport.h"]])
  toolHash.update(await read(...f));
const TOOL = toolHash.digest("hex");

const run = (cmd, argv, env) => new Promise((resolve) => {
  execFile(cmd, argv, { env: { ...process.env, ...env }, maxBuffer: 64 << 20, timeout: 240000 }, (err, stdout, stderr) => resolve({ err, out: stdout + stderr }));
});

let catalogue;
try { catalogue = JSON.parse(await fs.readFile(path.join(DATA, "index.json"), "utf8")); }
catch { console.error("docs/gallery/data/index.json missing — run scripts/build-gallery.mjs first"); process.exit(2); }

let ids = catalogue.map((r) => r.id);
if (flag("--all")) ids = (await fs.readdir(DATA)).filter((f) => f.endsWith(".vstai")).map((f) => f.slice(0, -6));
if (only) ids = ids.filter((i) => only.has(i));

await fs.mkdir(OUT, { recursive: true });
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(path.join(OUT, "index.json"), "utf8")); } catch {}

const results = { built: 0, cached: 0, skipped: 0, failed: [] };
const next = { manifest: {} };

async function one(id) {
  const vstai = path.join(DATA, id + ".vstai");
  const raw = await fs.readFile(vstai);
  const doc = JSON.parse(raw.toString("utf8"));
  const hash = createHash("sha256").update(raw).update(TOOL).digest("hex").slice(0, 16);
  const file = `${id}.wclap.tar.gz`;
  const dest = path.join(OUT, file);

  // Samplers read audio the bundle can't carry yet (the shim rejects loadSample).
  if ((doc.assembly || "").includes("getSamplePtr")) {
    next.manifest[id] = { skipped: "samples" };
    results.skipped++;
    return;
  }
  const prev = manifest[id];
  if (!flag("--force") && prev && prev.hash === hash && existsSync(dest)) {
    next.manifest[id] = prev; results.cached++; return;
  }

  const r = await run(exporter, [vstai, dest], { VSTAI_UI_DIR: path.join(ROOT, "ui") });
  if (r.err || !existsSync(dest)) { results.failed.push(`${id}: export — ${r.out.trim().split("\n").slice(0, 3).join(" | ")}`); return; }

  // Smoke-test the module inside the tarball before it is allowed into the gallery.
  const tmp = path.join(stage, id + ".wasm");
  const tarOut = (argv) => new Promise((resolve) => {
    execFile("tar", argv, { encoding: "buffer", maxBuffer: 64 << 20 }, (err, stdout) => resolve({ err, stdout }));
  });
  const names = (await tarOut(["-tzf", dest])).stdout.toString().split("\n");
  const inner = names.find((n) => n.endsWith("/module.wasm"));
  const x = inner ? await tarOut(["-xzOf", dest, inner]) : { err: true, stdout: Buffer.alloc(0) };
  if (x.err || !x.stdout.length) { await fs.rm(dest, { force: true }); results.failed.push(`${id}: no module.wasm in bundle`); return; }
  await fs.writeFile(tmp, x.stdout);
  try {
    const s = smoke(tmp, { synth: !!doc.isInstrument, expectParams: null });
    next.manifest[id] = { file, bytes: (await fs.stat(dest)).size, hash, params: s.params };
    results.built++;
  } catch (e) {
    await fs.rm(dest, { force: true });
    results.failed.push(`${id}: smoke — ${e.message}`);
  } finally { await fs.rm(tmp, { force: true }); }
}

const queue = [...ids];
let done = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (queue.length) {
    const id = queue.shift();
    try { await one(id); } catch (e) { results.failed.push(`${id}: ${e.message}`); }
    if (process.stdout.isTTY) process.stdout.write(`\r${++done}/${ids.length} `);
  }
}));
if (process.stdout.isTTY) process.stdout.write("\n");

// Keep entries for plugins this run didn't touch (--only), drop bundles of removed plugins.
const keep = only ? { ...manifest } : {};
const final = { ...keep, ...next.manifest };
for (const id of results.failed.map((f) => f.split(":")[0])) delete final[id];
const known = new Set(only ? Object.keys(final) : ids);
for (const id of Object.keys(final)) if (!known.has(id)) delete final[id];
const sorted = Object.fromEntries(Object.entries(final).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(path.join(OUT, "index.json"), JSON.stringify(sorted) + "\n");
for (const f of await fs.readdir(OUT))
  if (f.endsWith(".wclap.tar.gz") && !sorted[f.replace(/\.wclap\.tar\.gz$/, "")]?.file) await fs.rm(path.join(OUT, f));

console.log(`WebCLAP: ${results.built} built, ${results.cached} cached, ${results.skipped} skipped (samplers), ${results.failed.length} failed.`);
for (const f of results.failed) console.error("  ! " + f);
process.exit(results.failed.length ? 1 : 0);
