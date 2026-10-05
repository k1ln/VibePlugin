(function () {
"use strict";
// =====================================================================
//  KHEVEREST panel — a faithful re-creation of the Peak's front panel.
//  Every control is a "logical parameter"; build.mjs packs them several-to-a-host-slot
//  (mixed radix). This script owns the packing: R[key] = raw integer, V[key] = actual value,
//  slot = Σ R·mult. The OLED menu system mirrors the hardware's nine menus.
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

// ---------------------------------------------------------------- packing
function rawToActual(p, r) {
  if (p.curve === "int") return p.min + r;
  var n = p.steps > 1 ? r / (p.steps - 1) : 0;
  return p.min + n * (p.max - p.min);
}
function actualToRaw(p, v) {
  if (p.curve === "int") return clamp(Math.round(v - p.min), 0, p.steps - 1);
  var n = (v - p.min) / (p.max - p.min);
  return clamp(Math.round(n * (p.steps - 1)), 0, p.steps - 1);
}
function slotValue(s) {
  var f = FIELDS[s], t = 0;
  for (var i = 0; i < f.length; i++) { if (f[i].direct) return V[f[i].key]; t += R[f[i].key] * f[i].mult; }
  return t;
}
function push(s) { host("setParam", s, slotValue(s)); }
function norm(p) { return p.direct ? (V[p.key] - p.min) / (p.max - p.min) : (p.steps > 1 ? R[p.key] / (p.steps - 1) : 0); }
var dirty = false, ready = false;
function touch(p) { var u = UPD[p.key]; for (var i = 0; i < u.length; i++) u[i](); }
function markDirty() { if (!dirty) { dirty = true; oledRender(); } }
function setRaw(p, r) { r = clamp(Math.round(r), 0, p.steps - 1); R[p.key] = r; V[p.key] = rawToActual(p, r); }
function setNorm(p, n) {
  n = clamp(n, 0, 1);
  if (p.direct) V[p.key] = p.min + n * (p.max - p.min); else setRaw(p, n * (p.steps - 1));
  touch(p); push(p.slot); markDirty();
}
function set(key, actual, quiet) {
  var p = BY[key]; if (!p) return;
  if (p.direct) V[key] = clamp(actual, p.min, p.max); else setRaw(p, actualToRaw(p, actual));
  touch(p); if (!quiet) { push(p.slot); markDirty(); }
}
function step(p, dir, mult) {
  if (p.direct) { setNorm(p, norm(p) + dir * 0.02 * (mult || 1)); return; }
  setRaw(p, R[p.key] + dir * (mult || 1)); touch(p); push(p.slot); markDirty();
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
function applySnap(o) { P.forEach(function (p) { var v = o[p.key]; if (v === undefined) v = p.def; if (p.direct) V[p.key] = clamp(v, p.min, p.max); else setRaw(p, actualToRaw(p, v)); }); P.forEach(touch); for (var s = 0; s < NSLOT; s++) push(s); }
function bindKeys(keys, fn) { keys.forEach(function (k) { UPD[k].push(fn); }); }

// ---------------------------------------------------------------- formatting
var NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function fmtVal(p) {
  var v = V[p.key], f = p.fmt;
  if (Array.isArray(f)) return f[Math.round(v - p.min)] || String(v);
  switch (f) {
    case "n127": case "n255": case "int": return String(Math.round(v));
    case "sgn": return (v > 0.5 ? "+" : "") + Math.round(v);
    case "st": return (v > 0.04 ? "+" : "") + (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1));
    case "ct": return (v > 0.5 ? "+" : "") + Math.round(v);
    case "pct": return Math.round(v * 100) + "%";
    case "bip": return (v > 0.005 ? "+" : "") + v.toFixed(2);
    case "bits": return ((v & 1) ? "A1 " : "") + ((v & 2) ? "A2 " : "") + ((v & 4) ? "H" : "") || "-";
    case "rep": return v === 0 ? "Off" : (v >= 31 ? "On" : String(v));
    case "phase": return v === 0 ? "Free" : ((v - 1) * 6) + "deg";
    case "preglide": return v === 0 ? "Off" : ((v > 0 ? "+" : "") + v);
    case "oct": return (v > 0 ? "+" : "") + v;
    case "bpm": return v + "BPM";
    case "hold": return Math.round(v / 127 * 500) + "ms";
    case "wt": return DATA.wt[Math.round(v)] || "?";
    case "fixnote": return v === 0 ? "Off" : NOTES[v % 12] + (Math.floor(v / 12) - 2);
    case "tuning": return v + " " + DATA.tunings[v];
    default: return String(Math.round(v * 100) / 100);
  }
}
function pname(p) { return p.name; }

// ---------------------------------------------------------------- the faceplate
var plate = document.getElementById("plate");
var stage = document.getElementById("stage");
function sect(x, y, w, h, title, arrow) {
  var s = el("div", "sec", plate); put(s, x, y, w, h);
  if (title) el("span", "st", s, title);
  if (arrow) el("span", "ar", s, "▶");
  s.__t = title || "";
  return s;
}
function label(sec, x, y, txt, cls) { var l = el("div", "lb" + (cls ? " " + cls : ""), sec, txt); l.style.left = x + "px"; l.style.top = y + "px"; return l; }
function bracket(sec, x0, x1, y) { var b = el("div", "br", sec); put(b, x0, y, x1 - x0, 5); return b; }

// ---- OLED temp readout (hardware: touching a rotary shows the value in an alternative display)
var tempTimer = 0, temp = null;
function flash(sec, p, text) {
  temp = [sec ? sec.__t.toUpperCase() : "", pname(p), text != null ? text : fmtVal(p)];
  oledRender();
  clearTimeout(tempTimer); tempTimer = setTimeout(function () { temp = null; oledRender(); }, 1300);
}

// ---- knobs
function mkB(b) { return typeof b === "string" ? { keys: [b], cur: function () { return BY[b]; } } : b; }
function knob(sec, cx, cy, size, text, binding, o) {
  o = o || {}; var B = mkB(binding);
  var d = 44 * size / 25, w = el("div", "kw", sec); put(w, cx - d / 2, cy - d / 2, d, d);
  var s = sv("svg", { viewBox: "0 0 44 44", width: d, height: d }, w);
  for (var i = 0; i < 11; i++) {
    var a = (-135 + 27 * i) * Math.PI / 180, mid = i === 5 && !o.noMid;
    sv("circle", { cx: 22 + 18.5 * Math.sin(a), cy: 22 - 18.5 * Math.cos(a), r: mid ? 1.5 : 1.0, "class": "dot" }, s);
  }
  sv("circle", { cx: 22, cy: 22, r: 13.6, fill: "url(#kgEdge)" }, s);
  sv("circle", { cx: 22, cy: 22, r: 12.8, fill: "url(#kgBody)", "class": "rim", stroke: "transparent", "stroke-width": 0.8 }, s);
  sv("circle", { cx: 22, cy: 22, r: 9.3, fill: "url(#kgTop)" }, s);
  var ptr = sv("line", { x1: 22, y1: 22, x2: 22, y2: 12, "class": "ptr" }, s);
  if (text) label(sec, cx, cy + d / 2 - 2, text);
  function upd() {
    var p = B.cur(), n = norm(p), t = (-135 + 270 * n) * Math.PI / 180;
    ptr.setAttribute("x1", 22 + 4 * Math.sin(t)); ptr.setAttribute("y1", 22 - 4 * Math.cos(t));
    ptr.setAttribute("x2", 22 + 11.2 * Math.sin(t)); ptr.setAttribute("y2", 22 - 11.2 * Math.cos(t));
  }
  bindKeys(B.keys, upd); upd();
  var y0 = 0, n0 = 0, drag = false, pc = null;
  w.title = (BY[B.keys[0]].tip ? BY[B.keys[0]].tip + "\n" : "") + "double-click resets · shift = fine · wheel";
  w.addEventListener("pointerdown", function (e) { drag = true; pc = B.cur(); dragSlot = pc.slot; y0 = e.clientY; n0 = norm(pc); w.classList.add("act"); try { w.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
  w.addEventListener("pointermove", function (e) { if (!drag) return; var span = pc.direct || pc.steps > 70 ? 150 : Math.max(60, pc.steps * 6); var dy = (y0 - e.clientY) / SCALE; setNorm(pc, n0 + dy / (e.shiftKey ? span * 4 : span)); flash(sec, pc); e.preventDefault(); });
  function end() { drag = false; dragSlot = -1; w.classList.remove("act"); }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
  w.addEventListener("dblclick", function () { var p = B.cur(); set(p.key, p.def); flash(sec, p); });
  w.addEventListener("wheel", function (e) { var p = B.cur(); step(p, e.deltaY < 0 ? 1 : -1, e.shiftKey ? 1 : Math.max(1, Math.round(p.steps / 48))); flash(sec, p); e.preventDefault(); }, { passive: false });
  return w;
}

// ---- LED lists + buttons
var WAVEICON = {
  sine: "M0 4 C2 -1 4 -1 6 4 S10 9 12 4", tri: "M0 4 L3 1 L9 7 L12 4", saw: "M0 7 L11 1 L11 7", rsaw: "M1 1 L1 7 L12 1", sq: "M0 6 L0 2 L6 2 L6 6 L12 6", pul: "M0 6 L0 2 L4 2 L4 6 L12 6"
};
function icon(kind) { var s = sv("svg", { viewBox: "0 0 12 8", width: 11, height: 7 }); sv("path", { d: WAVEICON[kind], fill: "none", stroke: "#e8e8ea", "stroke-width": 1.1, "stroke-linejoin": "round" }, s); return s; }
// items: strings or {icon:"sine"}; returns array of led elements
function ledList(sec, x, y, items, dy, cols, colW) {
  var leds = []; cols = cols || 1; colW = colW || 30; dy = dy || 8;
  var per = Math.ceil(items.length / cols);
  items.forEach(function (it, i) {
    var cx = x + Math.floor(i / per) * colW, cy = y + (i % per) * dy;
    var l = el("div", "led", sec); put(l, cx, cy + 1.8); leds.push(l);
    var t = el("div", "ll", sec); put(t, cx + 7, cy);
    if (it && it.icon) t.appendChild(icon(it.icon)); else t.textContent = it;
  });
  return leds;
}
function button(sec, cx, cy, w, h, text, cls) { var b = el("div", "btn" + (cls ? " " + cls : ""), sec); put(b, cx - w / 2, cy - h / 2, w, h); if (text) el("div", "t", b, text); return b; }
// cycle button bound to a selector param with an LED list
function cycleCtl(sec, key, ledX, ledY, items, btnX, btnY, text, o) {
  o = o || {};
  var leds = ledList(sec, ledX, ledY, items, o.dy || 8, o.cols, o.colW);
  var b = button(sec, btnX, btnY, o.bw || 26, o.bh || 10, null, o.cls);
  if (text) label(sec, btnX, btnY + (o.bh || 10) / 2 + 1, text);
  var p = BY[key];
  function upd() { var cur = Math.round(V[key] - p.min); leds.forEach(function (l, i) { l.className = "led" + (i === cur ? " on" : ""); }); }
  bindKeys([key], upd); upd();
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); var n = (Math.round(V[key] - p.min) + 1) % p.steps; set(key, p.min + n); if (o.after) o.after(n); flash(sec, p); });
  return b;
}
function toggleBtn(sec, key, cx, cy, w, h, text, cls, inv) {
  var b = button(sec, cx, cy, w, h, null, cls || "w"); var p = BY[key];
  function upd() { var on = (V[key] > 0.5) !== !!inv; b.classList.toggle("on", on); }
  bindKeys([key], upd); upd();
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); set(key, V[key] > 0.5 ? 0 : 1); flash(sec, p); });
  if (text) label(sec, cx, cy + h / 2 + 1, text);
  return b;
}

