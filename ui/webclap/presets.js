// presets.js - the sound browser's host side for a WebCLAP page.
//
// On the desktop the drawer (ui/preset-browser.js) talks to PresetController.h through
// vstai._call('/__vstai/presets/...'). A WebCLAP plugin has no native side to ask, so this file
// answers the same URLs inside the page: factory sounds come from window.__vstaiPresetCfg
// (written by the exporter), the user's sounds / favourites / own types live in localStorage
// under the plugin's id, and "applying" a sound is a burst of vstai._setFromHost(index, value).
// It must stay in step with src/PresetStore.h + src/PresetController.h (same ids, same rules).
//
// Sounds belong to the browser profile, not the DAW project: they follow the user from project to
// project, like the desktop's per-user presets.json. Where storage is blocked they last for the
// session only, and the drawer says so.
(function () {
  var V = window.vstai, cfg = window.__vstaiPresetCfg;
  if (!V || V._call || !cfg) return;

  var MAX_TAGS = 8, MAX_TEXT = 40;
  var key = 'vstai.sounds.' + (cfg.id || cfg.product || 'plugin');
  var persisted = true;
  var S = { presets: [], favorites: [], categories: [] };
  var currentId = '';

  try {
    var raw = JSON.parse(localStorage.getItem(key));
    if (raw && raw.presets) S = { presets: raw.presets || [], favorites: raw.favorites || [], categories: raw.categories || [] };
  } catch (e) { /* none yet, or storage blocked */ }

  function flush() {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, presets: S.presets, favorites: S.favorites, categories: S.categories })); persisted = true; }
    catch (e) { persisted = false; }
  }

  // ---- the rules from PresetStore.h ---------------------------------------------------
  function cleanText(s, max) {
    var t = String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').replace(/ {2,}/g, ' ').trim();
    return t.substring(0, max || MAX_TEXT).trim();
  }
  function cleanTags(a) {
    var out = [], seen = {};
    (a || []).forEach(function (raw) {
      var t = cleanText(raw, 24), k = t.toLowerCase();
      if (t && !seen[k] && out.length < MAX_TAGS) { seen[k] = 1; out.push(t); }
    });
    return out;
  }
  function builtin(instrument) {
    return instrument
      ? ['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Bells', 'Strings', 'Brass', 'Arp & Seq', 'Drums & Perc', 'FX', 'Ambient', 'Other']
      : ['Clean', 'Warm', 'Dirty', 'Space', 'Modulation', 'Dynamics', 'Creative', 'Other'];
  }
  var RULES = [
    ['Bass', 'bass sub 808 reese wobble'], ['Lead', 'lead solo saw sync mono hoover'], ['Pad', 'pad warm drone wash choir voices'],
    ['Keys', 'keys piano organ rhodes ep clav wurli harpsichord'], ['Pluck', 'pluck stab pizz harp guitar kalimba marimba'],
    ['Bells', 'bell bells chime glass vibes mallet'], ['Strings', 'strings string violin cello ensemble'],
    ['Brass', 'brass horn horns trumpet sax trombone'], ['Arp & Seq', 'arp seq sequence pattern'],
    ['Drums & Perc', 'kick snare hat hihat clap tom perc drum drums'], ['FX', 'fx riser noise sweep impact zap laser texture'],
    ['Ambient', 'ambient atmos atmosphere space dream evolving cinematic']
  ];
  function inferCategory(name, instrument) {
    if (!instrument) return 'Other';
    var words = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
    for (var r = 0; r < RULES.length; r++) {
      var w = RULES[r][1].split(' ');
      for (var i = 0; i < w.length; i++) if (words.indexOf(w[i]) >= 0) return RULES[r][0];
    }
    return 'Other';
  }
  function has(list, s) { var k = String(s).toLowerCase(); return list.some(function (x) { return String(x).toLowerCase() === k; }); }

  // factory sounds first ("f:<name>", "#2" on a repeat), then the user's
  function entries() {
    var out = [], seen = {};
    (cfg.presets || []).forEach(function (p) {
      var name = p.name || ('Preset ' + (out.length + 1)), id = 'f:' + name;
      for (var n = 2; seen[id]; n++) id = 'f:' + name + '#' + n;
      seen[id] = 1;
      out.push({ id: id, name: name, category: p.category || inferCategory(name, cfg.instrument), tags: cleanTags(p.tags),
                 factory: true, favorite: S.favorites.indexOf(id) >= 0, values: p.values || {} });
    });
    S.presets.forEach(function (u) {
      out.push({ id: u.id, name: u.name, category: u.category || inferCategory(u.name, cfg.instrument), tags: u.tags || [],
                 factory: false, favorite: S.favorites.indexOf(u.id) >= 0, values: u.values || {} });
    });
    return out;
  }

  function browser(error, savedId) {
    var list = entries(), cats = [], listed = [];
    function add(n, custom) { cats.push({ name: n, custom: custom }); listed.push(n); }
    builtin(cfg.instrument).forEach(function (c) { add(c, false); });
    S.categories.forEach(function (c) { if (!has(listed, c)) add(c, true); });
    list.forEach(function (e) { if (e.category && !has(listed, e.category)) add(e.category, false); });
    var j = {
      product: cfg.product || '', instrument: !!cfg.instrument, current: currentId, categories: cats,
      entries: list.map(function (e) { return { id: e.id, name: e.name, category: e.category, tags: e.tags, factory: e.factory, favorite: e.favorite }; }),
      revealable: false,
      where: persisted ? 'this browser (local storage)' : 'this session only - browser storage is blocked here'
    };
    if (error) j.error = error;
    if (savedId) j.savedId = savedId;
    return JSON.stringify(j);
  }

  // ---- actions -------------------------------------------------------------------------
  function applyById(id) {
    var found = null;
    entries().forEach(function (e) { if (e.id === id) found = e; });
    if (!found) return false;
    currentId = id;
    var pm = {};
    (cfg.params || []).forEach(function (p) { pm[p.index] = p; });
    Object.keys(found.values).forEach(function (k) {
      var i = k | 0; if (!pm[i]) return;
      V._setFromHost(i, +found.values[k]);
    });
    return true;
  }
  function snapshot() {
    var values = {};
    (cfg.params || []).forEach(function (p) {
      var v = V.getParam(p.index);
      values[p.index] = (typeof v === 'number' && isFinite(v)) ? v : p.def;
    });
    return values;
  }
  function saveCurrent(name, category, tags) {
    name = cleanText(name);
    if (!name) return '';
    var values = snapshot(), cat = cleanText(category), tg = cleanTags(tags), hit = null;
    if (!Object.keys(values).length) return '';
    S.presets.forEach(function (u) { if (u.name.toLowerCase() === name.toLowerCase()) hit = u; });
    if (hit) { hit.name = name; hit.category = cat; hit.tags = tg; hit.values = values; }
    else {
      hit = { id: 'u:' + uuid(), name: name, category: cat, tags: tg, values: values };
      S.presets.push(hit);
    }
    currentId = hit.id; flush();
    return hit.id;
  }
  function uuid() {
    var a = new Uint8Array(16);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  function handle(url) {
    var cmd = url.split('/__vstai/presets/')[1];
    if (cmd == null) return null;
    cmd = cmd.split('?')[0];
    function arg(prefix) { try { return decodeURIComponent(cmd.substring(prefix.length)); } catch (e) { return cmd.substring(prefix.length); } }
    function starts(p) { return cmd.indexOf(p) === 0; }

    if (cmd === 'list') return browser();
    if (cmd === 'reveal') return browser('This host cannot open the folder.');
    if (starts('load/')) return applyById(arg('load/')) ? browser() : browser('That sound no longer exists.');
    if (starts('delete/')) {
      var id = arg('delete/'), n = S.presets.length;
      S.presets = S.presets.filter(function (u) { return u.id !== id; });
      if (S.presets.length === n) return browser('Only your own sounds can be deleted.');
      S.favorites = S.favorites.filter(function (f) { return f !== id; });
      if (currentId === id) currentId = '';
      flush(); return browser();
    }
    if (starts('fav/')) {
      var rest = cmd.substring(4), cut = rest.lastIndexOf('/'), fid = decodeURIComponent(rest.substring(0, cut)), on = rest.substring(cut + 1) === '1';
      S.favorites = S.favorites.filter(function (f) { return f !== fid; });
      if (on) S.favorites.push(fid);
      flush(); return browser();
    }
    if (starts('save/')) {
      var o = JSON.parse(arg('save/')), name = cleanText(o.name);
      if (!name) return browser('Give the sound a name.');
      var sid = saveCurrent(name, o.category, o.tags);
      return sid ? browser(null, sid) : browser('Nothing to save yet.');
    }
    if (starts('meta/')) {
      var m = JSON.parse(arg('meta/')), cur = null;
      S.presets.forEach(function (u) { if (u.id === m.id) cur = u; });
      if (!cur) return browser('Another sound already has that name.');
      var nn = 'name' in m ? cleanText(m.name) : cur.name;
      if (nn) {
        var clash = S.presets.some(function (u) { return u.id !== cur.id && u.name.toLowerCase() === nn.toLowerCase(); });
        if (clash) return browser('Another sound already has that name.');
        cur.name = nn;
      }
      if ('category' in m) cur.category = cleanText(m.category);
      if ('tags' in m) cur.tags = cleanTags(m.tags);
      flush(); return browser();
    }
    if (starts('cat/add/')) {
      var c = cleanText(arg('cat/add/'), 24);
      if (!c || has(S.categories, c) || has(builtin(cfg.instrument), c)) return browser('That type already exists.');
      S.categories.push(c); flush(); return browser();
    }
    if (starts('cat/del/')) {
      var d = arg('cat/del/'), at = -1;
      S.categories.forEach(function (x, i) { if (x.toLowerCase() === d.toLowerCase()) at = i; });
      if (at < 0) return browser('Only your own types can be deleted.');
      S.categories.splice(at, 1);
      S.presets.forEach(function (u) { if ((u.category || '').toLowerCase() === d.toLowerCase()) u.category = 'Other'; });
      flush(); return browser();
    }
    return browser('Unknown request.');
  }

  V._call = function (url) {
    return new Promise(function (resolve, reject) {
      try {
        var r = handle(String(url));
        if (r == null) reject(new Error('unsupported call ' + url)); else resolve(r);
      } catch (e) { reject(e); }
    });
  };
})();
