// Assemble the single-file gui.html from template + css + app.js + injected data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P, SLOT_MAX } from "../params.mjs";
import { L } from "../pack.mjs";
import { PRESETS } from "../presets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(here, f), "utf8");

export function buildGui() {
  const params = P.map((p) => ({ key: p.key, name: p.name, curve: p.curve, min: p.min, max: p.max, def: p.def, steps: p.steps, fmt: p.fmt, slot: p.slot, mult: p.mult, direct: p.direct, tip: p.tip, grp: p.grp }));
  const presets = PRESETS.map((pr) => {
    for (const k of Object.keys(pr.set)) if (!P.find((q) => q.key === k)) throw new Error(`preset ${pr.name}: unknown key ${k}`);
    return { name: pr.name, cat: pr.cat, note: pr.note, set: pr.set };
  });
  const data = { params, slots: L.slots, slotMax: SLOT_MAX, presets };
  return rd("template.html")
    .replace("/*@CSS@*/", () => rd("style.css"))
    .replace("/*@DATA@*/", () => JSON.stringify(data))
    .replace("/*@JS@*/", () => rd("app.js"));
}
