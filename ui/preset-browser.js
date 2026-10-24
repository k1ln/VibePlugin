/* preset-browser.js
 * =====================================================================
 *  The in-plugin sound browser ("Pro browser"). Injected after the bridge shim into
 *  EVERY generated GUI (see src/BridgeShim.h withBridge), so it works with any design,
 *  in the authoring editor and in an exported product alike.
 *
 *  Source of truth is this file; scripts/embed-preset-ui.mjs bakes it into
 *  src/PresetBrowserUi.h (exports strip Resources/ui, so it must live in the binary).
 *  Plain ES2015 on purpose: it runs in WKWebView / WebView2 of every supported OS.
 *
 *  Host calls (all GET, JSON reply — see handleBridgeFetch in BridgeShim.h):
 *      /__vstai/presets/list | load/<id> | save/<json> | delete/<id> | fav/<id>/<0|1> | reveal
 *      /__vstai/presets/meta/<json> | cat/add/<name> | cat/del/<name>
 *
 *  Public API (window.vstai):
 *      presets.{list,load,save,remove,favorite,meta,addCategory,removeCategory,onChange}
 *      openBrowser() closeBrowser() toggleBrowser() saveSound() nextPreset() prevPreset()
 *  A host can also drive it with window.postMessage({type:'vstai:browser', action:
 *  'open'|'close'|'toggle'|'save'|'next'|'prev'}).
 * ===================================================================== */
