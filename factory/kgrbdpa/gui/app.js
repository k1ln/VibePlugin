(function () {
"use strict";
// =====================================================================
//  KGrbdPa panel — a re-creation of the Grandmother's front panel (layout traced from the manual's
//  patch-sheet drawing), left-hand controller, 32-key keyboard and rear panel, with a LIVE patch bay:
//  drag a cable from any output jack to any input jack (or the other way round).
//  Every control is a "logical parameter" (params.mjs); build.mjs packs them into the host's float
//  slots (mixed radix). This script owns the packing: R[key] = raw integer, V[key] = actual value,
//  slot = Σ R·mult for packed params; direct params are plain floats.
// =====================================================================
var P = DATA.params, BY = {}, FIELDS = {}, UPD = {}, SV = "http://www.w3.org/2000/svg";
var R = {}, V = {}, dragSlot = -1, SCALE = 1;
P.forEach(function (p) { BY[p.key] = p; (FIELDS[p.slot] = FIELDS[p.slot] || []).push(p); UPD[p.key] = []; });
var NSLOT = DATA.slots;
var SRC = DATA.src, DST = DATA.dst;

function el(tag, cls, parent, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; }
function sv(tag, attrs, parent) { var e = document.createElementNS(SV, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function host(f) { var a = [].slice.call(arguments, 1); if (window.vstai && typeof window.vstai[f] === "function") window.vstai[f].apply(window.vstai, a); }
function put(e, x, y, w, h) { e.style.left = x + "px"; e.style.top = y + "px"; if (w != null) e.style.width = w + "px"; if (h != null) e.style.height = h + "px"; return e; }

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
  P.forEach(touch); for (var s = 0; s < NSLOT; s++) push(s); drawCables();
}
function bindKeys(keys, fn) { keys.forEach(function (k) { UPD[k].push(fn); }); fn(); }

// ---------------------------------------------------------------- value formatting
function fmtVal(p) {
  var v = V[p.key], f = p.fmt, n = norm(p);
  if (Array.isArray(f)) return f[Math.round(v - p.min)] || String(v);
  switch (f) {
    case "pct": return Math.round(n * 100) + " %";
    case "bip": return (v > 0.005 ? "+" : "") + v.toFixed(2);
    case "cut": { var hz = 20 * Math.pow(1000, n); return hz < 1000 ? hz.toFixed(hz < 100 ? 1 : 0) + " Hz" : (hz / 1000).toFixed(2) + " kHz"; }
    case "lfo": { var h = 0.07 * Math.pow(2, 14.18 * n); return h < 10 ? h.toFixed(2) + " Hz" : h < 1000 ? h.toFixed(1) + " Hz" : (h / 1000).toFixed(2) + " kHz"; }
    case "hz": { var h2 = 10 * Math.pow(2, 10 * n); return h2 < 1000 ? h2.toFixed(0) + " Hz" : (h2 / 1000).toFixed(2) + " kHz"; }
    case "time": { var lo = p.key === "ATK" ? 0.0008 : 0.002, hi = p.key === "ATK" ? 10000 : 6000; var t = lo * Math.pow(hi, n); return t < 1 ? (t * 1000).toFixed(t < 0.01 ? 1 : 0) + " ms" : t.toFixed(2) + " s"; }
    case "glide": return n < 0.01 ? "off" : (0.01 * Math.pow(600, (n - 0.01) * 1.0101)).toFixed(2) + " s";
    case "o2freq": { var st = v * (V.SYNC ? 36 : 7); return (st > 0.05 ? "+" : "") + st.toFixed(1) + " st"; }
    case "st": return (v > 0 ? "+" : "") + Math.round(v) + " st";
    case "sgn": return (v > 0 ? "+" : "") + Math.round(v);
    case "bpm": if (p.key === "TAP_BPM") return v ? Math.round(v) + " BPM" : "off"; if (V.CLK_SRC === 1) return DATA.clockDivs[Math.min(23, Math.floor(n * 23.999))]; return Math.round(20 + 260 * n) + " BPM";
    default: return String(Math.round(v * 1000) / 1000);
  }
}

// ---------------------------------------------------------------- stage geometry
var plate = document.getElementById("plate"), stage = document.getElementById("stage");
// front panel: coordinates traced from the manual drawing (200 dpi crop space) → plate pixels
var S0 = 0.744, SY = 0.83, DECK = 568;
function PX(x) { return 20 + (x - 22) * S0; }
function PY(y) { return 52 + 18 + (y - 45) * SY; }
function SC(v) { return v * S0; }
function SCY(v) { return v * SY; }
var hdr = el("div", "", plate); hdr.id = "hdr";
var panel = el("div", "", plate); panel.id = "panel"; put(panel, 0, 52);
var deck = el("div", "", plate); deck.id = "deck"; put(deck, 0, DECK - 6);

function section(x0, y0, x1, y1, title) { var s = el("div", "sec", plate); put(s, PX(x0), PY(y0), SC(x1 - x0), SCY(y1 - y0)); el("div", "st", s, title); return s; }
function label(x, y, txt, cls, parent) { var l = el("div", "lab" + (cls ? " " + cls : ""), parent || plate, txt); l.style.left = x + "px"; l.style.top = y + "px"; return l; }

// ---------------------------------------------------------------- tooltip
var tip = document.getElementById("tip");
function showTip(e, p) { tip.hidden = false; tip.textContent = p.name + ": " + fmtVal(p); tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY - 28) + "px"; }
function hideTip() { tip.hidden = true; }

// ---------------------------------------------------------------- knobs
function knob(key, cx, cy, r, opts) {
  opts = opts || {};
  var p = BY[key], pad = 18, size = 2 * (r + pad);
  var w = el("div", "kn", plate); put(w, cx - r - pad, cy - r - pad, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size }, w), c = r + pad;
  var tickN = 11, ticks = [];
  for (var i = 0; i < tickN; i++) {
    var a = (-150 + i * 30) * Math.PI / 180, long = opts.bipolar && i === 5, r0 = r + 3, r1 = r + (long ? 12 : 8);
    sv("line", { x1: c + r0 * Math.sin(a), y1: c - r0 * Math.cos(a), x2: c + r1 * Math.sin(a), y2: c - r1 * Math.cos(a), stroke: "#151515", "stroke-width": long ? 2.4 : 1.5 }, svg);
  }
  if (opts.scale) opts.scale.forEach(function (sc) {
    var a = sc[0] * Math.PI / 180, rr = r + 15, t = sv("text", { x: c + rr * Math.sin(a), y: c - rr * Math.cos(a) + 3, "text-anchor": "middle", "font-size": 8, "font-weight": 700, fill: "#111" }, svg); t.textContent = sc[1];
  });
  if (opts.bipolar) {
    sv("path", { d: "M " + (c - (r + 14) * 0.866) + " " + (c - (r + 14) * 0.5) + " A " + (r + 14) + " " + (r + 14) + " 0 0 1 " + (c + (r + 14) * 0.866) + " " + (c - (r + 14) * 0.5), fill: "none", stroke: "#151515", "stroke-width": 1.2 }, svg);
    var z = sv("text", { x: c, y: c - r - 19, "text-anchor": "middle", "font-size": 8.5, "font-weight": 800, fill: "#111" }, svg); z.textContent = "0";
  }
  sv("circle", { cx: c, cy: c, r: r + 1, fill: "#050506" }, svg);
  sv("circle", { cx: c, cy: c, r: r - 1.5, fill: "url(#kgKnob)", class: "rim", stroke: "#f1efe7", "stroke-width": 1.8 }, svg);
  sv("circle", { cx: c, cy: c, r: r * 0.62, fill: "url(#kgCap)", stroke: "#000", "stroke-width": 1 }, svg);
  var ptr = sv("line", { x1: c, y1: c - r * 0.18, x2: c, y2: c - r + 5, class: "ptr" }, svg);
  var dot = sv("circle", { cx: c, cy: c - r + 8, r: 2.6, fill: "#fff" }, svg);
  function draw() { var a = -150 + 300 * norm(p); ptr.setAttribute("transform", "rotate(" + a + " " + c + " " + c + ")"); dot.setAttribute("transform", "rotate(" + a + " " + c + " " + c + ")"); }
  bindKeys([key], draw);
  var drag = null;
  w.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { w.setPointerCapture(e.pointerId); } catch (x) {}
    drag = { y: e.clientY, n: norm(p) }; dragSlot = p.slot; w.classList.add("act"); showTip(e, p);
  });
  w.addEventListener("pointermove", function (e) {
    if (!drag) { showTip(e, p); return; }
    var d = (drag.y - e.clientY) / SCALE / (e.shiftKey ? 700 : 170);
    var n = clamp(drag.n + d, 0, 1);
    if (opts.detent && Math.abs(n - 0.5) < 0.012) n = 0.5;
    setNorm(p, n); showTip(e, p);
  });
  function end() { drag = null; dragSlot = -1; w.classList.remove("act"); }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
  w.addEventListener("pointerleave", function () { if (!drag) hideTip(); });
  w.addEventListener("dblclick", function () { set(key, p.def); hideTip(); });
  w.addEventListener("wheel", function (e) { e.preventDefault(); setNorm(p, norm(p) - e.deltaY / (e.shiftKey ? 8000 : 1800)); showTip(e, p); }, { passive: false });
  if (opts.label) {
    var lb = label(cx, cy + r + (opts.ly != null ? opts.ly : 15), opts.label, opts.lcls || "");
    if (opts.lcls === "box" || opts.lcls === "big") lb.style.transform = "translateX(-50%)";
  }
  return w;
}

