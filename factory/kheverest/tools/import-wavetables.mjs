#!/usr/bin/env node
// =====================================================================
//  import-wavetables.mjs — turn third-party wavetable packs (Serum-style WAVs:
//  float/int mono, N-sample frames, e.g. BVKER Custom Wavetables or the True
//  Cuckoo packs) into KHEVEREST's compact bank.
//
//    node factory/kheverest/tools/import-wavetables.mjs <zip|folder> [more …] [--frame 2048] [--out wt-extra.json]
//
//  Each table keeps 8 evenly spaced frames (swept by Shape Amount); each frame is
//  stored as 64 harmonics × (sine, cosine) coefficients, companded to int8
//  (sign · sqrt), with a Lanczos window against Gibbs ringing. The result is merged
//  with any existing output file (by table name), so packs can be added one at a time.
//  Licensing of the source packs is the user's responsibility (BVKER: royalty-free).
// =====================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const FRAME_ARG = +flag("--frame", 0);
const OUT = resolve(flag("--out", join(here, "../wt-extra.json")));
const COLS = 8, H = 64, FR = 2048;

function walk(p, out = []) {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f), out);
  else if (/\.wav$/i.test(p) && !p.includes("__MACOSX")) out.push(p);
  return out;
}
function readWav(buf) {
  let i = 12, fmt = null, data = null, clm = "";
  while (i + 8 <= buf.length) {
    const id = buf.toString("ascii", i, i + 4), sz = buf.readUInt32LE(i + 4);
    if (id === "fmt ") fmt = { tag: buf.readUInt16LE(i + 8), ch: buf.readUInt16LE(i + 10), sr: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    else if (id === "data") data = buf.subarray(i + 8, i + 8 + sz);
    else if (id === "clm ") clm = buf.toString("latin1", i + 8, i + 8 + Math.min(sz, 16));
    i += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error("bad wav");
  const bytes = fmt.bits / 8, n = Math.floor(data.length / bytes / fmt.ch), x = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (k * fmt.ch + c) * bytes;
      s += fmt.tag === 3 ? (fmt.bits === 32 ? data.readFloatLE(o) : data.readDoubleLE(o))
        : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
    x[k] = s / fmt.ch;
  }
  const m = /<!>(\d+)/.exec(clm);
  return { x, frame: m ? +m[1] : 0 };
}
function shortName(rel) {
  let n = basename(rel, extname(rel)).replace(/^BVKER\s*-?\s*/i, "");
  n = n.replace(/^Analog PWM Custom\s*/i, "PWMc ").replace(/^Analog PWM Saw\s*/i, "PWMs ").replace(/^Analog PWM Square\s*/i, "PWMq ").replace(/^Analog PWM Sub\s*/i, "PWMb ")
    .replace(/^Dist\s*-\s*/i, "Dst ").replace(/Clipping Extra/i, "Clip 2").replace(/Clipping/i, "Clip").replace(/Filter Drive/i, "FltDrive").replace(/Downsample/i, "Downsmp").replace(/Zero Square/i, "ZeroSqr").replace(/Sine Shaper/i, "SineShp").replace(/Soft Clip/i, "SoftClip").replace(/\s+/g, " ").trim();
  return n.slice(0, 16);
}
function category(rel) { const p = rel.split("/"); return p.length > 1 ? p[p.length - 2] : "Imported"; }

const sources = args.filter((a) => !a.startsWith("--"));
if (!sources.length) { console.error("usage: import-wavetables.mjs <zip|folder> [...]"); process.exit(2); }
const files = [];
for (const s of sources) {
  let dir = s;
  if (/\.zip$/i.test(s)) { dir = mkdtempSync(join(tmpdir(), "wt-")); execFileSync("unzip", ["-q", "-o", s, "-x", "__MACOSX/*", "-d", dir]); }
  for (const f of walk(dir)) files.push({ path: f, rel: f.slice(dir.length + 1) });
}
const bank = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { tables: [] };
const byName = new Map(bank.tables.map((t) => [t.name, t]));
const sinT = new Float64Array(FR), cosT = new Float64Array(FR);
for (let i = 0; i < FR; i++) { sinT[i] = Math.sin(2 * Math.PI * i / FR); cosT[i] = Math.cos(2 * Math.PI * i / FR); }

let added = 0;
for (const f of files) {
  let w; try { w = readWav(readFileSync(f.path)); } catch (e) { console.warn("skip", f.rel, e.message); continue; }
  const N = FRAME_ARG || w.frame || 2048;
  const frames = Math.floor(w.x.length / N);
  if (frames < 1) { console.warn("skip (too short)", f.rel); continue; }
  const bytes = new Int8Array(COLS * H * 2);
  for (let c = 0; c < COLS; c++) {
    const fi = Math.round(c * (frames - 1) / (COLS - 1));
    // resample the frame to FR points (linear) when N differs
    const fr = new Float64Array(FR);
    for (let i = 0; i < FR; i++) { const p = i * N / FR, k = Math.floor(p), t = p - k; fr[i] = w.x[fi * N + k] * (1 - t) + w.x[fi * N + Math.min(N - 1, k + 1)] * t; }
    const a = new Float64Array(H), b = new Float64Array(H);
    for (let h = 1; h <= H; h++) {
      let sa = 0, sb = 0;
      for (let i = 0; i < FR; i++) { const idx = (h * i) & (FR - 1); sa += fr[i] * cosT[idx]; sb += fr[i] * sinT[idx]; }
      const sig = Math.sin(Math.PI * h / (H + 1)) / (Math.PI * h / (H + 1));        // Lanczos σ
      a[h - 1] = 2 * sa / FR * sig; b[h - 1] = 2 * sb / FR * sig;
    }
    let M = 1e-9; for (let h = 0; h < H; h++) M = Math.max(M, Math.abs(a[h]), Math.abs(b[h]));
    const q = (v) => Math.round(127 * Math.sign(v) * Math.sqrt(Math.abs(v) / M));
    for (let h = 0; h < H; h++) { bytes[(c * H + h) * 2] = q(b[h]); bytes[(c * H + h) * 2 + 1] = q(a[h]); }   // sine, cosine
  }
  const name = shortName(f.rel);
  const t = { name, cat: category(f.rel), src: basename(f.rel), b64: Buffer.from(bytes.buffer).toString("base64") };
  if (!byName.has(name)) added++;
  byName.set(name, t);
}
bank.tables = [...byName.values()];
bank.note = "Frames: 8 per table, 64 harmonics × (sine, cosine), int8 sqrt-companded. Generated by tools/import-wavetables.mjs";
writeFileSync(OUT, JSON.stringify(bank));
console.log(`${files.length} files read, ${added} new tables, ${bank.tables.length} total → ${OUT}`);
