#!/usr/bin/env node
// =====================================================================
//  scaffold.mjs — generate spec.json, test-params.json and a themed
//  gui.html for a factory plugin from its def.mjs, then (optionally)
//  compile, test, GUI-check, pack and rebuild the gallery.
//
//  Usage: node factory/tools/scaffold.mjs <slug> [--pack]
//    factory/plugins/<slug>/def.mjs   (definition, see below)
//    factory/plugins/<slug>/assembly.ts
//
//  def.mjs default export:
//   { name, isInstrument, explanation, subtitle, category,
//     theme: { accent, accent2, bg1, bg2, panel, ink, dim },
//     params: [[name, min, max, default, step?, fmt?], ...]   (index = position)
//        fmt: undefined (percent, or integer if step) | "int" | "pct" | "semi"
//             | "cents" | ["A","B",...] (names for integer values from min)
//             | {hz:[lo,hi]} | {ms:[lo,hi]} | {unit:"x", scale:[a,b]}
//     groups: [{ title, items: [
//        {k:"knob", i:[idx...], labels?:[...]},
//        {k:"seg",  i:idx, label, opts:[...], presets?:[{idx:val,...},...]},  // integer choice (first opt = min); presets set other params on click; i:-1 = stateless preset buttons
//        {k:"tog",  i:idx, label, text},              // 0/1 button
//        {k:"bits", i:idx, label, opts:[...]}         // bit mask buttons
//     ]}],
//     viz: "bars" | "wave" | "none",  vizLabel, vizParam (index for wave richness),
//     kb: { base, n }                 // instruments: on-screen keyboard
//     testParams: { idx: value }      // engaged patch for the runner sweep
//     publishedAt }
// =====================================================================
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const slug = process.argv[2];
const doPack = process.argv.includes("--pack");
if (!slug) { console.error("usage: node scaffold.mjs <slug> [--pack]"); process.exit(2); }
const dir = join(root, "factory/plugins", slug);
const def = (await import(pathToFileURL(join(dir, "def.mjs")).href + "?t=" + Date.now())).default;

// ---------- spec.json / test-params.json ----------
const params = def.params.map((p, i) => {
  const o = { name: p[0], index: i, min: p[1], max: p[2], default: p[3] };
  if (p[4]) o.step = p[4];
  return o;
});
const spec = {
  name: def.name, isInstrument: !!def.isInstrument, explanation: def.explanation,
  assembly: `factory/plugins/${slug}/assembly.ts`, out: `factory/plugins/${slug}/x.vstai`,
  publishedAt: def.publishedAt || 1790000600000,
  theme: { accent: def.theme.accent, accent2: def.theme.accent2 },
  guiFile: `factory/plugins/${slug}/gui.html`, params,
};
writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2));
const tp = JSON.parse(JSON.stringify(params));
for (const [i, v] of Object.entries(def.testParams || {})) tp[+i].default = v;
writeFileSync(join(dir, "test-params.json"), JSON.stringify(tp, null, 2));

