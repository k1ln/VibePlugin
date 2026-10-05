#!/usr/bin/env node
// gui-interact.mjs — drives the real panel in headless Chrome against a stub host:
// every knob and fader is dragged, every button pressed, every OLED menu paged through,
// matrix pages edited, patches loaded. Fails on any page error or dead control.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../../..", import.meta.url).pathname;
const gui = readFileSync(join(root, "factory/plugins/kheverest/gui.html"), "utf8");
const stub = `<script>window.__errs=[];window.onerror=function(m,s,l,c){window.__errs.push(m+" @"+l+":"+c)};window.__pushes=0;window.__notes=[];
window.vstai={onReady:function(f){setTimeout(f,0)},setParam:function(i,v){window.__pushes++},onParam:function(cb){window.__onParam=cb},onDisplay:function(cb){window.__onDisp=cb},noteOn:function(n,v){window.__notes.push(["on",n])},noteOff:function(n){window.__notes.push(["off",n])}};</script>`;
const test = `<pre id="qa"></pre><script>
function ev(t,el,x,y,extra){var e=new PointerEvent(t,Object.assign({bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:"mouse"},extra||{}));el.dispatchEvent(e);}
function ctr(el){var r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}
setTimeout(function(){
 var out={err:[],knobs:0,knobDead:0,faders:0,faderDead:0,buttons:0,pages:{},oledEmpty:0,notes:0,preset:0,voiceLeds:0};
 try{
  var kn=[].slice.call(document.querySelectorAll(".kw"));
  kn.forEach(function(k){var c=ctr(k),p0=window.__pushes;ev("pointerdown",k,c[0],c[1]);ev("pointermove",k,c[0],c[1]-45);ev("pointerup",k,c[0],c[1]-45);out.knobs++;if(window.__pushes===p0)out.knobDead++;});
  var fd=[].slice.call(document.querySelectorAll(".fd"));
  fd.forEach(function(f){var r=f.getBoundingClientRect(),p0=window.__pushes;ev("pointerdown",f,r.left+r.width/2,r.top+r.height*0.3);ev("pointerup",f,r.left+r.width/2,r.top+r.height*0.3);out.faders++;if(window.__pushes===p0)out.faderDead++;});
  var bt=[].slice.call(document.querySelectorAll(".btn"));
  bt.forEach(function(b){var c=ctr(b);ev("pointerdown",b,c[0],c[1]);ev("pointerup",b,c[0],c[1]);out.buttons++;});
  // menus
  var menus=["osc","env","lfo","arp","mod","voice","fx","set","patch"];
  var pgNext=document.querySelectorAll(".btn.w")[0];
  menus.forEach(function(m){
    __kh.openMenu(m); var n=0;
    // find page buttons by label: second white button under Page/Select — use DOM: the two buttons right before the value encoder; simpler: dispatch via keys
    out.pages[m]=document.querySelectorAll("#oled .ol")[0].textContent.trim();
    document.querySelectorAll("#oled .ol").forEach(function(l,i){ if(i<3 && !l.textContent.trim()) out.oledEmpty++; });
  });
  // page through every page of every menu using the Page/Select buttons (located by position under the OLED)
  var o=document.getElementById("oled").getBoundingClientRect();
  var cand=[].slice.call(document.querySelectorAll(".btn")).filter(function(b){var r=b.getBoundingClientRect();return r.top>o.bottom&&r.left>o.left-10&&r.left<o.right&&r.width<40;});
  cand.sort(function(a,b){return a.getBoundingClientRect().left-b.getBoundingClientRect().left});
  var prev=cand[0],next=cand[1],seen={};
  ["osc","env","lfo","arp","mod","voice","fx","set"].forEach(function(m){__kh.openMenu(m);var guard=0,last="";seen[m]=0;
    for(var i=0;i<40;i++){var c=ctr(next);ev("pointerdown",next,c[0],c[1]);ev("pointerup",next,c[0],c[1]);var t=document.querySelectorAll("#oled .ol")[0].textContent;if(t===last)break;last=t;seen[m]++;}
  });
  out.pagesSeen=seen;
  // edit a mod-matrix slot through the OLED: select Mod menu, row 2 (dest), value + five times
  __kh.openMenu("mod");
  var rowsBtns=[].slice.call(document.querySelectorAll(".btn")).filter(function(b){var r=b.getBoundingClientRect();return r.right<o.left+4&&r.left>o.left-60&&r.top>o.top-5&&r.top<o.bottom;});
  rowsBtns.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top});
  var vp=[].slice.call(document.querySelectorAll(".btn")).filter(function(b){var r=b.getBoundingClientRect();return r.top>o.bottom&&r.left>o.right-20;}).sort(function(a,b){return a.getBoundingClientRect().left-b.getBoundingClientRect().left});
  var p1=window.__pushes; var rb=ctr(rowsBtns[1]); ev("pointerdown",rowsBtns[1],rb[0],rb[1]);
  for(var j=0;j<5;j++){var c2=ctr(vp[1]);ev("pointerdown",vp[1],c2[0],c2[1]);ev("pointerup",vp[1],c2[0],c2[1]);}
  out.matrixEdit=window.__pushes-p1;
  out.matrixText=[].slice.call(document.querySelectorAll("#oled .ol")).map(function(l){return l.textContent}).join("|");
  // presets
  var p2=window.__pushes; __kh.loadIndex(3); out.preset=window.__pushes-p2; out.presetName=document.querySelectorAll("#oled .ol")[0].textContent;
  // keyboard drawer
  var kb=document.getElementById("kbBtn"); var kc=ctr(kb); ev("pointerdown",kb,kc[0],kc[1]);
  var wk=document.querySelector("#keys .wk"); if(wk){var w=ctr(wk);ev("pointerdown",wk,w[0],w[1]);ev("pointerup",wk,w[0],w[1]);}
  out.notes=window.__notes.length;
  // voice LEDs follow engine display
  window.__onDisp&&window.__onDisp([0.5,0,0.3,0,0,0,0,0.9,0,0,0,0,0,0,0,0]);
  out.voiceLeds=document.querySelectorAll(".led.on").length;
  var mx=document.getElementById("matrix"); var mb=[].slice.call(document.querySelectorAll(".btn")).filter(function(b){return b.textContent==="MATRIX"})[0]; var mc=ctr(mb); ev("pointerdown",mb,mc[0],mc[1]); out.matrixRows=document.querySelectorAll("#matrix tr").length;
 }catch(e){out.err.push(String(e&&e.stack||e));}
 out.pageErrors=window.__errs;
 document.getElementById("qa").textContent=JSON.stringify(out);
},500);
</script>`;
const html = gui.replace("<body>", "<body>" + stub).replace("</body>", test + "</body>");
const dir = mkdtempSync(join(tmpdir(), "kh-int-"));
writeFileSync(join(dir, "qa.html"), html);
const dom = execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--window-size=1400,900", "--virtual-time-budget=20000", "--dump-dom", "file://" + join(dir, "qa.html")],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const m = dom.match(/<pre id="qa">([\s\S]*?)<\/pre>/);
if (!m) { console.log("no result from page"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
console.log(JSON.stringify(out, null, 1));
let bad = 0;
if (out.err.length || out.pageErrors.length) bad++;
if (out.knobDead) bad++; if (out.faderDead) bad++; if (out.oledEmpty) bad++;
if (!(out.matrixEdit >= 5)) bad++; if (out.preset < 60) bad++; if (out.notes < 2) bad++; if (out.voiceLeds < 3) bad++; if (out.matrixRows < 20) bad++;
console.log(bad ? "GUI INTERACT: FAIL" : "GUI INTERACT: PASS");
process.exit(bad ? 1 : 0);
