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
import { dirname, join } from "node:path";
import asc from "assemblyscript/asc";

const [, , inPath, outPath, mode] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: vstai-asc <in.ts> <out.wasm> [--clap]");
  process.exit(2);
}
// --clap: <in.ts> is the CLAP adapter and imports its siblings ./plugin and ./meta
// from the same folder. The module keeps its function table (exported as
// __indirect_function_table, growable) because a WebCLAP host calls the plugin
// through function pointers and installs its own callbacks into that table.
const clap = mode === "--clap";

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
  ...(clap ? ["--exportTable"] : []),
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
  readFile: (n) => {
    if (n === "input.ts") return source;
    // sibling files of the adapter, plain names only
    if (clap && /^[a-z]+\.ts$/.test(n)) {
      try { return readFileSync(join(dirname(inPath), n), "utf8"); } catch (e) { return null; }
    }
    return null;
  },
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
      writeFileSync(outPath, Buffer.from(clap ? patchClap(wasm) : wasm));
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

// ---- WebCLAP module patching ---------------------------------------------
// asc exports the table as "table" with a fixed size. A WebCLAP host looks for
// "__indirect_function_table" and grows it to install host callbacks, so rename
// the export and drop the table's maximum.
function leb(n) { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; }
function readLeb(b, p) { let r = 0, s = 0, x; do { x = b[p.i++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return r >>> 0; }

function patchClap(wasm) {
  const b = Buffer.from(wasm);
  const out = [b.subarray(0, 8)];
  let i = 8, sawTable = false, sawExport = false;
  while (i < b.length) {
    const id = b[i];
    const p = { i: i + 1 };
    const size = readLeb(b, p);
    const body = b.subarray(p.i, p.i + size);
    let nb = body;
    if (id === 4) {                                  // table section: [count, (reftype, limits)...]
      const q = { i: 0 };
      const count = readLeb(body, q);
      const o = [...leb(count)];
      for (let t = 0; t < count; t++) {
        o.push(body[q.i++]);                          // element type
        const flag = body[q.i++];
        const min = readLeb(body, q);
        if (flag & 1) readLeb(body, q);               // max (dropped)
        o.push(0, ...leb(min));
      }
      nb = Buffer.from(o); sawTable = true;
    } else if (id === 7) {                           // export section: rename table
      const q = { i: 0 };
      const count = readLeb(body, q);
      const o = [...leb(count)];
      for (let e = 0; e < count; e++) {
        const len = readLeb(body, q);
        let name = body.subarray(q.i, q.i + len).toString("utf8");
        q.i += len;
        const kind = body[q.i++];
        const idx = readLeb(body, q);
        if (kind === 1 && name === "table") name = "__indirect_function_table";
        const nameBytes = Buffer.from(name, "utf8");
        o.push(...leb(nameBytes.length), ...nameBytes, kind, ...leb(idx));
      }
      nb = Buffer.from(o); sawExport = true;
    }
    out.push(Buffer.from([id, ...leb(nb.length)]), nb);   // big sections (data) are copied, never spread
    i = p.i + size;
  }
  if (!sawTable || !sawExport) throw new Error("clap module has no function table export");
  return Uint8Array.from(Buffer.concat(out));
}
