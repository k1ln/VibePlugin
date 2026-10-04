// Assemble the single-file gui.html from template + css + app.js + injected data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P, TABS, LAYERS, MOD_SRC, MOD_SLOTS, MOD_DESTS, SLOT_MAX } from "../params.mjs";
import { L, actualToRaw } from "../pack.mjs";
import { PRESETS } from "../presets.mjs";
import { MAT_NAMES, MAT_R, MET_NAMES, MET_R } from "../tables.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(here, f), "utf8");
const FX_TABS = new Set(["drive", "filter", "eqdyn", "space"]);
const TAB_COLORS = { hit: "#ff4a3d", tone: "#ff4a3d", fm: "#ff8a2b", modal: "#ffc233", noise: "#7ee06a", metal: "#37d0e6", click: "#b07bff", mod: "#ffb347", drive: "#ff2d55", filter: "#ff6a5a", eqdyn: "#8ab4ff", space: "#6fe0c0" };

export function buildGui() {
  const params = P.map((p) => ({
    key: p.key, name: p.name, tab: p.tab, sec: p.sec, curve: p.curve, min: p.min, max: p.max, def: p.def, steps: p.steps,
    fmt: p.fmt, slot: p.slot, mult: p.mult, direct: p.direct, tip: p.tip, kind: p.kind || "", silent: !!p.silent,
  }));
  const tabLabel = Object.fromEntries(TABS);
  const defaults = Object.fromEntries(P.map((p) => [p.key, p.direct ? p.def : p.def]));
  const presets = PRESETS.map((pr) => {
    const diff = {};
    for (const [k, v] of Object.entries(pr.set)) {
      const p = P.find((q) => q.key === k);
      if (!p) throw new Error(`preset ${pr.name}: unknown key ${k}`);
      if (p.direct) { if (Math.abs(v - p.def) > 1e-9) diff[k] = v; }
      else if (actualToRaw(p, v) !== actualToRaw(p, p.def)) diff[k] = v;
    }
    return { name: pr.name, cat: pr.cat, diff };
  });
  const data = {
    params, slots: L.slots, slotMax: SLOT_MAX, tabs: TABS, tabColors: TAB_COLORS, layers: LAYERS,
    modSrc: MOD_SRC, modSlots: MOD_SLOTS,
    modDests: MOD_DESTS.map((p) => ({ key: p.key, label: FX_TABS.has(p.tab) ? `${tabLabel[p.tab].split("·")[0]} · ${p.sec} · ${p.name}` : `${tabLabel[p.tab].split("·")[0]} · ${p.name}`, fx: FX_TABS.has(p.tab) })),
    presets, tables: { MAT_NAMES, MAT_R, MET_NAMES, MET_R },
  };
  return rd("template.html").replace("@N@", String(P.length))
    .replace("/*@CSS@*/", () => rd("style.css"))
    .replace("/*@DATA@*/", () => JSON.stringify(data))
    .replace("/*@JS@*/", () => rd("app.js"));
}
