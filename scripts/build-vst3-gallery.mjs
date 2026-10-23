#!/usr/bin/env node
// build-vst3-gallery.mjs
// =====================================================================
//  Renders every gallery plugin to a locked, signed whitelabel .vst3 for THIS OS,
//  zips each one and (optionally) uploads the zips to a Scaleway Object Storage
//  bucket the gallery links to. Run it on macOS, Windows and Linux (CI does the
//  last two: .github/workflows/gallery-vst3.yml) — each run owns its OS's column of
//  docs/gallery/vst3/index.json and leaves the others alone.
//
//  Per plugin it runs the headless exporter (`vstai_export_vst3` — the editor's
//  "Export plugin…" minus the editor): copy the built VibePlugin Synth/FX bundle,
//  bake the creation in, slim, give it its own VST3 id, sign. Then it checks the
//  result before keeping it: unique CID across the whole set, valid signature (macOS).
//
//      cmake -B build-test -DVSTAI_BUILD_TESTS=ON …  &&  cmake --build build-test --target vstai_export_vst3
//      node scripts/build-vst3-gallery.mjs [options]
//
//  Options
//    --only id,id        just these plugins            --all      include gate-hidden plugins
//    --force             ignore the cache              --jobs N   parallel exports (default 4)
//    --notary <profile>  macOS: notarize + staple each (xcrun notarytool keychain profile)
//    --os <name>         render for macos|windows|linux instead of this OS (cross-render: a Linux
//                        box can export from a Windows source bundle — the patching is byte-level)
//    --manifest <file>   write the manifest there instead of docs/gallery/vst3/index.json
//                        (merge parts with scripts/merge-vst3-manifest.mjs)
//    --upload            after building, sync this OS's zips to the bucket (see below)
//    --base <url>        public URL prefix the gallery downloads from (saved in the manifest)
//
//  Environment
//    VSTAI_VST3_SRC      dir holding "VibePlugin Synth.vst3" + "VibePlugin FX.vst3"
//                        (default: found under build*/…/Release/VST3 or build*/…/VST3)
//    VSTAI_EXPORT_VST3   path of the vstai_export_vst3 binary (default: found under build*/)
//    VSTAI_SIGN_ID       macOS signing identity (default: the Developer ID Application cert)
//    VSTAI_WIN_SIGN_PFX  Windows: Authenticode .pfx to sign each plugin DLL with (signtool); with
//    VSTAI_WIN_SIGN_PASS its password. Unset = Windows zips are unsigned (SmartScreen will warn).
//    Upload (Scaleway Object Storage is S3-compatible; uses the `aws` CLI). Put these in the
//    gitignored .env.scaleway at the repo root (SCW_ACCESS_KEY / SCW_SECRET_KEY are the key pair):
//      SCW_BUCKET        bucket name             SCW_REGION   e.g. fr-par (default)
//      SCW_PREFIX        key prefix (default "vst3/")
//      AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   the Scaleway API key pair
//    --base defaults to https://$SCW_BUCKET.s3.$SCW_REGION.scw.cloud/$SCW_PREFIX
// =====================================================================

