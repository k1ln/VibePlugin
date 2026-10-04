// Std reverbs: classic Schroeder/Freeverb (StdReverb) and three 8-line feedback-delay-network reverbs.
const OUT = ["Output", -24, 12, 0, 0, "db"];

// decay-envelope picture: pre-delay gap, direct click, stochastic tail that decays to the RT60 mark
const tailViz = (rtExpr, preExpr, denseExpr = "0.9") => `frame(cx,r);
var rt=${rtExpr},pre=${preExpr},span=Math.max(1.2,rt*1.3+pre),w=r[2],h=r[3],seed=11,live=disp[0]||0;
function rn(){seed=(seed*16807)%2147483647;return seed/2147483647}
cx.fillStyle="rgba(255,255,255,.7)";cx.fillRect(r[0],r[1]+6,2,h-12);
var nd=${denseExpr};
for(var x=4;x<w;x+=2){var tt=x/w*span,e=tt<pre?0:Math.max(0,1-(tt-pre)/rt),ramp=Math.min(1,(tt-pre)/0.06);
var a=e*ramp*(0.25+0.75*rn())*(0.7+0.3*nd)*(0.9+0.1*Math.sin(t/400+x*.05));
if(a>0.004){cx.fillStyle="rgba(${"255,255,255"},"+(0.25+0.6*a)+")";var bh=a*(h-14);cx.fillRect(r[0]+x,r[1]+h/2-bh/2,1.6,bh)}}
var xm=r[0]+Math.min(w-2,(rt+pre)/span*w);cx.strokeStyle="rgba(255,255,255,.35)";cx.setLineDash([3,3]);cx.beginPath();cx.moveTo(xm,r[1]);cx.lineTo(xm,r[1]+h);cx.stroke();cx.setLineDash([]);
cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText("RT60 "+rt.toFixed(2)+" s",Math.min(xm+4,r[0]+w-70),r[1]+12);`;