(function () {
  var V = window.vstai;
  if (!V || V.presets || typeof V._call !== 'function') return;
  var call = V._call;

  var data = { product: '', instrument: true, current: '', categories: [], entries: [] };
  var listeners = [];
  var ui = null;                       // built lazily on first open
  var view = { scope: 'all', cat: '', tags: [], q: '', sel: -1, form: null };

  function enc(s) { return encodeURIComponent(s); }
  function api(path) {
    return call(path).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('bad reply from the plugin'); }
      return j;
    });
  }
  function adopt(j) {
    if (j && j.entries) data = j;
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](data); } catch (e) {} }
    if (ui && ui.open) render();
    return j;
  }

  var presets = {
    list: function () { return api('/__vstai/presets/list').then(adopt); },
    load: function (id) { return api('/__vstai/presets/load/' + enc(id)).then(adopt); },
    save: function (o) { return api('/__vstai/presets/save/' + enc(JSON.stringify(o))).then(adopt); },
    remove: function (id) { return api('/__vstai/presets/delete/' + enc(id)).then(adopt); },
    favorite: function (id, on) { return api('/__vstai/presets/fav/' + enc(id) + '/' + (on ? 1 : 0)).then(adopt); },
    meta: function (o) { return api('/__vstai/presets/meta/' + enc(JSON.stringify(o))).then(adopt); },
    addCategory: function (n) { return api('/__vstai/presets/cat/add/' + enc(n)).then(adopt); },
    removeCategory: function (n) { return api('/__vstai/presets/cat/del/' + enc(n)).then(adopt); },
    reveal: function () { return api('/__vstai/presets/reveal').then(adopt); },
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    get: function () { return data; }
  };

  /* ---------- filtering ------------------------------------------------- */
  function byName(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; }
  function matches(e) {
    if (view.scope === 'fav' && !e.favorite) return false;
    if (view.scope === 'factory' && !e.factory) return false;
    if (view.scope === 'user' && e.factory) return false;
    if (view.cat && e.category.toLowerCase() !== view.cat.toLowerCase()) return false;
    for (var i = 0; i < view.tags.length; i++) {
      var has = false;
      for (var k = 0; k < e.tags.length; k++) if (e.tags[k].toLowerCase() === view.tags[i].toLowerCase()) has = true;
      if (!has) return false;
    }
    var words = view.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      var hay = (e.name + ' ' + e.category + ' ' + e.tags.join(' ')).toLowerCase();
      for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) < 0) return false;
    }
    return true;
  }
  function visible() { return data.entries.filter(matches).sort(byName); }

  function step(dir) {
    var run = function () {
      var list = (ui && ui.open ? visible() : data.entries.slice().sort(byName));
      if (!list.length) return;
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].id === data.current) i = k;
      i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
      view.sel = i;
      presets.load(list[i].id);
    };
    if (data.entries.length) run(); else presets.list().then(run);
  }

  /* ---------- drawer (Shadow DOM: the GUI's CSS can't reach in, ours can't leak out) ---------- */
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.scrim{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.45);opacity:0;transition:opacity .15s}',
    '.panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);display:flex;flex-direction:column;background:#12161c;color:#e6e9ee;',
    ' font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:-12px 0 40px rgba(0,0,0,.5);',
    ' transform:translateX(100%);transition:transform .15s ease-out;border-left:1px solid #2a323d}',
    '.open .scrim{opacity:1}.open .panel{transform:none}',
    'header{display:flex;align-items:center;gap:6px;padding:12px 12px 8px 16px}',
    '.title{flex:1;font-size:15px;font-weight:600;letter-spacing:.02em}.title small{font-weight:400;color:#8a95a5;margin-left:8px}',
    'button{font:inherit;color:inherit;background:#1d242d;border:1px solid #2c3541;border-radius:6px;padding:5px 10px;cursor:pointer}',
    'button:hover{background:#26303b}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #6fd8bd;outline-offset:1px}',
    '.ib{width:30px;padding:4px 0;text-align:center;font-size:15px}',
    '.search{padding:0 16px 8px}',
    'input,select{width:100%;font:inherit;color:inherit;background:#0b0f14;border:1px solid #2c3541;border-radius:6px;padding:7px 10px}',
    '.scopes{display:flex;gap:4px;padding:0 16px 8px}.scopes button{flex:1;padding:5px 4px}',
    '.scopes button.on,.chip.on{background:#6fd8bd;color:#06231c;border-color:#6fd8bd;font-weight:600}',
    '.sect{padding:6px 16px 4px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#8a95a5}',
    '.chips{display:flex;flex-wrap:wrap;gap:5px;padding:0 16px 6px}',
    '.chip{padding:3px 9px;border-radius:999px;font-size:12px;position:relative}.chip i{font-style:normal;opacity:.6;margin-left:5px}',
    '.chip.custom{border-style:dashed}.chip .x{margin-left:6px;opacity:.55;font-style:normal}.chip .x:hover{opacity:1}',
    '.chip.add{background:none;border-style:dashed;color:#8a95a5}',
    '.tagrow .chip{border-radius:5px;background:transparent;border-color:#2c3541;color:#b4c0cf}.tagrow .chip::before{content:"#";opacity:.5;margin-right:2px}',
    '.tagrow .chip.on{background:#6fd8bd;color:#06231c;border-color:#6fd8bd}',
    '.chip input{width:110px;padding:1px 4px;font-size:12px;border-radius:4px}',
    'ul{list-style:none;margin:6px 0 0;padding:0;flex:1;overflow:auto;border-top:1px solid #2a323d}',
    'li{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 10px;border-bottom:1px solid #1b222b;cursor:pointer}',
    'li:hover,li.sel{background:#1b2330}li.cur{background:#17302d;box-shadow:inset 3px 0 #6fd8bd}',
    '.star{background:none;border:0;padding:2px 4px;font-size:16px;color:#5d6877;line-height:1}.star.on{color:#f2c14e}',
    '.nm{flex:1;min-width:0}.nm b{font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.nm span{color:#8a95a5;font-size:11px}.ty{font-size:11px;color:#9fb0c3;background:#1d2733;border-radius:4px;padding:1px 6px}',
    '.edit{background:none;border:0;color:#8a95a5;padding:2px 6px}.empty{padding:28px 20px;color:#8a95a5;text-align:center}',
    '.foot{padding:10px 16px;border-top:1px solid #2a323d;display:flex;gap:8px;align-items:center}.foot button.primary{flex:1}',
    'button.primary{background:#6fd8bd;color:#06231c;border-color:#6fd8bd;font-weight:600}button.primary:hover{background:#85e3cc}',
    'button.danger{color:#ff8a8a}',
    '.form{padding:12px 16px;border-top:1px solid #2a323d;background:#0f1319;display:grid;gap:8px}',
    '.form label{display:grid;gap:3px;font-size:11px;color:#8a95a5}.form .row{display:flex;gap:8px}.form .row button{flex:1}',
    '.msg{color:#ff8a8a;font-size:12px;min-height:16px}.hint{color:#6f7b8b;font-size:11px}',
    /* the default plugin window is only ~600px tall: keep the list the biggest thing on screen */
    '.chips{max-height:68px;overflow-y:auto}',
    '@media (max-height:760px){.sect{display:none}.chips{max-height:56px}header{padding-top:8px}.scopes,.search{padding-bottom:6px}}',
    '.forming .scopes,.forming .sect,.forming .chips{display:none}'
  ].join('');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    var host = document.createElement('div');
    host.id = 'vstai-sound-browser';
    host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:none';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
    var wrap = el('div', 'wrap'); root.appendChild(wrap);
    var scrim = el('div', 'scrim'); wrap.appendChild(scrim);
    var panel = el('aside', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Sound browser'); wrap.appendChild(panel);

    var head = el('header'); var title = el('div', 'title', 'Sounds'); var prod = el('small'); title.appendChild(prod); head.appendChild(title);
    var bPrev = el('button', 'ib', '‹'), bNext = el('button', 'ib', '›'), bClose = el('button', 'ib', '✕');
    bPrev.title = 'Previous sound'; bNext.title = 'Next sound'; bClose.title = 'Close (Esc)';
    head.appendChild(bPrev); head.appendChild(bNext); head.appendChild(bClose); panel.appendChild(head);

    var sw = el('div', 'search'); var q = el('input'); q.type = 'search'; q.placeholder = 'Search name, type or tag…'; q.setAttribute('aria-label', 'Search sounds');
    sw.appendChild(q); panel.appendChild(sw);

    var scopes = el('div', 'scopes'); var scopeBtn = {};
    [['all', 'All'], ['fav', '★ Favorites'], ['factory', 'Factory'], ['user', 'My sounds']].forEach(function (s) {
      var b = el('button', '', s[1]); b.onclick = function () { view.scope = s[0]; view.sel = -1; render(); };
      scopeBtn[s[0]] = b; scopes.appendChild(b);
    });
    panel.appendChild(scopes);

    panel.appendChild(el('div', 'sect', 'Type')); var cats = el('div', 'chips'); panel.appendChild(cats);
    var tagsHead = el('div', 'sect', 'Tags'); panel.appendChild(tagsHead); var tags = el('div', 'chips tagrow'); panel.appendChild(tags);
    var list = el('ul'); panel.appendChild(list);
    var form = el('div', 'form'); form.style.display = 'none'; panel.appendChild(form);
    var foot = el('div', 'foot'); var bSave = el('button', 'primary', '＋ Save current sound…'); foot.appendChild(bSave);
    var bFolder = el('button', '', 'Show folder'); bFolder.title = 'Your saved sounds are a file on disk'; bFolder.style.display = 'none'; foot.appendChild(bFolder);
    panel.appendChild(foot);

    // The page's own key handlers (typing piano, shortcuts) must never see keys typed in here.
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { panel.addEventListener(t, function (e) { e.stopPropagation(); }); });

    ui = { host: host, panel: panel, wrap: wrap, prod: prod, q: q, scopeBtn: scopeBtn, cats: cats, tags: tags, tagsHead: tagsHead,
           list: list, form: form, foot: foot, bSave: bSave, bFolder: bFolder, open: false };

    scrim.onclick = close; bClose.onclick = close; bPrev.onclick = function () { step(-1); }; bNext.onclick = function () { step(1); };
    bSave.onclick = function () { openForm({ mode: 'save' }); };
    bFolder.onclick = function () { presets.reveal(); };
    q.oninput = function () { view.q = q.value; view.sel = -1; renderList(); };
    panel.addEventListener('keydown', function (e) {
      var l = visible();
      if (e.key === 'Escape') { if (view.form) { view.form = null; render(); } else close(); e.preventDefault(); }
      else if (view.form) return;
      else if (e.key === 'ArrowDown' && l.length) { view.sel = Math.min(l.length - 1, view.sel + 1); renderList(true); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && l.length) { view.sel = Math.max(0, view.sel - 1); renderList(true); e.preventDefault(); }
      else if (e.key === 'Enter' && view.sel >= 0 && l[view.sel] && e.target === q) { presets.load(l[view.sel].id); e.preventDefault(); }
    });
    document.documentElement.appendChild(host);
  }

  function chip(label, count, on, onclick) {
    var c = el('button', 'chip' + (on ? ' on' : ''), label);
    if (count != null) { var n = el('i', '', String(count)); c.appendChild(n); }
    c.onclick = onclick; return c;
  }

  function render() {
    if (!ui) return;
    ui.prod.textContent = data.product || '';
    ui.bFolder.style.display = data.revealable ? '' : 'none';
    ui.bFolder.title = data.where ? 'Your saved sounds live in ' + data.where : 'Your saved sounds are a file on disk';
    for (var s in ui.scopeBtn) ui.scopeBtn[s].className = view.scope === s ? 'on' : '';

    // type chips (built-in + the user's own), with live counts for the current scope
    ui.cats.textContent = '';
    var scoped = data.entries.filter(function (e) {
      return view.scope === 'all' || (view.scope === 'fav' && e.favorite) || (view.scope === 'factory' && e.factory) || (view.scope === 'user' && !e.factory);
    });
    ui.cats.appendChild(chip('All', scoped.length, !view.cat, function () { view.cat = ''; view.sel = -1; render(); }));
    data.categories.forEach(function (c) {
      var n = scoped.filter(function (e) { return e.category.toLowerCase() === c.name.toLowerCase(); }).length;
      if (!n && !c.custom && view.cat.toLowerCase() !== c.name.toLowerCase()) return;     // hide empty built-in types
      var b = chip(c.name, n, view.cat.toLowerCase() === c.name.toLowerCase(), function () { view.cat = (view.cat.toLowerCase() === c.name.toLowerCase()) ? '' : c.name; view.sel = -1; render(); });
      if (c.custom) {
        b.className += ' custom';
        var x = el('i', 'x', '×'); x.title = 'Delete this type (its sounds move to Other)';
        x.onclick = function (ev) { ev.stopPropagation(); if (x.dataset.arm) { if (view.cat === c.name) view.cat = ''; presets.removeCategory(c.name); } else { x.dataset.arm = 1; x.textContent = 'delete?'; setTimeout(function () { delete x.dataset.arm; x.textContent = '×'; }, 2500); } };
        b.appendChild(x);
      }
      ui.cats.appendChild(b);
    });
    var add = el('button', 'chip add', '+ New type');
    add.onclick = function () {
      var inp = el('input'); inp.placeholder = 'Name'; inp.maxLength = 24;
      var done = function (ok) {
        var v = inp.value.trim();
        if (ok && v) presets.addCategory(v).then(function (j) { if (j && j.error) { ui.q.placeholder = j.error; setTimeout(function () { ui.q.placeholder = 'Search name, type or tag\u2026'; }, 2500); } });
        else render();
      };
      inp.onkeydown = function (e) { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      inp.onblur = function () { done(false); };
      add.replaceWith(inp); inp.focus({ preventScroll: true });
    };
    ui.cats.appendChild(add);

    // tag chips: every tag in the current scope+type, selectable (AND)
    var counts = {};
    scoped.filter(function (e) { return !view.cat || e.category.toLowerCase() === view.cat.toLowerCase(); }).forEach(function (e) {
      e.tags.forEach(function (t) { var k = t.toLowerCase(); counts[k] = counts[k] || { name: t, n: 0 }; counts[k].n++; });
    });
    view.tags.forEach(function (t) { counts[t.toLowerCase()] = counts[t.toLowerCase()] || { name: t, n: 0 }; });
    var names = Object.keys(counts).sort();
    ui.tags.textContent = '';
    ui.tagsHead.style.display = ui.tags.style.display = names.length ? '' : 'none';
    names.forEach(function (k) {
      var on = view.tags.map(function (t) { return t.toLowerCase(); }).indexOf(k) >= 0;
      ui.tags.appendChild(chip(counts[k].name, counts[k].n, on, function () {
        view.tags = on ? view.tags.filter(function (t) { return t.toLowerCase() !== k; }) : view.tags.concat([counts[k].name]);
        view.sel = -1; render();
      }));
    });

    renderList();
    renderForm();
  }

  function renderList(keepScroll) {
    var l = visible();
    ui.list.textContent = '';
    if (!l.length) {
      var filtered = view.q || view.cat || view.tags.length || view.scope !== 'all';
      var m = el('li', 'empty', data.entries.length ? (filtered ? 'No sounds match.' : '') :
        'No sounds yet. Dial one in, then press “Save current sound”.');
      m.style.cursor = 'default';
      if (filtered && data.entries.length) {
        var clr = el('button', '', 'Clear filters'); clr.style.marginLeft = '10px';
        clr.onclick = function () { view.scope = 'all'; view.cat = ''; view.tags = []; view.q = ''; ui.q.value = ''; render(); };
        m.appendChild(clr);
      }
      ui.list.appendChild(m);
      return;
    }
    l.forEach(function (e, i) {
      var li = el('li', (e.id === data.current ? 'cur ' : '') + (i === view.sel ? 'sel' : ''));
      var star = el('button', 'star' + (e.favorite ? ' on' : ''), e.favorite ? '★' : '☆');
      star.title = e.favorite ? 'Remove from favorites' : 'Add to favorites'; star.setAttribute('aria-pressed', String(!!e.favorite));
      star.onclick = function (ev) { ev.stopPropagation(); presets.favorite(e.id, !e.favorite); };
      var nm = el('div', 'nm'); nm.appendChild(el('b', '', e.name));
      if (e.tags.length) nm.appendChild(el('span', '', e.tags.join(' · ')));
      var ty = el('span', 'ty', e.category);
      li.appendChild(star); li.appendChild(nm); li.appendChild(ty);
      if (!e.factory) {
        var ed = el('button', 'edit', '✎'); ed.title = 'Rename, retag, delete';
        ed.onclick = function (ev) { ev.stopPropagation(); openForm({ mode: 'edit', entry: e }); };
        li.appendChild(ed);
      }
      li.onclick = function () { view.sel = i; presets.load(e.id); };
      ui.list.appendChild(li);
      if ((e.id === data.current && !keepScroll) || (keepScroll && i === view.sel)) setTimeout(function () { li.scrollIntoView({ block: 'nearest' }); }, 0);
    });
  }

  function openForm(f) { view.form = f; render(); var n = ui.form.querySelector('input'); if (n) { n.focus({ preventScroll: true }); n.select(); } }

  function renderForm() {
    var f = view.form;
    ui.form.style.display = f ? 'grid' : 'none';
    ui.panel.classList.toggle('forming', !!f);
    ui.foot.style.display = f ? 'none' : 'flex';
    if (!f) { ui.form.textContent = ''; ui.formBuilt = null; return; }
    if (ui.formBuilt === f) return;            // keep what the user is typing when the list refreshes underneath
    ui.formBuilt = f; ui.form.textContent = '';
    var cur = null;
    data.entries.forEach(function (e) { if (e.id === data.current) cur = e; });
    var seed = f.mode === 'edit' ? f.entry : (cur && !cur.factory ? cur : { name: '', category: (cur ? cur.category : ''), tags: cur ? cur.tags : [] });

    ui.form.appendChild(el('b', '', f.mode === 'edit' ? 'Edit sound' : 'Save current sound'));
    var ln = el('label', '', 'Name'); var name = el('input'); name.value = seed.name; name.maxLength = 40; ln.appendChild(name); ui.form.appendChild(ln);
    var lc = el('label', '', 'Type'); var sel = el('select');
    data.categories.forEach(function (c) { var o = el('option', '', c.name); o.value = c.name; sel.appendChild(o); });
    sel.value = seed.category && data.categories.some(function (c) { return c.name.toLowerCase() === seed.category.toLowerCase(); })
      ? data.categories.filter(function (c) { return c.name.toLowerCase() === seed.category.toLowerCase(); })[0].name : 'Other';
    lc.appendChild(sel); ui.form.appendChild(lc);
    var lt = el('label', '', 'Tags (comma separated)'); var tg = el('input'); tg.value = seed.tags.join(', '); tg.placeholder = 'warm, analog, slow…'; lt.appendChild(tg); ui.form.appendChild(lt);
    if (f.mode === 'save') ui.form.appendChild(el('div', 'hint', 'Saving under an existing name updates that sound.'));
    var msg = el('div', 'msg'); ui.form.appendChild(msg);

    var row = el('div', 'row');
    var ok = el('button', 'primary', f.mode === 'edit' ? 'Save changes' : 'Save'); var cancel = el('button', '', 'Cancel');
    row.appendChild(ok); row.appendChild(cancel);
    if (f.mode === 'edit') {
      var del = el('button', 'danger', 'Delete');
      del.onclick = function () {
        if (!del.dataset.arm) { del.dataset.arm = 1; del.textContent = 'Really delete?'; return; }
        presets.remove(f.entry.id).then(function () { view.form = null; render(); });
      };
      row.appendChild(del);
    }
    ui.form.appendChild(row);
    var go = function () {
      var o = { name: name.value, category: sel.value, tags: tg.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean) };
      if (!o.name.trim()) { msg.textContent = 'Give the sound a name.'; return; }
      var p = f.mode === 'edit' ? presets.meta({ id: f.entry.id, name: o.name, category: o.category, tags: o.tags }) : presets.save(o);
      p.then(function (j) {
        if (j && j.error) { msg.textContent = j.error; return; }
        view.form = null; render();
      }, function (e) { msg.textContent = String(e && e.message || e); });
    };
    ok.onclick = go; cancel.onclick = function () { view.form = null; render(); };
    ui.form.onkeydown = function (e) { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { go(); e.preventDefault(); } };
  }

  function open(thenSave) {
    if (!ui) build();
    ui.open = true; ui.host.style.display = 'block';
    presets.list().then(function () { if (thenSave === true) openForm({ mode: 'save' }); else ui.q.focus({ preventScroll: true }); });
    render();
    requestAnimationFrame(function () { ui.wrap.className = 'wrap open'; });
  }
  function close() {
    if (!ui || !ui.open) return;
    ui.open = false; view.form = null; ui.wrap.className = 'wrap';
    setTimeout(function () { if (!ui.open) ui.host.style.display = 'none'; }, 170);
  }
  function toggle() { if (ui && ui.open) close(); else open(); }
  // The "Save" button of a GUI: straight to the save form (opens the drawer first if it is closed).
  function saveSound() { if (ui && ui.open) openForm({ mode: 'save' }); else open(true); }

  V.presets = presets;
  V.openBrowser = function () { open(); }; V.closeBrowser = close; V.toggleBrowser = toggle; V.saveSound = saveSound;
  V.nextPreset = function () { step(1); }; V.prevPreset = function () { step(-1); };

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'vstai:browser') return;
    if (d.action === 'open') open(); else if (d.action === 'close') close(); else if (d.action === 'toggle') toggle(); else if (d.action === 'save') saveSound();
    else if (d.action === 'next') step(1); else if (d.action === 'prev') step(-1);
  });
})();
