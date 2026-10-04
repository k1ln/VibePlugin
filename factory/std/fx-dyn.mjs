// Std dynamics: compressor, limiter, gate, de-esser, transient shaper.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const dbU = (lo, hi) => ({ unit: " dB", scale: [lo, hi] });
const MIX = (d = 1) => ["Mix", 0, 1, d];

// ---------------- Compressor ----------------
const compressor = {
  slug: "std-compressor", name: "StdCompressor", theme: "Dynamics", subtitle: "Feed-forward compressor with soft knee",
  explanation: "A clean, transparent feed-forward compressor. A stereo-linked detector (peak or RMS) watches the signal after a sidechain high-pass filter, which stops big bass notes from pumping the whole mix, and the gain computer turns down everything above the Threshold by the Ratio, with a soft Knee that eases in gently instead of snapping. Attack and Release shape how quickly the gain reduction clamps down and lets go, Makeup restores the lost level, and Mix blends the dry signal back for parallel (New York) compression. The picture shows the transfer curve with a live gain-reduction readout.",
  params: [["Threshold", -60, 0, -18, 0, dbU(-60, 0)], ["Ratio", 1, 20, 4, 0, { unit: ":1", scale: [1, 20] }], ["Attack", 0, 1, 0.45, 0, { exp: [0.1, 100], unit: " ms" }],
    ["Release", 0, 1, 0.4, 0, { exp: [10, 1000], unit: " ms" }], ["Knee", 0, 24, 6, 0, dbU(0, 24)], ["Makeup", 0, 24, 0, 0, dbU(0, 24)], ["Detector", 0, 1, 0, 1, ["Peak", "RMS"]],
    ["SC Hi-Pass", 0, 1, 0.2, 0, { exp: [20, 500], unit: " Hz" }], MIX(1), OUT],
  groups: [
    { title: "COMPRESSION", items: [{ k: "knob", i: [0, 1, 4] }] },
    { title: "TIMING", items: [{ k: "seg", i: 6, label: "DETECTOR", opts: ["PEAK", "RMS"] }, { k: "knob", i: [2, 3, 7] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [5, 8, 9] }] },
  ],
  vizLabel: "TRANSFER CURVE (input dB to output dB)",
  vizCode: `frame(cx,r);
var thr=$Threshold,R=Math.max(1,$Ratio),kn=$Knee,mk=$Makeup;
function tf(x){var o=x-thr,g;if(2*o<-kn)g=0;else if(kn>0.01&&2*Math.abs(o)<=kn)g=(1/R-1)*Math.pow(o+kn/2,2)/(2*kn);else g=(1/R-1)*o;return x+g+mk}
cx.globalAlpha=.25;cx.strokeStyle="#fff";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;
plot(cx,r,tf,-60,0,-60,12,false);
var tx=r[0]+(thr+60)/60*r[2];cx.setLineDash([3,3]);cx.strokeStyle="rgba(255,255,255,.4)";cx.beginPath();cx.moveTo(tx,r[1]);cx.lineTo(tx,r[1]+r[3]);cx.stroke();cx.setLineDash([]);
var lv=disp[3]||0,li=-60+lv*60,px=r[0]+lv*r[2],py=r[1]+r[3]-(tf(li)+60)/72*r[3];cx.fillStyle="#fff";cx.beginPath();cx.arc(px,Math.max(r[1]+3,Math.min(r[1]+r[3]-3,py)),4,0,7);cx.fill();
cx.font="9px sans-serif";cx.fillText("GR "+((disp[2]||0)*24).toFixed(1)+" dB",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const sidz: StaticArray<f32> = new StaticArray<f32>(2); let rmsS: f32 = 0.0; let gS: f32 = 0.0;`,
  init: `sidz[0] = 0.0; sidz[1] = 0.0; rmsS = 0.0; gS = 0.0;`,
  block: `
  const thr: f32 = $Threshold; const ratio: f32 = maxf(1.0, $Ratio); const knee: f32 = $Knee; const slope: f32 = 1.0 / ratio - 1.0;
  const atk: f32 = tcK(expMap($Attack, 0.1, 100.0) * 0.001); const rel: f32 = tcK(expMap($Release, 10.0, 1000.0) * 0.001);
  const rmsK: f32 = tcK(0.01); const useRms: bool = $Detector > 0.5; const scK: f32 = opK(expMap($SCHiPass, 20.0, 500.0));
  const makeup: f32 = $Makeup; const mix: f32 = $Mix; const outG: f32 = dbLin($Output);
  let grMin: f32 = 0.0; let lvlMax: f32 = -90.0;`,
  mode: "stereo",
  sample: `
  sidz[0] += scK * (xl - sidz[0]); sidz[1] += scK * (xr - sidz[1]);
  const hl: f32 = xl - sidz[0]; const hr: f32 = xr - sidz[1];
  let lvl: f32 = 0.0;
  if (useRms) { rmsS += rmsK * ((hl * hl + hr * hr) * 0.5 - rmsS); lvl = f32(Mathf.sqrt(rmsS)) * 1.4142; } else { lvl = maxf(absf(hl), absf(hr)); }
  const lvlDb: f32 = linDb(lvl); const over: f32 = lvlDb - thr;
  let gr: f32 = 0.0;
  if (2.0 * over < -knee) gr = 0.0;
  else if (knee > 0.01 && 2.0 * absf(over) <= knee) { const q: f32 = over + knee * 0.5; gr = slope * q * q / (2.0 * knee); }
  else gr = slope * over;
  gS += (gr - gS) * (gr < gS ? atk : rel);
  const g: f32 = dbLin(gS + makeup);
  yl = softLim((xl * (1.0 - mix) + xl * g * mix) * outG); yr = softLim((xr * (1.0 - mix) + xr * g * mix) * outG);
  grMin = minf(grMin, gS); lvlMax = maxf(lvlMax, lvlDb);`,
  after: `display[2] = clampf(-grMin / 24.0, 0.0, 1.0); display[3] = clampf((lvlMax + 60.0) / 60.0, 0.0, 1.0);`,
  testParams: { 0: -30 },
};

