// player.js — static player: loads a published .vstai and runs its WASM DSP live.
//
// No server: the whole plugin (GUI HTML, params, and the compiled WASM as base64)
// lives in data/<id>.vstai. We fetch it, decode the WASM in the browser, and run it
// in an AudioWorklet (worklet.js) with the SAME ABI as the desktop host.

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const id = qs.get("id") || "";
const embed = qs.get("embed") === "1";       // embedded mode: slim chrome, GUI fills the pane
const autostart = qs.get("autostart") === "1"; // begin audio immediately (uses sticky activation)
const intro = qs.get("intro") === "1";         // homepage: the GUI runs a staged "build" animation

let ctx, node, meta, wasmBytes;
let inputNode = null;        // current effect input source feeding `node`
let analyser = null;         // view-only scope/EQ tap on the output

function setStatus(t) { $("status").textContent = t; }

// base64 → ArrayBuffer (the .vstai stores the module as wasmBase64)
function b64ToBytes(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function boot() {
  if (!id) { setStatus("No plugin id."); return; }
  let doc;
  try {
    doc = await (await fetch("data/" + encodeURIComponent(id) + ".vstai", { cache: "no-cache" })).json();
  } catch (e) { setStatus("Could not load plugin: " + e.message); return; }
  if (!doc || !doc.wasmBase64) { setStatus("This .vstai has no compiled WASM."); return; }

  meta = {
    name: doc.name || "Untitled",
    isInstrument: !!doc.isInstrument,
    explanation: doc.explanation || "",
    params: doc.params || [],
    html: doc.html || "",
  };
  wasmBytes = b64ToBytes(doc.wasmBase64);

  $("name").textContent = meta.name;
  $("badge").textContent = meta.isInstrument ? "SYNTH" : "EFFECT";
  $("badge").classList.add(meta.isInstrument ? "synth" : "fx");
  $("download").href = "data/" + encodeURIComponent(id) + ".vstai";
  $("download").setAttribute("download", id + ".vstai");
  document.title = "VibePlugin · " + meta.name;
  setStatus("Loaded. Press Start audio.");

  if (embed) {
    document.body.classList.add("embed");
    if (autostart) {
      // selected from the gallery: bring up audio right away (sticky activation
      // from the click usually allows it; otherwise the first key/click resumes).
      start();
    } else {
      // show the GUI immediately so the panel looks live before audio.
      $("guiWrap").hidden = false;
      renderGui();
      // intro mode: the GUI runs a staged build and signals when to bring in the
      // deck/keyboard (so the keys land last, under the "try it out" caption).
      if (!intro) {
        $("deck").hidden = false;
        if (meta.isInstrument) { $("kbdWrap").hidden = false; buildKeyboard(); updateOctaveLabel(); }
      }
    }
  }
}

// ---- audio graph ----------------------------------------------------
let gestureHooked = false;
function afterRunning() {
  const running = ctx && ctx.state === "running";
  $("startWrap").hidden = running;
  setStatus(running ? (meta.isInstrument ? "Ready — play the keyboard." : "Ready — pick an input.")
                    : "Click or play a key to enable sound 🔊");
}
function tryResume() { if (ctx) ctx.resume().then(afterRunning, afterRunning); }

async function start() {
  if (ctx) { tryResume(); return; }          // already booted — just (re)resume
  setStatus("Starting audio…");
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.audioWorklet.addModule("worklet.js");   // OK while suspended (no gesture yet)

  node = new AudioWorkletNode(ctx, "vstai-dsp", {
    numberOfInputs: meta.isInstrument ? 0 : 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.port.onmessage = (e) => { if (e.data.type === "error") setStatus("DSP error: " + e.data.message); };

  // tap the output for the GUI's oscilloscope + spectrum (display only)
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;
  node.connect(analyser);
  analyser.connect(ctx.destination);
  startScope();
  node.port.postMessage({ type: "load", wasm: wasmBytes, sampleRate: ctx.sampleRate, channels: 2 });

  $("guiWrap").hidden = false;
  renderGui();
  $("deck").hidden = false;
  if (meta.isInstrument) { $("kbdWrap").hidden = false; buildKeyboard(); updateOctaveLabel(); setupMidi(); }
  else { $("inputBar").hidden = false; await loadSampleList(); setInput("tone"); }

  // resume now (works inside a click gesture); otherwise resume on the first gesture.
  if (!gestureHooked) {
    gestureHooked = true;
    const go = () => tryResume();
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }
  tryResume();
}

// ---- view-only oscilloscope + spectrum, drawn on the top deck canvases ----
function startScope() {
  const osc = $("osc"), eq = $("eq");
  const oc = osc.getContext("2d"), ec = eq.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // only resize the bitmap when the element's CSS size actually changed — resizing
  // every frame clears the canvas and thrashes layout.
  const fit = (c) => {
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
  };
  const T = new Float32Array(analyser.fftSize);
  const F = new Uint8Array(analyser.frequencyBinCount);
  const NF = 64;
  function tick() {
    if (!ctx || ctx.state === "closed") return;
    requestAnimationFrame(tick);
    fit(osc); fit(eq);
    analyser.getFloatTimeDomainData(T);
    analyser.getByteFrequencyData(F);

    // oscilloscope
    let w = osc.width, h = osc.height; oc.clearRect(0, 0, w, h);
    oc.strokeStyle = "rgba(255,255,255,.06)"; oc.lineWidth = 1;
    oc.beginPath(); oc.moveTo(0, h / 2); oc.lineTo(w, h / 2); oc.stroke();
    oc.strokeStyle = "#4f8dff"; oc.lineWidth = 1.6 * dpr; oc.beginPath();
    for (let i = 0; i < T.length; i++) { const x = i / (T.length - 1) * w, y = h / 2 - T[i] * h * 0.46; i ? oc.lineTo(x, y) : oc.moveTo(x, y); }
    oc.shadowColor = "#4f8dff"; oc.shadowBlur = 8 * dpr; oc.stroke(); oc.shadowBlur = 0;

    // spectrum (EQ), log-grouped bars
    w = eq.width; h = eq.height; ec.clearRect(0, 0, w, h);
    const lo = 1, hi = F.length, bw = w / NF;
    for (let i = 0; i < NF; i++) {
      const a = (lo * Math.pow(hi / lo, i / NF)) | 0;
      const b = Math.max(a + 1, (lo * Math.pow(hi / lo, (i + 1) / NF)) | 0);
      let mx = 0; for (let j = a; j < b && j < F.length; j++) if (F[j] > mx) mx = F[j];
      const bh = (mx / 255) * h * 0.95, x = i * bw;
      const g = ec.createLinearGradient(0, h, 0, h - bh); g.addColorStop(0, "#3a63d6"); g.addColorStop(1, "#9d7bff");
      ec.fillStyle = g; ec.fillRect(x + 0.5, h - bh, bw - 1.2, bh);
    }
  }
  requestAnimationFrame(tick);
}

// ---- note helpers (used by keyboard + MIDI) ------------------------
function sendNote(on, note, vel) {
  if (!node) return;
  node.port.postMessage({ type: "note", on, note: note | 0, vel: vel == null ? 0.9 : vel });
}

// ---- effect input: royalty-free samples + tone/mic/file ------------
function clearInput() {
  if (inputNode) {
    try { inputNode.disconnect(); } catch {}
    if (inputNode.stop) try { inputNode.stop(); } catch {}
    inputNode = null;
  }
}
function markActive(kind) {
  for (const b of document.querySelectorAll("#inputBar .seg-btn"))
    b.classList.toggle("active", b.dataset.src === kind);
  if (kind !== "sample") $("sampleSel").selectedIndex = 0;
}

async function loadSampleList() {
  const sel = $("sampleSel");
  sel.innerHTML = '<option value="">Royalty-free sample…</option>';
  try {
    const list = await (await fetch("samples/index.json", { cache: "no-cache" })).json();
    for (const s of list) {
      const o = document.createElement("option");
      o.value = s.file; o.textContent = s.name;
      sel.appendChild(o);
    }
  } catch { /* samples are optional */ }
}

const sampleCache = new Map();
async function playSample(file) {
  let buf = sampleCache.get(file);
  if (!buf) {
    const ab = await (await fetch("samples/" + file)).arrayBuffer();
    buf = await ctx.decodeAudioData(ab);
    sampleCache.set(file, buf);
  }
  clearInput();
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  src.connect(node); src.start();
  inputNode = src;
  markActive("sample");
}

async function setInput(kind) {
  clearInput();
  markActive(kind);
  if (kind === "none") return;
  if (kind === "tone") {
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 110;
    const g = ctx.createGain(); g.gain.value = 0.25;
    osc.connect(g).connect(node); osc.start(); inputNode = osc;
  } else if (kind === "mic") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputNode = ctx.createMediaStreamSource(stream); inputNode.connect(node);
    } catch (e) { setStatus("Microphone blocked: " + e.message); }
  } else if (kind === "file") {
    $("inputFile").click();
  }
}

$("sampleSel").addEventListener("change", (e) => { if (e.target.value) playSample(e.target.value); });
$("inputFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await ctx.decodeAudioData(await f.arrayBuffer());
  clearInput();
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.connect(node); src.start(); inputNode = src;
  markActive("file");
});
for (const b of document.querySelectorAll("#inputBar .seg-btn"))
  b.addEventListener("click", () => setInput(b.dataset.src));

