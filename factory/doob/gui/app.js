(function () {
"use strict";
// =====================================================================
//  Doob panel — a re-creation of the Minimoog Model D's front panel: CONTROLLERS | OSCILLATOR BANK | MIXER |
//  MODIFIERS | OUTPUT on a black faceplate with white lettering, the left-hand controller (spring pitch wheel,
//  mod wheel, glide / decay rockers), the 44-key F…C keyboard and a rear strip (S-trig plug, feedback patch,
//  drift / bleed).  Every control is a "logical parameter" (params.mjs); build.mjs packs them into the host's
//  float slots (mixed radix). This script owns the packing: R[key] = raw integer, V[key] = actual value,
//  slot = Σ R·mult for packed params; direct params are plain floats.
// =====================================================================
var P = DATA.params, BY = {}, FIELDS = {}, UPD = {}, SV = "http://www.w3.org/2000/svg";
var R = {}, V = {}, dragSlot = -1, SCALE = 1;
P.forEach(function (p) { BY[p.key] = p; (FIELDS[p.slot] = FIELDS[p.slot] || []).push(p); UPD[p.key] = []; });
var NSLOT = DATA.slots;

function el(tag, cls, parent, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; }
function sv(tag, attrs, parent) { var e = document.createElementNS(SV, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function host(f) { var a = [].slice.call(arguments, 1); if (window.vstai && typeof window.vstai[f] === "function") window.vstai[f].apply(window.vstai, a); }
function put(e, x, y, w, h) { e.style.left = x + "px"; e.style.top = y + "px"; if (w != null) e.style.width = w + "px"; if (h != null) e.style.height = h + "px"; return e; }
function taper(x) { return (Math.exp(4.39 * x) - 1) / (Math.exp(4.39) - 1); }

// ---------------------------------------------------------------- packing (identical to pack.mjs)
function rawToActual(p, r) { if (p.curve === "int") return p.min + r; var n = p.steps > 1 ? r / (p.steps - 1) : 0; return p.min + n * (p.max - p.min); }
function actualToRaw(p, v) {
  if (p.curve === "int") return clamp(Math.round(v - p.min), 0, p.steps - 1);
  var n = (v - p.min) / (p.max - p.min); return clamp(Math.round(n * (p.steps - 1)), 0, p.steps - 1);
}
function slotValue(s) {
  var f = FIELDS[s], t = 0;
  for (var i = 0; i < f.length; i++) { if (f[i].direct) return V[f[i].key]; t += R[f[i].key] * f[i].mult; }
  return t;
}
function push(s) { host("setParam", s, slotValue(s)); }
function norm(p) { return p.direct ? (V[p.key] - p.min) / (p.max - p.min) : (p.steps > 1 ? R[p.key] / (p.steps - 1) : 0); }
function touch(p) { var u = UPD[p.key]; for (var i = 0; i < u.length; i++) u[i](); }
function setRaw(p, r) { r = clamp(Math.round(r), 0, p.steps - 1); R[p.key] = r; V[p.key] = rawToActual(p, r); }
function setNorm(p, n) {
  n = clamp(n, 0, 1);
  if (p.direct) V[p.key] = p.min + n * (p.max - p.min); else setRaw(p, n * (p.steps - 1));
  touch(p); push(p.slot);
}
function set(key, actual, quiet) {
  var p = BY[key]; if (!p) return;
  if (p.direct) V[key] = clamp(actual, p.min, p.max); else setRaw(p, actualToRaw(p, actual));
  touch(p); if (!quiet) push(p.slot);
}
function decodeSlot(s, value) {
  var f = FIELDS[s]; if (!f) return;
  var k = Math.round(value);
  for (var i = 0; i < f.length; i++) {
    var p = f[i];
    if (p.direct) V[p.key] = clamp(+value, p.min, p.max);
    else { var raw = Math.floor(k / p.mult) % p.steps; R[p.key] = raw; V[p.key] = rawToActual(p, raw); }
    touch(p);
  }
}
P.forEach(function (p) { if (p.direct) V[p.key] = p.def; else { R[p.key] = actualToRaw(p, p.def); V[p.key] = rawToActual(p, R[p.key]); } });
function snapshot() { var o = {}; P.forEach(function (p) { o[p.key] = V[p.key]; }); return o; }
function applySnap(o) {
  P.forEach(function (p) { var v = o[p.key]; if (v === undefined) v = p.def; if (p.direct) V[p.key] = clamp(v, p.min, p.max); else setRaw(p, actualToRaw(p, v)); });
  P.forEach(touch); for (var s = 0; s < NSLOT; s++) push(s);
}
function bindKeys(keys, fn) { keys.forEach(function (k) { UPD[k].push(fn); }); fn(); }

// ---------------------------------------------------------------- value formatting
function fmtSec(t) { return t < 1 ? (t * 1000).toFixed(t < 0.01 ? 1 : 0) + " ms" : t.toFixed(2) + " s"; }
function fmtVal(p) {
  var v = V[p.key], f = p.fmt, n = norm(p);
  if (Array.isArray(f)) return f[Math.round(v - p.min)] || String(v);
  switch (f) {
    case "dial": return (n * 10).toFixed(1);
    case "pct": if (p.key === "MODW") return (taper(n) * 100).toFixed(1) + " % depth (audio taper, " + (n * 10).toFixed(1) + ")"; return Math.round(n * 100) + " %";
    case "tune": return (v > 0.005 ? "+" : "") + (v * 4).toFixed(2) + " st";
    case "bip": return (v > 0.005 ? "+" : "") + v.toFixed(2) + "  (" + (v * V.BEND).toFixed(1) + " st)";
    case "freq": if (p.key === "O3_FREQ" && !V.O3_CTRL) { var oc = v * 3; return (oc > 0.005 ? "+" : "") + oc.toFixed(2) + " oct (free-running)"; } var st = v * 7; return (st > 0.005 ? "+" : "") + st.toFixed(2) + " st";
    case "cut": { var k = -5 + 10 * n, hz = 440 * Math.pow(2, k + 1); return (k > 0.005 ? "+" : "") + k.toFixed(2) + "  (" + (hz < 1000 ? hz.toFixed(hz < 100 ? 1 : 0) + " Hz" : (hz / 1000).toFixed(2) + " kHz") + ")"; }
    case "time": { var mx = (p.key === "FATK" ? 9 : (p.key === "LATK" ? 14 : 30)); return (n * 10).toFixed(1) + "  (" + fmtSec(0.001 + (mx - 0.001) * taper(n)) + ")"; }
    case "glide": return (n * 10).toFixed(1) + "  (τ " + fmtSec(0.00033 + 2.2 * taper(n)) + ")";
    case "mix": { var ro = 25 * (1 - n), rn = 25 * n, a = ro / (24 + ro) * 1.96, b = rn / (24 + rn) * 1.96; return (V.MOD_A ? "contour " : "osc 3 ") + Math.round(a * 100) + " %  ·  " + (V.MOD_B ? "LFO " : "noise ") + Math.round(b * 100) + " %"; }
    case "lfo": { var h = 0.1 * Math.pow(300, n); return h.toFixed(h < 10 ? 2 : 1) + " Hz"; }
    case "st": return Math.round(v) + " st";
    default: return String(Math.round(v * 1000) / 1000);
  }
}

// ---------------------------------------------------------------- stage geometry
var plate = document.getElementById("plate"), stage = document.getElementById("stage");
var DECK = 496;
var hdr = el("div", "", plate); hdr.id = "hdr";
var panel = el("div", "", plate); panel.id = "panel"; put(panel, 0, 52);
var deck = el("div", "", plate); deck.id = "deck"; put(deck, 0, DECK);

function section(x0, y0, x1, y1, title) { var s = el("div", "sec", plate); put(s, x0, y0, x1 - x0, y1 - y0); var t = el("div", "st", s); el("span", "", t, title); return s; }
function label(x, y, txt, cls, parent) { var l = el("div", "lab" + (cls ? " " + cls : ""), parent || plate); l.style.whiteSpace = "pre"; l.textContent = txt; l.style.left = x + "px"; l.style.top = y + "px"; return l; }

// ---------------------------------------------------------------- tooltip
var tip = document.getElementById("tip");
function showTip(e, p) { tip.hidden = false; tip.textContent = p.name + ": " + fmtVal(p); tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
function hideTip() { tip.hidden = true; }

// ---------------------------------------------------------------- knobs
var INK = "#efece1";
// opts: nums = "dial" (0-10) | "cut" (-5 … +5) | [left, centre, right]; bipolar centre detent; label / ly
function knob(key, cx, cy, r, opts) {
  opts = opts || {};
  var p = BY[key], pad = 22, size = 2 * (r + pad);
  var w = el("div", "kn", plate); put(w, cx - r - pad, cy - r - pad, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size }, w), c = r + pad;
  for (var i = 0; i < 11; i++) {
    var a = (-150 + i * 30) * Math.PI / 180, big = i % 5 === 0, r0 = r + 3, r1 = r + (big ? 10 : 7);
    sv("line", { x1: c + r0 * Math.sin(a), y1: c - r0 * Math.cos(a), x2: c + r1 * Math.sin(a), y2: c - r1 * Math.cos(a), stroke: INK, "stroke-width": big ? 2 : 1.3 }, svg);
    var txt = null;
    if (opts.nums === "dial") txt = (r >= 24 || big) ? String(i) : null;
    else if (opts.nums === "cut") txt = (i - 5 > 0 ? "+" : "") + (i - 5);
    else if (Array.isArray(opts.nums) && (i === 0 || i === 5 || i === 10)) txt = opts.nums[i / 5];
    if (txt !== null) {
      var rr = r + 17, t = sv("text", { x: c + rr * Math.sin(a), y: c - rr * Math.cos(a) + 3, "text-anchor": "middle", "font-size": 8, "font-weight": 700, fill: INK }, svg); t.textContent = txt;
    }
  }
  sv("circle", { cx: c, cy: c, r: r + 1, fill: "#050506" }, svg);
  sv("circle", { cx: c, cy: c, r: r - 1.5, fill: "url(#dbKnob)", class: "rim", stroke: "#cfccc0", "stroke-width": 1.6 }, svg);
  sv("circle", { cx: c, cy: c, r: r * 0.62, fill: "url(#dbCap)", stroke: "#000", "stroke-width": 1 }, svg);
  var ptr = sv("line", { x1: c, y1: c - r * 0.12, x2: c, y2: c - r + 3, class: "ptr" }, svg);
  function draw() { ptr.setAttribute("transform", "rotate(" + (-150 + 300 * norm(p)) + " " + c + " " + c + ")"); }
  bindKeys([key], draw);
  var drag = null;
  w.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { w.setPointerCapture(e.pointerId); } catch (x) {}
    drag = { y: e.clientY, n: norm(p) }; dragSlot = p.slot; w.classList.add("act"); showTip(e, p);
  });
  w.addEventListener("pointermove", function (e) {
    if (!drag) { showTip(e, p); return; }
    var n = clamp(drag.n + (drag.y - e.clientY) / SCALE / (e.shiftKey ? 700 : 170), 0, 1);
    if (opts.detent && Math.abs(n - 0.5) < 0.012) n = 0.5;
    setNorm(p, n); showTip(e, p);
  });
  function end() { drag = null; dragSlot = -1; w.classList.remove("act"); }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
  w.addEventListener("pointerleave", function () { if (!drag) hideTip(); });
  w.addEventListener("dblclick", function () { set(key, p.def); hideTip(); });
  w.addEventListener("wheel", function (e) { e.preventDefault(); setNorm(p, norm(p) - e.deltaY / (e.shiftKey ? 8000 : 1800)); showTip(e, p); }, { passive: false });
  if (opts.label) label(cx, cy + r + (opts.ly != null ? opts.ly : 17), opts.label, opts.lcls || "big");
  return w;
}

// ---------------------------------------------------------------- waveform icons
var ICON = {
  tri: "M1,9 L4,2 L7,9 L10,2 L13,9", shark: "M1,9 L6,2 L8,9 L13,2 L15,9", saw: "M1,9 L6,2 L6,9 L12,2 L12,9", sqr: "M1,9 L1,3 L4,3 L4,9 L7,9 L7,3 L10,3 L10,9 L13,9",
  wide: "M1,9 L1,3 L4,3 L4,9 L9,9 L9,3 L12,3 L12,9", nar: "M1,9 L1,3 L2.8,3 L2.8,9 L8,9 L8,3 L9.8,3 L9.8,9 L13,9", rev: "M1,2 L1,9 L6,2 L6,9 L12,2 L12,9"
};
function icon(parent, kind, x, y) {
  var g = sv("g", { transform: "translate(" + x + " " + y + ") scale(1.3) translate(-7,-5.5)" }, parent);
  sv("path", { d: ICON[kind], fill: "none", stroke: INK, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
  return g;
}
// 6-position rotary selector (range / waveform): positions on a 250° arc, labels or icons around it
function rotary6(key, cx, cy, r, items) {
  var p = BY[key], n = items.length, pad = 36, size = 2 * (r + pad), c = r + pad;
  var w = el("div", "ro", plate); put(w, cx - r - pad, cy - r - pad, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size }, w);
  var STEP = 50, A0 = -125, lab = [];
  items.forEach(function (it, i) {
    var a = (A0 + STEP * i) * Math.PI / 180, rr = r + 19;
    var x = c + rr * Math.sin(a), y = c - rr * Math.cos(a);
    var g = sv("g", {}, svg); lab.push(g);
    sv("line", { x1: c + (r + 3) * Math.sin(a), y1: c - (r + 3) * Math.cos(a), x2: c + (r + 8) * Math.sin(a), y2: c - (r + 8) * Math.cos(a), stroke: INK, "stroke-width": 1.4 }, g);
    if (it.t) { var t = sv("text", { x: x, y: y + 3, "text-anchor": "middle", "font-size": 10, "font-weight": 800, fill: INK }, g); t.textContent = it.t; }
    else icon(g, it.i, x, y);
    var hit = sv("circle", { cx: x, cy: y, r: 11, fill: "transparent", style: "cursor:pointer" }, g);
    hit.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); set(key, p.min + i); });
  });
  sv("circle", { cx: c, cy: c, r: r + 1, fill: "#050506" }, svg);
  sv("circle", { cx: c, cy: c, r: r - 1.5, fill: "url(#dbKnob)", stroke: "#cfccc0", "stroke-width": 1.6, class: "rim" }, svg);
  sv("circle", { cx: c, cy: c, r: r * 0.55, fill: "url(#dbCap)", stroke: "#000", "stroke-width": 1 }, svg);
  var ptr = sv("line", { x1: c, y1: c - r * 0.15, x2: c, y2: c - r + 3, stroke: "#fff", "stroke-width": 3, "stroke-linecap": "round" }, svg);
  function draw() {
    var i = clamp(Math.round(V[key] - p.min), 0, n - 1);
    ptr.setAttribute("transform", "rotate(" + (A0 + STEP * i) + " " + c + " " + c + ")");
    lab.forEach(function (g, k) { g.setAttribute("opacity", k === i ? 1 : 0.55); g.setAttribute("filter", k === i ? "" : ""); });
  }
  bindKeys([key], draw);
  var drag = null;
  w.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { w.setPointerCapture(e.pointerId); } catch (x) {}
    var r2 = w.getBoundingClientRect(), x0 = (e.clientX - r2.left) / SCALE - size / 2;
    drag = { x: e.clientX, i: Math.round(V[key] - p.min), moved: false, side: x0 >= 0 ? 1 : -1 };
  });
  w.addEventListener("pointermove", function (e) {
    if (!drag) { showTip(e, p); return; }
    var d = Math.round((e.clientX - drag.x) / SCALE / 22);
    if (d !== 0 || drag.moved) { drag.moved = true; set(key, p.min + clamp(drag.i + d, 0, n - 1)); showTip(e, p); }
  });
  function end() { if (drag && !drag.moved) set(key, p.min + clamp(drag.i + drag.side, 0, n - 1)); drag = null; }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", function () { drag = null; });
  w.addEventListener("wheel", function (e) { e.preventDefault(); set(key, p.min + clamp(Math.round(V[key] - p.min) + (e.deltaY < 0 ? 1 : -1), 0, n - 1)); }, { passive: false });
  w.addEventListener("pointerleave", hideTip);
  return w;
}
var RANGE_ITEMS = [{ t: "LO" }, { t: "32'" }, { t: "16'" }, { t: "8'" }, { t: "4'" }, { t: "2'" }];
var WAVE12 = [{ i: "tri" }, { i: "shark" }, { i: "saw" }, { i: "sqr" }, { i: "wide" }, { i: "nar" }];
var WAVE3 = [{ i: "tri" }, { i: "rev" }, { i: "saw" }, { i: "sqr" }, { i: "wide" }, { i: "nar" }];

