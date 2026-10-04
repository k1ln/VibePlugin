// Std delays: stereo delay with tempo sync, ping-pong, tape echo.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const SYNC = ["Free", "1/4", "1/8", "1/8 dotted", "1/16", "1/8 triplet"];

// echo-tap picture: taps every `ms`, height = feedback^n; left up, right down
const tapViz = (msExpr, extra = "") => `frame(cx,r);
var sy=Math.round($Sync),mult=[0,1,.5,.75,.25,1/3][sy],ms=sy?500*mult:${msExpr},fb=Math.min(.97,$Feedback),st=${extra || "0"};
var n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6)*(1+st),w=r[2],h=r[3],mid=r[1]+h/2;
cx.fillStyle="rgba(255,255,255,.75)";cx.fillRect(r[0],r[1]+4,2,h-8);
for(var i=1;i<=n;i++){var a=Math.pow(fb,i-1),xl=r[0]+i*ms/span*w,xr=r[0]+i*ms*(1+st)/span*w,bh=a*(h/2-8);
cx.fillStyle="rgba(${"255,255,255"},"+(0.2+0.7*a)+")";cx.fillRect(xl,mid-bh,3,bh);cx.fillStyle="${"#fff"}";cx.globalAlpha=.55*(0.3+0.7*a);cx.fillRect(xr,mid,3,bh);cx.globalAlpha=1}
cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText((sy?["","1/4","1/8","1/8.","1/16","1/8T"][sy]+" @120 bpm = ":"")+Math.round(ms)+" ms",r[0]+6,r[1]+h-6);`;

const timeCode = `
  const syn: i32 = i32($Sync + 0.5);
  let ms: f32 = expMap($Time, 10.0, 2000.0);
  if (syn > 0) {
    const beat: f32 = 60000.0 / hostBpm;
    ms = beat * (syn == 1 ? 1.0 : (syn == 2 ? 0.5 : (syn == 3 ? 0.75 : (syn == 4 ? 0.25 : 0.3333333))));
  }
  const tT: f32 = clampf(ms * 0.001 * sr, 2.0, f32(DM - 16));`;

const common = {
  globals: `
const DN: i32 = 524288; const DM: i32 = 524287;
const dbuf: StaticArray<f32> = new StaticArray<f32>(2 * 524288);
let dw: i32 = 0; let tLs: f32 = 0.0; let tRs: f32 = 0.0;
const fl: StaticArray<f32> = new StaticArray<f32>(8);`,
  init: `for (let i = 0; i < 2 * 524288; i++) dbuf[i] = 0.0; for (let i = 0; i < 8; i++) fl[i] = 0.0; dw = 0; tLs = 0.0; tRs = 0.0;`,
};

