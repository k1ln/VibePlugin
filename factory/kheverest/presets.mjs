// Factory patches = hand-written bank + per-patch level trim (PATCHLVL) from tests/tune-levels.mjs.
import { readFileSync, existsSync } from "node:fs";
import { BANK } from "./presets-bank.mjs";
const lvPath = new URL("./presets.levels.json", import.meta.url);
const levels = existsSync(lvPath) ? JSON.parse(readFileSync(lvPath, "utf8")) : {};
const names = new Set();
export const PRESETS = [{ name: "Init Patch", cat: "Init", set: {} }, ...BANK].map((p) => {
  if (names.has(p.name)) throw new Error("duplicate preset name " + p.name);
  names.add(p.name);
  return { name: p.name, cat: p.cat, set: levels[p.name] && p.name !== "Init Patch" ? { ...p.set, ...levels[p.name] } : p.set };
});
