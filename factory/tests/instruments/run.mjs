#!/usr/bin/env node
// =====================================================================
//  factory/tests/instruments/run.mjs — behavioural tests for the drum
//  machines and string instruments (factory/drums, factory/strings).
//
//  Compiles each plugin's assembly.ts with the bundled compiler into a temp
//  dir and runs its suite: sequencer timing to the sample, pitch accuracy,
//  articulations, controllers, ostinato rhythm, CPU budget.
//    node factory/tests/instruments/run.mjs            (all)
//    node factory/tests/instruments/run.mjs tessitura  (one)
//  Build the plugins first: node factory/drums/build.mjs
// =====================================================================
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const SUITES = [
  ["bridgewell-80", "seq808.mjs"], ["bridgewell-bass", "bass-test.mjs"],
  ["warehouse-909", "seq909.mjs", true], ["tessitura", "tess-test.mjs"],
  ["aleatora", "alea-test.mjs"], ["colossus", "col-test.mjs"],
];
const only = process.argv.slice(2);
const tmp = mkdtempSync(join(tmpdir(), "vstai-itest-"));
let failed = 0;
for (const [slug, test, needsSpec] of SUITES) {
  if (only.length && !only.includes(slug)) continue;
  const wasm = join(tmp, slug + ".wasm");
  execFileSync(join(root, "compiler/vstai-node"), [join(root, "compiler/asc-driver.mjs"), join(root, "factory/plugins", slug, "assembly.ts"), wasm], { stdio: "pipe" });
  const args = [join(here, test), wasm]; if (needsSpec) args.push(join(root, "factory/plugins", slug, "spec.json"));
  console.log(`\n== ${slug} (${test})`);
  try { execFileSync("node", args, { stdio: "inherit", cwd: here }); } catch { failed++; }
}
console.log(failed ? `\n${failed} SUITE(S) FAILED` : "\nALL INSTRUMENT SUITES PASSED");
process.exit(failed ? 1 : 0);
