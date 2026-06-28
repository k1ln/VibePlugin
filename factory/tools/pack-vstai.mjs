// =====================================================================
//  pack-vstai.mjs — compile an AssemblyScript DSP module and assemble a
//  self-contained .vstai document (format 1). Auto-generates the HTML GUI
//  from the param list so each plugin ships a working editor.
//
//  Usage:
//    node pack-vstai.mjs <spec.json>
//
//  spec.json:
//  {
//    "name": "Vast Hall",
//    "isInstrument": false,
//    "explanation": "…",
//    "assembly": "factory/plugins/vast-hall/assembly.ts",
//    "out":      "factory/plugins/vast-hall/plugin.vstai",
//    "params": [{ "name","index","min","max","default","step"? }, ...]
//  }
//
//  Writes the .vstai and prints the compiled wasm size. Reuses the repo's
//  bundled asc via compiler/asc-driver.mjs.
// =====================================================================

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function slug(s) {
  return (s || "plugin").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60) || "plugin";
}

const root = resolve(fileURLToPath(import.meta.url), "../../.."); // repo root
const specPath = process.argv[2];
if (!specPath) { console.error("usage: node pack-vstai.mjs <spec.json>"); process.exit(2); }
const spec = JSON.parse(readFileSync(specPath, "utf8"));

// --- distinct, non-generic name guard --------------------------------
// Every plugin must carry its own descriptive product name (it becomes the
// .vstai display name AND, on export, hashes to a unique VST3 class id). A
// generic/empty/placeholder name is rejected so nothing ships as "plugin".
const GENERIC = /^(untitled|plugin|new ?plugin|effect|synth|test|reverb|delay|filter|synthesizer)$/i;
const nm = (spec.name || "").trim();
if (!nm || GENERIC.test(nm)) {
  console.error(`REFUSING: "${spec.name}" is empty or a generic name. Give each plugin a distinct, descriptive name.`);
  process.exit(1);
}

const asmPath = resolve(root, spec.assembly);
// The .vstai filename always carries the plugin name (slugified), in the
// directory implied by spec.out — never a generic "plugin.vstai".
const outPath = join(dirname(resolve(root, spec.out)), slug(nm) + ".vstai");
const assembly = readFileSync(asmPath, "utf8");

// --- compile to wasm via the bundled asc driver ----------------------
const tmp = mkdtempSync(join(tmpdir(), "vstai-pack-"));
const wasmTmp = join(tmp, "plugin.wasm");
try {
  execFileSync("node", [join(root, "compiler/asc-driver.mjs"), asmPath, wasmTmp], { stdio: ["ignore", "inherit", "inherit"] });
} catch (e) {
  console.error("COMPILE FAILED");
  process.exit(1);
}
const wasm = readFileSync(wasmTmp);

