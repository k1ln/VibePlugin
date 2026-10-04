// Std EQ, tone and stereo utilities.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const GAIN = (n, d = 0) => [n, -15, 15, d, 0, "db"];
const QX = (d) => [undefined, 0, 1, d, 0, { exp: [0.3, 8], unit: " Q" }];
const q = (n, d) => { const p = QX(d); p[0] = n; return p; };

// ---------------- Parametric EQ ----------------
const eq = {
  slug: "std-eq", name: "StdEQ", theme: "EQ", subtitle: "4-band parametric equaliser",
  explanation: "A four-band parametric equaliser with a high-pass filter. The outer bands are shelving filters (Low and High) and the two middle bands are peaking bells (LoMid and HiMid) with adjustable Q from a broad, gentle 0.3 to a narrow 8. Each band has its own frequency and up to 15 dB of boost or cut, and the Low Cut is a second-order high-pass for clearing rumble. The curve in the display is the actual combined response of all five filters, redrawn as you turn the knobs.",
  params: [["Low Cut", 0, 1, 0, 0, { exp: [20, 400], unit: " Hz" }],
    ["Low Freq", 0, 1, 0.4, 0, { hz: [30, 400] }], GAIN("Low Gain"),
    ["LoMid Freq", 0, 1, 0.45, 0, { hz: [100, 2000] }], GAIN("LoMid Gain"), q("LoMid Q", 0.5),
    ["HiMid Freq", 0, 1, 0.5, 0, { hz: [500, 8000] }], GAIN("HiMid Gain"), q("HiMid Q", 0.5),
    ["High Freq", 0, 1, 0.5, 0, { hz: [2000, 16000] }], GAIN("High Gain"), OUT],
  groups: [
    { title: "LOW", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "LOW MID", items: [{ k: "knob", i: [3, 4, 5] }] },
    { title: "HIGH MID", items: [{ k: "knob", i: [6, 7, 8] }] },
    { title: "HIGH / OUTPUT", items: [{ k: "knob", i: [9, 10, 11] }] },
  ],
  vizLabel: "EQ CURVE (dB)",
  vizCode: `frame(cx,r);
var hp=20*Math.pow(20,$LowCut),lf=30*Math.pow(13.333,$LowFreq),mf=100*Math.pow(20,$LoMidFreq),mq=0.3*Math.pow(26.667,$LoMidQ),hf=500*Math.pow(16,$HiMidFreq),hq=0.3*Math.pow(26.667,$HiMidQ),sf=2000*Math.pow(8,$HighFreq);
plot(cx,r,function(f){return bqMag(1,hp,0.7071,0,f)+bqMag(5,lf,0.7071,$LowGain,f)+bqMag(4,mf,mq,$LoMidGain,f)+bqMag(4,hf,hq,$HiMidGain,f)+bqMag(6,sf,0.7071,$HighGain,f)},20,20000,-18,18,true);`,
  globals: `
const cf: StaticArray<f32> = new StaticArray<f32>(25); const zz: StaticArray<f32> = new StaticArray<f32>(20);`,
  init: `for (let i = 0; i < 20; i++) zz[i] = 0.0;`,
  block: `
  bqSet(cf, 0, 1, expMap($LowCut, 20.0, 400.0), 0.7071, 0.0);
  bqSet(cf, 5, 5, expMap($LowFreq, 30.0, 400.0), 0.7071, $LowGain);
  bqSet(cf, 10, 4, expMap($LoMidFreq, 100.0, 2000.0), expMap($LoMidQ, 0.3, 8.0), $LoMidGain);
  bqSet(cf, 15, 4, expMap($HiMidFreq, 500.0, 8000.0), expMap($HiMidQ, 0.3, 8.0), $HiMidGain);
  bqSet(cf, 20, 6, expMap($HighFreq, 2000.0, 16000.0), 0.7071, $HighGain);
  const outG: f32 = dbLin($Output);`,
  sample: `
  let w: f32 = bq(cf, 0, zz, c * 10, x);
  w = bq(cf, 5, zz, c * 10 + 2, w); w = bq(cf, 10, zz, c * 10 + 4, w); w = bq(cf, 15, zz, c * 10 + 6, w); w = bq(cf, 20, zz, c * 10 + 8, w);
  y = softLim(w * outG);`,
  testParams: { 2: 9, 4: 9, 7: 9, 10: 9 },
};