// ---------------------------------------------------------------- waveform icons
var ICON = {
  tri: "M1,9 L6,2 L11,9", saw: "M1,9 L9,2 L9,9", sqr: "M1,9 L1,3 L6,3 L6,9 L11,9", nar: "M1,9 L4,9 L4,3 L7,3 L7,9 L11,9",
  sine: "M1,6 C3,0 5,0 6,6 C7,12 9,12 11,6", ramp: "M1,2 L1,9 L9,2", saw2: "M1,9 L9,2 L9,9"
};
function icon(parent, kind, x, y, filled, on) {
  var g = sv("g", { transform: "translate(" + (x - 6) + " " + (y - 5) + ")" }, parent);
  sv("path", { d: ICON[kind], fill: filled ? "#111" : "none", stroke: "#111", "stroke-width": 1.5, "stroke-linejoin": "round" }, g);
  return g;
}
// 4-position rotary selector (waveform / octave knobs)
function rotary4(key, cx, cy, r, items, opts) {
  opts = opts || {};
  var p = BY[key], pad = 26, size = 2 * (r + pad), c = r + pad;
  var w = el("div", "ro", plate); put(w, cx - r - pad, cy - r - pad, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size }, w);
  var ANG = [-72, -24, 24, 72], lab = [];
  items.forEach(function (it, i) {
    var a = ANG[i] * Math.PI / 180, rr = r + 15;
    var x = c + rr * Math.sin(a), y = c - rr * Math.cos(a) + 1;
    var g = sv("g", {}, svg); lab.push(g);
    if (it.t) { var t = sv("text", { x: x, y: y + 3, "text-anchor": "middle", "font-size": 9.5, "font-weight": 800, fill: "#111" }, g); t.textContent = it.t; }
    else { icon(g, it.i, x, y, it.f); }
    var hit = sv("circle", { cx: x, cy: y, r: 11, fill: "transparent", style: "cursor:pointer" }, g);
    hit.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); set(key, p.min + i); });
  });
  sv("circle", { cx: c, cy: c, r: r + 1, fill: "#050506" }, svg);
  var body = sv("circle", { cx: c, cy: c, r: r - 1.5, fill: "url(#kgKnob)", stroke: "#f1efe7", "stroke-width": 1.6, class: "rim" }, svg);
  var tail = sv("path", { d: "M " + (c - 5) + " " + (c + r - 9) + " Q " + c + " " + (c + r + 4) + " " + (c + 5) + " " + (c + r - 9) + " Z", fill: "#050506" }, svg);
  sv("circle", { cx: c, cy: c, r: r * 0.5, fill: "#f4f2ea", stroke: "#000", "stroke-width": 1.5 }, svg);
  var ptr = sv("line", { x1: c, y1: c - r * 0.25, x2: c, y2: c - r + 3, stroke: "#f1efe7", "stroke-width": 3.4, "stroke-linecap": "round" }, svg);
  function draw() {
    var i = Math.round(V[key] - p.min), a = ANG[clamp(i, 0, 3)];
    ptr.setAttribute("transform", "rotate(" + a + " " + c + " " + c + ")"); tail.setAttribute("transform", "rotate(" + a + " " + c + " " + c + ")");
    lab.forEach(function (g, k) { g.setAttribute("opacity", k === i ? 1 : 0.62); });
  }
  bindKeys([key], draw);
  w.addEventListener("pointerdown", function (e) { e.preventDefault(); var r2 = w.getBoundingClientRect(), x = (e.clientX - r2.left) / SCALE - size / 2; set(key, p.min + clamp(Math.round(V[key] - p.min) + (x >= 0 ? 1 : -1), 0, 3)); });
  w.addEventListener("wheel", function (e) { e.preventDefault(); set(key, p.min + clamp(Math.round(V[key] - p.min) + (e.deltaY < 0 ? 1 : -1), 0, 3)); }, { passive: false });
  w.addEventListener("pointermove", function (e) { showTip(e, p); });
  w.addEventListener("pointerleave", hideTip);
  if (opts.label) label(cx, cy + r + 20, opts.label, "");
  return w;
}
var WAVE_ITEMS = [{ i: "tri" }, { i: "saw" }, { i: "sqr", f: true }, { i: "nar", f: true }];
var LFO_ITEMS = [{ i: "sine" }, { i: "saw2" }, { i: "ramp" }, { i: "sqr" }];