const delay = {
  ...common,
  slug: "std-delay", name: "StdDelay", theme: "Delay", subtitle: "Stereo delay with tempo sync",
  explanation: "A straightforward stereo delay. Time runs from 10 ms to 2 seconds, or locks to the host tempo as a quarter, eighth, dotted eighth, sixteenth or eighth triplet. Feedback repeats the echo, with a low-pass Tone control and a Low Cut filter inside the feedback loop so every repeat gets progressively darker and thinner instead of piling up mud. Stereo offsets the right channel's delay time against the left for a wide, loosely bouncing echo. Time changes glide smoothly, like turning the knob on an analogue delay, instead of clicking.",
  params: [["Time", 0, 1, 0.67, 0, { exp: [10, 2000], unit: " ms" }], ["Sync", 0, 5, 0, 1, SYNC], ["Feedback", 0, 0.95, 0.4], ["Tone", 0, 1, 0.7, 0, { hz: [500, 16000] }],
    ["Low Cut", 0, 1, 0.1, 0, { hz: [20, 1000] }], ["Stereo", 0, 1, 0.2], ["Mix", 0, 1, 0.3], OUT],
  groups: [
    { title: "TIME", items: [{ k: "seg", i: 1, label: "SYNC", opts: ["FREE", "1/4", "1/8", "1/8 D", "1/16", "1/8 T"] }, { k: "knob", i: [0, 5] }] },
    { title: "FEEDBACK", items: [{ k: "knob", i: [2, 3, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "ECHO TAPS  (left up, right down)",
  vizCode: tapViz("10*Math.pow(200,$Time)", "$Stereo*0.5"),
  block: `${timeCode}
  const tR: f32 = tT * (1.0 + $Stereo * 0.5);
  const fbk: f32 = $Feedback; const lpK: f32 = opK(expMap($Tone, 500.0, 16000.0)); const hpK: f32 = opK(expMap($LowCut, 20.0, 1000.0));
  const mix: f32 = $Mix; const wetG: f32 = minf(1.0, mix * 2.0); const dryG: f32 = 1.0 - maxf(0.0, mix - 0.5) * 2.0; const outG: f32 = dbLin($Output);
  if (tLs < 1.0) { tLs = tT; tRs = tR; }`,
  mode: "stereo",
  sample: `
  tLs += (tT - tLs) * 0.0008; tRs += (tR - tRs) * 0.0008;
  const dL: f32 = dlr(dbuf, 0, DM, dw, tLs); const dR: f32 = dlr(dbuf, DN, DM, dw, tRs);
  fl[0] += lpK * (dL - fl[0]); fl[1] += hpK * (fl[0] - fl[1]); const fbL: f32 = fl[0] - fl[1];
  fl[2] += lpK * (dR - fl[2]); fl[3] += hpK * (fl[2] - fl[3]); const fbR: f32 = fl[2] - fl[3];
  dbuf[dw] = fz(softLim(xl + fbL * fbk)); dbuf[DN + dw] = fz(softLim(xr + fbR * fbk)); dw = (dw + 1) & DM;
  yl = softLim((xl * dryG + dL * wetG) * outG); yr = softLim((xr * dryG + dR * wetG) * outG);`,
  testParams: {},
};

const pingpong = {
  ...common,
  slug: "std-pingpong", name: "StdPingPong", theme: "Delay", subtitle: "Ping-pong stereo delay",
  explanation: "A ping-pong delay: each echo bounces to the opposite side, left, right, left, right, with the feedback crossed between the two channels. The input is summed to mono and starts on the left; Spread feeds some of it straight into the right line as well for a wider, less strictly alternating pattern. Time can run free (10 ms to 2 s) or lock to the host tempo, and Tone and Low Cut shape each repeat inside the feedback loop so the bounces fade into the distance.",
  params: [["Time", 0, 1, 0.64, 0, { exp: [10, 2000], unit: " ms" }], ["Sync", 0, 5, 0, 1, SYNC], ["Feedback", 0, 0.95, 0.5], ["Tone", 0, 1, 0.75, 0, { hz: [500, 16000] }],
    ["Low Cut", 0, 1, 0.1, 0, { hz: [20, 1000] }], ["Spread", 0, 1, 0], ["Mix", 0, 1, 0.35], OUT],
  groups: [
    { title: "TIME", items: [{ k: "seg", i: 1, label: "SYNC", opts: ["FREE", "1/4", "1/8", "1/8 D", "1/16", "1/8 T"] }, { k: "knob", i: [0, 5] }] },
    { title: "FEEDBACK", items: [{ k: "knob", i: [2, 3, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "PING-PONG  (left up, right down)",
  vizCode: `frame(cx,r);
var sy=Math.round($Sync),mult=[0,1,.5,.75,.25,1/3][sy],ms=sy?500*mult:10*Math.pow(200,$Time),fb=Math.min(.97,$Feedback);
var n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6),w=r[2],h=r[3],mid=r[1]+h/2;
cx.fillStyle="rgba(255,255,255,.75)";cx.fillRect(r[0],r[1]+4,2,h-8);
for(var i=1;i<=n;i++){var a=Math.pow(fb,i-1),x=r[0]+i*ms/span*w,bh=a*(h/2-8),up=(i%2===1);
cx.globalAlpha=.3+.7*a;cx.fillStyle="#fff";cx.fillRect(x,up?mid-bh:mid,3,bh);cx.globalAlpha=.35*a;cx.fillRect(x,up?mid:mid-bh,3,bh*$Spread);cx.globalAlpha=1}
cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText(Math.round(ms)+" ms",r[0]+6,r[1]+h-6);`,
  block: `${timeCode}
  const fbk: f32 = $Feedback; const lpK: f32 = opK(expMap($Tone, 500.0, 16000.0)); const hpK: f32 = opK(expMap($LowCut, 20.0, 1000.0));
  const spread: f32 = $Spread;
  const mix: f32 = $Mix; const wetG: f32 = minf(1.0, mix * 2.0); const dryG: f32 = 1.0 - maxf(0.0, mix - 0.5) * 2.0; const outG: f32 = dbLin($Output);
  if (tLs < 1.0) { tLs = tT; }`,
  mode: "stereo",
  sample: `
  tLs += (tT - tLs) * 0.0008;
  const dL: f32 = dlr(dbuf, 0, DM, dw, tLs); const dR: f32 = dlr(dbuf, DN, DM, dw, tLs);
  fl[0] += lpK * (dR - fl[0]); fl[1] += hpK * (fl[0] - fl[1]); const fbL: f32 = fl[0] - fl[1];
  fl[2] += lpK * (dL - fl[2]); fl[3] += hpK * (fl[2] - fl[3]); const fbR: f32 = fl[2] - fl[3];
  const inM: f32 = (xl + xr) * 0.5;
  dbuf[dw] = fz(softLim(inM + fbL * fbk)); dbuf[DN + dw] = fz(softLim(inM * spread + fbR * fbk)); dw = (dw + 1) & DM;
  yl = softLim((xl * dryG + dL * wetG) * outG); yr = softLim((xr * dryG + dR * wetG) * outG);`,
  testParams: {},
};

const tape = {
  ...common,
  slug: "std-tapeecho", name: "StdTapeEcho", theme: "Delay", subtitle: "Tape echo with wow and flutter",
  explanation: "A tape-style echo. The repeats pass through a saturating tape stage, a gentle low-pass and a bass-trimming high-pass inside the feedback loop, so each generation gets warmer, darker and more compressed, and the feedback can be pushed to self-oscillation without blowing up. Wow adds slow speed drift and Flutter adds fast jitter to the delay time, giving the repeats their characteristic pitch wobble. Time glides when changed, with the pitch bending like a real tape machine being re-speeded.",
  params: [["Time", 0, 1, 0.6, 0, { exp: [30, 1000], unit: " ms" }], ["Feedback", 0, 1, 0.45], ["Tone", 0, 1, 0.5, 0, { hz: [800, 9000] }], ["Wow", 0, 1, 0.25],
    ["Flutter", 0, 1, 0.2], ["Drive", 0, 1, 0.3], ["Mix", 0, 1, 0.3], OUT],
  groups: [
    { title: "ECHO", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "TAPE", items: [{ k: "knob", i: [3, 4, 5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6, 7] }] },
  ],
  vizLabel: "TAPE LOOP",
  vizCode: `frame(cx,r);
var ms=30*Math.pow(33.33,$Time),fb=Math.min(1,$Feedback)*0.97,w=r[2],h=r[3],mid=r[1]+h/2,n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6),wob=($Wow*3+$Flutter*1.5);
cx.fillStyle="rgba(255,255,255,.75)";cx.fillRect(r[0],r[1]+4,2,h-8);
for(var i=1;i<=n;i++){var a=Math.pow(fb,i-1)*Math.pow(.93,i),x=r[0]+i*ms/span*w+Math.sin(t/500+i)*wob*i*.5,bh=a*(h-16);cx.globalAlpha=.25+.75*a;cx.fillStyle="#fff";cx.fillRect(x,mid-bh/2,3,bh);}
cx.globalAlpha=1;cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText(Math.round(ms)+" ms",r[0]+6,r[1]+h-6);`,
  globals: `${common.globals}
let wowP: f32 = 0.0; let flP: f32 = 0.0; let nz: f32 = 0.0;
const th: StaticArray<f32> = new StaticArray<f32>(4);`,
  init: `${common.init} wowP = 0.0; flP = 0.0; nz = 0.0; for (let i = 0; i < 4; i++) th[i] = 0.0;`,
  block: `
  const tT: f32 = clampf(expMap($Time, 30.0, 1000.0) * 0.001 * sr, 8.0, f32(DM - 16));
  const fbk: f32 = $Feedback * 1.02; const lpK: f32 = opK(expMap($Tone, 800.0, 9000.0)); const hpK: f32 = opK(120.0);
  const wowD: f32 = $Wow * 0.0012 * sr; const flD: f32 = $Flutter * 0.00018 * sr;
  const drv: f32 = 1.0 + $Drive * 5.0; const dn: f32 = 1.0 / tanhf(drv);
  const wowInc: f32 = 0.55 / sr; const flInc: f32 = 7.3 / sr;
  const mix: f32 = $Mix; const wetG: f32 = minf(1.0, mix * 2.0); const dryG: f32 = 1.0 - maxf(0.0, mix - 0.5) * 2.0; const outG: f32 = dbLin($Output);
  if (tLs < 1.0) { tLs = tT; }`,
  mode: "stereo",
  sample: `
  tLs += (tT - tLs) * 0.0004;
  wowP += wowInc; if (wowP >= 1.0) wowP -= 1.0; flP += flInc; if (flP >= 1.0) flP -= 1.0;
  nz += (rnd() - nz) * 0.002;
  const modL: f32 = wowD * f32(Mathf.sin(wowP * TWO_PI)) + flD * (f32(Mathf.sin(flP * TWO_PI)) + nz * 2.0);
  const modR: f32 = wowD * f32(Mathf.sin((wowP + 0.07) * TWO_PI)) + flD * (f32(Mathf.sin((flP + 0.31) * TWO_PI)) + nz * 2.0);
  const dL: f32 = dlr(dbuf, 0, DM, dw, clampf(tLs + modL, 2.0, f32(DM - 8))); const dR: f32 = dlr(dbuf, DN, DM, dw, clampf(tLs + modR, 2.0, f32(DM - 8)));
  fl[0] += lpK * (dL - fl[0]); fl[1] += hpK * (fl[0] - fl[1]); const fbL: f32 = tanhf((fl[0] - fl[1]) * drv) * dn;
  fl[2] += lpK * (dR - fl[2]); fl[3] += hpK * (fl[2] - fl[3]); const fbR: f32 = tanhf((fl[2] - fl[3]) * drv) * dn;
  const sL: f32 = tanhf(xl * 1.0); const sR: f32 = tanhf(xr * 1.0);
  dbuf[dw] = fz(sL + fbL * fbk); dbuf[DN + dw] = fz(sR + fbR * fbk); dw = (dw + 1) & DM;
  yl = softLim((xl * dryG + dL * wetG) * outG); yr = softLim((xr * dryG + dR * wetG) * outG);`,
  testParams: {},
};

export default [delay, pingpong, tape];