// ---- faders
function fader(sec, x, y, h, binding, text) {
  var B = mkB(binding);
  var f = el("div", "fd", sec); put(f, x - 9, y, 18, h);
  el("div", "slot", f);
  for (var i = 0; i <= 8; i++) { var t = el("div", "tick", f); t.style.top = (i * (h - 1) / 8) + "px"; if (i % 4 === 0) t.style.width = "9px"; }
  var cap = el("div", "cap", f);
  function upd() { var p = B.cur(), n = norm(p); cap.style.top = ((1 - n) * (h - 8) + 4) + "px"; }
  bindKeys(B.keys, upd); upd();
  var drag = false, pc = null;
  function mv(e) { var r = f.getBoundingClientRect(); var n = 1 - ((e.clientY - r.top) / SCALE - 4) / (h - 8); setNorm(pc, n); flash(sec, pc); }
  f.addEventListener("pointerdown", function (e) { drag = true; pc = B.cur(); dragSlot = pc.slot; try { f.setPointerCapture(e.pointerId); } catch (x) {} mv(e); e.preventDefault(); });
  f.addEventListener("pointermove", function (e) { if (drag) mv(e); });
  function end() { drag = false; dragSlot = -1; }
  f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  f.addEventListener("dblclick", function () { var p = B.cur(); set(p.key, p.def); });
  f.addEventListener("wheel", function (e) { var p = B.cur(); step(p, e.deltaY < 0 ? 1 : -1, 2); flash(sec, p); e.preventDefault(); }, { passive: false });
  if (text) label(sec, x, y + h + 3, text);
  return f;
}

// =====================================================================
//  layout — coordinates are the hardware photo's, relative to the faceplate
// =====================================================================
// header / footer
var hd = el("div", "logo", plate);
hd.innerHTML = '<svg viewBox="0 0 20 18"><path d="M1 17 L7.5 5 L11 11 L14 7 L19 17 Z" fill="none" stroke="#f2f2f2" stroke-width="1.7" stroke-linejoin="round"/><path d="M6.4 7 L7.5 5 L8.6 7 L7.5 6.5Z" fill="#f2f2f2"/></svg><span>KHEVEREST</span>';
el("div", "wm", plate, "KHEVEREST");
el("div", "foot l", plate, "THREE OSCILLATORS PER VOICE");
el("div", "foot r", plate, "EIGHT-VOICE POLYPHONIC SYNTHESISER");

