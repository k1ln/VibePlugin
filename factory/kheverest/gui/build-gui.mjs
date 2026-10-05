// Assemble the single-file gui.html from template + css + app.js + injected data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P, SLOT_MAX, WAVETABLES, WT_CATS, MOD_SRC, FXMOD_SRC, MOD_DEST, FXMOD_DEST, LFO_SYNC, ARP_SYNC, DELAY_SYNC, TUNING_NAMES } from "../params.mjs";
import { L, actualToRaw } from "../pack.mjs";
import { PRESETS } from "../presets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => readFileSync(join(here, f), "utf8");

export function buildGui() {
  const params = P.map((p) => ({
    key: p.key, name: p.name, curve: p.curve, min: p.min, max: p.max, def: p.def, steps: p.steps,
    fmt: p.fmt, slot: p.slot, mult: p.mult, direct: p.direct, tip: p.tip, kind: p.kind || "",
  }));
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
    params, slots: L.slots, slotMax: SLOT_MAX,
    wt: WAVETABLES, wtCats: WT_CATS, modSrc: MOD_SRC, fxSrc: FXMOD_SRC, modDest: MOD_DEST, fxDest: FXMOD_DEST,
    lfoSync: LFO_SYNC.map((x) => x[0]), arpSync: ARP_SYNC.map((x) => x[0]), dlySync: DELAY_SYNC.map((x) => x[0]), tunings: TUNING_NAMES,
    presets,
  };
  return rd("template.html")
    .replace("/*@CSS@*/", () => rd("style.css"))
    .replace("/*@DATA@*/", () => JSON.stringify(data))
    .replace("/*@JS@*/", () => rd("app.js"));
}
