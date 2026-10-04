#!/usr/bin/env node
// =====================================================================
//  std/build.mjs — generate the "Std*" bread-and-butter effect plugins.
//
//  Each effect is a small definition in fx-*.mjs: parameters, GUI groups,
//  a response/transfer-curve visualiser and the DSP as code fragments
//  (globals / init / block / pre / sample / post). This script pastes the
//  fragments into one AssemblyScript wrapper (prelude.ts + generated P_*
//  constants + ABI exports), writes assembly.ts + def.mjs into
//  factory/plugins/<slug>/ and hands off to factory/tools/scaffold.mjs for
//  spec.json / gui.html. In the DSP and viz fragments `$Name` means the
//  parameter called "Name" (spaces/punctuation dropped): params[P_NAME] in
//  DSP, V[index] in the GUI.
//
//  Usage: node factory/std/build.mjs [slug …|all] [--pack]
//     default  generate + compile + wasm-runner + gui-check (no packing)
//     --pack   additionally pack the .vstai and rebuild the gallery
//
//  Fragment contract
//    mode "chan"   : sample runs once per channel with c (0/1), x (input) and
//                    y (output, starts = x). pre/post run once per frame.
//    mode "stereo" : sample runs once per frame with xl, xr, yl, yr.
//    block runs at the top of process(n); after runs at the end (set display[]).
//    display[0] = output peak, display[1] = input peak are written for you.
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const prelude = readFileSync(join(here, "prelude.ts"), "utf8");

export const THEMES = {
  Filters:    { accent: "#ffb347", accent2: "#ffe2b0", bg1: "#3a2410", bg2: "#120a04", panel: "#241608", ink: "#fbeedd", dim: "#b79a78" },
  Reverb:     { accent: "#7aa8ff", accent2: "#d4e2ff", bg1: "#14264a", bg2: "#060b18", panel: "#0e1a32", ink: "#e6eefc", dim: "#8a9cc0" },
  Delay:      { accent: "#4fd6c4", accent2: "#c4f5ee", bg1: "#0f3a38", bg2: "#041514", panel: "#0a2624", ink: "#e2f8f5", dim: "#7fb0aa" },
  Distortion: { accent: "#ff6a4d", accent2: "#ffc7b8", bg1: "#411610", bg2: "#150704", panel: "#2a0e09", ink: "#fbe6e0", dim: "#b88a80" },
  Modulation: { accent: "#c58bff", accent2: "#ebd6ff", bg1: "#2c1650", bg2: "#0d0618", panel: "#1d0f36", ink: "#f0e6fb", dim: "#9a85b8" },
  Dynamics:   { accent: "#8fe388", accent2: "#d6f7d2", bg1: "#163a16", bg2: "#061406", panel: "#0e260e", ink: "#e6f8e4", dim: "#85b082" },
  EQ:         { accent: "#f2e06b", accent2: "#fbf4c4", bg1: "#3a3410", bg2: "#131004", panel: "#252008", ink: "#fbf8e0", dim: "#b5ad78" },
  Utility:    { accent: "#9fb4cc", accent2: "#dbe5f0", bg1: "#222c3a", bg2: "#0a0d12", panel: "#161d27", ink: "#e8eef5", dim: "#8795a6" },
};
export const CATEGORY = {
  Filters: "Filters", Reverb: "Reverb", Delay: "Delay & Echo", Distortion: "Distortion & Saturation",
  Modulation: "Modulation", Dynamics: "Dynamics", EQ: "EQ & Tone", Utility: "Creative",
};

const keyOf = (name) => name.replace(/[^A-Za-z0-9]/g, "");

function resolveDsp(code, keys, label) {
  return code.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (m, k) => {
    if (!(k in keys)) throw new Error(`${label}: unknown parameter $${k}`);
    return `params[P_${k.toUpperCase()}]`;
  });
}
function resolveViz(code, keys, label) {
  return code.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (m, k) => {
    if (!(k in keys)) throw new Error(`${label}: unknown viz parameter $${k}`);
    return `V[${keys[k]}]`;
  });
}

