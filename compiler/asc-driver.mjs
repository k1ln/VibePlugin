// asc-driver.mjs
// =====================================================================
//  The program baked into the bundled `vstai-asc` executable. It runs in a
//  real JS runtime (Node, via SEA) that HAS WebAssembly, so asc's Binaryen
//  backend works. The plugin execs it as:  vstai-asc <in.ts> <out.wasm>
//
//  No top-level await (SEA's CommonJS entry forbids it) — drives asc.main
//  with .then().
// =====================================================================

import { readFileSync, writeFileSync } from "node:fs";
import asc from "assemblyscript/asc";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: vstai-asc <in.ts> <out.wasm>");
  process.exit(2);
}

const ARGS = [
  "input.ts",
  "--outFile", "output.wasm",
  "--optimizeLevel", "3",
  "--shrinkLevel", "0",
  "--noAssert",
  "--runtime", "minimal",
  "--bindings", "raw",
  "--initialMemory", "16",
  // Cap at 4096 pages = 256 MiB. Memory only grows to what a module actually
  // touches, so plain effects/synths still use a few pages; this headroom is
  // what lets a sampler/granular module allocate the optional sample buffer
  // (kMaxSampleFrames stereo f32 ≈ 110 MiB). Was 64 (4 MiB), which trapped any
  // module that declared the sample buffer.
  "--maximumMemory", "4096",
  "--use", "abort=",
];

let source;
try {
  source = readFileSync(inPath, "utf8");
} catch (e) {
  console.error("cannot read " + inPath + ": " + e.message);
  process.exit(1);
}

let wasm = null;
let diag = "";

asc.main(ARGS, {
  readFile: (n) => (n === "input.ts" ? source : null),
  writeFile: (n, c) => { if (n === "output.wasm" && c instanceof Uint8Array) wasm = c; },
  listFiles: () => [],
  stdout: { write: (s) => (diag += s) },
  stderr: { write: (s) => (diag += s) },
})
  .then(({ error }) => {
    if (error || !wasm) {
      console.error(diag || String(error) || "compile failed");
      process.exit(1);
    }
    try {
      writeFileSync(outPath, Buffer.from(wasm));
      process.exit(0);
    } catch (e) {
      console.error("cannot write " + outPath + ": " + e.message);
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exit(1);
  });