// MASTER / ANIMATE
var sMaster = sect(0, 35, 60, 80, "Master");
knob(sMaster, 30, 40, 26, "Volume", "VOL");
var sAnim = sect(0, 117, 60, 110, "Animate");
var animBtn = [];
function animUpd() { var a = V.ANIM | 0; animBtn[0].classList.toggle("on", !!(a & 1)); animBtn[1].classList.toggle("on", !!(a & 2)); holdBtn.classList.toggle("on", !!(a & 4)); }
animBtn[0] = button(sAnim, 30, 33, 28, 28, "1", "w sq"); animBtn[1] = button(sAnim, 30, 66, 28, 28, "2", "w sq");
var holdBtn = button(sAnim, 30, 95, 30, 9, "Hold", "");
bindKeys(["ANIM"], animUpd);
[0, 1].forEach(function (i) {
  var bit = 1 << i, b = animBtn[i];
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); var a = V.ANIM | 0; if (a & 4) { set("ANIM", (a & bit) ? (a & ~bit) : (a | bit)); } else { set("ANIM", a | bit); } try { b.setPointerCapture(e.pointerId); } catch (x) {} });
  function up() { var a = V.ANIM | 0; if (!(a & 4)) set("ANIM", a & ~bit); }
  b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
});
holdBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); var a = V.ANIM | 0; if (a & 4) set("ANIM", 0); else set("ANIM", a | 4); });
animUpd();

// PATCH
var sPatch = sect(63, 35, 77, 192, "Patch");
var bInit = button(sPatch, 21, 28, 31, 11, null, "w"); label(sPatch, 21, 35, "Initialise");
var bComp = button(sPatch, 56, 28, 31, 11, null, "w"); label(sPatch, 56, 35, "Compare");
var bAud = button(sPatch, 21, 55, 31, 11, null, "w"); label(sPatch, 21, 62, "Audition");
var bSave = button(sPatch, 56, 55, 31, 11, null, "w"); label(sPatch, 56, 62, "Save");
var patchEnc = encoder(sPatch, 38, 116, 38);
var bPm = button(sPatch, 21, 172, 26, 10, null, ""); var bPp = button(sPatch, 56, 172, 26, 10, null, "");
label(sPatch, 21, 178, "−"); label(sPatch, 56, 178, "+"); label(sPatch, 38, 181, "Patch");

function encoder(sec, cx, cy, size) {
  var d = size + 8, e = el("div", "enc", sec); put(e, cx - d / 2, cy - d / 2, d, d);
  var s = sv("svg", { viewBox: "0 0 50 50", width: d, height: d }, e);
  sv("circle", { cx: 25, cy: 25, r: 23, fill: "url(#kgEdge)" }, s);
  sv("circle", { cx: 25, cy: 25, r: 21.6, fill: "url(#kgBody)", stroke: "#55565b", "stroke-width": 0.6 }, s);
  var g = sv("g", {}, s);
  for (var i = 0; i < 24; i++) { var a = i * 15 * Math.PI / 180; sv("line", { x1: 25 + 15 * Math.sin(a), y1: 25 - 15 * Math.cos(a), x2: 25 + 20.4 * Math.sin(a), y2: 25 - 20.4 * Math.cos(a), stroke: "rgba(255,255,255,.07)", "stroke-width": 1 }, g); }
  sv("circle", { cx: 25, cy: 25, r: 13.5, fill: "url(#kgTop)" }, s);
  sv("circle", { cx: 25, cy: 25, r: 2.2, fill: "#1b1c1f" }, s);
  var ang = 0; e.__rot = function (dir) { ang += dir * 14; g.setAttribute("transform", "rotate(" + ang + " 25 25)"); };
  return e;
}

// MENU
var sMenu = sect(142, 35, 286, 192, "Menu");
var menuBtns = {};
var MENU_LAYOUT = [["patch", "Patch", 0], ["osc", "Osc", 1], ["env", "Env", 1], ["lfo", "LFO", 1], ["arp", "Arp/Clock", 1], ["mod", "Mod", 2], ["voice", "Voice", 2], ["fx", "FX", 2], ["set", "Settings", 2]];
(function () {
  var xs = { osc: 70, env: 111, lfo: 152, arp: 193, mod: 70, voice: 111, fx: 152, set: 193 };
  MENU_LAYOUT.forEach(function (m) {
    var b;
    if (m[0] === "patch") { b = button(sMenu, 23, 40, 22, 17, null, "glow"); label(sMenu, 23, 49, "Patch"); }
    else { var y = m[2] === 1 ? 21 : 51; b = button(sMenu, xs[m[0]], y, 32, 11, null, "w"); label(sMenu, xs[m[0]], y + 6, m[1]); }
    menuBtns[m[0]] = b;
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); openMenu(m[0]); });
  });
})();
var voiceLeds = [];
(function () {
  for (var i = 0; i < 8; i++) { var l = el("div", "led", sMenu); put(l, 238 + (i % 4) * 11, 20 + Math.floor(i / 4) * 11); voiceLeds.push(l); var n = el("div", "ll", sMenu, String(i + 1)); put(n, 238 + (i % 4) * 11 + 0.5, 8.5 + Math.floor(i / 4) * 11 + 12); n.style.fontSize = "6px"; n.style.color = "#bbb"; }
  label(sMenu, 256, 47, "Active Voices");
})();
var rowBtns = [];
for (var rbI = 0; rbI < 3; rbI++) (function (i) { var b = button(sMenu, 24, 98 + i * 23, 34, 14, null, ""); rowBtns.push(b); b.addEventListener("pointerdown", function (e) { e.preventDefault(); oled.row = i; if (oled.menu === "mod" || oled.menu === "fxm") { if (i === 0) oled.field = 1 - oled.field; } oledRender(); }); })(rbI);
var oledEl = el("div", "", sMenu); oledEl.id = "oled"; put(oledEl, 46, 78, 190, 78);
var scr = el("div", "scr", oledEl);
var oledLines = [0, 1, 2, 3].map(function () { return el("div", "ol", scr); });
var bPg = [button(sMenu, 108, 170, 30, 10, null, "w"), button(sMenu, 143, 170, 30, 10, null, "w")];
label(sMenu, 125.5, 176, "◀ Page/Select ▶");
var valEnc = encoder(sMenu, 261, 114, 32);
var bVm = button(sMenu, 244, 170, 24, 10, null, ""), bVp = button(sMenu, 278, 170, 24, 10, null, "");
label(sMenu, 244, 176, "−"); label(sMenu, 278, 176, "+"); label(sMenu, 261, 179, "Value");

// ARP / GLIDE
var sArp = sect(430, 35, 52, 192, "Arp");
knob(sArp, 26, 44, 25, "Gate", "ARP_GATE");
toggleBtn(sArp, "ARP_LATCH", 26, 118, 30, 11, "Key Latch", "w");
toggleBtn(sArp, "ARP_ON", 26, 168, 30, 11, "On", "w");
var sGlide = sect(485, 120, 60, 107, "Glide");
knob(sGlide, 30, 44, 25, "Time", "GLIDE");
toggleBtn(sGlide, "GLIDE_ON", 30, 86, 30, 11, "On", "w");

