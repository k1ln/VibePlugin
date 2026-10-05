// Assemble the single-file gui.html from template + css + app.js + injected data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P, SLOT_MAX, SRC, DST, SRC_IDX, CLOCK_DIVS } from "../params.mjs";
import { L, actualToRaw } from "../pack.mjs";
import { PRESETS } from "../presets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(here, f), "utf8");

export function buildGui() {
  const params = P.map((p) => ({ key: p.key, name: p.name, curve: p.curve, min: p.min, max: p.max, def: p.def, steps: p.steps, fmt: p.fmt, slot: p.slot, mult: p.mult, direct: p.direct, tip: p.tip, grp: p.grp }));
  const presets = PRESETS.map((pr) => {
    const set = {};
    for (const [k, v0] of Object.entries(pr.set)) {
      const p = P.find((q) => q.key === k);
      if (!p) throw new Error(`preset ${pr.name}: unknown key ${k}`);
      let v = v0;
      if (k.startsWith("PB_") && typeof v === "string") { v = SRC_IDX[v]; if (!v) throw new Error(`preset ${pr.name}: unknown cable source ${v0}`); }
      set[k] = v;
    }
    return { name: pr.name, cat: pr.cat, note: pr.note, set };
  });
  const data = {
    params, slots: L.slots, slotMax: SLOT_MAX, src: SRC.map((s) => [s[0], s[1]]), dst: DST.map((d) => [d[0], d[1]]),
    clockDivs: CLOCK_DIVS.map((c) => c[0]), presets,
  };
  return rd("template.html")
    .replace("/*@CSS@*/", () => rd("style.css"))
    .replace("/*@DATA@*/", () => JSON.stringify(data))
    .replace("/*@JS@*/", () => rd("app.js"));
}
