(function () {
"use strict";
// =====================================================================
//  CATACLYSM panel. Every control is a "logical parameter"; build.mjs packs
//  them several-to-a-host-slot (mixed radix). This script owns the packing:
//  R[key] = raw integer, V[key] = actual value, slot = Σ R·mult.
// =====================================================================
var P = DATA.params, BY = {}, FIELDS = {}, SV = "http://www.w3.org/2000/svg";
var R = {}, V = {}, CTL = {}, VIS = {}, dragSlot = -1;
P.forEach(function (p) { BY[p.key] = p; (FIELDS[p.slot] = FIELDS[p.slot] || []).push(p); });
var NSLOT = DATA.slots;

function el(tag, cls, parent, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; }
function sv(tag, attrs, parent) { var e = document.createElementNS(SV, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function host(f) { var a = [].slice.call(arguments, 1); if (window.vstai && typeof window.vstai[f] === "function") window.vstai[f].apply(window.vstai, a); }

// ---------- packing ----------
function rawToActual(p, r) {
  if (p.curve === "int") return p.min + r;
  var n = p.steps > 1 ? r / (p.steps - 1) : 0;
  return p.curve === "exp" ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min);
}
function actualToRaw(p, v) {
  if (p.curve === "int") return clamp(Math.round(v - p.min), 0, p.steps - 1);
  var n = p.curve === "exp" ? Math.log(Math.max(v, p.min) / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
  return clamp(Math.round(n * (p.steps - 1)), 0, p.steps - 1);
}
function slotValue(s) {
  var f = FIELDS[s], t = 0;
  for (var i = 0; i < f.length; i++) { if (f[i].direct) return V[f[i].key]; t += R[f[i].key] * f[i].mult; }
  return t;
}
function push(s) { host("setParam", s, slotValue(s)); }
function norm(p) { return p.direct ? (V[p.key] - p.min) / (p.max - p.min) : (p.steps > 1 ? R[p.key] / (p.steps - 1) : 0); }

var dirty = false;
function touch(p) { if (CTL[p.key]) CTL[p.key].upd(); if (CTL[p.key] && CTL[p.key].more) CTL[p.key].more(); scheduleVis(); }
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
function markDirty() { if (!dirty) { dirty = true; var d = document.getElementById("dirty"); if (d) d.textContent = "edited"; } }
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

// ---------- formatting ----------
var NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function num(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString(); }
function sig(v) { var a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3); }
function fmtVal(p) {
  var v = V[p.key], f = p.fmt;
  if (Array.isArray(f)) return f[Math.round(v - p.min)] || String(v);
  switch (f) {
    case "hz": return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + "k" : (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + "Hz";
    case "ms": return v >= 1000 ? (v / 1000).toFixed(2) + "s" : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + "ms";
    case "s": return v.toFixed(2) + "s";
    case "db": return (v > 0.05 ? "+" : "") + v.toFixed(1) + "dB" + (p.silent && v <= p.min + 0.01 ? "" : "");
    case "st": return (v > 0.01 ? "+" : "") + v.toFixed(1) + "st";
    case "ct": return (v > 0.5 ? "+" : "") + Math.round(v) + "ct";
    case "pct": return Math.round(v * 100) + "%";
    case "x": return v.toFixed(2) + "×";
    case "oct": return (v > 0.01 ? "+" : "") + v.toFixed(1) + "oct";
    case "ratio": return v.toFixed(2) + ":1";
    case "bip": return (v > 0.005 ? "+" : "") + v.toFixed(2);
    case "fb": return (v > 0.005 ? "+" : "") + v.toFixed(2);
    case "bits": return v.toFixed(1) + "bit";
    case "pan": return Math.abs(v) < 0.03 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100);
    case "kt": return v < 0.25 ? "off" : v < 0.75 ? "½" : v < 1.25 ? "1×" : "1.5×";
    case "note": var n = Math.round(v); return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
    case "wave": var w = ["sin", "tri", "saw", "sqr"], i = Math.min(2, Math.floor(v)), fr = v - i; return fr < 0.04 ? w[i] : fr > 0.96 ? w[i + 1] : w[i] + "→" + w[i + 1] + " " + Math.round(fr * 100);
    case "mat": var mi = Math.min(4, Math.floor(v)), mf = v - mi; return mf < 0.04 ? DATA.tables.MAT_NAMES[mi] : mf > 0.96 ? DATA.tables.MAT_NAMES[mi + 1] : DATA.tables.MAT_NAMES[mi].slice(0, 4) + "→" + DATA.tables.MAT_NAMES[mi + 1].slice(0, 4);
    case "mset": var si = Math.min(4, Math.floor(v)), sf = v - si; return sf < 0.04 ? DATA.tables.MET_NAMES[si] : sf > 0.96 ? DATA.tables.MET_NAMES[si + 1] : DATA.tables.MET_NAMES[si].slice(0, 4) + "→" + DATA.tables.MET_NAMES[si + 1].slice(0, 4);
    case "fmode": return v < 0.04 ? "LP" : v < 0.96 ? "LP→BP" : v < 1.04 ? "BP" : v < 1.96 ? "BP→HP" : "HP";
    case "int": return String(Math.round(v));
    default: return sig(v);
  }
}

// ---------- controls ----------
function knob(p, label) {
  var w = el("div", "k"); w.title = (p.tip ? p.tip + "\n" : "") + p.key + "   ·   double-click resets, shift = fine";
  var s = sv("svg", { viewBox: "0 0 44 44" }, w);
  sv("circle", { cx: 22, cy: 22, r: 19, fill: "rgba(0,0,0,.4)", stroke: "rgba(255,255,255,.1)" }, s);
  var tr = sv("path", { fill: "none", stroke: "rgba(255,255,255,.13)", "stroke-width": 3, "stroke-linecap": "round" }, s);
  var ar = sv("path", { fill: "none", stroke: "var(--a)", "stroke-width": 3, "stroke-linecap": "round" }, s);
  var nd = sv("line", { x1: 22, y1: 22, stroke: "var(--a2)", "stroke-width": 2, "stroke-linecap": "round" }, s);
  el("div", "n", w, label || p.name); var vv = el("div", "v", w);
  var bip = p.curve === "lin" && p.min < 0 && p.max > 0;
  function arc(a0, a1) { var r = 15; return "M" + (22 + r * Math.sin(a0)) + " " + (22 - r * Math.cos(a0)) + "A" + r + " " + r + " 0 " + ((a1 - a0) > Math.PI ? 1 : 0) + " 1 " + (22 + r * Math.sin(a1)) + " " + (22 - r * Math.cos(a1)); }
  function upd() {
    var n = norm(p), a0 = -2.35, a1 = 2.35, t = a0 + (a1 - a0) * n;
    tr.setAttribute("d", arc(a0, a1));
    var c = bip ? (a0 + a1) / 2 : a0, lo = Math.min(c, t), hi = Math.max(c, t);
    ar.setAttribute("d", hi - lo < 0.01 ? "" : arc(lo, hi));
    nd.setAttribute("x2", 22 + 13 * Math.sin(t)); nd.setAttribute("y2", 22 - 13 * Math.cos(t));
    vv.textContent = fmtVal(p);
  }
  CTL[p.key] = { upd: upd };
  var y0 = 0, n0 = 0, drag = false;
  w.addEventListener("pointerdown", function (e) { drag = true; dragSlot = p.slot; y0 = e.clientY; n0 = norm(p); try { w.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
  w.addEventListener("pointermove", function (e) { if (!drag) return; var span = p.direct || p.steps > 60 ? 190 : Math.max(70, p.steps * 9); setNorm(p, n0 + (y0 - e.clientY) / (e.shiftKey ? span * 4 : span)); e.preventDefault(); });
  function end() { drag = false; dragSlot = -1; }
  w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
  w.addEventListener("dblclick", function () { set(p.key, p.def); });
  w.addEventListener("wheel", function (e) { var up = e.deltaY < 0 ? 1 : -1; if (p.direct) setNorm(p, norm(p) + up * 0.02); else setRaw(p, R[p.key] + up * (e.shiftKey ? 1 : Math.max(1, Math.round(p.steps / 64)))), touch(p), push(p.slot), markDirty(); e.preventDefault(); }, { passive: false });
  upd();
  return w;
}
function segCtl(p, label) {
  var row = el("div", "row"); el("span", "lb", row, label || p.name);
  var names = p.fmt, host_ = null, btns = [];
  if (names.length <= 5) {
    host_ = el("div", "seg", row);
    names.forEach(function (nm, i) { var b = el("button", "", host_, nm); b.type = "button"; b.addEventListener("click", function () { set(p.key, p.min + i); }); btns.push(b); });
    CTL[p.key] = { upd: function () { var cur = Math.round(V[p.key] - p.min); btns.forEach(function (b, i) { b.className = i === cur ? "on" : ""; }); } };
  } else {
    var sel = el("select", "dd", row);
    names.forEach(function (nm, i) { var o = el("option", "", sel, nm); o.value = i; });
    sel.addEventListener("change", function () { set(p.key, p.min + (+sel.value)); });
    CTL[p.key] = { upd: function () { sel.value = Math.round(V[p.key] - p.min); } };
  }
  row.title = (p.tip ? p.tip + "\n" : "") + p.key;
  CTL[p.key].upd();
  return row;
}
function togCtl(p) {
  var row = el("div", "row"); var b = el("button", "tgl", row, p.name); b.type = "button"; b.title = (p.tip ? p.tip + "\n" : "") + p.key;
  b.addEventListener("click", function () { set(p.key, V[p.key] > 0.5 ? 0 : 1); });
  CTL[p.key] = { upd: function () { b.className = "tgl" + (V[p.key] > 0.5 ? " on" : ""); } };
  CTL[p.key].upd(); return row;
}
function control(p) {
  if (p.kind === "tog") return togCtl(p);
  if (Array.isArray(p.fmt)) return segCtl(p);
  return knob(p);
}

// ---------- visual kit ----------
var ACC = "#ff4a3d", ACC2 = "#ffb347", TCOL = {};
DATA.layers.forEach(function (l) { TCOL[l[0]] = l[2]; });
function plotArea(cv) {
  var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  var w = Math.round(r.width), h = Math.round(r.height);
  if (w < 30 || h < 20) return null;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  var cx = cv.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
  return { cx: cx, w: w, h: h };
}
function mkViz(parent, cap) { var d = el("div", "viz", parent); var cv = el("canvas", "", d); el("div", "cap", d, cap); var rd = el("div", "rd", d); return { div: d, cv: cv, rd: rd }; }
function lg(f, lo, hi) { return Math.log(f / lo) / Math.log(hi / lo); }
function gridLog(cx, w, h, lo, hi, left) {
  cx.strokeStyle = "rgba(255,255,255,.06)"; cx.lineWidth = 1; cx.fillStyle = "rgba(255,255,255,.28)"; cx.font = "8px sans-serif";
  [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (f) { if (f < lo || f > hi) return; var x = left + lg(f, lo, hi) * (w - left); cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, h - 11); cx.stroke(); cx.fillText(f >= 1000 ? (f / 1000) + "k" : f, x + 2, h - 2); });
}
function polyline(cx, pts, color, lw, fill) {
  if (!pts.length) return; cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) cx.lineTo(pts[i][0], pts[i][1]);
  if (fill) { cx.lineTo(pts[pts.length - 1][0], fill); cx.lineTo(pts[0][0], fill); cx.closePath(); cx.fillStyle = color; cx.fill(); }
  else { cx.strokeStyle = color; cx.lineWidth = lw || 1.5; cx.stroke(); }
}
function dbf(x) { return 20 * Math.log10(Math.max(x, 1e-6)); }

// engine formulas, mirrored for the displays
function curveEnv(age, T, q) { if (T <= 1e-5) return 0; var u = age / T, x = q === 1 ? u : Math.pow(u, q); if (x > 12) return 0; return Math.exp(-6.907755 * x); }
function ampEnv(age, att, dec, crv, tailDb, tailT) {
  var a = 1; if (att > 1e-4) { a = age / att; a = a >= 1 ? 1 : a * a * (3 - 2 * a); }
  var e1 = curveEnv(age, dec, Math.pow(2, 2 * crv)), e2 = 0, tg = 0;
  if (tailDb > -59.5) { tg = Math.exp(tailDb * 0.11512925); if (age < tailT * 1.8) e2 = tg * Math.exp(-6.907755 * age / tailT); }
  return a * (e1 + e2) / (1 + 0.5 * tg);
}
function vS(k) { return V[k]; }
function layerEnv(pre, age) { return ampEnv(age, vS(pre + "_ATT") / 1000, vS(pre + "_DEC") / 1000, vS(pre + "_CRV"), vS(pre + "_TAIL"), vS(pre + "_TAILT") / 1000); }
function envSpan(pre) { var d = vS(pre + "_DEC") / 1000, t = vS(pre + "_TAIL") > -59.5 ? vS(pre + "_TAILT") / 1000 : 0; return clamp(Math.max(d, t) * 1.25, 0.03, 12); }
function tAxis(cx, w, h, Tmax, left) {
  cx.strokeStyle = "rgba(255,255,255,.06)"; cx.fillStyle = "rgba(255,255,255,.28)"; cx.font = "8px sans-serif";
  [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10].forEach(function (t) { if (t > Tmax) return; var x = left + lg(t * 1000, 1, Tmax * 1000) * (w - left); cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, h - 11); cx.stroke(); cx.fillText(t >= 1 ? t + "s" : (t * 1000) + "ms", x + 2, h - 2); });
}

// ---- envelope viz (tone / fm / noise / metal) ----
function vizEnvDraw(pre, extra) {
  return function (v) {
    var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, L = 6, top = 16, bot = h - 12;
    var T = Math.max(envSpan(pre), extra === "fm" ? vS("F_IDXT") / 400 : 0, extra === "tone" ? vS("T_PE2_TIME") / 600 : 0);
    tAxis(cx, w, h, T, L);
    var N = 180, pts = [], ppts = [], ipts = [], smin = 0, smax = 0, pe = [];
    function X(i) { return L + (i / N) * (w - L); }
    for (var i = 0; i <= N; i++) {
      var t = Math.exp(Math.log(0.001) + (i / N) * (Math.log(T) - Math.log(0.001)));
      var e = pre === "N" && vS("N_GATE") === 1 ? clapEnv(t) : layerEnv(pre, t);
      pts.push([X(i), bot - clamp(e, 0, 1.2) * (bot - top)]);
      if (extra === "tone") {
        var e1 = vS("T_PE1_AMT") * curveEnv(t, vS("T_PE1_TIME") / 1000, Math.pow(2, 2 * vS("T_PE1_CRV"))), e2 = vS("T_PE2_AMT") * curveEnv(t, vS("T_PE2_TIME") / 1000, 1), te = vS("T_TENS") * e * e;
        var s = e1 + e2 + te; pe.push(s); smin = Math.min(smin, s); smax = Math.max(smax, s);
      } else if (extra === "fm") { ipts.push([X(i), bot - clamp(curveEnv(t, vS("F_IDXT") / 1000, Math.pow(2, 2 * vS("F_IDXC"))), 0, 1) * (bot - top)]); }
    }
    var col = TCOL[pre] || ACC;
    cx.globalAlpha = 0.28; polyline(cx, pts, col, 1, bot); cx.globalAlpha = 1; polyline(cx, pts, col, 1.8);
    if (extra === "tone") {
      var span = Math.max(1, smax - smin); for (var j = 0; j <= N; j++) ppts.push([X(j), bot - ((pe[j] - smin) / span) * (bot - top)]);
      polyline(cx, ppts, "#ffffff", 1.4);
      cx.fillStyle = "rgba(255,255,255,.7)"; cx.font = "9px sans-serif"; cx.fillText("pitch " + (smax > 0.05 ? "+" + smax.toFixed(1) : "0") + " st", w - 70, top + 12);
      v.rd.textContent = sig(vS("T_PITCH")) + " Hz";
    } else if (extra === "fm") { polyline(cx, ipts, "#ffffff", 1.2); cx.fillStyle = "rgba(255,255,255,.7)"; cx.font = "9px sans-serif"; cx.fillText("index", w - 40, top + 12); v.rd.textContent = sig(vS("F_FREQ")) + " Hz · mod ×" + vS("F_MRATIO").toFixed(2); }
    else v.rd.textContent = "decay " + (vS(pre + "_DEC") >= 1000 ? (vS(pre + "_DEC") / 1000).toFixed(2) + "s" : Math.round(vS(pre + "_DEC")) + "ms");
  };
}
function clapEnv(t) {
  var n = vS("N_BN"), sp = vS("N_BSP") / 1000, slope = vS("N_BSLOPE"), bl = vS("N_BLEN") / 1000, best = 0, mx = 0, amps = [];
  for (var i = 0; i < n; i++) { amps.push(Math.exp(slope * i * 0.45)); mx = Math.max(mx, amps[i]); }
  var tl = (n - 1) * sp, g = 0;
  for (var k = 0; k < n - 1; k++) { var d = t - k * sp; if (d >= 0) g += amps[k] / mx * Math.exp(-6.907755 * d / bl); }
  if (t >= tl) g += layerEnv("N", t - tl) * amps[n - 1] / mx;
  return g;
}

// ---- modal viz ----
function modeData() {
  var T = DATA.tables, mat = clamp(vS("M_MAT"), 0, 5), ma = Math.min(4, Math.floor(mat)), mf = mat - ma, stretch = 1 + vS("M_STR"), nm = vS("M_NUM");
  var f0 = vS("M_PITCH"), dec = vS("M_DEC") / 1000, tilt = vS("M_TILT"), brt = vS("M_BRT"), pos = vS("M_POS") * 0.9, out = [], ws = 0;
  for (var k = 0; k < 12; k++) {
    var lnr = (Math.log(T.MAT_R[ma][k]) * (1 - mf) + Math.log(T.MAT_R[ma + 1][k]) * mf) * stretch, ratio = Math.exp(lnr), f = f0 * ratio, wv = 0;
    if (k < nm && f < 22000) { wv = (0.1 + 0.9 * Math.abs(Math.cos(Math.PI * ratio * pos))) * Math.exp(-brt * lnr); if (k === nm - 1 && nm > 1) wv *= 0.8; }
    ws += wv * wv; out.push({ f: f, w: wv, t60: Math.max(0.0004, dec * Math.exp(-tilt * lnr)) });
  }
  var nr = ws > 0 ? 1 / Math.sqrt(ws) : 0; out.forEach(function (m) { m.w *= nr; }); return out;
}
function vizModal(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 20, hi = 20000, L = 6;
  gridLog(cx, w, h, lo, hi, L);
  var md = modeData(), mx = 0; md.forEach(function (m) { mx = Math.max(mx, m.w); });
  md.forEach(function (m, k) {
    if (m.w <= 0) return; var x = L + clamp(lg(m.f, lo, hi), 0, 1) * (w - L), hh = (m.w / (mx || 1)) * (h - 32);
    cx.globalAlpha = 0.35 + 0.65 * clamp(Math.log(m.t60 / 0.01) / Math.log(300), 0, 1); cx.fillStyle = TCOL.M; cx.fillRect(x - 2, h - 12 - hh, 4, hh); cx.globalAlpha = 1;
    if (k < 8) { cx.fillStyle = "rgba(255,255,255,.55)"; cx.font = "8px sans-serif"; cx.fillText(m.f >= 1000 ? (m.f / 1000).toFixed(1) + "k" : Math.round(m.f), x - 8, h - 14 - hh); }
  });
  v.rd.textContent = DATA.tables.MAT_NAMES[Math.round(clamp(vS("M_MAT"), 0, 5))] + " · " + vS("M_NUM") + " modes";
}

// ---- filter responses ----
function svfMag(m, f, fc, Q, s24) {
  var x = f / fc, d = Math.sqrt((1 - x * x) * (1 - x * x) + (x / Q) * (x / Q)) + 1e-9, lp = 1 / d, bp = (x / Q) / d, hp = x * x / d, r;
  if (m < 1) r = lp * (1 - m) + bp * m; else r = bp * (2 - m) + hp * (m - 1);
  return s24 ? r * r : r;
}
function vizNoiseFilter(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 20, hi = 20000, L = 6;
  gridLog(cx, w, h, lo, hi, L);
  var Q = 0.5 * Math.exp(vS("N_RES") * 5.9914645), pts = [], N = 200;
  for (var i = 0; i <= N; i++) { var f = lo * Math.pow(hi / lo, i / N), mg = dbf(svfMag(vS("N_MODE"), f, vS("N_CUT"), Q, vS("N_SLOPE") > 0.5)); pts.push([L + (i / N) * (w - L), 12 + (1 - clamp((mg + 40) / 70, 0, 1)) * (h - 26)]); }
  cx.globalAlpha = 0.25; polyline(cx, pts, TCOL.N, 1, h - 12); cx.globalAlpha = 1; polyline(cx, pts, TCOL.N, 1.8);
  v.rd.textContent = fmtVal(BY.N_CUT) + " · Q " + Q.toFixed(1);
}
function vizBursts(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, L = 6, top = 16, bot = h - 12;
  var T = vS("N_GATE") === 1 ? Math.max(0.05, ((vS("N_BN") - 1) * vS("N_BSP") / 1000) + envSpan("N") * 0.8) : envSpan("N");
  T = Math.min(T, 3); tAxis(cx, w, h, T, L);
  var pts = [], N = 220;
  for (var i = 0; i <= N; i++) { var t = Math.exp(Math.log(0.001) + (i / N) * (Math.log(T) - Math.log(0.001))), e = vS("N_GATE") === 1 ? clapEnv(t) : layerEnv("N", t); pts.push([L + (i / N) * (w - L), bot - clamp(e, 0, 1.2) * (bot - top)]); }
  cx.globalAlpha = 0.28; polyline(cx, pts, TCOL.N, 1, bot); cx.globalAlpha = 1; polyline(cx, pts, TCOL.N, 1.8);
  v.rd.textContent = ["normal", "clap ×" + vS("N_BN"), "rattle"][vS("N_GATE")];
}
function vizMetal(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 100, hi = 20000, L = 6, NB = 200;
  gridLog(cx, w, h, lo, hi, L);
  var T = DATA.tables, ms = clamp(vS("X_SET"), 0, 5), ia = Math.min(4, Math.floor(ms)), fr = ms - ia, sp = vS("X_SPREAD"), base = vS("X_FREQ"), pw = vS("X_PW");
  var lns = [], mean = 0; for (var k = 0; k < 6; k++) { var l = Math.log(T.MET_R[ia][k]) * (1 - fr) + Math.log(T.MET_R[ia + 1][k]) * fr; lns.push(l); mean += l / 6; }
  var bins = new Array(NB).fill(0);
  for (var k2 = 0; k2 < 6; k2++) {
    var f0 = base * Math.exp(mean + (lns[k2] - mean) * sp);
    for (var n = 1; n < 400; n++) { var f = f0 * n; if (f > hi) break; if (f < lo) continue; var amp = Math.abs(Math.sin(Math.PI * n * pw)) / n; var bi = Math.floor(lg(f, lo, hi) * NB); if (bi >= 0 && bi < NB) bins[bi] += amp * amp; }
  }
  var Qb = vS("X_BPQ"), res = [], mx = 0;
  for (var i = 0; i < NB; i++) {
    var ff = lo * Math.pow(hi / lo, (i + 0.5) / NB), hp = svfMag(2, ff, vS("X_HPF"), 0.7, false), bp = svfMag(1, ff, vS("X_BPF"), Qb, false) * 1.6, band = vS("X_BAND");
    var g = (bp * (1 - band) + hp * band) * hp; res.push(Math.sqrt(bins[i]) * g); mx = Math.max(mx, res[i]);
  }
  for (var j = 0; j < NB; j++) { var bh = (res[j] / (mx || 1)) * (h - 30), x = L + (j / NB) * (w - L); cx.fillStyle = TCOL.X; cx.globalAlpha = 0.85; cx.fillRect(x, h - 12 - bh, Math.max(1, (w - L) / NB - 0.5), bh); }
  cx.globalAlpha = 1;
  var fp = []; for (var q = 0; q <= 160; q++) { var f2 = lo * Math.pow(hi / lo, q / 160), g2 = (svfMag(1, f2, vS("X_BPF"), Qb, false) * 1.6 * (1 - vS("X_BAND")) + svfMag(2, f2, vS("X_HPF"), 0.7, false) * vS("X_BAND")) * svfMag(2, f2, vS("X_HPF"), 0.7, false); fp.push([L + (q / 160) * (w - L), 14 + (1 - clamp((dbf(g2) + 36) / 42, 0, 1)) * (h - 28)]); }
  polyline(cx, fp, "#fff", 1.2);
  v.rd.textContent = DATA.tables.MET_NAMES[Math.round(ms)] + " · base " + sig(base) + " Hz";
}
function vizClick(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, sr = 48000, type = vS("C_TYPE"), len = vS("C_LEN") / 1000, f = vS("C_FREQ");
  var N = Math.min(2400, Math.max(120, Math.round(len * sr * 5))), pts = [], ph = 0, seed = 12345, lp = 0;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; }
  var cf = Math.exp(-6.907755 / Math.max(1, len * sr));
  var ce = 1, bp1 = 0, bp2 = 0, g = Math.tan(Math.PI * Math.min(f, 20000) / sr), k = type === 4 ? 0.1 : 1 / 1.2, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, ic1 = 0, ic2 = 0;
  for (var i = 0; i < N; i++) {
    var y = 0;
    if (type === 0) y = i < 0.5 * sr / f + 1 ? ce : 0;
    else if (type === 2) { y = Math.sin(6.283185 * ph) * ce; ph += f / sr; }
    else if (type === 3) { y = Math.sin(6.283185 * ph) * ce; ph += f * (1 + 5 * ce * ce) / sr; }
    else { var x = type === 4 ? (i === 0 ? 1 / Math.max(a2, 0.001) : 0) : rnd(); var v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; y = (type === 5 ? v2 : v1 * (type === 4 ? 1 : k)) * ce * (type === 5 ? 2 : 1); }
    ce *= cf; pts.push([6 + (i / (N - 1)) * (w - 12), h / 2 - clamp(y, -1, 1) * (h / 2 - 14)]);
  }
  cx.strokeStyle = "rgba(255,255,255,.07)"; cx.beginPath(); cx.moveTo(0, h / 2); cx.lineTo(w, h / 2); cx.stroke();
  polyline(cx, pts, TCOL.C, 1.4);
  v.rd.textContent = DATA.params.filter(function (q) { return q.key === "C_TYPE"; })[0].fmt[type] + " · " + (len * 1000).toFixed(2) + " ms";
}

// ---- hit / ratchet ----
function vizRatchet(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, n = vS("RAT_N"), sync = Math.round(vS("RAT_SYNC")), bt = [0, 0.5, 0.25, 0.125, 0.0625, 1 / 3, 1 / 6, 1 / 12];
  var sp = sync > 0 ? bt[sync] * 60 / 120 : vS("RAT_TIME") / 1000, slope = vS("RAT_VEL"), tot = Math.max(0.05, sp * (n - 1) * 1.05 + 0.04);
  cx.strokeStyle = "rgba(255,255,255,.06)"; cx.beginPath(); cx.moveTo(6, h - 12); cx.lineTo(w - 6, h - 12); cx.stroke();
  for (var i = 0; i < n; i++) { var t = i * sp, vel = Math.min(1, 0.9 * Math.pow(1 + slope, i)), x = 10 + (t / tot) * (w - 24), hh = vel * (h - 34); cx.globalAlpha = i === 0 ? 1 : 0.4 + 0.6 * vS("RAT_PROB"); cx.fillStyle = ACC; cx.fillRect(x - 2, h - 12 - hh, 4, hh); }
  cx.globalAlpha = 1; cx.fillStyle = "rgba(255,255,255,.4)"; cx.font = "8px sans-serif"; cx.fillText((tot * 1000).toFixed(0) + " ms (at 120 BPM if synced)", 8, h - 2);
  v.rd.textContent = n + (n === 1 ? " hit" : " hits") + (vS("RAT_PITCH") !== 0 ? " · " + (vS("RAT_PITCH") > 0 ? "+" : "") + vS("RAT_PITCH").toFixed(1) + " st each" : "");
}
function vizVelocity(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, pts = [];
  for (var i = 0; i <= 60; i++) { var vel = i / 60, g = (1 - vS("VEL_AMP")) + vS("VEL_AMP") * vel * vel; pts.push([10 + vel * (w - 20), h - 14 - g * (h - 34)]); }
  cx.strokeStyle = "rgba(255,255,255,.07)"; cx.beginPath(); cx.moveTo(10, h - 14); cx.lineTo(w - 10, 14); cx.stroke();
  polyline(cx, pts, ACC, 1.8); cx.fillStyle = "rgba(255,255,255,.4)"; cx.font = "8px sans-serif"; cx.fillText("velocity → level", 8, h - 2);
  v.rd.textContent = "+" + vS("VEL_PITCH").toFixed(0) + " st at full";
}

// ---- mod tab ----
function lfoShape(shape, ph) { if (shape === 0) return Math.sin(6.283185 * ph); if (shape === 1) return ph < 0.25 ? ph * 4 : ph < 0.75 ? 2 - ph * 4 : ph * 4 - 4; if (shape === 2) return ph * 2 - 1; if (shape === 3) return ph < 0.5 ? 1 : -1; return (Math.sin(ph * 37.1) + Math.sin(ph * 12.7 + 1)) * 0.5; }
function vizLfo(n) { return function (v) { var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, pts = []; for (var i = 0; i <= 160; i++) pts.push([8 + (i / 160) * (w - 16), h / 2 - lfoShape(vS("L" + n + "_SHAPE"), (i / 160 * 2) % 1) * (h / 2 - 18)]); cx.strokeStyle = "rgba(255,255,255,.06)"; cx.beginPath(); cx.moveTo(0, h / 2); cx.lineTo(w, h / 2); cx.stroke(); polyline(cx, pts, ACC2, 1.6); v.rd.textContent = vS("L" + n + "_SYNC") ? DATA.params.filter(function (q) { return q.key === "L" + n + "_SYNC"; })[0].fmt[vS("L" + n + "_SYNC")] : sig(vS("L" + n + "_RATE")) + " Hz"; }; }
function vizEnvAB(n) { return function (v) { var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, att = vS("E" + n + "_ATT") / 1000, dec = vS("E" + n + "_DEC") / 1000, q = Math.pow(2, 2 * vS("E" + n + "_CRV")), T = Math.max(0.05, (att + dec) * 1.1), pts = []; for (var i = 0; i <= 160; i++) { var t = (i / 160) * T, e = t < att ? t / att : curveEnv(t - att, dec, q); pts.push([8 + (i / 160) * (w - 16), h - 16 - e * (h - 34)]); } cx.globalAlpha = 0.25; polyline(cx, pts, ACC2, 1, h - 16); cx.globalAlpha = 1; polyline(cx, pts, ACC2, 1.6); v.rd.textContent = ((att + dec) * 1000).toFixed(0) + " ms"; }; }

// ---- drive tab ----
function shaperF(type, v) {
  var sc = function (x) { return x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x); };
  switch (type) {
    case 1: return sc(v); case 2: return clamp(v, -1, 1);
    case 3: { var a = v * 0.25 + 0.25; return 4 * Math.abs(a - Math.round(a)) - 1; }
    case 4: return v >= 0 ? 1 - Math.exp(-v) : -0.7 * (1 - Math.exp(0.9 * v));
    case 5: return (v >= 0 ? v / (1 + v) : v / (1 - 0.7 * v)) * 0.9;
    case 6: return Math.abs(sc(v)) * 2;
    case 7: { var x = sc(v), x2 = x * x; return 0.55 * x * (4 * x2 - 3) + 0.3 * x * (16 * x2 * x2 - 20 * x2 + 5) + 0.15 * (2 * x2 - 1); }
    case 8: return Math.sin(v);
    case 9: { var t = sc(v * 3); return t * 0.75 + (Math.abs(t) - 0.5) * 0.35; }
    default: return v;
  }
}
function vizDist(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, cxm = w / 2, cym = h / 2;
  cx.strokeStyle = "rgba(255,255,255,.08)"; cx.beginPath(); cx.moveTo(0, cym); cx.lineTo(w, cym); cx.moveTo(cxm, 0); cx.lineTo(cxm, h); cx.stroke();
  cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(cxm - (h / 2 - 14), cym + (h / 2 - 14)); cx.lineTo(cxm + (h / 2 - 14), cym - (h / 2 - 14)); cx.stroke(); cx.setLineDash([]);
  [["D1", ACC], ["D2", ACC2]].forEach(function (u) {
    var type = vS(u[0] + "_TYPE"); if (!type) return; var G = Math.pow(10, vS(u[0] + "_DRV") / 20), b = vS(u[0] + "_BIAS") * 0.9, z = shaperF(type, b), comp = 1 / Math.pow(G, 0.12), pts = [];
    for (var i = 0; i <= 240; i++) { var x = -1 + 2 * i / 240, y = (shaperF(type, x * G + b) - z) * comp; pts.push([cxm + x * (h / 2 - 14), cym - clamp(y, -1.3, 1.3) * (h / 2 - 14)]); }
    polyline(cx, pts, u[1], 1.7);
  });
  v.rd.textContent = "transfer curves  A " + DATA.params.filter(function (q) { return q.key === "D1_TYPE"; })[0].fmt[vS("D1_TYPE")] + " · B " + DATA.params.filter(function (q) { return q.key === "D2_TYPE"; })[0].fmt[vS("D2_TYPE")];
}
function vizCrush(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lev = Math.pow(2, vS("CR_BITS") - 1), pts = [], N = 200, hold = vS("CR_RATE") / 48000, phase = 0, held = 0;
  for (var i = 0; i < N; i++) { var x = Math.sin(6.283185 * i / N * 3) * 0.95; phase += hold; if (phase >= 1) { phase -= 1; held = Math.round(clamp(x, -1, 1) * lev) / lev; } pts.push([8 + (i / N) * (w - 16), h / 2 - held * (h / 2 - 14)]); }
  var ref = []; for (var j = 0; j < N; j++) ref.push([8 + (j / N) * (w - 16), h / 2 - Math.sin(6.283185 * j / N * 3) * 0.95 * (h / 2 - 14)]);
  polyline(cx, ref, "rgba(255,255,255,.18)", 1); polyline(cx, pts, ACC, 1.5); v.rd.textContent = vS("CR_BITS").toFixed(1) + " bit · " + (vS("CR_RATE") >= 47000 ? "full rate" : Math.round(vS("CR_RATE")) + " Hz");
}

// ---- filter / eq / comp / space ----
function bqMag(kind, f0, Q, g, f, SR) {
  var w0 = 2 * Math.PI * f0 / SR, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * Q), A = Math.pow(10, g / 40), b0, b1, b2, a0, a1, a2, sa;
  if (kind === 2) { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = b1; a2 = 1 - al / A; }
  else if (kind === 3) { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (kind === 4) { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { sa = 2 * Math.sqrt(A) * (s / (2 * 0.7071)); if (kind === 0) { b0 = A * ((A + 1) - (A - 1) * c + sa); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sa); a0 = (A + 1) + (A - 1) * c + sa; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sa; } else { b0 = A * ((A + 1) + (A - 1) * c + sa); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sa); a0 = (A + 1) - (A - 1) * c + sa; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sa; } }
  var w = 2 * Math.PI * f / SR, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w), nr = b0 + b1 * cw + b2 * c2, ni = -(b1 * sw + b2 * s2), dr = a0 + a1 * cw + a2 * c2, di = -(a1 * sw + a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}
