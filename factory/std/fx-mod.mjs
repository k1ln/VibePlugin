// Std modulation effects.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const MIX = (d = 0.5) => ["Mix", 0, 1, d];
// equal-power dry/wet gains from Mix
const mixGains = `const dryG: f32 = f32(Mathf.cos(mix * 1.5707963)); const wetG: f32 = f32(Mathf.sin(mix * 1.5707963));`;

// ---------------- Chorus ----------------
const chorus = {
  slug: "std-chorus", name: "StdChorus", theme: "Modulation", subtitle: "Multi-voice stereo chorus",
  explanation: "A classic chorus: one to four short, slowly modulated delay lines are mixed with the dry signal, so the pitch of each voice drifts a few cents sharp and flat and the sound thickens into a small ensemble. Rate sets the speed of the modulation, Depth how far each voice wanders, Delay the centre delay time, Voices how many copies are stacked (their LFOs are spread evenly around the cycle), and Spread offsets the right channel's LFO against the left for a wide, swirling image. Tone smooths the wet signal's top end.",
  params: [["Rate", 0, 1, 0.45, 0, { exp: [0.05, 5], unit: " Hz" }], ["Depth", 0, 1, 0.5], ["Delay", 0, 1, 0.4, 0, { ms: [5, 30] }], ["Voices", 1, 4, 3, 1, "int"],
    ["Spread", 0, 1, 0.8], ["Tone", 0, 1, 0.85, 0, { hz: [1000, 16000] }], MIX(0.5), OUT],
  groups: [
    { title: "MOTION", items: [{ k: "seg", i: 3, label: "VOICES", opts: ["1", "2", "3", "4"] }, { k: "knob", i: [0, 1, 2, 4] }] },
    { title: "TONE", items: [{ k: "knob", i: [5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "VOICE DELAY TIMES (ms)",
  vizCode: `frame(cx,r);
var nV=Math.round($Voices),base=5+$Delay*25,md=$Depth*0.45*base,rate=0.05*Math.pow(100,$Rate),ph=t*rate/1000;
for(var v=0;v<nV;v++){cx.beginPath();cx.strokeStyle="rgba(255,255,255,"+(0.45+0.5*(1-v/nV))+")";cx.lineWidth=2;
for(var i=0;i<=r[2];i+=2){var d=base+md*Math.sin((i/r[2]*2+ph+v/nV)*Math.PI*2),py=r[1]+r[3]-(d/45)*r[3];i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke()}
cx.lineWidth=1;cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText(base.toFixed(1)+" ms centre, +/-"+md.toFixed(1)+" ms",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const cb: StaticArray<f32> = new StaticArray<f32>(2 * 8192); let cw: i32 = 0; let cph: f32 = 0.0;
const ctz: StaticArray<f32> = new StaticArray<f32>(2);`,
  init: `for (let i = 0; i < 2 * 8192; i++) cb[i] = 0.0; cw = 0; cph = 0.0; ctz[0] = 0.0; ctz[1] = 0.0;`,
  block: `
  const inc: f32 = expMap($Rate, 0.05, 5.0) / sr;
  const baseMs: f32 = 5.0 + $Delay * 25.0; const baseS: f32 = baseMs * 0.001 * sr; const mdS: f32 = $Depth * 0.45 * baseS;
  const nV: i32 = i32($Voices + 0.5); const norm: f32 = 1.0 / f32(Mathf.sqrt(f32(nV)));
  const sp: f32 = $Spread * 0.5;
  const toneK: f32 = opK(expMap($Tone, 1000.0, 16000.0));
  const mix: f32 = $Mix; ${mixGains} const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  cph += inc; if (cph >= 1.0) cph -= 1.0;
  let wl: f32 = 0.0; let wr: f32 = 0.0;
  for (let v: i32 = 0; v < nV; v++) {
    const pv: f32 = cph + f32(v) / f32(nV);
    wl += dlr(cb, 0, 8191, cw, baseS + mdS * f32(Mathf.sin(pv * TWO_PI)));
    wr += dlr(cb, 8192, 8191, cw, baseS + mdS * f32(Mathf.sin((pv + sp) * TWO_PI)));
  }
  cb[cw] = xl; cb[8192 + cw] = xr; cw = (cw + 1) & 8191;
  ctz[0] += toneK * (wl * norm - ctz[0]); ctz[1] += toneK * (wr * norm - ctz[1]);
  yl = softLim((xl * dryG + ctz[0] * wetG) * outG); yr = softLim((xr * dryG + ctz[1] * wetG) * outG);`,
  testParams: {},
};

// ---------------- Flanger ----------------
const combViz = `function comb(f,d,fb){var w=2*Math.PI*f/48000,ca=Math.cos(w*d),sa=-Math.sin(w*d),dr=1-fb*ca,di=-fb*sa,m=(dr*dr+di*di)||1e-9;var wr=(ca*dr+sa*di)/m,wi=(sa*dr-ca*di)/m;var re=1+wr,im=wi;return 10*Math.log10(re*re+im*im+1e-9)}`;
const flanger = {
  slug: "std-flanger", name: "StdFlanger", theme: "Modulation", subtitle: "Jet-sweep flanger",
  explanation: "A flanger: the signal is mixed with a very short, swept copy of itself, which carves a comb of notches into the spectrum that sweeps up and down for the classic jet-engine whoosh. Manual sets the centre delay (short is bright and nasal, long is hollow), Depth how far the sweep travels (it moves exponentially, so it sounds even), and Rate its speed. Feedback, positive or negative, sharpens the notches into resonant peaks; negative feedback gives the hollow, metallic through-zero-ish flavour. Spread offsets the right channel's sweep from the left. The picture shows the live comb response.",
  params: [["Rate", 0, 1, 0.35, 0, { exp: [0.02, 10], unit: " Hz" }], ["Depth", 0, 1, 0.7], ["Manual", 0, 1, 0.45, 0, { exp: [0.1, 5], unit: " ms" }], ["Feedback", -0.95, 0.95, 0.5],
    ["Spread", 0, 1, 0.5], MIX(0.5), OUT],
  groups: [
    { title: "SWEEP", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "RESONANCE", items: [{ k: "knob", i: [3, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [5, 6] }] },
  ],
  vizLabel: "COMB RESPONSE (LIVE SWEEP)",
  vizCode: `${combViz}
frame(cx,r);
var rate=0.02*Math.pow(500,$Rate),man=0.1*Math.pow(50,$Manual),dep=$Depth,d=man*Math.pow(2,dep*3*Math.sin(t*rate/1000*Math.PI*2))*0.001*48000,fb=$Feedback;
plot(cx,r,function(f){return comb(f,d,fb)},20,20000,-30,18,true);`,
  globals: `
const fbuf: StaticArray<f32> = new StaticArray<f32>(2 * 8192); let fw: i32 = 0; let fph: f32 = 0.0;`,
  init: `for (let i = 0; i < 2 * 8192; i++) fbuf[i] = 0.0; fw = 0; fph = 0.0;`,
  block: `
  const inc: f32 = expMap($Rate, 0.02, 10.0) / sr; const manS: f32 = expMap($Manual, 0.1, 5.0) * 0.001 * sr; const dep3: f32 = $Depth * 3.0;
  const fbk: f32 = $Feedback; const sp: f32 = $Spread * 0.25;
  const mix: f32 = $Mix; ${mixGains} const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  fph += inc; if (fph >= 1.0) fph -= 1.0;
  const dL: f32 = clampf(manS * f32(Mathf.pow(2.0, dep3 * f32(Mathf.sin(fph * TWO_PI)))), 1.5, 8000.0);
  const dR: f32 = clampf(manS * f32(Mathf.pow(2.0, dep3 * f32(Mathf.sin((fph + sp) * TWO_PI)))), 1.5, 8000.0);
  const wl: f32 = dlr(fbuf, 0, 8191, fw, dL); const wr: f32 = dlr(fbuf, 8192, 8191, fw, dR);
  fbuf[fw] = fz(softLim(xl + fbk * wl)); fbuf[8192 + fw] = fz(softLim(xr + fbk * wr)); fw = (fw + 1) & 8191;
  yl = softLim((xl * dryG + wl * wetG) * outG); yr = softLim((xr * dryG + wr * wetG) * outG);`,
  testParams: {},
};

// ---------------- Phaser ----------------
const phaser = {
  slug: "std-phaser", name: "StdPhaser", theme: "Modulation", subtitle: "2 to 12 stage phaser",
  explanation: "A phaser: the signal passes through a cascade of first-order allpass filters whose corner frequency is swept by an LFO, and the result is mixed with the dry signal. Every pair of allpass stages adds one notch to the response, so 2 stages is a single gentle swoosh and 12 is a deep, complex sweep. Center sets where the sweep sits, Depth how many octaves it moves, Feedback (positive or negative) turns the notches into resonant peaks, and Spread offsets the right channel's LFO from the left. The picture shows the live notch pattern.",
  params: [["Stages", 0, 5, 1, 1, ["2", "4", "6", "8", "10", "12"]], ["Rate", 0, 1, 0.4, 0, { exp: [0.02, 10], unit: " Hz" }], ["Depth", 0, 1, 0.7], ["Center", 0, 1, 0.5, 0, { hz: [100, 5000] }],
    ["Feedback", -0.9, 0.9, 0.4], ["Spread", 0, 1, 0.4], MIX(0.5), OUT],
  groups: [
    { title: "SWEEP", items: [{ k: "seg", i: 0, label: "STAGES", opts: ["2", "4", "6", "8", "10", "12"] }, { k: "knob", i: [1, 2, 3] }] },
    { title: "RESONANCE", items: [{ k: "knob", i: [4, 5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "NOTCH PATTERN (LIVE SWEEP)",
  vizCode: `frame(cx,r);
var n=2*(Math.round($Stages)+1),rate=0.02*Math.pow(500,$Rate),cen=100*Math.pow(50,$Center),fc=cen*Math.pow(2,$Depth*2*Math.sin(t*rate/1000*Math.PI*2)),fb=$Feedback;
var a=(Math.tan(Math.PI*Math.min(fc,21000)/48000)-1)/(Math.tan(Math.PI*Math.min(fc,21000)/48000)+1);
plot(cx,r,function(f){var w=2*Math.PI*f/48000,c1=Math.cos(w),s1=-Math.sin(w);
var nr=a+c1,ni=s1,dr=1+a*c1,di=a*s1,m=dr*dr+di*di,hr=(nr*dr+ni*di)/m,hi=(ni*dr-nr*di)/m;var Ar=1,Ai=0;for(var i=0;i<n;i++){var tr=Ar*hr-Ai*hi;Ai=Ar*hi+Ai*hr;Ar=tr}
var lr=1-fb*(Ar*c1-Ai*s1),li=-fb*(Ar*s1+Ai*c1),lm=lr*lr+li*li||1e-9,wr=(Ar*lr+Ai*li)/lm,wi=(Ai*lr-Ar*li)/lm;return 10*Math.log10((1+wr)*(1+wr)+wi*wi+1e-9)},20,20000,-36,15,true);`,
  globals: `
const pz: StaticArray<f32> = new StaticArray<f32>(24); const pfb: StaticArray<f32> = new StaticArray<f32>(2); let pph: f32 = 0.0;`,
  init: `for (let i = 0; i < 24; i++) pz[i] = 0.0; pfb[0] = 0.0; pfb[1] = 0.0; pph = 0.0;`,
  block: `
  const inc: f32 = expMap($Rate, 0.02, 10.0) / sr; const nSt: i32 = 2 * (i32($Stages + 0.5) + 1);
  const cen: f32 = expMap($Center, 100.0, 5000.0); const dep2: f32 = $Depth * 2.0; const fbk: f32 = $Feedback; const sp: f32 = $Spread * 0.25;
  const mix: f32 = $Mix; ${mixGains} const outG: f32 = dbLin($Output);`,
  pre: `pph += inc; if (pph >= 1.0) pph -= 1.0;`,
  sample: `
  const lfo: f32 = f32(Mathf.sin((pph + f32(c) * sp) * TWO_PI));
  const fc: f32 = minf(cen * f32(Mathf.pow(2.0, dep2 * lfo)), sr * 0.45);
  const tn: f32 = f32(Mathf.tan(PI * fc / sr)); const a: f32 = (tn - 1.0) / (tn + 1.0);
  let u: f32 = x + fbk * pfb[c];
  for (let s: i32 = 0; s < nSt; s++) { const yy: f32 = a * u + pz[c * 12 + s]; pz[c * 12 + s] = fz(u - a * yy); u = yy; }
  pfb[c] = fz(u);
  y = softLim((x * dryG + u * wetG) * outG);`,
  testParams: {},
};

// ---------------- Tremolo ----------------
const tremolo = {
  slug: "std-tremolo", name: "StdTremolo", theme: "Modulation", subtitle: "Tempo-syncable tremolo",
  explanation: "A tremolo: the level of the signal is modulated by an LFO. Rate runs free from 0.1 to 20 Hz, or Sync locks it to the host tempo (quarter, eighth, sixteenth or thirty-second notes) and phase-locks it to the song position while the transport plays. Depth sets how far the level dips, Shape chooses sine, triangle, a soft square for a choppy gate-like pulse, or a falling saw, and Stereo shifts the right channel's LFO against the left, up to opposite phase, for a swirling auto-pan feel.",
  params: [["Rate", 0, 1, 0.5, 0, { exp: [0.1, 20], unit: " Hz" }], ["Sync", 0, 4, 0, 1, ["Free", "1/4", "1/8", "1/16", "1/32"]], ["Depth", 0, 1, 0.6], ["Shape", 0, 3, 0, 1, ["Sine", "Triangle", "Square", "Saw"]],
    ["Stereo", 0, 1, 0], OUT],
  groups: [
    { title: "LFO", items: [{ k: "seg", i: 3, label: "SHAPE", opts: ["SINE", "TRI", "SQUARE", "SAW"] }, { k: "seg", i: 1, label: "SYNC", opts: ["FREE", "1/4", "1/8", "1/16", "1/32"] }, { k: "knob", i: [0, 2, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [5] }] },
  ],
  vizLabel: "LEVEL MODULATION",
  vizCode: `frame(cx,r);
var kd=Math.round($Shape),dep=$Depth,rate=0.1*Math.pow(200,$Rate),sy=Math.round($Sync),cyc=sy?[0,1,2,4,8][sy]:Math.max(1,Math.min(8,rate)),ph=t*(sy?0.0004:rate/1000);
function lf(p){p=p-Math.floor(p);if(kd===0)return .5+.5*Math.sin(p*Math.PI*2);if(kd===1)return p<.5?2*p:2-2*p;if(kd===2)return .5+.5*Math.tanh(Math.sin(p*Math.PI*2)*8);return 1-p}
plot(cx,r,function(x){return 1-dep*(1-lf(x*cyc*0.5+ph*0.35))},0,1,0,1.05,false);`,
  globals: `let tlfo: f64 = 0.0; let tbeat: f64 = 0.0;
function tshape(kind: i32, p: f32): f32 {
  if (kind == 0) return 0.5 + 0.5 * f32(Mathf.sin(p * TWO_PI));
  if (kind == 1) return p < 0.5 ? 2.0 * p : 2.0 - 2.0 * p;
  if (kind == 2) return 0.5 + 0.5 * f32(Mathf.tanh(f32(Mathf.sin(p * TWO_PI)) * 8.0));
  return 1.0 - p;
}`,
  init: `tlfo = 0.0; tbeat = 0.0;`,
  block: `
  const sync: i32 = i32($Sync + 0.5); const kind: i32 = i32($Shape + 0.5); const depth: f32 = $Depth; const off: f32 = $Stereo * 0.5;
  const beats: f32 = sync == 1 ? 1.0 : (sync == 2 ? 0.5 : (sync == 3 ? 0.25 : 0.125));
  const freeInc: f64 = f64(expMap($Rate, 0.1, 20.0)) / f64(sr); const beatInc: f64 = f64(hostBpm) / (60.0 * f64(sr));
  if (hostPlaying) tbeat = beatPos;
  const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  if (sync > 0) { tbeat += beatInc; tlfo = tbeat / f64(beats); } else { tlfo += freeInc; }
  const p0: f32 = f32(tlfo - Math.floor(tlfo));
  let p1: f32 = p0 + off; if (p1 >= 1.0) p1 -= 1.0;
  yl = xl * (1.0 - depth * (1.0 - tshape(kind, p0))) * outG; yr = xr * (1.0 - depth * (1.0 - tshape(kind, p1))) * outG;`,
  testParams: {},
};

// ---------------- Vibrato ----------------
const vibrato = {
  slug: "std-vibrato", name: "StdVibrato", theme: "Modulation", subtitle: "Pitch vibrato",
  explanation: "A pure vibrato: the signal runs through a short delay whose time is swept by an LFO, which bends the pitch up and down in time with the sweep. Rate sets the vibrato speed, Depth the width of the pitch wobble (the picture shows the resulting pitch deviation in cents), Shape chooses a sine or a triangle LFO, and Stereo offsets the right channel's LFO against the left for a wide, slightly seasick image. Mix blends the dry signal back in, which turns vibrato into chorus.",
  params: [["Rate", 0, 1, 0.5, 0, { exp: [0.5, 12], unit: " Hz" }], ["Depth", 0, 1, 0.4], ["Shape", 0, 1, 0, 1, ["Sine", "Triangle"]], ["Stereo", 0, 1, 0.3], MIX(1), OUT],
  groups: [
    { title: "VIBRATO", items: [{ k: "seg", i: 2, label: "SHAPE", opts: ["SINE", "TRIANGLE"] }, { k: "knob", i: [0, 1, 3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "PITCH DEVIATION",
  vizCode: `frame(cx,r);
var rate=0.5*Math.pow(24,$Rate),md=$Depth*2.5,tri=Math.round($Shape)===1,peak=Math.min(1200,1200*Math.log2(1+2*Math.PI*rate*md*0.001)),ph=t*rate/1000;
plot(cx,r,function(x){var p=x*3+ph;p=p-Math.floor(p);var l=tri?(p<.5?4*p-1:3-4*p):Math.sin(p*Math.PI*2);return l*peak},0,1,-Math.max(peak*1.3,10),Math.max(peak*1.3,10),false);
cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText("+/-"+Math.round(peak)+" cents",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const vb: StaticArray<f32> = new StaticArray<f32>(2 * 8192); let vw: i32 = 0; let vph: f32 = 0.0;`,
  init: `for (let i = 0; i < 2 * 8192; i++) vb[i] = 0.0; vw = 0; vph = 0.0;`,
  block: `
  const inc: f32 = expMap($Rate, 0.5, 12.0) / sr; const mdS: f32 = $Depth * 0.0025 * sr; const cenS: f32 = mdS + 3.0;
  const tri: bool = $Shape > 0.5; const sp: f32 = $Stereo * 0.5;
  const mix: f32 = $Mix; ${mixGains} const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  vph += inc; if (vph >= 1.0) vph -= 1.0;
  let pl: f32 = vph; let pr: f32 = vph + sp; if (pr >= 1.0) pr -= 1.0;
  const lL: f32 = tri ? (pl < 0.5 ? 4.0 * pl - 1.0 : 3.0 - 4.0 * pl) : f32(Mathf.sin(pl * TWO_PI));
  const lR: f32 = tri ? (pr < 0.5 ? 4.0 * pr - 1.0 : 3.0 - 4.0 * pr) : f32(Mathf.sin(pr * TWO_PI));
  vb[vw] = xl; vb[8192 + vw] = xr; vw = (vw + 1) & 8191;
  const wl: f32 = dlr(vb, 0, 8191, vw, cenS + mdS * lL); const wr: f32 = dlr(vb, 8192, 8191, vw, cenS + mdS * lR);
  yl = softLim((xl * (1.0 - mix) + wl * mix) * outG); yr = softLim((xr * (1.0 - mix) + wr * mix) * outG);`,
  testParams: {},
};

// ---------------- Ring modulator ----------------
const ringmod = {
  slug: "std-ringmod", name: "StdRingMod", theme: "Modulation", subtitle: "Ring modulator / amplitude modulator",
  explanation: "A ring modulator: the input is multiplied by an internal carrier oscillator, which replaces every input frequency with its sum and difference against the carrier. The result is the clangorous, inharmonic metallic tone of old sci-fi robot voices and bell-like synth sounds. Frequency sets the carrier (5 Hz to 5 kHz), Shape chooses a sine, triangle, square or saw carrier, and AM blends from true ring modulation (carrier and input both suppressed) toward ordinary amplitude modulation (input kept, carrier adds a tremolo-like sideband). Mix blends back with the dry signal.",
  params: [["Frequency", 0, 1, 0.5, 0, { exp: [5, 5000], unit: " Hz" }], ["Shape", 0, 3, 0, 1, ["Sine", "Triangle", "Square", "Saw"]], ["AM", 0, 1, 0], MIX(0.7), OUT],
  groups: [
    { title: "CARRIER", items: [{ k: "seg", i: 1, label: "SHAPE", opts: ["SINE", "TRI", "SQUARE", "SAW"] }, { k: "knob", i: [0, 2] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [3, 4] }] },
  ],
  vizLabel: "CARRIER x INPUT",
  vizCode: `frame(cx,r);
var kd=Math.round($Shape),am=$AM,ph=t/900;
function car(p){p=p-Math.floor(p);if(kd===0)return Math.sin(p*Math.PI*2);if(kd===1)return p<.5?4*p-1:3-4*p;if(kd===2)return p<.5?1:-1;return 2*p-1}
cx.beginPath();cx.strokeStyle="rgba(255,255,255,.25)";for(var i=0;i<=r[2];i+=2){var py=r[1]+r[3]/2-Math.sin(i/r[2]*Math.PI*14+ph*3)*(r[3]/2-10);i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke();
plot(cx,r,function(x){var s=Math.sin(x*Math.PI*14+ph*3),c=car(x*3.5+ph*0.4);return s*((1-am)*c+am*(0.5+0.5*c))},0,1,-1.05,1.05,false);`,
  globals: `let rph: f32 = 0.0;`,
  init: `rph = 0.0;`,
  block: `
  const inc: f32 = expMap($Frequency, 5.0, 5000.0) / sr; const kind: i32 = i32($Shape + 0.5); const am: f32 = $AM;
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  pre: `rph += inc; if (rph >= 1.0) rph -= 1.0;
  let car: f32 = 0.0;
  if (kind == 0) car = f32(Mathf.sin(rph * TWO_PI));
  else if (kind == 1) car = rph < 0.5 ? 4.0 * rph - 1.0 : 3.0 - 4.0 * rph;
  else if (kind == 2) car = rph < 0.5 ? 1.0 : -1.0;
  else car = 2.0 * rph - 1.0;
  const gm: f32 = (1.0 - am) * car + am * (0.5 + 0.5 * car);`,
  sample: `y = softLim((x * (1.0 - mix) + x * gm * mix) * outG);`,
  testParams: {},
};

// ---------------- Pitch shifter ----------------
const pitch = {
  slug: "std-pitchshift", name: "StdPitchShift", theme: "Modulation", subtitle: "Two-tap crossfading pitch shifter",
  explanation: "A simple, low-latency pitch shifter: two read heads sweep through a delay line at a speed set by the pitch ratio and are crossfaded with complementary windows so one is always at full strength as the other wraps around. Semitones shifts the pitch up or down by up to an octave, Fine adds up to a semitone either way (small amounts with Mix at 50% make a classic detune thickener), and Window sets the grain size: short windows track fast but sound grainy and chorused, long windows sound smoother but smear transients. The picture shows the two crossfading windows.",
  params: [["Semitones", -12, 12, 0, 1, "semi"], ["Fine", -100, 100, 0, 0, "cents"], ["Window", 0, 1, 0.45, 0, { exp: [20, 120], unit: " ms" }], MIX(1), OUT],
  groups: [
    { title: "PITCH", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [3, 4] }] },
  ],
  vizLabel: "CROSSFADED READ HEADS",
  vizCode: `frame(cx,r);
var st=$Semitones+$Fine/100,ratio=Math.pow(2,st/12),sp=(1-ratio);
function w1(p){var s=Math.sin(Math.PI*p);return s*s}
plot(cx,r,function(p){return w1(p)},0,1,0,1.1,false);
plot(cx,r,function(p){var s=Math.cos(Math.PI*p);return s*s},0,1,0,1.1,false);
var ph=((t/2000)*(-sp*2+0.0001))%1;if(ph<0)ph+=1;cx.fillStyle="#fff";cx.fillRect(r[0]+ph*r[2]-1,r[1],2,r[3]);
cx.font="9px sans-serif";cx.fillText("x"+ratio.toFixed(3)+"  ("+(st>=0?"+":"")+st.toFixed(2)+" st)",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const pb: StaticArray<f32> = new StaticArray<f32>(2 * 32768); let pw: i32 = 0; let pph: f32 = 0.0;`,
  init: `for (let i = 0; i < 2 * 32768; i++) pb[i] = 0.0; pw = 0; pph = 0.0;`,
  block: `
  const ratio: f32 = f32(Mathf.pow(2.0, ($Semitones + $Fine / 100.0) / 12.0));
  const W: f32 = clampf(expMap($Window, 20.0, 120.0) * 0.001 * sr, 64.0, 16000.0);
  const dp: f32 = (1.0 - ratio) / W;
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  pre: `
  pph += dp; if (pph >= 1.0) pph -= 1.0; if (pph < 0.0) pph += 1.0;
  let q: f32 = pph + 0.5; if (q >= 1.0) q -= 1.0;
  const s1: f32 = f32(Mathf.sin(PI * pph)); const s2: f32 = f32(Mathf.sin(PI * q));
  const w1: f32 = s1 * s1; const w2: f32 = s2 * s2; const d1: f32 = pph * W + 2.0; const d2: f32 = q * W + 2.0;`,
  sample: `
  pb[c * 32768 + pw] = x;
  const wet: f32 = dlr(pb, c * 32768, 32767, pw + 1, d1) * w1 + dlr(pb, c * 32768, 32767, pw + 1, d2) * w2;
  y = softLim((x * (1.0 - mix) + wet * mix) * outG);`,
  post: `pw = (pw + 1) & 32767;`,
  testParams: { 0: 5 },
};

export default [chorus, flanger, phaser, tremolo, vibrato, ringmod, pitch];