// ---------------- Limiter ----------------
const limiter = {
  slug: "std-limiter", name: "StdLimiter", theme: "Dynamics", subtitle: "Look-ahead brickwall limiter",
  explanation: "A look-ahead brickwall limiter for the end of a chain. The audio is delayed by the Lookahead time while a sliding-window minimum finds the gain reduction each upcoming peak needs, and the gain is eased down before the peak arrives (so there is no overshoot or crackle) and released smoothly afterwards at the Release rate. Gain drives the signal into the limiter, Ceiling is the level nothing will ever exceed, and Soft Clip rounds the peaks with a tanh stage before limiting for a louder, warmer result with less gain reduction. Left and right are linked so the stereo image does not shift.",
  params: [["Gain", 0, 24, 6, 0, dbU(0, 24)], ["Ceiling", -12, 0, -0.3, 0, dbU(-12, 0)], ["Release", 0, 1, 0.5, 0, { exp: [10, 1000], unit: " ms" }], ["Lookahead", 0, 1, 0.22, 0, { ms: [0.5, 5] }],
    ["Soft Clip", 0, 1, 0]],
  groups: [
    { title: "LIMITER", items: [{ k: "knob", i: [0, 1, 2, 3, 4] }] },
  ],
  vizLabel: "LIMITING (input dB to output dB)",
  vizCode: `frame(cx,r);
var gn=$Gain,ce=$Ceiling,sc=$SoftClip;
cx.globalAlpha=.25;cx.strokeStyle="#fff";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;
function tf(x){var v=x+gn;if(sc>0.01){var a=Math.pow(10,v/20),t=(1-sc)*a+sc*Math.tanh(a);v=20*Math.log10(Math.max(1e-6,t))}return Math.min(v,ce)}
plot(cx,r,tf,-36,0,-36,6,false);
var cy=r[1]+r[3]-(ce+36)/42*r[3];cx.setLineDash([3,3]);cx.strokeStyle="rgba(255,255,255,.4)";cx.beginPath();cx.moveTo(r[0],cy);cx.lineTo(r[0]+r[2],cy);cx.stroke();cx.setLineDash([]);
cx.font="9px sans-serif";cx.fillStyle="#fff";cx.fillText("GR "+((disp[2]||0)*18).toFixed(1)+" dB",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const lbuf: StaticArray<f32> = new StaticArray<f32>(2 * 2048); const gh: StaticArray<f32> = new StaticArray<f32>(2048);
let lw: i32 = 0; let minV: f32 = 1.0; let minPos: i32 = 0; let gsm: f32 = 1.0;`,
  init: `for (let i = 0; i < 2 * 2048; i++) lbuf[i] = 0.0; for (let i = 0; i < 2048; i++) gh[i] = 1.0; lw = 0; minV = 1.0; minPos = 0; gsm = 1.0;`,
  block: `
  const LA: i32 = i32(clampf((0.5 + $Lookahead * 4.5) * 0.001 * sr, 8.0, 1900.0));
  const ceilL: f32 = dbLin($Ceiling); const inG: f32 = dbLin($Gain); const sc: f32 = $SoftClip;
  const relK: f32 = tcK(expMap($Release, 10.0, 1000.0) * 0.001); const atkK: f32 = tcK(f32(LA) / sr * 0.25);
  let gMin: f32 = 1.0;`,
  mode: "stereo",
  sample: `
  let vl: f32 = xl * inG; let vr: f32 = xr * inG;
  if (sc > 0.0) { vl = vl * (1.0 - sc) + tanhf(vl) * sc; vr = vr * (1.0 - sc) + tanhf(vr) * sc; }
  lbuf[lw] = vl; lbuf[2048 + lw] = vr;
  const pk: f32 = maxf(absf(vl), absf(vr)); const gReq: f32 = pk > ceilL ? ceilL / pk : 1.0;
  gh[lw] = gReq;
  const old: i32 = (lw - LA - 1) & 2047;
  if (gReq <= minV) { minV = gReq; minPos = lw; }
  else if (minPos == old) { minV = 1.0; for (let k: i32 = 0; k <= LA; k++) { const ix: i32 = (lw - k) & 2047; const gv: f32 = gh[ix]; if (gv < minV) { minV = gv; minPos = ix; } } }
  gsm += (minV - gsm) * (minV < gsm ? atkK : relK);
  const rd: i32 = (lw - LA) & 2047;
  yl = clampf(lbuf[rd] * gsm, -ceilL, ceilL); yr = clampf(lbuf[2048 + rd] * gsm, -ceilL, ceilL);
  lw = (lw + 1) & 2047;
  gMin = minf(gMin, gsm);`,
  after: `display[2] = clampf(-linDb(gMin) / 18.0, 0.0, 1.0);`,
  testParams: { 0: 12 },
};