// ---------------- Tone control ----------------
const tone = {
  slug: "std-tone", name: "StdTone", theme: "EQ", subtitle: "Bass / mid / treble tone control",
  explanation: "The simple tone stack everyone understands: Bass and Treble are shelving filters at adjustable corner frequencies, Mid is a broad bell at an adjustable centre, and each gives up to 12 dB of boost or cut. Meant for quick, musical broad strokes rather than surgical work: warm up a dull bass, lift a vocal's presence, tame a harsh top end. The curve shows the combined response.",
  params: [["Bass", -12, 12, 0, 0, "db"], ["Mid", -12, 12, 0, 0, "db"], ["Treble", -12, 12, 0, 0, "db"],
    ["Bass Freq", 0, 1, 0.4, 0, { hz: [60, 300] }], ["Mid Freq", 0, 1, 0.5, 0, { hz: [300, 3000] }], ["Treble Freq", 0, 1, 0.5, 0, { hz: [2000, 10000] }], OUT],
  groups: [
    { title: "TONE", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "FREQUENCIES", items: [{ k: "knob", i: [3, 4, 5] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [6] }] },
  ],
  vizLabel: "TONE CURVE (dB)",
  vizCode: `frame(cx,r);
var bf=60*Math.pow(5,$BassFreq),mf=300*Math.pow(10,$MidFreq),tf=2000*Math.pow(5,$TrebleFreq);
plot(cx,r,function(f){return bqMag(5,bf,0.7071,$Bass,f)+bqMag(4,mf,0.6,$Mid,f)+bqMag(6,tf,0.7071,$Treble,f)},20,20000,-15,15,true);`,
  globals: `
const cf: StaticArray<f32> = new StaticArray<f32>(15); const zz: StaticArray<f32> = new StaticArray<f32>(12);`,
  init: `for (let i = 0; i < 12; i++) zz[i] = 0.0;`,
  block: `
  bqSet(cf, 0, 5, expMap($BassFreq, 60.0, 300.0), 0.7071, $Bass);
  bqSet(cf, 5, 4, expMap($MidFreq, 300.0, 3000.0), 0.6, $Mid);
  bqSet(cf, 10, 6, expMap($TrebleFreq, 2000.0, 10000.0), 0.7071, $Treble);
  const outG: f32 = dbLin($Output);`,
  sample: `
  let w: f32 = bq(cf, 0, zz, c * 6, x); w = bq(cf, 5, zz, c * 6 + 2, w); w = bq(cf, 10, zz, c * 6 + 4, w);
  y = softLim(w * outG);`,
  testParams: { 0: 8, 1: 8, 2: 8 },
};

// ---------------- Graphic EQ ----------------
const FREQS = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const NAMES = ["31 Hz", "62 Hz", "125 Hz", "250 Hz", "500 Hz", "1 kHz", "2 kHz", "4 kHz", "8 kHz", "16 kHz"];
const graphic = {
  slug: "std-graphiceq", name: "StdGraphicEQ", theme: "EQ", subtitle: "10-band octave graphic equaliser",
  explanation: "A ten-band graphic equaliser with one band per octave from 31 Hz to 16 kHz, each a peaking filter of octave bandwidth with up to 12 dB of boost or cut. Bands that are set flat are bypassed completely, so an untouched EQ costs nothing and cannot colour the sound. Output trims the overall level. The curve shows the combined response of all ten bands.",
  params: [...NAMES.map((n) => [n, -12, 12, 0, 0, "db"]), OUT],
  groups: [
    { title: "BANDS", items: [{ k: "knob", i: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [10] }] },
  ],
  vizLabel: "EQ CURVE (dB)",
  vizCode: `frame(cx,r);
var F=[31.25,62.5,125,250,500,1000,2000,4000,8000,16000];
plot(cx,r,function(f){var s=0;for(var b=0;b<10;b++)s+=bqMag(4,F[b],1.41,V[b],f);return s},20,20000,-15,15,true);`,
  globals: `
const cf: StaticArray<f32> = new StaticArray<f32>(50); const zz: StaticArray<f32> = new StaticArray<f32>(40);
const GF: StaticArray<f32> = [${FREQS.join(", ")}];`,
  init: `for (let i = 0; i < 40; i++) zz[i] = 0.0;`,
  block: `
  for (let b: i32 = 0; b < 10; b++) bqSet(cf, b * 5, 4, GF[b], 1.41, params[b]);
  const outG: f32 = dbLin($Output);`,
  sample: `
  let w: f32 = x;
  for (let b: i32 = 0; b < 10; b++) { if (absf(params[b]) > 0.05) w = bq(cf, b * 5, zz, c * 20 + b * 2, w); }
  y = softLim(w * outG);`,
  testParams: { 1: 8, 5: -8, 8: 8 },
};