// ---------------------------------------------------------------- rocker switch (ON up / OFF down)
function rocker(key, cx, cy, opts) {
  opts = opts || {};
  var p = BY[key], size = 34, w = el("div", "rk", plate); put(w, cx - size / 2, cy - size / 2, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "-17 -17 34 34" }, w);
  var hex = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; hex.push((14 * Math.cos(a)) + "," + (14 * Math.sin(a))); }
  sv("polygon", { points: hex.join(" "), fill: "url(#dbNut)", stroke: "#111", "stroke-width": 1.4 }, svg);
  sv("circle", { cx: 0, cy: 0, r: 8.5, fill: "#111" }, svg);
  var lever = sv("g", {}, svg);
  sv("rect", { x: -3.4, y: -17, width: 6.8, height: 17, rx: 3, fill: "url(#dbLever)", stroke: "#000", "stroke-width": 1 }, lever);
  sv("circle", { cx: 0, cy: -16, r: 4.2, fill: "url(#dbLever)", stroke: "#000", "stroke-width": 1 }, lever);
  var caps = opts.caps || ["ON", "OFF"], up = label(cx, cy - size / 2 - 11, caps[0], "sm"), dn = label(cx, cy + size / 2 + 1, caps[1], "sm");
  if (opts.title) label(cx, cy + size / 2 + 13, opts.title, opts.tcls || "big");
  function draw() { var on = V[key] === p.max; lever.setAttribute("transform", "rotate(" + (on ? 0 : 180) + ")"); up.className = "lab sm" + (on ? " sel" : ""); dn.className = "lab sm" + (on ? "" : " sel"); }
  bindKeys([key], draw);
  w.addEventListener("pointerdown", function (e) { e.preventDefault(); set(key, V[key] === p.max ? p.min : p.max); showTip(e, p); });
  w.addEventListener("pointermove", function (e) { showTip(e, p); }); w.addEventListener("pointerleave", hideTip);
  return w;
}
function led(x, y, cls) { var l = el("div", "led" + (cls ? " " + cls : ""), plate); put(l, x, y); return l; }