function vizMasterFilter(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 20, hi = 20000, L = 6; gridLog(cx, w, h, lo, hi, L);
  var t = vS("FL_TYPE"), fc = vS("FL_CUT"), Q = vS("FL_RES"), s24 = vS("FL_SLOPE") > 0.5, pts = [], N = 220;
  for (var i = 0; i <= N; i++) {
    var f = lo * Math.pow(hi / lo, i / N), x = f / fc, d = Math.sqrt((1 - x * x) * (1 - x * x) + (x / Q) * (x / Q)) + 1e-9, lp = 1 / d, bp = (x / Q) / d, hp = x * x / d, m;
    m = t === 0 ? lp : t === 1 ? bp : t === 2 ? hp : t === 3 ? Math.abs(1 - x * x) / d : Math.abs(lp - hp) * (1);
    if (t === 4) m = Math.sqrt(Math.pow(1 - x * x, 2) + 0) / d * 0 + (1 + (1 / Q) * 0) * (1 / d) * (Math.abs(1 - x * x) + x / Q) / (1 + x / Q + 1e-9);
    if (s24) m = m * m; var db = dbf(m); pts.push([L + (i / N) * (w - L), 12 + (1 - clamp((db + 40) / 70, 0, 1)) * (h - 26)]);
  }
  cx.globalAlpha = 0.2; polyline(cx, pts, ACC, 1, h - 12); cx.globalAlpha = 1; polyline(cx, pts, ACC, 1.8);
  v.rd.textContent = vS("FL_ON") > 0.5 ? DATA.params.filter(function (q) { return q.key === "FL_TYPE"; })[0].fmt[t] + " " + fmtVal(BY.FL_CUT) : "filter off";
}
function vizComb(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 20, hi = 20000, L = 6; gridLog(cx, w, h, lo, hi, L);
  var f0 = vS("CB_FREQ"), fb = vS("CB_FB"), pts = [], N = 400, damp = vS("CB_DAMP");
  for (var i = 0; i <= N; i++) { var f = lo * Math.pow(hi / lo, i / N), ph = 2 * Math.PI * f / f0, dmp = 1 / Math.sqrt(1 + Math.pow(f / damp, 2)), re = 1 - fb * dmp * Math.cos(ph), im = fb * dmp * Math.sin(ph), mg = 1 / Math.sqrt(re * re + im * im + 1e-6); pts.push([L + (i / N) * (w - L), 12 + (1 - clamp((dbf(mg) + 24) / 48, 0, 1)) * (h - 26)]); }
  cx.globalAlpha = 0.2; polyline(cx, pts, ACC2, 1, h - 12); cx.globalAlpha = 1; polyline(cx, pts, ACC2, 1.4);
  v.rd.textContent = vS("CB_MIX") > 0 ? sig(f0) + " Hz · fb " + fb.toFixed(2) : "comb off";
}
function vizEq(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, lo = 20, hi = 20000, L = 6; gridLog(cx, w, h, lo, hi, L);
  cx.strokeStyle = "rgba(255,255,255,.1)"; cx.beginPath(); cx.moveTo(L, h / 2 - 6); cx.lineTo(w, h / 2 - 6); cx.stroke();
  var pts = [], N = 260, SR = 48000;
  for (var i = 0; i <= N; i++) {
    var f = lo * Math.pow(hi / lo, i / N), g = 0;
    if (vS("EQ_HPF") > 10.5) g += 2 * dbf(bqMag(3, vS("EQ_HPF"), 0.7071, 0, f, SR));
    if (Math.abs(vS("EQ_LS_G")) > 0.05) g += dbf(bqMag(0, vS("EQ_LS_F"), 0.7071, vS("EQ_LS_G"), f, SR));
    if (Math.abs(vS("EQ_LM_G")) > 0.05) g += dbf(bqMag(2, vS("EQ_LM_F"), vS("EQ_LM_Q"), vS("EQ_LM_G"), f, SR));
    if (Math.abs(vS("EQ_HM_G")) > 0.05) g += dbf(bqMag(2, vS("EQ_HM_F"), vS("EQ_HM_Q"), vS("EQ_HM_G"), f, SR));
    if (Math.abs(vS("EQ_HS_G")) > 0.05) g += dbf(bqMag(1, vS("EQ_HS_F"), 0.7071, vS("EQ_HS_G"), f, SR));
    if (vS("EQ_LPF") < 19900) g += 2 * dbf(bqMag(4, vS("EQ_LPF"), 0.7071, 0, f, SR));
    pts.push([L + (i / N) * (w - L), clamp(h / 2 - 6 - g * 2.2, 8, h - 14)]);
  }
  cx.globalAlpha = 0.18; polyline(cx, pts, ACC, 1, h / 2 - 6); cx.globalAlpha = 1; polyline(cx, pts, ACC, 1.8); v.rd.textContent = "±30 dB";
}
function vizComp(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, thr = vS("CP_THR"), ratio = vS("CP_RATIO"), knee = vS("CP_KNEE"), mk = vS("CP_MAKE"), pts = [], pad = 14;
  cx.setLineDash([3, 3]); cx.strokeStyle = "rgba(255,255,255,.12)"; cx.beginPath(); cx.moveTo(pad, h - pad); cx.lineTo(w - pad, pad); cx.stroke(); cx.setLineDash([]);
  for (var i = 0; i <= 120; i++) {
    var inDb = -60 + 60 * i / 120, over = inDb - thr, out;
    if (knee > 0.1 && over > -knee / 2 && over < knee / 2) out = inDb + (1 / ratio - 1) * Math.pow(over + knee / 2, 2) / (2 * knee); else if (over >= knee / 2) out = inDb + (1 / ratio - 1) * over; else out = inDb;
    out += mk; pts.push([pad + (i / 120) * (w - 2 * pad), clamp(h - pad - ((out + 60) / 60) * (h - 2 * pad), 4, h - 4)]);
  }
  polyline(cx, pts, ACC2, 1.8); v.rd.textContent = ratio >= 95 ? "∞:1" : ratio.toFixed(1) + ":1 · mix " + Math.round(vS("CP_MIX") * 100) + "%";
}
function vizVerb(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, rt = vS("RV_DEC"), pre = vS("RV_PRE") / 1000, T = Math.max(0.3, rt * 1.1), pts = [], gate = vS("RV_GATE") > 0.5, hold = vS("RV_GHOLD") / 1000;
  for (var i = 0; i <= 200; i++) { var t = (i / 200) * T, db = t < pre ? -60 : -60 * (t - pre) / rt; if (gate && t > hold + pre) db -= (t - hold - pre) * 600; pts.push([8 + (i / 200) * (w - 16), 14 + clamp(-db / 60, 0, 1) * (h - 32)]); }
  cx.fillStyle = "rgba(255,255,255,.35)"; cx.font = "8px sans-serif"; cx.fillText("reverb tail (dB over time)  0 → " + T.toFixed(1) + " s", 8, h - 3);
  polyline(cx, pts, ACC, 1.8); v.rd.textContent = "RT60 " + rt.toFixed(2) + " s";
}
function vizEcho(v) {
  var a = plotArea(v.cv); if (!a) return; var cx = a.cx, w = a.w, h = a.h, sync = Math.round(vS("DL_SYNC")), bt = [0, 1, 0.5, 0.25, 0.125, 1 / 3, 1 / 6, 1 / 12], t1 = sync > 0 ? bt[sync] * 60 / 120 : vS("DL_TIME") / 1000, fb = vS("DL_FB"), mix = vS("DL_MIX"), T = Math.max(0.3, t1 * 7);
  for (var n = 1; n < 12; n++) { var amp = Math.min(1, Math.pow(fb, n - 1)) * mix * 1.5, x = 10 + (n * t1 / T) * (w - 20); if (x > w - 6) break; var hh = clamp(amp, 0, 1) * (h - 34); cx.fillStyle = ACC2; cx.globalAlpha = 0.9; cx.fillRect(x - 2, h - 12 - hh, 4, hh); }
  cx.globalAlpha = 1; cx.fillStyle = ACC; cx.fillRect(8, 16, 4, h - 28); cx.fillStyle = "rgba(255,255,255,.35)"; cx.font = "8px sans-serif"; cx.fillText("echo taps (120 BPM if synced)", 20, h - 3);
  v.rd.textContent = (t1 * 1000).toFixed(0) + " ms · fb " + Math.round(fb * 100) + "%";
}