// ---------------- Gate ----------------
const gate = {
  slug: "std-gate", name: "StdGate", theme: "Dynamics", subtitle: "Noise gate with hold and hysteresis",
  explanation: "A noise gate that closes the gate on everything below the Threshold. A stereo-linked detector with an adjustable sidechain high-pass listens for the signal, the gate opens when the level rises above the Threshold and stays open for at least the Hold time, then closes only once the level has fallen Hysteresis dB below the threshold, which stops it chattering on a decaying note. Attack and Release shape how fast it opens and closes, and Range sets how much the signal is turned down when closed: all the way to silence, or just a few dB for a gentle expander-like clean-up.",
  params: [["Threshold", -80, 0, -40, 0, dbU(-80, 0)], ["Range", -80, 0, -60, 0, dbU(-80, 0)], ["Attack", 0, 1, 0.3, 0, { exp: [0.05, 50], unit: " ms" }], ["Hold", 0, 1, 0.1, 0, { ms: [0, 500] }],
    ["Release", 0, 1, 0.45, 0, { exp: [5, 2000], unit: " ms" }], ["Hysteresis", 0, 12, 3, 0, dbU(0, 12)], ["SC Hi-Pass", 0, 1, 0, 0, { exp: [20, 2000], unit: " Hz" }]],
  groups: [
    { title: "GATE", items: [{ k: "knob", i: [0, 1, 5] }] },
    { title: "TIMING", items: [{ k: "knob", i: [2, 3, 4] }] },
    { title: "SIDECHAIN", items: [{ k: "knob", i: [6] }] },
  ],
  vizLabel: "GATE TRANSFER (input dB to output dB)",
  vizCode: `frame(cx,r);
var thr=$Threshold,rg=$Range,hy=$Hysteresis;
cx.globalAlpha=.25;cx.strokeStyle="#fff";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;
plot(cx,r,function(x){return x<thr?Math.max(-80,x+rg):x},-80,0,-80,0,false);
var tx=r[0]+(thr+80)/80*r[2],hx=r[0]+(thr-hy+80)/80*r[2];cx.setLineDash([3,3]);cx.strokeStyle="rgba(255,255,255,.4)";cx.beginPath();cx.moveTo(tx,r[1]);cx.lineTo(tx,r[1]+r[3]);cx.moveTo(hx,r[1]);cx.lineTo(hx,r[1]+r[3]);cx.stroke();cx.setLineDash([]);
var lv=disp[3]||0,open=disp[2]||0;cx.fillStyle=open>.5?"#fff":"rgba(255,255,255,.25)";cx.beginPath();cx.arc(r[0]+lv*r[2],r[1]+r[3]-lv*r[3]*(open>.5?1:0.5),4,0,7);cx.fill();
cx.font="9px sans-serif";cx.fillText(open>.5?"OPEN":"CLOSED",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const gz: StaticArray<f32> = new StaticArray<f32>(2); let genv: f32 = 0.0; let gopen: bool = false; let ghold: i32 = 0; let gS: f32 = 1.0;`,
  init: `gz[0] = 0.0; gz[1] = 0.0; genv = 0.0; gopen = false; ghold = 0; gS = 0.0;`,
  block: `
  const thr: f32 = $Threshold; const hyst: f32 = $Hysteresis; const rangeL: f32 = dbLin($Range);
  const atk: f32 = tcK(expMap($Attack, 0.05, 50.0) * 0.001); const rel: f32 = tcK(expMap($Release, 5.0, 2000.0) * 0.001);
  const holdN: i32 = i32($Hold * 0.5 * sr); const scK: f32 = opK(expMap($SCHiPass, 20.0, 2000.0));
  const detRel: f32 = tcK(0.02);
  let gMax: f32 = 0.0; let lvlMax: f32 = -90.0;`,
  mode: "stereo",
  sample: `
  gz[0] += scK * (xl - gz[0]); gz[1] += scK * (xr - gz[1]);
  const lv: f32 = maxf(absf(xl - gz[0]), absf(xr - gz[1]));
  genv = lv > genv ? lv : genv + (lv - genv) * detRel;
  const ed: f32 = linDb(genv);
  if (!gopen) { if (ed > thr) { gopen = true; ghold = holdN; } }
  else {
    if (ed >= thr - hyst) ghold = holdN;
    else if (ghold > 0) ghold--;
    else gopen = false;
  }
  const tg: f32 = gopen ? 1.0 : rangeL;
  gS += (tg - gS) * (tg > gS ? atk : rel);
  yl = xl * gS; yr = xr * gS;
  gMax = maxf(gMax, gopen ? 1.0 : 0.0); lvlMax = maxf(lvlMax, ed);`,
  after: `display[2] = gMax; display[3] = clampf((lvlMax + 80.0) / 80.0, 0.0, 1.0);`,
  testParams: { 0: -35 },
  reactInput: "bursts", reactMin: 0.0003,
};