// =====================================================================
//  PANEL SECTIONS
// =====================================================================
// ---- CONTROLLERS
section(12, 66, 206, 484, "CONTROLLERS");
knob("TUNE", 66, 148, 27, { nums: ["-", "0", "+"], detent: true, label: "TUNE" });
knob("GLIDE", 66, 270, 27, { nums: "dial", label: "GLIDE" });
knob("MODMIX", 66, 384, 27, { nums: "dial", label: "MODULATION MIX", ly: 28 });
label(66, 384 + 27 + 40, "◀ OSC 3        NOISE ▶", "sm");
rocker("O3_CTRL", 156, 148, { title: "OSCILLATOR 3\nCONTROL", tcls: "sm" });
rocker("OSC_MOD", 156, 332, { title: "OSCILLATOR\nMODULATION", tcls: "sm" });
rocker("FIL_MOD", 156, 420, { title: "FILTER\nMODULATION", tcls: "sm" });

// ---- OSCILLATOR BANK
section(214, 66, 626, 484, "OSCILLATOR BANK");
label(306, 86, "RANGE", "hd"); label(432, 86, "FREQUENCY", "hd"); label(554, 86, "WAVEFORM", "hd");
var ROWY = [172, 296, 420];
for (var oi = 0; oi < 3; oi++) {
  var oy = ROWY[oi], on = String(oi + 1);
  label(240, oy - 10, "OSC\n" + on, "big");
  rotary6("O" + on + "_RANGE", 306, oy, 22, RANGE_ITEMS);
  if (oi === 0) { label(432, oy - 6, "NO FREQUENCY\nCONTROL", "sm"); }
  else knob("O" + on + "_FREQ", 432, oy, 25, { nums: ["-", "0", "+"], detent: true });
  rotary6("O" + on + "_WAVE", 554, oy, 22, oi === 2 ? WAVE3 : WAVE12);
}

