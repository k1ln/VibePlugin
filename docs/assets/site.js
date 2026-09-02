/* =====================================================================
   VibePlugin site — shared behaviour
   - animated hero waveform (cheap rAF, pauses when tab hidden)
   - scroll-reveal for .reveal elements
   - OS detection used to label the download buttons
   ===================================================================== */

/* ---- OS detection (shared with releases.js via window.vstaiOS) ------ */
function detectOS() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const plat = ((navigator.userAgentData && navigator.userAgentData.platform) ||
                navigator.platform || "").toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(plat) || /mac os x|macintosh/.test(ua)) return "macos";
  if (/win/.test(plat) || /windows/.test(ua)) return "windows";
  if (/linux|x11/.test(plat) || /linux/.test(ua)) return "linux";
  return "unknown";
}
window.vstaiOS = detectOS();

(function labelDownloads() {
  const label = { macos: "Download for macOS", windows: "Download for Windows", linux: "Download for Linux" }[window.vstaiOS];
  if (!label) return;
  const hero = document.getElementById("heroDownload");
  if (hero) hero.lastChild.textContent = " " + label;
})();

/* ---- latest release, shared by every page ----------------------------
   The brand pill used to be hard-coded ("v0.2") and went stale the moment a
   release shipped. It's now filled from the GitHub Releases API instead.

   One fetch per page load, exposed as window.vstaiReleases so releases.js
   (which needs the whole list, not just the tag) reuses it rather than
   asking twice, and memoised in sessionStorage so clicking around the site
   doesn't burn the 60-per-hour unauthenticated GitHub rate limit.

   The pill starts hidden and is only revealed once a real tag arrives — a
   missing pill is harmless, a wrong version number is not. */
const VP_REPO  = "k1ln/VibePlugin";
const VP_CACHE = "vstai:releases";
const VP_TTL   = 30 * 60 * 1000;

window.vstaiReleases = (async function fetchReleases() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(VP_CACHE) || "null");
    if (hit && Date.now() - hit.at < VP_TTL) return hit.data;
  } catch (e) { /* private mode, or junk in the slot — just refetch */ }

  const res = await fetch(`https://api.github.com/repos/${VP_REPO}/releases`,
                          { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("unexpected response");
  try { sessionStorage.setItem(VP_CACHE, JSON.stringify({ at: Date.now(), data })); }
  catch (e) { /* over quota — the in-page promise still shares it */ }
  return data;
})();
// Consumers below attach their own handling; this keeps a page that has no
// consumer (or a rate-limited API) from logging an unhandled rejection.
window.vstaiReleases.catch(() => {});

/* Prereleases are single-platform test builds — same exclusion releases.js
   makes, so the pill and the downloads page never disagree. */
window.vstaiLatest = (rels) => rels.filter((r) => !r.draft && !r.prerelease)[0];

(function navVersion() {
  const pills = document.querySelectorAll("[data-navver]");
  if (!pills.length) return;
  window.vstaiReleases.then((rels) => {
    const latest = window.vstaiLatest(rels);
    if (!latest || !latest.tag_name) return;
    pills.forEach((p) => { p.textContent = latest.tag_name; p.hidden = false; });
  }).catch(() => { /* leave the pill hidden */ });
})();

/* ---- scroll reveal --------------------------------------------------- */
(function reveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || !els.length) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
})();

/* ---- hero synth: play it with the computer keyboard ------------------
   The synth runs in a sandboxed iframe, so its own key listener only fires
   when the iframe has focus. Forward the play keys (A–K) and octave shift
   (Z/X) from this page down to it, so you can just start typing.  The player
   already accepts {__vstai:1, type:'keydown'|'keyup', key} via postMessage. */
(function heroKeys() {
  const f = document.getElementById("heroSynth");
  if (!f) return;
  const PLAY = "awsedftgyhujkzx";                 // note keys + Z/X octave
  const forward = (type) => (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = (e.key || "").toLowerCase();
    if (PLAY.indexOf(k) < 0) return;
    const t = e.target;
    if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;  // don't steal typing
    f.contentWindow.postMessage({ __vstai: 1, type, key: e.key, repeat: e.repeat }, "*");
  };
  window.addEventListener("keydown", forward("keydown"));
  window.addEventListener("keyup", forward("keyup"));
})();

/* ---- hero waveform --------------------------------------------------- */
(function waveform() {
  const canvas = document.getElementById("wave");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  window.addEventListener("resize", fit);

  let t = 0;
  function frame() {
    if (document.hidden) { return; }     // paused; resumed by visibilitychange
    const w = canvas.clientWidth, h = canvas.clientHeight, mid = h / 2;
    ctx.clearRect(0, 0, w, h);

    // soft grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

    // two layered waves: blue (front) + violet (back), evolving over time
    const waves = [
      { color: "rgba(157,123,255,0.55)", amp: h * 0.26, f1: 1.6, f2: 3.1, sp: 0.020, lw: 2 },
      { color: "rgba(79,141,255,0.95)",  amp: h * 0.34, f1: 2.2, f2: 4.7, sp: 0.028, lw: 2.4 },
    ];
    for (const wv of waves) {
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const p = x / w;
        const env = Math.sin(p * Math.PI);                       // fade at edges
        const y = mid + env * wv.amp * (
          0.6 * Math.sin(p * Math.PI * wv.f1 + t * wv.sp * 6) +
          0.4 * Math.sin(p * Math.PI * wv.f2 - t * wv.sp * 9)
        );
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = wv.lw;
      ctx.shadowColor = wv.color;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    t += reduce ? 0 : 1;
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !reduce) requestAnimationFrame(frame); });
})();
