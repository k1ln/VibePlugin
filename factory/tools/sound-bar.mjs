// sound-bar.mjs - gives a generated GUI the floating sound bar (ui/sound-bar.js).
//
//   import { withSoundBar } from "./sound-bar.mjs";
//   doc.html = withSoundBar(doc.html);
//
// Idempotent: a GUI that already carries the bar gets the current script swapped in, so
// re-running after editing ui/sound-bar.js updates every plugin. The bar only shows up where
// the host has the sound browser (see the header of ui/sound-bar.js), so baking it in is safe
// for the web player and for hosts that predate the browser.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../ui/sound-bar.js");
const TAG = /<script data-vstai-sound-bar>[\s\S]*?<\/script>\s*/g;

let cached = null;
export function soundBarScript() {
  if (cached == null) {
    cached = readFileSync(SRC, "utf8").replace(/\/\*[\s\S]*?\*\/\s*/, "").trim();   // header comment stays in the repo
    if (/<\/script/i.test(cached)) throw new Error("ui/sound-bar.js must not contain </script");
  }
  return cached;
}

export function withSoundBar(html) {
  if (typeof html !== "string" || !html) return html;
  const tag = `<script data-vstai-sound-bar>\n${soundBarScript()}\n</script>\n`;
  const bare = html.replace(TAG, "");
  const at = bare.toLowerCase().lastIndexOf("</body>");
  return at >= 0 ? bare.slice(0, at) + tag + bare.slice(at) : bare + "\n" + tag;
}

export function hasSoundBar(html) { return typeof html === "string" && html.includes("data-vstai-sound-bar>"); }