// ---------------- De-esser ----------------
const deesser = {
  slug: "std-deesser", name: "StdDeEsser", theme: "Dynamics", subtitle: "Split-band sibilance reducer",
  explanation: "A de-esser that tames harsh 's' and 't' sounds in vocals. A band-pass detector tuned to the Frequency watches for sibilance; when it rises above the Threshold the gain is reduced (up to the Range) in just that band (Split mode, which leaves the rest of the voice untouched) or across the whole signal (Wide mode). Release controls how quickly the reduction lets go, and Listen solos the sibilance band so you can tune the Frequency by ear. The picture shows the response with the live reduction applied.",
  params: [["Frequency", 0, 1, 0.5, 0, { exp: [2000, 12000], unit: " Hz" }], ["Threshold", -50, 0, -28, 0, dbU(-50, 0)], ["Range", 0, 24, 10, 0, dbU(0, 24)], ["Mode", 0, 1, 0, 1, ["Split", "Wide"]],
    ["Release", 0, 1, 0.4, 0, { exp: [5, 200], unit: " ms" }], ["Listen", 0, 1, 0, 1, ["Off", "On"]], OUT],
  groups: [
    { title: "DETECTION", items: [{ k: "seg", i: 3, label: "MODE", opts: ["SPLIT", "WIDE"] }, { k: "tog", i: 5, label: "LISTEN", text: "LISTEN" }, { k: "knob", i: [0, 1, 2, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6] }] },
  ],
  vizLabel: "SIBILANCE BAND (LIVE REDUCTION)",
  vizCode: `frame(cx,r);
var fc=2000*Math.pow(6,$Frequency),red=(disp[2]||0)*24,g=Math.pow(10,-red/20),wide=Math.round($Mode)===1;
plot(cx,r,function(f){var b=Math.pow(10,bqMag(2,fc,1.0,0,f)/20);var gg=wide?g:(1-(1-g)*b);return 20*Math.log10(gg+1e-6)},20,20000,-24,6,true);
cx.font="9px sans-serif";cx.fillStyle="#fff";cx.fillText(Math.round(fc)+" Hz   reduction "+red.toFixed(1)+" dB",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const dz: StaticArray<f32> = new StaticArray<f32>(8); const dcf: StaticArray<f32> = new StaticArray<f32>(5); let denv: f32 = 0.0; let dgS: f32 = 0.0;`,
  init: `for (let i = 0; i < 8; i++) dz[i] = 0.0; denv = 0.0; dgS = 0.0;`,
  block: `
  bqSet(dcf, 0, 2, expMap($Frequency, 2000.0, 12000.0), 1.0, 0.0);
  const thr: f32 = $Threshold; const range: f32 = $Range; const wide: bool = $Mode > 0.5; const listen: bool = $Listen > 0.5;
  const atk: f32 = tcK(0.0004); const rel: f32 = tcK(expMap($Release, 5.0, 200.0) * 0.001); const detRel: f32 = tcK(0.003);
  const outG: f32 = dbLin($Output);
  let redMax: f32 = 0.0;`,
  mode: "stereo",
  sample: `
  const sl: f32 = bq(dcf, 0, dz, 0, xl); const sr2: f32 = bq(dcf, 0, dz, 2, xr);
  const det: f32 = maxf(absf(sl), absf(sr2));
  denv = det > denv ? det : denv + (det - denv) * detRel;
  const over: f32 = linDb(denv) - thr;
  const gr: f32 = over > 0.0 ? -minf(range, over * 0.75) : 0.0;
  dgS += (gr - dgS) * (gr < dgS ? atk : rel);
  const g: f32 = dbLin(dgS);
  if (listen) { yl = sl * outG; yr = sr2 * outG; }
  else if (wide) { yl = xl * g * outG; yr = xr * g * outG; }
  else { yl = (xl - sl * (1.0 - g)) * outG; yr = (xr - sr2 * (1.0 - g)) * outG; }
  redMax = maxf(redMax, -dgS);`,
  after: `display[2] = clampf(redMax / 24.0, 0.0, 1.0);`,
  testParams: { 1: -35 },
};

