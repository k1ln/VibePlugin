// StandardUi.h
// =====================================================================
//  The VibePlugin "standard" GUI component kit — a known-good, self-contained
//  HTML document used three ways:
//    1. as the starter GUI shown before anything is generated (live, playable),
//    2. as the house-style reference injected into every build prompt, and
//    3. as the editable seed of the "Standard UI" tab.
//
//  It is a normal generated-GUI document: inline CSS/JS only, no external
//  requests, and it talks to the engine through window.vstai. Keep it that way
//  so the model can copy these patterns verbatim.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include "WebAssets.h"

namespace vstai
{
    // Compiled-in fallback copy of the house-style kit. The real source of truth is
    // the on-disk file ui/standard.html (shipped in the bundle's Resources, easy for
    // a designer or the AI to read/edit); this baked copy is only used if that file
    // is missing (e.g. an unsigned dev run from an unexpected working directory).
    // Returned by a function (not an inline variable) to avoid any ODR / large-static
    // concerns across translation units. Keep it in sync with ui/standard.html.
    inline const char* bakedStandardUiHtml()
    {
        return R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VibePlugin Standard Kit</title>
<style>
  /* ---- THEME TOKENS -------------------------------------------------------
     One restrained accent, near-black layered surfaces that get *lighter* (not
     shadowed) as they elevate, and hairline white-alpha borders. Re-skin the
     whole GUI from here; a light theme is one class away. */
  :root{
    --bg:#0b0c0f;            /* app base            */
    --panel:#14161c;         /* raised module       */
    --panel-2:#1b1e26;       /* overlay / hover     */
    --track:#08090c;         /* recessed wells      */
    --bezel:rgba(255,255,255,.07);   /* hairline    */
    --bezel-2:rgba(255,255,255,.13); /* default     */
    --bezel-3:rgba(255,255,255,.22); /* strong      */
    --ink:#eceef3; --ink-2:#aab1c0; --muted:#6b7280;
    --accent:#4f8dff; --accent-2:#9d7bff; --ok:#46d39a;
    --shadow:rgba(0,0,0,.55); --radius:13px; --radius-sm:8px;
  }
  body.light{
    --bg:#f4f6fa; --panel:#ffffff; --panel-2:#eef1f7; --track:#e6eaf2;
    --bezel:rgba(12,20,40,.08); --bezel-2:rgba(12,20,40,.14); --bezel-3:rgba(12,20,40,.24);
    --ink:#0f1219; --ink-2:#3f4654; --muted:#6b7280;
    --accent:#2f6bff; --accent-2:#7b4cff; --shadow:rgba(20,30,60,.12);
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:var(--bg); color:var(--ink); position:relative;
    font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; -webkit-user-select:none;user-select:none; padding:16px;
  }
  /* faint film grain for depth — a premium-plugin touch */
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.02;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  body>*{position:relative;z-index:1}
  .hdr{display:flex;align-items:center;gap:9px;margin:0 1px 16px;padding-bottom:13px;border-bottom:1px solid var(--bezel)}
  .hdr h1{font-size:11px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;margin:0;color:var(--ink-2)}
  .hdr .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
  .hdr .sp{flex:1}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(116px,1fr));gap:12px;align-items:start}
  .mod{background:var(--panel);border:1px solid var(--bezel);border-radius:var(--radius);
       padding:15px 12px 13px;display:flex;flex-direction:column;align-items:center;gap:11px;
       transition:border-color .14s,background .14s}
  .mod:hover{border-color:var(--bezel-2);background:var(--panel-2)}
  .mod .lbl{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);font-weight:600}
  .mod .val{font-size:11.5px;color:var(--ink);font-variant-numeric:tabular-nums;
            background:var(--track);border:1px solid var(--bezel);border-radius:6px;padding:2px 9px;min-width:46px;text-align:center}
  /* knob — thin accent arc, clean indicator */
  .knob{width:70px;height:70px;cursor:ns-resize;touch-action:none}
  .knob .body{fill:var(--track);stroke:var(--bezel-2);stroke-width:1.5}
  .knob .arc{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;
             filter:drop-shadow(0 0 4px color-mix(in srgb,var(--accent) 50%,transparent))}
  .knob .ind{stroke:var(--ink);stroke-width:2.5;stroke-linecap:round}
  /* fader */
  .fader{width:28px;height:120px;background:var(--track);border:1px solid var(--bezel-2);
         border-radius:7px;position:relative;cursor:ns-resize;touch-action:none;overflow:hidden}
  .fader .fill{position:absolute;left:0;right:0;bottom:0;
               background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--track)))}
  .fader .cap{position:absolute;left:-3px;right:-3px;height:14px;border-radius:5px;
              background:linear-gradient(180deg,#fff,#c6ccd9);box-shadow:0 1px 4px rgba(0,0,0,.45)}
  /* button + toggle */
  .btn{appearance:none;border:1px solid var(--bezel-2);background:var(--panel-2);color:var(--ink-2);
       font:inherit;font-weight:600;font-size:12px;padding:9px 14px;border-radius:var(--radius-sm);
       cursor:pointer;min-width:84px;transition:border-color .12s,color .12s,background .12s,transform .05s}
  .btn:hover{border-color:var(--bezel-3);color:var(--ink)}
  .btn:active{transform:translateY(1px)}
  .btn.on{background:var(--accent);border-color:var(--accent);color:#fff;
          box-shadow:0 0 18px color-mix(in srgb,var(--accent) 45%,transparent)}
  /* xy pad */
  .xy{width:128px;height:108px;background:
        linear-gradient(var(--bezel),transparent 1px) 0 0/100% 18px,
        linear-gradient(90deg,var(--bezel),transparent 1px) 0 0/18px 100%,
        var(--track);
      border:1px solid var(--bezel-2);border-radius:var(--radius-sm);position:relative;cursor:crosshair;touch-action:none}
  .xy:hover{border-color:var(--bezel-3)}
  .xy .pt{position:absolute;width:14px;height:14px;margin:-7px;border-radius:50%;
          background:var(--accent);border:2px solid #fff;
          box-shadow:0 0 14px color-mix(in srgb,var(--accent) 70%,transparent)}
  /* visualizers (oscilloscope / spectrum / level meter) */
  .viz-row{display:grid;grid-template-columns:1.4fr 1.4fr .55fr;gap:12px;margin:12px 0 0}
  .viz{position:relative;background:var(--panel);border:1px solid var(--bezel);border-radius:var(--radius);padding:11px 12px}
  .viz canvas{display:block;width:100%;height:96px;border-radius:var(--radius-sm);background:
       radial-gradient(120% 140% at 50% 0%, color-mix(in srgb,var(--accent) 7%,transparent), transparent), var(--track)}
  .viz .lbl{position:absolute;top:9px;left:13px;font-size:9.5px;letter-spacing:1.2px;
            text-transform:uppercase;color:var(--muted);font-weight:600;z-index:2}
  /* piano */
  .piano{position:relative;height:92px;margin-top:12px;display:flex;
         border:1px solid var(--bezel-2);border-radius:var(--radius-sm);overflow:hidden;background:#000}
  .wk{flex:1;background:linear-gradient(180deg,#f2f4f8,#cfd5e0);border-right:1px solid rgba(0,0,0,.28);
      cursor:pointer}
  .wk:active,.wk.down{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 30%,#fff),color-mix(in srgb,var(--accent) 55%,#fff))}
  .bk{position:absolute;top:0;width:5.0%;height:60%;background:linear-gradient(180deg,#2a2d36,#090b0f);
      border-radius:0 0 4px 4px;z-index:2;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,.5)}
  .bk:active,.bk.down{background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 45%,#000))}
</style>
</head>
<body>
  <div class="hdr"><span class="dot"></span><h1>Standard Kit</h1><span class="sp"></span>
    <span class="lbl" style="font-size:10px;color:var(--muted)">window.vstai house style</span></div>

  <div class="grid">
    <div class="mod"><div class="knob-host" data-index="0" data-min="0" data-max="1" data-def="0.5"></div>
      <div class="lbl">Drive</div><div class="val">—</div></div>
    <div class="mod"><div class="knob-host" data-index="1" data-min="20" data-max="20000" data-def="1000" data-log="1"></div>
      <div class="lbl">Cutoff</div><div class="val">—</div></div>
    <div class="mod"><div class="fader-host" data-index="2" data-min="0" data-max="1" data-def="0.7"></div>
      <div class="lbl">Level</div><div class="val">—</div></div>
    <div class="mod"><button class="btn toggle-host" data-index="3">Bypass</button><div class="lbl">Toggle</div></div>
    <div class="mod"><button class="btn momentary-host" data-index="4">Tap</button><div class="lbl">Momentary</div></div>
    <div class="mod"><div class="xy xy-host" data-x="5" data-y="6"></div><div class="lbl">XY</div></div>
  </div>

  <!-- VISUALIZERS: beautiful canvas displays. They animate on their own; feed
       real data via el.viz.push(samples) / el.viz.setLevel(l,r) when available. -->
  <div class="viz-row">
    <div class="viz"><span class="lbl">Oscilloscope</span><canvas class="scope-host"></canvas></div>
    <div class="viz"><span class="lbl">Spectrum</span><canvas class="spectrum-host"></canvas></div>
    <div class="viz"><span class="lbl">Level</span><canvas class="meter-host"></canvas></div>
  </div>

  <!-- INSTRUMENTS: include a playable keyboard wired to noteOn/noteOff. -->
  <div class="piano" id="kbd"></div>

<script>
"use strict";
/* ---- engine bridge: never touch window.vstai before it exists ----------- */
function whenReady(cb){
  function go(){ (window.vstai.onReady ? window.vstai.onReady(cb) : cb()); }
  if (window.vstai) return go();
  const t = setInterval(()=>{ if (window.vstai){ clearInterval(t); go(); } }, 25);
}
const setParam = (i,v)=>{ if (window.vstai) window.vstai.setParam(i,v); };
const noteOn   = (n,v)=>{ if (window.vstai && window.vstai.noteOn)  window.vstai.noteOn(n,v); };
const noteOff  = (n)  =>{ if (window.vstai && window.vstai.noteOff) window.vstai.noteOff(n); };
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const fmt = v => Math.abs(v)>=100 ? Math.round(v) : (Math.abs(v)>=10 ? v.toFixed(1) : v.toFixed(3));

/* ---- KNOB: drag up/down, wheel to fine-tune, double-click resets -------- */
function makeKnob(host){
  const i=+host.dataset.index, min=+host.dataset.min, max=+host.dataset.max,
        def=+host.dataset.def, log=host.dataset.log==="1";
  const val = host.parentElement.querySelector(".val");
  const ns="http://www.w3.org/2000/svg", svg=document.createElementNS(ns,"svg");
  svg.setAttribute("class","knob"); svg.setAttribute("viewBox","0 0 100 100");
  const a0=135, a1=405;                                   // sweep, degrees
  const body=document.createElementNS(ns,"circle");
  body.setAttribute("class","body"); body.setAttribute("cx",50); body.setAttribute("cy",50); body.setAttribute("r",38);
  const arc=document.createElementNS(ns,"path"); arc.setAttribute("class","arc");
  const ind=document.createElementNS(ns,"line"); ind.setAttribute("class","ind");
  svg.append(body,arc,ind); host.append(svg);
  const toNorm = v => log ? Math.log(v/min)/Math.log(max/min) : (v-min)/(max-min);
  const fromNorm = n => log ? min*Math.pow(max/min,n) : min+n*(max-min);
  const polar=(deg,r)=>[50+r*Math.cos(deg*Math.PI/180),50+r*Math.sin(deg*Math.PI/180)];
  let value=def;
  function render(){
    const n=clamp(toNorm(value),0,1), ang=a0+n*(a1-a0);
    const [sx,sy]=polar(a0,38),[ex,ey]=polar(ang,38);
    arc.setAttribute("d",`M ${sx} ${sy} A 38 38 0 ${ang-a0>180?1:0} 1 ${ex} ${ey}`);
    const [ix,iy]=polar(ang,16),[ox,oy]=polar(ang,34);
    ind.setAttribute("x1",ix); ind.setAttribute("y1",iy); ind.setAttribute("x2",ox); ind.setAttribute("y2",oy);
    if (val) val.textContent=fmt(value);
  }
  function set(v){ value=clamp(v,min,max); render(); setParam(i,value); }
  let drag=null;
  svg.addEventListener("pointerdown",e=>{ drag={y:e.clientY,n:clamp(toNorm(value),0,1)}; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove",e=>{ if(!drag)return; const n=clamp(drag.n+(drag.y-e.clientY)/180,0,1); set(fromNorm(n)); });
  svg.addEventListener("pointerup",()=>drag=null);
  svg.addEventListener("wheel",e=>{ e.preventDefault(); set(fromNorm(clamp(toNorm(value)-Math.sign(e.deltaY)*0.02,0,1))); },{passive:false});
  svg.addEventListener("dblclick",()=>set(def));
  if(window.vstai&&window.vstai.onParam) window.vstai.onParam((p,v)=>{ if(p===i){ value=clamp(+v,min,max); render(); } });
  set(def);
}

/* ---- FADER: vertical drag ----------------------------------------------- */
function makeFader(host){
  const i=+host.dataset.index, min=+host.dataset.min, max=+host.dataset.max, def=+host.dataset.def;
  const val=host.parentElement.querySelector(".val");
  host.classList.add("fader");
  const fill=document.createElement("div"); fill.className="fill";
  const cap=document.createElement("div"); cap.className="cap"; host.append(fill,cap);
  let value=def;
  function render(){ const n=clamp((value-min)/(max-min),0,1); fill.style.height=(n*100)+"%";
                     cap.style.bottom="calc("+(n*100)+"% - 8px)"; if(val) val.textContent=fmt(value); }
  function set(v){ value=clamp(v,min,max); render(); setParam(i,value); }
  let drag=false;
  const fromY=e=>{ const r=host.getBoundingClientRect(); return min+(max-min)*clamp(1-(e.clientY-r.top)/r.height,0,1); };
  host.addEventListener("pointerdown",e=>{ drag=true; host.setPointerCapture(e.pointerId); set(fromY(e)); });
  host.addEventListener("pointermove",e=>{ if(drag) set(fromY(e)); });
  host.addEventListener("pointerup",()=>drag=false);
  host.addEventListener("dblclick",()=>set(def));
  if(window.vstai&&window.vstai.onParam) window.vstai.onParam((p,v)=>{ if(p===i){ value=clamp(+v,min,max); render(); } });
  set(def);
}

/* ---- TOGGLE (latching 0/1) and MOMENTARY (1 while held) ----------------- */
function makeToggle(b){ const i=+b.dataset.index; let on=false;
  const upd=()=>{ b.classList.toggle("on",on); setParam(i,on?1:0); };
  b.addEventListener("click",()=>{ on=!on; upd(); }); upd();
  if(window.vstai&&window.vstai.onParam) window.vstai.onParam((p,v)=>{ if(p===i){ on=(+v>=0.5); b.classList.toggle("on",on); } }); }
function makeMomentary(b){ const i=+b.dataset.index;
  const dn=()=>{ b.classList.add("on"); setParam(i,1); };
  const up=()=>{ b.classList.remove("on"); setParam(i,0); };
  b.addEventListener("pointerdown",dn); b.addEventListener("pointerup",up); b.addEventListener("pointerleave",up); }

/* ---- XY PAD: two params ------------------------------------------------- */
function makeXY(host){
  const ix=+host.dataset.x, iy=+host.dataset.y;
  const pt=document.createElement("div"); pt.className="pt"; host.append(pt);
  let cx=0.5, cy=0.5, drag=false;
  function render(){ pt.style.left=(cx*100)+"%"; pt.style.top=(cy*100)+"%"; }
  function set(e){ const r=host.getBoundingClientRect();
    cx=clamp((e.clientX-r.left)/r.width,0,1); cy=clamp((e.clientY-r.top)/r.height,0,1);
    render(); setParam(ix,cx); setParam(iy,1-cy); }
  host.addEventListener("pointerdown",e=>{ drag=true; host.setPointerCapture(e.pointerId); set(e); });
  host.addEventListener("pointermove",e=>{ if(drag) set(e); });
  host.addEventListener("pointerup",()=>drag=false);
  if(window.vstai&&window.vstai.onParam) window.vstai.onParam((p,v)=>{
    if(p===ix){ cx=clamp(+v,0,1); render(); } else if(p===iy){ cy=clamp(1-(+v),0,1); render(); } });
  render();
}

/* ---- PIANO: 2 octaves from C4, calls noteOn/noteOff --------------------- */
function makeKeyboard(host){
  const base=60, octaves=2, pattern=[0,2,4,5,7,9,11], blacks={1:0,3:1,6:3,8:4,10:5};
  const whites=[];
  for(let o=0;o<octaves;o++) for(const s of pattern) whites.push(base+o*12+s);
  whites.forEach(n=>{ const k=document.createElement("div"); k.className="wk"; k.dataset.note=n; host.append(k); });
  const wpc=100/whites.length;
  for(let o=0;o<octaves;o++) for(const semi in blacks){ const n=base+o*12+ +semi;
    const k=document.createElement("div"); k.className="bk"; k.dataset.note=n;
    k.style.left=((blacks[semi]+o*7+1)*wpc - 2.5)+"%"; host.append(k); }
  let down=null;
  const press=n=>{ noteOn(n,100); host.querySelector(`[data-note="${n}"]`)?.classList.add("down"); };
  const release=n=>{ noteOff(n); host.querySelector(`[data-note="${n}"]`)?.classList.remove("down"); };
  host.addEventListener("pointerdown",e=>{ const n=e.target.dataset.note; if(n){ down=+n; press(down); host.setPointerCapture(e.pointerId);} });
  host.addEventListener("pointerup",()=>{ if(down!=null){ release(down); down=null; } });
  host.addEventListener("pointerleave",()=>{ if(down!=null){ release(down); down=null; } });
}

/* ---- VISUALIZERS: hi-dpi canvas displays. They animate on a synthetic source
   so the GUI looks alive; the latest real frame pushed via el.viz.push() /
   el.viz.setLevel() wins for ~250 ms. Colours come from the theme tokens. ---- */
function vizCanvas(el){ const dpr=devicePixelRatio||1, w=el.clientWidth||220, h=el.clientHeight||96;
  el.width=Math.round(w*dpr); el.height=Math.round(h*dpr);
  const c=el.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); el._w=w; el._h=h; return c; }
const vcol=(n,f)=>(getComputedStyle(document.body).getPropertyValue(n).trim())||f;
const vfresh=o=>o._t && (performance.now()-o._t)<250;

function makeScope(el){
  const ctx=vizCanvas(el); new ResizeObserver(()=>vizCanvas(el)).observe(el);
  const N=320; let data=new Float32Array(N), ph=0;
  const api={ push(a){ data=a; api._t=performance.now(); } }; el.viz=api;
  (function loop(){ const W=el._w,H=el._h;
    if(!vfresh(api)){ ph+=0.045; for(let i=0;i<N;i++){ const t=i/N*Math.PI*6+ph;
      data[i]=(Math.sin(t)*0.6+Math.sin(t*2+ph*1.3)*0.22+Math.sin(t*3)*0.12)*(0.82+0.18*Math.sin(ph)); } }
    ctx.clearRect(0,0,W,H);
    const ac=vcol("--accent","#5b8cff"), g=vcol("--bezel","#243049");
    ctx.globalAlpha=.4; ctx.strokeStyle=g; ctx.lineWidth=1;
    for(let x=0;x<=W;x+=W/8){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke(); ctx.globalAlpha=1;
    ctx.strokeStyle=ac; ctx.lineWidth=2; ctx.shadowColor=ac; ctx.shadowBlur=9; ctx.beginPath();
    for(let i=0;i<data.length;i++){ const x=i/(data.length-1)*W, y=H/2-data[i]*H*0.42; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.stroke(); ctx.shadowBlur=0; requestAnimationFrame(loop); })();
  return api;
}

function makeSpectrum(el){
  const ctx=vizCanvas(el); new ResizeObserver(()=>vizCanvas(el)).observe(el);
  const N=44; let mags=new Float32Array(N), peaks=new Float32Array(N), ph=0;
  const api={ push(a){ mags=a; api._t=performance.now(); } }; el.viz=api;
  (function loop(){ const W=el._w,H=el._h;
    if(!vfresh(api)){ ph+=0.03; for(let i=0;i<N;i++){ const f=i/N;
      mags[i]=Math.max(0,Math.pow(1-f,0.6)*(0.45+0.5*Math.sin(ph*2+i*0.5))+0.03*Math.random()); } }
    ctx.clearRect(0,0,W,H);
    const grad=ctx.createLinearGradient(0,H,0,0);
    grad.addColorStop(0,vcol("--accent","#5b8cff")); grad.addColorStop(1,vcol("--accent-2","#8a6cff"));
    const bw=W/N;
    for(let i=0;i<N;i++){ const v=Math.min(1,mags[i]), bh=v*(H-6);
      ctx.fillStyle=grad; ctx.fillRect(i*bw+1,H-bh,bw-2,bh);
      peaks[i]=Math.max(peaks[i]-1.0,bh);
      ctx.globalAlpha=.75; ctx.fillStyle=vcol("--ink","#e7ecf4"); ctx.fillRect(i*bw+1,H-peaks[i]-2,bw-2,2); ctx.globalAlpha=1; }
    requestAnimationFrame(loop); })();
  return api;
}

function makeMeter(el){
  const ctx=vizCanvas(el); new ResizeObserver(()=>vizCanvas(el)).observe(el);
  let lv=[0,0], peak=[0,0], ph=0;
  const api={ setLevel(l,r){ lv=[l, r==null?l:r]; api._t=performance.now(); } }; el.viz=api;
  (function loop(){ const W=el._w,H=el._h;
    if(!vfresh(api)){ ph+=0.06; lv=[0.45+0.5*Math.abs(Math.sin(ph)),0.45+0.5*Math.abs(Math.sin(ph*1.12+1))]; }
    ctx.clearRect(0,0,W,H);
    const gap=8, bw=(W-gap*3)/2;
    const grad=ctx.createLinearGradient(0,H,0,0);
    grad.addColorStop(0,"#3ad17a"); grad.addColorStop(.72,vcol("--accent","#5b8cff")); grad.addColorStop(1,"#ff5577");
    for(let ch=0;ch<2;ch++){ const x=gap+ch*(bw+gap), v=Math.min(1,lv[ch]||0);
      ctx.fillStyle=vcol("--track","#1c2535"); ctx.fillRect(x,0,bw,H);
      ctx.fillStyle=grad; ctx.fillRect(x,H-v*H,bw,v*H);
      peak[ch]=Math.max(peak[ch]-1.2,v*H);
      ctx.fillStyle=vcol("--ink","#e7ecf4"); ctx.fillRect(x,H-peak[ch]-2,bw,2); }
    requestAnimationFrame(loop); })();
  return api;
}

whenReady(()=>{
  document.querySelectorAll(".knob-host").forEach(makeKnob);
  document.querySelectorAll(".fader-host").forEach(makeFader);
  document.querySelectorAll(".toggle-host").forEach(makeToggle);
  document.querySelectorAll(".momentary-host").forEach(makeMomentary);
  document.querySelectorAll(".xy-host").forEach(makeXY);
  document.querySelectorAll(".scope-host").forEach(makeScope);
  document.querySelectorAll(".spectrum-host").forEach(makeSpectrum);
  document.querySelectorAll(".meter-host").forEach(makeMeter);
  makeKeyboard(document.getElementById("kbd"));   // remove for an effect with no keyboard
});
</script>
</body>
</html>
)HTML";
    }

    // The house-style kit served three ways (starter preview, prompt reference,
    // seed of the editable "Standard UI" tab). Source of truth is the on-disk
    // ui/standard.html; the baked copy above is the fallback. Read once and cached
    // (this is called per generation to build the prompt, so avoid re-reading disk).
    inline juce::String defaultStandardUiHtml()
    {
        static const juce::String html = []
        {
            auto fromFile = vstai::webassets::readText ("standard.html");
            return fromFile.isNotEmpty() ? fromFile : juce::String (bakedStandardUiHtml());
        }();
        return html;
    }
}