// LFOs
function lfoSect(x, n) {
  var s = sect(x, 35, n === 1 ? 225 : 235, 82, "LFO " + n), q = "L" + n + "_";
  cycleCtl(s, q + "TYPE", 10, 12, [{ icon: "tri" }, { icon: "rsaw" }, { icon: "sq" }, "S+H"], 22, 61, "Type", { bw: 28 });
  knob(s, 88, 36, 24, "Fade Time", q + "FADE");
  cycleCtl(s, q + "RANGE", n === 1 ? 133 : 143, 18, ["Low", "High", "Sync"], n === 1 ? 143 : 153, 59, "Range", { bw: 26 });
  knob(s, n === 1 ? 198 : 208, 36, 24, "Rate", { keys: [q + "RANGE", q + "RATE", q + "SYNC"], cur: function () { return BY[V[q + "RANGE"] === 2 ? q + "SYNC" : q + "RATE"]; } });
  bracket(s, n === 1 ? 138 : 148, n === 1 ? 198 : 208, 69);
  return s;
}
lfoSect(485, 1); lfoSect(715, 2);

// ENVELOPES
var sAmp = sect(548, 120, 162, 107, "Amp Envelope");
["A", "D", "S", "R"].forEach(function (k, i) { fader(sAmp, 24 + i * 36, 14, 62, "EA_" + k, ["Attack", "Decay", "Sustain", "Release"][i]); });
var sMod = sect(715, 120, 235, 107, "Mod Envelopes");
(function () {
  var leds = ledList(sMod, 12, 28, ["1", "2"], 8);
  var b = button(sMod, 24, 66, 28, 10, null, ""); label(sMod, 24, 72, "Select");
  function upd() { var c = V.ENV_SEL | 0; leds.forEach(function (l, i) { l.className = "led" + (i === c ? " on" : ""); }); }
  bindKeys(["ENV_SEL"], upd); upd();
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); set("ENV_SEL", 1 - (V.ENV_SEL | 0)); });
  ["A", "D", "S", "R"].forEach(function (k, i) {
    fader(sMod, 76 + i * 42, 14, 62, { keys: ["ENV_SEL", "EM1_" + k, "EM2_" + k], cur: function () { return BY[(V.ENV_SEL | 0) ? "EM2_" + k : "EM1_" + k]; } }, ["Attack", "Decay", "Sustain", "Release"][i]);
  });
})();

// OSCILLATORS
function oscRow(n, y) {
  var o = "O" + n + "_", s = sect(0, y, 428, 77, "Oscillator " + n, true);
  cycleCtl(s, o + "RANGE", 8, 20, ["16'", "8'", "4'", "2'"], 22, 56, "Range", { dy: 8, cols: 2, colW: 18, bw: 28 });
  knob(s, 70, 36, 25, "Coarse", o + "COARSE");
  knob(s, 120, 36, 25, "Fine", o + "FINE");
  cycleCtl(s, o + "WAVE", 148, 16, [{ icon: "sine" }, { icon: "tri" }, { icon: "saw" }, { icon: "pul" }, "more"], 170, 56, "Wave", { dy: 8, cols: 2, colW: 24, bw: 28 });
  knob(s, 218, 36, 25, "Mod Env 2 Depth", o + "ENV2");
  knob(s, 270, 36, 25, "LFO 2 Depth", o + "LFO2");
  bracket(s, 236, 286, 62); label(s, 261, 68, "Pitch");
  knob(s, 330, 36, 25, "Shape Amount", { keys: [o + "SRC", o + "SHAPE", o + "SHENV", o + "SHLFO"], cur: function () { return BY[[o + "SHAPE", o + "SHENV", o + "SHLFO"][clamp(V[o + "SRC"] | 0, 0, 2)]]; } });
  cycleCtl(s, o + "SRC", 366, 22, ["Manual", "Mod Env 1", "LFO 1"], 391, 56, null, { dy: 8, bw: 26 });
  bracket(s, 338, 396, 62); label(s, 367, 68, "Source");
  return s;
}
oscRow(1, 230); oscRow(2, 313); oscRow(3, 396);

// MIXER
var sMix = sect(430, 230, 112, 243, "Mixer", true);
[["MIX1", "Osc 1", 30, 40], ["VCAGAIN", "VCA Gain", 82, 40], ["MIX2", "Osc 2", 30, 120], ["MIXR", "Ring 1*2", 82, 120], ["MIX3", "Osc 3", 30, 200], ["MIXN", "Noise", 82, 200]].forEach(function (m) { knob(sMix, m[2], m[3], 25, m[1], m[0]); });

// FILTER
var sFil = sect(545, 230, 168, 243, "Filter", true);
knob(sFil, 28, 40, 25, "LFO 1 Depth", "F_LFO1"); knob(sFil, 84, 40, 25, "Osc 3 Filter Mod", "F_OSC3"); knob(sFil, 140, 40, 25, "Key Tracking", "F_KEY");
knob(sFil, 28, 108, 25, "Env Depth", { keys: ["F_ENVSEL", "F_ENVAMP", "F_ENVMOD"], cur: function () { return BY[(V.F_ENVSEL | 0) === 0 ? "F_ENVAMP" : "F_ENVMOD"]; } });
knob(sFil, 84, 108, 25, "Resonance", "F_RES"); knob(sFil, 140, 108, 25, "Overdrive", "F_OD");
cycleCtl(sFil, "F_ENVSEL", 10, 140, ["Amp Env", "Mod Env 1"], 28, 168, "Source", { dy: 8, bw: 26 });
cycleCtl(sFil, "F_SLOPE", 10, 192, ["12 dB", "24 dB"], 28, 217, "Slope", { dy: 8, bw: 26 });
knob(sFil, 84, 186, 40, "Frequency", "F_FREQ");
cycleCtl(sFil, "F_SHAPE", 126, 176, ["LP", "BP", "HP"], 144, 217, "Shape", { dy: 8, bw: 26 });

// DISTORTION / CHORUS / DELAY / EFFECTS / REVERB
var sDist = sect(715, 230, 57, 80, "Distortion"); knob(sDist, 28, 44, 25, "Level", "DIST");
var sCho = sect(775, 230, 175, 80, "Chorus");
knob(sCho, 36, 44, 25, "Rate", "CH_RATE");
cycleCtl(sCho, "CH_TYPE", 86, 24, ["1", "2", "3"], 98, 62, "Type", { dy: 8, bw: 26 });
knob(sCho, 142, 44, 25, "Level", "CH_LEVEL");
var sDel = sect(715, 313, 235, 77, "Delay");
knob(sDel, 38, 42, 25, "Feedback", "DL_FB");
knob(sDel, 106, 42, 25, "Time", { keys: ["DL_SYNC", "DL_TIME", "DL_SYNCR"], cur: function () { return BY[V.DL_SYNC > 0.5 ? "DL_SYNCR" : "DL_TIME"]; } });
toggleBtn(sDel, "DL_SYNC", 158, 28, 28, 10, "Sync", "w"); bracket(sDel, 92, 170, 63);
knob(sDel, 206, 42, 25, "Level", "DL_LEVEL");
var sFx = sect(715, 396, 57, 77, "Effects"); toggleBtn(sFx, "FX_BYPASS", 28, 40, 30, 11, "Bypass", "w", true);
var sRev = sect(775, 396, 175, 77, "Reverb");
knob(sRev, 36, 42, 25, "Time", "RV_TIME");
cycleCtl(sRev, "RV_TYPE", 86, 22, ["1", "2", "3"], 98, 58, "Type", { dy: 8, bw: 26, after: function (n) { set("RV_SIZE", [0, 64, 127][n]); } });
knob(sRev, 142, 42, 25, "Level", "RV_LEVEL");

