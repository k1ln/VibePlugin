/* =====================================================================
   Releases page — pulls assets live from the GitHub Releases API and
   sorts them into the macOS / Windows / Linux cards. OS-detected card is
   highlighted. Falls back gracefully to "coming soon" when a platform has
   no asset yet, and to a GitHub link if the API is unreachable / rate-limited.
   ===================================================================== */

const REPO = "k1ln/VibePlugin";
const API = `https://api.github.com/repos/${REPO}/releases`;

const OS_KEYS = {
  macos:   [/mac/i, /osx/i, /darwin/i, /\.dmg$/i, /\.pkg$/i],
  windows: [/win/i, /\.exe$/i, /\.msi$/i],
  linux:   [/linux/i, /\.deb$/i, /\.rpm$/i, /\.appimage$/i],
};

function classify(name) {
  for (const os of Object.keys(OS_KEYS)) {
    if (OS_KEYS[os].some((re) => re.test(name))) return os;
  }
  return null;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return ""; }
}

const DL_ICON = '<svg class="ai" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>';

function assetRow(a) {
  return `<a class="dl-asset" href="${a.browser_download_url}">
    ${DL_ICON}
    <span class="nm">${a.label || prettyName(a.name)}</span>
    <span class="spacer"></span>
    <span class="mi tabnum">${fmtSize(a.size)}</span>
  </a>`;
}

function prettyName(name) {
  if (/synth/i.test(name)) return "Synth + FX bundle";
  if (/\.zip$/i.test(name)) return "VST3 bundle (.zip)";
  return name;
}

function renderCard(os, assets) {
  const card = document.querySelector(`.dl-card[data-os="${os}"] .assets`);
  if (!card) return;
  if (!assets.length) {
    card.outerHTML = `<div class="dl-soon">No build for this platform in the latest release yet — <a class="accent" href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">check GitHub</a>.</div>`;
    return;
  }
  card.innerHTML = assets.map(assetRow).join("");
}

function highlightCurrentOS() {
  const os = window.vstaiOS;
  const card = document.querySelector(`.dl-card[data-os="${os}"]`);
  if (!card) return;
  card.classList.add("current");
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "Your system";
  card.prepend(badge);
  // reorder so the user's OS comes first
  card.parentElement.prepend(card);

  if (os === "macos") {
    const gk = document.getElementById("gatekeeperNote");
    if (gk) gk.innerHTML = ` On macOS, if Gatekeeper blocks an unsigned build, right-click the <code>.vst3</code> ▸ Open, or run <code>xattr -dr com.apple.quarantine "VibePlugin FX.vst3"</code>.`;
  }
}

function renderReleaseList(releases) {
  const list = document.getElementById("relList");
  if (!releases.length) {
    list.innerHTML = `<div class="dl-soon">No releases published yet. <a class="accent" href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">Watch the repo</a> to be notified.</div>`;
    return;
  }
  list.innerHTML = releases.slice(0, 8).map((r) => {
    const counts = { macos: 0, windows: 0, linux: 0 };
    (r.assets || []).forEach((a) => { const os = classify(a.name); if (os) counts[os]++; });
    const tags = ["macos", "windows", "linux"]
      .filter((os) => counts[os])
      .map((os) => `<span>${({ macos: "macOS", windows: "Windows", linux: "Linux" })[os]}</span>`)
      .join("");
    return `<div class="rel">
      <span class="ver">${r.tag_name || r.name}</span>
      ${r.prerelease ? '<span class="mi" style="color:var(--warn)">pre-release</span>' : ""}
      <span class="when">${fmtDate(r.published_at)}</span>
      <span class="spacer"></span>
      <div class="tags">
        ${tags}
        <a href="${r.html_url}" target="_blank" rel="noopener">Release notes →</a>
      </div>
    </div>`;
  }).join("");
}

function failGracefully(msg) {
  document.querySelectorAll(".dl-card .assets").forEach((el) => {
    el.outerHTML = `<div class="dl-soon"><a class="accent" href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">Download from GitHub Releases →</a></div>`;
  });
  const list = document.getElementById("relList");
  if (list) list.innerHTML = `<div class="dl-soon">${msg} <a class="accent" href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">Open releases on GitHub →</a></div>`;
  const lv = document.getElementById("latestVer");
  if (lv) lv.textContent = "on GitHub";
}

(async function load() {
  let releases;
  try {
    const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    releases = await res.json();
    if (!Array.isArray(releases)) throw new Error("unexpected response");
  } catch (e) {
    failGracefully("Couldn’t reach the GitHub API (it may be rate-limited).");
    return;
  }

  const published = releases.filter((r) => !r.draft);
  const latest = published[0];

  // header
  const lv = document.getElementById("latestVer");
  const lw = document.getElementById("latestWhen");
  const nv = document.getElementById("navVer");
  if (latest) {
    if (lv) lv.textContent = latest.tag_name || latest.name || "";
    if (lw) lw.textContent = latest.published_at ? " · " + fmtDate(latest.published_at) : "";
    if (nv) nv.textContent = latest.tag_name || "downloads";
  } else {
    if (lv) lv.textContent = "coming soon";
  }

  // sort latest release's assets into platform cards
  const buckets = { macos: [], windows: [], linux: [] };
  if (latest) (latest.assets || []).forEach((a) => { const os = classify(a.name); if (os) buckets[os].push(a); });
  ["macos", "windows", "linux"].forEach((os) => renderCard(os, buckets[os]));

  highlightCurrentOS();
  renderReleaseList(published);
})();
