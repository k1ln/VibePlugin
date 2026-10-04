// =====================================================================
//  pack.mjs — assign every logical parameter to a host slot and give it a
//  mixed-radix multiplier. Shared by build.mjs, the GUI generator and the
//  test harness, so DSP / GUI / tests can never disagree on the layout.
// =====================================================================
import { P, SLOT_CAP, SLOT_MAX, MAX_SLOTS, MOD_DESTS } from "./params.mjs";

const LOG2 = Math.log2;

// raw ⇄ actual ----------------------------------------------------------
export function rawToActual(p, raw) {
  if (p.curve === "int") return p.min + raw;
  const n = p.steps > 1 ? raw / (p.steps - 1) : 0;
  return p.curve === "exp" ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min);
}
export function actualToRaw(p, v) {
  if (p.curve === "int") return Math.max(0, Math.min(p.steps - 1, Math.round(v - p.min)));
  let n;
  if (p.curve === "exp") n = Math.log(Math.max(v, p.min) / p.min) / Math.log(p.max / p.min);
  else n = (v - p.min) / (p.max - p.min);
  return Math.max(0, Math.min(p.steps - 1, Math.round(n * (p.steps - 1))));
}

// First-fit-decreasing bin packing in the log domain ---------------------
export function layout() {
  const direct = P.filter((p) => p.direct);
  const packed = P.filter((p) => !p.direct);
  const cost = (p) => LOG2(p.steps);
  // keep the 3 fields of a mod-matrix row together: pack in key order, big first
  const order = [...packed].sort((a, b) => cost(b) - cost(a));
  const bins = [];   // {used (product), items:[]}
  for (const p of order) {
    let bin = bins.find((b) => b.prod * p.steps <= SLOT_CAP);
    if (!bin) { bin = { prod: 1, items: [] }; bins.push(bin); }
    p.__mult = bin.prod; bin.prod *= p.steps; bin.items.push(p);
  }
  // slot numbers: direct params first (stable, low indices), then packed bins
  let slot = 0;
  for (const p of direct) { p.slot = slot++; p.mult = 1; }
  bins.forEach((b) => { b.slot = slot++; for (const p of b.items) { p.slot = b.slot; p.mult = p.__mult; } });
  const totalBits = packed.reduce((s, p) => s + cost(p), 0);
  return { slots: slot, bins, direct, packed, totalBits, capBits: bins.length * LOG2(SLOT_CAP) };
}

// default raw value of a param, and the packed slot defaults --------------
export function defaultRaw(p) { return actualToRaw(p, p.def); }
export function slotDefaults(values = {}) {
  const L = layout.cache ?? (layout.cache = layout());
  const out = new Array(L.slots).fill(0);
  for (const p of P) {
    if (p.direct) { out[p.slot] = values[p.key] ?? p.def; continue; }
    const v = values[p.key];
    out[p.slot] += (v === undefined ? defaultRaw(p) : actualToRaw(p, v)) * p.mult;
  }
  return out;
}
// decode one slot value back to {key: actual} (host rounding tolerant)
export function decodeSlot(slotIdx, value) {
  const res = {};
  const k = Math.min(SLOT_CAP - 1, Math.max(0, Math.round(value)));
  for (const p of P) {
    if (p.slot !== slotIdx) continue;
    if (p.direct) { res[p.key] = value; continue; }
    const raw = Math.floor(k / p.mult) % p.steps;
    res[p.key] = rawToActual(p, raw);
  }
  return res;
}

export const L = layout();
export function assertFits() { if (L.slots > MAX_SLOTS) throw new Error(`needs ${L.slots} slots, only ${MAX_SLOTS} available`); }
layout.cache = L;

if (process.argv[1] && process.argv[1].endsWith("pack.mjs")) {
  console.log(`logical params: ${P.length}  (direct ${L.direct.length}, packed ${L.packed.length})`);
  console.log(`slots used: ${L.slots}/${MAX_SLOTS}   packed bits ${L.totalBits.toFixed(1)} of ${L.capBits.toFixed(1)}  (${(100 * L.totalBits / L.capBits).toFixed(1)}%)`);
  console.log(`mod targets: ${MOD_DESTS.length}/63`);
  const byTab = {};
  for (const p of P) byTab[p.tab] = (byTab[p.tab] || 0) + 1;
  console.log(byTab);
}
