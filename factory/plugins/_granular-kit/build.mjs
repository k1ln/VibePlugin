// Inline kit.css / kit.js / spec params into each plugin's gui.src.html -> gui.html
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "kit.css"), "utf8");
const js = readFileSync(resolve(here, "kit.js"), "utf8");
const slugs = process.argv.slice(2);
for (const slug of slugs) {
  const dir = resolve(here, "..", slug);
  const src = readFileSync(resolve(dir, "gui.src.html"), "utf8");
  const spec = JSON.parse(readFileSync(resolve(dir, "spec.json"), "utf8"));
  const out = src.replace("/*@@KITCSS@@*/", () => css).replace("/*@@KITJS@@*/", () => js)
    .replace("/*@@PARAMS@@*/[]", () => JSON.stringify(spec.params));
  writeFileSync(resolve(dir, "gui.html"), out);
  console.log("built", slug, out.length, "bytes");
}
