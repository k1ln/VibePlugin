var VS = (function () {
  "use strict";
  var defs = {}, vals = {}, listeners = {};
  function define(list) {
    for (var k = 0; k < list.length; k++) {
      var p = list[k];
      defs[p.index] = { i: p.index, name: p.name, min: p.min, max: p.max, def: p.default, step: p.step || 0 };
      vals[p.index] = p.default;
    }
  }
  function v(i) { return vals[i]; }
  function fire(i) { var l = listeners[i]; if (l) for (var k = 0; k < l.length; k++) l[k](); }
  function listen(i, f) { (listeners[i] = listeners[i] || []).push(f); }
  function clampv(i, x) {
    var d = defs[i]; x = Math.max(d.min, Math.min(d.max, x));
    if (d.step) x = Math.round(x / d.step) * d.step;
    return x;
  }
  function push(i, x) {
    x = clampv(i, +x); vals[i] = x;
    if (window.vstai && typeof window.vstai.setParam === "function") window.vstai.setParam(i, x);
    fire(i);
  }
  function el(tag, cls, parent, txt) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e;
  }
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e); return e;
  }
  function polar(cx, cy, r, deg) { var a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arc(cx, cy, r, d0, d1) {
    if (Math.abs(d1 - d0) < 0.05) d1 = d0 + 0.05;
    var lo = Math.min(d0, d1), hi = Math.max(d0, d1);
    var p0 = polar(cx, cy, r, lo), p1 = polar(cx, cy, r, hi);
    return "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A" + r + " " + r + " 0 " + ((hi - lo) > 180 ? 1 : 0) + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
  }

  // ---- knob ----
  function knob(parent, idx, opts) {
    opts = opts || {};
    var d = defs[idx], size = opts.size || 60;
    var bipolar = d.min < 0 && d.max > 0 && opts.center !== false;
    var box = el("div", "knob", parent);
    var s = svgEl("svg", { viewBox: "0 0 100 100", width: size, height: size }, box);
    var A0 = -135, A1 = 135;
    svgEl("path", { "class": "trk", d: arc(50, 50, 41, A0, A1), "stroke-width": 6, "stroke-linecap": "round" }, s);
    var av = svgEl("path", { "class": "arc", d: "", "stroke-width": 6, "stroke-linecap": "round" }, s);
    svgEl("circle", { "class": "body", cx: 50, cy: 50, r: 28 }, s);
    svgEl("circle", { "class": "cap", cx: 50, cy: 43, r: 26 }, s);
    var ptr = svgEl("line", { "class": "ptr", x1: 50, y1: 50, x2: 50, y2: 30, "stroke-width": 4 }, s);
    svgEl("circle", { "class": "dot", cx: 50, cy: 50, r: 3 }, s);
    var nm = el("div", "nm", box, opts.label || d.name);
    var vl = el("div", "vl", box);
    var fmt = opts.fmt || function (x) { return (Math.round(x * 100) / 100) + ""; };
    function paint() {
      var x = vals[idx], t = (x - d.min) / (d.max - d.min);
      t = Math.max(0, Math.min(1, t));
      var deg = A0 + t * (A1 - A0), t0 = bipolar ? A0 + 0.5 * (A1 - A0) : A0;
      av.setAttribute("d", arc(50, 50, 41, t0, deg));
      var tip = polar(50, 50, 21, deg);
      ptr.setAttribute("x2", tip[0].toFixed(2)); ptr.setAttribute("y2", tip[1].toFixed(2));
      vl.textContent = fmt(x);
    }
    listen(idx, paint); paint();
    var drag = false, lastY = 0;
    s.addEventListener("pointerdown", function (e) {
      drag = true; lastY = e.clientY; box.classList.add("drag");
      try { s.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    s.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dy = lastY - e.clientY; lastY = e.clientY;
      var span = d.max - d.min, sens = d.step ? d.step / 8 : span / 170;
      var cur = acc[idx] == null ? vals[idx] : acc[idx];
      cur = Math.max(d.min, Math.min(d.max, cur + dy * sens * (e.shiftKey ? 0.2 : 1)));
      acc[idx] = cur; push(idx, cur);
    });
    function end() { drag = false; acc[idx] = null; box.classList.remove("drag"); }
    s.addEventListener("pointerup", end); s.addEventListener("pointercancel", end);
    s.addEventListener("dblclick", function () { push(idx, d.def); });
    s.addEventListener("wheel", function (e) {
      var span = d.max - d.min, st = d.step || span * 0.02;
      push(idx, vals[idx] - Math.sign(e.deltaY) * st); e.preventDefault();
    }, { passive: false });
    return box;
  }
  var acc = {};

  // ---- segmented selector (values min..min+n-1) ----
  function seg(parent, idx, labels, cls) {
    var d = defs[idx], box = el("div", "seg" + (cls ? " " + cls : ""), parent), btns = [];
    labels.forEach(function (lb, k) {
      var b = el("button", "opt", box, lb); b.type = "button";
      b.addEventListener("click", function () { push(idx, d.min + k); });
      btns.push(b);
    });
    function paint() { var cur = Math.round(vals[idx] - d.min); btns.forEach(function (b, k) { b.classList.toggle("on", k === cur); }); }
    listen(idx, paint); paint(); return box;
  }
  function toggle(parent, idx, label, cls) {
    var b = el("button", "btn " + (cls || ""), parent, label); b.type = "button";
    b.addEventListener("click", function () { push(idx, vals[idx] >= 0.5 ? 0 : 1); });
    function paint() { b.classList.toggle("on", vals[idx] >= 0.5); }
    listen(idx, paint); paint(); return b;
  }
  function stepper(parent, idx, fmt, alsoIdx) {
    var box = el("div", "stepper", parent), m = el("button", "", box, "−"), lab = el("div", "v", box), p = el("button", "", box, "+");
    m.type = "button"; p.type = "button";
    m.addEventListener("click", function () { push(idx, vals[idx] - 1); });
    p.addEventListener("click", function () { push(idx, vals[idx] + 1); });
    function paint() { lab.textContent = fmt ? fmt(vals[idx]) : vals[idx]; }
    listen(idx, paint); if (alsoIdx != null) listen(alsoIdx, paint); paint(); return box;
  }


  // ---- vertical fader (click/drag anywhere on the track) ----
  function fader(parent, idx, opts) {
    opts = opts || {};
    var d = defs[idx], box = el("div", "fader" + (opts.bipolar ? " bi" : ""), parent), fill = el("div", "fill", box), lab = el("div", "fl", box);
    box.style.height = (opts.h || 90) + "px";
    var fmt = opts.fmt || function (x) { return x + ""; };
    function paint() {
      var t = (vals[idx] - d.min) / (d.max - d.min); t = Math.max(0, Math.min(1, t));
      if (opts.bipolar) { var lo = Math.min(t, 0.5), hi = Math.max(t, 0.5); fill.style.bottom = (lo * 100) + "%"; fill.style.height = ((hi - lo) * 100) + "%"; }
      else { fill.style.bottom = "0"; fill.style.height = (t * 100) + "%"; }
      lab.textContent = fmt(vals[idx]);
      box.classList.toggle("zero", vals[idx] === (opts.bipolar ? 0 : d.min));
    }
    function set(e) {
      var r = box.getBoundingClientRect(), t = 1 - (e.clientY - r.top) / r.height;
      push(idx, d.min + Math.max(0, Math.min(1, t)) * (d.max - d.min));
    }
    var drag = false;
    box.addEventListener("pointerdown", function (e) { drag = true; try { box.setPointerCapture(e.pointerId); } catch (_) {} set(e); e.preventDefault(); });
    box.addEventListener("pointermove", function (e) { if (drag) set(e); });
    function end() { drag = false; }
    box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
    box.addEventListener("dblclick", function () { push(idx, opts.reset != null ? opts.reset : d.def); });
    listen(idx, paint); paint(); return box;
  }

  function boot(build, loop) {
    function ready() {
      build();
      for (var i in vals) if (window.vstai && window.vstai.setParam) window.vstai.setParam(+i, vals[i]);
      if (window.vstai && window.vstai.onParam) window.vstai.onParam(function (i, x) {
        if (!(i in vals)) return; vals[i] = +x; fire(i);
      });
      if (loop) { var last = 0; (function frame(t) { var dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t; try { loop(t / 1000, dt); } catch (e) { console.error(e); } requestAnimationFrame(frame); })(0); }
    }
    if (window.vstai && typeof window.vstai.onReady === "function") window.vstai.onReady(ready); else ready();
  }

  // canvas helper: crisp DPR-aware sizing; returns {c,ctx,w(),h()}
  function canvas(parent, h) {
    var c = el("canvas", "", parent); c.style.width = "100%"; c.style.height = h + "px";
    var ctx = c.getContext("2d"), W = 1, H = h, dpr = 1;
    function fit() { dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(1, c.clientWidth); c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    fit(); window.addEventListener("resize", fit);
    return { c: c, ctx: ctx, w: function () { return c.clientWidth || W; }, h: function () { return H; }, fit: fit };
  }
  return { define: define, v: v, push: push, listen: listen, el: el, svgEl: svgEl, knob: knob, seg: seg, toggle: toggle, stepper: stepper, fader: fader, boot: boot, canvas: canvas, defs: defs };
})();
