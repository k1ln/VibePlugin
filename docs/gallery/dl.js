// dl.js — the optional downloads next to .vstai: WebCLAP bundles (webclap/index.json, hosted
// here) and signed locked VST3s per OS (vst3/index.json; the zips live in an object-storage
// bucket named by its `base`). Both manifests are optional: a missing one just hides its buttons.

const OS_LABEL = { macos: "macOS", windows: "Windows", linux: "Linux" };
const OS_ORDER = ["macos", "windows", "linux"];

export async function loadDownloads() {
  const get = async (u) => { try { const r = await fetch(u, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; } };
  const [webclap, vst3] = await Promise.all([get("webclap/index.json"), get("vst3/index.json")]);
  return { webclap: webclap || {}, vst3: vst3 && vst3.base ? vst3 : { base: "", items: {} } };
}

// The viewer's OS first, so the likely download is one click.
function guessOs() {
  const p = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  return /mac|iphone|ipad/.test(p) ? "macos" : /win/.test(p) ? "windows" : /linux|x11/.test(p) ? "linux" : "";
}

export function webclapLink(dl, id, cls) {
  const e = dl.webclap[id];
  if (!e || !e.file) return null;
  const a = document.createElement("a");
  a.className = cls; a.href = "webclap/" + encodeURIComponent(e.file); a.download = e.file;
  a.title = "WebCLAP bundle for browser hosts such as openDAW (Load Plugin → Import WebCLAP…)";
  a.textContent = cls.includes("btn") ? "Download WebCLAP" : "↓ WebCLAP";
  return a;
}

// A button that opens a small menu of per-OS VST3 zips. Returns null when none are published.
export function vst3Menu(dl, id, cls) {
  const item = dl.vst3.items[id];
  const oses = item ? OS_ORDER.filter((o) => item[o]) : [];
  if (!oses.length) return null;
  const mine = guessOs();
  oses.sort((a, b) => (b === mine) - (a === mine));
  const wrap = document.createElement("span");
  wrap.className = "dl-pop";
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = cls; btn.setAttribute("aria-haspopup", "true");
  btn.textContent = cls.includes("btn") ? "Download VST3 ▾" : "↓ VST3 ▾";
  btn.title = "Locked, signed VST3 plugin — pick your OS";
  const menu = document.createElement("span");
  menu.className = "dl-menu"; menu.hidden = true;
  for (const o of oses) {
    const e = item[o];
    const a = document.createElement("a");
    a.href = dl.vst3.base + encodeURIComponent(e.file);
    a.textContent = `${OS_LABEL[o]} · ${(e.bytes / 1048576).toFixed(1)} MB`;
    a.title = { notarized: "Developer ID signed + notarized", "developer-id": "Developer ID signed", authenticode: "Authenticode signed" }[e.signed] || "Unsigned build";
    menu.appendChild(a);
  }
  const close = () => { menu.hidden = true; };
  btn.addEventListener("click", (ev) => { ev.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener("click", (ev) => { ev.stopPropagation(); close(); });
  document.addEventListener("click", close);
  wrap.append(btn, menu);
  return wrap;
}