// ---------- layout ----------
var TAB = DATA.tabs, SKIP = {};
DATA.layers.forEach(function (l) { SKIP[l[0] + "_LEV"] = 1; SKIP[l[0] + "_PAN"] = 1; });
var content = document.getElementById("content"), tabPanels = {}, activeTab = "hit";
var VIZDEF = {
  hit: [["RATCHET", vizRatchet], ["VELOCITY", vizVelocity]],
  tone: [["AMP + PITCH ENVELOPE", vizEnvDraw("T", "tone")]],
  fm: [["INDEX + AMP ENVELOPE", vizEnvDraw("F", "fm")]],
  modal: [["MODES (log frequency · brightness = ring time)", vizModal]],
  noise: [["FILTER", vizNoiseFilter], ["GATE / ENVELOPE", vizBursts]],
  metal: [["SPECTRUM", vizMetal], ["AMP ENVELOPE", vizEnvDraw("X", "")]],
  click: [["CLICK WAVEFORM", vizClick]],
  mod: [["LFO 1", vizLfo(1)], ["LFO 2", vizLfo(2)], ["ENV A", vizEnvAB("A")], ["ENV B", vizEnvAB("B")]],
  drive: [["TRANSFER CURVES", vizDist], ["BIT CRUSHER", vizCrush]],
  filter: [["MASTER FILTER", vizMasterFilter], ["COMB RESONATOR", vizComb]],
  eqdyn: [["EQUALISER", vizEq], ["COMPRESSOR CURVE", vizComp]],
  space: [["REVERB", vizVerb], ["ECHO", vizEcho]],
};
function buildTab(id) {
  var panel = el("div", "panel", content); panel.style.display = "none"; tabPanels[id] = panel;
  panel.style.setProperty("--a", DATA.tabColors[id] || ACC);
  var vd = VIZDEF[id] || []; VIS[id] = [];
  if (vd.length) { var vr = el("div", "vizrow" + (id === "mod" ? " sm" : ""), panel); vd.forEach(function (d) { var v = mkViz(vr, d[0]); VIS[id].push(function () { d[1](v); }); }); }
  var grid = el("div", "grid", panel), secs = {}, order = [];
  P.forEach(function (p) {
    if (p.tab !== id || SKIP[p.key] || p.kind === "mx") return;
    if (!secs[p.sec]) { var c = el("div", "sec", grid); el("h2", "", c, p.sec); secs[p.sec] = el("div", "ctls", c); order.push(p.sec); }
    secs[p.sec].appendChild(control(p));
  });
  if (id === "mod") matrix(grid);
  P.forEach(function (p) { if (p.tab === id && CTL[p.key] && CTL[p.key].upd) CTL[p.key].upd(); });
  // a layer's own extra controls (stereo spread for modal lives in its tab)
}
function matrix(grid) {
  var c = el("div", "sec", grid); c.style.gridColumn = "1 / -1"; el("h2", "", c, "MODULATION MATRIX — any source to any target (voice and FX), amounts are bipolar fractions of the target's range");
  var t = el("table", "mx", c);
  for (var i = 1; i <= DATA.modSlots; i++) (function (i) {
    var tr = el("tr", "", t); el("td", "i", tr, i);
    var ps = BY["MX" + i + "_SRC"], pd = BY["MX" + i + "_DST"], pa = BY["MX" + i + "_AMT"];
    var s1 = el("select", "dd", el("td", "", tr)); DATA.modSrc.forEach(function (n, k) { el("option", "", s1, n).value = k; });
    var s2 = el("select", "dd", el("td", "", tr)); el("option", "", s2, "— none —").value = 0; DATA.modDests.forEach(function (d, k) { el("option", "", s2, d.label).value = k + 1; });
    s2.style.maxWidth = "190px";
    var td = el("td", "", tr); td.style.width = "45%"; var sl = el("input", "", td); sl.type = "range"; sl.min = 0; sl.max = pa.steps - 1; sl.step = 1;
    var rd = el("td", "amt", tr);
    s1.addEventListener("change", function () { set(ps.key, +s1.value); });
    s2.addEventListener("change", function () { set(pd.key, +s2.value); });
    sl.addEventListener("pointerdown", function () { dragSlot = pa.slot; }); sl.addEventListener("pointerup", function () { dragSlot = -1; });
    sl.addEventListener("input", function () { setRaw(pa, +sl.value); touch(pa); push(pa.slot); markDirty(); });
    sl.addEventListener("dblclick", function () { set(pa.key, pa.def); });
    CTL[ps.key] = { upd: function () { s1.value = Math.round(V[ps.key]); } };
    CTL[pd.key] = { upd: function () { s2.value = Math.round(V[pd.key]); } };
    CTL[pa.key] = { upd: function () { sl.value = R[pa.key]; rd.textContent = (V[pa.key] > 0.005 ? "+" : "") + Math.round(V[pa.key] * 100) + "%"; } };
    function dim() { tr.style.opacity = (Math.round(V[ps.key]) === 0 || Math.round(V[pd.key]) === 0) ? 0.45 : 1; }
    CTL[ps.key].more = dim; CTL[pd.key].more = dim;
    [ps, pd, pa].forEach(function (q) { CTL[q.key].upd(); }); dim();
  })(i);
}
function showTab(id) {
  activeTab = id; for (var k in tabPanels) tabPanels[k].style.display = k === id ? "" : "none";
  var bs = document.getElementById("tabs").children; for (var i = 0; i < bs.length; i++) bs[i].className = bs[i].dataset.id === id ? "on" : "";
  document.documentElement.style.setProperty("--a", DATA.tabColors[id] || ACC);
  scheduleVis();
}
var visQueued = false;
function scheduleVis() { if (visQueued) return; visQueued = true; requestAnimationFrame(function () { visQueued = false; (VIS[activeTab] || []).forEach(function (f) { try { f(); } catch (e) { if (window.console) console.error("viz " + activeTab + ": " + e.message); } }); }); }

