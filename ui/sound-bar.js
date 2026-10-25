/* sound-bar.js
 * =====================================================================
 *  The "sound bar": a small floating  ⋮⋮ ‹ Sounds › Save –  pill that gives ANY generated
 *  GUI a front door to the in-plugin sound browser (ui/preset-browser.js) without the GUI
 *  having to know about it. Prev/next step through the sounds, the name opens the browser
 *  drawer, Save writes the current knob positions to disk (WebCLAP: browser storage).
 *
 *  Baked into every .vstai's GUI as <script data-vstai-sound-bar> by factory/tools/sound-bar.mjs
 *  (idempotent; scripts/add-sound-bar.mjs retrofits a whole folder), AND injected by the host after
 *  the drawer (embed-preset-ui.mjs) so a GUI generated later gets it too. It does nothing when
 *    * the host has no sound browser (window.vstai.presets) - e.g. the web gallery player,
 *    * the GUI brought its own control (any element with data-vstai-sound), or
 *    * the host shows a native bar (window.__vstaiNativeSoundBar - exported VST3s).
 *  Drag the grip to move it out of the way (remembered); "–" folds it down to a note icon.
 *  Plain ES5 on purpose; it runs in WKWebView, WebView2 and every browser.
 * ===================================================================== */
(function () {
  if (window.__vstaiSoundBarBuilt) return;
  var POS_KEY = 'vstai.soundBar.pos', MIN_KEY = 'vstai.soundBar.min';
  var tries = 0;

  function store(k, v) { try { if (v == null) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  function ready() {
    var V = window.vstai;
    return V && V.presets && typeof V.openBrowser === 'function' && typeof V.saveSound === 'function';
  }

  function boot() {
    if (window.__vstaiSoundBarBuilt) return;
    if (window.__vstaiNativeSoundBar) return;                       // the host draws its own bar
    if (!ready()) { if (++tries < 40) setTimeout(boot, 150); return; }
    if (document.querySelector('[data-vstai-sound]')) return;       // the GUI has its own control
    window.__vstaiSoundBarBuilt = true;
    build(window.vstai);
  }

  function build(V) {
    var host = document.createElement('div');
    host.id = 'vstai-sound-bar';
    host.setAttribute('data-vstai-sound-bar-host', '');
    host.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483000;margin:0;padding:0;border:0';
    var root = host.attachShadow({ mode: 'open' });
    var css = document.createElement('style');
    css.textContent = [
      ':host{all:initial}*{box-sizing:border-box}',
      '.bar{display:flex;align-items:center;gap:1px;height:26px;padding:0 3px;border-radius:13px;',
      ' background:rgba(14,18,24,.86);border:1px solid rgba(255,255,255,.2);box-shadow:0 2px 10px rgba(0,0,0,.45);',
      ' color:#e6e9ee;font:11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      ' opacity:.62;transition:opacity .12s;user-select:none;-webkit-user-select:none}',
      '.bar:hover,.bar.drag{opacity:1}',
      'button{font:inherit;color:inherit;background:transparent;border:0;border-radius:10px;height:20px;min-width:20px;padding:0 5px;cursor:pointer;line-height:20px}',
      'button:hover{background:rgba(255,255,255,.14)}button:active{background:rgba(255,255,255,.24)}',
      '.grip{cursor:grab;min-width:12px;padding:0 3px;color:#8a95a5;letter-spacing:-2px;touch-action:none}.drag .grip{cursor:grabbing}',
      '.name{max-width:130px;min-width:46px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-weight:600}',
      '.save{background:#6fd8bd;color:#06231c;font-weight:700;margin-left:2px}.save:hover{background:#85e3cc}',
      '.arrow{font-size:15px;padding:0 4px}',
      '.min .hide{display:none}'
    ].join('');
    root.appendChild(css);

    function el(tag, cls, text, title) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      if (title) e.title = title;
      if (tag === 'button') e.type = 'button';
      return e;
    }
    var bar = el('div', 'bar');
    var grip = el('button', 'grip', '⋮⋮', 'Drag to move');
    var prev = el('button', 'arrow hide', '‹', 'Previous sound');
    var name = el('button', 'name hide', 'Sounds', 'Browse sounds: types, tags, favorites');
    var next = el('button', 'arrow hide', '›', 'Next sound');
    var save = el('button', 'save hide', 'Save', 'Save the current knob positions as a sound');
    var fold = el('button', 'fold', '–', 'Fold away');
    [grip, prev, name, next, save, fold].forEach(function (b) { bar.appendChild(b); });
    root.appendChild(bar);

    // The page behind must keep keyboard focus (typing piano) and never see our pointer traffic.
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'contextmenu'].forEach(function (t) {
      bar.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    prev.onclick = function () { V.prevPreset(); };
    next.onclick = function () { V.nextPreset(); };
    name.onclick = function () { V.openBrowser(); };
    save.onclick = function () { V.saveSound(); };

    function setMin(m) {
      bar.className = 'bar' + (m ? ' min' : '');
      fold.textContent = m ? '♫' : '–';
      fold.title = m ? 'Show the sound bar' : 'Fold away';
      store(MIN_KEY, m ? '1' : '0');
      clamp();
    }
    fold.onclick = function () { setMin(bar.className.indexOf('min') < 0); };

    // ---- position: drag by the grip, remember, keep on screen ----------------
    function clamp() {
      var r = host.getBoundingClientRect(), w = window.innerWidth, h = window.innerHeight;
      var x = Math.min(Math.max(0, r.left), Math.max(0, w - r.width));
      var y = Math.min(Math.max(0, r.top), Math.max(0, h - r.height));
      if (host.style.left || host.style.right === 'auto') { host.style.left = x + 'px'; host.style.top = y + 'px'; host.style.right = 'auto'; }
    }
    function place(x, y) { host.style.left = x + 'px'; host.style.top = y + 'px'; host.style.right = 'auto'; clamp(); }
    var drag = null;
    grip.addEventListener('pointerdown', function (e) {
      var r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.className += ' drag';
      try { grip.setPointerCapture(e.pointerId); } catch (x) {}
    });
    grip.addEventListener('pointermove', function (e) { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    function drop() {
      if (!drag) return;
      drag = null; bar.className = bar.className.replace(' drag', '');
      var r = host.getBoundingClientRect(); store(POS_KEY, Math.round(r.left) + ',' + Math.round(r.top));
    }
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
    window.addEventListener('resize', clamp);

    document.documentElement.appendChild(host);
    setMin(store(MIN_KEY) === '1');
    var saved = (store(POS_KEY) || '').split(',');
    if (saved.length === 2 && isFinite(+saved[0]) && isFinite(+saved[1])) place(+saved[0], +saved[1]);
    else {
      // No remembered spot: once the GUI has drawn, park the bar where it hides the least.
      var settle = function () { if (!drag) autoPlace(); };
      setTimeout(settle, 700); setTimeout(settle, 2500);
    }

    // The corner / edge whose pill-sized patch is mostly empty background: sample a grid of points and
    // count how many land on something control-sized (a panel or the page itself counts as background).
    function autoPlace() {
      if (store(POS_KEY)) return;
      var w = window.innerWidth, h = window.innerHeight, r = host.getBoundingClientRect(), bw = r.width, bh = r.height, m = 8;
      if (!bw || !bh) return;
      var cand = [[w - bw - m, m], [m, m], [(w - bw) / 2, m], [w - bw - m, h - bh - m], [m, h - bh - m], [(w - bw) / 2, h - bh - m]];
      var prev = host.style.display; host.style.display = 'none';          // look at the GUI, not at ourselves
      var best = -1, bestScore = 1e9;
      for (var c = 0; c < cand.length; c++) {
        var x0 = cand[c][0], y0 = cand[c][1], score = 0;
        for (var gx = 0; gx < 8; gx++) for (var gy = 0; gy < 3; gy++) {
          var e = document.elementFromPoint(x0 + (gx + .5) * bw / 8, y0 + (gy + .5) * bh / 3);
          if (!e || e === document.body || e === document.documentElement) continue;
          var b = e.getBoundingClientRect();
          if (b.width * b.height < .3 * w * h) score++;                        // a control-sized thing is under here
        }
        score += c * .01;                                                      // ties keep the earlier (top-right first) choice
        if (score < bestScore) { bestScore = score; best = c; }
      }
      host.style.display = prev;
      var cur = bestScore;
      if (best > 0 || cur >= 1) place(cand[best][0], cand[best][1]);
      host.__placed = best;
    }

    // ---- the name follows the loaded sound ------------------------------------
    function show(d) {
      var n = '';
      for (var i = 0; i < d.entries.length; i++) if (d.entries[i].id === d.current) n = d.entries[i].name;
      name.textContent = n || 'Sounds';
      name.title = n ? n + ' – browse sounds' : 'Browse sounds: types, tags, favorites';
    }
    V.presets.onChange(show);
    V.presets.list().catch(function () {});
  }

  // Give the GUI time to build itself first: one that makes its own sound control (data-vstai-sound)
  // does it while loading, and the bar must see that before deciding to show up.
  function later() { setTimeout(boot, 350); }
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();
