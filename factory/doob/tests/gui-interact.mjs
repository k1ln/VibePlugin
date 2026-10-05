#!/usr/bin/env node
// gui-interact.mjs — drives the real panel in headless Chrome against a stub host: every knob dragged, every rotary / rocker /
// wheel used, the keyboard, the settings dialog, every factory sound loaded, the display feed and the host-automation restore.
// Fails on any page error or dead control, or any parameter with no control on the panel.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../../..", import.meta.url).pathname;
const gui = readFileSync(join(root, "factory/plugins/doob/gui.html"), "utf8");
const stub = `<script>window.__errs=[];window.onerror=function(m,s,l,c){window.__errs.push(m+" @"+l+":"+c)};window.__pushes=0;window.__notes=[];window.__sets=[];
window.vstai={onReady:function(f){setTimeout(f,0)},setParam:function(i,v){window.__pushes++;window.__sets.push([i,v])},onParam:function(cb){window.__onParam=cb},onDisplay:function(cb){window.__onDisp=cb},noteOn:function(n,v){window.__notes.push(["on",n,v])},noteOff:function(n){window.__notes.push(["off",n])}};</script>`;
const test = `<pre id="qa"></pre><script>
function ev(t,el,x,y,extra){var e=new PointerEvent(t,Object.assign({bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:"mouse",button:0,buttons:1},extra||{}));el.dispatchEvent(e);}
function ctr(el){var r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}
function click(el){var c=ctr(el);ev("pointerdown",el,c[0],c[1]);ev("pointerup",el,c[0],c[1]);}
setTimeout(function(){
 var out={err:[],knobs:0,knobDead:[],ro:0,roDead:[],rk:0,rkDead:[],whl:0,whlDead:0,presets:0,presetFail:[],notes:0,status:"",glob:0,unbound:[],kbd:"",rocked:{},cons:[]};
 try{
  var K=__doob;
  [].slice.call(document.querySelectorAll(".kn")).forEach(function(k){var c=ctr(k),p0=window.__pushes;ev("pointerdown",k,c[0],c[1]);ev("pointermove",k,c[0],c[1]-60);ev("pointermove",k,c[0],c[1]+90);ev("pointerup",k,c[0],c[1]+90);ev("dblclick",k,c[0],c[1]);out.knobs++;if(window.__pushes===p0)out.knobDead.push(k.getBoundingClientRect().left|0);});
  [].slice.call(document.querySelectorAll(".ro")).forEach(function(r){var b=r.getBoundingClientRect(),p0=window.__pushes,x=b.left+b.width*0.8,y=b.top+b.height*0.5;ev("pointerdown",r,x,y);ev("pointerup",r,x,y);ev("pointerdown",r,b.left+b.width*0.2,y);ev("pointerup",r,b.left+b.width*0.2,y);ev("pointerdown",r,x,y);ev("pointermove",r,x+60,y);ev("pointerup",r,x+60,y);out.ro++;if(window.__pushes===p0)out.roDead.push(b.left|0);});
  [].slice.call(document.querySelectorAll(".rk")).forEach(function(t){var p0=window.__pushes;click(t);click(t);out.rk++;if(window.__pushes===p0)out.rkDead.push(t.getBoundingClientRect().left|0);});
  [].slice.call(document.querySelectorAll(".whl")).forEach(function(w){var r=w.getBoundingClientRect(),p0=window.__pushes;ev("pointerdown",w,r.left+r.width/2,r.top+r.height*0.2);ev("pointerup",w,r.left+r.width/2,r.top+r.height*0.2);out.whl++;if(window.__pushes===p0)out.whlDead++;});
  // exact-value checks through the controls
  K.applyPatch({});
  var ro1=document.querySelectorAll(".ro")[0], b1=ro1.getBoundingClientRect(); // osc 1 range: click right half steps up
  var r0=K.V.O1_RANGE; ev("pointerdown",ro1,b1.left+b1.width*0.8,b1.top+b1.height*0.5); ev("pointerup",ro1,b1.left+b1.width*0.8,b1.top+b1.height*0.5); out.rangeStep=(K.V.O1_RANGE===r0+1);
  var rks=[].slice.call(document.querySelectorAll(".rk")), changed={}; K.applyPatch({});
  rks.forEach(function(t){var before=K.snapshot(); click(t); var after=K.snapshot(); for(var k in after) if(after[k]!==before[k]) changed[k]=1;});
  out.rockKeys=Object.keys(changed).sort().join(",");
  // wheels: pitch spring returns to 0
  var pw=document.querySelectorAll(".whl")[0], wr=pw.getBoundingClientRect(); ev("pointerdown",pw,wr.left+wr.width/2,wr.top+5); out.pitchHeld=K.V.PITCHW; ev("pointerup",pw,wr.left+wr.width/2,wr.top+5);
  // every factory sound loads and the selector follows
  K.DATA.presets.forEach(function(pr,i){K.loadIndex(i);out.presets++;var sel=document.getElementById("sheet").querySelector("select").value; if(+sel!==i)out.presetFail.push(pr.name+" select");
    for (var k in pr.set){var p=K.DATA.params.filter(function(q){return q.key===k})[0]; var want=pr.set[k]; var got=K.V[k]; var tol=p.direct?1e-9:0.5; if(!p.direct) want=Math.round(want); if(Math.abs(got-want)>tol)out.presetFail.push(pr.name+" "+k+" "+got+" vs "+want);} });
  K.loadIndex(0);
  // keyboard
  var wk=document.querySelectorAll(".wk"), bk=document.querySelectorAll(".bk"); out.kbd=wk.length+"w+"+bk.length+"b";
  click(wk[0]); click(bk[0]); click(wk[wk.length-1]);
  out.notes=window.__notes.filter(function(e){return e[0]==="on"}).map(function(e){return e[1]});
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"a"})); window.dispatchEvent(new KeyboardEvent("keyup",{key:"a"})); out.typing=window.__notes.slice(-2).map(function(e){return e.join(":")}).join(",");
  // settings dialog
  var gb=[].slice.call(document.querySelectorAll("#sheet .hbtn")).filter(function(x){return /SETTINGS/.test(x.textContent)})[0]; gb.click(); out.glob=document.querySelectorAll("#glob select").length;
  var sel0=document.querySelector("#glob select"); sel0.value="1"; sel0.dispatchEvent(new Event("change")); out.dlgKey=K.V.KEY_PRI; document.getElementById("glob").hidden=true;
  out.unbound=K.unbound();
  // display → lamp / gate LED / status
  window.__onDisp&&window.__onDisp([1,1,0.5,1,0.0625,0.25,3,0,0,0,0,0,0,0,0,0]);
  out.ledsOn=document.querySelectorAll(".led.on").length; out.status=document.getElementById("status").textContent;
  // host automation restore: every slot decodes
  K.applyPatch({}); for(var s=0;s<K.NSLOT;s++) window.__onParam(s, 0); out.restored=1;
 }catch(e){out.err.push(String(e&&e.stack||e));}
 out.pageErrors=window.__errs; out.pushes=window.__pushes;
 document.getElementById("qa").textContent=JSON.stringify(out);
},600);
</script>`;
const html = gui.replace("<body>", "<body>" + stub).replace("</body>", test + "</body>");
const dir = mkdtempSync(join(tmpdir(), "db-int-"));
writeFileSync(join(dir, "qa.html"), html);
const dom = execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--window-size=1560,900", "--virtual-time-budget=30000", "--dump-dom", "file://" + join(dir, "qa.html")],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const m = dom.match(/<pre id="qa">([\s\S]*?)<\/pre>/);
if (!m) { console.log("no result from page"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
if (process.env.VERBOSE) console.log(JSON.stringify(out, null, 1));
let bad = 0; const need = (c, msg) => { if (!c) { bad++; console.log("  ✗ " + msg); } };
need(!out.err.length && !out.pageErrors.length, "page errors " + JSON.stringify(out.err.concat(out.pageErrors)));
need(out.knobs === 22 && !out.knobDead.length, `knobs live (${out.knobs}, dead: ${out.knobDead})`);
need(out.ro === 6 && !out.roDead.length, `rotary selectors (${out.ro}, dead ${out.roDead})`);
need(out.rk === 17 && !out.rkDead.length, `rockers (${out.rk}, dead ${out.rkDead})`);
need(out.whl === 2 && !out.whlDead, "wheels");
need(out.rangeStep, "clicking the right half of a rotary steps it up");
need(out.rockKeys.split(",").length === 17 && /GLIDE_ON/.test(out.rockKeys) && /DECAY_ON/.test(out.rockKeys), "each of the 17 rockers flips its own parameter: " + out.rockKeys);
need(out.pitchHeld > 0.9, "pitch wheel drag " + out.pitchHeld);
need(out.presets === 35 && !out.presetFail.length, "factory sounds load into the panel " + out.presetFail.slice(0, 3));
need(out.kbd === "26w+18b", "44 keys: " + out.kbd);
need(out.notes.join() === "41,42,84", "keyboard notes F1, F#1, C6(84): " + out.notes);
need(/on:60|off:60/.test(out.typing), "computer-keyboard typing " + out.typing);
need(out.glob >= 8 && out.dlgKey === 1, "settings dialog " + out.glob + " selects, KEY_PRI " + out.dlgKey);
need(!out.unbound.length, "parameters with no control: " + out.unbound);
need(out.ledsOn >= 2 && /gate/.test(out.status) && /OVERLOAD/.test(out.status), "display feed: " + out.status);
console.log(bad ? "GUI INTERACT: FAIL" : "GUI INTERACT: PASS");
process.exit(bad ? 1 : 0);