// header: layer strip
var layerMeters = [];
function buildLayers() {
  var host_ = document.getElementById("layers");
  DATA.layers.forEach(function (l, i) {
    var c = el("div", "ch", host_); c.style.setProperty("--c", l[2]);
    var lt = el("div", "lt", c); el("div", "nm", lt, l[1]);
    var mt = el("div", "mt", c), fill = el("i", "", mt); layerMeters.push(fill);
    var lev = BY[l[0] + "_LEV"], mb = el("button", "mb", lt, "MUTE"); mb.type = "button"; mb.title = "Mute layer";
    var saved = null;
    mb.addEventListener("click", function () { if (saved === null) { saved = V[lev.key]; set(lev.key, lev.min); mb.className = "mb on"; } else { set(lev.key, saved); saved = null; mb.className = "mb"; } });
    var ks = el("div", "ks", c); ks.appendChild(knob(lev, "Level"));
    var pn = BY[l[0] + "_PAN"] || BY.M_WIDTH; ks.appendChild(knob(pn, pn.key === "M_WIDTH" ? "Spread" : "Pan"));
  });
}
function buildTabs() {
  var tb = document.getElementById("tabs");
  TAB.forEach(function (t) { var b = el("button", "", tb, t[1]); b.dataset.id = t[0]; b.addEventListener("click", function () { showTab(t[0]); }); buildTab(t[0]); });
}

