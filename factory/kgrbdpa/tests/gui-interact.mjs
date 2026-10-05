#!/usr/bin/env node
// gui-interact.mjs — drives the real panel in headless Chrome against a stub host: every knob dragged, every selector /
// toggle / button / slider / wheel used, every jack cabled with REAL pointer drags (output → input, input → output, lift
// and move, right-click unplug, mult jacks), the transport / tap-tempo / record-marker buttons, the keyboard, the
// global dialog and every patch sheet loaded. Fails on any page error or dead control.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("../../..", import.meta.url).pathname;
const gui = readFileSync(join(root, "factory/plugins/kgrbdpa/gui.html"), "utf8");
const stub = `<script>window.__errs=[];window.onerror=function(m,s,l,c){window.__errs.push(m+" @"+l+":"+c)};window.__pushes=0;window.__notes=[];window.__sets=[];
window.vstai={onReady:function(f){setTimeout(f,0)},setParam:function(i,v){window.__pushes++;window.__sets.push([i,v])},onParam:function(cb){window.__onParam=cb},onDisplay:function(cb){window.__onDisp=cb},noteOn:function(n,v){window.__notes.push(["on",n,v])},noteOff:function(n){window.__notes.push(["off",n])}};</script>`;
const test = `<pre id="qa"></pre><script>
function ev(t,el,x,y,extra){var e=new PointerEvent(t,Object.assign({bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:"mouse",button:0,buttons:1},extra||{}));el.dispatchEvent(e);}
function ctr(el){var r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}
function click(el){var c=ctr(el);ev("pointerdown",el,c[0],c[1]);ev("pointerup",el,c[0],c[1]);}
function drag(from,to){var a=ctr(from),b=ctr(to);ev("pointerdown",from,a[0],a[1]);ev("pointermove",from,(a[0]+b[0])/2,(a[1]+b[1])/2);ev("pointermove",from,b[0],b[1]);ev("pointerup",from,b[0],b[1]);}
setTimeout(function(){
 var out={err:[],knobs:0,knobDead:[],ro:0,roDead:[],tg:0,tgDead:[],sw:0,swDead:0,fd:0,fdDead:0,whl:0,whlDead:0,jacks:{},cableFail:[],presets:0,presetFail:[],notes:0,leds:{},status:"",glob:0,btn:{}};
 try{
  var K=__kg;
  // knobs
  [].slice.call(document.querySelectorAll(".kn")).forEach(function(k){var c=ctr(k),p0=window.__pushes;ev("pointerdown",k,c[0],c[1]);ev("pointermove",k,c[0],c[1]-60);ev("pointermove",k,c[0],c[1]+90);ev("pointerup",k,c[0],c[1]+90);ev("dblclick",k,c[0],c[1]);out.knobs++;if(window.__pushes===p0)out.knobDead.push(k.getBoundingClientRect().left|0);});
  // 4-position rotary selectors
  [].slice.call(document.querySelectorAll(".ro")).forEach(function(r){var b=r.getBoundingClientRect(),p0=window.__pushes;ev("pointerdown",r,b.left+b.width*0.8,b.top+b.height*0.5);ev("pointerup",r,b.left+b.width*0.8,b.top+b.height*0.5);ev("pointerdown",r,b.left+b.width*0.2,b.top+b.height*0.5);out.ro++;if(window.__pushes===p0)out.roDead.push(b.left|0);});
  // 3-position toggles
  [].slice.call(document.querySelectorAll(".tg")).forEach(function(t){var p0=window.__pushes;click(t);click(t);out.tg++;if(window.__pushes===p0)out.tgDead.push(t.getBoundingClientRect().left|0);});
  // latching square buttons, faders, wheels
  [].slice.call(document.querySelectorAll(".sw")).forEach(function(s){var p0=window.__pushes;click(s);out.sw++;if(window.__pushes===p0)out.swDead++;});
  [].slice.call(document.querySelectorAll(".fd")).forEach(function(f){var r=f.getBoundingClientRect(),p0=window.__pushes;ev("pointerdown",f,r.left+r.width/2,r.top+r.height*0.3);ev("pointerup",f,r.left+r.width/2,r.top+r.height*0.3);out.fd++;if(window.__pushes===p0)out.fdDead++;});
  [].slice.call(document.querySelectorAll(".whl")).forEach(function(w){var r=w.getBoundingClientRect(),p0=window.__pushes;ev("pointerdown",w,r.left+r.width/2,r.top+r.height*0.2);ev("pointerup",w,r.left+r.width/2,r.top+r.height*0.2);out.whl++;if(window.__pushes===p0)out.whlDead++;});
  // chips (legato / gated / glide type)
  [].slice.call(document.querySelectorAll("#plate > .hbtn")).forEach(function(h){var p0=window.__pushes;click(h);out.btn[h.textContent]=window.__pushes-p0;});
  // ---- cables: real drags between every output and every input
  var outs=Object.keys(K.JACKS).filter(function(k){return K.JACKS[k].kind==="out"}), ins=Object.keys(K.JACKS).filter(function(k){return K.JACKS[k].kind==="in"});
  K.applyPatch({});
  var okPairs=0;
  ins.forEach(function(iid,n){
    var oid=outs[n%outs.length], O=K.JACKS[oid].el, I=K.JACKS[iid].el, key=iid.slice(2), srcKey=oid.slice(2);
    drag(O,I);
    var si=K.DATA.src.findIndex(function(s){return s[0]===srcKey})+1;
    if(K.R["PB_"+key]!==si){out.cableFail.push("drag "+oid+" -> "+iid+" got "+K.R["PB_"+key]+" want "+si);} else okPairs++;
  });
  out.cablesDragged=okPairs+"/"+ins.length;
  out.cableCount=K.cables().length;
  // lift a cable from an input and drop it on another input (move)
  var a=ins[0], b=ins[3]; var before=K.R["PB_"+a.slice(2)]; drag(K.JACKS[a].el,K.JACKS[b].el);
  out.moved=(K.R["PB_"+a.slice(2)]===0 && K.R["PB_"+b.slice(2)]===before);
  // lift and drop on empty space → removed
  var c=ins[5]; var had=K.R["PB_"+c.slice(2)]; var cc=ctr(K.JACKS[c].el); ev("pointerdown",K.JACKS[c].el,cc[0],cc[1]);ev("pointermove",K.JACKS[c].el,cc[0]+200,cc[1]+300);ev("pointerup",K.JACKS[c].el,5,5);
  out.removed=(had>0 && K.R["PB_"+c.slice(2)]===0);
  // reverse drag: input → output
  K.applyPatch({}); drag(K.JACKS["i:F_CUT"].el, K.JACKS["o:LFO"].el); out.reverse=(K.R.PB_F_CUT===K.DATA.src.findIndex(function(s){return s[0]==="LFO"})+1);
  // right-click unplug
  var ic=ctr(K.JACKS["i:F_CUT"].el); ev("pointerdown",K.JACKS["i:F_CUT"].el,ic[0],ic[1],{button:2}); out.unplug=(K.R.PB_F_CUT===0);
  // mult jacks: two cables into the mult, one out of it
  K.applyPatch({}); drag(K.JACKS["o:O1"].el,K.JACKS["m:0"].el); drag(K.JACKS["o:O2"].el,K.JACKS["m:3"].el); drag(K.JACKS["m:2"].el,K.JACKS["i:F_IN"].el);
  out.mult=[K.R.PB_MULT_A,K.R.PB_MULT_B,K.R.PB_F_IN];
  // ---- every patch sheet loads, cables match
  K.DATA.presets.forEach(function(pr,i){K.loadIndex(i);out.presets++;var nz=0;K.DATA.dst.forEach(function(d){if(K.R["PB_"+d[0]])nz++});if(K.cables().length!==nz)out.presetFail.push(pr.name+" cables "+K.cables().length+" vs "+nz);
    var wantTitle=document.getElementById("sheet").querySelector("select").value; if(+wantTitle!==i)out.presetFail.push(pr.name+" select");});
  K.loadIndex(0);
  // ---- LHC buttons
  var b=function(txt){return [].slice.call(document.querySelectorAll(".bt")).filter(function(e){return true})};
  var bts=[].slice.call(document.querySelectorAll(".bt")); out.lhcButtons=bts.length;
  var shift=bts[0],down=bts[1],up=bts[2],play=bts[3],hold=bts[4],tap=bts[5];
  var s0=K.V.PLAY; click(play); out.play=(K.V.PLAY!==s0); click(hold); out.hold=(K.V.HOLD===1);
  click(shift); click(up); out.octUp=(K.V.KB_OCT===1); click(shift); click(down); click(down); out.octDown=(K.V.KB_OCT===0);
  var t0=0; [0,500,1000,1500].forEach(function(){});
  var now=performance.now; var tt=[0,500,1000,1500],ti=0; performance.now=function(){return tt[Math.min(ti,3)]};
  tt.forEach(function(){click(tap);ti++;}); performance.now=now; out.tapBpm=K.V.TAP_BPM;
  K.set("ARP_MODE",2); var n0=window.__notes.length; click(play); click(hold); click(tap); out.markers=window.__notes.slice(n0).filter(function(e){return e[1]<0}).map(function(e){return e[1]}).join(",");
  K.set("ARP_MODE",0);
  // ---- keyboard
  var wk=document.querySelectorAll(".wk"), bk=document.querySelectorAll(".bk"); out.keys=wk.length+"w+"+bk.length+"b";
  click(wk[0]); click(bk[0]); out.notes=window.__notes.filter(function(e){return e[0]==="on"&&e[1]>=41}).length;
  out.firstNote=window.__notes.filter(function(e){return e[0]==="on"&&e[1]>=41})[0];
  // ---- global dialog
  var gl=[].slice.call(document.querySelectorAll("#sheet .hbtn")).filter(function(x){return /GLOBAL/.test(x.textContent)})[0]; gl.click(); out.glob=document.querySelectorAll("#glob select").length; document.getElementById("glob").hidden=true;
  // ---- display → LEDs / status
  window.__onDisp&&window.__onDisp([1,1,0.5,1,0.0625,0.0625,3,1,0,0,0,0,0,0,0,0]);
  out.leds={on:document.querySelectorAll(".led.on").length}; out.status=document.getElementById("status").textContent;
  // ---- host automation restore: every slot decodes
  K.applyPatch({}); for(var s=0;s<K.NSLOT;s++) window.__onParam(s, 0); out.restored=1;
 }catch(e){out.err.push(String(e&&e.stack||e));}
 out.pageErrors=window.__errs; out.pushes=window.__pushes;
 document.getElementById("qa").textContent=JSON.stringify(out);
},600);
</script>`;
const html = gui.replace("<body>", "<body>" + stub).replace("</body>", test + "</body>");
const dir = mkdtempSync(join(tmpdir(), "kg-int-"));
writeFileSync(join(dir, "qa.html"), html);
const dom = execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--window-size=1560,900", "--virtual-time-budget=30000", "--dump-dom", "file://" + join(dir, "qa.html")],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const m = dom.match(/<pre id="qa">([\s\S]*?)<\/pre>/);
if (!m) { console.log("no result from page"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
console.log(JSON.stringify(out, null, 1));
let bad = 0; const need = (c, msg) => { if (!c) { bad++; console.log("  ✗ " + msg); } };
need(!out.err.length && !out.pageErrors.length, "page errors");
need(out.knobs === 24 && !out.knobDead.length, `knobs live (${out.knobs}, dead: ${out.knobDead})`);
need(out.ro === 5 && !out.roDead.length, `rotary selectors (${out.ro})`);
need(out.tg === 5 && !out.tgDead.length, `toggles (${out.tg})`);
need(out.sw === 1 && !out.swDead, "SYNC button"); need(out.fd === 1 && !out.fdDead, "sustain slider"); need(out.whl === 2 && !out.whlDead, "wheels");
need(!out.cableFail.length && out.cablesDragged === "21/21", "cable drags " + out.cablesDragged + " " + out.cableFail.slice(0, 3));
need(out.moved && out.removed && out.reverse && out.unplug, `lift/move/remove/reverse/unplug (${out.moved} ${out.removed} ${out.reverse} ${out.unplug})`);
need(out.mult && out.mult[0] > 0 && out.mult[1] > 0 && out.mult[2] > 0, "mult jacks " + JSON.stringify(out.mult));
need(out.presets >= 18 && !out.presetFail.length, "patch sheets " + out.presetFail.slice(0, 3));
need(out.play && out.hold && out.octUp && out.octDown, `LHC buttons (play ${out.play} hold ${out.hold} oct+ ${out.octUp} oct- ${out.octDown})`);
need(out.tapBpm === 120, "tap tempo 4 taps 500 ms apart → 120 BPM, got " + out.tapBpm);
need(out.markers === "-3,-2,-4", "REC buttons send TIE/REST/ACCENT markers: " + out.markers);
need(out.notes >= 2 && out.firstNote && out.firstNote[1] === 41, "keyboard notes " + JSON.stringify(out.firstNote));
need(out.glob >= 8, "global dialog selects " + out.glob);
need(out.leds.on >= 3 && /SEQ|REC|ARP/.test(out.status), "display LEDs / status: " + out.status);
console.log(bad ? "GUI INTERACT: FAIL" : "GUI INTERACT: PASS");
process.exit(bad ? 1 : 0);