// ---- on-screen keyboard (synths) -----------------------------------
const KEY_ROW = "awsedftgyhujk";              // computer keys → semitones from C
const PC_NAMES = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];
let octave = 0;                                // keyboard octave shift (×12 semitones)
const baseMidi = () => 60 + octave * 12;       // leftmost C of the on-screen keyboard
const noteName = (midi) => PC_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

function noteVisual(midi, on) {
  const el = document.querySelector(`.key[data-midi="${midi}"]`);
  if (el) el.classList.toggle("down", on);
}
function buildKeyboard() {
  const root = $("keys"); root.innerHTML = "";
  const START = baseMidi(), COUNT = 17;        // ~1.5 octaves
  const black = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  for (let i = 0; i < COUNT; i++) {
    const midi = START + i, pc = ((midi % 12) + 12) % 12;
    const k = document.createElement("div");
    k.className = "key" + (black[pc] ? " black" : "");
    k.dataset.midi = midi;
    k.textContent = PC_NAMES[pc] ? noteName(midi) : "";
    const down = (ev) => { ev.preventDefault(); noteVisual(midi, true); sendNote(true, midi); };
    const up   = () => { noteVisual(midi, false); sendNote(false, midi); };
    k.addEventListener("mousedown", down);
    k.addEventListener("mouseup", up);
    k.addEventListener("mouseleave", () => { if (k.classList.contains("down")) up(); });
    k.addEventListener("touchstart", down, { passive: false });
    k.addEventListener("touchend", up);
    root.appendChild(k);
  }
}
function updateOctaveLabel() { const el = $("octLabel"); if (el) el.textContent = noteName(baseMidi()); }

