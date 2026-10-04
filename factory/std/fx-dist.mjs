// Std distortion family. Everything except the bitcrusher shapes the signal at 2x oversampling
// (zero-stuff, 4th-order Butterworth low-pass, shape, low-pass, decimate) to keep aliasing down.
const OUT = ["Output", -24, 12, 0, 0, "db"];
const MIX = (d = 1) => ["Mix", 0, 1, d];

const osGlobals = (shpBody, extra = "") => `
const osCf: StaticArray<f32> = new StaticArray<f32>(10);
const osZ: StaticArray<f32> = new StaticArray<f32>(16);
const dcz: StaticArray<f32> = new StaticArray<f32>(4);
const hpz: StaticArray<f32> = new StaticArray<f32>(4);
const lpz: StaticArray<f32> = new StaticArray<f32>(4);
${extra}
function shp(x: f32): f32 {
${shpBody}
}
function os2(c: i32, x: f32): f32 {
  const o: i32 = c * 8;
  let a: f32 = bq(osCf, 0, osZ, o, x * 2.0); a = bq(osCf, 5, osZ, o + 2, a);
  a = shp(a);
  let d1: f32 = bq(osCf, 0, osZ, o + 4, a); d1 = bq(osCf, 5, osZ, o + 6, d1);
  let b: f32 = bq(osCf, 0, osZ, o, 0.0); b = bq(osCf, 5, osZ, o + 2, b);
  b = shp(b);
  let d2: f32 = bq(osCf, 0, osZ, o + 4, b); d2 = bq(osCf, 5, osZ, o + 6, d2);
  return d2;
}`;
const osInit = `
  bqSetSr(osCf, 0, 0, sampleRate * 0.45, 0.5412, 0.0, sampleRate * 2.0); bqSetSr(osCf, 5, 0, sampleRate * 0.45, 1.3065, 0.0, sampleRate * 2.0);
  for (let i = 0; i < 16; i++) osZ[i] = 0.0; for (let i = 0; i < 4; i++) { dcz[i] = 0.0; hpz[i] = 0.0; lpz[i] = 0.0; }`;
// DC-block + tone low-pass + mix/level, shared tail of the chan-mode sample code
const tail = (wet) => `
  const dcy: f32 = ${wet} - dcz[c * 2] + 0.995 * dcz[c * 2 + 1]; dcz[c * 2] = ${wet}; dcz[c * 2 + 1] = fz(dcy);
  lpz[c] += lpK * (dcy - lpz[c]);
  y = softLim((x * (1.0 - mix) + lpz[c] * mix) * outG);`;

const transferViz = (js, dom = 1) => `frame(cx,r);
function shp(x){${js}}
plot(cx,r,function(x){return shp(x)},-${dom},${dom},-1.15,1.15,false);`;

// ---------------- Distortion ----------------
const distortion = {
  slug: "std-distortion", name: "StdDistortion", theme: "Distortion", subtitle: "Hard / soft / diode / fold distortion",
  explanation: "A general-purpose distortion with four clipping curves: Hard (flat-topped digital-style clipping), Soft (tanh, smooth tube-like saturation), Diode (asymmetric, with the even harmonics that give a warm, crunchy edge) and Fold (the signal folds back on itself instead of clipping, for bright, metallic overtones). Drive pushes the signal into the curve by up to 40 dB, Asymmetry offsets it for extra even harmonics, Low Cut tightens the bass before the clipper so the low end stays defined, and Tone rolls off the top afterwards. The shaping runs at twice the sample rate to keep aliasing down, and a DC blocker follows. A live transfer curve shows what the clipper is doing.",
  params: [["Drive", 0, 1, 0.5], ["Type", 0, 3, 1, 1, ["Hard", "Soft", "Diode", "Fold"]], ["Asymmetry", 0, 1, 0], ["Low Cut", 0, 1, 0.15, 0, { hz: [20, 800] }],
    ["Tone", 0, 1, 0.75, 0, { hz: [500, 16000] }], MIX(), ["Output", -24, 12, -6, 0, "db"]],
  groups: [
    { title: "DRIVE", items: [{ k: "seg", i: 1, label: "TYPE", opts: ["HARD", "SOFT", "DIODE", "FOLD"] }, { k: "knob", i: [0, 2] }] },
    { title: "TONE", items: [{ k: "knob", i: [3, 4] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [5, 6] }] },
  ],
  vizLabel: "TRANSFER CURVE",
  vizCode: transferViz(`var D=Math.pow(10,$Drive*2),t=Math.round($Type),b=$Asymmetry*0.5,v=x*D+b;
if(t===0)return Math.max(-1,Math.min(1,v));if(t===1)return Math.tanh(v);
if(t===2)return v>=0?1-Math.exp(-v):-0.9*(1-Math.exp(v*0.55));return Math.sin(v*1.5708)`),
  globals: osGlobals(`
  if (gType == 0) return clampf(x + gBias, -1.0, 1.0);
  if (gType == 1) return tanhf(x + gBias);
  if (gType == 2) { const v: f32 = x + gBias; return v >= 0.0 ? 1.0 - f32(Mathf.exp(-v)) : -0.9 * (1.0 - f32(Mathf.exp(v * 0.55))); }
  return f32(Mathf.sin((x + gBias) * 1.5708));`, "let gType: i32 = 1; let gBias: f32 = 0.0;"),
  init: osInit,
  block: `
  gType = i32($Type + 0.5); gBias = $Asymmetry * 0.5;
  const D: f32 = dbLin($Drive * 40.0);
  const hpK: f32 = opK(expMap($LowCut, 20.0, 800.0)); const lpK: f32 = opK(expMap($Tone, 500.0, 16000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  hpz[c] += hpK * (x - hpz[c]);
  const w: f32 = os2(c, (x - hpz[c]) * D);${tail("w")}`,
  testParams: {},
};

