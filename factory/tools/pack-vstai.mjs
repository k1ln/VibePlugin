// =====================================================================
//  pack-vstai.mjs — compile an AssemblyScript DSP module and assemble a
//  self-contained .vstai document (format 1). Auto-generates a state-of-the-art
//  HTML GUI from the param list (animated knobs, segmented switches, live
//  themed panel) plus a standalone test.html bench with a live scope.
//
//  Usage: node pack-vstai.mjs <spec.json>
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
const GENERIC = /^(untitled|plugin|new ?plugin|effect|synth|test|reverb|delay|filter|synthesizer)$/i;
const nm = (spec.name || "").trim();
if (!nm || GENERIC.test(nm)) {
  console.error(`REFUSING: "${spec.name}" is empty or a generic name. Give each plugin a distinct, descriptive name.`);
  process.exit(1);
}

const asmPath = resolve(root, spec.assembly);
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

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// A param is rendered as a segmented switch (buttons) when it is explicitly
// discrete: an integer step (>=1) over a small integer range (2..6 options).
// This is intentional — set step:1 on a mode/type/waveform param to get buttons;
// leave step at 0.001 for continuous morphs so they stay knobs.
function isDiscrete(p) {
  const step = p.step ?? 0.001;
  return step >= 1 && Number.isInteger(p.min) && Number.isInteger(p.max) && (p.max - p.min) >= 1 && (p.max - p.min) <= 5;
}