// =====================================================================
//  OLED + menus (manual pp.11, 17-36)
// =====================================================================
var oled = { menu: "patch", row: 0, field: 0 }, pg = { patch: 0, osc: 0, env: 0, lfo: 0, arp: 0, mod: 0, voice: 0, fx: 0, set: 0 };
function pgs(t, rows) { return { t: t, rows: rows }; }
var PAGES = {
  osc: [
    pgs("OSC COMN 1", [["DIVERGE", "Diverge"], ["DRIFT", "Drift"], ["NOISELPF", "Noise"]]),
    pgs("OSC COMN 2", [["KEYSYNC", "KeySync"], ["TUNING", "TuningTable"]]),
    pgs("OSCILLATOR 1", [["O1_MORE", "WaveMore"], ["O1_FIXED", "FixedNote"], ["O1_BEND", "BendRange"]]), pgs("OSCILLATOR 1", [["O1_VSYNC", "Vsync"], ["O1_SAWD", "SawDense"], ["O1_DDET", "DenseDet"]]),
    pgs("OSCILLATOR 2", [["O2_MORE", "WaveMore"], ["O2_FIXED", "FixedNote"], ["O2_BEND", "BendRange"]]), pgs("OSCILLATOR 2", [["O2_VSYNC", "Vsync"], ["O2_SAWD", "SawDense"], ["O2_DDET", "DenseDet"]]),
    pgs("OSCILLATOR 3", [["O3_MORE", "WaveMore"], ["O3_FIXED", "FixedNote"], ["O3_BEND", "BendRange"]]), pgs("OSCILLATOR 3", [["O3_VSYNC", "Vsync"], ["O3_SAWD", "SawDense"], ["O3_DDET", "DenseDet"]]),
  ],
  env: [
    pgs("AMP ENVELOPE", [["EA_VEL", "Velocity"], ["EA_TRIG", "MonoTrig"]]), pgs("AMP ENVELOPE", [["EA_HOLD", "HoldTime"], ["EA_REP", "Repeats"]]),
    pgs("MOD ENVELOPE 1", [["EM1_VEL", "Velocity"], ["EM1_TRIG", "MonoTrig"]]), pgs("MOD ENVELOPE 1", [["EM1_HOLD", "HoldTime"], ["EM1_REP", "Repeats"]]),
    pgs("MOD ENVELOPE 2", [["EM2_VEL", "Velocity"], ["EM2_TRIG", "MonoTrig"]]), pgs("MOD ENVELOPE 2", [["EM2_HOLD", "HoldTime"], ["EM2_REP", "Repeats"]]),
  ],
  lfo: [
    pgs("LFO 1", [["L1_PHASE", "Phase"], ["L1_MONO", "MonoTrig"], ["L1_SLEW", "Slew"]]), pgs("LFO 1", [["L1_FMODE", "FadeMode"], ["L1_FSYNC", "FadeSync"]]), pgs("LFO 1", [["L1_REP", "Repeats"], ["L1_COMMON", "Common"]]),
    pgs("LFO 2", [["L2_PHASE", "Phase"], ["L2_MONO", "MonoTrig"], ["L2_SLEW", "Slew"]]), pgs("LFO 2", [["L2_FMODE", "FadeMode"], ["L2_FSYNC", "FadeSync"]]), pgs("LFO 2", [["L2_REP", "Repeats"], ["L2_COMMON", "Common"]]),
    pgs("LFO 3", [["L3_WAVE", "L3Waveform"], ["L3_RATE", "L3Rate"], ["L3_SYNC", "L3RateSync"]]), pgs("LFO 4", [["L4_WAVE", "L4Waveform"], ["L4_RATE", "L4Rate"], ["L4_SYNC", "L4RateSync"]]),
  ],
  arp: [
    pgs("CLOCK", [["ARP_BPM", "ClockRate"], ["ARP_SRC", "Source"], ["@status", "status"]]), pgs("ARP", [["ARP_TYPE", "Type"], ["ARP_RHYTHM", "Rhythm"], ["ARP_OCT", "Octaves"]]), pgs("ARP", [["ARP_SWING", "Swing"], ["ARP_SYNC", "SyncRate"], ["ARP_KSYNC", "KeySync"]]),
  ],
  voice: [
    pgs("VOICE", [["UNISON", "Unison"], ["UNIDET", "UniDeTune"], ["UNISPR", "UniSpread"]]), pgs("VOICE", [["PREGLIDE", "PreGlide"], ["MODE", "Mode"], ["PATCHLVL", "PatchLevel"]]), pgs("VOICE", [["F_POST", "FltPostDrv"], ["F_DIV", "FltDiverge"], ["KBDOCT", "KbdOctave"]]),
  ],
  fx: [
    pgs("FX GLOBAL", [["FX_WET", "WetLevel"], ["FX_DRY", "DryLevel"], ["FX_ROUTE", "Routing"]]),
    pgs("CHORUS", [["CH_DEPTH", "ChorDepth"], ["CH_FB", "ChorFback"]]), pgs("CHORUS", [["CH_LP", "LoPass"], ["CH_HP", "HiPass"]]),
    pgs("DELAY", [["DL_SYNCR", "DelaySync"], ["DL_LP", "LP Damp"], ["DL_HP", "HP Damp"]]), pgs("DELAY", [["DL_LR", "L/R Ratio"], ["DL_SLEW", "SlewRate"], ["DL_WIDTH", "Width"]]),
    pgs("REVERB", [["RV_PRE", "PreDelay"], ["RV_LP", "LP Damp"], ["RV_HP", "HP Damp"]]), pgs("REVERB", [["RV_SIZE", "RevSize"], ["RV_MOD", "ModDepth"], ["RV_MODR", "ModRate"]]), pgs("REVERB", [["RV_LOP", "LoPass"], ["RV_HIP", "HiPass"]]),
    { t: "FX MOD", fxm: 1 }, { t: "FX MOD", fxm: 2 }, { t: "FX MOD", fxm: 3 }, { t: "FX MOD", fxm: 4 },
  ],
  set: [
    pgs("SYSTEM", [["@bright", "Brightness"], ["@version", "Version"]]), pgs("SYNTH", [["VELSHAPE", "VelShape"], ["TUNECENTS", "TuneCents"], ["TRANSPOSE", "Transpose"]]), pgs("MISC SETTINGS", [["VOLRANGE", "VolRange"], ["@ini", "Initialise"]]),
  ],
};
PAGES.mod = []; for (var mi = 1; mi <= 16; mi++) PAGES.mod.push({ t: "[Slot " + mi + "]", mod: mi });
var ARPSTAT = "INT";
var settings = { bright: 64, ini: 0 };
try { var _s = JSON.parse(localStorage.getItem("kh.settings") || "{}"); if (typeof _s.ini === "number") settings.ini = _s.ini; } catch (x) {}

