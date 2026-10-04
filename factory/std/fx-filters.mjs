// Std filters: ladder 12/24, Butterworth LP/HP, band-pass, multimode SVF, wah.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const MIX = (d = 1) => ["Mix", 0, 1, d];

// ---- Moog-style 4-pole ladder (zero-delay feedback), tapped at pole 2 (12 dB) or 4 (24 dB) ----
const ladder = (slope) => {
  const tap = slope === 12 ? 2 : 4;
  return {
    slug: `std-ladder-${slope}`, name: `StdLadder${slope}`, theme: "Filters",
    subtitle: `${slope} dB/oct ladder low-pass`,
    explanation: `A resonant ${slope} dB per octave low-pass ladder filter in the style of the classic transistor-ladder design: four cascaded one-pole stages in a zero-delay-feedback topology with the resonance loop closed around all four poles${slope === 12 ? ", tapped after the second pole for the gentler 12 dB slope that keeps the resonant peak" : ", tapped after the fourth pole for the full 24 dB slope"}. Drive saturates the input stage, an envelope follower can open the cutoff with the playing dynamics (amount in octaves, speed from fast to slow), and the resonance goes all the way to self-oscillation. A live frequency-response curve shows the cutoff and resonant peak.`,
    params: [
      ["Cutoff", 0, 1, 0.62, 0, { hz: [20, 18000] }], ["Resonance", 0, 1, 0.3], ["Drive", 0, 1, 0.15],
      ["Env Amount", 0, 1, 0], ["Env Speed", 0, 1, 0.4], MIX(), OUT,
    ],
    groups: [
      { title: "FILTER", items: [{ k: "knob", i: [0, 1, 2] }] },
      { title: "ENVELOPE FOLLOWER", items: [{ k: "knob", i: [3, 4] }] },
      { title: "OUTPUT", items: [{ k: "knob", i: [5, 6] }] },
    ],
    vizLabel: `LADDER ${slope} dB/oct`,
    vizCode: `frame(cx,r);
var fc=20*Math.pow(900,$Cutoff),k=$Resonance*4;
function cm(a,b){return[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]]}
plot(cx,r,function(f){var x=f/fc,d=1+x*x,h1=[1/d,-x/d],h2=cm(h1,h1),h4=cm(h2,h2),n=${tap === 2 ? "h2" : "h4"},dn=[1+k*h4[0],k*h4[1]],m=(n[0]*n[0]+n[1]*n[1])/(dn[0]*dn[0]+dn[1]*dn[1]);return 10*Math.log10(m+1e-12)},20,20000,-60,24,true);`,
    globals: `
const lz: StaticArray<f32> = new StaticArray<f32>(8);
const envS: StaticArray<f32> = new StaticArray<f32>(2);
let cutS: f32 = 0.6;
function ladder(c: i32, x: f32, G: f32, k: f32, drv: f32): f32 {
  const o: i32 = c * 4;
  const s1: f32 = lz[o]; const s2: f32 = lz[o + 1]; const s3: f32 = lz[o + 2]; const s4: f32 = lz[o + 3];
  const g1: f32 = 1.0 - G; const G2: f32 = G * G; const G3: f32 = G2 * G; const G4: f32 = G2 * G2;
  const S: f32 = g1 * (G3 * s1 + G2 * s2 + G * s3 + s4);
  const xs: f32 = tanhf(x * drv) / f32(Mathf.sqrt(drv));
  let u: f32 = (xs * (1.0 + k * 0.5) - k * S) / (1.0 + k * G4);
  u = tanhf(u);
  const v1: f32 = (u - s1) * G; const y1: f32 = v1 + s1; lz[o] = fz(y1 + v1);
  const v2: f32 = (y1 - s2) * G; const y2: f32 = v2 + s2; lz[o + 1] = fz(y2 + v2);
  const v3: f32 = (y2 - s3) * G; const y3: f32 = v3 + s3; lz[o + 2] = fz(y3 + v3);
  const v4: f32 = (y3 - s4) * G; const y4: f32 = v4 + s4; lz[o + 3] = fz(y4 + v4);
  return ${tap === 2 ? "y2" : "y4"};
}`,
    init: `for (let i = 0; i < 8; i++) lz[i] = 0.0; envS[0] = 0.0; envS[1] = 0.0; cutS = params[P_CUTOFF];`,
    block: `
  const cutT: f32 = $Cutoff; const kRes: f32 = $Resonance * 4.0; const drv: f32 = 1.0 + $Drive * 7.0;
  const envOct: f32 = $EnvAmount * 5.0; const envRel: f32 = tcK(expMap($EnvSpeed, 0.4, 0.015));
  const envAtk: f32 = tcK(0.002);
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
    mode: "stereo",
    sample: `
  cutS += (cutT - cutS) * 0.004;
  const lvl: f32 = maxf(absf(xl), absf(xr));
  const ev: f32 = envS[0];
  envS[0] = ev + (lvl - ev) * (lvl > ev ? envAtk : envRel);
  const fc: f32 = minf(expMap(cutS, 20.0, 18000.0) * f32(Mathf.pow(2.0, envOct * clampf(envS[0] * 2.0, 0.0, 1.0))), sr * 0.45);
  const g: f32 = f32(Mathf.tan(PI * fc / sr)); const G: f32 = g / (1.0 + g);
  const wl: f32 = ladder(0, xl, G, kRes, drv); const wr: f32 = ladder(1, xr, G, kRes, drv);
  yl = softLim((xl + (wl - xl) * mix) * outG); yr = softLim((xr + (wr - xr) * mix) * outG);`,
    after: `display[2] = clampf(envS[0] * 2.0, 0.0, 1.0);`,
    testParams: { 1: 0.5, 3: 0.5 },
  };
};

// ---- Butterworth LP / HP, 12 or 24 dB ----
const butter = (hp) => {
  const nm = hp ? "HighPass" : "LowPass";
  const t = hp ? 1 : 0;
  return {
    slug: `std-${hp ? "highpass" : "lowpass"}`, name: `Std${nm}`, theme: "Filters",
    subtitle: `${hp ? "High" : "Low"}-pass, 12 or 24 dB/oct`,
    explanation: `A clean ${hp ? "high" : "low"}-pass filter with a switchable 12 or 24 dB per octave slope. 12 dB is a single Butterworth biquad; 24 dB cascades two biquads with the Butterworth Q pair (0.54 and 1.31) for a maximally flat passband and a steep skirt. Resonance raises the Q of the final section for a peak at the cutoff${hp ? ", which is handy for tightening low end or building risers" : ""}. A live frequency-response curve shows exactly what the filter is doing.`,
    params: [
      ["Cutoff", 0, 1, hp ? 0.2 : 0.7, 0, { hz: hp ? [20, 8000] : [60, 20000] }], ["Slope", 0, 1, 1, 1, ["12 dB", "24 dB"]], ["Resonance", 0, 1, 0],
      MIX(), OUT,
    ],
    groups: [
      { title: "FILTER", items: [{ k: "seg", i: 1, label: "SLOPE", opts: ["12 dB", "24 dB"] }, { k: "knob", i: [0, 2] }] },
      { title: "OUTPUT", items: [{ k: "knob", i: [3, 4] }] },
    ],
    vizLabel: `${nm.toUpperCase()} RESPONSE`,
    vizCode: `frame(cx,r);
var fc=${hp ? "20*Math.pow(400,$Cutoff)" : "60*Math.pow(333.33,$Cutoff)"},q=$Resonance*8;
plot(cx,r,function(f){if($Slope>0.5)return bqMag(${t},fc,0.5412,0,f)+bqMag(${t},fc,1.3065+q,0,f);return bqMag(${t},fc,0.7071+q,0,f)},20,20000,-60,24,true);`,
    globals: `
const cf: StaticArray<f32> = new StaticArray<f32>(10);
const zz: StaticArray<f32> = new StaticArray<f32>(8);
let cutS: f32 = 0.5;`,
    init: `for (let i = 0; i < 8; i++) zz[i] = 0.0; cutS = params[P_CUTOFF];`,
    block: `
  cutS += ($Cutoff - cutS) * 0.6;
  const fc: f32 = expMap(cutS, ${hp ? "20.0, 8000.0" : "60.0, 20000.0"});
  const two: bool = $Slope > 0.5; const q: f32 = $Resonance * 8.0;
  if (two) { bqSet(cf, 0, ${t}, fc, 0.5412, 0.0); bqSet(cf, 5, ${t}, fc, 1.3065 + q, 0.0); }
  else { bqSet(cf, 0, ${t}, fc, 0.7071 + q, 0.0); }
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);
  const comp: f32 = 1.0 / (1.0 + q * 0.12);`,
    sample: `
  let w: f32 = bq(cf, 0, zz, c * 4, x);
  if (two) w = bq(cf, 5, zz, c * 4 + 2, w);
  y = softLim((x + (w * comp - x) * mix) * outG);`,
    testParams: { 2: 0.4 },
  };
};


// ---- Band-pass, 12 or 24 dB skirts ----
const bandpass = {
  slug: "std-bandpass", name: "StdBandPass", theme: "Filters", subtitle: "Band-pass with adjustable width",
  explanation: "A band-pass filter with a free centre frequency and a bandwidth control from a wide, gentle bell to a narrow resonant whistle. The 12 dB setting is one constant-peak biquad band-pass; the 24 dB setting cascades two of them, which narrows and steepens the passband. Use it to isolate a region (telephone and radio voices, resonant sweeps) or blend it back with the dry signal using Mix. A live frequency-response curve shows the centre and the width.",
  params: [["Center", 0, 1, 0.55, 0, { hz: [60, 12000] }], ["Width", 0, 1, 0.45], ["Slope", 0, 1, 0, 1, ["12 dB", "24 dB"]], ["Gain", 0, 1, 0.3], MIX(1), OUT],
  groups: [
    { title: "BAND", items: [{ k: "seg", i: 2, label: "SLOPE", opts: ["12 dB", "24 dB"] }, { k: "knob", i: [0, 1, 3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "BAND-PASS RESPONSE",
  vizCode: `frame(cx,r);
var fc=60*Math.pow(200,$Center),q=expq($Width);
function expq(w){return 0.3*Math.pow(40,1-w)}
plot(cx,r,function(f){var m=bqMag(2,fc,q,0,f);if($Slope>0.5)m+=bqMag(2,fc,q,0,f);return m+$Gain*24},20,20000,-60,30,true);`,
  globals: `
const cf: StaticArray<f32> = new StaticArray<f32>(5);
const zz: StaticArray<f32> = new StaticArray<f32>(8);
let cenS: f32 = 0.5;`,
  init: `for (let i = 0; i < 8; i++) zz[i] = 0.0; cenS = params[P_CENTER];`,
  block: `
  cenS += ($Center - cenS) * 0.6;
  const fc: f32 = expMap(cenS, 60.0, 12000.0);
  const q: f32 = 0.3 * f32(Mathf.pow(40.0, 1.0 - $Width));
  bqSet(cf, 0, 2, fc, q, 0.0);
  const two: bool = $Slope > 0.5;
  const makeup: f32 = dbLin($Gain * 24.0);
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  let w: f32 = bq(cf, 0, zz, c * 4, x);
  if (two) w = bq(cf, 0, zz, c * 4 + 2, w);
  y = softLim((x + (w * makeup - x) * mix) * outG);`,
  testParams: {},
};

// ---- Multimode state-variable filter ----
const multi = {
  slug: "std-multifilter", name: "StdMultiFilter", theme: "Filters", subtitle: "Multimode state-variable filter",
  explanation: "A 12 dB per octave multimode state-variable filter (zero-delay-feedback topology) with low-pass, high-pass, band-pass and notch outputs, a resonance control that runs from gentle to near self-oscillation, and an input drive that saturates the signal before it enters the filter. The cutoff stays stable and well behaved when swept quickly. A live response curve shows the selected mode.",
  params: [["Cutoff", 0, 1, 0.55, 0, { hz: [20, 18000] }], ["Resonance", 0, 1, 0.3], ["Drive", 0, 1, 0.1], ["Mode", 0, 3, 0, 1, ["Low-pass", "High-pass", "Band-pass", "Notch"]], MIX(), OUT],
  groups: [
    { title: "FILTER", items: [{ k: "seg", i: 3, label: "MODE", opts: ["LOW-PASS", "HIGH-PASS", "BAND-PASS", "NOTCH"] }, { k: "knob", i: [0, 1, 2] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "SVF RESPONSE",
  vizCode: `frame(cx,r);
var fc=20*Math.pow(900,$Cutoff),q=0.5+$Resonance*$Resonance*20,md=Math.round($Mode);
plot(cx,r,function(f){return bqMag(md,fc,q,0,f)},20,20000,-60,30,true);`,
  globals: `
const ic: StaticArray<f32> = new StaticArray<f32>(4);
let cutS: f32 = 0.55;`,
  init: `for (let i = 0; i < 4; i++) ic[i] = 0.0; cutS = params[P_CUTOFF];`,
  block: `
  const cutT: f32 = $Cutoff;
  const qv: f32 = 0.5 + $Resonance * $Resonance * 20.0; const kk: f32 = 1.0 / qv;
  const drv: f32 = 1.0 + $Drive * 8.0; const dnorm: f32 = 1.0 / f32(Mathf.sqrt(drv));
  const mode: i32 = i32($Mode + 0.5);
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  if (c == 0) cutS += (cutT - cutS) * 0.004;
  const g: f32 = f32(Mathf.tan(PI * minf(expMap(cutS, 20.0, 18000.0), sr * 0.45) / sr));
  const a1: f32 = 1.0 / (1.0 + g * (g + kk)); const a2: f32 = g * a1; const a3: f32 = g * a2;
  const xin: f32 = tanhf(x * drv) * dnorm;
  const v3: f32 = xin - ic[c * 2 + 1];
  const v1: f32 = a1 * ic[c * 2] + a2 * v3;
  const v2: f32 = ic[c * 2 + 1] + a2 * ic[c * 2] + a3 * v3;
  ic[c * 2] = fz(2.0 * v1 - ic[c * 2]); ic[c * 2 + 1] = fz(2.0 * v2 - ic[c * 2 + 1]);
  let w: f32 = v2;
  if (mode == 1) w = xin - kk * v1 - v2;
  else if (mode == 2) w = kk * v1;
  else if (mode == 3) w = xin - kk * v1;
  y = softLim((x + (w - x) * mix) * outG);`,
  testParams: { 1: 0.5 },
};

// ---- Wah ----
const wah = {
  slug: "std-wah", name: "StdWah", theme: "Filters", subtitle: "Wah pedal: manual, auto or LFO",
  explanation: "A wah-wah filter built on a resonant band-pass. In Manual mode the Pedal knob is the foot position (automate it or map it to a controller); in Auto mode an envelope follower sweeps the filter with your playing dynamics (Sensitivity sets how far, Decay how quickly it falls back); in LFO mode a sine sweeps it at a fixed rate. Low and High set the bottom and top of the sweep and Resonance sets how vocal the peak is.",
  params: [["Mode", 0, 2, 0, 1, ["Manual", "Auto", "LFO"]], ["Pedal", 0, 1, 0.5], ["Low", 0, 1, 0.3, 0, { hz: [200, 900] }], ["High", 0, 1, 0.55, 0, { hz: [900, 4500] }], ["Resonance", 0, 1, 0.55],
    ["Sensitivity", 0, 1, 0.6], ["Decay", 0, 1, 0.4], ["Rate", 0, 1, 0.4, 0, { exp: [0.2, 8], unit: " Hz" }], MIX(1), OUT],
  groups: [
    { title: "SWEEP", items: [{ k: "seg", i: 0, label: "MODE", opts: ["MANUAL", "AUTO", "LFO"] }, { k: "knob", i: [1, 2, 3, 4] }] },
    { title: "AUTO / LFO", items: [{ k: "knob", i: [5, 6, 7] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [8, 9] }] },
  ],
  vizLabel: "WAH POSITION",
  vizCode: `frame(cx,r);
var lo=200*Math.pow(4.5,$Low),hi=900*Math.pow(5,$High),q=1+$Resonance*9,pos=Math.round($Mode)===0?$Pedal:Math.min(1,Math.max(0,disp[2]));
var fc=lo*Math.pow(hi/lo,pos);
plot(cx,r,function(f){return bqMag(2,fc,q,0,f)+6},20,20000,-50,24,true);
cx.fillStyle="#fff";cx.globalAlpha=.5;cx.fillRect(r[0]+r[2]*Math.log(fc/20)/Math.log(1000)-1,r[1],2,r[3]);cx.globalAlpha=1;`,
  globals: `
const ic: StaticArray<f32> = new StaticArray<f32>(4);
let envW: f32 = 0.0; let lfoP: f32 = 0.0; let posS: f32 = 0.5;`,
  init: `for (let i = 0; i < 4; i++) ic[i] = 0.0; envW = 0.0; lfoP = 0.0; posS = 0.5;`,
  block: `
  const mode: i32 = i32($Mode + 0.5);
  const lo: f32 = expMap($Low, 200.0, 900.0) ; const hi: f32 = expMap($High, 900.0, 4500.0);
  const qv: f32 = 1.0 + $Resonance * 9.0; const kk: f32 = 1.0 / qv;
  const sens: f32 = 2.0 + $Sensitivity * 14.0; const dec: f32 = tcK(expMap(1.0 - $Decay, 0.03, 0.5)); const atk: f32 = tcK(0.004);
  const lfoInc: f32 = expMap($Rate, 0.2, 8.0) / sr;
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);
  const pedalT: f32 = $Pedal;`,
  mode: "stereo",
  sample: `
  const lvl: f32 = maxf(absf(xl), absf(xr));
  envW += (lvl - envW) * (lvl > envW ? atk : dec);
  let tgt: f32 = pedalT;
  if (mode == 1) tgt = clampf(envW * sens, 0.0, 1.0);
  else if (mode == 2) { lfoP += lfoInc; if (lfoP >= 1.0) lfoP -= 1.0; tgt = 0.5 - 0.5 * f32(Mathf.cos(lfoP * TWO_PI)); }
  posS += (tgt - posS) * 0.01;
  const fc: f32 = lo * f32(Mathf.pow(hi / lo, posS));
  const g: f32 = f32(Mathf.tan(PI * minf(fc, sr * 0.45) / sr));
  const a1: f32 = 1.0 / (1.0 + g * (g + kk)); const a2: f32 = g * a1; const a3: f32 = g * a2;
  for (let c: i32 = 0; c < 2; c++) {
    const xi: f32 = c == 0 ? xl : xr;
    const v3: f32 = xi - ic[c * 2 + 1];
    const v1: f32 = a1 * ic[c * 2] + a2 * v3;
    const v2: f32 = ic[c * 2 + 1] + a2 * ic[c * 2] + a3 * v3;
    ic[c * 2] = fz(2.0 * v1 - ic[c * 2]); ic[c * 2 + 1] = fz(2.0 * v2 - ic[c * 2 + 1]);
    const w: f32 = tanhf(kk * v1 * 1.6);
    const o: f32 = softLim((xi * (1.0 - mix) + w * mix) * outG);
    if (c == 0) yl = o; else yr = o;
  }`,
  after: `display[2] = posS;`,
  testParams: { 0: 1, 1: 0.5 },
  reactPatches: [{ 0: 0 }, { 0: 2 }], reactInput: "bursts",
};

export default [
  ladder(12),
  ladder(24),
  butter(false),
  butter(true),
  bandpass,
  multi,
  wah,
];