// ---- MIXER
section(634, 66, 878, 484, "MIXER");
var MIX = [["SW_O1", "VOL1", "OSCILLATOR 1"], ["SW_EXT", "VOLEXT", "EXTERNAL\nINPUT"], ["SW_O2", "VOL2", "OSCILLATOR 2"], ["SW_NZ", "VOLNZ", "NOISE"], ["SW_O3", "VOL3", "OSCILLATOR 3"]];
var MIXY = [134, 214, 294, 374, 454];
MIX.forEach(function (m, i) {
  rocker(m[0], 672, MIXY[i], {});
  knob(m[1], 744, MIXY[i], 22, { nums: "dial" });
  label(i === 1 || i === 3 ? 806 : 820, MIXY[i] - (m[2].indexOf("\n") >= 0 ? 12 : 5), m[2], "big");
});
var lampOver = led(846, MIXY[1], ""); label(846, MIXY[1] + 12, "OVERLOAD", "sm");
rocker("NZ_COLOR", 846, MIXY[3], { caps: ["PINK", "WHITE"] });

// ---- MODIFIERS
section(886, 66, 1380, 484, "MODIFIERS");
label(1000, 84, "FILTER", "hd");
rocker("KB1", 934, 152, { title: "KEYBOARD\nCONTROL 1", tcls: "sm" });
rocker("KB2", 996, 152, { title: "KEYBOARD\nCONTROL 2", tcls: "sm" });
knob("CUTOFF", 1106, 152, 33, { nums: "cut", label: "CUTOFF FREQUENCY", ly: 21 });
knob("EMPH", 1216, 152, 26, { nums: "dial", label: "EMPHASIS", ly: 21 });
knob("CONTOUR", 1322, 152, 26, { nums: "dial", label: "AMOUNT OF\nCONTOUR", ly: 18 });
var hl1 = el("div", "", plate); hl1.style.cssText = "position:absolute;left:896px;top:266px;width:474px;height:1px;background:rgba(233,229,216,.35)";
var hl2 = el("div", "", plate); hl2.style.cssText = "position:absolute;left:896px;top:372px;width:474px;height:1px;background:rgba(233,229,216,.35)";
label(940, 296, "FILTER\nCONTOUR", "hd"); label(940, 402, "LOUDNESS\nCONTOUR", "hd");
knob("FATK", 1060, 304, 24, { nums: "dial", label: "ATTACK TIME", ly: 20 }); knob("FDEC", 1170, 304, 24, { nums: "dial", label: "DECAY TIME", ly: 20 }); knob("FSUS", 1280, 304, 24, { nums: "dial", label: "SUSTAIN LEVEL", ly: 20 });
knob("LATK", 1060, 414, 24, { nums: "dial", label: "ATTACK TIME", ly: 20 }); knob("LDEC", 1170, 414, 24, { nums: "dial", label: "DECAY TIME", ly: 20 }); knob("LSUS", 1280, 414, 24, { nums: "dial", label: "SUSTAIN LEVEL", ly: 20 });