function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) : s; }
function line2(a, b, w) { a = String(a); b = String(b); var sp = w - a.length - b.length; if (sp < 1) { b = b.slice(0, Math.max(1, w - a.length - 1)); sp = w - a.length - b.length; } return a + new Array(sp + 1).join(" ") + b; }
function rowValue(spec) {
  var k = spec[0];
  if (k === "@status") return ARPSTAT + " " + (BY.ARP_BPM ? V.ARP_BPM.toFixed(2) : "") + "bpm";
  if (k === "@bright") return String(settings.bright);
  if (k === "@version") return "0221";
  if (k === "@ini") return settings.ini ? "Live" : "IniPatch";
  return fmtVal(BY[k]);
}
function curPages() { return PAGES[oled.menu]; }
function pageRows(page) { return page.rows || []; }

// ---- patches
var PL = DATA.presets.slice();          // factory + user list
var userPatches = [];
try { userPatches = JSON.parse(localStorage.getItem("kh.user") || "[]"); } catch (x) {}
var cats = ["All"]; DATA.presets.forEach(function (p) { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); }); if (userPatches.length) cats.push("User");
var cur = { idx: 0, cat: 0, name: "Init Patch" };
function allPatches() { var a = DATA.presets.map(function (p, i) { return { p: p, id: i }; }); userPatches.forEach(function (u, i) { a.push({ p: { name: u.name, cat: "User", user: u }, id: DATA.presets.length + i }); }); return a; }
function filtered() { var c = cats[cur.cat], a = allPatches(); return c === "All" ? a : a.filter(function (x) { return x.p.cat === c; }); }
var loadedSnap = snapshot();
function loadPatchObj(p) {
  var base = {}; if (p.user) base = p.user.snap; else for (var k in p.diff) base[k] = p.diff[k];
  applySnap(base);
  loadedSnap = snapshot(); cur.name = p.name; dirty = false; oledRender();
}
function loadIndex(id) { var a = allPatches(); id = ((id % a.length) + a.length) % a.length; cur.idx = id; loadPatchObj(a[id].p); }
function stepPatch(dir) {
  var f = filtered(); if (!f.length) return;
  var pos = -1; for (var i = 0; i < f.length; i++) if (f[i].id === cur.idx) { pos = i; break; }
  pos = pos < 0 ? (dir > 0 ? 0 : f.length - 1) : (pos + dir + f.length) % f.length;
  cur.idx = f[pos].id; loadPatchObj(f[pos].p);
}
function initPatch() { if (settings.ini === 1) { cur.name = "Init Patch"; loadedSnap = snapshot(); dirty = false; oledRender(); } else { applySnap({}); loadedSnap = snapshot(); cur.name = "Init Patch"; cur.idx = 0; dirty = false; oledRender(); } }

// ---- OLED rendering
function oledRender() {
  var L = oledLines, i;
  for (i = 0; i < 4; i++) { L[i].textContent = ""; L[i].className = "ol"; }
  if (temp) {
    L[0].textContent = trunc(temp[0], 20); L[1].textContent = trunc(temp[1], 20); L[2].textContent = " " + trunc(temp[2], 19);
    return;
  }
  for (var m in menuBtns) menuBtns[m].classList.toggle("glow", m === oled.menu);
  if (oled.menu === "patch") {
    var f = filtered(), pos = 0; for (i = 0; i < f.length; i++) if (f[i].id === cur.idx) pos = i;
    L[0].textContent = line2(trunc(cur.name, 15), "1/1", 20);
    var num = String(cur.idx).padStart(3, "0");
    var bank = "ABCD"[Math.min(3, Math.floor(cur.idx / 128) + (cur.idx >= DATA.presets.length ? 1 : 0))];
    L[1].textContent = line2("Patch", num + (dirty ? " *" : "  "), 19) + "▶";
    L[2].textContent = line2("Bank", bank, 19);
    L[3].textContent = line2("Category", trunc(cats[cur.cat], 9), 19);
    L[1 + oled.row].classList.add("sel");
    return;
  }
  var pages = curPages(), pgi = pg[oled.menu] = clamp(pg[oled.menu], 0, pages.length - 1), page = pages[pgi];
  L[0].textContent = line2(page.t, (pgi + 1) + "/" + pages.length, 20);
  if (page.mod || page.fxm) {
    var n = page.mod || page.fxm, fx = !!page.fxm, pre = fx ? "FM" + n + "_" : "MM" + n + "_";
    var sA = fmtVal(BY[pre + "A"]), sB = fmtVal(BY[pre + "B"]);
    L[1].innerHTML = "";
    var t = document.createElement("span"); t.textContent = ":sA "; L[1].appendChild(t);
    var fa = el("span", "fld" + (oled.field === 0 ? " sf" : ""), L[1], trunc(sA, 8)); var sp = document.createElement("span"); sp.textContent = new Array(Math.max(1, 8 - Math.min(8, sA.length)) + 2).join(" ") + ":sB "; L[1].appendChild(sp);
    var fb = el("span", "fld" + (oled.field === 1 ? " sf" : ""), L[1], trunc(sB, 8));
    fa.onclick = function () { oled.row = 0; oled.field = 0; oledRender(); }; fb.onclick = function () { oled.row = 0; oled.field = 1; oledRender(); };
    L[2].textContent = line2(fx ? "Fx Destin" : "Destin", fmtVal(BY[pre + "DEST"]), 20);
    L[3].textContent = line2("Depth", fmtVal(BY[pre + "DEPTH"]), 20);
    L[1 + oled.row].classList.add("sel");
    return;
  }
  var rows = pageRows(page);
  for (i = 0; i < 3; i++) {
    if (i < rows.length) L[1 + i].textContent = line2(rows[i][1], trunc(rowValue(rows[i]), 10), 19) + (i === 0 && pgi < pages.length - 1 ? "▶" : "");
  }
  if (oled.row >= rows.length) oled.row = Math.max(0, rows.length - 1);
  if (rows.length) L[1 + oled.row].classList.add("sel");
}
function openMenu(m) { oled.menu = m; oled.row = 0; oled.field = 0; temp = null; oledRender(); }
function adjustRow(dir, mult) {
  mult = mult || 1;
  if (oled.menu === "patch") {
    if (oled.row === 0) stepPatch(dir);
    else if (oled.row === 2) { cur.cat = (cur.cat + dir + cats.length) % cats.length; oledRender(); }
    return;
  }
  var page = curPages()[pg[oled.menu]];
  if (page.mod || page.fxm) {
    var n = page.mod || page.fxm, pre = page.fxm ? "FM" + n + "_" : "MM" + n + "_";
    var key = oled.row === 0 ? pre + (oled.field ? "B" : "A") : oled.row === 1 ? pre + "DEST" : pre + "DEPTH";
    step(BY[key], dir, oled.row === 2 ? mult : 1); oledRender(); return;
  }
  var rows = pageRows(page), spec = rows[oled.row]; if (!spec) return;
  var k = spec[0];
  if (k === "@bright") { settings.bright = clamp(settings.bright + dir * 8 * mult, 0, 127); oledEl.style.opacity = 0.35 + settings.bright / 127 * 0.65; }
  else if (k === "@ini") { settings.ini = 1 - settings.ini; try { localStorage.setItem("kh.settings", JSON.stringify(settings)); } catch (x) {} }
  else if (k[0] === "@") return;
  else step(BY[k], dir, mult);
  oledRender();
}
function pageMove(d) {
  if (oled.menu === "patch") { oled.row = clamp(oled.row + d, 0, 2); oledRender(); return; }
  var n = curPages().length; pg[oled.menu] = clamp(pg[oled.menu] + d, 0, n - 1); oled.row = 0; oled.field = 0; oledRender();
}
// row selection on the screen itself
[1, 2, 3].forEach(function (i) { oledLines[i].addEventListener("pointerdown", function (e) { if (e.target.classList && e.target.classList.contains("fld")) return; oled.row = i - 1; oledRender(); }); });
oledEl.addEventListener("wheel", function (e) { adjustRow(e.deltaY < 0 ? 1 : -1, e.shiftKey ? 5 : 1); e.preventDefault(); }, { passive: false });
function repeater(b, fn) {
  var t = 0, iv = 0;
  b.addEventListener("pointerdown", function (e) { e.preventDefault(); fn(); t = setTimeout(function () { iv = setInterval(fn, 90); }, 420); try { b.setPointerCapture(e.pointerId); } catch (x) {} });
  function up() { clearTimeout(t); clearInterval(iv); }
  b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
}
repeater(bVp, function () { adjustRow(1, 1); valEnc.__rot(1); });
repeater(bVm, function () { adjustRow(-1, 1); valEnc.__rot(-1); });
repeater(bPg[0], function () { pageMove(-1); }); repeater(bPg[1], function () { pageMove(1); });
repeater(bPp, function () { stepPatch(1); patchEnc.__rot(1); }); repeater(bPm, function () { stepPatch(-1); patchEnc.__rot(-1); });
function encDrag(e, fn, rot) {
  var y0 = 0, acc = 0, drag = false;
  e.addEventListener("pointerdown", function (ev) { drag = true; y0 = ev.clientY; acc = 0; try { e.setPointerCapture(ev.pointerId); } catch (x) {} ev.preventDefault(); });
  e.addEventListener("pointermove", function (ev) { if (!drag) return; acc += (y0 - ev.clientY) / SCALE; y0 = ev.clientY; while (acc >= 5) { fn(1, ev.shiftKey ? 5 : 1); e.__rot(1); acc -= 5; } while (acc <= -5) { fn(-1, ev.shiftKey ? 5 : 1); e.__rot(-1); acc += 5; } });
  function end() { drag = false; } e.addEventListener("pointerup", end); e.addEventListener("pointercancel", end);
  e.addEventListener("wheel", function (ev) { fn(ev.deltaY < 0 ? 1 : -1, ev.shiftKey ? 5 : 1); e.__rot(ev.deltaY < 0 ? 1 : -1); ev.preventDefault(); }, { passive: false });
}
encDrag(valEnc, function (d, m) { adjustRow(d, m); });
encDrag(patchEnc, function (d) { stepPatch(d); });