// ---------------- Transient shaper ----------------
const transient = {
  slug: "std-transient", name: "StdTransient", theme: "Dynamics", subtitle: "Attack and sustain shaper",
  explanation: "A transient shaper that changes the punch of a sound without any threshold to set. Two envelope followers, one fast and one slow, track the signal, and the difference between them separates the attack of each note from its sustained tail: when the fast follower is above the slow one a transient is happening, and when it falls below, the note is decaying. Attack boosts or cuts the transients by up to 12 dB and Sustain boosts or cuts the tails, so you can add snap to a dull snare, tighten a boomy kick, or dry out a roomy drum loop. Speed sets how fine the detection is.",
  params: [["Attack", -12, 12, 4, 0, "db"], ["Sustain", -12, 12, 0, 0, "db"], ["Speed", 0, 1, 0.5], OUT],
  groups: [
    { title: "SHAPE", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [3] }] },
  ],
  vizLabel: "ENVELOPE: ORIGINAL (DIM) VS SHAPED",
  vizCode: `frame(cx,r);
var at=Math.pow(10,$Attack/20),su=Math.pow(10,$Sustain/20);
function sp(x){return x<0.04?x/0.04:Math.exp(-(x-0.04)*16)}
function tl(x){return x<0.04?x/0.04:Math.exp(-(x-0.04)*1.4)}
cx.globalAlpha=.3;plot(cx,r,function(x){return 0.65*sp(x)+0.35*tl(x)},0,1,0,2.2,false);cx.globalAlpha=1;
plot(cx,r,function(x){return at*0.65*sp(x)+su*0.35*tl(x)},0,1,0,2.2,false);`,
  globals: `
let tfast: f32 = 0.0; let tslow: f32 = 0.0; let tg: f32 = 0.0;`,
  init: `tfast = 0.0; tslow = 0.0; tg = 0.0;`,
  block: `
  const sp: f32 = $Speed;
  const fA: f32 = tcK(0.0004); const fR: f32 = tcK(expMap(sp, 0.04, 0.008)); const sA: f32 = tcK(expMap(sp, 0.06, 0.012)); const sR: f32 = tcK(expMap(sp, 0.35, 0.12));
  const aDb: f32 = $Attack; const sDb: f32 = $Sustain; const smK: f32 = tcK(0.001); const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  const lv: f32 = maxf(absf(xl), absf(xr));
  tfast += (lv - tfast) * (lv > tfast ? fA : fR);
  tslow += (lv - tslow) * (lv > tslow ? sA : sR);
  const dd: f32 = linDb(tfast) - linDb(tslow);
  const trn: f32 = clampf(dd / 6.0, 0.0, 1.0); const sus: f32 = clampf(-dd / 6.0, 0.0, 1.0);
  const gate: f32 = tslow > 0.0005 ? 1.0 : 0.0;
  tg += ((trn * aDb + sus * sDb) * gate - tg) * smK;
  const g: f32 = dbLin(tg) * outG;
  yl = softLim(xl * g); yr = softLim(xr * g);`,
  testParams: {},
};

export default [compressor, limiter, gate, deesser, transient];