// ---- OUTPUT
section(1388, 66, 1490, 484, "OUTPUT");
knob("OUTVOL", 1439, 150, 30, { nums: "dial", label: "VOLUME", ly: 20 });
rocker("MAIN_ON", 1439, 262, { title: "MAIN\nOUTPUT", tcls: "sm" });
rocker("A440", 1439, 348, { title: "A-440", tcls: "sm" });
var ledGate = led(1416, 438, "g"); label(1416, 449, "GATE", "sm");
var mtr = el("div", "mtr", plate); put(mtr, 1458, 405, 10, 52); var mtrFill = el("i", "", mtr); label(1463, 459, "OUT", "sm");
label(1439, 480 - 8, "", "sm");

// =====================================================================
//  HEADER: brand, sound browser, status
// =====================================================================
var brand = el("div", "brand", hdr, "DOOB"); el("small", "", brand, "MODEL D · MONOPHONIC ANALOG SYNTHESIZER · RECREATION");
var sheetBox = el("div", "", hdr); sheetBox.id = "sheet";
var prevB = el("button", "hbtn", sheetBox, "◀"), sel = el("select", "", sheetBox), nextB = el("button", "hbtn", sheetBox, "▶"), initB = el("button", "hbtn", sheetBox, "INIT"), glB = el("button", "hbtn", sheetBox, "SETTINGS…");
var curIdx = 0, noteEl = el("div", "", hdr); noteEl.id = "note";
var cats = []; DATA.presets.forEach(function (p) { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
cats.forEach(function (c) { var g = el("optgroup", "", sel); g.label = c; DATA.presets.forEach(function (p, i) { if (p.cat === c) { var o = el("option", "", g, p.name); o.value = i; } }); });
function loadIndex(i) {
  i = (i + DATA.presets.length) % DATA.presets.length; curIdx = i; sel.value = i;
  var pr = DATA.presets[i]; applySnap(pr.set); noteEl.textContent = pr.note || ""; noteEl.title = pr.note || "";
}
sel.addEventListener("change", function () { loadIndex(+sel.value); });
prevB.addEventListener("click", function () { loadIndex(curIdx - 1); }); nextB.addEventListener("click", function () { loadIndex(curIdx + 1); });
initB.addEventListener("click", function () { loadIndex(0); });
var statusEl = el("div", "", hdr); statusEl.id = "status"; statusEl.textContent = "ready";

// =====================================================================
//  LEFT-HAND CONTROLLER
// =====================================================================
var lhc = el("div", "lhc", plate); put(lhc, 12, DECK + 8, 250, 384); el("div", "st", lhc, "LEFT-HAND CONTROLLER");
function wheel(key, x, y, w, h, spring, text) {
  var d = el("div", "whl", plate); put(d, x, y, w, h); var ind = el("i", "", d), p = BY[key], dragging = false;
  label(x + w / 2, y + h + 12, text, "big");
  function draw() { ind.style.top = ((1 - norm(p)) * h) + "px"; }
  bindKeys([key], draw);
  function mv(e) { var r = d.getBoundingClientRect(); setNorm(p, 1 - clamp((e.clientY - r.top) / r.height, 0, 1)); }
  d.addEventListener("pointerdown", function (e) { e.preventDefault(); dragging = true; dragSlot = p.slot; try { d.setPointerCapture(e.pointerId); } catch (x2) {} mv(e); showTip(e, p); });
  d.addEventListener("pointermove", function (e) { if (dragging) { mv(e); showTip(e, p); } });
  function end() { if (!dragging) return; dragging = false; dragSlot = -1; hideTip(); if (spring) { var n = norm(p), t0 = performance.now(); (function back() { var k = clamp((performance.now() - t0) / 120, 0, 1); setNorm(p, n + (0.5 - n) * k); if (k < 1) requestAnimationFrame(back); })(); } }
  d.addEventListener("pointerup", end); d.addEventListener("pointercancel", end);
  d.addEventListener("dblclick", function () { set(key, p.def); });
}
wheel("PITCHW", 46, DECK + 72, 46, 196, true, "PITCH"); wheel("MODW", 124, DECK + 72, 46, 196, false, "MOD");
rocker("GLIDE_ON", 220, DECK + 130, { title: "GLIDE", tcls: "sm" });
rocker("DECAY_ON", 220, DECK + 240, { title: "DECAY", tcls: "sm" });

// =====================================================================
//  REAR STRIP
// =====================================================================
var rear = el("div", "rear", plate); put(rear, 1364, DECK + 8, 124, 384); el("div", "st", rear, "REAR / REISSUE");
function ry(y) { return DECK + y; }
knob("DRIFT", 1426, ry(92), 21, { nums: "dial", label: "DRIFT", ly: 22 });
knob("BLEED", 1426, ry(172), 21, { nums: "dial", label: "BLEED", ly: 22 });
rocker("STRIG", 1426, ry(256), { title: "S-TRIG PLUG", tcls: "sm" });
rocker("FEEDBACK", 1426, ry(330), { title: "OUT → EXT IN", tcls: "sm" });

// =====================================================================
//  KEYBOARD (44 keys, F … C = MIDI 41…84) + computer keyboard
// =====================================================================
var kbd = el("div", "kbd", plate); put(kbd, 276, DECK + 12, 1076, 380);
var KEYNODES = {}, heldPtr = {};
(function () {
  var first = 41, last = 84, W = 1076, whites = [], blacks = [];
  for (var n = first; n <= last; n++) { var pc = n % 12; if ([1, 3, 6, 8, 10].indexOf(pc) < 0) whites.push(n); else blacks.push(n); }
  var kw = W / whites.length;
  function bind(node, note) {
    node.addEventListener("pointerdown", function (e) {
      e.preventDefault(); try { node.setPointerCapture(e.pointerId); } catch (x) {}
      var r = node.getBoundingClientRect(), v = clamp(0.35 + 0.65 * (e.clientY - r.top) / r.height, 0.2, 1);
      heldPtr[e.pointerId] = note; keyOn(note, v);
    });
    function up(e) { if (heldPtr[e.pointerId] === note) { delete heldPtr[e.pointerId]; keyOff(note); } }
    node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up);
    KEYNODES[note] = node;
  }
  whites.forEach(function (n, i) { var k = el("div", "wk", kbd); put(k, i * kw, 0, kw, 376); if (n % 12 === 0) el("div", "nm", k, "C" + (Math.floor(n / 12) - 1)); else if (n === 41) el("div", "nm", k, "F"); bind(k, n); });
  blacks.forEach(function (n) { var wi = whites.indexOf(n - 1); var k = el("div", "bk", kbd); put(k, (wi + 1) * kw - kw * 0.3, 0, kw * 0.6, 232); bind(k, n); });
})();
var onNotes = {};
function keyOn(note, vel) { onNotes[note] = 1; if (KEYNODES[note]) KEYNODES[note].classList.add("hit"); host("noteOn", note, vel); }
function keyOff(note) { delete onNotes[note]; if (KEYNODES[note]) KEYNODES[note].classList.remove("hit"); host("noteOff", note); }
var CK = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 }, ckOct = 60, ckDown = {};
window.addEventListener("keydown", function (e) {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key.toLowerCase();
  if (k === "z") { ckOct = Math.max(36, ckOct - 12); return; } if (k === "x") { ckOct = Math.min(72, ckOct + 12); return; }
  if (CK[k] === undefined || e.repeat || ckDown[k] !== undefined) return;
  var n = ckOct + CK[k]; ckDown[k] = n; keyOn(n, 0.78);
});
window.addEventListener("keyup", function (e) { var k = e.key.toLowerCase(); if (ckDown[k] !== undefined) { var n = ckDown[k]; delete ckDown[k]; keyOff(n); } });