// ---------- presets / random ----------
var presetSel = document.getElementById("pSel"), curPreset = 0;
function buildPresets() {
  var ph = el("option", "", presetSel, "— current sound —"); ph.value = -1;
  var cats = {}; DATA.presets.forEach(function (p, i) { (cats[p.cat] = cats[p.cat] || []).push(i); });
  Object.keys(cats).forEach(function (c) { var og = el("optgroup", "", presetSel); og.label = c; cats[c].forEach(function (i) { var o = el("option", "", og, DATA.presets[i].name); o.value = i; }); });
}
function applyPatch(diff) {
  P.forEach(function (p) {
    var val = diff && diff[p.key] !== undefined ? diff[p.key] : p.def;
    if (p.direct) V[p.key] = clamp(val, p.min, p.max); else setRaw(p, actualToRaw(p, val));
    if (CTL[p.key]) CTL[p.key].upd();
  });
  for (var s = 0; s < NSLOT; s++) push(s);
  document.querySelectorAll(".mb.on").forEach(function (b) { b.className = "mb"; });
  scheduleVis();
}
function loadPreset(i) {
  i = (i + DATA.presets.length) % DATA.presets.length; curPreset = i; presetSel.value = i;
  applyPatch(DATA.presets[i].diff); dirty = false; document.getElementById("dirty").textContent = "";
}
var NORND = /^(OUT_|MAC|ROOT$|BEND$|POLY$|GATE$|REL$|MX\d_|[TFMNXC]_LEV$|[TFNXC]_PAN$|CP_THR$|RAT_|TUNE$|M_WIDTH$|.*_SYNC$)/;
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function randomize(amt) {
  P.forEach(function (p) {
    if (NORND.test(p.key) || p.kind === "mx") return;
    if (p.curve === "int") { if (Math.random() < amt * 0.25 && p.steps > 1) { if (p.steps <= 2) setRaw(p, 1 - R[p.key]); else setRaw(p, Math.random() * (p.steps - 1)); } }
    else if (p.direct) return;
    else setRaw(p, R[p.key] + gauss() * amt * (p.steps - 1) * 0.5);
    if (CTL[p.key]) CTL[p.key].upd();
  });
  for (var s = 0; s < NSLOT; s++) push(s); markDirty(); scheduleVis();
}
function randomMod() {
  var voice = DATA.modDests.map(function (d, i) { return [d, i + 1]; }).filter(function (x) { return !x[0].fx; });
  for (var i = 1; i <= DATA.modSlots; i++) {
    if (Math.random() < 0.55) { var d = voice[Math.floor(Math.random() * voice.length)][1]; set("MX" + i + "_SRC", 1 + Math.floor(Math.random() * 15), true); set("MX" + i + "_DST", d, true); set("MX" + i + "_AMT", (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.5), true); }
    else { set("MX" + i + "_SRC", 0, true); set("MX" + i + "_DST", 0, true); }
  }
  for (var s = 0; s < NSLOT; s++) push(s); markDirty();
}