import { promises as fs, existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "docs", "gallery", "data");
// Credentials live in a gitignored .env.scaleway (KEY=value lines); real environment variables win.
try {
  for (const line of readFileSync(path.join(ROOT, ".env.scaleway"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}
process.env.AWS_ACCESS_KEY_ID ||= process.env.SCW_ACCESS_KEY;
process.env.AWS_SECRET_ACCESS_KEY ||= process.env.SCW_SECRET_KEY;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const HOST = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
const OSNAME = opt("--os", HOST);
if (!HOST || !["macos", "windows", "linux"].includes(OSNAME)) { console.error("unsupported platform/--os " + OSNAME); process.exit(2); }
const MANIFEST = path.resolve(opt("--manifest", path.join(ROOT, "docs", "gallery", "vst3", "index.json")));
const jobs = Math.max(1, +opt("--jobs", 4));
const only = opt("--only", "") ? new Set(opt("--only", "").split(",")) : null;
const notary = opt("--notary", "");
const OUT = path.resolve(opt("--out", path.join(ROOT, "dist", "gallery-vst3", OSNAME)));

// ---- locate the built plugin bundles + the exporter ---------------------
const exe = HOST === "windows" ? ".exe" : "";
const buildDirs = readdirSync(ROOT).filter((d) => d.startsWith("build")).map((d) => path.join(ROOT, d));
function find(cands, pred) { for (const c of cands) if (pred(c)) return c; return null; }

const exporter = process.env.VSTAI_EXPORT_VST3 || find(
  buildDirs.flatMap((d) => ["Release", "", "Debug"].map((c) => path.join(d, "vstai_export_vst3_artefacts", c, "vstai_export_vst3" + exe))),
  existsSync);
const bundleFor = (kind) => {
  const name = `VibePlugin ${kind}.vst3`;
  if (process.env.VSTAI_VST3_SRC) return path.join(process.env.VSTAI_VST3_SRC, name);
  return find(buildDirs.flatMap((d) => [
    path.join(d, `VibePlugin_${kind}_artefacts`, "Release", "VST3", name),
    path.join(d, `VibePlugin_${kind}_artefacts`, "VST3", name)]), existsSync);
};
const SRC = { Synth: bundleFor("Synth"), FX: bundleFor("FX") };
if (!exporter || !existsSync(exporter)) { console.error("No vstai_export_vst3 binary — build it (see the header) or set VSTAI_EXPORT_VST3."); process.exit(2); }
for (const [k, v] of Object.entries(SRC)) if (!v || !existsSync(v)) { console.error(`No built "VibePlugin ${k}.vst3" — build the plugins or set VSTAI_VST3_SRC.`); process.exit(2); }

const run = (cmd, argv, o = {}) => new Promise((resolve) =>
  execFile(cmd, argv, { maxBuffer: 64 << 20, timeout: 30 * 60 * 1000, ...o }, (err, stdout, stderr) => resolve({ err, out: String(stdout) + String(stderr) })));

// Hash of the source plugin binary the exports are derived from: a rebuilt plugin invalidates the cache.
async function fingerprint(dir) {
  const h = createHash("sha256");
  const contents = path.join(dir, "Contents");
  for (const sub of await fs.readdir(contents)) {
    const d = path.join(contents, sub);
    if (!(await fs.stat(d)).isDirectory() || sub === "Resources") continue;
    for (const f of (await fs.readdir(d)).sort()) {
      const p = path.join(d, f);
      if ((await fs.stat(p)).isFile()) h.update(f).update(await fs.readFile(p));
    }
  }
  return h.digest("hex");
}

const safeName = (n) => (n.replace(/[^A-Za-z0-9 _.+&-]/g, "").trim().replace(/\s+/g, " ") || "Plugin");

// ---- catalogue ----------------------------------------------------------
let ids;
if (flag("--all")) ids = (await fs.readdir(DATA)).filter((f) => f.endsWith(".vstai")).map((f) => f.slice(0, -6));
else ids = JSON.parse(await fs.readFile(path.join(DATA, "index.json"), "utf8")).map((r) => r.id);
if (only) ids = ids.filter((i) => only.has(i));

let manifest = { base: "", items: {} };
try { manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8")); } catch {}
manifest.items ||= {};
const base = opt("--base", "") || (process.env.SCW_BUCKET
  ? `https://${process.env.SCW_BUCKET}.s3.${process.env.SCW_REGION || "fr-par"}.scw.cloud/${process.env.SCW_PREFIX ?? "vst3/"}` : "");
if (base) manifest.base = base.endsWith("/") ? base : base + "/";

await fs.mkdir(OUT, { recursive: true });
const work = await fs.mkdtemp(path.join(os.tmpdir(), "vstai-vst3-"));
const srcPrint = { Synth: await fingerprint(SRC.Synth), FX: await fingerprint(SRC.FX) };
const failed = [];
const cids = new Map();     // cid -> id, to catch two plugins sharing a VST3 id
let built = 0, cached = 0;

async function one(id) {
  const raw = await fs.readFile(path.join(DATA, id + ".vstai"));
  const doc = JSON.parse(raw.toString("utf8"));
  const kind = doc.isInstrument ? "Synth" : "FX";
  const hash = createHash("sha256").update(raw).update(srcPrint[kind]).update(notary ? "n" : "").digest("hex").slice(0, 16);
  const file = `${id}-${OSNAME}.zip`;
  const zip = path.join(OUT, file);
  const prev = manifest.items[id]?.[OSNAME];
  if (!flag("--force") && prev && prev.hash === hash && prev.cid && existsSync(zip)) {
    manifest.items[id][OSNAME] = prev; cids.set(prev.cid, id); cached++; return;
  }

  const dir = path.join(work, id);
  await fs.mkdir(dir, { recursive: true });
  const bundle = path.join(dir, safeName(doc.name || id) + ".vst3");
  const r = await run(exporter, [path.join(DATA, id + ".vstai"), SRC[kind], bundle, ...(notary ? ["--notary", notary] : [])],
    { env: { ...process.env } });
  if (r.err || !existsSync(bundle)) { failed.push(`${id}: export — ${r.out.trim().split("\n").slice(-2).join(" | ")}`); return; }
  if (OSNAME === "macos" && /Sealed ad-hoc/.test(r.out)) { failed.push(`${id}: only ad-hoc signed (no Developer ID identity found)`); return; }
  if (notary && !/Notarized/.test(r.out)) { failed.push(`${id}: not notarized — ${r.out.trim().slice(-200)}`); return; }

  let cid = "";
  try { cid = JSON.parse((await fs.readFile(path.join(bundle, "Contents", "Resources", "moduleinfo.json"), "utf8")).replace(/,(\s*[}\]])/g, "$1")).Classes[0].CID; } catch {}
  if (!cid) { failed.push(`${id}: no CID in moduleinfo.json`); return; }
  if (cids.has(cid) && cids.get(cid) !== id) { failed.push(`${id}: VST3 id ${cid} collides with ${cids.get(cid)}`); return; }

  if (OSNAME === "macos" && HOST === "macos") {
    const v = await run("codesign", ["--verify", "--strict", bundle]);
    if (v.err) { failed.push(`${id}: signature invalid — ${v.out.trim()}`); return; }
  }

  // Windows: Authenticode-sign the plugin DLL if a certificate is configured. After the export
  // (which rewrites bytes in it) and before zipping, so the signature covers the final binary.
  let signed = OSNAME === "macos" ? (notary ? "notarized" : "developer-id") : "none";
  if (OSNAME === "windows" && HOST === "windows" && process.env.VSTAI_WIN_SIGN_PFX) {
    const archDir = path.join(bundle, "Contents", "x86_64-win");
    const dlls = existsSync(archDir) ? (await fs.readdir(archDir)).filter((f) => f.endsWith(".vst3")) : [];
    if (!dlls.length) { failed.push(`${id}: no plugin DLL to sign under ${archDir}`); return; }
    for (const d of dlls) {
      const sg = await run("signtool", ["sign", "/f", process.env.VSTAI_WIN_SIGN_PFX, ...(process.env.VSTAI_WIN_SIGN_PASS ? ["/p", process.env.VSTAI_WIN_SIGN_PASS] : []),
        "/fd", "sha256", "/tr", "http://timestamp.digicert.com", "/td", "sha256", path.join(archDir, d)]);
      if (sg.err) { failed.push(`${id}: signtool — ${sg.out.trim().slice(-200)}`); return; }
    }
    signed = "authenticode";
  }

  await fs.rm(zip, { force: true });
  const z = HOST === "macos" ? await run("ditto", ["-c", "-k", "--keepParent", bundle, zip])
          : HOST === "windows" ? await run("7z", ["a", "-tzip", "-bd", zip, path.basename(bundle)], { cwd: dir })
          : await run("zip", ["-r", "-y", "-q", zip, path.basename(bundle)], { cwd: dir });
  if (z.err || !existsSync(zip)) { failed.push(`${id}: zip — ${z.out.trim()}`); return; }
  const sha = createHash("sha256").update(await fs.readFile(zip)).digest("hex");
  cids.set(cid, id);
  (manifest.items[id] ||= {})[OSNAME] = { file, bytes: (await fs.stat(zip)).size, sha256: sha, hash, cid, name: path.basename(bundle), signed };
  built++;
  await fs.rm(dir, { recursive: true, force: true });
}

const queue = [...ids]; let done = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (queue.length) {
    const id = queue.shift();
    try { await one(id); } catch (e) { failed.push(`${id}: ${e.message}`); }
    if (process.stdout.isTTY) process.stdout.write(`\r${++done}/${ids.length} `);
  }
}));
if (process.stdout.isTTY) process.stdout.write("\n");
await fs.rm(work, { recursive: true, force: true });