// --- generate a STUNNING themeable HTML GUI from the param list ------
// Custom rotary knobs (conic-gradient rings + glowing pointers), a glassy
// panel with an animated accent glow, per-plugin accent color, and the
// description as a footer. Drag vertically / wheel to adjust, double-click
// to reset. Self-contained (no external assets).
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function genHtml(name, params, opts) {
  const accent = (opts && opts.accent) || "#ffb454";
  const accent2 = (opts && opts.accent2) || "#ff7a9c";
  const subtitle = (opts && opts.subtitle) || "";
  const knobs = params.map((p) => {
    const step = p.step ?? 0.001;
    return `      <div class="knob" data-i="${p.index}" data-min="${p.min}" data-max="${p.max}" data-def="${p.default}" data-step="${step}">
        <div class="dial"><span class="cap"></span><span class="ptr"></span></div>
        <div class="nm">${esc(p.name)}</div><div class="val"></div>
      </div>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{--ac:${accent};--ac2:${accent2}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font:13px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e7eef6;
    background:radial-gradient(120% 90% at 50% -10%,#1b2230 0%,#0a0d13 60%,#06080c 100%);
    display:flex;align-items:center;justify-content:center;padding:22px;overflow:hidden}
  .panel{position:relative;width:100%;max-width:560px;border-radius:20px;padding:22px 24px 18px;
    background:linear-gradient(160deg,rgba(31,38,52,.86),rgba(13,17,24,.92));
    border:1px solid rgba(255,255,255,.08);
    box-shadow:0 24px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06)}
  .panel::before{content:"";position:absolute;inset:-40%;z-index:0;pointer-events:none;
    background:radial-gradient(closest-side,color-mix(in srgb,var(--ac) 22%,transparent),transparent);
    filter:blur(20px);animation:drift 9s ease-in-out infinite alternate}
  @keyframes drift{from{transform:translate(-12%,-8%)}to{transform:translate(12%,8%)}}
  .hd{position:relative;z-index:1;display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
  h1{font-size:18px;margin:0;letter-spacing:.06em;font-weight:700;
    background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .badge{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8da0bd;
    border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 8px}
  .grid{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:14px 10px;justify-content:center;margin:16px 0 6px}
  .knob{width:96px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:ns-resize;user-select:none;touch-action:none}
  .dial{--n:0;position:relative;width:84px;height:84px;border-radius:50%;
    background:conic-gradient(from 225deg,var(--ac) calc(var(--n)*270deg),rgba(255,255,255,.09) calc(var(--n)*270deg) 270deg,transparent 270deg);
    filter:drop-shadow(0 0 7px color-mix(in srgb,var(--ac) 55%,transparent))}
  .cap{position:absolute;top:11px;left:11px;width:62px;height:62px;border-radius:50%;
    background:radial-gradient(circle at 50% 32%,#2c3546,#0f131b 72%);
    box-shadow:inset 0 2px 7px rgba(0,0,0,.65),inset 0 -1px 0 rgba(255,255,255,.05)}
  .ptr{position:absolute;top:7px;left:50%;width:3px;height:26px;margin-left:-1.5px;border-radius:2px;
    background:var(--ac);box-shadow:0 0 7px var(--ac);transform-origin:50% 35px;
    transform:rotate(calc((var(--n) - 0.5) * 270deg))}
  .nm{font-size:11px;letter-spacing:.06em;color:#aeb9cc;text-transform:uppercase}
  .val{font-size:12px;color:#fff;font-variant-numeric:tabular-nums;font-weight:600}
  .ft{position:relative;z-index:1;font-size:11px;line-height:1.5;color:#7c8aa3;margin-top:8px;
    border-top:1px solid rgba(255,255,255,.06);padding-top:10px}
  </style></head><body>
  <div class="panel">
    <div class="hd"><h1>${esc(name)}</h1><span class="badge">${params.length} controls</span></div>
    <div class="grid">
${knobs}
    </div>
    ${subtitle ? `<div class="ft">${esc(subtitle)}</div>` : ""}
  </div>
  <script>
  (function(){
    function fmt(v,step){ var d=step>=1?0:(step>=0.1?1:(step>=0.01?2:3)); return (+v).toFixed(d); }
    function setup(k){
      var i=+k.dataset.i, mn=+k.dataset.min, mx=+k.dataset.max, def=+k.dataset.def, step=+k.dataset.step||0.001;
      var val=def, dial=k.querySelector('.dial'), out=k.querySelector('.val');
      function norm(){ return (val-mn)/(mx-mn||1); }
      function paint(){ dial.style.setProperty('--n', norm()); out.textContent=fmt(val,step);
        if(window.vstai&&window.vstai.setParam) window.vstai.setParam(i,val); }
      function setN(n){ n=n<0?0:(n>1?1:n); var v=mn+(mx-mn)*n; v=Math.round(v/step)*step; val=v; paint(); }
      k.addEventListener('pointerdown',function(e){ k._d=1; k._y=e.clientY; k._n=norm(); k.setPointerCapture(e.pointerId); e.preventDefault(); });
      k.addEventListener('pointermove',function(e){ if(!k._d)return; setN(k._n+(k._y-e.clientY)/220); });
      k.addEventListener('pointerup',function(){ k._d=0; });
      k.addEventListener('pointercancel',function(){ k._d=0; });
      k.addEventListener('dblclick',function(){ val=def; paint(); });
      k.addEventListener('wheel',function(e){ e.preventDefault(); setN(norm()+(e.deltaY<0?0.02:-0.02)); },{passive:false});
      paint();
    }
    function ready(){ var ks=document.querySelectorAll('.knob'); for(var j=0;j<ks.length;j++) setup(ks[j]); }
    if(window.vstai&&window.vstai.onReady) window.vstai.onReady(ready); else ready();
  })();
  </script>
  </body></html>`;
}

// --- generate a standalone in-browser TEST BENCH ---------------------
// A self-contained page (opens from file://) that runs the compiled wasm
// through Web Audio and embeds the real GUI. Effects: built-in musical riff,
// microphone, or a dropped audio file. Synths: clickable + computer-key
// keyboard. Knobs are the live GUI, driving the wasm params in real time.
function genTestHtml(name, params, opts, wasmB64, isInstrument) {
  const accent = (opts && opts.accent) || "#ffb454";
  // embed the real GUI in an iframe; inject a vstai shim that posts to parent
  const shim = '<script>window.vstai={onReady:function(f){f()},setParam:function(i,v){parent.postMessage({t:"p",i:i,v:v},"*")},noteOn:function(id,f,v){parent.postMessage({t:"on",id:id,f:f,v:v},"*")},noteOff:function(id){parent.postMessage({t:"off",id:id},"*")}};<\/script>';
  const gui = genHtml(name, params, opts).replace("</head>", shim + "</head>");
  const guiLit = JSON.stringify(gui).replace(/<\//g, "<\\/");
  const keys = isInstrument
    ? `<div class="kb" id="kb"></div>`
    : `<div class="row"><label>Source
         <select id="src"><option value="riff">Musical riff</option><option value="mic">Microphone</option><option value="file">Audio file…</option></select></label>
         <input type="file" id="file" accept="audio/*" style="display:none"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(name)} — test bench</title><style>
  :root{--ac:${accent}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font:13px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e7eef6;
    background:radial-gradient(120% 90% at 50% -10%,#161c28,#080b10 70%);display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px}
  .top{display:flex;align-items:center;gap:12px;width:100%;max-width:600px}
  .top b{font-size:15px;letter-spacing:.04em;color:var(--ac)}
  .top .sub{font-size:11px;color:#7c8aa3}
  iframe{width:100%;max-width:600px;height:380px;border:0;background:transparent}
  .bar{width:100%;max-width:600px;display:flex;flex-direction:column;gap:10px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 16px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  button{font:inherit;color:#06080c;background:var(--ac);border:0;border-radius:9px;padding:9px 16px;font-weight:700;cursor:pointer}
  button.off{background:#2a3344;color:#e7eef6}
  select,input[type=file]{font:inherit;color:#e7eef6;background:#11161f;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 9px}
  label{display:flex;gap:8px;align-items:center;color:#aeb9cc}
  .st{font-size:12px;color:#8da0bd;min-height:16px}
  .kb{display:flex;gap:3px;flex-wrap:wrap}
  .kb .key{width:30px;height:78px;border-radius:0 0 6px 6px;background:linear-gradient(#f4f7fb,#cfd7e2);
    border:1px solid #2a3344;cursor:pointer;color:#1a2230;font-size:9px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px}
  .kb .key.bk{background:linear-gradient(#2b3340,#10151d);color:#9fb0c8;height:50px;width:22px;margin:0 -12px;z-index:2}
  .kb .key.dn{background:var(--ac);color:#06080c}
  </style></head><body>
  <div class="top"><b>${esc(name)}</b><span class="sub">live test bench — turn the knobs, play audio</span></div>
  <iframe id="gui"></iframe>
  <div class="bar">
    <div class="row"><button id="go" class="off">▶ Start audio</button><span class="st" id="st">click Start (browsers need a gesture to begin audio)</span></div>
    ${keys}
  </div>
  <script>
  var WB=${JSON.stringify(wasmB64)}, IS_SYNTH=${isInstrument ? "true" : "false"};
  document.getElementById('gui').srcdoc=${guiLit};
  var ctx,node,src,ex,inPtr,outPtr,parPtr,STRIDE=8192,started=false,running=false;
  var pcache=new Float32Array(64);
  function memF(){return new Float32Array(ex.memory.buffer);}
  window.addEventListener('message',function(e){var d=e.data||{};
    if(d.t==='p'){pcache[d.i]=d.v; if(ex) memF()[parPtr+d.i]=d.v;}
    else if(d.t==='on'&&ex&&ex.noteOn) ex.noteOn(d.id,d.f,d.v);
    else if(d.t==='off'&&ex&&ex.noteOff) ex.noteOff(d.id);});
  function st(m){document.getElementById('st').textContent=m;}
  function makeRiff(){
    var sr=ctx.sampleRate, len=Math.floor(sr*3.2), b=ctx.createBuffer(2,len,sr), d=b.getChannelData(0);
    var riff=[45,52,57,60,64,57,52,48], nl=Math.floor(sr*0.4);
    for(var i=0;i<len;i++){var idx=Math.floor(i/nl),lt=(i-idx*nl)/sr,hz=440*Math.pow(2,(riff[idx%riff.length]-69)/12),
      ph=2*Math.PI*hz*(i/sr),env=Math.exp(-lt*5);
      d[i]=env*(Math.sin(ph)+0.5*Math.sin(2*ph)+0.3*Math.sin(3*ph))*0.18;}
    b.copyToChannel(d,1); return b;
  }
  async function ensure(){
    if(started)return;
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    var bytes=Uint8Array.from(atob(WB),function(c){return c.charCodeAt(0);});
    var inst=await WebAssembly.instantiate(await WebAssembly.compile(bytes),{env:{abort:function(){},seed:function(){return 0;}}});
    ex=inst.exports; ex.init(ctx.sampleRate,STRIDE,2);
    inPtr=ex.getInputPtr()>>>2; outPtr=ex.getOutputPtr()>>>2; parPtr=ex.getParamsPtr()>>>2;
    var m=memF(); for(var i=0;i<64;i++) m[parPtr+i]=pcache[i];
    node=ctx.createScriptProcessor(1024,2,2);
    node.onaudioprocess=function(e){var n=e.outputBuffer.length,m=memF(),
      iL=e.inputBuffer.getChannelData(0),iR=e.inputBuffer.numberOfChannels>1?e.inputBuffer.getChannelData(1):e.inputBuffer.getChannelData(0);
      for(var i=0;i<n;i++){m[inPtr+i]=iL[i];m[inPtr+STRIDE+i]=iR[i];}
      ex.process(n);
      var oL=e.outputBuffer.getChannelData(0),oR=e.outputBuffer.getChannelData(1);
      for(var i=0;i<n;i++){oL[i]=m[outPtr+i];oR[i]=m[outPtr+STRIDE+i];}};
    node.connect(ctx.destination); started=true;
  }
  function disconnectSrc(){ if(src){try{src.disconnect();}catch(e){}; src=null;} }
  function setSource(kind){
    disconnectSrc();
    if(kind==='riff'){ src=ctx.createBufferSource(); src.buffer=makeRiff(); src.loop=true; src.connect(node); src.start(); st('playing musical riff through the plugin'); }
    else if(kind==='mic'){ navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){ src=ctx.createMediaStreamSource(s); src.connect(node); st('microphone → plugin'); }).catch(function(){ st('mic blocked'); }); }
  }
  document.getElementById('go').addEventListener('click',async function(){
    await ensure();
    if(ctx.state==='suspended') await ctx.resume();
    if(!running){ running=true; this.textContent='⏸ Stop'; this.className='';
      if(!IS_SYNTH){ setSource(document.getElementById('src').value); } else { st('press the keys (or computer keys A–K) to play'); }
    } else { running=false; this.textContent='▶ Start audio'; this.className='off'; disconnectSrc(); st('stopped'); }
  });
  ${isInstrument ? `
  var KB=document.getElementById('kb'), KEYS=[['C',60,0],['C#',61,1],['D',62,0],['D#',63,1],['E',64,0],['F',65,0],['F#',66,1],['G',67,0],['G#',68,1],['A',69,0],['A#',70,1],['B',71,0],['C',72,0]];
  var KMAP={a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72};
  function hz(m){return 440*Math.pow(2,(m-69)/12);}
  function down(m,el){ ensure().then(function(){ if(ctx.state==='suspended')ctx.resume(); if(ex&&ex.noteOn) ex.noteOn(m,hz(m),0.9); }); if(el)el.classList.add('dn'); }
  function up(m,el){ if(ex&&ex.noteOff) ex.noteOff(m); if(el)el.classList.remove('dn'); }
  KEYS.forEach(function(k){ var el=document.createElement('div'); el.className='key'+(k[2]?' bk':''); el.textContent=k[0];
    el.addEventListener('pointerdown',function(e){e.preventDefault();down(k[1],el);});
    el.addEventListener('pointerup',function(){up(k[1],el);}); el.addEventListener('pointerleave',function(){up(k[1],el);});
    KB.appendChild(el); });
  var held={};
  window.addEventListener('keydown',function(e){ var m=KMAP[e.key]; if(m&&!held[m]){held[m]=1;down(m,null);} });
  window.addEventListener('keyup',function(e){ var m=KMAP[e.key]; if(m){held[m]=0;up(m,null);} });
  ` : `
  document.getElementById('src').addEventListener('change',function(){
    var v=this.value, fi=document.getElementById('file'); fi.style.display=v==='file'?'inline-block':'none';
    if(running&&v!=='file') setSource(v);
  });
  document.getElementById('file').addEventListener('change',function(e){
    var f=e.target.files[0]; if(!f)return; ensure().then(function(){ f.arrayBuffer().then(function(ab){ ctx.decodeAudioData(ab,function(buf){
      disconnectSrc(); src=ctx.createBufferSource(); src.buffer=buf; src.loop=true; src.connect(node); if(ctx.state==='suspended')ctx.resume(); src.start(); st('looping '+f.name+' through the plugin'); }); }); });
  });
  `}
  </script></body></html>`;
}

// --- assemble the .vstai (format 1) ----------------------------------
// publishedAt must be deterministic-ish; use the spec's or a fixed epoch.
const doc = {
  format: 1,
  name: spec.name,
  isInstrument: !!spec.isInstrument,
  explanation: spec.explanation || "",
  params: spec.params.map((p) => ({ name: p.name, index: p.index, min: p.min, max: p.max, default: p.default })),
  wasmBase64: wasm.toString("base64"),
  html: spec.html || genHtml(spec.name, spec.params, {
    accent: spec.theme && spec.theme.accent, accent2: spec.theme && spec.theme.accent2, subtitle: spec.explanation,
  }),
  assembly,
  publishedAt: spec.publishedAt || 1750000000000,
};
const json = JSON.stringify(doc, null, 2);
writeFileSync(outPath, json);

// Standalone in-browser test bench next to the plugin (open from file://).
const testPath = join(dirname(outPath), "test.html");
writeFileSync(testPath, genTestHtml(spec.name, spec.params, {
  accent: spec.theme && spec.theme.accent, accent2: spec.theme && spec.theme.accent2, subtitle: spec.explanation,
}, doc.wasmBase64, !!spec.isInstrument));

// Deploy a copy into the gallery so it shows up in the catalogue. The gallery
// scans docs/gallery/data/*.vstai; build-gallery.mjs regenerates index.json.
const galleryDir = resolve(root, "docs/gallery/data");
let galleryPath = null;
if (existsSync(galleryDir)) {
  galleryPath = join(galleryDir, slug(spec.name) + ".vstai");
  writeFileSync(galleryPath, json);
}
const relOut = outPath.startsWith(root) ? outPath.slice(root.length + 1) : outPath;
console.log(`packed ${spec.name}  →  ${relOut}  (wasm ${wasm.length} B, ${spec.params.length} params, ${spec.isInstrument ? "synth" : "effect"})`);
console.log(`  test bench → ${join(dirname(relOut), "test.html")}`);
if (galleryPath) console.log(`  gallery → docs/gallery/data/${slug(nm)}.vstai`);