// ---------------- Overdrive ----------------
const overdrive = {
  slug: "std-overdrive", name: "StdOverdrive", theme: "Distortion", subtitle: "Mid-focused tube-style overdrive",
  explanation: "A mid-focused overdrive in the tradition of the classic green-pedal circuit. Instead of clipping everything equally, the gain stage amplifies only the frequencies above the Focus point, so bass stays clean and tight while the mids and upper harmonics are driven into smooth, symmetrical soft clipping. That keeps chords articulate and the low end from turning to mush even at high gain. Tone rolls off the top of the result, Level sets the volume, and Mix blends the dry signal back in for a more dynamic, pick-sensitive sound. The clipping runs at twice the sample rate to reduce aliasing.",
  params: [["Drive", 0, 1, 0.45], ["Focus", 0, 1, 0.4, 0, { hz: [250, 2000] }], ["Tone", 0, 1, 0.6, 0, { hz: [1000, 12000] }], MIX(), ["Output", -24, 12, -3, 0, "db"]],
  groups: [
    { title: "DRIVE", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [3, 4] }] },
  ],
  vizLabel: "GAIN VS FREQUENCY (BASS STAYS CLEAN)",
  vizCode: `frame(cx,r);
var G=1+$Drive*$Drive*90,fc=250*Math.pow(8,$Focus),lp=1000*Math.pow(12,$Tone);
plot(cx,r,function(f){var x=f/fc,g=Math.sqrt((1+G*G*x*x)/(1+x*x)),l=1/Math.sqrt(1+Math.pow(f/lp,2));return 20*Math.log10(g*l)},20,20000,-10,50,true);`,
  globals: osGlobals(`  return tanhf(x) * 0.95;`),
  init: osInit,
  block: `
  const G: f32 = 1.0 + $Drive * $Drive * 90.0;
  const hpK: f32 = opK(expMap($Focus, 250.0, 2000.0)); const lpK: f32 = opK(expMap($Tone, 1000.0, 12000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  hpz[c] += hpK * (x - hpz[c]);
  const hi: f32 = x - hpz[c];
  const w: f32 = os2(c, x + hi * (G - 1.0)) * (0.9 / f32(Mathf.sqrt(1.0 + G * 0.05)));${tail("w")}`,
  testParams: {},
};