// ---------------- Stereo widener ----------------
const widener = {
  slug: "std-widener", name: "StdWidener", theme: "Utility", subtitle: "Mid/side stereo width control",
  explanation: "A mid/side stereo widener. The signal is split into its centre (mid, what both channels share) and sides (what differs), and the sides are scaled by Width: 0% collapses to mono, 100% leaves the image untouched, 200% doubles the side content for a very wide mix. Bass Mono removes the stereo information below the chosen frequency so the low end stays solid and centred (important for vinyl, club systems and mono compatibility), and Mid Level and Side Level trim the two components independently. Balance shifts the whole image left or right. The picture is a goniometer-style view of how the image is being reshaped.",
  params: [["Width", 0, 2, 1, 0, { unit: " %", scale: [0, 200] }], ["Bass Mono", 0, 1, 0, 0, { exp: [20, 400], unit: " Hz" }], ["Mid Level", -12, 12, 0, 0, "db"], ["Side Level", -12, 12, 0, 0, "db"],
    ["Balance", -1, 1, 0, 0, { unit: " %", scale: [-100, 100] }], OUT],
  groups: [
    { title: "STEREO FIELD", items: [{ k: "knob", i: [0, 1, 4] }] },
    { title: "MID / SIDE", items: [{ k: "knob", i: [2, 3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [5] }] },
  ],
  vizLabel: "STEREO IMAGE (side across, mid up)",
  vizCode: `frame(cx,r);
var wd=$Width,mg=Math.pow(10,$MidLevel/20),sg=Math.pow(10,$SideLevel/20)*wd,cxm=r[0]+r[2]/2,cym=r[1]+r[3]/2,sx=r[2]*0.3,sy=r[3]*0.42;
function ell(ms,ss,st,al){cx.beginPath();for(var k=0;k<=64;k++){var a=k/64*Math.PI*2,m=Math.cos(a)*ms,s=Math.sin(a)*0.45*ss;var px=cxm+s*sx*2,py=cym-m*sy;k?cx.lineTo(px,py):cx.moveTo(px,py)}cx.closePath();cx.strokeStyle=st;cx.lineWidth=2;cx.globalAlpha=al;cx.stroke();cx.globalAlpha=1}
ell(1,1,"#fff",.25);ell(mg,sg,"#fff",.95);cx.lineWidth=1;
cx.fillStyle="rgba(255,255,255,.7)";cx.font="9px sans-serif";cx.fillText("width "+Math.round(wd*100)+"%",r[0]+6,r[1]+r[3]-6);`,
  globals: `
const bz: StaticArray<f32> = new StaticArray<f32>(2);`,
  init: `bz[0] = 0.0; bz[1] = 0.0;`,
  block: `
  const wd: f32 = $Width; const mG: f32 = dbLin($MidLevel); const sG: f32 = dbLin($SideLevel) * wd;
  const bk: f32 = opK(expMap($BassMono, 20.0, 400.0)); const bal: f32 = $Balance;
  const gl: f32 = bal > 0.0 ? 1.0 - bal : 1.0; const gr: f32 = bal < 0.0 ? 1.0 + bal : 1.0;
  const outG: f32 = dbLin($Output);`,
  mode: "stereo",
  sample: `
  const m: f32 = (xl + xr) * 0.5; let s: f32 = (xl - xr) * 0.5;
  bz[0] += bk * (s - bz[0]); s = ($BassMono > 0.01) ? s - bz[0] : s;
  const mo: f32 = m * mG; const so: f32 = s * sG;
  yl = softLim((mo + so) * gl * outG); yr = softLim((mo - so) * gr * outG);`,
  testParams: {},
};

// ---------------- Utility ----------------
const utility = {
  slug: "std-utility", name: "StdUtility", theme: "Utility", subtitle: "Gain, pan, polarity and mono utility",
  explanation: "The everyday utility plugin: Gain from -60 to +24 dB with click-free smoothing, an equal-power Pan control (centre is unity gain), polarity inversion for each channel (for fixing out-of-phase mic pairs), Swap to exchange left and right, Mono to sum to the centre, and an optional DC Filter to remove any offset. The meters show the output level of each channel.",
  params: [["Gain", -60, 24, 0, 0, "db"], ["Pan", -1, 1, 0, 0, { unit: " %", scale: [-100, 100] }], ["Phase L", 0, 1, 0, 1, ["Normal", "Invert"]], ["Phase R", 0, 1, 0, 1, ["Normal", "Invert"]],
    ["Swap", 0, 1, 0, 1, ["Off", "On"]], ["Mono", 0, 1, 0, 1, ["Off", "On"]], ["DC Filter", 0, 1, 0, 1, ["Off", "On"]]],
  groups: [
    { title: "LEVEL", items: [{ k: "knob", i: [0, 1] }] },
    { title: "POLARITY / ROUTING", items: [{ k: "tog", i: 2, label: "PHASE L", text: "INVERT L" }, { k: "tog", i: 3, label: "PHASE R", text: "INVERT R" }, { k: "tog", i: 4, label: "SWAP", text: "SWAP L/R" }, { k: "tog", i: 5, label: "MONO", text: "MONO" }, { k: "tog", i: 6, label: "DC FILTER", text: "DC FILTER" }] },
  ],
  vizLabel: "OUTPUT LEVEL",
  vizCode: `frame(cx,r);
var L=Math.min(1,disp[2]||0),R=Math.min(1,disp[3]||0),bw=r[2]*0.12,x0=r[0]+r[2]/2-bw*1.2,h=r[3]-14;
cx.fillStyle="rgba(255,255,255,.12)";cx.fillRect(x0,r[1]+7,bw,h);cx.fillRect(x0+bw*1.4,r[1]+7,bw,h);
cx.fillStyle="#fff";cx.fillRect(x0,r[1]+7+h*(1-L),bw,h*L);cx.fillRect(x0+bw*1.4,r[1]+7+h*(1-R),bw,h*R);
cx.font="9px sans-serif";cx.fillText("L",x0+bw/2-3,r[1]+r[3]);cx.fillText("R",x0+bw*1.4+bw/2-3,r[1]+r[3]);
var pn=$Pan,px=r[0]+r[2]/2+pn*r[2]*0.4;cx.fillText("PAN",r[0]+8,r[1]+14);cx.fillRect(r[0]+r[2]*0.1,r[1]+22,r[2]*0.8,1);cx.fillRect(r[0]+r[2]/2+pn*r[2]*0.4-2,r[1]+17,4,11);
cx.fillText($Gain.toFixed(1)+" dB",r[0]+r[2]-70,r[1]+14);`,
  globals: `
let gSm: f32 = 1.0; let pSm: f32 = 0.0; const dcs: StaticArray<f32> = new StaticArray<f32>(4);`,
  init: `gSm = dbLin(params[P_GAIN]); pSm = params[P_PAN]; for (let i = 0; i < 4; i++) dcs[i] = 0.0;`,
  block: `
  const gT: f32 = dbLin($Gain); const pT: f32 = $Pan;
  const pl: f32 = $PhaseL > 0.5 ? -1.0 : 1.0; const pr: f32 = $PhaseR > 0.5 ? -1.0 : 1.0;
  const swap: bool = $Swap > 0.5; const mono: bool = $Mono > 0.5; const dcOn: bool = $DCFilter > 0.5;
  let lMax: f32 = 0.0; let rMax: f32 = 0.0;`,
  mode: "stereo",
  sample: `
  gSm += (gT - gSm) * 0.004; pSm += (pT - pSm) * 0.004;
  let a: f32 = xl * pl; let b: f32 = xr * pr;
  if (swap) { const tmp: f32 = a; a = b; b = tmp; }
  if (mono) { const m: f32 = (a + b) * 0.5; a = m; b = m; }
  if (dcOn) {
    const ny: f32 = a - dcs[0] + 0.9995 * dcs[1]; dcs[0] = a; dcs[1] = fz(ny); a = ny;
    const ny2: f32 = b - dcs[2] + 0.9995 * dcs[3]; dcs[2] = b; dcs[3] = fz(ny2); b = ny2;
  }
  const ang: f32 = (pSm + 1.0) * PI * 0.25;
  yl = a * gSm * f32(Mathf.cos(ang)) * 1.4142; yr = b * gSm * f32(Mathf.sin(ang)) * 1.4142;
  lMax = maxf(lMax, absf(yl)); rMax = maxf(rMax, absf(yr));`,
  after: `display[2] = clampf(lMax, 0.0, 1.0); display[3] = clampf(rMax, 0.0, 1.0);`,
  testParams: { 0: -6, 1: 0.5, 2: 1 },
};

export default [eq, tone, graphic, widener, utility];