// 3-position lever switch with selectable captions
function toggle3(key, cx, cy, caps, opts) {
  opts = opts || {};
  var p = BY[key], size = 40, w = el("div", "tg", plate); put(w, cx - size / 2, cy - size / 2, size, size);
  var svg = sv("svg", { width: size, height: size, viewBox: "0 0 44 44" }, w);
  var hex = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; hex.push((22 + 14 * Math.cos(a)) + "," + (22 + 14 * Math.sin(a))); }
  sv("polygon", { points: hex.join(" "), fill: "url(#kgNut)", stroke: "#111", "stroke-width": 1.5 }, svg);
  sv("circle", { cx: 22, cy: 22, r: 8.5, fill: "#111" }, svg);
  var lever = sv("g", {}, svg); sv("rect", { x: 20, y: 5, width: 4, height: 17, rx: 2, fill: "#f4f2ea", stroke: "#000", "stroke-width": 1 }, lever); sv("circle", { cx: 22, cy: 5, r: 3.2, fill: "#f4f2ea", stroke: "#000", "stroke-width": 1 }, lever);
  var ang = [-42, 0, 42], labs = [];
  var rowY = cy + (opts.ly != null ? opts.ly : 26), xs = opts.xs || [-46, 0, 46];
  caps.forEach(function (t, i) {
    var l = label(cx + xs[i], rowY, t, "sm"); l.style.cursor = "pointer";
    l.addEventListener("pointerdown", function (e) { e.preventDefault(); set(key, p.min + i); });
    labs.push(l);
  });
  if (opts.title) label(cx, rowY + 12, opts.title, "big");
  function draw() { var i = clamp(Math.round(V[key] - p.min), 0, 2); lever.setAttribute("transform", "rotate(" + ang[i] + " 22 22)"); labs.forEach(function (l, k) { l.className = "lab sm" + (k === i ? " sel" : ""); }); }
  bindKeys([key], draw);
  w.addEventListener("pointerdown", function (e) { e.preventDefault(); var i = Math.round(V[key] - p.min); set(key, p.min + (i + 1) % 3); });
  return w;
}

// push-button (SYNC) — latching square
function sqButton(key, cx, cy, size, text) {
  var p = BY[key], b = el("div", "sw", plate); put(b, cx - size / 2, cy - size / 2, size, size); el("div", "ld", b);
  bindKeys([key], function () { b.className = "sw" + (V[key] ? " on" : ""); });
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); set(key, V[key] ? 0 : 1); });
  if (text) label(cx, cy + size / 2 + 12, text, "big");
  return b;
}

// vertical slider (SUSTAIN)
function slider(key, x, y, w, h, text) {
  var p = BY[key], f = el("div", "fd", plate); put(f, x, y, w, h);
  el("div", "rail", f);
  for (var i = 0; i <= 28; i++) { var t = el("div", "tk" + (i % 4 === 0 ? " m" : ""), f); t.style.top = (i * h / 28) + "px"; }
  var cap = el("div", "cap", f);
  function draw() { cap.style.top = ((1 - norm(p)) * h) + "px"; }
  bindKeys([key], draw);
  function mv(e) { var r = f.getBoundingClientRect(); setNorm(p, 1 - clamp((e.clientY - r.top) / r.height, 0, 1)); }
  var d = false;
  f.addEventListener("pointerdown", function (e) { e.preventDefault(); d = true; dragSlot = p.slot; try { f.setPointerCapture(e.pointerId); } catch (x2) {} mv(e); showTip(e, p); });
  f.addEventListener("pointermove", function (e) { if (d) { mv(e); showTip(e, p); } });
  function end() { d = false; dragSlot = -1; hideTip(); }
  f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  f.addEventListener("dblclick", function () { set(key, p.def); });
  if (text) label(x + w / 2, y + h + 14, text, "big");
  return f;
}

function led(x, y, cls) { var l = el("div", "led" + (cls ? " " + cls : ""), plate); put(l, x, y); return l; }

// ---------------------------------------------------------------- jacks and cables
var JACKS = {};          // id → {id, kind:'out'|'in'|'mult', x, y, el, key}
var cablesSvg = document.getElementById("cables");
var PAL = ["#e8423b", "#2f7fd6", "#f0b92b", "#2fae6d", "#8e44ad", "#ec7f2c", "#16a7a7", "#d6409f", "#8d6b3a", "#6aa84f"];
function srcIndex(key) { for (var i = 0; i < SRC.length; i++) if (SRC[i][0] === key) return i + 1; return 0; }
function dstIndex(key) { for (var i = 0; i < DST.length; i++) if (DST[i][0] === key) return i; return -1; }

function jack(id, kind, x, y, name, lbl, lblDy, lblCls) {
  var j = el("div", "jack", plate); put(j, x, y);
  j.title = name;
  var svg = sv("svg", { width: 26, height: 26, viewBox: "0 0 26 26" }, j);
  var hex = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; hex.push((13 + 11 * Math.cos(a)) + "," + (13 + 11 * Math.sin(a))); }
  sv("polygon", { points: hex.join(" "), fill: "url(#kgNut)", stroke: "#222", "stroke-width": 1, class: "nut" }, svg);
  sv("circle", { cx: 13, cy: 13, r: 7, fill: "url(#kgJack)", stroke: "#000", "stroke-width": 1 }, svg);
  sv("circle", { cx: 13, cy: 13, r: 3.6, fill: "#000", class: "hole" }, svg);
  var rec = { id: id, kind: kind, x: x, y: y, el: j, name: name };
  JACKS[id] = rec; j.__jid = id;
  if (lbl) label(x, y + (lblDy != null ? lblDy : 18), lbl, kind === "out" ? "out" : (lblCls || ""));
  j.addEventListener("pointerdown", function (e) { jackDown(e, rec); });
  j.addEventListener("contextmenu", function (e) { e.preventDefault(); if (kind === "in" || kind === "mult") unplugAt(rec); });
  return rec;
}
function srcJack(key) { return JACKS["o:" + key]; }
function jackCenter(rec) { return [rec.x, rec.y]; }