// =====================================================================
//  SETTINGS dialog (reissue options + MIDI chart)
// =====================================================================
var glob = document.getElementById("glob"), globBuilt = false;
function buildGlobal() {
  globBuilt = true;
  var x = el("button", "hbtn x", glob, "Close"); x.onclick = function () { glob.hidden = true; };
  el("h3", "", glob, "SETTINGS");
  el("div", "", glob, "The original has none of these: they are the options of the 2016 / 2022 reissues and of this plug-in. They are saved with the project.").style.cssText = "font-size:10.5px;color:#a89a7e;margin-bottom:4px";
  var g = el("div", "grid", glob);
  function row(key, text, tip) {
    var p = BY[key]; el("div", "", g, text);
    var c = el("div", "", g), s;
    if (p.fmt && Array.isArray(p.fmt) && p.steps <= 16) { s = el("select", "", c); p.fmt.forEach(function (nm, i) { var o = el("option", "", s, nm); o.value = i; }); s.addEventListener("change", function () { set(key, p.min + (+s.value)); }); bindKeys([key], function () { s.value = Math.round(V[key] - p.min); }); }
    else { s = el("input", "", c); s.type = "range"; s.min = p.min; s.max = p.max; s.step = p.direct ? 0.01 : 1; var lab = el("span", "", c, ""); lab.style.marginLeft = "8px"; s.addEventListener("input", function () { set(key, +s.value); lab.textContent = fmtVal(p); }); bindKeys([key], function () { s.value = V[key]; lab.textContent = fmtVal(p); }); }
    if (tip) el("div", "tp", g, tip);
  }
  row("KEY_PRI", "Key priority", p("KEY_PRI"));
  row("TRIG_MODE", "Triggering", p("TRIG_MODE"));
  row("BEND", "Pitch-bend range", p("BEND"));
  row("SCALE", "Scale", p("SCALE"));
  row("KEY_ERR", "Vintage keyboard error", p("KEY_ERR"));
  row("MOD_A", "Modulation source A", p("MOD_A"));
  row("MOD_B", "Modulation source B", p("MOD_B"));
  row("LFO_RATE", "LFO rate", p("LFO_RATE"));
  row("LFO_WAVE", "LFO waveform", "");
  row("LOCAL", "Local", p("LOCAL"));
  function p(k) { return BY[k].tip; }
  el("h3", "", glob, "MIDI IMPLEMENTATION");
  var t = el("table", "", glob), rows = [["CC1 (+ CC33)", "Mod wheel (14-bit with the LSB)"], ["Pitch bend", "Pitch wheel (range = BEND / RPN 0)"], ["RPN 0 (CC101/100/6)", "Pitch-bend range in semitones"], ["CC64", "Sustain pedal (host)"], ["CC120 / CC123", "All sound off / all notes off"], ["CC122", "Local control on/off"], ["Notes F1 … C5 (41 … 84)", "The 44 keys; notes outside extend the 1 V/oct scale"]];
  rows.forEach(function (r) { var tr = el("tr", "", t); el("td", "", tr, r[0]); el("td", "", tr, r[1]); });
}
glB.addEventListener("click", function () { if (!globBuilt) buildGlobal(); glob.hidden = !glob.hidden; });