// PATCH buttons
bInit.addEventListener("pointerdown", function (e) { e.preventDefault(); initPatch(); });
var cmpEdited = null;
bComp.addEventListener("pointerdown", function (e) { e.preventDefault(); cmpEdited = snapshot(); applySnap(loadedSnap); bComp.classList.add("on"); try { bComp.setPointerCapture(e.pointerId); } catch (x) {} });
function cmpUp() { if (cmpEdited) { applySnap(cmpEdited); cmpEdited = null; } bComp.classList.remove("on"); }
bComp.addEventListener("pointerup", cmpUp); bComp.addEventListener("pointercancel", cmpUp);
bAud.addEventListener("pointerdown", function (e) { e.preventDefault(); host("noteOn", 60, 0.8); bAud.classList.add("on"); try { bAud.setPointerCapture(e.pointerId); } catch (x) {} });
function audUp() { host("noteOff", 60); bAud.classList.remove("on"); }
bAud.addEventListener("pointerup", audUp); bAud.addEventListener("pointercancel", audUp);
var saveDlg = document.getElementById("saveDlg"), saveName = document.getElementById("saveName");
bSave.addEventListener("pointerdown", function (e) { e.preventDefault(); saveName.value = cur.name === "Init Patch" ? "My Patch" : cur.name; saveDlg.hidden = false; setTimeout(function () { saveName.focus(); saveName.select(); }, 0); });
document.getElementById("saveNo").onclick = function () { saveDlg.hidden = true; };
document.getElementById("saveOk").onclick = function () {
  var nm = (saveName.value || "My Patch").trim().slice(0, 20), snap = snapshot();
  userPatches.push({ name: nm, snap: snap }); try { localStorage.setItem("kh.user", JSON.stringify(userPatches)); } catch (x) {}
  if (cats.indexOf("User") < 0) cats.push("User");
  cur.idx = DATA.presets.length + userPatches.length - 1; cur.name = nm; loadedSnap = snap; dirty = false; saveDlg.hidden = true; oledRender();
};

// voices / meters
if (window.vstai && window.vstai.onDisplay) window.vstai.onDisplay(function (d) { for (var i = 0; i < 8; i++) voiceLeds[i].className = "led" + ((d[i] || 0) > 0.02 ? " on" : ""); });

