// player.js — static player: loads a published .vstai and runs its WASM DSP live.
//
// No server: the whole plugin (GUI HTML, params, and the compiled WASM as base64)
// lives in data/<id>.vstai. We fetch it, decode the WASM in the browser, and run it
// in an AudioWorklet (worklet.js) with the SAME ABI as the desktop host.

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const id = qs.get("id") || "";
const embed = qs.get("embed") === "1";   // hero/embedded mode: no chrome, GUI shown immediately

let ctx, node, meta, wasmBytes;
let inputNode = null;        // current effect input source feeding `node`

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
    // Show the real GUI (and keyboard) immediately — before audio — so the panel
    // looks live. Audio still needs the one required click on Start.
    document.body.classList.add("embed");
    $("guiWrap").hidden = false;
    renderGui();
    if (meta.isInstrument) { $("keys").hidden = false; buildKeyboard(); }
  }
}

// ---- audio graph ----------------------------------------------------
async function start() {
  $("startBtn").disabled = true;
  setStatus("Starting audio…");
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  await ctx.audioWorklet.addModule("worklet.js");

  node = new AudioWorkletNode(ctx, "vstai-dsp", {
    numberOfInputs: meta.isInstrument ? 0 : 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") setStatus(meta.isInstrument ? "Ready — play the keyboard." : "Ready — pick an input.");
    if (m.type === "error") setStatus("DSP error: " + m.message);
  };
  node.connect(ctx.destination);
  node.port.postMessage({ type: "load", wasm: wasmBytes, sampleRate: ctx.sampleRate, channels: 2 });

  $("startWrap").hidden = true;
  $("guiWrap").hidden = false;
  renderGui();

  if (meta.isInstrument) {
    $("keys").hidden = false;
    buildKeyboard();
    setupMidi();
  } else {
    $("inputBar").hidden = false;
    await loadSampleList();
    setInput("tone");                       // sensible default so effects are audible
  }
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
function buildKeyboard() {
  const root = $("keys"); root.innerHTML = "";
  const START = 60, COUNT = 17;               // C4 .. E5
  const black = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  const names = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];
  for (let i = 0; i < COUNT; i++) {
    const midi = START + i, pc = midi % 12;
    const k = document.createElement("div");
    k.className = "key" + (black[pc] ? " black" : "");
    k.dataset.midi = midi;
    k.textContent = names[pc] || "";
    const down = (ev) => { ev.preventDefault(); k.classList.add("down"); sendNote(true, midi); };
    const up   = () => { k.classList.remove("down"); sendNote(false, midi); };
    k.addEventListener("mousedown", down);
    k.addEventListener("mouseup", up);
    k.addEventListener("mouseleave", () => { if (k.classList.contains("down")) up(); });
    k.addEventListener("touchstart", down, { passive: false });
    k.addEventListener("touchend", up);
    root.appendChild(k);
  }
}
const heldKeys = new Set();
window.addEventListener("keydown", (e) => {
  if (!meta || !meta.isInstrument || e.repeat) return;
  const idx = KEY_ROW.indexOf(e.key.toLowerCase());
  if (idx < 0 || heldKeys.has(e.key)) return;
  heldKeys.add(e.key);
  const midi = 60 + idx;
  sendNote(true, midi);
  const el = document.querySelector(`.key[data-midi="${midi}"]`); if (el) el.classList.add("down");
});
window.addEventListener("keyup", (e) => {
  const idx = KEY_ROW.indexOf(e.key.toLowerCase());
  if (idx < 0) return;
  heldKeys.delete(e.key);
  const midi = 60 + idx;
  sendNote(false, midi);
  const el = document.querySelector(`.key[data-midi="${midi}"]`); if (el) el.classList.remove("down");
});

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
})();
<\/script>`;

function renderGui() {
  const html = meta.html || "<body style='font:14px sans-serif;color:#fff'>No GUI.</body>";
  const head = html.indexOf("<head>");
  const doc = head >= 0
    ? html.slice(0, head + 6) + SHIM + html.slice(head + 6)
    : SHIM + html;
  $("gui").srcdoc = doc;
}

window.addEventListener("message", (e) => {
  const m = e.data; if (!m || !m.__vstai || !node) return;
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
