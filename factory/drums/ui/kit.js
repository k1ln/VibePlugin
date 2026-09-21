/* =====================================================================
   drums/ui/kit.js — shared panel components for the drum machines.
   Inlined into every gui.html by build.mjs (a plugin GUI is one file).

   Contract with the host (src/BridgeShim.h):
     · window.vstai.setParam(i, v) sends ACTUAL values (spec min..max).
     · on ready, every param's current value is pushed once;
     · window.vstai.onParam(cb) repaints controls when the DAW / a restored
       session changes a value — draw only, never push back;
     · window.vstai.onDisplay(cb) delivers the engine's 16 display floats.
   ===================================================================== */
var Kit = (function () {
  var PD = {};            // index -> {name,min,max,def,step}
  var vals = {};
  var listeners = {};
  var displayFns = [];

  function has(fn) { return window.vstai && typeof window.vstai[fn] === "function"; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(tag, attrs, parent) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function define(list) {
    list.forEach(function (p) { PD[p.index] = p; vals[p.index] = p.def; });
  }
  function get(i) { return vals[i]; }
  function norm(i) { var p = PD[i]; return (vals[i] - p.min) / ((p.max - p.min) || 1); }
  function quant(i, v) {
    var p = PD[i];
    v = clamp(v, p.min, p.max);
    if (p.step) v = Math.round((v - p.min) / p.step) * p.step + p.min;
    return v;
  }
  function notify(i) { var ls = listeners[i]; if (ls) for (var j = 0; j < ls.length; j++) ls[j](vals[i]); }
  // User change: store, send to the engine, repaint.
  function set(i, v) {
    v = quant(i, v);
    if (v === vals[i]) return;
    vals[i] = v;
    if (has("setParam")) window.vstai.setParam(+i, v);
    notify(i);
  }
  function listen(i, fn) { (listeners[i] = listeners[i] || []).push(fn); fn(vals[i]); }
  function onDisplay(fn) { displayFns.push(fn); }

  function ready() {
    for (var i in vals) if (has("setParam")) window.vstai.setParam(+i, vals[i]);
    if (has("onParam")) window.vstai.onParam(function (i, v) {
      if (!(i in PD)) return;
      vals[i] = quant(i, +v);
      notify(i);
    });
    if (has("onDisplay")) window.vstai.onDisplay(function (d) {
      for (var j = 0; j < displayFns.length; j++) { try { displayFns[j](d); } catch (e) {} }
    });
  }
  function start() { if (has("onReady")) window.vstai.onReady(ready); else ready(); }

  function note(n, vel) {
    if (!has("noteOn")) return;
    window.vstai.noteOn(n, vel == null ? 0.7 : vel);
    setTimeout(function () { if (has("noteOff")) window.vstai.noteOff(n); }, 60);
  }

  // ---- drag helper: vertical drag, shift = fine --------------------------
  function dragValue(target, i, sens) {
    var startY = 0, startN = 0, active = false;
    function move(e) {
      if (!active) return;
      var dy = startY - e.clientY;
      var k = (e.shiftKey ? 0.2 : 1) * (sens || 1) / 160;
      var p = PD[i];
      set(i, p.min + clamp(startN + dy * k, 0, 1) * (p.max - p.min));
    }
    function up() { active = false; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
    target.addEventListener("pointerdown", function (e) {
      e.preventDefault(); active = true; startY = e.clientY; startN = norm(i);
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
    target.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = PD[i], stepN = p.step ? p.step / (p.max - p.min) : 0.01;
      set(i, p.min + clamp(norm(i) + (e.deltaY < 0 ? 1 : -1) * stepN * (e.shiftKey ? 1 : 2), 0, 1) * (p.max - p.min));
    }, { passive: false });
    target.addEventListener("dblclick", function () { set(i, PD[i].def); });
  }

  // ---- knob --------------------------------------------------------------
  // opts: {label, cap (css colour), size, fmt(v) -> string, sub}
  function knob(parent, i, opts) {
    opts = opts || {};
    var size = opts.size || 44;
    var wrap = el("div", "k-wrap" + (opts.cls ? " " + opts.cls : ""), parent);
    var s = svg("svg", { width: size, height: size, viewBox: "0 0 100 100", class: "k" }, wrap);
    // scale ticks
    for (var t = 0; t <= 10; t++) {
      var a = (-135 + t * 27) * Math.PI / 180;
      svg("line", { x1: 50 + 44 * Math.sin(a), y1: 50 - 44 * Math.cos(a), x2: 50 + 49 * Math.sin(a), y2: 50 - 49 * Math.cos(a), class: "k-tick" }, s);
    }
    svg("circle", { cx: 50, cy: 50, r: 38, class: "k-skirt" }, s);
    svg("circle", { cx: 50, cy: 50, r: 30, class: "k-cap", style: opts.cap ? "fill:" + opts.cap : "" }, s);
    var needle = svg("line", { x1: 50, y1: 50, x2: 50, y2: 18, class: "k-needle" }, s);
    if (opts.label) el("div", "k-label", wrap, opts.label);
    var readout = el("div", "k-val", wrap, "");
    function draw() {
      var th = (-135 + 270 * norm(i)) * Math.PI / 180;
      needle.setAttribute("x2", 50 + 32 * Math.sin(th));
      needle.setAttribute("y2", 50 - 32 * Math.cos(th));
      readout.textContent = opts.fmt ? opts.fmt(vals[i]) : "";
    }
    listen(i, draw);
    dragValue(s, i, opts.sens);
    wrap.title = (PD[i] && PD[i].name) || "";
    return wrap;
  }

  // ---- multi-position selector (values = option index + min) -------------
  // opts: {label, options:[...labels], cls}
  function selector(parent, i, opts) {
    var wrap = el("div", "sel" + (opts.cls ? " " + opts.cls : ""), parent);
    if (opts.label) el("div", "sel-label", wrap, opts.label);
    var row = el("div", "sel-row", wrap);
    var btns = opts.options.map(function (lab, j) {
      var b = el("button", "sel-btn", row, lab);
      b.type = "button";
      b.addEventListener("click", function () { set(i, PD[i].min + j * (PD[i].step || 1)); });
      return b;
    });
    listen(i, function (v) {
      var j = Math.round((v - PD[i].min) / (PD[i].step || 1));
      btns.forEach(function (b, k) { b.classList.toggle("on", k === j); });
    });
    return wrap;
  }

  // ---- one bit of a packed switch word ------------------------------------
  function bitSwitch(parent, i, bit, offLabel, onLabel, cls) {
    var b = el("button", "bit" + (cls ? " " + cls : ""), parent);
    b.type = "button";
    var a = el("span", "bit-a", b, offLabel), c = el("span", "bit-b", b, onLabel);
    b.addEventListener("click", function () { set(i, Math.round(vals[i]) ^ (1 << bit)); });
    listen(i, function (v) { var on = (Math.round(v) >> bit) & 1; b.classList.toggle("on", !!on); });
    return b;
  }

  function toggle(parent, i, label, cls) {
    var b = el("button", "tog" + (cls ? " " + cls : ""), parent, label);
    b.type = "button";
    b.addEventListener("click", function () { set(i, vals[i] > 0.5 ? 0 : 1); });
    listen(i, function (v) { b.classList.toggle("on", v > 0.5); });
    return b;
  }

  function pad(parent, noteNum, label, cls) {
    var b = el("button", "pad" + (cls ? " " + cls : ""), parent, label);
    b.type = "button";
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); note(noteNum, e.shiftKey ? 1.0 : 0.62); b.classList.add("hit"); setTimeout(function () { b.classList.remove("hit"); }, 90); });
    return b;
  }

  // A 16-bit step row stored in one parameter.
  function rowBit(i, step) { return (Math.round(vals[i]) >> step) & 1; }
  function toggleStep(i, step) { set(i, Math.round(vals[i]) ^ (1 << step)); }

  return {
    define: define, get: get, set: set, listen: listen, onDisplay: onDisplay, start: start,
    knob: knob, selector: selector, bitSwitch: bitSwitch, toggle: toggle, pad: pad, note: note,
    rowBit: rowBit, toggleStep: toggleStep, el: el, svg: svg, PD: PD
  };
})();