// =====================================================================
//  STATE-OF-THE-ART GUI  — animated knobs + segmented switches, themed
//  panel with a pulsing power LED, staggered entrance, value bubbles.
// =====================================================================
function genHtml(name, params, opts) {
  const accent = (opts && opts.accent) || "#ffb454";
  const accent2 = (opts && opts.accent2) || "#ff7a9c";
  const subtitle = (opts && opts.subtitle) || "";
  const cells = params.map((p, idx) => {
    const d = idx * 45;
    if (isDiscrete(p)) {
      let segs = "";
      for (let v = p.min; v <= p.max; v++) segs += `<button class="seg" data-v="${v}">${v}</button>`;
      return `      <div class="cell sw" style="--d:${d}ms" data-i="${p.index}" data-min="${p.min}" data-max="${p.max}" data-def="${p.default}" data-step="${p.step ?? 1}">
        <div class="segwrap">${segs}</div><div class="nm">${esc(p.name)}</div></div>`;
    }
    const step = p.step ?? 0.001;
    return `      <div class="cell" style="--d:${d}ms" data-i="${p.index}" data-min="${p.min}" data-max="${p.max}" data-def="${p.default}" data-step="${step}">
        <div class="knob"><i class="ticks"></i><i class="dial"><i class="cap"></i><i class="ptr"></i></i><span class="bub"></span></div>
        <div class="nm">${esc(p.name)}</div><div class="val"></div></div>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @property --n{syntax:'<number>';inherits:true;initial-value:0}
  :root{--ac:${accent};--ac2:${accent2}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font:13px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e7eef6;
    background:radial-gradient(130% 100% at 50% -20%,#1c2434 0%,#0a0d13 58%,#05070b 100%);
    display:flex;align-items:center;justify-content:center;padding:20px}
  .panel{position:relative;width:100%;max-width:600px;border-radius:22px;padding:0 0 16px;overflow:hidden;
    background:linear-gradient(165deg,rgba(34,42,58,.92),rgba(12,16,23,.95));
    border:1px solid rgba(255,255,255,.09);
    box-shadow:0 30px 70px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.07),inset 0 0 0 1px rgba(0,0,0,.4)}
  .panel::before{content:"";position:absolute;inset:-45%;z-index:0;pointer-events:none;
    background:radial-gradient(closest-side,color-mix(in srgb,var(--ac) 20%,transparent),transparent);
    filter:blur(26px);animation:drift 11s ease-in-out infinite alternate}
  @keyframes drift{from{transform:translate(-14%,-9%) scale(1)}to{transform:translate(14%,10%) scale(1.1)}}
  .bar{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:15px 20px;
    background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0));
    border-bottom:1px solid rgba(255,255,255,.07)}
  .led{width:9px;height:9px;border-radius:50%;background:var(--ac);
    box-shadow:0 0 9px var(--ac),0 0 2px #fff inset;animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.55;box-shadow:0 0 5px var(--ac)}50%{opacity:1;box-shadow:0 0 13px var(--ac)}}
  h1{font-size:17px;margin:0;letter-spacing:.07em;font-weight:800;flex:1;
    background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .badge{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#93a4c0;
    border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:3px 9px}
  .grid{position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(94px,1fr));
    gap:6px 4px;justify-items:center;padding:20px 18px 6px}
  .cell{display:flex;flex-direction:column;align-items:center;gap:7px;padding:8px 4px 10px;border-radius:14px;
    transition:transform .18s ease,background .18s ease;animation:pop .5s both;animation-delay:var(--d)}
  .cell:hover{transform:translateY(-3px);background:rgba(255,255,255,.035)}
  @keyframes pop{from{opacity:0;transform:translateY(10px) scale(.9)}to{opacity:1;transform:none}}
  .knob{position:relative;width:84px;height:84px;cursor:ns-resize;user-select:none;touch-action:none}
  .ticks{position:absolute;inset:-5px;border-radius:50%;
    background:repeating-conic-gradient(from 226deg,rgba(255,255,255,.22) 0 1.3deg,transparent 1.3deg 13.5deg);
    -webkit-mask:radial-gradient(circle,transparent 45px,#000 46px,#000 49px,transparent 50px);
    mask:radial-gradient(circle,transparent 45px,#000 46px,#000 49px,transparent 50px)}
  .dial{--n:0;position:absolute;inset:0;border-radius:50%;
    background:conic-gradient(from 225deg,var(--ac) calc(var(--n)*270deg),rgba(255,255,255,.08) calc(var(--n)*270deg) 270deg,transparent 270deg);
    filter:drop-shadow(0 0 calc(4px + var(--n)*9px) color-mix(in srgb,var(--ac) 60%,transparent));
    transition:--n .14s cubic-bezier(.2,.75,.25,1)}
  .cap{position:absolute;top:11px;left:11px;width:62px;height:62px;border-radius:50%;
    background:radial-gradient(circle at 50% 30%,#323c4f,#0d1118 74%);
    box-shadow:inset 0 2px 8px rgba(0,0,0,.7),inset 0 -1px 0 rgba(255,255,255,.06),0 1px 1px rgba(0,0,0,.5)}
  .ptr{position:absolute;top:8px;left:50%;width:3px;height:25px;margin-left:-1.5px;border-radius:2px;
    background:linear-gradient(var(--ac),var(--ac2));box-shadow:0 0 8px var(--ac);transform-origin:50% 34px;
    transform:rotate(calc((var(--n) - 0.5) * 270deg));transition:transform .14s cubic-bezier(.2,.75,.25,1)}
  .bub{position:absolute;top:-14px;left:50%;transform:translate(-50%,4px) scale(.8);opacity:0;pointer-events:none;
    font-size:11px;font-weight:700;color:#06080c;background:var(--ac);padding:2px 7px;border-radius:6px;
    font-variant-numeric:tabular-nums;box-shadow:0 4px 12px rgba(0,0,0,.4);transition:.15s}
  .cell:hover .bub,.knob.act .bub{opacity:1;transform:translate(-50%,0) scale(1)}
  .nm{font-size:10.5px;letter-spacing:.08em;color:#aeb9cc;text-transform:uppercase;text-align:center}
  .val{font-size:12px;color:#fff;font-variant-numeric:tabular-nums;font-weight:700}
  .segwrap{display:flex;gap:3px;padding:4px;border-radius:11px;background:rgba(0,0,0,.34);
    border:1px solid rgba(255,255,255,.07);height:84px;flex-direction:column;justify-content:center;width:64px}
  .seg{flex:1;min-height:0;font:inherit;font-size:12px;font-weight:700;color:#9fb0c8;cursor:pointer;
    background:transparent;border:0;border-radius:8px;transition:.16s}
  .seg:hover{color:#e7eef6;background:rgba(255,255,255,.06)}
  .seg.on{color:#06080c;background:linear-gradient(var(--ac),var(--ac2));box-shadow:0 0 12px color-mix(in srgb,var(--ac) 55%,transparent)}
  .ft{position:relative;z-index:1;font-size:11px;line-height:1.55;color:#8290a8;margin:6px 20px 0;
    border-top:1px solid rgba(255,255,255,.06);padding-top:11px}
  </style></head><body>
  <div class="panel">
    <div class="bar"><span class="led"></span><h1>${esc(name)}</h1><span class="badge">${params.length} controls</span></div>
    <div class="grid">
${cells}
    </div>
    ${subtitle ? `<div class="ft">${esc(subtitle)}</div>` : ""}
  </div>
  <script>
  (function(){
    function fmt(v,step){ var d=step>=1?0:(step>=0.1?1:(step>=0.01?2:3)); return (+v).toFixed(d); }
    function setKnob(c){
      var i=+c.dataset.i, mn=+c.dataset.min, mx=+c.dataset.max, def=+c.dataset.def, step=+c.dataset.step||0.001;
      var val=def, knob=c.querySelector('.knob'), dial=c.querySelector('.dial'), out=c.querySelector('.val'), bub=c.querySelector('.bub');
      function norm(){ return (val-mn)/(mx-mn||1); }
      function paint(){ var n=norm(); dial.style.setProperty('--n',n); var t=fmt(val,step); out.textContent=t; bub.textContent=t;
        if(window.vstai&&window.vstai.setParam) window.vstai.setParam(i,val); }
      function setN(n){ n=n<0?0:(n>1?1:n); var v=mn+(mx-mn)*n; v=Math.round(v/step)*step; val=v; paint(); }
      knob.addEventListener('pointerdown',function(e){ knob._d=1; knob._y=e.clientY; knob._n=norm(); knob.classList.add('act'); knob.setPointerCapture(e.pointerId); e.preventDefault(); });
      knob.addEventListener('pointermove',function(e){ if(!knob._d)return; setN(knob._n+(knob._y-e.clientY)/200); });
      knob.addEventListener('pointerup',function(){ knob._d=0; knob.classList.remove('act'); });
      knob.addEventListener('pointercancel',function(){ knob._d=0; knob.classList.remove('act'); });
      knob.addEventListener('dblclick',function(){ val=def; paint(); });
      knob.addEventListener('wheel',function(e){ e.preventDefault(); setN(norm()+(e.deltaY<0?0.02:-0.02)); },{passive:false});
      paint();
    }
    function setSeg(c){
      var i=+c.dataset.i, def=+c.dataset.def, segs=c.querySelectorAll('.seg');
      function pick(b){ for(var j=0;j<segs.length;j++) segs[j].classList.remove('on'); b.classList.add('on');
        if(window.vstai&&window.vstai.setParam) window.vstai.setParam(i,+b.dataset.v); }
      for(var j=0;j<segs.length;j++){ (function(b){ b.addEventListener('click',function(){ pick(b); }); })(segs[j]); }
      var best=segs[0],bd=1e9; for(var k=0;k<segs.length;k++){ var dd=Math.abs(+segs[k].dataset.v-def); if(dd<bd){bd=dd;best=segs[k];} }
      pick(best);
    }
    function ready(){
      var cs=document.querySelectorAll('.cell');
      for(var j=0;j<cs.length;j++){ if(cs[j].classList.contains('sw')) setSeg(cs[j]); else setKnob(cs[j]); }
    }
    if(window.vstai&&window.vstai.onReady) window.vstai.onReady(ready); else ready();
  })();
  </script>
  </body></html>`;
}

// =====================================================================
//  TEST BENCH — runs the wasm through Web Audio, embeds the real GUI, and
//  shows a live waveform scope. Effects: riff / mic / file. Synths: keyboard.
// =====================================================================
function genTestHtml(name, params, opts, wasmB64, isInstrument, guiHtml) {
  const accent = (opts && opts.accent) || "#ffb454";
  // GUIs (and the gallery contract) call noteOn(midiNote, velocity); the bench
  // turns the MIDI note into Hz in the message handler below.
  const shim = '<script>window.vstai={onReady:function(f){f()},setParam:function(i,v){parent.postMessage({t:"p",i:i,v:v},"*")},noteOn:function(n,v){parent.postMessage({t:"on",id:n,v:v},"*")},noteOff:function(id){parent.postMessage({t:"off",id:id},"*")}};<\/script>';
  // use the plugin's own (bespoke) GUI if supplied, else the default generator;
  // inject the vstai shim robustly wherever the doc lets us.
  let gui = guiHtml || genHtml(name, params, opts);
  if (gui.includes("</head>")) gui = gui.replace("</head>", shim + "</head>");
  else if (gui.includes("<body>")) gui = gui.replace("<body>", "<body>" + shim);
  else gui = shim + gui;
  const guiLit = JSON.stringify(gui).replace(/<\//g, "<\\/");
  const keys = isInstrument
    ? `<div class="krow"><span class="klabel">Octave</span><button id="octdn" class="oct" type="button">−</button><span id="octval" class="octval">4</span><button id="octup" class="oct" type="button">+</button><span class="khint">or Z / X keys</span></div>
       <div class="kb" id="kb"></div>`
    : `<div class="row"><label>Source
         <select id="src"><option value="riff">Musical riff</option><option value="mic">Microphone</option><option value="file">Audio file…</option></select></label>
         <input type="file" id="file" accept="audio/*" style="display:none"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(name)} — test bench</title><style>
  :root{--ac:${accent}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font:13px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e7eef6;
    background:radial-gradient(130% 100% at 50% -20%,#171f2d,#070a0f 72%);display:flex;flex-direction:column;align-items:center;gap:13px;padding:18px}
  .top{display:flex;align-items:center;gap:11px;width:100%;max-width:620px}
  .top .led{width:9px;height:9px;border-radius:50%;background:var(--ac);box-shadow:0 0 10px var(--ac)}
  .top b{font-size:15px;letter-spacing:.05em;color:var(--ac)}
  .top .sub{font-size:11px;color:#7c8aa3;margin-left:auto}
  iframe{width:100%;max-width:620px;height:400px;border:0;background:transparent}
  .bar{width:100%;max-width:620px;display:flex;flex-direction:column;gap:11px;
    background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
    border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:14px 16px;
    box-shadow:0 16px 40px rgba(0,0,0,.4)}
  canvas{width:100%;height:74px;display:block;border-radius:10px;background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.06)}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  button{font:inherit;color:#06080c;background:var(--ac);border:0;border-radius:10px;padding:9px 17px;font-weight:800;cursor:pointer;transition:.15s}
  button:hover{filter:brightness(1.08)}
  button.off{background:#28313f;color:#e7eef6}
  select,input[type=file]{font:inherit;color:#e7eef6;background:#10151e;border:1px solid rgba(255,255,255,.13);border-radius:9px;padding:7px 9px}
  label{display:flex;gap:8px;align-items:center;color:#aeb9cc}
  .st{font-size:12px;color:#8da0bd;min-height:16px}
  .krow{display:flex;gap:8px;align-items:center;color:#aeb9cc;font-size:12px}
  .krow .klabel{font-weight:600;letter-spacing:.03em}
  .krow .oct{padding:4px 13px;font-size:16px;line-height:1;background:#28313f;color:#e7eef6;border-radius:8px}
  .krow .octval{min-width:22px;text-align:center;font-weight:800;color:var(--ac);font-variant-numeric:tabular-nums}
  .krow .khint{margin-left:4px;color:#7c8aa3;font-size:11px}
  .kb{display:flex;gap:3px;flex-wrap:wrap}
  .kb .key{width:30px;height:80px;border-radius:0 0 7px 7px;background:linear-gradient(#f4f7fb,#cdd5e0);
    border:1px solid #2a3344;cursor:pointer;color:#1a2230;font-size:9px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;transition:.08s}
  .kb .key.bk{background:linear-gradient(#2b3340,#10151d);color:#9fb0c8;height:52px;width:22px;margin:0 -12px;z-index:2}
  .kb .key.dn{background:linear-gradient(var(--ac),#fff);color:#06080c;transform:translateY(2px)}
  </style></head><body>
  <div class="top"><span class="led"></span><b>${esc(name)}</b><span class="sub">live test bench — turn the knobs, play audio</span></div>
  <iframe id="gui"></iframe>
  <div class="bar">
    <canvas id="scope" width="620" height="74"></canvas>
    <div class="row"><button id="go" class="off">▶ Start audio</button><span class="st" id="st">click Start (browsers need a gesture to begin audio)</span></div>
    ${keys}
  </div>
  <script>
  var WB=${JSON.stringify(wasmB64)}, IS_SYNTH=${isInstrument ? "true" : "false"};
  document.getElementById('gui').srcdoc=${guiLit};
  var ctx,node,src,analyser,wav,ex,inPtr,outPtr,parPtr,STRIDE=8192,started=false,running=false;
  var pcache=new Float32Array(64);
  function memF(){return new Float32Array(ex.memory.buffer);}
  window.addEventListener('message',function(e){var d=e.data||{};
    if(d.t==='p'){pcache[d.i]=d.v; if(ex) memF()[parPtr+d.i]=d.v;}
    else if(d.t==='on'&&ex&&ex.noteOn) ex.noteOn(d.id,440*Math.pow(2,(d.id-69)/12),d.v==null?0.9:d.v);
    else if(d.t==='off'&&ex&&ex.noteOff) ex.noteOff(d.id);});
  function st(m){document.getElementById('st').textContent=m;}
  var cv=document.getElementById('scope'), g=cv.getContext('2d');
  var ACC=getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()||'#ffb454';
  function draw(){
    requestAnimationFrame(draw);
    var W=cv.width,H=cv.height; g.clearRect(0,0,W,H);
    g.strokeStyle='rgba(255,255,255,.07)'; g.lineWidth=1; g.beginPath(); g.moveTo(0,H/2); g.lineTo(W,H/2); g.stroke();
    if(!analyser){ return; }
    analyser.getFloatTimeDomainData(wav);
    g.lineWidth=2; g.strokeStyle=ACC; g.shadowBlur=10; g.shadowColor=ACC; g.beginPath();
    for(var i=0;i<wav.length;i++){ var x=i/(wav.length-1)*W, y=H/2 - wav[i]*H*0.46; if(i===0)g.moveTo(x,y); else g.lineTo(x,y); }
    g.stroke(); g.shadowBlur=0;
  }
  draw();
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
    analyser=ctx.createAnalyser(); analyser.fftSize=1024; wav=new Float32Array(analyser.fftSize);
    node.connect(analyser); node.connect(ctx.destination); started=true;
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
  var oct=0;                                              // octave offset (−4..+4), applied at note-on
  function hz(m){return 440*Math.pow(2,(m-69)/12);}
  function setOct(o){ oct=o<-4?-4:(o>4?4:o); var ov=document.getElementById('octval'); if(ov)ov.textContent=(4+oct); }
  function down(m,el){ ensure().then(function(){ if(ctx.state==='suspended')ctx.resume(); if(ex&&ex.noteOn) ex.noteOn(m,hz(m),0.9); }); if(el)el.classList.add('dn'); }
  function up(m,el){ if(ex&&ex.noteOff) ex.noteOff(m); if(el)el.classList.remove('dn'); }
  KEYS.forEach(function(k){ var el=document.createElement('div'); el.className='key'+(k[2]?' bk':''); el.textContent=k[0];
    el.addEventListener('pointerdown',function(e){e.preventDefault();el._n=k[1]+oct*12;down(el._n,el);});
    el.addEventListener('pointerup',function(){up(el._n,el);}); el.addEventListener('pointerleave',function(){if(el.classList.contains('dn'))up(el._n,el);});
    KB.appendChild(el); });
  document.getElementById('octdn').addEventListener('click',function(){setOct(oct-1);});
  document.getElementById('octup').addEventListener('click',function(){setOct(oct+1);});
  var held={};                                            // base note -> actual note played (so releases survive an octave change)
  window.addEventListener('keydown',function(e){ if(e.repeat)return;
    if(e.key==='z'||e.key==='Z'){setOct(oct-1);return;} if(e.key==='x'||e.key==='X'){setOct(oct+1);return;}
    var b=KMAP[e.key]; if(b&&!held[b]){var m=b+oct*12;held[b]=m;down(m,null);} });
  window.addEventListener('keyup',function(e){ var b=KMAP[e.key]; if(b&&held[b]!=null){up(held[b],null);held[b]=null;} });
  setOct(0);
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

// --- resolve the GUI: each plugin's OWN bespoke GUI if it has one --------
// Priority: spec.guiFile (path to a hand/agent-authored gui.html) > spec.html
// (inline) > the default generator. This is what makes every plugin's GUI
// individual instead of one shared template.
const guiOpts = { accent: spec.theme && spec.theme.accent, accent2: spec.theme && spec.theme.accent2, subtitle: spec.explanation };
let guiHtml = null;
if (spec.guiFile) {
  const gf = resolve(root, spec.guiFile);
  if (existsSync(gf)) guiHtml = readFileSync(gf, "utf8");
  else console.error("  ! guiFile not found, using default GUI: " + spec.guiFile);
}
if (!guiHtml && spec.html) guiHtml = spec.html;
if (!guiHtml) guiHtml = genHtml(spec.name, spec.params, guiOpts);

// --- assemble the .vstai (format 1) ----------------------------------
const doc = {
  format: 1,
  name: spec.name,
  isInstrument: !!spec.isInstrument,
  explanation: spec.explanation || "",
  params: spec.params.map((p) => ({ name: p.name, index: p.index, min: p.min, max: p.max, default: p.default })),
  wasmBase64: wasm.toString("base64"),
  html: guiHtml,
  assembly,
  publishedAt: spec.publishedAt || 1750000000000,
};
const json = JSON.stringify(doc, null, 2);
writeFileSync(outPath, json);

// Standalone in-browser test bench next to the plugin (open from file://).
const testPath = join(dirname(outPath), "test.html");
writeFileSync(testPath, genTestHtml(spec.name, spec.params, guiOpts, doc.wasmBase64, !!spec.isInstrument, guiHtml));

// Deploy a copy into the gallery (docs/gallery/data/*.vstai; build-gallery.mjs rebuilds index.json).
const galleryDir = resolve(root, "docs/gallery/data");
let galleryPath = null;
if (existsSync(galleryDir)) {
  galleryPath = join(galleryDir, slug(spec.name) + ".vstai");
  writeFileSync(galleryPath, json);
}
const relOut = outPath.startsWith(root) ? outPath.slice(root.length + 1) : outPath;
console.log(`packed ${spec.name}  →  ${relOut}  (wasm ${wasm.length} B, ${spec.params.length} params, ${spec.isInstrument ? "synth" : "effect"})`);
if (galleryPath) console.log(`  gallery → docs/gallery/data/${slug(nm)}.vstai`);