// physical/forwarded computer-key handling (char → midi so keyup matches the press)
const keyDownByChar = new Map();
function releaseAllKeys() {
  for (const midi of keyDownByChar.values()) { noteVisual(midi, false); sendNote(false, midi); }
  keyDownByChar.clear();
}
function changeOctave(d) {
  releaseAllKeys();                            // avoid stuck notes across the shift
  octave = Math.max(-3, Math.min(3, octave + d));
  updateOctaveLabel();
  if (meta && meta.isInstrument) buildKeyboard();
}
function onKeyDown(key, repeat) {
  if (!meta || !meta.isInstrument) return;
  const k = (key || "").toLowerCase();
  if (k === "z") { if (!repeat) changeOctave(-1); return; }
  if (k === "x") { if (!repeat) changeOctave(1); return; }
  const idx = KEY_ROW.indexOf(k);
  if (idx < 0 || keyDownByChar.has(k)) return;
  const midi = baseMidi() + idx;
  keyDownByChar.set(k, midi);
  noteVisual(midi, true); sendNote(true, midi);
}
function onKeyUp(key) {
  const k = (key || "").toLowerCase();
  if (!keyDownByChar.has(k)) return;
  const midi = keyDownByChar.get(k); keyDownByChar.delete(k);
  noteVisual(midi, false); sendNote(false, midi);
}
window.addEventListener("keydown", (e) => onKeyDown(e.key, e.repeat));
window.addEventListener("keyup", (e) => onKeyUp(e.key));
$("octDown").addEventListener("click", () => changeOctave(-1));
$("octUp").addEventListener("click", () => changeOctave(1));