// ---------------- Fuzz ----------------
const fuzz = {
  slug: "std-fuzz", name: "StdFuzz", theme: "Distortion", subtitle: "Asymmetric fuzz with gate",
  explanation: "A two-transistor-style fuzz: enormous gain into an asymmetric clipper that turns the signal into a thick, buzzy, almost square wave. Fuzz sets the gain (up to 60 dB), Bias moves the operating point of the clipper so the positive and negative halves clip differently, which is the difference between a smooth sustaining sound and a ragged, starved one, and Gate adds the spitting, sputtering cutoff of a dying battery by killing the quiet parts of the waveform. Tone filters the top end and the clipping runs at twice the sample rate.",
  params: [["Fuzz", 0, 1, 0.7], ["Bias", 0, 1, 0.3], ["Gate", 0, 1, 0.1], ["Tone", 0, 1, 0.6, 0, { hz: [400, 8000] }], MIX(), ["Output", -24, 12, -6, 0, "db"]],
  groups: [
    { title: "FUZZ", items: [{ k: "knob", i: [0, 1, 2] }] },
    { title: "TONE", items: [{ k: "knob", i: [3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "TRANSFER CURVE",
  vizCode: transferViz(`var D=Math.pow(10,($Fuzz*40+10)/20),b=$Bias*0.8,v=x*D+b,y=v>=0?Math.tanh(v*1.6):0.8*Math.tanh(v*0.8),g=$Gate*0.25,a=Math.abs(y);a=Math.max(0,a-g)/(1-g);return y<0?-a:a`, 0.2),
  globals: osGlobals(`
  const v: f32 = x + gBias;
  let y: f32 = v >= 0.0 ? tanhf(v * 1.6) : 0.8 * tanhf(v * 0.8);
  const a: f32 = absf(y); const s: f32 = maxf(0.0, a - gGate) / (1.0 - gGate);
  return y < 0.0 ? -s : s;`, "let gBias: f32 = 0.0; let gGate: f32 = 0.0;"),
  init: osInit,
  block: `
  gBias = $Bias * 0.8; gGate = $Gate * 0.25;
  const D: f32 = dbLin(10.0 + $Fuzz * 40.0);
  const hpK: f32 = opK(60.0); const lpK: f32 = opK(expMap($Tone, 400.0, 8000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  hpz[c] += hpK * (x - hpz[c]);
  const w: f32 = os2(c, (x - hpz[c]) * D);${tail("w")}`,
  testParams: {},
};

// ---------------- Saturator ----------------
const saturator = {
  slug: "std-saturator", name: "StdSaturator", theme: "Distortion", subtitle: "Tape / tube / soft saturation",
  explanation: "A gentle, level-compensated saturator for warming up and gluing sounds rather than wrecking them. Tape is symmetrical tanh saturation (odd harmonics, rounded peaks), Tube is asymmetric (adds even harmonics, a thick fat low end) and Soft is a very mild x/(1+|x|) curve for a barely-there glue. Drive pushes the signal into the curve while the output is renormalised so more drive sounds richer rather than just louder; Warmth adds a low-shelf bump around 150 Hz after saturation and Tone rolls the highs off like tape does. Runs at twice the sample rate.",
  params: [["Drive", 0, 1, 0.4], ["Type", 0, 2, 0, 1, ["Tape", "Tube", "Soft"]], ["Warmth", 0, 1, 0.3], ["Tone", 0, 1, 0.9, 0, { hz: [2000, 20000] }], MIX(), OUT],
  groups: [
    { title: "SATURATION", items: [{ k: "seg", i: 1, label: "TYPE", opts: ["TAPE", "TUBE", "SOFT"] }, { k: "knob", i: [0, 2, 3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "TRANSFER CURVE",
  vizCode: transferViz(`var D=1+$Drive*7,t=Math.round($Type),v=x*D,y;if(t===0)y=Math.tanh(v)*0.25/Math.tanh(0.25*D);else if(t===1){y=(v>=0?Math.tanh(v):0.85*Math.tanh(v*1.2))*0.25/Math.tanh(0.25*D)}else y=(v/(1+Math.abs(v)))*0.25/(0.25*D/(1+0.25*D));return y`),
  globals: osGlobals(`
  if (gType == 0) return tanhf(x);
  if (gType == 1) return x >= 0.0 ? tanhf(x) : 0.85 * tanhf(x * 1.2);
  return x / (1.0 + absf(x));`, "let gType: i32 = 0;"),
  init: `${osInit}
  bqSet(shCf, 0, 5, 150.0, 0.7071, 0.0); for (let i = 0; i < 4; i++) shZ[i] = 0.0;`,
  block: `
  gType = i32($Type + 0.5);
  const D: f32 = 1.0 + $Drive * 7.0;
  const nrm: f32 = 0.25 / (gType == 2 ? (0.25 * D) / (1.0 + 0.25 * D) : tanhf(0.25 * D));
  bqSet(shCf, 0, 5, 150.0, 0.7071, $Warmth * 9.0);
  const lpK: f32 = opK(expMap($Tone, 2000.0, 20000.0)); const hpK: f32 = 0.0;
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  const w0: f32 = os2(c, x * D) * nrm;
  const w: f32 = bq(shCf, 0, shZ, c * 2, w0);${tail("w")}`,
  testParams: {},
};
saturator.globals += "\nconst shCf: StaticArray<f32> = new StaticArray<f32>(5);\nconst shZ: StaticArray<f32> = new StaticArray<f32>(4);";

// ---------------- Bitcrusher ----------------
const bitcrusher = {
  slug: "std-bitcrusher", name: "StdBitcrusher", theme: "Distortion", subtitle: "Bit depth and sample-rate reduction",
  explanation: "A digital degrader. Bits quantises the signal to between 1 and 16 bits (the fewer, the grittier and more noise-like), Rate resamples it at anything from 200 Hz up to the full sample rate with no anti-aliasing (the reflections are the point), and Dither adds a touch of noise before quantising to soften the stair-steps or, at high settings, to give lo-fi hiss. Tone smooths the result with a low-pass and Mix blends it with the clean signal for parallel crushing. A live picture shows the staircase the signal is being forced onto.",
  params: [["Bits", 1, 16, 8, 1, "int"], ["Rate", 0, 1, 0.7, 0, { hz: [200, 48000] }], ["Dither", 0, 1, 0.2], ["Tone", 0, 1, 1, 0, { hz: [500, 20000] }], MIX(), OUT],
  groups: [
    { title: "CRUSH", items: [{ k: "knob", i: [0, 1, 2, 3] }] },
    { title: "OUTPUT", items: [{ k: "knob", i: [4, 5] }] },
  ],
  vizLabel: "QUANTISED SIGNAL (1 kHz SINE)",
  vizCode: `frame(cx,r);
var bits=Math.round($Bits),lv=Math.pow(2,bits)/2,rate=200*Math.pow(240,$Rate),hold=Math.max(1,48000/rate),hp=hold*r[2]/192,ph=t/900;
function sg(i){return Math.sin(i/r[2]*Math.PI*8+ph)}
cx.beginPath();cx.strokeStyle="rgba(255,255,255,.25)";
for(var i=0;i<=r[2];i+=2){var py=r[1]+r[3]/2-sg(i)*(r[3]/2-8);i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke();
cx.beginPath();cx.strokeStyle="#fff";cx.lineWidth=2;var held=0,lastX=-1e9;
for(var j=0;j<=r[2];j++){if(j-lastX>=hp){lastX=j;held=Math.round(sg(j)*lv)/lv}var py2=r[1]+r[3]/2-held*(r[3]/2-8);j?cx.lineTo(r[0]+j,py2):cx.moveTo(r[0]+j,py2)}cx.stroke();cx.lineWidth=1;`,
  globals: `
const bph: StaticArray<f32> = new StaticArray<f32>(2); const bhold: StaticArray<f32> = new StaticArray<f32>(2);
const blp: StaticArray<f32> = new StaticArray<f32>(2);`,
  init: `for (let i = 0; i < 2; i++) { bph[i] = 1.0; bhold[i] = 0.0; blp[i] = 0.0; }`,
  block: `
  const step: f32 = 2.0 / f32(Mathf.pow(2.0, f32(i32($Bits + 0.5))));
  const ratio: f32 = minf(1.0, expMap($Rate, 200.0, 48000.0) / sr);
  const dith: f32 = $Dither * step;
  const lpK: f32 = opK(expMap($Tone, 500.0, 20000.0));
  const mix: f32 = $Mix; const outG: f32 = dbLin($Output);`,
  sample: `
  bph[c] += ratio;
  if (bph[c] >= 1.0) {
    bph[c] -= 1.0;
    const d: f32 = (rnd() + rnd()) * 0.5 * dith;
    bhold[c] = clampf(f32(Mathf.floor((x + d) / step + 0.5)) * step, -1.0, 1.0);
  }
  blp[c] += lpK * (bhold[c] - blp[c]);
  y = softLim((x * (1.0 - mix) + blp[c] * mix) * outG);`,
  testParams: {},
};

export default [distortion, overdrive, fuzz, saturator, bitcrusher];