// ---------- gui.html ----------
const T = def.theme;
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
const meta = def.params.map((p, i) => ({ name: p[0], min: p[1], max: p[2], def: p[3], step: p[4] || 0, fmt: p[5] === undefined ? null : p[5] }));
const gui = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${def.name}</title>
<style>
:root{--a:${T.accent};--a2:${T.accent2};--pn:${T.panel};--ink:${T.ink};--dim:${T.dim};--ln:rgba(${rgb(T.accent)},.16)}
*{box-sizing:border-box}html,body{margin:0;background:radial-gradient(120% 80% at 50% 0%,${T.bg1},${T.bg2} 65%);color:var(--ink);font:12px/1.3 -apple-system,"Segoe UI",Helvetica,sans-serif;min-height:100%}
#app{max-width:1040px;margin:0 auto;padding:12px}
h1{margin:0 0 8px;font-size:18px;letter-spacing:.3em;font-weight:300;color:var(--a2)}h1 small{letter-spacing:.15em;color:var(--dim);font-size:10px;margin-left:10px}
canvas{width:100%;height:130px;display:block;background:rgba(0,0,0,.35);border:1px solid var(--ln);border-radius:8px}
.row{display:grid;gap:8px;margin-top:8px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.g{background:var(--pn);border:1px solid var(--ln);border-radius:10px;padding:8px 10px}
.g h2{margin:0 0 6px;font-size:9px;letter-spacing:.25em;color:var(--a);font-weight:600}
.ks{display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:6px 2px;margin-top:6px}
.tg{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:2px}.tg span{font-size:8px;letter-spacing:.2em;color:var(--dim);width:74px}
.tg button{background:rgba(0,0,0,.3);color:var(--dim);border:1px solid var(--ln);border-radius:5px;padding:5px 7px;font:600 9px/1 inherit;letter-spacing:.1em;cursor:pointer}
.tg button.on{background:var(--a);color:${T.bg2};border-color:var(--a)}
.k{display:flex;flex-direction:column;align-items:center;user-select:none;touch-action:none;cursor:ns-resize}
.k svg{width:40px;height:40px}.k .n{font-size:9px;color:var(--dim);text-align:center;margin-top:1px}.k .v{font-size:9px;color:var(--a2)}
#kb{position:relative;height:76px;margin-top:8px;user-select:none;touch-action:none}
.w{position:absolute;top:0;height:100%;background:linear-gradient(${T.ink},#b9b9b9);border:1px solid ${T.bg2};border-radius:0 0 4px 4px}.w.on{background:var(--a)}
.b{position:absolute;top:0;height:58%;background:linear-gradient(${T.panel},${T.bg2});border-radius:0 0 3px 3px;z-index:2}.b.on{background:var(--a)}
</style></head><body><div id="app"><h1>${def.name.toUpperCase()}<small>${(def.subtitle || "").toUpperCase()}</small></h1>${def.viz === "none" ? "" : '<canvas id="cv"></canvas>'}<div class="row" id="rest"></div>${def.isInstrument ? '<div id="kb"></div>' : ""}</div>
<script>
(function(){
var PARAMS=${JSON.stringify(meta)};
var GROUPS=${JSON.stringify(def.groups)};
var VIZ=${JSON.stringify(def.viz || "bars")},VIZP=${def.vizParam === undefined ? -1 : def.vizParam},VLAB=${JSON.stringify(def.vizLabel || "")};
var KB=${JSON.stringify(def.kb || { base: 36, n: 49 })},ISI=${def.isInstrument ? "true" : "false"};
var V={},R={},SV="http://www.w3.org/2000/svg",held={},disp=[],hasDisp=0,lastHit=0;for(var q=0;q<16;q++)disp[q]=0;
function host(f){var a=[].slice.call(arguments,1);if(window.vstai&&typeof window.vstai[f]==="function")window.vstai[f].apply(window.vstai,a)}
function set(i,v){V[i]=v;host("setParam",i,v);if(R[i])R[i]()}
var NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function fmt(i,v){var p=PARAMS[i],f=p.fmt;
if(f==="pct"||(f===null&&!p.step))return Math.round((v-p.min)/(p.max-p.min)*100)+"%";
if(f===null||f==="int")return String(Math.round(v));
if(f==="semi")return(v>0?"+":"")+(Math.round(v*10)/10)+" st";
if(f==="cents")return(v>0?"+":"")+Math.round(v)+" c";
if(f==="note"){var n=Math.round(v);return NOTES[((n%12)+12)%12]+(Math.floor(n/12)-1)}
if(Array.isArray(f))return f[Math.round(v)-p.min]||String(Math.round(v));
if(f.hz){var t=(v-p.min)/(p.max-p.min),hz=f.hz[0]*Math.pow(f.hz[1]/f.hz[0],t);return hz>=1000?(hz/1000).toFixed(1)+" kHz":Math.round(hz)+" Hz"}
if(f.ms){var t2=(v-p.min)/(p.max-p.min),ms=f.ms[0]+(f.ms[1]-f.ms[0])*t2;return ms>=1000?(ms/1000).toFixed(2)+" s":Math.round(ms)+" ms"}
if(f.unit){var t3=(v-p.min)/(p.max-p.min);return(f.scale[0]+(f.scale[1]-f.scale[0])*t3).toFixed(2)+f.unit}
return String(v)}
function knob(i,label){var p=PARAMS[i];V[i]=p.def;var w=document.createElement("div");w.className="k";
var s=document.createElementNS(SV,"svg");s.setAttribute("viewBox","0 0 44 44");
s.innerHTML='<circle cx="22" cy="22" r="19" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.12)"/><path class="tr" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="3" stroke-linecap="round"/><path class="ar" fill="none" stroke="${T.accent}" stroke-width="3" stroke-linecap="round"/><line class="nd" x1="22" y1="22" stroke="${T.accent2}" stroke-width="2" stroke-linecap="round"/>';
var n=document.createElement("div");n.className="n";n.textContent=label||p.name;var vv=document.createElement("div");vv.className="v";w.appendChild(s);w.appendChild(n);w.appendChild(vv);
function arc(a0,a1){var r=15,x0=22+r*Math.sin(a0),y0=22-r*Math.cos(a0),x1=22+r*Math.sin(a1),y1=22-r*Math.cos(a1);return"M"+x0+" "+y0+"A"+r+" "+r+" 0 "+((a1-a0)>Math.PI?1:0)+" 1 "+x1+" "+y1}
function norm(){return(V[i]-p.min)/(p.max-p.min)}
function paint(){var a0=-2.35,a1=2.35,t=a0+(a1-a0)*norm();s.querySelector(".tr").setAttribute("d",arc(a0,a1));s.querySelector(".ar").setAttribute("d",arc(a0,Math.max(t,a0+.001)));
var nd=s.querySelector(".nd");nd.setAttribute("x2",22+13*Math.sin(t));nd.setAttribute("y2",22-13*Math.cos(t));vv.textContent=fmt(i,V[i])}
R[i]=paint;paint();
var y0,n0,drag=false;
function put(nv){nv=Math.min(1,Math.max(0,nv));var v=p.min+nv*(p.max-p.min);if(p.step)v=Math.round(v/p.step)*p.step;set(i,v)}
function mv(e){if(!drag)return;var y=e.touches?e.touches[0].clientY:e.clientY;put(n0+(y0-y)/(e.shiftKey?600:160));if(e.cancelable)e.preventDefault()}
w.addEventListener("mousedown",function(e){drag=true;y0=e.clientY;n0=norm();e.preventDefault()});
w.addEventListener("touchstart",function(e){drag=true;y0=e.touches[0].clientY;n0=norm()},{passive:false});
window.addEventListener("mousemove",mv);window.addEventListener("touchmove",mv,{passive:false});window.addEventListener("mouseup",function(){drag=false});window.addEventListener("touchend",function(){drag=false});
w.addEventListener("dblclick",function(){set(i,p.def)});
w.addEventListener("wheel",function(e){var st=p.step?p.step:(p.max-p.min)*.02;set(i,Math.min(p.max,Math.max(p.min,V[i]-Math.sign(e.deltaY)*st)));e.preventDefault()},{passive:false});
return w}
function row(label){var r=document.createElement("div");r.className="tg";r.innerHTML="<span>"+label+"</span>";return r}
function bits(i,label,names){V[i]=PARAMS[i].def;var r=row(label),bs=[];names.forEach(function(nm,k){var b=document.createElement("button");b.textContent=nm;b.onclick=function(){set(i,Math.round(V[i])^(1<<k))};r.appendChild(b);bs.push(b)});R[i]=function(){bs.forEach(function(b,k){b.className=(Math.round(V[i])&(1<<k))?"on":""})};R[i]();return r}
function seg(i,label,names,pre){if(i<0){var r0=row(label);names.forEach(function(nm,k){var b=document.createElement("button");b.textContent=nm;b.onclick=function(){if(pre&&pre[k])for(var j in pre[k])set(+j,pre[k][j])};r0.appendChild(b)});return r0}V[i]=PARAMS[i].def;var r=row(label),bs=[],mn=PARAMS[i].min;names.forEach(function(nm,k){var b=document.createElement("button");b.textContent=nm;b.onclick=function(){set(i,mn+k);if(pre&&pre[k])for(var j in pre[k])set(+j,pre[k][j])};r.appendChild(b);bs.push(b)});R[i]=function(){bs.forEach(function(b,k){b.className=(Math.round(V[i])===mn+k)?"on":""})};R[i]();return r}
function tog(i,label,text){V[i]=PARAMS[i].def;var r=row(label),b=document.createElement("button");b.textContent=text||label;b.onclick=function(){set(i,V[i]>.5?0:1)};R[i]=function(){b.className=V[i]>.5?"on":""};R[i]();r.appendChild(b);return r}
var cv=document.getElementById("cv"),cx=cv?cv.getContext("2d"):null,sm=[];for(q=0;q<16;q++)sm[q]=0;
function draw(t){if(!cx)return;var dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;if(cv.width!==Math.round(W*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,W,H);cx.fillStyle="${T.dim}";cx.font="9px sans-serif";cx.fillText(VLAB,10,12);
var since=(t-lastHit)/1000,idle=hasDisp?0:1;
if(VIZ==="bars"){var n=16,bw=(W-20)/n;for(var i=0;i<n;i++){var tg=hasDisp?disp[i]:.2+.18*Math.sin(t/700+i*.6)*Math.sin(t/1300+i);sm[i]+=(tg-sm[i])*.35;var h=Math.max(2,sm[i]*(H-30)),x=10+i*bw+bw*.12,w=bw*.76;
var gr=cx.createLinearGradient(0,H-8,0,H-8-h);gr.addColorStop(0,"rgba(${rgb(T.accent)},.2)");gr.addColorStop(1,"rgba(${rgb(T.accent2)},.95)");cx.fillStyle=gr;cx.fillRect(x,H-8-h,w,h)}}
else{var lv=hasDisp?Math.min(1,disp[0]):(ISI?Math.exp(-since*1.2):.35+.2*Math.sin(t/900)),rich=VIZP>=0?(V[VIZP]-PARAMS[VIZP].min)/(PARAMS[VIZP].max-PARAMS[VIZP].min):.5,mid=H/2+6,amp=(H-40)/2*(.12+.88*lv);
sm[0]+=(lv-sm[0])*.3;cx.beginPath();cx.strokeStyle="${T.accent2}";cx.lineWidth=1.8;
for(var x2=0;x2<=W;x2+=3){var u=x2/W*6.2832*3,y=Math.sin(u+t/300)+rich*.6*Math.sin(2*u+t/220)+rich*.35*Math.sin(3*u+t/170)+rich*.2*Math.sin(5*u);y/=(1+rich*1.15);if(x2)cx.lineTo(x2,mid+y*amp);else cx.moveTo(x2,mid+y*amp)}
cx.stroke();cx.strokeStyle="rgba(${rgb(T.accent)},.18)";cx.beginPath();cx.moveTo(0,mid);cx.lineTo(W,mid);cx.stroke()}
requestAnimationFrame(draw)}
function on(n){if(held[n])return;held[n]=1;lastHit=performance.now();host("noteOn",n,.8);var e=KEYS[n];if(e)e.classList.add("on")}
function off(n){if(!held[n])return;delete held[n];host("noteOff",n);var e=KEYS[n];if(e)e.classList.remove("on")}
var KEYS=[];
function buildKb(){var kb=document.getElementById("kb");if(!kb)return;var BLK={1:1,3:1,6:1,8:1,10:1},wn=0,n;for(n=KB.base;n<KB.base+KB.n;n++)if(!BLK[n%12])wn++;
var wi=0;for(n=KB.base;n<KB.base+KB.n;n++){var e=document.createElement("div"),bk=BLK[n%12];e.className=bk?"b":"w";
if(bk){e.style.left=(wi/wn*100-.75)+"%";e.style.width="1.5%"}else{e.style.left=(wi/wn*100)+"%";e.style.width=(100/wn)+"%";wi++}
(function(n,e){e.addEventListener("mousedown",function(ev){on(n);ev.preventDefault();ev.stopPropagation()});e.addEventListener("mouseup",function(){off(n)});e.addEventListener("mouseleave",function(){off(n)});
e.addEventListener("touchstart",function(ev){on(n);ev.preventDefault()},{passive:false});e.addEventListener("touchend",function(ev){off(n);ev.preventDefault()})})(n,e);
KEYS[n]=e;kb.appendChild(e)}
var MAP="awsedftgyhujkolp;".split("");window.addEventListener("keydown",function(e){if(e.repeat)return;var i=MAP.indexOf(e.key);if(i>=0)on(60+i)});
window.addEventListener("keyup",function(e){var i=MAP.indexOf(e.key);if(i>=0)off(60+i)})}
function boot(){var rest=document.getElementById("rest");
GROUPS.forEach(function(g){var c=document.createElement("div");c.className="g";c.innerHTML="<h2>"+g.title+"</h2>";
g.items.forEach(function(it){
if(it.k==="knob"){var ks=document.createElement("div");ks.className="ks";it.i.forEach(function(i,j){ks.appendChild(knob(i,it.labels&&it.labels[j]))});c.appendChild(ks)}
else if(it.k==="seg")c.appendChild(seg(it.i,it.label,it.opts,it.presets));
else if(it.k==="tog")c.appendChild(tog(it.i,it.label,it.text));
else if(it.k==="bits")c.appendChild(bits(it.i,it.label,it.opts))});
rest.appendChild(c)});
PARAMS.forEach(function(p,i){if(!(i in V))V[i]=p.def;host("setParam",i,p.def)});
buildKb();
if(window.vstai&&window.vstai.onDisplay)window.vstai.onDisplay(function(d){hasDisp=1;for(var i=0;i<16;i++)disp[i]=d[i]||0});
if(window.vstai&&window.vstai.onParam)window.vstai.onParam(function(i,v){if(!(i in V))return;V[i]=+v;if(R[i])R[i]()});
requestAnimationFrame(draw)}
if(window.vstai&&typeof window.vstai.onReady==="function")window.vstai.onReady(boot);else boot();
})();
</script></body></html>`;
writeFileSync(join(dir, "gui.html"), gui);
console.log(`scaffold: wrote spec.json, test-params.json, gui.html for ${def.name} (${params.length} params)`);

if (!doPack) process.exit(0);

// ---------- compile, test, GUI check, pack, gallery ----------
const tmp = mkdtempSync(join(tmpdir(), "scaffold-"));
const wasm = join(tmp, "p.wasm");
const run = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }); } catch (e) { return (e.stdout || "") + (e.stderr || "") + "\n__FAILED__"; } };
const asc = run("node", ["compiler/asc-driver.mjs", `factory/plugins/${slug}/assembly.ts`, wasm]);
if (asc.includes("FAILURE") || asc.includes("__FAILED__") || !existsSync(wasm)) { console.log("COMPILE FAILED\n" + asc); process.exit(1); }
const runner = (pf, extra = []) => run("node", ["factory/tools/wasm-runner.mjs", wasm, "--params", join(dir, pf), ...(def.isInstrument ? ["--synth"] : []), ...extra]);
for (const pf of ["spec.json", "test-params.json"]) {
  const out = runner(pf);
  console.log(`-- runner (${pf})`);
  console.log(out.split("\n").filter((l) => /output|inert|VERDICT|FAIL/.test(l)).join("\n"));
}
const gc = run("node", ["factory/tools/gui-check.mjs", dir, "--shot", join(tmp, "shot.png")]);
console.log("-- gui-check:", /GUI CHECK: PASS/.test(gc) ? "PASS" : "FAIL\n" + gc);
console.log("screenshot:", join(tmp, "shot.png"));
const pk = run("node", ["factory/tools/pack-vstai.mjs", join(dir, "spec.json")]);
console.log(pk.trim().split("\n").slice(-2).join("\n"));
// gallery category
if (def.category) {
  const cp = join(root, "factory/gallery-categories.json");
  let s = readFileSync(cp, "utf8");
  if (!s.includes(`"${slug}"`)) {
    const anchor = s.lastIndexOf('"assign"');
    const open = s.indexOf("{", anchor);
    s = s.slice(0, open + 1) + `\n  "${slug}": "${def.category}",` + s.slice(open + 1);
    writeFileSync(cp, s);
    JSON.parse(s);
  }
}
console.log(run("node", ["scripts/build-gallery.mjs"]).trim().split("\n").slice(-3).join("\n"));