// ---- GUI iframe + window.vstai bridge ------------------------------
// The plugin's HTML (arbitrary, user-published) runs in a sandboxed iframe with
// NO same-origin access, so it can't touch this page. A shim defines window.vstai
// and forwards control events here via postMessage; we relay them to the worklet.
const SHIM = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script>
(function(){
  var vals={};
  function post(m){ try{ m.__vstai=1; parent.postMessage(m,'*'); }catch(e){} }
  async function loadSample(file,onProgress){
    if(!file) throw new Error('No file given.');
    var AC=window.AudioContext||window.webkitAudioContext; if(!AC) throw new Error('No AudioContext.');
    var ac=new AC(); var audio=await ac.decodeAudioData(await file.arrayBuffer()); try{ac.close();}catch(e){}
    var channels=Math.min(2,audio.numberOfChannels), frames=audio.length, rate=Math.round(audio.sampleRate);
    var data=new Float32Array(channels*frames);
    for(var c=0;c<channels;c++) data.set(audio.getChannelData(c).subarray(0,frames), c*frames);
    post({type:'sample', channels:channels, frames:frames, rate:rate, data:data});
    if(onProgress) try{onProgress(1);}catch(e){}
    return {frames:frames, channels:channels, sampleRate:rate};
  }
  window.vstai={
    setParam:function(i,v){ vals[i]=+v; post({type:'param', i:(i|0), v:+v}); },
    getParam:function(i){ return (i in vals)?vals[i]:0; },
    onReady:function(cb){ try{cb();}catch(e){} },
    onParam:function(cb){},
    noteOn:function(n,v){ post({type:'note', on:true, note:(n|0), vel:(v==null?1:+v)}); },
    noteOff:function(n){ post({type:'note', on:false, note:(n|0)}); },
    loadSample:function(file,onProgress){ return loadSample(file,onProgress); }
  };
  // forward computer-key play up to the player (so A–K / Z–X work while the GUI
  // has focus — e.g. right after dragging a knob).
  window.addEventListener('keydown', function(e){ post({type:'keydown', key:e.key, repeat:e.repeat}); });
  window.addEventListener('keyup',   function(e){ post({type:'keyup',   key:e.key}); });
})();
<\/script>`;

function renderGui() {
  const html = meta.html || "<body style='font:14px sans-serif;color:#fff'>No GUI.</body>";
  // homepage only: tell the GUI to run its staged "build" animation
  const flag = intro ? "<script>window.__vstaiIntro=true<\/script>" : "";
  const head = html.indexOf("<head>");
  const doc = head >= 0
    ? html.slice(0, head + 6) + flag + SHIM + html.slice(head + 6)
    : flag + SHIM + html;
  $("gui").srcdoc = doc;
}

window.addEventListener("message", (e) => {
  const m = e.data; if (!m || !m.__vstai) return;
  // computer-key play forwarded from the GUI iframe or the gallery parent
  if (m.type === "keydown") { onKeyDown(m.key, m.repeat); return; }
  if (m.type === "keyup")   { onKeyUp(m.key); return; }
  // intro build finished: bring the deck + keyboard in for the "try it out" beat
  if (m.type === "intro") {
    if (m.phase === "keys" && $("deck").hidden) {
      $("deck").hidden = false; $("deck").classList.add("deck-in");
      if (meta.isInstrument) { $("kbdWrap").hidden = false; buildKeyboard(); updateOctaveLabel(); }
    }
    return;
  }
  if (!node) return;
  if (m.type === "param") node.port.postMessage({ type: "param", i: m.i, v: m.v });
  else if (m.type === "note") node.port.postMessage({ type: "note", on: m.on, note: m.note, vel: m.vel });
  else if (m.type === "sample") node.port.postMessage({ type: "sample", channels: m.channels, frames: m.frames, rate: m.rate, data: m.data }, [m.data.buffer]);
});

// ---- optional Web MIDI for synths ----------------------------------
function setupMidi() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then((midi) => {
    for (const inp of midi.inputs.values()) inp.onmidimessage = (ev) => {
      const [s, d1, d2] = ev.data, cmd = s & 0xf0;
      if (cmd === 0x90 && d2 > 0) sendNote(true, d1, d2 / 127);
      else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) sendNote(false, d1);
    };
  }).catch(() => {});
}

$("startBtn").addEventListener("click", start);
boot();
