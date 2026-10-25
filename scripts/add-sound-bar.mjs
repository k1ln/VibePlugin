#!/usr/bin/env node
// Bakes the floating sound bar (ui/sound-bar.js) into the GUI of every .vstai under the
// given folders (default: factory/plugins and docs/gallery/data). Idempotent.
//
//   node scripts/add-sound-bar.mjs              # patch everything
//   node scripts/add-sound-bar.mjs --check      # exit 1 if any file is missing / has a stale bar
//   node scripts/add-sound-bar.mjs some/dir …   # other folders
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withSoundBar } from "../factory/tools/sound-bar.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dirs = args.filter((a) => !a.startsWith("--"));
if (!dirs.length) dirs.push(join(root, "factory/plugins"), join(root, "docs/gallery/data"));

function* walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (n.endsWith(".vstai")) yield p;
  }
}

let changed = 0, same = 0, skipped = 0;
for (const d of dirs) for (const f of walk(resolve(d))) {
  const text = readFileSync(f, "utf8");
  const doc = JSON.parse(text);
  if (!doc.html) { skipped++; continue; }
  const html = withSoundBar(doc.html);
  if (html === doc.html) { same++; continue; }
  changed++;
  if (check) { console.log("needs the sound bar: " + f); continue; }
  doc.html = html;
  // Same layout the packer writes (2-space JSON) so the diff is the GUI and nothing else.
  writeFileSync(f, JSON.stringify(doc, null, text.startsWith("{\n") ? 2 : 0));
}
console.log(`${check ? "would patch" : "patched"} ${changed}, already current ${same}, no GUI ${skipped}`);
process.exit(check && changed ? 1 : 0);