// which jack positions the cables of the current patch use
function multJacks() { return [JACKS["m:0"], JACKS["m:1"], JACKS["m:2"], JACKS["m:3"]]; }
function cableList() {
  var list = [], used = {}, multIn = 0;
  var inUse = { 0: false, 1: false, 2: false, 3: false };
  var a = R.PB_MULT_A || 0, b = R.PB_MULT_B || 0;
  if (a) inUse[0] = true; if (b) inUse[1] = true;
  var free = [0, 1, 2, 3].filter(function (i) { return !inUse[i]; }), fi = 0;
  DST.forEach(function (d, di) {
    var s = R["PB_" + d[0]] || 0; if (!s) return;
    var sk = SRC[s - 1][0], from, to;
    if (sk === "MULT") { var mj = free.length ? free[(fi++) % free.length] : 3; from = JACKS["m:" + mj]; } else from = srcJack(sk);
    if (d[0] === "MULT_A") to = JACKS["m:0"]; else if (d[0] === "MULT_B") to = JACKS["m:1"]; else to = JACKS["i:" + d[0]];
    if (from && to) list.push({ from: from, to: to, color: PAL[(di * 3 + s) % PAL.length], dst: d[0] });
  });
  return list;
}
function cablePath(x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0, dist = Math.sqrt(dx * dx + dy * dy), sag = clamp(30 + dist * 0.16, 30, 150);
  return "M" + x0 + "," + y0 + " C" + x0 + "," + (y0 + sag * 1.25) + " " + x1 + "," + (y1 + sag * 1.25) + " " + x1 + "," + y1;
}
var tempCable = null;
function drawCables() {
  while (cablesSvg.firstChild) cablesSvg.removeChild(cablesSvg.firstChild);
  var list = cableList(), usedOut = {}, usedIn = {};
  list.forEach(function (c) {
    var d = cablePath(c.from.x, c.from.y, c.to.x, c.to.y);
    sv("path", { d: d, class: "c", stroke: "rgba(0,0,0,.5)", "stroke-width": 8, transform: "translate(1.5 2.5)" }, cablesSvg);
    sv("path", { d: d, class: "c", stroke: c.color, "stroke-width": 5.5 }, cablesSvg);
    sv("path", { d: d, class: "c", stroke: "rgba(255,255,255,.35)", "stroke-width": 1.4, transform: "translate(-1 -1.2)" }, cablesSvg);
    [c.from, c.to].forEach(function (j) { sv("circle", { cx: j.x, cy: j.y, r: 9.5, fill: c.color, class: "plug", "fill-opacity": 0.95 }, cablesSvg); sv("circle", { cx: j.x, cy: j.y, r: 4, fill: "#111" }, cablesSvg); });
    usedOut[c.from.id] = 1; usedIn[c.to.id] = 1;
  });
  if (tempCable) {
    var d2 = cablePath(tempCable.x0, tempCable.y0, tempCable.x1, tempCable.y1);
    sv("path", { d: d2, class: "c", stroke: "rgba(0,0,0,.45)", "stroke-width": 8, transform: "translate(1.5 2.5)" }, cablesSvg);
    sv("path", { d: d2, class: "c", stroke: tempCable.color, "stroke-width": 5.5, "stroke-opacity": 0.85 }, cablesSvg);
    sv("circle", { cx: tempCable.x1, cy: tempCable.y1, r: 9.5, fill: tempCable.color, class: "plug" }, cablesSvg);
  }
  Object.keys(JACKS).forEach(function (id) { var j = JACKS[id]; j.el.classList.toggle("used", !!(usedOut[id] || usedIn[id])); });
}
function toPlate(e) { var r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / SCALE - 30, (e.clientY - r.top) / SCALE]; }
function jackAt(e) {
  var els = document.elementsFromPoint(e.clientX, e.clientY);
  for (var i = 0; i < els.length; i++) { var n = els[i]; while (n && !n.__jid) n = n.parentNode; if (n && n.__jid) return JACKS[n.__jid]; }
  return null;
}
function setCable(dstKey, srcKeyOrIdx) { var s = typeof srcKeyOrIdx === "number" ? srcKeyOrIdx : srcIndex(srcKeyOrIdx); set("PB_" + dstKey, s); drawCables(); }
function connect(a, b) {                       // a, b: jack records (any order)
  if (!a || !b || a === b) return false;
  var src = null, dst = null;
  [a, b].forEach(function (j) { if (j.kind === "out" && !src) src = j; });
  [a, b].forEach(function (j) { if ((j.kind === "in") && !dst && j !== src) dst = j; });
  if (!src) { var mj = [a, b].filter(function (j) { return j.kind === "mult"; }); if (mj.length === 1 && (a.kind === "in" || b.kind === "in")) { src = mj[0]; dst = a.kind === "in" ? a : b; } else if (mj.length === 2) return false; }
  if (src && !dst) { var mj2 = [a, b].filter(function (j) { return j.kind === "mult" && j !== src; })[0]; if (mj2) dst = mj2; }
  if (!src || !dst) return false;
  var sk = src.kind === "mult" ? "MULT" : src.id.slice(2);
  if (dst.kind === "mult") {                    // plug an output into the mult: first free of A / B
    var ka = R.PB_MULT_A, kb = R.PB_MULT_B, si = srcIndex(sk);
    if (sk === "MULT") return false;
    if (!ka) setCable("MULT_A", si); else if (!kb) setCable("MULT_B", si); else setCable("MULT_B", si);
    return true;
  }
  setCable(dst.id.slice(2), sk); return true;
}
function unplugAt(rec) {
  if (rec.kind === "in") { if (R["PB_" + rec.id.slice(2)]) setCable(rec.id.slice(2), 0); }
  else if (rec.kind === "mult") { var i = +rec.id.slice(2); if (i === 0 && R.PB_MULT_A) setCable("MULT_A", 0); else if (i === 1 && R.PB_MULT_B) setCable("MULT_B", 0); }
}
function jackDown(e, rec) {
  e.preventDefault(); e.stopPropagation();
  if (e.button === 2 || e.ctrlKey) { unplugAt(rec); return; }
  var j = rec.el; try { j.setPointerCapture(e.pointerId); } catch (x) {}
  var start = null;                              // {from jack, color, replacing dst}
  if (rec.kind === "out") start = { jack: rec, color: PAL[(srcIndex(rec.id.slice(2)) * 3 + 1) % PAL.length], srcKey: rec.id.slice(2) };
  else if (rec.kind === "in") {
    var s = R["PB_" + rec.id.slice(2)] || 0;
    if (s) { var sk = SRC[s - 1][0]; start = { jack: sk === "MULT" ? JACKS["m:2"] : srcJack(sk), color: PAL[(dstIndex(rec.id.slice(2)) * 3 + s) % PAL.length], srcKey: sk, lifted: rec.id.slice(2) }; setCable(rec.id.slice(2), 0); }
    else start = { jack: rec, color: "#888", reverse: true, srcKey: null };
  } else {                                       // mult jack
    var idx = +rec.id.slice(2), occ = idx === 0 ? R.PB_MULT_A : idx === 1 ? R.PB_MULT_B : 0;
    if (occ) { var sk2 = SRC[occ - 1][0]; start = { jack: srcJack(sk2) || rec, color: "#aaa", srcKey: sk2, lifted: idx === 0 ? "MULT_A" : "MULT_B" }; setCable(idx === 0 ? "MULT_A" : "MULT_B", 0); }
    else start = { jack: rec, color: PAL[4], srcKey: "MULT", fromMult: true };
  }
  var cx = start.jack.x, cy = start.jack.y;
  tempCable = { x0: cx, y0: cy, x1: cx, y1: cy, color: start.color };
  var tgtEl = null;
  function mv(ev) { var p = toPlate(ev); tempCable.x1 = p[0]; tempCable.y1 = p[1]; drawCables(); var t = jackAt(ev); if (tgtEl && tgtEl !== (t && t.el)) tgtEl.classList.remove("tgt"); tgtEl = t ? t.el : null; if (tgtEl) tgtEl.classList.add("tgt"); }
  function up(ev) {
    j.removeEventListener("pointermove", mv); j.removeEventListener("pointerup", up); j.removeEventListener("pointercancel", up);
    if (tgtEl) tgtEl.classList.remove("tgt"); tempCable = null;
    var t = jackAt(ev);
    if (t) {
      if (start.reverse) connect(rec, t);
      else if (start.fromMult) connect(rec, t);
      else {                                     // a lifted / new cable from output start.srcKey to the target
        var fakeOut = start.srcKey === "MULT" ? JACKS["m:2"] : srcJack(start.srcKey);
        if (t.kind === "in" || t.kind === "mult") connect(fakeOut, t);
        else if (t.kind === "out" && start.lifted === undefined && rec.kind === "in") connect(rec, t);
      }
    }
    drawCables();
  }
  j.addEventListener("pointermove", mv); j.addEventListener("pointerup", up); j.addEventListener("pointercancel", up);
  drawCables();
}

// =====================================================================
//  FRONT PANEL
// =====================================================================
var SEC = [["ARP/SEQ", 22, 180], ["MODULATION", 193, 500], ["OSCILLATORS", 518, 825], ["MIXER", 843, 995], ["UTILITIES", 1013, 1165], ["FILTER", 1183, 1490], ["ENVELOPE", 1508, 1815]];
SEC.forEach(function (s) { section(s[1], 45, s[2], 620, s[0]); });
section(1830, 45, 1985, 440, "OUTPUT"); section(1830, 465, 1985, 620, "SPRING REVERB");
function J(key, kind, xL, yL, name, lbl, dy, cls) { return jack(kind === "out" ? "o:" + key : (kind === "mult" ? "m:" + key : "i:" + key), kind, PX(xL), PY(yL), name, lbl, dy, cls); }

