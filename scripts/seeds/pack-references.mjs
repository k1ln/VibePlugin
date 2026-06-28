#!/usr/bin/env node
// pack-references.mjs — give the committed "reference" gallery demos their DSP
// source. Saw Lead and Warm Lowpass are the repo's reference modules
// (wasm-template/assembly/{synth,index}.ts), but the published .vstai files only
// carried the compiled WASM + GUI. This embeds the matching AssemblyScript source
// and recompiles the WASM from it, so a download opens fully editable and its
// source compiles to exactly the WASM it ships. The GUI, params and metadata in
// the existing .vstai are preserved.
//
//   node scripts/seeds/pack-references.mjs
//
// Requires the bundled compiler (compiler/asc-driver.mjs + its node_modules).

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const DATA = path.join(ROOT, "docs", "gallery", "data");

const DEMOS = [
  { vstai: "saw-lead-demo.vstai",     ts: "wasm-template/assembly/synth.ts" },
  { vstai: "warm-lowpass-demo.vstai", ts: "wasm-template/assembly/index.ts" },
];

for (const { vstai, ts } of DEMOS) {
  const tsPath = path.join(ROOT, ts);
  const assembly = await fs.readFile(tsPath, "utf8");

  // Recompile the source -> WASM so the shipped binary matches the shown source.
  const tmpWasm = path.join(os.tmpdir(), vstai.replace(/\W+/g, "_") + ".wasm");
  const r = spawnSync(process.execPath,
    [path.join(ROOT, "compiler", "asc-driver.mjs"), tsPath, tmpWasm],
    { stdio: "inherit" });
  if (r.status !== 0) { console.error("asc compile failed for " + ts); process.exit(1); }
  const wasmBase64 = (await fs.readFile(tmpWasm)).toString("base64");

  // Preserve the existing GUI / params / metadata; only add source + refresh WASM.
  const outPath = path.join(DATA, vstai);
  const doc = JSON.parse(await fs.readFile(outPath, "utf8"));
  doc.assembly = assembly;
  doc.wasmBase64 = wasmBase64;

  await fs.writeFile(outPath, JSON.stringify(doc));
  console.log("Wrote " + path.relative(ROOT, outPath)
    + "  (assembly " + (assembly.length / 1024).toFixed(1) + " KB, wasm "
    + (wasmBase64.length / 1024 | 0) + " KB b64)");
}
