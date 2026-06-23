// webplayer/server.mjs
// =====================================================================
//  Minimal zero-dependency catalogue server for published VibePlugin plugins.
//
//  The VibePlugin host POSTs a compiled plugin here when you press "Publish".
//  This server stores each one as a .vstai JSON (the same format the host
//  saves/loads) and serves a browser front-end that lets anyone search the
//  catalogue, PLAY a plugin live in the browser (the AssemblyScript/WASM DSP
//  runs in an AudioWorklet), and download the .vstai.
//
//  Run:   node webplayer/server.mjs            (defaults to :8787, ./data)
//         PORT=9000 DATA_DIR=/var/vstai node webplayer/server.mjs
//
//  Point the host's "Publish server URL" (Keys… dialog) at this server's
//  base URL, e.g. http://localhost:8787
// =====================================================================

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const HERE     = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC    = path.join(HERE, "public");
const DATA_DIR  = process.env.DATA_DIR || path.join(HERE, "data");
const PORT      = parseInt(process.env.PORT || "8787", 10);
const MAX_BODY  = 64 * 1024 * 1024;   // 64 MB — generous; wasm payloads are tiny

const MIME = {
  ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8", ".json": "application/json;charset=utf-8",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

await fs.mkdir(DATA_DIR, { recursive: true });

// ---- helpers --------------------------------------------------------
function slug(s) {
  return (s || "plugin").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "plugin";
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json;charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const docPath = (id) => path.join(DATA_DIR, id + ".vstai");

async function listDocs() {
  const out = [];
  for (const f of await fs.readdir(DATA_DIR)) {
    if (!f.endsWith(".vstai")) continue;
    try {
      const doc = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
      out.push({
        id: f.slice(0, -6),
        name: doc.name || "Untitled",
        isInstrument: !!doc.isInstrument,
        explanation: doc.explanation || "",
        params: Array.isArray(doc.params) ? doc.params.length : 0,
        publishedAt: doc.publishedAt || 0,
      });
    } catch { /* skip malformed */ }
  }
  out.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return out;
}

// ---- routes ---------------------------------------------------------
async function handlePublish(req, res) {
  const body = await readBody(req);
  let doc;
  try { doc = JSON.parse(body.toString("utf8")); }
  catch { return json(res, 400, { error: "body is not valid JSON" }); }

  if (!doc || !doc.wasmBase64 || !doc.html)
    return json(res, 400, { error: "missing wasmBase64 or html — is this a compiled plugin?" });

  doc.publishedAt = Date.now();
  const id = slug(doc.name) + "-" + crypto.randomBytes(3).toString("hex");
  await fs.writeFile(docPath(id), JSON.stringify(doc));

  const base = `http://${req.headers.host}`;
  return json(res, 200, { id, url: `${base}/play.html?id=${id}` });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);   // ["api", ...]

  if (req.method === "POST" && parts[1] === "publish")
    return handlePublish(req, res);

  if (req.method === "GET" && parts[1] === "plugins" && parts.length === 2) {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    let rows = await listDocs();
    if (q) rows = rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.explanation.toLowerCase().includes(q));
    return json(res, 200, rows);
  }

  if (req.method === "GET" && parts[1] === "plugins" && parts[2]) {
    const id = parts[2].replace(/[^a-z0-9-]/gi, "");
    let raw;
    try { raw = await fs.readFile(docPath(id), "utf8"); }
    catch { return json(res, 404, { error: "not found" }); }
    const doc = JSON.parse(raw);

    if (parts[3] === "plugin.wasm") {                       // binary wasm
      const bytes = Buffer.from(doc.wasmBase64 || "", "base64");
      cors(res);
      res.writeHead(200, { "Content-Type": "application/wasm" });
      return res.end(bytes);
    }
    if (parts[3] === "download") {                          // the .vstai file
      cors(res);
      res.writeHead(200, {
        "Content-Type": "application/json;charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug(doc.name)}.vstai"`,
      });
      return res.end(raw);
    }
    // metadata + html + params for the player (omit the big base64 wasm).
    return json(res, 200, {
      id, name: doc.name || "Untitled", isInstrument: !!doc.isInstrument,
      explanation: doc.explanation || "", params: doc.params || [],
      html: doc.html, wasmUrl: `/api/plugins/${id}/plugin.wasm`,
    });
  }

  return json(res, 404, { error: "unknown endpoint" });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  // contain to PUBLIC (no traversal)
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
}).listen(PORT, () => {
  console.log(`VibePlugin web player on http://localhost:${PORT}  (data: ${DATA_DIR})`);
});