// =====================================================================
//  engine display → lamp, gate LED, meter, status line
// =====================================================================
var lastGate = 0;
function db(x) { return x > 1e-5 ? 20 * Math.log10(x) : -100; }
if (window.vstai && window.vstai.onDisplay) window.vstai.onDisplay(function (d) {
  lampOver.classList.toggle("on", d[0] > 0.5); ledGate.classList.toggle("on", d[1] > 0.5);
  mtrFill.style.height = clamp((db(d[5]) + 48) / 48, 0, 1) * 100 + "%";
  statusEl.textContent = (d[1] > 0.5 ? "● gate " : "○ gate ") + " · out " + (d[5] > 1e-5 ? db(d[5]).toFixed(1) + " dB" : "−∞") + (d[0] > 0.5 ? " · OVERLOAD" : "");
});

// =====================================================================
//  scaling, host restore, test hooks
// =====================================================================
function layout() {
  var s = Math.min(window.innerWidth / 1560, window.innerHeight / 900);
  SCALE = s > 0 ? s : 1;
  stage.style.transform = "scale(" + SCALE + ")";
  stage.style.left = Math.max(0, (window.innerWidth - 1560 * SCALE) / 2) + "px";
  stage.style.top = Math.max(0, (window.innerHeight - 900 * SCALE) / 2) + "px";
}
window.addEventListener("resize", layout); layout();
document.addEventListener("pointerup", hideTip);
// host → panel: automation / session restore (and replay of the restored sound at boot)
if (window.vstai && window.vstai.onParam) window.vstai.onParam(function (i, v) { if (i === dragSlot) return; if (FIELDS[i]) decodeSlot(i, +v); });
noteEl.textContent = DATA.presets[0].note || ""; noteEl.title = noteEl.textContent;
window.__doob = { V: V, R: R, NSLOT: NSLOT, slotValue: slotValue, applyPatch: function (o) { applySnap(o || {}); }, loadIndex: loadIndex, snapshot: snapshot, DATA: DATA, set: set, keyOn: keyOn, keyOff: keyOff, unbound: function () { return P.filter(function (p) { return UPD[p.key].length === 0; }).map(function (p) { return p.key; }); } };
})();