// Failed plugins lose this OS's entry (a stale zip must not be offered); plugins no longer listed drop out.
for (const f of failed) { const id = f.split(":")[0]; if (manifest.items[id]) delete manifest.items[id][OSNAME]; }
if (!only) for (const id of Object.keys(manifest.items)) if (!ids.includes(id)) delete manifest.items[id];
for (const id of Object.keys(manifest.items)) if (!Object.keys(manifest.items[id]).length) delete manifest.items[id];
manifest.items = Object.fromEntries(Object.entries(manifest.items).sort(([a], [b]) => a.localeCompare(b)));
await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
await fs.writeFile(MANIFEST, JSON.stringify(manifest) + "\n");

console.log(`VST3 (${OSNAME}): ${built} built, ${cached} cached, ${failed.length} failed → ${OUT}`);
for (const f of failed) console.error("  ! " + f);

// ---- upload -------------------------------------------------------------
if (flag("--upload")) {
  const bucket = process.env.SCW_BUCKET;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("--upload needs SCW_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (the Scaleway API key pair)."); process.exit(2);
  }
  const region = process.env.SCW_REGION || "fr-par";
  const prefix = process.env.SCW_PREFIX ?? "vst3/";
  const dest = `s3://${bucket}/${prefix}`;
  // Only what the manifest lists for this OS, so a failed plugin's stale zip is never published.
  const keep = Object.values(manifest.items).map((e) => e[OSNAME]?.file).filter(Boolean);
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "vstai-upload-"));
  for (const f of keep) await fs.symlink(path.join(OUT, f), path.join(stage, f));
  const u = await run("aws", ["s3", "sync", stage, dest, "--follow-symlinks", "--endpoint-url", `https://s3.${region}.scw.cloud`,
    "--region", region, "--acl", "public-read", "--content-type", "application/zip", "--cache-control", "public, max-age=3600"]);
  await fs.rm(stage, { recursive: true, force: true });
  console.log(u.err ? "upload FAILED:\n" + u.out.slice(-1500) : `uploaded ${keep.length} zip(s) to ${dest}`);
  if (u.err) process.exit(1);
}
process.exit(failed.length ? 1 : 0);
