// shim.js — window.vstai for a plugin GUI running as a WebCLAP webview page.
//
// The desktop shim (BridgeShim.h) reaches the host with fetch(); here the host is
// the CLAP module, reached with the clap.webview message channel: ArrayBuffers
// posted to window.parent, ArrayBuffers coming back as "message" events. The
// frames are the ones clap-adapter.ts reads and writes:
//
//   page -> plugin   'H'                         hello (page is up)
//                    'P' u32 index, f64 value    parameter edit
//                    'B' / 'E' u32 index         gesture begin / end (automation)
//                    'N' u8 note, f32 velocity   note on        'F' u8 note   note off
//   plugin -> page   'P' u16 count, count * (u32 index, f64 value)
//                    'D' 16 * f32                display floats (onDisplay)
//
// Everything is little endian. The API a generated GUI sees is unchanged.
(function () {
  var vals = {};
  var paramCbs = [];
  var displayCbs = [];
  var held = {};
  var gest = {};            // index -> timer, while an edit gesture is open
  var snapshot = null;      // values the plugin reported on hello
  var booting = true;       // GUIs push their own defaults while they build
  var sentHello = false;

  function endBoot() { booting = false; }
  window.addEventListener('pointerdown', endBoot, true);
  window.addEventListener('keydown', endBoot, true);
  setTimeout(endBoot, 6000);

  function post(bytes) {
    try { window.parent.postMessage(bytes.buffer, '*', [bytes.buffer]); } catch (e) {}
  }
  function frame(len) { var b = new Uint8Array(len); return { b: b, v: new DataView(b.buffer) }; }

  function hello() {
    if (sentHello) return;
    sentHello = true;
    var f = frame(1); f.b[0] = 0x48; post(f.b);
  }

  function sendParam(i, v) {
    var f = frame(13);
    f.b[0] = 0x50; f.v.setUint32(1, i, true); f.v.setFloat64(5, v, true);
    post(f.b);
  }
  function sendGesture(kind, i) {
    var f = frame(5);
    f.b[0] = kind; f.v.setUint32(1, i, true);
    post(f.b);
  }
  function touch(i) {
    if (gest[i] == null) sendGesture(0x42, i);
    else clearTimeout(gest[i]);
    gest[i] = setTimeout(function () { gest[i] = null; sendGesture(0x45, i); }, 300);
  }
  function sendNote(n, on, vel) {
    if (on) { var f = frame(6); f.b[0] = 0x4E; f.b[1] = n; f.v.setFloat32(2, vel, true); post(f.b); }
    else { var g = frame(2); g.b[0] = 0x46; g.b[1] = n; post(g.b); }
  }

  function fire(i, v) {
    vals[i] = v;
    for (var j = 0; j < paramCbs.length; j++) { try { paramCbs[j](i, v); } catch (_) {} }
  }

  window.vstai = {
    setParam: function (i, v) {
      i = i | 0; v = +v;
      if (booting) {
        // Before the plugin's values arrive there is nothing to compare with, so keep
        // the GUI's default to ourselves; afterwards the plugin's value wins.
        if (!snapshot) { vals[i] = v; return; }
        if (i in snapshot && Math.abs(v - snapshot[i]) > 1e-6) v = snapshot[i];
      }
      vals[i] = v;
      sendParam(i, v);
      if (!booting) touch(i);
    },
    getParam: function (i) { return (i in vals) ? vals[i] : 0; },
    hostMenu: function () {},
    onReady: function (cb) { try { cb(); } catch (e) {} },
    onParam: function (cb) {
      if (typeof cb !== 'function') return;
      paramCbs.push(cb);
      // Replay what the plugin holds so a control built from its default draws the sound.
      setTimeout(function () {
        for (var k in vals) { try { cb(+k, vals[k]); } catch (_) {} }
      }, 0);
    },
    onDisplay: function (cb) { if (typeof cb === 'function') displayCbs.push(cb); },
    noteOn: function (n, v) { n = n | 0; held[n] = 1; sendNote(n, true, v == null ? 1 : +v); },
    noteOff: function (n) { n = n | 0; delete held[n]; sendNote(n, false, 0); },
    loadSample: function () {
      return Promise.reject(new Error('Loading samples is not supported in the WebCLAP version.'));
    },
    // The sound browser (presets.js) loading a sound: send the value to the plugin AND tell the
    // GUI's own controls, which only follow values that arrive from outside (onParam).
    _setFromHost: function (i, v) {
      i = i | 0; v = +v;
      endBoot();
      vals[i] = v;
      sendParam(i, v);
      touch(i);
      fire(i, v);
    }
  };

  // Stuck-note safety net, as in the desktop shim.
  function allNotesOff() {
    for (var k in held) sendNote(k | 0, false, 0);
    held = {};
  }
  var off = function () { if (Object.keys(held).length) allNotesOff(); };
  window.addEventListener('pointerup', off, true);
  window.addEventListener('mouseup', off, true);
  window.addEventListener('pointercancel', off, true);
  window.addEventListener('blur', allNotesOff);
  document.addEventListener('visibilitychange', function () { if (document.hidden) allNotesOff(); });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!(d instanceof ArrayBuffer) || d.byteLength < 1) return;
    var v = new DataView(d);
    var t = v.getUint8(0);
    if (t === 0x50 && d.byteLength >= 3) {
      var n = v.getUint16(1, true), p = 3, first = !snapshot, snap = snapshot || {};
      for (var k = 0; k < n && p + 12 <= d.byteLength; k++, p += 12) {
        var idx = v.getUint32(p, true), val = v.getFloat64(p + 4, true);
        if (first) snap[idx] = val;
        fire(idx, val);
      }
      snapshot = snap;
    } else if (t === 0x44 && d.byteLength >= 65) {
      var arr = [];
      for (var q = 0; q < 16; q++) arr.push(v.getFloat32(1 + q * 4, true));
      for (var j = 0; j < displayCbs.length; j++) { try { displayCbs[j](arr); } catch (_) {} }
    }
  });

  hello();
  // The host may open the window before the plugin is ready for messages; ask again.
  var again = setInterval(function () {
    if (snapshot) { clearInterval(again); return; }
    sentHello = false; hello();
  }, 500);
})();