// ---------- pads ----------
function buildPads() {
  var pd = document.getElementById("pads"), held = {};
  for (var i = 0; i < 16; i++) (function (note) {
    var b = el("button", "pad", pd); b.type = "button"; b.innerHTML = (note - 35) + "<small>" + NOTES[note % 12] + (Math.floor(note / 12) - 1) + "</small>"; b.title = "Click to play · higher on the pad = harder";
    function off() { if (!held[note]) return; delete held[note]; host("noteOff", note); b.classList.remove("hit"); }
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); var r = b.getBoundingClientRect(); var vel = clamp(1 - (e.clientY - r.top) / r.height * 0.85, 0.15, 1); held[note] = 1; host("noteOn", note, vel); b.classList.add("hit"); try { b.setPointerCapture(e.pointerId); } catch (x) {} });
    b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off);
  })(36 + i);
}

// ---------- display (engine → GUI) ----------
var disp = [], mL = document.querySelector("#mL i"), mR = document.querySelector("#mR i"), mG = document.querySelector("#mGr i");
for (var q = 0; q < 16; q++) disp[q] = 0;
function frame() {
  for (var i = 0; i < 6; i++) layerMeters[i].style.height = Math.round(clamp(disp[i], 0, 1) * 100) + "%";
  mL.style.height = Math.round(clamp(disp[6], 0, 1) * 100) + "%"; mR.style.height = Math.round(clamp(disp[7], 0, 1) * 100) + "%"; mG.style.height = Math.round(clamp(disp[8], 0, 1) * 100) + "%";
  requestAnimationFrame(frame);
}

