// player.js — loads a published plugin and runs its WASM DSP live in the browser.

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";

let ctx, node, meta, wasmBytes;
let inputNode = null;        // current effect input source feeding `node`

function setStatus(t) { $("status").textContent = t; }

async function boot() {
  if (!id) { setStatus("No plugin id."); return; }
  try {
    meta = await (await fetch("/api/plugins/" + encodeURIComponent(id))).json();
    if (meta.error) throw new Error(meta.error);
  } catch (e) { setStatus("Could not load plugin: " + e.message); return; }

  $("name").textContent = meta.name || "Untitled";
  $("badge").textContent = meta.isInstrument ? "SYNTH" : "EFFECT";
  $("badge").classList.add(meta.isInstrument ? "synth" : "fx");
  $("download").href = "/api/plugins/" + encodeURIComponent(id) + "/download";
  document.title = "VibePlugin · " + (meta.name || "Player");

  wasmBytes = await (await fetch(meta.wasmUrl)).arrayBuffer();
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
    if (m.type === "ready")  setStatus(meta.isInstrument ? "Ready — play the keyboard." : "Ready — pick an input.");
    if (m.type === "error")  setStatus("DSP error: " + m.message);
  };
  node.connect(ctx.destination);
  node.port.postMessage({ type: "load", wasm: wasmBytes, sampleRate: ctx.sampleRate, channels: 2 });

  $("startWrap").hidden = true;
  $("guiWrap").hidden = false;
  renderGui();

  if (meta.isInstrument) {
    setupMidi();
  } else {
    $("inputBar").hidden = false;
    setInput("tone");                       // sensible default so effects are audible
  }
}

// ---- effect input sources ------------------------------------------
function clearInput() {
  if (inputNode) { try { inputNode.disconnect(); } catch {} ; if (inputNode.stop) try { inputNode.stop(); } catch {} ; inputNode = null; }
}
async function setInput(kind) {
  clearInput();
  for (const b of document.querySelectorAll("#inputBar .seg-btn"))
    b.classList.toggle("active", b.dataset.src === kind);

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
$("inputFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await ctx.decodeAudioData(await f.arrayBuffer());
  clearInput();
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.connect(node); src.start(); inputNode = src;
  for (const b of document.querySelectorAll("#inputBar .seg-btn")) b.classList.toggle("active", b.dataset.src === "file");
});
for (const b of document.querySelectorAll("#inputBar .seg-btn"))
  b.addEventListener("click", () => setInput(b.dataset.src));

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
      if (cmd === 0x90 && d2 > 0) node.port.postMessage({ type: "note", on: true, note: d1, vel: d2 / 127 });
      else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) node.port.postMessage({ type: "note", on: false, note: d1 });
    };
  }).catch(() => {});
}

$("startBtn").addEventListener("click", start);
boot();