// ---- ARP / SEQ
J("GATE", "out", 107, 100, "Gate Out", "GATE OUT"); J("KB", "out", 57, 158, "KB Out", "KB OUT"); J("VEL", "out", 140, 158, "KB Vel Out", "KB VEL OUT");
knob("ARP_RATE", PX(97), PY(262), SC(40), { label: "RATE", lcls: "big", ly: 17 });
toggle3("ARP_MODE", PX(100), PY(362), ["ARP", "SEQ", "REC"], { title: "MODE", xs: [-30, 0, 28] });
toggle3("ARP_DIR", PX(100), PY(458), ["ORDR", "FWD/BKWD", "RNDM"], { title: "DIRECTION", xs: [-38, 0, 38] });
toggle3("OCT_SEQ", PX(100), PY(554), ["1", "2", "3"], { title: "OCT / SEQ", xs: [-20, 0, 20] });
var ledArp = led(PX(97) + SC(34), PY(262) - SC(36));

// ---- MODULATION
J("LFO_RATE", "in", 232, 100, "Mod Rate In", "RATE IN"); J("LFO", "out", 465, 100, "Mod Wave Out", "WAVE OUT");
J("LFO_SYNC", "in", 307, 158, "Mod Sync In", "SYNC IN"); J("SH", "out", 385, 158, "Mod S/H Out", "S/H OUT");
knob("MOD_RATE", PX(327), PY(258), SC(40), { label: "RATE", lcls: "big", ly: 17 });
var ledLfo = led(PX(327) + SC(34), PY(258) - SC(36));
knob("MOD_FINE", PX(327) + SC(76), PY(258) + SCY(46), SC(11), { detent: true });
label(PX(327) + SC(76), PY(258) + SCY(46) + 19, "FINE", "sm");
knob("MOD_PITCH", PX(265), PY(392), SC(38), { label: "PITCH AMT", lcls: "box", ly: 15 });
knob("MOD_CUT", PX(410), PY(392), SC(38), { label: "CUTOFF AMT", lcls: "box", ly: 15 });
knob("MOD_PW", PX(272), PY(528), SC(38), { label: "PULSE WIDTH AMT", lcls: "big", ly: 15 });
rotary4("MOD_WAVE", PX(410), PY(530), SC(30), LFO_ITEMS, { label: "WAVEFORM" });

// ---- OSCILLATORS
label(PX(535), PY(62), "1", "l big"); label(PX(802), PY(62), "2", "l big");
var oscDiv = el("div", "", plate); oscDiv.style.cssText = "position:absolute;width:2px;background:#151515;left:" + PX(672) + "px;top:" + PY(88) + "px;height:" + SCY(500) + "px";
J("O1", "out", 595, 100, "Osc 1 Wave Out", "WAVE OUT"); J("O1_PITCH", "in", 555, 158, "Osc 1 Pitch In", "PITCH IN"); J("O1_PWM", "in", 635, 158, "PWM In (both oscillators)", "PWM IN");
J("O2", "out", 747, 100, "Osc 2 Wave Out", "WAVE OUT"); J("O2_PITCH", "in", 708, 158, "Osc 2 Pitch In", "PITCH IN"); J("O2_FM", "in", 788, 158, "Osc 2 Lin FM In", "LIN FM IN");
rotary4("O1_OCT", PX(592), PY(262), SC(34), [{ t: "32'" }, { t: "16'" }, { t: "8'" }, { t: "4'" }], { label: "OCTAVE" });
rotary4("O2_OCT", PX(748), PY(262), SC(34), [{ t: "16'" }, { t: "8'" }, { t: "4'" }, { t: "2'" }], { label: "OCTAVE" });
sqButton("SYNC", PX(593), PY(405), SC(78), "SYNC");
var syncLine = el("div", "", plate); syncLine.style.cssText = "position:absolute;height:2px;background:#151515;left:" + (PX(593) + SC(39)) + "px;width:" + (PX(748) - PX(593) - SC(39) - SC(38)) + "px;top:" + PY(405) + "px";
knob("O2_FREQ", PX(748), PY(405), SC(38), { bipolar: true, detent: true, label: "FREQUENCY", lcls: "big", ly: 15 });
rotary4("O1_WAVE", PX(592), PY(540), SC(32), WAVE_ITEMS, { label: "WAVEFORM" });
rotary4("O2_WAVE", PX(748), PY(540), SC(32), WAVE_ITEMS, { label: "WAVEFORM" });

// ---- MIXER
J("MX_O1", "in", 878, 100, "Mixer Osc 1 In", "OSC 1 IN"); J("MX_O2", "in", 960, 100, "Mixer Osc 2 In", "OSC 2 IN");
J("MX_NZ", "in", 878, 158, "Mixer Noise In", "NOISE IN"); J("MIX", "out", 960, 158, "Mixer Output", "OUTPUT");
knob("MIX_O1", PX(917), PY(262), SC(36), { label: "OSCILLATOR 1", lcls: "box", ly: 15 });
knob("MIX_O2", PX(917), PY(405), SC(36), { label: "OSCILLATOR 2", lcls: "box", ly: 15 });
knob("MIX_NZ", PX(917), PY(545), SC(36), { label: "NOISE", lcls: "big", ly: 15 });

// ---- UTILITIES
var m4 = [[1050, 100], [1130, 100], [1050, 157], [1130, 157]];
m4.forEach(function (q, i) { J(String(i), "mult", q[0], q[1], "Mult jack " + (i + 1) + " (all four are wired together)"); });
var mbox = el("div", "", plate); mbox.style.cssText = "position:absolute;border:2px solid #151515;left:" + PX(1050) + "px;top:" + PY(100) + "px;width:" + SC(80) + "px;height:" + SCY(57) + "px;z-index:1";
label(PX(1090), PY(190), "MULT", "big");
knob("HP_CUT", PX(1075), PY(270), SC(36), { label: "HIGH PASS", lcls: "big", ly: 15 });
J("HP_IN", "in", 1050, 355, "High Pass Input", "INPUT"); J("HP", "out", 1130, 355, "High Pass Output", "OUTPUT");
knob("ATT", PX(1075), PY(470), SC(36), { bipolar: true, detent: true, label: "ATTENUATOR", lcls: "big", ly: 15 });
J("ATT_IN", "in", 1050, 568, "Attenuator Input", "INPUT"); J("ATT", "out", 1130, 568, "Attenuator Output", "OUTPUT");

// ---- FILTER
J("F_IN", "in", 1217, 100, "Filter Input", "INPUT"); J("FIL", "out", 1453, 100, "Filter Output", "OUTPUT");
J("F_ENVAMT", "in", 1295, 158, "Filter Env Amt In", "ENV AMT IN"); J("F_CUT", "in", 1375, 158, "Filter Cutoff In", "CUTOFF IN");
knob("CUTOFF", PX(1317), PY(285), SC(54), { label: "CUTOFF", lcls: "big", ly: 16, scale: [[-150, "20Hz"], [-50, "200Hz"], [50, "2kHz"], [150, "20kHz"]] });
toggle3("KBD_TRK", PX(1330), PY(425), ["1:2", "OFF", "1:1"], { title: "KBD TRACK", xs: [-34, 0, 34] });
knob("ENV_AMT", PX(1257), PY(545), SC(38), { bipolar: true, detent: true, label: "ENVELOPE AMT", lcls: "big", ly: 15 });
knob("RESO", PX(1413), PY(545), SC(38), { label: "RESONANCE", lcls: "big", ly: 15 });

