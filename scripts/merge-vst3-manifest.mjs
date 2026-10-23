#!/usr/bin/env node
// merge-vst3-manifest.mjs — fold the per-OS columns of manifest parts (written by
// build-vst3-gallery.mjs --manifest) into docs/gallery/vst3/index.json.
//
//   node scripts/merge-vst3-manifest.mjs <os>=<part.json> [<os>=<part.json> …]
//
// For each named OS the part's column replaces the manifest's; every other OS column is kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "gallery", "vst3", "index.json");
let m = { base: "", items: {} };
try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
m.items ||= {};
for (const arg of process.argv.slice(2)) {
  const [os, part] = arg.split("=");
  if (!os || !part || !fs.existsSync(part)) { console.error(`skipping ${arg}: no such part`); continue; }
  const p = JSON.parse(fs.readFileSync(part, "utf8"));
  if (p.base) m.base = p.base;
  for (const id of Object.keys(m.items)) delete m.items[id][os];
  for (const [id, cols] of Object.entries(p.items || {})) if (cols[os]) (m.items[id] ||= {})[os] = cols[os];
}
for (const id of Object.keys(m.items)) if (!Object.keys(m.items[id]).length) delete m.items[id];
m.items = Object.fromEntries(Object.entries(m.items).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(file, JSON.stringify(m) + "\n");
const count = (os) => Object.values(m.items).filter((c) => c[os]).length;
console.log(`vst3 manifest: macos ${count("macos")}, windows ${count("windows")}, linux ${count("linux")}`);