// ---------- boot ----------
function boot() {
  buildLayers(); buildTabs(); buildPads(); buildPresets();
  presetSel.addEventListener("change", function () { if (+presetSel.value >= 0) loadPreset(+presetSel.value); });
  document.getElementById("pPrev").addEventListener("click", function () { loadPreset(curPreset - 1); });
  document.getElementById("pNext").addEventListener("click", function () { loadPreset(curPreset + 1); });
  document.getElementById("bInit").addEventListener("click", function () { applyPatch(null); presetSel.value = -1; dirty = false; document.getElementById("dirty").textContent = ""; });
  document.getElementById("bRnd").addEventListener("click", function () { randomize(+document.getElementById("chaosAmt").value / 100); });
  document.getElementById("bMod").addEventListener("click", randomMod);
  var hint = document.getElementById("hint");
  hint.innerHTML = "<b>Cataclysm</b> layers six sources — Tone, FM, Modal, Noise, Metal, Click — through a mod matrix and a long FX chain.<br><br>The host has only 64 parameter slots, so every control is <i>packed</i> into shared slots. <b>Macros 1–4</b> and the matrix are the DAW-automation path: route a macro to anything.<br><br>Double-click a knob to reset it, shift-drag for fine, wheel to step.";
  document.getElementById("bHelp").addEventListener("click", function () { hint.style.display = hint.style.display === "block" ? "none" : "block"; });
  var hs = {}; (location.hash || "").slice(1).split("&").forEach(function (kv) { var q = kv.split("="); if (q[0]) hs[q[0]] = decodeURIComponent(q[1] || ""); });
  showTab(hs.tab && tabPanels[hs.tab] ? hs.tab : "tone");
  // push the defaults; the shell restores a saved sound over them during its boot window
  for (var s = 0; s < NSLOT; s++) push(s);
  if (window.vstai && window.vstai.onParam) window.vstai.onParam(function (i, v) { if (i === dragSlot) return; if (FIELDS[i]) decodeSlot(i, +v); });
  if (window.vstai && window.vstai.onDisplay) window.vstai.onDisplay(function (d) { for (var i = 0; i < 16; i++) disp[i] = d[i] || 0; });
  if (hs.preset) { for (var pi = 0; pi < DATA.presets.length; pi++) if (DATA.presets[pi].name === hs.preset) loadPreset(pi); }
  window.addEventListener("resize", scheduleVis);
  requestAnimationFrame(frame);
}
if (window.__CATA_TEST) window.__cat = { set: set, applyPatch: applyPatch, V: V, R: R, decodeSlot: decodeSlot, slotValue: slotValue, NSLOT: NSLOT };
if (window.vstai && typeof window.vstai.onReady === "function") window.vstai.onReady(boot); else boot();
})();