// =====================================================================
//  keyboard drawer: wheels, pedals, 5-octave keys + computer keyboard
// =====================================================================
var keysEl = document.getElementById("keys");
var kbBtn = button(plate, 0, 0, 44, 13, "KEYS", ""); kbBtn.id = "kbBtn"; kbBtn.style.left = "330px"; kbBtn.style.top = "11px"; kbBtn.style.right = "auto";
var kbBuilt = false;
function wheel(parent, key, spring, text) {
  var w = el("div", "whl", parent), ind = el("i", "", w); el("b", "", w, text);
  var p = BY[key], drag = false;
  function upd() { var n = norm(p); ind.style.top = ((1 - n) * 92 + 4) + "%"; }
  bindKeys([key], upd); upd();
  function mv(e) { var r = w.getBoundingClientRect(); setNorm(p, 1 - clamp((e.clientY - r.top) / r.height, 0, 1)); }
  w.addEventListener("pointerdown", function (e) { drag = true; try { w.setPointerCapture(e.pointerId); } catch (x) {} mv(e); e.preventDefault(); });
  w.addEventListener("pointermove", function (e) { if (drag) mv(e); });
  function end() { drag = false; if (spring) set(key, 0); }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
}
function buildKeys() {
  kbBuilt = true;
  var c = el("div", "ctl", keysEl);
  wheel(c, "WHEEL_BEND", true, "PITCH"); wheel(c, "WHEEL_MOD", false, "MOD");
  var sl = el("div", "sl", c);
  [["EXPR1", "Pedal 1", 0, 1], ["EXPR2", "Pedal 2", 0, 1], ["AFTERT", "Aftertouch", 0, 1], ["CVIN", "CV In", -1, 1]].forEach(function (d) {
    var l = el("label", "", sl, d[1]), r = el("input", "", l); r.type = "range"; r.min = d[2]; r.max = d[3]; r.step = 0.01; r.value = V[d[0]];
    r.addEventListener("input", function () { set(d[0], +r.value); });
    bindKeys([d[0]], function () { r.value = V[d[0]]; });
  });
  var kb = el("div", "kb", keysEl), held = {};
  var first = 36, nw = 36, white = [0, 2, 4, 5, 7, 9, 11], wi = 0;
  function on(note, node, e) { if (held[note]) return; held[note] = 1; host("noteOn", note, 0.78); node.classList.add("hit"); }
  function off(note, node) { if (!held[note]) return; delete held[note]; host("noteOff", note); node.classList.remove("hit"); }
  function key(note, node) {
    node.addEventListener("pointerdown", function (e) { e.preventDefault(); on(note, node); try { node.setPointerCapture(e.pointerId); } catch (x) {} });
    node.addEventListener("pointerup", function () { off(note, node); }); node.addEventListener("pointercancel", function () { off(note, node); });
    node.__note = note; KEYNODES[note] = node;
  }
  for (var o = 0; o < 6; o++) for (var k = 0; k < 7; k++) {
    var note = first + o * 12 + white[k]; if (wi >= nw) break;
    var w = el("div", "wk", kb); w.style.left = (wi * 100 / nw) + "%"; w.style.width = (100 / nw) + "%"; key(note, w);
    if ([0, 1, 3, 4, 5].indexOf(k) >= 0) { var b = el("div", "bk", kb); b.style.left = ((wi + 1) * 100 / nw - 0.95) + "%"; b.style.width = "1.9%"; key(note + 1, b); }
    wi++;
  }
}
var KEYNODES = {};
function toggleKeys() { if (!kbBuilt) buildKeys(); keysEl.hidden = !keysEl.hidden; layout(); }
kbBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); toggleKeys(); });
// computer keyboard
var CK = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 }, ckOct = 60, ckDown = {};
window.addEventListener("keydown", function (e) {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  var k = e.key.toLowerCase();
  if (k === "z") { ckOct = Math.max(24, ckOct - 12); return; } if (k === "x") { ckOct = Math.min(96, ckOct + 12); return; }
  if (CK[k] === undefined || e.repeat || ckDown[k]) return;
  var n = ckOct + CK[k]; ckDown[k] = n; host("noteOn", n, 0.78); if (KEYNODES[n]) KEYNODES[n].classList.add("hit");
});
window.addEventListener("keyup", function (e) { var k = e.key.toLowerCase(); if (ckDown[k] !== undefined) { var n = ckDown[k]; delete ckDown[k]; host("noteOff", n); if (KEYNODES[n]) KEYNODES[n].classList.remove("hit"); } });

// =====================================================================
//  matrix editor (plug-in convenience: all 16 + 4 slots in one table)
// =====================================================================
var mxEl = document.getElementById("matrix"), mxBuilt = false;
var mxBtn = button(plate, 0, 0, 52, 13, "MATRIX", ""); mxBtn.style.left = "386px"; mxBtn.style.top = "11px";
function mkSelect(parent, key) {
  var p = BY[key], s = el("select", "", parent);
  p.fmt.forEach(function (nm, i) { var o = el("option", "", s, nm); o.value = i; });
  s.addEventListener("change", function () { set(key, p.min + (+s.value)); });
  bindKeys([key], function () { s.value = Math.round(V[key] - p.min); }); s.value = Math.round(V[key] - p.min);
  return s;
}
function mkDepth(parent, key) {
  var p = BY[key], r = el("input", "", parent), t = el("span", "", parent, " "); r.type = "range"; r.min = 0; r.max = p.steps - 1; r.step = 1; r.value = R[key];
  r.addEventListener("input", function () { setRaw(p, +r.value); touch(p); push(p.slot); markDirty(); });
  function upd() { r.value = R[key]; t.textContent = " " + fmtVal(p); }
  bindKeys([key], upd); upd();
}
function buildMatrix() {
  mxBuilt = true;
  var x = el("button", "x", mxEl, "Close"); x.onclick = function () { mxEl.hidden = true; };
  el("h3", "", mxEl, "MODULATION MATRIX — 16 slots · A × B → destination");
  var t = el("table", "", mxEl), h = el("tr", "", t); ["#", "Source A", "Source B", "Destination", "Depth"].forEach(function (c) { el("th", "", h, c); });
  for (var n = 1; n <= 16; n++) { var tr = el("tr", "", t); el("td", "", tr, String(n)); mkSelect(el("td", "", tr), "MM" + n + "_A"); mkSelect(el("td", "", tr), "MM" + n + "_B"); mkSelect(el("td", "", tr), "MM" + n + "_DEST"); mkDepth(el("td", "", tr), "MM" + n + "_DEPTH"); }
  el("h3", "", mxEl, "FX MODULATION MATRIX — 4 slots").style.marginTop = "14px";
  var t2 = el("table", "", mxEl), h2 = el("tr", "", t2); ["#", "Source A", "Source B", "Destination", "Depth"].forEach(function (c) { el("th", "", h2, c); });
  for (var m = 1; m <= 4; m++) { var tr2 = el("tr", "", t2); el("td", "", tr2, String(m)); mkSelect(el("td", "", tr2), "FM" + m + "_A"); mkSelect(el("td", "", tr2), "FM" + m + "_B"); mkSelect(el("td", "", tr2), "FM" + m + "_DEST"); mkDepth(el("td", "", tr2), "FM" + m + "_DEPTH"); }
}
mxBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); if (!mxBuilt) buildMatrix(); mxEl.hidden = !mxEl.hidden; });

// =====================================================================
//  scaling
// =====================================================================
function layout() {
  var kh = keysEl.hidden ? 0 : 116;
  var s = Math.min(window.innerWidth / 1018, (window.innerHeight - kh) / 536);
  SCALE = s > 0 ? s : 1;
  stage.style.transform = "scale(" + SCALE + ")";
  stage.style.left = Math.max(0, (window.innerWidth - 1018 * SCALE) / 2) + "px";
  stage.style.top = Math.max(0, ((window.innerHeight - kh) - 536 * SCALE) / 2) + "px";
}
window.addEventListener("resize", layout); layout();

// host → panel: automation / session restore (and replay of the restored sound at boot)
if (window.vstai && window.vstai.onParam) window.vstai.onParam(function (i, v) { if (i === dragSlot) return; if (FIELDS[i]) { decodeSlot(i, +v); oledRender(); } });
oledRender();
ready = true;
// test hooks
window.__kh = { V: V, R: R, NSLOT: NSLOT, slotValue: slotValue, applyPatch: function (o) { applySnap(o || {}); }, loadIndex: loadIndex, openMenu: openMenu, snapshot: snapshot, DATA: DATA };
})();