// ---- ENVELOPE
J("E_TRIG", "in", 1658, 100, "Env Trigger In", "TRIGGER IN"); J("ENVP", "out", 1583, 158, "+ Env Out", "+ ENV OUT"); J("ENVN", "out", 1733, 158, "- Env Out", "- ENV OUT");
knob("ATK", PX(1568), PY(262), SC(38), { label: "ATTACK", lcls: "big", ly: 15 });
knob("DEC", PX(1568), PY(400), SC(38), { label: "DECAY", lcls: "big", ly: 15 });
knob("REL", PX(1568), PY(545), SC(38), { label: "RELEASE", lcls: "big", ly: 15 });
slider("SUS", PX(1722), PY(262), SC(34), SCY(262), "SUSTAIN");

// ---- OUTPUT / REVERB
J("V_AMT", "in", 1907, 100, "VCA Amt In", "VCA AMT IN"); J("V_IN", "in", 1868, 158, "VCA In", "VCA IN"); J("R_IN", "in", 1950, 158, "Reverb In", "REVERB IN");
knob("VOLUME", PX(1903), PY(262), SC(38), { label: "VOLUME", lcls: "big", ly: 15 });
toggle3("VCA_MODE", PX(1907), PY(375), ["ENV", "KB RLS", "DRONE"], { title: "VCA MODE", xs: [-34, 0, 36] });
knob("REV_MIX", PX(1902), PY(545), SC(38), { label: "MIX", lcls: "big", ly: 15 });