export function generate(e) {
  const keys = {};
  e.params.forEach((p, i) => {
    const k = keyOf(p[0]);
    if (k in keys) throw new Error(`${e.slug}: duplicate param key ${k}`);
    keys[k] = i;
  });
  if (e.params.length > 64) throw new Error(`${e.slug}: more than 64 params`);
  const upper = new Set(Object.keys(keys).map((k) => k.toUpperCase()));
  if (upper.size !== Object.keys(keys).length) throw new Error(`${e.slug}: param keys collide when upper-cased`);
  const R = (c) => resolveDsp(c || "", keys, e.slug);
  const fmt = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const consts = Object.entries(keys).map(([k, i]) => `const P_${k.toUpperCase()}: i32 = ${i};`).join("\n");
  const defaults = e.params.map((p, i) => `  params[${i}] = ${fmt(p[3])};   // ${p[0]}`).join("\n");
  const mode = e.mode || "chan";
  const loop = mode === "stereo"
    ? `    const xl: f32 = inBuf[f]; const xr: f32 = inBuf[MAX_FRAMES + f];
    let yl: f32 = xl; let yr: f32 = xr;
    ${R(e.pre)}
    ${R(e.sample)}
    if (!(yl == yl)) yl = 0.0; if (!(yr == yr)) yr = 0.0;
    outBuf[f] = yl; outBuf[MAX_FRAMES + f] = yr;
    pkIn = maxf(pkIn, maxf(absf(xl), absf(xr))); pkOut = maxf(pkOut, maxf(absf(yl), absf(yr)));
    ${R(e.post)}`
    : `    ${R(e.pre)}
    for (let c: i32 = 0; c < 2; c++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f];
      let y: f32 = x;
      ${R(e.sample)}
      if (!(y == y)) y = 0.0;
      outBuf[c * MAX_FRAMES + f] = y;
      pkIn = maxf(pkIn, absf(x)); pkOut = maxf(pkOut, absf(y));
    }
    ${R(e.post)}`;
  const asm = `// =====================================================================
//  ${e.name.toUpperCase()} — ${e.subtitle}
//  ${e.explanation.replace(/\n/g, "\n//  ")}
//  (generated by factory/std/build.mjs from factory/std/fx-*.mjs — edit the definition, not this file)
// =====================================================================
${prelude}
const NUM_PARAMS: i32 = ${e.params.length};
${consts}
function setDefaults(): void {
${defaults}
}

${R(e.globals)}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
export function transport(playing: i32, ppq: f64, bpm: f32): void {
  hostPlaying = playing != 0; if (bpm > 20.0) hostBpm = bpm;
  if (hostPlaying) beatPos = ppq;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  hostPlaying = false; hostBpm = 120.0; beatPos = 0.0; seed = 12345;
  setDefaults();
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  ${R(e.init)}
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  let pkIn: f32 = 0.0; let pkOut: f32 = 0.0;
  ${R(e.block)}
  for (let f = 0; f < n; f++) {
${loop}
  }
  display[0] = maxf(display[0] * 0.8, clampf(pkOut, 0.0, 1.0));
  display[1] = maxf(display[1] * 0.8, clampf(pkIn, 0.0, 1.0));
  ${R(e.after)}
}
`;
  const theme = THEMES[e.theme || "Utility"];
  const def = {
    name: e.name, isInstrument: false, subtitle: e.subtitle, category: CATEGORY[e.theme || "Utility"],
    explanation: e.explanation, theme, params: e.params, groups: e.groups,
    viz: e.viz || "custom", vizLabel: e.vizLabel || "", vizParam: e.vizParam,
    vizCode: e.vizCode ? resolveViz(e.vizCode, keys, e.slug) : undefined,
    testParams: e.testParams || {},
    reactPatches: e.reactPatches, reactInput: e.reactInput, reactMin: e.reactMin,
  };
  const dir = join(root, "factory/plugins", e.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "assembly.ts"), asm);
  writeFileSync(join(dir, "def.mjs"), "export default " + JSON.stringify(def, null, 1) + ";\n");
  return dir;
}

// ---------- CLI ----------
async function main() {
  const args = process.argv.slice(2);
  const pack = args.includes("--pack");
  const want = args.filter((a) => !a.startsWith("--"));
  const mods = ["fx-filters", "fx-reverb", "fx-delay", "fx-dist", "fx-mod", "fx-dyn", "fx-eq"];
  let all = [];
  for (const m of mods) {
    if (!existsSync(join(here, m + ".mjs"))) continue;
    all = all.concat((await import(join(here, m + ".mjs"))).default);
  }
  const slugs = new Set(all.map((e) => e.slug));
  if (slugs.size !== all.length) throw new Error("duplicate slugs in fx-*.mjs");
  const todo = want.length === 0 || want.includes("all") ? all : all.filter((e) => want.includes(e.slug));
  if (!todo.length) { console.error("no matching effects. known: " + [...slugs].join(" ")); process.exit(2); }
  const tmp = mkdtempSync(join(tmpdir(), "std-"));
  const run = (cmd, a) => { try { return execFileSync(cmd, a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }); } catch (err) { return (err.stdout || "") + (err.stderr || "") + "\n__FAILED__"; } };
  let bad = 0;
  for (const e of todo) {
    const dir = generate(e);
    run("node", ["factory/tools/scaffold.mjs", e.slug]);
    const wasm = join(tmp, e.slug + ".wasm");
    const asc = run("node", ["compiler/asc-driver.mjs", `factory/plugins/${e.slug}/assembly.ts`, wasm]);
    if (asc.includes("FAILURE") || asc.includes("__FAILED__") || !existsSync(wasm)) { console.log(`✗ ${e.slug}: COMPILE FAILED\n${asc.slice(0, 1800)}`); bad++; continue; }
    const lines = [];
    let ok = true;
    for (const pf of ["spec.json", "test-params.json"]) {
      const out = run("node", ["factory/tools/wasm-runner.mjs", wasm, "--params", join(dir, pf), ...(e.runnerArgs || [])]);
      const verdict = (out.match(/VERDICT: (\w+)/) || [])[1] || "?";
      if (verdict !== "PASS") ok = false;
      const inert = out.split("\n").filter((l) => /inert|no effect|not reactive/i.test(l));
      lines.push(`  ${pf}: ${verdict}` + (inert.length ? "\n    " + inert.join("\n    ") : "") + "\n" + out.split("\n").filter((l) => /output:|peak|rms/i.test(l)).slice(0, 2).map((l) => "    " + l.trim()).join("\n"));
    }
    const gc = run("node", ["factory/tools/gui-check.mjs", dir, "--shot", join(tmp, e.slug + ".png")]);
    const guiOk = /GUI CHECK: PASS/.test(gc);
    if (!guiOk) ok = false;
    console.log(`${ok ? "✓" : "✗"} ${e.slug} (${e.name}) gui:${guiOk ? "PASS" : "FAIL " + gc.slice(0, 600)}\n${lines.join("\n")}`);
    if (!ok) bad++;
    if (pack && ok) console.log(run("node", ["factory/tools/scaffold.mjs", e.slug, "--pack"]).split("\n").slice(-6).join("\n"));
  }
  console.log(`\n${todo.length - bad}/${todo.length} ok. shots + wasm in ${tmp}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