// ---------- Freeverb-style ----------
const classic = {
  slug: "std-reverb", name: "StdReverb", theme: "Reverb", subtitle: "Classic algorithmic reverb",
  explanation: "The textbook algorithmic reverb: a pre-delay feeds eight parallel damped feedback comb filters whose outputs run through four series allpass diffusers, with a slightly different set of lengths on the right channel for stereo width. Decay sets how long the tail rings, Damping rolls off the highs inside the loop so the tail darkens like a real room, Width blends the stereo image toward mono, and Low Cut and High Cut shape the wet signal. Smooth, dense and unfussy - the reverb you reach for first.",
  params: [["Decay", 0, 1, 0.55], ["Damping", 0, 1, 0.45], ["Pre-Delay", 0, 1, 0.08, 0, { ms: [0, 200] }], ["Width", 0, 1, 1], ["Low Cut", 0, 1, 0.1, 0, { hz: [20, 800] }],
    ["High Cut", 0, 1, 0.9, 0, { hz: [1000, 20000] }], ["Mix", 0, 1, 0.3], OUT],
  groups: [
    { title: "SPACE", items: [{ k: "knob", i: [0, 1, 2, 3] }] },
    { title: "TONE", items: [{ k: "knob", i: [4, 5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "REVERB TAIL",
  vizCode: tailViz("0.032*(-3/Math.log10(0.7+$Decay*0.28))", "$PreDelay*0.2", "1"),
  globals: `
const CST: i32 = 8192; const AST: i32 = 4096;
const combBuf: StaticArray<f32> = new StaticArray<f32>(16 * 8192);
const apBuf: StaticArray<f32> = new StaticArray<f32>(8 * 4096);
const combLen: StaticArray<i32> = new StaticArray<i32>(16); const combIdx: StaticArray<i32> = new StaticArray<i32>(16);
const combLp: StaticArray<f32> = new StaticArray<f32>(16);
const apLen: StaticArray<i32> = new StaticArray<i32>(8); const apIdx: StaticArray<i32> = new StaticArray<i32>(8);
const preBuf: StaticArray<f32> = new StaticArray<f32>(65536); let preW: i32 = 0;
const CT: StaticArray<i32> = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const AT: StaticArray<i32> = [556, 441, 341, 225];
const wf: StaticArray<f32> = new StaticArray<f32>(4);`,
  init: `
  const sc: f32 = sampleRate / 44100.0; const spread: i32 = i32(23.0 * sc + 0.5);
  for (let i = 0; i < 16; i++) { combIdx[i] = 0; combLp[i] = 0.0; const k: i32 = i & 7; combLen[i] = min(CST - 2, i32(f32(CT[k]) * sc + 0.5) + (i >= 8 ? spread : 0)); }
  for (let i = 0; i < 8; i++) { apIdx[i] = 0; const k: i32 = i & 3; apLen[i] = min(AST - 2, i32(f32(AT[k]) * sc + 0.5) + (i >= 4 ? spread : 0)); }
  for (let i = 0; i < 16 * 8192; i++) combBuf[i] = 0.0;
  for (let i = 0; i < 8 * 4096; i++) apBuf[i] = 0.0;
  for (let i = 0; i < 65536; i++) preBuf[i] = 0.0;
  preW = 0; for (let i = 0; i < 4; i++) wf[i] = 0.0;`,
  block: `
  const fbk: f32 = 0.7 + $Decay * 0.28; const damp: f32 = $Damping * 0.6; const damp1: f32 = 1.0 - damp;
  const pdN: i32 = i32($PreDelay * 0.2 * sr);
  const wid: f32 = $Width; const w1: f32 = 0.5 + 0.5 * wid; const w2: f32 = 0.5 - 0.5 * wid;
  const hpK: f32 = opK(expMap($LowCut, 20.0, 800.0)); const lpK: f32 = opK(expMap($HighCut, 1000.0, 20000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  preBuf[preW] = (xl + xr) * 0.5; preW = (preW + 1) & 65535;
  const inp: f32 = preBuf[(preW - 1 - pdN) & 65535] * 0.02;
  let sumL: f32 = 0.0; let sumR: f32 = 0.0;
  for (let i: i32 = 0; i < 8; i++) {
    let idx: i32 = combIdx[i]; const yv: f32 = combBuf[i * 8192 + idx];
    combLp[i] = fz(yv * damp1 + combLp[i] * damp); combBuf[i * 8192 + idx] = inp + combLp[i] * fbk;
    idx++; if (idx >= combLen[i]) idx = 0; combIdx[i] = idx; sumL += yv;
    const j: i32 = i + 8; let id2: i32 = combIdx[j]; const yr2: f32 = combBuf[j * 8192 + id2];
    combLp[j] = fz(yr2 * damp1 + combLp[j] * damp); combBuf[j * 8192 + id2] = inp + combLp[j] * fbk;
    id2++; if (id2 >= combLen[j]) id2 = 0; combIdx[j] = id2; sumR += yr2;
  }
  for (let j: i32 = 0; j < 4; j++) {
    let ia: i32 = apIdx[j]; const ba: f32 = apBuf[j * 4096 + ia]; apBuf[j * 4096 + ia] = fz(sumL + ba * 0.5); sumL = ba - sumL;
    ia++; if (ia >= apLen[j]) ia = 0; apIdx[j] = ia;
    const k2: i32 = j + 4; let ib: i32 = apIdx[k2]; const bb: f32 = apBuf[k2 * 4096 + ib]; apBuf[k2 * 4096 + ib] = fz(sumR + bb * 0.5); sumR = bb - sumR;
    ib++; if (ib >= apLen[k2]) ib = 0; apIdx[k2] = ib;
  }
  let wl: f32 = (sumL * w1 + sumR * w2) * 3.0; let wr: f32 = (sumR * w1 + sumL * w2) * 3.0;
  wf[0] += hpK * (wl - wf[0]); wl -= wf[0]; wf[1] += hpK * (wr - wf[1]); wr -= wf[1];
  wf[2] += lpK * (wl - wf[2]); wl = wf[2]; wf[3] += lpK * (wr - wf[3]); wr = wf[3];
  yl = softLim((xl * (1.0 - mix) + wl * mix) * outG); yr = softLim((xr * (1.0 - mix) + wr * mix) * outG);`,
  testParams: {},
};

// ---------- 8-line feedback delay network ----------
const fdn = (cfg) => ({
  slug: cfg.slug, name: cfg.name, theme: "Reverb", subtitle: cfg.subtitle, explanation: cfg.explanation,
  params: [
    ["Decay", 0, 1, cfg.decay, 0, { exp: [0.2, 20], unit: " s" }], ["Size", 0, 1, cfg.size ?? 0.5, 0, { exp: [0.5, 2], unit: "x" }],
    ["Pre-Delay", 0, 1, cfg.pre, 0, { ms: [0, 250] }], ["Damping", 0, 1, cfg.damp], ["Diffusion", 0, 1, cfg.diff], ["Mod", 0, 1, cfg.mod],
    ["Low Cut", 0, 1, cfg.lc ?? 0.1, 0, { hz: [20, 800] }], ["High Cut", 0, 1, cfg.hc ?? 0.9, 0, { hz: [1000, 20000] }],
    ["Width", 0, 1, 1], ["Mix", 0, 1, cfg.mix ?? 0.3], OUT,
  ],
  groups: [
    { title: "SPACE", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "CHARACTER", items: [{ k: "knob", i: [3, 4, 5] }] },
    { title: "TONE", items: [{ k: "knob", i: [6, 7, 8] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [9, 10] }] },
  ],
  vizLabel: cfg.viz,
  vizCode: tailViz("0.2*Math.pow(100,$Decay)", "$PreDelay*0.25", "(0.3+$Diffusion*0.7)"),
  globals: `
const FL: i32 = 32768; const FM: i32 = 32767;
const fbuf: StaticArray<f32> = new StaticArray<f32>(8 * 32768);
const fW: StaticArray<i32> = new StaticArray<i32>(8);
const fLp: StaticArray<f32> = new StaticArray<f32>(8);
const fG: StaticArray<f32> = new StaticArray<f32>(8);
const fDs: StaticArray<f32> = new StaticArray<f32>(8);
const fLfo: StaticArray<f32> = new StaticArray<f32>(8);
const rdv: StaticArray<f32> = new StaticArray<f32>(8);
const vv: StaticArray<f32> = new StaticArray<f32>(8);
const BMS: StaticArray<f32> = [${cfg.delays.join(", ")}];
const SGN: StaticArray<f32> = [1.0, 1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0];
const dBuf: StaticArray<f32> = new StaticArray<f32>(4 * 4096);
const dW: StaticArray<i32> = new StaticArray<i32>(4);
const dLen: StaticArray<i32> = new StaticArray<i32>(4);
const DMS: StaticArray<f32> = [${cfg.diffMs.join(", ")}];
const preBuf: StaticArray<f32> = new StaticArray<f32>(65536); let preW: i32 = 0;
const wf: StaticArray<f32> = new StaticArray<f32>(4);
let szS: f32 = 1.0;`,
  init: `
  for (let i = 0; i < 8 * 32768; i++) fbuf[i] = 0.0;
  for (let i = 0; i < 8; i++) { fW[i] = 0; fLp[i] = 0.0; fG[i] = 0.0; fDs[i] = 0.0; fLfo[i] = f32(i) * 0.125; rdv[i] = 0.0; vv[i] = 0.0; }
  for (let i = 0; i < 4 * 4096; i++) dBuf[i] = 0.0;
  for (let i = 0; i < 4; i++) { dW[i] = 0; dLen[i] = min(4090, i32(DMS[i] * 0.001 * sampleRate + 0.5)); wf[i] = 0.0; }
  for (let i = 0; i < 65536; i++) preBuf[i] = 0.0;
  preW = 0; szS = expMap(params[P_SIZE], 0.5, 2.0);`,
  block: `
  const rt: f32 = expMap($Decay, 0.2, 20.0); const szT: f32 = expMap($Size, 0.5, 2.0);
  const pdN: i32 = i32($PreDelay * 0.25 * sr);
  const dK: f32 = opK(expMap(1.0 - $Damping, 1500.0, 20000.0));
  const dg: f32 = 0.15 + $Diffusion * 0.6;
  const modD: f32 = $Mod * 0.0004 * sr;
  const wid: f32 = $Width;
  const hpK: f32 = opK(expMap($LowCut, 20.0, 800.0)); const lpK: f32 = opK(expMap($HighCut, 1000.0, 20000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);
  for (let i: i32 = 0; i < 8; i++) {
    const ds: f32 = clampf(BMS[i] * 0.001 * sr * szS, 4.0, f32(FL - 64));
    fG[i] = f32(Mathf.pow(10.0, -3.0 * ds / (rt * sr)));
  }
  const lfoInc0: f32 = 0.1 / sr;`,
  mode: "stereo",
  sample: `
  szS += (szT - szS) * 0.0004;
  preBuf[preW] = (xl + xr) * 0.5; preW = (preW + 1) & 65535;
  let s: f32 = preBuf[(preW - 1 - pdN) & 65535];
  for (let j: i32 = 0; j < 4; j++) {
    const o: i32 = j * 4096; const z: f32 = dBuf[o + dW[j]];
    const w: f32 = s + dg * z; dBuf[o + dW[j]] = fz(w); s = z - dg * w;
    let nw: i32 = dW[j] + 1; if (nw >= dLen[j]) nw = 0; dW[j] = nw;
  }
  s *= 0.65;
  let sum: f32 = 0.0;
  for (let i: i32 = 0; i < 8; i++) {
    fLfo[i] += lfoInc0 * (1.0 + f32(i) * 0.37); if (fLfo[i] >= 1.0) fLfo[i] -= 1.0;
    const dd: f32 = clampf(BMS[i] * 0.001 * sr * szS + modD * f32(Mathf.sin(fLfo[i] * TWO_PI)), 2.0, f32(FL - 8));
    const r: f32 = dlr(fbuf, i * FL, FM, fW[i], dd);
    rdv[i] = r;
    fLp[i] = fz(fLp[i] + dK * (r - fLp[i]));
    const v: f32 = fLp[i] * fG[i]; vv[i] = v; sum += v;
  }
  const hh: f32 = sum * 0.25;
  for (let i: i32 = 0; i < 8; i++) {
    fbuf[i * FL + fW[i]] = fz(vv[i] - hh + s * SGN[i]);
    fW[i] = (fW[i] + 1) & FM;
  }
  let wl: f32 = (rdv[0] - rdv[2] + rdv[4] - rdv[6]) * 0.5; let wr: f32 = (rdv[1] - rdv[3] + rdv[5] - rdv[7]) * 0.5;
  const md: f32 = (wl + wr) * 0.5; const sd: f32 = (wl - wr) * 0.5 * wid; wl = md + sd; wr = md - sd;
  wf[0] += hpK * (wl - wf[0]); wl -= wf[0]; wf[1] += hpK * (wr - wf[1]); wr -= wf[1];
  wf[2] += lpK * (wl - wf[2]); wl = wf[2]; wf[3] += lpK * (wr - wf[3]); wr = wf[3];
  yl = softLim((xl * (1.0 - mix) + wl * mix) * outG); yr = softLim((xr * (1.0 - mix) + wr * mix) * outG);`,
  testParams: {},
});

const room = fdn({
  slug: "std-room", name: "StdRoom", subtitle: "Small natural room", viz: "ROOM TAIL",
  delays: [7.1, 9.3, 11.7, 13.9, 16.3, 18.9, 21.7, 24.3], diffMs: [3.1, 4.3, 5.9, 7.7],
  decay: 0.28, size: 0.5, pre: 0.02, damp: 0.55, diff: 0.7, mod: 0.15, mix: 0.25,
  explanation: "A small-room reverb for putting drums, vocals and guitars in a believable space without washing them out. Eight short delay lines are coupled by a Householder feedback matrix (a lossless mixing matrix, so the tail stays smooth and metal-free), with per-line decay set from a real RT60 time, one-pole damping that makes highs die faster than lows, four input diffusers and a touch of delay-time modulation to stop ringing. Size scales the whole room from a closet to a studio.",
});
const hall = fdn({
  slug: "std-hall", name: "StdHall", subtitle: "Large concert hall", viz: "HALL TAIL",
  delays: [29.7, 37.1, 41.1, 43.7, 53.0, 59.3, 67.9, 79.1], diffMs: [4.7, 3.7, 12.1, 8.3],
  decay: 0.55, size: 0.5, pre: 0.1, damp: 0.5, diff: 0.75, mod: 0.35, mix: 0.3,
  explanation: "A big, smooth concert-hall reverb. Eight long delay lines (roughly 30 to 80 ms) are coupled by a Householder feedback matrix, giving a dense, slowly blooming tail that can run from a couple of seconds to a cathedral-length 20. Damping darkens the tail as it decays, Diffusion sets how quickly the echoes smear into a wash, Mod adds gentle delay-time movement for a lush, non-metallic sound, and Pre-Delay keeps the dry source clear in front of the tail.",
});
const plate = fdn({
  slug: "std-plate", name: "StdPlate", subtitle: "Bright dense plate reverb", viz: "PLATE TAIL",
  delays: [11.3, 13.7, 17.9, 19.3, 23.1, 29.9, 31.7, 37.3], diffMs: [2.3, 3.9, 6.1, 9.1],
  decay: 0.42, size: 0.5, pre: 0, damp: 0.3, diff: 0.95, mod: 0.25, hc: 0.95, lc: 0.15, mix: 0.3,
  explanation: "A bright, instantly dense plate-style reverb: no early-reflection gap, just a tight, shimmering wash that sits on top of vocals, snares and synths. Short delay lines with heavy input diffusion in a Householder-matrix network give an echo density that is smooth from the first millisecond, while light damping keeps it airy. Use Decay for the length, Damping to take the edge off and Low Cut to keep the wash out of the low end.",
});

export default [classic, room, hall, plate];