// =====================================================================
//  HEADER: brand, patch-sheet browser, status
// =====================================================================
var brand = el("div", "brand", hdr, "KGrbdPa"); el("small", "", brand, "SEMI-MODULAR ANALOG SYNTHESIZER · RECREATION");
var sheetBox = el("div", "", hdr); sheetBox.id = "sheet";
var prevB = el("button", "hbtn", sheetBox, "◀"), sel = el("select", "", sheetBox), nextB = el("button", "hbtn", sheetBox, "▶"), initB = el("button", "hbtn", sheetBox, "INIT"), glB = el("button", "hbtn", sheetBox, "GLOBAL…");
var curIdx = 0, noteEl = el("div", "", hdr); noteEl.id = "note";
var cats = []; DATA.presets.forEach(function (p) { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
cats.forEach(function (c) { var g = el("optgroup", "", sel); g.label = c; DATA.presets.forEach(function (p, i) { if (p.cat === c) { var o = el("option", "", g, p.name); o.value = i; } }); });
function loadIndex(i) {
  i = (i + DATA.presets.length) % DATA.presets.length; curIdx = i; sel.value = i;
  var pr = DATA.presets[i]; applySnap(pr.set); noteEl.textContent = pr.note || ""; noteEl.title = pr.note || ""; refreshStatus();
}
sel.addEventListener("change", function () { loadIndex(+sel.value); });
prevB.addEventListener("click", function () { loadIndex(curIdx - 1); }); nextB.addEventListener("click", function () { loadIndex(curIdx + 1); });
initB.addEventListener("click", function () { loadIndex(0); });
var statusEl = el("div", "", hdr); statusEl.id = "status";

// =====================================================================
//  LEFT-HAND CONTROLLER
// =====================================================================
var lhc = el("div", "lhc", plate); put(lhc, 12, DECK, 250, 320); el("div", "st", lhc, "LEFT-HAND CONTROLLER");
function lx(x) { return 12 + x; } function ly(y) { return DECK + y; }
knob("GLIDE", lx(52), ly(76), 28, { label: "GLIDE", lcls: "big", ly: 14 });
// glide switches
function chip(key, x, y, text) { var b = el("div", "hbtn", plate, text); put(b, x, y, null, null); b.style.cssText += ";position:absolute;font-size:9px;padding:2px 6px;z-index:5"; bindKeys([key], function () { b.classList.toggle("on", !!V[key]); }); b.addEventListener("pointerdown", function (e) { e.preventDefault(); set(key, V[key] ? 0 : 1); }); return b; }
chip("GL_LEGATO", lx(14), ly(160), "LEGATO"); chip("GL_GATED", lx(14), ly(184), "GATED");
var glT = el("div", "hbtn", plate, "EXP"); glT.style.cssText = "position:absolute;left:" + lx(14) + "px;top:" + ly(208) + "px;font-size:9px;padding:2px 6px;z-index:5;min-width:44px;text-align:center";
bindKeys(["GL_TYPE"], function () { glT.textContent = ["LCR", "LCT", "EXP"][V.GL_TYPE]; });
glT.addEventListener("pointerdown", function (e) { e.preventDefault(); set("GL_TYPE", (V.GL_TYPE + 1) % 3); });
// transport buttons
var shiftOn = false, shiftBtn;
function roundBtn(x, y, r, text, sub, cls) {
  var b = el("div", "bt " + (cls || ""), plate); put(b, x - r, y - r, 2 * r, 2 * r);
  label(x, y - r - 14, text, "big"); if (sub) label(x, y + r + 4, sub, "sm");
  return b;
}
var btnShift = roundBtn(lx(150), ly(48), 15, "SHIFT", "", ""), btnDown = roundBtn(lx(100), ly(48), 15, "◄ KB", "", ""), btnUp = roundBtn(lx(200), ly(48), 15, "KB ►", "", "");
var btnPlay = roundBtn(lx(100), ly(112), 20, "PLAY", "(TIE)", ""), btnHold = roundBtn(lx(150), ly(112), 20, "HOLD", "(REST)", ""), btnTap = roundBtn(lx(200), ly(112), 20, "TAP", "(ACCENT)", "");
var ledShift = led(lx(150) + 14, ly(48) - 14), octRead = label(lx(150), ly(48) + 20, "OCT 0", "sm");
function updateOct() { octRead.textContent = "OCT " + (V.KB_OCT > 0 ? "+" : "") + V.KB_OCT; }
bindKeys(["KB_OCT"], updateOct);
btnShift.addEventListener("pointerdown", function (e) { e.preventDefault(); shiftOn = !shiftOn; btnShift.classList.toggle("on", shiftOn); ledShift.classList.toggle("on", shiftOn); });
function octShift(d) { set("KB_OCT", clamp(V.KB_OCT + d, -2, 2)); shiftOn = false; btnShift.classList.remove("on"); ledShift.classList.remove("on"); }
btnDown.addEventListener("pointerdown", function (e) { e.preventDefault(); btnDown.classList.add("dn"); if (shiftOn) octShift(-1); });
btnUp.addEventListener("pointerdown", function (e) { e.preventDefault(); btnUp.classList.add("dn"); if (shiftOn) octShift(1); });
[btnDown, btnUp].forEach(function (b) { b.addEventListener("pointerup", function () { b.classList.remove("dn"); }); b.addEventListener("pointerleave", function () { b.classList.remove("dn"); }); });
var ledPlay = led(lx(100) + 17, ly(112) - 17, ""), ledHold = led(lx(150) + 17, ly(112) - 17, ""), ledTap = led(lx(200) + 17, ly(112) - 17, "");
var padDown = { play: false, hold: false, tap: false }, panicT = null;
function checkPanic() { if (padDown.play && padDown.hold && padDown.tap) { if (!panicT) panicT = setTimeout(function () { host("noteOn", -5, 0); panicT = null; }, 900); } else if (panicT) { clearTimeout(panicT); panicT = null; } }
function recMode() { return V.ARP_MODE === 2; }
bindKeys(["PLAY"], function () { btnPlay.classList.toggle("on", !!V.PLAY && !recMode()); }); bindKeys(["HOLD"], function () { btnHold.classList.toggle("on", !!V.HOLD && !recMode()); });
bindKeys(["ARP_MODE"], function () { var rec = recMode(); btnPlay.classList.toggle("on", !!V.PLAY && !rec); btnHold.classList.toggle("on", !!V.HOLD && !rec); });
btnPlay.addEventListener("pointerdown", function (e) { e.preventDefault(); padDown.play = true; checkPanic(); if (recMode()) { host("noteOn", -3, 0); btnPlay.classList.add("dn"); } else set("PLAY", V.PLAY ? 0 : 1); });
btnHold.addEventListener("pointerdown", function (e) { e.preventDefault(); padDown.hold = true; checkPanic(); if (recMode()) { host("noteOn", -2, 0); btnHold.classList.add("dn"); } else set("HOLD", V.HOLD ? 0 : 1); });
// TAP tempo: three or more taps set the rate; hold for a second to leave tap tempo
var taps = [], tapHold = null, tapExit = false;
btnTap.addEventListener("pointerdown", function (e) {
  e.preventDefault(); padDown.tap = true; checkPanic(); tapExit = false;
  if (recMode()) { host("noteOn", -4, 0); btnTap.classList.add("dn"); return; }
  tapHold = setTimeout(function () { tapExit = true; set("TAP_BPM", 0); taps = []; }, 1000);
  var t = performance.now(); if (taps.length && t - taps[taps.length - 1] > 2200) taps = []; taps.push(t);
  if (taps.length >= 3) { var s = 0; for (var i = 1; i < taps.length; i++) s += taps[i] - taps[i - 1]; var bpm = 60000 / (s / (taps.length - 1)); set("TAP_BPM", clamp(Math.round(bpm), 20, 280)); }
});
function padUp(which, b) { return function () { padDown[which] = false; checkPanic(); b.classList.remove("dn"); if (which === "tap" && tapHold) { clearTimeout(tapHold); tapHold = null; } }; }
btnPlay.addEventListener("pointerup", padUp("play", btnPlay)); btnHold.addEventListener("pointerup", padUp("hold", btnHold)); btnTap.addEventListener("pointerup", padUp("tap", btnTap));
[["play", btnPlay], ["hold", btnHold], ["tap", btnTap]].forEach(function (q) { q[1].addEventListener("pointerleave", padUp(q[0], q[1])); q[1].addEventListener("pointercancel", padUp(q[0], q[1])); });
bindKeys(["TAP_BPM"], function () { ledTap.classList.toggle("on", V.TAP_BPM > 0); });
bindKeys(["PLAY"], function () { ledPlay.classList.toggle("on", !!V.PLAY); }); bindKeys(["HOLD"], function () { ledHold.classList.toggle("on", !!V.HOLD); });

// wheels
function wheel(key, x, y, w, h, spring, text) {
  var d = el("div", "whl", plate); put(d, x, y, w, h); var ind = el("i", "", d), p = BY[key], dragging = false;
  label(x + w / 2, y + h + 6, text, "big");
  function draw() { ind.style.top = ((1 - norm(p)) * h) + "px"; }
  bindKeys([key], draw);
  function mv(e) { var r = d.getBoundingClientRect(); setNorm(p, 1 - clamp((e.clientY - r.top) / r.height, 0, 1)); }
  d.addEventListener("pointerdown", function (e) { e.preventDefault(); dragging = true; dragSlot = p.slot; try { d.setPointerCapture(e.pointerId); } catch (x2) {} mv(e); });
  d.addEventListener("pointermove", function (e) { if (dragging) mv(e); });
  function end() { if (!dragging) return; dragging = false; dragSlot = -1; if (spring) { var n = norm(p), t0 = performance.now(); (function back() { var k = clamp((performance.now() - t0) / 120, 0, 1); setNorm(p, n + (0.5 - n) * k); if (k < 1) requestAnimationFrame(back); })(); } }
  d.addEventListener("pointerup", end); d.addEventListener("pointercancel", end);
  d.addEventListener("dblclick", function () { set(key, p.def); });
}
wheel("PITCHW", lx(78), ly(172), 44, 124, true, "PITCH"); wheel("MODW", lx(150), ly(172), 44, 124, false, "MOD");

// =====================================================================
//  REAR PANEL
// =====================================================================
var rear = el("div", "rear", plate); put(rear, 1364, DECK, 124, 320); el("div", "st", rear, "REAR PANEL");
function rx(x) { return 1364 + x; } function ry(y) { return DECK + y; }
label(rx(62), ry(24), "AUDIO", "sm");
jack("o:EXT", "out", rx(30), ry(48), "Instrument In (host audio input)", "INSTR IN", 18);
knob("INST_LVL", rx(90), ry(48), 14, { label: "LEVEL", lcls: "sm", ly: 14 });
jack("o:EURO", "out", rx(30), ry(96), "Eurorack Out", "EURO OUT", 18); jack("o:REV", "out", rx(90), ry(96), "Reverb Out", "REVERB OUT", 18);
label(rx(62), ry(134), "ARP/SEQ CV", "sm");
jack("i:CLK_IN", "in", rx(30), ry(160), "Clock In", "CLOCK IN", 18); jack("i:ONOFF_IN", "in", rx(90), ry(160), "On/Off In", "ON/OFF IN", 18);
jack("i:RESET_IN", "in", rx(30), ry(208), "Reset In", "RESET IN", 18); jack("o:CLK", "out", rx(90), ry(208), "Clock Out", "CLOCK OUT", 18);
knob("FINE", rx(30), ry(276), 14, { bipolar: true, detent: true, label: "FINE TUNE", lcls: "sm", ly: 15 });
knob("DRIFT", rx(90), ry(276), 14, { label: "DRIFT", lcls: "sm", ly: 15 });
// mult jacks were registered as m:0..3 and outputs as o:KEY — the "out" ids above already use the o: prefix

// =====================================================================
//  KEYBOARD (32 keys, F … C) + computer keyboard
// =====================================================================
var kbd = el("div", "kbd", plate); put(kbd, 12 + 264, DECK + 4, 1076, 312);
var KEYNODES = {}, heldPtr = {};
(function () {
  var first = 41, last = 72, W = 1076, whites = [], blacks = [];
  for (var n = first; n <= last; n++) { var pc = n % 12; if ([1, 3, 6, 8, 10].indexOf(pc) < 0) whites.push(n); else blacks.push(n); }
  var kw = W / whites.length, NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
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
  whites.forEach(function (n, i) { var k = el("div", "wk", kbd); put(k, i * kw, 0, kw, 312); if (n % 12 === 0) el("div", "nm", k, "C" + (Math.floor(n / 12) - 1)); bind(k, n); });
  blacks.forEach(function (n) { var wi = whites.indexOf(n - 1); var k = el("div", "bk", kbd); put(k, (wi + 1) * kw - kw * 0.3, 0, kw * 0.6, 194); bind(k, n); });
})();
var onNotes = {};
function keyOn(note, vel) { onNotes[note] = 1; if (KEYNODES[note]) KEYNODES[note].classList.add("hit"); host("noteOn", note, vel); }
function keyOff(note) { delete onNotes[note]; if (KEYNODES[note]) KEYNODES[note].classList.remove("hit"); host("noteOff", note); }
var CK = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 }, ckOct = 60, ckDown = {};
window.addEventListener("keydown", function (e) {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key.toLowerCase();
  if (k === "z") { ckOct = Math.max(24, ckOct - 12); return; } if (k === "x") { ckOct = Math.min(84, ckOct + 12); return; }
  if (CK[k] === undefined || e.repeat || ckDown[k] !== undefined) return;
  var n = ckOct + CK[k]; ckDown[k] = n; keyOn(n, 0.78);
});
window.addEventListener("keyup", function (e) { var k = e.key.toLowerCase(); if (ckDown[k] !== undefined) { var n = ckDown[k]; delete ckDown[k]; keyOff(n); } });

// =====================================================================
//  GLOBAL SETTINGS dialog (manual p.37-38 + MIDI chart)
// =====================================================================
var glob = document.getElementById("glob"), globBuilt = false;
function buildGlobal() {
  globBuilt = true;
  var x = el("button", "hbtn x", glob, "Close"); x.onclick = function () { glob.hidden = true; };
  el("h3", "", glob, "GLOBAL SETTINGS");
  el("div", "", glob, "On the hardware these are set from the keyboard (HOLD + SYNC); here they are plain controls. They are saved with the project.").style.cssText = "font-size:10.5px;color:#a89a7e;margin-bottom:4px";
  var g = el("div", "grid", glob);
  function row(key, text, tip) {
    var p = BY[key]; el("div", "", g, text);
    var c = el("div", "", g), s;
    if (p.fmt && Array.isArray(p.fmt) && p.steps <= 16) { s = el("select", "", c); p.fmt.forEach(function (nm, i) { var o = el("option", "", s, nm); o.value = i; }); s.addEventListener("change", function () { set(key, p.min + (+s.value)); }); bindKeys([key], function () { s.value = Math.round(V[key] - p.min); }); }
    else { s = el("input", "", c); s.type = "range"; s.min = p.min; s.max = p.max; s.step = p.direct ? 0.01 : 1; s.addEventListener("input", function () { set(key, +s.value); lab.textContent = fmtVal(p); }); var lab = el("span", "", c, ""); lab.style.marginLeft = "8px"; bindKeys([key], function () { s.value = V[key]; lab.textContent = fmtVal(p); }); }
    if (tip) { var t = el("div", "tp", g, tip); }
  }
  row("NOTE_PRI", "Note priority", "Which held key wins on the monophonic keyboard (default LAST).");
  row("BEND_UP", "Pitch-bend range up", "Semitones, 0-24 (MIDI CC107 / RPN 0).");
  row("BEND_DN", "Pitch-bend range down", "Semitones, 0-24 (MIDI CC108).");
  row("KB_TRANS", "Keyboard transpose", "Semitones (MIDI CC119).");
  row("KB_RANGE", "KB OUT range", "-5…+5 V or 0…10 V.");
  row("LOCAL", "Local", "Off: keyboard / wheel / arp only drive the jacks and MIDI, not the internal engine.");
  row("CLK_SRC", "Arp / Seq clock", "Internal BPM / tap tempo, or follow the host tempo (RATE then selects one of 24 note divisions, e.g. quarter, dotted eighth, 16th triplet).");
  row("EXT_MODE", "External clock mode", "How the CLOCK IN jack is read.");
  row("EXT_PPQN", "External clock PPQN", "Pulses per quarter note at CLOCK IN (default 2).");
  row("OUT_PPQN", "Clock output PPQN", "Pulses per quarter note at CLOCK OUT (default 2).");
  row("GL_TYPE", "Glide type", "LCR = linear constant rate, LCT = linear constant time, exponential.");
  row("GL_GATED", "Gated glide", "Glide only slews while the gate is high (MIDI CC103).");
  el("h3", "", glob, "MIDI IMPLEMENTATION");
  var t = el("table", "", glob), rows = [["CC1", "Mod wheel"], ["CC3", "Modulation rate"], ["CC5", "Glide time"], ["CC8", "Arp/Seq rate"], ["CC12", "Oscillator 2 frequency"], ["CC65", "Glide on/off"], ["CC69 / CC73", "Hold / Play"], ["CC74 / CC75", "Osc 1 / Osc 2 octave"], ["CC77", "Oscillator sync"], ["CC85", "Glide type"], ["CC89", "Keyboard octave"], ["CC90", "Arp/Seq clock division"], ["CC91 / 92 / 93", "Mode / direction / range-seq"], ["CC94 / CC103", "Legato glide / gated glide"], ["CC107 / CC108", "Bend up / down amount"], ["CC119", "Keyboard transpose"], ["RPN 0 / 1 / 2", "Bend range / fine / coarse tune"], ["CC120 / 122 / 123", "All sound off / local / all notes off"]];
  rows.forEach(function (r) { var tr = el("tr", "", t); el("td", "", tr, r[0]); el("td", "", tr, r[1]); });
}
glB.addEventListener("click", function () { if (!globBuilt) buildGlobal(); glob.hidden = !glob.hidden; });

// =====================================================================
//  engine display → LEDs and the status line
// =====================================================================
var lastDisp = [0, 0, 0, 0, 0, 0, 0, 0];
function refreshStatus() {
  var d = lastDisp, mode = ["ARP", "SEQ", "REC"][V.ARP_MODE], s = [];
  var run = Math.round(d[6]);
  s.push(mode);
  if (V.ARP_MODE === 0) s.push((run & 1) ? "▶ range " + (V.OCT_SEQ + 1) : (V.PLAY ? "armed" : "stop"));
  else { var len = Math.round(d[5] * 256); s.push("seq " + (V.OCT_SEQ + 1)); s.push(len + " steps"); if (run & 2) s.push("▶ " + String(Math.max(1, Math.round(d[4] * 256))).padStart(3, "0")); else if (V.ARP_MODE === 2) s.push(d[7] > 0.5 ? "● armed (next note erases)" : "● rec"); }
  if (V.TAP_BPM) s.push("tap " + V.TAP_BPM);
  statusEl.textContent = s.join(" · ");
}
if (window.vstai && window.vstai.onDisplay) window.vstai.onDisplay(function (d) {
  lastDisp = d; ledLfo.classList.toggle("on", d[0] > 0.5); ledArp.classList.toggle("on", d[1] > 0.3);
  refreshStatus();
});
P.forEach(function (p) { if (["ARP_MODE", "OCT_SEQ", "PLAY", "TAP_BPM"].indexOf(p.key) >= 0) UPD[p.key].push(refreshStatus); });

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
if (window.vstai && window.vstai.onParam) window.vstai.onParam(function (i, v) { if (i === dragSlot) return; if (FIELDS[i]) { decodeSlot(i, +v); drawCables(); } });
drawCables(); refreshStatus();
noteEl.textContent = DATA.presets[0].note || ""; noteEl.title = noteEl.textContent;
window.__kg = { V: V, R: R, NSLOT: NSLOT, slotValue: slotValue, applyPatch: function (o) { applySnap(o || {}); }, loadIndex: loadIndex, snapshot: snapshot, DATA: DATA, JACKS: JACKS, connect: function (a, b) { return connect(JACKS[a], JACKS[b]); }, cables: cableList, set: set, keyOn: keyOn, keyOff: keyOff };
})();
