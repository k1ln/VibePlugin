#!/usr/bin/env node
// build-gallery.mjs
// =====================================================================
//  Regenerates the static gallery catalogue from the committed .vstai files.
//
//  Scans docs/gallery/data/*.vstai and writes docs/gallery/data/index.json — a
//  small array (no big base64 wasm) that the gallery page (app.js) lists and
//  searches. The player loads the full .vstai directly, so nothing else is
//  extracted here. Run it after adding/merging a synth:
//
//      node scripts/build-gallery.mjs
//
//  CI runs the same command on push (see .github/workflows/gallery.yml) so the
//  catalogue stays in sync with whatever .vstai files are in the repo.
// =====================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "docs", "gallery", "data");

function slug(s) {
  return (s || "plugin").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60) || "plugin";
}

const rows = [];
let files;
try {
  files = await fs.readdir(DATA);
} catch {
  console.error("No data dir at " + DATA + " — nothing to build.");
  process.exit(0);
}

for (const f of files) {
  if (!f.endsWith(".vstai")) continue;
  const id = f.slice(0, -6);
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(path.join(DATA, f), "utf8"));
  } catch (e) {
    console.warn(`! skipping ${f}: ${e.message}`);
    continue;
  }
  if (!doc.wasmBase64 || !doc.html) {
    console.warn(`! skipping ${f}: missing wasmBase64 or html (not a compiled plugin)`);
    continue;
  }
  rows.push({
    id,
    name: doc.name || "Untitled",
    isInstrument: !!doc.isInstrument,
    explanation: doc.explanation || "",
    params: Array.isArray(doc.params) ? doc.params.length : 0,
    publishedAt: doc.publishedAt || 0,
    slug: slug(doc.name),
  });
}

rows.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0) || a.name.localeCompare(b.name));

// ---- quality gate (factory/quality-gate.json) ------------------------
// Too-light builds keep their .vstai in data/ but are not listed until
// rebuilt to the deep-detail standard (factory/REBUILD.md).
let visible = rows;
try {
  const gate = JSON.parse(await fs.readFile(path.join(HERE, "..", "factory", "quality-gate.json"), "utf8"));
  const hideFx = new Set(gate.hideEffects || []);
  const minP = gate.instrumentMinParams || 0;
  visible = rows.filter((r) =>
    r.isInstrument ? r.params >= minP : !hideFx.has(r.id)
  );
  const hidden = rows.length - visible.length;
  if (hidden > 0) console.log(`quality gate: ${hidden} too-light plugin${hidden === 1 ? "" : "s"} not displayed (rebuild queue: factory/REBUILD-QUEUE.md).`);
} catch {
  // no gate file — list everything
}

await fs.writeFile(path.join(DATA, "index.json"), JSON.stringify(visible, null, 0) + "\n");
console.log(`Wrote index.json — ${visible.length} plugin${visible.length === 1 ? "" : "s"} listed (${rows.length} total).`);
